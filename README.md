# KhmerPDFcraft

Type Khmer Unicode onto any PDF, in any Khmer font: the ones bundled here, a font file
you drop in, or a font installed on your Mac. The text is shaped with HarfBuzz, so
subscript consonants (ជើង), pre-base vowels and stacked marks come out right, and the
font is embedded in the saved PDF so it looks the same everywhere.

It exists because two editors I otherwise like could not do this:
[PdfCraft](https://github.com/storytold/pdfcraft) refuses Khmer in Add text, and
[Stirling-PDF](https://github.com/Stirling-Tools/Stirling-PDF) shows Khmer but only
offers five generic fonts. The source-level evidence for both is in
[docs/analysis/why-pdfcraft-and-stirling-fail-khmer.md](docs/analysis/why-pdfcraft-and-stirling-fail-khmer.md)
and the design in
[docs/superpowers/specs/2026-10-26-khmerpdfcraft-design.md](docs/superpowers/specs/2026-10-26-khmerpdfcraft-design.md).

## Desktop app (macOS, Windows, Linux)

The same editor ships as a desktop app built with Electron. Because it bundles Chromium,
"Fonts on this computer…" works on all three systems, PDFs open from Finder / Explorer
("Open with") or the command line, and File ▸ Save PDF As… uses the native save dialog.

Installers are produced by the GitHub Actions workflow in `.github/workflows/desktop.yml`:
run it from the Actions tab (workflow_dispatch) or push a tag such as `v0.1.0`, then pick
up the files: `.dmg` for macOS (universal), `.exe` installer for Windows, `.AppImage` and
`.deb` for Linux. The builds are not signed or notarized, so the first launch needs one
extra step:

- macOS: Gatekeeper says the app "Not Opened" and offers only Move to Trash / Done.
  Click Done, open System Settings ▸ Privacy & Security, scroll to Security and click
  "Open Anyway" next to KhmerPDFcraft. Or, in Terminal:
  `xattr -dr com.apple.quarantine /Applications/KhmerPDFcraft.app`.
  Signing and notarizing (which removes this step) needs an Apple Developer account.
- Windows: SmartScreen shows "Windows protected your PC"; click More info ▸ Run anyway.

To build locally for the system you are on:

```bash
npm install
npm run dist:desktop     # output in release/
npm run desktop          # or just run it without packaging
```

## Run it in a browser

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open the address Vite prints (usually http://localhost:5173). Everything runs in your
browser; no PDF or font ever leaves your machine.

For a production build: `npm run build`, then `npm run preview` (or serve the `dist`
folder with any static server).

## Use it

1. Open a PDF (button or drag it onto the window).
2. With Add text active, click where the text should start and type. Switch your Mac
   keyboard to Khmer and type as usual. Enter starts a new line, Escape finishes.
3. Pick a font in the left panel or the toolbar, set size and colour. Changing them with
   a box selected restyles that box; otherwise they become the defaults for new boxes.
4. Select tool (or press V): drag boxes to move them, double-click to edit, Delete to
   remove, ⌘Z / ⇧⌘Z to undo and redo.
5. Download PDF saves `<name>-khmer.pdf` with the fonts embedded.

### Fonts

- Bundled: Noto Sans Khmer, Noto Serif Khmer, Battambang, Kantumruy Pro, Moul and
  Noto Sans (Latin), all under the SIL Open Font License (`public/fonts/OFL.txt`).
- Add font file…: any `.ttf` or `.otf`. Fonts you add are kept in the browser's storage
  so they are there next time.
- Fonts on this computer…: in Chrome or Edge this lists the fonts installed on your
  Mac (Local Font Access API), with a Khmer-only filter. Safari and Firefox do not
  offer that API; drop the font file in instead. Mac fonts live in `/Library/Fonts`,
  `~/Library/Fonts` and `/System/Library/Fonts`.

Known limitation: Apple's Khmer MN and Khmer Sangam MN use Apple's AAT tables rather
than OpenType, and the HarfBuzz build used here does not include AAT shaping, so they
may not shape correctly. OpenType Khmer fonts (Khmer OS family, Noto, Google Fonts
Khmer faces) work.

## How the PDF is written

Each font is embedded once as a subset CID font (`Type0` / `Identity-H`). Every glyph
is placed with the advance and offset HarfBuzz computed, so GPOS mark positioning is
preserved. Each line carries `ActualText` with the typed string, and the font carries a
ToUnicode map, so the Khmer stays searchable and copyable (Acrobat and Preview use
ActualText and get the exact text; pdf.js uses ToUnicode and may show visual order).

## Development

```bash
npm test        # vitest: shaping, PDF writing, extraction through pdf.js
npm run typecheck
npm run build
```

Core modules live in `src/core` (`shaping.ts`, `fontInfo.ts`, `pdfWriter.ts`,
`fonts.ts`, `pdfView.ts`) and the React UI in `src/ui` and `src/App.tsx`. The desktop
shell is `electron/main.cjs` (window, app:// scheme, menu, open/save dialogs, permissions)
and `electron/preload.cjs` (the small bridge the page sees as `window.khmerpdfcraft`).
To develop the desktop shell against the live dev server: `npm run dev` in one terminal
and `KPC_DEV_URL=http://localhost:5173 npx electron .` in another.

`scripts/e2e-smoke.cjs` drives the built app in headless Chromium (needs `playwright`
installed and `npm run preview` running): it opens a PDF, types Khmer in three fonts,
downloads the result and reopens it. Rasterise the output with poppler's `pdftoppm`
to compare against another renderer.
