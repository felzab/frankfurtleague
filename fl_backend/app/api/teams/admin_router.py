"""
TEAMS · write endpoints

Clubs, and their membership of a season. Guarded at router level by `verify_access_admin`.

Invariants:
- A rename fans the club's name into every match embedding it, unconditionally.
- Deletion is soft; `uniq_shorthand` keeps indexing a retired club, so a taken shorthand 409s.
- A team never leaves a season — the junction has a POST and a PATCH and no DELETE.
- A write echoes `FLTeamRecord`, never `FLTeam` — the strict join would 404 a just-created club.
- `/teams/{team_id}/saisons/{saison_id}` addresses a junction row, never the season.

See:
- docs/glossary.md — "the season junctions"
"""

from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument

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
    FLTeamWithMemberships,
    FLTeamWriteResponse,
)
from app.api.teams.services import (
    build_team_memberships_pipeline,
    find_entry_refusal,
    find_gruppe_move_refusal,
    find_retire_refusal,
)
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, patch_many_in_db, patch_one_in_db, post_one_to_db, pull_many_from_db, pull_one_from_db
from app.core.dependencies import (
    SaisonsCollection,
    SaisonTeamsCollection,
    SpieleCollection,
    TeamsCollection,
    get_german_date_str,
)
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentConflictException, DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/teams",
    dependencies=[Depends(verify_access_admin)],
)


@router.get("/memberships", response_model=FLTeamsMembershipsResponse, summary="Every team with its season memberships")
async def get_team_memberships(teams_collection: TeamsCollection) -> FLTeamsMembershipsResponse:
    """
    Every team, retired ones included, each with every season membership it holds. Sorted by name.

    The admin list's one read. `GET /teams` cannot answer it: that read is season-scoped with a
    strict junction join by design, so listing every team meant one request per season and a
    client-side union. This is the club-centric question as one aggregation instead.

    In the admin router rather than the read router because only the admin surface asks it — the
    same split that puts `GET /spiele/action_required` beside the match writes.

    A static path beside `by_id` routes: the id convertor takes 24 hex characters, so
    `/teams/memberships` can never be captured by an id route regardless of declaration order.
    """

    teams_raw = await aggregate_many_from_db(collection=teams_collection, pipeline=build_team_memberships_pipeline())

    return FLTeamsMembershipsResponse(teams=[FLTeamWithMemberships.model_validate(team) for team in teams_raw])


@router.post("", response_model=FLPostTeamResponse, status_code=201, summary="Create a team")
async def post_team(
    team_data: Annotated[FLPostTeamPayload, Body()],
    teams_collection: TeamsCollection,
) -> FLPostTeamResponse:
    """
    Create a club.

    `shorthand` is unique across every club, retired ones included, and the database enforces it — a
    duplicate comes back as 409, not as a second team.

    **It never revives a retired club, and that is deliberate.** A shorthand collision has two possible
    meanings — the same club returning, or a different club wanting two letters the old one still
    holds — and nothing in the payload distinguishes them. Reviving on the first reading would, on the
    second, silently repoint every historical match of the retired club at a different club's name.
    Reactivation is `POST /teams/{team_id}/reactivate`, which names an id and so cannot be ambiguous.

    This creates the club only. It plays no season until it has a junction row, which is
    `POST /teams/{team_id}/saisons` — and until then it is absent from every season-scoped read,
    because that join is strict.
    """

    post_operation = await post_one_to_db(
        collection=teams_collection,
        document={**team_data.model_dump(mode="json"), "inactive_since": None},
    )

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
) -> FLPatchTeamResponse:
    """
    Update a club, then rewrite the name and shorthand embedded in every match it plays in.

    The fan-out is not optional: matches carry a copy of both fields, so without it every match card
    shows a stale name indefinitely. Measured 2026-08-09: zero drift across the embedded copies, which
    is the state this endpoint exists to preserve.

    **It runs for every club, with no exception to remember.** The embedded `name` is a display copy of
    this document and carries nothing else — a bracket slot's source is the match's own `teamN_quelle`,
    which no path under `team1.`/`team2.` reaches.
    """

    updated_raw = await patch_one_in_db(
        collection=teams_collection,
        filter={"_id": team_id},
        update={"$set": team_data.model_dump(mode="json")},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"_id": team_id}, error_code=DOCUMENT_NOT_FOUND)

    # Both slots, in two passes: a match embeds the team as either `team1` or `team2`, and one
    # `update_many` cannot write a different path per document.
    fanned_out = 0
    for slot in ("team1", "team2"):
        result = await patch_many_in_db(
            collection=spiele_collection,
            filter={f"{slot}.team_id": team_id},
            update={"$set": {f"{slot}.name": team_data.name, f"{slot}.shorthand": team_data.shorthand}},
        )
        fanned_out += result.modified_count

    return FLPatchTeamResponse(updated_document=FLTeamRecord.model_validate(updated_raw), fanned_out_to_spiele=fanned_out)


@router.delete(by_id("team_id"), response_model=FLTeamWriteResponse, summary="Retire a team (soft delete)")
async def delete_team(
    team_id: CustomRouteObjectId,
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    today: str = Depends(get_german_date_str),
) -> FLTeamWriteResponse:
    """
    Retire a club from the league.

    A SOFT delete: it stamps `inactive_since` and the document stays.

    **Refused with a 409 (`REQ-RETIRE-001`) while the club is entered in an `active` or `future`
    season.** Retiring hides the club from every picker and default list while its fixtures are
    still being played or drawn; a club leaves a running season only by disqualification.
    A club whose seasons are all `past`, or that is in no season, retires normally.

    Matches embed a copy of the team and reference it by id, so a hard delete would orphan every
    historical match it ever played. Its junction rows are left alone as well — the seasons it played
    in still happened, and its results still count towards those tables.

    Reversed by `POST /teams/{team_id}/reactivate`, never by creating the club again — the create
    endpoint refuses a shorthand a retired club still holds, because it cannot tell the same club
    returning from a different one wanting those two letters.
    """

    # The junction names the club's seasons; their statuses decide the refusal. Two small reads rather
    # than a lookup: a club holds a handful of rows and the league a handful of seasons.
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

    refusal = find_retire_refusal(str(row["status"]) for row in saison_rows)
    if refusal is not None:
        raise DocumentConflictException.from_refusal(refusal)

    updated_raw = await patch_one_in_db(
        collection=teams_collection,
        filter={"_id": team_id},
        update={"$set": {"inactive_since": today}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"_id": team_id}, error_code=DOCUMENT_NOT_FOUND)

    return FLTeamWriteResponse(updated_document=FLTeamRecord.model_validate(updated_raw))


@router.post(f"{by_id('team_id')}/reactivate", response_model=FLTeamWriteResponse, summary="Bring a retired team back")
async def reactivate_team(
    team_id: CustomRouteObjectId,
    teams_collection: TeamsCollection,
) -> FLTeamWriteResponse:
    """
    Clear `inactive_since`, putting a retired club back into every read that hides retired ones.

    Separate from create on purpose. Reviving inside create would have to key off `shorthand`, which
    cannot distinguish the same club returning from a different club wanting two letters the retired
    one still holds — and getting that wrong repoints every historical match of the old club at the new
    one's name. An id cannot be ambiguous, so reactivation names one.
    """

    updated_raw = await patch_one_in_db(
        collection=teams_collection,
        filter={"_id": team_id},
        update={"$set": {"inactive_since": None}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"_id": team_id}, error_code=DOCUMENT_NOT_FOUND)

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

    A team with no row here is **absent from that season entirely** — the join is strict, so it appears
    in no table, no group and no statistics. Entering every participating team is therefore the
    substantive step in setting a season up.

    **Refused with a 409 unless the season is `future`, the group is one it offers and that group has
    space** (`REQ-ENTER-001..003`, decided 2026-08-07). The bounds are the season's own
    `rules.number_of_groups` and `rules.teams_per_group`. The count-then-insert is not transactional;
    the single-admin surface makes the race a non-concern, and the cost of losing it is one team over
    a planning bound rather than corrupt data.

    One row per team per season, enforced by a unique index; a second attempt is a 409. Creating is a
    plain insert rather than a revive, because no row here is ever retired — a team leaves a season
    only by disqualification.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_team_data.saison_id})
    occupied_rows = await pull_many_from_db(
        collection=saison_teams_collection,
        db_filter={"saison_id": saison_team_data.saison_id, "gruppe": saison_team_data.gruppe},
        projection=["_id"],
    )

    refusal = find_entry_refusal(
        saison_status=str(saison_raw["status"]),
        gruppe=saison_team_data.gruppe,
        # Validated rather than read raw, so a season document still missing the two capacity keys
        # fails loudly here instead of entering a team against a bound nobody chose.
        rules=FLSaisonRules.model_validate(saison_raw["rules"]),
        occupied=len(occupied_rows),
    )
    if refusal is not None:
        raise DocumentConflictException.from_refusal(refusal)

    await post_one_to_db(
        collection=saison_teams_collection,
        document={
            "saison_id": saison_team_data.saison_id,
            "team_id": team_id,
            "gruppe": saison_team_data.gruppe,
            # Written explicitly rather than left off: the key is required by the validator and by
            # `FLTeam`, and a row without it is unreadable rather than merely undecorated.
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

    Disqualification is how a team leaves a season; there is no delete here. It is a RECORD carrying
    the reason and the effective date, and `null` is what lifting one looks like — there is no boolean
    beside it to contradict it. The record is read by `GET /teams` and joined into match data rather
    than copied, so entering it here reaches every surface that shows a DQ badge with no second write
    to keep in step.

    Both writable fields are required on the payload, so this replaces them wholesale. An omitted
    `disqualifikation` is a 422 rather than a team quietly reinstated by a form that forgot the field.

    **A group CHANGE is held to its own rules**, and only a change is checked — a disqualification writes
    the same row without moving anyone. The target group must be one the season offers and must have space
    (`REQ-ENTER-002`/`003`), and the move must fall inside the window
    `fl_backend/app/api/teams/services.py :: find_gruppe_move_refusal` states (`REQ-ENTER-004`). A picker
    lock alone is no rule: without this check a direct request moves a team whose group fixtures are drawn
    — and the group phase is a round robin INSIDE a group, so those fixtures are its group.
    """

    existing_raw = await pull_one_from_db(
        collection=saison_teams_collection,
        db_filter={"team_id": team_id, "saison_id": saison_id},
        projection=["gruppe"],
    )
    if saison_team_data.gruppe != existing_raw["gruppe"]:
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id})

        # Whether this team's group phase is already drawn, which is what closes the window. Counted over
        # both sides, because a fixture fields a team on either.
        fixtures_drawn = await spiele_collection.count_documents(
            {"saison_id": saison_id, "$or": [{"team1.team_id": team_id}, {"team2.team_id": team_id}]}
        )
        move_refusal = find_gruppe_move_refusal(saison_status=str(saison_raw["status"]), fixtures_drawn=fixtures_drawn)
        if move_refusal is not None:
            raise DocumentConflictException.from_refusal(move_refusal)

        occupied_rows = await pull_many_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "gruppe": saison_team_data.gruppe},
            projection=["_id"],
        )
        refusal = find_entry_refusal(
            # The status gate is `find_gruppe_move_refusal`'s above, which states the window a move has
            # rather than the one an entry has -- so this call is fed the one status the entry gate accepts.
            saison_status="future",
            gruppe=saison_team_data.gruppe,
            rules=FLSaisonRules.model_validate(saison_raw["rules"]),
            occupied=len(occupied_rows),
        )
        if refusal is not None:
            raise DocumentConflictException.from_refusal(refusal)

    updated_raw = await patch_one_in_db(
        collection=saison_teams_collection,
        filter={"team_id": team_id, "saison_id": saison_id},
        update={"$set": saison_team_data.model_dump(mode="json")},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"team_id": team_id, "saison_id": saison_id}, error_code=DOCUMENT_NOT_FOUND)

    return FLSaisonTeamResponse(
        saison_id=saison_id,
        team_id=team_id,
        gruppe=saison_team_data.gruppe,
        disqualifikation=saison_team_data.disqualifikation,
    )
