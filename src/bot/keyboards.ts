import { InlineKeyboard } from 'grammy';
import type { NotificationAction } from '../domain/types.js';

/** Builds a confirm/decline inline keyboard for a match invitation. */
export function matchInviteKeyboard(matchId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('Confirm', `match:confirm:${matchId}`)
    .text('Decline', `match:decline:${matchId}`);
}

/** Builds a confirm/decline inline keyboard for a bench standby invitation. */
export function benchStandbyKeyboard(matchId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('Available', `bench:confirm:${matchId}`)
    .text('Not available', `bench:decline:${matchId}`);
}

/** Builds an accept/decline inline keyboard for an invitation-queue offer. */
export function invitationQueueKeyboard(entryId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('Accept', `invite:accept:${entryId}`)
    .text('Decline', `invite:decline:${entryId}`);
}

/** Maps a domain-level NotificationAction to the concrete inline keyboard to attach. */
export function keyboardForAction(action: NotificationAction): InlineKeyboard {
  switch (action.kind) {
    case 'matchInvite':
      return matchInviteKeyboard(action.matchId);
    case 'benchInvite':
      return benchStandbyKeyboard(action.matchId);
    case 'invitationOffer':
      return invitationQueueKeyboard(action.entryId);
  }
}
