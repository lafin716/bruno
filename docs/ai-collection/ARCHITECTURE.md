# Architecture

Preferences > AI > Local CLI connections persists ai.localProviders through existing preferences store. IPC reads settings from main process; renderer cannot supply arbitrary CLI flags. Main spawns configured executable with an argument array and shell disabled, bounded stdin/stdout, fixed no-tools/read-only invocation, timeout and AbortSignal. Existing CLI account credentials remain managed by the CLI.

Import Collection > AI receives Swagger link and provider choice. Resolver fetches bounded HTTP(S) JSON/YAML or discovers Swagger UI configuration without executing remote code. Parser rejects invalid or unsupported specs. Application skill plus secret-free structural summary is sent to selected CLI. Model proposes JSON folders/endpoint assignment and documented token extraction paths only. Validator rejects unknown endpoints, unsafe names and token paths. Existing OpenAPI converter plus deterministic edits creates request tree, environments and fixed token capture scripts. Result preview displays changes and warnings before existing destination selection/save flow.

All imports are read-only until the user uses the existing Import action. Cancellation aborts fetch/CLI, and sender teardown kills active jobs. Do not persist or log prompts/output containing secrets. Errors distinguish connection, retrieval, interpretation and cancellation. Existing API-key integrations remain available as before; local CLIs initially power collection automation.

Design follows current Preferences settings panes, themed textboxes/buttons and Import tabs. Busy state remains inside AI tab so Cancel is reachable. Preview lists generated folder/env/auth changes and unknown-token warnings. No new artwork or theme framework.
