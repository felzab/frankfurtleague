# ADR-0034 — The write path is resource-first, in a second router per slice

**Status:** Accepted
**Date:** 2026-08-02
**Surface:** backend
**Supersedes:** —
**Superseded by:** —
**Source:** Open item BE-4, building the write path for the reference collections.

## Context

Every mutation in this service used to live in one file, `app/api/admin/router.py`, under paths shaped
`/api/v0/admin/<verb>_<resource>` with the target's id in the request **body**. It held two resources
and roughly six operations, and at that size the arrangement was unremarkable.

BE-4 took it to **seven resources and 50 operations**, at which point three properties of the shape
stopped being cosmetic.

**The URL did not name the resource.** `PATCH /api/v0/admin/patch_spielort` with `{"spielort_id": …}`
in the body means the Request-URI identifies _an operation_, not a thing. RFC 5789 §2 is explicit that
for `PATCH` the Request-URI identifies the resource and the body describes the change; the old shape
inverted that, so nothing about a request's path said what it would touch, and no two resources'
mutations were addressable alike.

**Authorization was per-endpoint.** Every handler in the admin router carried
`Depends(verify_access_admin)` on its own signature. That is one decorator argument away from an
unguarded write, in a file where every neighbour has it, in a diff where its absence looks like every
other line. Nothing fails when it is forgotten — the endpoint simply works, for everyone.

**One file was becoming the whole write path.** Seven resources' mutations in one module, importing
seven slices' schemas and services, is the aggregator shape that ADR-0012 permits for `admin` on the
frontend precisely because it is a _view_ over slices. A write path is not a view; it belongs to the
data it writes.

A fourth question arrived with the junctions. `saison_teams` and `saison_spieler` have no id a client
carries around — a row is identified by a pair, and each pair is exactly a unique index
(`uniq_saison_id_team_id`, `uniq_spieler_id_saison_id`).

## Decision

**Resource-first URLs, with the id in the path.** `PATCH /api/v0/spielorte/{spielort_id}`. The
`/api/v0/admin/*` prefix no longer exists.

**Two routers per slice.** `router.py` holds the reads and declares
`dependencies=[Depends(verify_access_base)]`; `admin_router.py` holds the writes and declares
`dependencies=[Depends(verify_access_admin)]`. Neither guard appears on an individual endpoint. Verified
on FastAPI 0.138: a router's `dependencies` apply to every route it carries, so an endpoint reaches the
wrong authorization only by being written in the wrong **file** — a mistake that is visible at the top
of the diff rather than absent from the middle of it.

**Junction rows nest under the entity, addressed by their natural key.**
`/teams/{team_id}/saisons/{saison_id}` and `/spieler/{spieler_id}/saisons/{saison_id}`. The path is
exactly the collection's unique index, so an ambiguous write cannot be expressed.

**The `saisons` segment there addresses a junction row, not a season document.** It is named for what it
points at rather than what it is, which is a real if minor naming smell, accepted because the natural-key
property above is worth more than the name. A season document lives at `/saisons/{saison_id}` and
belongs to no team. **If a `GET` is ever added under either junction path, it must return junction
rows.**

**`GET /{id}` exists on all seven resources**, so every resource is addressable the same way whether or
not anything currently reads it that way.

**One team shape, no `compact` variant.** `GET /teams` returns one projection. Measured 2026-08-02, a
reduced variant trims **26.1 KiB across all 17 teams** — on responses the frontend caches for days, over
a container-local network — and no query work at all, because both `$lookup` stages run either way.

## Consequences

**Adding a write means adding a file to a slice, not a section to a shared module.** The per-slice
checklist that falls out of this is: schemas → `admin_router.py` → the slice's single read → confirm
against the inventory. The last step is not optional — the first pass through seven slices skipped the
single read on `schiedsrichter` and nothing noticed until the inventory was walked.

**`app.openapi()["paths"]` is the inventory, and `app.routes` is not.** FastAPI 0.138 does not flatten
included routes into `app.routes`; they sit behind `_IncludedRouter`. Anything that wants to assert a
property of every operation — such as `tests/api/test_admin_guard.py`, which asserts that every non-GET
operation is admin-guarded — has to walk the OpenAPI document.

**Two literal paths coexist with parameterised siblings across router boundaries**, and each is handled
differently because the ids differ. `GET /spiele/action_required` is protected by the `objectid` path
convertor in `app/core/routing.py`, which makes the literal unmatchable by `{spiel_id}` regardless of
include order. `/saisons/current` cannot use it — a season id is a four-character string — so it stays
declared **before** `/saisons/{saison_id}` in the same router.

**A malformed ObjectId in a path is a 404, not a 422.** `/spiele/not-an-id` matches no route at all,
which is the honest answer.

**`DuplicateKeyError` became a real error code.** Unique-index collisions were an unhandled 500 when
nothing could write; with seven create endpoints they are ordinary, and a dedicated handler maps them to
**409**.

**The frontend's mutation URLs, the compact team schema and its adapter all changed in the same
change.** That is the cost of the rename, paid once.

## Alternatives considered

**Keep one admin router and only fix the URLs.** Rejected: it fixes the addressing and leaves the
per-endpoint guard, which is the failure with no symptom. At 50 operations the file would also import
from every slice, which is the dependency shape a slice layout exists to avoid.

**One router per slice, with the guard on each write endpoint.** The smaller diff, and it is what the
old code did at a smaller scale. Rejected because the property being bought here is exactly that the
guard cannot be forgotten. A test asserting that every non-GET operation is guarded was written anyway —
but a test that catches the mistake is weaker than a layout in which the mistake has nowhere to happen,
and having both costs nothing.

**Flat junction collections — `/saison-teams/{id}`.** Rejected: the client would need the junction row's
own ObjectId, which nothing hands it. It has a team and a season; the natural key is what it can
actually address.

**`/saisons/{saison_id}/teams/{team_id}`, season-first.** Genuinely defensible, and rejected on where
the write path's reads already are: an admin editing a club is on the club, and the junction fields
(`gruppe`, `is_disqualified`) read as attributes _of the team within a season_. Season-first would also
put the season document and the junction under the same first segment, which is the confusion the
accepted shape at least keeps to one segment.

**Keep the `compact` team shape.** Rejected on the measurement above: 26.1 KiB of cached response, no
query saved, in exchange for a second hand-mirrored Pydantic/Zod model pair — the drift risk F2 exists
to warn about. It also lacked `gruppe`, so callers that wanted the small shape and the group had to ask
for the full one anyway.
