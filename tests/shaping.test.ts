import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Shaper, clusterTexts } from '../src/core/shaping';

const notoKhmer = new Uint8Array(readFileSync('public/fonts/NotoSansKhmer-Regular.ttf'));
const battambang = new Uint8Array(readFileSync('public/fonts/Battambang-Regular.ttf'));

describe('Shaper with Noto Sans Khmer', () => {
  const shaper = new Shaper(notoKhmer);

  it('reports font units and extents', () => {
    expect(shaper.unitsPerEm).toBe(1000);
    const e = shaper.extents();
    expect(e.ascender).toBeGreaterThan(0);
    expect(e.descender).toBeLessThan(0);
  });

  it('shapes a coeng (subscript) consonant into a different glyph than the base form', () => {
    // ខ្មែរ = KHA, COENG, MO, VOWEL AE, RO. The coeng+MO must become a subscript glyph.
    const text = 'ខ្មែរ';
    const glyphs = shaper.shape(text);
    expect(glyphs.length).toBeGreaterThan(0);
    const plainMo = shaper.glyphFor('ម'.codePointAt(0)!);
    const gids = glyphs.map((g) => g.gid);
    expect(gids).not.toContain(plainMo); // MO only appears as a subscript form
    expect(gids).not.toContain(0); // nothing missing
    // Every glyph's cluster points inside the text.
    for (const g of glyphs) expect(g.cluster).toBeLessThan(text.length);
  });

  it('positions marks with GPOS offsets', () => {
    // KA + VOWEL SIGN II (above-base mark): the mark must get a non-zero offset or zero advance.
    const glyphs = shaper.shape('កី');
    const mark = glyphs[glyphs.length - 1];
    expect(mark.xAdvance === 0 || mark.xOffset !== 0 || mark.yOffset !== 0).toBe(true);
  });

  it('reorders a pre-base vowel in front of its consonant', () => {
    // KA + VOWEL SIGN E (U+17C1) is typed consonant first but drawn vowel first.
    const text = 'កេ';
    const glyphs = shaper.shape(text);
    const e = shaper.glyphFor(0x17c1)!;
    const ka = shaper.glyphFor(0x1780)!;
    expect(glyphs.map((g) => g.gid)).toEqual([e, ka]);
  });

  it('finds characters the font lacks', () => {
    expect(shaper.firstMissingChar('ខ្មែរ 123')).toBeUndefined();
    expect(shaper.firstMissingChar('ខ្មែរ 中')).toBe('中');
    expect(shaper.firstMissingChar('a\nb​')).toBeUndefined();
  });

  it('measures text', () => {
    expect(shaper.measure('ខ្មែរ')).toBeGreaterThan(0);
    expect(shaper.measure('')).toBe(0);
  });
});

describe('clusterTexts', () => {
  it('assigns each cluster text to its first glyph only', () => {
    const shaper = new Shaper(battambang);
    const text = 'ខ្មែរ';
    const glyphs = shaper.shape(text);
    const texts = clusterTexts(text, glyphs);
    expect(texts.length).toBe(glyphs.length);
    expect(texts.join('')).toBe(text); // every character lands in exactly one cluster
  });
});
