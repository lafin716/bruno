# Integration contracts

## GitLab

Main-process `store/gitlab.js` owns metadata and encrypted PAT independently of general preferences. Getter returns `{baseUrl, configured}` only. Changing the URL cannot silently reuse a token for another server; replacing/clearing is explicit. Require HTTPS except localhost loopback for local tests. Reject embedded credentials/query/fragment and disable HTTP redirects on authenticated API requests. TLS verification remains enabled; company CA uses normal trusted CA configuration.

IPC contracts (single object args except getter):
- `renderer:get-gitlab-settings` -> `{baseUrl, configured}`.
- `renderer:save-gitlab-settings` `{baseUrl, token?}` -> safe settings. Omitted/blank token preserves only the same server's token; URL changes require a fresh token.
- `renderer:clear-gitlab-settings` -> safe empty settings.
- `renderer:test-gitlab-connection` `{baseUrl?, token?}` -> `{username}`. Saved-token fallback only for the same server.
- `renderer:list-gitlab-projects` `{search, page}` -> `{projects:[{id,name,pathWithNamespace,httpUrl,sshUrl,defaultBranch}],hasMore}`. `PRIVATE-TOKEN`, `/api/v4/projects`, membership=true, simple=true, per_page=20. Server URL supports a path prefix.

Import UI passes `{type:'git-repository', repositoryUrl: project.httpUrl}` to the existing workflow. Existing git clone/list-branches IPC routes add credentials only to matching configured GitLab URLs. Scoped git askpass uses a temporary script plus process environment; always remove it, disable credential helper persistence and redirects, sanitize errors. Never store tokenized remotes. Own GitLab service/store/new IPC and git.js utility/IPC files; leader registers module in Electron index.

Fetch/pull/push/canPush use the same scoped authentication, with push URLs checked separately. Reject applicable Git URL rewrite rules before attaching credentials. A generated Node askpass helper parses Git's prompted URL and requires an exact host/port match; POSIX and Windows wrappers launch it using the current executable with Electron's Node mode. Progress redaction handles tokens split across output chunks.

## AWS Secrets Manager

Main-process `store/aws-secrets.js` stores only `{enabled, region, profile}` (defaults false/empty/empty). IPC:
- `renderer:get-aws-secrets-settings` -> settings.
- `renderer:save-aws-secrets-settings` `{enabled, region, profile}` -> validated settings.
- `renderer:test-aws-secret` `{secretId, jsonKey?, region?, profile?}` -> `{ok:true}` after a fetch; never return the secret value.

References persist in the existing collection environment format:
`externalSecrets: {type:'aws-secrets-manager', variables:[{name:'API_TOKEN',value:'{"secretId":"dev/api","jsonKey":"token","region":"ap-northeast-2","profile":"dev"}'}]}`.
`value` is a JSON string so BRU and YAML both preserve it. `secretId` required; remaining fields optional; empty jsonKey uses the entire SecretString (or decoded SecretBinary). JSON selection uses a literal top-level key, not an ambiguous dotted path. Names must be valid, unique, and not reserved (`__proto__`, `constructor`, `prototype`, `__name__`). Region/profile defaults come from desktop settings or CLI options/environment. Reference overrides are explicit per variable.

Shared `@usebruno/requests` exports `resolveAwsExternalSecrets` and AWS client factory, using injected AWS signing/credential callbacks to reuse existing `aws4-axios` and `@aws-sdk/credential-providers` from Electron/CLI without adding dependencies. Resolve `GetSecretValue` via signed HTTPS JSON POST; no arbitrary remote endpoint in collection references. Include session credentials, timeout and sanitized error categories; a failed lookup stops the request. No persistent value cache in MVP; deduplicate same secret within a resolution operation. Enforce bounded reference count.

Desktop/CLI credential adapters use named profiles or default provider chain. Resolve after env assembly but before interpolation/scripts/send, including collection runner. External values override same-named regular environment values; existing explicit CLI `--env-var` overrides win. CLI flags `--aws-secrets` (default false), `--aws-region`, `--aws-profile`; do not unexpectedly read AWS secrets from shared collections without opt-in. Preserve ordinary environments with no AWS references. When AWS references exist and fetching is disabled, fail closed with a clear configuration message rather than sending unresolved placeholders.

Resolution returns ephemeral `{variables, secretNames, secretValues}`. Track this metadata through each execution operation. Never mutate persisted environment/reference objects. Remove protected names from desktop script env/global/collection writeback and CLI persistence; also omit automatic variable updates containing a fetched value under another name. Runtime script writes to external names remain runtime-only. Redact known secret values (including values embedded in larger strings) in errors, final renderer responses, desktop runner events and CLI console/JSON/HTML/JUnit output. Internal request/script execution must use actual values; redact only at output boundaries. Add focused leakage regression tests. Keep raw values out of the Redux store, settings/status IPC and secret test results. Shared redaction helper may live with AWS resolver in bruno-requests and be exported for output boundaries.

HTTP/GraphQL execution is supported; gRPC/WebSocket reject AWS references explicitly. Live SSE output is masked while AWS references are active; complete bodies remain available internally for execution/tests. Automatic cookies containing fetched values are not persisted. OAuth2 debug events and cached credential metadata are redacted, including Basic-auth envelopes, form encoding and JSON escaping. Redaction cannot prevent deliberate arbitrary transformations or transmission by user scripts.

Use a dedicated `renderer:save-external-secrets` handler taking `(collectionPathname, environmentName, externalSecrets)` and returning void. Under the existing per-file lock read the latest environment file, update only `externalSecrets`, stringify/write, and preserve all local secret references, variable drafts, extends/color/annotations. Leader owns this handler in ipc/collection.js and matching Redux `saveExternalSecrets` thunk/reducer; settings/backend agents do not edit those files.

Backend agent owns `bruno-requests` new AWS helpers/exports/tests, Electron AWS store/IPC/services and execution integration, CLI execution/utilities/tests. Leader owns environment editor, Redux actions/reducers and Electron registration. Settings agent owns Preferences and ImportCollection components. Ask leader before shared-file changes.

## UI

Reuse Preferences SettingsLayout, existing theme/form inputs/buttons and modal/import styles. Provide explicit save/test/clear actions, loading and error feedback, no raw fetched value preview. GitLab search has empty/loading/error states and pagination. External Secrets editor has explicit Save references, add/remove mappings, provider/default settings hint, pending-change handling, and JSON validation before save. No raster assets needed. Validate desktop at wide and narrow supported sizes.

## Primary API evidence

- GitLab projects API: https://docs.gitlab.com/api/projects/
- GitLab REST authentication: https://docs.gitlab.com/api/rest/authentication/
- AWS GetSecretValue: https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html
