import asyncio
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Annotated, Any, NamedTuple

from fastapi import APIRouter, Body, Depends
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError
from pymongo.results import InsertOneResult

from app.api.berechtigungen.guard import verify_actor_is_admin
from app.api.einladungen.crud import owed_einladung_mails
from app.api.einladungen.schemas import (
    FLEinladung,
    FLInvitationDispatchPayload,
    FLInvitationDispatchPreviewResponse,
    FLInvitationDispatchPreviewRow,
    FLInvitationDispatchResponse,
    FLInvitationDispatchRow,
    FLInvitationLinkRow,
)
from app.api.einladungen.services import (
    LIVE_EINLADUNG,
    WITHOUT_TOKEN_HASH,
    EinladungVersandPlan,
    bestaetigte_empfaenger,
    build_live_team_filter,
    compose_einladung,
    compose_revocation_update,
    find_saison_vorbei_refusal,
    plan_einladung_versand,
)
from app.api.identity.crud import due_count, saison_statuses
from app.api.identity.schemas import FLErasurePreviewResponse
from app.api.identity.services import closed_by, statuses_after_activating
from app.api.outbox.services import enqueue_mails
from app.api.saisons.crud import count_teams_by_saison, pull_finale_by_saison, saisons_with_a_fixture_taken_place
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
    FLSaisonAdminClub,
    FLSaisonAdminListAdapter,
    FLSaisonAdminResponse,
    FLSaisonAdminTeam,
    FLSaisonRules,
    FLSaisonsAdminListResponse,
    FLSaisonsFilterParams,
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
    find_saison_id_refusal,
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
from app.api.sperrliste.lookup import BanList, BanListLookup, barred_addresses
from app.api.spielberichte.crud import anchor_the_season_reported_in, count_eingereichte_berichte
from app.api.spiele.schemas import FLSpielListAdapter
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
    build_query,
    build_sort,
    delete_many_from_db,
    erase_many_from_db,
    patch_many_in_db,
    patch_one_in_db,
    post_many_to_db,
    post_one_to_db,
    pull_many_from_db,
    pull_one_from_db,
    refuse,
)
from app.core.dependencies import (
    BanListCollection,
    DBClient,
    InvitationsCollection,
    OutboxCollection,
    RegistrierungenCollection,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonTeamsCollection,
    SpielberichteCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
    SpielerCollection,
    SpieltageCollection,
    TeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exceptions import WriteRefusal
from app.core.logging import fl_logger
from app.core.security import bind_actor, get_actor_email, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
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
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    saison_teams_collection: SaisonTeamsCollection,
    filters: FLSaisonsFilterParams = Depends(),
    today: str = Depends(get_german_date_str),
) -> FLSaisonsAdminListResponse:
    """
    List every season, the `future` ones every base-tier read withholds included, each with its start, play and decision states.

    The admin surfaces read here because a season is created `future` and clubs are entered while it
    still is, so an admin who cannot see one cannot run the league. `begun` is the start every
    start lock refuses on, the swap's, the replacement's and the rules freeze's; `taken_place` is what
    fixes the start date (`saison_start_taken_place`); `decided` is the landing's own rule, all four places of the Finale in.
    `count_teams` counts every club row of the season, one that left included.
    """

    db_filter = build_query(filters, terms={"status"})
    db_sort = build_sort(sort_by=filters.sort_by, order=filters.order)

    saisons_raw = await pull_many_from_db(
        collection=saisons_collection,
        db_filter=db_filter,
        limit=filters.limit,
        sort_by=db_sort,
    )

    saison_ids = [str(raw["_id"]) for raw in saisons_raw]
    taken_place, finale_by_saison, teams_by_saison = await asyncio.gather(
        saisons_with_a_fixture_taken_place(spiele_collection=spiele_collection, saison_ids=saison_ids, session=None),
        pull_finale_by_saison(spiele_collection=spiele_collection, saison_ids=saison_ids),
        count_teams_by_saison(saison_teams_collection=saison_teams_collection, saison_ids=saison_ids),
    )
    saisons = [
        {
            **with_schedule(raw),
            "begun": has_started(start_date=str(raw["start_date"]), today=today),
            "taken_place": raw["_id"] in taken_place,
            "decided": decided_podium(finale_by_saison.get(str(raw["_id"]), [])) is not None,
            "count_teams": teams_by_saison.get(str(raw["_id"]), 0),
        }
        for raw in saisons_raw
    ]

    return FLSaisonsAdminListResponse(saisons=FLSaisonAdminListAdapter.validate_python(saisons))


# Declared after `/list/admin`, which it would otherwise answer with `list` as a season id; a static suffix rather than
# a second `GET /{saison_id}`, which the public router owns at this same prefix.
@router.get("/{saison_id}/admin", response_model=FLSaisonAdminResponse, summary="One Saison for the admin editor")
async def get_saison_admin(
    saison_id: str,
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spiele_collection: SpieleCollection,
    spieltage_collection: SpieltageCollection,
    teams_collection: TeamsCollection,
    spielberichte_collection: SpielberichteCollection,
    invitations_collection: InvitationsCollection,
    ban_list: BanListLookup,
    today: str = Depends(get_german_date_str),
) -> FLSaisonAdminResponse:
    """
    Return what the season editor shows in one read: its season, clubs, shapes and matchdays, its acts' states and its links.

    The season is served a `future` one included, with its `version`, whether it has started (`begun`), whether a
    fixture of it has taken place (`taken_place`) and whether it is decided (`decided`), by the landing's own rule.

    Each club's two flags are what the group swap's `swap_sides_taken_place` and the replacement's
    `replace_sides_taken_place` read, so a picker closes exactly the pairs and rows those writes refuse; `begun` closes
    both before either is pressed. `incoming_clubs` is every club still in the league holding no row of the season,
    which is what the replacement admits.

    `refusals` names, per act, the refusal its write would answer now, by that write's own judgement, so the editor
    offers an act exactly where the write takes it. `invitations` is the registration links' press planned by the function
    the press decides each team by, `resend` left false, beside each team's live link and the day it was last sent.
    Read outside a transaction: a write landing between this read and a press is judged by the press. 404 where no
    season holds that id.
    """

    # First and alone: a season id naming nothing raises the 404 here, and the activation is judged on the status read.
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id})
    saison_status = str(saison_raw["status"])

    # Two groups of reads sent at once, because `asyncio.gather`'s typing stops at six.
    (rows, fixtures, count_spieltage, clubs, finale_by_saison), (activation, recorded_rows, berichte, planned) = await asyncio.gather(
        asyncio.gather(
            pull_many_from_db(
                collection=saison_teams_collection,
                db_filter={"saison_id": saison_id},
                projection=["team_id", "name", "shorthand", "gruppe", "austritt"],
                sort_by=build_sort(sort_by="name", order="asc"),
                collation=GERMAN_COLLATION,
                limit=LIST_LIMIT_DEFAULT + 1,
            ),
            pull_many_from_db(
                collection=spiele_collection,
                db_filter={"saison_id": saison_id},
                projection=["saison_phase", "team1.team_id", "team2.team_id", *TAKEN_PLACE_FIELDS],
                limit=LIST_LIMIT_DEFAULT + 1,
            ),
            spieltage_collection.count_documents({"saison_id": saison_id}),
            pull_many_from_db(
                collection=teams_collection,
                db_filter={"inactive_since": None},
                projection=["name", "shorthand"],
                sort_by=build_sort(sort_by="name", order="asc"),
                collation=GERMAN_COLLATION,
                limit=LIST_LIMIT_DEFAULT + 1,
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
            count_eingereichte_berichte(spielberichte_collection=spielberichte_collection, saison_id=saison_id, session=None),
            _plan_the_dispatch(
                saison_id=saison_id,
                saison_teams_collection=saison_teams_collection,
                invitations_collection=invitations_collection,
                ban_list=ban_list,
                resend=False,
            ),
        ),
    )
    recorded_fixtures = sum(1 for spiel in recorded_rows if holds_a_recorded_fact(spiel))

    def code_of(refusal: WriteRefusal | None) -> Code | None:
        return None if refusal is None else refusal.error_code

    # One over the cap, as `fl_backend/app/api/spiele/crud.py :: advance_bracket_winners` asks: a truncated list grades a
    # club open whose taken-place fixture fell past the page, and offers a club the replacement refuses as entered.
    for listed, what in ((rows, "teams"), (fixtures, "fixtures"), (clubs, "clubs")):
        if len(listed) > LIST_LIMIT_DEFAULT:
            raise ValueError(f"season {saison_id} reads more than {LIST_LIMIT_DEFAULT} {what}, which is more than one read can grade")

    played = [spiel for spiel in fixtures if has_taken_place(spiel)]

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
            fixtures_drawn=len(recorded_rows),
            spieltage_held=count_spieltage,
            rules=saison.rules,
            occupancy_by_gruppe=occupancy,
            replace=replace,
            recorded_fixtures=recorded_fixtures,
        )

    return FLSaisonAdminResponse(
        saison=saison,
        teams=[
            FLSaisonAdminTeam.model_validate(
                {
                    **row,
                    "group_fixture_taken_place": has_played(row["team_id"], group_only=True),
                    "fixture_taken_place": has_played(row["team_id"], group_only=False),
                }
            )
            for row in rows
        ],
        incoming_clubs=[FLSaisonAdminClub.model_validate(club) for club in clubs if club["_id"] not in entered],
        shapes=workable_shapes(saison.rules),
        count_spieltage=count_spieltage,
        refusals=FLSaisonActRefusals(
            activate=code_of(activation[1]),
            # The draw's own judgement of the stored rules, the ones both presses draw, over the clubs entered.
            create=code_of(draw_refusal(replace=False)),
            recreate=code_of(draw_refusal(replace=True) or find_berichte_refusal(berichte=berichte)),
            undraw=code_of(_find_undraw_refusal_of(saison_status=saison_status, recorded_fixtures=recorded_fixtures, berichte=berichte)),
        ),
        invitations=[
            FLInvitationLinkRow(
                team_id=team.team["team_id"],
                team_name=team.team["name"],
                recipient=team.plan.recipient,
                skipped=team.plan.skipped,
                replaced_link=team.plan.replaced_link,
                has_link=team.live is not None,
                sent_at=None if team.live is None else FLEinladung.model_validate(team.live).sent_at,
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
    Create a season, always `future`.

    The id is supplied rather than generated -- it is the string every `saison_id` elsewhere
    references, so reusing one is refused `duplicate_key`, naming `id`. Making the season live is a separate step.
    """

    refuse(
        find_rules_refusal(
            stored=None,
            proposed=saison_data.rules,
            occupancy_by_gruppe={},
            highest_wired_platz=0,
        )
    )

    # After the rules: an impossible bracket makes the implied matchday count meaningless.
    refuse(
        find_saison_span_refusal(
            start_date=saison_data.start_date,
            end_date=saison_data.end_date,
            rules=saison_data.rules,
            spieltag_spans=[],
        )
    )

    async def enter_the_season(session: AsyncClientSession) -> InsertOneResult:
        holder = await saisons_collection.find_one({"_id": saison_data.id}, projection={"_id": 1}, session=session)
        refuse(find_saison_id_refusal(taken=holder is not None))
        return await post_one_to_db(
            collection=saisons_collection,
            # `_id` rather than `id`: this payload's `id` IS the document key.
            document={**saison_data.model_dump(mode="json", exclude={"id"}), "_id": saison_data.id, "status": "future"},
            session=session,
        )

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
        drawn_fixtures = sum(per_spieltag.values())

        for spieltag_id, attached in per_spieltag.items():
            phase = phase_of_spieltag.get(spieltag_id)
            # A fixture pointing at another season's matchday, or at none, exceeds no count here.
            if phase is not None:
                attached_by_phase[phase] = max(attached_by_phase.get(phase, 0), attached)

        largest_squad_rows = await (
            await saison_spieler_collection.aggregate(
                [
                    {"$match": {"saison_id": saison_id, "inactive_since": None}},
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
            (str(row["beginn"]), str(row["ende"]))
            async for row in spieltage_collection.find(
                {"saison_id": saison_id, "beginn": {"$ne": None}, "ende": {"$ne": None}}, {"beginn": 1, "ende": 1}, session=session
            )
        ]

        taken_place = saison_id in await saisons_with_a_fixture_taken_place(
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
                drawn_fixtures=drawn_fixtures,
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
    saisons_collection: AsyncCollection,
    spiele_collection: AsyncCollection,
    spieltage_collection: AsyncCollection,
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
    target_fixtures = await spiele_collection.count_documents({"saison_id": saison_id}, session=session)

    # In-session for `target_status`'s reason, and `beginn` alone: `ende` is dated with it, and a
    # matchday half-dated is a shape no write here produces.
    undated_spieltage = await spieltage_collection.count_documents({"saison_id": saison_id, "beginn": None}, session=session)

    return outgoing_ids, find_activation_refusal(
        target_status=target_status,
        target_fixtures=target_fixtures,
        undated_spieltage=undated_spieltage,
        outgoing_unplayed=unplayed,
    )


async def _pull_recorded_fact_rows(
    *, spiele_collection: AsyncCollection, saison_id: str, session: AsyncClientSession | None
) -> list[Mapping[str, Any]]:
    """The season's fixtures as `holds_a_recorded_fact` reads them, which the planning window of the replace and the undraw turns on.

    The predicate's own fields, so the projection cannot fall behind what it reads: a venue, a referee or an admin's note
    is work a replace would destroy, and the window closes on one exactly as on a result. Read one over the cap and
    refused past it, as `fl_backend/app/api/spiele/crud.py :: advance_bracket_winners` asks: a truncated list counts fewer
    records than the season holds, and the window opens on work the removal would destroy.
    """

    stored_spiele = await pull_many_from_db(
        collection=spiele_collection,
        db_filter={"saison_id": saison_id},
        projection=list(RECORDED_FACT_FIELDS),
        limit=LIST_LIMIT_DEFAULT + 1,
        session=session,
    )

    if len(stored_spiele) > LIST_LIMIT_DEFAULT:
        raise ValueError(
            f"season {saison_id} holds more than {LIST_LIMIT_DEFAULT} fixtures, more than one read can weigh a replace or an undraw against"
        )

    return stored_spiele


def _find_undraw_refusal_of(*, saison_status: str, recorded_fixtures: int, berichte: int) -> WriteRefusal | None:
    """The undraw's whole judgement, in its order: its window, then the reports it would delete."""

    return find_undraw_refusal(saison_status=saison_status, recorded_fixtures=recorded_fixtures) or find_berichte_refusal(berichte=berichte)


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

        # ERASED rather than deleted: a retention period
        # ended, which is the distinction between the two helpers, and a `before` image would
        # outlive the bound by the log's own twelve months.

        # `$lt` and not `$lte`: the season named on a row is the last one the ban covers, so the row
        # lapses on the activation of the season AFTER it.
        await erase_many_from_db(
            collection=ban_list_collection,
            db_filter={"barred_until_saison_id": {"$lt": saison_id}},
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

        entered_rows = await pull_many_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id},
            # `name` and `shorthand` off the JUNCTION: that is the name the season is played under,
            # and `teams` may since have been renamed.
            projection=["team_id", "gruppe", "name", "shorthand"],
            limit=LIST_LIMIT_DEFAULT + 1,
            session=session,
        )

        # One over the cap, as `fl_backend/app/api/spiele/crud.py :: advance_bracket_winners` asks:
        # a truncated entry list draws a season short of teams and
        # weighs a group occupancy no group holds.
        if len(entered_rows) > LIST_LIMIT_DEFAULT:
            raise ValueError(f"season {saison_id} holds more than {LIST_LIMIT_DEFAULT} entry rows, which is more than one read can draw from")

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
                fixtures_drawn=len(stored_spiele),
                spieltage_held=await spieltage_collection.count_documents({"saison_id": saison_id}, session=session),
                rules=rules,
                occupancy_by_gruppe=occupancy,
                replace=spielplan_data.replace,
                recorded_fixtures=sum(1 for spiel in stored_spiele if holds_a_recorded_fact(spiel)),
            )
        )
        if spielplan_data.replace:
            refuse(
                find_berichte_refusal(
                    berichte=await count_eingereichte_berichte(
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
            # The season a report's first write anchors, so the two conflict: the watermark's `$set` below can change
            # nothing on a same-day redraw, and the report's insert meets no delete here.
            await anchor_the_season_reported_in(saisons_collection=saisons_collection, saison_id=saison_id, session=session)
            # NOT extracted, though `delete_spielplan` repeats it: two sites are no pattern yet.
            await delete_many_from_db(collection=spielbestaetigungen_collection, db_filter={"saison_id": saison_id}, session=session)
            await delete_many_from_db(collection=spielberichte_collection, db_filter={"saison_id": saison_id}, session=session)
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
                    berichte=await count_eingereichte_berichte(
                        spielberichte_collection=spielberichte_collection, saison_id=saison_id, session=None
                    )
                )
            )

        watermark = FLSaisonSpielplan(generated_at=today, spieltage=len(drawn.spieltage), spiele=len(drawn.spiele))
        # ONE `$set` inside the transaction: the shape and the draw it produced are one fact, so one
        # write carries one pre-image -- the season before either moved. Two would log a `before`
        # holding rules that were never the season's.
        await patch_one_in_db(
            collection=saisons_collection,
            db_filter={"_id": saison_id},
            update={"$set": {**shape_written, "spielplan": watermark.model_dump(mode="json")}},
            session=session,
            # Nothing here reads the result, and `AFTER` would re-read the whole season inside the
            # transaction to build one. The log takes its pre-image from the update itself either
            # way.
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )

        return FLGenerateSpielplanResponse(
            saison_id=saison_id,
            spieltage=watermark.spieltage,
            spiele=watermark.spiele,
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
                recorded_fixtures=sum(1 for spiel in stored_spiele if holds_a_recorded_fact(spiel)),
                berichte=await count_eingereichte_berichte(
                    spielberichte_collection=spielberichte_collection, saison_id=saison_id, session=session
                ),
            )
        )

        # The season a report's first write anchors, so the two conflict: the `$unset` below changes nothing on a season
        # holding no watermark, and the report's insert meets no delete here.
        await anchor_the_season_reported_in(saisons_collection=saisons_collection, saison_id=saison_id, session=session)

        # Fixtures first, the reverse of the draw's write order: neither the log's rows nor a restore
        # replaying them then holds a fixture whose matchday is already gone. Confirmations and reports
        # go first for that reason, each naming the fixture it is about.
        await delete_many_from_db(collection=spielbestaetigungen_collection, db_filter={"saison_id": saison_id}, session=session)
        await delete_many_from_db(collection=spielberichte_collection, db_filter={"saison_id": saison_id}, session=session)
        removed_spiele = await delete_many_from_db(collection=spiele_collection, db_filter={"saison_id": saison_id}, session=session)
        removed_spieltage = await delete_many_from_db(collection=spieltage_collection, db_filter={"saison_id": saison_id}, session=session)

        # INSIDE the transaction holding both removals: a season
        # keeping its watermark while its fixtures are gone reads as drawn, and `$unset` is the shape
        # a season nobody has drawn carries.
        before = await patch_one_in_db(
            collection=saisons_collection,
            db_filter={"_id": saison_id},
            update={"$unset": {"spielplan": ""}},
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )

        # The replace's reason.
        refuse(
            find_berichte_refusal(
                berichte=await count_eingereichte_berichte(spielberichte_collection=spielberichte_collection, saison_id=saison_id, session=None)
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


async def _entered_teams(*, saison_teams_collection: AsyncCollection, saison_id: str) -> list[Mapping[str, Any]]:
    """Every team this season holds, ordered as its other lists are.

    Read one over the cap and refused past it (`app/api/spiele/crud.py :: advance_bracket_winners`'s
    reason): a truncated list silently leaves teams unmailed, which is what this press exists to stop.
    """

    entered = await pull_many_from_db(
        collection=saison_teams_collection,
        db_filter={"saison_id": saison_id},
        projection=["team_id", "name", "kontakte", "austritt"],
        sort_by=build_sort(sort_by="name", order="asc"),
        collation=GERMAN_COLLATION,
        limit=LIST_LIMIT_DEFAULT + 1,
    )

    if len(entered) > LIST_LIMIT_DEFAULT:
        raise ValueError(f"season {saison_id} holds more than {LIST_LIMIT_DEFAULT} teams, which is more than one read can mail in one press")

    return entered


async def _barred_recipients(ban_list: BanList, entered: Sequence[Mapping[str, Any]]) -> set[str]:
    """Every stored address of the season's confirmed seats a standing ban holds, one read for all its teams."""

    addresses = [person.email for team in entered for person in bestaetigte_empfaenger(kontakte=team.get("kontakte"))]

    return await barred_addresses(ban_list, addresses) if addresses else set()


class _PlannedTeam(NamedTuple):
    """One team as a press made now would treat it, beside the live link it holds."""

    team: Mapping[str, Any]
    live: Mapping[str, Any] | None
    plan: EinladungVersandPlan


async def _plan_the_dispatch(
    *,
    saison_id: str,
    saison_teams_collection: AsyncCollection,
    invitations_collection: AsyncCollection,
    ban_list: BanList,
    resend: bool,
) -> list[_PlannedTeam]:
    """Every team of the season planned by `plan_einladung_versand`, the function the press decides each team by.

    Read outside any transaction, for the preview and the editor's read: the press plans each team again in its own.
    """

    entered = await _entered_teams(saison_teams_collection=saison_teams_collection, saison_id=saison_id)
    team_ids = [team["team_id"] for team in entered]

    # Keyed on the teams just read rather than on the season alone: `uniq_invitation_live` makes that
    # at most one row per team, so this read cannot truncate and report a mailed team as unmailed.
    live = await pull_many_from_db(
        collection=invitations_collection,
        db_filter={"saison_id": saison_id, "team_id": {"$in": team_ids}, **LIVE_EINLADUNG},
        limit=len(team_ids) or 1,
        projection=dict(WITHOUT_TOKEN_HASH),
    )
    by_team = {row["team_id"]: row for row in live}
    barred = await _barred_recipients(ban_list, entered)

    planned: list[_PlannedTeam] = []
    for team in entered:
        einladung_raw = by_team.get(team["team_id"])
        plan = plan_einladung_versand(
            austritt=team.get("austritt"),
            kontakte=team.get("kontakte"),
            einladung_raw=einladung_raw,
            resend=resend,
            barred=barred,
        )
        planned.append(_PlannedTeam(team=team, live=einladung_raw, plan=plan))

    return planned


async def _mail_one_team(
    *,
    invitations_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    db: AsyncMongoClient,
    saison_id: str,
    team: Mapping[str, Any],
    resend: bool,
    barred: set[str],
    created_by: str,
    today: str,
    now: datetime,
) -> FLInvitationDispatchRow:
    """One team's whole share of the press, its revoke, its fresh row and the mails it owes, in a transaction of its own.

    Per team rather than one for all: a season's worth of mints in one transaction would take back
    the teams already done on a write conflict. A team's commit holds its fresh row and every mail
    owed about it together, so no team is left holding a link nobody is owed.
    """

    # What the callback's last run read and planned, kept for a transaction that raises: whether the
    # team held a link, and whether that commit may have revoked it, is what its row then tells the admin.
    ersetzt_link = False
    hatte_link: bool | None = None

    async def mint_where_the_team_qualifies(session: AsyncClientSession) -> FLInvitationDispatchRow:
        """Plan this team, then revoke, insert and owe where the plan says to.

        The INVITE and its mails alone are read in-session: the withdrawal and the contacts come from
        the read before the loop, so a retry re-decides on those as they stood then.
        """

        nonlocal ersetzt_link, hatte_link
        # Reset before the read: a retry raising ahead of it would otherwise report the previous
        # attempt's link, which a rival's press may have revoked since.
        ersetzt_link, hatte_link = False, None

        live = await pull_many_from_db(
            collection=invitations_collection,
            db_filter=build_live_team_filter(saison_id=saison_id, team_id=team["team_id"]),
            limit=1,
            projection=dict(WITHOUT_TOKEN_HASH),
            session=session,
        )
        plan = plan_einladung_versand(
            austritt=team.get("austritt"),
            kontakte=team.get("kontakte"),
            einladung_raw=live[0] if live else None,
            resend=resend,
            barred=barred,
        )
        ersetzt_link, hatte_link = plan.replaced_link, bool(live)

        if plan.skipped is not None:
            return FLInvitationDispatchRow(
                team_id=team["team_id"],
                team_name=team["name"],
                recipient=[],
                skipped=plan.skipped,
                replaced_link=plan.replaced_link,
                had_link=bool(live),
            )

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
            document=compose_einladung(
                saison_id=saison_id, team_id=team["team_id"], token_hashes=[], created_by=created_by, today=today, sent_at=today
            ),
            session=session,
        )
        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=owed_einladung_mails(
                invitation_id=post_operation.inserted_id,
                team_name=team["name"],
                saison_id=saison_id,
                recipient=plan.recipient,
                occasion="versand",
            ),
            now=now,
        )

        return FLInvitationDispatchRow(
            team_id=team["team_id"],
            team_name=team["name"],
            recipient=plan.recipient,
            skipped=None,
            replaced_link=plan.replaced_link,
            had_link=bool(live),
        )

    # Caught outside the session: a failure the session never sees leaves the transaction open on the
    # server.
    try:
        async with transaction_session(db) as session:
            return await session.with_transaction(mint_where_the_team_qualifies)
    except PyMongoError as failure:
        # Per TEAM: every team already done is committed with its mails. A commit sent and never answered may have revoked
        # this team's link and owed its mails too, so its row says unknown rather than failed.
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

        return FLInvitationDispatchRow(
            team_id=team["team_id"],
            team_name=team["name"],
            recipient=[],
            skipped="mint_uncertain" if uncertain else "mint_failed",
            # A failed commit replaced nothing; an unanswered one may have replaced the link the
            # plan found, and a team that held none must not read about one.
            replaced_link=uncertain and ersetzt_link,
            had_link=hatte_link,
        )


@router.get(
    "/{saison_id}/invitations/dispatch/preview",
    response_model=FLInvitationDispatchPreviewResponse,
    summary="Who the send would reach",
)
async def get_invitations_dispatch_preview(
    saison_id: str,
    saison_teams_collection: SaisonTeamsCollection,
    invitations_collection: InvitationsCollection,
    saisons_collection: SaisonsCollection,
    ban_list: BanListLookup,
    resend: bool = False,
) -> FLInvitationDispatchPreviewResponse:
    """
    Per team of this season, the mailboxes the send would write to and the reason it would skip a team — and it writes nothing itself.

    Decided by the function the send itself decides by, so the list read here is the list performed. `resend` mirrors the send's own
    switch: left false, a team whose live link was already sent, by the day stored on it, reads as `already_sent`, and pressing the send with
    `resend` true instead makes this preview's own answer wrong unless the same value is asked for here.

    **`replaced_link` is the warning this list carries**: the send mints for every team it answers, so a team already holding a link has that
    link REVOKED and the copy in somebody's inbox opens nothing from that moment. A row carries no trace of the invitation the team holds,
    so a page offering the press reads that fact here or nowhere.

    Five skips, each an ordinary state rather than a refusal: the team has left this season, it holds no contact block, no seat of that
    block has been confirmed by its own person, every confirmed seat's address is on the ban list, or its live link was already
    sent and `resend` is false. A season holding
    no team answers an empty list. One row per MAILBOX, so a person sitting in two seats is named once. 404 where no season holds that id.
    """

    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])

    planned = await _plan_the_dispatch(
        saison_id=saison_id,
        saison_teams_collection=saison_teams_collection,
        invitations_collection=invitations_collection,
        ban_list=ban_list,
        resend=resend,
    )

    return FLInvitationDispatchPreviewResponse(
        saison_id=saison_id,
        rows=[
            FLInvitationDispatchPreviewRow(
                team_id=team.team["team_id"],
                team_name=team.team["name"],
                recipient=team.plan.recipient,
                skipped=team.plan.skipped,
                replaced_link=team.plan.replaced_link,
            )
            for team in planned
        ],
    )


@router.get(
    "/{saison_id}/erasure/preview",
    response_model=FLErasurePreviewResponse,
    summary="How many pupils activating this season would delete",
)
async def get_erasure_preview(
    saison_id: str,
    saisons_collection: SaisonsCollection,
    spieler_collection: SpielerCollection,
    registrierungen_collection: RegistrierungenCollection,
) -> FLErasurePreviewResponse:
    """
    How many pupils `POST /identity/erasure/sweep` deletes once this season is activated, and which season that activation closes.

    Judged by the run's own rule over the statuses the activation leaves: the season now `active` turned `past`, this one
    `active`, every other as it stands. A count and never a name, and writes nothing. It judges none of the activation's own
    refusals, and the people it counts are those due at this moment: a squad row or a registration arriving before the run
    keeps its pupil, and a pupil whose stored address no request matches is counted though the run passes them over.
    `completed_saison_id` is null where no season but this one is `active`. 404 where no season holds that id.
    """

    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])

    statuses = await saison_statuses(saisons_collection=saisons_collection)
    spieler = await due_count(
        statuses_after_activating(statuses, saison_id),
        spieler_collection=spieler_collection,
        registrierungen_collection=registrierungen_collection,
    )

    return FLErasurePreviewResponse(completed_saison_id=closed_by(statuses, saison_id), spieler=spieler)


@router.post(
    "/{saison_id}/invitations/dispatch",
    response_model=FLInvitationDispatchResponse,
    summary="Mint every admitted team a link",
)
async def post_invitations_dispatch(
    saison_id: str,
    versand_data: Annotated[FLInvitationDispatchPayload, Body()],
    saison_teams_collection: SaisonTeamsCollection,
    invitations_collection: InvitationsCollection,
    saisons_collection: SaisonsCollection,
    outbox_collection: OutboxCollection,
    ban_list: BanListLookup,
    db: DBClient,
    created_by: str = Depends(get_actor_email),
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLInvitationDispatchResponse:
    """
    Give every admitted team of this season a fresh registration link and owe it to the team's confirmed seats, one mail each.

    **Every team mailed gets a fresh invite, and any link that team already held is REVOKED in the same per-team transaction** — the
    copy in somebody's inbox opens nothing from that moment. The mails are owed in that transaction too, each minting its link when it is
    handed out; no link is answered. `replaced_link` says of each row whether a link died for it, and the preview answers it before the
    press. A team this skips is left exactly as it was.

    Five skips, each an ordinary state rather than a refusal: the team has left this season, it holds no contact block, no seat of that block
    has been confirmed by its own person, every confirmed seat's address is on the ban list, or its live link was already sent and
    `resend` is false. **The ban is read once ahead of every team**, so a team the mailer could reach nobody of keeps the link it
    holds rather than losing it to a press that mails nobody. **The fifth is read off the day the live link was sent, stored on it**,
    never off the Postausgang, whose row is erased a retention after it settles: pressing twice mails nobody twice, and a link a club
    holds is replaced only by a deliberate resend. **The first is read off the junction row's
    `austritt` record**, so a team out of the season by either route is passed over; minting for one team by hand is not refused, that
    being a deliberate act rather than a bulk one.

    Refused where the season has ended (`saison_past`); 404 where no season holds that id; a season holding no team answers an
    empty list.

    **An administrator whose access is revoked while the mailing runs is refused `actor_not_admin` at the next team**: every team done before
    that point holds its fresh link and its mails, and running the mailing again, as an administrator who still holds access, skips those
    teams and reaches the rest.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"])
    refuse(find_saison_vorbei_refusal(saison_status=str(saison_raw["status"])))

    entered = await _entered_teams(saison_teams_collection=saison_teams_collection, saison_id=saison_id)
    # Read once ahead of the loop, as the withdrawal and the contacts are: a retry re-decides on them as they stood.
    barred = await _barred_recipients(ban_list, entered)

    # Sequential rather than gathered: each team opens its own session, and sixteen at once would
    # hold sixteen against a pool sized for the whole application.
    zeilen = [
        await _mail_one_team(
            invitations_collection=invitations_collection,
            outbox_collection=outbox_collection,
            db=db,
            saison_id=saison_id,
            team=team,
            resend=versand_data.resend,
            barred=barred,
            created_by=created_by,
            today=today,
            now=germany_now,
        )
        for team in entered
    ]

    return FLInvitationDispatchResponse(saison_id=saison_id, rows=zeilen)
