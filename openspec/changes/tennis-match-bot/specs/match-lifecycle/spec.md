## ADDED Requirements

### Requirement: Cancel a match
Any participant of a match SHALL be able to cancel it, at any point before it is completed.

#### Scenario: Participant cancels a pending or confirmed match
- **WHEN** a participant sends a cancel request for a match that is not already `completed` or `cancelled`
- **THEN** the system sets `overallStatus = cancelled`, cancels any pending reminder for that match, and notifies all other participants that the match was cancelled and by whom

#### Scenario: Cancelling an already-cancelled match
- **WHEN** a participant attempts to cancel a match that already has `overallStatus = cancelled`
- **THEN** the system takes no further action and informs the requester the match is already cancelled

### Requirement: Propose a reschedule
A participant SHALL be able to propose a new date/time and/or venue for an existing match that has not been cancelled or completed.

#### Scenario: Participant proposes a new time
- **WHEN** a participant submits a new proposed date/time for a match
- **THEN** the system records the proposed change, resets every main participant's `participantStatus` to `invited` except the proposer (who is `confirmed`), sets `overallStatus = pending`, and notifies the other main participants of the proposed change for re-confirmation (bench players' status is left unchanged)

#### Scenario: Participant proposes a new venue as part of rescheduling
- **WHEN** a participant submits a new venue together with a reschedule proposal
- **THEN** the system stores the new venue as pending, applying it only once the reschedule is fully re-confirmed

### Requirement: Re-confirm a rescheduled match
Participants SHALL re-confirm a rescheduled match before it becomes `confirmed` again, following the same confirmation rules as initial match creation.

#### Scenario: All participants re-confirm the new time
- **WHEN** every participant of a rescheduled match responds "confirm" to the new proposed time
- **THEN** the system sets `overallStatus = confirmed`, applies the new time (and venue, if proposed), and re-evaluates reminder eligibility

#### Scenario: A participant declines the reschedule
- **WHEN** a participant responds "decline" to a reschedule proposal
- **THEN** the system keeps the match `pending`, notifies the other participants that the reschedule was declined, and leaves the previous confirmed time/venue inactive until a new proposal is made or the match is cancelled

### Requirement: Retire from a doubles match and call up a bench player
A main participant of a confirmed doubles match SHALL be able to mark themselves as retiring, triggering a call-up of the standby-confirmed bench players via the invitation queue, without resetting the match's `overallStatus` or requiring re-confirmation from the other main participants.

#### Scenario: Main participant retires with bench players available
- **WHEN** a main participant of a `confirmed` doubles match marks themselves as retiring, and one or more bench players have `participantStatus = standby-confirmed`
- **THEN** the system creates a candidate queue for the vacated slot from those bench players, in their declared order, and invites the first one, while leaving `overallStatus = confirmed` and the venue/time unchanged

#### Scenario: Bench player accepts the call-up
- **WHEN** a bench player who is currently invited from the vacated slot's queue responds "confirm" before their invitation expires
- **THEN** the system promotes that bench player to `slotType = main` with `participantStatus = confirmed` for the vacated slot, marks the retiring player as replaced, notifies the other main participants of the substitution, and stops the queue (remaining bench candidates are not invited)

#### Scenario: Bench player declines or lets the call-up expire
- **WHEN** the currently invited bench player for a vacated slot declines, or does not respond within 1 hour
- **THEN** the system invites the next standby-confirmed bench player in the declared order, per the invitation queue behavior

#### Scenario: No bench player accepts
- **WHEN** every bench player in the vacated slot's queue has declined or expired without any acceptance
- **THEN** the match remains available to be cancelled via the existing cancellation flow; the system does not automatically cancel it
