export type FixtureMessage = {
  id: string;
  accountId: string;
  folder: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  unread: boolean;
  body: string;
};

export type FolderSummary = {
  name: string;
  unread: number;
  total: number;
};

export class MailStore {
  private messages = new Map<string, FixtureMessage>();

  static openMemory(): MailStore {
    return new MailStore();
  }

  loadFixture(rows: FixtureMessage[]): void {
    for (const row of rows) {
      this.messages.set(row.id, { ...row });
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
    return [...byFolder.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  listMessages(accountId: string, folder: string): FixtureMessage[] {
    return [...this.messages.values()]
      .filter((m) => m.accountId === accountId && m.folder === folder)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  getMessage(id: string): FixtureMessage | undefined {
    const found = this.messages.get(id);
    return found ? { ...found } : undefined;
  }

  markRead(id: string): void {
    const found = this.messages.get(id);
    if (found) found.unread = false;
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
      .sort((a, b) => b.date.localeCompare(a.date));
  }
}
