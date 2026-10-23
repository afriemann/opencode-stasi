## ADDED Requirements

### Requirement: Corrected evidence is independent of tuning lifecycle
The plugin SHALL reflect edits and retractions in current rating evidence without evaluating thresholds or modifying existing tuning state or passes during correction.

#### Scenario: Corrected evidence excludes retracted votes and audit history
- **WHEN** ratings are edited or retracted and evidence is queried
- **THEN** current scores and comments alone contribute to window and lifetime statistics and recent ratings
- **AND** edits retain their original position, version and resolution eligibility, with the existing newest-500 scan and window-size limits unchanged
- **AND** task labels and audit history are not exposed through the evidence query

#### Scenario: Corrections leave tuning decisions untouched
- **WHEN** an edit or retraction changes the evidence for an ok, tripped, awaiting_review or resolved agent
- **THEN** correction does not evaluate thresholds, start or cancel a pass, resolve an agent, reset cooldown or change existing pass records
- **AND** later ordinary rating submissions evaluate current votes using the existing trigger rules
