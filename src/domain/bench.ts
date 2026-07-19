import { and, eq } from 'drizzle-orm';
import { matchParticipants } from '../db/schema.js';
import type { DomainContext } from './types.js';
import { DomainError } from './types.js';
import { findUserByTelegramId } from './users.js';
import { getMatch, getParticipant, buildBenchStandbyInviteMessage, UnregisteredParticipantError } from './matches.js';

export { UnregisteredParticipantError };

/** Attaches one or more bench/standby players to a doubles match. Rejected for singles. */
export function addBenchPlayers(ctx: DomainContext, matchId: number, telegramUserIds: string[]) {
  const match = getMatch(ctx, matchId);
  if (!match) throw new DomainError(`Match ${matchId} not found`);
  if (match.type !== 'doubles') {
    throw new DomainError('Bench players are only supported for doubles matches');
  }

  const users = telegramUserIds.map((tid) => {
    const user = findUserByTelegramId(ctx, tid);
    if (!user) throw new UnregisteredParticipantError(tid);
    return user;
  });

  const now = ctx.clock.now().getTime();
  const added = users.map((user) => {
    const row = ctx.db
      .insert(matchParticipants)
      .values({
        matchId,
        userId: user.id,
        slotType: 'bench',
        participantStatus: 'invited',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    ctx.notify(user.id, buildBenchStandbyInviteMessage(ctx, matchId), { kind: 'benchInvite', matchId });
    return row;
  });
  return added;
}

function getBenchParticipant(ctx: DomainContext, matchId: number, userId: number) {
  const participant = getParticipant(ctx, matchId, userId);
  if (!participant || participant.slotType !== 'bench') {
    throw new DomainError(`User ${userId} is not a bench participant of match ${matchId}`);
  }
  return participant;
}

export function confirmBenchStandby(ctx: DomainContext, matchId: number, userId: number) {
  const participant = getBenchParticipant(ctx, matchId, userId);
  const now = ctx.clock.now().getTime();
  return ctx.db
    .update(matchParticipants)
    .set({ participantStatus: 'standby-confirmed', updatedAt: now })
    .where(eq(matchParticipants.id, participant.id))
    .returning()
    .get();
}

export function declineBenchStandby(ctx: DomainContext, matchId: number, userId: number) {
  const participant = getBenchParticipant(ctx, matchId, userId);
  const now = ctx.clock.now().getTime();
  return ctx.db
    .update(matchParticipants)
    .set({ participantStatus: 'declined', updatedAt: now })
    .where(eq(matchParticipants.id, participant.id))
    .returning()
    .get();
}

export function getStandbyConfirmedBenchPlayers(ctx: DomainContext, matchId: number) {
  return ctx.db
    .select()
    .from(matchParticipants)
    .where(
      and(
        eq(matchParticipants.matchId, matchId),
        eq(matchParticipants.slotType, 'bench'),
        eq(matchParticipants.participantStatus, 'standby-confirmed'),
      ),
    )
    .all();
}
