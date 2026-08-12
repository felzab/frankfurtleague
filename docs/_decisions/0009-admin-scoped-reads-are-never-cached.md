# ADR-0009 — An admin-scoped API read is never cached

**Status:** Accepted\
**Date:** 2026-08-08\
**Surface:** frontend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** The documentation re-baseline of 2026-08-08, widening the original decision of
2026-07-29 from one function to the class it was always an instance of.

## Context

Most query functions under `fl_frontend/src` carry `"use cache"`. The ones that fetch with the
admin API key do not, and the first of them — `getAdminSpieleActionRequired`, in
`fl_frontend/src/features/admin/queries.ts` — looks like an oversight: the same shape as its
neighbours, missing the directive they all have.

It is not an oversight. Next's cache is keyed by a function's **arguments**, never by caller
identity. An admin-scoped read cached on its arguments becomes a slot any later caller can be
served from — populated by whoever asked first, holding data that was fetched with credentials the
later caller never presented. For a zero-argument function the failure is total: one shared slot
for everyone.

## Decision

**No admin-scoped API read takes `"use cache"`.** A cache shared across callers must hold only
data every caller is entitled to; caching authorized data would require keying on the
authorization, which `"use cache"` does not do.

`getAdminSpieleActionRequired` is the governing instance: it returns the matches needing attention,
fetched with the admin API key, and takes no arguments. It stays uncached, and so does every read
added to the admin surface after it.

## Consequences

**The cost is one backend request per call site, not one per admin page load** — nothing dedupes
them, so a page reading the same data from more than one boundary pays for each
([`docs/frontend/spec.md`](../frontend/spec.md#12-cached-reads) §1.2 carries the mechanism). On pages
loaded by one person a handful of times a day, that is still not a trade worth reversing.

**The safety property is a design guarantee rather than a routing accident.** Today an uncached
admin read leaks nothing even if it were cached, because the admin queries are only reachable from
`/admin`, which is guarded twice. But that protection is "no unauthorized caller ever reaches this
function" — a property of the current routing, one route change away from being false. The rule
removes the dependency.

**A violation is silent.** Adding `"use cache"` to an admin read type-checks, lints, builds and
passes every test; nothing in the toolchain knows what the function returns or who it fetches as.
That is why this rule is also a named trap in the assistant instructions — the gate cannot catch
it, so the reader has to.

## Alternatives considered

**Cache admin reads with a short lifetime.** Rejected: a shorter window narrows the exposure
without changing its nature, and buys nearly nothing on pages loaded a few times a day.

**Cache keyed by session.** Rejected as pointless here — there is effectively one admin identity,
so the key would be a constant and the cache would be the shared slot again. It would also make the
cache key a piece of authorization state, which is a thing to reason about on every future change.
