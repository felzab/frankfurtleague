from typing import Annotated

from fastapi import APIRouter, Body, Depends
from motor.motor_asyncio import AsyncIOMotorClientSession

from app.api.saisons.schemas import FLSaisonRules
from app.api.teams.schemas import (
    FLPatchSaisonTeamPayload,
    FLPatchTeamPayload,
    FLPatchTeamResponse,
    FLPostSaisonTeamPayload,
    FLPostTeamPayload,
    FLPostTeamResponse,
    FLSaisonTeamResponse,
    FLTeamRecord,
    FLTeamsMembershipsResponse,
    FLTeamWithMembershipsListAdapter,
    FLTeamWriteResponse,
)
from app.api.teams.services import (
    build_team_memberships_pipeline,
    find_club_entry_refusal,
    find_entry_refusal,
    find_gruppe_move_refusal,
    find_retire_refusal,
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

    The fan-out is not optional: the junction and every match carry a copy of both fields, so
    without it a stale name stands indefinitely. A `past` season is left alone -- it is the record
    of the name the club was played under.
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

    A team with no row here is ABSENT from that season entirely: the join is strict. Refused unless
    the club is still in the league, the season is `future`, and the group it names has space.
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
        name=team_raw["name"],
        shorthand=team_raw["shorthand"],
    )


@router.patch(
    f"{by_id('team_id')}/saisons/{{saison_id}}",
    response_model=FLSaisonTeamResponse,
    summary="Change a team's group or record its exit from the season",
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
    Change which group a team is in for a season, or record that it has left.

    An `austritt` -- a disqualification or a withdrawal -- is how a team leaves a season; there is no
    delete. Both fields are required, so an omitted `austritt` is a 422 rather than a team quietly
    reinstated.
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
                # entering does not judge it, and only the capacity half below applies.
                saison_status="future",
                gruppe=saison_team_data.gruppe,
                rules=FLSaisonRules.model_validate(saison_raw["rules"]),
                occupied=len(occupied_rows),
            )
        )

    await patch_one_in_db(
        collection=saison_teams_collection,
        db_filter={"team_id": team_id, "saison_id": saison_id},
        update={"$set": saison_team_data.model_dump(mode="json")},
    )

    return FLSaisonTeamResponse(
        saison_id=saison_id,
        team_id=team_id,
        gruppe=saison_team_data.gruppe,
        austritt=saison_team_data.austritt,
        name=existing_raw["name"],
        shorthand=existing_raw["shorthand"],
    )
