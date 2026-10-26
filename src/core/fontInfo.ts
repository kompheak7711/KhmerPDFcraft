/** Font file inspection and subsetting through fontkit (the pdf-lib build of it). */
import fontkit from '@pdf-lib/fontkit';

export interface FontFileInfo {
  familyName: string;
  styleName: string;
  postscriptName: string;
  fullName: string;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  capHeight: number;
  italicAngle: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  isCFF: boolean;
  numGlyphs: number;
}

// fontkit's types do not describe collections or the `cff` table; keep the escape hatch local.
type AnyFont = ReturnType<typeof fontkit.create> & { fonts?: AnyFont[]; cff?: unknown; 'OS/2'?: { xHeight?: number } };

export function parseFont(bytes: Uint8Array): AnyFont {
  let font = fontkit.create(bytes) as AnyFont;
  if (font.fonts && font.fonts.length > 0) font = font.fonts[0];
  if (typeof font.unitsPerEm !== 'number' || !font.unitsPerEm) throw new Error('Not a usable font file');
  return font;
}

export function fontFileInfo(bytes: Uint8Array): FontFileInfo {
  const font = parseFont(bytes);
  const family = font.familyName || font.postscriptName || 'Unnamed font';
  return {
    familyName: family,
    styleName: font.subfamilyName || 'Regular',
    postscriptName: (font.postscriptName || family).replace(/[^\x21-\x7e]/g, '').replace(/[\s/()\[\]<>{}%#]/g, '') || 'Font',
    fullName: font.fullName || family,
    unitsPerEm: font.unitsPerEm,
    ascent: font.ascent,
    descent: font.descent,
    capHeight: font.capHeight || font.ascent,
    italicAngle: font.italicAngle || 0,
    bbox: { minX: font.bbox.minX, minY: font.bbox.minY, maxX: font.bbox.maxX, maxY: font.bbox.maxY },
    isCFF: Boolean(font.cff),
    numGlyphs: font.numGlyphs,
  };
}

/** Builds a subset font containing exactly the given glyph IDs (plus .notdef).
 *  Returns the subset bytes and a map from original glyph ID to its ID in the subset. */
export async function subsetFont(bytes: Uint8Array, gids: Iterable<number>): Promise<{ bytes: Uint8Array; gidMap: Map<number, number> }> {
  const font = parseFont(bytes);
  const subset = font.createSubset();
  const gidMap = new Map<number, number>();
  gidMap.set(0, subset.includeGlyph(0));
  for (const gid of gids) {
    if (!gidMap.has(gid)) gidMap.set(gid, subset.includeGlyph(font.getGlyph(gid)));
  }
  const out = await new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    try {
      subset
        .encodeStream()
        .on('data', (c: Uint8Array) => chunks.push(c))
        .on('end', () => {
          const total = chunks.reduce((n, c) => n + c.length, 0);
          const buf = new Uint8Array(total);
          let o = 0;
          for (const c of chunks) {
            buf.set(c, o);
            o += c.length;
          }
          resolve(buf);
        });
    } catch (e) {
      reject(e);
    }
  });
  return { bytes: out, gidMap };
}
