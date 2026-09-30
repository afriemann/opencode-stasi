# subagent-rating-capture Specification

## Purpose
Defines how the plugin asks the calling agent to rate a finished subagent call, validates and stores each rating with its comment locally, and protects the stored data.

## Requirements

### Requirement: Rating request injection
The plugin SHALL append exactly one rating-request line to the result of every eligible completed foreground `subagent` call, containing the call key, the 1–5 anchored score rubric and the instruction to judge the result against the caller's brief.

#### Scenario: Completed foreground call is solicited
- **WHEN** a `subagent` call finishes with status completed and its output status completed
- **THEN** the result the caller sees ends with one line naming the call key and the five rubric levels
- **AND** a pending call record is stored with the subagent type, caller session, child session and agent definition version

#### Scenario: Background call is not solicited
- **WHEN** a `subagent` call returns with output status running
- **THEN** the result is left unchanged and no call record is stored

#### Scenario: Errored call is not solicited
- **WHEN** a `subagent` call ends with status error
- **THEN** the result is left unchanged and no call record is stored

#### Scenario: Sampling skips a call deterministically
- **WHEN** `samplingRate` is below 1.0 and the call key hashes at or above the rate
- **THEN** the result is left unchanged and no call record is stored
- **AND** the same call key always yields the same decision

#### Scenario: Capture failure never alters the result
- **WHEN** any error occurs while capturing a call
- **THEN** the subagent result is returned unmodified and the error is logged

### Requirement: Excluded calls are never solicited
The plugin SHALL NOT solicit or record ratings for `subagent` calls made from a session that is, or descends from, an improvement-pass session, and SHALL NOT solicit ratings for calls to the rating tools.

#### Scenario: Call inside a pass lineage
- **WHEN** a `subagent` call finishes in a session whose ancestry contains an improvement-pass session
- **THEN** no rating line is appended and no call record is stored

#### Scenario: Ordinary use of the tuned agent is still rated
- **WHEN** a user-driven session (outside any pass lineage) calls the configured tuning agent as a subagent
- **THEN** the call is solicited like any other

### Requirement: Server-side subagent identity
The plugin SHALL determine the subagent type and agent definition version from the host's resolved agent definition at capture time, never from the rater's input.

#### Scenario: Rater cannot supply the subagent type
- **WHEN** `rate_subagent` is called
- **THEN** its input accepts only the call key, score and comment
- **AND** the stored subagent type equals the type recorded at capture

### Requirement: rate_subagent stores a validated rating
The `rate_subagent` tool SHALL accept a call key, an integer score from 1 to 5 and a non-empty comment of at most `commentMaxChars` characters, and SHALL store exactly one rating for a pending call made by the calling session.

#### Scenario: Valid rating is stored
- **WHEN** the session that made a pending call submits score 4 with a comment
- **THEN** one rating with score, comment, subagent type, definition version and timestamp is stored
- **AND** the call is marked rated

#### Scenario: Out-of-range or non-integer score is rejected
- **WHEN** the score is 0, 6 or 3.5
- **THEN** the tool returns an error and stores nothing

#### Scenario: Comment length boundaries
- **WHEN** the comment is empty
- **THEN** the tool rejects it
- **AND WHEN** the comment has exactly `commentMaxChars` characters it is accepted verbatim
- **AND WHEN** it has one more character it is rejected with a message stating the limit and is not truncated

#### Scenario: Unknown or already-rated call key
- **WHEN** the call key is unknown, already rated, or expired
- **THEN** the tool returns an error and stores nothing

#### Scenario: Different session cannot rate
- **WHEN** a session other than the recorded caller submits a rating for a pending call
- **THEN** the tool returns an error and stores nothing

### Requirement: Unrated calls expire
The plugin SHALL treat a pending call older than `pendingTtlHours` as expired and not ratable.

#### Scenario: Late rating is rejected
- **WHEN** a rating is submitted for a pending call older than `pendingTtlHours`
- **THEN** the tool returns an error and the call is marked expired

### Requirement: Local private storage
The plugin SHALL store ratings and comments only in a local SQLite database file created with owner-only permissions and SHALL NOT transmit them elsewhere.

#### Scenario: File permissions
- **WHEN** the database is created or opened
- **THEN** its directory is mode 0700 and the file is mode 0600

#### Scenario: Database inside a git work tree
- **WHEN** the configured database path lies within a git work tree
- **THEN** the plugin disables itself, logs one line, and appends no rating lines

### Requirement: Validated configuration fails closed
The plugin SHALL read its settings from a JSON configuration file and SHALL disable itself with one log line when the file is invalid or contains unknown keys, applying documented defaults for absent keys.

#### Scenario: Defaults apply
- **WHEN** the configuration file is absent or empty
- **THEN** threshold 3.0, window 20, minimum samples 8, cooldown 24 hours, sampling rate 1.0, comment cap 500 and pending TTL 24 hours are in effect

#### Scenario: Unknown key disables the plugin
- **WHEN** the file contains an unknown key
- **THEN** no rating lines are appended and one log line names the problem
