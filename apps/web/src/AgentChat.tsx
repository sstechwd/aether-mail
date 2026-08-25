import { useEffect, useState } from "react";
import { apiUrl } from "./apibase.js";

type Turn = { role: string; text: string };
type Llm = {
  provider: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  allowCloud?: boolean;
  authMode?: string;
  effort?: "low" | "medium" | "high";
};
type Preset = { id: string; label: string; model: string; kind: string; baseUrl?: string; canOAuth?: boolean; needsKey?: boolean };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json()) as T & { message?: string; error?: string };
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
}

function labelFor(llm: Llm | null): string {
  if (!llm) return "no model";
  const host = (() => {
    try {
      return new URL(llm.baseUrl).hostname;
    } catch {
      return llm.baseUrl;
    }
  })();
  if (host.includes("x.ai")) return `Grok ${llm.model.replace("grok-", "")} · ${llm.effort ?? "medium"}`;
  if (host.includes("anthropic")) return llm.model;
  if (host.includes("openai.com")) return llm.model;
  if (host === "127.0.0.1" || host === "localhost") return `local ${llm.model}`;
  return llm.model;
}

export default function AgentChat(props: { messageId: string | null; onStoreChange?: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [llm, setLlm] = useState<Llm | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [usage, setUsage] = useState({ lastCompletion: 0, cap: 256, promptTokens: 0 });

  function loadLlm() {
    api<{ llm: Llm; presets?: Preset[] }>("/api/settings/llm")
      .then((d) => {
        setLlm(d.llm);
        setPresets(d.presets ?? []);
      })
      .catch((e: Error) => setErr(e.message));
  }

  useEffect(() => {
    api<{ turns: Turn[]; llm?: Llm }>("/api/agent/chat")
      .then((d) => {
        setTurns(d.turns);
        if (d.llm) setLlm(d.llm);
      })
      .catch((e: Error) => setErr(e.message));
    loadLlm();
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

  const grok = Boolean(llm && llm.baseUrl.includes("x.ai"));
  const currentPreset =
    presets.find((p) => p.baseUrl && llm && p.baseUrl.replace(/\/$/, "") === llm.baseUrl.replace(/\/$/, ""))?.id ??
    (grok ? "grok" : "ollama");

  async function switchPreset(id: string) {
    setErr(null);
    try {
      const d = await api<{ llm: Llm }>("/api/settings/llm", {
        method: "POST",
        body: JSON.stringify({ preset: id }),
      });
      setLlm(d.llm);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function switchEffort(effort: "low" | "medium") {
    setErr(null);
    try {
      const d = await api<{ llm: Llm }>("/api/settings/llm", {
        method: "POST",
        body: JSON.stringify({ effort }),
      });
      setLlm(d.llm);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

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
      props.onStoreChange?.();
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
        <select
          className="llm-switch"
          value={currentPreset}
          disabled={busy}
          onChange={(e) => void switchPreset(e.target.value)}
          aria-label="Model"
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {grok ? (
          <select
            className="llm-switch"
            value={llm?.effort === "low" ? "low" : "medium"}
            disabled={busy}
            onChange={(e) => void switchEffort(e.target.value === "low" ? "low" : "medium")}
            aria-label="Speed"
          >
            <option value="low">Fast</option>
            <option value="medium">Balanced</option>
          </select>
        ) : null}
        <span>{labelFor(llm)} · cannot send</span>
        <button
          onClick={() => {
            fetch(apiUrl("/api/agent/chat"), { method: "DELETE" })
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
        <em>{busy ? "generating…" : `${usage.lastCompletion}/${usage.cap} tok`}</em>
      </div>
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
