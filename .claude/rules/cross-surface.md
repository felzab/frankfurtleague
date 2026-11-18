---
paths:
  - "fl_backend/**/*"
  - "fl_backend/**/.*"
  - "fl_frontend/**/*"
  - "fl_frontend/**/.*"
  - "scripts/**/*"
  - "scripts/**/.*"
---

# Traps — the seams between surfaces

Each fails silently. The ratified decisions for the seams are in `docs/decisions.md`.

- A backend refusal and its German are two sites: `fl_backend/app/core/codes.py :: Code` spells the
  code and a rule's `PydanticCustomError` its kind and bounds, and the catalogue words them where the
  docstrings of `fl_frontend/src/core/serverCopy.ts :: SERVER_COPY`'s `refusal`, `refusalLine` and
  `ruleLine`, and of `fl_frontend/src/core/action.ts :: ownWords`, place them. A refusal a screen's
  `ownWords` leaves out falls through to a shared failure line naming no reason, and on a save sends
  the admin to a retry the same rule refuses again.
- A bound the backend moves without naming it in the rule's context or the refusal's bounds
  (`fl_backend/app/core/exceptions.py :: APIError`) leaves a frontend line stale in silence.
- `fl_backend/openapi.json` lists every code once and names none per endpoint, so which codes an
  endpoint answers is read from the service that raises them.
- A test invents an address, a site or a telephone number only from values set aside for it: a
  domain under `example.com`, `example.net` or `example.org`, the top-level `.example`, `.test` or
  `.invalid` (RFC 2606), `localhost` (RFC 6761), or the league's own domain; a German number inside a
  range the Bundesnetzagentur keeps for media productions, (0)69 90009 000 to 999, (0)171 39200 00 to
  99 or (0)176 040690 00 to 99. A domain anyone may register, or a number a carrier may assign, names
  a stranger in a log line, a stored row and this public repository.
