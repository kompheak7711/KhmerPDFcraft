# Why Khmer text fails in PdfCraft and Stirling-PDF

This is the finding ledger behind KhmerPDFcraft, written in the style the
[REA "reverse-engineer-anything" skill](https://github.com/morluto/rea) asks for:
each conclusion is tied to the evidence that supports it, and observations are kept
apart from inferences and unknowns. Both targets publish their full source, so (as the
REA skill itself instructs for complete source repositories) the analysis uses normal
source reading rather than binary or runtime instrumentation.

Targets, as cloned on 2026-10-26:

- PdfCraft: https://github.com/storytold/pdfcraft (Rust, egui)
- Stirling-PDF: https://github.com/Stirling-Tools/Stirling-PDF (Java backend, React frontend on `@embedpdf`/PDFium)

## Question 1: Why can't PdfCraft type Khmer in "Add text"?

### Observations

- `crates/fonts/Cargo.toml` describes the font crate as "Font metrics and text encoding
  helpers for generated appearances (standard fonts, WinAnsi)". Its only shaping
  dependency is `harfrust` for "Arabic shaping for text written into PDFs".
- `crates/edit/src/added.rs` imports `Std14`, `win_ansi`, `shape_arabic`, `shape_hebrew`,
  `shape_thai`. `Family::base_font` maps the chosen family to a standard-14 font name.
- `added.rs` line ~397: when the item is not "shaped by a face", the text is "drawn line
  by line in the item's standard font" and the function returns
  `pdfcraft_fonts::first_non_win_ansi(line)`, that is, the first character outside
  WinAnsi is reported as an error.
- `shaped_by_a_face` (line ~414) only returns true for Arabic (`document_arabic_font`) and
  Hebrew (`document_hebrew_font`); `shaped_layout` (line ~473) classifies characters as
  Thai, Hebrew or Arabic only. No branch mentions Khmer (U+1780–U+17FF).
- `ROADMAP.md` entries dated 2026-10-09/10/14 describe adding Arabic, Thai and Hebrew to
  Add text one script at a time, each with a specific craft-fonts face compiled into the app.

### Conclusion (high confidence, static evidence)

PdfCraft's Add text writes with the PDF standard-14 fonts (WinAnsi encoding, Latin only)
and bolts on exactly three complex scripts via bundled faces. Khmer is not one of them,
so a Khmer character is rejected as "not WinAnsi" before anything is written. There is
no user-selectable or uploadable font in that path.

### Unknowns

- Whether a Khmer face is planned; the roadmap does not say.

## Question 2: Why can Stirling-PDF show Khmer but not use Mac or custom fonts?

### Observations

- `frontend/src/editor/core/components/annotation/shared/TextInputWithFont.tsx` defines the
  font picker for the text annotation tool as a fixed list of five names:
  Helvetica, Times-Roman, Courier, Arial, Georgia. There is no file input or
  system-font query in that component.
- `frontend/scripts/embedpdfFontFallbackPatch.mts` patches the pinned `@embedpdf/engines`
  (PDFium) font fallback: "its PDFium font fallback picks a face by charset only". The
  patch exists to choose serif/mono fallbacks by name; it confirms rendering of
  non-embedded fonts goes through PDFium's charset-based fallback.
- `app/core/src/main/resources/static/fonts/` ships Noto Sans faces for Arabic,
  Devanagari, Hebrew, JP, KR, SC, TC, Malayalam, Thai and Tibetan, and DejaVu/Liberation.
  No Khmer face is in that directory.

### Conclusions

- Khmer appears on screen because the viewer engine (PDFium in the browser) falls back
  to whatever font covers the characters, not because the tool lets you choose a Khmer
  font (medium confidence: inferred from the fallback patch and the fixed font list;
  the exact fallback face is not established here).
- Custom or macOS fonts cannot be used because the only inputs to the text tool are the
  five hard-coded family names (high confidence, static evidence).

### Unknowns

- How the backend flattens the text annotation into the PDF (PDFBox font choice) was not
  traced; it does not change the answer to the user's question.

## What the rebuild needs (derived requirements)

1. Shape Khmer properly: OpenType GSUB/GPOS shaping (coeng subscripts, pre-base vowels,
   mark positioning). Neither target shapes Khmer; the rebuild uses HarfBuzz (WebAssembly).
2. Let the user pick any font: bundled Khmer faces, a font file they drop in, or a font
   installed on their Mac (Local Font Access API in Chromium-based browsers).
3. Embed the chosen font in the PDF as a CID-keyed TrueType/CFF font (Identity-H), with
   ToUnicode and ActualText so the Khmer text stays searchable and copyable.
