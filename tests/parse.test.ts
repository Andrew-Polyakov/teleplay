import { describe, it, expect } from 'vitest';
import { parseNewMatchArgs, parseRescheduleArgs } from '../src/bot/parse.js';

describe('bot command parsing', () => {
  it('parses a singles direct-invite command', () => {
    const result = parseNewMatchArgs(['singles', '2026-03-01T18:00:00Z', '@bob']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('singles');
      expect(result.value.otherMainParticipants).toEqual([{ kind: 'direct', telegramUserId: '@bob' }]);
    }
  });

  it('parses a doubles command with a queue slot and bench players', () => {
    const result = parseNewMatchArgs([
      'doubles',
      '2026-03-01T18:00:00Z',
      '@p2',
      'queue:@p3,@p4',
      '@p5',
      'bench:@b1,@b2',
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.otherMainParticipants).toEqual([
        { kind: 'direct', telegramUserId: '@p2' },
        { kind: 'queue', candidateTelegramUserIds: ['@p3', '@p4'] },
        { kind: 'direct', telegramUserId: '@p5' },
      ]);
      expect(result.value.benchUsernames).toEqual(['@b1', '@b2']);
    }
  });

  it('rejects a wrong slot count for the match type', () => {
    const result = parseNewMatchArgs(['singles', '2026-03-01T18:00:00Z', '@a', '@b']);
    expect(result.ok).toBe(false);
  });

  it('rejects an unparsable time', () => {
    const result = parseNewMatchArgs(['singles', 'not-a-date', '@a']);
    expect(result.ok).toBe(false);
  });

  it('parses a reschedule with just a match id', () => {
    const result = parseRescheduleArgs(['42']);
    expect(result).toEqual({ ok: true, value: { matchId: 42 } });
  });

  it('parses a reschedule with time and venue', () => {
    const result = parseRescheduleArgs(['42', '2026-03-01T18:00:00Z', 'Court', '5']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.matchId).toBe(42);
      expect(result.value.newScheduledAt?.toISOString()).toBe('2026-03-01T18:00:00.000Z');
      expect(result.value.newVenue).toBe('Court 5');
    }
  });
});
