import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext } from './testContext.js';
import { registerUser } from '../src/domain/users.js';
import { createMatch, confirmMainParticipant, getMatch } from '../src/domain/matches.js';
import { submitVenue, isMatchReady } from '../src/domain/venue.js';
import { DomainError } from '../src/domain/types.js';

describe('venue-booking', () => {
  let harness: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    harness = createTestContext();
  });

  function setupConfirmedSingles() {
    const { ctx } = harness;
    const a = registerUser(ctx, { telegramUserId: 'a', chatId: 'ca', displayName: 'A' });
    const b = registerUser(ctx, { telegramUserId: 'b', chatId: 'cb', displayName: 'B' });
    const match = createMatch(ctx, {
      type: 'singles',
      scheduledAt: new Date('2026-02-01T10:00:00.000Z'),
      creatorTelegramUserId: a.telegramUserId,
      otherMainParticipants: [{ kind: 'direct', telegramUserId: b.telegramUserId }],
    });
    confirmMainParticipant(ctx, match.id, b.id);
    return { a, b, match };
  }

  it('a participant can submit a venue', () => {
    const { ctx } = harness;
    const { a, match } = setupConfirmedSingles();
    submitVenue(ctx, match.id, a.id, 'Court 1');
    expect(getMatch(ctx, match.id)?.venue).toBe('Court 1');
  });

  it('rejects a venue submission from a non-participant', () => {
    const { ctx } = harness;
    const { match } = setupConfirmedSingles();
    const stranger = registerUser(ctx, { telegramUserId: 's', chatId: 'cs', displayName: 'S' });
    expect(() => submitVenue(ctx, match.id, stranger.id, 'Court 2')).toThrow(DomainError);
  });

  it('a confirmed match with no venue is not "ready"', () => {
    const { match } = setupConfirmedSingles();
    expect(isMatchReady({ overallStatus: match.overallStatus, venue: match.venue })).toBe(false);
  });

  it('a confirmed match becomes ready once a venue is submitted', () => {
    const { ctx } = harness;
    const { a, match } = setupConfirmedSingles();
    const updated = submitVenue(ctx, match.id, a.id, 'Court 3');
    expect(isMatchReady(updated)).toBe(true);
  });

  it('updating an existing venue notifies the other participants', () => {
    const { ctx } = harness;
    const { a, b, match } = setupConfirmedSingles();
    submitVenue(ctx, match.id, a.id, 'Court 1');
    harness.sent.length = 0;
    submitVenue(ctx, match.id, a.id, 'Court 2');
    expect(harness.sent.some((m) => m.userId === b.id && m.text.includes('Court 2'))).toBe(true);
  });
});
