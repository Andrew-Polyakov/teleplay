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

### `/newmatch <singles|doubles> <ISO time> <slot>... [bench:@a,@b,...]`
Creates a match. Each `<slot>` after the type and time fills one of the *other* main player
slots (you don't list yourself — you're added automatically as confirmed):
- `singles` needs exactly 1 other slot.
- `doubles` needs exactly 3 other slots.

A slot is either:
- `@username` — directly invite that player.
- `queue:@a,@b,@c` — declare an ordered candidate queue for that slot. The bot invites `@a`
  first; if they don't accept within 1 hour (or decline), it moves to `@b`, then `@c`.

`bench:@a,@b` (doubles only) additionally attaches standby players who can be called up if a
main player has to retire later.

Examples:
```
/newmatch singles 2026-03-01T18:00:00Z @bob
/newmatch doubles 2026-03-01T18:00:00Z @p2 @p3 @p4 bench:@sub1,@sub2
/newmatch singles 2026-03-01T18:00:00Z queue:@a,@b,@c
```

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
