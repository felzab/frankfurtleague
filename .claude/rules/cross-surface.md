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
  code and a rule's `PydanticCustomError` its kind and bounds; the catalogue words them, a code in
  `fl_frontend/src/core/serverCopy.ts :: SERVER_COPY.refusal`, or `refusalLine` for one naming no
  field, and a refused payload's rule through `fl_frontend/src/core/ruleMessage.ts :: ruleMessage`.
  A screen's lane in `fl_frontend/src/core/action.ts` words only what its `ownWords` names, placing a
  refusal about one field by its `paths` and one naming no field on the status line; anything else
  falls through, at any status, to a shared failure line in `COPY.shared.failure`, which names no
  reason, and on a save sends the admin to a retry the same rule refuses again. A bound the backend moves without naming it in the rule's context is a frontend
  line that goes stale in silence. `fl_backend/openapi.json` lists every code once and names none per
  endpoint, so which codes an endpoint answers is read from the service that raises them.
