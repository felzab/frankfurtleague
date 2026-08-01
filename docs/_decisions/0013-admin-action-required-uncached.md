# ADR-0013 — `getAdminSpieleActionRequired` is deliberately uncached

**Status:** Accepted
**Date:** 2026-07-29
**Surface:** frontend
**Supersedes:** —
**Superseded by:** —
**Source:** CLAUDE.md §9 A8

## Context

Eleven query functions carry `"use cache"`. One does not: `getAdminSpieleActionRequired`, in
`features/admin/queries.ts`. It looks like an oversight — the same shape as its neighbours, missing the
directive they all have.

## Decision

**It stays uncached.** Do not add `"use cache"` to it.

## Consequences

It returns **admin-authorized data** — the matches needing attention, fetched with the admin API key.
Next's cache is keyed by arguments, not by caller identity, and this function takes no arguments. A
cache entry would be a single shared slot holding admin-scoped data, populated by whoever asked first.

Today that leaks nothing to the public: the query is only reachable from `/admin`, which is guarded
twice. But the property that keeps it safe would then be "no unauthorized caller ever reaches this
function", which is a routing accident rather than a design guarantee — and one route change away from
being false.

The cost of leaving it uncached is one backend request per admin page load, on a page loaded by one
person a handful of times a day. That is not a trade worth making.

The general rule this expresses: **a cache shared across callers must hold data every caller is
entitled to.** Caching authorized data requires keying on the authorization, which `"use cache"` does
not do.

## Alternatives considered

**Cache it with a short lifetime.** Rejected: a shorter window narrows the exposure without changing
its nature, and buys nearly nothing on a page loaded a few times a day.

**Cache it keyed by session.** Rejected as pointless here — there is effectively one admin identity, so
the key would be a constant and the cache would be the shared slot again. It would also make the cache
key a piece of authorization state, which is a thing to reason about on every future change.
