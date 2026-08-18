import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuditLog } from "./audit.js";

describe("AuditLog", () => {
  it("keeps recent events and does not store a body field", () => {
    const file = join(mkdtempSync(join(tmpdir(), "aether-audit-")), "audit.jsonl");
    const log = new AuditLog(file);
    log.append({ actor: "user", action: "folder.create", detail: "Priya" });
    const rows = log.list();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toMatch(/body/i);
    expect(rows[0].detail).toBe("Priya");
  });
});
