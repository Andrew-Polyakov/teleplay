import { and, asc, eq } from 'drizzle-orm';
import { matches, matchParticipants } from '../db/schema.js';
import type { MatchType } from '../db/schema.js';
import type { DomainContext } from './types.js';
import { DomainError } from './types.js';
import { findUserByTelegramId } from './users.js';
import { declareCandidateQueue } from './invitationQueue.js';

export class UnregisteredParticipantError extends DomainError {
  constructor(public telegramUserId: string) {
    super(`Participant ${telegramUserId} has not started the bot yet`);
  }
}

export type MainParticipantSpec =
  | { kind: 'direct'; telegramUserId: string }
  | { kind: 'queue'; candidateTelegramUserIds: string[] };

export interface CreateMatchInput {
  type: MatchType;
  scheduledAt: Date;
  creatorTelegramUserId: string;
  /** Specs for the main slots OTHER than the creator's: 1 for singles, 3 for doubles. */
  otherMainParticipants: MainParticipantSpec[];
  benchTelegramUserIds?: string[];
}

function expectedMainSlots(type: MatchType): number {
  return type === 'singles' ? 2 : 4;
}

function resolveUserOrThrow(ctx: DomainContext, telegramUserId: string) {
  const user = findUserByTelegramId(ctx, telegramUserId);
  if (!user) throw new UnregisteredParticipantError(telegramUserId);
  return user;
}

export function createMatch(ctx: DomainContext, input: CreateMatchInput) {
  const expectedOthers = expectedMainSlots(input.type) - 1;
  if (input.otherMainParticipants.length !== expectedOthers) {
    throw new DomainError(
      `${input.type} match needs ${expectedOthers} other main participant slot(s), got ${input.otherMainParticipants.length}`,
    );
  }
  if (input.benchTelegramUserIds?.length && input.type !== 'doubles') {
    throw new DomainError('Bench players are only supported for doubles matches');
  }

  const creator = resolveUserOrThrow(ctx, input.creatorTelegramUserId);

  // Validate every directly-named / queued participant is registered before writing anything.
  for (const spec of input.otherMainParticipants) {
    if (spec.kind === 'direct') {
      resolveUserOrThrow(ctx, spec.telegramUserId);
    } else {
      for (const tid of spec.candidateTelegramUserIds) resolveUserOrThrow(ctx, tid);
    }
  }
  const benchUsers = (input.benchTelegramUserIds ?? []).map((tid) => resolveUserOrThrow(ctx, tid));

  const now = ctx.clock.now().getTime();
  const match = ctx.db
    .insert(matches)
    .values({
      type: input.type,
      scheduledAt: input.scheduledAt.getTime(),
      overallStatus: 'pending',
      createdByUserId: creator.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  ctx.db
    .insert(matchParticipants)
    .values({
      matchId: match.id,
      userId: creator.id,
      slotType: 'main',
      participantStatus: 'confirmed',
      createdAt: now,
      updatedAt: now,
    })
    .run();

  let queueSlotIndex = 0;
  for (const spec of input.otherMainParticipants) {
    if (spec.kind === 'direct') {
      const invitee = resolveUserOrThrow(ctx, spec.telegramUserId);
      ctx.db
        .insert(matchParticipants)
        .values({
          matchId: match.id,
          userId: invitee.id,
          slotType: 'main',
          participantStatus: 'invited',
          createdAt: now,
          updatedAt: now,
        })
        .run();
      ctx.notify(invitee.id, buildMatchInviteMessage(ctx, match.id), { kind: 'matchInvite', matchId: match.id });
    } else {
      const candidateUserIds = spec.candidateTelegramUserIds.map((tid) => resolveUserOrThrow(ctx, tid).id);
      declareCandidateQueue(ctx, {
        matchId: match.id,
        slotType: 'main',
        slotIndex: queueSlotIndex,
        candidateUserIds,
        declaredByUserId: creator.id,
      });
      queueSlotIndex += 1;
    }
  }

  for (const benchUser of benchUsers) {
    ctx.db
      .insert(matchParticipants)
      .values({
        matchId: match.id,
        userId: benchUser.id,
        slotType: 'bench',
        participantStatus: 'invited',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    ctx.notify(benchUser.id, buildBenchStandbyInviteMessage(ctx, match.id), {
      kind: 'benchInvite',
      matchId: match.id,
    });
  }

  return checkAndConfirmMatch(ctx, match.id);
}

export function getMatch(ctx: DomainContext, matchId: number) {
  return ctx.db.select().from(matches).where(eq(matches.id, matchId)).get();
}

export function getMainParticipants(ctx: DomainContext, matchId: number) {
  return ctx.db
    .select()
    .from(matchParticipants)
    .where(and(eq(matchParticipants.matchId, matchId), eq(matchParticipants.slotType, 'main')))
    .orderBy(asc(matchParticipants.id))
    .all();
}

export function getBenchParticipants(ctx: DomainContext, matchId: number) {
  return ctx.db
    .select()
    .from(matchParticipants)
    .where(and(eq(matchParticipants.matchId, matchId), eq(matchParticipants.slotType, 'bench')))
    .orderBy(asc(matchParticipants.id))
    .all();
}

export function getParticipant(ctx: DomainContext, matchId: number, userId: number) {
  return ctx.db
    .select()
    .from(matchParticipants)
    .where(and(eq(matchParticipants.matchId, matchId), eq(matchParticipants.userId, userId)))
    .get();
}

/**
 * Re-evaluates a match's overallStatus. Idempotent, safe to call after any participant
 * status change. Once every main slot (by match type) is confirmed, transitions to
 * `confirmed` — applying any staged reschedule (pendingScheduledAt/pendingVenue) at the
 * same time, since that's the only path back to `confirmed` after a reschedule proposal.
 */
export function checkAndConfirmMatch(ctx: DomainContext, matchId: number) {
  const match = getMatch(ctx, matchId);
  if (!match) throw new DomainError(`Match ${matchId} not found`);
  if (match.overallStatus !== 'pending') return match;

  const mainParticipants = getMainParticipants(ctx, matchId);
  const confirmedCount = mainParticipants.filter((p) => p.participantStatus === 'confirmed').length;
  if (confirmedCount < expectedMainSlots(match.type)) return match;

  const now = ctx.clock.now().getTime();
  const applied = ctx.db
    .update(matches)
    .set({
      overallStatus: 'confirmed',
      scheduledAt: match.pendingScheduledAt ?? match.scheduledAt,
      venue: match.pendingVenue ?? match.venue,
      pendingScheduledAt: null,
      pendingVenue: null,
      // A reschedule may have changed the time, so any previous reminder no longer applies.
      reminderSentAt: match.pendingScheduledAt !== null ? null : match.reminderSentAt,
      updatedAt: now,
    })
    .where(eq(matches.id, matchId))
    .returning()
    .get();
  return applied;
}

export function confirmMainParticipant(ctx: DomainContext, matchId: number, userId: number) {
  const participant = getParticipant(ctx, matchId, userId);
  if (!participant || participant.slotType !== 'main') {
    throw new DomainError(`User ${userId} is not a main participant of match ${matchId}`);
  }
  const now = ctx.clock.now().getTime();
  ctx.db
    .update(matchParticipants)
    .set({ participantStatus: 'confirmed', updatedAt: now })
    .where(eq(matchParticipants.id, participant.id))
    .run();
  return checkAndConfirmMatch(ctx, matchId);
}

export function declineMainParticipant(ctx: DomainContext, matchId: number, userId: number) {
  const participant = getParticipant(ctx, matchId, userId);
  if (!participant || participant.slotType !== 'main') {
    throw new DomainError(`User ${userId} is not a main participant of match ${matchId}`);
  }
  const now = ctx.clock.now().getTime();
  ctx.db
    .update(matchParticipants)
    .set({ participantStatus: 'declined', updatedAt: now })
    .where(eq(matchParticipants.id, participant.id))
    .run();

  const others = getMainParticipants(ctx, matchId).filter((p) => p.userId !== userId);
  for (const other of others) {
    ctx.notify(other.userId, `A player declined the match invitation — the match cannot proceed as configured.`);
  }
  return getMatch(ctx, matchId);
}

export function buildMatchInviteMessage(ctx: DomainContext, matchId: number): string {
  const match = getMatch(ctx, matchId);
  if (!match) throw new DomainError(`Match ${matchId} not found`);
  return formatMatchSummary(match);
}

export function buildBenchStandbyInviteMessage(ctx: DomainContext, matchId: number): string {
  const match = getMatch(ctx, matchId);
  if (!match) throw new DomainError(`Match ${matchId} not found`);
  return `You've been added as a bench/standby player for: ${formatMatchSummary(match)}`;
}

export function formatMatchSummary(match: { type: MatchType; scheduledAt: number; venue: string | null }): string {
  const when = new Date(match.scheduledAt).toISOString();
  const venue = match.venue ?? 'venue TBD';
  return `${match.type} match at ${when} — ${venue}`;
}
