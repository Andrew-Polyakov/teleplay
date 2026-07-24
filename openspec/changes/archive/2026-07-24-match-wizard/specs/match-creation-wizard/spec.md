## ADDED Requirements

### Requirement: Wizard starts from a bare /match command
The system SHALL start an interactive match-creation wizard when a registered user sends `/match` with no arguments, beginning with a singles/doubles choice presented as inline buttons.

#### Scenario: Registered user starts the wizard
- **WHEN** a registered user sends `/match` with no arguments
- **THEN** the system replies with a match-type step offering "Singles" and "Doubles" inline buttons

#### Scenario: Unregistered user starts the wizard
- **WHEN** a user who has not sent `/start` sends `/match`
- **THEN** the system replies asking them to `/start` first and does not create wizard state

#### Scenario: Starting a new wizard replaces an active one
- **WHEN** a user with a wizard already in progress sends `/match` again
- **THEN** the system discards the previous wizard state and starts a fresh wizard at the match-type step

### Requirement: Date selection via inline calendar
The wizard SHALL present a month-grid inline-keyboard calendar for date selection, with previous/next month navigation, and SHALL NOT allow selecting dates in the past.

#### Scenario: User picks a future date
- **WHEN** the user taps a selectable day in the calendar
- **THEN** the wizard records the date and advances to the time-slot step

#### Scenario: User navigates months
- **WHEN** the user taps the next-month (or previous-month) control
- **THEN** the calendar message is edited in place to show that month's grid

#### Scenario: Past dates are inert
- **WHEN** the calendar renders a month containing days before the current date
- **THEN** those days are rendered as non-selectable placeholders and tapping them does not advance the wizard

### Requirement: Time selection via slot buttons
The wizard SHALL present a grid of time-slot buttons derived from configuration (start hour, end hour, step minutes) and combine the chosen slot with the chosen date into the match's scheduled time.

#### Scenario: User picks a time slot
- **WHEN** the user taps a time slot (e.g. 18:30)
- **THEN** the wizard records the combined date+time as the match's scheduled time and advances to the player-selection step

### Requirement: Player selection from registered users
The wizard SHALL let the creator fill the other main slot(s) (1 for singles, 3 for doubles) by tapping entries from a paginated list of registered users, excluding the creator and already-selected players, and SHALL also accept typed `@username` messages as manual additions while this step is active.

#### Scenario: Filling slots by tapping
- **WHEN** the user taps registered players until the required slot count is reached
- **THEN** each tap adds that player to the selection shown in the message, and the wizard enables advancing once the count is satisfied

#### Scenario: Deselecting a tapped player
- **WHEN** the user taps a player who is already selected
- **THEN** the wizard removes that player from the selection

#### Scenario: Adding a player by typed username
- **WHEN** the user sends a text message containing `@username`(s) while the player step is active
- **THEN** the wizard adds those usernames to the selection as if they had been tapped, subject to the same slot-count limit

### Requirement: Bench selection for doubles
For doubles matches, the wizard SHALL offer an optional bench step using the same player picker, with an explicit skip control; for singles matches the wizard SHALL NOT offer a bench step.

#### Scenario: Doubles creator adds bench players
- **WHEN** the wizard reaches the bench step for a doubles match and the user selects one or more standby players and taps Done
- **THEN** the selected players are attached to the match as bench standby candidates

#### Scenario: Doubles creator skips the bench
- **WHEN** the user taps Skip on the bench step
- **THEN** the wizard advances to the confirmation step with no bench players

#### Scenario: Singles match has no bench step
- **WHEN** the wizard's main slot is filled for a singles match
- **THEN** the wizard advances directly to the confirmation step

### Requirement: Confirmation summary before creation
The wizard SHALL show a summary (type, scheduled time, players, bench) with Create and Cancel buttons, and SHALL only create the match when Create is tapped, using the same match-creation entry point as the one-line command syntax.

#### Scenario: User confirms creation
- **WHEN** the user taps Create on the summary step
- **THEN** the system creates the match exactly as the equivalent one-line `/match` command would (same statuses, invitations, and notifications) and clears the wizard state

#### Scenario: User cancels at the summary
- **WHEN** the user taps Cancel
- **THEN** the wizard state is discarded, no match is created, and the message is updated to say the wizard was cancelled

### Requirement: Wizard state lifecycle
Wizard state SHALL be per-user, in-memory, and expire after a configurable idle timeout; taps on expired or out-of-step wizard messages SHALL produce a hint rather than a state change.

#### Scenario: Idle wizard expires
- **WHEN** a wizard receives no interaction for longer than the configured timeout
- **THEN** the system purges its state, and a subsequent tap on its buttons answers with a message telling the user to send `/match` to start again

#### Scenario: Stale tap on an earlier step
- **WHEN** the user taps a button belonging to a step the wizard has already moved past (e.g. an old calendar message)
- **THEN** the system answers the callback with a hint and does not modify wizard state
