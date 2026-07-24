# match-scheduling Specification

## Purpose
TBD - created by archiving change tennis-match-bot. Update Purpose after archive.
## Requirements
### Requirement: Create a match
A player SHALL be able to create a match by specifying the match type (singles or doubles), a proposed date/time, and the other participant(s).

#### Scenario: Player creates a singles match
- **WHEN** a player starts the "new match" flow, selects singles, picks a date/time, and selects one other participant who has already started the bot
- **THEN** the system creates a match with `overallStatus = pending`, records both participants with `participantStatus = invited` for the invitee and `confirmed` for the creator, and sends the invitee a confirmation request

#### Scenario: Player creates a doubles match
- **WHEN** a player starts the "new match" flow, selects doubles, picks a date/time, and selects three other participants who have all already started the bot
- **THEN** the system creates a match with exactly 4 participant slots, records the creator as `confirmed` and the other three as `invited`, and sends each invitee a confirmation request

#### Scenario: Invited participant hasn't started the bot
- **WHEN** the creator tries to add a participant who has no stored chat id with the bot
- **THEN** the system does not add that participant, and instead returns a shareable invite link/message the creator can forward

### Requirement: Confirm or decline a match invitation
An invited participant SHALL be able to confirm or decline a match they were invited to.

#### Scenario: Participant confirms
- **WHEN** an invited participant responds "confirm" to a match invitation
- **THEN** the system sets that participant's `participantStatus` to `confirmed`

#### Scenario: Participant declines
- **WHEN** an invited participant responds "decline" to a match invitation
- **THEN** the system sets that participant's `participantStatus` to `declined` and notifies the other participants that the match cannot proceed as configured

### Requirement: Match reaches confirmed status
The system SHALL transition a match to `overallStatus = confirmed` only once every main participant slot (2 for singles, 4 for doubles) has `participantStatus = confirmed`. Bench slots are not counted toward this transition.

#### Scenario: All participants confirm a singles match
- **WHEN** both participants of a singles match have `participantStatus = confirmed`
- **THEN** the system sets `overallStatus = confirmed`

#### Scenario: Not all participants have confirmed
- **WHEN** at least one main participant of a match still has `participantStatus = invited`
- **THEN** the system keeps `overallStatus = pending` and the match is not eligible for reminders

#### Scenario: Bench players pending doesn't block confirmation
- **WHEN** all 4 main slots of a doubles match have `participantStatus = confirmed`, but one or more attached bench players still have `participantStatus = invited`
- **THEN** the system sets `overallStatus = confirmed` regardless of the bench players' status

### Requirement: Attach bench players to a doubles match
The organizer of a doubles match SHALL be able to attach one or more bench/standby players to the match, distinct from the 4 main players.

#### Scenario: Organizer adds a bench player at creation
- **WHEN** a player creates a doubles match and additionally selects one or more participants who have started the bot to be added as bench players
- **THEN** the system records each as a `MatchParticipant` with `slotType = bench` and `participantStatus = invited`, and sends each a standby invitation

#### Scenario: Bench player accepts standby
- **WHEN** a bench player responds "confirm" to a standby invitation
- **THEN** the system sets that bench player's `participantStatus` to `standby-confirmed`

#### Scenario: Bench players not available for singles
- **WHEN** a player attempts to attach a bench player to a singles match
- **THEN** the system rejects the request, since bench players are only supported for doubles matches

### Requirement: Fill a main slot from a candidate queue
When creating a match, a player SHALL be able to fill a main slot by declaring an ordered list of candidates instead of naming one fixed participant, using the invitation queue mechanism.

#### Scenario: Player declares a candidate queue for an open main slot
- **WHEN** a player creates a match and, for one of the main slots, provides an ordered list of candidate players instead of a single participant
- **THEN** the system creates a candidate queue for that slot and invites the first candidate, per the invitation queue behavior

#### Scenario: Slot filled once a queued candidate accepts
- **WHEN** a candidate from a main slot's queue accepts their invitation
- **THEN** the system records that candidate as the main participant for that slot with `participantStatus = confirmed`, and the match's confirmation check proceeds as normal for the remaining slots

### Requirement: Match creation command entry points
The match-creation command SHALL be `/match`. When invoked with arguments it SHALL behave as the existing one-line syntax (`/match <singles|doubles> <ISO time> <slot>... [bench:...]`, including `queue:` slots); when invoked with no arguments it SHALL start the interactive match-creation wizard. The former `/newmatch` command SHALL no longer create matches and SHALL reply with a pointer to `/match`.

#### Scenario: Power syntax under the new name
- **WHEN** a registered user sends `/match doubles 2026-03-01T18:00:00Z @p2 @p3 @p4 bench:@sub1`
- **THEN** the system parses and creates the match exactly as `/newmatch` did before the rename

#### Scenario: Bare command starts the wizard
- **WHEN** a registered user sends `/match` with no arguments
- **THEN** the system starts the interactive match-creation wizard instead of replying with a usage error

#### Scenario: Old command name is retired
- **WHEN** a user sends `/newmatch` (with or without arguments)
- **THEN** the system does not create a match and replies telling the user to use `/match`

