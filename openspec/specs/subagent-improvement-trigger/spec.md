# subagent-improvement-trigger Specification

## Purpose
Defines the propose-only improvement pass started when a subagent type trips: an isolated, contained, bounded tuning-agent session that yields a reviewable branch and never changes live agent files.

## Requirements

### Requirement: Pass produces a reviewable branch only
When a subagent type trips and passes are enabled for it, the plugin SHALL create a git worktree on a new branch `agent-tuning/<agent>-<yyyymmdd>` of `agentConfigRepo`, run a tuning-agent session there (the configured `pass.agent`, or the plugin's built-in `subagent-tuner` when unset), and commit the resulting changes to that branch only, without pushing or merging.

#### Scenario: Successful pass
- **WHEN** a type trips, `agentConfigRepo` is set and the pass session ends with changed files inside `allowedPaths`
- **THEN** one commit exists on the new branch containing exactly those files
- **AND** the state becomes awaiting_review with the branch and commit recorded
- **AND** no push, merge or change to the live agent directory occurs

#### Scenario: Branch name collision
- **WHEN** the branch name for that agent and date already exists
- **THEN** a numeric suffix makes the name unique

#### Scenario: Pass made no changes
- **WHEN** the session ends without file changes
- **THEN** the pass is recorded as no_change and the state becomes awaiting_review without a commit

### Requirement: Built-in tuning agent
When `pass.agent` is unset, the plugin SHALL register its own hidden primary agent `subagent-tuner` whose instructions are generic to agent-definition tuning, and SHALL NOT hard-code any other agent name.

#### Scenario: Built-in tuner used when none configured
- **WHEN** `pass.agent` is unset and a type trips
- **THEN** the pass session uses `subagent-tuner`, which is not callable as a subagent and is therefore never rated

#### Scenario: Configured agent takes precedence
- **WHEN** `pass.agent` is set to an existing agent
- **THEN** the built-in tuner is not used for the pass

### Requirement: Unguided brief with evidence via tool
The pass brief SHALL identify the agent, definition version and window statistics, direct the engineer to `subagent_ratings` for evidence, and SHALL NOT suggest specific fixes or embed rating comments.

#### Scenario: Brief content
- **WHEN** a pass session is prompted
- **THEN** the prompt names the agent and points to `subagent_ratings`
- **AND** contains no rating comment text

### Requirement: Pass session containment
The plugin SHALL restrict a pass session so that it can only use the configured tool allowlist, can only write inside its worktree, and can never wait for human input.

#### Scenario: Tools outside the allowlist are removed
- **WHEN** a pass-lineage session builds a model request
- **THEN** every tool not in `pass.tools` is not advertised, and shell, subagent, question, rating and resolve tools are absent unless explicitly listed (rating and resolve tools are never allowed)

#### Scenario: Shell is denied unless a pattern allows it
- **WHEN** the pass session runs a shell command and `pass.shellAllow` is empty or does not match it
- **THEN** the permission decision is deny
- **AND** a command matching an allow pattern is permitted unless it contains a redirect or targets an external directory

#### Scenario: Writes outside the worktree are denied
- **WHEN** the pass session attempts to edit a path outside its worktree
- **THEN** the permission decision is deny

#### Scenario: Ask becomes deny
- **WHEN** a permission evaluation for a pass-lineage session would be ask
- **THEN** it is changed to deny with a message

### Requirement: Pass resource caps
The plugin SHALL interrupt a pass session that exceeds `timeoutMinutes`, `maxSteps` or `maxTokens` and record the pass as interrupted.

#### Scenario: Timeout
- **WHEN** the session is still running after `timeoutMinutes`
- **THEN** it is interrupted and the pass status is interrupted with no commit

### Requirement: Scope gate before commit
The plugin SHALL commit only when every changed path matches `allowedPaths`.

#### Scenario: Change outside allowed paths
- **WHEN** the worktree contains a changed path outside `allowedPaths`
- **THEN** nothing is committed, the pass status is failed_scope, the worktree is kept and the state stays tripped

### Requirement: Single pass at a time
The plugin SHALL run at most one improvement pass globally, and SHALL start a queued tripped type when the running pass ends or at plugin startup.

#### Scenario: Second trip while a pass runs
- **WHEN** another type trips while a pass is running
- **THEN** no second pass starts and the type stays tripped until the running pass ends

#### Scenario: Stale running pass at startup
- **WHEN** the plugin starts and a pass is marked running for longer than `timeoutMinutes`
- **THEN** it is marked failed and a queued trip may start

### Requirement: One automatic pass per trip
The plugin SHALL start at most one automatic pass for an agent type per tripped definition version, and SHALL start no pass from a plugin instance whose location lies inside a pass worktree.

#### Scenario: A failed pass is not retried for the same tripped version
- **WHEN** a pass for a tripped type ended in any status and the type is still tripped at the same definition version
- **THEN** no further automatic pass starts for it, in this or any other plugin instance

#### Scenario: Instance inside a pass worktree stays passive
- **WHEN** the plugin loads in a location inside the pass worktree root while a type is tripped
- **THEN** it starts no pass

### Requirement: Notify-only fallback
The plugin SHALL leave a tripped type in state tripped, record the reason in the pass status as notify_only or failed, and start no session when `agentConfigRepo` is unset or not a git repository, the agent is listed in `triggerExclude` (empty by default), a configured `pass.agent` does not exist, the built-in tuner is disabled while `pass.agent` is unset, or worktree creation, session creation or prompting fails.

#### Scenario: agentConfigRepo unset
- **WHEN** a type trips and `agentConfigRepo` is unset
- **THEN** no worktree or session is created and the pass status is notify_only

#### Scenario: Excluded agent
- **WHEN** a type listed in `triggerExclude` trips
- **THEN** no pass starts and the state is reported in the overview

#### Scenario: Configured tuning agent does not exist
- **WHEN** `pass.agent` names an agent the host cannot resolve
- **THEN** no session starts, the built-in tuner is not substituted, and the pass status is failed with the reason

#### Scenario: A tuning agent may tune itself
- **WHEN** the type that trips is the configured tuning agent and `triggerExclude` is empty
- **THEN** a pass starts for it like for any other type

#### Scenario: Session creation fails
- **WHEN** the host rejects session creation for the worktree directory
- **THEN** the pass is recorded as failed with the reason and the state stays tripped

### Requirement: User resolution of a pass
The `subagent_tuning_resolve` tool SHALL accept an agent, an outcome of accepted or dismissed and a confirmation equal to the agent id, honour it only from a root session outside any pass lineage, and then set the state to resolved with a cooldown.

#### Scenario: Confirmed resolution
- **WHEN** a root session calls it with confirm equal to the agent id
- **THEN** the state becomes resolved, `cooldown_until` is set, and the pass worktree is removed unless it has uncommitted changes
- **AND** the branch is kept

#### Scenario: An agent cannot resolve a notice about itself
- **WHEN** the calling session's agent is the agent the notice is about
- **THEN** the tool returns an error and the state is unchanged

#### Scenario: Wrong confirmation or non-root caller
- **WHEN** the confirmation does not match or the caller is a subagent or pass session
- **THEN** the tool returns an error and the state is unchanged

### Requirement: User is told a pass awaits review
The plugin SHALL show one reminder message per root session for each open tripped or awaiting_review notice, and SHALL NOT repeat it for that session.

#### Scenario: Reminder shown once
- **WHEN** a root session builds a model request while an unnotified notice exists
- **THEN** one reminder message naming the agent and branch is persisted in that session
- **AND** later requests in that session add no further reminder for the same notice
