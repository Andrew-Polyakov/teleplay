## Why

Creating a match today requires typing a rigid one-liner like
`/newmatch doubles 2026-03-01T18:00:00Z @p2 @p3 @p4 bench:@sub1,@sub2` — ISO 8601 timestamps
and exact `@username`s, hand-typed on a phone. Real users won't format that correctly, which
makes the bot's core flow (creating a match) its worst experience. Telegram has no native
datepicker, but the established idiom — inline-keyboard calendars and button grids — covers
the whole flow with taps instead of typing.

## What Changes

- **BREAKING**: `/newmatch` is renamed to `/match`. The old command name is removed
  (a `/newmatch` message gets a hint pointing to `/match`).
- `/match` with no arguments starts an interactive tap-through wizard:
  1. Match type — "Singles / Doubles" buttons.
  2. Date — inline-keyboard calendar (month grid, prev/next month navigation, past dates
     not selectable).
  3. Time — button grid of time slots (configurable range/step, e.g. 07:00–22:00 every 30 min).
  4. Players — tap-to-select from users already registered with the bot (singles: 1 opponent;
     doubles: 3 others), with a typed-`@username` escape hatch for unregistered players.
  5. Bench (doubles only) — optional tap-to-select standby players, same source.
  6. Summary → "Create match" / "Cancel" confirmation.
- `/match <singles|doubles> <ISO time> <slot>... [bench:...]` — the existing one-line power
  syntax keeps working unchanged (same parser), just under the new command name.
- Per-user wizard state is kept in memory with a timeout; an in-progress wizard can be
  abandoned via a Cancel button or by starting a new one.
- Queue slots (`queue:@a,@b,...`) remain power-syntax-only in this change; the wizard covers
  direct invites and bench.

## Capabilities

### New Capabilities
- `match-creation-wizard`: the interactive `/match` wizard — step sequence, calendar and
  time-slot keyboards, registered-player selection, wizard state lifecycle (timeout,
  cancel, restart), and confirmation summary.

### Modified Capabilities
- `match-scheduling`: the match-creation command is renamed `/newmatch` → `/match`; the
  one-line argument syntax is retained under the new name as a power-user fallback.
  (Note: main `openspec/specs/` is empty — the current match-scheduling spec lives in the
  un-archived `tennis-match-bot` change. This change ships a delta spec for the rename.)

## Impact

- `src/bot/handlers.ts` — rename command registration, branch no-args → wizard, args → parser.
- New wizard module(s) under `src/bot/` — state machine, calendar/time/player keyboards,
  callback-query handlers.
- `src/bot/parse.ts` — unchanged parsing logic; usage strings updated to `/match`.
- `src/domain/users.ts` — needs a "list registered users" query for the player picker.
- `src/config.ts` / `.env.example` — wizard time-slot range/step and wizard timeout settings.
- `docs/USAGE.md`, `README.md` — command rename + wizard documentation, BotFather command list.
- No schema/database changes; match creation still goes through the existing
  `src/domain/matches.ts` entry point.
- No new runtime dependencies (calendar keyboard is hand-rolled; no conversations plugin —
  a small explicit state map suffices).
