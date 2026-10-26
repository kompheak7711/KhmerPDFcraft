/** The bridge the Electron preload script exposes; absent when running in a browser. */
export interface DesktopBridge {
  platform: string;
  /** Call once the open-file listener is registered; queued files are then delivered. */
  ready(): Promise<void>;
  openDialog(): Promise<void>;
  savePdf(name: string, bytes: Uint8Array): Promise<{ saved: boolean; path?: string }>;
  onOpenFile(handler: (payload: { name: string; bytes: Uint8Array }) => void): () => void;
  onRequestSave(handler: () => void): () => void;
}

declare global {
  interface Window {
    khmerpdfcraft?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | undefined = typeof window !== 'undefined' ? window.khmerpdfcraft : undefined;
