import type { AppDatabase } from '../db/client.js';

export type { MatchType, MatchStatus, ParticipantStatus, SlotType, InvitationQueueStatus } from '../db/schema.js';

/** Injectable clock so domain logic and workers are deterministic in tests. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/**
 * Describes the action buttons that should accompany a notification, without the domain
 * layer depending on any Telegram-specific keyboard type. The bot layer maps these to
 * real inline keyboards (see src/bot/keyboards.ts).
 */
export type NotificationAction =
  | { kind: 'matchInvite'; matchId: number }
  | { kind: 'benchInvite'; matchId: number }
  | { kind: 'invitationOffer'; entryId: number };

/** Sends a message to a user; the bot layer wires this to the live Telegram API. */
export type Notifier = (userId: number, text: string, action?: NotificationAction) => Promise<void> | void;

export interface DomainContext {
  db: AppDatabase;
  clock: Clock;
  notify: Notifier;
}

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
