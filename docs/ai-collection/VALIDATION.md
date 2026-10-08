# Validation evidence

Date: 2026-10-08. Target: local Bruno Electron on macOS. No external deployment required.

## Current evidence

- Plan: independent critic accepted repaired concrete contracts before implementation.
- Renderer production build: PASS (`npm run build:web`), existing dependency/module warnings only.
- Final Electron UI smoke: PASS 2/2, isolated CLI/HTTP/userdata fixtures. Swagger UI discovery, local connection check, generation preview, save destination, files/folders/environment/auth/token script, cancellation/error retry. Screenshots at 1280×850 and 850×700 inspected.
- Actual synthetic HTTP round trip: PASS. Public login sends no Authorization header; generated post-response script captures the token; protected `/api/v1/users` sends `Bearer synthetic-access-token`.
- Existing AI context/script/autocomplete prompt regressions: PASS 155 tests / 3 suites.
- Existing OpenAPI/Swagger2 authentication/server-variable converter regressions: PASS 30 tests / 3 suites.
- Final Electron adapter/resolver/import specs: PASS 51 tests / 4 suites.
- App local preferences/import/autocomplete specs: PASS 13 tests / 3 suites.
- Total: 249 Jest tests / 13 suites and 2 Electron E2Es passed. Independent final code review: APPROVE, no remaining findings.
- ESLint all changed JS/TS files: PASS, zero errors; four pre-existing warnings (existing hook dependency patterns, unused PROVIDERS import, old == usage).
- `git diff --check`: PASS. No dependency or lockfile changes retained.

## Actual subscription CLI evidence

Separate from deterministic fixture smoke, both actual installed adapters called their AI service with a short synthetic-only prompt and returned the expected strict Health endpoint JSON:

| CLI | Version | Login check | Model generation |
|---|---|---|---|
| Codex | 0.157.1 | ChatGPT subscription verified | PASS; group Health, GET /health, no token captures |
| Claude Code | 2.1.283 | claude.ai first-party subscription verified | PASS; group Health, GET /health, no token captures |

No auth files or credentials were exposed. The real Codex invocation used the current installed npm CLI symlink under Node 24; forcing a different older Codex installation on the Node 22 PATH produced a models-cache compatibility error. Configure the intended CLI absolute path when multiple installations exist. Application/project builds used Node 22, matching repository guidance. The adapter resolves npm executable symlinks and runs JS entrypoints using Electron's Node mode.

## Review and repairs

Independent reviewers tested the actual code and reproduced an endpoint suffix collision that attached token capture to the wrong request. Exact synthetic endpoint identity mapping now prevents this. The same review identified unsafe failed-response traversal and credential-bearing redirect bypasses; response scripts now guard status and use safe traversal, and resolver redirects are validated at every hop under a shared deadline.

Leader checks additionally repaired server-template/relative URL preservation, missing auth env variables, process termination/timeout/EPIPE, and CLI canonical output/auth checks. The refresh-token-to-bearer collision is repaired: conflicting captures are skipped with a warning and cannot become the access credential. Public authentication overrides are explicitly preserved. Final independent re-review approved these repairs; all targeted specs and enhanced HTTP smoke passed afterward.

## Environment notes

Locked dependencies were installed without adding packages. npm blocked native install scripts; Electron's locked installer was run explicitly. jsdom's optional canvas package existed without its native binding, so the unusable local installation was moved aside inside ignored node_modules to use jsdom's supported no-canvas mode. This affects no tracked source or application behavior. Jest uses `--watchman=false` because sandboxed Watchman cannot write its user state directory. Workspace prerequisite builds were executed with Node 22 after a Node 24 build remained alive after writing artifacts.

## Evidence locations

Commands and latest results are recorded here and in PROGRESS.md. Session logs under `/private/tmp/bruno-ai-*.log`; real UI screenshots/traces under `test-results/ai-local-collection-import-*/`. These generated artifacts are ignored; rerun the committed `tests/ai/local-collection-import.spec.ts` to reproduce them.
