import { describe, expect, it } from "vitest";
import { parseProposal, describeProposal, PROPOSAL_SCHEMA } from "./agent-tools.js";

/**
 * Agent tool-use.
 *
 * Today the agent is a text generator: it reads a message, calls a model, and
 * returns prose. It cannot create a rule or a template — the user has to read
 * the suggestion and do the work by hand. That is not agentic, it is a
 * chatbot bolted to a mailbox.
 *
 * The fix is NOT to hand the model a function that writes to the store. It is
 * propose → show → approve → execute:
 *
 *   1. the model returns a structured proposal, not prose
 *   2. we parse and VALIDATE it — an unknown action is rejected outright
 *   3. the user sees exactly what it would do, in plain language
 *   4. one human click executes it
 *
 * The model never touches app state. It writes a suggestion; a person commits
 * it. That keeps "the agent cannot send or delete" structurally true while
 * making the agent actually useful.
 */

describe("parseProposal", () => {
  it("accepts a well-formed rule proposal", () => {
    const p = parseProposal(
      JSON.stringify({
        action: "create_rule",
        field: "from",
        contains: "newsletter@shop.example",
        then: "move",
        folder: "Archive",
        why: "You have never replied to this sender.",
      }),
    );
    expect(p?.action).toBe("create_rule");
    expect(p?.rule?.contains).toBe("newsletter@shop.example");
  });

  it("pulls the proposal out of prose the model wrapped it in", () => {
    // Small local models pad JSON with commentary no matter how you ask.
    const p = parseProposal(
      'Sure! Here is a rule:\n```json\n{"action":"create_rule","field":"from","contains":"a@b.c","then":"star"}\n```\nHope that helps.',
    );
    expect(p?.action).toBe("create_rule");
  });

  it("rejects an action that is not on the allow-list", () => {
    // The whole safety property. A model that asks to send must be refused by
    // the parser, not by a policy someone can later relax.
    expect(parseProposal(JSON.stringify({ action: "send_email", to: "x@y.z" }))).toBeNull();
    expect(parseProposal(JSON.stringify({ action: "delete_messages" }))).toBeNull();
    expect(parseProposal(JSON.stringify({ action: "run_shell", cmd: "rm -rf /" }))).toBeNull();
  });

  it("rejects a rule with nothing to match on", () => {
    // An empty pattern would file the entire mailbox.
    expect(
      parseProposal(JSON.stringify({ action: "create_rule", field: "from", contains: "", then: "star" })),
    ).toBeNull();
  });

  it("rejects a move with no destination", () => {
    expect(
      parseProposal(
        JSON.stringify({ action: "create_rule", field: "from", contains: "a@b.c", then: "move" }),
      ),
    ).toBeNull();
  });

  it("rejects an unknown field or action verb", () => {
    expect(
      parseProposal(JSON.stringify({ action: "create_rule", field: "password", contains: "x", then: "star" })),
    ).toBeNull();
    expect(
      parseProposal(JSON.stringify({ action: "create_rule", field: "from", contains: "x", then: "forward" })),
    ).toBeNull();
  });

  it("accepts a template proposal", () => {
    const p = parseProposal(
      JSON.stringify({
        action: "create_template",
        name: "Decline politely",
        body: "Thanks for thinking of me — I can't take this on right now.",
      }),
    );
    expect(p?.action).toBe("create_template");
    expect(p?.template?.name).toBe("Decline politely");
  });

  it("rejects a template with no body", () => {
    expect(parseProposal(JSON.stringify({ action: "create_template", name: "Empty" }))).toBeNull();
  });

  it("returns null on junk rather than throwing", () => {
    for (const junk of ["", "not json", "{", "[]", "null", "42"]) {
      expect(() => parseProposal(junk)).not.toThrow();
      expect(parseProposal(junk)).toBeNull();
    }
  });

  it("caps absurd lengths so a runaway model cannot bloat the store", () => {
    const p = parseProposal(
      JSON.stringify({
        action: "create_rule",
        field: "from",
        contains: "x".repeat(5000),
        then: "star",
      }),
    );
    expect((p?.rule?.contains ?? "").length).toBeLessThanOrEqual(300);
  });
});

describe("describeProposal", () => {
  it("explains a rule in words a person can check", () => {
    const p = parseProposal(
      JSON.stringify({
        action: "create_rule",
        field: "from",
        contains: "shop@x.example",
        then: "move",
        folder: "Archive",
      }),
    );
    const text = describeProposal(p!);
    expect(text).toContain("shop@x.example");
    expect(text.toLowerCase()).toContain("archive");
  });

  it("explains a template", () => {
    const p = parseProposal(
      JSON.stringify({ action: "create_template", name: "Decline", body: "No thanks" }),
    );
    expect(describeProposal(p!)).toContain("Decline");
  });
});

describe("PROPOSAL_SCHEMA", () => {
  it("tells the model the only actions that exist", () => {
    expect(PROPOSAL_SCHEMA).toContain("create_rule");
    expect(PROPOSAL_SCHEMA).toContain("create_template");
  });

  it("does not advertise sending or deleting as options", () => {
    expect(PROPOSAL_SCHEMA.toLowerCase()).not.toContain("send_email");
    expect(PROPOSAL_SCHEMA.toLowerCase()).not.toContain("delete");
  });
});
