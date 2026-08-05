"""
SPIELE · write endpoints, and the one admin-only read

Every mutation sits beside the reads for the resource it changes, in a second router whose guard is
`verify_access_admin` (ADR-0034).

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `verify_access_admin` is attached at ROUTER level, so every endpoint added here is guarded by
    construction. Never move the guard onto an individual endpoint.
  • `ergebnis` is DERIVED from the two `tore` values and is never accepted from the client. A fixture
    with an unresolved side has no goals to derive from and therefore no result (ADR-0041).
  • The payload is written wholesale with `$set`, so a field absent from it is overwritten rather than
    preserved. That is why the money fields carry no Pydantic default.
  • `patch_spiel_data` writes NO team document. Team statistics are derived from the matches on read
    (ADR-0026), so there is no second write to keep in step and no team to look up here. It does write
    other MATCH documents: entering a result resolves the season's bracket, which moves winners into
    the fixtures whose `quelle` names that match (ADR-0042).

 WHY `/action_required` DOES NOT COLLIDE WITH `/{spiel_id}` ────────────────────────────────────────────────

  They are the same path shape at the same depth, in two routers with different authorization -- so
  declaration order cannot separate them. The `objectid` convertor does: `GET /spiele/{spiel_id}` in
  `router.py` matches only 24 hex characters, so "action_required" is not a candidate for it and routing
  reaches this endpoint whatever order the routers are included in. See `app/core/routing.py`.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/backend/spec.md -- section 3, the write path step by step
"""

from typing import Annotated

from fastapi import APIRouter, Body, Depends

from app.api.saisons.crud import pull_saison_id_and_rules
from app.api.spiele.crud import advance_bracket_winners
from app.api.spiele.schemas import (
    FLPatchSpielDataPayload,
    FLPatchSpielDataResponse,
    FLSpieleListResponse,
    FLSpielListAdapter,
)
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, pull_many_from_db
from app.core.dependencies import DBClient, SaisonsCollection, SpieleCollection, TeamsCollection, get_german_date_str
from app.core.exceptions import DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spiele",
    dependencies=[Depends(verify_access_admin)],
)


@router.get("/action_required", response_model=FLSpieleListResponse, summary="Spiele needing attention")
async def get_spiele_action_required(spiele_collection: SpieleCollection, today: str = Depends(get_german_date_str)) -> FLSpieleListResponse:
    """
    List Spiele that need an admin's attention.

    A match qualifies if it is cancelled, is missing a date, time, venue or referee, or is in the past
    with no result recorded. Not season-filtered: it spans every season.

    Deliberately uncached on the frontend — admin-authorized data does not belong in a shared cache
    (ADR-0013).
    """

    # Fetch all games with either a missing attribute or games which have a date in the past but don't have a final score
    spiele_raw = await pull_many_from_db(
        collection=spiele_collection,
        db_filter={
            "$or": [
                {"is_canceled": True},
                {"datum": None},
                {"uhrzeit": None},
                {"ort": None},
                {"schiedsrichter": None},
                {"datum": {"$lt": today}, "ergebnis": None},
            ]
        },
    )
    spiele = FLSpielListAdapter.validate_python(spiele_raw)

    return FLSpieleListResponse(spiele=spiele)


@router.patch(by_id("spiel_id"), response_model=FLPatchSpielDataResponse, summary="Update a Spiel")
async def patch_spiel_data(
    spiel_id: CustomRouteObjectId,
    spiel_data: Annotated[FLPatchSpielDataPayload, Body()],
    db: DBClient,
    spiele_collection: SpieleCollection,
    teams_collection: TeamsCollection,
    saisons_collection: SaisonsCollection,
) -> FLPatchSpielDataResponse:
    """
    Update one Spiel, then resolve the season's playoff bracket.

    `ergebnis` is derived from the two `tore` values and must not be submitted. The payload is written
    wholesale, so every field must be present -- an omitted field is overwritten, not preserved.

    **A result can move fixtures other than this one.** The occupant of a slot referring to match 25 is
    the winner of match 25, so entering that match's result fills the slot, correcting it later moves
    the right team in, and deleting it empties the slot again (ADR-0042). A slot referring to a group
    placing is filled the same way, once no remaining fixture in that group can still change who holds
    it (ADR-0043). Every fixture written either way is named in `advanced_to`.

    `unresolvable_slots` names the group references that no further result can honour — a `platz` its
    group will never produce, and a placing the tiebreak chain cannot separate in a group that has
    finished. A group still being played is not reported: that placing is simply not decided yet.

    The league table follows on its own: team statistics are computed from the match documents by
    `GET /teams`, so a result entered here is reflected the next time that table is read.

    `saison_id` is deliberately not part of the payload: it is not declared on the model and Pydantic
    would discard it. The frontend passes it separately, for cache invalidation only.
    """

    # Read through both sides, either of which may be absent: a slot whose occupant is still unknown
    # has nobody to score, so an unresolved fixture derives no result at all rather than a partial one.
    both_sides_known = spiel_data.team1 is not None and spiel_data.team2 is not None
    team1_tore = spiel_data.team1.tore if spiel_data.team1 is not None else None
    team2_tore = spiel_data.team2.tore if spiel_data.team2 is not None else None
    updated_ergebnis_field = f"{team1_tore}:{team2_tore}" if both_sides_known and team1_tore is not None and team2_tore is not None else None

    document = spiel_data.model_dump(context={"keep_oid": True})

    # Clearing one side drops the result, so the goals the OTHER side still carries would be stored
    # against a fixture that has none -- the hand-edited shape `build_statistik_lookup_stage` restates
    # its `team1.tore` filter to survive. Written here rather than left to the form: the payload is
    # $set wholesale, so this is the only place that sees both sides at once.
    if not both_sides_known:
        for slot in ("team1", "team2"):
            if document.get(slot) is not None:
                document[slot]["tore"] = None

    # The transaction is what makes the result and the advancement it causes one fact: a bracket that
    # resolved against a result the caller never committed would be worse than one that did not resolve.
    async with await db.start_session() as session:
        async with session.start_transaction():
            patched_spiel_raw = await patch_one_in_db(
                collection=spiele_collection,
                filter={"_id": spiel_id},
                update={"$set": {**document, "ergebnis": updated_ergebnis_field}},
                session=session,
            )
            # `find_one_and_update` returns None only when nothing matched, so this is the 404 branch
            # rather than an error check.
            if patched_spiel_raw is None:
                raise DocumentNotFoundException(
                    filter={"_id": spiel_id},
                    error_code="DB-COMMON-001",
                )

            # The season scopes the bracket below, and it is read off the document `patch_one_in_db`
            # returns -- the pre-image, which is the helper's default (spec I2). Safe here and only
            # here: `saison_id` is on no payload, so the `$set` above cannot have changed it.
            saison_id = str(patched_spiel_raw["saison_id"])

            # The season's own scoring, which the standing behind a `gruppe` reference is derived with,
            # exactly as `GET /teams` derives the table (ADR-0026). Not read through the session: this
            # transaction writes no season document, so there is nothing of its own to see.
            _, saison_rules = await pull_saison_id_and_rules(saisons_collection=saisons_collection, saison_id=saison_id)

            advanced_to, unresolvable_slots = await advance_bracket_winners(
                spiele_collection=spiele_collection,
                teams_collection=teams_collection,
                saison_id=saison_id,
                rules=saison_rules,
                session=session,
            )

    return FLPatchSpielDataResponse(advanced_to=advanced_to, unresolvable_slots=unresolvable_slots)
