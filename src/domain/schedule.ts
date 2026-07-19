import { asc, eq, inArray } from 'drizzle-orm';
import { matches, matchParticipants } from '../db/schema.js';
import type { DomainContext } from './types.js';
import { getPendingInvitationsForUser } from './invitationQueue.js';

export interface ScheduledMatchView {
  matchId: number;
  type: string;
  scheduledAt: number;
  overallStatus: string;
  venue: string | null;
  slotType: string;
}

/** Matches the user is a main/bench participant of, still pending or confirmed, soonest first. */
export function getUpcomingMatchesForUser(ctx: DomainContext, userId: number): ScheduledMatchView[] {
  const participantRows = ctx.db
    .select()
    .from(matchParticipants)
    .where(eq(matchParticipants.userId, userId))
    .all();

  const matchIds = participantRows.map((p) => p.matchId);
  if (matchIds.length === 0) return [];

  const matchRows = ctx.db
    .select()
    .from(matches)
    .where(inArray(matches.id, matchIds))
    .orderBy(asc(matches.scheduledAt))
    .all()
    .filter((m) => m.overallStatus === 'pending' || m.overallStatus === 'confirmed');

  const slotTypeByMatchId = new Map(participantRows.map((p) => [p.matchId, p.slotType]));

  return matchRows.map((m) => ({
    matchId: m.id,
    type: m.type,
    scheduledAt: m.scheduledAt,
    overallStatus: m.overallStatus,
    venue: m.venue,
    slotType: slotTypeByMatchId.get(m.id) ?? 'main',
  }));
}

export interface PendingInvitationView {
  entryId: number;
  matchId: number;
  type: string;
  scheduledAt: number;
  venue: string | null;
  status: 'queued' | 'invited';
  expiresAt: number | null;
}

/** Invitation queue entries where the user is the candidate, still queued or invited. */
export function getPendingInvitationsView(ctx: DomainContext, userId: number): PendingInvitationView[] {
  const entries = getPendingInvitationsForUser(ctx, userId);
  return entries.map((entry) => {
    const match = ctx.db.select().from(matches).where(eq(matches.id, entry.matchId)).get();
    return {
      entryId: entry.id,
      matchId: entry.matchId,
      type: match?.type ?? 'unknown',
      scheduledAt: match?.scheduledAt ?? 0,
      venue: match?.venue ?? null,
      status: entry.status as 'queued' | 'invited',
      expiresAt: entry.expiresAt,
    };
  });
}
