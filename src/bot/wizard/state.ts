import type { MatchType } from '../../db/schema.js';

export type WizardStep = 'type' | 'date' | 'time' | 'players' | 'bench' | 'summary';

/** Everything the /match wizard remembers between taps. Lives only in memory. */
export interface WizardState {
  telegramUserId: string;
  chatId: number;
  /** The message the wizard keeps editing in place; set after the first send. */
  messageId?: number;
  /** 'create' builds a new match; 'reschedule' picks a new time for `matchId`. */
  mode: 'create' | 'reschedule';
  /** The match being rescheduled (reschedule mode only). */
  matchId?: number;
  step: WizardStep;
  /** 'YYYY-MM' month currently shown on the calendar step. */
  calendarMonth: string;
  /** Player-picker page (players and bench steps). */
  page: number;
  type?: MatchType;
  /** 'YYYY-MM-DD' */
  date?: string;
  /** 'HHMM' */
  time?: string;
  /** Telegram user ids (`@username` / `id:123`) filling the other main slots. */
  players: string[];
  bench: string[];
  lastActivityAt: number;
}

export function requiredOtherMainCount(type: MatchType): number {
  return type === 'singles' ? 1 : 3;
}

export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Per-user wizard states. One wizard per user; starting a new one replaces the old.
 * Expiry is enforced both lazily on access and by the periodic sweep worker.
 */
export class WizardStore {
  private states = new Map<string, WizardState>();

  start(input: {
    telegramUserId: string;
    chatId: number;
    now: Date;
    mode?: 'create' | 'reschedule';
    matchId?: number;
  }): WizardState {
    const mode = input.mode ?? 'create';
    const state: WizardState = {
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      mode,
      matchId: input.matchId,
      // Reschedule already knows the match type/players — it starts straight at the date.
      step: mode === 'reschedule' ? 'date' : 'type',
      calendarMonth: monthKey(input.now),
      page: 0,
      players: [],
      bench: [],
      lastActivityAt: input.now.getTime(),
    };
    this.states.set(input.telegramUserId, state);
    return state;
  }

  /** Returns the user's live wizard, purging (and returning undefined for) an expired one. */
  get(telegramUserId: string, now: Date, timeoutMinutes: number): WizardState | undefined {
    const state = this.states.get(telegramUserId);
    if (!state) return undefined;
    if (now.getTime() - state.lastActivityAt > timeoutMinutes * 60_000) {
      this.states.delete(telegramUserId);
      return undefined;
    }
    return state;
  }

  touch(state: WizardState, now: Date) {
    state.lastActivityAt = now.getTime();
  }

  clear(telegramUserId: string) {
    this.states.delete(telegramUserId);
  }

  /** Drops every wizard idle past the timeout; returns how many were purged. */
  sweep(now: Date, timeoutMinutes: number): number {
    let purged = 0;
    for (const [key, state] of this.states) {
      if (now.getTime() - state.lastActivityAt > timeoutMinutes * 60_000) {
        this.states.delete(key);
        purged += 1;
      }
    }
    return purged;
  }
}
