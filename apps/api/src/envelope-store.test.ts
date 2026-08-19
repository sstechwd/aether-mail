import { describe, expect, it } from "vitest";
import { splitPayload, envelopeOf, type StoredMessage } from "./envelope-store.js";

const FULL: StoredMessage = {
  id: "acc-1-imap-99",
  accountId: "acc-1",
  folder: "INBOX",
  from: "Sender <s@example.com>",
  to: "me@example.com",
  subject: "Quarterly report",
  date: "2026-08-18T16:12:44Z",
  unread: true,
  starred: false,
  preview: "Numbers are in, see attached",
  body: "x".repeat(50_000),
  html: "<p>" + "y".repeat(80_000) + "</p>",
  headers: "Received: from mx.example.com\r\nDKIM-Signature: v=1",
  uid: "imap-99",
  hiddenMedia: 2,
  attachments: [
    { part: 3, filename: "q3.pdf", mimeType: "application/pdf", size: 900, contentId: null, inline: false },
  ],
};

describe("envelopeOf", () => {
  it("keeps everything the message list renders", () => {
    const env = envelopeOf(FULL);
    expect(env.id).toBe(FULL.id);
    expect(env.subject).toBe("Quarterly report");
    expect(env.from).toBe(FULL.from);
    expect(env.date).toBe(FULL.date);
    expect(env.unread).toBe(true);
    expect(env.preview).toBe("Numbers are in, see attached");
    // The list shows a paperclip, so the count must survive.
    expect(env.attachmentCount).toBe(1);
  });

  it("drops the heavy payload the list never shows", () => {
    const env = envelopeOf(FULL) as Record<string, unknown>;
    expect(env.body).toBeUndefined();
    expect(env.html).toBeUndefined();
    expect(env.headers).toBeUndefined();
  });

  it("is dramatically smaller than the full message", () => {
    const full = JSON.stringify(FULL).length;
    const env = JSON.stringify(envelopeOf(FULL)).length;
    // 130KB of payload vs a small envelope: expect at least a 50x saving.
    expect(env * 50).toBeLessThan(full);
  });
});

describe("splitPayload", () => {
  it("separates the envelope from the on-demand payload", () => {
    const { envelope, payload } = splitPayload(FULL);
    expect(envelope.id).toBe(FULL.id);
    expect(payload.body).toBe(FULL.body);
    expect(payload.html).toBe(FULL.html);
    expect(payload.headers).toBe(FULL.headers);
  });

  it("round-trips: envelope + payload reconstructs what the reader needs", () => {
    const { envelope, payload } = splitPayload(FULL);
    const rebuilt = { ...envelope, ...payload };
    expect(rebuilt.body).toBe(FULL.body);
    expect(rebuilt.html).toBe(FULL.html);
    expect(rebuilt.subject).toBe(FULL.subject);
  });

  it("handles a message with no html or attachments", () => {
    const plain: StoredMessage = {
      ...FULL,
      html: undefined,
      attachments: undefined,
      body: "just text",
    };
    const { envelope, payload } = splitPayload(plain);
    expect(envelope.attachmentCount).toBe(0);
    expect(payload.html).toBeUndefined();
    expect(payload.body).toBe("just text");
  });
});
