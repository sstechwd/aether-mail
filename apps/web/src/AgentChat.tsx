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
  const [usage, setUsage] = useState({ lastCompletion: 0, cap: 80, promptTokens: 0 });

  useEffect(() => {
    api<{ turns: Turn[] }>("/api/agent/chat")
      .then((d) => setTurns(d.turns))
      .catch((e: Error) => setErr(e.message));
  }, []);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => {
      api<{ lastCompletion: number; cap: number; promptTokens: number }>("/api/usage")
        .then(setUsage)
        .catch(() => undefined);
    }, 400);
    return () => clearInterval(id);
  }, [busy]);

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
      api<{ lastCompletion: number; cap: number; promptTokens: number }>("/api/usage")
        .then(setUsage)
        .catch(() => undefined);
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
        <span>local Mistral · ~15–40s on CPU · cannot send</span>
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
        {busy ? (
          <p className="turn bot chat-wait" aria-live="polite">
            <b>Aether</b> <span className="dots" />
          </p>
        ) : null}
      </div>
      {err ? <p className="error">{err}</p> : null}
      <div className="token-bar" title={`${usage.lastCompletion}/${usage.cap} completion tokens · ~${usage.promptTokens} prompt`}>
        <i style={{ width: `${Math.min(100, (usage.lastCompletion / Math.max(1, usage.cap)) * 100)}%` }} />
        <em>
          {busy ? "generating…" : `${usage.lastCompletion}/${usage.cap} tok`}
        </em>
      </div>
      <div className="chat-input">
        <textarea
          rows={2}
          value={text}
          placeholder={busy ? "Thinking… CPU model, give it up to 45s" : "Message Aether"}
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
