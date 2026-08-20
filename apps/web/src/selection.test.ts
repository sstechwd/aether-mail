import { describe, expect, it } from "vitest";
import { toggleSelection, rangeSelection, UndoStack } from "./selection.js";

/**
 * The three gaps at the top of docs/FEATURE-REVIEW.md are one interaction
 * surface: selecting rows, acting on the selection, and being able to take it
 * back. Deleting 40 newsletters one at a time is why people abandon a client,
 * and a destructive action with no undo is why they stop trusting one.
 */

const IDS = ["a", "b", "c", "d", "e"];

describe("toggleSelection", () => {
  it("adds an id that is not selected", () => {
    expect(toggleSelection(["a"], "b")).toEqual(["a", "b"]);
  });

  it("removes an id that is selected", () => {
    expect(toggleSelection(["a", "b"], "b")).toEqual(["a"]);
  });

  it("does not duplicate", () => {
    expect(toggleSelection(["a"], "a")).toEqual([]);
  });
});

describe("rangeSelection", () => {
  it("selects everything between the anchor and the target", () => {
    expect(rangeSelection(IDS, "b", "d")).toEqual(["b", "c", "d"]);
  });

  it("works when the range is dragged upward", () => {
    expect(rangeSelection(IDS, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("a single row selects just that row", () => {
    expect(rangeSelection(IDS, "c", "c")).toEqual(["c"]);
  });

  it("returns just the target when the anchor is gone (list refreshed)", () => {
    expect(rangeSelection(IDS, "zzz", "c")).toEqual(["c"]);
  });

  it("returns empty when neither id is in the list", () => {
    expect(rangeSelection(IDS, "x", "y")).toEqual([]);
  });
});

describe("UndoStack", () => {
  it("remembers the last action", () => {
    const stack = new UndoStack();
    stack.push({ label: "Moved 3 to Trash", undo: async () => undefined });
    expect(stack.peek()?.label).toBe("Moved 3 to Trash");
  });

  it("runs the undo and clears it, so it cannot fire twice", async () => {
    let ran = 0;
    const stack = new UndoStack();
    stack.push({ label: "x", undo: async () => void ran++ });
    await stack.undo();
    await stack.undo();
    expect(ran).toBe(1);
    expect(stack.peek()).toBeNull();
  });

  it("does nothing when there is nothing to undo", async () => {
    const stack = new UndoStack();
    await expect(stack.undo()).resolves.toBeUndefined();
  });

  it("keeps only the most recent action — this is undo, not history", () => {
    const stack = new UndoStack();
    stack.push({ label: "first", undo: async () => undefined });
    stack.push({ label: "second", undo: async () => undefined });
    expect(stack.peek()?.label).toBe("second");
  });

  it("expires so a stale undo cannot resurrect something from an hour ago", () => {
    const stack = new UndoStack(50);
    stack.push({ label: "x", undo: async () => undefined });
    expect(stack.peek(Date.now() + 5_000)).toBeNull();
  });

  it("clears on demand", () => {
    const stack = new UndoStack();
    stack.push({ label: "x", undo: async () => undefined });
    stack.clear();
    expect(stack.peek()).toBeNull();
  });

  it("surfaces a failing undo instead of swallowing it", async () => {
    const stack = new UndoStack();
    stack.push({
      label: "x",
      undo: async () => {
        throw new Error("server said no");
      },
    });
    await expect(stack.undo()).rejects.toThrow("server said no");
  });
});
