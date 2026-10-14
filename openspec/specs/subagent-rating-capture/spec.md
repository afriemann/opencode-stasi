# subagent-rating-capture Specification

## Purpose
Defines how the plugin asks the calling agent to rate a finished subagent call, validates and stores each rating with its comment locally, and protects the stored data.

## Requirements

### Requirement: Rating request injection
The plugin SHALL append exactly one rating-request line to the result of every eligible `subagent` call: a completed foreground call receives the rating line, and a background launch that starts a new child session receives a deferred rating line, each containing the call key, the 1–5 anchored score rubric and the instruction to judge the result against the caller's brief.

#### Scenario: Completed foreground call is solicited
- **WHEN** a `subagent` call finishes with status completed and its output status completed
- **THEN** the result the caller sees ends with one line naming the call key and the five rubric levels
- **AND** a pending call record is stored with the subagent type, caller session, child session and agent definition version

#### Scenario: New-child background launch is solicited
- **WHEN** a `subagent` call returns with output status running and its input names no existing session
- **THEN** the launch result ends with one deferred line naming the call key and the five rubric levels
- **AND** the line tells the caller to keep the key, to read the eventual result or failure report, to rate that work rather than the launch acknowledgement, and never to invent a key
- **AND** a pending call record is stored with the subagent type, caller session, child session and agent definition version

#### Scenario: Background call is not solicited
- **WHEN** a `subagent` call returns with output status running and its input names an existing session
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

### Requirement: Rating requires a finished child
The `rate_subagent` tool SHALL store a rating only when the recorded child session has finished an execution, meaning its idle marker is set and a wait for the session to become idle resolves within one second.

#### Scenario: Rating before the subagent finishes is rejected
- **WHEN** the caller rates a pending call whose child has no idle marker, or whose wait does not resolve within one second
- **THEN** the tool returns an error stating the subagent is still running and to rate after it finishes
- **AND** nothing is stored and the call stays pending and ratable

#### Scenario: Unavailable child state is rejected
- **WHEN** the child lookup or wait fails, the child no longer exists, or the probe capacity is exhausted
- **THEN** the tool returns an error stating the subagent state cannot be determined and to retry later
- **AND** nothing is stored, the call stays pending, and no raw host error text is returned

#### Scenario: Finished background child is ratable
- **WHEN** the caller rates a pending background call whose child has an idle marker and whose wait resolves
- **THEN** one rating is stored and the call is marked rated

#### Scenario: Failed or cancelled child is ratable
- **WHEN** the caller rates a pending call whose child ended failed, interrupted or cancelled and is idle
- **THEN** one rating is stored

#### Scenario: Invalid key never probes the child
- **WHEN** the call key is unknown, already rated, expired or belongs to another session
- **THEN** the tool returns the existing error without looking up or waiting on any child session

#### Scenario: Expiry during the probe
- **WHEN** the pending call passes its expiry while the probe is in progress
- **THEN** the tool returns the expiry error, stores nothing and marks the call expired

#### Scenario: Completed foreground call passes the probe
- **WHEN** the caller rates a pending foreground call whose child is idle
- **THEN** the rating is stored as before

### Requirement: Child probing is bounded
The plugin SHALL keep at most one unresolved wait per child session and at most 128 unresolved waits in total, and SHALL NOT interrupt a child session in order to rate it.

#### Scenario: Concurrent and repeated attempts share one wait
- **WHEN** several rating attempts probe the same child while its wait is unresolved
- **THEN** exactly one underlying wait exists for that child
- **AND** a timed-out attempt leaves that wait in place for later attempts to join

#### Scenario: Settled wait is released
- **WHEN** the underlying wait resolves or rejects
- **THEN** its entry is removed and the next attempt starts a fresh wait

#### Scenario: Capacity is exhausted
- **WHEN** 128 unresolved waits exist and a new child is probed
- **THEN** the tool returns the state-unavailable error and starts no wait, while children with an existing wait may still join it

#### Scenario: Unload stops late storage
- **WHEN** the plugin is unloaded while a probe is in progress
- **THEN** the attempt returns the state-unavailable error and nothing is stored or evaluated afterwards

### Requirement: Tool guidance forbids invented keys
The `rate_subagent` tool description SHALL tell the caller to use only a call key taken from a `[rate]` line, from either a finished foreground result or an earlier background launch, and never to invent a key or use a session id.

#### Scenario: Description carries the guidance
- **WHEN** the tool is registered
- **THEN** its description names both sources of a call key, says to rate after reading the eventual result, and says never to invent a key
