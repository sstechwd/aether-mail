import { useEffect, useMemo, useState } from "react";

type Folder = { name: string; unread: number; total: number };
type Message = {
  id: string;
  folder: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  unread: boolean;
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
  const data = (await res.json()) as T & { error?: string; message?: string };
  if (!res.ok) {
    throw new Error(data.message || data.error || res.statusText);
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
  const [folder, setFolder] = useState("INBOX");
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Message | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [agent, setAgent] = useState<AgentResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendNote, setSendNote] = useState<string | null>(null);

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
  }, []);

  useEffect(() => {
    refreshMessages(folder).catch((e: Error) => setError(e.message));
  }, [folder]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    api<{ message: Message; draft: { text: string } | null }>(`/api/messages/${selectedId}`)
      .then((data) => {
        setSelected(data.message);
        if (data.draft?.text) setDraft(data.draft.text);
        setMessages((prev) => prev.map((m) => (m.id === selectedId ? { ...m, unread: false } : m)));
        refreshFolders().catch(() => undefined);
      })
      .catch((e: Error) => setError(e.message));
  }, [selectedId]);

  const visible = useMemo(() => {
    if (!query.trim()) return messages;
    const q = query.toLowerCase();
    return messages.filter((m) =>
      [m.subject, m.from, m.body].some((f) => f.toLowerCase().includes(q)),
    );
  }, [messages, query]);

  async function runSkill(skill: "summarize" | "draft-reply") {
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

  async function confirmSend() {
    setSendNote(null);
    try {
      await api("/api/send", { method: "POST", body: JSON.stringify({ messageId: selectedId, draft }) });
    } catch (e) {
      setSendNote(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="mark">Æ</span>
          <div>
            <strong>Aether Mail</strong>
            <em>local fixture · mistral on this machine</em>
          </div>
        </div>
        <input
          className="search"
          placeholder="Search this folder"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </header>

      <aside className="folders">
        <p className="acct">Local fixture</p>
        {folders.map((f) => (
          <button
            key={f.name}
            className={f.name === folder ? "folder on" : "folder"}
            onClick={() => {
              setFolder(f.name);
              setSelectedId(null);
              setAgent(null);
              setSendNote(null);
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
            <span className="from">{m.from.replace(/<[^>]+>/, "").trim()}</span>
            <span className="subj">{m.subject}</span>
            <span className="when">{formatWhen(m.date)}</span>
          </button>
        ))}
        {visible.length === 0 ? <p className="empty">No messages.</p> : null}
      </section>

      <main className="read">
        {!selected ? (
          <p className="empty tall">Select a message. The agent stays closed until you ask.</p>
        ) : (
          <>
            <div className="headers">
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
                </div>
              ) : (
                <p className="hint">Open only if you want help. Summarize or draft — you still hit send.</p>
              )}
              <label>
                Compose
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={8} />
              </label>
              <div className="sendrow">
                <button className="danger" disabled={!draft.trim()} onClick={confirmSend}>
                  Confirm send…
                </button>
                {sendNote ? <span className="note">{sendNote}</span> : null}
              </div>
            </section>
          </>
        )}
        {error ? <p className="error">{error}</p> : null}
      </main>
    </div>
  );
}
