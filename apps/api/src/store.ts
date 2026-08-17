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
};

export type FolderSummary = {
  name: string;
  unread: number;
  total: number;
};

export class MailStore {
  private messages = new Map<string, FixtureMessage>();
  private filePath: string | null = null;

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
      for (const row of rows) this.messages.set(row.id, { ...row, starred: row.starred ?? false });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
    }
  }

  save(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const rows = [...this.messages.values()];
    writeFileSync(this.filePath, JSON.stringify(rows, null, 2), "utf8");
  }

  loadFixture(rows: FixtureMessage[]): void {
    for (const row of rows) {
      this.messages.set(row.id, { ...row, starred: row.starred ?? false });
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
    return folders;
  }

  listMessages(accountId: string, folder: string): FixtureMessage[] {
    return [...this.messages.values()]
      .filter((m) => {
        if (m.accountId !== accountId) return false;
        if (folder === "Starred") return Boolean(m.starred);
        return m.folder === folder;
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((m) => ({ ...m, body: "" }));
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
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((m) => ({ ...m, body: "" }));
  }
}

function extractAddress(from: string): string {
  const angle = from.match(/<([^>]+)>/);
  return (angle?.[1] ?? from).trim();
}
