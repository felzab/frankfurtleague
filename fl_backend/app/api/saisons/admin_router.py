from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Annotated, Any, Literal, NamedTuple

from fastapi import APIRouter, Body, status
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError
from pymongo.results import InsertOneResult

from app.api.aufstellungen.crud import remove_the_seasons_aufstellungen
from app.api.grants.guard import ADMIN_TIER
from app.api.invitations.schemas import (
    FLInvitation,
    FLInvitationLinkRow,
    FLInvitationsMailResponse,
)
from app.api.invitations.services import (
    LIVE_INVITATION,
    WITHOUT_TOKEN_HASH,
    InvitationMailPlan,
    build_live_team_filter,
    compose_invitation,
    compose_revocation_update,
    find_invitation_saison_past_refusal,
    owed_invitation_mails,
    plan_invitation_mail,
)
from app.api.outbox.services import enqueue_mails
from app.api.saisons.crud import (
    count_spiele_by_saison,
    count_teams_by_saison,
    listed_create_state,
    pull_create_state,
    pull_finale_by_saison,
    saisons_with_a_spiel_taken_place,
)
from app.api.saisons.overview import SPIELE_AS, FLSaisonOverviewResponse, build_overview_pipeline, overview_of
from app.api.saisons.schemas import (
    FLGenerateSpielplanPayload,
    FLGruppenNamesAdapter,
    FLPatchSaisonPayload,
    FLPostSaisonPayload,
    FLPostSaisonResponse,
    FLSaisonActRefusals,
    FLSaisonAdmin,
    FLSaisonAdminIncomingTeam,
    FLSaisonAdminResponse,
    FLSaisonAdminTeam,
    FLSaisonDrawn,
    FLSaisonRules,
    FLSaisonsAdminListResponse,
    FLSaisonsAdminRefusals,
    FLSaisonSpielplan,
    FLSwapGruppenPayload,
)
from app.api.saisons.services import (
    RECORDED_FACT_FIELDS,
    decided_podium,
    find_activation_refusal,
    find_berichte_refusal,
    find_gruppe_swap_refusal,
    find_rules_freeze_refusal,
    find_rules_refusal,
    find_saison_create_refusal,
    find_saison_span_refusal,
    find_saison_start_austritt_refusal,
    find_saison_start_refusal,
    find_shape_refusal,
    find_spielplan_refusal,
    find_undraw_refusal,
    has_started,
    holds_a_recorded_fact,
    workable_shapes,
)
from app.api.saisons.spielplan import EnteredTeam, draw_spielplan
from app.api.spielberichte.crud import count_submitted_berichte
from app.api.spiele.crud import bracket_faults_of
from app.api.spiele.schemas import TAKEN_PLACE_FIELDS, FLSpielJoinedInternalListAdapter, has_taken_place, unplayed_filter
from app.api.spieler.services import CAPPED_KADER_ROW
from app.core import clock
from app.core.codes import Code
from app.core.concurrency import concurrently
from app.core.crud import (
    GERMAN_COLLATION,
    VERSION_FIELD,
    aggregate_many_from_db,
    anchor_in_db,
    delete_many_from_db,
    patch_many_in_db,
    patch_one_in_db,
    post_many_to_db,
    post_one_to_db,
    pull_many_from_db,
    pull_one_from_db,
    pull_whole_from_db,
    refuse,
    refuse_faults,
)
from app.core.dependencies import (
    AufstellungenCollection,
    BanListCollection,
    DBClient,
    GermanDay,
    GermanyNow,
    InvitationsCollection,
    InvitationsReadCollection,
    OutboxCollection,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonsReadCollection,
    SaisonTeamsCollection,
    SaisonTeamsReadCollection,
    SchiedsrichterReadCollection,
    SpielberichteCollection,
    SpielberichteReadCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
    SpieleReadCollection,
    SpielorteReadCollection,
    SpieltageCollection,
    SpieltageReadCollection,
    TeamsReadCollection,
)
from app.core.exceptions import APIError, DocumentNotFoundError, as_judged_on_stored_state
from app.core.logging import fl_logger
from app.core.readonly import ReadCollection
from app.core.recording import ACT_BY_SYSTEM, record_act
from app.core.transactions import transact
from app.shared.schemas.literals import FLGruppenNames
from app.shared.schemas.responses import FLVersionResponse

router = APIRouter(
    prefix="/saisons",
    dependencies=ADMIN_TIER,
)


async def _rewrite_gruppenphase_sides(
    *,
    spiele: Sequence[Mapping[str, Any]],
    team_ids: Sequence[Any],
    spiele_collection: AsyncCollection,
    session: AsyncClientSession,
) -> None:
    """Rewrite each club's side of these fixtures to the other, by its `team_id` alone.

    Neither the club's name nor `tore` moves: every read joins a side's name from its season row, and goals belong to
    whoever scored them: a swap runs only before the season's start, when the save refuses a result. Named by `_id` from a snapshot
    read before any write: filtering on the club would let the second pass match what the first just wrote and swap it
    back.
    """

    other_of = {team_ids[0]: team_ids[1], team_ids[1]: team_ids[0]}

    # One `update_many` writes one path with one value, so the passes split by `(slot, occupant)`.
    by_pass: dict[tuple[str, Any], list[Any]] = {}
    for spiel in spiele:
        for slot in ("team1", "team2"):
            occupant = (spiel.get(slot) or {}).get("team_id")
            if occupant in other_of:
                by_pass.setdefault((slot, occupant), []).append(spiel["_id"])

    for (slot, occupant), spiel_ids in by_pass.items():
        await patch_many_in_db(
            collection=spiele_collection,
            db_filter={"_id": {"$in": spiel_ids}},
            update={"$set": {f"{slot}.team_id": other_of[occupant]}},
            session=session,
        )


@router.get("", summary="Every Saison for the admin surfaces")
async def get_saisons_admin(
    saisons_collection: SaisonsReadCollection,
    spiele_collection: SpieleReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    today: GermanDay,
) -> FLSaisonsAdminListResponse:
    """Every season, the `future` ones included, each with its start, play and decision states and its counts.

    `next_saison_id` is the id the next create mints, and `refusals.create` the code that create would be refused with
    now, or null.
    """

    # Oldest first: a season's id is its starting year.
    saisons_raw = await pull_whole_from_db(collection=saisons_collection, db_filter={}, sort_by=[("_id", 1)])

    saison_ids = [str(raw["_id"]) for raw in saisons_raw]
    finale_by_saison, teams_by_saison, spiele_by_saison = await concurrently(
        pull_finale_by_saison(spiele_collection=spiele_collection, saison_ids=saison_ids),
        count_teams_by_saison(saison_teams_collection=saison_teams_collection, saison_ids=saison_ids),
        count_spiele_by_saison(spiele_collection=spiele_collection, saison_ids=saison_ids),
    )
    next_saison_id, future_stands = listed_create_state(saisons_raw)
    create_refusal = find_saison_create_refusal(future_stands=future_stands)
    saisons = [
        {
            **raw,
            "begun": has_started(start_date=str(raw["start_date"]), today=today),
            "decided": decided_podium(finale_by_saison.get(str(raw["_id"]), [])) is not None,
            "count_teams": teams_by_saison.get(str(raw["_id"]), 0),
            "count_spiele": spiele_by_saison.get(str(raw["_id"]), 0),
        }
        for raw in saisons_raw
    ]

    return FLSaisonsAdminListResponse.model_validate(
        {
            "saisons": saisons,
            "next_saison_id": next_saison_id,
            "refusals": FLSaisonsAdminRefusals(create=None if create_refusal is None else create_refusal.error_code),
        }
    )


# Mounted after the public router, whose `/frame` and `/landing` it would otherwise take as season ids: routes match in
# the order they are mounted, and a season id is a plain four-character string no convertor tells apart.
@router.get("/{saison_id}", summary="One Saison for the admin editor")
async def get_saison_admin(
    saison_id: str,
    saisons_collection: SaisonsReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    spiele_collection: SpieleReadCollection,
    spieltage_collection: SpieltageReadCollection,
    teams_collection: TeamsReadCollection,
    spielberichte_collection: SpielberichteReadCollection,
    invitations_collection: InvitationsReadCollection,
    today: GermanDay,
) -> FLSaisonAdminResponse:
    """What the season editor shows in one read: its season, clubs, shapes and matchdays, its acts' states and its links.

    The season is served a `future` one included, and every flag and every refusal is judged as the write it stands for
    judges it, so an act is offered exactly where its write takes it.
    """

    # Outside a transaction: a write landing between this read and a press is judged by the press. First and alone: a
    # season id naming nothing raises the 404 here, and the activation is judged on the status read.
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id})
    saison_status = str(saison_raw["status"])

    rows, count_spieltage, teams, finale_by_saison, activation, recorded_rows, berichte, planned = await concurrently(
        # Whole: a truncated list offers a club the replacement refuses as entered.
        pull_whole_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id},
            projection=["team_id", "name", "shorthand", "gruppe", "austritt"],
            sort_by=[("name", 1)],
            collation=GERMAN_COLLATION,
        ),
        spieltage_collection.count_documents({"saison_id": saison_id}),
        pull_whole_from_db(
            collection=teams_collection,
            db_filter={"inactive_since": None},
            projection=["name", "shorthand"],
            sort_by=[("name", 1)],
            collation=GERMAN_COLLATION,
        ),
        pull_finale_by_saison(spiele_collection=spiele_collection, saison_ids=[saison_id]),
        _judge_the_activation(
            saison_id=saison_id,
            target_status=saison_status,
            saisons_collection=saisons_collection,
            spiele_collection=spiele_collection,
            spieltage_collection=spieltage_collection,
            session=None,
        ),
        _pull_recorded_fact_rows(spiele_collection=spiele_collection, saison_id=saison_id, session=None),
        count_submitted_berichte(spielberichte_collection=spielberichte_collection, saison_id=saison_id, session=None),
        _plan_the_mail(
            saison_id=saison_id,
            saison_teams_collection=saison_teams_collection,
            invitations_collection=invitations_collection,
        ),
    )
    recorded_spiele = sum(1 for spiel in recorded_rows if holds_a_recorded_fact(spiel))
    # The rows a first draw refuses on, and the undraw and the replace remove: the season is drawn exactly while it holds
    # one, so the editor offers the draw's acts where their writes take them. The draw that wrote them dated the season.
    spielplan = (
        None
        if not recorded_rows
        else FLSaisonDrawn(
            spieltage=count_spieltage,
            spiele=len(recorded_rows),
            generated_at=FLSaisonSpielplan.model_validate(saison_raw["spielplan"]).generated_at,
        )
    )

    def code_of(refusal: APIError | None) -> Code | None:
        return None if refusal is None else refusal.error_code

    entered = {row["team_id"] for row in rows}
    saison = FLSaisonAdmin.model_validate(
        {
            **saison_raw,
            "begun": has_started(start_date=str(saison_raw["start_date"]), today=today),
            "taken_place": any(has_taken_place(spiel) for spiel in recorded_rows),
            "decided": decided_podium(finale_by_saison.get(saison_id, [])) is not None,
        }
    )

    # Withdrawn rows included, as the draw counts them: a club that left keeps its place.
    occupancy: dict[FLGruppenNames, int] = {}
    for row in rows:
        occupancy[row["gruppe"]] = occupancy.get(row["gruppe"], 0) + 1

    def draw_refusal(*, replace: bool) -> APIError | None:
        return find_spielplan_refusal(
            saison_status=saison_status,
            spiele_drawn=len(recorded_rows),
            rules=saison.rules,
            occupancy_by_gruppe=occupancy,
            replace=replace,
            recorded_spiele=recorded_spiele,
        )

    return FLSaisonAdminResponse(
        saison=saison,
        teams=[FLSaisonAdminTeam.model_validate(row) for row in rows],
        incoming_teams=[FLSaisonAdminIncomingTeam.model_validate(team) for team in teams if team["_id"] not in entered],
        shapes=workable_shapes(saison.rules),
        spielplan=spielplan,
        refusals=FLSaisonActRefusals(
            activate=code_of(activation[1]),
            # The draw's own judgement of the stored rules, the ones both presses draw, over the clubs entered.
            create=code_of(draw_refusal(replace=False)),
            recreate=code_of(draw_refusal(replace=True) or find_berichte_refusal(berichte=berichte)),
            undraw=code_of(_find_undraw_refusal_of(saison_status=saison_status, recorded_spiele=recorded_spiele, berichte=berichte)),
        ),
        invitations=[
            FLInvitationLinkRow(
                team_id=team.team["team_id"],
                team_name=team.team["name"],
                skipped=team.plan.skipped,
                has_link=team.live is not None,
                sent_at=None if team.live is None else FLInvitation.model_validate(team.live).sent_at,
            )
            for team in planned
        ],
    )


@router.get("/{saison_id}/overview", summary="One Saison's open work, card by card")
async def get_saison_overview(
    saison_id: str,
    saisons_collection: SaisonsReadCollection,
    spiele_collection: SpieleReadCollection,
    teams_collection: TeamsReadCollection,
    spielorte_collection: SpielorteReadCollection,
    schiedsrichter_collection: SchiedsrichterReadCollection,
    germany_now: GermanyNow,
) -> FLSaisonOverviewResponse:
    """The administrator's Übersicht for one season: its open work on the cards `due`, `ergebnisse`, `dates` and `bewerbungen`.

    Every card is served, an empty one included, and each row carries what its act needs, the fixture with its `version`
    among it.
    """

    read = await aggregate_many_from_db(
        collection=saisons_collection, pipeline=build_overview_pipeline(saison_id=saison_id, today=clock.german_day(germany_now))
    )
    if not read:
        raise DocumentNotFoundError()

    (season,) = read
    # The internal fixture, which the fault walk needs; every row serves it in the admin shape.
    spiele = FLSpielJoinedInternalListAdapter.validate_python(season[SPIELE_AS])
    faults = await bracket_faults_of(
        spiele=spiele,
        rules=FLSaisonRules.model_validate(season["rules"]),
        saison_id=saison_id,
        spiele_collection=spiele_collection,
        teams_collection=teams_collection,
        spielorte_collection=spielorte_collection,
        schiedsrichter_collection=schiedsrichter_collection,
    )

    return overview_of(read=season, spiele=spiele, faults=faults, now=germany_now)


@router.post(
    "",
    status_code=201,
    summary="Create a Saison",
)
async def post_saison(
    saison_data: FLPostSaisonPayload,
    saisons_collection: SaisonsCollection,
    db: DBClient,
) -> FLPostSaisonResponse:
    """Create the next season, always `future`, from its two days, answering the id it minted.

    Its id follows the newest stored season's and its rules carry on from it, its two windows start closed, and a league
    holds at most one planned season.
    """

    async def enter_the_season(session: AsyncClientSession) -> InsertOneResult:
        state = await pull_create_state(saisons_collection=saisons_collection, session=session)
        refuse(find_saison_create_refusal(future_stands=state.future_stands))
        refuse(find_shape_refusal(stored=None, proposed=state.rules))
        rules = find_rules_refusal(stored=None, proposed=state.rules, occupancy_by_gruppe={})
        refuse_faults(
            rules,
            # Behind the rules: the season's length is read off their schedule.
            find_saison_span_refusal(
                start_date=saison_data.start_date,
                end_date=saison_data.end_date,
                rules=None if rules else state.rules,
                spieltag_spans=[],
            ),
        )
        created = await post_one_to_db(
            collection=saisons_collection,
            document={
                **saison_data.model_dump(mode="json"),
                "rules": state.rules.model_dump(mode="json"),
                "bewerbung": None,
                "registrierung": None,
                "_id": state.saison_id,
                "status": "future",
            },
            session=session,
        )
        await record_act(collection=saisons_collection, action="saison.created", saison_id=state.saison_id, session=session)

        return created

    post_operation = await transact(db, enter_the_season)

    return FLPostSaisonResponse(
        created_id=str(post_operation.inserted_id),
    )


@router.patch(
    "/{saison_id}",
    summary="Update a Saison's dates and rules",
)
async def patch_saison(
    saison_id: str,
    saison_data: FLPatchSaisonPayload,
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spiele_collection: SpieleCollection,
    spieltage_collection: SpieltageCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    db: DBClient,
    today: GermanDay,
) -> FLVersionResponse:
    """Save a season's dates and rules on the `version` it was read at, answering the version stored.

    What a started or drawn season has fixed is refused, as is a rule narrowed below what it holds; the start date is
    fixed once a fixture has taken place, and moves later only while no club's exit is stored.
    """

    async def judge_and_write_the_rules(session: AsyncClientSession) -> FLVersionResponse:
        # Through the session, and first: this opens the snapshot the update below is judged
        # against, so a rival writing `saisons` under the judgement conflicts instead of being
        # overwritten. A season id naming nothing raises the 404 here.
        stored_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)

        # Disqualified rows included: a team never leaves a season. The same read says whether any club's exit is
        # stored, which a start moved later must not leave on a season reading as unstarted.
        occupancy: dict[Any, int] = {}
        austritt_stored = False
        for row in await pull_whole_from_db(
            collection=saison_teams_collection, db_filter={"saison_id": saison_id}, projection={"gruppe": 1, "austritt": 1}, session=session
        ):
            gruppe = row.get("gruppe")
            if gruppe is not None:
                occupancy[gruppe] = occupancy.get(gruppe, 0) + 1
            austritt_stored = austritt_stored or row.get("austritt") is not None

        # In the transaction's session: what `rules_shape_after_spielplan` freezes is the draw, and only a draw or an
        # undraw moves whether a fixture stands, and both write `saisons`, so one landing under this save conflicts.
        drawn = await spiele_collection.find_one({"saison_id": saison_id}, {"_id": 1}, session=session) is not None

        largest_kader_rows = await (
            await saison_spieler_collection.aggregate(
                [
                    {"$match": {"saison_id": saison_id, **CAPPED_KADER_ROW}},
                    {"$group": {"_id": "$team_id", "held": {"$sum": 1}}},
                    {"$sort": {"held": -1}},
                    {"$limit": 1},
                ],
                session=session,
            )
        ).to_list(length=1)
        largest_kader = int(largest_kader_rows[0]["held"]) if largest_kader_rows else 0

        # Dated rows only, filtered in the query rather than after `str()`: a generated matchday carries
        # no span until somebody sets one, and a null stringified to "None" sorts above every date and
        # would be reported as falling outside the season.
        spieltag_spans = [
            (str(row["start"]), str(row["end"]))
            for row in await pull_whole_from_db(
                collection=spieltage_collection,
                db_filter={"saison_id": saison_id, "start": {"$ne": None}, "end": {"$ne": None}},
                projection={"start": 1, "end": 1},
                session=session,
            )
        ]

        taken_place = saison_id in await saisons_with_a_spiel_taken_place(
            spiele_collection=spiele_collection, saison_ids=[saison_id], session=session
        )

        # Validated, not read raw: a season missing a rules key fails here rather than comparing
        # against a default nobody chose.
        stored_rules = FLSaisonRules.model_validate(stored_raw["rules"])
        stored_start_date = str(stored_raw["start_date"])
        # The stored start, in this transaction's snapshot: the date on the payload is what the edit
        # proposes, and a freeze lifted by the same save that changes the rules would be no freeze. A season started
        # too early is unlocked by one save moving its start and a second changing its rules.
        refuse(
            find_rules_freeze_refusal(
                saison_status=str(stored_raw["status"]),
                started=has_started(start_date=stored_start_date, today=today),
                stored=stored_rules,
                proposed=saison_data.rules,
            )
        )
        refuse(find_shape_refusal(stored=stored_rules, proposed=saison_data.rules, drawn=drawn))
        rules = find_rules_refusal(stored=stored_rules, proposed=saison_data.rules, occupancy_by_gruppe=occupancy, largest_kader=largest_kader)
        refuse_faults(
            # First: a start that cannot move is a fact about the payload's own date, whatever its rules ask.
            find_saison_start_refusal(stored_start_date=stored_start_date, proposed_start_date=saison_data.start_date, taken_place=taken_place),
            find_saison_start_austritt_refusal(
                stored_start_date=stored_start_date, proposed_start_date=saison_data.start_date, austritt_stored=austritt_stored
            ),
            rules,
            # Behind the rules: the season's length is read off their schedule.
            find_saison_span_refusal(
                start_date=saison_data.start_date,
                end_date=saison_data.end_date,
                rules=None if rules else saison_data.rules,
                spieltag_spans=spieltag_spans,
            ),
        )

        # `AFTER`, read back inside the transaction at no extra round trip: the version answered is the one this commit stores.
        patched = await patch_one_in_db(
            collection=saisons_collection,
            db_filter={"_id": saison_id},
            update={"$set": saison_data.model_dump(mode="json", exclude={"version"})},
            expected_version=saison_data.version,
            session=session,
            return_document=ReturnDocument.AFTER,
        )
        await record_act(collection=saisons_collection, action="saison.changed", saison_id=saison_id, session=session)

        # A result is a write to `spiele` alone, so a moved start writes the fixtures it was judged on:
        # a result landing under the judgement conflicts, and the retry refuses on it. A squad entry
        # and a matchday re-dating anchor `saisons` themselves, so the season write above is theirs.
        if saison_data.start_date != stored_raw["start_date"]:
            await anchor_in_db(collection=spiele_collection, db_filter={"saison_id": saison_id}, session=session)

        return FLVersionResponse(version=patched[VERSION_FIELD])

    # `transact`, not a bare `start_transaction`: a draw and an undraw write `saisons` too,
    # so one landing under a `$set` that changes something conflicts, and the retry judges the
    # season as that rival left it.
    patched = await transact(db, judge_and_write_the_rules)

    return patched


async def _judge_the_activation(
    *,
    saison_id: str,
    target_status: str,
    saisons_collection: ReadCollection,
    spiele_collection: ReadCollection,
    spieltage_collection: ReadCollection,
    session: AsyncClientSession | None,
) -> tuple[list[Any], APIError | None]:
    """The seasons activating this one would close, and why it must be refused, or `None`.

    Read by the activation in its transaction and by the editor's read outside one, so the act the editor offers is the act
    the write takes.
    """

    # `$ne` on the target, so re-activating the current season is not blocked by its own fixtures.
    outgoing = await pull_whole_from_db(
        collection=saisons_collection,
        db_filter={"status": "active", "_id": {"$ne": saison_id}},
        projection={"_id": 1},
        session=session,
    )
    outgoing_ids = [row["_id"] for row in outgoing]

    # None where nothing but the target holds `active` -- a fresh league, or a re-activation. One match owing a result is
    # the whole question, so the lookup stops at the first.
    outgoing_unplayed = bool(outgoing_ids) and (
        await spiele_collection.find_one({"saison_id": {"$in": outgoing_ids}, **unplayed_filter()}, projection={"_id": 1}, session=session)
        is not None
    )

    # One call, so which of the two refusals an admin is shown stays the service's decision.
    # The target's own fixtures, not the outgoing season's: a league going live with nothing drawn
    # has no repair, activation writing `status` one way only.
    target_drawn = await spiele_collection.find_one({"saison_id": saison_id}, {"_id": 1}, session=session) is not None

    # `start` alone: `end` is dated with it, and a matchday half-dated is a shape no write here produces.
    spieltage_undated = await spieltage_collection.find_one({"saison_id": saison_id, "start": None}, {"_id": 1}, session=session) is not None

    return outgoing_ids, find_activation_refusal(
        target_status=target_status,
        target_drawn=target_drawn,
        spieltage_undated=spieltage_undated,
        outgoing_unplayed=outgoing_unplayed,
    )


async def _pull_recorded_fact_rows(
    *, spiele_collection: ReadCollection, saison_id: str, session: AsyncClientSession | None
) -> list[Mapping[str, Any]]:
    """The season's fixtures as `holds_a_recorded_fact` and `has_taken_place` read them.

    The first is what the planning window of the replace and the undraw turns on, the second the start's lock. The
    predicates' own fields, so the projection cannot fall behind what either reads: a venue, a referee or an admin's
    note is work a replace would destroy, and the window closes on one exactly as on a result. Read one over the cap and
    refused past it: a truncated list counts fewer records than the season holds, and the window opens on work the
    removal would destroy, or the start stays open while a fixture that took place fell past the page.
    """

    return await pull_whole_from_db(
        collection=spiele_collection,
        db_filter={"saison_id": saison_id},
        projection=[*RECORDED_FACT_FIELDS, *TAKEN_PLACE_FIELDS],
        session=session,
    )


def _find_undraw_refusal_of(*, saison_status: str, recorded_spiele: int, berichte: int) -> APIError | None:
    """The undraw's whole judgement, in its order: its window, then the reports it would delete."""

    return find_undraw_refusal(saison_status=saison_status, recorded_spiele=recorded_spiele) or find_berichte_refusal(berichte=berichte)


@router.post(
    "/{saison_id}/activate",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Make this the active Saison",
)
async def activate_saison(
    saison_id: str,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    spieltage_collection: SpieltageCollection,
    ban_list_collection: BanListCollection,
    db: DBClient,
) -> None:
    """Make this the active season, moving whichever holds `active` to `past`.

    The outgoing season must be finished, and every matchday of the target dated.
    """

    async def judge_and_roll_the_league_over(session: AsyncClientSession) -> None:
        # A season id naming nothing raises the 404 here, before any demotion.
        target_raw = await pull_one_from_db(
            collection=saisons_collection, db_filter={"_id": saison_id}, projection={"status": 1}, session=session
        )
        outgoing_ids, refusal = await _judge_the_activation(
            saison_id=saison_id,
            target_status=str(target_raw["status"]),
            saisons_collection=saisons_collection,
            spiele_collection=spiele_collection,
            spieltage_collection=spieltage_collection,
            session=session,
        )
        refuse(refusal)

        # Before the promotion: `uniq_saison_active` is checked at each write rather than at the
        # commit, so promoting first meets the incumbent and aborts the rollover.
        await patch_many_in_db(
            collection=saisons_collection,
            db_filter={"status": "active", "_id": {"$ne": saison_id}},
            update={"$set": {"status": "past"}},
            session=session,
        )

        # Raises the target's version even where it is already `active`, so a rival demoting it under
        # this rollover conflicts with the write and the retry judges it `past`.
        await patch_one_in_db(
            collection=saisons_collection,
            db_filter={"_id": saison_id},
            update={"$set": {"status": "active"}},
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )

        # A fixture's save judges `saison_past` on a status it only reads, so the rollover writes what it writes:
        # one judged before this commit then conflicts, and its retry reads `past`. The club rows stay unanchored,
        # so a consent press committing across the rollover is not retried: the club move, the one row write
        # judging `saison_past`, and the club rename, which rewrites the rows of every season it reads as open, anchor
        # the season documents this demotion writes.
        if outgoing_ids:
            await anchor_in_db(collection=spiele_collection, db_filter={"saison_id": {"$in": outgoing_ids}}, session=session)

        await record_act(collection=saisons_collection, action="saison.activated", saison_id=saison_id, session=session)

        # `$lt` and not `$lte`: the season named on a row is the last one the ban covers, so the row
        # lapses on the activation of the season after it.
        lapsed = await delete_many_from_db(
            collection=ban_list_collection,
            db_filter={"barred_until_saison_id": {"$lt": saison_id}},
            session=session,
        )
        if lapsed.deleted_count:
            await record_act(
                collection=ban_list_collection,
                action="retention.bans",
                by=ACT_BY_SYSTEM,
                saison_id=saison_id,
                count=lapsed.deleted_count,
                session=session,
            )

    # `transact`, not a bare `start_transaction`: a draw filling the outgoing season or an
    # undraw emptying the target writes a season this one writes too, so it conflicts and the
    # retry judges the league again rather than closing it blind.
    await transact(db, judge_and_roll_the_league_over)


@router.post(
    "/{saison_id}/gruppen/swap",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Exchange two teams' groups",
)
async def swap_gruppen(
    saison_id: str,
    swap_data: FLSwapGruppenPayload,
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spiele_collection: SpieleCollection,
    db: DBClient,
    today: GermanDay,
) -> None:
    """Exchange the groups of two clubs entered in this season, as one write.

    Every group fixture fielding either club has that side rewritten with it, so each group stays a round robin; neither
    `tore` nor `austritt` moves.
    """

    # A read first, so an unknown season is a 404 rather than a 409 about clubs holding no row in it. It is also what
    # judges the path id ahead of every write: an id of any other width names no season.
    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])

    async def exchange_the_two_gruppen(session: AsyncClientSession) -> None:
        both_ids = [swap_data.team1_id, swap_data.team2_id]

        rows = await pull_whole_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "team_id": {"$in": both_ids}},
            projection=["team_id", "gruppe"],
            session=session,
        )
        # Each stored group judged against the closed set before the first write: one outside it aborts the exchange
        # rather than being written onto the other club.
        gruppe_of = {row["team_id"]: FLGruppenNamesAdapter.validate_python(row["gruppe"]) for row in rows}

        saison_raw = await pull_one_from_db(
            collection=saisons_collection, db_filter={"_id": saison_id}, projection={"status": 1, "start_date": 1}, session=session
        )
        # Anchored, so the start and the status this is judged on belong to its write set: `PATCH /saisons/{saison_id}`
        # moves the one and `activate_saison` the other, each writing this document, so either landing under the
        # judgement conflicts and the retry judges the season it left.
        await anchor_in_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)

        refuse(
            find_gruppe_swap_refusal(
                team1_gruppe=gruppe_of.get(swap_data.team1_id),
                team2_gruppe=gruppe_of.get(swap_data.team2_id),
                saison_status=str(saison_raw["status"]),
                started=has_started(start_date=str(saison_raw["start_date"]), today=today),
            )
        )

        gruppenphase_spiele = await pull_whole_from_db(
            collection=spiele_collection,
            db_filter={
                "saison_id": saison_id,
                "saison_phase": "gruppenphase",
                "$or": [{"team1.team_id": {"$in": both_ids}}, {"team2.team_id": {"$in": both_ids}}],
            },
            projection=["team1.team_id", "team2.team_id"],
            session=session,
        )

        await _rewrite_gruppenphase_sides(
            spiele=gruppenphase_spiele,
            team_ids=both_ids,
            spiele_collection=spiele_collection,
            session=session,
        )

        for team_id, target_gruppe in (
            (swap_data.team1_id, gruppe_of[swap_data.team2_id]),
            (swap_data.team2_id, gruppe_of[swap_data.team1_id]),
        ):
            # A row nothing matches raises, and that aborts the transaction: it takes the first
            # write back rather than leaving one group a club short.
            await patch_one_in_db(
                collection=saison_teams_collection,
                db_filter={"saison_id": saison_id, "team_id": team_id},
                update={"$set": {"gruppe": target_gruppe}},
                session=session,
                expected_version=None,
                return_document=ReturnDocument.BEFORE,
            )
        await record_act(collection=saisons_collection, action="saison.gruppen_swapped", saison_id=saison_id, session=session)

    # `transact`, not a bare `start_transaction`: two admins on one season can write-conflict,
    # and a retry judges these rows as the rival left them.
    await transact(db, exchange_the_two_gruppen)


@router.post(
    "/{saison_id}/spielplan",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Draw this Saison's Spielplan",
)
async def post_spielplan(
    saison_id: str,
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spiele_collection: SpieleCollection,
    spieltage_collection: SpieltageCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spielberichte_collection: SpielberichteCollection,
    aufstellungen_collection: AufstellungenCollection,
    db: DBClient,
    # An absent body is `replace: false`, so a first draw needs no confirmation and nothing replaces
    # a season by leaving the flag out.
    spielplan_data: Annotated[FLGenerateSpielplanPayload, Body(default_factory=FLGenerateSpielplanPayload)],
    today: GermanDay,
) -> None:
    """Draw the whole season at once, every matchday and every fixture undated, from the season's rules.

    `replace` first deletes what a planned season holds, its fixtures' confirmations, reports and line-ups with it;
    nothing writes the removed rows back.
    """

    # A read first, so an unknown season is a 404 rather than a refusal about what it does not hold.
    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])

    async def draw_the_whole_season(session: AsyncClientSession) -> None:
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)
        rules = FLSaisonRules.model_validate(saison_raw["rules"])

        # Whole: a truncated entry list draws a season short of teams and weighs a group occupancy no group holds.
        entered_rows = await pull_whole_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id},
            # `name` and `shorthand` off the junction: that is the name the season is played under,
            # and `teams` may since have been renamed.
            projection=["team_id", "gruppe", "name", "shorthand"],
            session=session,
        )

        occupancy: dict[FLGruppenNames, int] = {}
        for row in entered_rows:
            gruppe = row["gruppe"]
            occupancy[gruppe] = occupancy.get(gruppe, 0) + 1

        # Listed rather than counted: one read answers `spielplan_already_drawn` and supplies what
        # `spielplan_replace_outside_its_window` weighs, so the two cannot disagree about what a replace would destroy.
        stored_spiele = await _pull_recorded_fact_rows(spiele_collection=spiele_collection, saison_id=saison_id, session=session)

        refuse(
            find_spielplan_refusal(
                saison_status=str(saison_raw["status"]),
                spiele_drawn=len(stored_spiele),
                rules=rules,
                occupancy_by_gruppe=occupancy,
                replace=spielplan_data.replace,
                recorded_spiele=sum(1 for spiel in stored_spiele if holds_a_recorded_fact(spiel)),
            )
        )
        if spielplan_data.replace:
            # Ahead of the rules, so the administrator reads the reports first. A report written since this snapshot
            # anchors its fixture and the season, which the replace deletes and writes below, so the two conflict and the
            # retry counts it.
            refuse(
                find_berichte_refusal(
                    berichte=await count_submitted_berichte(
                        spielberichte_collection=spielberichte_collection, saison_id=saison_id, session=session
                    )
                )
            )

        # `stored=None` is the create's reading, and the one this wants: every rule judging the numbers alone fires on
        # the stored rules, which a save judged only against the rules it replaced, and every rule judging a standing
        # fixture is skipped, each of those weighing a draw about to cease to exist. On the status line alone: the draw's
        # body has no rules box for a field to name. The span is not judged again: every create and every save judge it
        # whole against the rules they store.
        refuse(find_shape_refusal(stored=None, proposed=rules))
        refuse(as_judged_on_stored_state(find_rules_refusal(stored=None, proposed=rules, occupancy_by_gruppe=occupancy)))

        # `find_wiring_refusal`, `judge_spieltag_occupancy`, `find_clash_refusal` and
        # `find_eligibility_refusal` are all unasked: each judges one payload against a stored season,
        # and would see a draw half written. The construction is what is verified instead.
        drawn = draw_spielplan(
            saison_id=saison_id,
            rules=rules,
            entered=[
                EnteredTeam(
                    row_id=row["_id"],
                    team_id=row["team_id"],
                    gruppe=row["gruppe"],
                    name=str(row["name"]),
                    shorthand=str(row["shorthand"]),
                )
                for row in entered_rows
            ],
        )

        # Both collections together, fixtures first, the reverse of the draw's write order, as the undraw removes them.
        if spielplan_data.replace:
            # Not extracted, though `delete_spielplan` repeats it: two sites are no pattern yet.
            await delete_many_from_db(collection=spielbestaetigungen_collection, db_filter={"saison_id": saison_id}, session=session)
            await delete_many_from_db(collection=spielberichte_collection, db_filter={"saison_id": saison_id}, session=session)
            await remove_the_seasons_aufstellungen(aufstellungen_collection=aufstellungen_collection, saison_id=saison_id, session=session)
            await delete_many_from_db(collection=spiele_collection, db_filter={"saison_id": saison_id}, session=session)
            await delete_many_from_db(collection=spieltage_collection, db_filter={"saison_id": saison_id}, session=session)

        # Matchdays first: every fixture already carries the `spieltag_id` of a row in this list, the
        # draw having generated both ids together rather than reading one back.
        await post_many_to_db(collection=spieltage_collection, documents=drawn.spieltage, session=session)
        await post_many_to_db(collection=spiele_collection, documents=drawn.spiele, session=session)

        watermark = FLSaisonSpielplan(generated_at=today)
        # Raises the season's `version`, though no form saves `spielplan`: the draw fixes what the rules form may still
        # save, so a form read before it is refused rather than saved over a drawn season.
        await patch_one_in_db(
            collection=saisons_collection,
            db_filter={"_id": saison_id},
            update={"$set": {"spielplan": watermark.model_dump(mode="json")}},
            session=session,
            # Nothing here reads the result, and `AFTER` would re-read the whole season inside the
            # transaction to build one.
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )
        await record_act(
            collection=saisons_collection,
            action="saison.spielplan_recreated" if spielplan_data.replace else "saison.spielplan_created",
            saison_id=saison_id,
            session=session,
        )

    # `transact`, not a bare `start_transaction`, and a retry is safe because the draw
    # generates its own ids and wires by `spiel_nr`, never by one.
    await transact(db, draw_the_whole_season)


@router.delete(
    "/{saison_id}/spielplan",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Undraw this Saison's Spielplan",
)
async def delete_spielplan(
    saison_id: str,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    spieltage_collection: SpieltageCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spielberichte_collection: SpielberichteCollection,
    aufstellungen_collection: AufstellungenCollection,
    db: DBClient,
) -> None:
    """Return the season to undrawn: its matchdays and fixtures, their confirmations, reports and line-ups, and the draw's day.

    Undoing the draw reopens the shape rules to an edit and the groups to an entry.
    """

    async def undraw_the_whole_season(session: AsyncClientSession) -> None:
        # A season id naming nothing raises the 404 here.
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"], session=session)

        # The stored rows, never the watermark: they are what the window weighs and the undraw removes.
        stored_spiele = await _pull_recorded_fact_rows(spiele_collection=spiele_collection, saison_id=saison_id, session=session)

        # A report written since this snapshot anchors its fixture and the season, which the undraw deletes and writes below,
        # so the two conflict and the retry counts it.
        refuse(
            _find_undraw_refusal_of(
                saison_status=str(saison_raw["status"]),
                recorded_spiele=sum(1 for spiel in stored_spiele if holds_a_recorded_fact(spiel)),
                berichte=await count_submitted_berichte(
                    spielberichte_collection=spielberichte_collection, saison_id=saison_id, session=session
                ),
            )
        )

        # Fixtures first, the reverse of the draw's write order. Confirmations, reports and line-ups go first of
        # all, each naming the fixture it is about.
        await delete_many_from_db(collection=spielbestaetigungen_collection, db_filter={"saison_id": saison_id}, session=session)
        await delete_many_from_db(collection=spielberichte_collection, db_filter={"saison_id": saison_id}, session=session)
        await remove_the_seasons_aufstellungen(aufstellungen_collection=aufstellungen_collection, saison_id=saison_id, session=session)
        await delete_many_from_db(collection=spiele_collection, db_filter={"saison_id": saison_id}, session=session)
        await delete_many_from_db(collection=spieltage_collection, db_filter={"saison_id": saison_id}, session=session)

        # Inside the transaction holding both removals: a season keeping its watermark while its fixtures
        # are gone would date a draw it no longer holds, and `$unset` is the shape a season nobody has drawn carries. It
        # raises the season's `version` as the draw's write does: the undraw reopens what the rules form may save.
        await patch_one_in_db(
            collection=saisons_collection,
            db_filter={"_id": saison_id},
            update={"$unset": {"spielplan": ""}},
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )
        await record_act(collection=saisons_collection, action="saison.spielplan_deleted", saison_id=saison_id, session=session)

    # `transact`, not a bare `start_transaction`, and a retry is safe because the undraw
    # removes a set by filter rather than by any id it read.
    await transact(db, undraw_the_whole_season)


async def _entered_teams(*, saison_teams_collection: ReadCollection, saison_id: str) -> list[Mapping[str, Any]]:
    """Every team this season holds, ordered as its other lists are.

    Read one over the cap and refused past it: a truncated list silently leaves teams unmailed, which is what this press
    exists to stop.
    """

    return await pull_whole_from_db(
        collection=saison_teams_collection,
        db_filter={"saison_id": saison_id},
        projection=["team_id", "name", "kontakte", "austritt"],
        sort_by=[("name", 1)],
        collation=GERMAN_COLLATION,
    )


class _PlannedTeam(NamedTuple):
    """One team as a press made now would treat it, beside the live link it holds."""

    team: Mapping[str, Any]
    live: Mapping[str, Any] | None
    plan: InvitationMailPlan


async def _plan_the_mail(
    *,
    saison_id: str,
    saison_teams_collection: ReadCollection,
    invitations_collection: ReadCollection,
) -> list[_PlannedTeam]:
    """Every team of the season planned by `plan_invitation_mail`, the function the press decides each team by.

    Read outside any transaction, for the editor's read: the press plans each team again in its own.
    """

    entered = await _entered_teams(saison_teams_collection=saison_teams_collection, saison_id=saison_id)
    team_ids = [team["team_id"] for team in entered]

    # Keyed on the teams just read rather than on the season alone: `uniq_invitation_live` makes that
    # at most one row per team, so this read cannot truncate and report a mailed team as unmailed.
    live = await pull_many_from_db(
        collection=invitations_collection,
        db_filter={"saison_id": saison_id, "team_id": {"$in": team_ids}, **LIVE_INVITATION},
        limit=len(team_ids) or 1,
        projection=dict(WITHOUT_TOKEN_HASH),
    )
    by_team = {row["team_id"]: row for row in live}

    planned: list[_PlannedTeam] = []
    for team in entered:
        invitation_raw = by_team.get(team["team_id"])
        plan = plan_invitation_mail(
            austritt=team.get("austritt"),
            kontakte=team.get("kontakte"),
            invitation_raw=invitation_raw,
        )
        planned.append(_PlannedTeam(team=team, live=invitation_raw, plan=plan))

    return planned


# What one team's share of the press came to, which the press's answer counts.
type _PressOutcome = Literal["mailed", "skipped", "failed"]


async def _mail_one_team(
    *,
    invitations_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    db: AsyncMongoClient,
    saison_id: str,
    team: Mapping[str, Any],
    records_the_press: bool,
    today: str,
    now: datetime,
) -> _PressOutcome:
    """One team's whole share of the press, its revoke, its fresh row and the mails it owes, in a transaction of its own.

    Per team rather than one for all: a season's worth of mints in one transaction would take back
    the teams already done on a write conflict. A team's commit holds its fresh row and every mail
    owed about it together, so no team is left holding a link nobody is owed.
    """

    async def mint_where_the_team_qualifies(session: AsyncClientSession) -> _PressOutcome:
        """The invite and its mails alone are read in-session.

        The withdrawal and the contacts come from the read before the loop, so a retry re-decides on those as they stood
        then.
        """

        live = await pull_many_from_db(
            collection=invitations_collection,
            db_filter=build_live_team_filter(saison_id=saison_id, team_id=team["team_id"]),
            limit=1,
            projection=dict(WITHOUT_TOKEN_HASH),
            session=session,
        )
        # A link already sent is read off the day stored on it, never off the Postausgang, whose row is erased a retention
        # after it settles: pressing twice mails nobody twice.
        plan = plan_invitation_mail(
            austritt=team.get("austritt"),
            kontakte=team.get("kontakte"),
            invitation_raw=live[0] if live else None,
        )

        if plan.skipped is not None:
            return "skipped"

        # Only where the read above found one: a team holding no link is spared the command.
        if live:
            await patch_many_in_db(
                collection=invitations_collection,
                db_filter=build_live_team_filter(saison_id=saison_id, team_id=team["team_id"]),
                update=compose_revocation_update(today=today),
                session=session,
            )

        post_operation = await post_one_to_db(
            collection=invitations_collection,
            # No link of its own: each mail below mints one at its hand-out.
            document=compose_invitation(saison_id=saison_id, team_id=team["team_id"], token_hashes=[], sent_at=today),
            session=session,
        )
        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=owed_invitation_mails(
                invitation_id=post_operation.inserted_id,
                team_id=team["team_id"],
                team_name=team["name"],
                saison_id=saison_id,
                recipient=plan.recipient,
                occasion="dispatch",
            ),
            now=now,
        )
        if records_the_press:
            await record_act(collection=invitations_collection, action="saison.invitations_dispatched", saison_id=saison_id, session=session)

        return "mailed"

    # Caught outside the session: a failure the session never sees leaves the transaction open on the
    # server.
    try:
        return await transact(db, mint_where_the_team_qualifies)
    except PyMongoError as failure:
        # Per team: every team already done is committed with its mails. A commit sent and never answered may have revoked
        # this team's link and owed its mails too, so its line says unknown rather than failed.
        uncertain = failure.has_error_label("UnknownTransactionCommitResult")
        fl_logger.error(
            "saisons.invitation_unminted",
            extra={
                "error_code": Code.UNKNOWN_OUTCOME if uncertain else Code.DATABASE_FAILED,
                "team_id": str(team["team_id"]),
                "saison_id": saison_id,
                "exception": type(failure).__name__,
            },
        )

        return "failed"


@router.post(
    "/{saison_id}/invitations/mail",
    summary="Mint every admitted team a link",
)
async def post_invitations_mail(
    saison_id: str,
    saison_teams_collection: SaisonTeamsCollection,
    invitations_collection: InvitationsCollection,
    saisons_collection: SaisonsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: GermanDay,
    germany_now: GermanyNow,
) -> FLInvitationsMailResponse:
    """Give every admitted team of this season a fresh registration link, revoking any it held, mailed to its confirmed seats.

    A team that has left the season, holds no confirmed seat or was already sent its live link is skipped and left as it
    was, so pressing twice mails nobody twice.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"])
    refuse(find_invitation_saison_past_refusal(saison_status=str(saison_raw["status"])))

    entered = await _entered_teams(saison_teams_collection=saison_teams_collection, saison_id=saison_id)

    # Sequential rather than gathered: each team opens its own session, and sixteen at once would
    # hold sixteen against a pool sized for the whole application.
    outcomes: list[_PressOutcome] = []
    for team in entered:
        outcomes.append(
            await _mail_one_team(
                invitations_collection=invitations_collection,
                outbox_collection=outbox_collection,
                db=db,
                saison_id=saison_id,
                team=team,
                # One press across a transaction per team is one act, its row in the first team's that mails: a write
                # after the loop would meet the deadline the loop spent, and answer 500 over teams already mailed.
                records_the_press="mailed" not in outcomes,
                today=today,
                now=germany_now,
            )
        )

    return FLInvitationsMailResponse(mailed=outcomes.count("mailed"), failed=outcomes.count("failed"))
