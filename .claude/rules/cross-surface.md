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

- A backend refusal and its German are three sites. `fl_backend/app/core/domain.py` declares the rule
  and its code; a mapper in the feature slice words it for the save, and where the replayed
  endpoint declares refusals the undo action words it again in its own replay table. The frontend
  reads a refusal by its code, and the backend answers it at the status its rule's check chose, so a
  code either path leaves unmapped falls through, at any status, to the shared fallback in
  `fl_frontend/src/shared/utils/actionError.ts`, which names no reason, and on a save sends the admin
  to a retry the same rule refuses again. A slice's test asks its mapper about every refusal code
  `fl_backend/openapi.json` publishes on that endpoint, through
  `fl_frontend/src/test-support/publishedRefusals.ts`.
