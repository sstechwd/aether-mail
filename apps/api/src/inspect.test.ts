import { describe, expect, it } from "vitest";
import { inspectHeaders } from "./inspect.js";

const PHISH = [
  "Return-Path: <bot@evil.example>",
  "Received: from unknown.tor (unknown [198.51.100.9])",
  "From: Totally Real Bank <security@bank.example>",
  "Reply-To: attacker@evil.example",
  "Authentication-Results: mx.google.com; spf=fail smtp.mailfrom=evil.example; dkim=fail; dmarc=fail",
  "Subject: Urgent: verify your account",
].join("\r\n");

const LEGIT = [
  "Return-Path: <priya@example.com>",
  "Received: from mail.example.com (mail.example.com [192.0.2.10])",
  "From: Priya Shah <priya@example.com>",
  "Reply-To: priya@example.com",
  "Authentication-Results: mx.google.com; spf=pass smtp.mailfrom=example.com; dkim=pass; dmarc=pass",
  "Subject: Can we move Thursday's call?",
].join("\r\n");

describe("inspectHeaders", () => {
  it("flags From domain vs Return-Path and failed auth", () => {
    const r = inspectHeaders(PHISH);
    expect(r.fromDomain).toBe("bank.example");
    expect(r.returnPathDomain).toBe("evil.example");
    expect(r.spf).toBe("fail");
    expect(r.dkim).toBe("fail");
    expect(r.dmarc).toBe("fail");
    expect(r.label).toBe("danger");
    expect(r.findings.some((f) => /return-path/i.test(f))).toBe(true);
  });

  it("passes aligned From and SPF/DKIM/DMARC", () => {
    const r = inspectHeaders(LEGIT);
    expect(r.label).toBe("ok");
    expect(r.spf).toBe("pass");
    expect(r.findings).toHaveLength(0);
  });
});
