## ADDED Requirements

### Requirement: View current schedule
A player SHALL be able to request their current schedule, showing every match they are a participant in (main or bench) with `overallStatus` of `pending` or `confirmed`, ordered by scheduled time ascending.

#### Scenario: Player has upcoming matches
- **WHEN** a player requests their schedule and has one or more matches with `overallStatus` in `pending` or `confirmed` where they are a main or bench participant
- **THEN** the system lists each match with its scheduled time, format (singles/doubles), the other participant(s), venue (or "TBD" if not yet set), and the match's status, ordered soonest first

#### Scenario: Player has no upcoming matches
- **WHEN** a player requests their schedule and has no matches with `overallStatus` in `pending` or `confirmed`
- **THEN** the system tells the player they have no upcoming matches

#### Scenario: Cancelled and completed matches are excluded
- **WHEN** a player requests their schedule
- **THEN** matches with `overallStatus` of `cancelled` or `completed` are not included in the listing

### Requirement: View pending invitations
A player's schedule request SHALL also show any invitation queue entries where they are the candidate and the entry is `queued` or `invited`.

#### Scenario: Player has a pending invitation
- **WHEN** a player requests their schedule and has one or more invitation queue entries with `status` in `queued` or `invited`
- **THEN** the system lists each as a pending invitation, separately from committed matches, showing the match's format, scheduled time, venue (or "TBD"), and — if currently `invited` — the time remaining before it expires

#### Scenario: No pending invitations
- **WHEN** a player requests their schedule and has no invitation queue entries with `status` in `queued` or `invited`
- **THEN** the system omits the pending invitations section (or shows it as empty)
