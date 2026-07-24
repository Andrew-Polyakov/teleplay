## ADDED Requirements

### Requirement: Menu entry point
The system SHALL open the root menu when a registered user sends `/menu`, showing New match, My matches, Pending invites, and My info entries; unregistered users SHALL be told to `/start` first.

#### Scenario: Registered user opens the menu
- **WHEN** a registered user sends `/menu`
- **THEN** the bot replies with one message carrying the root menu (🎾 New match, 📅 My matches, ⏳ Pending invites, ℹ️ My info)

#### Scenario: Unregistered user opens the menu
- **WHEN** a user who has not sent `/start` sends `/menu`
- **THEN** the bot asks them to `/start` first and shows no menu

### Requirement: Hierarchical navigation
The menu SHALL navigate by editing the same message in place, with a back control on every submenu returning to the parent level.

#### Scenario: Descending into a submenu
- **WHEN** the user taps "My matches" on the root menu
- **THEN** the same message is edited to show the matches submenu

#### Scenario: Going back up
- **WHEN** the user taps "‹ Back" on any submenu
- **THEN** the same message is edited back to the parent menu

### Requirement: New match launches the wizard
The New match entry SHALL start the existing `/match` creation wizard for the user.

#### Scenario: Starting a match from the menu
- **WHEN** the user taps "🎾 New match"
- **THEN** the match-creation wizard begins exactly as if the user had sent `/match` with no arguments

### Requirement: My matches lists live upcoming matches
The My matches submenu SHALL render one entry per upcoming match where the user is a main or bench participant, from live data at render time, and SHALL show an empty-state message when there are none.

#### Scenario: Player has upcoming matches
- **WHEN** the user opens My matches while participating in upcoming matches
- **THEN** each match appears as its own button labelled with its type, date/time, and status

#### Scenario: Cancelled match disappears
- **WHEN** a listed match is cancelled and the menu is rendered again
- **THEN** that match no longer appears in the list

#### Scenario: No upcoming matches
- **WHEN** the user opens My matches with no upcoming matches
- **THEN** the submenu shows an empty-state message and a back control

### Requirement: Context-sensitive per-match actions
A match's submenu SHALL show only actions currently valid for that match and player: Set venue and Reschedule and Cancel for participants of non-terminal matches, Retire only for a main participant of a confirmed doubles match; every action SHALL still be validated by the domain layer when tapped.

#### Scenario: Confirmed doubles match for a main player
- **WHEN** a main participant opens the submenu of a confirmed doubles match
- **THEN** Set venue, Reschedule, Retire, and Cancel are all offered

#### Scenario: Singles match shows no Retire
- **WHEN** a participant opens the submenu of a singles match
- **THEN** Retire is not offered

#### Scenario: Stale action tap is backstopped by domain validation
- **WHEN** the user taps an action on an outdated menu message whose match state has since changed such that the action is invalid
- **THEN** the domain layer rejects it and the user is answered with the rejection reason instead of the action being applied

### Requirement: Menu-driven venue entry
Tapping Set venue SHALL prompt the user to reply with the venue as plain text and apply it to that match without requiring a match id; the pending prompt SHALL expire after the configured timeout and SHALL be replaced by any newer text-consuming interaction.

#### Scenario: Setting a venue from the menu
- **WHEN** the user taps "📍 Set venue" on a match and replies with `Court 5, Riverside`
- **THEN** the venue is submitted for that match via the existing venue flow, other participants are notified, and the user gets a confirmation

#### Scenario: Prompt superseded by a new interaction
- **WHEN** the user taps "Set venue" but then starts a `/match` wizard before replying
- **THEN** the venue prompt is discarded and the text reply is not interpreted as a venue

### Requirement: Menu-driven reschedule
Tapping Reschedule SHALL reuse the wizard's calendar and time-slot pickers to choose a new date and time, then route through the existing reschedule proposal flow (resetting other participants' confirmations and notifying them).

#### Scenario: Rescheduling from the menu
- **WHEN** the user taps "🔁 Reschedule" on a match, picks a date and a time, and confirms
- **THEN** a reschedule is proposed for that match with the picked time, exactly as `/reschedule <id> <time>` would

### Requirement: Cancel requires confirmation
The Cancel action SHALL require a second confirming tap before the match is cancelled.

#### Scenario: Two-step cancel
- **WHEN** the user taps "❌ Cancel match" and then confirms on the follow-up
- **THEN** the match is cancelled via the existing cancel flow and other participants are notified

#### Scenario: Backing out of a cancel
- **WHEN** the user taps "❌ Cancel match" and then taps back instead of confirming
- **THEN** the match is not cancelled

### Requirement: Pending invites with inline responses
The Pending invites submenu SHALL list the user's open match invitations and invitation-queue offers from live data, each with Accept and Decline controls that route through the existing confirm/decline and queue accept/decline flows.

#### Scenario: Accepting from the menu
- **WHEN** the user taps ✅ on a pending match invitation in the menu
- **THEN** the confirmation is processed exactly as the invitation message's Confirm button would, and the entry disappears from the list on re-render

#### Scenario: No pending invites
- **WHEN** the user opens Pending invites with nothing outstanding
- **THEN** the submenu shows an empty-state message and a back control

### Requirement: My info
The My info entry SHALL show the user's registered identity and the shareable invite link for players who haven't started the bot.

#### Scenario: Viewing my info
- **WHEN** the user taps "ℹ️ My info"
- **THEN** the menu shows their registered username/display name and the bot's invite link

### Requirement: Outdated menu handling
Taps on a menu message rendered from stale data SHALL refresh the menu rather than act on stale assumptions.

#### Scenario: Tapping an old menu message
- **WHEN** the user taps a button on a menu message whose content no longer matches current data
- **THEN** the menu is re-rendered with current data and the user is notified the menu was updated, without the stale action being applied
