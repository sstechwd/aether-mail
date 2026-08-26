import { describe, expect, it } from "vitest";
import path from "node:path";
import { buildMailCliArgs, mailCliCandidates } from "./mailio.js";

describe("mail CLI argv", () => {
  it("never places the password on the command line", () => {
    const args = buildMailCliArgs({
      action: "probe",
      host: "imap.gmail.com",
      port: 993,
      tls: "ssl",
      username: "you@gmail.com",
      secretRef: "keyring:acc-1",
    });
    const joined = args.join(" ");
    expect(joined).not.toMatch(/password|secret=|app-pass/i);
    expect(args).toContain("--secret-ref");
    expect(args).toContain("keyring:acc-1");
    expect(args[0]).toBe("probe");
  });

  it("deletes a keyring entry by ref only — no password on argv", () => {
    const args = buildMailCliArgs({ action: "secret-delete", secretRef: "keyring:acc-1" });
    expect(args).toEqual(["secret-delete", "--secret-ref", "keyring:acc-1"]);
  });
});

describe("mailCliCandidates", () => {
  it("finds aether-cli next to the sidecar in a fresh install (no target/)", () => {
    const install = path.win32.join("C:", "Users", "Sam", "AppData", "Local", "Aether Mail");
    const hits = mailCliCandidates({
      platform: "win32",
      env: {},
      execPath: path.win32.join(install, "aether-api.exe"),
      cwd: path.win32.join("C:", "Windows", "System32"),
      appRoot: path.win32.join("C:", "Windows", "System32"),
    });
    expect(hits).toContain(path.win32.join(install, "aether-cli.exe"));
  });

  it("honours AETHER_CLI when the shell already located the binary", () => {
    const pinned = path.win32.join("D:", "bundle", "aether-cli.exe");
    const hits = mailCliCandidates({
      platform: "win32",
      env: { AETHER_CLI: pinned },
      execPath: "C:\\Windows\\System32\\node.exe",
      cwd: "C:\\Windows\\System32",
      appRoot: "C:\\Windows\\System32",
    });
    expect(hits[0]).toBe(pinned);
  });
});
