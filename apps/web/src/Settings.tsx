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
type Llm = { provider: string; baseUrl: string; model: string; hasKey: boolean; allowCloud?: boolean; authMode?: string };
type LlmPreset = {
  id: string;
  label: string;
  kind: "local" | "cloud";
  baseUrl: string;
  model: string;
  allowCloud: boolean;
  needsKey: boolean;
  canOAuth?: boolean;
  keyHost: string;
  keyUrl: string;
  billingNote: string;
};

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
  const [signature, setSignature] = useState("");
  /** Profile backups, and the status line under the button. */
  const [backups, setBackups] = useState<
    { name: string; path: string; createdAt: string; messages: number }[]
  >([]);
  const [backupNote, setBackupNote] = useState<string | null>(null);

  async function loadBackups(): Promise<void> {
    try {
      const r = await fetch(apiUrl("/api/backup"));
      const d = (await r.json()) as { backups?: typeof backups };
      setBackups(d.backups ?? []);
    } catch {
      setBackups([]);
    }
  }
  const [sigNote, setSigNote] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  const [llm, setLlm] = useState<Llm | null>(null);
  const [presets, setPresets] = useState<LlmPreset[]>([]);
  const [pickId, setPickId] = useState("ollama");
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
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthPrompt, setOauthPrompt] = useState<{ url: string; userCode: string } | null>(null);
  const [autoInspect, setAutoInspect] = useState(true);
  const [alwaysShow, setAlwaysShow] = useState(false);

  useEffect(() => {
    void loadBackups();
    api<{ signature: string }>("/api/signature")
      .then((d) => setSignature(d.signature ?? ""))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    api<{ providers: Provider[] }>("/api/providers").then((d) => setProviders(d.providers)).catch((e: Error) => setNote(e.message));
    api<{ accounts: SavedAccount[] }>("/api/accounts").then((d) => setAccounts(d.accounts)).catch((e: Error) => setNote(e.message));
    api<{ llm: Llm; presets?: LlmPreset[] }>("/api/settings/llm")
      .then((d) => {
        setLlm(d.llm);
        setModel(d.llm.model);
        setBaseUrl(d.llm.baseUrl);
        setAllowCloud(Boolean(d.llm.allowCloud));
        const list = d.presets ?? [];
        setPresets(list);
        const match = list.find((p) => p.baseUrl.replace(/\/$/, "") === d.llm.baseUrl.replace(/\/$/, ""));
        if (match) setPickId(match.id);
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
  const pickedLlm = presets.find((p) => p.id === pickId);

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
        {/*
          Sign in with the provider instead of a password.
          Google and Microsoft are removing app passwords, so for those two
          this is the path that keeps working. It opens the SYSTEM browser —
          never an in-app window asking for a Google password, which is
          indistinguishable from phishing.
        */}
        {providerId === "gmail" || providerId === "outlook" ? (
          <button
            className="oauth-btn"
            disabled={saving}
            onClick={() => {
              setNote("Opening your browser…");
              api<{ url?: string; error?: string; message?: string }>("/api/oauth/start", {
                method: "POST",
                body: JSON.stringify({ provider: providerId, email }),
              })
                .then((d) => {
                  if (d.url) {
                    window.open(d.url, "_blank", "noopener,noreferrer");
                    setNote("Finish signing in in your browser, then come back.");
                  } else {
                    setNote(d.message ?? d.error ?? "Sign-in is not configured.");
                  }
                })
                .catch((e: Error) => setNote(e.message));
            }}
          >
            Sign in with {providerId === "gmail" ? "Google" : "Microsoft"}
          </button>
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
        <h2>Your data</h2>
        <p className="hint">
          Mail lives in one SQLite file plus plain JSON settings. Any tool can read it —
          no export format, no lock-in. Passwords are <em>not</em> included: they stay in the
          OS keyring, so a backup is not a copy of your credentials.
        </p>
        <button
          onClick={() => {
            setBackupNote("Backing up…");
            fetch(apiUrl("/api/backup"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            })
              .then((r) => r.json())
              .then((d: { messages?: number; bytes?: number; path?: string; error?: string }) => {
                if (d.error) {
                  setBackupNote(d.error);
                  return;
                }
                const mb = ((d.bytes ?? 0) / 1048576).toFixed(1);
                setBackupNote(`Backed up ${d.messages ?? 0} messages (${mb} MB) to ${d.path}`);
                void loadBackups();
              })
              .catch((e: Error) => setBackupNote(e.message));
          }}
        >
          Back up now
        </button>
        {backupNote ? <p className="note">{backupNote}</p> : null}
        {backups.length > 0 ? (
          <div className="backup-list">
            {backups.map((b) => (
              <div className="backup-row" key={b.path}>
                <span>
                  <strong>{new Date(b.createdAt).toLocaleString()}</strong>
                  <span className="hint"> · {b.messages} messages</span>
                </span>
                <button
                  className="subtle-danger"
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Restore ${b.messages} messages from ${new Date(b.createdAt).toLocaleString()}?\n\n` +
                          "Your current mail is moved aside, not deleted. Aether must be restarted afterwards.",
                      )
                    )
                      return;
                    fetch(apiUrl("/api/backup/restore"), {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ path: b.path }),
                    })
                      .then((r) => r.json())
                      .then((d: { error?: string; movedAsideTo?: string }) => {
                        setBackupNote(
                          d.error
                            ? d.error
                            : `Restored. Previous profile kept at ${d.movedAsideTo}. Restart Aether now.`,
                        );
                      })
                      .catch((e: Error) => setBackupNote(e.message));
                  }}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section>
        <h2>Signature</h2>
        <p className="hint">
          Added below what you write, and above the quoted text in a reply. Applies to the active
          account.
        </p>
        <textarea
          rows={4}
          value={signature}
          placeholder={"— Your name\nyou@example.com"}
          onChange={(e) => setSignature(e.target.value)}
        />
        <button
          onClick={() => {
            void (async () => {
              try {
                await api("/api/signature", { method: "POST", body: JSON.stringify({ signature }) });
                setSigNote("Saved.");
                window.setTimeout(() => setSigNote(null), 2000);
              } catch (e) {
                setSigNote(e instanceof Error ? e.message : String(e));
              }
            })();
          }}
        >
          Save signature
        </button>
        {sigNote ? <p className="note">{sigNote}</p> : null}
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
        <h2>Agent model</h2>
        <p className="hint">
          Pick a provider. Grok can sign in with SuperGrok. Claude and ChatGPT
          subscriptions cannot — those companies block third-party mail apps, so
          those two still need an API key. Keys go in Windows Credential Manager.
        </p>
        <div className="llm-cards" role="list">
          {presets.map((p) => {
            const active = llm && p.baseUrl.replace(/\/$/, "") === llm.baseUrl.replace(/\/$/, "");
            return (
              <button
                key={p.id}
                type="button"
                role="listitem"
                className={`llm-card${pickId === p.id ? " on" : ""}${active ? " current" : ""}`}
                onClick={() => {
                  setPickId(p.id);
                  setBaseUrl(p.baseUrl);
                  setModel(p.model);
                  setAllowCloud(p.allowCloud);
                  setApiKey("");
                }}
              >
                <strong>{p.label}</strong>
                <span>{p.kind === "local" ? "This computer" : p.keyHost}</span>
                {active ? <em>in use</em> : null}
              </button>
            );
          })}
        </div>
        {pickedLlm ? (
          <div className="llm-pick">
            {pickedLlm.needsKey ? (
              <>
                <label>
                  API key from {pickedLlm.keyHost}
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    autoComplete="off"
                    placeholder="paste key"
                  />
                </label>
                <p className="hint">
                  Get a key at{" "}
                  <a href={pickedLlm.keyUrl} target="_blank" rel="noreferrer">
                    {pickedLlm.keyHost}
                  </a>
                  . {pickedLlm.billingNote}
                </p>
                <p className="cloud-warn">
                  When you run the agent, that one open message is sent to{" "}
                  <strong>{pickedLlm.keyHost}</strong> — never the rest of the mailbox, and never
                  in the background.
                </p>
              </>
            ) : (
              <p className="hint">
                Uses whatever model is already running in Ollama on this computer. Nothing is
                uploaded.
              </p>
            )}
            {pickedLlm.canOAuth ? (
              <button
                type="button"
                className="oauth-btn"
                disabled={oauthBusy}
                onClick={() => {
                  setNote(null);
                  setOauthBusy(true);
                  api<{ url: string; userCode: string; pollMs?: number }>("/api/settings/llm/oauth/start", {
                    method: "POST",
                    body: JSON.stringify({ preset: pickedLlm.id }),
                  })
                    .then(async (d) => {
                      setOauthPrompt({ url: d.url, userCode: d.userCode });
                      setNote(`Approve SuperGrok in your browser${d.userCode ? ` (code ${d.userCode})` : ""}.`);
                      const wait = Math.max(2000, d.pollMs ?? 4000);
                      for (let i = 0; i < 90; i++) {
                        await new Promise((r) => setTimeout(r, wait));
                        const polled = await api<{ status: string; llm?: Llm }>("/api/settings/llm/oauth/poll", {
                          method: "POST",
                          body: "{}",
                        });
                        if (polled.status === "ready" && polled.llm) {
                          setLlm(polled.llm);
                          setModel(polled.llm.model);
                          setBaseUrl(polled.llm.baseUrl);
                          setAllowCloud(Boolean(polled.llm.allowCloud));
                          setOauthPrompt(null);
                          setNote("Grok is signed in. Close Settings (top right), then ask the Assistant something.");
                          return;
                        }
                      }
                      setNote("SuperGrok sign-in timed out. Try again.");
                    })
                    .catch((e: Error) => setNote(e.message))
                    .finally(() => setOauthBusy(false));
                }}
              >
                {oauthBusy ? "Waiting for SuperGrok…" : "Sign in with SuperGrok"}
              </button>
            ) : null}
            {oauthPrompt ? (
              <p className="cloud-warn">
                Finish sign-in in your browser. If a tab did not open, go to{" "}
                <strong>{oauthPrompt.url}</strong> and enter{" "}
                <strong>{oauthPrompt.userCode}</strong>.
              </p>
            ) : null}
            <button
              type="button"
              disabled={
                saving ||
                (Boolean(pickedLlm.needsKey) &&
                  !apiKey.trim() &&
                  !(llm?.hasKey && llm.baseUrl.replace(/\/$/, "") === pickedLlm.baseUrl.replace(/\/$/, "")))
              }
              onClick={() => {
                setNote(null);
                setSaving(true);
                api<{ llm: Llm }>("/api/settings/llm", {
                  method: "POST",
                  body: JSON.stringify({
                    preset: pickedLlm.id,
                    apiKey: apiKey.trim() || undefined,
                  }),
                })
                  .then((d) => {
                    setLlm(d.llm);
                    setModel(d.llm.model);
                    setBaseUrl(d.llm.baseUrl);
                    setAllowCloud(Boolean(d.llm.allowCloud));
                    setApiKey("");
                    setNote(`${pickedLlm.label} is now the agent model.`);
                  })
                  .catch((e: Error) => setNote(e.message))
                  .finally(() => setSaving(false));
              }}
            >
              {saving ? "Saving…" : `Use ${pickedLlm.label}`}
            </button>
          </div>
        ) : null}
        {llm ? (
          <p className="hint">
            Active: {llm.model} · {llm.authMode === "oauth" ? "signed in with SuperGrok" : `key ${llm.hasKey ? "set" : "not set"}`}
          </p>
        ) : null}
        <details className="llm-advanced">
          <summary>Advanced — custom URL</summary>
          <label>
            Model
            <input value={model} onChange={(e) => setModel(e.target.value)} />
          </label>
          <label>
            Base URL
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </label>
          <label>
            API key
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
          </label>
          <label>
            <input type="checkbox" checked={allowCloud} onChange={(e) => setAllowCloud(e.target.checked)} />
            Allow a non-localhost model (sends the open message to that URL)
          </label>
          <button
            type="button"
            onClick={() => {
              setNote(null);
              api<{ llm: Llm }>("/api/settings/llm", {
                method: "POST",
                body: JSON.stringify({
                  baseUrl,
                  model,
                  apiKey: apiKey.trim() || undefined,
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
            Save custom
          </button>
        </details>
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
