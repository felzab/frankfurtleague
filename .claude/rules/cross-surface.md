---
paths:
  - "fl_backend/**/*"
  - "fl_backend/**/.*"
  - "fl_frontend/**/*"
  - "fl_frontend/**/.*"
  - "nginx/**/*"
  - "nginx/**/.*"
  - "scripts/**/*"
  - "scripts/**/.*"
---

# Traps — the seams between surfaces

Each fails silently. The ratified decisions for the seams are in `docs/decisions.md`.

- A backend refusal and its German are two sites. `fl_backend/app/core/codes.py :: Code` spells the
  code, and a mapper in the feature slice words it for the save. The frontend reads a refusal by its
  code, and the backend answers it at the status its check chose, so a code the mapper leaves
  unmapped falls through, at any status, to the shared fallback in
  `fl_frontend/src/shared/utils/actionError.ts`, which names no reason, and on a save sends the admin
  to a retry the same rule refuses again. `fl_backend/openapi.json` lists every code once and names
  none per endpoint, so which codes an endpoint answers is read from the service that raises them.
