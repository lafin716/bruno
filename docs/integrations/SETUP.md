# Self-hosted GitLab and AWS Secrets Manager

These integrations are part of this Bruno fork. They do not require a Bruno paid license. AWS Secrets Manager remains an AWS service with its own charges; this change removes no AWS service charges.

## GitLab

1. Open **Preferences → Git Providers**.
2. Enter the corporate GitLab URL, such as `https://gitlab.company.example` or `https://git.company.example/gitlab`.
3. Enter a GitLab Personal Access Token with `read_api` for project discovery and `read_repository` for HTTPS clone/fetch/pull. Add `write_repository` if you use Git push.
4. Save, then use **Test** to verify the authenticated GitLab username.
5. Open **Import Collection → GitLab**, search your projects and choose HTTPS or SSH. The existing clone workflow lets you choose the branch and local directory, then finds Bruno collections in the repository.

Saved PATs are encrypted in the desktop app's local store. The settings getter returns the server URL and a configured flag. A blank token retains the existing token only when the server URL is unchanged; changing servers requires a new token. **Clear** removes the saved connection. Tokens do not appear in remote URLs or repository configuration. SSH uses the credentials and SSH agent already configured for system Git.

HTTPS is required for corporate servers. HTTP is accepted only for loopback test servers. API and authenticated Git redirects are disabled. A corporate CA must be trusted by Node/Electron and system Git; use your organization's certificate setup, including `NODE_EXTRA_CA_CERTS` where needed.

Saved PAT authentication also applies to fetch, pull and push for matching remotes. Git URL rewrite rules targeting the configured repository are rejected before attaching the PAT; use a direct HTTPS remote or SSH instead.

The configured connection covers one GitLab installation. Project discovery uses GitLab's membership filter. Git permissions still follow the user's project access and token scopes. [GitLab project API](https://docs.gitlab.com/api/projects/), [GitLab API authentication](https://docs.gitlab.com/api/rest/authentication/).

## AWS Secrets Manager

1. Configure local AWS credentials with the normal AWS profile/provider chain. For SSO, authenticate the profile with `aws sso login --profile <profile>` before launching requests.
2. Open **Preferences → Secret Managers**, enable AWS Secrets Manager, enter the default region (for example `ap-northeast-2`) and optional profile, then save.
3. Open a collection environment's **External Secrets** tab and add a mapping:
   - Variable name: `API_TOKEN`
   - Secret ID or ARN: `dev/api`
   - JSON field: `token`, if the SecretString is a JSON object
   - Optional region/profile overrides
4. Save references and use `{{API_TOKEN}}` in your requests. **Test access** checks retrieval without displaying the value.

The credential source is a named AWS profile when configured; otherwise the standard provider chain can use environment credentials, SSO, or an applicable AWS role. This UI never asks for static access keys. The caller needs `secretsmanager:GetSecretValue`; a secret encrypted with a customer managed KMS key also needs `kms:Decrypt`. [AWS GetSecretValue API](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html).

Only references are written into the environment. For example:

```bru
vars:externalsecrets:aws-secrets-manager {
  API_TOKEN: {"secretId":"dev/api","jsonKey":"token","region":"ap-northeast-2","profile":"dev"}
}
```

The JSON reference string is also preserved in YAML `externalSecrets.variables[].value`. A JSON field selects a literal top-level key; omit it for the entire SecretString (or UTF-8-decoded SecretBinary). Use at most 50 unique variable mappings. Overrides apply to each reference; otherwise the desktop settings or CLI defaults apply. References belong to the selected environment, so configure them in each environment that needs them.

Requests resolve references before interpolation and scripts. AWS values override ordinary environment variables of the same name during execution. AWS access being disabled or retrieval failing stops execution. Values are held for the current operation and masked at output boundaries. Automatic variable writeback skips protected names and copied values. The application cannot prevent a script from deliberately transmitting a secret to another service or encoding it into a different value.

Current desktop support covers HTTP and GraphQL requests, collection/folder execution, and GraphQL introspection. gRPC and WebSocket requests with AWS references fail with an explicit unsupported-protocol error. Live SSE chunk content is hidden while AWS secrets are in use, preventing values split across chunks from bypassing masking; completed response data is masked. Ordinary environments retain the existing protocol behavior.

## CLI

```sh
bru run --env dev --aws-secrets --aws-region ap-northeast-2 --aws-profile dev
```

The CLI requires `--aws-secrets` for each run that uses AWS references. `--aws-region` and `--aws-profile` override environment defaults (`AWS_REGION` / `AWS_DEFAULT_REGION`, `AWS_PROFILE`). Explicit `--env-var NAME=value` takes precedence over AWS values for that variable during the run. Reporter output masks retrieved values, including occurrences inside larger strings.

## Development validation

Install dependencies using the repository's normal setup, build the workspace packages, and run the focused Jest suites. Tests use synthetic credentials and temporary files; real company GitLab and AWS validation additionally needs a reachable nonproduction endpoint and working local credentials.

For the actual desktop UI regression, start `npm run dev:web`, then run:

```sh
npx playwright test -c playwright.integrations.config.ts
```

The Electron test uses isolated user data, a loopback GitLab mock and a temporary collection. Screenshots are written to `/private/tmp/bruno-integration-screenshots`. Validation results and limits are recorded in `VALIDATION.md`.
