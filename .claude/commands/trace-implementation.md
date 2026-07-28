---
description: Reason through stack layers, edge cases, and security before writing any code
argument-hint: "[the feature or change to trace]"
---

Reason step-by-step **before** producing any code. No implementation until the trace is complete.

**Subject:** `$ARGUMENTS` — if empty, trace the change currently under discussion.

**Work through, in order:**
1. **Stack layers touched** — frontend (Next.js/HeroUI/Tailwind), API (FastAPI/Pydantic), data (Motor/MongoDB), infra (Compose/nginx). Name each layer and what changes in it.
2. **Data flow** — trace a request end to end, including the response and error paths.
3. **Edge cases** — empty, null, concurrent, duplicate, oversized, malformed, unauthorized.
4. **Security** — input validation, authz boundaries, secret handling, injection surface.
5. **Failure modes** — what happens when the DB is unreachable, a request times out, a write half-succeeds.
6. **Trade-offs** — what the chosen approach costs, and what specifically would need to change to reverse it later.

Mark the end with `=== TRACE COMPLETE ===`, then provide the implementation per the `CLAUDE.md` §4 Response Structure.
