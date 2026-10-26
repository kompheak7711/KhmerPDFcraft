import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TextItem } from './core/model';
import { hexToRgb, rgbToHex } from './core/model';
import type { LoadedFont, LocalFontData } from './core/fonts';
import { deleteUserFont, fontFromBytes, importLocalFont, loadBundledFonts, loadUserFonts, saveUserFont } from './core/fonts';
import { openPdf, type PDFDocumentProxy } from './core/pdfView';
import { exportPdf } from './core/pdfWriter';
import { commit, createHistory, redo, replace, undo, type History } from './core/history';
import { PageView } from './ui/PageView';
import { FontPanel } from './ui/FontPanel';

type Tool = 'select' | 'text';

interface Defaults {
  fontId: string;
  fontSize: number;
  color: string;
}

const DEFAULT_FONT = 'bundled-NotoSansKhmer-Regular';
const LINE_HEIGHT = 1.5;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

let seq = 0;
const newId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

export function App() {
  const [fonts, setFonts] = useState<LoadedFont[]>([]);
  const [fontStatus, setFontStatus] = useState<string>('Loading fonts…');
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfName, setPdfName] = useState<string>('');
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [history, setHistory] = useState<History<TextItem[]>>(() => createHistory<TextItem[]>([]));
  const items = history.present;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('text');
  const [zoom, setZoom] = useState(1);
  const [defaults, setDefaults] = useState<Defaults>({ fontId: DEFAULT_FONT, fontSize: 18, color: '#1c2430' });
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const fontMap = useMemo(() => new Map(fonts.map((f) => [f.id, f])), [fonts]);
  const selected = items.find((i) => i.id === selectedId) ?? null;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const bundled = await loadBundledFonts(import.meta.env.BASE_URL);
        const user = await loadUserFonts();
        if (!alive) return;
        setFonts([...bundled, ...user]);
        setFontStatus('');
      } catch (e) {
        if (alive) setFontStatus(`Fonts failed to load: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const setItems = useCallback((next: TextItem[], record: boolean) => {
    setHistory((h) => (record ? commit(h, next) : replace(h, next)));
  }, []);

  const openFile = useCallback(async (file: File) => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const d = await openPdf(bytes);
      setDoc((old) => {
        old?.cleanup();
        return d;
      });
      setPdfBytes(bytes);
      setPdfName(file.name);
      setHistory(createHistory<TextItem[]>([]));
      setSelectedId(null);
      setEditingId(null);
      setStatus(null);
    } catch (e) {
      setStatus({ text: `Could not open ${file.name}: ${e instanceof Error ? e.message : String(e)}`, error: true });
    }
  }, []);

  const addFontFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      try {
        const font = await fontFromBytes(new Uint8Array(await file.arrayBuffer()), 'file');
        await saveUserFont(font).catch(() => undefined);
        setFonts((fs) => [...fs, font]);
        setDefaults((d) => ({ ...d, fontId: font.id }));
        setStatus({ text: `Added ${font.label}` });
      } catch (e) {
        setStatus({ text: `${file.name} is not a usable font: ${e instanceof Error ? e.message : String(e)}`, error: true });
      }
    }
  }, []);

  const importLocal = useCallback(async (data: LocalFontData) => {
    try {
      const font = await importLocalFont(data);
      await saveUserFont(font).catch(() => undefined);
      setFonts((fs) => (fs.some((f) => f.id === font.id) ? fs : [...fs, font]));
      setDefaults((d) => ({ ...d, fontId: font.id }));
      setStatus({ text: `Added ${font.label}` });
    } catch (e) {
      setStatus({ text: `Could not import ${data.fullName}: ${e instanceof Error ? e.message : String(e)}`, error: true });
    }
  }, []);

  const removeFont = useCallback(
    async (id: string) => {
      await deleteUserFont(id).catch(() => undefined);
      setFonts((fs) => fs.filter((f) => f.id !== id));
      setDefaults((d) => (d.fontId === id ? { ...d, fontId: DEFAULT_FONT } : d));
      setItems(
        items.map((i) => (i.fontId === id ? { ...i, fontId: DEFAULT_FONT } : i)),
        true,
      );
    },
    [items, setItems],
  );

  // Applies a property to the selected box (recorded) and makes it the default for new boxes.
  const applyStyle = (patch: Partial<Pick<TextItem, 'fontId' | 'fontSize' | 'color'>>) => {
    setDefaults((d) => ({
      ...d,
      ...(patch.fontId ? { fontId: patch.fontId } : {}),
      ...(patch.fontSize ? { fontSize: patch.fontSize } : {}),
      ...(patch.color ? { color: rgbToHex(patch.color) } : {}),
    }));
    if (selected) setItems(items.map((i) => (i.id === selected.id ? { ...i, ...patch } : i)), true);
  };

  /** Ends editing: records the text in history and drops a box left empty. */
  const finishEditing = (current: TextItem[]): TextItem[] => {
    if (!editingId) return current;
    setEditingId(null);
    const edited = current.find((i) => i.id === editingId);
    if (edited && edited.text.trim().length === 0) {
      if (selectedId === editingId) setSelectedId(null);
      return current.filter((i) => i.id !== editingId);
    }
    return current;
  };

  const createItem = (pageIndex: number, left: number, top: number) => {
    const base = finishEditing(items);
    const item: TextItem = {
      id: newId(),
      pageIndex,
      left,
      top,
      text: '',
      fontId: fontMap.has(defaults.fontId) ? defaults.fontId : (fonts[0]?.id ?? DEFAULT_FONT),
      fontSize: defaults.fontSize,
      lineHeight: LINE_HEIGHT,
      color: hexToRgb(defaults.color),
    };
    setItems([...base, item], true);
    setSelectedId(item.id);
    setEditingId(item.id);
  };

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    setItems(items.filter((i) => i.id !== selectedId), true);
    setSelectedId(null);
  }, [items, selectedId, setItems]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        setHistory((h) => (e.shiftKey ? redo(h) : undo(h)));
        return;
      }
      if (editingId) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      } else if (e.key === 'Enter' && selectedId) {
        e.preventDefault();
        setEditingId(selectedId);
      } else if (e.key === 't' && !mod) {
        setTool('text');
      } else if (e.key === 'v' && !mod) {
        setTool('select');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingId, selectedId, deleteSelected]);

  const download = async () => {
    if (!pdfBytes) return;
    setExporting(true);
    setStatus({ text: 'Preparing PDF…' });
    try {
      const sources = new Map(fonts.map((f) => [f.id, { id: f.id, bytes: f.bytes }]));
      const out = await exportPdf(pdfBytes, items, sources);
      const blob = new Blob([out as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = pdfName.replace(/\.pdf$/i, '') + '-khmer.pdf';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setStatus({ text: `Saved ${a.download}` });
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setExporting(false);
    }
  };

  const boxHandlers = {
    onSelect: (id: string) => {
      if (editingId && editingId !== id) setItems(finishEditing(items), true);
      setSelectedId(id);
    },
    onStartEdit: (id: string) => {
      setSelectedId(id);
      setEditingId(id);
    },
    onTextChange: (id: string, text: string) => setItems(items.map((i) => (i.id === id ? { ...i, text } : i)), false),
    onStopEdit: (id: string, text: string) => {
      if (editingId !== id) return; // already finished by the app
      setEditingId(null);
      const next = text.trim().length === 0 ? items.filter((i) => i.id !== id) : items.map((i) => (i.id === id ? { ...i, text } : i));
      setItems(next, true);
      if (text.trim().length === 0 && selectedId === id) setSelectedId(null);
    },
    onMove: (id: string, left: number, top: number, done: boolean) =>
      setItems(items.map((i) => (i.id === id ? { ...i, left, top } : i)), done),
  };

  const currentFontId = selected ? selected.fontId : defaults.fontId;
  const currentSize = selected ? selected.fontSize : defaults.fontSize;
  const currentColor = selected ? rgbToHex(selected.color) : defaults.color;

  return (
    <div className="app">
      <header className="bar">
        <div className="title">
          Khmer<span>PDF</span>craft
        </div>
        <button type="button" onClick={() => fileInput.current?.click()}>
          Open PDF…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          data-testid="pdf-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) openFile(f);
          }}
        />
        {pdfName ? <span className="file" title={pdfName}>{pdfName}</span> : null}
        <span className="sep" />
        <div className="group" role="group" aria-label="Tool">
          <button type="button" className={tool === 'text' ? 'active' : ''} onClick={() => setTool('text')} title="Click a page to add text (T)">
            Add text
          </button>
          <button type="button" className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')} title="Select and move text (V)">
            Select
          </button>
        </div>
        <span className="sep" />
        <label>
          Font
          <select value={currentFontId} onChange={(e) => applyStyle({ fontId: e.target.value })} data-testid="font-select">
            {fonts.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Size
          <input
            type="number"
            min={4}
            max={400}
            step={1}
            value={currentSize}
            data-testid="size-input"
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 4 && v <= 400) applyStyle({ fontSize: v });
            }}
          />
        </label>
        <label>
          Colour
          <input type="color" value={currentColor} onChange={(e) => applyStyle({ color: hexToRgb(e.target.value) })} />
        </label>
        <span className="sep" />
        <div className="group" aria-label="Zoom">
          <button type="button" onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])} disabled={zoom === ZOOMS[0]}>
            −
          </button>
          <span className="status">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])} disabled={zoom === ZOOMS[ZOOMS.length - 1]}>
            +
          </button>
        </div>
        <span className="sep" />
        <div className="group">
          <button type="button" onClick={() => setHistory((h) => undo(h))} disabled={history.past.length === 0} title="Undo (⌘Z)">
            Undo
          </button>
          <button type="button" onClick={() => setHistory((h) => redo(h))} disabled={history.future.length === 0} title="Redo (⇧⌘Z)">
            Redo
          </button>
          <button type="button" onClick={deleteSelected} disabled={!selected}>
            Delete
          </button>
        </div>
        <span className="spacer" />
        <span className={`status${status?.error ? ' error' : ''}`} role="status">
          {status?.text ?? fontStatus}
        </span>
        <button type="button" className="primary" onClick={download} disabled={!pdfBytes || exporting} data-testid="download">
          {exporting ? 'Saving…' : 'Download PDF'}
        </button>
      </header>

      <FontPanel fonts={fonts} currentFontId={currentFontId} onChoose={(id) => applyStyle({ fontId: id })} onAddFiles={addFontFiles} onImportLocal={importLocal} onRemove={removeFont} />

      <main
        className={`desk${tool === 'text' ? ' text-tool' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const files = Array.from(e.dataTransfer.files);
          const pdf = files.find((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
          const fontFiles = files.filter((f) => /\.(ttf|otf|ttc)$/i.test(f.name));
          if (pdf) openFile(pdf);
          if (fontFiles.length) addFontFiles(fontFiles);
        }}
      >
        {doc ? (
          Array.from({ length: doc.numPages }, (_, i) => (
            <PageView
              key={i}
              doc={doc}
              pageIndex={i}
              zoom={zoom}
              tool={tool}
              items={items.filter((it) => it.pageIndex === i)}
              fonts={fontMap}
              selectedId={selectedId}
              editingId={editingId}
              onCreate={createItem}
              onDeselect={() => {
                setItems(finishEditing(items), true);
                setSelectedId(null);
              }}
              box={boxHandlers}
            />
          ))
        ) : (
          <div className={`empty${dragging ? ' dragging' : ''}`}>
            <div className="big" style={{ fontFamily: '"kpc-bundled-NotoSerifKhmer-Regular", "Kantumruy Pro"' }}>
              សរសេរអក្សរខ្មែរលើ PDF
            </div>
            <div>Open a PDF, or drop one here. Drop .ttf or .otf files to add fonts.</div>
            <div>
              <button type="button" className="primary" onClick={() => fileInput.current?.click()}>
                Open PDF…
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
