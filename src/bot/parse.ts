import type { MatchType } from '../db/schema.js';
import type { MainParticipantSpec } from '../domain/matches.js';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function normalizeUsername(raw: string): string {
  return raw.startsWith('@') ? raw : `@${raw}`;
}

/**
 * Parses `/newmatch <singles|doubles> <ISO-time> <slot>... [bench:@a,@b]`.
 * Each <slot> is either `@username` (direct invite) or `queue:@a,@b,@c` (ordered candidate queue).
 */
export function parseNewMatchArgs(args: string[]): ParseResult<{
  type: MatchType;
  scheduledAt: Date;
  otherMainParticipants: MainParticipantSpec[];
  benchUsernames: string[];
}> {
  if (args.length < 3) {
    return {
      ok: false,
      error:
        'Usage: /newmatch <singles|doubles> <ISO time> <@player | queue:@a,@b,...>... [bench:@a,@b,...]',
    };
  }

  const [typeRaw, timeRaw, ...rest] = args;
  const type = typeRaw!.toLowerCase();
  if (type !== 'singles' && type !== 'doubles') {
    return { ok: false, error: 'Match type must be "singles" or "doubles".' };
  }

  const scheduledAt = new Date(timeRaw!);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { ok: false, error: `Could not parse time "${timeRaw}" — use ISO 8601, e.g. 2026-03-01T18:00:00Z.` };
  }

  let benchUsernames: string[] = [];
  const slotTokens = rest.filter((token) => {
    if (token.toLowerCase().startsWith('bench:')) {
      benchUsernames = token
        .slice('bench:'.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(normalizeUsername);
      return false;
    }
    return true;
  });

  const otherMainParticipants: MainParticipantSpec[] = slotTokens.map((token) => {
    if (token.toLowerCase().startsWith('queue:')) {
      const candidateTelegramUserIds = token
        .slice('queue:'.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(normalizeUsername);
      return { kind: 'queue', candidateTelegramUserIds };
    }
    return { kind: 'direct', telegramUserId: normalizeUsername(token) };
  });

  const expectedOthers = type === 'singles' ? 1 : 3;
  if (otherMainParticipants.length !== expectedOthers) {
    return {
      ok: false,
      error: `A ${type} match needs ${expectedOthers} other main player slot(s) (got ${otherMainParticipants.length}).`,
    };
  }

  return { ok: true, value: { type, scheduledAt, otherMainParticipants, benchUsernames } };
}

export function parseRescheduleArgs(args: string[]): ParseResult<{
  matchId: number;
  newScheduledAt?: Date;
  newVenue?: string;
}> {
  if (args.length < 1) {
    return { ok: false, error: 'Usage: /reschedule <matchId> [ISO time] [new venue text...]' };
  }
  const matchId = Number(args[0]);
  if (!Number.isInteger(matchId)) {
    return { ok: false, error: `"${args[0]}" is not a valid match id.` };
  }
  if (args.length === 1) {
    return { ok: true, value: { matchId } };
  }

  const maybeDate = new Date(args[1]!);
  if (Number.isNaN(maybeDate.getTime())) {
    return { ok: true, value: { matchId, newVenue: args.slice(1).join(' ') } };
  }
  const newVenue = args.length > 2 ? args.slice(2).join(' ') : undefined;
  return { ok: true, value: { matchId, newScheduledAt: maybeDate, newVenue } };
}

export function parseMatchIdAndText(
  args: string[],
  usage: string,
): ParseResult<{ matchId: number; text: string }> {
  if (args.length < 2) return { ok: false, error: usage };
  const matchId = Number(args[0]);
  if (!Number.isInteger(matchId)) return { ok: false, error: `"${args[0]}" is not a valid match id.` };
  return { ok: true, value: { matchId, text: args.slice(1).join(' ') } };
}

export function parseMatchId(args: string[], usage: string): ParseResult<{ matchId: number }> {
  if (args.length < 1) return { ok: false, error: usage };
  const matchId = Number(args[0]);
  if (!Number.isInteger(matchId)) return { ok: false, error: `"${args[0]}" is not a valid match id.` };
  return { ok: true, value: { matchId } };
}
