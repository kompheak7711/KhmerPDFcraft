/**
 * HarfBuzz shaping for a single font. This is the piece PdfCraft and Stirling-PDF lack
 * for Khmer: it turns a Unicode string into positioned glyph IDs, applying the font's
 * GSUB (coeng subscripts, pre-base vowels, ligatures) and GPOS (mark placement) rules.
 */
import * as hb from 'harfbuzzjs';

/** One positioned glyph. All numbers are in font units (per `unitsPerEm`). */
export interface ShapedGlyph {
  gid: number;
  /** UTF-16 index into the shaped string of the cluster this glyph belongs to. */
  cluster: number;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
}

export interface FontExtents {
  ascender: number;
  descender: number;
  lineGap: number;
}

export interface ShapeOptions {
  /** OpenType script tag, e.g. "khmr". Guessed from the text when omitted. */
  script?: string;
  /** BCP 47 language, e.g. "km". */
  language?: string;
}

export class Shaper {
  readonly unitsPerEm: number;
  private readonly face: hb.Face;
  private readonly font: hb.Font;

  constructor(fontBytes: Uint8Array, faceIndex = 0) {
    const blob = new hb.Blob(fontBytes);
    this.face = new hb.Face(blob, faceIndex);
    this.unitsPerEm = this.face.upem;
    this.font = new hb.Font(this.face);
    this.font.setScale(this.unitsPerEm, this.unitsPerEm);
  }

  extents(): FontExtents {
    return this.font.hExtents();
  }

  /** Horizontal advance of a glyph in font units. */
  advance(gid: number): number {
    return this.font.glyphHAdvance(gid);
  }

  /** Nominal glyph for a code point, or undefined when the font lacks it. */
  glyphFor(codePoint: number): number | undefined {
    const gid = this.font.glyph(codePoint);
    return gid === undefined || gid === 0 ? undefined : gid;
  }

  /** The first character (other than whitespace and format controls) the font has no glyph for. */
  firstMissingChar(text: string): string | undefined {
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (cp === 0x0a || cp === 0x0d || cp === 0x09) continue;
      if (/\p{Cf}/u.test(ch)) continue;
      if (this.glyphFor(cp) === undefined) return ch;
    }
    return undefined;
  }

  shape(text: string, opts: ShapeOptions = {}): ShapedGlyph[] {
    if (text.length === 0) return [];
    const buffer = new hb.Buffer();
    buffer.addText(text);
    buffer.guessSegmentProperties();
    if (opts.script) buffer.setScript(opts.script);
    if (opts.language) buffer.setLanguage(opts.language);
    buffer.setClusterLevel(hb.ClusterLevel.MONOTONE_GRAPHEMES);
    hb.shape(this.font, buffer);
    const infos = buffer.getGlyphInfos();
    const positions = buffer.getGlyphPositions();
    const out: ShapedGlyph[] = new Array(infos.length);
    for (let i = 0; i < infos.length; i++) {
      out[i] = {
        gid: infos[i].codepoint,
        cluster: infos[i].cluster,
        xAdvance: positions[i].xAdvance,
        yAdvance: positions[i].yAdvance,
        xOffset: positions[i].xOffset,
        yOffset: positions[i].yOffset,
      };
    }
    return out;
  }

  /** Advance width of `text` after shaping, in font units. */
  measure(text: string, opts?: ShapeOptions): number {
    let w = 0;
    for (const g of this.shape(text, opts)) w += g.xAdvance;
    return w;
  }

  /** Objects are released by the harfbuzzjs finalization registry; drop references to free them. */
  destroy(): void {
    // intentionally empty
  }
}

/**
 * Groups shaped glyphs by cluster and returns, for each glyph, the Unicode text of the
 * cluster it starts (empty for glyphs that continue a cluster). Used for ToUnicode.
 * Assumes left-to-right, monotone clusters, which is what Khmer and Latin produce.
 */
export function clusterTexts(text: string, glyphs: ShapedGlyph[]): string[] {
  const starts = Array.from(new Set(glyphs.map((g) => g.cluster))).sort((a, b) => a - b);
  const end = new Map<number, number>();
  for (let i = 0; i < starts.length; i++) end.set(starts[i], i + 1 < starts.length ? starts[i + 1] : text.length);
  const seen = new Set<number>();
  return glyphs.map((g) => {
    if (seen.has(g.cluster)) return '';
    seen.add(g.cluster);
    return text.slice(g.cluster, end.get(g.cluster));
  });
}
