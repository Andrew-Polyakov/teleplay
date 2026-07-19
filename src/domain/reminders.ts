import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { matches } from '../db/schema.js';
import type { DomainContext } from './types.js';
import { getMainParticipants, formatMatchSummary } from './matches.js';

/** Matches that are confirmed, venue-set, not yet reminded, and within the lead window before start. */
export function findReminderEligibleMatches(ctx: DomainContext, leadHours: number) {
  const now = ctx.clock.now().getTime();
  const leadWindowMs = leadHours * 60 * 60 * 1000;

  return ctx.db
    .select()
    .from(matches)
    .where(and(eq(matches.overallStatus, 'confirmed'), isNotNull(matches.venue), isNull(matches.reminderSentAt)))
    .all()
    .filter((m) => m.scheduledAt > now && m.scheduledAt - now <= leadWindowMs);
}

/** Polling worker: sends and marks reminders for every currently-eligible match. */
export function sendDueReminders(ctx: DomainContext, leadHours: number) {
  const eligible = findReminderEligibleMatches(ctx, leadHours);
  const now = ctx.clock.now().getTime();

  for (const match of eligible) {
    const participants = getMainParticipants(ctx, match.id).filter((p) => p.participantStatus === 'confirmed');
    const message = `Reminder: ${formatMatchSummary(match)}`;
    for (const participant of participants) {
      ctx.notify(participant.userId, message);
    }
    ctx.db.update(matches).set({ reminderSentAt: now, updatedAt: now }).where(eq(matches.id, match.id)).run();
  }

  return eligible.length;
}
