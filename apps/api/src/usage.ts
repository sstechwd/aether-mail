export type UsageSnap = {
  promptTokens: number;
  lastCompletion: number;
  cap: number;
  updatedAt: string;
};

let last: UsageSnap = {
  promptTokens: 0,
  lastCompletion: 0,
  cap: 80,
  updatedAt: "",
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function recordUsage(input: { promptChars: number; completion: number; cap?: number }): UsageSnap {
  last = {
    promptTokens: Math.ceil(input.promptChars / 4),
    lastCompletion: input.completion,
    cap: input.cap ?? 80,
    updatedAt: new Date().toISOString(),
  };
  return { ...last };
}

export function usageSnapshot(): UsageSnap {
  return { ...last };
}
