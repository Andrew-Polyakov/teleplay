import { eq } from 'drizzle-orm';
import { matches } from '../db/schema.js';
import type { DomainContext } from './types.js';
import { DomainError } from './types.js';
import { getMatch, getParticipant, getMainParticipants, getBenchParticipants } from './matches.js';

/** Submits or updates the venue for a match. Restricted to participants; blocked once terminal. */
export function submitVenue(ctx: DomainContext, matchId: number, userId: number, venue: string) {
  const match = getMatch(ctx, matchId);
  if (!match) throw new DomainError(`Match ${matchId} not found`);

  const participant = getParticipant(ctx, matchId, userId);
  if (!participant) {
    throw new DomainError(`User ${userId} is not a participant of match ${matchId}`);
  }
  if (match.overallStatus === 'cancelled' || match.overallStatus === 'completed') {
    throw new DomainError(`Match ${matchId} is ${match.overallStatus} — venue can no longer be changed`);
  }

  const isUpdate = match.venue !== null && match.venue !== venue;
  const now = ctx.clock.now().getTime();
  const updated = ctx.db
    .update(matches)
    .set({ venue, updatedAt: now })
    .where(eq(matches.id, matchId))
    .returning()
    .get();

  if (isUpdate) {
    const everyone = [...getMainParticipants(ctx, matchId), ...getBenchParticipants(ctx, matchId)].filter(
      (p) => p.userId !== userId,
    );
    for (const p of everyone) {
      ctx.notify(p.userId, `The venue for your match changed to: ${venue}`);
    }
  }

  return updated;
}

export function isMatchReady(match: { overallStatus: string; venue: string | null }): boolean {
  return match.overallStatus === 'confirmed' && match.venue !== null;
}
