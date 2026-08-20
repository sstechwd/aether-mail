/**
 * Draggable pane widths.
 *
 * The three-pane grid used to be fixed at 208px / 320px / rest, per theme. A
 * 320px list truncates almost every subject line, and nothing could be
 * widened — which is what "some things are cut off" means in practice.
 *
 * Widths live in CSS custom properties, so dragging sets two variables and the
 * grid reflows. Kept in its own module because clamping and restoring are the
 * parts worth testing; the drag itself is a few lines of pointer handling.
 */

export type PaneKey = "folders" | "list";

export type PaneWidths = Record<PaneKey, number>;

/**
 * Bounds per pane.
 *
 * min: below this the pane cannot do its job (a folder name, a subject line).
 * max: above this it starves the reading pane on a laptop screen.
 */
export const PANE_LIMITS: Record<PaneKey, { min: number; max: number; default: number }> = {
  folders: { min: 150, max: 420, default: 224 },
  list: { min: 260, max: 900, default: 380 },
};

const STORAGE_KEY = "aether.panes";

/** Force a width into range, whatever nonsense arrives. */
export function clampPane(key: PaneKey, value: number): number {
  const limits = PANE_LIMITS[key];
  if (!Number.isFinite(value)) {
    // NaN means "no idea" -> default. Infinity means "as far as possible" -> max.
    return Number.isNaN(value) ? limits.default : limits.max;
  }
  return Math.round(Math.min(limits.max, Math.max(limits.min, value)));
}

/**
 * Read the saved layout.
 *
 * Takes the reader as an argument so this is testable without a DOM and so a
 * blocked or throwing localStorage cannot break startup.
 */
export function loadPanes(read: () => string | null = defaultRead): PaneWidths {
  const fallback: PaneWidths = {
    folders: PANE_LIMITS.folders.default,
    list: PANE_LIMITS.list.default,
  };
  try {
    const raw = read();
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    const rows = parsed as Partial<Record<PaneKey, unknown>>;
    return {
      folders:
        typeof rows.folders === "number" ? clampPane("folders", rows.folders) : fallback.folders,
      list: typeof rows.list === "number" ? clampPane("list", rows.list) : fallback.list,
    };
  } catch {
    return fallback;
  }
}

function defaultRead(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function savePanes(panes: PaneWidths): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(panes));
  } catch {
    /* private mode or blocked storage — layout just will not persist */
  }
}

/** Push the widths into the CSS variables the grid reads. */
export function applyPanes(panes: PaneWidths): void {
  const root = document.documentElement;
  root.style.setProperty("--folder-w", `${panes.folders}px`);
  root.style.setProperty("--list-w", `${panes.list}px`);
}

export function resetPanes(): PaneWidths {
  return { folders: PANE_LIMITS.folders.default, list: PANE_LIMITS.list.default };
}
