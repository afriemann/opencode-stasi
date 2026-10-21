## MODIFIED Requirements

### Requirement: Evidence query tool
The `subagent_ratings` tool SHALL return read-only evidence: each agent's state, current-window count and mean, and lifetime count and mean in both modes; open-pass metadata in overview; and existing window statistics, definition version, threshold and up to `limit` (maximum 50) recent ratings with comments in detail.

#### Scenario: Overview without agent
- **WHEN** `subagent_ratings` is called with no agent
- **THEN** each type's state, `window.n`, `window.mean`, `lifetime.n` and `lifetime.mean` are returned
- **AND** tripped or awaiting_review types retain pass status, branch and worktree metadata

#### Scenario: Detail for one agent
- **WHEN** it is called with an agent id
- **THEN** the same summaries as overview and the existing window statistics, definition version, threshold and most recent scores and comments are returned
- **AND** lifetime values do not affect tuning state

#### Scenario: Limit is enforced
- **WHEN** `limit` exceeds 50 or requests fewer ratings than the stored population
- **THEN** only the requested number, clamped to 50, is listed
- **AND** neither summary is limited by the displayed list

#### Scenario: Lifetime includes ratings excluded from the window
- **WHEN** stored ratings span definition versions, a resolution and more eligible ratings than `windowSize`
- **THEN** lifetime count and arithmetic mean include every stored rating for that agent across versions and resolutions
- **AND** current-window values preserve existing version, resolution and window-size filtering in both modes

#### Scenario: Lifetime exceeds the current-window scan
- **WHEN** an agent has more than 500 stored ratings
- **THEN** lifetime count and mean include all of them in both modes
- **AND** current-window values preserve the existing newest-500 raw-rating scan boundary

#### Scenario: Empty rating populations
- **WHEN** an agent has no stored ratings or no ratings eligible for its current window
- **THEN** each empty population has `n: 0` and an omitted `mean`, never a zero score or null
- **AND** state-only agents remain visible in overview and an unknown agent can be queried in detail without inventing ratings

#### Scenario: Rating read fails
- **WHEN** stored ratings cannot be read for an agent
- **THEN** the query fails instead of reporting a partial lifetime population or a zero score
