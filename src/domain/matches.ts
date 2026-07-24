import { and, asc, eq } from 'drizzle-orm';
import { matches, matchParticipants } from '../db/schema.js';
import type { MatchType } from '../db/schema.js';
import type { DomainContext } from './types.js';
import { DomainError } from './types.js';
import { findUserById, findUserByTelegramId } from './users.js';
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
  // Insert every participant row before sending anything, so each invitation can name
  // the full lineup — not just whoever happened to be inserted before it.
  const directInvitees: { id: number }[] = [];
  const queueSpecs: { slotIndex: number; candidateUserIds: number[] }[] = [];
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
      directInvitees.push(invitee);
    } else {
      queueSpecs.push({
        slotIndex: queueSlotIndex,
        candidateUserIds: spec.candidateTelegramUserIds.map((tid) => resolveUserOrThrow(ctx, tid).id),
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
  }

  for (const invitee of directInvitees) {
    ctx.notify(invitee.id, buildMatchInviteMessage(ctx, match.id, invitee.id), {
      kind: 'matchInvite',
      matchId: match.id,
    });
  }
  for (const benchUser of benchUsers) {
    ctx.notify(benchUser.id, buildBenchStandbyInviteMessage(ctx, match.id, benchUser.id), {
      kind: 'benchInvite',
      matchId: match.id,
    });
  }
  for (const queueSpec of queueSpecs) {
    declareCandidateQueue(ctx, {
      matchId: match.id,
      slotType: 'main',
      slotIndex: queueSpec.slotIndex,
      candidateUserIds: queueSpec.candidateUserIds,
      declaredByUserId: creator.id,
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
  // Re-confirming is a no-op; without this guard a repeated /confirm would re-notify everyone.
  const alreadyConfirmed = participant.participantStatus === 'confirmed';
  const now = ctx.clock.now().getTime();
  ctx.db
    .update(matchParticipants)
    .set({ participantStatus: 'confirmed', updatedAt: now })
    .where(eq(matchParticipants.id, participant.id))
    .run();
  const match = checkAndConfirmMatch(ctx, matchId);

  if (!alreadyConfirmed) {
    const confirmerName = findUserById(ctx, userId)?.telegramUserId ?? `user ${userId}`;
    const mains = getMainParticipants(ctx, matchId);
    const remaining = expectedMainSlots(match.type) - mains.filter((p) => p.participantStatus === 'confirmed').length;
    const text =
      match.overallStatus === 'confirmed'
        ? `✅ ${confirmerName} confirmed — everyone is in, match is on! 🎾 ${formatMatchSummary(match)}`
        : `✅ ${confirmerName} confirmed: ${formatMatchSummary(match)}. Waiting on ${remaining} more player(s).`;
    for (const other of mains.filter((p) => p.userId !== userId && p.participantStatus !== 'declined')) {
      ctx.notify(other.userId, text);
    }
  }
  return match;
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

function formatDateTime(scheduledAtMs: number): string {
  const date = new Date(scheduledAtMs);
  const day = date.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day} at ${hh}:${mm} UTC`;
}

/**
 * The 📅/👥/📍 detail lines shared by invite, bench, and queue-offer messages, so a
 * recipient always sees when, with whom, and where. Their own slot reads "you".
 */
export function buildMatchDetails(ctx: DomainContext, matchId: number, recipientUserId?: number): string {
  const match = getMatch(ctx, matchId);
  if (!match) throw new DomainError(`Match ${matchId} not found`);
  const players = getMainParticipants(ctx, matchId).map((p) =>
    p.userId === recipientUserId ? 'you' : (findUserById(ctx, p.userId)?.telegramUserId ?? `user ${p.userId}`),
  );
  return [
    `📅 ${formatDateTime(match.scheduledAt)}`,
    `👥 ${players.join(', ')}`,
    `📍 ${match.venue ?? 'venue TBD'}`,
  ].join('\n');
}

export function buildMatchInviteMessage(ctx: DomainContext, matchId: number, recipientUserId?: number): string {
  const match = getMatch(ctx, matchId);
  if (!match) throw new DomainError(`Match ${matchId} not found`);
  const creator = findUserById(ctx, match.createdByUserId);
  return `🎾 ${creator?.telegramUserId ?? 'Someone'} invited you to a ${match.type} match\n${buildMatchDetails(ctx, matchId, recipientUserId)}`;
}

export function buildBenchStandbyInviteMessage(ctx: DomainContext, matchId: number, recipientUserId?: number): string {
  const match = getMatch(ctx, matchId);
  if (!match) throw new DomainError(`Match ${matchId} not found`);
  return `🎾 You've been added as a bench (standby) player for a ${match.type} match\n${buildMatchDetails(ctx, matchId, recipientUserId)}`;
}

export function formatMatchSummary(match: { type: MatchType; scheduledAt: number; venue: string | null }): string {
  const venue = match.venue ?? 'venue TBD';
  return `${match.type} match on ${formatDateTime(match.scheduledAt)} — ${venue}`;
}
