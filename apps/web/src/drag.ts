/**
 * Pointer drag — not HTML5 drag-and-drop.
 *
 * Tauri on Windows enables a native file-drop interceptor. That steals
 * HTML5 dragstart/drop inside the webview, so grabbing a message looks
 * dead. Pointer capture + elementFromPoint does not go through that path.
 */

export const DRAG_PX = 8;

export function dragExceeded(ax: number, ay: number, bx: number, by: number, px = DRAG_PX): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy >= px * px;
}

export function folderFromPoint(target: EventTarget | null): string | null {
  if (!target || typeof (target as Element).closest !== "function") return null;
  const el = (target as Element).closest("[data-drop-folder]");
  return el?.getAttribute("data-drop-folder") || null;
}
