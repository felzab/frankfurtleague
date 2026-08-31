from typing import Annotated, Any, Mapping, Sequence

from fastapi import APIRouter, Body, Depends
from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorCollection

from app.api.saisons.crud import pull_saison_id_and_rules
from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import FLSpielListAdapter
from app.api.teams.schemas import (
    FLPatchSaisonTeamKontaktePayload,
    FLPatchSaisonTeamKontakteResponse,
    FLPatchSaisonTeamPayload,
    FLPatchTeamPayload,
    FLPatchTeamResponse,
    FLPostSaisonTeamPayload,
    FLPostTeamPayload,
    FLPostTeamResponse,
    FLReplaceSaisonTeamPayload,
    FLReplaceSaisonTeamResponse,
    FLSaisonTeamResponse,
    FLTeamListAdapter,
    FLTeamRecord,
    FLTeamsFilterParams,
    FLTeamsGroupedResponse,
    FLTeamsListResponse,
    FLTeamsMembershipsResponse,
    FLTeamsResponse,
    FLTeamWithMembershipsListAdapter,
    FLTeamWriteResponse,
)
from app.api.teams.services import (
    build_gruppen,
    build_team_memberships_pipeline,
    build_team_pipeline,
    find_club_entry_refusal,
    find_entry_refusal,
    find_gruppe_move_refusal,
    find_replacement_refusal,
    find_retire_refusal,
    has_taken_place,
)
from app.core.config import API_VERSION
from app.core.crud import (
    aggregate_many_from_db,
    insert_live,
    patch_many_in_db,
    patch_one_in_db,
    post_one_to_db,
    pull_many_from_db,
    pull_one_from_db,
    refuse,
    set_inactive_since,
)
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonTeamsCollection,
    SpieleCollection,
    TeamsCollection,
    get_german_date_str,
)
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/teams",
    dependencies=[Depends(verify_access_admin), Depends(bind_actor)],
)


async def _rewrite_the_outgoing_clubs_sides(
    *,
    spiele: Sequence[Mapping[str, Any]],
    outgoing_team_id: Any,
    incoming_side: Mapping[str, Any],
    spiele_collection: AsyncIOMotorCollection,
    session: AsyncIOMotorClientSession,
) -> int:
    """Hand this club's sides to the incoming one; returns how many FIXTURES moved.

    `incoming_side`'s keys ARE the paths written under each slot. Named by `_id` off a snapshot
    taken BEFORE any write, as `_rewrite_gruppenphase_sides` is.
    """

    # One `update_many` writes one path with one value, so the passes split by slot.
    by_slot: dict[str, list[Any]] = {}
    for spiel in spiele:
        for slot in ("team1", "team2"):
            if (spiel.get(slot) or {}).get("team_id") == outgoing_team_id:
                by_slot.setdefault(slot, []).append(spiel["_id"])

    for slot, spiel_ids in by_slot.items():
        await patch_many_in_db(
            collection=spiele_collection,
            db_filter={"_id": {"$in": spiel_ids}},
            update={"$set": {f"{slot}.{key}": value for key, value in incoming_side.items()}},
            session=session,
        )

    # The fixtures, not the sides: `modified_count` reports 0 where a value already matched, and
    # double-counts a fixture holding the club on both.
    return len({spiel_id for spiel_ids in by_slot.values() for spiel_id in spiel_ids})


# A static path beside `by_id` routes: the id convertor takes 24 hex characters, so no id route can
# capture this one whatever the declaration order.
@router.get("/memberships", response_model=FLTeamsMembershipsResponse, summary="Every team with its season memberships")
async def get_team_memberships(teams_collection: TeamsCollection) -> FLTeamsMembershipsResponse:
    """
    Every team, retired ones included, each with every season membership it holds. Sorted by name.

    `GET /teams` cannot answer it: that read is season-scoped with a strict junction join.
    """

    teams_raw = await aggregate_many_from_db(collection=teams_collection, pipeline=build_team_memberships_pipeline())

    return FLTeamsMembershipsResponse(teams=FLTeamWithMembershipsListAdapter.validate_python(teams_raw))


# Two static segments, as `GET /saisons/list/admin` has, so the admin tier lists every season-scoped
# resource under one shape. No id route at this prefix ends in `/admin`, so none can shadow this one.
@router.get("/list/admin", response_model=FLTeamsResponse, summary="Teams for a Saison, for the admin surfaces")
async def get_teams_for_admin(
    teams_collection: TeamsCollection,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    filters: FLTeamsFilterParams = Depends(),
) -> FLTeamsResponse:
    """
    List a season's teams for the admin surfaces, a `future` season's included.

    Same filters and shapes as `GET /teams`, without its season gate: a club is entered while its
    season is still planned, so an admin who cannot see one cannot enter it.
    """

    # The whole body below mirrors `app/api/teams/router.py :: get_teams`, which cannot be called
    # here: the gate is inside it, and refusing the planned season is the one thing this must not do.
    filters.saison_id, saison_rules = await pull_saison_id_and_rules(saisons_collection=saisons_collection, saison_id=filters.saison_id)

    teams = FLTeamListAdapter.validate_python(
        await aggregate_many_from_db(
            collection=teams_collection,
            pipeline=build_team_pipeline(filters=filters, rules=saison_rules),
        )
    )
    if not filters.in_gruppen:
        return FLTeamsListResponse(teams=teams)

    # Narrowed to the set the statistics counted, so a head-to-head tiebreak weighs the same matches.
    spiele_filter: dict[str, Any] = {"saison_id": filters.saison_id}
    if filters.statistik_scope == "gruppenphase":
        spiele_filter["saison_phase"] = "gruppenphase"

    spiele = FLSpielListAdapter.validate_python(await pull_many_from_db(collection=spiele_collection, db_filter=spiele_filter))

    return FLTeamsGroupedResponse(
        gruppen=build_gruppen(teams=teams, spiele=spiele, rules=saison_rules),
        qualifiers_per_group=saison_rules.qualifiers_per_group,
    )


@router.post("", response_model=FLPostTeamResponse, status_code=201, summary="Create a team")
async def post_team(
    team_data: Annotated[FLPostTeamPayload, Body()],
    teams_collection: TeamsCollection,
) -> FLPostTeamResponse:
    """Create a club. `shorthand` is unique across every club, retired ones included, so a duplicate is a 409."""

    post_operation = await insert_live(collection=teams_collection, document=team_data.model_dump(mode="json"))

    return FLPostTeamResponse(
        acknowledged=1 if post_operation.acknowledged else 0,
        created_id=post_operation.inserted_id,
    )


@router.patch(by_id("team_id"), response_model=FLPatchTeamResponse, summary="Update a team and fan the rename out")
async def patch_team(
    team_id: CustomRouteObjectId,
    team_data: Annotated[FLPatchTeamPayload, Body()],
    teams_collection: TeamsCollection,
    spiele_collection: SpieleCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
) -> FLPatchTeamResponse:
    """
    Update a club, then rewrite the name and shorthand its unfinished seasons carry.

    The junction and every match hold a copy of both (`docs/backend/spec.md :: I13`); a `past`
    season keeps the name it was played under.
    """

    async def rename_and_fan_out(session: AsyncIOMotorClientSession) -> FLPatchTeamResponse:
        updated_raw = await patch_one_in_db(
            collection=teams_collection,
            db_filter={"_id": team_id},
            update={"$set": team_data.model_dump(mode="json")},
            session=session,
        )

        # Read through the session, so a season closed by a concurrent write cannot leave the
        # junction rewritten and its fixtures not, or the reverse.
        open_saisons = await pull_many_from_db(
            collection=saisons_collection,
            db_filter={"status": {"$ne": "past"}},
            projection=["_id"],
            session=session,
        )
        # One season per year against a 1024-row read: the list cannot truncate this century.
        open_saison_ids = [row["_id"] for row in open_saisons]

        junction = await patch_many_in_db(
            collection=saison_teams_collection,
            db_filter={"team_id": team_id, "saison_id": {"$in": open_saison_ids}},
            update={"$set": {"name": team_data.name, "shorthand": team_data.shorthand}},
            session=session,
        )

        # Two passes: one `update_many` cannot write a different path per document.
        fanned_out = 0
        for slot in ("team1", "team2"):
            result = await patch_many_in_db(
                collection=spiele_collection,
                db_filter={f"{slot}.team_id": team_id, "saison_id": {"$in": open_saison_ids}},
                update={"$set": {f"{slot}.name": team_data.name, f"{slot}.shorthand": team_data.shorthand}},
                session=session,
            )
            fanned_out += result.modified_count

        return FLPatchTeamResponse(
            updated_document=FLTeamRecord.model_validate(updated_raw),
            fanned_out_to_spiele=fanned_out,
            fanned_out_to_saison_teams=junction.modified_count,
        )

    # One transaction over every write here: a rename reaching some and not the rest leaves a season
    # disagreeing with itself. `with_transaction` is safe to retry, every write deriving from the payload.
    async with await db.start_session() as session:
        return await session.with_transaction(rename_and_fan_out)


@router.delete(by_id("team_id"), response_model=FLTeamWriteResponse, summary="Retire a team (soft delete)")
async def delete_team(
    team_id: CustomRouteObjectId,
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    today: str = Depends(get_german_date_str),
) -> FLTeamWriteResponse:
    """
    Retire a club from the league. SOFT: `inactive_since` is stamped and the document stays.

    Refused while the club is entered in an `active` or `future` season. Its junction rows are left
    alone: the seasons it played still happened.
    """

    # Two small reads rather than a lookup: a club holds a handful of rows, the league a few seasons.
    junction_rows = await pull_many_from_db(
        collection=saison_teams_collection,
        db_filter={"team_id": team_id},
        projection=["saison_id"],
    )
    saison_ids = [row["saison_id"] for row in junction_rows]
    saison_rows = await pull_many_from_db(
        collection=saisons_collection,
        db_filter={"_id": {"$in": saison_ids}},
        projection=["status"],
    )

    refuse(find_retire_refusal(str(row["status"]) for row in saison_rows))

    updated_raw = await set_inactive_since(collection=teams_collection, db_filter={"_id": team_id}, when=today)

    return FLTeamWriteResponse(updated_document=FLTeamRecord.model_validate(updated_raw))


@router.post(f"{by_id('team_id')}/reactivate", response_model=FLTeamWriteResponse, summary="Bring a retired team back")
async def reactivate_team(
    team_id: CustomRouteObjectId,
    teams_collection: TeamsCollection,
) -> FLTeamWriteResponse:
    """Clear `inactive_since`, restoring a retired club to reads that hide retired ones."""

    updated_raw = await set_inactive_since(collection=teams_collection, db_filter={"_id": team_id}, when=None)

    return FLTeamWriteResponse(updated_document=FLTeamRecord.model_validate(updated_raw))


@router.post(f"{by_id('team_id')}/saisons", response_model=FLSaisonTeamResponse, status_code=201, summary="Enter a team into a season")
async def post_saison_team(
    team_id: CustomRouteObjectId,
    saison_team_data: Annotated[FLPostSaisonTeamPayload, Body()],
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
) -> FLSaisonTeamResponse:
    """
    Enter a team into a season, in a group, under the name the club carries today.

    A club with no row here is ABSENT from that season rather than merely unlisted
    (`docs/backend/spec.md :: I11`).
    """

    # The one read of the club, and it earns its place twice over: an id naming nothing 404s here
    # rather than inserting a row pointing at no club, and the season's own copy of the name and
    # shorthand is seeded from it.
    team_raw = await pull_one_from_db(
        collection=teams_collection,
        db_filter={"_id": team_id},
        projection=["name", "shorthand", "inactive_since"],
    )
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_team_data.saison_id})

    # Before the count: the club's standing in the LEAGUE cannot be repaired by picking another
    # group, so nobody should be handed a capacity figure to act on first.
    refuse(find_club_entry_refusal(inactive_since=team_raw.get("inactive_since")))

    # Count-then-insert, not transactional: losing the race costs one team over a planning bound
    # rather than corrupt data, on a single-admin surface.
    occupied_rows = await pull_many_from_db(
        collection=saison_teams_collection,
        db_filter={"saison_id": saison_team_data.saison_id, "gruppe": saison_team_data.gruppe},
        projection=["_id"],
    )

    refuse(
        find_entry_refusal(
            saison_status=str(saison_raw["status"]),
            gruppe=saison_team_data.gruppe,
            # Validated, not read raw: a season missing the capacity keys fails here rather than
            # admitting a team against a bound nobody chose.
            rules=FLSaisonRules.model_validate(saison_raw["rules"]),
            occupied=len(occupied_rows),
        )
    )

    await post_one_to_db(
        collection=saison_teams_collection,
        document={
            "saison_id": saison_team_data.saison_id,
            "team_id": team_id,
            "gruppe": saison_team_data.gruppe,
            # Required by the validator and by `FLTeam`, so a row without it is unreadable.
            "austritt": None,
            # Written as nulls although the validator does not require the keys: entry carries
            # neither, and a row that states so is easier to read back than one that omits them.
            "trikot_farbe": None,
            "kontakte": None,
            # Copied rather than joined on read (`docs/backend/spec.md :: I11`): once the season is
            # `past` this is the name it was played under, which makes the copy in its fixtures true
            # rather than merely old.
            "name": team_raw["name"],
            "shorthand": team_raw["shorthand"],
        },
    )

    return FLSaisonTeamResponse(
        saison_id=saison_team_data.saison_id,
        team_id=team_id,
        gruppe=saison_team_data.gruppe,
        austritt=None,
        trikot_farbe=None,
        kontakte=None,
        name=team_raw["name"],
        shorthand=team_raw["shorthand"],
    )


@router.patch(
    f"{by_id('team_id')}/saisons/{{saison_id}}",
    response_model=FLSaisonTeamResponse,
    summary="Rewrite a team's season row: group, exit record and kit colour",
)
async def patch_saison_team(
    team_id: CustomRouteObjectId,
    saison_id: str,
    saison_team_data: Annotated[FLPatchSaisonTeamPayload, Body()],
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
) -> FLSaisonTeamResponse:
    """
    Rewrite a team's row for one season: group, exit record and kit colour.

    All three are required and replaced WHOLESALE: an omitted key is a 422, never a team reinstated
    (`docs/backend/spec.md :: I31`). The contact block is `PATCH .../kontakte`'s.
    """

    # The identity comes back with the group because this endpoint echoes the whole row and writes
    # neither field: a group change and an austritt both leave the season's name where it was.
    existing_raw = await pull_one_from_db(
        collection=saison_teams_collection,
        db_filter={"team_id": team_id, "saison_id": saison_id},
        projection=["gruppe", "name", "shorthand"],
    )
    # Only a CHANGE is judged: recording an austritt writes the same row without moving anyone.
    if saison_team_data.gruppe != existing_raw["gruppe"]:
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id})

        # Both sides, because a fixture fields a team on either.
        fixtures_drawn = await spiele_collection.count_documents(
            {"saison_id": saison_id, "$or": [{"team1.team_id": team_id}, {"team2.team_id": team_id}]}
        )
        refuse(find_gruppe_move_refusal(fixtures_drawn=fixtures_drawn))

        occupied_rows = await pull_many_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "gruppe": saison_team_data.gruppe},
            projection=["_id"],
        )
        refuse(
            find_entry_refusal(
                # A MOVE is not an entry -- the club already holds a row -- so the status gate on
                # entering does not judge it, and only its two group gates below apply.
                saison_status="future",
                gruppe=saison_team_data.gruppe,
                rules=FLSaisonRules.model_validate(saison_raw["rules"]),
                occupied=len(occupied_rows),
            )
        )

    updated_raw = await patch_one_in_db(
        collection=saison_teams_collection,
        db_filter={"team_id": team_id, "saison_id": saison_id},
        update={"$set": saison_team_data.model_dump(mode="json")},
    )

    # `kontakte` below is the one field read off the AFTER image, no payload carrying the block.
    # `.get` covers a row whose key is ABSENT; a block PRESENT in a shape this model cannot describe
    # still refuses, a keyword being validated like any other value.

    # That write took no session and has committed by here, so such a block answers 500 after it
    # landed. Accepted: the write is the one asked for, the retry is idempotent, and a session would
    # abort a correct write over a field this endpoint never touches.
    return FLSaisonTeamResponse(
        saison_id=saison_id,
        team_id=team_id,
        gruppe=saison_team_data.gruppe,
        austritt=saison_team_data.austritt,
        # From the PAYLOAD, not the pre-read above: the `$set` writes these wholesale, so the values
        # sent are the values now stored and the projection has nothing to widen for.
        trikot_farbe=saison_team_data.trikot_farbe,
        kontakte=updated_raw.get("kontakte"),
        name=existing_raw["name"],
        shorthand=existing_raw["shorthand"],
    )


@router.patch(
    f"{by_id('team_id')}/saisons/{{saison_id}}/kontakte",
    response_model=FLPatchSaisonTeamKontakteResponse,
    summary="Rewrite a team's season contacts, and nothing else on the row",
)
async def patch_saison_team_kontakte(
    team_id: CustomRouteObjectId,
    saison_id: str,
    kontakte_data: Annotated[FLPatchSaisonTeamKontaktePayload, Body()],
    saison_teams_collection: SaisonTeamsCollection,
) -> FLPatchSaisonTeamKontakteResponse:
    """
    Rewrite the three people this team is reached through for one season. Null clears the block.

    Its own endpoint so the contacts editor and the club editor cannot clobber one row. It refuses
    nothing: a `past` season's contacts stay correctable.
    """

    updated_raw = await patch_one_in_db(
        collection=saison_teams_collection,
        db_filter={"team_id": team_id, "saison_id": saison_id},
        # The one path, spelled out rather than dumped wholesale: `gruppe`, `austritt` and
        # `trikot_farbe` belong to the junction PATCH, and a `$set` carrying them would reinstate
        # whatever this caller last read.
        update={"$set": {"kontakte": kontakte_data.model_dump(mode="json")["kontakte"]}},
    )

    return FLPatchSaisonTeamKontakteResponse(
        saison_id=saison_id,
        team_id=team_id,
        # The AFTER image, not the payload: what the row holds is the claim this echo makes.
        kontakte=updated_raw["kontakte"],
    )


@router.post(
    f"{by_id('team_id')}/saisons/{{saison_id}}/replace",
    response_model=FLReplaceSaisonTeamResponse,
    summary="Replace a club in a season, keeping its schedule",
)
async def replace_saison_team(
    team_id: CustomRouteObjectId,
    saison_id: str,
    replacement_data: Annotated[FLReplaceSaisonTeamPayload, Body()],
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLReplaceSaisonTeamResponse:
    """
    Hand this season's junction row, and every fixture on it, to another club.

    Its `team_id`, identity copy, `austritt` and every fixture side move, and the outgoing club's
    live squad rows are retired, in ONE transaction: the schedule survives.
    """

    # Outside the transaction, as the group swap reads it: an unknown season is a 404 about the
    # season rather than about a junction row nobody expected to find in it.
    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])

    async def hand_the_row_over(session: AsyncIOMotorClientSession) -> FLReplaceSaisonTeamResponse:
        """The whole replacement: judge, rewrite the fixtures, then the row. Everything it decides on is read in-session."""

        # For the 404 alone, and deliberately NOT a read of the club it names: D43 repairs a row
        # whose `team_id` resolves to no `teams` document, so nothing here may require one.
        await pull_one_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "team_id": team_id},
            projection=["_id"],
            session=session,
        )

        # In-session, because `activate_saison` moves `status` in a transaction of its own.
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"], session=session)

        # The ONE read of the incoming club, and it earns its place three times over: an id naming
        # nothing 404s here, the row's name is reseeded from it as `post_saison_team` seeds one at
        # entry, and every rewritten fixture side takes the same two values.
        incoming_raw = await pull_one_from_db(
            collection=teams_collection,
            db_filter={"_id": replacement_data.incoming_team_id},
            projection=["name", "shorthand", "inactive_since"],
            session=session,
        )

        incoming_rows = await pull_many_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "team_id": replacement_data.incoming_team_id},
            projection=["_id"],
            session=session,
        )

        # LISTED rather than counted: one read judges `REQ-REPLACE-002` and supplies what the
        # rewrite moves, so the two cannot disagree. Every phase, because the incoming club inherits
        # the whole schedule, a bracket slot included.
        spiele = await pull_many_from_db(
            collection=spiele_collection,
            db_filter={"saison_id": saison_id, "$or": [{"team1.team_id": team_id}, {"team2.team_id": team_id}]},
            projection=["team1.team_id", "team1.tore", "team2.team_id", "team2.tore", "ergebnis", "sonderereignis"],
            session=session,
        )

        refuse(
            find_replacement_refusal(
                saison_status=str(saison_raw["status"]),
                fixtures_with_a_record=sum(1 for spiel in spiele if has_taken_place(spiel)),
                incoming_inactive_since=incoming_raw.get("inactive_since"),
                incoming_already_entered=bool(incoming_rows),
            )
        )

        # One dict for both layers, so the season's row and its fixtures cannot come to disagree
        # about what this club is called (`docs/backend/spec.md :: I11`). No `tore`: a fixture
        # holding one has taken place, which `REQ-REPLACE-002` has already refused.
        incoming_side = {
            "team_id": replacement_data.incoming_team_id,
            "name": incoming_raw["name"],
            "shorthand": incoming_raw["shorthand"],
        }

        fanned_out = await _rewrite_the_outgoing_clubs_sides(
            spiele=spiele,
            outgoing_team_id=team_id,
            incoming_side=incoming_side,
            spiele_collection=spiele_collection,
            session=session,
        )

        updated_raw = await patch_one_in_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "team_id": team_id},
            # `austritt` cleared: left standing it marks the INCOMING club withdrawn to
            # `REQ-SWAP-006` and `_may_hold_a_platz`; the exit survives in the logged pre-image. The
            # colour and the contacts describe the OUTGOING school (`docs/backend/spec.md :: I50`).
            update={"$set": {**incoming_side, "austritt": None, "trikot_farbe": None, "kontakte": None}},
            session=session,
        )

        # Ausgetragen, not moved: the players did not transfer, and a row left standing would name a
        # season its club now holds no junction row in -- what `REQ-SQUAD-001` refuses to create.
        # LIVE rows alone, so an earlier exit keeps its own date.
        ausgetragene_squad = await patch_many_in_db(
            collection=saison_spieler_collection,
            db_filter={"saison_id": saison_id, "team_id": team_id, "inactive_since": None},
            update={"$set": {"inactive_since": today}},
            session=session,
        )

        # Built from the AFTER image, so the echo cannot describe a row this write did not land; a
        # stored `gruppe` outside A-D raises here and aborts the transaction rather than answering.
        return FLReplaceSaisonTeamResponse(
            saison_id=saison_id,
            outgoing_team_id=team_id,
            incoming_team_id=replacement_data.incoming_team_id,
            gruppe=updated_raw["gruppe"],
            trikot_farbe=updated_raw["trikot_farbe"],
            kontakte=updated_raw["kontakte"],
            name=updated_raw["name"],
            shorthand=updated_raw["shorthand"],
            fanned_out_to_spiele=fanned_out,
            ausgetragene_squad_rows=ausgetragene_squad.modified_count,
        )

    # One transaction over every write: a row handed over while its fixtures are not leaves the
    # season fielding a club that holds no place in it. `with_transaction` is safe to retry, the
    # callback re-reading everything it judges on.
    async with await db.start_session() as session:
        return await session.with_transaction(hand_the_row_over)
