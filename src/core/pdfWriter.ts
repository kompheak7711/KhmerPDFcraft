/**
 * Writes shaped text into an existing PDF with pdf-lib, embedding each font as a
 * CID-keyed (Identity-H) subset so any OpenType font works, with ToUnicode and
 * ActualText so the Khmer text remains searchable and copyable.
 */
import { PDFDocument, PDFHexString, PDFName, PDFRef, PDFPage } from 'pdf-lib';
import { Shaper, clusterTexts, type ShapedGlyph } from './shaping';
import { fontFileInfo, subsetFont } from './fontInfo';
import type { TextItem } from './model';

export interface FontSource {
  id: string;
  bytes: Uint8Array;
}

export interface ExportOptions {
  /** OpenType script tag override for shaping (normally guessed per text). */
  script?: string;
  language?: string;
}

export class MissingGlyphError extends Error {
  constructor(public readonly fontId: string, public readonly char: string) {
    super(`The selected font has no glyph for "${char}" (U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`);
    this.name = 'MissingGlyphError';
  }
}

interface ShapedLine {
  text: string;
  glyphs: ShapedGlyph[];
}

interface ShapedItem {
  item: TextItem;
  lines: ShapedLine[];
}

interface FontBuild {
  source: FontSource;
  shaper: Shaper;
  usedGids: Set<number>;
  lines: ShapedLine[];
}

const COENG = '\u17d2';
const ZWSP = '\u200b';

/**
 * Builds the ToUnicode mapping (glyph id -> text) for one font. A ToUnicode entry is per
 * glyph, not per occurrence, so glyphs are mapped by what they represent: the nominal
 * glyph of a character maps to that character, a subscript consonant maps to
 * COENG + consonant, and anything left in a cluster maps to the cluster's unclaimed
 * characters (or a zero-width space). Viewers that honour ActualText (Acrobat, Preview)
 * get the exact typed text from the per-line ActualText instead.
 */
export function glyphUnicodeMap(shaper: Shaper, lines: ShapedLine[]): Map<number, string> {
  const map = new Map<number, string>();
  const dotted = shaper.glyphFor(0x25cc);
  const chars = new Set<string>();
  for (const line of lines) for (const ch of line.text) chars.add(ch);
  for (const ch of chars) {
    const gid = shaper.glyphFor(ch.codePointAt(0)!);
    if (gid !== undefined && !map.has(gid)) map.set(gid, ch);
  }
  for (const line of lines) {
    for (let i = 0; i + 1 < line.text.length; i++) {
      if (line.text[i] !== COENG) continue;
      const pair = line.text.slice(i, i + 2);
      const glyphs = shaper.shape(pair).filter((g) => g.gid !== 0 && g.gid !== dotted);
      if (glyphs.length === 1 && !map.has(glyphs[0].gid)) map.set(glyphs[0].gid, pair);
    }
  }
  for (const line of lines) {
    const texts = clusterTexts(line.text, line.glyphs);
    let start = 0;
    while (start < line.glyphs.length) {
      let end = start + 1;
      while (end < line.glyphs.length && line.glyphs[end].cluster === line.glyphs[start].cluster) end++;
      const cluster = line.glyphs.slice(start, end);
      let leftover = texts[start];
      for (const g of cluster) {
        const claimed = map.get(g.gid);
        if (claimed) for (const ch of claimed) leftover = leftover.replace(ch, '');
      }
      for (const g of cluster) {
        if (map.has(g.gid)) continue;
        map.set(g.gid, leftover || ZWSP);
        leftover = '';
      }
      start = end;
    }
  }
  return map;
}

const fmt = (n: number): string => {
  const s = n.toFixed(3);
  return s.replace(/\.?0+$/, '') || '0';
};

function utf16beHex(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) out += text.charCodeAt(i).toString(16).padStart(4, '0');
  return out;
}

function escapePdfName(s: string): string {
  return s.replace(/[^\x21-\x7e]|[#\/()<>\[\]{}%]/g, (c) => `#${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

function subsetTag(seed: number): string {
  let s = '';
  let x = seed;
  for (let i = 0; i < 6; i++) {
    s += String.fromCharCode(65 + (x % 26));
    x = Math.floor(x / 26) + 7;
  }
  return s;
}

function buildToUnicodeCMap(entries: Map<number, string>): string {
  const lines: string[] = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <ffff>',
    'endcodespacerange',
  ];
  const items = [...entries.entries()].filter(([, t]) => t.length > 0).sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100);
    lines.push(`${chunk.length} beginbfchar`);
    for (const [cid, text] of chunk) lines.push(`<${cid.toString(16).padStart(4, '0')}> <${utf16beHex(text)}>`);
    lines.push('endbfchar');
  }
  lines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end');
  return lines.join('\n');
}

/** Baseline of line `i` measured downward from the top of the text box, in points.
 *  Mirrors CSS line boxes: half-leading above and below the font's ascender/descender. */
export function baselineFromTop(i: number, fontSize: number, lineHeight: number, ascender: number, descender: number, unitsPerEm: number): number {
  const scale = fontSize / unitsPerEm;
  const line = fontSize * lineHeight;
  const content = (ascender - descender) * scale; // descender is negative
  const halfLeading = (line - content) / 2;
  return i * line + halfLeading + ascender * scale;
}

/** Shapes every item and returns the fonts to embed. Throws MissingGlyphError. */
function shapeItems(items: TextItem[], fonts: Map<string, FontSource>, opts: ExportOptions): { shaped: ShapedItem[]; builds: Map<string, FontBuild> } {
  const builds = new Map<string, FontBuild>();
  const shaped: ShapedItem[] = [];
  for (const item of items) {
    if (item.text.trim().length === 0) continue;
    let build = builds.get(item.fontId);
    if (!build) {
      const source = fonts.get(item.fontId);
      if (!source) throw new Error(`Font "${item.fontId}" is not loaded`);
      build = { source, shaper: new Shaper(source.bytes), usedGids: new Set(), lines: [] };
      builds.set(item.fontId, build);
    }
    const missing = build.shaper.firstMissingChar(item.text);
    if (missing !== undefined) throw new MissingGlyphError(item.fontId, missing);
    const lines: ShapedLine[] = [];
    for (const text of item.text.split('\n')) {
      const glyphs = build.shaper.shape(text, { script: opts.script, language: opts.language });
      for (const g of glyphs) build.usedGids.add(g.gid);
      const line = { text, glyphs };
      lines.push(line);
      build.lines.push(line);
    }
    shaped.push({ item, lines });
  }
  return { shaped, builds };
}

async function embedFont(doc: PDFDocument, build: FontBuild, seed: number): Promise<{ ref: PDFRef; gidMap: Map<number, number> }> {
  const info = fontFileInfo(build.source.bytes);
  const { bytes, gidMap } = await subsetFont(build.source.bytes, build.usedGids);
  const scale = 1000 / info.unitsPerEm;
  const baseFont = `${subsetTag(seed)}+${info.postscriptName}`;

  const widths: (number | number[])[] = [];
  const bySubsetGid = [...gidMap.entries()].sort((a, b) => a[1] - b[1]);
  for (const [orig, sub] of bySubsetGid) widths.push(sub, [Math.round(build.shaper.advance(orig) * scale)]);

  const fontStream = doc.context.flateStream(bytes, info.isCFF ? { Subtype: 'CIDFontType0C' } : { Length1: bytes.length });
  const fontStreamRef = doc.context.register(fontStream);

  const descriptor = doc.context.obj({
    Type: 'FontDescriptor',
    FontName: PDFName.of(escapePdfName(baseFont)),
    Flags: 4,
    FontBBox: [info.bbox.minX * scale, info.bbox.minY * scale, info.bbox.maxX * scale, info.bbox.maxY * scale].map(Math.round),
    ItalicAngle: info.italicAngle,
    Ascent: Math.round(info.ascent * scale),
    Descent: Math.round(info.descent * scale),
    CapHeight: Math.round(info.capHeight * scale),
    StemV: 80,
    [info.isCFF ? 'FontFile3' : 'FontFile2']: fontStreamRef,
  });
  const descriptorRef = doc.context.register(descriptor);

  const toUnicodeSub = new Map<number, string>();
  for (const [orig, text] of glyphUnicodeMap(build.shaper, build.lines)) {
    const sub = gidMap.get(orig);
    if (sub !== undefined) toUnicodeSub.set(sub, text);
  }
  const toUnicodeRef = doc.context.register(doc.context.flateStream(buildToUnicodeCMap(toUnicodeSub)));

  const cidFont = doc.context.obj({
    Type: 'Font',
    Subtype: info.isCFF ? 'CIDFontType0' : 'CIDFontType2',
    BaseFont: PDFName.of(escapePdfName(baseFont)),
    CIDSystemInfo: { Registry: PDFHexString.fromText('Adobe'), Ordering: PDFHexString.fromText('Identity'), Supplement: 0 },
    FontDescriptor: descriptorRef,
    DW: 1000,
    W: widths,
    CIDToGIDMap: 'Identity',
  });
  const cidFontRef = doc.context.register(cidFont);

  const type0 = doc.context.obj({
    Type: 'Font',
    Subtype: 'Type0',
    BaseFont: PDFName.of(escapePdfName(baseFont)),
    Encoding: 'Identity-H',
    DescendantFonts: [cidFontRef],
    ToUnicode: toUnicodeRef,
  });
  return { ref: doc.context.register(type0), gidMap };
}

function drawItem(page: PDFPage, fontName: string, build: FontBuild, gidMap: Map<number, number>, s: ShapedItem): string {
  const { item } = s;
  const { ascender, descender } = build.shaper.extents();
  const upem = build.shaper.unitsPerEm;
  const scale = item.fontSize / upem;
  // pdf.js displays the crop box, so box positions are relative to it.
  const crop = page.getCropBox();
  const ops: string[] = [];
  s.lines.forEach((line, i) => {
    if (line.glyphs.length === 0) return;
    const baseline = crop.y + crop.height - (item.top + baselineFromTop(i, item.fontSize, item.lineHeight, ascender, descender, upem));
    ops.push(`/Span << /ActualText <FEFF${utf16beHex(line.text)}> >> BDC`);
    ops.push('BT');
    ops.push(`${fontName} ${fmt(item.fontSize)} Tf`);
    ops.push(`${fmt(item.color.r)} ${fmt(item.color.g)} ${fmt(item.color.b)} rg`);
    let penX = crop.x + item.left;
    let penY = baseline;
    for (const g of line.glyphs) {
      const sub = gidMap.get(g.gid) ?? 0;
      const x = penX + g.xOffset * scale;
      const y = penY + g.yOffset * scale;
      ops.push(`1 0 0 1 ${fmt(x)} ${fmt(y)} Tm <${sub.toString(16).padStart(4, '0')}> Tj`);
      penX += g.xAdvance * scale;
      penY += g.yAdvance * scale;
    }
    ops.push('ET');
    ops.push('EMC');
  });
  return ops.join('\n');
}

/**
 * Returns a new PDF with every text item drawn onto its page. The original bytes are
 * not modified. Fonts are embedded once per face.
 */
export async function exportPdf(original: Uint8Array, items: TextItem[], fonts: Map<string, FontSource>, opts: ExportOptions = {}): Promise<Uint8Array> {
  const { shaped, builds } = shapeItems(items, fonts, opts);
  const doc = await PDFDocument.load(original, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();

  const embedded = new Map<string, { ref: PDFRef; gidMap: Map<number, number> }>();
  let seed = 1;
  for (const [id, build] of builds) embedded.set(id, await embedFont(doc, build, seed++));

  const perPage = new Map<number, string[]>();
  const fontNames = new Map<string, string>(); // `${pageIndex}:${fontId}` -> resource name
  for (const s of shaped) {
    const page = pages[s.item.pageIndex];
    if (!page) continue;
    const key = `${s.item.pageIndex}:${s.item.fontId}`;
    let name = fontNames.get(key);
    if (!name) {
      name = page.node.newFontDictionary('KPC', embedded.get(s.item.fontId)!.ref).toString();
      fontNames.set(key, name);
    }
    const build = builds.get(s.item.fontId)!;
    const ops = drawItem(page, name, build, embedded.get(s.item.fontId)!.gidMap, s);
    if (!perPage.has(s.item.pageIndex)) perPage.set(s.item.pageIndex, []);
    perPage.get(s.item.pageIndex)!.push(ops);
  }

  for (const [pageIndex, chunks] of perPage) {
    const page = pages[pageIndex];
    // Isolate the page's existing graphics state (which may leave a transform or clip
    // behind) so our text is drawn in the page's default coordinate system.
    page.node.normalize();
    const q = doc.context.register(doc.context.stream('q\n'));
    const Q = doc.context.register(doc.context.stream('\nQ\n'));
    page.node.wrapContentStreams(q, Q);
    const content = doc.context.flateStream(`q\n${chunks.join('\n')}\nQ\n`);
    page.node.addContentStream(doc.context.register(content));
  }

  return doc.save({ useObjectStreams: false });
}
