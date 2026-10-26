import { useEffect, useLayoutEffect, useRef } from 'react';
import type { TextItem } from '../core/model';
import { rgbToHex } from '../core/model';
import type { LoadedFont } from '../core/fonts';

interface Props {
  item: TextItem;
  font: LoadedFont | undefined;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect: (id: string) => void;
  onStartEdit: (id: string) => void;
  onStopEdit: (id: string, text: string) => void;
  onTextChange: (id: string, text: string) => void;
  onMove: (id: string, left: number, top: number, done: boolean) => void;
}

/** Reads a contenteditable's plain text without the trailing newline browsers add. */
function readText(el: HTMLElement): string {
  return el.innerText.replace(/\n$/, '');
}

export function TextBox({ item, font, zoom, selected, editing, onSelect, onStartEdit, onStopEdit, onTextChange, onMove }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startY: number; left: number; top: number; moved: boolean } | null>(null);

  // Put the text into the element only when not editing, so the caret never jumps.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || editing) return;
    if (el.textContent !== item.text) el.textContent = item.text;
  }, [item.text, editing]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !editing) return;
    if (el.textContent !== item.text) el.textContent = item.text;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // item.text intentionally omitted: only runs when editing starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editing) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect(item.id);
    drag.current = { startX: e.clientX, startY: e.clientY, left: item.left, top: item.top, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / zoom;
    const dy = (e.clientY - d.startY) / zoom;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    d.moved = true;
    onMove(item.id, d.left + dx, d.top + dy, false);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) onMove(item.id, d.left + (e.clientX - d.startX) / zoom, d.top + (e.clientY - d.startY) / zoom, true);
  };

  return (
    <div
      ref={ref}
      className={`text-box${selected ? ' selected' : ''}${editing ? ' editing' : ''}`}
      style={{
        left: item.left * zoom,
        top: item.top * zoom,
        fontFamily: font ? `"${font.cssFamily}"` : 'sans-serif',
        fontSize: item.fontSize * zoom,
        lineHeight: item.lineHeight,
        color: rgbToHex(item.color),
      }}
      contentEditable={editing ? 'plaintext-only' : false}
      suppressContentEditableWarning
      spellCheck={false}
      data-testid="text-box"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!editing) onStartEdit(item.id);
      }}
      onInput={(e) => onTextChange(item.id, readText(e.currentTarget))}
      onBlur={(e) => {
        if (editing) onStopEdit(item.id, readText(e.currentTarget));
      }}
      onKeyDown={(e) => {
        if (editing && e.key === 'Escape') {
          e.preventDefault();
          (e.currentTarget as HTMLElement).blur();
        }
        if (editing) e.stopPropagation();
      }}
    />
  );
}
