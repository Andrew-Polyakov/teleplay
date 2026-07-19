## 1. Project Setup

- [x] 1.1 Initialize Node.js + TypeScript project (package.json, tsconfig, lint/format config)
- [x] 1.2 Add bot framework dependency (grammY or Telegraf) and a basic `/start` handler that records the user's chat id
- [x] 1.3 Add ORM (Drizzle or Prisma) with a SQLite datasource and migration tooling
- [x] 1.4 Add environment/config loading (bot token, reminder lead time, invitation timeout, etc.)

## 2. Data Model

- [x] 2.1 Define `User` table (Telegram user id, chat id, display name, first-seen timestamp)
- [x] 2.2 Define `Match` table (type: singles/doubles, scheduled time, `overallStatus`, venue, reminder-sent flag, timestamps)
- [x] 2.3 Define `MatchParticipant` table (match id, user id, `participantStatus`, `slotType`: main/bench)
- [x] 2.4 Define `InvitationQueueEntry` table (match id, slot type, sequence position, candidate user id, status, invited-at, expires-at)
- [x] 2.5 Write and run initial migration

## 3. Invitation Queue Infrastructure

- [x] 3.1 Implement "declare candidate queue for a slot" function: create ordered `InvitationQueueEntry` rows, invite the first candidate
- [x] 3.2 Implement invitation content builder: match format, scheduled time, venue (or "venue TBD")
- [x] 3.3 Implement candidate accept handler: mark entry `accepted`, fill the target slot, close out remaining entries for that slot
- [x] 3.4 Implement candidate decline handler: mark entry `declined`, immediately activate next `queued` entry for that slot
- [x] 3.5 Implement expiry polling worker (same interval pattern as reminders): find `invited` entries past `expiresAt`, mark `expired`, activate next `queued` entry
- [x] 3.6 Implement "queue exhausted" notification to the player who declared the queue when no candidate accepts

## 4. Match Scheduling (creation, invites, confirmation)

- [x] 4.1 Implement "new match" conversation flow: choose singles/doubles, date/time, participant(s)
- [x] 4.2 Implement participant lookup by stored chat id; generate shareable invite link/message for users who haven't started the bot
- [x] 4.3 Implement invite delivery to each invited participant with confirm/decline actions
- [x] 4.4 Implement confirm handler: update `participantStatus`, check if all main slots confirmed, transition `overallStatus` to `confirmed`
- [x] 4.5 Implement decline handler: mark participant declined, notify other participants, keep match from becoming confirmed
- [x] 4.6 Implement "add bench player(s)" flow for doubles matches (reject for singles)
- [x] 4.7 Implement bench standby confirm/decline handler (`participantStatus = standby-confirmed`), excluded from the main-slot confirmation check
- [x] 4.8 Implement "fill main slot via candidate queue" option in the new-match flow, using the invitation queue infrastructure

## 5. Venue Booking

- [x] 5.1 Implement "submit venue" command/flow restricted to match participants
- [x] 5.2 Store venue on the match and mark venue-set state
- [x] 5.3 Implement venue update flow (replace existing venue, notify other participants) for non-terminal matches
- [x] 5.4 Gate "match ready" status (used by notifications) on both `overallStatus = confirmed` and venue set

## 6. Pre-Match Notifications

- [x] 6.1 Implement reminder-eligibility query (confirmed, venue set, not cancelled, within lead window, not yet reminded)
- [x] 6.2 Implement polling worker/job that runs on an interval and sends reminders to all participants of eligible matches
- [x] 6.3 Mark matches as reminded to prevent duplicate sends
- [x] 6.4 Ensure cancelled matches are excluded from reminder queries

## 7. Cancellation & Rescheduling

- [x] 7.1 Implement cancel command available to any participant; set `overallStatus = cancelled`, clear pending reminders, notify others
- [x] 7.2 Implement guard against cancelling an already-cancelled/completed match
- [x] 7.3 Implement reschedule proposal flow (new time and/or venue), resetting main participant confirmations except proposer
- [x] 7.4 Implement re-confirmation flow for rescheduled matches, reusing the confirm/decline handlers from match scheduling
- [x] 7.5 Implement decline-reschedule handling that keeps the match pending without discarding the prior confirmed state
- [x] 7.6 Implement "retire" command for a main doubles participant on a confirmed match, creating a candidate queue from standby-confirmed bench players in declared order
- [x] 7.7 Wire bench call-up acceptance to the invitation queue infrastructure: promote to `slotType = main` on accept, notify remaining main participants
- [x] 7.8 Ensure retirement/substitution does not reset `overallStatus` or trigger reschedule-style re-confirmation
- [x] 7.9 Implement "no bench candidate accepted" fallback, leaving the match cancellable via the existing cancel flow

## 8. Player Schedule View

- [x] 8.1 Implement schedule query: matches where the requester is a main/bench `MatchParticipant` with `overallStatus` in `pending`/`confirmed`, ordered by scheduled time
- [x] 8.2 Implement pending-invitations query: `InvitationQueueEntry` rows where the requester is the candidate with `status` in `queued`/`invited`
- [x] 8.3 Implement `/schedule` command rendering both sections (committed matches, then pending invitations with time-remaining for `invited` entries)
- [x] 8.4 Handle empty states (no upcoming matches / no pending invitations)

## 9. Testing & Polish

- [x] 9.1 Unit tests for match state transitions (confirm/decline/cancel/reschedule)
- [x] 9.2 Unit tests for reminder-eligibility query edge cases
- [x] 9.3 Unit tests for invitation queue advancement (accept, decline, expiry, exhausted queue)
- [x] 9.4 Unit tests for schedule/pending-invitations queries (ordering, exclusion of cancelled/completed matches)
- [x] 9.5 Manual end-to-end test: create singles match, confirm, submit venue, receive reminder
- [x] 9.6 Manual end-to-end test: create doubles match, cancel, reschedule, re-confirm
- [x] 9.7 Manual end-to-end test: create doubles match with bench players, retire a main player, first bench candidate lets invitation expire, second bench candidate accepts
- [x] 9.8 Manual end-to-end test: view `/schedule` showing a confirmed match, a pending invitation, and confirming no cancelled matches appear
- [x] 9.9 Write basic bot usage docs (commands, flows) for players
