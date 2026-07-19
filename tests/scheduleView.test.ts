import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext } from './testContext.js';
import { registerUser } from '../src/domain/users.js';
import { createMatch, confirmMainParticipant } from '../src/domain/matches.js';
import { cancelMatch } from '../src/domain/lifecycle.js';
import { getUpcomingMatchesForUser, getPendingInvitationsView } from '../src/domain/schedule.js';

describe('match-schedule-view', () => {
  let harness: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    harness = createTestContext();
  });

  function register(tid: string) {
    return registerUser(harness.ctx, { telegramUserId: tid, chatId: `c-${tid}`, displayName: tid });
  }

  it('lists upcoming matches ordered soonest first, excluding cancelled/completed', () => {
    const { ctx } = harness;
    const a = register('a');
    const b = register('b');
    const c = register('c');

    const later = createMatch(ctx, {
      type: 'singles',
      scheduledAt: new Date('2026-03-01T10:00:00.000Z'),
      creatorTelegramUserId: a.telegramUserId,
      otherMainParticipants: [{ kind: 'direct', telegramUserId: b.telegramUserId }],
    });
    const sooner = createMatch(ctx, {
      type: 'singles',
      scheduledAt: new Date('2026-02-01T10:00:00.000Z'),
      creatorTelegramUserId: a.telegramUserId,
      otherMainParticipants: [{ kind: 'direct', telegramUserId: c.telegramUserId }],
    });
    const cancelled = createMatch(ctx, {
      type: 'singles',
      scheduledAt: new Date('2026-01-15T10:00:00.000Z'),
      creatorTelegramUserId: a.telegramUserId,
      otherMainParticipants: [{ kind: 'direct', telegramUserId: b.telegramUserId }],
    });
    cancelMatch(ctx, cancelled.id, a.id);

    const schedule = getUpcomingMatchesForUser(ctx, a.id);
    expect(schedule.map((m) => m.matchId)).toEqual([sooner.id, later.id]);
  });

  it('reports no upcoming matches for a player with none', () => {
    const { ctx } = harness;
    const a = register('lonely');
    expect(getUpcomingMatchesForUser(ctx, a.id)).toHaveLength(0);
  });

  it('shows pending invitations separately, including time remaining for invited entries', () => {
    const { ctx } = harness;
    const a = register('org');
    const cand1 = register('cand1');
    const cand2 = register('cand2');

    const match = createMatch(ctx, {
      type: 'singles',
      scheduledAt: new Date('2026-03-01T10:00:00.000Z'),
      creatorTelegramUserId: a.telegramUserId,
      otherMainParticipants: [
        { kind: 'queue', candidateTelegramUserIds: [cand1.telegramUserId, cand2.telegramUserId] },
      ],
    });

    const cand1View = getPendingInvitationsView(ctx, cand1.id);
    expect(cand1View).toHaveLength(1);
    expect(cand1View[0]!.status).toBe('invited');
    expect(cand1View[0]!.matchId).toBe(match.id);
    expect(cand1View[0]!.expiresAt).not.toBeNull();

    const cand2View = getPendingInvitationsView(ctx, cand2.id);
    expect(cand2View).toHaveLength(1);
    expect(cand2View[0]!.status).toBe('queued');
  });

  it('omits the pending invitations section when there are none', () => {
    const { ctx } = harness;
    const a = register('nopending');
    expect(getPendingInvitationsView(ctx, a.id)).toHaveLength(0);
  });

  it('confirmed matches where the user is a main or bench participant both appear', () => {
    const { ctx } = harness;
    const p1 = register('bp1');
    const p2 = register('bp2');
    const p3 = register('bp3');
    const p4 = register('bp4');
    const bench = register('benchP');

    const match = createMatch(ctx, {
      type: 'doubles',
      scheduledAt: new Date('2026-03-01T10:00:00.000Z'),
      creatorTelegramUserId: p1.telegramUserId,
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

    const benchSchedule = getUpcomingMatchesForUser(ctx, bench.id);
    expect(benchSchedule).toHaveLength(1);
    expect(benchSchedule[0]!.slotType).toBe('bench');
  });
});
