## MODIFIED Requirements

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

## ADDED Requirements

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
