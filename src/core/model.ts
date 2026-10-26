/** A text box placed on a page. Positions are PDF points measured from the page's
 *  top-left corner (y grows downward), so zoom never changes what gets saved. */
export interface TextItem {
  id: string;
  pageIndex: number;
  /** Left edge of the box, in PDF points from the page's left edge. */
  left: number;
  /** Top edge of the box, in PDF points from the page's top edge. */
  top: number;
  /** Raw text; `\n` separates lines. No automatic wrapping. */
  text: string;
  fontId: string;
  fontSize: number;
  /** Line height as a multiple of the font size. */
  lineHeight: number;
  /** 0..1 each. */
  color: { r: number; g: number; b: number };
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
