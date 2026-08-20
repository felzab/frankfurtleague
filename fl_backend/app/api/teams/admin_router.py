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
    db: DBClient,
) -> FLPatchTeamResponse:
    """
    Update a club, then rewrite the name and shorthand embedded in its matches.

    The fan-out is not optional: matches carry a copy of both fields, so without it every match card
    shows a stale name indefinitely.
    """

    async def rename_and_fan_out(session: AsyncIOMotorClientSession) -> FLPatchTeamResponse:
        updated_raw = await patch_one_in_db(
            collection=teams_collection,
            db_filter={"_id": team_id},
            update={"$set": team_data.model_dump(mode="json")},
            session=session,
        )

        # Two passes: one `update_many` cannot write a different path per document.
        fanned_out = 0
        for slot in ("team1", "team2"):
            result = await patch_many_in_db(
                collection=spiele_collection,
                db_filter={f"{slot}.team_id": team_id},
                update={"$set": {f"{slot}.name": team_data.name, f"{slot}.shorthand": team_data.shorthand}},
                session=session,
            )
            fanned_out += result.modified_count

        return FLPatchTeamResponse(updated_document=FLTeamRecord.model_validate(updated_raw), fanned_out_to_spiele=fanned_out)

    # One transaction over the three writes: a club renamed on `team1` and not on `team2` leaves
    # one fixture disagreeing with itself. `with_transaction` over a bare `start_transaction` --
    # every write derives from the payload, so a retry is safe.
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
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
) -> FLSaisonTeamResponse:
    """
    Enter a team into a season, in a group.

    A team with no row here is ABSENT from that season entirely: the join is strict. Refused unless
    the season is `future` and the group it names has space.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_team_data.saison_id})
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
            "disqualifikation": None,
        },
    )

    return FLSaisonTeamResponse(
        saison_id=saison_team_data.saison_id,
        team_id=team_id,
        gruppe=saison_team_data.gruppe,
        disqualifikation=None,
    )


@router.patch(
    f"{by_id('team_id')}/saisons/{{saison_id}}",
    response_model=FLSaisonTeamResponse,
    summary="Change a team's group or disqualify it",
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
    Change which group a team is in for a season, or disqualify it.

    Disqualification is how a team leaves a season; there is no delete. Both fields are required, so
    an omitted `disqualifikation` is a 422 rather than a team quietly reinstated.
    """

    existing_raw = await pull_one_from_db(
        collection=saison_teams_collection,
        db_filter={"team_id": team_id, "saison_id": saison_id},
        projection=["gruppe"],
    )
    # Only a CHANGE is judged: a disqualification writes the same row without moving anyone.
    if saison_team_data.gruppe != existing_raw["gruppe"]:
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id})

        # Both sides, because a fixture fields a team on either.
        fixtures_drawn = await spiele_collection.count_documents(
            {"saison_id": saison_id, "$or": [{"team1.team_id": team_id}, {"team2.team_id": team_id}]}
        )
        refuse(find_gruppe_move_refusal(saison_status=str(saison_raw["status"]), fixtures_drawn=fixtures_drawn))

        occupied_rows = await pull_many_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "gruppe": saison_team_data.gruppe},
            projection=["_id"],
        )
        refuse(
            find_entry_refusal(
                # `find_gruppe_move_refusal` above holds the status gate a MOVE has, so this is fed
                # the one status the entry gate accepts.
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
        disqualifikation=saison_team_data.disqualifikation,
    )
