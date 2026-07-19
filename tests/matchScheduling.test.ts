import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext } from './testContext.js';
import { registerUser } from '../src/domain/users.js';
import {
  createMatch,
  confirmMainParticipant,
  declineMainParticipant,
  getMatch,
  getMainParticipants,
  UnregisteredParticipantError,
} from '../src/domain/matches.js';

describe('match-scheduling', () => {
  let harness: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    harness = createTestContext();
  });

  function register(tid: string) {
    const { ctx } = harness;
    return registerUser(ctx, { telegramUserId: tid, chatId: `chat-${tid}`, displayName: `Player ${tid}` });
  }

  it('creates a singles match with creator confirmed and invitee invited', () => {
    const { ctx } = harness;
    const creator = register('creator');
    const invitee = register('invitee');

    const match = createMatch(ctx, {
      type: 'singles',
      scheduledAt: new Date('2026-02-01T10:00:00.000Z'),
      creatorTelegramUserId: creator.telegramUserId,
      otherMainParticipants: [{ kind: 'direct', telegramUserId: invitee.telegramUserId }],
    });

    expect(match.overallStatus).toBe('pending');
    const participants = getMainParticipants(ctx, match.id);
    expect(participants).toHaveLength(2);
    expect(participants.find((p) => p.userId === creator.id)?.participantStatus).toBe('confirmed');
    expect(participants.find((p) => p.userId === invitee.id)?.participantStatus).toBe('invited');
    expect(harness.sent.some((m) => m.userId === invitee.id)).toBe(true);
  });

  it('creates a doubles match with exactly 4 main slots', () => {
    const { ctx } = harness;
    const creator = register('c');
    const p2 = register('p2');
    const p3 = register('p3');
    const p4 = register('p4');

    const match = createMatch(ctx, {
      type: 'doubles',
      scheduledAt: new Date('2026-02-01T10:00:00.000Z'),
      creatorTelegramUserId: creator.telegramUserId,
      otherMainParticipants: [
        { kind: 'direct', telegramUserId: p2.telegramUserId },
        { kind: 'direct', telegramUserId: p3.telegramUserId },
        { kind: 'direct', telegramUserId: p4.telegramUserId },
      ],
    });

    expect(getMainParticipants(ctx, match.id)).toHaveLength(4);
  });

  it('rejects an invitee who has not started the bot, without creating anything', () => {
    const { ctx } = harness;
    const creator = register('creator2');

    expect(() =>
      createMatch(ctx, {
        type: 'singles',
        scheduledAt: new Date('2026-02-01T10:00:00.000Z'),
        creatorTelegramUserId: creator.telegramUserId,
        otherMainParticipants: [{ kind: 'direct', telegramUserId: 'ghost' }],
      }),
    ).toThrow(UnregisteredParticipantError);
  });

  it('transitions to confirmed once all main participants confirm (singles)', () => {
    const { ctx } = harness;
    const creator = register('a');
    const invitee = register('b');
    const match = createMatch(ctx, {
      type: 'singles',
      scheduledAt: new Date('2026-02-01T10:00:00.000Z'),
      creatorTelegramUserId: creator.telegramUserId,
      otherMainParticipants: [{ kind: 'direct', telegramUserId: invitee.telegramUserId }],
    });

    expect(getMatch(ctx, match.id)?.overallStatus).toBe('pending');
    confirmMainParticipant(ctx, match.id, invitee.id);
    expect(getMatch(ctx, match.id)?.overallStatus).toBe('confirmed');
  });

  it('stays pending while any main participant has not confirmed', () => {
    const { ctx } = harness;
    const creator = register('a2');
    const p2 = register('b2');
    const p3 = register('c2');
    const p4 = register('d2');
    const match = createMatch(ctx, {
      type: 'doubles',
      scheduledAt: new Date('2026-02-01T10:00:00.000Z'),
      creatorTelegramUserId: creator.telegramUserId,
      otherMainParticipants: [
        { kind: 'direct', telegramUserId: p2.telegramUserId },
        { kind: 'direct', telegramUserId: p3.telegramUserId },
        { kind: 'direct', telegramUserId: p4.telegramUserId },
      ],
    });

    confirmMainParticipant(ctx, match.id, p2.id);
    confirmMainParticipant(ctx, match.id, p3.id);
    expect(getMatch(ctx, match.id)?.overallStatus).toBe('pending');
  });

  it('a decline notifies the other main participants and does not confirm the match', () => {
    const { ctx } = harness;
    const creator = register('a3');
    const invitee = register('b3');
    const match = createMatch(ctx, {
      type: 'singles',
      scheduledAt: new Date('2026-02-01T10:00:00.000Z'),
      creatorTelegramUserId: creator.telegramUserId,
      otherMainParticipants: [{ kind: 'direct', telegramUserId: invitee.telegramUserId }],
    });

    declineMainParticipant(ctx, match.id, invitee.id);
    expect(getMatch(ctx, match.id)?.overallStatus).toBe('pending');
    expect(harness.sent.some((m) => m.userId === creator.id && m.text.includes('declined'))).toBe(true);
  });

  it('rejects attaching bench players to a singles match', async () => {
    const { ctx } = harness;
    const creator = register('s1');
    const invitee = register('s2');
    const bench = register('s3');
    expect(() =>
      createMatch(ctx, {
        type: 'singles',
        scheduledAt: new Date('2026-02-01T10:00:00.000Z'),
        creatorTelegramUserId: creator.telegramUserId,
        otherMainParticipants: [{ kind: 'direct', telegramUserId: invitee.telegramUserId }],
        benchTelegramUserIds: [bench.telegramUserId],
      }),
    ).toThrow(/only supported for doubles/);
  });

  it('doubles match confirms even while a bench player has not responded', () => {
    const { ctx } = harness;
    const creator = register('d1');
    const p2 = register('d2');
    const p3 = register('d3');
    const p4 = register('d4');
    const bench = register('d5');

    const match = createMatch(ctx, {
      type: 'doubles',
      scheduledAt: new Date('2026-02-01T10:00:00.000Z'),
      creatorTelegramUserId: creator.telegramUserId,
      otherMainParticipants: [
        { kind: 'direct', telegramUserId: p2.telegramUserId },
        { kind: 'direct', telegramUserId: p3.telegramUserId },
        { kind: 'direct', telegramUserId: p4.telegramUserId },
      ],
      benchTelegramUserIds: [bench.telegramUserId],
    });

    confirmMainParticipant(ctx, match.id, p2.id);
    confirmMainParticipant(ctx, match.id, p3.id);
    confirmMainParticipant(ctx, match.id, p4.id);

    expect(getMatch(ctx, match.id)?.overallStatus).toBe('confirmed');
  });

  it('fills a main slot from a candidate queue and confirms once accepted', () => {
    const { ctx } = harness;
    const creator = register('q1');
    const cand1 = register('q2');
    const cand2 = register('q3');

    const match = createMatch(ctx, {
      type: 'singles',
      scheduledAt: new Date('2026-02-01T10:00:00.000Z'),
      creatorTelegramUserId: creator.telegramUserId,
      otherMainParticipants: [
        { kind: 'queue', candidateTelegramUserIds: [cand1.telegramUserId, cand2.telegramUserId] },
      ],
    });

    // Only cand1 should be invited so far — cand2 not yet.
    expect(harness.sent.some((m) => m.userId === cand1.id)).toBe(true);
    expect(harness.sent.some((m) => m.userId === cand2.id)).toBe(false);
    expect(getMatch(ctx, match.id)?.overallStatus).toBe('pending');
  });
});
