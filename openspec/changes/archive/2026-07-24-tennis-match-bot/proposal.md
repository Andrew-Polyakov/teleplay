## Why

Organizing casual tennis matches today happens over scattered chat messages: someone proposes a time, players confirm ad hoc, a court gets booked (or forgotten) by whoever remembers, and cancellations/reschedules get lost in unrelated group chats. There's no single place tracking who's playing, whether a court is booked, or reminding players before the match. **Teleplay**, a Telegram bot, can own this workflow end to end: match setup, court booking accountability, reminders, and clean cancellation/reschedule handling.

## What Changes

- Add Teleplay, a Telegram bot that lets a player create a match (singles or doubles), inviting the other participant(s).
- Add a requirement that every match has a court/venue attached before it's considered confirmed — one of the players submits the venue to the bot via a command/flow.
- Add pre-match notifications sent to all participants ahead of the scheduled time.
- Add cancellation handling: any participant can cancel a match, which notifies the other participants.
- Add rescheduling handling: a participant can propose a new time/court for an existing match, which the other participant(s) must confirm.
- Track match state (proposed → confirmed → venue-set → reminded → completed/cancelled) so the bot knows when a match is actually ready to go.
- Add bench/substitute players to doubles matches: an organizer can attach standby players who can step in at the last moment if one of the four main players has to retire, without cancelling or fully re-confirming the match.
- Add an ordered invitation queue for filling an open match slot (a main slot at creation, or a bench slot during retirement call-up): a player declares candidates in priority order, and the bot invites them one at a time. Each candidate has 1 hour to accept; if they don't, the bot moves to the next candidate in the list. As soon as one candidate accepts, no further invitations from that queue are sent. Each invitation states the match format (singles/doubles), time, and venue.
- Add a way for a player to view their current schedule: a command that lists their upcoming matches (as a main or bench participant) along with pending invitations they've been queued for.

## Capabilities

### New Capabilities
- `match-scheduling`: Creating a match (singles or doubles), inviting participants, participants confirming or declining, and (for doubles) attaching bench/standby players.
- `venue-booking`: Submitting, storing, and confirming the court/venue for a specific match; enforcing that a match isn't fully confirmed until a venue is set.
- `match-notifications`: Sending pre-match reminder notifications to all confirmed participants at appropriate lead times.
- `match-lifecycle`: Cancelling a match, rescheduling a match (new time and/or venue) with re-confirmation, and substituting a retiring main doubles player with a confirmed bench player.
- `invitation-queue`: Filling an open match slot (main or bench) from an ordered list of candidates, inviting one at a time with a 1-hour response window per candidate, stopping as soon as one accepts.
- `match-schedule-view`: Letting a player view their own current schedule — upcoming matches they're committed to, and invitations they're currently queued for.

### Modified Capabilities
(none — greenfield project, no existing specs)

## Impact

- New Telegram bot service (Teleplay) with commands/conversation flows for creating matches, submitting venues, cancelling, rescheduling.
- New persistence for matches, participants, and venues.
- New scheduled job/worker for sending pre-match notifications.
- No existing systems affected (this is a new project).
