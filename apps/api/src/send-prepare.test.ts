import { describe, expect, it } from "vitest";
import { prepareSend } from "./send-prepare.js";

describe("prepareSend", () => {
  it("uses the sender as To when confirming a draft-reply on an inbox message", () => {
    const out = prepareSend({
      draft: "Thanks, Thursday works.",
      source: {
        folder: "INBOX",
        from: "Priya Shah <priya@example.com>",
        to: "you@localhost",
        subject: "Thursday",
        body: "Can we do 9:30?",
      },
    });
    expect(out.to).toBe("priya@example.com");
    expect(out.subject).toBe("Re: Thursday");
    expect(out.body).toContain("Thursday works");
  });

  it("uses the Drafts row when the agent draft state is empty", () => {
    const out = prepareSend({
      draft: "",
      source: {
        folder: "Drafts",
        from: "you@localhost",
        to: "priya@example.com",
        subject: "Re: Thursday",
        body: "See you then.",
      },
    });
    expect(out.to).toBe("priya@example.com");
    expect(out.body).toBe("See you then.");
  });
});
