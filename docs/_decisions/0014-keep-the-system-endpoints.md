# ADR-0014 — Keep the unused system endpoints and their API key

**Status:** Accepted
**Date:** 2026-07-29
**Surface:** frontend, backend, ops
**Supersedes:** —
**Superseded by:** —
**Source:** Remediation-ledger decision D1, 2026-07-29

## Context

`checkIsReady` and `getSystemInfo` in `features/system/queries.ts` had **no callers anywhere in the
application**. They exist, they are typed, they are cached — and nothing renders them.

`INTERNAL_API_KEY_SYSTEM` is required at boot by `core/config.ts` solely to authenticate those two
calls, so every deployment must supply a 64-character secret for functionality nothing invokes.

Three separate audit findings proposed deleting some combination of the three.

## Decision

**Keep all three.** All three findings close as won't-fix.

## Consequences

The accepted cost is explicit: `INTERNAL_API_KEY_SYSTEM` stays mandatory at boot, and a deployment that
omits it fails to start, for functionality nothing calls.

That cost turned out to be an investment rather than waste. When an in-network revalidation route
was added (retired decision 0015; [ADR-0035](0035-reference-data-staleness-is-bounded-by-cache-lifetime.md)
later removed it), the key it authenticated with was already declared, already required, and already
validated — the route needed no new secret and no new deployment step.

**One thing must never be done, and it is the trap this decision creates.** If the two functions are
ever removed, the environment declaration must be removed _with_ them. Deleting only the declaration
while leaving `authType: "system"` in `core/api.ts` converts a boot-time failure — loud, immediate,
impossible to miss — into a runtime `Bearer undefined` that fails on a live request.

## Alternatives considered

**Delete the two functions and the key.** The tidy option. Rejected because readiness and diagnostics
endpoints are the kind of thing wanted precisely when something is wrong, and re-adding them under
pressure means re-adding a secret to production configuration at the worst possible moment.

**Keep the endpoints, make the key optional.** Rejected: an optional secret is one that is absent in
some environment and discovered to be absent during an incident. Boot-time failure is the correct
behaviour for a required credential.

**Keep the backend endpoints, delete the frontend wrappers.** Rejected: the wrappers are what make the
key's `authType` reachable and typed, and deleting them recreates the trap above by another route.
