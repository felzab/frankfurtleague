"""
SAISONS · write endpoints

Creating a season, editing its dates and rules, the rollover, and the group swap. The guard is
router-level, so every endpoint added here is admin-guarded by construction (ADR-0027) — never move
it onto one.

Invariants:
- Exactly one season is `active`; `activate_saison` is the only writer of `status` (ADR-0026).
- There is no DELETE — retiring a season would orphan every spiel, spieltag and junction row.
- A created season is always `future`, so a typo in a new id cannot roll over the live one.
- A group swap writes both junction rows or neither — one transaction, never two calls (ADR-0062).

See:
- docs/backend/spec.md — section 1.1, the season write endpoints
"""

from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from motor.motor_asyncio import AsyncIOMotorClientSession
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
    FLSwapGruppenPayload,
    FLSwapGruppenResponse,
)
from app.api.saisons.services import find_activation_refusal, find_rules_refusal, find_saison_span_refusal, unplayed_spiel_nrs, with_schedule
from app.api.spiele.schemas import KNOCKOUT_PHASES, FLSpielListAdapter
from app.api.teams.services import find_gruppe_swap_refusal
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
    qualifiers_per_group` has to be a power of two the phase set can hold (`REQ-RULES-001`, ADR-0052),
    and `REQ-RULES-007` refuses more qualifiers than a group holds. Every other rule reads stored data,
    which a season with no teams and no fixtures has none of.
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
    # because "every season write drops the cache" is a rule worth keeping unconditional (ADR-0056).
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
    next read** — the standings are derived from the matches rather than stored (ADR-0019), so there is
    no migration to run and equally nothing to announce that the numbers moved. Which is exactly why a
    `past` season freezes them: `REQ-RULES-005` refuses the edit rather than silently rewriting who won a
    finished competition.

    **Most of these refusals read the season's own data** (ADR-0052, docs/domain.md). The rules
    decide the shape of the competition, so narrowing one below what already exists strands it: a group the
    season stops running while teams are still entered in it, a group left over its own capacity, a bracket
    slot naming a placing that can no longer be reached, or a matchday left holding more fixtures than its
    phase accounts for. The DATES obey the same principle (`REQ-DATE-004`): a span cannot shrink below a
    live matchday's own, which is `REQ-DATE-002`'s containment refused from the container's side. Each of
    those states is legal at every layer and invisible until something downstream reads it.
    """

    stored_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id})

    # Group occupancy, disqualified rows included: a team never leaves a season (ADR-0026), so its place
    # stays taken and a narrowing has to account for it.
    occupancy: dict[Any, int] = {}
    async for row in saison_teams_collection.find({"saison_id": saison_id}, {"gruppe": 1}):
        gruppe = row.get("gruppe")
        if gruppe is not None:
            occupancy[gruppe] = occupancy.get(gruppe, 0) + 1

    # The highest group placing any of this season's bracket slots names. Read from both sides, because a
    # `quelle` sits on either (ADR-0034), and 0 where the season has no group-seeded slot at all.
    highest_platz = 0
    async for spiel in spiele_collection.find(
        {"saison_id": saison_id, "$or": [{"team1_quelle.type": "gruppe"}, {"team2_quelle.type": "gruppe"}]},
        {"team1_quelle": 1, "team2_quelle": 1},
    ):
        for side in ("team1_quelle", "team2_quelle"):
            quelle = spiel.get(side)
            if isinstance(quelle, dict) and quelle.get("type") == "gruppe":
                highest_platz = max(highest_platz, int(quelle.get("platz", 0)))

    # The fullest matchday of each phase, not the total: the expected count is per matchday, and one
    # matchday over its phase's count is what `REQ-RULES-006` refuses. Keyed on the matchday's phase
    # rather than the fixture's, which can disagree.
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
        # instead of being compared against a default nobody chose (ADR-0035's rule).
        stored=FLSaisonRules.model_validate(stored_raw["rules"]),
        proposed=saison_data.rules,
        occupancy_by_gruppe=occupancy,
        highest_wired_platz=highest_platz,
        attached_by_phase=attached_by_phase,
    )
    if refusal is not None:
        error_code, detail = refusal
        raise DocumentConflictException(error_code=error_code, message=detail)

    # The span, against the season's own matchdays (`REQ-DATE-004`). Retired ones are excluded:
    # retiring is how a mis-dated matchday leaves the schedule, so one must not block the repair of
    # the dates it was retired over.
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
    # running season -- now describes rules or dates the database no longer holds (ADR-0056).
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

    # The incumbent's own fixtures, read before the transaction: this refuses rather than writes, so a
    # 409 needs no session. `$ne` on the target, so re-activating the current season is not blocked by
    # its own fixtures.
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
            # `update_many`, not `update_one`: a database holding two active seasons is repaired here
            # rather than half-preserved. `$ne` on the target, so re-activating the current season is
            # a no-op instead of demoting the row it is about to promote.
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
    # rollover leaves the cache nothing to unlearn. This write moves which season "current" names,
    # the entry the cache exists for (ADR-0056).
    invalidate_saison_cache()

    # The read above already proved the row exists, so this is a type narrowing rather than a branch
    # anything is expected to reach.
    activated = FLSaison.model_validate(with_schedule(activated_raw if activated_raw is not None else target_raw))

    return FLActivateSaisonResponse(updated_document=activated, deactivated=demoted.modified_count)


@router.post("/{saison_id}/gruppen/swap", response_model=FLSwapGruppenResponse, summary="Exchange two teams' groups")
async def swap_gruppen(
    saison_id: str,
    swap_data: Annotated[FLSwapGruppenPayload, Body()],
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spiele_collection: SpieleCollection,
    db: DBClient,
) -> FLSwapGruppenResponse:
    """
    Exchange the groups of two clubs entered in this season, as one write.

    **The one mid-season group change that is defensible** (ADR-0062). A group decides which table counts
    a club's results and which bracket slot its placing seeds (ADR-0035), so moving a single club
    falsifies both; two clubs exchanging keeps each group's size and leaves every drawn fixture facing
    the opponents it was drawn against.

    **On the season rather than on the club** (ADR-0027's grain): `PATCH /teams/{team_id}/saisons/{saison_id}`
    addresses one junction row, so a swap done there is two requests with a window between them in which
    one group is a club short and the other a club over — and a failure after the first leaves the season
    in that state with nothing to say so. Both rows are written in **one transaction**, so the season
    never holds half a swap.

    **Refused with a 409 unless the two ids name two clubs of this season standing in different groups**
    (`REQ-SWAP-001`). One club named twice, a club with no junction row, and two clubs of one group all
    describe something that is not a swap. The control offers only pairs that are one, so a request
    carrying any of them is stale or racing another admin, and reloading is the way past it.

    **Refused with a 409 of its own once the knockout rounds have begun** (`REQ-SWAP-002`) — any fixture
    outside the Gruppenphase carrying an `ergebnis`. By then the standings have been consumed by the
    seeding, so exchanging the groups behind a played bracket rewrites what its slots meant. That is a
    refusal and not a warning: there is no reading of it under which the swap is still defensible.

    **`REQ-ENTER-004`'s lock is deliberately not consulted.** It refuses a MOVE for a club whose fixtures
    are drawn, and its own message names a swap as the case that would be defensible — so this operation
    exists beside that lock rather than relaxing it. `disqualifikation` is untouched here: a swap changes
    where a club plays and nothing about whether it may.
    """

    # A read first, so an unknown season is a 404 rather than a 409 about two clubs holding no row in a
    # season nobody has (ADR-0057). Inside the transaction it would roll back either way; the ordering is
    # what makes the failure legible.
    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])

    async def exchange_the_two_gruppen(session: AsyncIOMotorClientSession) -> FLSwapGruppenResponse:
        """The whole swap: judge, then write both rows. Everything it decides on is read in-session."""

        # Read THROUGH the session, because these rows decide what is written: a retry after a write
        # conflict has to judge them as they are then, not as this request first saw them.
        rows = await pull_many_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "team_id": {"$in": [swap_data.team1_id, swap_data.team2_id]}},
            projection=["team_id", "gruppe"],
            session=session,
        )
        gruppe_of = {row["team_id"]: row["gruppe"] for row in rows}

        # Counted rather than listed: the rule asks whether the bracket has begun, and one played
        # knockout fixture answers it.

        # Straight on the collection, because no helper takes a session -- and without one this would
        # read the snapshot from before the transaction.
        played_knockout = await spiele_collection.count_documents(
            {"saison_id": saison_id, "saison_phase": {"$in": list(KNOCKOUT_PHASES)}, "ergebnis": {"$ne": None}},
            session=session,
        )

        refusal = find_gruppe_swap_refusal(
            is_same_team=swap_data.team1_id == swap_data.team2_id,
            team1_gruppe=gruppe_of.get(swap_data.team1_id),
            team2_gruppe=gruppe_of.get(swap_data.team2_id),
            played_knockout_fixtures=played_knockout,
        )
        if refusal is not None:
            error_code, detail = refusal
            raise DocumentConflictException(error_code=error_code, message=detail)

        # The refusal above proved both rows exist and hold different groups, so each club's target is
        # simply the other's current group.

        # Built BEFORE the writes and then written FROM, rather than assembled from them afterwards.

        # Two things follow: this model refuses a stored group outside the closed A-D set before anything
        # is written, and the echo cannot disagree with what landed -- it is the same object.
        swapped = FLSwapGruppenResponse(
            saison_id=saison_id,
            team1_id=swap_data.team1_id,
            team1_gruppe=gruppe_of[swap_data.team2_id],
            team2_id=swap_data.team2_id,
            team2_gruppe=gruppe_of[swap_data.team1_id],
        )

        for team_id, target_gruppe in ((swapped.team1_id, swapped.team1_gruppe), (swapped.team2_id, swapped.team2_gruppe)):
            written = await patch_one_in_db(
                collection=saison_teams_collection,
                filter={"saison_id": saison_id, "team_id": team_id},
                update={"$set": {"gruppe": target_gruppe}},
                session=session,
            )
            # `find_one_and_update` returns None only when nothing matched, so this is the 404 branch
            # rather than an error check -- and raising here aborts the transaction, taking the first
            # write back with it rather than leaving one group a club short.
            if written is None:
                raise DocumentNotFoundException(filter={"saison_id": saison_id, "team_id": team_id}, error_code="DB-COMMON-001")

        return swapped

    # `with_transaction` rather than a bare `start_transaction`, which is `patch_spiel_data`'s choice and
    # for its reason: two admins on one season can write-conflict here, and the callback re-reads
    # everything it judges on, so it is safe to retry.
    async with await db.start_session() as session:
        return await session.with_transaction(exchange_the_two_gruppen)
