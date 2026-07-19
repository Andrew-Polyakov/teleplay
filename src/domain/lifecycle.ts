import { and, eq, inArray } from 'drizzle-orm';
import { matches, matchParticipants, invitationQueueEntries } from '../db/schema.js';
import type { DomainContext } from './types.js';
import { DomainError } from './types.js';
import { getMatch, getMainParticipants, getBenchParticipants, getParticipant } from './matches.js';
import { getStandbyConfirmedBenchPlayers } from './bench.js';
import { declareCandidateQueue } from './invitationQueue.js';

export interface CancelResult {
  alreadyCancelled: boolean;
}

/** Cancels a match. A no-op (not an error) if it's already cancelled, per spec. */
export function cancelMatch(ctx: DomainContext, matchId: number, userId: number): CancelResult {
  const match = getMatch(ctx, matchId);
  if (!match) throw new DomainError(`Match ${matchId} not found`);
  const participant = getParticipant(ctx, matchId, userId);
  if (!participant) throw new DomainError(`User ${userId} is not a participant of match ${matchId}`);

  if (match.overallStatus === 'cancelled') {
    return { alreadyCancelled: true };
  }

  const now = ctx.clock.now().getTime();
  ctx.db
    .update(matches)
    .set({ overallStatus: 'cancelled', updatedAt: now })
    .where(eq(matches.id, matchId))
    .run();

  // Close out any open invitation-queue activity for this match — nobody should be invited to a cancelled match.
  ctx.db
    .update(invitationQueueEntries)
    .set({ status: 'closed', updatedAt: now })
    .where(
      and(
        eq(invitationQueueEntries.matchId, matchId),
        inArray(invitationQueueEntries.status, ['queued', 'invited']),
      ),
    )
    .run();

  const others = [...getMainParticipants(ctx, matchId), ...getBenchParticipants(ctx, matchId)].filter(
    (p) => p.userId !== userId,
  );
  for (const other of others) {
    ctx.notify(other.userId, `The match was cancelled by ${userId}.`);
  }
  return { alreadyCancelled: false };
}

export interface ProposeRescheduleInput {
  matchId: number;
  proposerUserId: number;
  newScheduledAt?: Date;
  newVenue?: string;
}

/** Proposes a new time/venue, resetting main participants to `invited` (except the proposer) for re-confirmation. */
export function proposeReschedule(ctx: DomainContext, input: ProposeRescheduleInput) {
  const match = getMatch(ctx, input.matchId);
  if (!match) throw new DomainError(`Match ${input.matchId} not found`);
  if (match.overallStatus === 'cancelled' || match.overallStatus === 'completed') {
    throw new DomainError(`Match ${input.matchId} is ${match.overallStatus} — it cannot be rescheduled`);
  }
  const proposer = getParticipant(ctx, input.matchId, input.proposerUserId);
  if (!proposer || proposer.slotType !== 'main') {
    throw new DomainError(`User ${input.proposerUserId} is not a main participant of match ${input.matchId}`);
  }

  const now = ctx.clock.now().getTime();
  ctx.db
    .update(matches)
    .set({
      overallStatus: 'pending',
      pendingScheduledAt: input.newScheduledAt ? input.newScheduledAt.getTime() : match.pendingScheduledAt,
      pendingVenue: input.newVenue ?? match.pendingVenue,
      updatedAt: now,
    })
    .where(eq(matches.id, input.matchId))
    .run();

  const mainParticipants = getMainParticipants(ctx, input.matchId);
  for (const participant of mainParticipants) {
    const isProposer = participant.userId === input.proposerUserId;
    ctx.db
      .update(matchParticipants)
      .set({ participantStatus: isProposer ? 'confirmed' : 'invited', updatedAt: now })
      .where(eq(matchParticipants.id, participant.id))
      .run();
    if (!isProposer) {
      ctx.notify(participant.userId, `A reschedule was proposed for match ${input.matchId} — please re-confirm.`);
    }
  }

  return getMatch(ctx, input.matchId);
}

export interface RetireInput {
  matchId: number;
  retiringUserId: number;
}

/**
 * A main doubles participant retires; the vacated slot is offered to standby-confirmed bench
 * players in their declared (insertion) order via the invitation queue. Does not touch
 * `overallStatus` — the match stays `confirmed` throughout the call-up.
 */
export function retireFromDoublesMatch(ctx: DomainContext, input: RetireInput) {
  const match = getMatch(ctx, input.matchId);
  if (!match) throw new DomainError(`Match ${input.matchId} not found`);
  if (match.type !== 'doubles') {
    throw new DomainError('Retirement/bench call-up is only supported for doubles matches');
  }
  if (match.overallStatus !== 'confirmed') {
    throw new DomainError(`Match ${input.matchId} must be confirmed before a player can retire`);
  }
  const retiring = getParticipant(ctx, input.matchId, input.retiringUserId);
  if (!retiring || retiring.slotType !== 'main' || retiring.participantStatus !== 'confirmed') {
    throw new DomainError(`User ${input.retiringUserId} is not a confirmed main participant of match ${input.matchId}`);
  }

  const now = ctx.clock.now().getTime();
  ctx.db
    .update(matchParticipants)
    .set({ participantStatus: 'replaced', updatedAt: now })
    .where(eq(matchParticipants.id, retiring.id))
    .run();

  const benchCandidates = getStandbyConfirmedBenchPlayers(ctx, input.matchId);
  if (benchCandidates.length === 0) {
    // No bench players available to call up — the match remains cancellable via the existing flow.
    return { calledUp: false as const };
  }

  declareCandidateQueue(ctx, {
    matchId: input.matchId,
    slotType: 'main',
    // Uses the vacated participant row's id so a concurrent second retirement gets its own queue.
    slotIndex: retiring.id,
    candidateUserIds: benchCandidates.map((b) => b.userId),
    declaredByUserId: match.createdByUserId,
  });
  return { calledUp: true as const };
}
