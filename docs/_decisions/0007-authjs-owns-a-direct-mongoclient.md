# ADR-0007 — Auth.js owns a direct `MongoClient`; nothing else in the frontend does

**Status:** Accepted\
**Date:** 2026-07-29\
**Surface:** frontend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** Ratified 2026-07-29 by the frontend audit and remediation programme, whose permanent
record is `docs/_auditing/reports/2026-07-frontend.md`.

## Context

The standing architectural rule is that the frontend never queries MongoDB — application data goes
through FastAPI without exception. `src/core/db.ts` holds a `MongoClient`, which violates that rule on
its face.

## Decision

**Allow it, scoped narrowly to the Auth.js adapter.** `core/db.ts` may be imported by `core/auth.ts`
and by nothing else.

## Consequences

The scope is what makes it safe, and it is genuinely narrow:

- It targets a **separate database**, `authjs`, not the application database.
- It touches **zero business entities** — sessions, users, verification tokens.
- `@auth/mongodb-adapter` has **no HTTP transport**. Routing it through FastAPI would mean writing and
  maintaining a session-store API, on the hot path of every authorization check.

That hot path is the deciding factor: the session store is read by `src/proxy.ts` on every `/admin`
request and by `getAdminSession()` in every server action. An HTTP hop there would add a round trip to
every authorized operation to satisfy a rule whose purpose — keeping business data behind one validated
API — is not engaged.

**CLAUDE.md's database rule is scoped to _application data_ for this reason.** A second direct
`MongoClient` in the frontend is a real violation, not a precedent this establishes.

The development-mode branch caching the client on `global` is not part of this decision; it is the
standard Next.js pattern preventing hot reload from exhausting the connection pool.

## Alternatives considered

**Put the session store behind FastAPI.** Rejected on cost and risk: a bespoke session API on the
authorization hot path, replacing a maintained adapter, to satisfy a rule about business data.

**Use a JWT session strategy and drop the database adapter entirely.** Genuinely tempting — it removes
the client altogether. Rejected because it removes revocation: there is already no in-app sign-out, so
session lifetime is the only revocation mechanism, and a stateless token would make even deleting the
database row impossible. For an interface whose only purpose is mutating league data, keeping a
server-side record of live sessions is worth the connection.
