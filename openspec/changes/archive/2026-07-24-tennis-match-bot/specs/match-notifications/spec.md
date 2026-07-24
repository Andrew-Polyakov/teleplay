## ADDED Requirements

### Requirement: Send pre-match reminders
The system SHALL send a reminder notification to every participant of a match once the match is ready (confirmed and venue set) and the current time reaches the configured reminder lead time before the match's scheduled start.

#### Scenario: Reminder due for a ready match
- **WHEN** a match has `overallStatus = confirmed`, has a venue set, has not been cancelled, and the current time is within the configured lead window before the scheduled start time
- **THEN** the system sends each participant a reminder message including the match time, type (singles/doubles), opponent(s)/partner, and venue

#### Scenario: Reminder not sent for a match that isn't ready
- **WHEN** a match has not reached `overallStatus = confirmed` or has no venue set
- **THEN** the system does not send a reminder for that match, regardless of how close the scheduled time is

#### Scenario: Reminder is sent only once
- **WHEN** a reminder has already been sent for a match
- **THEN** the system does not send a duplicate reminder for the same match/lead-time window

### Requirement: No reminders for cancelled matches
The system SHALL NOT send pre-match reminders for a match that has been cancelled.

#### Scenario: Match cancelled before reminder time
- **WHEN** a match is cancelled before its scheduled reminder time
- **THEN** the system does not send a reminder for that match
