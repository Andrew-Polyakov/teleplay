/**
 * Per-user pending "reply with text" prompts (currently: venue entry from the menu).
 * Same in-memory + idle-expiry stance as the wizard store. A user has at most one
 * pending text interaction: starting a wizard clears their prompt and vice versa.
 */
export interface VenuePrompt {
  telegramUserId: string;
  matchId: number;
  lastActivityAt: number;
}

export class PromptStore {
  private prompts = new Map<string, VenuePrompt>();

  start(input: { telegramUserId: string; matchId: number; now: Date }): VenuePrompt {
    const prompt: VenuePrompt = {
      telegramUserId: input.telegramUserId,
      matchId: input.matchId,
      lastActivityAt: input.now.getTime(),
    };
    this.prompts.set(input.telegramUserId, prompt);
    return prompt;
  }

  get(telegramUserId: string, now: Date, timeoutMinutes: number): VenuePrompt | undefined {
    const prompt = this.prompts.get(telegramUserId);
    if (!prompt) return undefined;
    if (now.getTime() - prompt.lastActivityAt > timeoutMinutes * 60_000) {
      this.prompts.delete(telegramUserId);
      return undefined;
    }
    return prompt;
  }

  clear(telegramUserId: string) {
    this.prompts.delete(telegramUserId);
  }

  sweep(now: Date, timeoutMinutes: number): number {
    let purged = 0;
    for (const [key, prompt] of this.prompts) {
      if (now.getTime() - prompt.lastActivityAt > timeoutMinutes * 60_000) {
        this.prompts.delete(key);
        purged += 1;
      }
    }
    return purged;
  }
}
