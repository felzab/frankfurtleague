from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Query
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.saisons.crud import pull_current_saison_id, pull_saison_id_and_rules
from app.api.saisons.schemas import FLSaisonRules
from app.api.spielberichte.crud import pull_zustaende, stamp_the_adoption
from app.api.spielberichte.schemas import FLSpieleActionRequiredResponse
from app.api.spielberichte.services import BERICHT_ZUSTAENDE_OFFEN, seiten_of
from app.api.spielbestaetigungen.services import ansetzung_stand_of, build_triage_rows_filter
from app.api.spiele.crud import (
    advance_bracket_winners,
    anchor_a_booked_referee,
    anchor_a_booked_venue,
    find_bracket_faults,
    preview_bracket_after_patch,
    pull_booked_referee,
    pull_booked_slots,
    pull_booked_venue,
    pull_saison_membership,
    pull_spieltag_span,
    release_spieltag_sides,
)
from app.api.spiele.schemas import (
    SONDEREREIGNIS_RECORDING_AN_ABSENCE,
    SPIEL_PATCH_WRITTEN_FIELDS,
    FLPatchSpielDataPayload,
    FLPatchSpielDataResponse,
    FLSpiel,
    FLSpieleAdminListResponse,
    FLSpieleAdminSingleResponse,
    FLSpieleFilterParams,
    FLSpielJoinedAdmin,
    FLSpielJoinedAdminListAdapter,
    FLSpielListAdapter,
)
from app.api.spiele.services import (
    BookedReferences,
    ResolvedReferences,
    SpieltagRelease,
    apply_payload_to_spiel,
    build_spiele_filter,
    build_spiele_pipeline,
    build_spiele_sort,
    find_booking_refusal,
    find_claims_made,
    find_clash_refusal,
    find_eligibility_refusal,
    find_fixture_date_refusal,
    find_referee_stand_refusal,
    find_references_to_anchor,
    find_result_removal_refusal,
    find_state_refusal,
    find_wiring_refusal,
    judge_spieltag_occupancy,
    stored_in_slice,
)
from app.core.codes import Code
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, patch_one_in_db, pull_many_from_db, pull_one_from_db, refuse
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielberichteCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
    SpielorteCollection,
    SpieltageCollection,
    TeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, stores_nothing_when
from app.core.exceptions import DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin, verify_actor_is_admin
from app.core.transactions import transaction_session
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.custom import CustomObjectId, CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spiele",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


# Two static segments, matching `GET /saisons/list/admin`. Declared before `{spiel_id}/admin`, whose
# only separation from this path is the `objectid` convertor.
@router.get(
    "/list/admin",
    response_model=FLSpieleAdminListResponse,
    summary="Spiele for the admin surfaces",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
async def get_spiele_for_admin(
    spiele_collection: SpieleCollection,
    saisons_collection: SaisonsCollection,
    filters: FLSpieleFilterParams = Depends(),
    today: str = Depends(get_german_date_str),
) -> FLSpieleAdminListResponse:
    """
    List a season's Spiele for the admin surfaces, a `future` season's included.

    Same filters as `GET /spiele`, without its season gate -- which lists a planned season as empty,
    so every admin surface counting fixtures reads zero. The admin fixture shape, so the referee
    carries their whole name and the two figures ride along (`READ-MONEY-001`, `READ-REFEREE-001`).
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

    return FLSpieleAdminListResponse(spiele=FLSpielJoinedAdminListAdapter.validate_python(spiele_raw))


@router.get(
    "/action_required",
    response_model=FLSpieleActionRequiredResponse,
    summary="Spiele needing attention",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
async def get_spiele_action_required(
    spiele_collection: SpieleCollection,
    teams_collection: TeamsCollection,
    saisons_collection: SaisonsCollection,
    spielorte_collection: SpielorteCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spielberichte_collection: SpielberichteCollection,
    saison_id: str | None = None,
    today: str = Depends(get_german_date_str),
) -> FLSpieleActionRequiredResponse:
    """List Spiele needing attention, and the bracket faults among them.

    Qualifying: cancelled, missing a date, time, venue or referee, past with no result, a
    knockout side with neither team nor `quelle`, or holding a referee's report the administrator has
    not adopted as it stands. Every report's state the season holds is served beside them. Scoped to `saison_id`, the active season when none
    is named, which answers 404 while no season is active.

    Also every fixture a club's unclosed confirmation about its Ansetzung as it stands puts before the
    administrator: a decline proposing another date, a deadline passed unanswered, or a deadline of
    today on a request sent today or never. The rows themselves are not served: `GET /spielbestaetigungen`
    for the same season serves them, read separately, so a row reaching one of those states between
    the two reads shows its fixture on the next.

    The faults include a fixture still to be played that is booked onto a retired venue or referee,
    and one whose venue or referee another fixture of any season claims less than four hours away.
    """

    # Resolved as every other admin read resolves an omitted season: the selector sends none for the
    # running one, so spanning the archive here would bury its queue under every other season's.
    if saison_id is None:
        saison_id = await pull_current_saison_id(saisons_collection=saisons_collection)

    # The joined pipeline, as the public reads use: the raw shape carries no `austritt`, so
    # this list would silently omit a badge the grids show.
    spiele_raw = await aggregate_many_from_db(
        collection=spiele_collection,
        pipeline=build_spiele_pipeline(
            db_filter={
                "saison_id": saison_id,
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
    spiele = FLSpielJoinedAdminListAdapter.validate_python(spiele_raw)

    # The SAME scope as the read above: a fault is unioned into that list, so a fault swept from a
    # season the list does not cover would surface a fixture the admin did not ask about.
    bracket_faults, faulted_spiele = await find_bracket_faults(
        spiele_collection=spiele_collection,
        teams_collection=teams_collection,
        saisons_collection=saisons_collection,
        spielorte_collection=spielorte_collection,
        schiedsrichter_collection=schiedsrichter_collection,
        saison_id=saison_id,
    )

    by_id: dict[CustomObjectId, FLSpielJoinedAdmin] = {spiel.id: spiel for spiel in spiele}
    for spiel in faulted_spiele:
        by_id.setdefault(spiel.id, spiel)

    # A fixture a confirmation names may lack nothing above: rows are minted only for one with its day, time,
    # ground and both sides. Grouped per fixture, so the read is bounded by the season's fixtures, never its rows.
    angefragt = await aggregate_many_from_db(
        collection=spielbestaetigungen_collection,
        pipeline=[
            {"$match": build_triage_rows_filter(saison_id=saison_id, today=today)},
            {"$group": {"_id": "$spiel_id", "staende": {"$addToSet": "$ansetzung.stand"}}},
        ],
    )
    staende = {row["_id"]: set(row["staende"]) for row in angefragt if row["_id"] not in by_id}
    if staende:
        for spiel_raw in await aggregate_many_from_db(
            collection=spiele_collection, pipeline=build_spiele_pipeline(db_filter={"saison_id": saison_id, "_id": {"$in": list(staende)}})
        ):
            # A row about an Ansetzung the fixture has left asks the administrator nothing: the next pass closes it.
            if ansetzung_stand_of(spiel_raw) in staende[spiel_raw["_id"]]:
                spiel = FLSpielJoinedAdmin.model_validate(spiel_raw)
                by_id.setdefault(spiel.id, spiel)

    # A report awaiting the administrator sits on a fixture the read above passes over -- one played today, or one whose
    # result stands -- so it is unioned in as a fault's is; the reports' own read serves the states.
    berichte = await pull_zustaende(spielberichte_collection=spielberichte_collection, saison_id=saison_id)
    offen = [eintrag.spiel_id for eintrag in berichte if eintrag.zustand in BERICHT_ZUSTAENDE_OFFEN and eintrag.spiel_id not in by_id]
    if offen:
        berichtet_raw = await aggregate_many_from_db(
            collection=spiele_collection, pipeline=build_spiele_pipeline(db_filter={"saison_id": saison_id, "_id": {"$in": offen}})
        )
        for spiel in FLSpielJoinedAdminListAdapter.validate_python(berichtet_raw):
            by_id.setdefault(spiel.id, spiel)

    return FLSpieleActionRequiredResponse(spiele=list(by_id.values()), bracket_faults=bracket_faults, spielberichte=berichte)


# A static suffix rather than a second `GET /{spiel_id}`: the public router owns that path at this
# same prefix, so whichever router registered first would answer both.
@router.get(
    f"{by_id('spiel_id')}/admin",
    response_model=FLSpieleAdminSingleResponse,
    summary="One Spiel for the admin editor",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
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
        raise DocumentNotFoundException(filter={"_id": spiel_id}, error_code=Code.DOCUMENT_NOT_FOUND)

    return FLSpieleAdminSingleResponse(spiel=FLSpielJoinedAdmin.model_validate(spiele_raw[0]))


@stores_nothing_when("dry_run")
async def previewing(
    dry_run: Annotated[bool, Query(description="Report what this payload would move and destroy, and write nothing")] = False,
) -> bool:
    return dry_run


@router.patch(
    by_id("spiel_id"),
    response_model=FLPatchSpielDataResponse,
    summary="Update a Spiel",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
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
    spielberichte_collection: SpielberichteCollection,
    uebernimmt_bericht: Annotated[
        int | None,
        Query(ge=1, description="The `version` of the fixture's Spielbericht the editor was seeded from, to stamp it adopted"),
    ] = None,
    now: datetime = Depends(get_germany_now),
    dry_run: Annotated[bool, Depends(previewing)] = False,
) -> FLPatchSpielDataResponse:
    """
    Update one Spiel and resolve the season's bracket.

    The payload is written wholesale: an omitted field is overwritten, and every name it carries is
    composed by the server. A result can fill or empty the slots below it, each named in `advanced_to`.

    With `uebernimmt_bericht`, the save also stamps the fixture's Spielbericht adopted at that version, in the same
    transaction. A report corrected since that version, or written about other clubs than the save leaves on the
    fixture, is left unstamped, and the save lands all the same: nothing is refused for it. A `dry_run` stamps nothing.
    """

    async def season_of(session: AsyncClientSession | None) -> tuple[str, FLSaisonRules]:
        """Which season the fixture is played in, and under which rules.

        The `saison_id` read is what answers 404 for an id no fixture holds.
        """

        # `saison_id` alone: everything the judgement and the normalisation read comes from the
        # season slice `judge` takes.
        stored_raw = await pull_one_from_db(
            collection=spiele_collection, db_filter={"_id": spiel_id}, projection={"saison_id": 1}, session=session
        )
        saison_id = str(stored_raw["saison_id"])

        # Read off no session: no season document is written here. Ahead of the normalisation
        # because a forfeit is awarded from these rather than typed.
        _, saison_rules = await pull_saison_id_and_rules(saisons_collection=saisons_collection, saison_id=saison_id)

        return saison_id, saison_rules

    async def judge(
        session: AsyncClientSession | None, saison_id: str, saison_rules: FLSaisonRules
    ) -> tuple[list[FLSpiel], list[SpieltagRelease], FLSpiel, BookedReferences]:
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
        stored = stored_in_slice(spiel_id, season)

        # First, and on the payload alone: the event the admin just chose is what the rest of this
        # judgement is about, so a contradiction inside it should not be reported as a bracket fault.
        refuse(find_state_refusal(spiel_data))

        refuse(find_wiring_refusal(spiel_id, spiel_data, season, number_of_groups=saison_rules.number_of_groups))

        # Read through the session, so an austritt committed by this transaction is visible.
        membership = await pull_saison_membership(saison_teams_collection=saison_teams_collection, saison_id=saison_id, session=session)
        refuse(find_eligibility_refusal(spiel_id, spiel_data, season, membership))

        # Before the occupancy judgement: a side that cannot be emptied is a fact about this
        # fixture, where a clash is a fact about its neighbours.
        refuse(find_result_removal_refusal(spiel_id, spiel_data, season))

        verdict = judge_spieltag_occupancy(spiel_id, spiel_data, season)
        refuse(verdict.refusal)

        # The session is what makes a matchday widened by a concurrent write visible.
        span = await pull_spieltag_span(spieltage_collection=spieltage_collection, spieltag_id=stored.spieltag_id, session=session)
        if span is not None:
            refuse(find_fixture_date_refusal(datum=spiel_data.datum, spieltag_beginn=span.beginn, spieltag_ende=span.ende))

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
        refuse(find_booking_refusal(spiel_id, spiel_data, season, resolved, saison_rules))

        # Off the slice this transaction judges, so a save retried after a referee's decline conflicted with it meets the
        # slot the decline left; after the booking refusal, which names an erased referee as its own case.
        refuse(find_referee_stand_refusal(stored, spiel_data))

        # Read after every refusal but the one it feeds: it validates fixtures of every season, and a
        # hand-edited one raises, which would answer 500 for a save an earlier rule refuses.
        booked = await pull_booked_slots(
            spiele_collection=spiele_collection, spiel_id=spiel_id, claims=find_claims_made(stored, spiel_data), session=session
        )
        refuse(find_clash_refusal(datum=spiel_data.datum, uhrzeit=spiel_data.uhrzeit, booked=booked))

        return (
            season,
            verdict.releases,
            apply_payload_to_spiel(stored, spiel_data, saison_rules, resolved),
            # Returned rather than left to the caller to derive, so every transaction judging here
            # anchors what the two rules above judged.
            find_references_to_anchor(stored, spiel_data, saison_rules),
        )

    async def preview() -> FLPatchSpielDataResponse:
        """What this payload would move and destroy, judged against the season as it stands and written nowhere."""

        saison_id, saison_rules = await season_of(None)
        season, releases, patched, _ = await judge(None, saison_id, saison_rules)
        advanced_to, released_sides, bracket_faults = await preview_bracket_after_patch(
            teams_collection=teams_collection,
            saison_id=saison_id,
            rules=saison_rules,
            season=season,
            patched=patched,
            releases=releases,
        )

        return FLPatchSpielDataResponse(advanced_to=advanced_to, released_sides=released_sides, bracket_faults=bracket_faults)

    if dry_run:
        # No transaction: a preview that took a write lock would be paying for a question.
        return await preview()

    async def write_and_resolve_the_bracket(session: AsyncClientSession) -> FLPatchSpielDataResponse:
        # Inside the transaction, so a retry after a write conflict revalidates against fresh reads.
        saison_id, saison_rules = await season_of(session)
        season, releases, patched, anchored = await judge(session, saison_id, saison_rules)

        # From the NORMALISED fixture, with keys off the PAYLOAD's field set: keys off the fixture
        # would put `saison_id`, `saison_phase`, `spiel_nr` and `spieltag_id` in the `$set`.
        document = patched.model_dump(context={"keep_oid": True}, include={*SPIEL_PATCH_WRITTEN_FIELDS, "ergebnis"})

        await patch_one_in_db(
            collection=spiele_collection,
            db_filter={"_id": spiel_id},
            update={"$set": document},
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

        # Before the resolution: a slot this release opens can be refilled by that same resolution,
        # and the reverse order would leave the season one pass behind.
        released_sides, booked_again_by_the_release = await release_spieltag_sides(
            spiele_collection=spiele_collection,
            season=season,
            releases=releases,
            session=session,
        )

        advanced_to, bracket_faults, booked_again_by_the_resolution = await advance_bracket_winners(
            spiele_collection=spiele_collection,
            teams_collection=teams_collection,
            saison_id=saison_id,
            rules=saison_rules,
            session=session,
        )

        # A retirement, the erasure and a rival save at the same hour each judge fixtures and write
        # none of this pass's, so only a write to a row puts what this pass judged in their write
        # sets.
        for booked in (anchored, *booked_again_by_the_release, *booked_again_by_the_resolution):
            if booked.spielort_id is not None:
                await anchor_a_booked_venue(spielorte_collection=spielorte_collection, spielort_id=booked.spielort_id, session=session)
            if booked.schiedsrichter_id is not None:
                await anchor_a_booked_referee(
                    schiedsrichter_collection=schiedsrichter_collection, schiedsrichter_id=booked.schiedsrichter_id, session=session
                )

        # Here and with the session, never after the commit or off it: a save refused or rolled back stamps nothing.
        if uebernimmt_bericht is not None:
            # After the resolution, which can re-field this fixture's sides too.
            gespeichert = await pull_one_from_db(
                collection=spiele_collection,
                db_filter={"_id": spiel_id},
                projection={"team1.team_id": 1, "team2.team_id": 1},
                session=session,
            )
            await stamp_the_adoption(
                spielberichte_collection=spielberichte_collection,
                spiel_id=spiel_id,
                version=uebernimmt_bericht,
                seiten=seiten_of(gespeichert),
                now=now,
                session=session,
            )

        return FLPatchSpielDataResponse(advanced_to=advanced_to, released_sides=released_sides, bracket_faults=bracket_faults)

    # `with_transaction` rather than a bare `start_transaction`: two saves in one season can
    # write-conflict on the same advanced fixture, and the callback is safe to retry, every pass
    # re-reading what it judges.
    async with transaction_session(db) as session:
        return await session.with_transaction(write_and_resolve_the_bracket)
