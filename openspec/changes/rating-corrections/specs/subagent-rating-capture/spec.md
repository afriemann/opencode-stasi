## MODIFIED Requirements

### Requirement: Rating request injection
The plugin SHALL append exactly one rating-request line to the result of every eligible `subagent` call: a completed foreground call receives the rating line, and a background launch that starts a new child session receives a deferred rating line, each containing the call key, resolved agent type, available short task description, the 1–5 anchored score rubric and the instruction to judge the result against the caller's brief.

#### Scenario: Completed foreground call is solicited
- **WHEN** a `subagent` call finishes with status completed and its output status completed
- **THEN** the result the caller sees ends with one line naming the call key, resolved agent, task description and five rubric levels
- **AND** a pending call record is stored with the subagent type, caller session, child session, task label and agent definition version

#### Scenario: New-child background launch is solicited
- **WHEN** a `subagent` call returns with output status running and its input names no existing session
- **THEN** the launch result ends with one deferred line naming the call key, resolved agent, task description and five rubric levels
- **AND** the line tells the caller to keep the key, to read the eventual result or failure report, to rate that work rather than the launch acknowledgement, and never to invent a key
- **AND** a pending call record is stored with the subagent type, caller session, child session, task label and agent definition version

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

## ADDED Requirements

### Requirement: Recognizable rating acknowledgements
The plugin SHALL identify the stored call key, resolved agent, available task description and accepted score when acknowledging a downward rating or edit, and identify the target when acknowledging a retraction.

#### Scenario: Accepted feedback identifies its target
- **WHEN** a session rates or corrects its call
- **THEN** the acknowledgement names the stored target and accepted score for a rating or edit, or confirms retraction
- **AND** a legacy call without a task label remains usable with its agent and key

### Requirement: Task labels are bounded descriptive data
The plugin SHALL use only the short delegation description for task labels, normalizing whitespace and control characters, limiting labels to 200 characters and escaping displayed strings as single-line descriptive data rather than instructions.

#### Scenario: Untrusted task descriptions remain single-line labels
- **WHEN** a task description contains newlines, control characters, quotes, or more than 200 characters
- **THEN** its stored label is bounded and its displayed target cannot introduce another rating-request line
- **AND** the full brief is not stored and the label does not determine agent identity

### Requirement: Session-owned rating corrections
The `correct_subagent_rating` tool SHALL accept a recorded call key and an edit or retract action only from that call's originating session, with edits requiring a complete score/comment pair validated like an initial rating.

#### Scenario: Owner edits a rating without changing its identity or age
- **WHEN** the originating session edits its stored rating, including an old rating or one from an earlier version or resolution
- **THEN** score and comment change while its agent, version, original timestamp and ordering remain unchanged

#### Scenario: Owner retracts and can rate again under original admission rules
- **WHEN** the originating session retracts a stored rating
- **THEN** the current vote is removed and the call returns to pending without resetting capture time
- **AND** a later rating uses the original expiry clock and child-completion checks

#### Scenario: Invalid corrections cannot mutate or disclose feedback
- **WHEN** a correction names an unknown call, another session's call, a call without a current vote, an invalid action, or invalid edit values
- **THEN** the tool returns an error without changing feedback or revealing a foreign target
- **AND** its guidance directs callers to recorded keys and explains edit versus retract

### Requirement: Atomic local correction history
The plugin SHALL retain each correction's before/after feedback, original rating identity, acting session and correction time in private-local history atomically with the current-vote change, without adding a history query API.

#### Scenario: Corrections retain history across reopen
- **WHEN** an existing database is upgraded, feedback is edited or retracted, and the database is reopened
- **THEN** existing feedback and task-label fallbacks remain usable and committed correction history survives

#### Scenario: Failed and competing corrections preserve one current vote
- **WHEN** correction storage fails or competing correction requests target a call
- **THEN** each successful operation is atomic, a failed operation leaves no partial audit or vote change, and the call has at most one current vote
- **AND** repeating a retraction without an intervening rating returns an error
