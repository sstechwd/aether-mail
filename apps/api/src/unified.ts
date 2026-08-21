/**
 * Unified inbox.
 *
 * One list across every configured account, newest first.
 *
 * With a single account this is identical to the inbox, so the UI only offers
 * it once there are two or more — otherwise it is a nav entry that appears to
 * do nothing. The merge still has to be correct regardless.
 */

/** The envelope fields a unified row needs. Bodies stay out of this. */
export type SourceMessage = {
  id: string;
  from: string;
  subject: string;
  date: string;
  unread: boolean;
  starred?: boolean;
  preview?: string;
};

export type AccountMail = {
  accountId: string;
  email: string;
  messages: SourceMessage[];
};

export type UnifiedRow = SourceMessage & {
  accountId: string;
  /** Shown as a small badge so it is obvious which mailbox a row belongs to. */
  accountEmail: string;
  /**
   * Stable unique key. Two accounts can hold the same provider uid, and a
   * duplicate React key makes the reading pane open the wrong message.
   */
  rowKey: string;
};

/** Epoch ms, or 0 when the Date header is missing or unparseable. */
function timeOf(date: string): number {
  const ms = Date.parse(date ?? "");
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Merge every account's mail into one date-ordered list.
 *
 * Messages with a broken Date header sort last rather than being dropped:
 * real mail does carry malformed dates, and hiding mail from the user is a
 * worse failure than showing it in the wrong position.
 */
export function mergeAccounts(accounts: AccountMail[], limit = 400): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  for (const account of accounts) {
    for (const msg of account.messages ?? []) {
      rows.push({
        ...msg,
        accountId: account.accountId,
        accountEmail: account.email,
        rowKey: `${account.accountId}::${msg.id}`,
      });
    }
  }
  rows.sort((a, b) => timeOf(b.date) - timeOf(a.date));
  return rows.slice(0, limit);
}
