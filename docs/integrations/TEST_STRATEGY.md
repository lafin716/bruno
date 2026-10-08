# Validation strategy

Install existing locked dependencies in the isolated worktree; build shared packages following `contributing.md`. Do not add dependencies or alter lockfile merely for integration.

- GitLab: unit/service tests and local HTTP mock verify URL/path normalization, project mapping/pagination, PAT header, redirects disabled, sanitized errors, host isolation, secure token status and clone askpass cleanup. Existing git tests must still pass.
- AWS: signed client tests verify regional endpoints, session auth, SecretString/SecretBinary/JSON field handling, deduplication and invalid reference rejection; resolver integration verifies selected environment injection, fail-closed behavior, CLI opt-in/overrides and no writeback of resolved values.
- UI: targeted React tests for save/test/clear/error flows and searching/import; actual isolated Electron or browser UI smoke verifies settings/editor actions and screenshot layout at wide/narrow sizes. Local mocks contain only synthetic secrets.
- Integration: build `bruno-common`, `bruno-requests`, schema-types, filestore, converters/query/graphql/sqlite and JS sandbox prerequisites as necessary; production web build, targeted ESLint and relevant type checks. Existing targeted env persistence tests prove preservation.
- Review: independent code-reviewer reads actual diff, architecture and evidence before final commit.
- Required plan review repairs: protected external names/values across writeback; value-based output redaction (JSON/HTML/JUnit/desktop); fail closed when integration disabled; same credential-scoped path for git clone and branch listing; independent externalSecrets-only save preserving concurrent/draft variable edits. Plan reviewed by native critic with verdict OKAY WITH REQUIRED REPAIRS; these contracts now include the repairs.
- Push: `git push -u origin feat/gitlab-aws-secrets`; compare remote branch SHA to committed local SHA. Never force push.

Real GitLab/AWS smoke runs only against user-identified nonproduction targets with authorized local authentication. If details/auth remain unavailable, report that gap distinctly from local mock results. No real secret contents in logs, screenshots or documentation.
