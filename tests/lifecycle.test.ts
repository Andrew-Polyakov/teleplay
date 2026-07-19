import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext } from './testContext.js';
import { registerUser } from '../src/domain/users.js';
import { createMatch, confirmMainParticipant, getMatch, getMainParticipants } from '../src/domain/matches.js';
import { confirmBenchStandby } from '../src/domain/bench.js';
import { cancelMatch, proposeReschedule, retireFromDoublesMatch } from '../src/domain/lifecycle.js';
import { acceptInvitationEntry, getPendingInvitationsForUser, declineInvitationEntry } from '../src/domain/invitationQueue.js';

describe('match-lifecycle', () => {
  let harness: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    harness = createTestContext();
  });

  function register(tid: string) {
    return registerUser(harness.ctx, { telegramUserId: tid, chatId: `c-${tid}`, displayName: tid });
  }

  describe('cancel', () => {
    it('cancels a pending match and notifies others', () => {
      const { ctx } = harness;
      const a = register('a');
      const b = register('b');
      const match = createMatch(ctx, {
        type: 'singles',
        scheduledAt: new Date('2026-02-01T10:00:00.000Z'),
        creatorTelegramUserId: a.telegramUserId,
        otherMainParticipants: [{ kind: 'direct', telegramUserId: b.telegramUserId }],
      });

      const result = cancelMatch(ctx, match.id, a.id);
      expect(result.alreadyCancelled).toBe(false);
      expect(getMatch(ctx, match.id)?.overallStatus).toBe('cancelled');
      expect(harness.sent.some((m) => m.userId === b.id && m.text.includes('cancelled'))).toBe(true);
    });

    it('cancelling an already-cancelled match is a no-op', () => {
      const { ctx } = harness;
      const a = register('a2');
      const b = register('b2');
      const match = createMatch(ctx, {
        type: 'singles',
        scheduledAt: new Date('2026-02-01T10:00:00.000Z'),
        creatorTelegramUserId: a.telegramUserId,
        otherMainParticipants: [{ kind: 'direct', telegramUserId: b.telegramUserId }],
      });
      cancelMatch(ctx, match.id, a.id);
      const second = cancelMatch(ctx, match.id, a.id);
      expect(second.alreadyCancelled).toBe(true);
    });
  });

  describe('reschedule', () => {
    it('proposing a reschedule resets main participants to invited except the proposer', () => {
      const { ctx } = harness;
      const a = register('r1');
      const b = register('r2');
      const match = createMatch(ctx, {
        type: 'singles',
        scheduledAt: new Date('2026-02-01T10:00:00.000Z'),
        creatorTelegramUserId: a.telegramUserId,
        otherMainParticipants: [{ kind: 'direct', telegramUserId: b.telegramUserId }],
      });
      confirmMainParticipant(ctx, match.id, b.id);
      expect(getMatch(ctx, match.id)?.overallStatus).toBe('confirmed');

      proposeReschedule(ctx, {
        matchId: match.id,
        proposerUserId: a.id,
        newScheduledAt: new Date('2026-02-02T10:00:00.000Z'),
      });

      expect(getMatch(ctx, match.id)?.overallStatus).toBe('pending');
      const participants = getMainParticipants(ctx, match.id);
      expect(participants.find((p) => p.userId === a.id)?.participantStatus).toBe('confirmed');
      expect(participants.find((p) => p.userId === b.id)?.participantStatus).toBe('invited');
    });

    it('re-confirming applies the staged new time and re-confirms the match', () => {
      const { ctx } = harness;
      const a = register('r3');
      const b = register('r4');
      const match = createMatch(ctx, {
        type: 'singles',
        scheduledAt: new Date('2026-02-01T10:00:00.000Z'),
        creatorTelegramUserId: a.telegramUserId,
        otherMainParticipants: [{ kind: 'direct', telegramUserId: b.telegramUserId }],
      });
      confirmMainParticipant(ctx, match.id, b.id);
      const newTime = new Date('2026-02-05T12:00:00.000Z');
      proposeReschedule(ctx, { matchId: match.id, proposerUserId: a.id, newScheduledAt: newTime });

      confirmMainParticipant(ctx, match.id, b.id);

      const updated = getMatch(ctx, match.id)!;
      expect(updated.overallStatus).toBe('confirmed');
      expect(updated.scheduledAt).toBe(newTime.getTime());
      expect(updated.pendingScheduledAt).toBeNull();
    });
  });

  describe('retire and bench call-up', () => {
    function setupConfirmedDoublesWithBench() {
      const { ctx } = harness;
      const p1 = register('m1');
      const p2 = register('m2');
      const p3 = register('m3');
      const p4 = register('m4');
      const bench1 = register('bench1');
      const bench2 = register('bench2');

      const match = createMatch(ctx, {
        type: 'doubles',
        scheduledAt: new Date('2026-02-01T10:00:00.000Z'),
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

      return { p1, p2, p3, p4, bench1, bench2, match };
    }

    it('retiring calls up the first standby-confirmed bench player without changing overallStatus', () => {
      const { ctx } = harness;
      const { p2, bench1, match } = setupConfirmedDoublesWithBench();

      const result = retireFromDoublesMatch(ctx, { matchId: match.id, retiringUserId: p2.id });
      expect(result.calledUp).toBe(true);
      expect(getMatch(ctx, match.id)?.overallStatus).toBe('confirmed');
      expect(harness.sent.some((m) => m.userId === bench1.id)).toBe(true);
    });

    it('bench player accepting the call-up is promoted to main and confirmed, without a full re-confirmation', () => {
      const { ctx } = harness;
      const { p2, p3, p4, bench1, bench2, match } = setupConfirmedDoublesWithBench();
      retireFromDoublesMatch(ctx, { matchId: match.id, retiringUserId: p2.id });
      harness.sent.length = 0;

      const pending = getPendingInvitationsForUser(ctx, bench1.id);
      acceptInvitationEntry(ctx, { entryId: pending[0]!.id, respondingUserId: bench1.id });

      const participants = getMainParticipants(ctx, match.id);
      expect(participants.find((p) => p.userId === bench1.id)?.participantStatus).toBe('confirmed');
      expect(participants.find((p) => p.userId === p2.id)?.participantStatus).toBe('replaced');
      // p3/p4 were never reset to `invited` — no full re-confirmation was triggered.
      expect(participants.find((p) => p.userId === p3.id)?.participantStatus).toBe('confirmed');
      expect(participants.find((p) => p.userId === p4.id)?.participantStatus).toBe('confirmed');
      expect(getMatch(ctx, match.id)?.overallStatus).toBe('confirmed');
      expect(harness.sent.some((m) => m.userId === bench2.id)).toBe(false);
    });

    it('bench decline/expiry advances to the next bench candidate', () => {
      const { ctx } = harness;
      const { p2, bench1, bench2, match } = setupConfirmedDoublesWithBench();
      retireFromDoublesMatch(ctx, { matchId: match.id, retiringUserId: p2.id });

      const pending = getPendingInvitationsForUser(ctx, bench1.id);
      declineInvitationEntry(ctx, { entryId: pending[0]!.id, respondingUserId: bench1.id });

      expect(harness.sent.some((m) => m.userId === bench2.id)).toBe(true);
    });

    it('if no bench player accepts, the match remains cancellable rather than auto-cancelled', () => {
      const { ctx } = harness;
      const { p2, bench1, bench2, match } = setupConfirmedDoublesWithBench();
      retireFromDoublesMatch(ctx, { matchId: match.id, retiringUserId: p2.id });

      let pending = getPendingInvitationsForUser(ctx, bench1.id);
      declineInvitationEntry(ctx, { entryId: pending[0]!.id, respondingUserId: bench1.id });
      pending = getPendingInvitationsForUser(ctx, bench2.id);
      declineInvitationEntry(ctx, { entryId: pending[0]!.id, respondingUserId: bench2.id });

      expect(getMatch(ctx, match.id)?.overallStatus).toBe('confirmed');
      const result = cancelMatch(ctx, match.id, bench2.id);
      expect(result.alreadyCancelled).toBe(false);
      expect(getMatch(ctx, match.id)?.overallStatus).toBe('cancelled');
    });
  });
});
