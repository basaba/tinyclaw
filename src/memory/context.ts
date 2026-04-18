import type { MemoryStore } from "./store.js";

export interface ContextMessage {
  role: string;
  content: string;
}

export class ContextBuilder {
  constructor(
    private store: MemoryStore,
    private tokenBudget: number,
  ) {}

  buildContext(conversationId: string, systemPrompt: string): ContextMessage[] {
    const messages: ContextMessage[] = [];
    const systemTokens = this.estimateTokens(systemPrompt);
    let remaining = this.tokenBudget - systemTokens;

    messages.push({ role: "system", content: systemPrompt });

    // Fetch recent messages (most recent first via limit)
    const allMessages = this.store.getMessages(conversationId, 200);

    // allMessages is most-recent-first when limit is provided; reverse to build from oldest
    const chronological = [...allMessages].reverse();

    // Walk from most recent backwards, collecting messages that fit
    const selected: ContextMessage[] = [];
    for (let i = chronological.length - 1; i >= 0; i--) {
      const msg = chronological[i];
      const tokens = msg.token_count ?? this.estimateTokens(msg.content);
      if (tokens > remaining) break;
      remaining -= tokens;
      selected.unshift({ role: msg.role, content: msg.content });
    }

    messages.push(...selected);
    return messages;
  }

  getRelevantMemory(namespace: string, keys?: string[]): Record<string, string> {
    const result: Record<string, string> = {};

    if (keys) {
      for (const key of keys) {
        const value = this.store.getMemory(namespace, key);
        if (value !== undefined) {
          result[key] = value;
        }
      }
    }

    return result;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
