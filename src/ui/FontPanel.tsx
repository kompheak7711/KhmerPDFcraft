import { useMemo, useRef, useState } from 'react';
import type { LoadedFont, LocalFontData } from '../core/fonts';
import { localFontsSupported, queryLocalFonts } from '../core/fonts';

interface Props {
  fonts: LoadedFont[];
  currentFontId: string;
  onChoose: (id: string) => void;
  onAddFiles: (files: File[]) => void;
  onImportLocal: (data: LocalFontData) => void;
  onRemove: (id: string) => void;
}

const originLabel: Record<LoadedFont['origin'], string> = { bundled: 'bundled', file: 'your file', local: 'installed' };

export function FontPanel({ fonts, currentFontId, onChoose, onAddFiles, onImportLocal, onRemove }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState<LocalFontData[] | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [khmerOnly, setKhmerOnly] = useState(true);

  const listLocal = async () => {
    setLocalError(null);
    try {
      const all = await queryLocalFonts();
      setLocal(all);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    }
  };

  const filteredLocal = useMemo(() => {
    if (!local) return [];
    const q = query.trim().toLowerCase();
    return local.filter((f) => {
      if (khmerOnly && !/khmer|khm|battambang|hanuman|moul|kantumruy|siemreap|bokor|koulen|metal|suwannaphum|taprom|content|dangrek|preahvihear|fasthand|chenla|kdam|nokora|odor|freehand|angkor|bayon|limon/i.test(`${f.family} ${f.postscriptName}`)) return false;
      return q.length === 0 || `${f.fullName} ${f.family}`.toLowerCase().includes(q);
    });
  }, [local, query, khmerOnly]);

  return (
    <aside className="side">
      <h2>Fonts</h2>
      <div className="actions">
        <button type="button" onClick={() => fileInput.current?.click()}>
          Add font file…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".ttf,.otf,.ttc,font/ttf,font/otf"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) onAddFiles(files);
          }}
        />
        {localFontsSupported() ? (
          <button type="button" onClick={listLocal}>
            Fonts on this computer…
          </button>
        ) : null}
      </div>
      {!localFontsSupported() ? (
        <p className="hint">To use a font installed on your Mac in this browser, drop its file in: look in /Library/Fonts or ~/Library/Fonts. Chrome and Edge can list installed fonts directly.</p>
      ) : null}
      {localError ? <p className="hint status error">{localError}</p> : null}
      {local ? (
        <div className="local-picker">
          <input type="search" placeholder="Search installed fonts" value={query} onChange={(e) => setQuery(e.target.value)} />
          <label className="khmer-only">
            <input type="checkbox" checked={khmerOnly} onChange={(e) => setKhmerOnly(e.target.checked)} /> Khmer fonts only
          </label>
          <ul>
            {filteredLocal.slice(0, 200).map((f) => (
              <li key={f.postscriptName}>
                <button
                  type="button"
                  onClick={() => {
                    onImportLocal(f);
                    setLocal(null);
                  }}
                >
                  {f.fullName}
                </button>
              </li>
            ))}
            {filteredLocal.length === 0 ? <li className="hint">No matching fonts.</li> : null}
          </ul>
        </div>
      ) : null}
      <div className="font-list" role="listbox" aria-label="Fonts">
        {fonts.map((f) => (
          <div
            key={f.id}
            role="option"
            aria-selected={f.id === currentFontId}
            tabIndex={0}
            className={`font-row${f.id === currentFontId ? ' selected' : ''}`}
            onClick={() => onChoose(f.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onChoose(f.id);
              }
            }}
          >
            <div className="specimen" style={{ fontFamily: `"${f.cssFamily}"` }}>
              {f.hasKhmer ? 'ខ្មែរ Aa' : 'Aa Bb'}
            </div>
            <div className="name">
              {f.label} <span className="origin">· {f.hasKhmer ? originLabel[f.origin] : 'no Khmer glyphs'}</span>
            </div>
            {f.origin !== 'bundled' ? (
              <button
                type="button"
                className="remove"
                title="Remove this font"
                aria-label={`Remove ${f.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(f.id);
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </aside>
  );
}
