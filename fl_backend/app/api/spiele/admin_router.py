"""
SPIELE · write endpoints, and the one admin-only read

Every mutation sits beside the reads for the resource it changes, in a second router whose guard is
`verify_access_admin` (ADR-0034).

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `verify_access_admin` is attached at ROUTER level, so every endpoint added here is guarded by
    construction. Never move the guard onto an individual endpoint.
  • There is NO POST and NO DELETE here, and neither is to be added (ADR-0045). A season's fixtures are
    all created at its start; a match is thereafter CANCELLED (`is_canceled`) or MOVED (`datum`), and
    those two are the whole vocabulary of change. Deleting one would leave every `teamN_quelle` naming
    its `spiel_nr` pointing at nothing, which the resolution reads as a typo and acts on by leaving the
    slot alone -- so the bracket would keep a team it should not, and report nothing.
  • `ergebnis` is DERIVED from the two `tore` values and is never accepted from the client. A fixture
    with an unresolved side has no goals to derive from and therefore no result (ADR-0041).
  • `elfmeterschiessen` IS accepted from the client -- it is a scoreline of its own and nothing else in
    the document states it -- but only on a KNOCKOUT fixture whose goals are level. Anywhere else it is
    discarded on the way in: a group-phase match has no tie to break, and a shoot-out on a fixture one
    side already won is a contradiction (ADR-0044).
  • The payload is written wholesale with `$set`, so a field absent from it is overwritten rather than
    preserved. That is why the money fields carry no Pydantic default.
  • `patch_spiel_data` writes NO team document. Team statistics are derived from the matches on read
    (ADR-0026), so there is no second write to keep in step and no team to look up here. It does write
    other MATCH documents: entering a result resolves the season's bracket, which moves winners into
    the fixtures whose `quelle` names that match (ADR-0042).
  • Wiring the season cannot hold is a 409 (`REQ-WIRING-001`), decided by `find_wiring_refusal` inside
    the transaction and before the write (ADR-0046). The resolution's own containment of the same
    shapes stays: it is for data that never passed through this endpoint.
  • `/action_required` DERIVES its bracket faults and stores none (ADR-0047). It is the only read here
    that does work beyond a filter, and it is uncached for the same reason the rest of the route is.
    Reporting a fault never resolves it: the containment in `resolve_bracket` is what owns that.

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
from motor.motor_asyncio import AsyncIOMotorClientSession

from app.api.saisons.crud import pull_saison_id_and_rules
from app.api.spiele.crud import advance_bracket_winners, find_bracket_faults
from app.api.spiele.schemas import (
    FLPatchSpielDataPayload,
    FLPatchSpielDataResponse,
    FLSpiel,
    FLSpieleActionRequiredResponse,
    FLSpielListAdapter,
)
from app.api.spiele.services import find_wiring_refusal
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, pull_many_from_db, pull_one_from_db
from app.core.dependencies import DBClient, SaisonsCollection, SpieleCollection, TeamsCollection, get_german_date_str
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import verify_access_admin
from app.shared.schemas.custom import CustomObjectId, CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spiele",
    dependencies=[Depends(verify_access_admin)],
)


@router.get("/action_required", response_model=FLSpieleActionRequiredResponse, summary="Spiele needing attention")
async def get_spiele_action_required(
    spiele_collection: SpieleCollection,
    teams_collection: TeamsCollection,
    saisons_collection: SaisonsCollection,
    today: str = Depends(get_german_date_str),
) -> FLSpieleActionRequiredResponse:
    """
    List Spiele that need an admin's attention, and the bracket faults among them.

    A match qualifies if it is cancelled, is missing a date, time, venue or referee, is in the past
    with no result recorded, or is a knockout fixture with a side that has neither a team nor a
    `quelle`. That last shape is legal and permanent-by-default: nothing resolves such a slot and
    nothing else reminds the admin that it is theirs (ADR-0046). A Gruppenphase fixture is exempt --
    an unscheduled group match is an unfilled schedule, not an orphaned slot, and every group fixture
    legitimately carries no `quelle` forever. Not season-filtered: it spans every season.

    **`bracket_faults` is derived here rather than filtered** (ADR-0047). A fault is a contradiction
    between documents -- a `quelle` naming a match the season does not have, a cycle, a placing no
    standing will produce, a fixture resolving to one club -- so no Mongo filter can select one, and
    the resolution is what decides them. Every fixture a fault names is added to `spiele` below, so the
    client holds the document behind each fault whether or not the filter also selected it.

    Deliberately uncached on the frontend — admin-authorized data does not belong in a shared cache
    (ADR-0013), and a derived fault list would be wrong the moment a document changed under it anyway.
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
                {
                    "saison_phase": {"$ne": "gruppenphase"},
                    "$or": [
                        {"team1": None, "team1_quelle": None},
                        {"team2": None, "team2_quelle": None},
                    ],
                },
            ]
        },
    )
    spiele = FLSpielListAdapter.validate_python(spiele_raw)

    bracket_faults, faulted_spiele = await find_bracket_faults(
        spiele_collection=spiele_collection,
        teams_collection=teams_collection,
        saisons_collection=saisons_collection,
    )

    # Keyed by id and not by `spiel_nr`, which repeats across the seasons this route spans. A faulted
    # fixture the filter above already selected keeps that copy; both come from the same collection in
    # the same request, so the two are the same document.
    by_id: dict[CustomObjectId, FLSpiel] = {spiel.id: spiel for spiel in spiele}
    for spiel in faulted_spiele:
        by_id.setdefault(spiel.id, spiel)

    return FLSpieleActionRequiredResponse(spiele=list(by_id.values()), bracket_faults=bracket_faults)


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

    `elfmeterschiessen` records how a knockout that finished level was settled, and is kept only on a
    fixture outside the Gruppenphase whose two goal counts are equal; anywhere else it is discarded
    rather than refused, because a group draw is a final result and the goals are what say whether a
    shoot-out was possible at all (ADR-0044). It decides the bracket below and is invisible to the
    league table, which counts the match as the draw it was (ADR-0026).

    **A result can move fixtures other than this one.** The occupant of a slot referring to match 25 is
    the winner of match 25, so entering that match's result fills the slot, correcting it later moves
    the right team in, and deleting it empties the slot again (ADR-0042). A slot referring to a group
    placing is filled the same way, once no remaining fixture in that group can still change who holds
    it (ADR-0043). Every fixture written either way is named in `advanced_to`.

    `bracket_faults` names every stored contradiction this season's resolution walked past: a `platz`
    its group will never produce, a placing the tiebreak chain cannot separate in a group that has
    finished, a `quelle` naming a match the season does not have, a chain of references that closes on
    itself, and a fixture whose two sides resolve to one club (ADR-0047). A group still being played is
    not reported: that placing is simply not decided yet. The same list is re-derivable at
    `GET /spiele/action_required`, so missing it here is not losing it.

    The league table follows on its own: team statistics are computed from the match documents by
    `GET /teams`, so a result entered here is reflected the next time that table is read.

    **Wiring the season cannot hold is refused with a 409** (`REQ-WIRING-001`, ADR-0046) before
    anything is written: a `quelle` on a Gruppenphase fixture, a `spiel` source the season does not
    have or that is not played before this fixture, one outcome feeding two slots, and a team
    submitted against a side a `quelle` maintains. The form does not offer these shapes, so a request
    carrying one is stale or racing another admin -- reloading is the way past the 409.

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

    # The phase and season are read BEFORE the write and off the stored document, because both are on
    # no payload and nothing anywhere writes them -- so they cannot change under this request and one
    # projected round trip settles both. The 404 it can raise is the same one the write raises below;
    # that one stays, as the guard against a match deleted between the two.
    stored = await pull_one_from_db(collection=spiele_collection, db_filter={"_id": spiel_id}, projection={"saison_phase": 1, "saison_id": 1})

    # A shoot-out settles a KNOCKOUT fixture that finished LEVEL, and a record failing either half
    # states a contradiction: a group-phase match, which has no tie to break, or a match with no result
    # at all, or one a side already won by goals. Discarded rather than refused, and here rather than
    # anywhere later, for the same reason `ergebnis` is derived here -- this is the one place that sees
    # the whole payload, and no `$jsonSchema` validator may hold a cross-field rule (ADR-0027).
    is_knockout = stored.get("saison_phase") != "gruppenphase"
    if not is_knockout or updated_ergebnis_field is None or team1_tore != team2_tore:
        document["elfmeterschiessen"] = None

    # The transaction is what makes the result and the advancement it causes one fact: a bracket that
    # resolved against a result the caller never committed would be worse than one that did not resolve.
    #
    # `with_transaction` rather than a bare `start_transaction`, because two saves in one season each
    # resolve the whole bracket and can write-conflict on the same advanced fixture -- a transient
    # error the driver labels as retryable, which the bare form would surface as a 500. The callback
    # is safe to re-run: the `$set` states absolute values and the resolution recomputes from scratch,
    # so a retry writes the same thing the first attempt would have. The 404 below is not transient
    # and aborts without retrying.
    async def write_result_and_resolve_bracket(session: AsyncIOMotorClientSession) -> FLPatchSpielDataResponse:
        # Refused BEFORE anything is written, inside the transaction, against the season as this
        # request sees it -- so a retry after a write conflict revalidates against fresh reads, and a
        # refusal leaves the season exactly as it was. The rules are `find_wiring_refusal`'s
        # (ADR-0046): wiring on a group fixture, a source the season cannot honour, one outcome
        # feeding two slots, and a hand-set team on a maintained side. The English detail is for the
        # log; the form prevents these shapes, so a request carrying one is stale or raced.
        season_raw = await pull_many_from_db(
            collection=spiele_collection,
            db_filter={"saison_id": stored.get("saison_id")},
            session=session,
        )
        refusal = find_wiring_refusal(spiel_id, spiel_data, FLSpielListAdapter.validate_python(season_raw))
        if refusal is not None:
            raise DocumentConflictException(error_code="REQ-WIRING-001", message=refusal)

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

        advanced_to, bracket_faults = await advance_bracket_winners(
            spiele_collection=spiele_collection,
            teams_collection=teams_collection,
            saison_id=saison_id,
            rules=saison_rules,
            session=session,
        )

        return FLPatchSpielDataResponse(advanced_to=advanced_to, bracket_faults=bracket_faults)

    async with await db.start_session() as session:
        return await session.with_transaction(write_result_and_resolve_bracket)
