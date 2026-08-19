import { describe, expect, it } from "vitest";
import { decodeEncodedWords } from "./mailtext.js";

describe("decodeEncodedWords", () => {
  it("decodes a real base64 subject captured from a live inbox", () => {
    // Verbatim from data/mail.json, fetched before MIME parsing existed.
    const raw = "=?utf-8?b?UGVyZmVjdCBQeXRob24gcXVpY2tseeKAlGNvZGUgbmF0dXJhbGx5IHRvZGF5IQ==?=";
    expect(decodeEncodedWords(raw)).toBe("Perfect Python quickly\u2014code naturally today!");
  });

  it("decodes quoted-printable encoded words", () => {
    expect(decodeEncodedWords("=?UTF-8?Q?Ren=C3=A9e_M=C3=BCller?=")).toBe("Ren\u00e9e M\u00fcller");
  });

  it("joins adjacent encoded words without inserting a space", () => {
    const raw = "=?UTF-8?B?SGVsbG8g?= =?UTF-8?B?V29ybGQ=?=";
    expect(decodeEncodedWords(raw)).toBe("Hello World");
  });

  it("leaves plain text untouched", () => {
    expect(decodeEncodedWords("Just a normal subject")).toBe("Just a normal subject");
  });

  it("leaves a malformed encoded word alone instead of throwing", () => {
    const raw = "=?UTF-8?B?!!!not-base64!!!?=";
    expect(() => decodeEncodedWords(raw)).not.toThrow();
  });

  it("handles a mix of plain text and an encoded word", () => {
    expect(decodeEncodedWords("Re: =?UTF-8?Q?caf=C3=A9?= today")).toBe("Re: caf\u00e9 today");
  });
});
