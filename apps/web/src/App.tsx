import { useEffect, useRef, useState } from "react";
import { apiUrl } from "./apibase.js";
import {
  monthGrid,
  weekDays,
  sameDay,
  shift,
  viewLabel,
  dayLabel,
  type CalView,
} from "./calgrid.js";
import {
  loadPanes,
  savePanes,
  applyPanes,
  clampPane,
  resetPanes,
  PANE_LIMITS,
  type PaneWidths,
  type PaneKey,
} from "./panes.js";
import { toggleSelection, rangeSelection, UndoStack } from "./selection.js";
import Settings from "./Settings";
import AgentChat from "./AgentChat";
import Templates from "./Templates";
import { THEMES, applyTheme, readTheme } from "./themes";

type Provider = {
  id: string;
  label: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  unsupported: boolean;
  notes: string;
};
type SavedAccount = { id: string; email: string; provider: string; imap_host: string };
type Folder = { name: string; unread: number; total: number };
type Message = {
  id: string;
  accountId?: string;
  folder: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  unread: boolean;
  starred?: boolean;
  body: string;
  hiddenMedia?: number;
  /** Snippet from the server — the list never receives a full body. */
  preview?: string;
  /** Non-inline attachments, for the paperclip in the list row. */
  attachmentCount?: number;
  /** Set when the list is grouped into conversations. */
  threadCount?: number;
  participants?: string[];
  threadIds?: string[];
};
type AgentResult = {
  skill: string;
  text: string;
  model: string;
  proposedActions: Array<{ type: string; label: string }>;
  refused: string[];
};

type OutboxItem = {
  id: string;
  to: string;
  subject: string;
  sendAt: number | null;
  status: "queued" | "sending" | "failed";
  attempts: number;
  error?: string;
  queuedAt: number;
};

type Invite = {
  summary: string;
  description?: string;
  location?: string;
  organizer?: string;
  attendees: string[];
  start: string | null;
  end: string | null;
  allDay: boolean;
  method?: string;
  uid?: string;
};

type Contact = { address: string; name?: string; score: number };

type Rule = {
  id: string;
  field: "from" | "to" | "subject";
  contains: string;
  action: "move" | "star" | "read";
  folder?: string;
  enabled: boolean;
};

type CalEvent = {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  organizer?: string;
  attendees?: string[];
  start: string;
  end: string | null;
  allDay: boolean;
  messageId?: string;
};

/** Glyphs, not emoji: they inherit the theme colour and stay crisp at any size. */
const FOLDER_ICONS: Record<string, string> = {
  INBOX: "▾",
  Inbox: "▾",
  Sent: "↑",
  Drafts: "✎",
  Trash: "⌫",
  Spam: "⚠",
  Junk: "⚠",
  Archive: "▤",
  Starred: "★",
};

/** A human sentence for when a meeting is. Mirrors the server's formatter. */
function inviteWhen(ev: Invite): string {
  if (!ev.start) return "Time not specified";
  const start = new Date(ev.start);
  if (Number.isNaN(start.getTime())) return "Time not specified";
  if (ev.allDay) return `${start.toLocaleDateString(undefined, { dateStyle: "full" })} · all day`;
  const date = start.toLocaleDateString(undefined, { dateStyle: "full" });
  const from = start.toLocaleTimeString(undefined, { timeStyle: "short" });
  if (!ev.end) return `${date} at ${from}`;
  const end = new Date(ev.end);
  if (Number.isNaN(end.getTime())) return `${date} at ${from}`;
  return `${date} · ${from} – ${end.toLocaleTimeString(undefined, { timeStyle: "short" })}`;
}

/**
 * Grow a message iframe to fit its content.
 *
 * The frame is sandboxed with no same-origin, so the page inside cannot tell us
 * how tall it is and we cannot read its document in the normal case. Where the
 * browser does allow the measurement we use it; otherwise we fall back to a
 * generous height so a long newsletter is not trapped in a small box.
 *
 * Images load after the document fires load, so we re-measure a couple of times
 * rather than trusting the first number.
 */
function fitMailFrame(frame: HTMLIFrameElement): void {
  const measure = (): void => {
    try {
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      const height = Math.max(
        doc.body.scrollHeight,
        doc.documentElement?.scrollHeight ?? 0,
        420,
      );
      // Cap it: a runaway page should not create a mile-long pane.
      frame.style.height = `${Math.min(height + 24, 20000)}px`;
    } catch {
      // Cross-origin measurement blocked — leave the CSS min-height in place.
    }
  };
  measure();
  // Re-measure as images arrive and late layout settles.
  window.setTimeout(measure, 120);
  window.setTimeout(measure, 600);
}

/** Bytes -> what a person reads next to a filename. */
function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** True when running inside the Tauri shell rather than a plain browser tab. */
function inTauri(): boolean {
  return typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json()) as T & { error?: string; message?: string; preview?: { to?: string } };
  if (!res.ok) {
    const extra = data.preview?.to ? ` Would send to ${data.preview.to}.` : "";
    throw new Error((data.message || data.error || res.statusText) + extra);
  }
  return data;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function App() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folder, setFolder] = useState(() => {
    try {
      return localStorage.getItem("aether.folder") || "INBOX";
    } catch {
      return "INBOX";
    }
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Message | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [agent, setAgent] = useState<AgentResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendNote, setSendNote] = useState<string | null>(null);
  const [threat, setThreat] = useState<{ score: number; label: string; reasons: string[] } | null>(null);
  const [inspect, setInspect] = useState<{
    label: string;
    findings: string[];
    spf: string;
    dkim: string;
    dmarc: string;
    fromDomain: string;
    returnPathDomain: string;
    receivedHops: number;
  } | null>(null);
  const [showInspect, setShowInspect] = useState(false);
  const [mailHtml, setMailHtml] = useState<string | null>(null);
  const [remoteImages, setRemoteImages] = useState(0);
  const [attachments, setAttachments] = useState<
    Array<{
      part: number;
      filename: string;
      mimeType: string;
      size: number;
      human: string;
      /** Server's verdict on what may be rendered in-app. */
      preview?: "image" | "pdf" | "text" | "none";
    }>
  >([]);
  /** The attachment being previewed inline, if any. */
  const [previewPart, setPreviewPart] = useState<number | null>(null);
  const [imagesOn, setImagesOn] = useState(false);
  const [lastFetchAt, setLastFetchAt] = useState<string | null>(null);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  /** Group the list into conversations. Persisted: it is a reading preference. */
  const [threaded, setThreaded] = useState(() => {
    try {
      return localStorage.getItem("aether.threaded") === "1";
    } catch {
      return false;
    }
  });
  const [sort, setSort] = useState<"newest" | "oldest">(() => {
    try {
      return localStorage.getItem("aether.sort") === "oldest" ? "oldest" : "newest";
    } catch {
      return "newest";
    }
  });
  const [showOnboard, setShowOnboard] = useState(false);
  const [splash, setSplash] = useState(true);
  const [themeId, setThemeId] = useState(readTheme);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showFolders, setShowFolders] = useState(false);
  /** Queued/scheduled mail waiting to go out. Local, not an IMAP folder. */
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  /** When set, the compose Send button queues for later instead of sending now. */
  const [scheduleAt, setScheduleAt] = useState("");
  /** Calendar invite found in the open message, if any. */
  const [invite, setInvite] = useState<Invite | null>(null);
  /** Address suggestions for the compose To field. */
  const [contactHits, setContactHits] = useState<Contact[]>([]);
  /** Full address book, for the Contacts page. */
  const [contacts, setContacts] = useState<Contact[]>([]);
  /** Local calendar events, for the Calendar page. */
  const [events, setEvents] = useState<CalEvent[]>([]);
  /** New-event form state on the Calendar page. */
  const [evTitle, setEvTitle] = useState("");
  const [evWhen, setEvWhen] = useState("");
  const [evWhere, setEvWhere] = useState("");
  const [calNote, setCalNote] = useState<string | null>(null);
  /** Which calendar view is showing, and the date it is centred on. */
  const [calView, setCalView] = useState<CalView>("month");
  const [calAnchor, setCalAnchor] = useState<Date>(() => new Date());
  /** The day the user clicked — drives the agenda and the detail pane. */
  const [calPicked, setCalPicked] = useState<Date>(() => new Date());
  /** Event selected for the detail pane. */
  const [calSelected, setCalSelected] = useState<string | null>(null);
  /** Contacts page filters. People-only hides newsletters and no-reply senders. */
  const [contactQuery, setContactQuery] = useState("");
  const [contactsPeopleOnly, setContactsPeopleOnly] = useState(true);
  /** Draggable pane widths. Persisted, so the layout survives a restart. */
  const [panes, setPanes] = useState<PaneWidths>(() => loadPanes());
  /** Which divider is being dragged right now, if any. */
  const [dragging, setDragging] = useState<PaneKey | null>(null);
  /** Message id being dragged onto a folder, and the folder under the cursor. */
  const [dragMsg, setDragMsg] = useState<string | null>(null);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  /** Multi-selected message ids, and the anchor row for shift-click ranges. */
  const [picked, setPicked] = useState<string[]>([]);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  /** Right-click menu position and target. */
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  /** One-deep undo for the last destructive action. */
  const undoRef = useRef(new UndoStack());
  const [undoLabel, setUndoLabel] = useState<string | null>(null);
  /** Filing rules, and the new-rule form on the Rules page. */
  const [rules, setRules] = useState<Rule[]>([]);
  const [ruleField, setRuleField] = useState<"from" | "to" | "subject">("from");
  const [ruleText, setRuleText] = useState("");
  const [ruleAction, setRuleAction] = useState<"move" | "star" | "read">("move");
  const [ruleFolder, setRuleFolder] = useState("Archive");
  const [ruleNote, setRuleNote] = useState<string | null>(null);
  /** What the open message offers by way of unsubscribing, if anything. */
  type Unsub = {
    available?: boolean;
    method?: "web" | "email";
    oneClick?: boolean;
    fromDomain?: string;
    mailto?: string;
  };
  const [unsub, setUnsub] = useState<Unsub | null>(null);
  /** Sibling messages in the open message's thread, oldest first. */
  type ConvoRow = {
    id: string;
    from: string;
    subject: string;
    date: string;
    unread?: boolean;
    preview?: string;
  };
  const [convo, setConvo] = useState<ConvoRow[]>([]);

  /*
   * Ask what the open message offers by way of unsubscribing.
   *
   * Read-only: this never contacts the sender, it only reads the headers we
   * already stored. Nothing leaves the machine until the user clicks.
   */
  /*
   * Load the rest of the conversation.
   *
   * Envelopes only — clicking a sibling opens it normally, so a long thread
   * never drags every body into the pane at once.
   */
  useEffect(() => {
    // Close any open preview: part numbers are per-message, so leaving it open
    // would render a different message's attachment.
    setPreviewPart(null);
    if (!selectedId) {
      setConvo([]);
      return;
    }
    let cancelled = false;
    void api<{ messages?: ConvoRow[] }>(
      `/api/messages/${encodeURIComponent(selectedId)}/conversation`,
    )
      .then((d) => {
        if (!cancelled) setConvo(d.messages ?? []);
      })
      .catch(() => {
        if (!cancelled) setConvo([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setUnsub(null);
      return;
    }
    let cancelled = false;
    void api<Unsub>(`/api/messages/${encodeURIComponent(selectedId)}/unsubscribe`)
      .then((d) => {
        if (!cancelled) setUnsub(d);
      })
      .catch(() => {
        if (!cancelled) setUnsub(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);
  /**
   * Bulk senders worth a rule, computed from the folder.
   *
   * Not model output — counting senders is arithmetic, so this works even
   * with no LLM configured.
   */
  type Suggestion = {
    match: string;
    label: string;
    count: number;
    unread: number;
    /** Held back because filing this domain would bury important mail. */
    withheld?: boolean;
    reason?: string;
  };
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  /** Suggestions the user has ticked for batch approval. */
  const [pickedSuggestions, setPickedSuggestions] = useState<string[]>([]);
  /** A pending agent automation suggestion, awaiting a human click. */
  const [proposal, setProposal] = useState<{
    proposal: unknown;
    describe: string;
    note?: string | null;
  } | null>(null);
  /** Unified inbox rows, and whether it is worth showing at all. */
  const [unified, setUnified] = useState<(Message & { accountEmail?: string; rowKey?: string })[]>([]);
  const [unifiedUseful, setUnifiedUseful] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState("fixture");
  const [adding, setAdding] = useState(false);
  const [providerId, setProviderId] = useState("gmail");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [accountNote, setAccountNote] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [attachFiles, setAttachFiles] = useState<Array<{ path: string; name: string; size: number }>>([]);
  /** Confirm token for a compose-window send. Two clicks, same as replies. */
  const [composeConfirm, setComposeConfirm] = useState<string | null>(null);
  const [composeNote, setComposeNote] = useState<string | null>(null);
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  /** Formatted body from the contenteditable, sanitized server-side at prepare. */
  const [composeHtml, setComposeHtml] = useState("");
  const composeRef = useRef<HTMLDivElement | null>(null);

  async function refreshFolders() {
    const data = await api<{ folders: Folder[] }>("/api/folders");
    setFolders(data.folders);
  }

  async function refreshMessages(nextFolder: string) {
    const data = await api<{ messages: Message[]; account?: string }>(
      `/api/messages?folder=${encodeURIComponent(nextFolder)}&sort=${sort}${threaded ? "&threaded=1" : ""}`,
    );
    setMessages(data.messages);
  }

  function selectAccount(id: string) {
    setBusy("switch");
    api<{ active: string; folders: Folder[] }>(`/api/accounts/${id}/select`, { method: "POST" })
      .then((d) => {
        setActiveAccountId(d.active);
        setFolders(d.folders);
        setSelectedId(null);
        setFolder("INBOX");
        return refreshMessages("INBOX");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  }

  useEffect(() => {
    refreshFolders().catch((e: Error) => setError(e.message));
    api<{ providers: Provider[] }>("/api/providers")
      .then((d) => setProviders(d.providers))
      .catch((e: Error) => setError(e.message));
    api<{ accounts: SavedAccount[]; active?: string }>("/api/accounts")
      .then((d) => {
        setSavedAccounts(d.accounts);
        if (d.active) setActiveAccountId(d.active);
        try {
          if (d.accounts.length === 0 && !localStorage.getItem("aether.onboarded")) setShowOnboard(true);
        } catch {
          if (d.accounts.length === 0) setShowOnboard(true);
        }
      })
      .catch((e: Error) => setError(e.message));
    const tick = () => {
      api<{ lastFetchAt: string | null; unread: number }>("/api/health")
        .then((d) => {
          setLastFetchAt(d.lastFetchAt);
          setUnreadTotal(d.unread);
        })
        .catch(() => undefined);
    };
    tick();
    const id = setInterval(tick, 15000);
    const splashTimer = setTimeout(() => setSplash(false), 1400);
    return () => {
      clearInterval(id);
      clearTimeout(splashTimer);
    };
  }, []);

  useEffect(() => {
    refreshMessages(folder).catch((e: Error) => setError(e.message));
    try {
      localStorage.setItem("aether.folder", folder);
    } catch {
      /* ignore */
    }
  }, [folder, sort, threaded]);

  // Ask once whether a unified inbox is worth offering. With one account it
  // is a duplicate of the inbox, so the nav entry stays hidden.
  useEffect(() => {
    void refreshUnified();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      setThreat(null);
      setInspect(null);
      setShowInspect(false);
      setMailHtml(null);
      setRemoteImages(0);
      setImagesOn(false);
      return;
    }
    api<{
      message: Message;
      html?: string | null;
      remoteImages?: number;
      imagesOn?: boolean;
      attachments?: Array<{
        part: number;
        filename: string;
        mimeType: string;
        size: number;
        human: string;
        /** Server's verdict on what may be rendered in-app. */
        preview?: "image" | "pdf" | "text" | "none";
      }>;
      invite?: Invite | null;
      draft: { text: string } | null;
      threat?: { score: number; label: string; reasons: string[] };
      inspect?: {
        label: string;
        findings: string[];
        spf: string;
        dkim: string;
        dmarc: string;
        fromDomain: string;
        returnPathDomain: string;
        receivedHops: number;
      } | null;
      autoOpen?: boolean;
    }>(`/api/messages/${selectedId}`)
      .then((data) => {
        setSelected(data.message);
        setMailHtml(data.html ?? null);
        setRemoteImages(data.remoteImages ?? 0);
        setImagesOn(Boolean(data.imagesOn));
        setAttachments(data.attachments ?? []);
        setInvite(data.invite ?? null);
        setThreat(data.threat ?? null);
        setInspect(data.inspect ?? null);
        setShowInspect(Boolean(data.autoOpen));
        if (data.draft?.text) setDraft(data.draft.text);
        setMessages((prev) => prev.map((m) => (m.id === selectedId ? { ...m, unread: false } : m)));
        refreshFolders().catch(() => undefined);
      })
      .catch((e: Error) => setError(e.message));
  }, [selectedId]);

  const [hits, setHits] = useState<Message[] | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    const t = setTimeout(() => {
      api<{ messages: Message[] }>(`/api/search?q=${encodeURIComponent(q)}`)
        .then((data) => setHits(data.messages))
        .catch((e: Error) => setError(e.message));
    }, 150);
    return () => clearTimeout(t);
  }, [query]);

  const visible = (hits ?? messages).filter((m) => {
    if (unreadOnly && !m.unread) return false;
    if (m.accountId && m.accountId !== activeAccountId) return false;
    return true;
  });
  const selectedRef = useRef(selected);
  const visibleRef = useRef(visible);
  selectedRef.current = selected;
  visibleRef.current = visible;

  async function runSkill(skill: "summarize" | "draft-reply" | "triage" | "action-items") {
    if (!selectedId) return;
    setBusy(skill);
    setError(null);
    try {
      const data = await api<{ result: AgentResult; draft: { text: string } | null }>("/api/agent/run", {
        method: "POST",
        body: JSON.stringify({ messageId: selectedId, skill }),
      });
      setAgent(data.result);
      if (data.draft?.text) setDraft(data.draft.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** Open the compose window pre-filled as a reply / reply-all / forward. */
  async function startCompose(mode: "reply" | "all" | "forward"): Promise<void> {
    if (!selectedId) return;
    setError(null);
    try {
      const data = await api<{ compose: { to: string; cc?: string; subject: string; body: string } }>(
        "/api/compose/reply",
        { method: "POST", body: JSON.stringify({ messageId: selectedId, mode }) },
      );
      setComposeTo(data.compose.to);
      setComposeSubject(data.compose.subject);
      setComposeBody(data.compose.body);
      setAttachFiles([]);
      setComposing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Delete is destructive and human-only. The agent has no path to this: it is
   * a click handler, not a tool, and it always asks first.
   */
  async function deleteSelected(): Promise<void> {
    const current = selectedRef.current;
    if (!current) return;
    const ok = window.confirm(`Delete "${current.subject}"?\n\nThis moves it to Trash on the server.`);
    if (!ok) return;
    try {
      await moveSelected("Trash");
      setSelectedId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Hand the invite to whatever calendar the OS has registered for .ics. */
  async function addToCalendar(): Promise<void> {
    if (!invite) return;
    try {
      const res = await fetch(apiUrl("/api/calendar/ics"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite }),
      });
      if (!res.ok) throw new Error("Could not build the calendar file.");
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${(invite.summary || "invite").replace(/[^\w.-]+/g, "-").slice(0, 60)}.ics`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Suggest addresses from mail we already have. No address book to sync. */
  async function lookupContacts(query: string): Promise<void> {
    const q = query.split(",").pop()?.trim() ?? "";
    if (q.length < 2) {
      setContactHits([]);
      return;
    }
    try {
      const data = await api<{ contacts: Contact[] }>(`/api/contacts?q=${encodeURIComponent(q)}`);
      setContactHits(data.contacts ?? []);
    } catch {
      setContactHits([]);
    }
  }

  /** Remove a contact. Stays removed across syncs. */
  async function removeContact(address: string): Promise<void> {
    try {
      await api(`/api/contacts/${encodeURIComponent(address)}`, { method: "DELETE" });
      setContacts((cs) => cs.filter((c) => c.address !== address));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Open the current message in its own window, the way Outlook does.
   *
   * The popup gets the already-sanitized HTML we render in the reading pane —
   * it never re-fetches and never gets the raw message, so the same rules
   * apply: no scripts, no remote images unless the user already allowed them.
   */
  function openMessageWindow(): void {
    if (!selected) return;
    const win = window.open("", "_blank", "width=900,height=760,menubar=no,toolbar=no");
    if (!win) {
      setError("Your window manager blocked the popup.");
      return;
    }
    const esc = (v: string): string =>
      v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const head = `<style>
      body{margin:0;font:14px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;background:#fff;color:#111}
      header{padding:16px 20px;border-bottom:1px solid #e5e5e5}
      h1{margin:0 0 6px;font-size:19px}
      .meta{color:#666;font-size:13px}
      iframe{display:block;width:100%;border:0;min-height:70vh}
      pre{margin:0;padding:16px 20px;white-space:pre-wrap;font:inherit}
    </style>`;
    const header = `<header><h1>${esc(selected.subject || "(no subject)")}</h1>
      <div class="meta">${esc(selected.from)} · ${esc(formatWhen(selected.date))}</div></header>`;
    const bodyHtml = mailHtml
      ? `<iframe sandbox="" referrerpolicy="no-referrer" srcdoc="${mailHtml.replace(/"/g, "&quot;")}"></iframe>`
      : `<pre>${esc(selected.body ?? "")}</pre>`;
    win.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${esc(
        selected.subject || "Message",
      )}</title>${head}</head><body>${header}${bodyHtml}</body></html>`,
    );
    win.document.close();
  }

  // Push pane widths into the CSS variables the grid reads, and remember them.
  useEffect(() => {
    applyPanes(panes);
    savePanes(panes);
  }, [panes]);

  /**
   * Drag a divider.
   *
   * Pointer capture means the drag keeps working if the cursor leaves the thin
   * divider, which is the difference between a resize that feels solid and one
   * that keeps slipping. The folders divider is measured from the window edge;
   * the list divider is measured from where the folders pane ends.
   */
  function startPaneDrag(key: PaneKey, e: React.PointerEvent<HTMLDivElement>): void {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setDragging(key);

    const move = (ev: PointerEvent): void => {
      setPanes((current) => {
        const next =
          key === "folders"
            ? clampPane("folders", ev.clientX)
            : clampPane("list", ev.clientX - current.folders);
        if (next === current[key]) return current;
        return { ...current, [key]: next };
      });
    };

    const stop = (): void => {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      setDragging(null);
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }

  /** Keyboard resizing, so a divider is not mouse-only. */
  function nudgePane(key: PaneKey, delta: number): void {
    setPanes((current) => ({ ...current, [key]: clampPane(key, current[key] + delta) }));
  }

  /**
   * Mute the thread of the right-clicked message.
   *
   * Muting files existing replies and keeps future ones out of the inbox. It
   * does not delete or unsubscribe — the thread stays in Archive.
   */
  async function muteThread(): Promise<void> {
    const target = menu ? messages.find((m) => m.id === menu.id) : null;
    const subject = target?.subject ?? "";
    if (!subject.trim()) {
      setError("That message has no subject to mute on.");
      return;
    }
    try {
      const data = await api<{ filed: number; folders: Folder[] }>("/api/mute", {
        method: "POST",
        body: JSON.stringify({ subject }),
      });
      setFolders(data.folders);
      await refreshMessages(folder);
      setSendNote(`Muted. ${data.filed} message(s) filed.`);
      window.setTimeout(() => setSendNote(null), 2600);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Load the unified inbox.
   *
   * `meaningful` is false with a single account, where this view would be an
   * exact copy of the inbox — so the nav entry stays hidden rather than
   * pretending to do something.
   */
  async function refreshUnified(): Promise<void> {
    try {
      const data = await api<{
        messages: (Message & { accountEmail?: string; rowKey?: string })[];
        meaningful: boolean;
      }>("/api/unified");
      setUnified(data.messages ?? []);
      setUnifiedUseful(Boolean(data.meaningful));
    } catch {
      setUnified([]);
      setUnifiedUseful(false);
    }
  }

  /**
   * Ask the model to suggest one automation for the open message.
   *
   * The reply is a structured proposal validated server-side against a closed
   * allow-list — there is no send or delete action in the schema. Nothing is
   * created until the user clicks Create it.
   */
  async function proposeAutomation(): Promise<void> {
    if (!selectedId) return;
    setBusy("propose");
    setProposal(null);
    try {
      const d = await api<{ proposal: unknown; describe?: string; note?: string }>(
        "/api/agent/propose",
        { method: "POST", body: JSON.stringify({ messageId: selectedId }) },
      );
      if (!d.proposal) {
        setRuleNote(d.note ?? "Nothing worth automating here.");
        return;
      }
      setProposal({ proposal: d.proposal, describe: d.describe ?? "", note: d.note });
    } catch (e) {
      setRuleNote(e instanceof Error ? e.message : "Agent unavailable.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Remove an empty folder the user created.
   *
   * Confirms first, then lets the server decide: it refuses standard folders
   * and any folder still holding mail, so deleting a folder can never be an
   * accidental way to lose messages.
   */
  async function removeFolder(name: string): Promise<void> {
    if (!window.confirm(`Remove the folder "${name}"?`)) return;
    try {
      const d = await api<{ folders?: Folder[] }>(`/api/folders/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (d.folders) setFolders(d.folders);
      if (folder === name) setFolder("INBOX");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove that folder.");
    }
  }

  /**
   * Create the rule a suggestion describes, then file what is already there.
   *
   * Two steps on purpose: the rule handles future mail, and "Run on Inbox"
   * handles the backlog the user is actually looking at. Creating a rule that
   * silently leaves 19 messages sitting in the inbox reads as broken.
   */
  async function acceptSuggestion(s: Suggestion, destination: string): Promise<void> {
    try {
      await api("/api/rules", {
        method: "POST",
        body: JSON.stringify({
          field: "from",
          contains: s.match,
          action: "move",
          folder: destination,
        }),
      });
      setSuggestions((prev) => prev.filter((p) => p.match !== s.match));
      await refreshRules();
      await runRules();
      await loadSuggestions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create that rule.");
    }
  }

  /**
   * Create rules for every ticked suggestion in one request.
   *
   * The server validates the whole batch before creating anything, so a bad
   * entry cannot leave half the rules behind.
   */
  async function acceptPicked(): Promise<void> {
    const chosen = suggestions.filter((s) => pickedSuggestions.includes(s.match) && !s.withheld);
    if (chosen.length === 0) return;
    if (!window.confirm(`File mail from ${chosen.length} senders into Archive?`)) return;
    try {
      const d = await api<{ created?: number; filed?: number }>("/api/agent/approve-batch", {
        method: "POST",
        body: JSON.stringify({
          entries: chosen.map((c) => ({ match: c.match, folder: "Archive" })),
        }),
      });
      setRuleNote(`Created ${d.created ?? 0} rules and filed ${d.filed ?? 0} messages.`);
      setPickedSuggestions([]);
      await refreshRules();
      await loadSuggestions();
      await refreshFolders();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create those rules.");
    }
  }

  async function loadSuggestions(): Promise<void> {
    try {
      const d = await api<{ candidates?: Suggestion[] }>(
        "/api/agent/folder-suggestions?folder=INBOX",
      );
      setSuggestions(d.candidates ?? []);
    } catch {
      // Suggestions are a bonus; never break the rules page over them.
      setSuggestions([]);
    }
  }

  /**
   * Unsubscribe from the open message's sender.
   *
   * Confirms first: unsubscribing is not destructive but it is irreversible
   * without visiting the sender's site, and it confirms to them that the
   * address is live.
   */
  async function doUnsubscribe(): Promise<void> {
    if (!selectedId) return;
    const who = unsub?.fromDomain ?? "this sender";
    if (!window.confirm(`Ask ${who} to stop emailing you?`)) return;
    try {
      const d = await api<{ ok?: boolean; message?: string }>(
        `/api/messages/${encodeURIComponent(selectedId)}/unsubscribe`,
        { method: "POST" },
      );
      setRuleNote(d.message ?? "Unsubscribe request sent.");
      setUnsub(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unsubscribe.");
    }
  }

  async function refreshRules(): Promise<void> {
    try {
      const data = await api<{ rules: Rule[] }>("/api/rules");
      setRules(data.rules ?? []);
    } catch {
      setRules([]);
    }
  }

  async function addRule(): Promise<void> {
    if (!ruleText.trim()) {
      setRuleNote("Give the rule something to match on.");
      return;
    }
    try {
      const data = await api<{ rules: Rule[] }>("/api/rules", {
        method: "POST",
        body: JSON.stringify({
          field: ruleField,
          contains: ruleText.trim(),
          action: ruleAction,
          folder: ruleAction === "move" ? ruleFolder : undefined,
        }),
      });
      setRules(data.rules ?? []);
      setRuleText("");
      setRuleNote(null);
    } catch (e) {
      setRuleNote(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeRule(id: string): Promise<void> {
    try {
      const data = await api<{ rules: Rule[] }>(`/api/rules/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setRules(data.rules ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Apply every rule to the current folder, on demand. */
  async function runRules(): Promise<void> {
    try {
      const data = await api<{ filed: number; folders: Folder[] }>("/api/rules/run", {
        method: "POST",
        body: JSON.stringify({ folder: folder === "__rules" ? "INBOX" : folder }),
      });
      setFolders(data.folders);
      setRuleNote(`Filed ${data.filed} message(s).`);
      await refreshMessages(folder === "__rules" ? "INBOX" : folder);
    } catch (e) {
      setRuleNote(e instanceof Error ? e.message : String(e));
    }
  }

  /** Snooze the selected messages until a preset time. */
  async function snooze(ids: string[], preset: "later" | "tomorrow" | "week" | "weekend"): Promise<void> {
    if (ids.length === 0) return;
    try {
      let folders: Folder[] = [];
      for (const id of ids) {
        const data = await api<{ folders: Folder[] }>("/api/snooze", {
          method: "POST",
          body: JSON.stringify({ id, preset }),
        });
        folders = data.folders;
      }
      if (folders.length) setFolders(folders);
      setMessages((ms) => ms.filter((m) => !ids.includes(m.id)));
      if (selectedId && ids.includes(selectedId)) setSelectedId(null);
      setPicked([]);
      setSendNote(`Snoozed ${ids.length} until ${preset}.`);
      window.setTimeout(() => setSendNote(null), 2400);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function refreshContacts(): Promise<void> {
    try {
      const data = await api<{ contacts: Contact[] }>("/api/contacts");
      setContacts(data.contacts ?? []);
    } catch {
      setContacts([]);
    }
  }

  async function refreshCalendar(): Promise<void> {
    try {
      const data = await api<{ events: CalEvent[] }>("/api/calendar");
      setEvents(data.events ?? []);
    } catch {
      setEvents([]);
    }
  }

  /** Add an event on the day currently picked in the grid. */
  async function addEvent(): Promise<void> {
    if (!evTitle.trim()) {
      setCalNote("Give it a title.");
      return;
    }
    try {
      // The grid supplies the date, the form supplies the time. Default to
      // 9am so a title-only event still lands somewhere sensible.
      const [hh, mm] = (evWhen || "09:00").split(":").map((n) => Number(n) || 0);
      const when = new Date(calPicked);
      when.setHours(hh, mm, 0, 0);
      await api("/api/calendar", {
        method: "POST",
        body: JSON.stringify({
          summary: evTitle.trim(),
          start: when.toISOString(),
          location: evWhere.trim() || undefined,
        }),
      });
      setEvTitle("");
      setEvWhen("");
      setEvWhere("");
      setCalNote(null);
      await refreshCalendar();
    } catch (e) {
      setCalNote(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeEvent(id: string): Promise<void> {
    try {
      await api(`/api/calendar/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refreshCalendar();
    } catch (e) {
      setCalNote(e instanceof Error ? e.message : String(e));
    }
  }

  /** Save an invite found in mail into the local calendar. */
  async function saveInviteToCalendar(): Promise<void> {
    if (!invite) return;
    try {
      await api("/api/calendar", {
        method: "POST",
        body: JSON.stringify({ ...invite, messageId: selectedId ?? undefined }),
      });
      await refreshCalendar();
      setSendNote("Added to your calendar.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function refreshOutbox(): Promise<void> {
    try {
      const data = await api<{ items: OutboxItem[] }>("/api/outbox");
      setOutbox(data.items ?? []);
    } catch {
      /* the outbox view will just show empty */
    }
  }

  async function cancelQueued(id: string): Promise<void> {
    try {
      await api(`/api/outbox/${encodeURIComponent(id)}/cancel`, { method: "POST" });
      await refreshOutbox();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function retryQueued(id: string): Promise<void> {
    try {
      await api(`/api/outbox/${encodeURIComponent(id)}/retry`, { method: "POST" });
      await refreshOutbox();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Send what is in the compose window. Two human clicks, exactly like the
   * reply path: the first prepares and returns a token, the second delivers.
   * The agent has no route into this — it is a click handler.
   */
  async function sendCompose(): Promise<void> {
    setComposeNote(null);
    try {
      const data = await api<{
        confirmId?: string;
        sent?: boolean;
        queued?: boolean;
        message?: string;
        preview?: { to: string; subject: string };
      }>("/api/send", {
        method: "POST",
        body: JSON.stringify({
          to: composeTo,
          subject: composeSubject,
          draft: composeBody,
          confirmId: composeConfirm,
          attachments: attachFiles.map((f) => f.path),
          // Empty means send now. A date-time means queue it in the Outbox.
          sendAt: scheduleAt ? new Date(scheduleAt).getTime() : undefined,
        }),
      });
      if (data.sent || data.queued) {
        setComposeConfirm(null);
        setComposeNote(null);
        setComposing(false);
        setComposeTo("");
        setComposeSubject("");
        setComposeBody("");
      setComposeHtml("");
      if (composeRef.current) composeRef.current.innerHTML = "";
        setComposeHtml("");
        if (composeRef.current) composeRef.current.innerHTML = "";
        setAttachFiles([]);
        setScheduleAt("");
        setSendNote(data.queued ? "Queued in the Outbox." : "Sent via SMTP.");
        void refreshOutbox();
        refreshFolders().catch(() => undefined);
      } else if (data.confirmId) {
        setComposeConfirm(data.confirmId);
        setComposeNote(
          `${data.message ?? "Click Send again to deliver."}${data.preview ? ` → ${data.preview.to}` : ""}`,
        );
      }
    } catch (e) {
      setComposeConfirm(null);
      setComposeNote(e instanceof Error ? e.message : String(e));
    }
  }

  async function pickAttachments(): Promise<void> {
    if (!inTauri()) {
      setError("Attaching files needs the desktop app — a browser tab cannot read file paths.");
      return;
    }
    try {
      const invoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;
      const picked = (await invoke("plugin:dialog|open", {
        options: { multiple: true, directory: false, title: "Attach files" },
      })) as string[] | string | null;
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      const added = await Promise.all(
        paths.map(async (p) => {
          const info = await api<{ name: string; size: number }>(
            `/api/fileinfo?path=${encodeURIComponent(p)}`,
          ).catch(() => null);
          return {
            path: p,
            name: info?.name ?? p.split(/[\\/]/).pop() ?? "file",
            size: info?.size ?? 0,
          };
        }),
      );
      setAttachFiles((prev) => {
        const seen = new Set(prev.map((f) => f.path));
        return [...prev, ...added.filter((f) => !seen.has(f.path))];
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the file picker.");
    }
  }

  async function saveDraft() {
    setError(null);
    try {
      const data = await api<{ message: Message; folders: Folder[] }>("/api/compose", {
        method: "POST",
        body: JSON.stringify({ to: composeTo, subject: composeSubject, body: composeBody, html: composeHtml }),
      });
      setFolders(data.folders);
      setComposing(false);
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
      setFolder("Drafts");
      setSelectedId(data.message.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function applyMessage(next: Message, foldersNext?: Folder[]) {
    setSelected(next);
    if (foldersNext) setFolders(foldersNext);
    else await refreshFolders().catch(() => undefined);
    if (next.folder !== folder) {
      setFolder(next.folder);
    } else {
      await refreshMessages(folder).catch(() => undefined);
    }
  }

  async function starSelected() {
    const current = selectedRef.current;
    if (!current) return;
    const data = await api<{ message: Message }>(`/api/messages/${current.id}/star`, {
      method: "POST",
      body: JSON.stringify({ starred: !current.starred }),
    });
    if (data.message) await applyMessage(data.message);
  }

  /**
   * Act on the current selection (or one message), with undo.
   *
   * Every destructive action records how to reverse itself before it runs, so
   * "Moved 40 to Trash" is always one click from being taken back. Undo is
   * one-deep and expires — see selection.ts for why.
   */
  async function bulkAction(
    ids: string[],
    action: "move" | "read" | "unread" | "star" | "unstar",
    dest?: string,
  ): Promise<void> {
    if (ids.length === 0) return;
    // Remember where each message was, so a move can be reversed exactly.
    const origins = new Map<string, string>();
    for (const id of ids) {
      const m = messages.find((x) => x.id === id);
      if (m) origins.set(id, m.folder ?? folder);
    }

    try {
      const data = await api<{ done: string[]; folders: Folder[] }>("/api/messages/bulk", {
        method: "POST",
        body: JSON.stringify({ ids, action, folder: dest }),
      });
      setFolders(data.folders);

      if (action === "move") {
        setMessages((ms) => ms.filter((m) => !ids.includes(m.id)));
        if (selectedId && ids.includes(selectedId)) setSelectedId(null);
        const label = `Moved ${ids.length} to ${dest}`;
        undoRef.current.push({
          label,
          undo: async () => {
            // Put each message back where it actually came from, one call per
            // origin folder rather than assuming they shared one.
            const byOrigin = new Map<string, string[]>();
            for (const [id, from] of origins) {
              byOrigin.set(from, [...(byOrigin.get(from) ?? []), id]);
            }
            for (const [from, group] of byOrigin) {
              await api("/api/messages/bulk", {
                method: "POST",
                body: JSON.stringify({ ids: group, action: "move", folder: from }),
              });
            }
            await refreshMessages(folder);
            await refreshFolders();
          },
        });
        setUndoLabel(label);
        window.setTimeout(() => setUndoLabel(null), 12_000);
      } else {
        // Flag changes are cheap to reflect locally.
        setMessages((ms) =>
          ms.map((m) =>
            ids.includes(m.id)
              ? {
                  ...m,
                  unread: action === "unread" ? true : action === "read" ? false : m.unread,
                  starred: action === "star" ? true : action === "unstar" ? false : m.starred,
                }
              : m,
          ),
        );
      }
      setPicked([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function runUndo(): Promise<void> {
    setUndoLabel(null);
    try {
      await undoRef.current.undo();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Move any message by id — used by drag-and-drop onto a folder. */
  async function moveMessage(id: string, dest: string): Promise<void> {
    try {
      const data = await api<{ folders: Folder[] }>(`/api/messages/${id}/move`, {
        method: "POST",
        body: JSON.stringify({ folder: dest }),
      });
      setFolders(data.folders);
      setMessages((ms) => ms.filter((m) => m.id !== id));
      if (selectedId === id) setSelectedId(null);
      setSendNote(`Moved to ${dest}.`);
      window.setTimeout(() => setSendNote(null), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Trust this sender's images from now on. */
  async function trustSenderImages(): Promise<void> {
    if (!selected) return;
    try {
      await api("/api/images/policy", {
        method: "POST",
        body: JSON.stringify({ trust: selected.from }),
      });
      const d = await api<{ html?: string | null; imagesOn?: boolean }>(
        `/api/messages/${selected.id}?images=1`,
      );
      setMailHtml(d.html ?? null);
      setImagesOn(true);
      setSendNote("Images from this sender will load from now on.");
      window.setTimeout(() => setSendNote(null), 2400);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function moveSelected(dest: string) {
    const current = selectedRef.current;
    if (!current) return;
    const data = await api<{ message: Message; folders: Folder[] }>(`/api/messages/${current.id}/move`, {
      method: "POST",
      body: JSON.stringify({ folder: dest }),
    });
    if (data.message) await applyMessage(data.message, data.folders);
  }

  async function unreadSelected() {
    const current = selectedRef.current;
    if (!current) return;
    const data = await api<{ message: Message }>(`/api/messages/${current.id}/unread`, { method: "POST" });
    if (data.message) await applyMessage(data.message);
  }

  async function replySelected() {
    const current = selectedRef.current;
    if (!current) return;
    const data = await api<{ message: Message; folders: Folder[] }>(`/api/messages/${current.id}/reply`, {
      method: "POST",
    });
    if (data.message) {
      setFolders(data.folders);
      setFolder("Drafts");
      setSelectedId(data.message.id);
      setDraft(data.message.body);
    }
  }

  async function forwardSelected() {
    const current = selectedRef.current;
    if (!current) return;
    const data = await api<{ message: Message; folders: Folder[] }>(`/api/messages/${current.id}/forward`, {
      method: "POST",
    });
    if (data.message) {
      setFolders(data.folders);
      setFolder("Drafts");
      setSelectedId(data.message.id);
      setDraft(data.message.body);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const current = selectedRef.current;
      const rows = visibleRef.current;
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setShowKeys((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        setShowKeys(false);
        setShowFolders(false);
        setShowSettings(false);
        setComposing(false);
        return;
      }
      if (e.key === "c") {
        e.preventDefault();
        setComposing(true);
      }
      if (e.key === "n") {
        e.preventDefault();
        const nxt = rows.find((m) => m.unread && m.id !== current?.id);
        if (nxt) setSelectedId(nxt.id);
      }
      if (!current) return;
      if (e.key === "s") {
        e.preventDefault();
        starSelected().catch((err: Error) => setError(err.message));
      }
      if (e.key === "e") {
        e.preventDefault();
        moveSelected("Archive").catch((err: Error) => setError(err.message));
      }
      if (e.key === "#") {
        e.preventDefault();
        moveSelected("Trash").catch((err: Error) => setError(err.message));
      }
      if (e.key === "u") {
        e.preventDefault();
        unreadSelected().catch((err: Error) => setError(err.message));
      }
      if (e.key === "r") {
        e.preventDefault();
        runSkill("draft-reply").catch((err: Error) => setError(err.message));
      }
      if (e.key === "!") {
        e.preventDefault();
        moveSelected("Spam").catch((err: Error) => setError(err.message));
      }
      if (e.key === "f") {
        e.preventDefault();
        forwardSelected().catch((err: Error) => setError(err.message));
      }
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const idx = rows.findIndex((m) => m.id === current.id);
        const next = e.key === "j" ? rows[idx + 1] : rows[idx - 1];
        if (next) setSelectedId(next.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function confirmSend() {
    setSendNote(null);
    try {
      const data = await api<{ confirmId?: string; sent?: boolean; message?: string; preview?: { to: string; subject: string } }>(
        "/api/send",
        {
          method: "POST",
          body: JSON.stringify({
            messageId: selectedId,
            draft,
            confirmId: pendingConfirm,
            // Paths only — the file bytes are read by the Rust CLI at send
            // time, so a large attachment never crosses localhost as JSON.
            attachments: attachFiles.map((f) => f.path),
          }),
        },
      );
      if (data.sent) {
        setPendingConfirm(null);
        setAttachFiles([]);
        setSendNote("Sent via SMTP.");
      } else if (data.confirmId) {
        setPendingConfirm(data.confirmId);
        setSendNote(
          `${data.message ?? "Confirm again to send."}${data.preview ? ` To ${data.preview.to}` : ""}`,
        );
      }
    } catch (e) {
      setSendNote(e instanceof Error ? e.message : String(e));
    }
  }

  const selectedProvider = providers.find((p) => p.id === providerId);

  async function saveAccount() {
    setAccountNote(null);
    try {
      const data = await api<{ account: SavedAccount; probe: string }>("/api/accounts", {
        method: "POST",
        body: JSON.stringify({
          provider: providerId,
          email,
          password,
          imap_host: imapHost || undefined,
        }),
      });
      setPassword("");
      setSavedAccounts((prev) => [...prev, data.account]);
      setAdding(false);
      setAccountNote(data.probe);
    } catch (e) {
      setAccountNote(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className={selected ? "shell has-mail" : "shell"}>
      {splash ? (
        <div className="splash" role="status">
          <span className="mark">Æ</span>
          <strong>Aether Mail</strong>
          <em>local · private</em>
        </div>
      ) : null}
      {showOnboard ? (
        <div className="onboard" role="dialog">
          <span className="mark">Æ</span>
          <strong>Add a mailbox</strong>
          <p>
            This is a client, not a host. Use an app password. The fixture inbox stays for practice.
          </p>
          <button
            type="button"
            onClick={() => {
              setShowOnboard(false);
              setShowSettings(true);
              try {
                localStorage.setItem("aether.onboarded", "1");
              } catch {
                /* ignore */
              }
            }}
          >
            Add Gmail / IMAP
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setShowOnboard(false);
              try {
                localStorage.setItem("aether.onboarded", "1");
              } catch {
                /* ignore */
              }
            }}
          >
            Use local fixture
          </button>
        </div>
      ) : null}
      <header className="topbar">
        <div className="brand">
          <span className="mark">Æ</span>
          <div>
            <strong>Aether Mail</strong>
            <em>{themeId === "retro" ? "night-olive · copper" : themeId === "modern" ? "slate · steel" : "filament"}</em>
          </div>
        </div>
        <button className="folders-toggle" type="button" onClick={() => setShowFolders((v) => !v)}>
          Folders
        </button>
        <input
          className="search"
          placeholder="Search this folder"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="toolbar">
          <button onClick={() => setComposing(true)}>New (c)</button>
          {savedAccounts[0] && activeAccountId !== "fixture" ? (
            <button
              disabled={!!busy}
              onClick={() => {
                const id = activeAccountId;
                setBusy("fetch");
                api<{ count: number }>(`/api/accounts/${id}/sync`, { method: "POST" })
                  .then((d) => {
                    setSendNote(`Fetched ${d.count} newest messages.`);
                    return refreshFolders().then(() => refreshMessages(folder));
                  })
                  .catch((e: Error) => setError(e.message))
                  .finally(() => setBusy(null));
              }}
            >
              {busy === "fetch" ? "Fetching…" : "Fetch INBOX"}
            </button>
          ) : null}
          <button disabled={!selected} onClick={() => starSelected().catch((e: Error) => setError(e.message))}>
            {selected?.starred ? "Unstar (s)" : "Star (s)"}
          </button>
          <button disabled={!selected} onClick={() => moveSelected("Archive").catch((e: Error) => setError(e.message))}>
            Archive (e)
          </button>
          <button disabled={!selected} onClick={() => moveSelected("Trash").catch((e: Error) => setError(e.message))}>
            Trash (#)
          </button>
          <select
            className="move-to"
            disabled={!selected}
            value=""
            onChange={(e) => {
              const dest = e.target.value;
              if (dest) moveSelected(dest).catch((err: Error) => setError(err.message));
            }}
          >
            <option value="">Move to…</option>
            {folders.filter((f) => f.name !== "Starred").map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
          <button disabled={!selected} onClick={() => replySelected().catch((e: Error) => setError(e.message))}>
            Reply
          </button>
          <button disabled={!selected} onClick={() => forwardSelected().catch((e: Error) => setError(e.message))}>
            Forward (f)
          </button>
          <button disabled={!selected} onClick={() => unreadSelected().catch((e: Error) => setError(e.message))}>
            Unread (u)
          </button>
          <button onClick={() => setUnreadOnly((v) => !v)}>{unreadOnly ? "All mail" : "Unread only"}</button>
          <button
            onClick={() =>
              setThreaded((v) => {
                const next = !v;
                try {
                  localStorage.setItem("aether.threaded", next ? "1" : "0");
                } catch {
                  /* ignore */
                }
                return next;
              })
            }
          >
            {threaded ? "Flat list" : "Conversations"}
          </button>
          <select
            className="move-to"
            value={sort}
            aria-label="Sort"
            onChange={(e) => {
              const next = e.target.value === "oldest" ? "oldest" : "newest";
              setSort(next);
              try {
                localStorage.setItem("aether.sort", next);
              } catch {
                /* ignore */
              }
            }}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          <button
            onClick={() => {
              api<{ folders: Folder[] }>("/api/folders/read", {
                method: "POST",
                body: JSON.stringify({ folder }),
              })
                .then((d) => {
                  setFolders(d.folders);
                  return refreshMessages(folder);
                })
                .catch((e: Error) => setError(e.message));
            }}
          >
            Mark folder read
          </button>
          <button type="button" onClick={() => setShowKeys(true)}>
            Keys (?)
          </button>
          <select
            className="move-to theme-pick"
            value={themeId}
            onChange={(e) => {
              const id = e.target.value as (typeof THEMES)[number]["id"];
              setThemeId(id);
              applyTheme(id);
            }}
            aria-label="Theme"
          >
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setShowTemplates(true)}>
            Templates
          </button>
          <button onClick={() => setShowSettings(true)}>Settings</button>
        </div>
      </header>

      <aside className={showFolders ? "folders open" : "folders"}>
        {/*
          First run: no real account yet. A new user otherwise lands on a
          demo mailbox with no indication that it is a demo, or where to go
          next — which reads as "this app came with someone else's mail".
        */}
        {savedAccounts.length === 0 && !adding ? (
          <div className="first-run">
            <strong>You're looking at a demo mailbox</strong>
            <p>
              Nothing here is real. Add your own account to see your mail — it stays on this
              machine, and your password goes to the system keyring, never to a file.
            </p>
            <button className="first-run-go" onClick={() => setAdding(true)}>
              Add your email account
            </button>
          </div>
        ) : null}
        <p className="acct">Accounts</p>
        <button
          type="button"
          className={activeAccountId === "fixture" ? "acct-line on" : "acct-line"}
          onClick={() => selectAccount("fixture")}
        >
          {savedAccounts.length === 0 ? "Demo mailbox" : "Local fixture"}
        </button>
        {savedAccounts.map((a) => (
          <button
            key={a.id}
            type="button"
            className={activeAccountId === a.id ? "acct-line on" : "acct-line"}
            onClick={() => selectAccount(a.id)}
          >
            {a.email}
          </button>
        ))}
        <button className="folder" onClick={() => setAdding((v) => !v)}>
          {adding ? "Close" : "Add account"}
        </button>
        {adding ? (
          <div className="add-acc">
            <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {selectedProvider ? <p className="hint">{selectedProvider.notes}</p> : null}
            <input placeholder="you@domain.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input
              type="password"
              placeholder="password or app password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
            />
            {providerId === "custom" ? (
              <input placeholder="imap.example.com" value={imapHost} onChange={(e) => setImapHost(e.target.value)} />
            ) : null}
            <button disabled={selectedProvider?.unsupported} onClick={saveAccount}>
              Save on this machine
            </button>
          </div>
        ) : null}
        {accountNote ? <p className="hint">{accountNote}</p> : null}
        <p className="acct">Folders</p>
        <button
          className="folder"
          onClick={() => {
            const name = window.prompt("New folder name");
            if (!name) return;
            api<{ folders: Folder[] }>("/api/folders", { method: "POST", body: JSON.stringify({ name }) })
              .then((d) => setFolders(d.folders))
              .catch((e: Error) => setError(e.message));
          }}
        >
          + New folder
        </button>
        {folders.map((f) => (
          <button
            key={f.name}
            className={`folder${f.name === folder ? " on" : ""}${
              dropFolder === f.name ? " drop" : ""
            }`}
            onContextMenu={(e) => {
              // Right-click to remove a folder you made. The server refuses
              // standard folders and anything still holding mail, so this can
              // only ever delete an empty custom folder.
              e.preventDefault();
              void removeFolder(f.name);
            }}
            onDragOver={(e) => {
              // Only a real message drag may drop here, and never onto the
              // folder it already lives in.
              if (!dragMsg || f.name === folder) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDropFolder(f.name);
            }}
            onDragLeave={() => setDropFolder((d) => (d === f.name ? null : d))}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain") || dragMsg;
              setDropFolder(null);
              setDragMsg(null);
              if (id) void moveMessage(id, f.name);
            }}
            onClick={() => {
              setFolder(f.name);
              setSelectedId(null);
              setAgent(null);
              setSendNote(null);
              setShowFolders(false);
            }}
          >
            <span className="fico" aria-hidden="true">
              {FOLDER_ICONS[f.name] ?? "◇"}
            </span>
            <span>{f.name}</span>
            <span className="counts">
              {f.unread > 0 ? <b>{f.unread}</b> : null}
              <i>{f.total}</i>
            </span>
          </button>
        ))}
        {/* Local destinations — not IMAP folders. These live only on this
            machine, so they are grouped below the mail folders. */}
        <div className="nav-sep" />
        <button
          className={folder === "Outbox" ? "folder on" : "folder"}
          onClick={() => {
            setFolder("Outbox");
            setSelectedId(null);
            setAgent(null);
            setShowFolders(false);
            void refreshOutbox();
          }}
        >
          <span className="fico" aria-hidden="true">
            ↗
          </span>
          <span>Outbox</span>
          <span className="counts">{outbox.length > 0 ? <b>{outbox.length}</b> : null}</span>
        </button>
        <button
          className={folder === "__calendar" ? "folder on" : "folder"}
          onClick={() => {
            setFolder("__calendar");
            setSelectedId(null);
            setAgent(null);
            setShowFolders(false);
            void refreshCalendar();
          }}
        >
          <span className="fico" aria-hidden="true">
            ▦
          </span>
          <span>Calendar</span>
          <span className="counts">{events.length > 0 ? <i>{events.length}</i> : null}</span>
        </button>
        <button
          className={folder === "__contacts" ? "folder on" : "folder"}
          onClick={() => {
            setFolder("__contacts");
            setSelectedId(null);
            setAgent(null);
            setShowFolders(false);
            void refreshContacts();
          }}
        >
          <span className="fico" aria-hidden="true">
            ◍
          </span>
          <span>Contacts</span>
          <span className="counts">{contacts.length > 0 ? <i>{contacts.length}</i> : null}</span>
        </button>
        {unifiedUseful ? (
          <button
            className={folder === "__unified" ? "folder on" : "folder"}
            onClick={() => {
              setFolder("__unified");
              setSelectedId(null);
              void refreshUnified();
            }}
          >
            <span className="fico" aria-hidden="true">⊞</span>
            <span>All inboxes</span>
            <span className="counts">
              {unified.filter((m) => m.unread).length > 0 ? (
                <b>{unified.filter((m) => m.unread).length}</b>
              ) : null}
              <i>{unified.length}</i>
            </span>
          </button>
        ) : null}
        <button
          className={folder === "__rules" ? "folder on" : "folder"}
          onClick={() => {
            setFolder("__rules");
            setSelectedId(null);
            void refreshRules();
            void loadSuggestions();
          }}
        >
          <span className="fico" aria-hidden="true">⚙</span>
          <span>Rules</span>
          {rules.length > 0 ? <span className="counts"><i>{rules.length}</i></span> : null}
        </button>
        <button
          className={folder === "__agent" ? "folder on" : "folder"}
          onClick={() => {
            setFolder("__agent");
            setSelectedId(null);
            setShowFolders(false);
          }}
        >
          <span className="fico" aria-hidden="true">
            ✦
          </span>
          <span>Assistant</span>
        </button>
      </aside>

      {/* Drag to widen the folder list. Keyboard-resizable too. */}
      <div
        className={`pane-grip grip-folders${dragging === "folders" ? " on" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize folder pane"
        aria-valuenow={panes.folders}
        aria-valuemin={PANE_LIMITS.folders.min}
        aria-valuemax={PANE_LIMITS.folders.max}
        tabIndex={0}
        onPointerDown={(e) => startPaneDrag("folders", e)}
        onDoubleClick={() => setPanes(resetPanes())}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") nudgePane("folders", -16);
          if (e.key === "ArrowRight") nudgePane("folders", 16);
        }}
      />

      <section className="list">
        {folder === "__unified" ? (
          <div className="unified">
            {unified.length === 0 ? (
              <p className="empty">Nothing in any inbox.</p>
            ) : (
              unified.map((m) => (
                <button
                  key={m.rowKey ?? m.id}
                  className={`row${m.id === selectedId ? " on" : ""}${m.unread ? " unread" : ""}`}
                  onClick={() => {
                    setSelectedId(m.id);
                    setAgent(null);
                  }}
                >
                  <span className="from">
                    {m.starred ? "★ " : ""}
                    {m.from.replace(/<[^>]+>/, "").trim()}
                  </span>
                  <span className="when">{formatWhen(m.date)}</span>
                  <span className="subj">{m.subject || "(no subject)"}</span>
                  {m.accountEmail ? <span className="acct-badge">{m.accountEmail}</span> : null}
                </button>
              ))
            )}
          </div>
        ) : folder === "__rules" ? (
          <div className="rules-page">
            <div className="rules-bar">
              <strong>Filing rules</strong>
              <button onClick={() => void runRules()}>Run on Inbox</button>
            </div>
            <p className="hint">
              Rules file, flag or mark read. They can never reply or forward — that is structural,
              not a setting.
            </p>
            {/*
              Suggestions computed from the folder itself, not generated by a
              model — counting senders is arithmetic. Domains you have written
              to are excluded, so a colleague who mails often is never offered
              up for filing.
            */}
            {suggestions.some((s) => !s.withheld) ? (
              <div className="suggests">
                <div className="suggests-head">
                  <strong>Noticed in your inbox</strong>
                  <span className="hint">
                    {suggestions.filter((s) => !s.withheld).reduce((n, s) => n + s.count, 0)}{" "}
                    messages from {suggestions.filter((s) => !s.withheld).length} senders
                  </span>
                </div>
                {suggestions
                  .filter((s) => !s.withheld)
                  .map((s) => (
                    <div className="suggest-row" key={s.match}>
                      <label className="suggest-what">
                        <input
                          type="checkbox"
                          checked={pickedSuggestions.includes(s.match)}
                          onChange={(e) =>
                            setPickedSuggestions((prev) =>
                              e.target.checked
                                ? [...prev, s.match]
                                : prev.filter((m) => m !== s.match),
                            )
                          }
                        />{" "}
                        <strong>{s.count}</strong> from <em>{s.label}</em>
                        {s.unread > 0 ? (
                          <span className="suggest-unread">{s.unread} unread</span>
                        ) : null}
                      </label>
                      <span className="suggest-act">
                        <button
                          onClick={() => void acceptSuggestion(s, "Archive")}
                          title={`File mail from ${s.match} into Archive`}
                        >
                          File to Archive
                        </button>
                        <button
                          className="ghost"
                          onClick={() =>
                            setSuggestions((prev) => prev.filter((p) => p.match !== s.match))
                          }
                          title="Not this one"
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  ))}
                {/*
                  Batch bar, only once something is ticked. Showing a disabled
                  "Apply 0" button would just be noise on every visit.
                */}
                {pickedSuggestions.length > 0 ? (
                  <div className="suggest-batch">
                    <button onClick={() => void acceptPicked()}>
                      File {pickedSuggestions.length} selected to Archive
                    </button>
                    <button className="ghost" onClick={() => setPickedSuggestions([])}>
                      Clear
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {/*
              Domains deliberately NOT offered. Shown without any action button
              — the whole point is that a blunt domain rule would bury mail the
              user must see, so there is nothing safe to click here.
            */}
            {suggestions.some((s) => s.withheld) ? (
              <div className="suggests held">
                <div className="suggests-head">
                  <strong>Not suggested, on purpose</strong>
                </div>
                {suggestions
                  .filter((s) => s.withheld)
                  .map((s) => (
                    <div className="suggest-row" key={s.match}>
                      <span className="suggest-what">
                        <strong>{s.count}</strong> from <em>{s.label}</em>
                        <span className="suggest-why">{s.reason}</span>
                      </span>
                    </div>
                  ))}
              </div>
            ) : null}
            {rules.length === 0 ? (
              <p className="empty">No rules yet. Add one in the right pane.</p>
            ) : (
              rules.map((r) => (
                <div className="rule-row" key={r.id}>
                  <span className="rule-what">
                    <strong>{r.field}</strong> contains <em>{r.contains}</em>
                  </span>
                  <span className="rule-then">
                    → {r.action === "move" ? `move to ${r.folder}` : r.action === "star" ? "flag" : "mark read"}
                  </span>
                  <button className="subtle-danger" onClick={() => void removeRule(r.id)}>
                    ✕
                  </button>
                </div>
              ))
            )}
            {ruleNote ? <p className="note">{ruleNote}</p> : null}
          </div>
        ) : folder === "__calendar" ? (
          <div className="calendar">
            <div className="cal-bar">
              <button className="cal-nav" onClick={() => setCalAnchor((d) => shift(calView, d, -1))}>
                ‹
              </button>
              <strong className="cal-title">{viewLabel(calView, calAnchor)}</strong>
              <button className="cal-nav" onClick={() => setCalAnchor((d) => shift(calView, d, 1))}>
                ›
              </button>
              <button className="cal-today" onClick={() => setCalAnchor(new Date())}>
                Today
              </button>
              <span className="cal-views">
                {(["month", "week", "day"] as CalView[]).map((v) => (
                  <button
                    key={v}
                    className={calView === v ? "on" : ""}
                    onClick={() => setCalView(v)}
                  >
                    {v[0].toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </span>
            </div>

            {calView === "month" ? (
              <div className="cal-month">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <span className="cal-dow" key={d}>
                    {d}
                  </span>
                ))}
                {monthGrid(calAnchor).map((cell) => {
                  const dayEvents = events.filter((e) => sameDay(new Date(e.start), cell.date));
                  const isToday = sameDay(cell.date, new Date());
                  const isPicked = sameDay(cell.date, calPicked);
                  return (
                    <button
                      key={cell.date.toISOString()}
                      className={`cal-cell${cell.inMonth ? "" : " dim"}${isToday ? " today" : ""}${
                        isPicked ? " picked" : ""
                      }`}
                      onClick={() => {
                        setCalPicked(cell.date);
                        setCalAnchor(cell.date);
                      }}
                    >
                      <span className="cal-num">{cell.date.getDate()}</span>
                      {dayEvents.slice(0, 3).map((e) => (
                        <span className="cal-chip" key={e.id} title={e.summary}>
                          {e.summary}
                        </span>
                      ))}
                      {dayEvents.length > 3 ? (
                        <span className="cal-more">+{dayEvents.length - 3} more</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : calView === "week" ? (
              <div className="cal-week">
                {weekDays(calAnchor).map((d) => {
                  const dayEvents = events.filter((e) => sameDay(new Date(e.start), d));
                  return (
                    <button
                      key={d.toISOString()}
                      className={`cal-col${sameDay(d, new Date()) ? " today" : ""}${
                        sameDay(d, calPicked) ? " picked" : ""
                      }`}
                      onClick={() => setCalPicked(d)}
                    >
                      <span className="cal-colhead">
                        <i>{d.toLocaleDateString(undefined, { weekday: "short" })}</i>
                        <b>{d.getDate()}</b>
                      </span>
                      {dayEvents.map((e) => (
                        <span className="cal-chip" key={e.id}>
                          {e.allDay
                            ? "all day"
                            : new Date(e.start).toLocaleTimeString(undefined, { timeStyle: "short" })}{" "}
                          {e.summary}
                        </span>
                      ))}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="cal-day">
                {events.filter((e) => sameDay(new Date(e.start), calAnchor)).length === 0 ? (
                  <p className="empty">Nothing on {dayLabel(calAnchor)}.</p>
                ) : (
                  events
                    .filter((e) => sameDay(new Date(e.start), calAnchor))
                    .map((e) => (
                      <button
                        key={e.id}
                        className={`cal-row${calSelected === e.id ? " on" : ""}`}
                        onClick={() => setCalSelected(e.id)}
                      >
                        <span className="cal-when">
                          <b>
                            {e.allDay
                              ? "All day"
                              : new Date(e.start).toLocaleTimeString(undefined, { timeStyle: "short" })}
                          </b>
                        </span>
                        <span className="cal-body">
                          <strong>{e.summary}</strong>
                          {e.location ? <span className="cal-where">📍 {e.location}</span> : null}
                        </span>
                      </button>
                    ))
                )}
              </div>
            )}

            {/* Agenda for the picked day, under the grid. */}
            <div className="cal-agenda">
              <strong>{dayLabel(calPicked)}</strong>
              {events.filter((e) => sameDay(new Date(e.start), calPicked)).length === 0 ? (
                <p className="hint">Nothing scheduled. Click Add event in the right pane.</p>
              ) : (
                events
                  .filter((e) => sameDay(new Date(e.start), calPicked))
                  .map((e) => (
                    <button
                      key={e.id}
                      className={`cal-row${calSelected === e.id ? " on" : ""}`}
                      onClick={() => setCalSelected(e.id)}
                    >
                      <span className="cal-when">
                        <b>
                          {e.allDay
                            ? "All day"
                            : new Date(e.start).toLocaleTimeString(undefined, { timeStyle: "short" })}
                        </b>
                      </span>
                      <span className="cal-body">
                        <strong>{e.summary}</strong>
                        {e.location ? <span className="cal-where">📍 {e.location}</span> : null}
                      </span>
                    </button>
                  ))
              )}
            </div>
          </div>
        ) : folder === "__contacts" ? (
          <div className="contacts-page">
            <div className="contacts-bar">
              <input
                placeholder="Search contacts"
                value={contactQuery}
                onChange={(e) => setContactQuery(e.target.value)}
              />
              <button
                className={contactsPeopleOnly ? "on" : ""}
                onClick={() => setContactsPeopleOnly((v) => !v)}
                title="Hide newsletters and no-reply senders"
              >
                {contactsPeopleOnly ? "People" : "Everyone"}
              </button>
            </div>
            {(() => {
              const q = contactQuery.trim().toLowerCase();
              const shown = contacts
                .filter((c) => (contactsPeopleOnly ? c.score > 0 : true))
                .filter(
                  (c) =>
                    !q || c.address.includes(q) || (c.name ?? "").toLowerCase().includes(q),
                );
              if (shown.length === 0) {
                return (
                  <p className="empty">
                    {contacts.length === 0
                      ? "No contacts yet. Sync some mail first."
                      : "Nothing matches. Try Everyone, or a different search."}
                  </p>
                );
              }
              return shown.map((c) => (
                <div className="contact-row" key={c.address}>
                  <span className="avatar" aria-hidden="true">
                    {(c.name || c.address).trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="contact-id">
                    <strong>{c.name || c.address.split("@")[0]}</strong>
                    <span>{c.address}</span>
                  </span>
                  <span className="contact-actions">
                    <button
                      onClick={() => {
                        setComposeTo(c.address);
                        setComposing(true);
                      }}
                    >
                      Write
                    </button>
                    <button
                      className="subtle-danger"
                      title="Remove from contacts"
                      onClick={() => void removeContact(c.address)}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              ));
            })()}
          </div>
        ) : folder === "Outbox" ? (
          <div className="outbox">
            {outbox.length === 0 ? (
              <p className="empty">
                Nothing waiting. Mail you schedule with “Send later” waits here — it goes out even if
                you close the app.
              </p>
            ) : (
              outbox.map((item) => (
                <div className={`queued ${item.status}`} key={item.id}>
                  <span className="q-to">{item.to}</span>
                  <span className="q-subj">{item.subject || "(no subject)"}</span>
                  <span className="q-when">
                    {item.status === "failed"
                      ? `Failed — ${item.error ?? "unknown"} (tried ${item.attempts}×)`
                      : item.sendAt
                        ? `Goes out ${new Date(item.sendAt).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}`
                        : "Sending shortly"}
                  </span>
                  <span className="q-actions">
                    {item.status === "failed" ? (
                      <button onClick={() => void retryQueued(item.id)}>Retry</button>
                    ) : null}
                    <button onClick={() => void cancelQueued(item.id)}>Cancel</button>
                  </span>
                </div>
              ))
            )}
          </div>
        ) : folder === "__agent" ? (
          <p className="empty">
            The assistant reads your mail to answer, drafts replies, and can explain a thread. It can
            never send or delete — that is always your click.
          </p>
        ) : (
          <>
            {visible.map((m) => (
          <button
            key={m.id}
            className={`row${m.id === selectedId ? " on" : ""}${m.unread ? " unread" : ""}${
              dragMsg === m.id ? " dragging" : ""
            }${picked.includes(m.id) ? " picked" : ""}`}
            draggable
            onContextMenu={(e) => {
              e.preventDefault();
              // Right-clicking outside the selection targets just that row.
              if (!picked.includes(m.id)) setPicked([m.id]);
              setMenu({ x: e.clientX, y: e.clientY, id: m.id });
            }}
            onDragStart={(e) => {
              setDragMsg(m.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", m.id);
            }}
            onDragEnd={() => {
              setDragMsg(null);
              setDropFolder(null);
            }}
            onClick={(e) => {
              // Ctrl/Cmd toggles one row; Shift extends from the anchor.
              if (e.ctrlKey || e.metaKey) {
                setPicked((p) => toggleSelection(p, m.id));
                setAnchorId(m.id);
                return;
              }
              if (e.shiftKey && anchorId) {
                setPicked(rangeSelection(visible.map((v) => v.id), anchorId, m.id));
                return;
              }
              setPicked([]);
              setAnchorId(m.id);
              setSelectedId(m.id);
              setAgent(null);
              setSendNote(null);
              setDraft("");
            }}
          >
            <span className="from">
              {m.starred ? "★ " : ""}
              {m.threadCount && m.threadCount > 1 && m.participants?.length
                ? m.participants.map((p) => p.split("@")[0]).join(", ")
                : m.from.replace(/<[^>]+>/, "").trim()}
              {m.threadCount && m.threadCount > 1 ? (
                <span className="thread-count" title={`${m.threadCount} messages`}>
                  {m.threadCount}
                </span>
              ) : null}
            </span>
            <span className="subj">
              {m.attachmentCount ? (
                <span className="clip" title={`${m.attachmentCount} attachment(s)`} aria-label="has attachments">
                  📎{" "}
                </span>
              ) : null}
              {m.subject}
            </span>
            <span className="when">{formatWhen(m.date)}</span>
            {m.preview ? <span className="peek">{m.preview}</span> : null}
          </button>
        ))}
        {visible.length === 0 ? <p className="empty">{unreadOnly ? "No unread in this folder." : "No messages."}</p> : null}
          </>
        )}
      </section>

      {/* Drag to widen the message list — double-click either grip to reset. */}
      <div
        className={`pane-grip grip-list${dragging === "list" ? " on" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize message list"
        aria-valuenow={panes.list}
        aria-valuemin={PANE_LIMITS.list.min}
        aria-valuemax={PANE_LIMITS.list.max}
        tabIndex={0}
        onPointerDown={(e) => startPaneDrag("list", e)}
        onDoubleClick={() => setPanes(resetPanes())}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") nudgePane("list", -16);
          if (e.key === "ArrowRight") nudgePane("list", 16);
        }}
      />

      <main className="read">
        {folder === "__rules" ? (
          <div className="cal-detail">
            <h1>New rule</h1>
            <p className="hint">
              When a message matches, do one thing to it. First matching rule wins.
            </p>
            <form
              className="cal-new"
              onSubmit={(e) => {
                e.preventDefault();
                void addRule();
              }}
            >
              <label>
                When the
                <select value={ruleField} onChange={(e) => setRuleField(e.target.value as typeof ruleField)}>
                  <option value="from">sender</option>
                  <option value="to">recipient</option>
                  <option value="subject">subject</option>
                </select>
              </label>
              <label>
                contains
                <input
                  placeholder="newsletter@example.com"
                  value={ruleText}
                  onChange={(e) => setRuleText(e.target.value)}
                />
              </label>
              <label>
                then
                <select value={ruleAction} onChange={(e) => setRuleAction(e.target.value as typeof ruleAction)}>
                  <option value="move">move it to</option>
                  <option value="star">flag it</option>
                  <option value="read">mark it read</option>
                </select>
              </label>
              {ruleAction === "move" ? (
                <label>
                  folder
                  <select value={ruleFolder} onChange={(e) => setRuleFolder(e.target.value)}>
                    {folders.map((f) => (
                      <option key={f.name} value={f.name}>
                        {f.name}
                      </option>
                    ))}
                    <option value="Archive">Archive</option>
                  </select>
                </label>
              ) : null}
              <button type="submit">Add rule</button>
              {ruleNote ? <p className="note">{ruleNote}</p> : null}
            </form>
          </div>
        ) : folder === "__calendar" ? (
          <div className="cal-detail">
            {(() => {
              const ev = events.find((e) => e.id === calSelected);
              if (ev) {
                return (
                  <>
                    <h1>{ev.summary}</h1>
                    <p className="cal-detail-when">
                      {new Date(ev.start).toLocaleDateString(undefined, { dateStyle: "full" })}
                      <br />
                      {ev.allDay
                        ? "All day"
                        : `${new Date(ev.start).toLocaleTimeString(undefined, { timeStyle: "short" })}${
                            ev.end
                              ? ` – ${new Date(ev.end).toLocaleTimeString(undefined, { timeStyle: "short" })}`
                              : ""
                          }`}
                    </p>
                    {ev.location ? <p className="hint">📍 {ev.location}</p> : null}
                    {ev.organizer ? <p className="hint">Organizer · {ev.organizer}</p> : null}
                    {ev.attendees && ev.attendees.length > 0 ? (
                      <p className="hint">{ev.attendees.join(", ")}</p>
                    ) : null}
                    {ev.description ? <p className="cal-desc">{ev.description}</p> : null}
                    <div className="msg-actions">
                      <button
                        className="subtle-danger"
                        onClick={() => {
                          setCalSelected(null);
                          void removeEvent(ev.id);
                        }}
                      >
                        🗑 Delete event
                      </button>
                      <button onClick={() => setCalSelected(null)}>Close</button>
                    </div>
                  </>
                );
              }
              return (
                <form
                  className="cal-new"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void addEvent();
                  }}
                >
                  <h1>New event</h1>
                  <p className="hint">On {dayLabel(calPicked)}. Pick another day in the grid to change it.</p>
                  <label>
                    What
                    <input
                      placeholder="Design review"
                      value={evTitle}
                      onChange={(e) => setEvTitle(e.target.value)}
                    />
                  </label>
                  <label>
                    When
                    <input type="time" value={evWhen} onChange={(e) => setEvWhen(e.target.value)} />
                  </label>
                  <label>
                    Where
                    <input
                      placeholder="Optional"
                      value={evWhere}
                      onChange={(e) => setEvWhere(e.target.value)}
                    />
                  </label>
                  <button type="submit">Add event</button>
                  {calNote ? <p className="note">{calNote}</p> : null}
                </form>
              );
            })()}
          </div>
        ) : folder === "__agent" ? (
          <div className="agent-page">
            <h1>✦ Assistant</h1>
            <p className="hint">
              Ask about your mail without opening a message. Runs on your own key or a local model —
              nothing leaves this machine unless you configured a hosted one.
            </p>
            <AgentChat messageId={null} onStoreChange={() => void refreshFolders()} />
          </div>
        ) : !selected ? (
          <>
            <p className="empty tall">Select a message. Chat still works on whatever you open next.</p>
            <AgentChat messageId={null} onStoreChange={() => void refreshFolders()} />
          </>
        ) : (
          <>
            <div className="headers">
              <button className="back-phone" onClick={() => setSelectedId(null)}>
                ← Inbox
              </button>
              <h1>{selected.subject}</h1>
              <p>
                <b>From</b> {selected.from}
              </p>
              <p>
                <b>To</b> {selected.to}
              </p>
              <p>
                <b>Date</b> {formatWhen(selected.date)}
              </p>
              {/*
                The rest of the thread, oldest first — the order it happened
                in, which is deliberately the opposite of the list (newest
                first), because here you are reading rather than scanning.
                Only shown when there is more than one message.
              */}
              {convo.length > 1 ? (
                <div className="convo">
                  <div className="convo-head">
                    {convo.length} messages in this conversation
                  </div>
                  {convo.map((c) => (
                    <button
                      key={c.id}
                      className={`convo-row${c.id === selectedId ? " on" : ""}${
                        c.unread ? " unread" : ""
                      }`}
                      onClick={() => setSelectedId(c.id)}
                      title={c.subject}
                    >
                      <span className="convo-from">{c.from}</span>
                      <span className="convo-when">{formatWhen(c.date)}</span>
                      {c.preview ? <span className="convo-peek">{c.preview}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="msg-actions">
                <button onClick={() => openMessageWindow()} title="Open in a separate window">
                  ⧉ Pop out
                </button>
                <button onClick={() => void startCompose("reply")}>↩ Reply</button>
                <button onClick={() => void startCompose("all")}>↩↩ Reply all</button>
                <button onClick={() => void startCompose("forward")}>↪ Forward</button>
                {/*
                  Only shown when the sender advertised a safe https
                  unsubscribe. A mailto-only sender is deliberately not
                  offered here — that would mean sending mail.
                */}
                {unsub?.available && unsub.method === "web" ? (
                  <button onClick={() => void doUnsubscribe()} title={`Unsubscribe from ${unsub.fromDomain ?? "this sender"}`}>
                    ⊘ Unsubscribe
                  </button>
                ) : null}
                <button onClick={() => void deleteSelected()} className="subtle-danger">
                  🗑 Delete
                </button>
              </div>
            </div>
            {invite ? (
              <div className={`invite${invite.method === "CANCEL" ? " cancelled" : ""}`}>
                <span className="inv-kind">
                  {invite.method === "CANCEL" ? "Meeting cancelled" : "Calendar invite"}
                </span>
                <strong className="inv-title">{invite.summary || "(no title)"}</strong>
                <span className="inv-when">{inviteWhen(invite)}</span>
                {invite.location ? <span className="inv-where">📍 {invite.location}</span> : null}
                {invite.organizer ? <span className="inv-who">Organizer · {invite.organizer}</span> : null}
                {invite.attendees.length > 0 ? (
                  <span className="inv-who">
                    {invite.attendees.length} attendee{invite.attendees.length === 1 ? "" : "s"}
                  </span>
                ) : null}
                {invite.method !== "CANCEL" ? (
                  <span className="inv-actions">
                    <button className="inv-add" onClick={() => void saveInviteToCalendar()}>
                      Add to Aether calendar
                    </button>
                    <button className="inv-alt" onClick={() => void addToCalendar()}>
                      Download .ics
                    </button>
                  </span>
                ) : null}
              </div>
            ) : null}
            {threat ? (
              <p className={`threat ${threat.label}`}>
                Threat {threat.score}/100 · {threat.label}
                {threat.reasons[0] ? ` · ${threat.reasons[0]}` : ""}
                {threat.label === "danger" ? (
                  <button className="inline" onClick={() => moveSelected("Spam").catch((e: Error) => setError(e.message))}>
                    Move to Spam
                  </button>
                ) : null}
                <button className="inline" type="button" onClick={() => setShowInspect((v) => !v)}>
                  {showInspect ? "Hide headers" : "Inspect headers"}
                </button>
              </p>
            ) : (
              <p className="threat ok">
                <button className="inline" type="button" onClick={() => setShowInspect((v) => !v)}>
                  Inspect headers
                </button>
              </p>
            )}
            {showInspect ? (
              <pre className="inspect">
                {inspect
                  ? [
                      `spf=${inspect.spf}  dkim=${inspect.dkim}  dmarc=${inspect.dmarc}  hops=${inspect.receivedHops}`,
                      inspect.fromDomain ? `From ${inspect.fromDomain}` : "From domain unknown",
                      inspect.returnPathDomain ? `Return-Path ${inspect.returnPathDomain}` : "No Return-Path",
                      ...(inspect.findings.length ? inspect.findings : ["No header mismatches."]),
                    ].join("\n")
                  : "No stored headers. Fetch INBOX again to keep Return-Path / Auth-Results."}
              </pre>
            ) : null}
            {attachments.length > 0 ? (
              <div className="attachments">
                <span className="attachments-label">
                  {attachments.length} attachment{attachments.length === 1 ? "" : "s"}
                </span>
                {attachments.map((a) => (
                  <span className="attachment-pair" key={a.part}>
                    {/*
                      A View button only when the server said the type is
                      safe to render. Download stays available for everything,
                      so an unpreviewable file is never a dead end.
                    */}
                    {a.preview && a.preview !== "none" ? (
                      <button
                        className="attachment view"
                        onClick={() => setPreviewPart(previewPart === a.part ? null : a.part)}
                        title={`View ${a.filename} without downloading`}
                      >
                        <span className="attachment-name">
                          {previewPart === a.part ? "▾ " : "▸ "}
                          {a.filename}
                        </span>
                        <span className="attachment-size">{a.human}</span>
                      </button>
                    ) : (
                      <a
                        className="attachment"
                        href={apiUrl(`/api/messages/${encodeURIComponent(selectedId ?? "")}/parts/${a.part}`)}
                        download={a.filename}
                        title={`${a.mimeType} · ${a.human}`}
                      >
                        <span className="attachment-name">{a.filename}</span>
                        <span className="attachment-size">{a.human}</span>
                      </a>
                    )}
                    {a.preview && a.preview !== "none" ? (
                      <a
                        className="attachment save"
                        href={apiUrl(`/api/messages/${encodeURIComponent(selectedId ?? "")}/parts/${a.part}`)}
                        download={a.filename}
                        title={`Save ${a.filename}`}
                      >
                        ⭳
                      </a>
                    ) : null}
                  </span>
                ))}
              </div>
            ) : null}
            {/*
              The preview itself, sandboxed exactly like mail HTML.
              `sandbox` with no allow-* tokens means no scripts, no forms, no
              same-origin — an attachment is a file from a stranger, so it gets
              the same treatment as a mail body regardless of its type.
            */}
            {previewPart !== null && selectedId ? (
              <div className="attach-preview">
                <iframe
                  title="Attachment preview"
                  className="attach-frame"
                  sandbox=""
                  referrerPolicy="no-referrer"
                  src={apiUrl(
                    `/api/messages/${encodeURIComponent(selectedId)}/parts/${previewPart}?preview=1`,
                  )}
                />
              </div>
            ) : null}
            {remoteImages > 0 ? (
              <p className="hint">
                {imagesOn
                  ? `${remoteImages} remote image(s) loading in a sandbox (trackers can still see your IP).`
                  : `${remoteImages} remote image(s) blocked — trackers stay dark.`}{" "}
                <button
                  type="button"
                  className="inline"
                  onClick={() => {
                    if (!selectedId) return;
                    api<{ html?: string | null; imagesOn?: boolean }>(
                      `/api/messages/${selectedId}?images=${imagesOn ? "0" : "1"}`,
                    )
                      .then((d) => {
                        setMailHtml(d.html ?? null);
                        setImagesOn(Boolean(d.imagesOn));
                      })
                      .catch((e: Error) => setError(e.message));
                  }}
                >
                  {imagesOn ? "Hide images" : "Load images"}
                </button>
                {!imagesOn ? (
                  <button
                    type="button"
                    className="inline"
                    onClick={() => void trustSenderImages()}
                    title="Remember this sender and stop asking"
                  >
                    Always from this sender
                  </button>
                ) : null}
              </p>
            ) : selected.hiddenMedia ? (
              <p className="hint">
                {selected.hiddenMedia} image(s) not shown. Fetch INBOX again to keep HTML for the sandbox.
              </p>
            ) : null}
            {mailHtml ? (
              <iframe
                className="mail-frame"
                title="Message"
                // Locked down: no scripts, no forms, no same-origin. Mail is
                // hostile input. This is why the height has to be measured
                // from out here rather than reported by the page itself.
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={mailHtml}
                onLoad={(e) => fitMailFrame(e.currentTarget)}
              />
            ) : (
              <pre className="body">{selected.body}</pre>
            )}

            <section className="agent">
              <header>
                <strong>Aether</strong>
                <span>local model · cannot send for you</span>
                <div className="actions">
                  <button disabled={!!busy} onClick={() => runSkill("summarize")}>
                    {busy === "summarize" ? "Summarizing…" : "Summarize"}
                  </button>
                  <button disabled={!!busy} onClick={() => runSkill("draft-reply")}>
                    {busy === "draft-reply" ? "Drafting…" : "Draft reply"}
                  </button>
                  <button disabled={!!busy} onClick={() => runSkill("triage")}>
                    {busy === "triage" ? "Triaging…" : "Triage"}
                  </button>
                  <button disabled={!!busy} onClick={() => runSkill("action-items")}>
                    {busy === "action-items" ? "Extracting…" : "Action items"}
                  </button>
                  {/*
                    Propose an automation. The model returns a structured
                    suggestion; nothing happens until the user clicks Create.
                  */}
                  <button disabled={!!busy} onClick={() => void proposeAutomation()}>
                    {busy === "propose" ? "Thinking…" : "⚡ Automate this"}
                  </button>
                </div>
              </header>
              {proposal ? (
                <div className="proposal">
                  <strong>Suggested automation</strong>
                  <p className="proposal-what">{proposal.describe}</p>
                  {proposal.note ? <p className="hint">{proposal.note}</p> : null}
                  <div className="proposal-actions">
                    <button
                      onClick={() => {
                        void api("/api/agent/approve", {
                          method: "POST",
                          body: JSON.stringify({ proposal: proposal.proposal }),
                        })
                          .then(() => {
                            setProposal(null);
                            setRuleNote("Created. Find it under Rules.");
                            void refreshRules();
                          })
                          .catch((e: Error) => setRuleNote(e.message));
                      }}
                    >
                      Create it
                    </button>
                    <button className="subtle" onClick={() => setProposal(null)}>
                      No thanks
                    </button>
                  </div>
                </div>
              ) : null}
              {agent ? (
                <div className="transcript">
                  {agent.refused.map((r) => (
                    <p key={r} className="refuse">
                      {r}
                    </p>
                  ))}
                  <pre>{agent.text}</pre>
                  <p className="meta">
                    {agent.model} · {agent.proposedActions.map((a) => a.label).join(" · ")}
                  </p>
                  <div className="actions">
                    {agent.proposedActions.some((a) => a.type === "propose-star") ? (
                      <button onClick={() => starSelected().catch((e: Error) => setError(e.message))}>Apply star</button>
                    ) : null}
                    {agent.proposedActions.some((a) => a.type === "propose-archive") ? (
                      <button onClick={() => moveSelected("Archive").catch((e: Error) => setError(e.message))}>
                        Apply archive
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="hint">Open only if you want help. Summarize or draft — you still hit send.</p>
              )}
              <label>
                Compose
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={8} />
              </label>
              <div className="sendrow">
                <button
                  className="danger"
                  disabled={!draft.trim() && selected.folder !== "Drafts"}
                  onClick={confirmSend}
                >
                  Confirm send…
                </button>
                {sendNote ? <span className="note">{sendNote}</span> : null}
              </div>
            </section>
            <AgentChat messageId={selected.id} onStoreChange={() => void refreshFolders()} />
          </>
        )}
        {error ? <p className="error">{error}</p> : null}
      </main>
      {composing ? (
        <div className="compose">
          <strong>New message</strong>
          <div className="to-field">
            <input
              placeholder="To"
              value={composeTo}
              onChange={(e) => {
                setComposeTo(e.target.value);
                void lookupContacts(e.target.value);
              }}
              onBlur={() => window.setTimeout(() => setContactHits([]), 150)}
            />
            {contactHits.length > 0 ? (
              <div className="contact-hits">
                {contactHits.map((c) => (
                  <button
                    type="button"
                    key={c.address}
                    onMouseDown={(e) => {
                      // mousedown, not click: blur would close the list first.
                      e.preventDefault();
                      const parts = composeTo.split(",");
                      parts[parts.length - 1] = ` ${c.address}`;
                      setComposeTo(parts.join(",").replace(/^\s+/, ""));
                      setContactHits([]);
                    }}
                  >
                    {c.name ? <b>{c.name}</b> : null}
                    <span>{c.address}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <input placeholder="Subject" value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} />
          {/*
            Formatting toolbar. execCommand is deprecated but is still the only
            thing every engine implements for contenteditable, and the output
            is sanitized server-side at prepare regardless of what it emits.
          */}
          <div className="fmt-bar">
            <button type="button" title="Bold" onMouseDown={(e) => { e.preventDefault(); document.execCommand("bold"); }}>
              <b>B</b>
            </button>
            <button type="button" title="Italic" onMouseDown={(e) => { e.preventDefault(); document.execCommand("italic"); }}>
              <i>I</i>
            </button>
            <button type="button" title="Underline" onMouseDown={(e) => { e.preventDefault(); document.execCommand("underline"); }}>
              <u>U</u>
            </button>
            <span className="fmt-sep" />
            <button type="button" title="Bullet list" onMouseDown={(e) => { e.preventDefault(); document.execCommand("insertUnorderedList"); }}>
              •—
            </button>
            <button type="button" title="Numbered list" onMouseDown={(e) => { e.preventDefault(); document.execCommand("insertOrderedList"); }}>
              1.
            </button>
            <span className="fmt-sep" />
            <button
              type="button"
              title="Add a link"
              onMouseDown={(e) => {
                e.preventDefault();
                const url = window.prompt("Link to:");
                if (url && /^https?:\/\//i.test(url)) document.execCommand("createLink", false, url);
              }}
            >
              🔗
            </button>
            <button
              type="button"
              title="Remove formatting"
              onMouseDown={(e) => { e.preventDefault(); document.execCommand("removeFormat"); }}
            >
              ⌫
            </button>
          </div>
          <div
            className="compose-body"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Message body"
            ref={composeRef}
            onInput={(e) => {
              const el = e.currentTarget;
              setComposeHtml(el.innerHTML);
              setComposeBody(el.innerText);
            }}
          />
          {attachFiles.length > 0 ? (
            <div className="attach-list">
              {attachFiles.map((f) => (
                <span className="attach-chip" key={f.path} title={f.path}>
                  📎 {f.name} <span className="attach-size">{humanSize(f.size)}</span>
                  <button
                    type="button"
                    className="attach-x"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setAttachFiles((prev) => prev.filter((x) => x.path !== f.path))}
                  >
                    ×
                  </button>
                </span>
              ))}
              <span className="attach-total">{humanSize(attachFiles.reduce((n, f) => n + f.size, 0))} total</span>
            </div>
          ) : null}
          <div className="sendrow">
            <button onClick={() => void pickAttachments()}>📎 Attach</button>
            <button onClick={() => saveDraft()}>Save draft</button>
            <label className="schedule">
              <span>Send later</span>
              <input
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => {
                  setScheduleAt(e.target.value);
                  // Changing when it goes out invalidates any pending confirm.
                  setComposeConfirm(null);
                }}
              />
            </label>
            <button
              className="danger"
              disabled={!composeTo.trim() || !composeBody.trim()}
              onClick={() => void sendCompose()}
            >
              {composeConfirm
                ? scheduleAt
                  ? "Confirm — queue it"
                  : "Confirm send — click to deliver"
                : scheduleAt
                  ? "Schedule…"
                  : "Send…"}
            </button>
            <button
              onClick={() => {
                setComposing(false);
                setComposeConfirm(null);
                setComposeNote(null);
              }}
            >
              Cancel
            </button>
          </div>
          {composeNote ? <p className="note">{composeNote}</p> : null}
        </div>
      ) : null}
      {showSettings ? <Settings onClose={() => setShowSettings(false)} /> : null}
      {showTemplates ? (
        <Templates
          onClose={() => setShowTemplates(false)}
          onUse={(subject, body) => {
            setComposeSubject(subject);
            setComposeBody(body);
            setComposing(true);
            setShowTemplates(false);
          }}
        />
      ) : null}
      {showKeys ? (
        <div className="keys" role="dialog" aria-label="Keyboard shortcuts">
          <strong>Keyboard shortcuts</strong>
          <div className="key-grid">
            <span className="key-sec">Reading</span>
            <span><kbd>j</kbd> <kbd>k</kbd> next / previous</span>
            <span><kbd>n</kbd> next unread</span>
            <span><kbd>u</kbd> mark unread</span>
            <span><kbd>s</kbd> flag</span>
            <span className="key-sec">Filing</span>
            <span><kbd>e</kbd> archive</span>
            <span><kbd>#</kbd> trash</span>
            <span><kbd>!</kbd> spam</span>
            <span>drag a row onto a folder</span>
            <span className="key-sec">Writing</span>
            <span><kbd>c</kbd> compose</span>
            <span><kbd>r</kbd> reply draft</span>
            <span><kbd>f</kbd> forward</span>
            <span className="key-sec">Selecting</span>
            <span><kbd>ctrl</kbd>+click one row</span>
            <span><kbd>shift</kbd>+click a range</span>
            <span>right-click for actions</span>
            <span className="key-sec">Panels</span>
            <span>drag a divider to resize</span>
            <span>double-click it to reset</span>
            <span><kbd>?</kbd> this list · <kbd>Esc</kbd> close</span>
          </div>
          <button type="button" onClick={() => setShowKeys(false)}>
            Close
          </button>
        </div>
      ) : null}
      <footer className="statusbar">
        <span className="sb-unread">{unreadTotal} unread</span>
        <span className="sb-sync">
          {busy === "fetch"
            ? "Fetching newest 40 from IMAP…"
            : lastFetchAt
              ? `Last fetch ${lastFetchAt.slice(11, 16)} UTC`
              : "Fixture only — no live fetch yet"}
        </span>
        <span className="sb-agent">{busy === "fetch" ? "IMAP" : busy ? `working: ${busy}` : "idle"}</span>
      </footer>

      {/* Right-click menu. Closes on any click elsewhere or Escape. */}
      {menu ? (
        <>
          <div className="menu-veil" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
            <span className="ctx-head">
              {picked.length > 1 ? `${picked.length} messages` : "Message"}
            </span>
            <button onClick={() => { void bulkAction(picked, "read"); setMenu(null); }}>
              Mark read
            </button>
            <button onClick={() => { void bulkAction(picked, "unread"); setMenu(null); }}>
              Mark unread
            </button>
            <button onClick={() => { void bulkAction(picked, "star"); setMenu(null); }}>
              ★ Flag
            </button>
            <button onClick={() => { void bulkAction(picked, "unstar"); setMenu(null); }}>
              Unflag
            </button>
            <button onClick={() => { void muteThread(); setMenu(null); }}>
              🔕 Mute thread
            </button>
            <div className="ctx-sep" />
            <span className="ctx-head">Snooze until</span>
            <button onClick={() => { void snooze(picked, "later"); setMenu(null); }}>
              ⏰ Later today
            </button>
            <button onClick={() => { void snooze(picked, "tomorrow"); setMenu(null); }}>
              ⏰ Tomorrow 8am
            </button>
            <button onClick={() => { void snooze(picked, "weekend"); setMenu(null); }}>
              ⏰ This weekend
            </button>
            <button onClick={() => { void snooze(picked, "week"); setMenu(null); }}>
              ⏰ Next week
            </button>
            <div className="ctx-sep" />
            {folders
              .filter((f) => f.name !== folder)
              .slice(0, 6)
              .map((f) => (
                <button key={f.name} onClick={() => { void bulkAction(picked, "move", f.name); setMenu(null); }}>
                  Move to {f.name}
                </button>
              ))}
            <div className="ctx-sep" />
            <button
              className="danger"
              onClick={() => { void bulkAction(picked, "move", "Trash"); setMenu(null); }}
            >
              🗑 Delete
            </button>
          </div>
        </>
      ) : null}

      {/* Selection bar — appears only when more than one row is picked. */}
      {picked.length > 1 ? (
        <div className="selbar">
          <strong>{picked.length} selected</strong>
          <button onClick={() => void bulkAction(picked, "read")}>Mark read</button>
          <button onClick={() => void bulkAction(picked, "star")}>★ Flag</button>
          <button onClick={() => void bulkAction(picked, "move", "Archive")}>Archive</button>
          <button className="subtle-danger" onClick={() => void bulkAction(picked, "move", "Trash")}>
            🗑 Delete
          </button>
          <button onClick={() => setPicked([])}>Clear</button>
        </div>
      ) : null}

      {/* Undo toast for the last destructive action. */}
      {undoLabel ? (
        <div className="undo-toast">
          <span>{undoLabel}</span>
          <button onClick={() => void runUndo()}>Undo</button>
        </div>
      ) : null}
    </div>
  );
}
