import { useEffect, useState } from "react";

type Turn = { role: string; text: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json()) as T & { message?: string; error?: string };
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
}

export default function AgentChat(props: { messageId: string | null }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ turns: Turn[] }>("/api/agent/chat")
      .then((d) => setTurns(d.turns))
      .catch((e: Error) => setErr(e.message));
  }, []);

  async function send() {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setErr(null);
    setText("");
    try {
      const data = await api<{ turns: Turn[] }>("/api/agent/chat", {
        method: "POST",
        body: JSON.stringify({ text: q, messageId: props.messageId }),
      });
      setTurns(data.turns);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="agent-chat">
      <header>
        <strong>Aether</strong>
        <span>lean local chat · 8 turns · cannot send</span>
        <button
          onClick={() => {
            fetch("/api/agent/chat", { method: "DELETE" })
              .then(() => setTurns([]))
              .catch((e: Error) => setErr(e.message));
          }}
        >
          Clear
        </button>
      </header>
      <div className="turns">
        {turns.length === 0 ? (
          <p className="hint">Ask about the open message — summarize, draft, triage, or what to do next.</p>
        ) : null}
        {turns.map((t, i) => (
          <p key={`${t.role}-${i}`} className={t.role === "user" ? "turn user" : "turn bot"}>
            <b>{t.role === "user" ? "You" : "Aether"}</b> {t.text}
          </p>
        ))}
      </div>
      {err ? <p className="error">{err}</p> : null}
      <div className="chat-input">
        <textarea
          rows={2}
          value={text}
          placeholder={busy ? "Thinking…" : "Message Aether"}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send().catch((err: Error) => setErr(err.message));
            }
          }}
        />
        <button disabled={busy || !text.trim()} onClick={() => send()}>
          Send
        </button>
      </div>
    </section>
  );
}
