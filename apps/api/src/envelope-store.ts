/**
 * Envelope / payload split.
 *
 * Measured on a real 108-message mailbox: 93% of the store was body, HTML and
 * headers — data the message list never renders, held in RAM for the life of the
 * process. The list needs ~177KB of envelopes; it was carrying 2.5MB.
 *
 * So the store keeps envelopes hot and loads a message's payload only when the
 * user opens it. This is the "envelope-only lists" rule from CONVENTIONS.md,
 * actually enforced.
 */

export type Attachment = {
  part: number;
  filename: string;
  mimeType: string;
  size: number;
  contentId: string | null;
  inline: boolean;
};

/** A message as stored on disk — envelope plus the heavy parts. */
export type StoredMessage = {
  id: string;
  accountId: string;
  folder: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  unread: boolean;
  starred?: boolean;
  preview?: string;
  body?: string;
  html?: string;
  headers?: string;
  uid?: string;
  hiddenMedia?: number;
  attachments?: Attachment[];
};

/** What the message list needs. Small, and safe to hold for every message. */
export type Envelope = {
  id: string;
  accountId: string;
  folder: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  unread: boolean;
  starred: boolean;
  preview: string;
  uid?: string;
  hiddenMedia: number;
  /** The list draws a paperclip; it does not need the attachment metadata. */
  attachmentCount: number;
};

/** The heavy parts, loaded when a message is opened. */
export type Payload = {
  body?: string;
  html?: string;
  headers?: string;
  attachments?: Attachment[];
};

export function envelopeOf(msg: StoredMessage): Envelope {
  return {
    id: msg.id,
    accountId: msg.accountId,
    folder: msg.folder,
    from: msg.from,
    to: msg.to,
    subject: msg.subject,
    date: msg.date,
    unread: msg.unread,
    starred: msg.starred ?? false,
    // Fall back to a slice of the body so old rows (fetched before previews
    // existed) still show something in the list.
    preview: msg.preview ?? (msg.body ?? "").slice(0, 200),
    uid: msg.uid,
    hiddenMedia: msg.hiddenMedia ?? 0,
    attachmentCount: (msg.attachments ?? []).filter((a) => !a.inline).length,
  };
}

export function payloadOf(msg: StoredMessage): Payload {
  return {
    body: msg.body,
    html: msg.html,
    headers: msg.headers,
    attachments: msg.attachments,
  };
}

export function splitPayload(msg: StoredMessage): { envelope: Envelope; payload: Payload } {
  return { envelope: envelopeOf(msg), payload: payloadOf(msg) };
}
