import { describe, expect, it } from "vitest";
import { parseJsonBody, asString, asStringArray } from "./reqbody.js";

/**
 * Found by fuzzing the running API: three routes returned HTTP 500 with an
 * internal error message in the response body when given input of the wrong
 * shape. A 500 is a bug — malformed input from a client is expected and must
 * produce a clean 400.
 *
 *   POST /api/compose/reply  body: "not json at all"
 *     -> 500 {"error":"server_error","message":"Unexpected token 'o'..."}
 *   POST /api/signature      body: {"signature":{"nested":true}}
 *     -> 500 "(body.signature ?? \"\").slice is not a function"
 *   POST /api/calendar/ics   body: {"invite":{"summary":42}}
 *     -> 500 "v.replace is not a function"
 */

describe("parseJsonBody", () => {
  it("parses a normal object", () => {
    expect(parseJsonBody('{"a":1}')).toEqual({ a: 1 });
  });

  it("treats an empty body as an empty object", () => {
    expect(parseJsonBody("")).toEqual({});
    expect(parseJsonBody("   ")).toEqual({});
  });

  it("returns null for invalid JSON instead of throwing", () => {
    expect(parseJsonBody("not json at all")).toBeNull();
    expect(parseJsonBody("{unclosed")).toBeNull();
  });

  it("rejects valid JSON that is not an object, so callers can assume fields", () => {
    // JSON.parse("42") succeeds; body.foo would then be undefined at best and
    // a crash at worst. An array is equally wrong for these routes.
    expect(parseJsonBody("42")).toBeNull();
    expect(parseJsonBody('"a string"')).toBeNull();
    expect(parseJsonBody("[1,2,3]")).toBeNull();
    expect(parseJsonBody("null")).toBeNull();
  });
});

describe("asString", () => {
  it("passes a real string through", () => {
    expect(asString("hello")).toBe("hello");
  });

  it("returns the fallback for every non-string, rather than crashing later", () => {
    expect(asString(undefined)).toBe("");
    expect(asString(null)).toBe("");
    expect(asString(42)).toBe("");
    expect(asString({ nested: true })).toBe("");
    expect(asString(["a"])).toBe("");
    expect(asString(true)).toBe("");
  });

  it("honours a custom fallback", () => {
    expect(asString(undefined, "(none)")).toBe("(none)");
  });

  it("enforces a maximum length so a huge value cannot be stored", () => {
    expect(asString("x".repeat(5000), "", 100)).toHaveLength(100);
  });
});

describe("asStringArray", () => {
  it("keeps only the strings", () => {
    expect(asStringArray(["a", 1, null, "b", { x: 1 }])).toEqual(["a", "b"]);
  });

  it("returns empty for a non-array", () => {
    expect(asStringArray("notanarray")).toEqual([]);
    expect(asStringArray(undefined)).toEqual([]);
    expect(asStringArray(42)).toEqual([]);
  });

  it("caps the length so a 50000-element array cannot be walked", () => {
    const huge = Array.from({ length: 50_000 }, (_, i) => `f${i}`);
    expect(asStringArray(huge, 20)).toHaveLength(20);
  });
});
