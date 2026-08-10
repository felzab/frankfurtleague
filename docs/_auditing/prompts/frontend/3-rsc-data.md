# Frontend pass 3 — RSC and caching semantics, type and validation integrity

Audit pass `frontend 3` on `./fl_frontend`. Lens: RSC AND CACHING SEMANTICS, TYPE AND DATA VALIDATION
INTEGRITY.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the report
to `docs/audit/programme/f3-rsc-data.md`.

DELIVERABLE: required tables — the mutation→invalidation map (A1), the per-segment shell coverage
table (A3), and the per-call-site response-validation table (B1). Report each in full, not only its
gap rows.

CONTEXT — derive, do not assume: `cacheComponents` is on; data reaches the frontend exclusively
through `src/core/api.ts` against FastAPI. The caching design is ratified — two granular tags with
unconditional base tags (ADR-0001), the season default server-side (ADR-0002), `connection()`
preceding every page fetch (ADR-0006), no `generateStaticParams` (`docs/frontend/spec.md :: I28`),
the uncached admin query (ADR-0009). This pass audits **conformance to those decisions**, not the
decisions.

SECTION A — CACHING, RSC, DATA FLOW

A1. **Mutation → invalidation map.** The required table, one row per exported server action (derive
the module list from a `"use server"` grep — never a hardcoded list): action | resource mutated |
tags invalidated | tags used by the queries reading that resource | GAP. Derive the read side from
every `use cache` function's `cacheTag` calls. Verify ADR-0001's invariants hold: every granular
tag has a matching `updateTag` in the same slice, and the base tags are invalidated
unconditionally. Report the full table.

A2. **`use cache` correctness.** Per cached function: `cacheTag` / `cacheLife` declared or silently
defaulted; request-scoped reads (cookies, headers, searchParams, `Date.now()`, random) that would
poison a shared entry; dynamically constructed tag strings unreachable by invalidation.

A3. **Shells and streaming.** Per route segment: `loading.tsx` / `error.tsx` / `not-found` coverage
as a table, Suspense placement between each dynamic hole and the static shell, and — this check
is only real if measured — **measure the built shells**: prerendered HTML sizes per route group,
`$RX` count in served HTML, `resumable` errors in the log. A hook above a boundary
(`useSearchParams` without Suspense) silently collapses a whole route group's shells; a
build-time clock read in the static shell 500s every request while the build markers look
entirely normal.

A4. **Client boundary placement.** Per `"use client"` file: is the directive on the smallest
interactive component, or is a subtree shipped for one leaf? Flag client files importing
`src/core/*`. Before proposing any directive removal, grep the file for **render props** — a
Server Component may not pass a function to a Client Component, neither `tsc` nor the build
catches it on a dynamic route, and it throws at request time on the live page. The rule is in
CLAUDE.md's repo-specific traps.

A5. **Route conventions.** `await params` / `await searchParams` handling, `generateMetadata`
correctness (self-canonicals, per-page titles; every `generateMetadata` doing a fetch must start
with `await connection()` — ADR-0006 applies to it too), searchParams parsed not cast.

A6. **Hook correctness, keys and hydration.** Effects doing derived state or server-side work;
unstable dependencies; state that should be URL state; hydration mismatch sources (clock reads,
locale-dependent formatting, storage reads before mount). Keys belong to this pass in both
senses — a wrong key loses component state as readily as it costs a render: index keys on
reorderable lists, and keys unique only per subset (a per-season match number is not unique
across sibling lists).

SECTION B — TYPES AND VALIDATION

B1. **Response validation, both directions.** The required table, one row per `apiClient` call site:
schema passed | too permissive (`z.any` / `z.unknown` / `.passthrough` / needless `.optional`) |
**fields the backend sends that the schema fails to declare** — zod's default strip mode silently
discards them, and an audit checking only for over-permissiveness cannot see this class at all |
verdict.

B2. **Server-action input validation.** Per action: client-supplied input parsed through a schema
before use, or trusted? Report each unvalidated field with its assumed type.

B3. **Schema and type drift.** Hand-maintained types duplicating a zod schema in the same slice:
derived (`z.infer`) or drifting, with every differing field named.

B4. **Unsafe escapes.** `as` casts (excluding `as const`), non-null `!`, unguarded `unknown`
narrowing, shape-assuming catch blocks. `noUncheckedIndexedAccess` is on — anything reported here
must be a genuine remaining hole, not something the compiler already rejects.

B5. **Env contract.** Every env var consumed in `src` is declared and validated in `core/config.ts`;
anything declared but never consumed (names only, never values; check ADR-0010 before flagging
the system key).

Priority order: A1, B1, A3, A2, B2, A4, B4, B3, A5, B5, A6.

BOUNDARIES — not this pass: deprecated idioms → f1 · structure, duplication and dead code → f2 ·
authorization, secret exposure, injection, error leakage → f4 · accessibility and UX → f5 · styling
and rendering cost → f6 · **whether the backend write behind an action changes more than the
invalidated tags cover** → the crosscut pass, which joins A1's table against the backend's own
write→read map.
