/**
 * Multi-select and undo.
 *
 * The top three gaps in docs/FEATURE-REVIEW.md are really one surface:
 * selecting rows, acting on many at once, and being able to take it back.
 *
 * Kept out of the component because the range maths and the expiry rule are
 * the parts worth testing; the click handling around them is trivial.
 */

/** Ctrl/Cmd-click: add or remove one id. */
export function toggleSelection(current: string[], id: string): string[] {
  return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
}

/**
 * Shift-click: everything between the anchor and the target, in list order.
 *
 * If the anchor has disappeared — the list refreshed under us, or a message
 * moved — fall back to selecting just the target rather than returning
 * something surprising.
 */
export function rangeSelection(ids: string[], anchor: string, target: string): string[] {
  const to = ids.indexOf(target);
  if (to === -1) return [];
  const from = ids.indexOf(anchor);
  if (from === -1) return [target];
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return ids.slice(lo, hi + 1);
}

export type UndoAction = {
  /** What the toast says, e.g. "Moved 3 to Trash". */
  label: string;
  undo: () => Promise<void>;
};

type Held = UndoAction & { at: number };

/**
 * A one-deep undo with an expiry.
 *
 * Deliberately not a history stack: the useful guarantee is "I can take back
 * what I just did", and an unbounded stack invites resurrecting something from
 * an hour ago into a mailbox that has moved on since.
 */
export class UndoStack {
  private held: Held | null = null;

  constructor(private ttlMs = 15_000) {}

  push(action: UndoAction): void {
    this.held = { ...action, at: Date.now() };
  }

  /** The pending action, or null when there is none or it has expired. */
  peek(now = Date.now()): UndoAction | null {
    if (!this.held) return null;
    if (now - this.held.at > this.ttlMs) {
      this.held = null;
      return null;
    }
    return this.held;
  }

  /**
   * Run the pending undo. Clears first, so a double-click cannot fire it twice
   * — but a failure still propagates so the UI can say so rather than pretend
   * it worked.
   */
  async undo(): Promise<void> {
    const action = this.peek();
    if (!action) return;
    this.held = null;
    await action.undo();
  }

  clear(): void {
    this.held = null;
  }
}
