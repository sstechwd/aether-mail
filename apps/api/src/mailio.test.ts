import { describe, expect, it } from "vitest";
import { buildMailCliArgs } from "./mailio.js";

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
});
