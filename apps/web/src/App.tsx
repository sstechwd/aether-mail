import { useEffect, useRef, useState } from "react";
import { apiUrl } from "./apibase.js";
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
    Array<{ part: number; filename: string; mimeType: string; size: number; human: string }>
  >([]);
  const [imagesOn, setImagesOn] = useState(false);
  const [lastFetchAt, setLastFetchAt] = useState<string | null>(null);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
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

  async function refreshFolders() {
    const data = await api<{ folders: Folder[] }>("/api/folders");
    setFolders(data.folders);
  }

  async function refreshMessages(nextFolder: string) {
    const data = await api<{ messages: Message[]; account?: string }>(
      `/api/messages?folder=${encodeURIComponent(nextFolder)}&sort=${sort}`,
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
  }, [folder, sort]);

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
      }>;
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
        body: JSON.stringify({ to: composeTo, subject: composeSubject, body: composeBody }),
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
        <p className="acct">Accounts</p>
        <button
          type="button"
          className={activeAccountId === "fixture" ? "acct-line on" : "acct-line"}
          onClick={() => selectAccount("fixture")}
        >
          Local fixture
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
            className={f.name === folder ? "folder on" : "folder"}
            onClick={() => {
              setFolder(f.name);
              setSelectedId(null);
              setAgent(null);
              setSendNote(null);
              setShowFolders(false);
            }}
          >
            <span>{f.name}</span>
            <span className="counts">
              {f.unread > 0 ? <b>{f.unread}</b> : null}
              <i>{f.total}</i>
            </span>
          </button>
        ))}
        {/* Outbox is local, not an IMAP folder — it only exists on this machine
            until the queue drains, so it is listed separately. */}
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
          <span>Outbox</span>
          <span className="counts">{outbox.length > 0 ? <b>{outbox.length}</b> : null}</span>
        </button>
        <button
          className={folder === "__agent" ? "folder on" : "folder"}
          onClick={() => {
            setFolder("__agent");
            setSelectedId(null);
            setShowFolders(false);
          }}
        >
          <span>✦ Assistant</span>
        </button>
      </aside>

      <section className="list">
        {folder === "Outbox" ? (
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
            className={`row${m.id === selectedId ? " on" : ""}${m.unread ? " unread" : ""}`}
            onClick={() => {
              setSelectedId(m.id);
              setAgent(null);
              setSendNote(null);
              setDraft("");
            }}
          >
            <span className="from">
              {m.starred ? "★ " : ""}
              {m.from.replace(/<[^>]+>/, "").trim()}
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

      <main className="read">
        {folder === "__agent" ? (
          <div className="agent-page">
            <h1>✦ Assistant</h1>
            <p className="hint">
              Ask about your mail without opening a message. Runs on your own key or a local model —
              nothing leaves this machine unless you configured a hosted one.
            </p>
            <AgentChat messageId={null} />
          </div>
        ) : !selected ? (
          <>
            <p className="empty tall">Select a message. Chat still works on whatever you open next.</p>
            <AgentChat messageId={null} />
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
              <div className="msg-actions">
                <button onClick={() => void startCompose("reply")}>↩ Reply</button>
                <button onClick={() => void startCompose("all")}>↩↩ Reply all</button>
                <button onClick={() => void startCompose("forward")}>↪ Forward</button>
                <button onClick={() => void deleteSelected()} className="subtle-danger">
                  🗑 Delete
                </button>
              </div>
            </div>
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
                  <a
                    key={a.part}
                    className="attachment"
                    href={apiUrl(`/api/messages/${encodeURIComponent(selectedId ?? "")}/parts/${a.part}`)}
                    download={a.filename}
                    title={`${a.mimeType} · ${a.human}`}
                  >
                    <span className="attachment-name">{a.filename}</span>
                    <span className="attachment-size">{a.human}</span>
                  </a>
                ))}
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
                  {imagesOn ? "Block images" : "Load images"}
                </button>
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
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={mailHtml}
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
                </div>
              </header>
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
            <AgentChat messageId={selected.id} />
          </>
        )}
        {error ? <p className="error">{error}</p> : null}
      </main>
      {composing ? (
        <div className="compose">
          <strong>New message</strong>
          <input placeholder="To" value={composeTo} onChange={(e) => setComposeTo(e.target.value)} />
          <input placeholder="Subject" value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} />
          <textarea rows={8} value={composeBody} onChange={(e) => setComposeBody(e.target.value)} />
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
        <div className="keys" role="dialog">
          <strong>Keys</strong>
          <p>c new · s star · e archive · # trash · ! spam · u unread · r draft · f forward</p>
          <p>j/k move · n next unread · ? this list · Esc close</p>
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
    </div>
  );
}
