## Context

The bot has two interaction styles today: typed commands with match-id arguments
(`/venue 3 Court 5`, `/cancel 2`) and two bespoke callback surfaces — action buttons on
notifications (`match:`/`bench:`/`invite:` namespaces) and the `/match` wizard (`wiz:`
namespace, in-memory per-user state with idle expiry, one self-editing message). The
schedule data needed for a menu already exists (`getUpcomingMatchesForUser`,
`getPendingInvitationsView`), as do all the actions (venue, cancel, reschedule, retire,
accept/decline). What's missing is a navigable surface that ties them together without
ids or command syntax.

## Goals / Non-Goals

**Goals:**
- One `/menu` message the player can navigate down (submenus) and up (back buttons)
  covering: new match, my matches with per-match actions, pending invites, my info.
- Context-sensitive buttons: an action appears only when it would succeed for that match
  and player (no Retire on singles, no actions on cancelled matches).
- Live data on every render; taps on an outdated menu message refresh instead of acting
  on stale state.
- Existing commands, notification buttons, and the wizard remain untouched surfaces over
  the same domain functions.

**Non-Goals:**
- Group-chat menus — private chats only, like the rest of the bot.
- Menu-driven bench management, queue declaration, or match creation beyond launching the
  existing wizard (those stay command/wizard territory).
- Pagination of long match lists (list is capped with a hint; realistic scale is a
  friends group).
- Persisting menu or prompt state across restarts (same stance as the wizard).

## Decisions

1. **Adopt `@grammyjs/menu` rather than extending the hand-rolled `wiz:` pattern.**
   The wizard is a linear flow, where a hand-rolled state machine is natural. A menu tree
   is different: arbitrary depth, back navigation, many small handlers — exactly what the
   plugin gives declaratively (`Menu`, `.submenu()`, `.back()`, dynamic ranges), including
   callback routing and detection of outdated menu messages (fingerprint mismatch →
   configurable "menu updated" answer + re-render). Hand-rolling all that would be a
   larger, buggier version of the plugin. Trade-off accepted: first runtime dependency
   beyond grammy/drizzle/dotenv, and menu construction happens at module level (needs the
   domain context injected via a factory, mirroring `registerHandlers`).

2. **One menu instance, dynamic ranges keyed by ids in payload.**
   A single root `Menu` with `menu.dynamic()` ranges: "My matches" renders one row per
   upcoming match (`getUpcomingMatchesForUser`), "Pending invites" one row per open
   invitation. Payloads carry only the match/entry id; every render re-queries, so a
   cancelled match simply stops appearing. Match lists are capped at 10 rows with a
   "showing first 10" label (`log`-free, purely visual) — no pagination machinery.

3. **Action visibility is computed by one helper, not scattered conditionals.**
   `availableMatchActions(domain, matchId, userId)` returns the set
   {venue, reschedule, retire, cancel} derived from existing domain rules (participant?
   overall status non-terminal? confirmed doubles main for retire?). The per-match submenu
   renders from that set, and the action handlers still call the domain functions (which
   re-validate), so the menu is a convenience filter, never the enforcement point.

4. **Venue entry via a per-user prompt store, sharing the wizard's text-fallthrough.**
   Tapping "Set venue" records `{ matchId, expiresAt }` in a small in-memory
   `PromptStore` (same shape/expiry-sweep pattern as `WizardStore`) and asks for a text
   reply. The existing `message:text` fallthrough routes: active wizard picker step first,
   else active venue prompt, else ignore. One pending text interaction per user — starting
   a wizard clears a venue prompt and vice versa, so a text reply is never ambiguous.

5. **Reschedule reuses the wizard's calendar and time keyboards via a wizard mode.**
   `WizardState` gains `mode: 'create' | 'reschedule'` (+ `matchId` when rescheduling).
   Reschedule mode enters at the date step, skips type/players/bench, and its final
   Confirm calls `proposeReschedule` instead of `createMatch`. This reuses the `wiz:`
   callback handling, stale-tap guards, idle expiry, and both keyboards with zero
   duplication. Alternative considered — a separate `resched:` mini-flow — rejected as a
   second copy of the same state machine.

6. **Cancel gets a tap-to-confirm second level.**
   "❌ Cancel match" opens a tiny submenu ("Really cancel? / ‹ Back") rather than acting
   on first tap — the only destructive action in the tree.

7. **Middleware order: menu plugin installs before `registerHandlers`.**
   The plugin consumes its own callback queries; everything else falls through to the
   existing global `callback_query:data` handler, whose `match:`/`bench:`/`invite:`/`wiz:`
   namespaces don't overlap plugin payloads. `/menu` itself is just another command in
   `registerHandlers`, replying with the root menu attached.

## Risks / Trade-offs

- [Plugin renders menus from module-level definitions; domain context needed at render
  time] → Build menus in a `createMenus(domain, deps)` factory called from `index.ts`,
  same dependency-injection style as the rest of the bot; tests construct it with the
  test context.
- [Menu message can outlive validity of its buttons (user scrolls up)] → Plugin
  fingerprinting detects outdated menus and re-renders; action handlers rely on domain
  validation as the backstop, answering with the domain error text.
- [Two text-input consumers (wizard, venue prompt) could both claim a reply] → Single
  "one pending interaction per user" rule (Decision 4) enforced in the store layer, unit
  tested.
- [`@grammyjs/menu` version drift vs pinned grammy 1.x] → Pin a compatible 1.x plugin
  version; it's a pure-TS package with no transitive runtime deps.
- [Wizard-mode branching creeps complexity into the create flow] → Reschedule mode only
  touches step entry, step skip, and the final action; guarded by the `mode` discriminant
  and covered by dedicated tests.

## Migration Plan

Single deploy, no data migration. Add `menu - Open the Teleplay menu` to the BotFather
`/setcommands` list at rollout. Rollback = previous build (menus/prompts are in-memory).

## Open Questions

- None blocking. If match lists outgrow the 10-row cap in practice, pagination becomes a
  follow-up change.
