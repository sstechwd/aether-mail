import { compareMailDate, decodeEncodedWords } from "./mailtext.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type FixtureMessage = {
  id: string;
  accountId: string;
  folder: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  unread: boolean;
  starred?: boolean;
  body: string;
  headers?: string;
  hiddenMedia?: number;
  html?: string;
  /** MIME parts (metadata only — bytes are fetched on demand). */
  attachments?: Array<{
    part: number;
    filename: string;
    mimeType: string;
    size: number;
    contentId: string | null;
    inline: boolean;
  }>;
  /** Short snippet for the list row, so the list never carries a whole body. */
  preview?: string;
  /** Count of non-inline attachments, for the list's paperclip. */
  attachmentCount?: number;
  /** IMAP UID + folder, needed to pull a part later. */
  uid?: string;
  /** The provider's own folder name, e.g. "[Gmail]/Sent Mail". Needed to talk
   *  back to IMAP, since the UI shows the canonical name instead. */
  remoteFolder?: string;
};

export type FolderSummary = {
  name: string;
  unread: number;
  total: number;
};

export class MailStore {
  private messages = new Map<string, FixtureMessage>();
  private extraFolders = new Map<string, Set<string>>();
  private filePath: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  static openMemory(): MailStore {
    return new MailStore();
  }

  static openFile(filePath: string): MailStore {
    const store = new MailStore();
    store.filePath = filePath;
    store.loadFromDisk();
    return store;
  }

  loadFromDisk(): void {
    if (!this.filePath) return;
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const rows = JSON.parse(raw) as FixtureMessage[];
      this.messages.clear();
      for (const row of rows) {
        this.messages.set(row.id, {
          ...row,
          subject: decodeEncodedWords(row.subject ?? ""),
          from: decodeEncodedWords(row.from ?? ""),
          to: decodeEncodedWords(row.to ?? ""),
          starred: row.starred ?? false,
        });
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
    }
  }

  /**
   * Persist to disk. Debounced and compact on purpose:
   *
   * - `JSON.stringify(rows, null, 2)` pretty-printed the whole store on every
   *   star/read toggle. On a real mailbox that is ~2.5MB of synchronous work
   *   inside the request, and the indentation is ~25% of the bytes for a file
   *   no human reads.
   * - Toggling read state used to write the file once per message.
   *
   * `saveNow()` remains for shutdown and tests, where a flush must be certain.
   */
  save(): void {
    if (!this.filePath) return;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 400);
    // Do not hold the process open just for a pending write.
    if (typeof this.saveTimer.unref === "function") this.saveTimer.unref();
  }

  saveNow(): void {
    if (!this.filePath) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    mkdirSync(dirname(this.filePath), { recursive: true });
    const rows = [...this.messages.values()];
    writeFileSync(this.filePath, JSON.stringify(rows), "utf8");
  }

  loadFixture(rows: FixtureMessage[]): void {
    for (const row of rows) {
      // Decode RFC 2047 once, on the way in: mail stored by earlier builds still
      // carries raw "=?utf-8?B?...?=" subjects, and every read path (list,
      // search, open, agent prompt) must see human text, not wire encoding.
      this.messages.set(row.id, {
        ...row,
        subject: decodeEncodedWords(row.subject ?? ""),
        from: decodeEncodedWords(row.from ?? ""),
        to: decodeEncodedWords(row.to ?? ""),
        starred: row.starred ?? false,
      });
    }
  }

  fillMissingHeaders(rows: FixtureMessage[]): void {
    for (const row of rows) {
      const found = this.messages.get(row.id);
      if (found && !found.headers && row.headers) found.headers = row.headers;
    }
  }

  listFolders(accountId: string): FolderSummary[] {
    const byFolder = new Map<string, FolderSummary>();
    for (const msg of this.messages.values()) {
      if (msg.accountId !== accountId) continue;
      const current = byFolder.get(msg.folder) ?? {
        name: msg.folder,
        unread: 0,
        total: 0,
      };
      current.total += 1;
      if (msg.unread) current.unread += 1;
      byFolder.set(msg.folder, current);
    }
    let starredUnread = 0;
    let starredTotal = 0;
    for (const msg of this.messages.values()) {
      if (msg.accountId !== accountId || !msg.starred) continue;
      starredTotal += 1;
      if (msg.unread) starredUnread += 1;
    }
    const folders = [...byFolder.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (starredTotal > 0) {
      folders.unshift({ name: "Starred", unread: starredUnread, total: starredTotal });
    }
    const extras = this.extraFolders.get(accountId);
    if (extras) {
      for (const name of extras) {
        if (!folders.some((f) => f.name === name)) folders.push({ name, unread: 0, total: 0 });
      }
    }
    return folders;
  }

  ensureFolder(accountId: string, name: string): void {
    const clean = name.trim();
    if (!clean || clean === "Starred") return;
    const set = this.extraFolders.get(accountId) ?? new Set<string>();
    set.add(clean);
    this.extraFolders.set(accountId, set);
  }

  listMessages(accountId: string, folder: string, order: "newest" | "oldest" = "newest"): FixtureMessage[] {
    const dir = order === "oldest" ? 1 : -1;
    return [...this.messages.values()]
      .filter((m) => {
        if (m.accountId !== accountId) return false;
        if (folder === "Starred") return Boolean(m.starred);
        return m.folder === folder;
      })
      .sort((a, b) => dir * compareMailDate(a.date, b.date) || dir * a.id.localeCompare(b.id))
      // Return envelopes only. Spreading the whole message and blanking three
      // fields still copies the body/html strings first; on a 108-message
      // mailbox that was ~2.5MB of needless allocation per list request.
      .map((m) => this.envelopeRow(m));
  }

  /**
   * The subset the message list renders. Explicit field-by-field construction —
   * never `...m` — so a future payload field cannot silently start shipping.
   */
  private envelopeRow(m: FixtureMessage): FixtureMessage {
    return {
      id: m.id,
      accountId: m.accountId,
      folder: m.folder,
      from: m.from,
      to: m.to,
      subject: m.subject,
      date: m.date,
      unread: m.unread,
      starred: m.starred ?? false,
      preview: m.preview ?? (m.body ?? "").slice(0, 200),
      hiddenMedia: m.hiddenMedia ?? 0,
      attachmentCount: (m.attachments ?? []).filter((a) => !a.inline).length,
      body: "",
    };
  }

  getMessage(id: string): FixtureMessage | undefined {
    const found = this.messages.get(id);
    return found ? { ...found } : undefined;
  }

  markRead(id: string): void {
    const found = this.messages.get(id);
    if (found) {
      found.unread = false;
      this.save();
    }
  }

  markFolderRead(accountId: string, folder: string): void {
    for (const msg of this.messages.values()) {
      if (msg.accountId === accountId && (folder === "Starred" ? msg.starred : msg.folder === folder)) {
        msg.unread = false;
      }
    }
    this.save();
  }

  markUnread(id: string): void {
    const found = this.messages.get(id);
    if (found) {
      found.unread = true;
      this.save();
    }
  }

  setStarred(id: string, starred: boolean): void {
    const found = this.messages.get(id);
    if (found) {
      found.starred = starred;
      this.save();
    }
  }

  move(id: string, folder: string): void {
    const found = this.messages.get(id);
    if (found) {
      found.folder = folder;
      this.save();
    }
  }

  compose(input: {
    accountId: string;
    to: string;
    subject: string;
    body: string;
  }): FixtureMessage {
    const draft: FixtureMessage = {
      id: `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      accountId: input.accountId,
      folder: "Drafts",
      from: "you@localhost",
      to: input.to,
      subject: input.subject,
      date: new Date().toISOString(),
      unread: false,
      starred: false,
      body: input.body,
    };
    this.messages.set(draft.id, draft);
    this.save();
    return { ...draft };
  }

  reply(id: string): FixtureMessage {
    const src = this.messages.get(id);
    if (!src) throw new Error("message not found");
    const addr = extractAddress(src.from);
    const subject = src.subject.startsWith("Re:") ? src.subject : `Re: ${src.subject}`;
    return this.compose({
      accountId: src.accountId,
      to: addr,
      subject,
      body: `\n\nOn ${src.date}, ${src.from} wrote:\n> ${src.body.replace(/\n/g, "\n> ")}`,
    });
  }

  forward(id: string): FixtureMessage {
    const src = this.messages.get(id);
    if (!src) throw new Error("message not found");
    const subject = src.subject.startsWith("Fwd:") ? src.subject : `Fwd: ${src.subject}`;
    return this.compose({
      accountId: src.accountId,
      to: "",
      subject,
      body: `\n\n---------- Forwarded message ----------\nFrom: ${src.from}\nDate: ${src.date}\nSubject: ${src.subject}\n\n${src.body}`,
    });
  }

  /**
   * Every message for an account, any folder. Used to harvest contacts;
   * envelope fields only are read by the caller, so this stays cheap.
   */
  allForAccount(accountId: string): FixtureMessage[] {
    return [...this.messages.values()].filter((m) => m.accountId === accountId);
  }

  search(accountId: string, query: string): FixtureMessage[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return [...this.messages.values()]
      .filter((m) => m.accountId === accountId)
      .filter((m) =>
        [m.subject, m.from, m.to, m.body].some((field) =>
          field.toLowerCase().includes(q),
        ),
      )
      .sort((a, b) => compareMailDate(b.date, a.date))
      .map((m) => ({ ...m, body: "" }));
  }

  idsForAccount(accountId: string): string[] {
    return [...this.messages.values()].filter((m) => m.accountId === accountId).map((m) => m.id);
  }
}

function extractAddress(from: string): string {
  const angle = from.match(/<([^>]+)>/);
  return (angle?.[1] ?? from).trim();
}
