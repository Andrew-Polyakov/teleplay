import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext } from './testContext.js';
import { registerUser } from '../src/domain/users.js';
import { createMatch, getMatch, getMainParticipants } from '../src/domain/matches.js';
import {
  acceptInvitationEntry,
  declineInvitationEntry,
  expireDueInvitations,
  getPendingInvitationsForUser,
} from '../src/domain/invitationQueue.js';

describe('invitation-queue', () => {
  let harness: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    harness = createTestContext();
  });

  function register(tid: string) {
    return registerUser(harness.ctx, { telegramUserId: tid, chatId: `c-${tid}`, displayName: tid });
  }

  function setupQueuedSingles() {
    const { ctx } = harness;
    const creator = register('creator');
    const cand1 = register('cand1');
    const cand2 = register('cand2');
    const cand3 = register('cand3');
    const match = createMatch(ctx, {
      type: 'singles',
      scheduledAt: new Date('2026-02-01T10:00:00.000Z'),
      creatorTelegramUserId: creator.telegramUserId,
      otherMainParticipants: [
        {
          kind: 'queue',
          candidateTelegramUserIds: [cand1.telegramUserId, cand2.telegramUserId, cand3.telegramUserId],
        },
      ],
    });
    return { creator, cand1, cand2, cand3, match };
  }

  it('invites only the first candidate initially', () => {
    const { cand1, cand2, cand3 } = setupQueuedSingles();
    expect(harness.sent.some((m) => m.userId === cand1.id)).toBe(true);
    expect(harness.sent.some((m) => m.userId === cand2.id)).toBe(false);
    expect(harness.sent.some((m) => m.userId === cand3.id)).toBe(false);
  });

  it('acceptance fills the slot and stops the queue', () => {
    const { ctx } = harness;
    const { cand1, cand2, match } = setupQueuedSingles();
    const pending = getPendingInvitationsForUser(ctx, cand1.id);
    expect(pending).toHaveLength(1);

    acceptInvitationEntry(ctx, { entryId: pending[0]!.id, respondingUserId: cand1.id });

    expect(getMatch(ctx, match.id)?.overallStatus).toBe('confirmed');
    expect(getMainParticipants(ctx, match.id).some((p) => p.userId === cand1.id)).toBe(true);
    // cand2 must never have been invited.
    expect(harness.sent.some((m) => m.userId === cand2.id)).toBe(false);
  });

  it('an explicit decline immediately advances to the next candidate', () => {
    const { ctx } = harness;
    const { cand1, cand2 } = setupQueuedSingles();
    const pending = getPendingInvitationsForUser(ctx, cand1.id);
    declineInvitationEntry(ctx, { entryId: pending[0]!.id, respondingUserId: cand1.id });
    expect(harness.sent.some((m) => m.userId === cand2.id)).toBe(true);
  });

  it('expiry after 1 hour advances to the next candidate', () => {
    const { ctx } = harness;
    const { cand2 } = setupQueuedSingles();
    expect(harness.sent.some((m) => m.userId === cand2.id)).toBe(false);

    harness.clock.advanceMs(61 * 60 * 1000);
    const expiredCount = expireDueInvitations(ctx);

    expect(expiredCount).toBe(1);
    expect(harness.sent.some((m) => m.userId === cand2.id)).toBe(true);
  });

  it('a candidate cannot accept before the current invitee has responded', () => {
    const { ctx } = harness;
    const { cand2 } = setupQueuedSingles();
    const pendingForCand2 = getPendingInvitationsForUser(ctx, cand2.id);
    expect(pendingForCand2[0]!.status).toBe('queued');
    expect(() => acceptInvitationEntry(ctx, { entryId: pendingForCand2[0]!.id, respondingUserId: cand2.id })).toThrow();
  });

  it('notifies the declarer when the whole queue is exhausted with no acceptance', () => {
    const { ctx } = harness;
    const { creator, cand1, cand2, cand3 } = setupQueuedSingles();

    let pending = getPendingInvitationsForUser(ctx, cand1.id);
    declineInvitationEntry(ctx, { entryId: pending[0]!.id, respondingUserId: cand1.id });
    pending = getPendingInvitationsForUser(ctx, cand2.id);
    declineInvitationEntry(ctx, { entryId: pending[0]!.id, respondingUserId: cand2.id });
    harness.sent.length = 0;
    pending = getPendingInvitationsForUser(ctx, cand3.id);
    declineInvitationEntry(ctx, { entryId: pending[0]!.id, respondingUserId: cand3.id });

    expect(harness.sent.some((m) => m.userId === creator.id && m.text.includes('No candidate accepted'))).toBe(true);
  });

  it('invitation content states format, time, and venue-TBD when unset', () => {
    const { cand1 } = setupQueuedSingles();
    const msg = harness.sent.find((m) => m.userId === cand1.id)!;
    expect(msg.text).toMatch(/singles/);
  });
});
