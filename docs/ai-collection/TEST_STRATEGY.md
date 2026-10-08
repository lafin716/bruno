# Validation strategy

- Jest Electron targeted specs: process invocation, shell safety, auth/missing CLI/error/malformed output, timeout/cancel/output bounds; Swagger JSON/YAML/UI discovery, bad HTTP/spec/reference errors; collection endpoint preservation/grouping/environments/auth/token scripts and unsafe plans.
- Jest App targeted tests: settings save/preservation, enabled/provider selection, AI import preview/errors/cancel.
- Existing OpenAPI converter and relevant import/AI tests for regression.
- ESLint changed files, production renderer build, CommonJS syntax checks. Repository JS has no distinct typecheck script; build + lint verify syntax/module contracts.
- Real Electron/Playwright isolated smoke: CLI fixture emits predictable plan; local HTTP server serves Swagger UI/spec; import via real UI and verify disk collection. Test connection/error states. Screenshots desktop and narrow supported window.
- Installed real CLI availability/login checked read-only; actual subscription generation recorded separately from fixture evidence.
- No external deployment applicable: desktop feature validated locally.
