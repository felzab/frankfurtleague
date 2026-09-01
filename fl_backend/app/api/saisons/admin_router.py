from typing import Annotated, Any, Mapping, Sequence

from fastapi import APIRouter, Body, Depends
from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorCollection
from pymongo import ReturnDocument

from app.api.saisons.cache import invalidate_saison_cache
from app.api.saisons.schemas import (
    FLActivateSaisonResponse,
    FLGenerateSpielplanPayload,
    FLGenerateSpielplanResponse,
    FLPatchSaisonPayload,
    FLPatchSaisonResponse,
    FLPostSaisonPayload,
    FLPostSaisonResponse,
    FLSaison,
    FLSaisonListAdapter,
    FLSaisonRules,
    FLSaisonsFilterParams,
    FLSaisonsListResponse,
    FLSaisonSpielplan,
    FLSwapGruppenPayload,
    FLSwapGruppenResponse,
    FLUndrawSpielplanResponse,
)
from app.api.saisons.services import (
    RECORDED_FACT_FIELDS,
    find_activation_refusal,
    find_rules_refusal,
    find_saison_span_refusal,
    find_spielplan_refusal,
    find_undraw_refusal,
    holds_a_recorded_fact,
    unplayed_spiel_nrs,
    with_schedule,
)
from app.api.saisons.spielplan import EnteredTeam, draw_spielplan
from app.api.spiele.schemas import KNOCKOUT_PHASES, FLSpielListAdapter
from app.api.teams.schemas import FLGruppenNames
from app.api.teams.services import find_gruppe_swap_refusal, fixtures_newly_fielding_a_departed_club, has_taken_place
from app.core.config import API_VERSION
from app.core.crud import (
    build_query,
    build_sort,
    delete_many_from_db,
    patch_many_in_db,
    patch_one_in_db,
    post_many_to_db,
    post_one_to_db,
    pull_many_from_db,
    pull_one_from_db,
    refuse,
)
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonTeamsCollection,
    SpieleCollection,
    SpieltageCollection,
    TeamsCollection,
    get_german_date_str,
)
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.core.security import bind_actor, verify_access_admin

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/saisons",
    dependencies=[Depends(verify_access_admin), Depends(bind_actor)],
)

# No `tore`: goals belong to whoever scored them, and `has_taken_place` leaves none to move.
SWAPPED_SIDE_KEYS: tuple[str, ...] = ("team_id", "name", "shorthand")


def _spieltag_clashes(
    *,
    team_ids: Sequence[Any],
    gruppenphase_spiele: Sequence[Mapping[str, Any]],
    knockout_spiele: Sequence[Mapping[str, Any]],
) -> int:
    """How many Spieltage would double one of these clubs once they exchange (`REQ-SWAP-005`).

    A bijection over the Gruppenphase, so afterwards a club stands in its OWN knockout fixtures plus
    the OTHER's group ones.
    """

    other_of = {team_ids[0]: team_ids[1], team_ids[1]: team_ids[0]}

    # Split by whether the rewrite moves the fixture: a group side becomes the other club's and a
    # bracket side stays put, which is the whole arithmetic below.
    moved: dict[tuple[Any, Any], int] = {}
    fixed: dict[tuple[Any, Any], int] = {}

    for spiele, counted in ((gruppenphase_spiele, moved), (knockout_spiele, fixed)):
        for spiel in spiele:
            spieltag_id = spiel.get("spieltag_id")
            if spieltag_id is None:
                continue
            for slot in ("team1", "team2"):
                occupant = (spiel.get(slot) or {}).get("team_id")
                if occupant in other_of:
                    counted[(occupant, spieltag_id)] = counted.get((occupant, spieltag_id), 0) + 1

    offending: set[Any] = set()
    for club in team_ids:
        other = other_of[club]
        for spieltag_id in {day for held, day in fixed if held == club} | {day for held, day in moved if held == other}:
            before = fixed.get((club, spieltag_id), 0) + moved.get((club, spieltag_id), 0)
            after = fixed.get((club, spieltag_id), 0) + moved.get((other, spieltag_id), 0)
            # Only a Spieltag the exchange BREAKS, never one already broken.
            if after > 1 and before <= 1:
                offending.add(spieltag_id)

    return len(offending)


async def _rewrite_gruppenphase_sides(
    *,
    spiele: Sequence[Mapping[str, Any]],
    team_ids: Sequence[Any],
    spiele_collection: AsyncIOMotorCollection,
    teams_collection: AsyncIOMotorCollection,
    session: AsyncIOMotorClientSession,
) -> int:
    """Rewrite each club's side of these fixtures to the other, returning how many were touched.

    Named by `_id` from a snapshot read BEFORE any write: filtering on the club would let the second
    pass match what the first just wrote and swap it back.
    """

    identities = await pull_many_from_db(
        collection=teams_collection,
        db_filter={"_id": {"$in": list(team_ids)}},
        # `teams`, while `app/api/spiele/services.py :: _composed_side` reads the season's
        # `saison_teams` row: they differ only in a `past` season, which `REQ-SWAP-003` refuses.
        # Spelled out, not sliced off `SWAPPED_SIDE_KEYS`, whose order would then matter.
        projection=["name", "shorthand"],
        session=session,
    )
    identity_of = {row["_id"]: row for row in identities}

    # Raising here aborts the transaction rather than writing half an exchange.
    for team_id in team_ids:
        if team_id not in identity_of:
            raise DocumentNotFoundException(filter={"_id": team_id}, error_code=DOCUMENT_NOT_FOUND)

    other_of = {team_ids[0]: team_ids[1], team_ids[1]: team_ids[0]}

    # One `update_many` writes one path with one value, so the passes split by `(slot, occupant)`.
    by_pass: dict[tuple[str, Any], list[Any]] = {}
    for spiel in spiele:
        for slot in ("team1", "team2"):
            occupant = (spiel.get(slot) or {}).get("team_id")
            if occupant in other_of:
                by_pass.setdefault((slot, occupant), []).append(spiel["_id"])

    for (slot, occupant), spiel_ids in by_pass.items():
        target = other_of[occupant]
        identity = identity_of[target]
        await patch_many_in_db(
            collection=spiele_collection,
            db_filter={"_id": {"$in": spiel_ids}},
            update={"$set": {f"{slot}.{key}": (target if key == "team_id" else identity[key]) for key in SWAPPED_SIDE_KEYS}},
            session=session,
        )

    # The fixtures, not the sides: `modified_count` double-counts a fixture fielding both clubs, and
    # reports 0 where the value already matched.
    return len({spiel_id for spiel_ids in by_pass.values() for spiel_id in spiel_ids})


# Two segments, because `GET /saisons/{saison_id}` is declared first and would answer a single static
# one: a season id is a plain four-character string, so the `objectid` convertor cannot separate them
# (`docs/backend/spec.md :: I37`).
@router.get("/list/admin", response_model=FLSaisonsListResponse, summary="Every Saison for the admin surfaces")
async def get_saisons_for_admin(saisons_collection: SaisonsCollection, filters: FLSaisonsFilterParams = Depends()) -> FLSaisonsListResponse:
    """
    List every season, the `future` ones `GET /saisons` withholds included.

    The admin surfaces read here because a season is created `future` and clubs are entered while it
    still is, so an admin who cannot see one cannot run the league.
    """

    db_filter = build_query(filters, terms={"status"})
    db_sort = build_sort(sort_by=filters.sort_by, order=filters.order)

    saisons_raw = await pull_many_from_db(
        collection=saisons_collection,
        db_filter=db_filter,
        limit=filters.limit,
        sort_by=db_sort,
    )

    return FLSaisonsListResponse(saisons=FLSaisonListAdapter.validate_python([with_schedule(raw) for raw in saisons_raw]))


@router.post("", response_model=FLPostSaisonResponse, status_code=201, summary="Create a Saison")
async def post_saison(
    saison_data: Annotated[FLPostSaisonPayload, Body()],
    saisons_collection: SaisonsCollection,
) -> FLPostSaisonResponse:
    """
    Create a season, always `future`.

    The id is supplied rather than generated -- it is the string every `saison_id` elsewhere
    references, so reusing one comes back 409. Making the season live is a separate step.
    """

    refuse(
        find_rules_refusal(
            saison_status="future",
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

    post_operation = await post_one_to_db(
        collection=saisons_collection,
        # `_id` rather than `id`: this payload's `id` IS the document key.
        document={**saison_data.model_dump(mode="json", exclude={"id"}), "_id": saison_data.id, "status": "future"},
    )

    # Nothing cached is wrong yet; dropped anyway, so the rule stays "every season write drops it".
    invalidate_saison_cache()

    return FLPostSaisonResponse(
        acknowledged=1 if post_operation.acknowledged else 0,
        created_id=str(post_operation.inserted_id),
    )


@router.patch("/{saison_id}", response_model=FLPatchSaisonResponse, summary="Update a Saison's dates and rules")
async def patch_saison(
    saison_id: str,
    saison_data: Annotated[FLPatchSaisonPayload, Body()],
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spiele_collection: SpieleCollection,
    spieltage_collection: SpieltageCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    db: DBClient,
) -> FLPatchSaisonResponse:
    """
    Update a season's dates and rules. `status` is on no payload.

    Editing the points moves every league table on the NEXT READ, standings being derived. What a
    finished or drawn season has fixed is refused, as is a rule narrowed below what it holds.
    """

    async def judge_and_write_the_rules(session: AsyncIOMotorClientSession) -> FLPatchSaisonResponse:
        """Judge, then write the season's dates and rules. Everything judged is read in-session."""

        # THROUGH the session, as the draw's reads are: a retry after a write conflict has to judge
        # the season as it stands then. A season id naming nothing raises the 404 here.
        stored_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)

        # Disqualified rows included: a team never leaves a season.
        occupancy: dict[Any, int] = {}
        async for row in saison_teams_collection.find({"saison_id": saison_id}, {"gruppe": 1}, session=session):
            gruppe = row.get("gruppe")
            if gruppe is not None:
                occupancy[gruppe] = occupancy.get(gruppe, 0) + 1

        # Both sides, because a `quelle` sits on either; 0 where no slot is group-seeded.
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
        # fixture's can disagree with.
        attached_by_phase: dict[Any, int] = {}
        phase_of_spieltag: dict[Any, Any] = {}
        async for spieltag in spieltage_collection.find({"saison_id": saison_id}, {"saison_phase": 1}, session=session):
            phase_of_spieltag[spieltag["_id"]] = spieltag["saison_phase"]

        per_spieltag: dict[Any, int] = {}
        played_knockout = 0
        # ONE pass for both counts, and `has_taken_place` over the documents rather than a `$match`
        # of its own: a predicate here and an equivalent filter there would drift, as the group swap
        # avoids for the same rule (`REQ-SWAP-002`).
        async for spiel in spiele_collection.find(
            {"saison_id": saison_id},
            {"spieltag_id": 1, "saison_phase": 1, "ergebnis": 1, "sonderereignis": 1, "team1.tore": 1, "team2.tore": 1},
            session=session,
        ):
            per_spieltag[spiel["spieltag_id"]] = per_spieltag.get(spiel["spieltag_id"], 0) + 1
            # The FIXTURE's own phase, never its matchday's: the bracket was seeded from the placings
            # `REQ-RULES-012` protects, and what was played is what the fixture records.
            if spiel.get("saison_phase") in KNOCKOUT_PHASES and has_taken_place(spiel):
                played_knockout += 1

        # Every fixture of the season, whichever matchday it hangs on: what `REQ-RULES-011` freezes is the
        # draw, and a fixture pointing at another season's matchday came out of this season's rules too.
        drawn_fixtures = sum(per_spieltag.values())

        for spieltag_id, attached in per_spieltag.items():
            phase = phase_of_spieltag.get(spieltag_id)
            # A fixture pointing at another season's matchday, or at none, exceeds no count here.
            if phase is not None:
                attached_by_phase[phase] = max(attached_by_phase.get(phase, 0), attached)

        async def movable_figures(figures_session: AsyncIOMotorClientSession | None) -> tuple[int, list[tuple[str, str]]]:
            """The judged figures a rival can move without conflicting on `saisons`: the largest live squad and the dated matchday spans.

            Occupancy stays out on `app/api/teams/admin_router.py :: post_saison_team`'s concession
            -- a planning bound the draw reports.
            """

            largest_squad_rows = await saison_spieler_collection.aggregate(
                [
                    {"$match": {"saison_id": saison_id, "inactive_since": None}},
                    {"$group": {"_id": "$team_id", "held": {"$sum": 1}}},
                    {"$sort": {"held": -1}},
                    {"$limit": 1},
                ],
                session=figures_session,
            ).to_list(length=1)

            # Dated rows only, filtered in the QUERY rather than after `str()`: a generated matchday carries
            # no span until somebody sets one, and a null stringified to "None" sorts above every date and
            # would be reported as falling outside the season.
            spieltag_spans = [
                (str(row["beginn"]), str(row["ende"]))
                async for row in spieltage_collection.find(
                    {"saison_id": saison_id, "beginn": {"$ne": None}, "ende": {"$ne": None}}, {"beginn": 1, "ende": 1}, session=figures_session
                )
            ]

            return (int(largest_squad_rows[0]["held"]) if largest_squad_rows else 0, spieltag_spans)

        def judge(largest_squad: int, spieltag_spans: Sequence[tuple[str, str]]) -> None:
            refuse(
                find_rules_refusal(
                    saison_status=str(stored_raw["status"]),
                    # Validated, not read raw: a season missing a rules key fails here rather than comparing
                    # against a default nobody chose.
                    stored=FLSaisonRules.model_validate(stored_raw["rules"]),
                    proposed=saison_data.rules,
                    occupancy_by_gruppe=occupancy,
                    highest_wired_platz=highest_platz,
                    largest_squad=largest_squad,
                    attached_by_phase=attached_by_phase,
                    drawn_fixtures=drawn_fixtures,
                    played_knockout_fixtures=played_knockout,
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

        judge(*await movable_figures(session))

        updated_document_raw = await patch_one_in_db(
            collection=saisons_collection,
            db_filter={"_id": saison_id},
            update={"$set": saison_data.model_dump(mode="json")},
            session=session,
            return_document=ReturnDocument.AFTER,
        )

        # Re-judged OUTSIDE the session before answering: the write set is `saisons` alone, so a
        # rival squad write or matchday re-date raises no conflict and no retry (I53;
        # `REQ-RULES-009`, `REQ-DATE-004`). A rival landing after this read still slips through.
        judge(*await movable_figures(None))

        return FLPatchSaisonResponse(updated_document=FLSaison.model_validate(with_schedule(updated_document_raw)))

    # `with_transaction`, not a bare `start_transaction`: a draw landing between this request's
    # judgement and its write would leave the season's rules contradicting its own fixtures, and the
    # retry re-judges against it.
    async with await db.start_session() as session:
        patched = await session.with_transaction(judge_and_write_the_rules)

    # After the commit: an aborted patch leaves the cache nothing to unlearn.
    invalidate_saison_cache()

    return patched


@router.post("/{saison_id}/activate", response_model=FLActivateSaisonResponse, summary="Make this the active Saison")
async def activate_saison(
    saison_id: str,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    db: DBClient,
) -> FLActivateSaisonResponse:
    """
    Make this the active season, moving whichever holds `active` to `past`.

    The only path to `status: "active"`. One transaction judges and writes, so the league never
    briefly holds no active season, nor two, and neither season can be drawn or undrawn under the
    judgement. The outgoing must be finished, and a `past` target refused.
    """

    async def judge_and_roll_the_league_over(session: AsyncIOMotorClientSession) -> FLActivateSaisonResponse:
        """Judge, then demote every incumbent and promote the target. Everything judged is read in-session."""

        async def the_targets_status(status_session: AsyncIOMotorClientSession | None) -> str:
            """`REQ-ACTIVATE-002`'s input, read either through the transaction or outside it.

            A season id naming nothing raises the 404 here, before any demotion.
            """

            target = await pull_one_from_db(
                collection=saisons_collection, db_filter={"_id": saison_id}, projection={"status": 1}, session=status_session
            )

            return str(target["status"])

        # THROUGH the session, as the draw's reads are: a retry after a write conflict judges the
        # league as it stands then.
        target_status = await the_targets_status(session)

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

        refuse(
            find_activation_refusal(
                target_status=target_status,
                target_fixtures=target_fixtures,
                outgoing_unplayed=unplayed,
            )
        )

        # `update_many`: a database holding two active seasons is repaired, not half-preserved.
        demoted = await patch_many_in_db(
            collection=saisons_collection,
            db_filter={"status": "active", "_id": {"$ne": saison_id}},
            update={"$set": {"status": "past"}},
            session=session,
        )

        activated_raw = await patch_one_in_db(
            collection=saisons_collection,
            db_filter={"_id": saison_id},
            update={"$set": {"status": "active"}},
            session=session,
            return_document=ReturnDocument.AFTER,
        )

        # A target already `active` is `$set` to that same status, so the promotion rewrites nothing
        # and joins no write set: a rival demoting it raises no conflict to retry on. Re-judged
        # OUTSIDE the session (I53); the window to the commit is the residue.

        # The STATUS alone, because it is the only input a rival can move here: an undraw and a
        # replace each need a `future` season, a draw only adds fixtures, and a new incumbent arrives
        # only from a rollover that demotes this target.
        if target_status == "active":
            refuse(
                find_activation_refusal(
                    target_status=await the_targets_status(None),
                    target_fixtures=target_fixtures,
                    outgoing_unplayed=unplayed,
                )
            )

        activated = FLSaison.model_validate(with_schedule(activated_raw))

        return FLActivateSaisonResponse(updated_document=activated, deactivated=demoted.modified_count)

    # `with_transaction`, not a bare `start_transaction`: a draw filling the outgoing season or an
    # undraw emptying the target writes a season this one writes too, so it conflicts and the
    # retry judges the league again rather than closing it blind.
    async with await db.start_session() as session:
        rolled_over = await session.with_transaction(judge_and_roll_the_league_over)

    # After the commit: an aborted rollover leaves the cache nothing to unlearn.
    invalidate_saison_cache()

    return rolled_over


@router.post("/{saison_id}/gruppen/swap", response_model=FLSwapGruppenResponse, summary="Exchange two teams' groups")
async def swap_gruppen(
    saison_id: str,
    swap_data: Annotated[FLSwapGruppenPayload, Body()],
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spiele_collection: SpieleCollection,
    teams_collection: TeamsCollection,
    db: DBClient,
) -> FLSwapGruppenResponse:
    """
    Exchange the groups of two clubs entered in this season, as one write.

    Every Gruppenphase fixture fielding either club has that side rewritten in the same transaction,
    so each group stays a round robin. Neither `tore` nor `austritt` moves.
    """

    # A read first, so an unknown season is a 404 rather than a 409 about clubs holding no row in it.
    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])

    async def exchange_the_two_gruppen(session: AsyncIOMotorClientSession) -> FLSwapGruppenResponse:
        """The whole swap: judge, then write both rows. Everything it decides on is read in-session."""

        both_ids = [swap_data.team1_id, swap_data.team2_id]

        # THROUGH the session: a retry after a write conflict has to judge these rows as they are
        # then, not as this request first saw them.
        rows = await pull_many_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "team_id": {"$in": both_ids}},
            projection=["team_id", "gruppe", "austritt"],
            session=session,
        )
        gruppe_of = {row["team_id"]: row["gruppe"] for row in rows}

        # The same rows as the groups, so `REQ-SWAP-006` cannot judge against a stale record.
        departed_since = {row["team_id"]: (row.get("austritt") or {}).get("datum") for row in rows}

        # Again in-session, because `activate_saison` moves `status` in a transaction of its own.
        saison_raw = await pull_one_from_db(
            collection=saisons_collection, db_filter={"_id": saison_id}, projection={"status": 1}, session=session
        )

        # LISTED rather than counted: one read answers `REQ-SWAP-004` and supplies what the rewrite
        # moves, so the two cannot disagree.
        gruppenphase_spiele = await pull_many_from_db(
            collection=spiele_collection,
            db_filter={
                "saison_id": saison_id,
                "saison_phase": "gruppenphase",
                "$or": [{"team1.team_id": {"$in": both_ids}}, {"team2.team_id": {"$in": both_ids}}],
            },
            projection=["spieltag_id", "datum", "team1.team_id", "team1.tore", "team2.team_id", "team2.tore", "ergebnis", "sonderereignis"],
            session=session,
        )

        # Listed too, so both windows are decided by `has_taken_place` rather than by one predicate
        # here and a `$or` filter there.
        knockout_spiele = await pull_many_from_db(
            collection=spiele_collection,
            db_filter={"saison_id": saison_id, "saison_phase": {"$in": list(KNOCKOUT_PHASES)}},
            projection=["spieltag_id", "team1.team_id", "team1.tore", "team2.team_id", "team2.tore", "ergebnis", "sonderereignis"],
            session=session,
        )

        refuse(
            find_gruppe_swap_refusal(
                is_same_team=swap_data.team1_id == swap_data.team2_id,
                team1_gruppe=gruppe_of.get(swap_data.team1_id),
                team2_gruppe=gruppe_of.get(swap_data.team2_id),
                saison_status=str(saison_raw["status"]),
                played_knockout_fixtures=sum(1 for spiel in knockout_spiele if has_taken_place(spiel)),
                played_gruppenphase_fixtures=sum(1 for spiel in gruppenphase_spiele if has_taken_place(spiel)),
                clashing_spieltage=_spieltag_clashes(
                    team_ids=both_ids,
                    gruppenphase_spiele=gruppenphase_spiele,
                    knockout_spiele=knockout_spiele,
                ),
                departed_fixtures=fixtures_newly_fielding_a_departed_club(
                    team1_id=swap_data.team1_id,
                    team2_id=swap_data.team2_id,
                    departed_since=departed_since,
                    gruppenphase_spiele=gruppenphase_spiele,
                ),
            )
        )

        rewritten = await _rewrite_gruppenphase_sides(
            spiele=gruppenphase_spiele,
            team_ids=both_ids,
            spiele_collection=spiele_collection,
            teams_collection=teams_collection,
            session=session,
        )

        # Built BEFORE the junction writes and then written FROM: the model refuses a stored group
        # outside A-D before anything lands, and the echo cannot disagree with what did.
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
            )

        return swapped

    # `with_transaction`, not a bare `start_transaction`: two admins on one season can write-conflict,
    # and the callback re-reads everything it judges on, so a retry is safe.
    async with await db.start_session() as session:
        return await session.with_transaction(exchange_the_two_gruppen)


@router.post("/{saison_id}/spielplan", response_model=FLGenerateSpielplanResponse, status_code=201, summary="Draw this Saison's Spielplan")
async def generate_spielplan(
    saison_id: str,
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spiele_collection: SpieleCollection,
    spieltage_collection: SpieltageCollection,
    db: DBClient,
    # An absent body is `replace: false`, so a first draw needs no confirmation and nothing replaces
    # a season by leaving the flag out.
    spielplan_data: Annotated[FLGenerateSpielplanPayload, Body(default_factory=FLGenerateSpielplanPayload)],
    today: str = Depends(get_german_date_str),
) -> FLGenerateSpielplanResponse:
    """
    Draw the whole season at once: every matchday and every fixture, undated, in one transaction.

    `shape` states the three rules the fixtures come out of, and is stored with them. `replace`
    deletes both lists first, inside `REQ-SPIELPLAN-005`'s window.
    """

    # A read first, so an unknown season is a 404 rather than a refusal about what it does not hold.
    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])

    async def draw_the_whole_season(session: AsyncIOMotorClientSession) -> FLGenerateSpielplanResponse:
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
            # and `teams` may since have been renamed (`docs/backend/spec.md :: I19`).
            projection=["team_id", "gruppe", "name", "shorthand"],
            session=session,
        )

        occupancy: dict[FLGruppenNames, int] = {}
        for row in entered_rows:
            gruppe = row["gruppe"]
            occupancy[gruppe] = occupancy.get(gruppe, 0) + 1

        # LISTED rather than counted, as the group swap's callback lists its own: one read answers
        # `REQ-SPIELPLAN-001` and supplies what `REQ-SPIELPLAN-005` weighs, so the two cannot
        # disagree about what a replace would destroy.
        stored_spiele = await pull_many_from_db(
            collection=spiele_collection,
            db_filter={"saison_id": saison_id},
            # The predicate's own fields, so the projection cannot fall behind what it reads: a
            # venue, a referee or an admin's note is work a replace would destroy, and
            # `REQ-SPIELPLAN-005`'s window closes on one exactly as on a result.
            projection=list(RECORDED_FACT_FIELDS),
            session=session,
        )

        refuse(
            find_spielplan_refusal(
                saison_status=str(saison_raw["status"]),
                fixtures_drawn=len(stored_spiele),
                spieltage_held=await spieltage_collection.count_documents({"saison_id": saison_id}, session=session),
                watermark=saison_raw.get("spielplan"),
                rules=rules,
                occupancy_by_gruppe=occupancy,
                replace=spielplan_data.replace,
                recorded_fixtures=sum(1 for spiel in stored_spiele if holds_a_recorded_fact(spiel)),
            )
        )

        # `stored=None` is the create's reading, and the one this wants: every rule judging the
        # numbers alone fires on the payload's own, and every rule judging a standing fixture is
        # skipped, each of those weighing a draw about to cease to exist.
        refuse(
            find_rules_refusal(
                saison_status=str(saison_raw["status"]),
                stored=None,
                proposed=rules,
                occupancy_by_gruppe=occupancy,
                highest_wired_platz=0,
            )
        )

        # After the rules, as `post_saison` is: a bracket with no shape implies no matchday count
        # worth measuring. Empty spans -- the draw dates nothing, and a replace has every stored
        # matchday still to delete below.
        refuse(
            find_saison_span_refusal(
                start_date=str(saison_raw["start_date"]),
                end_date=str(saison_raw["end_date"]),
                rules=rules,
                spieltag_spans=[],
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

        # Both collections together (`docs/backend/spec.md :: I46`), fixtures first: the reverse of
        # the write order below, so neither the log's rows nor a restore replaying them holds a
        # fixture whose matchday is gone.
        if spielplan_data.replace:
            await delete_many_from_db(collection=spiele_collection, db_filter={"saison_id": saison_id}, session=session)
            await delete_many_from_db(collection=spieltage_collection, db_filter={"saison_id": saison_id}, session=session)

        # Matchdays first: every fixture already carries the `spieltag_id` of a row in this list, the
        # draw having generated both ids together rather than reading one back.
        await post_many_to_db(collection=spieltage_collection, documents=drawn.spieltage, session=session)
        await post_many_to_db(collection=spiele_collection, documents=drawn.spiele, session=session)

        # Dotted keys, and only where the payload states a shape: a whole `rules` object would write
        # the six rules the draw is no function of, and drop any sub-key `FLSaisonRules` ignores --
        # the merged copy lost it at validation.
        shape = spielplan_data.shape
        shape_written = {} if shape is None else {f"rules.{rule}": value for rule, value in shape.model_dump().items()}

        watermark = FLSaisonSpielplan(generiert_am=today, spieltage=len(drawn.spieltage), spiele=len(drawn.spiele))
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
            # way (`docs/backend/spec.md :: I39`).
            return_document=ReturnDocument.BEFORE,
        )

        return FLGenerateSpielplanResponse(
            saison_id=saison_id,
            spieltage=watermark.spieltage,
            spiele=watermark.spiele,
            generiert_am=watermark.generiert_am,
        )

    # `with_transaction`, not a bare `start_transaction`: the callback re-reads everything it judges
    # on, and a retry is safe because it generates its own ids and wires by `spiel_nr`, never by one.
    async with await db.start_session() as session:
        drawn_response = await session.with_transaction(draw_the_whole_season)

    # After the commit: an aborted draw leaves the cache nothing to unlearn.
    invalidate_saison_cache()

    return drawn_response


@router.delete("/{saison_id}/spielplan", response_model=FLUndrawSpielplanResponse, summary="Undraw this Saison's Spielplan")
async def undraw_spielplan(
    saison_id: str,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    spieltage_collection: SpieltageCollection,
    db: DBClient,
) -> FLUndrawSpielplanResponse:
    """
    Return the season to undrawn: matchdays, fixtures and watermark, in one transaction.

    The replace's window bounds it (`REQ-SPIELPLAN-006`). Undoing the draw is what reopens the shape
    rules to `PATCH` and the groups to an entry.
    """

    async def undraw_the_whole_season(session: AsyncIOMotorClientSession) -> FLUndrawSpielplanResponse:
        """Judge, then remove both collections and the watermark. Everything judged is read in-session."""

        # THROUGH the session, as the draw's reads are: a retry after a write conflict judges the
        # season as it stands then. A season id naming nothing raises the 404 here.
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"], session=session)

        # The stored rows, never the watermark: a season drawn outside this API carries none, and its
        # fixtures are as much a record as one this endpoint wrote.
        stored_spiele = await pull_many_from_db(
            collection=spiele_collection,
            db_filter={"saison_id": saison_id},
            projection=list(RECORDED_FACT_FIELDS),
            session=session,
        )

        refuse(
            find_undraw_refusal(
                saison_status=str(saison_raw["status"]),
                recorded_fixtures=sum(1 for spiel in stored_spiele if holds_a_recorded_fact(spiel)),
            )
        )

        # Fixtures first, the reverse of the draw's write order: neither the log's rows nor a restore
        # replaying them then holds a fixture whose matchday is already gone.
        removed_spiele = await delete_many_from_db(collection=spiele_collection, db_filter={"saison_id": saison_id}, session=session)
        removed_spieltage = await delete_many_from_db(collection=spieltage_collection, db_filter={"saison_id": saison_id}, session=session)

        # INSIDE the transaction holding both removals (`docs/backend/spec.md :: I46`): a season
        # keeping its watermark while its fixtures are gone reads as drawn, and `$unset` is the shape
        # a season nobody has drawn carries.
        before = await patch_one_in_db(
            collection=saisons_collection,
            db_filter={"_id": saison_id},
            update={"$unset": {"spielplan": ""}},
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

        return FLUndrawSpielplanResponse(
            saison_id=saison_id,
            spieltage=removed_spieltage.deleted_count,
            spiele=removed_spiele.deleted_count,
            # The update's OWN pre-image, so nothing lands between reading the watermark and clearing
            # it. A season holding one with no fixtures behind it reports the only thing removed.
            watermark_cleared=before.get("spielplan") is not None,
        )

    # `with_transaction`, not a bare `start_transaction`: the callback re-reads everything it judges
    # on, and a retry is safe because it removes a set by filter rather than by any id it read.
    async with await db.start_session() as session:
        undrawn = await session.with_transaction(undraw_the_whole_season)

    # After the commit: an aborted undraw leaves the cache nothing to unlearn.
    invalidate_saison_cache()

    return undrawn
