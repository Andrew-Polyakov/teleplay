## ADDED Requirements

### Requirement: Declare an ordered candidate queue for a match slot
A player SHALL be able to fill an open match slot (a main slot or a bench slot) by declaring an ordered list of candidate players, instead of directly assigning one fixed participant.

#### Scenario: Player declares a candidate queue
- **WHEN** a player provides an ordered list of candidate players (who have all started the bot) to fill a specific open slot on a match
- **THEN** the system creates one queue entry per candidate with `status = queued`, in the given order, for that slot

### Requirement: Invite one candidate at a time
The system SHALL have at most one `invited` queue entry per slot at any time, and SHALL send that candidate an invitation before considering the next candidate.

#### Scenario: First candidate is invited
- **WHEN** a candidate queue is created for a slot
- **THEN** the system sets the first candidate's entry to `invited`, records the invitation time, and sends that candidate an invitation

#### Scenario: Later candidates are not invited yet
- **WHEN** a slot has a candidate whose entry is currently `invited`
- **THEN** the system does not send invitations to any other queued candidates for that slot until the current invitation is resolved (accepted, declined, or expired)

### Requirement: Invitation content
Every invitation sent from a candidate queue SHALL state the match format (singles or doubles), the scheduled time, and the venue.

#### Scenario: Venue already set
- **WHEN** the system sends an invitation for a match that already has a venue
- **THEN** the invitation message includes the match format, scheduled time, and venue

#### Scenario: Venue not yet set
- **WHEN** the system sends an invitation for a match that has no venue yet
- **THEN** the invitation message includes the match format and scheduled time, and states that the venue is still to be determined

### Requirement: Acceptance stops the queue
When a candidate accepts their invitation, the system SHALL fill the slot with that candidate and SHALL NOT send invitations to any remaining candidates in that queue.

#### Scenario: Candidate accepts
- **WHEN** an invited candidate responds "confirm" before their invitation expires
- **THEN** the system marks that candidate's entry `accepted`, fills the corresponding match slot with that candidate, and leaves all other queued entries for that slot un-invited

### Requirement: Invitation expires after one hour
The system SHALL expire an invitation if the candidate has not responded within 1 hour of being invited, and SHALL advance to the next candidate in the queue.

#### Scenario: Candidate does not respond in time
- **WHEN** an invited candidate has not accepted or declined within 1 hour of being invited
- **THEN** the system marks that candidate's entry `expired` and invites the next `queued` candidate for that slot, if any

#### Scenario: Candidate explicitly declines
- **WHEN** an invited candidate responds "decline" before the 1-hour window elapses
- **THEN** the system marks that candidate's entry `declined` immediately and invites the next `queued` candidate for that slot, if any, without waiting out the remainder of the hour

### Requirement: Queue exhausted without acceptance
When every candidate in a slot's queue has been declined or expired without any acceptance, the system SHALL leave the slot unfilled and notify the player who declared the queue.

#### Scenario: All candidates decline or expire
- **WHEN** the last remaining `queued` candidate for a slot is marked `declined` or `expired` with no prior acceptance
- **THEN** the system leaves the slot unfilled and notifies the player who declared the queue that no candidate accepted
