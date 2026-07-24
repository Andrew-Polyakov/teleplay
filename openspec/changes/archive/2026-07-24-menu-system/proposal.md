## Why

Outside the `/match` wizard, every interaction is still a typed command with a memorized
match id (`/venue 3 Court 5`, `/cancel 2`, `/retire 4`), and invalid actions are only
discovered after a rejection reply. A hierarchical menu — one message that edits itself as
you tap through levels — lets players find and act on their matches without typing ids or
remembering command names, and only shows actions that are actually valid for that match.

## What Changes

- New `/menu` command (also offered in the `/start` welcome) opening a nested inline menu:
  - **🎾 New match** — launches the existing `/match` wizard.
  - **📅 My matches** — one button per upcoming match (from the player's schedule query),
    each opening a per-match submenu with context-sensitive actions:
    - **📍 Set venue** — prompts for the venue as a text reply (no match id to type).
    - **🔁 Reschedule** — reuses the wizard's calendar + time-slot keyboards to pick the
      new time, then routes through the existing reschedule proposal flow.
    - **🚪 Retire** — only shown for confirmed doubles matches the player mains in.
    - **❌ Cancel match** — with a tap-to-confirm second step.
    - **‹ Back** navigation at every level.
  - **⏳ Pending invites** — the player's open invitations (match invites and queue
    offers) with ✅ Accept / ❌ Decline right on the menu.
  - **ℹ️ My info** — registered identity plus the shareable invite link for friends who
    haven't started the bot.
- Menus are backed by live data at render time; buttons for actions that are no longer
  valid (cancelled match, expired invite) disappear on re-render, and taps on outdated
  menu messages get a refresh hint instead of acting on stale state.
- New dependency: `@grammyjs/menu` (declarative nested menus, navigation stack, callback
  routing).
- All existing commands keep working unchanged — the menu is an additional surface over
  the same domain functions, not a replacement.

## Capabilities

### New Capabilities
- `menu-navigation`: the `/menu` entry point, the menu tree and its navigation (submenus,
  back buttons, stale-menu handling), dynamic per-match and per-invite listings,
  context-sensitive action visibility, and the menu-driven venue text prompt and
  reschedule picker.

### Modified Capabilities

<!-- none — every menu action delegates to existing domain behavior (venue-booking,
match-lifecycle, invitation-queue, match-schedule-view requirements are unchanged; the
menu is a new entry surface, which the new menu-navigation spec covers) -->

## Impact

- `package.json` — add `@grammyjs/menu`.
- New `src/bot/menu/` module(s) — menu tree definition, per-match submenu rendering,
  pending-invite rendering, venue-prompt state.
- `src/bot/handlers.ts` — register `/menu`, route menu-owned text replies (venue prompt),
  mention `/menu` in the `/start` welcome.
- `src/bot/index.ts` — install the menu middleware (must be registered before handlers).
- `src/bot/wizard/` — calendar/time keyboards reused by the menu's reschedule picker;
  wizard state gains a reschedule variant (or the menu carries its own small state map,
  decided in design).
- `src/domain/schedule.ts` / `src/domain/lifecycle.ts` — reused as-is; possibly one new
  query for "actions valid for this match + player".
- `docs/USAGE.md`, `README.md`, BotFather command list — add `menu`.
- No schema/database changes.
