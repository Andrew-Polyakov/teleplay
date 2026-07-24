# Teleplay

A Telegram bot for organizing tennis matches: create singles/doubles matches, invite
players (directly or via ordered candidate queues), book a court, get pre-match
reminders, and handle cancellations, reschedules, and last-minute substitutions.

## Highlights

- **🎛 Hierarchical `/menu`** — one self-editing message to browse your matches, act on
  them (venue, reschedule, retire, cancel), answer pending invites, and grab the invite
  link. Only currently-valid actions are shown, always from live data.
- **🧙 `/match` wizard** — create a match entirely with taps: singles/doubles buttons, an
  inline calendar, hourly time slots, and a tap-to-pick list of registered players. The
  one-line power syntax still works for those who prefer it.
- **💬 Direct chat links** — every match menu links straight to your opponents' Telegram
  chats.
- **🔔 Notifications that carry context** — invitations show who, when, and where;
  confirmations notify the whole lineup; reminders fire before venue-confirmed matches.
- **🪑 Doubles bench** — standby players get called up automatically (in order, with
  acceptance windows) when someone retires.

## Quick start

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `TELEGRAM_BOT_TOKEN` (from [@BotFather](https://t.me/BotFather)).
   For local development set `BOT_MODE=polling`.
3. `npm run db:migrate` to create the SQLite database.
4. `npm run dev` (or `npm run build && npm start`) to run the bot.

All other settings have working defaults — see `.env.example` for the reminder lead time,
invitation timeout, wizard time-slot range/step, and wizard/prompt idle timeout.

See [docs/USAGE.md](docs/USAGE.md) for full command syntax and the match lifecycle.
Specs live in `openspec/specs/` (one file per capability); development follows the
OpenSpec propose → apply → archive workflow in `openspec/changes/`.

## Commands

| Command | Description |
| --- | --- |
| `/start` | Register with the bot (required before anyone can invite you) |
| `/menu` | Navigable menu: your matches with actions, pending invites, new match |
| `/match` | Create a match — tap-through wizard, or one-line syntax for power users |
| `/confirm` | Confirm your spot in a match you were invited to |
| `/decline` | Decline a match invitation |
| `/bench_add` | Add standby bench players to a doubles match |
| `/bench_confirm` | Accept a standby bench spot |
| `/bench_decline` | Decline a standby bench spot |
| `/venue` | Set or update the court/venue for a match |
| `/cancel` | Cancel a match you're participating in |
| `/reschedule` | Propose a new time and/or venue (everyone re-confirms) |
| `/retire` | Leave a confirmed doubles match; bench players get called up |
| `/schedule` | Show your upcoming matches and pending invitations |

## Registering the command menu with BotFather

Send `/setcommands` to [@BotFather](https://t.me/BotFather), select this bot, and paste:

```
start - Register with the bot (required before anyone can invite you)
menu - Open the Teleplay menu
match - Create a match (tap-through wizard, or one-line syntax)
confirm - Confirm your spot in a match you were invited to
decline - Decline a match invitation
bench_add - Add standby bench players to a doubles match
bench_confirm - Accept a standby bench spot
bench_decline - Decline a standby bench spot
venue - Set or update the court/venue for a match
cancel - Cancel a match you're participating in
reschedule - Propose a new time and/or venue (everyone re-confirms)
retire - Leave a confirmed doubles match; bench players get called up
schedule - Show your upcoming matches and pending invitations
```
