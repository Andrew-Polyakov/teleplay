## 1. Command Rename & Config

- [x] 1.1 Rename the command registration: `/match` runs the existing parse-or-create flow when arguments are present; `/newmatch` replies with a one-line pointer to `/match`
- [x] 1.2 Update usage/error strings in `src/bot/parse.ts` from `/newmatch` to `/match`
- [x] 1.3 Add wizard config: `WIZARD_TIME_START`, `WIZARD_TIME_END`, `WIZARD_TIME_STEP_MINUTES`, `WIZARD_TIMEOUT_MINUTES` in `src/config.ts` and `.env.example` (defaults 07:00, 22:00, 30, 10)

## 2. Domain Support

- [x] 2.1 Add `listRegisteredUsers` query to `src/domain/users.ts` (ordered by display name, excludes nothing — filtering happens in the picker)
- [x] 2.2 Unit test for `listRegisteredUsers`

## 3. Wizard State Machine

- [x] 3.1 Create `src/bot/wizard/state.ts`: `WizardState` type (step discriminant, type, date, time, selected players, bench, message ids, lastActivityAt), per-user `Map` store with get/set/clear and idle-expiry sweep function
- [x] 3.2 Wire the expiry sweep into the existing interval-worker pattern (`src/bot/workers.ts`)
- [x] 3.3 Unit tests for state store: replace-on-restart, expiry, step guards

## 4. Wizard Keyboards

- [x] 4.1 Create `src/bot/wizard/keyboards.ts`: match-type keyboard (`wiz:type:*`)
- [x] 4.2 Calendar month grid (`wiz:cal:YYYY-MM` navigation, `wiz:date:YYYY-MM-DD` selection, past days inert, forward horizon)
- [x] 4.3 Time-slot grid from config (`wiz:time:HHMM`, 4 per row)
- [x] 4.4 Paginated player picker (`wiz:player:<id>` toggle, `wiz:page:<n>`, Done/Skip controls) with selected-players summary rendering
- [x] 4.5 Confirmation summary keyboard (Create / Cancel)
- [x] 4.6 Unit tests for calendar rendering (month boundaries, past-day inertness) and time-slot generation

## 5. Wizard Handlers

- [x] 5.1 Create `src/bot/wizard/handlers.ts`: `/match` no-args entry point (registered-user guard, replace active wizard, send type step)
- [x] 5.2 Callback routing for the `wiz` namespace from the global `callback_query:data` dispatcher, with step validation and expired/stale-tap hint answers
- [x] 5.3 Step transitions: type → calendar → time → players → (bench for doubles) → summary, editing messages in place
- [x] 5.4 Typed-`@username` text handler active only during player/bench steps (manual additions, same slot-count limits)
- [x] 5.5 Create action: build the same input as the parser path and call `createMatch`; clear state; surface invite-link fallback for unregistered typed usernames
- [x] 5.6 Cancel action and wizard-replaced/expired messaging

## 6. Tests & Docs

- [x] 6.1 Integration-style test: wizard step sequence for a singles match produces a `createMatch` call identical to the equivalent one-line `/match` command
- [x] 6.2 Integration-style test: doubles flow with bench selection and with Skip
- [x] 6.3 Test: `/newmatch` no longer creates and hints at `/match`; `/match <args>` parses as before
- [x] 6.4 Update `docs/USAGE.md` and `README.md`: command rename, wizard walkthrough, refreshed BotFather `/setcommands` block (`match` replaces `newmatch`)
- [x] 6.5 Manual end-to-end test on the live local bot: full wizard doubles flow with bench, plus power-syntax `/match`, plus stale-tap and timeout behavior
