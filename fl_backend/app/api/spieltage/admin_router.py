"""
SPIELTAGE · write endpoints

Matchdays: named blocks of fixtures inside a season. Guarded at router level by
`verify_access_admin` (ADR-0027).

Invariants:
- No payload carries a position and none may gain one — a matchday's place is derived (ADR-0051).
- Deletion is soft: `spiele.spieltag_id` points here and nothing cascades.
- Soft is not harmless — `REQ-RETIRE-002` refuses retiring a matchday holding a played match.
- Nor is reactivating — `REQ-DATE-002` refuses one whose span the season no longer covers.
- `anzahl_spiele` is derived (ADR-0052); `REQ-SPIELTAG-002` refuses a MOVE into a phase too small for it.
- A phase change is graded as a STEP, never as the state the row already sits in (ADR-0075).
- Every echo goes through `with_expected_matches`: the field is required and sits on no document.
"""

from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument

from app.api.saisons.schedule import expected_matches, implied_matchdays
from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import KNOCKOUT_PHASES
from app.api.spieltage.schemas import (
    FLPatchSpieltagPayload,
    FLPostSpieltagPayload,
    FLSpieltag,
    FLSpieltagWriteResponse,
)
from app.api.spieltage.services import (
    find_spieltag_boundary_refusal,
    find_spieltag_create_refusal,
    find_spieltag_phase_refusal,
    find_spieltag_retire_refusal,
    find_spieltag_span_refusal,
    find_spieltag_unplayed_phase_refusal,
    with_expected_matches,
)
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, post_one_to_db, pull_one_from_db
from app.core.dependencies import SaisonsCollection, SpieleCollection, SpieltageCollection, get_german_date_str
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieltage",
    dependencies=[Depends(verify_access_admin)],
)


@router.post("", response_model=FLSpieltagWriteResponse, status_code=201, summary="Create a Spieltag")
async def post_spieltag(
    spieltag_data: Annotated[FLPostSpieltagPayload, Body()],
    spieltage_collection: SpieltageCollection,
    saisons_collection: SaisonsCollection,
    today: str = Depends(get_german_date_str),
) -> FLSpieltagWriteResponse:
    """
    Create a matchday.

    Where it sits in the season follows from what it is: the phase in bracket order, then `beginn`. So a
    matchday created out of sequence is not a matchday in the wrong place — it is one whose phase or date
    is wrong, and correcting either moves it (ADR-0051). Its NAME follows from the same two facts, which is
    why the payload carries none (ADR-0051).

    **Three refusals.** The phase has to be one the season's rules actually produce
    (`REQ-SPIELTAG-004`, decided 2026-08-13) — a season sending eight teams into the bracket plays no
    round of sixteen, so an `achtelfinale` matchday there belongs to a round nobody plays. **That is a
    rule about WHICH phase and never about how many:** the matchday count a phase implies is a floor
    rather than a quota, because a round split across two dates is two matchdays for one phase
    (ADR-0051).

    A season whose knockout phase is already under way takes no new matchdays at all
    (`REQ-SPIELTAG-003`, decided 2026-08-08) — "under way" meaning its earliest non-group matchday begins
    today or began earlier, which is a date rather than a result. And the span has to sit inside the
    season's own (`REQ-DATE-002`).
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": spieltag_data.saison_id})
    rules = FLSaisonRules.model_validate(saison_raw["rules"])

    # The earliest non-group matchday's `beginn`, retired ones included: a retired knockout matchday is
    # still a date the bracket was scheduled to start on, and hiding it from a list does not un-start
    # the phase.
    earliest_knockout = await spieltage_collection.find_one(
        {"saison_id": spieltag_data.saison_id, "saison_phase": {"$in": list(KNOCKOUT_PHASES)}},
        {"beginn": 1},
        sort=[("beginn", 1)],
    )
    create_refusal = find_spieltag_create_refusal(
        implied_in_phase=implied_matchdays(rules, spieltag_data.saison_phase),
        saison_phase=spieltag_data.saison_phase,
        earliest_knockout_beginn=None if earliest_knockout is None else str(earliest_knockout["beginn"]),
        today=today,
    )
    if create_refusal is not None:
        error_code, detail = create_refusal
        raise DocumentConflictException(error_code=error_code, message=detail)

    # Then the span, which has to sit inside the season it names (`REQ-DATE-002`). A new matchday has no
    # fixtures, so the second half of that rule has nothing to check yet.
    span_refusal = find_spieltag_span_refusal(
        beginn=spieltag_data.beginn,
        ende=spieltag_data.ende,
        saison_start=str(saison_raw["start_date"]),
        saison_end=str(saison_raw["end_date"]),
        fixture_dates=[],
    )
    if span_refusal is not None:
        error_code, detail = span_refusal
        raise DocumentConflictException(error_code=error_code, message=detail)

    post_operation = await post_one_to_db(
        collection=spieltage_collection,
        document={**spieltag_data.model_dump(mode="json"), "inactive_since": None},
    )

    return FLSpieltagWriteResponse(
        acknowledged=1 if post_operation.acknowledged else 0,
        spieltag_id=post_operation.inserted_id,
    )


@router.patch(by_id("spieltag_id"), response_model=FLSpieltagWriteResponse, summary="Update a Spieltag")
async def patch_spieltag(
    spieltag_id: CustomRouteObjectId,
    spieltag_data: Annotated[FLPatchSpieltagPayload, Body()],
    spieltage_collection: SpieltageCollection,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
) -> FLSpieltagWriteResponse:
    """
    Update a matchday.

    No fan-out: matches reference a matchday by id and embed no copy of it, so a renamed or re-dated
    matchday is picked up by every consumer on the next read.

    **A phase accounting for fewer matches than the matchday already holds is refused**
    (`REQ-SPIELTAG-002`, ADR-0052). A single round robin per group fixes that number, so moving a matchday
    of eight group fixtures into a Finale would leave seven of them with nowhere to be played. The other
    direction -- fewer fixtures than expected -- is left alone, because that is every season part-way
    through being set up.

    **What that refuses is the MOVE, never the state.** A matchday already holding more fixtures than its
    phase accounts for got there from data this API never wrote (ADR-0037), and refusing a payload that
    repeats its own phase would cost it its dates as well, over a mismatch no edit here can repair. Moving
    one from that state into a narrower phase still is refused, because it makes the mismatch worse.

    **Two transitions are refused outright, whatever the counts say** (ADR-0075). A move into a round the
    season's rules never produce is `REQ-SPIELTAG-005`, the mirror of the create's `REQ-SPIELTAG-004`. And
    a matchday carrying fixtures may not cross the gruppenphase/knockout boundary away from them
    (`REQ-SPIELTAG-006`): the bracket selects rounds by the MATCHDAY's phase and fixtures by the
    FIXTURE's, and no endpoint writes `spiele.saison_phase`, so the move would strand every one of them
    with nothing able to repair it. **An EMPTY matchday crosses freely** — correcting a mislabelled row is
    the scheduling decision ADR-0052 kept editable.
    """

    stored_raw = await pull_one_from_db(collection=spieltage_collection, db_filter={"_id": spieltag_id})

    # The season's rules decide what the proposed phase accounts for, so the refusal needs both -- and
    # so does the echo, whose `anzahl_spiele` is derived from the phase this write may have just moved.
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": stored_raw["saison_id"]})
    rules = FLSaisonRules.model_validate(saison_raw["rules"])

    attached = await spiele_collection.count_documents({"spieltag_id": spieltag_id})

    # Split by the FIXTURE's own `saison_phase`, which this endpoint never writes and which need not
    # agree with its matchday's -- so the transition rule can tell a move away from the fixtures from a
    # move towards them (ADR-0075).
    attached_knockout = await spiele_collection.count_documents({"spieltag_id": spieltag_id, "saison_phase": {"$in": list(KNOCKOUT_PHASES)}})
    on_group_side = attached - attached_knockout
    stored_phase = stored_raw["saison_phase"]

    # First of the three phase rules, matching how the create orders `REQ-SPIELTAG-004`: a round the
    # season never plays is wrong whatever the matchday holds (ADR-0075).
    unplayed_refusal = find_spieltag_unplayed_phase_refusal(
        stored_phase=stored_phase,
        proposed_phase=spieltag_data.saison_phase,
        implied_in_proposed=implied_matchdays(rules, spieltag_data.saison_phase),
    )
    if unplayed_refusal is not None:
        error_code, detail = unplayed_refusal
        raise DocumentConflictException(error_code=error_code, message=detail)

    refusal = find_spieltag_phase_refusal(
        attached_count=attached,
        expected_count=expected_matches(rules, spieltag_data.saison_phase),
        # The stored phase's own figure, so the refusal judges the STEP: a payload repeating the phase the
        # matchday already holds compares equal and is a dates-only edit, whatever the fixture count is.
        expected_in_stored_phase=expected_matches(rules, stored_raw["saison_phase"]),
    )
    if refusal is not None:
        error_code, detail = refusal
        raise DocumentConflictException(error_code=error_code, message=detail)

    # Last of the three, because it is the widest statement: the count rule above names two numbers an
    # admin can compare, where this one is about the join the whole bracket is drawn from (ADR-0075).
    boundary_refusal = find_spieltag_boundary_refusal(
        stored_phase=stored_phase,
        proposed_phase=spieltag_data.saison_phase,
        fixtures_on_stored_side=on_group_side if stored_phase == "gruppenphase" else attached_knockout,
        fixtures_on_proposed_side=on_group_side if spieltag_data.saison_phase == "gruppenphase" else attached_knockout,
    )
    if boundary_refusal is not None:
        error_code, detail = boundary_refusal
        raise DocumentConflictException(error_code=error_code, message=detail)

    # The span, against the season above and against this matchday's own fixtures. Undated fixtures are
    # filtered out rather than passed as nulls: one constrains nothing, and a season being scheduled is
    # full of them.
    fixture_dates = [
        str(row["datum"]) async for row in spiele_collection.find({"spieltag_id": spieltag_id, "datum": {"$ne": None}}, {"datum": 1})
    ]
    span_refusal = find_spieltag_span_refusal(
        beginn=spieltag_data.beginn,
        ende=spieltag_data.ende,
        saison_start=str(saison_raw["start_date"]),
        saison_end=str(saison_raw["end_date"]),
        fixture_dates=fixture_dates,
    )
    if span_refusal is not None:
        error_code, detail = span_refusal
        raise DocumentConflictException(error_code=error_code, message=detail)

    updated_raw = await patch_one_in_db(
        collection=spieltage_collection,
        filter={"_id": spieltag_id},
        update={"$set": spieltag_data.model_dump(mode="json")},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"_id": spieltag_id}, error_code="DB-COMMON-001")

    return FLSpieltagWriteResponse(
        spieltag_id=spieltag_id,
        updated_document=FLSpieltag.model_validate(with_expected_matches(updated_raw, rules)),
    )


@router.delete(by_id("spieltag_id"), response_model=FLSpieltagWriteResponse, summary="Retire a Spieltag (soft delete)")
async def delete_spieltag(
    spieltag_id: CustomRouteObjectId,
    spieltage_collection: SpieltageCollection,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    today: str = Depends(get_german_date_str),
) -> FLSpieltagWriteResponse:
    """
    Retire a matchday. SOFT: it stamps `inactive_since` and the document stays.

    Its matches are **not** touched and stay resolvable — `GET /spiele` never joins `spieltage`. That is
    the reason this is soft rather than a delete: a hard one would leave every one of those matches
    pointing at nothing.

    **It is refused while any of them carries a result** (`REQ-RETIRE-002`, decided 2026-08-08). Resolvable
    is not the same as visible: a retired matchday leaves `GET /spieltage`, and the public Spielplan joins
    fixtures onto the matchdays it received — so this retirement takes played results off that page. An
    unplayed matchday retires freely, which is the one somebody created by mistake.

    **And it is refused while the phase would drop below the count its rules imply** (`REQ-RETIRE-005`,
    decided 2026-08-13). Until this existed a season could be emptied of a phase it still had to play,
    one unplayed matchday at a time, with nothing anywhere to refuse a single step. The derived figure
    is a **floor, never a ceiling** — a phase may hold more rows than the rules imply, because a round
    split across two dates is two matchdays (ADR-0051) — so a phase above the floor retires back down
    to it and stops there. A phase already **below** the floor is not refused (`REQ-RETIRE-005`): no
    retirement put it there, and the emptying above is still refused at its first step.

    **The floor governs this endpoint and `POST /spieltage`, and nothing watches `PATCH`**, which can
    move a row between phases and so change both counts from a side neither refusal sees.
    """

    # Both reads before the write, the season's for the echo's derived count alone. Ahead of the stamp
    # rather than after it, so a season this matchday cannot resolve is a 404 instead of a retirement
    # that landed and then answered with an error.
    stored_raw = await pull_one_from_db(collection=spieltage_collection, db_filter={"_id": spieltag_id})
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": stored_raw["saison_id"]})
    rules = FLSaisonRules.model_validate(saison_raw["rules"])

    played = await spiele_collection.count_documents({"spieltag_id": spieltag_id, "ergebnis": {"$ne": None}})

    # The phase's live rows as they stand, THIS matchday included -- the refusal subtracts it, so the
    # count passed in is the state before the retirement rather than after it.
    live_in_phase = await spieltage_collection.count_documents(
        {"saison_id": stored_raw["saison_id"], "saison_phase": stored_raw["saison_phase"], "inactive_since": None}
    )
    refusal = find_spieltag_retire_refusal(
        played_count=played,
        live_in_phase=live_in_phase,
        implied_in_phase=implied_matchdays(rules, stored_raw["saison_phase"]),
    )
    if refusal is not None:
        error_code, detail = refusal
        raise DocumentConflictException(error_code=error_code, message=detail)

    updated_raw = await patch_one_in_db(
        collection=spieltage_collection,
        filter={"_id": spieltag_id},
        update={"$set": {"inactive_since": today}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"_id": spieltag_id}, error_code="DB-COMMON-001")

    return FLSpieltagWriteResponse(
        spieltag_id=spieltag_id,
        updated_document=FLSpieltag.model_validate(with_expected_matches(updated_raw, rules)),
    )


@router.post(f"{by_id('spieltag_id')}/reactivate", response_model=FLSpieltagWriteResponse, summary="Bring a retired Spieltag back")
async def reactivate_spieltag(
    spieltag_id: CustomRouteObjectId,
    spieltage_collection: SpieltageCollection,
    saisons_collection: SaisonsCollection,
) -> FLSpieltagWriteResponse:
    """
    Clear `inactive_since`, restoring the matchday to every read that hides retired ones.

    **The span is checked on the way back in** (`REQ-DATE-002`). While the matchday was retired the
    season's dates were free to move past it: `PATCH /saisons/{saison_id}` reads only LIVE matchdays for
    `REQ-DATE-004`, deliberately, so that retiring a mis-dated matchday is what lets the dates it was
    retired over be repaired. Restoring it is therefore the moment the containment has to hold again, and
    the way through is to re-date the matchday first.

    Its own fixtures need no check here. `spieltag_id` is on no payload and `REQ-DATE-001` reads this
    matchday whether or not it is retired, so no fixture can have drifted outside the span meanwhile.
    """

    stored_raw = await pull_one_from_db(collection=spieltage_collection, db_filter={"_id": spieltag_id})
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": stored_raw["saison_id"]})
    rules = FLSaisonRules.model_validate(saison_raw["rules"])

    span_refusal = find_spieltag_span_refusal(
        beginn=str(stored_raw["beginn"]),
        ende=str(stored_raw["ende"]),
        saison_start=str(saison_raw["start_date"]),
        saison_end=str(saison_raw["end_date"]),
        fixture_dates=[],
    )
    if span_refusal is not None:
        error_code, detail = span_refusal
        raise DocumentConflictException(error_code=error_code, message=detail)

    updated_raw = await patch_one_in_db(
        collection=spieltage_collection,
        filter={"_id": spieltag_id},
        update={"$set": {"inactive_since": None}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"_id": spieltag_id}, error_code="DB-COMMON-001")

    return FLSpieltagWriteResponse(
        spieltag_id=spieltag_id,
        updated_document=FLSpieltag.model_validate(with_expected_matches(updated_raw, rules)),
    )
