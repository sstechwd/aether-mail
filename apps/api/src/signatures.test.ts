import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignatureBook, applySignature } from "./signatures.js";

function freshBook(): SignatureBook {
  return SignatureBook.openFile(join(mkdtempSync(join(tmpdir(), "aether-sig-")), "sig.json"));
}

describe("SignatureBook", () => {
  let book: SignatureBook;
  beforeEach(() => {
    book = freshBook();
  });

  it("stores a signature per account", () => {
    book.set("acc-1", "— Sam\nAether Mail");
    expect(book.get("acc-1")).toBe("— Sam\nAether Mail");
    expect(book.get("acc-2")).toBe("");
  });

  it("persists across a restart", () => {
    const file = join(mkdtempSync(join(tmpdir(), "aether-sig-")), "sig.json");
    SignatureBook.openFile(file).set("acc-1", "— Sam");
    expect(SignatureBook.openFile(file).get("acc-1")).toBe("— Sam");
  });

  it("clearing removes it rather than leaving an empty block", () => {
    book.set("acc-1", "— Sam");
    book.set("acc-1", "");
    expect(book.get("acc-1")).toBe("");
  });
});

describe("applySignature", () => {
  it("appends below the body with the conventional separator", () => {
    const out = applySignature("Thanks for the update.", "— Sam\nAether Mail");
    expect(out).toBe("Thanks for the update.\n\n-- \n— Sam\nAether Mail");
  });

  it("returns the body untouched when there is no signature", () => {
    expect(applySignature("Hello", "")).toBe("Hello");
    expect(applySignature("Hello", "   ")).toBe("Hello");
  });

  it("does not add a second signature if one is already present", () => {
    const once = applySignature("Hello", "— Sam");
    expect(applySignature(once, "— Sam")).toBe(once);
  });

  it("goes above the quoted text in a reply, not at the very bottom", () => {
    // Replying puts the quote after two newlines; the signature belongs with
    // what you wrote, not stranded under the quoted history.
    const reply = "\n\nOn Tue, Priya wrote:\n> original message";
    const out = applySignature(reply, "— Sam");
    expect(out.indexOf("— Sam")).toBeLessThan(out.indexOf("> original message"));
  });
});
