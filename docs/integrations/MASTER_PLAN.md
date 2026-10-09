# GitLab and AWS Secrets Manager integrations

Goal: provide configurable self-hosted GitLab project discovery and authenticated clone, plus AWS Secrets Manager references resolved before requests in the desktop application and CLI. Deliver on `feat/gitlab-aws-secrets` in `/private/tmp/bruno-gitlab-aws-20261008`, commit and push to the user's `origin` fork.

## Requirements and completion criteria

- R1: Preferences > Git Providers supports a GitLab base URL (including an installation path), encrypted PAT save/replace/clear, and connection test. Search accessible projects with pagination and import through the existing clone/scan workflow.
- R2: Private HTTPS clone, branch discovery, fetch, pull and push use the saved token without placing it in URLs, command arguments, git config, logs, or renderer state after save. Match push URLs independently. SSH remains available through system Git.
- R3: Preferences > Secret Managers configures AWS region/profile and enables fetching. Credentials use existing AWS providers; static AWS access keys are never requested or stored by these settings.
- R4: Collection environment External Secrets editor maps variable names to AWS Secret ID/ARN, optional JSON field, region, and profile. Persist references only in existing `externalSecrets` format; `.bru` and YAML round-trip.
- R5: Resolve selected environment references before desktop and CLI execution; raw values remain ephemeral, participate in secret masking, and are never persisted by environment writeback. Errors stop execution and omit secret payloads. CLI opt-in is explicit.
- R6: Targeted tests cover auth isolation, validation, API behavior, references, injection, failures, and preservation of existing env behavior. Build/lint and actual UI smoke at two sizes validate integration. An independent reviewer examines credentials and secret leakage.
- R7: Document setup, minimum permissions, supported scope, tests and remaining limits. Commit and push branch after verification.

Target: local macOS Electron development app with isolated user data and local mock service/credential tests. Real company GitLab/AWS smoke additionally needs user-specified nonproduction endpoints/Secret ID and usable local authentication; these have been requested, without asking for credential values. No external infrastructure or deployment is required.

## Tasks and ownership

| ID | Output | Owner | Dependencies | Complexity |
|---|---|---|---|---|
| INT-001 | Contract and independent plan review | leader + critic | - | HIGH |
| INT-002 | GitLab service/store/IPC, authenticated git, tests | gitlab agent | INT-001 | HIGH |
| INT-003 | Shared AWS client/resolver, desktop and CLI integration, tests | aws agent | INT-001 | HIGH |
| INT-004 | Preferences and GitLab import UI/tests | settings agent | INT-001 | MEDIUM |
| INT-005 | External Secrets environment UI/state, registration, integration tests | leader | INT-001 | HIGH |
| INT-006 | Build/lint/tests, actual desktop UI smoke and review fixes | leader + independent reviewer | INT-002, INT-003, INT-004, INT-005 | HIGH |
| INT-007 | Setup docs and final validation evidence | leader | INT-006 | MEDIUM |
| INT-008 | Commit/push and remote SHA verification | leader | INT-007 | LOW |

Use native executor agents for bounded lanes. Installed explore/researcher models proved unavailable for this account in the earlier investigation; supported executor/critic/code-reviewer roles are used instead. Logical tier HIGH/ADVANCED/high for backend/auth, MEDIUM/STANDARD/medium for UI; effective model is role default unless observed. No global model changes.
