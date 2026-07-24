## ADDED Requirements

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
