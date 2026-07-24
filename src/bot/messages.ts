import type { MainParticipantSpec } from '../domain/matches.js';

/** Builds the "— invited @a, @b; bench: @c" suffix for match-created confirmations. */
export function describeInvitees(specs: MainParticipantSpec[], bench: string[]): string {
  const slots = specs.map((s) =>
    s.kind === 'direct' ? s.telegramUserId : `queue(${s.candidateTelegramUserIds.join(' → ')})`,
  );
  const benchPart = bench.length ? `; bench: ${bench.join(', ')}` : '';
  return ` — invited ${slots.join(', ')}${benchPart}`;
}
