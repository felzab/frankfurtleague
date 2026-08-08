# ADR-0071 — A malformed id is a 404 in a path and a 422 in a query, and that split is the rule

**Status:** Accepted
**Date:** 2026-08-08
**Surface:** backend
**Supersedes:** —
**Superseded by:** —
**Source:** Roadmap item BE-13 (my item, 2026-08-04), asking for one predictable rule.

## Context

The two spellings answer differently, and each is uniform within itself:

- **A path segment: 404.** `fl_backend/app/core/routing.py :: by_id` spells every ObjectId-addressed route with
  the `objectid` convertor, whose regex is 24 hex characters — `/spiele/not-an-id` matches no route
  and never reaches a handler. A season id is a four-character string rather than an ObjectId, so
  `/saisons/{saison_id}` carries no convertor and a wrong id 404s from the lookup instead; the status
  is the same from both mechanisms.
- **A query parameter: 422.** `GET /spieler?team_id=not-an-id` reaches the filter model, where
  `team_id` is a `CustomObjectId`, and Pydantic rejects the value as `REQ-VAL-001` — exactly as it
  rejects any other malformed parameter.

The rule as first proposed — one status for "twenty-four characters that are not a valid ObjectId" —
cannot be implemented, because that set is empty: every 24-character hex string constructs an
ObjectId, and a 24-character string that is not hex fails the convertor's regex and never reaches
validation. There is no case in between for a third disposition to catch.

The convertor is not free to go. `GET /spiele/action_required` is admin-authorized and
`GET /spiele/{spiel_id}` is not, so the two live in different routers
([ADR-0034](0034-the-write-path-is-resource-first-in-a-second-router.md)) — and with an
unconstrained `{spiel_id}`, the literal path is captured by the parameter unless the include order
in `fl_backend/app/main.py` happens to save it, which is a load-bearing invisible ordering the convertor
exists to remove.

## Decision

**The split is ratified as the rule: a path identifies, a query validates.** A path segment names a
resource, and a malformed id names nothing — there is no such resource, and no resource is a 404. A
query parameter carries input, and malformed input is a validation failure — 422, `REQ-VAL-001`,
like every other malformed parameter. The distinction is real rather than accidental, and it now
reads that way: `docs/backend/spec.md` §4 states it beside the other failure contracts.

**`REQ-OID-001` (400) stays, as the net behind both.** It maps bson's `InvalidId` wherever a
handler constructs an ObjectId from a string no convertor or model has checked. Through routed
traffic it is expected to be unreachable — the convertor guarantees 24 hex characters, which always
construct, and every query id passes `CustomObjectId` first — and a net whose triggering would
reveal a gap in the two rules above is worth its eleven lines.

## Consequences

**No code changes.** The behaviour was already uniform within each spelling; what was missing was
the statement that the split is intentional, which is what made it read as accidental
(`docs/backend/spec.md` §7 tracked it as such, and that row leaves with this decision).

**The convertor must stay.** Dropping it would re-open the literal-vs-parameter capture that
`fl_backend/app/core/routing.py`'s header documents, and would move `/spiele/not-an-id` from "no such route"
to "a handler queried Mongo with a string" — which is the case `REQ-OID-001` exists to net.

**A client can tell the two failures apart, and that is correct.** A 404 on a path says "nothing is
at this address"; a 422 on a query says "this request is malformed". An SDK generated from
`openapi.json` sees the same split every HTTP API built on resource semantics shows.

## Alternatives considered

**One status for a malformed id anywhere, by dropping the convertor.** Rejected: it re-opens the
routing capture above, makes router include order load-bearing and silent, and turns a
never-matching URL into a database query.

**One status for a malformed id anywhere, by mapping a malformed query id to 404.** Rejected: it
would special-case one parameter out of `REQ-VAL-001`'s uniform contract — every other malformed
parameter stays 422 — so the API would trade one inconsistency for a worse one inside a single
endpoint.

**A dedicated 400 for malformed ids in both positions.** Rejected for the path half outright — the
convertor means the route does not exist, and answering 400 would require matching the route first —
and for the query half it is the same special-casing as above with a different number.
