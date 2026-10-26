/** pdf.js loading and page rendering for the viewer. */
// The legacy build carries polyfills (e.g. Uint8Array.toHex) so the viewer also runs in
// the Electron shell and in older Safari.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };

export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  // pdf.js transfers the buffer to its worker; hand it a copy so the original stays usable for export.
  return pdfjs.getDocument({ data: bytes.slice() }).promise;
}

export interface PageSize {
  width: number;
  height: number;
  rotation: number;
}

export function pageSize(page: PDFPageProxy): PageSize {
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height, rotation: page.rotate };
}

/** Renders a page into a canvas at the given zoom, sharp on high-DPI screens. Returns a cancel function. */
export function renderPage(page: PDFPageProxy, canvas: HTMLCanvasElement, zoom: number): () => void {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const viewport = page.getViewport({ scale: zoom * dpr });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
  canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => undefined;
  const task: RenderTask = page.render({ canvasContext: ctx, viewport, canvas } as Parameters<PDFPageProxy['render']>[0]);
  task.promise.catch(() => undefined);
  return () => task.cancel();
}
