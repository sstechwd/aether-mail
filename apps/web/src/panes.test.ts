import { describe, expect, it } from "vitest";
import { clampPane, loadPanes, PANE_LIMITS, type PaneWidths } from "./panes.js";

/**
 * Reported: "I need to be able to adjust the UI with sliders and stuff to
 * expand or shorten the panels like outlook, some things are cut off."
 *
 * The three-pane grid was fixed at 208px / 320px / rest. A 320px list cannot
 * show a real subject line, and nothing could be widened.
 */

describe("clampPane", () => {
  it("keeps a sensible width unchanged", () => {
    expect(clampPane("folders", 240)).toBe(240);
    expect(clampPane("list", 400)).toBe(400);
  });

  it("refuses to shrink a pane into uselessness", () => {
    expect(clampPane("folders", 10)).toBe(PANE_LIMITS.folders.min);
    expect(clampPane("list", 0)).toBe(PANE_LIMITS.list.min);
  });

  it("refuses to let one pane eat the window", () => {
    expect(clampPane("folders", 5000)).toBe(PANE_LIMITS.folders.max);
    expect(clampPane("list", 5000)).toBe(PANE_LIMITS.list.max);
  });

  it("rounds to whole pixels — fractional grid columns shimmer while dragging", () => {
    expect(clampPane("list", 383.7)).toBe(384);
  });

  it("survives NaN rather than writing garbage into the layout", () => {
    expect(clampPane("list", Number.NaN)).toBe(PANE_LIMITS.list.default);
    expect(clampPane("folders", Number.POSITIVE_INFINITY)).toBe(PANE_LIMITS.folders.max);
  });
});

describe("loadPanes", () => {
  it("returns defaults when nothing is stored", () => {
    const panes = loadPanes(() => null);
    expect(panes.folders).toBe(PANE_LIMITS.folders.default);
    expect(panes.list).toBe(PANE_LIMITS.list.default);
  });

  it("reads a stored layout", () => {
    const stored = JSON.stringify({ folders: 250, list: 420 } satisfies PaneWidths);
    const panes = loadPanes(() => stored);
    expect(panes).toEqual({ folders: 250, list: 420 });
  });

  it("clamps a stored layout that is out of range", () => {
    // A window resized smaller, or a hand-edited file, must not break the app.
    const stored = JSON.stringify({ folders: 9999, list: 1 });
    const panes = loadPanes(() => stored);
    expect(panes.folders).toBe(PANE_LIMITS.folders.max);
    expect(panes.list).toBe(PANE_LIMITS.list.min);
  });

  it("falls back to defaults on corrupt storage instead of throwing", () => {
    expect(loadPanes(() => "not json")).toEqual({
      folders: PANE_LIMITS.folders.default,
      list: PANE_LIMITS.list.default,
    });
    expect(loadPanes(() => "[1,2,3]")).toEqual({
      folders: PANE_LIMITS.folders.default,
      list: PANE_LIMITS.list.default,
    });
  });

  it("ignores a partial layout field by field", () => {
    const panes = loadPanes(() => JSON.stringify({ list: 400 }));
    expect(panes.folders).toBe(PANE_LIMITS.folders.default);
    expect(panes.list).toBe(400);
  });

  it("survives a storage read that throws", () => {
    const panes = loadPanes(() => {
      throw new Error("blocked");
    });
    expect(panes.folders).toBe(PANE_LIMITS.folders.default);
  });
});

describe("PANE_LIMITS", () => {
  it("gives the list enough room for a real subject line", () => {
    // 320px was the old fixed width and it truncated everything.
    expect(PANE_LIMITS.list.default).toBeGreaterThanOrEqual(360);
  });

  it("has coherent bounds", () => {
    for (const key of ["folders", "list"] as const) {
      expect(PANE_LIMITS[key].min).toBeLessThan(PANE_LIMITS[key].default);
      expect(PANE_LIMITS[key].default).toBeLessThan(PANE_LIMITS[key].max);
    }
  });
});
