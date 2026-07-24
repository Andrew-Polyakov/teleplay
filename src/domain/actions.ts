import type { DomainContext } from './types.js';
import { getMatch, getParticipant } from './matches.js';

export interface MatchActions {
  venue: boolean;
  reschedule: boolean;
  retire: boolean;
  cancel: boolean;
}

const NONE: MatchActions = { venue: false, reschedule: false, retire: false, cancel: false };

/**
 * Which actions the menu should offer for this match+player. This is a visibility filter
 * only — every action's domain function re-validates on execution, so this never needs to
 * be the enforcement point. Mirrors: venue/cancel need any participant on a non-terminal
 * match; reschedule needs a main participant; retire needs a confirmed main participant
 * of a confirmed doubles match.
 */
export function availableMatchActions(ctx: DomainContext, matchId: number, userId: number): MatchActions {
  const match = getMatch(ctx, matchId);
  if (!match || match.overallStatus === 'cancelled' || match.overallStatus === 'completed') return NONE;
  const participant = getParticipant(ctx, matchId, userId);
  if (!participant) return NONE;

  const isMain = participant.slotType === 'main';
  return {
    venue: true,
    cancel: true,
    reschedule: isMain,
    retire:
      match.type === 'doubles' &&
      match.overallStatus === 'confirmed' &&
      isMain &&
      participant.participantStatus === 'confirmed',
  };
}
