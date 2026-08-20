import { useEffect, useState } from "react";
import { apiUrl } from "./apibase.js";
import { THEMES, applyTheme, readTheme, type ThemeId } from "./themes";

type Provider = {
  id: string;
  label: string;
  unsupported: boolean;
  notes: string;
  imap_host: string;
};
type SavedAccount = { id: string; email: string; provider: string; imap_host: string };
type Llm = { provider: string; baseUrl: string; model: string; hasKey: boolean; allowCloud?: boolean };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json()) as T & { message?: string; error?: string };
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
}

export default function Settings(props: { onClose: () => void }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  const [llm, setLlm] = useState<Llm | null>(null);
  const [providerId, setProviderId] = useState("gmail");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [model, setModel] = useState("mistral");
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:11434");
  const [apiKey, setApiKey] = useState("");
  const [allowCloud, setAllowCloud] = useState(false);
  const [spoken, setSpoken] = useState("star invoices and archive newsletters");
  const [rules, setRules] = useState<Array<{ id: string; spoken: string; action: string }>>([]);
  const [audit, setAudit] = useState<Array<{ at: string; actor: string; action: string; detail: string }>>([]);
  const [memory, setMemory] = useState<Array<{ kind: string; name: string }>>([]);
  const [themeId, setThemeId] = useState<ThemeId>(readTheme);
  const [note, setNote] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoInspect, setAutoInspect] = useState(true);
  const [alwaysShow, setAlwaysShow] = useState(false);

  useEffect(() => {
    api<{ providers: Provider[] }>("/api/providers").then((d) => setProviders(d.providers)).catch((e: Error) => setNote(e.message));
    api<{ accounts: SavedAccount[] }>("/api/accounts").then((d) => setAccounts(d.accounts)).catch((e: Error) => setNote(e.message));
    api<{ llm: Llm }>("/api/settings/llm")
      .then((d) => {
        setLlm(d.llm);
        setModel(d.llm.model);
        setBaseUrl(d.llm.baseUrl);
        setAllowCloud(Boolean(d.llm.allowCloud));
      })
      .catch((e: Error) => setNote(e.message));
    api<{ workflows: Array<{ id: string; spoken: string; action: string }> }>("/api/workflows")
      .then((d) => setRules(d.workflows))
      .catch((e: Error) => setNote(e.message));
    api<{ events: Array<{ at: string; actor: string; action: string; detail: string }> }>("/api/audit")
      .then((d) => setAudit(d.events.slice().reverse().slice(0, 40)))
      .catch(() => undefined);
    api<{ hits: Array<{ kind: string; name: string }> }>("/api/memory")
      .then((d) => setMemory(d.hits ?? []))
      .catch(() => undefined);
    api<{ inspect: { autoInspect: boolean; alwaysShow: boolean } }>("/api/settings/inspect")
      .then((d) => {
        setAutoInspect(d.inspect.autoInspect);
        setAlwaysShow(d.inspect.alwaysShow);
      })
      .catch(() => undefined);
  }, []);

  const selected = providers.find((p) => p.id === providerId);

  return (
    <div className="settings">
      <header>
        <strong>Settings</strong>
        <button onClick={props.onClose}>Close</button>
      </header>
      <section>
        <h2>Mail accounts</h2>
        <p className="hint">App password only. Fetch takes the newest 40 messages, not the oldest. HTML is stripped to text.</p>
        {accounts.map((a) => (
          <p key={a.id} className="acct-line">
            {a.email} · {a.provider} · {a.imap_host}{" "}
            <button
              disabled={fetching}
              onClick={() => {
                setNote("Fetching newest 40 from INBOX…");
                setFetching(true);
                api<{ count: number }>(`/api/accounts/${a.id}/sync`, { method: "POST" })
                  .then((d) => setNote(`Fetched ${d.count} newest messages.`))
                  .catch((e: Error) => setNote(e.message))
                  .finally(() => setFetching(false));
              }}
            >
              {fetching ? "Fetching…" : "Fetch INBOX"}
            </button>{" "}
            <button
              onClick={() => {
                if (!window.confirm(`Remove ${a.email} from this machine?`)) return;
                api<{ accounts: SavedAccount[] }>(`/api/accounts/${a.id}`, { method: "DELETE" })
                  .then((d) => {
                    setAccounts(d.accounts);
                    setNote("Account removed from this machine.");
                  })
                  .catch((e: Error) => setNote(e.message));
              }}
            >
              Remove
            </button>
          </p>
        ))}
        {fetching ? <div className="token-bar busy" aria-live="polite"><i /><em>IMAP…</em></div> : null}
        <h3>Add account</h3>
        <p className="hint">App password, not your main login. Password goes to Windows Credential Manager.</p>
        <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {selected ? <p className="hint">{selected.notes}</p> : null}
        <input placeholder="you@domain.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" placeholder="app password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
        {providerId === "custom" ? (
          <input placeholder="imap.example.com" value={imapHost} onChange={(e) => setImapHost(e.target.value)} />
        ) : null}
        <button
          disabled={selected?.unsupported || saving}
          onClick={() => {
            setNote("Checking IMAP…");
            setSaving(true);
            api<{ account: SavedAccount; probe: string }>("/api/accounts", {
              method: "POST",
              body: JSON.stringify({ provider: providerId, email, password, imap_host: imapHost || undefined }),
            })
              .then((d) => {
                setAccounts((prev) => [...prev, d.account]);
                setPassword("");
                setNote(d.probe);
              })
              .catch((e: Error) => setNote(e.message))
              .finally(() => setSaving(false));
          }}
        >
          Save mail account on this machine
        </button>
      </section>
      <section>
        <h2>Header inspect</h2>
        <p className="hint">
          Local only. Compares From vs Return-Path and reads SPF/DKIM/DMARC. Not a cloud scanner. Chat “inspect headers” skips Ollama.
        </p>
        <p className="hint">
          HTML mail opens in a locked iframe (no scripts). Remote pictures stay off until you hit Load images — those can phone home.
        </p>
        <label>
          <input
            type="checkbox"
            checked={autoInspect}
            onChange={(e) => {
              const v = e.target.checked;
              setAutoInspect(v);
              api("/api/settings/inspect", { method: "POST", body: JSON.stringify({ autoInspect: v, alwaysShow }) }).catch(
                (err: Error) => setNote(err.message),
              );
            }}
          />
          Auto-open inspect when a message looks suspect
        </label>
        <label>
          <input
            type="checkbox"
            checked={alwaysShow}
            onChange={(e) => {
              const v = e.target.checked;
              setAlwaysShow(v);
              api("/api/settings/inspect", { method: "POST", body: JSON.stringify({ autoInspect, alwaysShow: v }) }).catch(
                (err: Error) => setNote(err.message),
              );
            }}
          />
          Prefer showing the header panel (you can still hide it)
        </label>
      </section>
      <section>
        <h2>Agent LLM</h2>
        <p className="hint">Default is local Ollama. Keys stay in memory, never in llm.json. Lean: 8-turn chat, 80 tokens, 45s timeout.</p>
        <label>
          Model
          <input value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        <label>
          Base URL
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </label>
        <label>
          API key (optional BYOK)
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
        </label>
        <label>
          <input type="checkbox" checked={allowCloud} onChange={(e) => setAllowCloud(e.target.checked)} />
          Allow a non-localhost model (sends the open message to that URL)
        </label>
        <button
          onClick={() => {
            setNote(null);
            api<{ llm: Llm }>("/api/settings/llm", {
              method: "POST",
              body: JSON.stringify({
                provider: baseUrl.includes("11434") ? "ollama" : "openai-compatible",
                baseUrl,
                model,
                apiKey: apiKey || undefined,
                allowCloud,
              }),
            })
              .then((d) => {
                setLlm(d.llm);
                setApiKey("");
                setNote(`LLM saved: ${d.llm.model} @ ${d.llm.baseUrl}`);
              })
              .catch((e: Error) => setNote(e.message));
          }}
        >
          Save LLM
        </button>
        {llm ? (
          <p className="hint">
            Active: {llm.model} · {llm.baseUrl} · key {llm.hasKey ? "set" : "not set"}
          </p>
        ) : null}
      </section>
      <section>
        <h2>Workflows</h2>
        <p className="hint">Tell the agent in English. It stars or archives matching mail when it arrives. It will never send, delete, or forward on its own.</p>
        {rules.map((r) => (
          <p key={r.id} className="acct-line">
            {r.action} · {r.spoken}{" "}
            <button
              type="button"
              onClick={() => {
                api<{ workflows: Array<{ id: string; spoken: string; action: string }> }>(`/api/workflows/${r.id}`, {
                  method: "DELETE",
                })
                  .then((d) => setRules(d.workflows))
                  .catch((e: Error) => setNote(e.message));
              }}
            >
              Forget
            </button>
          </p>
        ))}
        <input value={spoken} onChange={(e) => setSpoken(e.target.value)} placeholder="star invoices" />
        <button
          onClick={() => {
            setNote(null);
            api<{
              workflow: { id: string; spoken: string; action: string };
              workflows?: Array<{ id: string; spoken: string; action: string }>;
              applied: unknown[];
            }>("/api/workflows", {
              method: "POST",
              body: JSON.stringify({ spoken }),
            })
              .then((d) => {
                setRules((prev) => [...prev, ...(d.workflows ?? (d.workflow ? [d.workflow] : []))]);
                setNote(`Saved. Applied to ${d.applied.length} existing messages.`);
              })
              .catch((e: Error) => setNote(e.message));
          }}
        >
          Teach the agent
        </button>
      </section>
      <section>
        <h2>Your voice</h2>
        <p className="hint">Paste a sent email you wrote. Drafts will try to sound like you. Stored locally, max 8 samples. Not uploaded unless you use a cloud model.</p>
        <textarea
          rows={4}
          placeholder="Hey — Thursday works on my side…"
          id="persona-sample"
        />
        <button
          onClick={() => {
            const el = document.getElementById("persona-sample") as HTMLTextAreaElement | null;
            const sample = el?.value ?? "";
            setNote(null);
            api<{ count: number }>("/api/persona", { method: "POST", body: JSON.stringify({ sample }) })
              .then((d) => {
                if (el) el.value = "";
                setNote(`Saved. ${d.count} sample(s) on this machine.`);
              })
              .catch((e: Error) => setNote(e.message));
          }}
        >
          Save writing sample
        </button>
      </section>
      <section>
        <h2>Theme</h2>
        <p className="hint">Filament is the new default (near-black + amber). Retro keeps olive/copper. Works even if the API is down — picker is in the app, not fetched.</p>
        <div className="theme-row">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={t.id === themeId ? "folder on" : "folder"}
              onClick={() => {
                setThemeId(t.id);
                applyTheme(t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h2>Sibyl memory</h2>
        <p className="hint">
          Official Sibyl SDK, SQLite on this PC. Chat “remember that Priya prefers Friday 9:30”. Mail bodies and passwords stay out. Not uploaded.
        </p>
        {memory.length === 0 ? <p className="hint">Empty until you teach it.</p> : null}
        {memory.map((h) => (
          <p key={`${h.kind}-${h.name}`} className="acct-line">
            {h.kind}/{h.name}
          </p>
        ))}
      </section>
      <section>
        <h2>Audit (30 days)</h2>
        <p className="hint">Local log. No mail bodies. Agent cannot send from here.</p>
        {audit.length === 0 ? <p className="hint">No events yet.</p> : null}
        {audit.map((e, i) => (
          <p key={`${e.at}-${i}`} className="acct-line">
            {e.at.slice(0, 16)} · {e.actor} · {e.action} · {e.detail}
          </p>
        ))}
      </section>
      {note ? <p className="note">{note}</p> : null}
    </div>
  );
}
