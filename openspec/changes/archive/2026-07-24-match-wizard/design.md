## Context

Match creation is the bot's core flow, and today it is a single rigid command
(`/newmatch <type> <ISO time> <slots>... [bench:...]`) parsed by `src/bot/parse.ts` and
executed by `createMatch` in `src/domain/matches.ts`. All interactive affordances in the
codebase are stateless inline keyboards (`src/bot/keyboards.ts`) dispatched by a single
`callback_query:data` handler that splits payloads on `:` into `namespace:action:id`.
There is no per-user conversational state anywhere yet. Users self-register via `/start`
into the `users` table, which already stores `telegramUserId`, `chatId`, `displayName`.

The wizard adds the first stateful, multi-step interaction, and renames the command to
`/match`.

## Goals / Non-Goals

**Goals:**
- Create a singles or doubles match end-to-end with taps only (type, date, time, players,
  bench, confirm), on a phone, with no syntax to remember.
- Keep the one-line power syntax working unchanged under `/match`.
- No new runtime dependencies; no schema changes; wizard funnels into the same
  `createMatch` call the parser path uses.

**Non-Goals:**
- Queue slots (`queue:@a,@b`) in the wizard — power syntax only for now.
- Editing an in-flight match through the wizard (venue, reschedule keep their commands).
- Wizard state surviving a bot restart (in-memory is acceptable; an abandoned wizard is
  a few taps to redo).
- Timezone handling beyond the current behavior (times are entered/displayed as UTC today;
  fixing that is a separate change).

## Decisions

1. **Hand-rolled state machine, not `@grammyjs/conversations`.**
   The wizard is a linear 6-step flow with one branch (bench for doubles). A
   `Map<telegramUserId, WizardState>` with a `step` discriminant plus explicit callback
   handlers is ~identical in size to adopting the conversations plugin, keeps the existing
   "stateless handlers + inline keyboards" architecture recognizable, and avoids the
   plugin's session-storage requirement. Alternative considered: conversations plugin —
   rejected as a new dependency + new architectural pattern for one flow.

2. **One wizard per user, keyed by `telegramUserId`, with idle timeout.**
   Starting `/match` while a wizard is active discards the old one and starts fresh
   (simplest mental model). States idle longer than a configurable timeout (default
   10 min) are purged by the same interval-worker pattern used for reminders/invitations
   (`src/bot/workers.ts`). Callback taps on a dead wizard get an "expired — send /match
   to start again" answer instead of a silent no-op.

3. **Callback data stays in the existing `namespace:action:value` shape, namespace `wiz`.**
   The global `callback_query:data` handler already splits on `:`; wizard payloads use
   values with no internal colons (`wiz:type:doubles`, `wiz:date:2026-07-25`,
   `wiz:time:1830` — HHMM, not HH:MM), so the dispatcher needs no change beyond routing
   the `wiz` namespace to the wizard module. Every payload is validated against the
   user's *current* step; stale taps (e.g. on an old calendar message) answer with a hint
   rather than corrupting state.

4. **Calendar is a hand-rolled month grid.**
   7-column day grid, header `‹ July 2026 ›` with `wiz:cal:2026-08` navigation, past days
   rendered as no-op placeholders, ~14-month forward horizon. `telegram-inline-calendar`
   was considered and rejected: the hand-rolled grid is <100 lines, dependency-free, and
   we control the look and the callback format.

5. **Time slots come from config.**
   `WIZARD_TIME_START` (default 07:00), `WIZARD_TIME_END` (default 22:00),
   `WIZARD_TIME_STEP_MINUTES` (default 30) render as a button grid (4 per row). Combined
   with the picked date into the same UTC `Date` the parser path produces.

6. **Player picker lists registered users; typed usernames stay as escape hatch.**
   A new `listRegisteredUsers` domain query feeds a paginated inline keyboard (8 per
   page) excluding the creator and already-picked players; each tap toggles selection,
   with a running "picked: …" summary and a Done button enabled once the slot count is
   satisfied (1 for singles, 3 for doubles). While the wizard is on the player/bench step,
   a plain text message containing `@username`s is parsed as manual additions — this is
   the only place the wizard reads message text, and it covers not-yet-registered players
   exactly like the power syntax does. Bench step is doubles-only, optional, same picker,
   Skip button.

7. **`/newmatch` is removed, not aliased.**
   The handler for `/newmatch` is replaced by a one-line reply pointing at `/match`.
   Rationale: the bot is pre-rollout (no real users yet), so carrying a permanent alias
   only adds a second name to document. **BREAKING** but victimless today.

8. **Wizard completion calls `createMatch` with the identical input shape as the parser
   path** (`type`, `scheduledAt`, `otherMainParticipants` as direct-invite specs,
   `benchTelegramUserIds`), so domain logic, invitations, and notifications are shared
   and the existing tests keep covering the core.

## Risks / Trade-offs

- [In-memory wizard state lost on restart] → Acceptable: wizard is short-lived; expired-tap
  handling gives a clear "start again" message. Revisit only if restarts become frequent.
- [Callback messages outlive the wizard (user scrolls up and taps an old keyboard)] → Every
  `wiz:` payload is checked against current step + wizard existence; mismatches get an
  `answerCallbackQuery` hint, never a state write.
- [Registered-user list grows beyond a usable keyboard] → Pagination at 8/page from day one;
  fine for a friends-group bot's realistic scale.
- [Two entry paths to `createMatch` drift apart] → Wizard builds the same input type and
  reuses `MainParticipantSpec`; a test asserts wizard output equals parser output for an
  equivalent match.
- [Renaming to `/match` breaks muscle memory / old docs] → Pre-rollout; `/newmatch` replies
  with a pointer; README/USAGE/BotFather list updated in the same change.

## Migration Plan

Single deploy; no data migration. Update the BotFather `/setcommands` list (replace
`newmatch` with `match`) when rolling out. Rollback = redeploy previous build (no
persistent state involved).

## Open Questions

- None blocking. Timezone UX (entering local time instead of UTC) is deliberately deferred.
