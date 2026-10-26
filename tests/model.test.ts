import { describe, it, expect } from 'vitest';
import { hexToRgb, rgbToHex } from '../src/core/model';

describe('colour helpers', () => {
  it('round-trips hex colours', () => {
    expect(rgbToHex(hexToRgb('#1a2b3c'))).toBe('#1a2b3c');
    expect(hexToRgb('nope')).toEqual({ r: 0, g: 0, b: 0 });
  });
});
