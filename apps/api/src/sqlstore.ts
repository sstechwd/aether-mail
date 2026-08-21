/**
 * SQLite-backed mail storage.
 *
 * The JSON store loaded every message — bodies, HTML and all — into memory at
 * startup and rewrote the entire file on any change. Measured on the live
 * mailbox: 8.0 MB for 246 messages, so roughly 325 MB at 10,000. That is the
 * ceiling between a demo and something a stranger can actually adopt.
 *
 * Uses `node:sqlite`, built into Node 22+, deliberately rather than a native
 * module: the API ships as a single-file SEA binary and a .node addon cannot
 * be bundled into one.
 *
 * The interface mirrors the JSON store so the API does not have to be
 * rewritten around it, and existing `mail.json` data migrates on first open.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type StoredAttachment = {
  part: number;
  filename: string;
  mimeType: string;
  size: number;
  contentId: string | null;
  inline: boolean;
};

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
  body: string;
  html?: string;
  headers?: string;
  preview?: string;
  uid?: string;
  remoteFolder?: string;
  attachments?: StoredAttachment[];
  hiddenMedia?: number;
};

export type FolderSummary = { name: string; unread: number; total: number };

/** Columns the list pane needs. Bodies stay on disk until a message is opened. */
const ENVELOPE_COLS =
  "id, account_id, folder, sender, recipient, subject, date, unread, starred, preview, attachments_json, hidden_media";

type Row = Record<string, unknown>;

export class SqlStore {
  private db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static openFile(dbPath: string, migrateFromJson?: string): SqlStore {
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);

    // WAL keeps reads from blocking on the sync writer.
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");

    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        folder TEXT NOT NULL,
        sender TEXT NOT NULL DEFAULT '',
        recipient TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        date TEXT NOT NULL DEFAULT '',
        unread INTEGER NOT NULL DEFAULT 1,
        starred INTEGER NOT NULL DEFAULT 0,
        body TEXT,
        html TEXT,
        headers TEXT,
        preview TEXT,
        uid TEXT,
        remote_folder TEXT,
        attachments_json TEXT,
        hidden_media INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_msg_folder ON messages(account_id, folder, date DESC);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS extra_folders (
        account_id TEXT NOT NULL,
        name TEXT NOT NULL,
        PRIMARY KEY (account_id, name)
      );
    `);

    // Full-text index. Contentless (content='') would need manual sync on every
    // write; storing the text costs disk but keeps search correct by
    // construction, which matters more than a few MB here.
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        id UNINDEXED, account_id UNINDEXED, subject, sender, body
      );
    `);

    const store = new SqlStore(db);
    if (migrateFromJson) store.migrateOnce(migrateFromJson);
    return store;
  }

  /**
   * Import a legacy `mail.json` exactly once.
   *
   * Guarded by a meta flag: re-importing on every startup would drag messages
   * back to the folder they were fetched into and silently undo every move the
   * user made.
   */
  private migrateOnce(jsonPath: string): void {
    const done = this.db.prepare("SELECT value FROM meta WHERE key = 'migrated_from_json'").get() as
      | Row
      | undefined;
    if (done) return;

    let rows: StoredMessage[] = [];
    try {
      if (existsSync(jsonPath)) {
        const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as unknown;
        if (Array.isArray(parsed)) rows = parsed as StoredMessage[];
      }
    } catch {
      // A corrupt or half-written file must not stop the app from starting.
      rows = [];
    }

    if (rows.length > 0) this.loadFixture(rows);
    this.db
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated_from_json', ?)")
      .run(new Date().toISOString());
  }

  /**
   * Insert or update messages.
   *
   * Local flags survive a re-sync: IMAP re-delivers the same message, and
   * clobbering `unread`/`starred` every fetch makes "mark read" look broken.
   */
  loadFixture(rows: StoredMessage[]): void {
    const upsert = this.db.prepare(`
      INSERT INTO messages (
        id, account_id, folder, sender, recipient, subject, date, unread, starred,
        body, html, headers, preview, uid, remote_folder, attachments_json, hidden_media
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        folder = excluded.folder,
        sender = excluded.sender,
        recipient = excluded.recipient,
        subject = excluded.subject,
        date = excluded.date,
        body = excluded.body,
        html = excluded.html,
        headers = excluded.headers,
        preview = excluded.preview,
        uid = excluded.uid,
        remote_folder = excluded.remote_folder,
        attachments_json = excluded.attachments_json,
        hidden_media = excluded.hidden_media
    `);
    const clearFts = this.db.prepare("DELETE FROM messages_fts WHERE id = ?");
    const addFts = this.db.prepare(
      "INSERT INTO messages_fts (id, account_id, subject, sender, body) VALUES (?, ?, ?, ?, ?)",
    );

    this.db.exec("BEGIN");
    try {
      for (const m of rows) {
        if (!m?.id) continue;
        upsert.run(
          m.id,
          m.accountId ?? "",
          m.folder ?? "INBOX",
          m.from ?? "",
          m.to ?? "",
          m.subject ?? "",
          m.date ?? "",
          m.unread ? 1 : 0,
          m.starred ? 1 : 0,
          m.body ?? null,
          m.html ?? null,
          m.headers ?? null,
          m.preview ?? null,
          m.uid ?? null,
          m.remoteFolder ?? null,
          m.attachments ? JSON.stringify(m.attachments) : null,
          m.hiddenMedia ?? 0,
        );
        clearFts.run(m.id);
        addFts.run(m.id, m.accountId ?? "", m.subject ?? "", m.from ?? "", m.body ?? "");
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  private toMessage(row: Row, withBody: boolean): StoredMessage {
    const msg: StoredMessage = {
      id: String(row.id),
      accountId: String(row.account_id),
      folder: String(row.folder),
      from: String(row.sender ?? ""),
      to: String(row.recipient ?? ""),
      subject: String(row.subject ?? ""),
      date: String(row.date ?? ""),
      unread: Number(row.unread) === 1,
      starred: Number(row.starred) === 1,
      // Callers type body as a string; the list path simply has it empty.
      body: "",
      hiddenMedia: Number(row.hidden_media ?? 0),
    };
    if (row.preview != null) msg.preview = String(row.preview);
    if (row.attachments_json != null) {
      try {
        msg.attachments = JSON.parse(String(row.attachments_json)) as StoredAttachment[];
      } catch {
        msg.attachments = [];
      }
    }
    if (withBody) {
      msg.body = row.body != null ? String(row.body) : "";
      if (row.html != null) msg.html = String(row.html);
      if (row.headers != null) msg.headers = String(row.headers);
      if (row.uid != null) msg.uid = String(row.uid);
      if (row.remote_folder != null) msg.remoteFolder = String(row.remote_folder);
    }
    return msg;
  }

  listMessages(
    accountId: string,
    folder: string,
    order: "newest" | "oldest" = "newest",
  ): StoredMessage[] {
    const dir = order === "oldest" ? "ASC" : "DESC";
    const rows = this.db
      .prepare(
        `SELECT ${ENVELOPE_COLS} FROM messages
         WHERE account_id = ? AND folder = ? ORDER BY date ${dir}`,
      )
      .all(accountId, folder) as Row[];
    return rows.map((r) => this.toMessage(r, false));
  }

  allForAccount(accountId: string): StoredMessage[] {
    const rows = this.db
      .prepare(`SELECT ${ENVELOPE_COLS} FROM messages WHERE account_id = ? ORDER BY date DESC`)
      .all(accountId) as Row[];
    return rows.map((r) => this.toMessage(r, false));
  }

  getMessage(id: string): StoredMessage | undefined {
    const row = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Row | undefined;
    return row ? this.toMessage(row, true) : undefined;
  }

  listFolders(accountId: string): FolderSummary[] {
    const rows = this.db
      .prepare(
        `SELECT folder AS name, COUNT(*) AS total, SUM(unread) AS unread
         FROM messages WHERE account_id = ? GROUP BY folder`,
      )
      .all(accountId) as Row[];
    const byName = new Map<string, FolderSummary>();
    for (const r of rows) {
      byName.set(String(r.name), {
        name: String(r.name),
        total: Number(r.total ?? 0),
        unread: Number(r.unread ?? 0),
      });
    }
    // Folders the user created that hold nothing yet must still be listed, or
    // they disappear the moment their last message is moved out.
    const extra = this.db
      .prepare("SELECT name FROM extra_folders WHERE account_id = ?")
      .all(accountId) as Row[];
    for (const e of extra) {
      const name = String(e.name);
      if (!byName.has(name)) byName.set(name, { name, total: 0, unread: 0 });
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  markRead(id: string): void {
    this.db.prepare("UPDATE messages SET unread = 0 WHERE id = ?").run(id);
  }

  markUnread(id: string): void {
    this.db.prepare("UPDATE messages SET unread = 1 WHERE id = ?").run(id);
  }

  setStarred(id: string, starred: boolean): void {
    this.db.prepare("UPDATE messages SET starred = ? WHERE id = ?").run(starred ? 1 : 0, id);
  }

  move(id: string, folder: string): void {
    this.db.prepare("UPDATE messages SET folder = ? WHERE id = ?").run(folder, id);
  }

  markFolderRead(accountId: string, folder: string): void {
    this.db
      .prepare("UPDATE messages SET unread = 0 WHERE account_id = ? AND folder = ?")
      .run(accountId, folder);
  }

  idsForAccount(accountId: string): string[] {
    const rows = this.db
      .prepare("SELECT id FROM messages WHERE account_id = ?")
      .all(accountId) as Row[];
    return rows.map((r) => String(r.id));
  }

  /**
   * Full-text search.
   *
   * The query is rewritten into a quoted prefix expression rather than passed
   * through: a bare quote, `AND`, or `*` is a syntax error in FTS5 MATCH, and
   * a search box must never fail because someone typed an apostrophe.
   */
  search(accountId: string, query: string): StoredMessage[] {
    const terms = (query ?? "")
      .split(/\s+/)
      .map((t) => t.replace(/["*()]/g, "").trim())
      .filter(Boolean)
      .map((t) => `"${t}"*`);
    if (terms.length === 0) return [];

    try {
      /*
       * Two-step rather than one join.
       *
       * Mixing `MATCH` with a filter on an UNINDEXED column in the same WHERE
       * gave wrong counts on the real corpus (4 hits where 149 existed), and
       * `alias MATCH ?` is not valid syntax. Resolving the ids first keeps the
       * MATCH clause alone and unambiguous, then the account filter is an
       * ordinary query on the messages table.
       */
      const hits = this.db
        .prepare("SELECT id FROM messages_fts WHERE messages_fts MATCH ? LIMIT 500")
        .all(terms.join(" ")) as Row[];
      const ids = hits.map((h) => String(h.id));
      if (ids.length === 0) return [];

      const placeholders = ids.map(() => "?").join(", ");
      const rows = this.db
        .prepare(
          `SELECT ${ENVELOPE_COLS} FROM messages
           WHERE account_id = ? AND id IN (${placeholders})
           ORDER BY date DESC LIMIT 200`,
        )
        .all(accountId, ...ids) as Row[];
      return rows.map((r) => this.toMessage(r, false));
    } catch {
      // Any residual FTS5 syntax trouble degrades to no results, never a 500.
      return [];
    }
  }

  /**
   * Folders with no mail in them yet.
   *
   * Folder summaries are derived by grouping messages, so an empty folder
   * would otherwise vanish from the sidebar the moment its last message moved.
   */
  ensureFolder(accountId: string, name: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO extra_folders (account_id, name) VALUES (?, ?)")
      .run(accountId, name);
  }

  /** Save a draft into Drafts. */
  compose(input: { accountId: string; to: string; subject: string; body: string }): StoredMessage {
    const draft: StoredMessage = {
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
    this.loadFixture([draft]);
    return { ...draft };
  }

  reply(id: string): StoredMessage {
    const src = this.getMessage(id);
    if (!src) throw new Error("message not found");
    const angled = /<([^>]+)>/.exec(src.from);
    const addr = (angled ? angled[1] : src.from).trim();
    // Re: Re: Re: is how a subject line dies. Only add the prefix once.
    const subject = /^re:/i.test(src.subject) ? src.subject : `Re: ${src.subject}`;
    return this.compose({
      accountId: src.accountId,
      to: addr,
      subject,
      body: `\n\nOn ${src.date}, ${src.from} wrote:\n> ${(src.body ?? "").replace(/\n/g, "\n> ")}`,
    });
  }

  forward(id: string): StoredMessage {
    const src = this.getMessage(id);
    if (!src) throw new Error("message not found");
    const subject = /^fwd:/i.test(src.subject) ? src.subject : `Fwd: ${src.subject}`;
    return this.compose({
      accountId: src.accountId,
      to: "",
      subject,
      body: `\n\n---------- Forwarded message ----------\nFrom: ${src.from}\nDate: ${src.date}\nSubject: ${src.subject}\n\n${src.body ?? ""}`,
    });
  }

  /** Older stored rows may predate header capture; nothing to do here. */
  fillMissingHeaders(_rows: StoredMessage[]): void {}

  /** Kept so callers written against the JSON store still compile. */
  save(): void {}
  saveNow(): void {}

  close(): void {
    this.db.close();
  }
}
