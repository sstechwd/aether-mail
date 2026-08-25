import { describe, expect, it } from "vitest";
import { planBatch } from "./batchrules.js";

/**
 * Accepting several suggestions at once.
 *
 * The suggestions panel already computes five candidates. Accepting them one
 * at a time means five confirmations and five backlog sweeps, which is exactly
 * the friction the feature was meant to remove.
 *
 * THE SEMANTICS ARE THE DESIGN. A batch where one entry is malformed must not
 * half-apply: validating inside the loop is how a bulk endpoint ends up having
 * created three rules and then failing, leaving the user to work out which
 * three. Validate everything first, then mutate — the same lesson the bulk
 * message endpoint taught when it returned 200 for an unknown action.
 */

describe("planBatch", () => {
  it("accepts a well-formed batch", () => {
    const plan = planBatch([
      { match: "amazon.com", folder: "Archive" },
      { match: "gog.com", folder: "Archive" },
    ]);
    expect(plan.ok).toBe(true);
    expect(plan.rules).toHaveLength(2);
  });

  it("refuses an empty batch rather than reporting success on nothing", () => {
    const plan = planBatch([]);
    expect(plan.ok).toBe(false);
    expect(plan.error).toBe("no_entries");
  });

  it("rejects the WHOLE batch when one entry is malformed", () => {
    // The property that matters: nothing is created if anything is wrong.
    const plan = planBatch([
      { match: "amazon.com", folder: "Archive" },
      { match: "", folder: "Archive" },
      { match: "gog.com", folder: "Archive" },
    ]);
    expect(plan.ok).toBe(false);
    expect(plan.rules).toHaveLength(0);
    expect(plan.error).toBe("empty_match");
  });

  it("refuses an entry with no destination folder", () => {
    const plan = planBatch([{ match: "amazon.com", folder: "" }]);
    expect(plan.ok).toBe(false);
    expect(plan.error).toBe("no_folder");
  });

  it("refuses a destination that is not a plain folder name", () => {
    // A folder name arrives from the client; never let it carry a path.
    for (const bad of ["../etc", "a/b", "a\\b"]) {
      expect(planBatch([{ match: "x.example", folder: bad }]).ok).toBe(false);
    }
  });

  it("caps the batch so one request cannot create hundreds of rules", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      match: `d${i}.example`,
      folder: "Archive",
    }));
    const plan = planBatch(many);
    expect(plan.ok).toBe(false);
    expect(plan.error).toBe("too_many");
  });

  it("drops a duplicate match rather than creating two identical rules", () => {
    const plan = planBatch([
      { match: "amazon.com", folder: "Archive" },
      { match: "AMAZON.COM", folder: "Archive" },
    ]);
    expect(plan.ok).toBe(true);
    expect(plan.rules).toHaveLength(1);
  });

  it("trims whitespace so a stray space is not a different rule", () => {
    const plan = planBatch([{ match: "  amazon.com  ", folder: " Archive " }]);
    expect(plan.rules[0].contains).toBe("amazon.com");
    expect(plan.rules[0].folder).toBe("Archive");
  });

  it("always produces a move rule on the from field", () => {
    // Suggestions are about senders. No other shape is reachable from here,
    // which keeps the batch endpoint from becoming a general rule writer.
    const plan = planBatch([{ match: "x.example", folder: "Archive" }]);
    expect(plan.rules[0].field).toBe("from");
    expect(plan.rules[0].action).toBe("move");
  });
});
