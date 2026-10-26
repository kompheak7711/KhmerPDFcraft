import { describe, it, expect } from 'vitest';
import { createHistory, commit, replace, undo, redo } from '../src/core/history';

describe('history', () => {
  it('undoes and redoes committed states but not replaced ones', () => {
    let h = createHistory(0);
    h = commit(h, 1);
    h = replace(h, 2);
    h = commit(h, 3);
    expect(h.present).toBe(3);
    h = undo(h);
    expect(h.present).toBe(2);
    h = undo(h);
    expect(h.present).toBe(0);
    h = undo(h);
    expect(h.present).toBe(0);
    h = redo(h);
    expect(h.present).toBe(2);
    h = commit(h, 9);
    expect(redo(h).present).toBe(9); // redo stack cleared by a new commit
  });
});
