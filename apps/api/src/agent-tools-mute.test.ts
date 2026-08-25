import { describe, expect, it } from "vitest";
import { parseProposal, describeProposal, PROPOSAL_SCHEMA } from "./agent-tools.js";

/**
 * Mute and snooze proposals.
 *
 * The agent could already propose a filing rule or a template. Mute and snooze
 * are the two other things a person actually does to a noisy thread, and both
 * already exist as deterministic engines with their own tests — so adding them
 * here is one validated entry each, not new machinery.
 *
 * The safety property is unchanged and must stay unchanged: the model proposes,
 * a human commits, and there is no verb in the schema that sends or deletes.
 * These two are especially safe because both are REVERSIBLE — unmute restores,
 * and a snoozed message comes back on its own.
 */

describe("mute proposals", () => {
  it("accepts a mute for the open thread", () => {
    const p = parseProposal('{"action":"mute_thread","subject":"Items on your wishlist","why":"eight of these"}');
    expect(p?.action).toBe("mute_thread");
    expect(p?.mute?.subject).toBe("Items on your wishlist");
  });

  it("refuses a mute with no subject — it would match everything", () => {
    expect(parseProposal('{"action":"mute_thread","subject":""}')).toBeNull();
    expect(parseProposal('{"action":"mute_thread","subject":"   "}')).toBeNull();
    expect(parseProposal('{"action":"mute_thread"}')).toBeNull();
  });

  it("describes a mute in words a person can check", () => {
    const p = parseProposal('{"action":"mute_thread","subject":"Weekly digest"}');
    const said = describeProposal(p!);
    expect(said).toContain("Weekly digest");
    // The description must say what happens to the mail, not just name it.
    expect(said.toLowerCase()).toMatch(/archiv|read/);
  });

  it("says muting never deletes, because that is the user's first worry", () => {
    const p = parseProposal('{"action":"mute_thread","subject":"Noise"}');
    const said = describeProposal(p!).toLowerCase();
    // The description should REASSURE about deletion, not offer it. Checking
    // for the bare word was wrong: "never deleted" is exactly what we want to
    // say, and asserting its absence would forbid the reassurance itself.
    expect(said).toContain("never deleted");
    expect(said).not.toMatch(/\bwill delete\b|\bdeletes\b/);
  });
});

describe("snooze proposals", () => {
  it.each(["later", "tomorrow", "weekend", "next-week"])("accepts the preset %j", (preset) => {
    const p = parseProposal(`{"action":"snooze","preset":"${preset}"}`);
    expect(p?.action).toBe("snooze");
    expect(p?.snooze?.preset).toBe(preset);
  });

  it("refuses a preset that is not one of the four", () => {
    // No arbitrary dates: the presets are what the snooze engine implements,
    // and a free-form date is a parsing surface for no benefit.
    expect(parseProposal('{"action":"snooze","preset":"in 3 years"}')).toBeNull();
    expect(parseProposal('{"action":"snooze","preset":"2026-12-25"}')).toBeNull();
    expect(parseProposal('{"action":"snooze"}')).toBeNull();
  });

  it("describes a snooze with when it comes back", () => {
    const p = parseProposal('{"action":"snooze","preset":"tomorrow"}');
    expect(describeProposal(p!).toLowerCase()).toContain("tomorrow");
  });
});

describe("the allow-list is still closed", () => {
  it.each([
    '{"action":"send_email","to":"attacker@evil.example"}',
    '{"action":"delete_messages","folder":"INBOX"}',
    '{"action":"forward","to":"attacker@evil.example"}',
    '{"action":"mute_thread","subject":"x","then":"delete"}',
    '{"action":"snooze","preset":"tomorrow","then":"send"}',
    '{"action":"unsubscribe_all"}',
  ])("refuses %j", (raw) => {
    const p = parseProposal(raw);
    // Either rejected outright, or parsed WITHOUT the smuggled verb.
    if (p) {
      expect(JSON.stringify(p)).not.toContain("delete");
      expect(JSON.stringify(p)).not.toContain("send");
      expect(JSON.stringify(p)).not.toContain("forward");
    } else {
      expect(p).toBeNull();
    }
  });

  it("names every allowed action in the schema and nothing else", () => {
    expect(PROPOSAL_SCHEMA).toContain("create_rule");
    expect(PROPOSAL_SCHEMA).toContain("create_template");
    expect(PROPOSAL_SCHEMA).toContain("mute_thread");
    expect(PROPOSAL_SCHEMA).toContain("snooze");
    // The guarantee, stated in the prompt the model actually sees.
    expect(PROPOSAL_SCHEMA.toLowerCase()).not.toContain("send_email");
    expect(PROPOSAL_SCHEMA.toLowerCase()).not.toContain("delete_message");
  });
});
