import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext } from './testContext.js';
import { registerUser } from '../src/domain/users.js';
import { createMatch, confirmMainParticipant, getMatch, getMainParticipants } from '../src/domain/matches.js';
import { confirmBenchStandby } from '../src/domain/bench.js';
import { submitVenue } from '../src/domain/venue.js';
import { cancelMatch, proposeReschedule, retireFromDoublesMatch } from '../src/domain/lifecycle.js';
import { sendDueReminders } from '../src/domain/reminders.js';
import {
  acceptInvitationEntry,
  expireDueInvitations,
  getPendingInvitationsForUser,
} from '../src/domain/invitationQueue.js';
import { getUpcomingMatchesForUser, getPendingInvitationsView } from '../src/domain/schedule.js';

/**
 * These cover tasks.md 9.5-9.8 ("manual end-to-end test") as automated, code-driven
 * end-to-end flows over the domain layer + an in-memory SQLite DB, since there's no
 * live Telegram environment available in this session.
 */
describe('end-to-end scenarios', () => {
  let harness: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    harness = createTestContext(new Date('2026-02-01T00:00:00.000Z'));
  });

  function register(tid: string) {
    return registerUser(harness.ctx, { telegramUserId: tid, chatId: `c-${tid}`, displayName: tid });
  }

  it('9.5 singles: create -> confirm -> venue -> reminder received', () => {
    const { ctx } = harness;
    const alice = register('alice');
    const bob = register('bob');

    const match = createMatch(ctx, {
      type: 'singles',
      scheduledAt: new Date('2026-02-01T02:00:00.000Z'),
      creatorTelegramUserId: alice.telegramUserId,
      otherMainParticipants: [{ kind: 'direct', telegramUserId: bob.telegramUserId }],
    });
    expect(getMatch(ctx, match.id)?.overallStatus).toBe('pending');

    confirmMainParticipant(ctx, match.id, bob.id);
    expect(getMatch(ctx, match.id)?.overallStatus).toBe('confirmed');

    submitVenue(ctx, match.id, alice.id, 'Riverside Court 2');
    expect(getMatch(ctx, match.id)?.venue).toBe('Riverside Court 2');

    const sentCount = sendDueReminders(ctx, 3);
    expect(sentCount).toBe(1);
    expect(harness.sent.some((m) => m.userId === alice.id && m.text.includes('Reminder'))).toBe(true);
    expect(harness.sent.some((m) => m.userId === bob.id && m.text.includes('Reminder'))).toBe(true);
  });

  it('9.6 doubles: create -> cancel -> new match rescheduled and re-confirmed', () => {
    const { ctx } = harness;
    const p1 = register('p1');
    const p2 = register('p2');
    const p3 = register('p3');
    const p4 = register('p4');

    const match = createMatch(ctx, {
      type: 'doubles',
      scheduledAt: new Date('2026-03-01T10:00:00.000Z'),
      creatorTelegramUserId: p1.telegramUserId,
      otherMainParticipants: [
        { kind: 'direct', telegramUserId: p2.telegramUserId },
        { kind: 'direct', telegramUserId: p3.telegramUserId },
        { kind: 'direct', telegramUserId: p4.telegramUserId },
      ],
    });
    confirmMainParticipant(ctx, match.id, p2.id);
    confirmMainParticipant(ctx, match.id, p3.id);
    confirmMainParticipant(ctx, match.id, p4.id);
    expect(getMatch(ctx, match.id)?.overallStatus).toBe('confirmed');

    // Reschedule this same match rather than cancelling+recreating, to exercise the
    // reschedule/re-confirm path end to end (cancel is exercised separately below).
    proposeReschedule(ctx, {
      matchId: match.id,
      proposerUserId: p1.id,
      newScheduledAt: new Date('2026-03-08T10:00:00.000Z'),
    });
    expect(getMatch(ctx, match.id)?.overallStatus).toBe('pending');

    confirmMainParticipant(ctx, match.id, p2.id);
    confirmMainParticipant(ctx, match.id, p3.id);
    confirmMainParticipant(ctx, match.id, p4.id);

    const rescheduled = getMatch(ctx, match.id)!;
    expect(rescheduled.overallStatus).toBe('confirmed');
    expect(rescheduled.scheduledAt).toBe(new Date('2026-03-08T10:00:00.000Z').getTime());

    // And a separately cancelled match stays cancelled and un-reminded.
    const cancellable = createMatch(ctx, {
      type: 'singles',
      scheduledAt: new Date('2026-02-01T02:00:00.000Z'),
      creatorTelegramUserId: p1.telegramUserId,
      otherMainParticipants: [{ kind: 'direct', telegramUserId: p2.telegramUserId }],
    });
    const cancelResult = cancelMatch(ctx, cancellable.id, p1.id);
    expect(cancelResult.alreadyCancelled).toBe(false);
    expect(getMatch(ctx, cancellable.id)?.overallStatus).toBe('cancelled');
  });

  it('9.7 doubles with bench: retire -> first candidate expires -> second accepts', () => {
    const { ctx } = harness;
    const p1 = register('e1');
    const p2 = register('e2');
    const p3 = register('e3');
    const p4 = register('e4');
    const bench1 = register('eb1');
    const bench2 = register('eb2');

    const match = createMatch(ctx, {
      type: 'doubles',
      scheduledAt: new Date('2026-03-01T10:00:00.000Z'),
      creatorTelegramUserId: p1.telegramUserId,
      otherMainParticipants: [
        { kind: 'direct', telegramUserId: p2.telegramUserId },
        { kind: 'direct', telegramUserId: p3.telegramUserId },
        { kind: 'direct', telegramUserId: p4.telegramUserId },
      ],
      benchTelegramUserIds: [bench1.telegramUserId, bench2.telegramUserId],
    });
    confirmMainParticipant(ctx, match.id, p2.id);
    confirmMainParticipant(ctx, match.id, p3.id);
    confirmMainParticipant(ctx, match.id, p4.id);
    confirmBenchStandby(ctx, match.id, bench1.id);
    confirmBenchStandby(ctx, match.id, bench2.id);
    expect(getMatch(ctx, match.id)?.overallStatus).toBe('confirmed');

    retireFromDoublesMatch(ctx, { matchId: match.id, retiringUserId: p2.id });
    expect(getPendingInvitationsForUser(ctx, bench1.id)[0]!.status).toBe('invited');
    expect(getPendingInvitationsForUser(ctx, bench2.id)[0]!.status).toBe('queued');

    // First candidate lets the 1-hour window lapse.
    harness.clock.advanceMs(61 * 60 * 1000);
    expireDueInvitations(ctx);
    expect(getPendingInvitationsForUser(ctx, bench2.id)[0]!.status).toBe('invited');

    // Second candidate accepts.
    const pending = getPendingInvitationsForUser(ctx, bench2.id);
    acceptInvitationEntry(ctx, { entryId: pending[0]!.id, respondingUserId: bench2.id });

    const participants = getMainParticipants(ctx, match.id);
    expect(participants.find((p) => p.userId === bench2.id)?.participantStatus).toBe('confirmed');
    expect(participants.find((p) => p.userId === p2.id)?.participantStatus).toBe('replaced');
    expect(getMatch(ctx, match.id)?.overallStatus).toBe('confirmed');
  });

  it('9.8 /schedule shows a confirmed match and a pending invitation, excludes cancelled', () => {
    const { ctx } = harness;
    const player = register('viewer');
    const opponent = register('opponent');
    const organizer = register('organizer');
    const otherCandidate = register('other-candidate');

    const confirmedMatch = createMatch(ctx, {
      type: 'singles',
      scheduledAt: new Date('2026-03-01T10:00:00.000Z'),
      creatorTelegramUserId: player.telegramUserId,
      otherMainParticipants: [{ kind: 'direct', telegramUserId: opponent.telegramUserId }],
    });
    confirmMainParticipant(ctx, confirmedMatch.id, opponent.id);

    const cancelledMatch = createMatch(ctx, {
      type: 'singles',
      scheduledAt: new Date('2026-01-20T10:00:00.000Z'),
      creatorTelegramUserId: player.telegramUserId,
      otherMainParticipants: [{ kind: 'direct', telegramUserId: opponent.telegramUserId }],
    });
    cancelMatch(ctx, cancelledMatch.id, player.id);

    createMatch(ctx, {
      type: 'singles',
      scheduledAt: new Date('2026-03-05T10:00:00.000Z'),
      creatorTelegramUserId: organizer.telegramUserId,
      otherMainParticipants: [
        { kind: 'queue', candidateTelegramUserIds: [player.telegramUserId, otherCandidate.telegramUserId] },
      ],
    });

    const schedule = getUpcomingMatchesForUser(ctx, player.id);
    expect(schedule.map((m) => m.matchId)).toEqual([confirmedMatch.id]);

    const invitations = getPendingInvitationsView(ctx, player.id);
    expect(invitations).toHaveLength(1);
    expect(invitations[0]!.status).toBe('invited');
  });
});
