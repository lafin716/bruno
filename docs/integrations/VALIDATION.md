# Integration validation

Target: local macOS Electron 37.6.1 development app, with isolated user data, synthetic credentials, a temporary Bruno collection and loopback GitLab/Git servers. No user application settings or production services were modified. The initial source revision was `9d177eb4f89f46e54191fdcf991b7a6ca4781fce`.

## Evidence

| Check | Result |
| --- | --- |
| App focused regression tests | PASS: 10 suites, 108 tests, including drafts, protected writeback and close/save flows |
| CLI focused regression tests | PASS: 6 suites, 100 tests, including actual runner protection and credential signing |
| Shared AWS resolver/client/redaction | PASS: 9 tests |
| Electron focused regression tests | PASS: 13 suites, 103 tests, including real authenticated Git clone/branch/fetch, IPC and protocol regressions |
| Git integration under actual Electron Node runtime | PASS: authenticated clone/branch/fetch with Electron 37.6.1's Node 22.19.0 executable |
| Actual Electron UI | PASS: 1 Playwright test; provider save/test/clear, GitLab project listing, AWS settings, external reference add/save/discard |
| Production web build | PASS: `npm run build:web` |
| Shared package build | PASS: `npm run build:bruno-requests` |
| Strict type check | PASS: new AWS TypeScript module using the existing workspace TypeScript 5.8 compiler |
| ESLint | PASS: 62 changed/new JavaScript/TypeScript files checked; 0 errors, 53 warnings |
| Whitespace check | PASS: `git diff --check` |

Final focused totals: 320 tests across 30 suites, plus one actual Electron Playwright test. The final independent security review approved the scoped Git authority and OAuth2 redaction repairs with zero remaining issues.

## Reproduce

Focused test commands were run with `--runInBand --no-watchman`. Watchman otherwise tries to write outside the task's isolated writable roots. The real Git and Electron tests also need loopback server access.

```sh
npm run test --workspace=packages/bruno-app -- --runInBand --no-watchman \
  src/components/Preferences/GitProviders/index.spec.js \
  src/components/Preferences/SecretManagers/index.spec.js \
  src/components/Sidebar/ImportCollection/GitLabTab.spec.js \
  src/components/Sidebar/ImportCollection/index.spec.js \
  src/providers/ReduxStore/slices/collections/external-secrets.spec.js \
  src/providers/ReduxStore/slices/collections/external-secret-writeback-protection.spec.js \
  src/providers/App/ConfirmAppClose/SaveRequestsModal.spec.js \
  src/providers/ReduxStore/slices/collections/draft-env-merge.spec.js \
  src/providers/ReduxStore/slices/collections/draft-collection-vars-isolation.spec.js \
  src/providers/ReduxStore/slices/global-environments.spec.js

npm run test --workspace=packages/bruno-cli -- --runInBand --no-watchman \
  tests/utils/aws-secrets.spec.js tests/runner/response-fields.spec.js \
  tests/utils/persist-variables-aws.spec.js tests/utils/sanitize-results.spec.js \
  tests/utils/persist-variables.spec.js tests/utils/environment.spec.js

npm run test --workspace=packages/bruno-requests -- --runInBand --no-watchman src/utils/aws-secrets.spec.ts

npm run test:ci --workspace=packages/bruno-electron -- --runInBand --no-watchman \
  src/store/tests/gitlab.spec.js src/services/gitlab.spec.js src/ipc/gitlab.spec.js \
  src/ipc/git.spec.js src/utils/git.spec.js src/utils/git.integration.spec.js \
  src/services/aws-secrets.spec.js src/services/save-external-secrets.spec.js \
  src/ipc/collection.spec.js tests/network/aws-secrets.spec.js \
  src/ipc/network/ws-event-handlers.spec.js src/ipc/network/grpc-event-handlers.spec.js \
  src/ipc/network/runner-exchange.spec.js

node packages/bruno-common/node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck \
  --target ES2020 --module commonjs --esModuleInterop --types node \
  packages/bruno-requests/src/utils/aws-secrets.ts

# From packages/bruno-electron, verify the askpass helper with Electron's executable:
ELECTRON_RUN_AS_NODE=1 ../../node_modules/.bin/electron ../../node_modules/jest/bin/jest.js \
  src/utils/git.integration.spec.js --runInBand --no-watchman

npm run dev:web
# In another terminal:
npx playwright test -c playwright.integrations.config.ts
```

Screenshots were visually inspected at both supported sizes:

- [Git Providers, 1440×1000](screenshots/settings-git-providers-1440x1000.png)
- [Git Providers, 900×700](screenshots/settings-git-providers-900x700.png)
- [External Secrets, 1440×1000](screenshots/external-secrets-1440x1000.png)
- [External Secrets, 900×700](screenshots/external-secrets-900x700.png)

## Review and limits

Independent plan review required explicit protected-value metadata, output masking, disabled-mode rejection, scoped Git authentication and a separate reference-only save path. These contracts were incorporated before implementation. Independent code review then exercised the actual CLI persistence wiring, desktop writeback, stream/console/error paths, credential signing and Git output/auth isolation; findings were repaired and regression tested.

The final review verdict was APPROVE. The generated Git askpass helper parses the prompted URL and compares its authority exactly; actual helper execution rejects suffix, prefix and path lookalikes. OAuth2 debug events and cached credential metadata use the shared value redactor, with Basic-auth, form-encoded and JSON-escaped regressions. The reviewer independently reran 31 focused Electron tests and 9 shared AWS tests and checked modified Git/network syntax.

Real company GitLab and AWS access was not exercised because no nonproduction endpoint/project/Secret ID and local authorization were supplied. Local protocol/signing/mock results are not claims of real account access. No packaged installer was produced; validation uses the actual development Electron app and a production renderer build.

The shared package build still emits preexisting Faker declaration warnings from the package's TypeScript 4.8 build, and converter prerequisite builds have preexisting type warnings. The new AWS module passes a separate strict TypeScript 5.8 check. No dependency or lockfile changes were made.

See [SETUP.md](SETUP.md) for protocol support and certificate/credential requirements. AWS references currently support HTTP/GraphQL; gRPC/WebSocket are explicitly rejected. Live SSE content is hidden while AWS secrets are active. A script can deliberately transmit or transform a secret; output masking cannot provide protection against arbitrary script transformations.

## Delivery

Implementation commit `6ed3a78f041da1ef1c569405bbaae8f7d7b69273` was pushed to `origin/feat/gitlab-aws-secrets`. `git ls-remote --heads origin feat/gitlab-aws-secrets` returned the same SHA. The commit hook passed and left the validated staging tree unchanged (`092e7d524dafac5ef4a5616397d8a79efe9678ea`). The worktree was clean after commit. The original workspace remained clean on `main` at the initial source revision. This completed validation/progress record is delivered as a documentation follow-up commit.
