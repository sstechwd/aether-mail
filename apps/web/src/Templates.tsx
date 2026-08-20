import { useEffect, useState } from "react";
import { apiUrl } from "./apibase.js";

type Tpl = { id: string; name: string; subject: string; body: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json()) as T & { message?: string; error?: string };
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
}

export default function Templates(props: {
  onClose: () => void;
  onUse: (subject: string, body: string) => void;
}) {
  const [rows, setRows] = useState<Tpl[]>([]);
  const [name, setName] = useState("Short yes");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("Works on my side — thanks.");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    api<{ templates: Tpl[] }>("/api/templates")
      .then((d) => setRows(d.templates))
      .catch((e: Error) => setNote(e.message));
  }, []);

  return (
    <div className="settings">
      <header>
        <strong>Templates</strong>
        <button type="button" onClick={props.onClose}>
          Close
        </button>
      </header>
      <p className="hint">
        Local snippets only. Not Outlook/Thunderbird import yet. Not a store — no buying, no other people&apos;s skins.
      </p>
      {rows.map((t) => (
        <p key={t.id} className="acct-line">
          {t.name}{" "}
          <button type="button" onClick={() => props.onUse(t.subject, t.body)}>
            Use
          </button>{" "}
          <button
            type="button"
            onClick={() => {
              api<{ templates: Tpl[] }>(`/api/templates/${t.id}`, { method: "DELETE" })
                .then((d) => setRows(d.templates))
                .catch((e: Error) => setNote(e.message));
            }}
          >
            Forget
          </button>
        </p>
      ))}
      <h2>New on this machine</h2>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
      <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject (optional)" />
      <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
      <button
        type="button"
        onClick={() => {
          api<{ template: Tpl; templates: Tpl[] }>("/api/templates", {
            method: "POST",
            body: JSON.stringify({ name, subject, body }),
          })
            .then((d) => {
              setRows(d.templates);
              setNote("Saved locally.");
            })
            .catch((e: Error) => setNote(e.message));
        }}
      >
        Save template
      </button>
      {note ? <p className="note">{note}</p> : null}
    </div>
  );
}
