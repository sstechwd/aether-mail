import { useEffect, useRef, useState } from "react";
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
  folder: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  unread: boolean;
  starred?: boolean;
  body: string;
};
type AgentResult = {
  skill: string;
  text: string;
  model: string;
  proposedActions: Array<{ type: string; label: string }>;
  refused: string[];
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
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
  const [lastFetchAt, setLastFetchAt] = useState<string | null>(null);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [splash, setSplash] = useState(true);
  const [themeId, setThemeId] = useState(readTheme);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showFolders, setShowFolders] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [adding, setAdding] = useState(false);
  const [providerId, setProviderId] = useState("gmail");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [accountNote, setAccountNote] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");

  async function refreshFolders() {
    const data = await api<{ folders: Folder[] }>("/api/folders");
    setFolders(data.folders);
  }

  async function refreshMessages(nextFolder: string) {
    const data = await api<{ messages: Message[] }>(`/api/messages?folder=${encodeURIComponent(nextFolder)}`);
    setMessages(data.messages);
  }

  useEffect(() => {
    refreshFolders().catch((e: Error) => setError(e.message));
    api<{ providers: Provider[] }>("/api/providers")
      .then((d) => setProviders(d.providers))
      .catch((e: Error) => setError(e.message));
    api<{ accounts: SavedAccount[] }>("/api/accounts")
      .then((d) => setSavedAccounts(d.accounts))
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
  }, [folder]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      setThreat(null);
      setInspect(null);
      setShowInspect(false);
      return;
    }
    api<{
      message: Message;
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

  const visible = (hits ?? messages).filter((m) => (unreadOnly ? m.unread : true));
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
          body: JSON.stringify({ messageId: selectedId, draft, confirmId: pendingConfirm }),
        },
      );
      if (data.sent) {
        setPendingConfirm(null);
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
          {savedAccounts[0] ? (
            <button
              disabled={!!busy}
              onClick={() => {
                const id = savedAccounts[0].id;
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
        <p className="acct-line">Local fixture</p>
        {savedAccounts.map((a) => (
          <p key={a.id} className="acct-line">
            {a.email}
          </p>
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
      </aside>

      <section className="list">
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
            <span className="subj">{m.subject}</span>
            <span className="when">{formatWhen(m.date)}</span>
          </button>
        ))}
        {visible.length === 0 ? <p className="empty">{unreadOnly ? "No unread in this folder." : "No messages."}</p> : null}
      </section>

      <main className="read">
        {!selected ? (
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
            <pre className="body">{selected.body}</pre>

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
          <div className="sendrow">
            <button onClick={() => saveDraft()}>Save draft</button>
            <button onClick={() => setComposing(false)}>Cancel</button>
          </div>
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
