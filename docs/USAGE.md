# Teleplay — usage guide

Teleplay is a Telegram bot for organizing tennis matches: creating singles/doubles matches,
booking a court, sending pre-match reminders, and handling cancellations, reschedules, and
last-minute doubles substitutions.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `TELEGRAM_BOT_TOKEN` (from [@BotFather](https://t.me/BotFather)).
3. `npm run db:migrate` to create the SQLite database.
4. `npm run dev` (or `npm run build && npm start`) to run the bot.

Everyone who wants to be invited to a match must send `/start` to the bot **before** anyone
tries to invite them — Telegram bots can't message a user who hasn't started a conversation
with them first. Teleplay identifies players by their Telegram `@username`, so make sure you
have one set in Telegram.

## Commands

### `/start`
Registers you with the bot. Do this first.

### `/menu`
Opens the navigable menu — the easiest way to use the bot. One message with buttons that
you tap through:

- **🎾 New match** — starts the `/match` wizard.
- **📅 My matches** — every upcoming match you're in; tap one for its actions:
  **📍 Set venue** (just reply with the venue text — no match id needed),
  **🔁 Reschedule** (calendar + time picker), **🚪 Retire** (confirmed doubles only),
  **❌ Cancel match** (asks for a confirming second tap).
- **⏳ Pending invites** — everything waiting on your answer, with ✅ Accept / ❌ Decline
  right there.
- **ℹ️ My info** — how you're registered, plus the invite link to forward to friends.

Only valid actions are shown (e.g. no Retire on a singles match), and the menu always
reflects live data — if it's outdated when you tap, it refreshes instead of acting.

### `/match` — interactive wizard
Send `/match` with nothing after it and the bot walks you through creating a match with
buttons — no syntax to remember:

1. **Singles or Doubles** — tap one.
2. **Date** — tap a day on the calendar (‹ › to change month; past days are disabled).
3. **Time** — tap a slot (07:00–22:00 UTC, hourly by default).
4. **Players** — tap the other player(s) from the list of everyone registered with the bot
   (1 for singles, 3 for doubles). You can also just type `@username`s — useful for people
   who haven't started the bot yet.
5. **Bench** (doubles only) — optionally tap standby players, or Skip.
6. **Summary** — review and tap **Create match**.

An idle wizard expires after 10 minutes; sending `/match` again always starts fresh.

### `/match <singles|doubles> <ISO time> <slot>... [bench:@a,@b,...]` — one-line syntax
The power-user alternative: same result as the wizard, one message. Each `<slot>` after the
type and time fills one of the *other* main player slots (you don't list yourself — you're
added automatically as confirmed):
- `singles` needs exactly 1 other slot.
- `doubles` needs exactly 3 other slots.

A slot is either:
- `@username` — directly invite that player.
- `queue:@a,@b,@c` — declare an ordered candidate queue for that slot. The bot invites `@a`
  first; if they don't accept within 1 hour (or decline), it moves to `@b`, then `@c`.
  (Queues are only available through this syntax, not the wizard.)

`bench:@a,@b` (doubles only) additionally attaches standby players who can be called up if a
main player has to retire later.

Examples:
```
/match singles 2026-03-01T18:00:00Z @bob
/match doubles 2026-03-01T18:00:00Z @p2 @p3 @p4 bench:@sub1,@sub2
/match singles 2026-03-01T18:00:00Z queue:@a,@b,@c
```

(`/newmatch` was the old name for this command; it now just points you to `/match`.)

### `/confirm <matchId>` / `/decline <matchId>`
Accept or decline a match invitation you received as a main participant. (You can also use the
inline "Confirm/Decline" buttons on the invitation message itself.)

### `/bench_confirm <matchId>` / `/bench_decline <matchId>`
Accept or decline being on the standby bench for a doubles match.

### `/bench_add <matchId> @a,@b,...`
Attach additional bench players to an existing doubles match.

### `/venue <matchId> <venue text>`
Submit (or update) the court/venue for a match. Any participant can do this. A match isn't
considered ready for reminders until a venue is set, even if everyone has confirmed.

### `/cancel <matchId>`
Cancel a match. Any participant can do this at any point before the match is completed.

### `/reschedule <matchId> [ISO time] [new venue text...]`
Propose a new time and/or venue. This resets every other main participant back to "invited" —
everyone needs to `/confirm` again (via the same `/confirm` command) before the match is
`confirmed` again with the new time/venue applied.

### `/retire <matchId>`
For a confirmed doubles match: mark yourself as retiring. The bot offers your slot to the
match's standby-confirmed bench players, one at a time (in the order they were added), each
with a 1-hour window to accept. The match stays `confirmed` throughout — the other three
players are not asked to re-confirm.

### `/schedule`
Shows your current schedule: upcoming matches you're committed to (main or bench), and any
invitation-queue offers you're still queued or invited for (with time remaining, for active
offers).

## How invitations resolve

Whenever a match, bench spot, or invitation-queue slot needs a decision from you, you'll get
a message with **Confirm/Decline** (or **Accept/Decline**) inline buttons — tapping them is
equivalent to running the matching `/confirm`, `/decline`, `/bench_confirm`, etc. command.

## Match lifecycle at a glance

```
pending --(all main slots confirmed)--> confirmed --(reschedule proposed)--> pending
   |                                        |
   +--------------- /cancel ----------------+----------------------------> cancelled
                                             |
                                    (doubles) /retire -> bench call-up -> confirmed (same status)
```

A match only becomes reminder-eligible once it is `confirmed` **and** has a venue set.
