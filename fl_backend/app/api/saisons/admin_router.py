from typing import Annotated, Any, Mapping, Sequence

from fastapi import APIRouter, Body, Depends
from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorCollection
from pymongo import ReturnDocument

from app.api.saisons.cache import invalidate_saison_cache
from app.api.saisons.schemas import (
    FLActivateSaisonResponse,
    FLGenerateSpielplanResponse,
    FLPatchSaisonPayload,
    FLPatchSaisonResponse,
    FLPostSaisonPayload,
    FLPostSaisonResponse,
    FLSaison,
    FLSaisonRules,
    FLSaisonSpielplan,
    FLSwapGruppenPayload,
    FLSwapGruppenResponse,
)
from app.api.saisons.services import (
    find_activation_refusal,
    find_rules_refusal,
    find_saison_span_refusal,
    find_spielplan_refusal,
    unplayed_spiel_nrs,
    with_schedule,
)
from app.api.saisons.spielplan import EnteredTeam, draw_spielplan
from app.api.spiele.schemas import KNOCKOUT_PHASES, SONDEREREIGNIS_PRODUCING_A_RECORD, FLSpielListAdapter
from app.api.teams.schemas import FLGruppenNames
from app.api.teams.services import find_gruppe_swap_refusal, fixtures_newly_fielding_a_departed_club
from app.core.config import API_VERSION
from app.core.crud import patch_many_in_db, patch_one_in_db, post_many_to_db, post_one_to_db, pull_many_from_db, pull_one_from_db, refuse
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

# No `tore`: goals belong to whoever scored them, and `_has_taken_place` leaves none to move.
SWAPPED_SIDE_KEYS: tuple[str, ...] = ("team_id", "name", "shorthand")


def _has_taken_place(spiel: Mapping[str, Any]) -> bool:
    """Whether this fixture happened. NOT `unplayed_spiel_nrs` negated: a half-entered score reads unfinished there."""

    # An abandonment and a no-show each left a record the exchange would rewrite. A fixture called
    # off or struck out left none, so its sides are still free to move.
    if spiel.get("ergebnis") is not None or spiel.get("sonderereignis") in SONDEREREIGNIS_PRODUCING_A_RECORD:
        return True

    # A fixture can hold `team1.tore` with no `ergebnis` at all, and nothing refuses that shape.
    return any((spiel.get(slot) or {}).get("tore") is not None for slot in ("team1", "team2"))


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
) -> FLPatchSaisonResponse:
    """
    Update a season's dates and rules. `status` is on no payload.

    Editing the points moves every league table on the NEXT READ, standings being derived. What a
    finished or drawn season has fixed is refused, as is a rule narrowed below what it holds.
    """

    stored_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id})

    # Disqualified rows included: a team never leaves a season.
    occupancy: dict[Any, int] = {}
    async for row in saison_teams_collection.find({"saison_id": saison_id}, {"gruppe": 1}):
        gruppe = row.get("gruppe")
        if gruppe is not None:
            occupancy[gruppe] = occupancy.get(gruppe, 0) + 1

    # Both sides, because a `quelle` sits on either; 0 where no slot is group-seeded.
    highest_platz = 0
    async for spiel in spiele_collection.find(
        {"saison_id": saison_id, "$or": [{"team1_quelle.type": "gruppe"}, {"team2_quelle.type": "gruppe"}]},
        {"team1_quelle": 1, "team2_quelle": 1},
    ):
        for side in ("team1_quelle", "team2_quelle"):
            quelle = spiel.get(side)
            if isinstance(quelle, dict) and quelle.get("type") == "gruppe":
                highest_platz = max(highest_platz, int(quelle.get("platz", 0)))

    # The fullest matchday of a phase, not the total, and keyed on the MATCHDAY's phase, which the
    # fixture's can disagree with.
    attached_by_phase: dict[Any, int] = {}
    phase_of_spieltag: dict[Any, Any] = {}
    async for spieltag in spieltage_collection.find({"saison_id": saison_id}, {"saison_phase": 1}):
        phase_of_spieltag[spieltag["_id"]] = spieltag["saison_phase"]

    per_spieltag: dict[Any, int] = {}
    async for spiel in spiele_collection.find({"saison_id": saison_id}, {"spieltag_id": 1}):
        per_spieltag[spiel["spieltag_id"]] = per_spieltag.get(spiel["spieltag_id"], 0) + 1

    # Every fixture of the season, whichever matchday it hangs on: what `REQ-RULES-011` freezes is the
    # draw, and a fixture pointing at another season's matchday came out of this season's rules too.
    drawn_fixtures = sum(per_spieltag.values())

    for spieltag_id, attached in per_spieltag.items():
        phase = phase_of_spieltag.get(spieltag_id)
        # A fixture pointing at another season's matchday, or at none, exceeds no count here.
        if phase is not None:
            attached_by_phase[phase] = max(attached_by_phase.get(phase, 0), attached)

    largest_squad_rows = await saison_spieler_collection.aggregate(
        [
            {"$match": {"saison_id": saison_id, "inactive_since": None}},
            {"$group": {"_id": "$team_id", "held": {"$sum": 1}}},
            {"$sort": {"held": -1}},
            {"$limit": 1},
        ]
    ).to_list(length=1)
    largest_squad = int(largest_squad_rows[0]["held"]) if largest_squad_rows else 0

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
        )
    )

    # Dated rows only, filtered in the QUERY rather than after `str()`: a generated matchday carries
    # no span until somebody sets one, and a null stringified to "None" sorts above every date and
    # would be reported as falling outside the season.
    spieltag_spans = [
        (str(row["beginn"]), str(row["ende"]))
        async for row in spieltage_collection.find(
            {"saison_id": saison_id, "beginn": {"$ne": None}, "ende": {"$ne": None}}, {"beginn": 1, "ende": 1}
        )
    ]
    refuse(
        find_saison_span_refusal(
            start_date=saison_data.start_date,
            end_date=saison_data.end_date,
            rules=saison_data.rules,
            spieltag_spans=spieltag_spans,
        )
    )

    updated_document_raw = await patch_one_in_db(
        collection=saisons_collection,
        db_filter={"_id": saison_id},
        update={"$set": saison_data.model_dump(mode="json")},
        return_document=ReturnDocument.AFTER,
    )

    # After the write lands: the cached copy now describes rules or dates the database has not.
    invalidate_saison_cache()

    return FLPatchSaisonResponse(updated_document=FLSaison.model_validate(with_schedule(updated_document_raw)))


@router.post("/{saison_id}/activate", response_model=FLActivateSaisonResponse, summary="Make this the active Saison")
async def activate_saison(
    saison_id: str,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    db: DBClient,
) -> FLActivateSaisonResponse:
    """
    Make this the active season, moving whichever holds `active` to `past`.

    The only path to `status: "active"`. One transaction, so the league never briefly holds no
    active season, nor two. The outgoing must be finished, and a `past` target refused.
    """

    # A read first, so a bad id is a 404 rather than a rollover that promotes nothing. Its `status`
    # with it, that being what `REQ-ACTIVATE-002` judges the target on.
    target = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection={"status": 1})

    # `$ne` on the target, so re-activating the current season is not blocked by its own fixtures.
    outgoing = await pull_many_from_db(
        collection=saisons_collection,
        db_filter={"status": "active", "_id": {"$ne": saison_id}},
        projection={"_id": 1},
    )
    outgoing_ids = [row["_id"] for row in outgoing]

    # Empty where nothing BUT the target holds `active` -- a fresh league, or a re-activation.
    unplayed: list[int] = []
    if outgoing_ids:
        unplayed = unplayed_spiel_nrs(
            FLSpielListAdapter.validate_python(
                await pull_many_from_db(collection=spiele_collection, db_filter={"saison_id": {"$in": outgoing_ids}})
            )
        )

    # One call, so which of the two refusals an admin is shown stays the service's decision.
    refuse(find_activation_refusal(target_status=str(target["status"]), outgoing_unplayed=unplayed))

    async with await db.start_session() as session:
        async with session.start_transaction():
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

    # Outside the transaction: an aborted rollover leaves the cache nothing to unlearn.
    invalidate_saison_cache()

    activated = FLSaison.model_validate(with_schedule(activated_raw))

    return FLActivateSaisonResponse(updated_document=activated, deactivated=demoted.modified_count)


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

        # Listed too, so both windows are decided by `_has_taken_place` rather than by one predicate
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
                played_knockout_fixtures=sum(1 for spiel in knockout_spiele if _has_taken_place(spiel)),
                played_gruppenphase_fixtures=sum(1 for spiel in gruppenphase_spiele if _has_taken_place(spiel)),
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
    today: str = Depends(get_german_date_str),
) -> FLGenerateSpielplanResponse:
    """
    Draw the whole season at once: every matchday and every fixture, in one transaction.

    ONE-WAY, like activation, and nothing it writes carries a date. A half-written draw could not be
    repaired here, `/spiele` having neither a create nor a delete.
    """

    # A read first, so an unknown season is a 404 rather than a refusal about what it does not hold.
    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])

    async def draw_the_whole_season(session: AsyncIOMotorClientSession) -> FLGenerateSpielplanResponse:
        """Judge, then write both collections and the watermark. Everything judged is read in-session."""

        # THROUGH the session, as the group swap's callback is: a retry after a write conflict has to
        # judge the season as it stands then, not as this request first saw it.
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)
        rules = FLSaisonRules.model_validate(saison_raw["rules"])

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

        refuse(
            find_spielplan_refusal(
                saison_status=str(saison_raw["status"]),
                fixtures_drawn=await spiele_collection.count_documents({"saison_id": saison_id}, session=session),
                spieltage_held=await spieltage_collection.count_documents({"saison_id": saison_id}, session=session),
                watermark=saison_raw.get("spielplan"),
                rules=rules,
                occupancy_by_gruppe=occupancy,
            )
        )

        # Last, and reachable only on a season the API can no longer create: create and patch run
        # this same `stored=None` path. Asked anyway, because drawing one writes a group phase
        # whose bracket has no shape.
        refuse(
            find_rules_refusal(
                saison_status=str(saison_raw["status"]),
                stored=None,
                proposed=rules,
                occupancy_by_gruppe=occupancy,
                highest_wired_platz=0,
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

        # Matchdays first: every fixture already carries the `spieltag_id` of a row in this list, the
        # draw having generated both ids together rather than reading one back.
        await post_many_to_db(collection=spieltage_collection, documents=drawn.spieltage, session=session)
        await post_many_to_db(collection=spiele_collection, documents=drawn.spiele, session=session)

        watermark = FLSaisonSpielplan(generiert_am=today, spieltage=len(drawn.spieltage), spiele=len(drawn.spiele))
        # Inside the transaction, so the watermark can never disagree with what was written.
        await patch_one_in_db(
            collection=saisons_collection,
            db_filter={"_id": saison_id},
            update={"$set": {"spielplan": watermark.model_dump(mode="json")}},
            session=session,
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
