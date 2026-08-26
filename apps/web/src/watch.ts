/**
 * Did the mailbox move since we last painted the list?
 *
 * Auto-sync and IMAP IDLE already write to the store. The UI used to ignore
 * that until you pressed Fetch. Compare the health stamp and redraw only
 * when something actually changed, so a quiet inbox does not flicker.
 */
export type InboxStamp = {
  lastFetchAt: string | null;
  unread: number;
  inboxTotal: number;
};

export function stampChanged(prev: InboxStamp | null, next: InboxStamp): boolean {
  if (!prev) return true;
  return (
    prev.lastFetchAt !== next.lastFetchAt ||
    prev.unread !== next.unread ||
    prev.inboxTotal !== next.inboxTotal
  );
}
