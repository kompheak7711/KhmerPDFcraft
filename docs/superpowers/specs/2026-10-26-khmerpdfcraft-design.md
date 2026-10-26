# KhmerPDFcraft design

Date: 2026-10-26. Status: implemented in this repository (v0.1).

## Intent

The user likes PdfCraft and Stirling-PDF but cannot type Khmer Unicode in PdfCraft, and
cannot use macOS or custom fonts in Stirling-PDF (see
`docs/analysis/why-pdfcraft-and-stirling-fail-khmer.md`). They want their own PDF
application in which they can type Khmer Unicode text onto a PDF using a Khmer Unicode
font of their choice, including fonts installed on their Mac.

Success means: open a PDF, click on a page, type Khmer with the macOS Khmer keyboard,
pick a Khmer font (bundled, uploaded, or installed on the Mac), download a PDF in which
the text is rendered correctly in that font and is searchable.

## Assumptions (stated because the session ran without the user present)

- A web application that runs locally (`npm run dev`) is acceptable as "my own PDF
  application". It can be wrapped in Electron or Tauri later without changing the core.
- Scope is the text feature the user is missing. Page organising, merging, signing and
  so on are left to PdfCraft and Stirling-PDF, which the user already has and likes.
- Text boxes do not auto-wrap; Enter starts a new line. This keeps the on-screen preview
  and the PDF output identical and avoids inventing Khmer line-breaking rules.
- "macOS fonts" are reached through the Local Font Access API, which exists in Chrome
  and Edge. In Safari and Firefox the user drops the font file in instead (fonts live in
  `/Library/Fonts`, `~/Library/Fonts` and `/System/Library/Fonts`).

## Approaches considered

1. Fork PdfCraft and add a Khmer face the way Arabic was added. Rejected: it hard-codes
   one face per script, which is the limitation the user hit; still no custom fonts.
2. Fork Stirling-PDF's text tool. Rejected: large Java and React codebase for a small
   change, and the PDFium fallback path gives no control over which font is embedded.
3. Small standalone app: pdf.js for viewing, HarfBuzz (WASM) for shaping, pdf-lib for
   writing the PDF with an embedded CID font. Chosen: every piece is a well-maintained
   library, the whole thing is a few files, and it supports any OpenType font.

## Architecture

```
src/core/shaping.ts   HarfBuzz wrapper: text + font bytes -> glyph runs (gid, advance, offsets, cluster)
src/core/fonts.ts     Font registry: bundled faces, uploaded files, local fonts; FontFace registration for preview
src/core/pdfWriter.ts pdf-lib: embed a subset CIDFontType2/CIDFontType0 font, draw shaped runs, ToUnicode, ActualText
src/core/model.ts     TextItem and document state types
src/ui/*              React: toolbar, page canvas (pdf.js), draggable/editable text boxes, font panel
```

Data flow: user types in a text box (HTML textarea styled with the chosen font via the
FontFace API, so the browser shapes Khmer live). On export, each text item's lines are
shaped by HarfBuzz with the same font bytes; the resulting glyph IDs are subset into a
new font, embedded once per face per document, and drawn with explicit per-glyph
positioning (`Tm` + `Tj`) so GPOS offsets for marks and subscripts are honoured.

Coordinates: text items are stored in PDF user space (points, origin bottom-left) per
page so zoom never changes the saved result.

## Font handling

- Bundled (OFL): Noto Sans Khmer, Noto Serif Khmer, Battambang, Kantumruy Pro, Moul,
  Noto Sans (Latin). Static Regular/Bold instances generated from the Google Fonts
  variable sources, because PDF viewers ignore variation axes.
- Uploaded: `.ttf` / `.otf` (also `.ttc` index 0). Stored in IndexedDB so they survive a
  reload.
- Local (Chromium): `navigator.queryLocalFonts()`; the chosen font's bytes are read
  with `FontData.blob()` and treated exactly like an upload.
- Limitation: HarfBuzz in harfbuzzjs is built without AAT, so Apple's AAT-only Khmer
  fonts (Khmer MN, Khmer Sangam MN) may shape incorrectly. OpenType Khmer fonts
  (Khmer OS family, Noto, Google Fonts Khmer faces) shape correctly.

## PDF output

- Font: `/Type0` with `/Encoding /Identity-H`, descendant `/CIDFontType2` (TrueType) or
  `/CIDFontType0` (CFF) with `/CIDToGIDMap /Identity`, `/W` widths from the subset, and a
  `/FontDescriptor` with `/FontFile2` or `/FontFile3`. Same shape pdf-lib itself writes.
- Text: per line `BT /Fn size Tf r g b rg` then for each glyph `1 0 0 1 x y Tm <gid> Tj`,
  wrapped in `/Span << /ActualText (UTF-16BE line) >> BDC ... EMC`.
- ToUnicode: each glyph maps to the Unicode text of the cluster it begins; ActualText is
  the authoritative extraction path.

## Error handling

- Font that fails to parse: shown in the font panel as an error, never embedded.
- Font lacking a character: HarfBuzz returns glyph 0; the exporter reports the first
  missing character and refuses to write a .notdef box silently.
- Export failures surface in the toolbar; nothing is downloaded on failure.

## Testing

- Unit (vitest, Node): shaping Khmer with Noto Sans Khmer produces subscript glyphs and
  non-zero mark offsets; exported PDF contains an embedded CID font and ActualText; pdf.js
  extracts the original Khmer string back from the export.
- End-to-end (Playwright, Chromium): load the app, add Khmer text, export, reopen the
  export in pdf.js and screenshot.

## Out of scope for v0.1

Auto-wrapping paragraphs, editing existing PDF text, annotations other than text,
desktop packaging, rich text (mixed fonts in one box), undo history beyond the session.
