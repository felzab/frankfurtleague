from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Query, Request
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.saisons.crud import pull_current_saison_id, pull_saison_id_and_rules
from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.crud import (
    advance_bracket_winners,
    anchor_a_booked_referee,
    anchor_a_booked_venue,
    find_bracket_faults,
    preview_bracket_after_patch,
    pull_booked_referee,
    pull_booked_venue,
    pull_saison_membership,
    pull_slot_holders,
    release_spieltag_sides,
    report_prior_paarungen,
)
from app.api.spiele.schemas import (
    SONDEREREIGNIS_RECORDING_AN_ABSENCE,
    FLPatchSpielDataPayload,
    FLPatchSpielDataResponse,
    FLPatchSpielePaarungenPayload,
    FLPatchSpielePaarungenResponse,
    FLPatchSpielPaarungPayload,
    FLSpiel,
    FLSpielAdvancement,
    FLSpieleActionRequiredResponse,
    FLSpieleAdminListResponse,
    FLSpieleAdminSingleResponse,
    FLSpieleFilterParams,
    FLSpielJoinedAdmin,
    FLSpielJoinedAdminListAdapter,
    FLSpielListAdapter,
    FLSpielReleasedSide,
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
    find_references_to_anchor,
    find_result_removal_refusal,
    find_state_refusal,
    find_wiring_refusal,
    judge_spieltag_occupancy,
    slots_booked_against,
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
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, DUPLICATE_KEY_RESPONSE, stores_nothing, stores_nothing_when
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin, verify_actor_is_admin
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.custom import CustomObjectId, CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spiele",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


# Two static segments, matching `GET /saisons/list/admin`. Declared before `{spiel_id}/admin`, whose
# only separation from this path is the `objectid` convertor (`docs/backend/spec.md :: I37`).
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
    saison_id: str | None = None,
    today: str = Depends(get_german_date_str),
) -> FLSpieleActionRequiredResponse:
    """List Spiele needing attention, and the bracket faults among them.

    Qualifying: cancelled, missing a date, time, venue or referee, past with no result, or a
    knockout side with neither team nor `quelle`. Scoped to `saison_id`, the active season when none
    is named, which answers 404 while no season is active.

    The faults include a fixture still to be played that is booked onto a retired venue or referee,
    and one whose venue or referee another fixture of any season claims less than four hours away.
    """

    # Resolved as every other admin read resolves an omitted season: the selector sends none for the
    # running one, so spanning the archive here would bury its queue under every other season's.
    if saison_id is None:
        saison_id = await pull_current_saison_id(saisons_collection=saisons_collection)

    # The joined pipeline, as the public reads use: the raw shape carries no `austritt`, so
    # this list would silently omit a badge the grids show (`docs/backend/spec.md :: I32`).
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

    return FLSpieleActionRequiredResponse(spiele=list(by_id.values()), bracket_faults=bracket_faults)


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
        raise DocumentNotFoundException(filter={"_id": spiel_id}, error_code=DOCUMENT_NOT_FOUND)

    return FLSpieleAdminSingleResponse(spiel=FLSpielJoinedAdmin.model_validate(spiele_raw[0]))


async def _write_spiel_data(
    entries: Sequence[tuple[CustomObjectId, FLPatchSpielDataPayload | FLPatchSpielPaarungPayload]],
    db: AsyncMongoClient,
    spiele_collection: AsyncCollection,
    teams_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    spieltage_collection: AsyncCollection,
    spielorte_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    dry_run: bool,
) -> list[FLPatchSpielDataResponse]:
    """One implementation behind every write route, so a narrowed restore meets every rule a wholesale save does.

    A LIST because a replay commits every fixture or none (`docs/backend/spec.md :: I222`).
    """

    async def season_of(session: AsyncClientSession | None, spiel_id: CustomObjectId) -> tuple[str, FLSaisonRules]:
        """Which season a fixture is played in, and under which rules.

        The `saison_id` read is what answers 404 for an id no fixture holds; inside the transaction
        below, that raise takes every fixture already written back with it.
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
        session: AsyncClientSession | None,
        spiel_id: CustomObjectId,
        submitted: FLPatchSpielDataPayload | FLPatchSpielPaarungPayload,
        saison_id: str,
        saison_rules: FLSaisonRules,
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

        # Ahead of every refusal rather than beside the date rule: a narrowed entry carries a subset,
        # so a rule reading a field it omits sees the fixture's own value rather than nothing
        # (`docs/backend/spec.md :: I108`).
        stored = stored_in_slice(spiel_id, season)

        # Completed HERE and never at the write, so the refusals, the composed result and the
        # resolution below all judge the one shape they were written against.
        spiel_data = submitted if isinstance(submitted, FLPatchSpielDataPayload) else submitted.completed_with(stored)

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
        refuse(find_booking_refusal(spiel_id, spiel_data, season, resolved, saison_rules))

        claims = find_claims_made(stored, spiel_data)
        holders = await pull_slot_holders(spiele_collection=spiele_collection, claims=claims, session=session)
        refuse(
            find_clash_refusal(
                datum=spiel_data.datum,
                uhrzeit=spiel_data.uhrzeit,
                booked=[slot for claim in claims for slot in slots_booked_against(claim, holders, spiel_id=spiel_id)],
            )
        )

        return (
            season,
            verdict.releases,
            apply_payload_to_spiel(stored, spiel_data, saison_rules, resolved),
            # Returned rather than left to the caller to derive, so every transaction judging here
            # anchors what the two rules above judged (`docs/backend/spec.md` §1.3 step 1l).
            find_references_to_anchor(stored, spiel_data, saison_rules),
        )

    async def preview(spiel_id: CustomObjectId, spiel_data: FLPatchSpielDataPayload | FLPatchSpielPaarungPayload) -> FLPatchSpielDataResponse:
        """What this payload would move and destroy, judged against the season as it stands and written nowhere."""

        saison_id, saison_rules = await season_of(None, spiel_id)
        season, releases, patched, _ = await judge(None, spiel_id, spiel_data, saison_id, saison_rules)
        advanced_to, released_sides, bracket_faults = await preview_bracket_after_patch(
            teams_collection=teams_collection,
            saison_id=saison_id,
            rules=saison_rules,
            season=season,
            patched=patched,
            releases=releases,
        )

        return FLPatchSpielDataResponse(
            advanced_to=advanced_to,
            released_sides=released_sides,
            bracket_faults=bracket_faults,
            prior_paarungen=report_prior_paarungen(spiel_id, season, patched, advanced_to, released_sides),
        )

    if dry_run:
        # No transaction: a preview that took a write lock would be paying for a question.
        return [await preview(spiel_id, spiel_data) for spiel_id, spiel_data in entries]

    async def write_and_resolve_the_bracket(session: AsyncClientSession) -> list[FLPatchSpielDataResponse]:
        reports: list[FLPatchSpielDataResponse] = []

        # The list's own order, never re-sorted here: a fixture fed by another is restorable only
        # once that other one has put its winner back (`docs/backend/spec.md :: I223`).
        for spiel_id, spiel_data in entries:
            # Inside the transaction, so a retry after a write conflict revalidates against fresh reads.
            saison_id, saison_rules = await season_of(session, spiel_id)
            season, releases, patched, anchored = await judge(session, spiel_id, spiel_data, saison_id, saison_rules)

            # From the NORMALISED fixture, with keys off the PAYLOAD's field set: keys off the fixture
            # would put `saison_id`, `saison_phase`, `spiel_nr` and `spieltag_id` in the `$set`.
            document = patched.model_dump(context={"keep_oid": True}, include={*FLPatchSpielDataPayload.model_fields, "ergebnis"})

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
            # sets (`docs/backend/spec.md :: I53`).
            for booked in (anchored, *booked_again_by_the_release, *booked_again_by_the_resolution):
                if booked.spielort_id is not None:
                    await anchor_a_booked_venue(spielorte_collection=spielorte_collection, spielort_id=booked.spielort_id, session=session)
                if booked.schiedsrichter_id is not None:
                    await anchor_a_booked_referee(
                        schiedsrichter_collection=schiedsrichter_collection, schiedsrichter_id=booked.schiedsrichter_id, session=session
                    )

            reports.append(
                FLPatchSpielDataResponse(
                    advanced_to=advanced_to,
                    released_sides=released_sides,
                    bracket_faults=bracket_faults,
                    # `season` and not a read of its own: it is the slice this pass judged on, so a
                    # fixture the two writes above both reached is reported as it stood before either.
                    prior_paarungen=report_prior_paarungen(spiel_id, season, patched, advanced_to, released_sides),
                )
            )

        return reports

    # `with_transaction` rather than a bare `start_transaction`: two saves in one season can
    # write-conflict on the same advanced fixture, and the callback is safe to retry, every pass
    # re-reading what it judges.
    async with db.start_session() as session:
        return await session.with_transaction(write_and_resolve_the_bracket)


@stores_nothing_when("dry_run")
async def previewing(
    request: Request,
    dry_run: Annotated[bool, Query(description="Report what this payload would move and destroy, and write nothing")] = False,
) -> bool:
    # Declared before any database call, so a deadline cutting the preview answers a failed read.
    if dry_run:
        stores_nothing(request)
    return dry_run


@router.patch(
    by_id("spiel_id"),
    response_model=FLPatchSpielDataResponse,
    summary="Update a Spiel",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
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
    dry_run: Annotated[bool, Depends(previewing)] = False,
) -> FLPatchSpielDataResponse:
    """
    Update one Spiel and resolve the season's bracket.

    The payload is written wholesale: an omitted field is overwritten, and every name it carries is
    composed by the server. A result can fill or empty the slots below it, each named in `advanced_to`,
    and every fixture this call changed arrives in `prior_paarungen` as it stood before it — this one
    leading the list, and carrying the fields beyond its Paarung that this payload replaced.
    """

    written = await _write_spiel_data(
        [(spiel_id, spiel_data)],
        db=db,
        spiele_collection=spiele_collection,
        teams_collection=teams_collection,
        saisons_collection=saisons_collection,
        saison_teams_collection=saison_teams_collection,
        spieltage_collection=spieltage_collection,
        spielorte_collection=spielorte_collection,
        schiedsrichter_collection=schiedsrichter_collection,
        dry_run=dry_run,
    )

    return written[0]


# A static segment under the collection rather than a mode on the patch above: the body names the
# fixtures it restores, and a tagged body would make every existing caller send the tag.
@router.patch(
    "/paarungen",
    response_model=FLPatchSpielePaarungenResponse,
    summary="Restore the Paarungen one save moved",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
)
async def patch_spiele_paarungen(
    payload: Annotated[FLPatchSpielePaarungenPayload, Body()],
    db: DBClient,
    spiele_collection: SpieleCollection,
    teams_collection: TeamsCollection,
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spieltage_collection: SpieltageCollection,
    spielorte_collection: SpielorteCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
) -> FLPatchSpielePaarungenResponse:
    """
    Put every fixture one save moved back as it stood, in ONE transaction, and resolve the bracket again.

    **All of it lands or none of it does.** A refusal on any entry takes the entries already written
    back with it, so a replay never leaves a season half restored — which it otherwise would, the
    leading entry's resolution being what empties the scorelines the entries after it put back.

    **The list is replayed in the order it arrives and is never re-sorted**, that order being
    `prior_paarungen`'s: a fixture is restored after whatever feeds it, or its occupant is refused as
    a hand-set team on a slot its `quelle` maintains.

    Each entry carries the four fields a bracket resolution can rewrite, and beyond them only the
    ones its `other_fields.replaced` names: the date, the venue, the referee, the note and both
    `quelle`s are otherwise read from the stored document rather than from the request, so a value
    somebody moved since that save survives. Every refusal, and the resolution itself, are
    `PATCH /spiele/{spiel_id}`'s.

    `advanced_to` and `released_sides` report what the replay cost fixtures it was NOT asked to
    restore; one it puts back afterwards is the order doing its work rather than a loss. No
    `dry_run`: what these bodies would move is what the save they undo already reported.
    """

    reports = await _write_spiel_data(
        [(paarung.spiel_id, paarung) for paarung in payload.paarungen],
        db=db,
        spiele_collection=spiele_collection,
        teams_collection=teams_collection,
        saisons_collection=saisons_collection,
        saison_teams_collection=saison_teams_collection,
        spieltage_collection=spieltage_collection,
        spielorte_collection=spielorte_collection,
        schiedsrichter_collection=schiedsrichter_collection,
        dry_run=False,
    )

    # Where each fixture sits in the replay, which is what tells a rewrite this list repairs further
    # down from one an admin has actually lost (`docs/backend/spec.md :: I223`).
    restored_at = {paarung.spiel_id: position for position, paarung in enumerate(payload.paarungen)}

    def restored_later(spiel_id: CustomObjectId, position: int) -> bool:
        return restored_at.get(spiel_id, position) > position

    # The FIRST report of a key wins: a later entry's resolution can rewrite a fixture an earlier one
    # already emptied, and only the first names a result that was really standing there.
    advanced_to: dict[CustomObjectId, FLSpielAdvancement] = {}

    # Keyed on the side too, one fixture being able to give up both.
    released_sides: dict[tuple[CustomObjectId, str], FLSpielReleasedSide] = {}

    for position, report in enumerate(reports):
        for advancement in report.advanced_to:
            if not restored_later(advancement.spiel_id, position):
                advanced_to.setdefault(advancement.spiel_id, advancement)

        for release in report.released_sides:
            if not restored_later(release.spiel_id, position):
                released_sides.setdefault((release.spiel_id, release.side), release)

    return FLPatchSpielePaarungenResponse(
        advanced_to=list(advanced_to.values()),
        released_sides=list(released_sides.values()),
        # The LAST pass's, never a union: an earlier one's faults describe a season the replay moved
        # past, and only the committed state is one an admin can act on.
        bracket_faults=reports[-1].bracket_faults,
    )
