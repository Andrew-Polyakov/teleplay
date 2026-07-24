## ADDED Requirements

### Requirement: Submit a venue for a match
One of the match participants SHALL be able to submit the court/venue for a specific match.

#### Scenario: Participant submits a venue
- **WHEN** a participant of a match sends the venue details (name/location) for that match
- **THEN** the system stores the venue on the match and marks the match's venue as set

#### Scenario: Non-participant attempts to submit a venue
- **WHEN** a user who is not a participant of the match tries to submit a venue for it
- **THEN** the system rejects the submission and does not modify the match

### Requirement: Match is not ready without a venue
The system SHALL NOT consider a match fully ready (eligible for pre-match reminders) until a venue has been submitted, even if all participants have confirmed.

#### Scenario: All participants confirmed but no venue set
- **WHEN** a match has `overallStatus = confirmed` but no venue has been submitted
- **THEN** the system does not schedule or send pre-match reminders for that match, and the match is shown to participants as "awaiting venue"

#### Scenario: Venue submitted after participants confirm
- **WHEN** a participant submits a venue for a match that already has `overallStatus = confirmed`
- **THEN** the system marks the match as ready and becomes eligible for pre-match reminder scheduling

### Requirement: Update a venue before the match occurs
A participant SHALL be able to update the previously submitted venue for a match, as long as the match has not started or been completed/cancelled.

#### Scenario: Participant changes the venue
- **WHEN** a participant submits a new venue for a match that already has a venue set, and the match is not cancelled or completed
- **THEN** the system replaces the stored venue with the new value and notifies the other participants of the change
