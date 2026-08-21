/**
 * Conversation view.
 *
 * The message list already groups threads, but opening one showed a single
 * message — so a reply was read with its own question missing. On the live
 * inbox 86 of 180 messages sit in multi-message threads, so this is most of
 * the mailbox, not an edge case.
 *
 * Reuses `normalizeSubject` from threading.ts rather than reimplementing the
 * Re:/Fwd: rules. Two subject normalisers that drift apart would mean the list
 * groups messages the conversation view then refuses to show together.
 */

import { normalizeSubject } from "./threading.js";

export type ConversationRow = {
  id: string;
  subject: string;
  date: string;
  unread?: boolean;
};

export type Conversation<T extends ConversationRow> = {
  messages: T[];
  /** The message the user actually opened, so the UI can scroll to it. */
  focusId: string;
  unread: number;
  /** True when the thread was longer than the cap. */
  truncated: boolean;
};

/** One conversation cannot be allowed to pull an entire folder into memory. */
const MAX_IN_CONVERSATION = 100;

/** Epoch millis, or NaN for the malformed dates real mail actually carries. */
function timeOf(date: string): number {
  return new Date(date ?? "").getTime();
}

/**
 * Collect the thread containing `focusId`.
 *
 * Ordered OLDEST FIRST — the order it happened in, and the order that makes a
 * reply comprehensible. Note this is the opposite of the message list, which
 * is newest first because there you are scanning for what is new.
 */
export function buildConversation<T extends ConversationRow>(
  rows: T[],
  focusId: string,
): Conversation<T> {
  const focus = rows.find((r) => r.id === focusId);
  if (!focus) {
    return { messages: [], focusId, unread: 0, truncated: false };
  }

  const key = normalizeSubject(focus.subject ?? "");
  const inThread = rows.filter((r) => normalizeSubject(r.subject ?? "") === key);

  inThread.sort((a, b) => {
    const ta = timeOf(a.date);
    const tb = timeOf(b.date);
    // Unparseable dates sort last rather than being dropped: real mail carries
    // malformed dates, and hiding a message is worse than mis-ordering it.
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return ta - tb;
  });

  let messages = inThread;
  let truncated = false;
  if (inThread.length > MAX_IN_CONVERSATION) {
    truncated = true;
    /*
     * Keep the newest, but guarantee the opened message survives — otherwise
     * clicking an old message in a long thread opens a blank pane, which
     * looks like the app losing mail.
     */
    const tail = inThread.slice(-MAX_IN_CONVERSATION);
    messages = tail.some((m) => m.id === focusId)
      ? tail
      : [focus, ...tail.slice(0, MAX_IN_CONVERSATION - 1)];
  }

  return {
    messages,
    focusId,
    unread: messages.filter((m) => m.unread).length,
    truncated,
  };
}
