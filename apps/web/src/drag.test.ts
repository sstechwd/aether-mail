import { describe, expect, it } from "vitest";
import { dragExceeded, folderFromPoint } from "./drag.js";

describe("dragExceeded", () => {
  it("ignores a click that barely moved", () => {
    expect(dragExceeded(10, 10, 12, 11)).toBe(false);
  });

  it("arms after the pointer travels a few pixels", () => {
    expect(dragExceeded(10, 10, 10, 20)).toBe(true);
  });
});

describe("folderFromPoint", () => {
  it("reads data-drop-folder from the target or an ancestor", () => {
    const folder = { getAttribute: (n: string) => (n === "data-drop-folder" ? "Receipts" : null) };
    const child = { closest: (sel: string) => (sel === "[data-drop-folder]" ? folder : null) };
    expect(folderFromPoint(child as unknown as EventTarget)).toBe("Receipts");
  });

  it("returns null when the pointer is not over a folder", () => {
    const miss = { closest: () => null };
    expect(folderFromPoint(miss as unknown as EventTarget)).toBeNull();
    expect(folderFromPoint(null)).toBeNull();
  });
});
