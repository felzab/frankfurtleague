from typing import Annotated, Literal

from fastapi import APIRouter, Body, Depends, Query
from motor.motor_asyncio import AsyncIOMotorClientSession

from app.api.saisons.crud import pull_current_saison_id, pull_saison_id_and_rules
from app.api.spiele.crud import (
    advance_bracket_winners,
    find_bracket_faults,
    preview_bracket_after_patch,
    pull_booked_referee,
    pull_booked_venue,
    pull_saison_membership,
    release_spieltag_sides,
)
from app.api.spiele.schemas import (
    SONDEREREIGNIS_KEEPING_ITS_SLOT,
    SONDEREREIGNIS_RECORDING_AN_ABSENCE,
    FLPatchSpielDataPayload,
    FLPatchSpielDataResponse,
    FLSpiel,
    FLSpielBookingListAdapter,
    FLSpieleActionRequiredResponse,
    FLSpieleAdminSingleResponse,
    FLSpieleFilterParams,
    FLSpieleListResponse,
    FLSpielJoined,
    FLSpielJoinedAdmin,
    FLSpielJoinedListAdapter,
    FLSpielListAdapter,
)
from app.api.spiele.services import (
    BookedSlot,
    ResolvedReferences,
    SpieltagRelease,
    apply_payload_to_spiel,
    build_spiele_filter,
    build_spiele_pipeline,
    build_spiele_sort,
    find_booking_refusal,
    find_clash_refusal,
    find_eligibility_refusal,
    find_fixture_date_refusal,
    find_result_removal_refusal,
    find_state_refusal,
    find_wiring_refusal,
    judge_spieltag_occupancy,
    stored_in_slice,
)
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, patch_one_in_db, pull_many_from_db, pull_one_from_db, refuse
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpieleCollection,
    SpielorteCollection,
    SpieltageCollection,
    TeamsCollection,
    get_german_date_str,
)
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.custom import CustomObjectId, CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spiele",
    dependencies=[Depends(verify_access_admin), Depends(bind_actor)],
)


# Two static segments, matching `GET /saisons/list/admin`. Declared before `{spiel_id}/admin`, whose
# only separation from this path is the `objectid` convertor (`docs/backend/spec.md :: I37`).
@router.get("/list/admin", response_model=FLSpieleListResponse, summary="Spiele for the admin surfaces")
async def get_spiele_for_admin(
    spiele_collection: SpieleCollection,
    saisons_collection: SaisonsCollection,
    filters: FLSpieleFilterParams = Depends(),
    today: str = Depends(get_german_date_str),
) -> FLSpieleListResponse:
    """
    List a season's Spiele for the admin surfaces, a `future` season's included.

    Same filters and shape as `GET /spiele`, without its season gate -- which lists a planned season
    as empty, so every admin surface counting fixtures reads zero.
    """

    # Mirrors `app/api/spiele/router.py :: get_spiele`, which cannot be called here: the gate is
    # inside it, and emptying the planned season is the one thing this must not do.
    if filters.saison_id is None:
        filters.saison_id = await pull_current_saison_id(saisons_collection=saisons_collection)

    # The joined pipeline, for `get_spiele_action_required`'s reason: a plain `find` drops `austritt`.
    spiele_raw = await aggregate_many_from_db(
        collection=spiele_collection,
        pipeline=build_spiele_pipeline(
            db_filter=build_spiele_filter(filters=filters, today=today),
            sort_by=build_spiele_sort(sort_by=filters.sort_by, order=filters.order),
            limit=filters.limit,
        ),
        limit=filters.limit,
    )

    return FLSpieleListResponse(spiele=FLSpielJoinedListAdapter.validate_python(spiele_raw))


@router.get("/action_required", response_model=FLSpieleActionRequiredResponse, summary="Spiele needing attention")
async def get_spiele_action_required(
    spiele_collection: SpieleCollection,
    teams_collection: TeamsCollection,
    saisons_collection: SaisonsCollection,
    saison_id: str | None = None,
    today: str = Depends(get_german_date_str),
) -> FLSpieleActionRequiredResponse:
    """List Spiele needing attention, and the bracket faults among them.

    Qualifying: cancelled, missing a date, time, venue or referee, past with no result, or a
    knockout side with neither team nor `quelle`. Scoped to `saison_id`, every season without.
    """

    # The joined pipeline, as the public reads use: the raw shape carries no `austritt`, so
    # this list would silently omit a badge the grids show (`docs/backend/spec.md :: I32`).
    spiele_raw = await aggregate_many_from_db(
        collection=spiele_collection,
        pipeline=build_spiele_pipeline(
            db_filter={
                # Named first so the term reads before the conditions it narrows. Absent, this is an
                # empty spread and the read spans the archive, as it did before the page had a selector.
                **({} if saison_id is None else {"saison_id": saison_id}),
                "$or": [
                    {"sonderereignis": {"$in": list(SONDEREREIGNIS_RECORDING_AN_ABSENCE)}},
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
                ],
            }
        ),
    )
    spiele = FLSpielJoinedListAdapter.validate_python(spiele_raw)

    # The SAME scope as the read above: a fault is unioned into that list, so a fault swept from a
    # season the list does not cover would surface a fixture the admin did not ask about.
    bracket_faults, faulted_spiele = await find_bracket_faults(
        spiele_collection=spiele_collection,
        teams_collection=teams_collection,
        saisons_collection=saisons_collection,
        saison_id=saison_id,
    )

    # Keyed by id, not `spiel_nr`, which repeats across seasons -- and this route still spans them
    # when no `saison_id` is named.
    by_id: dict[CustomObjectId, FLSpielJoined] = {spiel.id: spiel for spiel in spiele}
    for spiel in faulted_spiele:
        by_id.setdefault(spiel.id, spiel)

    return FLSpieleActionRequiredResponse(spiele=list(by_id.values()), bracket_faults=bracket_faults)


# A static suffix rather than a second `GET /{spiel_id}`: the public router owns that path at this
# same prefix, so whichever router registered first would answer both.
@router.get(f"{by_id('spiel_id')}/admin", response_model=FLSpieleAdminSingleResponse, summary="One Spiel for the admin editor")
async def get_spiel_for_admin(spiel_id: CustomRouteObjectId, spiele_collection: SpieleCollection) -> FLSpieleAdminSingleResponse:
    """
    Return one match in the joined shape, plus the two figures the base tier withholds.

    The editor reads here because it round-trips `ort.mietpreis` and `schiedsrichter.payment`,
    which are admin-tier (`READ-MONEY-001`).
    """

    spiele_raw = await aggregate_many_from_db(
        collection=spiele_collection,
        pipeline=build_spiele_pipeline(db_filter={"_id": spiel_id}),
        limit=1,
    )
    if not spiele_raw:
        raise DocumentNotFoundException(filter={"_id": spiel_id}, error_code=DOCUMENT_NOT_FOUND)

    return FLSpieleAdminSingleResponse(spiel=FLSpielJoinedAdmin.model_validate(spiele_raw[0]))


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
    spielorte_collection: SpielorteCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    dry_run: Annotated[bool, Query(description="Report what this payload would move and destroy, and write nothing")] = False,
) -> FLPatchSpielDataResponse:
    """
    Update one Spiel and resolve the season's bracket.

    The payload is written wholesale: an omitted field is overwritten, and every name it carries is
    composed by the server. A result can fill or empty the slots below it, each named in `advanced_to`.
    """

    # `saison_id` alone: everything the judgement and the normalisation read comes from the season
    # slice below, and this read is what answers 404 for an id no fixture holds.
    stored_raw = await pull_one_from_db(collection=spiele_collection, db_filter={"_id": spiel_id}, projection={"saison_id": 1})
    saison_id = str(stored_raw["saison_id"])

    # Read outside any transaction: no season document is written here. Ahead of the normalisation
    # because a forfeit is awarded from these rather than typed.
    _, saison_rules = await pull_saison_id_and_rules(saisons_collection=saisons_collection, saison_id=saison_id)

    async def judge(session: AsyncIOMotorClientSession | None) -> tuple[list[FLSpiel], list[SpieltagRelease], FLSpiel]:
        """Judge this payload against the season, and compose the fixture it saves to.

        Every refusal is raised here, so the `dry_run` preview cannot succeed where the save is
        refused, and the normalisation after them composes from rows already judged.
        """

        # One over the cap, so a truncated season is DETECTED rather than judged: a dropped fixture
        # leaves `find_wiring_refusal` reporting a live `spiel_nr` as no such match, and
        # `judge_spieltag_occupancy` blind to a release it owes.
        season_raw = await pull_many_from_db(
            collection=spiele_collection,
            db_filter={"saison_id": saison_id},
            limit=LIST_LIMIT_DEFAULT + 1,
            session=session,
        )
        if len(season_raw) > LIST_LIMIT_DEFAULT:
            raise ValueError(f"season {saison_id} holds more than {LIST_LIMIT_DEFAULT} fixtures, which is more than one read can judge")

        season = FLSpielListAdapter.validate_python(season_raw)

        # First, and on the payload alone: the event the admin just chose is what the rest of this
        # judgement is about, so a contradiction inside it should not be reported as a bracket fault.
        refuse(find_state_refusal(spiel_data))

        refuse(find_wiring_refusal(spiel_id, spiel_data, season))

        # Read through the session, so an austritt committed by this transaction is visible.
        membership = await pull_saison_membership(saison_teams_collection=saison_teams_collection, saison_id=saison_id, session=session)
        refuse(find_eligibility_refusal(spiel_id, spiel_data, season, membership))

        # Before the occupancy judgement: a side that cannot be emptied is a fact about this
        # fixture, where a clash is a fact about its neighbours.
        refuse(find_result_removal_refusal(spiel_id, spiel_data, season))

        verdict = judge_spieltag_occupancy(spiel_id, spiel_data, season)
        refuse(verdict.refusal)

        # The same slice the refusals above judged (`docs/backend/spec.md :: I45`), so this read
        # cannot quietly skip the date rule over a fixture they already stood on.
        stored = stored_in_slice(spiel_id, season)

        # `find_one` directly, because `pull_one_from_db` raises on a miss and this branches on one.
        # The session is what makes a matchday widened by a concurrent write visible.
        spieltag_raw = await spieltage_collection.find_one(
            {"_id": stored.spieltag_id},
            {"beginn": 1, "ende": 1},
            session=session,
        )
        if spieltag_raw is not None:
            # Passed RAW, never through `str()`: a drawn matchday stores a null span, and "None"
            # sorts above every date, so stringifying it would refuse every fixture the season
            # drew rather than reaching the rule's own absent-span branch.
            refuse(
                find_fixture_date_refusal(
                    datum=spiel_data.datum,
                    spieltag_beginn=spieltag_raw["beginn"],
                    spieltag_ende=spieltag_raw["ende"],
                )
            )

        # Read whatever the payload names, unchanged reference included: these rows are where the
        # saved names come FROM, so a copy that went stale is repaired by the next save either way.
        resolved = ResolvedReferences(
            teams=membership,
            ort=await pull_booked_venue(
                spielorte_collection=spielorte_collection,
                spielort_id=spiel_data.ort.spielort_id if spiel_data.ort is not None else None,
                session=session,
            ),
            schiedsrichter=await pull_booked_referee(
                schiedsrichter_collection=schiedsrichter_collection,
                schiedsrichter_id=spiel_data.schiedsrichter.schiedsrichter_id if spiel_data.schiedsrichter is not None else None,
                session=session,
            ),
        )
        # Before the clash: whether a ground exists at all is more basic than who else is on it.
        refuse(find_booking_refusal(spiel_id, spiel_data, season, resolved))

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
                        {
                            field: chosen,
                            "datum": spiel_data.datum,
                            "uhrzeit": {"$ne": None},
                            "_id": {"$ne": spiel_id},
                            # An abandoned match used the ground and the referee; the rest freed both.
                            "sonderereignis": {"$in": list(SONDEREREIGNIS_KEEPING_ITS_SLOT)},
                        },
                        {"spiel_nr": 1, "datum": 1, "uhrzeit": 1},
                        session=session,
                    ).to_list(length=None)
                )
                claims.extend(
                    BookedSlot(spiel_nr=booking.spiel_nr, datum=booking.datum, uhrzeit=booking.uhrzeit, resource=resource)
                    for booking in bookings
                )

            refuse(find_clash_refusal(datum=spiel_data.datum, uhrzeit=spiel_data.uhrzeit, booked=claims))

        return season, verdict.releases, apply_payload_to_spiel(stored, spiel_data, saison_rules, resolved)

    if dry_run:
        # No transaction: a preview that took a write lock would be paying for a question.
        season, releases, patched = await judge(session=None)
        advanced_to, released_sides, bracket_faults = await preview_bracket_after_patch(
            teams_collection=teams_collection,
            saison_id=saison_id,
            rules=saison_rules,
            season=season,
            patched=patched,
            releases=releases,
        )
        return FLPatchSpielDataResponse(advanced_to=advanced_to, released_sides=released_sides, bracket_faults=bracket_faults)

    # `with_transaction` rather than a bare `start_transaction`: two saves in one season can
    # write-conflict on the same advanced fixture, and the callback is safe to retry.
    async def write_result_and_resolve_bracket(session: AsyncIOMotorClientSession) -> FLPatchSpielDataResponse:
        # Inside the transaction, so a retry after a write conflict revalidates against fresh reads.
        _, releases, patched = await judge(session=session)

        # From the NORMALISED fixture, with keys off the PAYLOAD's field set: keys off the fixture
        # would put `saison_id`, `saison_phase`, `spiel_nr` and `spieltag_id` in the `$set`.
        document = patched.model_dump(context={"keep_oid": True}, include={*FLPatchSpielDataPayload.model_fields, "ergebnis"})

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
