## 1. Dependency & Scaffolding

- [x] 1.1 Add `@grammyjs/menu` (compatible 1.x pin) to package.json and install
- [x] 1.2 Create `src/bot/menu/` module skeleton with a `createMenus(domain, deps)` factory returning the root menu instance
- [x] 1.3 Install the menu middleware in `src/bot/index.ts` before `registerHandlers`; register the `/menu` command replying with the root menu; mention `/menu` in the `/start` welcome

## 2. Action Availability & Data

- [x] 2.1 Implement `availableMatchActions(domain, matchId, userId)` → {venue, reschedule, retire, cancel} derived from participant role, match type, and overall status
- [x] 2.2 Unit tests for `availableMatchActions` (singles vs doubles, pending vs confirmed vs cancelled, main vs bench, non-participant)

## 3. Menu Tree

- [x] 3.1 Root menu: New match / My matches / Pending invites / My info entries
- [x] 3.2 My matches dynamic range from `getUpcomingMatchesForUser` (label: type, date/time, status; 10-row cap with "showing first 10" note; empty state)
- [x] 3.3 Per-match submenu rendering from `availableMatchActions`, with Back
- [x] 3.4 Cancel confirmation sub-level (Really cancel? / Back) wired to `cancelMatch`
- [x] 3.5 Retire action wired to `retireFromDoublesMatch` with result feedback
- [x] 3.6 Pending invites dynamic range from `getPendingInvitationsView` with ✅/❌ wired to the existing confirm/decline and queue accept/decline functions; empty state
- [x] 3.7 My info view (identity + `buildInviteLink`)
- [x] 3.8 New match entry launching `startWizard`

## 4. Text Prompt & Reschedule Flow

- [x] 4.1 `PromptStore` (per-user pending venue prompt: matchId, expiry; expiry sweep alongside the wizard sweep; one-pending-interaction rule with the wizard, both directions)
- [x] 4.2 Set venue action: record prompt, ask for text; route venue replies in the `message:text` fallthrough (wizard picker first, then venue prompt) via `submitVenue`
- [x] 4.3 Extend `WizardState` with `mode: 'create' | 'reschedule'` (+ `matchId`); reschedule mode enters at the date step, skips type/players/bench, summary shows old → new time
- [x] 4.4 Reschedule confirm calls `proposeReschedule`; wire the menu's Reschedule button to start a reschedule-mode wizard
- [x] 4.5 Unit tests: prompt store expiry + supersession, reschedule-mode step sequence, reschedule-mode create action

## 5. Tests

- [x] 5.1 Stubbed-bot test: `/menu` renders root; My matches lists a created match; cancelled match disappears on re-render
- [x] 5.2 Stubbed-bot test: per-match submenu action visibility (singles hides Retire; cancelled match shows nothing)
- [x] 5.3 Stubbed-bot test: venue prompt end-to-end (tap Set venue → text reply → venue stored + participants notified)
- [x] 5.4 Stubbed-bot test: menu reschedule end-to-end (pick date/time → proposal created, others reset to invited)
- [x] 5.5 Stubbed-bot test: pending invite accept from menu confirms the participant

## 6. Docs & Rollout

- [x] 6.1 Update `docs/USAGE.md` and `README.md`: `/menu` walkthrough, refreshed BotFather block (add `menu - Open the Teleplay menu`)
- [x] 6.2 Manual end-to-end test on the live local bot: navigate all levels, set venue, reschedule, cancel with confirm, accept an invite, stale-menu tap
