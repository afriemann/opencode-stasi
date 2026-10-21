## ADDED Requirements

### Requirement: Advisory parent brief solicitation
The plugin SHALL solicit brief-quality feedback before child execution for each eligible new or resumed delegation without enforcing action order or completion.

#### Scenario: New and resumed briefs receive independent advisory keys
- **WHEN** a parent delegates new or overlapping resumed work
- **THEN** each admitted child prompt contains its own rating key and guidance about clarity, context, scope and executable instructions, without storing the brief

### Requirement: Trusted upward request binding
The plugin SHALL bind upward feedback to host-verified parent and child identities before accepting a vote.

#### Scenario: Siblings and conflicting prompt replays cannot claim requests
- **WHEN** an unbound, mismatched or replayed request is presented
- **THEN** no alternative child or prompt can claim its identity and correlation markers are removed before child admission

#### Scenario: Prompt retries reuse only their original binding
- **WHEN** the same correlated child prompt is prepared again
- **THEN** its original key is reused without creating another delegation record

### Requirement: Validated single upward vote
The rate_parent tool SHALL accept one integer score from 1 through 5 and a nonempty comment within commentMaxChars from the bound child before pendingTtlHours expires.

#### Scenario: Bound children can rate late but only once
- **WHEN** a bound child submits after doing other work and before expiry
- **THEN** its vote is accepted once, including concurrent duplicate attempts, without checking child completion

#### Scenario: Invalid foreign and expired votes preserve feedback integrity
- **WHEN** a score, comment, request identity, caller ownership or expiry check fails
- **THEN** the vote is rejected without storing feedback or consuming another eligible request

### Requirement: Upward feedback fails safely
The plugin SHALL omit upward feedback when capture, storage or identity verification fails rather than interrupt delegation.

#### Scenario: Failure and abandoned correlation leave delegation usable
- **WHEN** identity lookup or storage fails, a correlation expires, or an unbound request crosses restart
- **THEN** no unverifiable rating is solicited and the actual delegation remains usable without a correlation marker

#### Scenario: Capacity and unload prevent unbounded or late capture
- **WHEN** transient lookup, nonce or eligible-pending capacity is exhausted, or the plugin unloads
- **THEN** additional feedback is omitted and unresolved operations cannot write after unload

### Requirement: Upward feedback excludes tuning passes
The plugin SHALL deny upward capture and submission from improvement-pass ancestry or unresolved ancestry and exclude both upward tools from pass containment even when allowlisted.

#### Scenario: Pass and incomplete ancestry cannot produce upward votes
- **WHEN** capture or submission originates in pass, cyclic, truncated or unavailable ancestry
- **THEN** no upward vote can be created and pass tool access remains denied
