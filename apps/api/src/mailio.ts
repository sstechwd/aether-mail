import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { appRoot } from "./approot.js";

export type MailCliAction =
  | "probe"
  | "fetch"
  | "part"
  | "send"
  | "idle"
  | "secret-put"
  | "secret-delete";

export function buildMailCliArgs(input: {
  action: MailCliAction;
  host?: string;
  port?: number;
  tls?: string;
  username?: string;
  secretRef: string;
  folder?: string;
  smtpHost?: string;
  smtpPort?: number;
  from?: string;
  to?: string;
  subject?: string;
  uid?: string;
  part?: number;
  /** Seconds to hold an IDLE connection open before giving up. */
  timeout?: number;
  /** Fetch only UIDs above this. Omit for a full window. */
  sinceUid?: number;
}): string[] {
  const args = [input.action, "--secret-ref", input.secretRef];
  if (input.host) args.push("--host", input.host);
  if (input.port) args.push("--port", String(input.port));
  if (input.tls) args.push("--tls", input.tls);
  if (input.username) args.push("--user", input.username);
  if (input.folder) args.push("--folder", input.folder);
  if (input.timeout) args.push("--timeout", String(input.timeout));
  if (input.sinceUid) args.push("--since-uid", String(input.sinceUid));
  if (input.smtpHost) args.push("--smtp-host", input.smtpHost);
  if (input.smtpPort) args.push("--smtp-port", String(input.smtpPort));
  if (input.from) args.push("--from", input.from);
  if (input.to) args.push("--to", input.to);
  if (input.subject) args.push("--subject", input.subject);
  if (input.uid) args.push("--uid", input.uid);
  if (input.part !== undefined) args.push("--part", String(input.part));
  return args;
}

export function findMailCli(): string | null {
  if (process.env.AETHER_CLI && existsSync(process.env.AETHER_CLI)) return process.env.AETHER_CLI;
  const root = appRoot();
  const names = process.platform === "win32" ? ["aether-cli.exe"] : ["aether-cli"];
  for (const profile of ["release", "debug"]) {
    for (const name of names) {
      const candidate = path.join(root, "target", profile, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export type MailCliResult = {
  ok: boolean;
  error?: string;
  /** For `idle`: why the wait ended — "activity" means fetch now. */
  woke?: "activity" | "timeout";
  /** Mailbox UIDVALIDITY, for detecting a server-side renumber. */
  uid_validity?: number;
  /** Highest UID returned; undefined when nothing new arrived. */
  highest_uid?: number;
  folders?: string[];
  messages?: Array<{
    id: string;
    folder: string;
    from: string;
    to: string;
    subject: string;
    date: string;
    unread: boolean;
    body: string;
    headers?: string;
    html?: string;
    preview?: string;
    attachments?: Array<{
      part: number;
      filename: string;
      mime_type: string;
      size: number;
      content_id?: string | null;
      inline: boolean;
    }>;
  }>;
  part?: { mime_type: string; data: string };
};

export function runMailCli(args: string[], stdinText?: string): Promise<MailCliResult> {
  const bin = findMailCli();
  if (!bin) {
    return Promise.resolve({
      ok: false,
      error: "aether-cli not built. From the repo: cargo build -p aether-cli",
    });
  }
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      stdout += String(c);
    });
    child.stderr.on("data", (c) => {
      stderr += String(c);
    });
    child.on("error", (e) => resolve({ ok: false, error: e.message }));
    child.on("close", () => {
      const raw = stdout.trim() || stderr.trim();
      try {
        const parsed = JSON.parse(raw) as MailCliResult;
        resolve(parsed);
      } catch {
        resolve({ ok: false, error: raw.slice(0, 240) || "mail cli failed" });
      }
    });
    if (stdinText !== undefined) {
      child.stdin.write(stdinText);
    }
    child.stdin.end();
  });
}
