"""
SAISONS · write endpoints

Creating a season, editing its dates and rules, and the rollover. The guard is router-level, so
every endpoint added here is admin-guarded by construction (ADR-0034) — never move it onto one.

Invariants:
- Exactly one season is `active`; `activate_saison` is the only writer of `status` (ADR-0033).
- There is no DELETE — retiring a season would orphan every spiel, spieltag and junction row.
- A created season is always `future`, so a typo in a new id cannot roll over the live one.

See:
- docs/backend/spec.md — section 3, the write path
"""

from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument

from app.api.saisons.cache import invalidate_saison_cache
from app.api.saisons.schemas import (
    FLActivateSaisonResponse,
    FLPatchSaisonPayload,
    FLPatchSaisonResponse,
    FLPostSaisonPayload,
    FLPostSaisonResponse,
    FLSaison,
    FLSaisonRules,
)
from app.api.saisons.services import find_activation_refusal, find_rules_refusal, find_saison_span_refusal, unplayed_spiel_nrs, with_schedule
from app.api.spiele.schemas import FLSpielListAdapter
from app.core.config import API_VERSION
from app.core.crud import patch_many_in_db, patch_one_in_db, post_one_to_db, pull_many_from_db, pull_one_from_db
from app.core.dependencies import DBClient, SaisonsCollection, SaisonTeamsCollection, SpieleCollection, SpieltageCollection
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
from app.core.security import verify_access_admin

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/saisons",
    dependencies=[Depends(verify_access_admin)],
)


@router.post("", response_model=FLPostSaisonResponse, status_code=201, summary="Create a Saison")
async def post_saison(
    saison_data: Annotated[FLPostSaisonPayload, Body()],
    saisons_collection: SaisonsCollection,
) -> FLPostSaisonResponse:
    """
    Create a season. It is always created `future` and never `active`.

    The id is supplied rather than generated: `saisons._id` is the four-character season string that
    every `saison_id` elsewhere in the database references. Reusing an existing one is refused by the
    `_id` index and comes back as a 409.

    Making it live is a separate, deliberate step — `POST /saisons/{saison_id}/activate`.

    The rules are refused if they describe a competition with no bracket — `number_of_groups x
    qualifiers_per_group` has to be a power of two the phase set can hold (`REQ-RULES-001`, ADR-0065).
    None of the other four rules can apply to a season that has no teams and no fixtures yet.
    """

    refusal = find_rules_refusal(
        saison_status="future",
        stored=None,
        proposed=saison_data.rules,
        occupancy_by_gruppe={},
        highest_wired_platz=0,
    )
    if refusal is not None:
        error_code, detail = refusal
        raise DocumentConflictException(error_code=error_code, message=detail)

    post_operation = await post_one_to_db(
        collection=saisons_collection,
        # `_id` rather than `id`: this payload's `id` IS the document key, and the read model reads it
        # back through a `_id` validation alias.
        document={**saison_data.model_dump(mode="json", exclude={"id"}), "_id": saison_data.id, "status": "future"},
    )

    # A created season is `future`, so no cached answer is strictly wrong yet -- dropped anyway,
    # because "every season write drops the cache" is a rule worth keeping unconditional (ADR-0070).
    invalidate_saison_cache()

    return FLPostSaisonResponse(
        acknowledged=1 if post_operation.acknowledged else 0,
        created_id=str(post_operation.inserted_id),
    )


@router.patch("/{saison_id}", response_model=FLPatchSaisonResponse, summary="Update a Saison's dates and rules")
async def patch_saison(
    saison_id: str,
    saison_data: Annotated[FLPatchSaisonPayload, Body()],
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spiele_collection: SpieleCollection,
    spieltage_collection: SpieltageCollection,
) -> FLPatchSaisonResponse:
    """
    Update a season's dates and scoring rules. `status` is deliberately not part of the payload.

    Editing `rules.win_points` or `draw_points` changes **every league table for this season on the
    next read** — the standings are derived from the matches rather than stored (ADR-0026), so there is
    no migration to run and equally nothing to announce that the numbers moved. Which is exactly why a
    `past` season freezes them: `REQ-RULES-005` refuses the edit rather than silently rewriting who won a
    finished competition.

    **Seven refusals, and five of them read the season's own data** (ADR-0065, docs/domain.md). The rules
    decide the shape of the competition, so narrowing one below what already exists strands it: a group the
    season stops running while teams are still entered in it, a group left over its own capacity, a bracket
    slot naming a placing that can no longer be reached, or a matchday left holding more fixtures than its
    phase accounts for. The DATES obey the same principle (`REQ-DATE-004`): a span cannot shrink below a
    live matchday's own, which is `REQ-DATE-002`'s containment refused from the container's side. Each of
    those states is legal at every layer and invisible until something downstream reads it.
    """

    stored_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id})

    # Group occupancy, disqualified rows included: a team never leaves a season (ADR-0033), so its place
    # stays taken and a narrowing has to account for it.
    occupancy: dict[Any, int] = {}
    async for row in saison_teams_collection.find({"saison_id": saison_id}, {"gruppe": 1}):
        gruppe = row.get("gruppe")
        if gruppe is not None:
            occupancy[gruppe] = occupancy.get(gruppe, 0) + 1

    # The highest group placing any of this season's bracket slots names. Read from both sides, because a
    # `quelle` sits on either (ADR-0042), and 0 where the season has no group-seeded slot at all.
    highest_platz = 0
    async for spiel in spiele_collection.find(
        {"saison_id": saison_id, "$or": [{"team1_quelle.type": "gruppe"}, {"team2_quelle.type": "gruppe"}]},
        {"team1_quelle": 1, "team2_quelle": 1},
    ):
        for side in ("team1_quelle", "team2_quelle"):
            quelle = spiel.get(side)
            if isinstance(quelle, dict) and quelle.get("type") == "gruppe":
                highest_platz = max(highest_platz, int(quelle.get("platz", 0)))

    # The fullest matchday of each phase, by attached fixtures. The MAXIMUM rather than the total, because
    # the expected count these rules imply is per matchday -- and one matchday over its phase's count is
    # what `REQ-RULES-006` refuses, whatever its neighbours hold. Keyed on the matchday's phase rather than
    # the fixture's: the two can disagree, and it is the matchday whose count is being checked.
    attached_by_phase: dict[Any, int] = {}
    phase_of_spieltag: dict[Any, Any] = {}
    async for spieltag in spieltage_collection.find({"saison_id": saison_id}, {"saison_phase": 1}):
        phase_of_spieltag[spieltag["_id"]] = spieltag["saison_phase"]

    per_spieltag: dict[Any, int] = {}
    async for spiel in spiele_collection.find({"saison_id": saison_id}, {"spieltag_id": 1}):
        per_spieltag[spiel["spieltag_id"]] = per_spieltag.get(spiel["spieltag_id"], 0) + 1
    for spieltag_id, attached in per_spieltag.items():
        phase = phase_of_spieltag.get(spieltag_id)
        # A fixture pointing at a matchday of another season, or at none at all, is not this rule's
        # business -- there is no matchday here whose count it could exceed.
        if phase is not None:
            attached_by_phase[phase] = max(attached_by_phase.get(phase, 0), attached)

    refusal = find_rules_refusal(
        saison_status=str(stored_raw["status"]),
        # Validated rather than read raw, so a season document still missing a rules key fails loudly here
        # instead of being compared against a default nobody chose (ADR-0043's rule).
        stored=FLSaisonRules.model_validate(stored_raw["rules"]),
        proposed=saison_data.rules,
        occupancy_by_gruppe=occupancy,
        highest_wired_platz=highest_platz,
        attached_by_phase=attached_by_phase,
    )
    if refusal is not None:
        error_code, detail = refusal
        raise DocumentConflictException(error_code=error_code, message=detail)

    # The span, against the season's own matchdays (`REQ-DATE-004`). Retired ones are excluded: retiring
    # is how a mis-dated matchday leaves the schedule, so one must not block the repair of the dates it
    # was retired over. The mirror of `REQ-DATE-002`, which refuses the same containment from the
    # matchday's side.
    spieltag_spans = [
        (str(row["beginn"]), str(row["ende"]))
        async for row in spieltage_collection.find({"saison_id": saison_id, "inactive_since": None}, {"beginn": 1, "ende": 1})
    ]
    span_refusal = find_saison_span_refusal(
        start_date=saison_data.start_date,
        end_date=saison_data.end_date,
        spieltag_spans=spieltag_spans,
    )
    if span_refusal is not None:
        error_code, detail = span_refusal
        raise DocumentConflictException(error_code=error_code, message=detail)

    updated_document_raw = await patch_one_in_db(
        collection=saisons_collection,
        filter={"_id": saison_id},
        update={"$set": saison_data.model_dump(mode="json")},
        return_document=ReturnDocument.AFTER,
    )
    if updated_document_raw is None:
        raise DocumentNotFoundException(filter={"_id": saison_id}, error_code="DB-COMMON-001")

    # After the write has landed: the cached copy of this season -- and of "current", if this is the
    # running season -- now describes rules or dates the database no longer holds (ADR-0070).
    invalidate_saison_cache()

    return FLPatchSaisonResponse(updated_document=FLSaison.model_validate(with_schedule(updated_document_raw)))


@router.post("/{saison_id}/activate", response_model=FLActivateSaisonResponse, summary="Make this the active Saison")
async def activate_saison(
    saison_id: str,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    db: DBClient,
) -> FLActivateSaisonResponse:
    """
    Make this the active season, moving whichever season currently holds `active` to `past`.

    This is the **only** path to `status: "active"` — no other endpoint writes the field, so "exactly
    one active season" holds by construction rather than by convention. `pull_current_saison` and every
    endpoint defaulting an omitted `saison_id` (ADR-0002) depend on it.

    Both writes run in one transaction, so the league is never briefly without an active season and
    never briefly with two.

    **The outgoing season has to be finished** (`REQ-ACTIVATE-001`, decided 2026-08-08). Demoting it to
    `past` freezes its competitive rules and makes its derived table the record of what happened, so
    rolling over across unplayed fixtures closes a competition that is not over. Entering the missing
    results or cancelling the fixtures is the way through; cancelling is what turns a match nobody will
    play into a settled one.
    """

    # A read first, so a bad id is a 404 rather than a rollover that deactivates the live season and
    # then promotes nothing. Inside the transaction it would roll back, but the ordering makes the
    # failure legible without relying on that.
    target_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id})

    # The incumbent's own fixtures, read BEFORE the transaction: this refuses rather than writes, so
    # there is nothing to roll back and a 409 needs no session. `$ne` on the target for the reason the
    # demotion below uses it -- re-activating the current season must not be blocked by its own fixtures.
    outgoing = await pull_many_from_db(
        collection=saisons_collection,
        db_filter={"status": "active", "_id": {"$ne": saison_id}},
        projection={"_id": 1},
    )
    outgoing_ids = [row["_id"] for row in outgoing]
    if outgoing_ids:
        unplayed = unplayed_spiel_nrs(
            FLSpielListAdapter.validate_python(
                await pull_many_from_db(collection=spiele_collection, db_filter={"saison_id": {"$in": outgoing_ids}})
            )
        )
        refusal = find_activation_refusal(outgoing_unplayed=unplayed)
        if refusal is not None:
            error_code, detail = refusal
            raise DocumentConflictException(error_code=error_code, message=detail)

    async with await db.start_session() as session:
        async with session.start_transaction():
            # `update_many`, not `update_one`: if the database has somehow ended up with two active
            # seasons, this is the operation that repairs it rather than preserving one of them.
            # `$ne` on the target so re-activating the current season is a no-op instead of demoting
            # the very row it is about to promote.
            demoted = await patch_many_in_db(
                collection=saisons_collection,
                filter={"status": "active", "_id": {"$ne": saison_id}},
                update={"$set": {"status": "past"}},
                session=session,
            )

            activated_raw = await patch_one_in_db(
                collection=saisons_collection,
                filter={"_id": saison_id},
                update={"$set": {"status": "active"}},
                session=session,
                return_document=ReturnDocument.AFTER,
            )

    # Outside the transaction blocks, so the drop happens only once the commit has: an aborted
    # rollover leaves the database unchanged and the cache with nothing to unlearn. This write is the
    # one that moves WHICH season "current" names, which is the entry the cache exists for (ADR-0070).
    invalidate_saison_cache()

    # The read above already proved the row exists, so this is a type narrowing rather than a branch
    # anything is expected to reach.
    activated = FLSaison.model_validate(with_schedule(activated_raw if activated_raw is not None else target_raw))

    return FLActivateSaisonResponse(updated_document=activated, deactivated=demoted.modified_count)
