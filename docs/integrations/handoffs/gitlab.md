# INT-002: GitLab backend

Role: executor, HIGH/ADVANCED/high requested; installed role effective default (role constraints apply).
Read AGENTS.md, MASTER_PLAN/ARCHITECTURE/TEST_STRATEGY in docs/integrations and PROGRESS.md.
Dependency INT-001: critic approved with repairs recorded in contracts.
Ownership: new packages/bruno-electron/src/store/gitlab.js, services/gitlab*.js, ipc/gitlab.js and tests; existing utils/git.js, utils/git.spec.js, ipc/git.js and related tests only. Leader owns src/index.js registration and docs/progress; settings agent owns all GitLab UI.
Implement all GitLab IPC contracts in ARCHITECTURE, encrypted token storage, URL/path validation and matching, connection test, paginated projects, and private HTTPS clone AND branch listing authentication through scoped askpass with guaranteed cleanup. Reuse dependencies; no tokenized URLs or persistent credential config; no raw token in getters/errors/logs/progress. HTTPS production, loopback HTTP tests only; redirects disabled. SSH must remain unchanged.
Tests: mock HTTP/Git and encrypted store; inspect actual ephemeral script invocation/token env and cleanup, URL origin isolation, path prefixes, denied credentials, pagination/redaction and existing git tests. Installation/dependency builds run by leader; no independent npm install/build to avoid races. You may run targeted Jest after prerequisites are available. Report exact commands and pass/fail.
You are not alone in this worktree. Do not revert others, edit shared files, commit, push, or recursively delegate. Read task state before work; return IN_PROGRESS then REVIEW report with changed files, evidence and any blockers/contract revisions. Leader integrates/verifies DONE.
