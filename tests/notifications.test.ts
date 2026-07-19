import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext } from './testContext.js';
import { registerUser } from '../src/domain/users.js';
import { createMatch, confirmMainParticipant, getMatch } from '../src/domain/matches.js';
import { submitVenue } from '../src/domain/venue.js';
import { cancelMatch } from '../src/domain/lifecycle.js';
import { findReminderEligibleMatches, sendDueReminders } from '../src/domain/reminders.js';

const LEAD_HOURS = 3;

describe('match-notifications', () => {
  let harness: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    harness = createTestContext(new Date('2026-02-01T00:00:00.000Z'));
  });

  function register(tid: string) {
    return registerUser(harness.ctx, { telegramUserId: tid, chatId: `c-${tid}`, displayName: tid });
  }

  function setupReadyMatch(scheduledAt: Date) {
    const { ctx } = harness;
    const a = register('a');
    const b = register('b');
    const match = createMatch(ctx, {
      type: 'singles',
      scheduledAt,
      creatorTelegramUserId: a.telegramUserId,
      otherMainParticipants: [{ kind: 'direct', telegramUserId: b.telegramUserId }],
    });
    confirmMainParticipant(ctx, match.id, b.id);
    submitVenue(ctx, match.id, a.id, 'Court 9');
    return { a, b, match };
  }

  it('is not eligible before the lead window, and eligible once inside it', () => {
    const { ctx } = harness;
    setupReadyMatch(new Date('2026-02-01T12:00:00.000Z')); // 12h away, lead window is 3h
    expect(findReminderEligibleMatches(ctx, LEAD_HOURS)).toHaveLength(0);

    harness.clock.set(new Date('2026-02-01T09:30:00.000Z')); // now 2.5h before start
    expect(findReminderEligibleMatches(ctx, LEAD_HOURS)).toHaveLength(1);
  });

  it('is not eligible when confirmed but venue unset', () => {
    const { ctx } = harness;
    const a = register('a2');
    const b = register('b2');
    const match = createMatch(ctx, {
      type: 'singles',
      scheduledAt: new Date('2026-02-01T01:00:00.000Z'),
      creatorTelegramUserId: a.telegramUserId,
      otherMainParticipants: [{ kind: 'direct', telegramUserId: b.telegramUserId }],
    });
    confirmMainParticipant(ctx, match.id, b.id);
    expect(findReminderEligibleMatches(ctx, LEAD_HOURS)).toHaveLength(0);
  });

  it('sends a reminder to each confirmed main participant and marks it sent', () => {
    const { ctx } = harness;
    const { a, b, match } = setupReadyMatch(new Date('2026-02-01T02:00:00.000Z'));
    const count = sendDueReminders(ctx, LEAD_HOURS);
    expect(count).toBe(1);
    expect(harness.sent.some((m) => m.userId === a.id && m.text.includes('Reminder'))).toBe(true);
    expect(harness.sent.some((m) => m.userId === b.id && m.text.includes('Reminder'))).toBe(true);
    expect(getMatch(ctx, match.id)?.reminderSentAt).not.toBeNull();
  });

  it('does not send a duplicate reminder once already sent', () => {
    const { ctx } = harness;
    setupReadyMatch(new Date('2026-02-01T02:00:00.000Z'));
    sendDueReminders(ctx, LEAD_HOURS);
    harness.sent.length = 0;
    const secondCount = sendDueReminders(ctx, LEAD_HOURS);
    expect(secondCount).toBe(0);
    expect(harness.sent).toHaveLength(0);
  });

  it('does not send a reminder for a cancelled match', () => {
    const { ctx } = harness;
    const { a, match } = setupReadyMatch(new Date('2026-02-01T02:00:00.000Z'));
    cancelMatch(ctx, match.id, a.id);
    expect(findReminderEligibleMatches(ctx, LEAD_HOURS)).toHaveLength(0);
  });
});
