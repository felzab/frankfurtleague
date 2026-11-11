import asyncio
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Annotated, Any, Literal, NamedTuple

from fastapi import APIRouter, Body, Depends
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError
from pymongo.results import InsertOneResult

from app.api.aufstellungen.crud import remove_the_seasons_aufstellungen
from app.api.grants.guard import verify_actor_is_admin
from app.api.invitations.crud import owed_invitation_mails
from app.api.invitations.schemas import (
    FLInvitation,
    FLInvitationDispatchResponse,
    FLInvitationLinkRow,
)
from app.api.invitations.services import (
    LIVE_INVITATION,
    WITHOUT_TOKEN_HASH,
    InvitationDispatchPlan,
    build_live_team_filter,
    compose_invitation,
    compose_revocation_update,
    find_invitation_saison_past_refusal,
    plan_invitation_dispatch,
)
from app.api.outbox.services import enqueue_mails
from app.api.saisons.crud import (
    count_spiele_by_saison,
    count_teams_by_saison,
    pull_create_state,
    pull_finale_by_saison,
    saisons_with_a_spiel_taken_place,
)
from app.api.saisons.schemas import (
    FLActivateSaisonResponse,
    FLGenerateSpielplanPayload,
    FLGenerateSpielplanResponse,
    FLPatchSaisonPayload,
    FLPatchSaisonResponse,
    FLPostSaisonPayload,
    FLPostSaisonResponse,
    FLSaisonActRefusals,
    FLSaisonAdmin,
    FLSaisonAdminIncomingTeam,
    FLSaisonAdminListAdapter,
    FLSaisonAdminResponse,
    FLSaisonAdminTeam,
    FLSaisonDrawn,
    FLSaisonRules,
    FLSaisonsAdminListResponse,
    FLSaisonsAdminRefusals,
    FLSaisonSpielplan,
    FLSwapGruppenPayload,
    FLSwapGruppenResponse,
    FLUndrawSpielplanResponse,
)
from app.api.saisons.services import (
    RECORDED_FACT_FIELDS,
    as_the_draw_answers,
    decided_podium,
    find_activation_refusal,
    find_berichte_refusal,
    find_rules_freeze_refusal,
    find_rules_refusal,
    find_saison_create_refusal,
    find_saison_span_refusal,
    find_saison_start_austritt_refusal,
    find_saison_start_refusal,
    find_spielplan_refusal,
    find_undraw_refusal,
    has_started,
    holds_a_recorded_fact,
    unplayed_spiel_nrs,
    with_schedule,
    workable_shapes,
)
from app.api.saisons.spielplan import EnteredTeam, draw_spielplan
from app.api.spielberichte.crud import anchor_the_season_reported_in, count_submitted_berichte
from app.api.spiele.schemas import FLSpielListAdapter
from app.api.spieler.services import CAPPED_SQUAD_ROW
from app.api.teams.services import (
    TAKEN_PLACE_FIELDS,
    find_gruppe_swap_refusal,
    find_swap_pair_refusal,
    has_taken_place,
)
from app.core.codes import Code
from app.core.config import API_VERSION
from app.core.crud import (
    GERMAN_COLLATION,
    VERSION_FIELD,
    anchor_in_db,
    build_sort,
    delete_many_from_db,
    patch_many_in_db,
    patch_one_in_db,
    post_many_to_db,
    post_one_to_db,
    pull_many_from_db,
    pull_one_from_db,
    pull_whole_from_db,
    refuse,
)
from app.core.dependencies import (
    AufstellungenCollection,
    BanListCollection,
    DBClient,
    InvitationsCollection,
    InvitationsReadCollection,
    OutboxCollection,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonsReadCollection,
    SaisonTeamsCollection,
    SaisonTeamsReadCollection,
    SpielberichteCollection,
    SpielberichteReadCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
    SpieleReadCollection,
    SpieltageCollection,
    SpieltageReadCollection,
    TeamsReadCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exceptions import WriteRefusal
from app.core.logging import fl_logger
from app.core.readonly import ReadCollection
from app.core.recording import ACT_BY_SYSTEM, record_act
from app.core.security import bind_actor, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.schemas.literals import FLGruppenNames

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/saisons",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


async def _rewrite_gruppenphase_sides(
    *,
    spiele: Sequence[Mapping[str, Any]],
    team_ids: Sequence[Any],
    spiele_collection: AsyncCollection,
    session: AsyncClientSession,
) -> int:
    """Rewrite each club's side of these fixtures to the other, by its `team_id` alone.

    Neither the club's name nor `tore` moves: every read joins a side's name from its season row, and goals belong to
    whoever scored them, a swap running only on fixtures none of which has taken place. Named by `_id` from a snapshot
    read BEFORE any write: filtering on the club would let the second pass match what the first just wrote and swap it
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

    # The fixtures, not the sides: `modified_count` double-counts a fixture fielding both clubs, and
    # reports 0 where the value already matched.
    return len({spiel_id for spiel_ids in by_pass.values() for spiel_id in spiel_ids})


# Two segments, because `GET /saisons/{saison_id}` is declared first and would answer a single static
# one: a season id is a plain four-character string, so the `objectid` convertor cannot separate them.
@router.get("/list/admin", response_model=FLSaisonsAdminListResponse, summary="Every Saison for the admin surfaces")
async def get_saisons_admin(
    saisons_collection: SaisonsReadCollection,
    spiele_collection: SpieleReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    today: str = Depends(get_german_date_str),
) -> FLSaisonsAdminListResponse:
    """
    List every season, the `future` ones every base-tier read withholds included, each with its start, play and decision states.

    The admin surfaces read here because a season is created `future` and clubs are entered while it
    still is, so an admin who cannot see one cannot run the league. `begun` is the start every
    start lock refuses on, the swap's, the replacement's and the rules freeze's; `taken_place` is what
    fixes the start date (`saison_start_taken_place`); `decided` is the landing's own rule, all four places of the Finale in.
    `count_teams` counts every club row of the season, one that left included, and `count_spiele` its fixtures.
    `next_saison_id` is the id the next create mints, and `refusals.create` the code that create would be refused with
    now, by its own judgement, or null.
    """

    # Oldest first: a season's id is its starting year.
    saisons_raw = await pull_many_from_db(collection=saisons_collection, db_filter={}, sort_by=[("_id", 1)])

    saison_ids = [str(raw["_id"]) for raw in saisons_raw]
    taken_place, finale_by_saison, teams_by_saison, spiele_by_saison, create_state = await asyncio.gather(
        saisons_with_a_spiel_taken_place(spiele_collection=spiele_collection, saison_ids=saison_ids, session=None),
        pull_finale_by_saison(spiele_collection=spiele_collection, saison_ids=saison_ids),
        count_teams_by_saison(saison_teams_collection=saison_teams_collection, saison_ids=saison_ids),
        count_spiele_by_saison(spiele_collection=spiele_collection, saison_ids=saison_ids),
        pull_create_state(saisons_collection=saisons_collection),
    )
    create_refusal = find_saison_create_refusal(future_stands=create_state.future_stands)
    saisons = [
        {
            **with_schedule(raw),
            "begun": has_started(start_date=str(raw["start_date"]), today=today),
            "taken_place": raw["_id"] in taken_place,
            "decided": decided_podium(finale_by_saison.get(str(raw["_id"]), [])) is not None,
            "count_teams": teams_by_saison.get(str(raw["_id"]), 0),
            "count_spiele": spiele_by_saison.get(str(raw["_id"]), 0),
        }
        for raw in saisons_raw
    ]

    return FLSaisonsAdminListResponse(
        saisons=FLSaisonAdminListAdapter.validate_python(saisons),
        next_saison_id=create_state.saison_id,
        refusals=FLSaisonsAdminRefusals(create=None if create_refusal is None else create_refusal.error_code),
    )


# Declared after `/list/admin`, which it would otherwise answer with `list` as a season id; a static suffix rather than
# a second `GET /{saison_id}`, which the public router owns at this same prefix.
@router.get("/{saison_id}/admin", response_model=FLSaisonAdminResponse, summary="One Saison for the admin editor")
async def get_saison_admin(
    saison_id: str,
    saisons_collection: SaisonsReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    spiele_collection: SpieleReadCollection,
    spieltage_collection: SpieltageReadCollection,
    teams_collection: TeamsReadCollection,
    spielberichte_collection: SpielberichteReadCollection,
    invitations_collection: InvitationsReadCollection,
    today: str = Depends(get_german_date_str),
) -> FLSaisonAdminResponse:
    """
    Return what the season editor shows in one read: its season, clubs, shapes and matchdays, its acts' states and its links.

    The season is served a `future` one included, with its `version`, whether it has started (`begun`), whether a
    fixture of it has taken place (`taken_place`) and whether it is decided (`decided`), by the landing's own rule.

    Each club's two flags are what the group swap's `swap_sides_taken_place` and the replacement's
    `replace_sides_taken_place` read, so a picker closes exactly the pairs and rows those writes refuse; `begun` closes
    both before either is pressed. `incoming_teams` is every club still in the league holding no row of the season,
    which is what the replacement admits.

    `refusals` names, per act, the refusal its write would answer now, by that write's own judgement, so the editor
    offers an act exactly where the write takes it. `invitations` is the registration links' press planned by the function
    the press decides each team by, beside each team's live link and the day it was last sent.
    Read outside a transaction: a write landing between this read and a press is judged by the press. 404 where no
    season holds that id.
    """

    # First and alone: a season id naming nothing raises the 404 here, and the activation is judged on the status read.
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id})
    saison_status = str(saison_raw["status"])

    # Two groups of reads sent at once, because `asyncio.gather`'s typing stops at six.
    (rows, spiele, count_spieltage, clubs, finale_by_saison), (activation, recorded_rows, berichte, planned) = await asyncio.gather(
        asyncio.gather(
            # Each whole, as `fl_backend/app/api/spiele/crud.py :: advance_bracket_winners` reads its season: a truncated
            # list grades a club open whose taken-place fixture fell past the page, and offers a club the replacement
            # refuses as entered.
            pull_whole_from_db(
                collection=saison_teams_collection,
                db_filter={"saison_id": saison_id},
                what=f"season {saison_id}'s clubs",
                projection=["team_id", "name", "shorthand", "gruppe", "austritt"],
                sort_by=build_sort(sort_by="name", order="asc"),
                collation=GERMAN_COLLATION,
            ),
            pull_whole_from_db(
                collection=spiele_collection,
                db_filter={"saison_id": saison_id},
                what=f"season {saison_id}'s fixtures",
                projection=["saison_phase", "team1.team_id", "team2.team_id", *TAKEN_PLACE_FIELDS],
            ),
            spieltage_collection.count_documents({"saison_id": saison_id}),
            pull_whole_from_db(
                collection=teams_collection,
                db_filter={"inactive_since": None},
                what="the league's clubs",
                projection=["name", "shorthand"],
                sort_by=build_sort(sort_by="name", order="asc"),
                collation=GERMAN_COLLATION,
            ),
            pull_finale_by_saison(spiele_collection=spiele_collection, saison_ids=[saison_id]),
        ),
        asyncio.gather(
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
            _plan_the_dispatch(
                saison_id=saison_id,
                saison_teams_collection=saison_teams_collection,
                invitations_collection=invitations_collection,
            ),
        ),
    )
    recorded_spiele = sum(1 for spiel in recorded_rows if holds_a_recorded_fact(spiel))
    # The rows a first draw refuses on, and the undraw and the replace remove: the season is drawn exactly while it holds
    # one, whatever its watermark says, so the editor offers the draw's acts where their writes take them.
    watermark = saison_raw.get("spielplan")
    spielplan = (
        None
        if count_spieltage == 0 and not recorded_rows
        else FLSaisonDrawn(
            spieltage=count_spieltage,
            spiele=len(recorded_rows),
            generated_at=None if watermark is None else FLSaisonSpielplan.model_validate(watermark).generated_at,
        )
    )

    def code_of(refusal: WriteRefusal | None) -> Code | None:
        return None if refusal is None else refusal.error_code

    played = [spiel for spiel in spiele if has_taken_place(spiel)]

    def has_played(team_id: Any, *, group_only: bool) -> bool:
        return any(
            team_id in ((spiel.get("team1") or {}).get("team_id"), (spiel.get("team2") or {}).get("team_id"))
            for spiel in played
            if not group_only or spiel.get("saison_phase") == "gruppenphase"
        )

    entered = {row["team_id"] for row in rows}
    saison = FLSaisonAdmin.model_validate(
        {
            **with_schedule(saison_raw),
            "begun": has_started(start_date=str(saison_raw["start_date"]), today=today),
            "taken_place": bool(played),
            "decided": decided_podium(finale_by_saison.get(saison_id, [])) is not None,
        }
    )

    # Withdrawn rows included, as the draw counts them: a club that left keeps its place.
    occupancy: dict[FLGruppenNames, int] = {}
    for row in rows:
        occupancy[row["gruppe"]] = occupancy.get(row["gruppe"], 0) + 1

    def draw_refusal(*, replace: bool) -> WriteRefusal | None:
        return find_spielplan_refusal(
            saison_status=saison_status,
            spiele_drawn=len(recorded_rows),
            spieltage_held=count_spieltage,
            rules=saison.rules,
            occupancy_by_gruppe=occupancy,
            replace=replace,
            recorded_spiele=recorded_spiele,
        )

    return FLSaisonAdminResponse(
        saison=saison,
        teams=[
            FLSaisonAdminTeam.model_validate(
                {
                    **row,
                    "group_spiel_taken_place": has_played(row["team_id"], group_only=True),
                    "spiel_taken_place": has_played(row["team_id"], group_only=False),
                }
            )
            for row in rows
        ],
        incoming_teams=[FLSaisonAdminIncomingTeam.model_validate(club) for club in clubs if club["_id"] not in entered],
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


@router.post(
    "",
    response_model=FLPostSaisonResponse,
    status_code=201,
    summary="Create a Saison",
)
async def post_saison(
    saison_data: Annotated[FLPostSaisonPayload, Body()],
    saisons_collection: SaisonsCollection,
    db: DBClient,
) -> FLPostSaisonResponse:
    """
    Create the next season, always `future`, from its two days, answering the id it minted.

    The server names it: the year after the newest stored season's, or the league's first where none is stored, so a
    season is never created out of turn. Its rules carry on from that newest season, or are the league's first season's
    (`FIRST_SAISON_RULES`), and its two windows start closed, each set in the season's own editor. Refused while a
    `future` season stands (`create_saison_future_stands`), so a league holds at most one planned season, the loser of
    two creates at once included (`find_saison_create_refusal`); then by the rules it carries on and by its span against
    them. Making the season live is a separate step.
    """

    async def enter_the_season(session: AsyncClientSession) -> InsertOneResult:
        # Inside the transaction, so the id, the rules and the planned season are judged on one snapshot.
        state = await pull_create_state(saisons_collection=saisons_collection, session=session)
        refuse(find_saison_create_refusal(future_stands=state.future_stands))
        refuse(find_rules_refusal(stored=None, proposed=state.rules, occupancy_by_gruppe={}, highest_wired_platz=0))
        # After the rules: an impossible bracket makes the implied matchday count meaningless.
        refuse(
            find_saison_span_refusal(
                start_date=saison_data.start_date,
                end_date=saison_data.end_date,
                rules=state.rules,
                spieltag_spans=[],
            )
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
        await record_act(collection=saisons_collection, action="saison.created", label=state.saison_id, session=session)

        return created

    async with transaction_session(db) as session:
        post_operation = await session.with_transaction(enter_the_season)

    return FLPostSaisonResponse(
        created_id=str(post_operation.inserted_id),
    )


@router.patch(
    "/{saison_id}",
    response_model=FLPatchSaisonResponse,
    summary="Update a Saison's dates and rules",
)
async def patch_saison(
    saison_id: str,
    saison_data: Annotated[FLPatchSaisonPayload, Body()],
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spiele_collection: SpieleCollection,
    spieltage_collection: SpieltageCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLPatchSaisonResponse:
    """
    Update a season's dates and rules on the `version` the editor was served, answering the version stored, which its next save sends.

    `status` is on no payload. Editing the points moves every league table on the NEXT READ, standings being derived. What a
    started or drawn season has fixed is refused, as is a rule narrowed below what it holds. The start date moves until a
    fixture of the season has taken place (`saison_start_taken_place`), and later only while no club's exit is stored
    (`saison_start_austritt_stored`, its `latest` the stored start); the rules freeze reads the STORED start, so a season
    started too early is unlocked by one save moving its start and a second changing its rules.
    """

    async def judge_and_write_the_rules(session: AsyncClientSession) -> FLPatchSaisonResponse:
        """Judge, then write the season's dates and rules. Every figure is read in-session."""

        # THROUGH the session, and FIRST: this opens the snapshot the update below is judged
        # against, so a rival writing `saisons` under the judgement conflicts instead of being
        # overwritten. A season id naming nothing raises the 404 here.
        stored_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)

        # Disqualified rows included: a team never leaves a season. The same read says whether any club's exit is
        # stored, which a start moved later must not leave on a season reading as unstarted.
        occupancy: dict[Any, int] = {}
        austritt_stored = False
        async for row in saison_teams_collection.find({"saison_id": saison_id}, {"gruppe": 1, "austritt": 1}, session=session):
            gruppe = row.get("gruppe")
            if gruppe is not None:
                occupancy[gruppe] = occupancy.get(gruppe, 0) + 1
            austritt_stored = austritt_stored or row.get("austritt") is not None

        # Both sides, because a `quelle` sits on either; 0 where no slot is group-seeded. Judged on
        # the snapshot and never re-read below: `rules_qualifiers_below_wiring`, the only refusal that reads it,
        # cannot be reached at all.
        highest_platz = 0
        async for spiel in spiele_collection.find(
            {"saison_id": saison_id, "$or": [{"team1_quelle.type": "gruppe"}, {"team2_quelle.type": "gruppe"}]},
            {"team1_quelle": 1, "team2_quelle": 1},
            session=session,
        ):
            for side in ("team1_quelle", "team2_quelle"):
                quelle = spiel.get(side)
                if isinstance(quelle, dict) and quelle.get("type") == "gruppe":
                    highest_platz = max(highest_platz, int(quelle.get("platz", 0)))

        # The fullest matchday of a phase, not the total, and keyed on the MATCHDAY's phase, which the
        # fixture's can disagree with. Judged on the snapshot for `highest_platz`'s reason, the
        # unreachable refusal here being `rules_spieltag_over_its_phase`.
        attached_by_phase: dict[Any, int] = {}
        phase_of_spieltag: dict[Any, Any] = {}
        async for spieltag in spieltage_collection.find({"saison_id": saison_id}, {"saison_phase": 1}, session=session):
            phase_of_spieltag[spieltag["_id"]] = spieltag["saison_phase"]

        per_spieltag: dict[Any, int] = {}
        async for spiel in spiele_collection.find({"saison_id": saison_id}, ["spieltag_id"], session=session):
            per_spieltag[spiel["spieltag_id"]] = per_spieltag.get(spiel["spieltag_id"], 0) + 1

        # Every fixture, whichever matchday it hangs on: what `rules_shape_after_spielplan` freezes is the draw, and
        # one on another season's matchday came out of this season's rules too. Only a draw or an
        # undraw moves the count, and both write `saisons`, so both conflict.
        drawn_spiele = sum(per_spieltag.values())

        for spieltag_id, attached in per_spieltag.items():
            phase = phase_of_spieltag.get(spieltag_id)
            # A fixture pointing at another season's matchday, or at none, exceeds no count here.
            if phase is not None:
                attached_by_phase[phase] = max(attached_by_phase.get(phase, 0), attached)

        largest_squad_rows = await (
            await saison_spieler_collection.aggregate(
                [
                    {"$match": {"saison_id": saison_id, **CAPPED_SQUAD_ROW}},
                    {"$group": {"_id": "$team_id", "held": {"$sum": 1}}},
                    {"$sort": {"held": -1}},
                    {"$limit": 1},
                ],
                session=session,
            )
        ).to_list(length=1)
        largest_squad = int(largest_squad_rows[0]["held"]) if largest_squad_rows else 0

        # Dated rows only, filtered in the QUERY rather than after `str()`: a generated matchday carries
        # no span until somebody sets one, and a null stringified to "None" sorts above every date and
        # would be reported as falling outside the season.
        spieltag_spans = [
            (str(row["start"]), str(row["end"]))
            async for row in spieltage_collection.find(
                {"saison_id": saison_id, "start": {"$ne": None}, "end": {"$ne": None}}, {"start": 1, "end": 1}, session=session
            )
        ]

        taken_place = saison_id in await saisons_with_a_spiel_taken_place(
            spiele_collection=spiele_collection, saison_ids=[saison_id], session=session
        )

        # Validated, not read raw: a season missing a rules key fails here rather than comparing
        # against a default nobody chose.
        stored_rules = FLSaisonRules.model_validate(stored_raw["rules"])
        # First: a start that cannot move is a fact about the payload's own date, whatever its rules ask.
        refuse(
            find_saison_start_refusal(
                stored_start_date=str(stored_raw["start_date"]),
                proposed_start_date=saison_data.start_date,
                taken_place=taken_place,
            )
        )
        refuse(
            find_saison_start_austritt_refusal(
                stored_start_date=str(stored_raw["start_date"]),
                proposed_start_date=saison_data.start_date,
                austritt_stored=austritt_stored,
            )
        )
        # The STORED start, in this transaction's snapshot: the date on the payload is what the edit
        # proposes, and a freeze lifted by the same save that changes the rules would be no freeze.
        refuse(
            find_rules_freeze_refusal(
                saison_status=str(stored_raw["status"]),
                started=has_started(start_date=str(stored_raw["start_date"]), today=today),
                stored=stored_rules,
                proposed=saison_data.rules,
            )
        )
        refuse(
            find_rules_refusal(
                stored=stored_rules,
                proposed=saison_data.rules,
                occupancy_by_gruppe=occupancy,
                highest_wired_platz=highest_platz,
                largest_squad=largest_squad,
                attached_by_phase=attached_by_phase,
                drawn_spiele=drawn_spiele,
            )
        )
        refuse(
            find_saison_span_refusal(
                start_date=saison_data.start_date,
                end_date=saison_data.end_date,
                rules=saison_data.rules,
                spieltag_spans=spieltag_spans,
            )
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
        await record_act(collection=saisons_collection, action="saison.changed", label=saison_id, session=session)

        # A result is a write to `spiele` alone, so a moved start writes the fixtures it was judged on:
        # a result landing under the judgement conflicts, and the retry refuses on it. A squad entry
        # and a matchday re-dating anchor `saisons` themselves, so the season write above is theirs.
        if saison_data.start_date != stored_raw["start_date"]:
            await anchor_in_db(collection=spiele_collection, db_filter={"saison_id": saison_id}, session=session)

        return FLPatchSaisonResponse(version=patched[VERSION_FIELD])

    # `with_transaction`, not a bare `start_transaction`: a draw and an undraw write `saisons` too,
    # so one landing under a `$set` that changes something conflicts, and the retry judges the
    # season as that rival left it.
    async with transaction_session(db) as session:
        patched = await session.with_transaction(judge_and_write_the_rules)

    return patched


async def _judge_the_activation(
    *,
    saison_id: str,
    target_status: str,
    saisons_collection: ReadCollection,
    spiele_collection: ReadCollection,
    spieltage_collection: ReadCollection,
    session: AsyncClientSession | None,
) -> tuple[list[Any], WriteRefusal | None]:
    """The seasons activating this one would close, and why it must be refused, or `None`.

    Read by the activation in its transaction and by the editor's read outside one, so the act the editor offers is the act
    the write takes.
    """

    # `$ne` on the target, so re-activating the current season is not blocked by its own fixtures.
    outgoing = await pull_many_from_db(
        collection=saisons_collection,
        db_filter={"status": "active", "_id": {"$ne": saison_id}},
        projection={"_id": 1},
        session=session,
    )
    outgoing_ids = [row["_id"] for row in outgoing]

    # Empty where nothing BUT the target holds `active` -- a fresh league, or a re-activation.
    unplayed: list[int] = []
    if outgoing_ids:
        unplayed = unplayed_spiel_nrs(
            FLSpielListAdapter.validate_python(
                await pull_many_from_db(collection=spiele_collection, db_filter={"saison_id": {"$in": outgoing_ids}}, session=session)
            )
        )

    # One call, so which of the two refusals an admin is shown stays the service's decision.
    # The target's OWN fixtures, not the outgoing season's: a league going live with nothing drawn
    # has no repair, activation writing `status` one way only.
    target_spiele = await spiele_collection.count_documents({"saison_id": saison_id}, session=session)

    # In-session for `target_status`'s reason, and `start` alone: `end` is dated with it, and a
    # matchday half-dated is a shape no write here produces.
    undated_spieltage = await spieltage_collection.count_documents({"saison_id": saison_id, "start": None}, session=session)

    return outgoing_ids, find_activation_refusal(
        target_status=target_status,
        target_spiele=target_spiele,
        undated_spieltage=undated_spieltage,
        outgoing_unplayed=unplayed,
    )


async def _pull_recorded_fact_rows(
    *, spiele_collection: ReadCollection, saison_id: str, session: AsyncClientSession | None
) -> list[Mapping[str, Any]]:
    """The season's fixtures as `holds_a_recorded_fact` reads them, which the planning window of the replace and the undraw turns on.

    The predicate's own fields, so the projection cannot fall behind what it reads: a venue, a referee or an admin's note
    is work a replace would destroy, and the window closes on one exactly as on a result. Read one over the cap and
    refused past it, as `fl_backend/app/api/spiele/crud.py :: advance_bracket_winners` asks: a truncated list counts fewer
    records than the season holds, and the window opens on work the removal would destroy.
    """

    return await pull_whole_from_db(
        collection=spiele_collection,
        db_filter={"saison_id": saison_id},
        what=f"season {saison_id}'s fixtures",
        projection=list(RECORDED_FACT_FIELDS),
        session=session,
    )


def _find_undraw_refusal_of(*, saison_status: str, recorded_spiele: int, berichte: int) -> WriteRefusal | None:
    """The undraw's whole judgement, in its order: its window, then the reports it would delete."""

    return find_undraw_refusal(saison_status=saison_status, recorded_spiele=recorded_spiele) or find_berichte_refusal(berichte=berichte)


@router.post(
    "/{saison_id}/activate",
    response_model=FLActivateSaisonResponse,
    summary="Make this the active Saison",
)
async def activate_saison(
    saison_id: str,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    spieltage_collection: SpieltageCollection,
    ban_list_collection: BanListCollection,
    db: DBClient,
) -> FLActivateSaisonResponse:
    """
    Make this the active season, moving whichever holds `active` to `past` in one transaction.

    The only path to `status: "active"`. The outgoing season must be finished, a `past` target is
    refused, and every matchday of the target carries a date.
    """

    async def judge_and_roll_the_league_over(session: AsyncClientSession) -> FLActivateSaisonResponse:
        """Judge, then demote every incumbent and promote the target. Every figure is read in-session."""

        # THROUGH the session, as the draw's reads are: a retry after a write conflict judges the
        # league as it stands then. A season id naming nothing raises the 404 here, before any demotion.
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

        # BEFORE the promotion: `uniq_saison_active` is checked at each write rather than at the
        # commit, so promoting first meets the incumbent and aborts the rollover.
        demoted = await patch_many_in_db(
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

        await record_act(collection=saisons_collection, action="saison.activated", label=saison_id, session=session)

        # `$lt` and not `$lte`: the season named on a row is the last one the ban covers, so the row
        # lapses on the activation of the season AFTER it.
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
                label=saison_id,
                count=lapsed.deleted_count,
                session=session,
            )

        return FLActivateSaisonResponse(deactivated=demoted.modified_count)

    # `with_transaction`, not a bare `start_transaction`: a draw filling the outgoing season or an
    # undraw emptying the target writes a season this one writes too, so it conflicts and the
    # retry judges the league again rather than closing it blind.
    async with transaction_session(db) as session:
        rolled_over = await session.with_transaction(judge_and_roll_the_league_over)

    return rolled_over


@router.post(
    "/{saison_id}/gruppen/swap",
    response_model=FLSwapGruppenResponse,
    summary="Exchange two teams' groups",
)
async def swap_gruppen(
    saison_id: str,
    swap_data: Annotated[FLSwapGruppenPayload, Body()],
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spiele_collection: SpieleCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSwapGruppenResponse:
    """
    Exchange the groups of two clubs entered in this season, as one write.

    Every Gruppenphase fixture fielding either club has that side rewritten in the same transaction,
    so each group stays a round robin. Neither `tore` nor `austritt` moves.
    """

    # Before any read, as FastAPI refuses a malformed body: this pair is refused whatever the season holds.
    refuse(find_swap_pair_refusal(team1_id=swap_data.team1_id, team2_id=swap_data.team2_id))

    # A read first, so an unknown season is a 404 rather than a 409 about clubs holding no row in it.
    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])

    async def exchange_the_two_gruppen(session: AsyncClientSession) -> FLSwapGruppenResponse:
        """The whole swap: judge, then write both rows. Everything it decides on is read in-session."""

        both_ids = [swap_data.team1_id, swap_data.team2_id]

        # THROUGH the session: a retry after a write conflict has to judge these rows as they are
        # then, not as this request first saw them.
        rows = await pull_many_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "team_id": {"$in": both_ids}},
            projection=["team_id", "gruppe"],
            session=session,
        )
        gruppe_of = {row["team_id"]: row["gruppe"] for row in rows}

        saison_raw = await pull_one_from_db(
            collection=saisons_collection, db_filter={"_id": saison_id}, projection={"status": 1, "start_date": 1}, session=session
        )
        # Anchored, so the start and the status this is judged on belong to its write set: `PATCH /saisons/{saison_id}`
        # moves the one and `activate_saison` the other, each writing this document, so either landing under the
        # judgement conflicts and the retry judges the season it left.
        await anchor_in_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)

        # The fixtures the rewrite moves, read once for the refusal below too, so the two cannot disagree.
        gruppenphase_spiele = await pull_many_from_db(
            collection=spiele_collection,
            db_filter={
                "saison_id": saison_id,
                "saison_phase": "gruppenphase",
                "$or": [{"team1.team_id": {"$in": both_ids}}, {"team2.team_id": {"$in": both_ids}}],
            },
            projection=["team1.team_id", "team2.team_id", *TAKEN_PLACE_FIELDS],
            session=session,
        )

        refuse(
            find_gruppe_swap_refusal(
                team1_gruppe=gruppe_of.get(swap_data.team1_id),
                team2_gruppe=gruppe_of.get(swap_data.team2_id),
                saison_status=str(saison_raw["status"]),
                started=has_started(start_date=str(saison_raw["start_date"]), today=today),
                taken_place=any(has_taken_place(spiel) for spiel in gruppenphase_spiele),
            )
        )

        rewritten = await _rewrite_gruppenphase_sides(
            spiele=gruppenphase_spiele,
            team_ids=both_ids,
            spiele_collection=spiele_collection,
            session=session,
        )

        # Built BEFORE the junction writes and then written FROM: the model refuses a stored group
        # outside the closed set before anything lands, and the echo cannot disagree with what did.
        swapped = FLSwapGruppenResponse(
            saison_id=saison_id,
            team1_id=swap_data.team1_id,
            team1_gruppe=gruppe_of[swap_data.team2_id],
            team2_id=swap_data.team2_id,
            team2_gruppe=gruppe_of[swap_data.team1_id],
            rewritten_spiele=rewritten,
        )

        for team_id, target_gruppe in ((swapped.team1_id, swapped.team1_gruppe), (swapped.team2_id, swapped.team2_gruppe)):
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
        await record_act(collection=saisons_collection, action="saison.gruppen_swapped", label=saison_id, session=session)

        return swapped

    # `with_transaction`, not a bare `start_transaction`: two admins on one season can write-conflict,
    # and a retry judges these rows as the rival left them.
    async with transaction_session(db) as session:
        return await session.with_transaction(exchange_the_two_gruppen)


@router.post(
    "/{saison_id}/spielplan",
    response_model=FLGenerateSpielplanResponse,
    status_code=201,
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
    today: str = Depends(get_german_date_str),
) -> FLGenerateSpielplanResponse:
    """
    Draw the whole season at once: every matchday and every fixture, undated, in one transaction.

    `shape` states the three rules the fixtures come out of, and is stored with them. `replace`
    deletes both lists first, every fixture's confirmations with them, inside `spielplan_replace_outside_its_window`'s
    window and on a season holding no submitted match report (`spielplan_berichte_submitted`): nothing writes the
    removed rows back.
    """

    # A read first, so an unknown season is a 404 rather than a refusal about what it does not hold.
    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])

    async def draw_the_whole_season(session: AsyncClientSession) -> FLGenerateSpielplanResponse:
        """Judge, then write both collections and the watermark. Everything judged is read in-session."""

        # THROUGH the session, as the group swap's callback is: a retry after a write conflict has to
        # judge the season as it stands then, not as this request first saw it.
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)
        stored_rules = FLSaisonRules.model_validate(saison_raw["rules"])

        # ONE object judged, drawn and stored, so every refusal below weighs the numbers this draw
        # runs from. `model_copy` skips validation and safely: `FLSpielplanShape` declares the three
        # under `FLSaisonRules`' own types.
        rules = stored_rules if spielplan_data.shape is None else stored_rules.model_copy(update=spielplan_data.shape.model_dump())

        # Whole: a truncated entry list draws a season short of teams and weighs a group occupancy no group holds.
        entered_rows = await pull_whole_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id},
            what=f"season {saison_id}'s clubs",
            # `name` and `shorthand` off the JUNCTION: that is the name the season is played under,
            # and `teams` may since have been renamed.
            projection=["team_id", "gruppe", "name", "shorthand"],
            session=session,
        )

        occupancy: dict[FLGruppenNames, int] = {}
        for row in entered_rows:
            gruppe = row["gruppe"]
            occupancy[gruppe] = occupancy.get(gruppe, 0) + 1

        # LISTED rather than counted, as the group swap's callback lists its own: one read answers
        # `spielplan_already_drawn` and supplies what `spielplan_replace_outside_its_window` weighs, so the two cannot
        # disagree about what a replace would destroy.
        stored_spiele = await _pull_recorded_fact_rows(spiele_collection=spiele_collection, saison_id=saison_id, session=session)

        refuse(
            find_spielplan_refusal(
                saison_status=str(saison_raw["status"]),
                spiele_drawn=len(stored_spiele),
                spieltage_held=await spieltage_collection.count_documents({"saison_id": saison_id}, session=session),
                rules=rules,
                occupancy_by_gruppe=occupancy,
                replace=spielplan_data.replace,
                recorded_spiele=sum(1 for spiel in stored_spiele if holds_a_recorded_fact(spiel)),
            )
        )
        if spielplan_data.replace:
            refuse(
                find_berichte_refusal(
                    berichte=await count_submitted_berichte(
                        spielberichte_collection=spielberichte_collection, saison_id=saison_id, session=session
                    )
                )
            )

        # `stored=None` is the create's reading, and the one this wants: every rule judging the
        # numbers alone fires on the payload's own, and every rule judging a standing fixture is
        # skipped, each of those weighing a draw about to cease to exist.
        refuse(
            as_the_draw_answers(
                find_rules_refusal(
                    stored=None,
                    proposed=rules,
                    occupancy_by_gruppe=occupancy,
                    highest_wired_platz=0,
                ),
            )
        )

        # After the rules, as `post_saison` is: a bracket with no shape implies no matchday count
        # worth measuring. Empty spans -- the draw dates nothing, and a replace has every stored
        # matchday still to delete below.
        refuse(
            as_the_draw_answers(
                find_saison_span_refusal(
                    start_date=str(saison_raw["start_date"]),
                    end_date=str(saison_raw["end_date"]),
                    rules=rules,
                    spieltag_spans=[],
                ),
            )
        )

        # `find_wiring_refusal`, `judge_spieltag_occupancy`, `find_clash_refusal` and
        # `find_eligibility_refusal` are all unasked: each judges ONE payload against a stored season,
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

        # Both collections together, fixtures first for
        # `delete_spielplan`'s reason.
        removed_spieltage = 0
        removed_spiele = 0

        # The counts go to the response: they are what the admin confirmed deleting, and the flag
        # alone cannot say whether anything was there to delete.
        if spielplan_data.replace:
            # The season every report write anchors, so the two conflict: the watermark's `$set` below can change
            # nothing on a same-day redraw, and the report's insert meets no delete here.
            await anchor_the_season_reported_in(saisons_collection=saisons_collection, saison_id=saison_id, session=session)
            # NOT extracted, though `delete_spielplan` repeats it: two sites are no pattern yet.
            await delete_many_from_db(collection=spielbestaetigungen_collection, db_filter={"saison_id": saison_id}, session=session)
            await delete_many_from_db(collection=spielberichte_collection, db_filter={"saison_id": saison_id}, session=session)
            await remove_the_seasons_aufstellungen(aufstellungen_collection=aufstellungen_collection, saison_id=saison_id, session=session)
            removed_spiele = (
                await delete_many_from_db(collection=spiele_collection, db_filter={"saison_id": saison_id}, session=session)
            ).deleted_count
            removed_spieltage = (
                await delete_many_from_db(collection=spieltage_collection, db_filter={"saison_id": saison_id}, session=session)
            ).deleted_count

        # Matchdays first: every fixture already carries the `spieltag_id` of a row in this list, the
        # draw having generated both ids together rather than reading one back.
        await post_many_to_db(collection=spieltage_collection, documents=drawn.spieltage, session=session)
        await post_many_to_db(collection=spiele_collection, documents=drawn.spiele, session=session)

        # Dotted keys, and only where the payload states a shape: a whole `rules` object would write
        # the six rules the draw is no function of, and drop any sub-key `FLSaisonRules` ignores --
        # the merged copy lost it at validation.
        shape = spielplan_data.shape
        shape_written = {} if shape is None else {f"rules.{rule}": value for rule, value in shape.model_dump().items()}

        if spielplan_data.replace:
            # Counted again outside the transaction: a report's first write conflicts
            # with this one on the season, and a correction on the report, but a document no write made does not.
            refuse(
                find_berichte_refusal(
                    berichte=await count_submitted_berichte(
                        spielberichte_collection=spielberichte_collection, saison_id=saison_id, session=None
                    )
                )
            )

        watermark = FLSaisonSpielplan(generated_at=today)
        # ONE `$set` inside the transaction: the shape and the draw it produced are one fact.
        await patch_one_in_db(
            collection=saisons_collection,
            db_filter={"_id": saison_id},
            update={"$set": {**shape_written, "spielplan": watermark.model_dump(mode="json")}},
            session=session,
            # Nothing here reads the result, and `AFTER` would re-read the whole season inside the
            # transaction to build one.
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )
        await record_act(
            collection=saisons_collection,
            action="saison.spielplan_recreated" if spielplan_data.replace else "saison.spielplan_created",
            label=saison_id,
            session=session,
        )

        return FLGenerateSpielplanResponse(
            saison_id=saison_id,
            spieltage=len(drawn.spieltage),
            spiele=len(drawn.spiele),
            generated_at=watermark.generated_at,
            removed_spieltage=removed_spieltage,
            removed_spiele=removed_spiele,
        )

    # `with_transaction`, not a bare `start_transaction`, and a retry is safe because the draw
    # generates its own ids and wires by `spiel_nr`, never by one.
    async with transaction_session(db) as session:
        drawn_response = await session.with_transaction(draw_the_whole_season)

    return drawn_response


@router.delete(
    "/{saison_id}/spielplan",
    response_model=FLUndrawSpielplanResponse,
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
) -> FLUndrawSpielplanResponse:
    """
    Return the season to undrawn: matchdays, fixtures and watermark, in one transaction.

    Every fixture's confirmations go with it.

    The replace's window bounds it (`spielplan_undraw_outside_its_window`), and a submitted match report refuses it
    (`spielplan_berichte_submitted`). Undoing the draw is what reopens the shape rules to `PATCH` and the groups to
    an entry.
    """

    async def undraw_the_whole_season(session: AsyncClientSession) -> FLUndrawSpielplanResponse:
        """Judge, then remove both collections and the watermark. Everything judged is read in-session."""

        # THROUGH the session, as the draw's reads are: a retry after a write conflict judges the
        # season as it stands then. A season id naming nothing raises the 404 here.
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"], session=session)

        # The stored rows, never the watermark: a season drawn outside this API carries none, and its
        # fixtures are as much a record as one this endpoint wrote.
        stored_spiele = await _pull_recorded_fact_rows(spiele_collection=spiele_collection, saison_id=saison_id, session=session)

        refuse(
            _find_undraw_refusal_of(
                saison_status=str(saison_raw["status"]),
                recorded_spiele=sum(1 for spiel in stored_spiele if holds_a_recorded_fact(spiel)),
                berichte=await count_submitted_berichte(
                    spielberichte_collection=spielberichte_collection, saison_id=saison_id, session=session
                ),
            )
        )

        # The season every report write anchors, so the two conflict: the `$unset` below changes nothing on a season
        # holding no watermark, and the report's insert meets no delete here.
        await anchor_the_season_reported_in(saisons_collection=saisons_collection, saison_id=saison_id, session=session)

        # Fixtures first, the reverse of the draw's write order. Confirmations, reports and line-ups go first of
        # all, each naming the fixture it is about.
        await delete_many_from_db(collection=spielbestaetigungen_collection, db_filter={"saison_id": saison_id}, session=session)
        await delete_many_from_db(collection=spielberichte_collection, db_filter={"saison_id": saison_id}, session=session)
        await remove_the_seasons_aufstellungen(aufstellungen_collection=aufstellungen_collection, saison_id=saison_id, session=session)
        removed_spiele = await delete_many_from_db(collection=spiele_collection, db_filter={"saison_id": saison_id}, session=session)
        removed_spieltage = await delete_many_from_db(collection=spieltage_collection, db_filter={"saison_id": saison_id}, session=session)

        # INSIDE the transaction holding both removals: a season keeping its watermark while its fixtures
        # are gone would date a draw it no longer holds, and `$unset` is the shape a season nobody has drawn carries.
        before = await patch_one_in_db(
            collection=saisons_collection,
            db_filter={"_id": saison_id},
            update={"$unset": {"spielplan": ""}},
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )
        await record_act(collection=saisons_collection, action="saison.spielplan_deleted", label=saison_id, session=session)

        # The replace's reason.
        refuse(
            find_berichte_refusal(
                berichte=await count_submitted_berichte(spielberichte_collection=spielberichte_collection, saison_id=saison_id, session=None)
            )
        )

        return FLUndrawSpielplanResponse(
            saison_id=saison_id,
            spieltage=removed_spieltage.deleted_count,
            spiele=removed_spiele.deleted_count,
            # The update's OWN pre-image, so nothing lands between reading the watermark and clearing
            # it. A season holding one with no fixtures behind it reports the only thing removed.
            watermark_cleared=before.get("spielplan") is not None,
        )

    # `with_transaction`, not a bare `start_transaction`, and a retry is safe because the undraw
    # removes a set by filter rather than by any id it read.
    async with transaction_session(db) as session:
        undrawn = await session.with_transaction(undraw_the_whole_season)

    return undrawn


async def _entered_teams(*, saison_teams_collection: ReadCollection, saison_id: str) -> list[Mapping[str, Any]]:
    """Every team this season holds, ordered as its other lists are.

    Read one over the cap and refused past it (`app/api/spiele/crud.py :: advance_bracket_winners`'s
    reason): a truncated list silently leaves teams unmailed, which is what this press exists to stop.
    """

    return await pull_whole_from_db(
        collection=saison_teams_collection,
        db_filter={"saison_id": saison_id},
        what=f"season {saison_id}'s clubs",
        projection=["team_id", "name", "kontakte", "austritt"],
        sort_by=build_sort(sort_by="name", order="asc"),
        collation=GERMAN_COLLATION,
    )


class _PlannedTeam(NamedTuple):
    """One team as a press made now would treat it, beside the live link it holds."""

    team: Mapping[str, Any]
    live: Mapping[str, Any] | None
    plan: InvitationDispatchPlan


async def _plan_the_dispatch(
    *,
    saison_id: str,
    saison_teams_collection: ReadCollection,
    invitations_collection: ReadCollection,
) -> list[_PlannedTeam]:
    """Every team of the season planned by `plan_invitation_dispatch`, the function the press decides each team by.

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
        plan = plan_invitation_dispatch(
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
        """Plan this team, then revoke, insert and owe where the plan says to.

        The INVITE and its mails alone are read in-session: the withdrawal and the contacts come from
        the read before the loop, so a retry re-decides on those as they stood then.
        """

        live = await pull_many_from_db(
            collection=invitations_collection,
            db_filter=build_live_team_filter(saison_id=saison_id, team_id=team["team_id"]),
            limit=1,
            projection=dict(WITHOUT_TOKEN_HASH),
            session=session,
        )
        plan = plan_invitation_dispatch(
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
            await record_act(collection=invitations_collection, action="saison.invitations_dispatched", label=saison_id, session=session)

        return "mailed"

    # Caught outside the session: a failure the session never sees leaves the transaction open on the
    # server.
    try:
        async with transaction_session(db) as session:
            return await session.with_transaction(mint_where_the_team_qualifies)
    except PyMongoError as failure:
        # Per TEAM: every team already done is committed with its mails. A commit sent and never answered may have revoked
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
    "/{saison_id}/invitations/dispatch",
    response_model=FLInvitationDispatchResponse,
    summary="Mint every admitted team a link",
)
async def post_invitations_dispatch(
    saison_id: str,
    saison_teams_collection: SaisonTeamsCollection,
    invitations_collection: InvitationsCollection,
    saisons_collection: SaisonsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLInvitationDispatchResponse:
    """
    Give every admitted team of this season a fresh registration link and owe it to the team's confirmed seats, one mail each.

    **Every team mailed gets a fresh invite, and any link that team already held is REVOKED in the same per-team transaction** — the
    copy in somebody's inbox opens nothing from that moment. The mails are owed in that transaction too, each minting its link when it is
    handed out; no link is answered. A team this skips is left exactly as it was.

    Four skips, each an ordinary state rather than a refusal: the team has left this season, it holds no contact block, no seat of that block
    has been confirmed by its own person, or its live link was already sent. **The fourth is read off the day the live link was sent,
    stored on it**, never off the Postausgang, whose row is erased a retention after it settles: pressing twice mails nobody twice, and
    the team's own press is what mails a club its link again. **The first is read off the junction row's
    `austritt` record**, so a team out of the season by either route is passed over; minting for one team by hand is not refused, that
    being a deliberate act rather than a bulk one.

    Refused where the season has ended (`saison_past`); 404 where no season holds that id; a season holding no team answers zero
    counts.

    **An administrator whose access is revoked while the mailing runs is refused `actor_not_admin` at the next team**: every team done before
    that point holds its fresh link and its mails, and running the mailing again, as an administrator who still holds access, skips those
    teams and reaches the rest.
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

    return FLInvitationDispatchResponse(
        saison_id=saison_id,
        mailed=outcomes.count("mailed"),
        skipped=outcomes.count("skipped"),
        failed=outcomes.count("failed"),
    )
