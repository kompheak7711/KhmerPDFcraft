import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from '../core/pdfView';
import { renderPage, pageSize } from '../core/pdfView';
import type { TextItem } from '../core/model';
import type { LoadedFont } from '../core/fonts';
import { TextBox } from './TextBox';

interface Props {
  doc: PDFDocumentProxy;
  pageIndex: number;
  zoom: number;
  tool: 'select' | 'text';
  items: TextItem[];
  fonts: Map<string, LoadedFont>;
  selectedId: string | null;
  editingId: string | null;
  onCreate: (pageIndex: number, left: number, top: number) => void;
  onDeselect: () => void;
  box: Omit<React.ComponentProps<typeof TextBox>, 'item' | 'font' | 'zoom' | 'selected' | 'editing'>;
}

export function PageView({ doc, pageIndex, zoom, tool, items, fonts, selectedId, editingId, onCreate, onDeselect, box }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);

  useEffect(() => {
    let alive = true;
    doc.getPage(pageIndex + 1).then((p) => {
      if (alive) setPage(p);
    });
    return () => {
      alive = false;
    };
  }, [doc, pageIndex]);

  useEffect(() => {
    if (!page || !canvasRef.current) return;
    return renderPage(page, canvasRef.current, zoom);
  }, [page, zoom]);

  const size = page ? pageSize(page) : { width: 595, height: 842, rotation: 0 };

  return (
    <>
      <div className="page" style={{ width: size.width * zoom, height: size.height * zoom }} data-testid={`page-${pageIndex}`}>
        <canvas ref={canvasRef} />
        <div
          className="page-overlay"
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget) return;
            // Keep the browser from moving focus on mousedown: a box being edited is
            // finished by the app, and a newly created box must keep its focus.
            e.preventDefault();
            if (tool === 'text') {
              const rect = e.currentTarget.getBoundingClientRect();
              onCreate(pageIndex, (e.clientX - rect.left) / zoom, (e.clientY - rect.top) / zoom);
            } else {
              onDeselect();
            }
          }}
        >
          {items.map((item) => (
            <TextBox
              key={item.id}
              item={item}
              font={fonts.get(item.fontId)}
              zoom={zoom}
              selected={item.id === selectedId}
              editing={item.id === editingId}
              {...box}
            />
          ))}
        </div>
      </div>
      <div className="page-number">
        {pageIndex + 1} / {doc.numPages}
      </div>
    </>
  );
}
