/**
 * Font registry for the browser: bundled Khmer faces, font files the user drops in,
 * and fonts installed on the machine (Local Font Access API, Chromium only). Every font
 * is also registered as a CSS FontFace so the on-screen text box shows the real glyphs.
 */
import { fontFileInfo, parseFont } from './fontInfo';

export type FontOrigin = 'bundled' | 'file' | 'local';

export interface LoadedFont {
  id: string;
  /** "Family Style", what the picker shows. */
  label: string;
  family: string;
  style: string;
  origin: FontOrigin;
  bytes: Uint8Array;
  /** CSS family name registered through FontFace. */
  cssFamily: string;
  /** Whether the font has Khmer glyphs (checked on KA, U+1780). */
  hasKhmer: boolean;
}

export const BUNDLED_FONTS: { file: string; family: string; style: string }[] = [
  { file: 'NotoSansKhmer-Regular.ttf', family: 'Noto Sans Khmer', style: 'Regular' },
  { file: 'NotoSansKhmer-Bold.ttf', family: 'Noto Sans Khmer', style: 'Bold' },
  { file: 'NotoSerifKhmer-Regular.ttf', family: 'Noto Serif Khmer', style: 'Regular' },
  { file: 'NotoSerifKhmer-Bold.ttf', family: 'Noto Serif Khmer', style: 'Bold' },
  { file: 'Battambang-Regular.ttf', family: 'Battambang', style: 'Regular' },
  { file: 'Battambang-Bold.ttf', family: 'Battambang', style: 'Bold' },
  { file: 'KantumruyPro-Regular.ttf', family: 'Kantumruy Pro', style: 'Regular' },
  { file: 'KantumruyPro-Bold.ttf', family: 'Kantumruy Pro', style: 'Bold' },
  { file: 'Moul-Regular.ttf', family: 'Moul', style: 'Regular' },
  { file: 'NotoSans-Regular.ttf', family: 'Noto Sans', style: 'Regular' },
  { file: 'NotoSans-Bold.ttf', family: 'Noto Sans', style: 'Bold' },
];

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

async function registerCss(id: string, bytes: Uint8Array): Promise<string> {
  const cssFamily = `kpc-${id}`;
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return cssFamily;
  const face = new FontFace(cssFamily, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  await face.load();
  document.fonts.add(face);
  return cssFamily;
}

/** Parses a font file, registers it for CSS preview and returns the registry entry. */
export async function fontFromBytes(bytes: Uint8Array, origin: FontOrigin, id = newId(origin)): Promise<LoadedFont> {
  const info = fontFileInfo(bytes); // throws for unusable files
  const hasKhmer = parseFont(bytes).hasGlyphForCodePoint(0x1780);
  const cssFamily = await registerCss(id, bytes);
  return {
    id,
    label: info.styleName && info.styleName !== 'Regular' ? `${info.familyName} ${info.styleName}` : info.familyName,
    family: info.familyName,
    style: info.styleName,
    origin,
    bytes,
    cssFamily,
    hasKhmer,
  };
}

export async function loadBundledFonts(baseUrl: string): Promise<LoadedFont[]> {
  const out: LoadedFont[] = [];
  for (const f of BUNDLED_FONTS) {
    const res = await fetch(`${baseUrl}fonts/${f.file}`);
    if (!res.ok) throw new Error(`Cannot load bundled font ${f.file}: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    out.push(await fontFromBytes(bytes, 'bundled', `bundled-${f.file.replace(/\.ttf$/, '')}`));
  }
  return out;
}

// ---- Local Font Access API (Chrome / Edge) ------------------------------------------

export interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob(): Promise<Blob>;
}

declare global {
  interface Window {
    queryLocalFonts?: (options?: { postscriptNames?: string[] }) => Promise<LocalFontData[]>;
  }
}

export function localFontsSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function';
}

export async function queryLocalFonts(): Promise<LocalFontData[]> {
  if (!localFontsSupported()) throw new Error('This browser cannot list installed fonts. Use Chrome or Edge, or drop the font file in.');
  return window.queryLocalFonts!();
}

/** Reads an installed font's bytes and registers it like an uploaded file. */
export async function importLocalFont(data: LocalFontData): Promise<LoadedFont> {
  const blob = await data.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return fontFromBytes(bytes, 'local', `local-${data.postscriptName.replace(/[^\w-]/g, '_')}`);
}

// ---- Persistence of user fonts (IndexedDB) -------------------------------------------

const DB_NAME = 'khmerpdfcraft';
const STORE = 'fonts';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface StoredFont {
  id: string;
  origin: FontOrigin;
  bytes: Uint8Array;
}

export async function saveUserFont(font: LoadedFont): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ id: font.id, origin: font.origin, bytes: font.bytes } satisfies StoredFont);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function deleteUserFont(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadUserFonts(): Promise<LoadedFont[]> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return [];
  }
  const stored = await new Promise<StoredFont[]>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as StoredFont[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  const out: LoadedFont[] = [];
  for (const s of stored) {
    try {
      out.push(await fontFromBytes(s.bytes, s.origin, s.id));
    } catch {
      // a corrupt entry is skipped; the user can add the font again
    }
  }
  return out;
}
