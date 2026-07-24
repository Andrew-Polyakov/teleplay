## Context

Greenfield project (repo currently empty aside from OpenSpec scaffolding). No existing stack, data model, or bot to integrate with — this design picks the initial architecture for Teleplay, the Telegram bot described in the proposal.

Key Telegram platform constraint: a bot cannot message a user who has never started a conversation with it (no `/start`). This shapes how invites and notifications must work.

## Goals / Non-Goals

**Goals:**
- Let a player create a singles or doubles match and invite the other participant(s).
- Require a court/venue to be attached before a match counts as confirmed.
- Send pre-match reminders automatically.
- Support cancellation and rescheduling with re-confirmation of all participants.
- Survive process restarts without losing in-flight match state (multi-step flows, pending reminders).
- Allow doubles matches to have bench/standby players who can substitute in for a retiring main player at the last moment, without forcing a full match re-confirmation.
- Support filling an open match slot (main or bench) from an ordered candidate queue, inviting one candidate at a time with a bounded response window, so an organizer doesn't need every candidate to already be lined up.
- Let a player view their own current schedule: upcoming matches they're committed to, plus any pending invitations they're currently queued for.

**Non-Goals:**
- Payment/cost-splitting between players.
- Skill-based matchmaking, rankings, or opponent discovery/search.
- Recurring leagues/tournaments or ladder scheduling.
- A web dashboard — Telegram is the only interface.
- Court availability integration with real venues (venue is free-text/manual entry, not booked automatically through a third-party API).

## Decisions

- **Bot framework: Node.js + TypeScript + grammY (or Telegraf).**
  Both are mature Telegram bot frameworks with good middleware/session support for multi-step conversations. TypeScript keeps the match state machine and data model type-safe. Alternative considered: Python + python-telegram-bot — equally viable; Node/TS chosen for simpler cron-style scheduling (single runtime for bot + reminder worker) and no strong existing stack preference in the repo.

- **Persistent storage: SQLite via a lightweight ORM (e.g. Drizzle or Prisma).**
  Match volume is small (a bot for a friend group/club, not a marketplace), so a single-file database avoids operational overhead. Alternative: Postgres — deferred until/unless multi-instance deployment or heavier concurrent load is needed; the data model will stay ORM-based so migrating later is low-cost.

- **Conversation/match state stored in the database, not in-memory.**
  Multi-step flows (create match, submit venue, propose reschedule) and pending reminders must survive bot restarts. Only short-lived UI state (e.g. "what step of this dialog is the user on") may use in-memory/session middleware; anything that represents a real match fact (participants, confirmations, venue, schedule) is persisted immediately.

- **Match state machine.**
  A match has:
  - `participantStatus` per participant: `invited | confirmed | declined`
  - `venue`: unset until one participant submits it
  - `overallStatus`: `pending` (invites out) → `confirmed` (all participants accepted) → `cancelled` | `completed`
  - Reminders are only scheduled once `overallStatus = confirmed` **and** a venue is set.
  This separates "people agreed to play" from "the match is actually ready," matching the proposal's requirement that a court is mandatory.

- **Reminder delivery via a polling worker, not per-match timers.**
  A scheduled job runs on a short interval (e.g. every 1–5 minutes), queries matches with an unset "reminder sent" flag whose match time is within the configured lead window, and sends notifications. This is simpler and more restart-safe than scheduling in-process timers per match (which would need to be re-armed on every restart anyway).

- **Invite mechanism respects the "bot can't DM first" constraint.**
  Only players who have already started the bot (have a stored Telegram chat id) can be added as participants. When a player tries to invite someone who hasn't started the bot, the bot returns a shareable deep-link/instructions instead of silently failing.

- **Doubles participant model.**
  A doubles match has exactly 4 main participant slots (2 vs 2); a singles match has exactly 2. The organizer fills the remaining slots at creation time; each invited participant confirms independently. The match only reaches `confirmed` once all main slots are filled and confirmed.

- **Bench players and last-moment substitution (doubles only).**
  `MatchParticipant` gains a `slotType` of `main` or `bench`. Bench players are optional, doubles-only, and attached at match creation (or added later) by the organizer as an ordered list; each is asked to opt in as available (`participantStatus: invited | standby-confirmed | declined`), and this opt-in ask is sent to all of them up front (it's just building the standby pool, not filling a specific vacancy yet). Bench slots are never counted toward the match reaching `overallStatus = confirmed` — only the 4 main slots are. When a main participant marks themselves as retiring, the vacated slot is filled via the invitation queue mechanism below, working through the standby-confirmed bench players in their declared order. Because the match was already `confirmed` and venue was already set, a successful call-up does **not** reset `overallStatus` or require re-confirmation from the unaffected main participants — it's a narrower transition than a full reschedule. If the bench queue is exhausted with no acceptance, the match falls back to the existing cancellation flow (a main participant/organizer cancels).

- **Ordered invitation queue for filling a match slot.**
  A new `InvitationQueueEntry` table holds, per open slot (`matchId`, `slotType`), an ordered list of candidate users: `sequencePosition`, `candidateUserId`, `status` (`queued | invited | accepted | declined | expired`), `invitedAt`, `expiresAt`. Only one entry per slot is ever `invited` at a time. A polling worker (same pattern as the reminder worker, e.g. every 1–5 minutes) finds `invited` entries whose `expiresAt` (1 hour after `invitedAt`) has passed, marks them `expired`, and activates the next `queued` entry for that slot — setting it to `invited`, stamping `invitedAt`/`expiresAt`, and sending the invitation. An explicit decline advances the queue immediately rather than waiting out the hour. Every invitation message states the match format (singles/doubles), scheduled time, and venue (or "venue TBD" if not yet set). When a candidate accepts, their entry is marked `accepted`, the slot's `MatchParticipant` record is created/updated (main slot: `participantStatus = confirmed`; bench slot: `standby-confirmed`), and any other `queued`/`invited` entries for that slot are closed out (no further invitations sent). This same mechanism is reused both for filling a main slot at match creation (an alternative to directly naming a fixed participant) and for bench call-up on retirement — the only difference is which slot type the queue targets.

- **Schedule view is a read-only query, not new state.**
  A `/schedule` command queries, for the requesting user: (a) matches where they're a `MatchParticipant` (main or bench) with `overallStatus` in `pending`/`confirmed`, ordered by scheduled time ascending, and (b) `InvitationQueueEntry` rows where they're the candidate with `status` in `queued`/`invited`. The two are rendered as separate sections — "your matches" (things you're committed to, showing type, time, opponent(s)/partner, venue-or-TBD, and status) and "pending invitations" (things you've been offered but haven't accepted, including how long until that invitation expires) — since mixing them would blur the line between a commitment and an offer. No new tables or state transitions are needed; this reuses existing data.

## Risks / Trade-offs

- **[Risk]** Users who haven't started the bot can't be invited directly. → **Mitigation**: bot generates a shareable invite link/message the organizer can forward; once the invitee starts the bot via that link, they're auto-added to the pending match.
- **[Risk]** Reschedule and cancellation could race (e.g. two participants act at the same time). → **Mitigation**: state transitions are guarded by the match's current `overallStatus`/version; a stale action is rejected with a clear "this match already changed" message.
- **[Risk]** Polling-based reminders add up-to-one-interval delay and a small always-on worker cost. → **Mitigation**: acceptable given lead times are on the order of hours, not seconds; interval is configurable.
- **[Risk]** Time zone handling across participants. → **Mitigation**: store all match times in UTC; format in each user's configured (or Telegram client default) time zone when displaying/notifying.
- **[Risk]** SQLite limits concurrent write throughput. → **Mitigation**: acceptable at expected scale; revisit only if the bot grows beyond a single small deployment.
- **[Risk]** Multiple bench players could try to accept a standby call-up at the same time. → **Mitigation**: first-accept-wins guarded by the vacated slot's state; late acceptors are told the slot is already filled.
- **[Risk]** Sequential queue invitations mean a slot can take hours to fill if early candidates all let their 1-hour window lapse. → **Mitigation**: acceptable trade-off for simplicity; the organizer can see queue progress and cancel/adjust manually if it's taking too long.
- **[Risk]** A candidate could decline and later change their mind after the queue has moved on. → **Mitigation**: once an entry is `declined` or `expired`, it's not reactivated; the organizer would need to re-add them as a new queue entry.

## Migration Plan

Not applicable — greenfield build, no existing system or data to migrate.

## Open Questions

- Should rescheduling require unanimous re-confirmation from all participants, or just acknowledgement (notify-only)? Current spec assumes re-confirmation is required, mirroring the initial confirmation flow.
- Should a player be able to belong to multiple pending matches at overlapping times, or should the bot warn/block on conflicts? Not addressed in this change — left as a future enhancement.
