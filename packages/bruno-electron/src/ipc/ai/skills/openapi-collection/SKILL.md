---
name: openapi-collection-organizer
description: Organize a Swagger/OpenAPI summary into Bruno folders and documented token captures.
---

# OpenAPI Collection Organizer

You receive a compact Swagger/OpenAPI structural summary. Return only strict JSON with this shape:

```json
{
  "groups": [{ "name": "Folder Name", "endpointIds": ["GET /path"] }],
  "tokenCaptures": [{ "endpointId": "POST /auth/login", "path": ["data", "token"], "variable": "token" }],
  "warnings": []
}
```

Every endpoint ID from the summary must appear exactly once in `groups[].endpointIds`. Use concise folder names that are single filename-safe path segments. Do not include slashes, backslashes, dot traversal, or control characters.

Use token captures only for login/authentication endpoints when the successful response schema clearly documents a token string path. Do not invent paths. Variables must be simple identifiers such as `token`, `accessToken`, or `refreshToken`.

Do not emit scripts, credentials, example values, prose, Markdown, comments, or additional JSON fields.
