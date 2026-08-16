import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PROVIDERS } from "./providers.js";
import { SecretVault } from "./vault.js";

export type AccountRecord = {
  id: string;
  display_name: string;
  email: string;
  provider: string;
  imap_host: string;
  imap_port: number;
  imap_tls: string;
  smtp_host: string;
  smtp_port: number;
  smtp_tls: string;
  username: string;
  secret_ref: string;
  auth_method: string;
};

const secrets = new SecretVault(8);

export class AccountBook {
  constructor(private filePath: string) {}

  private read(): AccountRecord[] {
    try {
      return JSON.parse(readFileSync(this.filePath, "utf8")) as AccountRecord[];
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return [];
      throw err;
    }
  }

  private write(rows: AccountRecord[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(rows, null, 2), "utf8");
  }

  list(): AccountRecord[] {
    return this.read();
  }

  add(input: {
    provider: string;
    email: string;
    username?: string;
    password?: string;
    display_name?: string;
    imap_host?: string;
    imap_port?: number;
    imap_tls?: string;
    smtp_host?: string;
    smtp_port?: number;
    smtp_tls?: string;
  }): AccountRecord {
    const preset = PROVIDERS.find((p) => p.id === input.provider);
    if (!preset) throw new Error("unknown provider");
    if (preset.unsupported) throw new Error(preset.notes);
    const email = input.email.trim();
    if (!email.includes("@")) throw new Error("need an email address");
    const password = input.password ?? "";
    if (!password) throw new Error("need a password or app password (sent only to this machine)");

    const id = `acc-${Date.now().toString(36)}`;
    const secret_ref = `memory:${id}`;
    secrets.put(secret_ref, password);

    const row: AccountRecord = {
      id,
      display_name: input.display_name?.trim() || email,
      email,
      provider: preset.id,
      imap_host: input.imap_host || preset.imap_host,
      imap_port: input.imap_port || preset.imap_port,
      imap_tls: input.imap_tls || preset.imap_tls,
      smtp_host: input.smtp_host || preset.smtp_host,
      smtp_port: input.smtp_port || preset.smtp_port,
      smtp_tls: input.smtp_tls || preset.smtp_tls,
      username: (input.username || email).trim(),
      secret_ref,
      auth_method: preset.auth_method,
    };
    if (!row.imap_host) throw new Error("need IMAP host");
    const rows = this.read();
    rows.push(row);
    this.write(rows);
    return row;
  }
}

export function hasSecret(ref: string): boolean {
  return secrets.has(ref);
}
