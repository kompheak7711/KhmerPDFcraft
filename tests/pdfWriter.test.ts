import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFDict, PDFRawStream, PDFRef } from 'pdf-lib';
import { exportPdf, MissingGlyphError, baselineFromTop, glyphUnicodeMap } from '../src/core/pdfWriter';
import { Shaper } from '../src/core/shaping';
import type { TextItem } from '../src/core/model';

const notoKhmer = new Uint8Array(readFileSync('public/fonts/NotoSansKhmer-Regular.ttf'));

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawRectangle({ x: 50, y: 50, width: 100, height: 100 });
  return doc.save();
}

const item = (over: Partial<TextItem> = {}): TextItem => ({
  id: 't1',
  pageIndex: 0,
  left: 72,
  top: 72,
  text: 'សួស្តី ពិភពលោក\nខ្មែរ',
  fontId: 'noto',
  fontSize: 24,
  lineHeight: 1.4,
  color: { r: 0, g: 0, b: 1 },
  ...over,
});

const fonts = new Map([['noto', { id: 'noto', bytes: notoKhmer }]]);

describe('exportPdf', () => {
  it('embeds a CID font and draws the text with ActualText', async () => {
    const out = await exportPdf(await blankPdf(), [item()], fonts);
    const doc = await PDFDocument.load(out);
    const page = doc.getPage(0);
    const resources = page.node.Resources()!;
    const fontDict = resources.lookup(PDFName.of('Font'), PDFDict);
    const names = fontDict.keys().map((k) => k.toString());
    expect(names.length).toBe(1);
    const type0 = fontDict.lookup(names[0] === '/KPC' ? PDFName.of('KPC') : PDFName.of(names[0].slice(1)), PDFDict);
    expect(type0.get(PDFName.of('Subtype'))!.toString()).toBe('/Type0');
    expect(type0.get(PDFName.of('Encoding'))!.toString()).toBe('/Identity-H');
    const descendants = type0.lookup(PDFName.of('DescendantFonts'));
    expect(descendants).toBeDefined();
    const cid = doc.context.lookup((descendants as any).get(0) as PDFRef, PDFDict);
    expect(cid.get(PDFName.of('Subtype'))!.toString()).toBe('/CIDFontType2');
    const descriptor = cid.lookup(PDFName.of('FontDescriptor'), PDFDict);
    expect(descriptor.get(PDFName.of('FontFile2'))).toBeDefined();
    const fontFile = descriptor.lookup(PDFName.of('FontFile2'), PDFRawStream);
    expect(fontFile.contents.length).toBeGreaterThan(100);
    expect(fontFile.contents.length).toBeLessThan(notoKhmer.length); // subset

    // Content: our stream is the last one and carries ActualText + glyph codes.
    const contents = page.node.Contents()!;
    const last = doc.context.lookup((contents as any).get((contents as any).size() - 1) as PDFRef, PDFRawStream);
    const { inflateSync } = await import('node:zlib');
    const text = Buffer.from(inflateSync(Buffer.from(last.contents))).toString('latin1');
    expect(text).toContain('/ActualText <FEFF');
    expect(text).toContain(' Tf');
    expect(text).toContain(' Tj');
    expect(text).toContain('0 0 1 rg');
    const lines = text.split('\n').filter((l) => l.includes('BDC'));
    expect(lines.length).toBe(2);
  });

  it('extracts the original Khmer text back through pdf.js', async () => {
    const out = await exportPdf(await blankPdf(), [item({ text: 'ខ្មែរ' })], fonts);
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: out, useSystemFonts: false, isEvalSupported: false }).promise;
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const joined = content.items.map((i: any) => i.str ?? '').join('');
    // pdf.js ignores ActualText and concatenates per-glyph ToUnicode in drawing order, so
    // the pre-base vowel comes out before its consonant; every character must still be
    // present exactly once and nothing else (no raw glyph ids, no zero-width fillers).
    expect([...joined].sort().join('')).toBe([...'ខ្មែរ'].sort().join(''));
    await doc.cleanup();
  });

  it('reuses one embedded font for several items and pages', async () => {
    const base = await PDFDocument.create();
    base.addPage([595, 842]);
    base.addPage([595, 842]);
    const out = await exportPdf(await base.save(), [item(), item({ id: 't2', pageIndex: 1, text: 'ទំព័រ ២' })], fonts);
    const doc = await PDFDocument.load(out);
    const fontRefs = doc.getPages().map((p) => p.node.Resources()!.lookup(PDFName.of('Font'), PDFDict).values()[0].toString());
    expect(fontRefs[0]).toBe(fontRefs[1]);
  });

  it('refuses text the font cannot draw', async () => {
    await expect(exportPdf(await blankPdf(), [item({ text: '中文' })], fonts)).rejects.toBeInstanceOf(MissingGlyphError);
  });

  it('skips empty items without touching the page', async () => {
    const src = await blankPdf();
    const out = await exportPdf(src, [item({ text: '   ' })], fonts);
    const doc = await PDFDocument.load(out);
    const font = doc.getPage(0).node.Resources()!.get(PDFName.of('Font'));
    expect(font === undefined || (font as PDFDict).keys().length === 0).toBe(true);
  });

  it('maps subscript consonants to COENG + consonant in ToUnicode', () => {
    const shaper = new Shaper(notoKhmer);
    const text = 'ខ្មែរ';
    const map = glyphUnicodeMap(shaper, [{ text, glyphs: shaper.shape(text) }]);
    const values = [...map.values()];
    expect(values).toContain('្ម');
    expect(values).toContain('ខ');
    expect(values).toContain('ែ');
    expect(values).toContain('រ');
  });

  it('places text relative to the crop box', async () => {
    const base = await PDFDocument.create();
    const page = base.addPage([600, 800]);
    page.setCropBox(100, 100, 400, 600);
    const out = await exportPdf(await base.save(), [item({ left: 0, top: 0, text: 'ក' })], fonts);
    const doc = await PDFDocument.load(out);
    const contents = doc.getPage(0).node.Contents()!;
    const last = doc.context.lookup((contents as any).get((contents as any).size() - 1) as PDFRef, PDFRawStream);
    const { inflateSync } = await import('node:zlib');
    const text = Buffer.from(inflateSync(Buffer.from(last.contents))).toString('latin1');
    const m = /1 0 0 1 ([\d.]+) ([\d.]+) Tm/.exec(text)!;
    expect(Number(m[1])).toBeCloseTo(100, 0); // crop.x + left
    expect(Number(m[2])).toBeLessThan(700); // below crop top (100 + 600)
    expect(Number(m[2])).toBeGreaterThan(650);
  });

  it('computes baselines like CSS line boxes', () => {
    // 1000 upem, ascender 800, descender -200, size 10, line-height 1.5 => line 15, content 10, half-leading 2.5
    expect(baselineFromTop(0, 10, 1.5, 800, -200, 1000)).toBeCloseTo(10.5);
    expect(baselineFromTop(1, 10, 1.5, 800, -200, 1000)).toBeCloseTo(25.5);
  });
});
