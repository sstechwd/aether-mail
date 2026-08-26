import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { appRoot, isPackaged } from "./approot.js";

export type MailCliAction =
  | "probe"
  | "fetch"
  | "part"
  | "send"
  | "idle"
  | "secret-put"
  | "secret-get"
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

export type MailCliSearch = {
  platform: string;
  env: Record<string, string | undefined>;
  execPath: string;
  cwd: string;
  appRoot: string;
};

/**
 * Places a packaged install would keep aether-cli.
 *
 * Fresh NSIS puts it next to the sidecar. Source trees keep it in
 * target/release. The Start Menu often launches us with cwd=System32, so
 * cwd is the last place we look, not the first.
 */
export function mailCliCandidates(input: MailCliSearch): string[] {
  const join = input.platform === "win32" ? path.win32.join : path.posix.join;
  const dirname = input.platform === "win32" ? path.win32.dirname : path.posix.dirname;
  const exe = input.platform === "win32" ? "aether-cli.exe" : "aether-cli";
  const names = input.platform === "win32" ? [exe, "aether-cli"] : [exe];

  const pinned = input.env.AETHER_CLI?.trim();
  const dirs: string[] = [];
  const add = (d: string): void => {
    if (d && !dirs.includes(d)) dirs.push(d);
  };

  let walk = dirname(input.execPath);
  for (let i = 0; i < 4; i += 1) {
    add(walk);
    add(join(walk, "resources"));
    const up = dirname(walk);
    if (up === walk) break;
    walk = up;
  }
  add(join(input.appRoot, "target", "release"));
  add(join(input.appRoot, "target", "debug"));
  add(input.appRoot);
  add(input.cwd);

  const out: string[] = [];
  if (pinned) out.push(pinned);
  for (const dir of dirs) {
    for (const name of names) out.push(join(dir, name));
  }
  return out;
}

export function findMailCli(): string | null {
  const candidates = mailCliCandidates({
    platform: process.platform,
    env: process.env,
    execPath: process.execPath,
    cwd: process.cwd(),
    appRoot: appRoot(),
  });
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export type MailCliResult = {
  ok: boolean;
  error?: string;
  /** For `idle`: why the wait ended — "activity" means fetch now. */
  woke?: "activity" | "timeout";
  /** Only set by secret-get, which the CLI restricts to the LLM key. */
  secret?: string;
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
      error: isPackaged()
        ? "Mail helper missing from this install. Uninstall Aether Mail, then run the latest setup."
        : "aether-cli not built. From the repo: cargo build -p aether-cli",
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
