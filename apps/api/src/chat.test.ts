import { describe, expect, it } from "vitest";
import { ChatThread } from "./chat.js";

describe("ChatThread", () => {
  it("caps history at 8 turns for a lean context window", () => {
    const thread = new ChatThread();
    for (let i = 0; i < 12; i++) thread.add("user", `m${i}`);
    expect(thread.list()).toHaveLength(8);
    expect(thread.list()[0].text).toBe("m4");
  });
});
