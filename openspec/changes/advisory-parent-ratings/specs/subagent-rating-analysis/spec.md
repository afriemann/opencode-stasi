## ADDED Requirements

### Requirement: Separate parent feedback evidence
The parent_ratings tool SHALL expose database-wide upward count and mean summaries by parent agent and bounded recent comments for an optional agent filter, without agent-role restrictions outside tuning passes.

#### Scenario: Ordinary readers receive bounded database-wide evidence
- **WHEN** any ordinary session queries feedback with an optional parent agent and comment limit
- **THEN** it receives upward count and mean summaries and newest comments bounded to default 10 or maximum 50, without internal session identifiers

#### Scenario: Empty and failed reads do not fabricate evidence
- **WHEN** no upward votes exist or a query fails
- **THEN** empty results contain no fabricated mean and query failures are reported rather than returning partial evidence

### Requirement: Upward comments remain untrusted private-local data
The plugin SHALL label upward comments as untrusted and discourage sensitive quotations in solicitation guidance.

#### Scenario: Comments are returned verbatim with privacy guidance
- **WHEN** upward feedback is solicited or its comments are read
- **THEN** guidance discourages secrets and brief quotations and read results carry a fixed untrusted-data warning without interpreting comment instructions

### Requirement: Upward feedback never changes downward evaluation
The plugin SHALL retain upward evidence separately from downward ratings, thresholds and automatic tuning inputs.

#### Scenario: Upward votes leave downward scores and state unchanged
- **WHEN** upward votes are stored and queried
- **THEN** existing downward evidence, threshold state and tuning inputs remain unchanged, including across database reopen
