export type ChatRole = "user" | "assistant" | "system";

export type ChatTurn = {
  role: ChatRole;
  text: string;
};

const MAX_TURNS = 8;

export class ChatThread {
  private turns: ChatTurn[] = [];

  list(): ChatTurn[] {
    return [...this.turns];
  }

  add(role: ChatRole, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.turns.push({ role, text: trimmed.slice(0, 1500) });
    if (this.turns.length > MAX_TURNS) {
      this.turns = this.turns.slice(-MAX_TURNS);
    }
  }

  promptBlock(): string {
    return this.turns.map((t) => `${t.role}: ${t.text}`).join("\n");
  }

  clear(): void {
    this.turns = [];
  }
}
