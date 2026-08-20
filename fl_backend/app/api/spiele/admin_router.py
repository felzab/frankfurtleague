from typing import Annotated, Literal

from fastapi import APIRouter, Body, Depends, Query
from motor.motor_asyncio import AsyncIOMotorClientSession

from app.api.saisons.crud import pull_saison_id_and_rules
from app.api.spiele.crud import (
    advance_bracket_winners,
    find_bracket_faults,
    preview_bracket_after_patch,
    pull_saison_membership,
    release_spieltag_sides,
)
from app.api.spiele.schemas import (
    FLPatchSpielDataPayload,
    FLPatchSpielDataResponse,
    FLSpiel,
    FLSpielBookingListAdapter,
    FLSpieleActionRequiredResponse,
    FLSpielJoined,
    FLSpielJoinedListAdapter,
    FLSpielListAdapter,
)
from app.api.spiele.services import (
    BookedSlot,
    SpieltagRelease,
    apply_payload_to_spiel,
    build_spiele_pipeline,
    find_clash_refusal,
    find_eligibility_refusal,
    find_fixture_date_refusal,
    find_result_removal_refusal,
    find_wiring_refusal,
    judge_spieltag_occupancy,
)
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, patch_one_in_db, pull_many_from_db, pull_one_from_db, refuse
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonTeamsCollection,
    SpieleCollection,
    SpieltageCollection,
    TeamsCollection,
    get_german_date_str,
)
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
    """List Spiele needing an admin's attention, and the bracket faults among them.

    Qualifying: cancelled, missing a date, time, venue or referee, past with no result, or a
    knockout side holding neither team nor `quelle`. Every season.
    """

    # The joined pipeline, as the public reads use: the raw shape carries no `disqualifikation`, so
    # this list would silently omit a badge the grids show (`docs/backend/spec.md :: I32`).
    spiele_raw = await aggregate_many_from_db(
        collection=spiele_collection,
        pipeline=build_spiele_pipeline(
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
            }
        ),
    )
    spiele = FLSpielJoinedListAdapter.validate_python(spiele_raw)

    bracket_faults, faulted_spiele = await find_bracket_faults(
        spiele_collection=spiele_collection,
        teams_collection=teams_collection,
        saisons_collection=saisons_collection,
    )

    # Keyed by id, not `spiel_nr`, which repeats across the seasons this route spans.
    by_id: dict[CustomObjectId, FLSpielJoined] = {spiel.id: spiel for spiel in spiele}
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
    saison_teams_collection: SaisonTeamsCollection,
    spieltage_collection: SpieltageCollection,
    dry_run: Annotated[bool, Query(description="Report what this payload would move and destroy, and write nothing")] = False,
) -> FLPatchSpielDataResponse:
    """
    Update one Spiel and resolve the season's bracket.

    The payload is written wholesale: an omitted field is overwritten. A result can fill or empty the
    slots below it, each named in `advanced_to`. `dry_run=true` answers the same and writes nothing.
    """

    # In full, because the normalisation needs the fixture it applies to: `saison_phase` decides
    # whether a shoot-out survives.
    stored_raw = await pull_one_from_db(collection=spiele_collection, db_filter={"_id": spiel_id})
    stored = FLSpiel.model_validate(stored_raw)
    saison_id = stored.saison_id

    patched = apply_payload_to_spiel(stored, spiel_data)

    # Read outside any transaction: no season document is written here.
    _, saison_rules = await pull_saison_id_and_rules(saisons_collection=saisons_collection, saison_id=saison_id)

    async def judge(session: AsyncIOMotorClientSession | None) -> tuple[list[FLSpiel], list[SpieltagRelease]]:
        """The season as this request sees it, and the sides another fixture must give up.

        Every refusal is raised here, so a preview can never succeed where the save is refused.
        """

        season_raw = await pull_many_from_db(collection=spiele_collection, db_filter={"saison_id": saison_id}, session=session)
        season = FLSpielListAdapter.validate_python(season_raw)

        refuse(find_wiring_refusal(spiel_id, spiel_data, season))

        # Read through the session, so a disqualification committed by this transaction is visible.
        membership = await pull_saison_membership(saison_teams_collection=saison_teams_collection, saison_id=saison_id, session=session)
        refuse(find_eligibility_refusal(spiel_id, spiel_data, season, membership))

        # Before the occupancy judgement: a side that cannot be emptied is a fact about this
        # fixture, where a clash is a fact about its neighbours.
        refuse(find_result_removal_refusal(spiel_id, spiel_data, season))

        verdict = judge_spieltag_occupancy(spiel_id, spiel_data, season)
        refuse(verdict.refusal)

        stored = next((entry for entry in season if entry.id == spiel_id), None)
        if stored is not None:
            # `find_one` directly, because `pull_one_from_db` takes no session, and the session is
            # what makes a matchday widened by a concurrent write visible.
            spieltag_raw = await spieltage_collection.find_one(
                {"_id": stored.spieltag_id},
                {"beginn": 1, "ende": 1},
                session=session,
            )
            if spieltag_raw is not None:
                refuse(
                    find_fixture_date_refusal(
                        datum=spiel_data.datum,
                        spieltag_beginn=str(spieltag_raw["beginn"]),
                        spieltag_ende=str(spieltag_raw["ende"]),
                    )
                )

        # No `saison_id` in the query below: a double booking crosses competitions.
        if spiel_data.datum is not None:
            claims: list[BookedSlot] = []
            # Annotated rather than inferred: a bare tuple literal widens `resource` to `str`, which
            # `BookedSlot` then refuses.
            resources: tuple[tuple[Literal["Spielort", "Schiedsrichter"], str, CustomObjectId | None], ...] = (
                ("Spielort", "ort.spielort_id", spiel_data.ort.spielort_id if spiel_data.ort is not None else None),
                (
                    "Schiedsrichter",
                    "schiedsrichter.schiedsrichter_id",
                    spiel_data.schiedsrichter.schiedsrichter_id if spiel_data.schiedsrichter is not None else None,
                ),
            )
            for resource, field, chosen in resources:
                if chosen is None:
                    continue
                # VALIDATED, not read as a raw dict, for the reason
                # `fl_backend/app/api/spiele/schemas.py :: FLSpielBooking` states.
                bookings = FLSpielBookingListAdapter.validate_python(
                    await spiele_collection.find(
                        {field: chosen, "datum": spiel_data.datum, "uhrzeit": {"$ne": None}, "_id": {"$ne": spiel_id}, "is_canceled": False},
                        {"spiel_nr": 1, "datum": 1, "uhrzeit": 1},
                        session=session,
                    ).to_list(length=None)
                )
                claims.extend(
                    BookedSlot(spiel_nr=booking.spiel_nr, datum=booking.datum, uhrzeit=booking.uhrzeit, resource=resource)
                    for booking in bookings
                )

            refuse(find_clash_refusal(datum=spiel_data.datum, uhrzeit=spiel_data.uhrzeit, booked=claims))

        return season, verdict.releases

    if dry_run:
        # No transaction: a preview that took a write lock would be paying for a question.
        season, releases = await judge(session=None)
        advanced_to, released_sides, bracket_faults = await preview_bracket_after_patch(
            teams_collection=teams_collection,
            saison_id=saison_id,
            rules=saison_rules,
            season=season,
            patched=patched,
            releases=releases,
        )
        return FLPatchSpielDataResponse(advanced_to=advanced_to, released_sides=released_sides, bracket_faults=bracket_faults)

    # From the NORMALISED fixture, with keys off the PAYLOAD's field set: keys off the fixture would
    # put `saison_id`, `saison_phase`, `spiel_nr` and `spieltag_id` in the `$set`.
    document = patched.model_dump(context={"keep_oid": True}, include={*FLPatchSpielDataPayload.model_fields, "ergebnis"})

    # `with_transaction` rather than a bare `start_transaction`: two saves in one season can
    # write-conflict on the same advanced fixture, and the callback is safe to retry.
    async def write_result_and_resolve_bracket(session: AsyncIOMotorClientSession) -> FLPatchSpielDataResponse:
        # Inside the transaction, so a retry after a write conflict revalidates against fresh reads.
        _, releases = await judge(session=session)

        await patch_one_in_db(
            collection=spiele_collection,
            db_filter={"_id": spiel_id},
            update={"$set": document},
            session=session,
        )

        # Before the resolution: a slot this release opens can be refilled by that same resolution,
        # and the reverse order would leave the season one pass behind.
        released_sides = await release_spieltag_sides(spiele_collection=spiele_collection, releases=releases, session=session)

        advanced_to, bracket_faults = await advance_bracket_winners(
            spiele_collection=spiele_collection,
            teams_collection=teams_collection,
            saison_id=saison_id,
            rules=saison_rules,
            session=session,
        )

        return FLPatchSpielDataResponse(advanced_to=advanced_to, released_sides=released_sides, bracket_faults=bracket_faults)

    async with await db.start_session() as session:
        return await session.with_transaction(write_result_and_resolve_bracket)
