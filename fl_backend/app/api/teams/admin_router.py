"""
TEAMS · write endpoints

Clubs, and their membership of a season.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `verify_access_admin` is attached at ROUTER level, so every endpoint added here is guarded by
    construction. Never move the guard onto an individual endpoint.
  • Renaming a club FANS OUT into every match embedding it, unconditionally. The embedded `name` is a
    display copy of `teams.name` and nothing else (ADR-0028, rule 3): a bracket slot label lives in the
    match's own `teamN_quelle`, which no path under `team1.`/`team2.` can reach (ADR-0041).
  • Deletion is SOFT, because `spiele.team1.team_id` and `team2.team_id` point here and a hard delete
    would orphan every historical match. `uniq_shorthand` keeps indexing a retired club, so its two
    letters stay reserved -- which is correct, and which is why creating a club whose shorthand is
    taken comes back 409 rather than succeeding.
  • A team is NEVER removed from a season. Once squads are settled the only way out is disqualification
    (ADR-0033), so the junction has a POST and a PATCH and no DELETE at all.
  • A write echoes `FLTeamRecord`, the STORED club document -- never `FLTeam`. `FLTeam` is flattened
    from the club, a junction row and a derived `statistik`, and its pipeline's junction join is
    STRICT: a club with no `saison_teams` row for the current season is dropped, so re-reading one
    would answer 404 to a write that succeeded. That is the normal state for a club being created,
    retired or reactivated.
  • `/teams/{team_id}/saisons/{saison_id}` addresses a JUNCTION ROW -- this team's group and
    disqualification for that season -- and never the season document, which lives at
    `/saisons/{saison_id}`. A GET added here must return junction rows (ADR-0034).

 DECISIONS ────────────────────────────────────────────────────────────────────────────────────────────────

  ADR-0032  soft deletion is a date, and creating never revives
  ADR-0033  a team leaves a season only by disqualification
  ADR-0034  the junction is addressed by its natural key, under the entity

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/glossary.md -- "the season junctions"
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
from app.api.teams.services import RETIRE_BLOCKED, build_team_memberships_pipeline, find_entry_refusal, find_retire_refusal
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, patch_many_in_db, patch_one_in_db, post_one_to_db, pull_many_from_db, pull_one_from_db
from app.core.dependencies import (
    SaisonsCollection,
    SaisonTeamsCollection,
    SpieleCollection,
    TeamsCollection,
    get_german_date_str,
)
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
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
    same split that puts `GET /spiele/action_required` beside the match writes (ADR-0034).

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

    `shorthand` is unique across every club, retired ones included, and the database enforces it
    (ADR-0027) — a duplicate comes back as 409, not as a second team.

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
    shows the old name indefinitely. There was zero drift across all 31 matches when this was
    measured, and that is the state this endpoint exists to preserve.

    **It runs for every club, with no exception to remember.** The embedded `name` is a display copy of
    this document and carries nothing else — a bracket slot's source is the match's own `teamN_quelle`,
    which no path under `team1.`/`team2.` reaches (ADR-0028, ADR-0041).
    """

    updated_raw = await patch_one_in_db(
        collection=teams_collection,
        filter={"_id": team_id},
        update={"$set": team_data.model_dump(mode="json")},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"_id": team_id}, error_code="DB-COMMON-001")

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
    still being played or drawn; a club leaves a running season only by disqualification (ADR-0033).
    A club whose seasons are all `past`, or that is in no season, retires normally.

    Matches embed a copy of the team and reference it by id, so a hard delete would orphan every
    historical match it ever played. Its junction rows are left alone as well — the seasons it played
    in still happened, and its results still count towards those tables.

    Reversed by `POST /teams/{team_id}/reactivate`, never by creating the club again — the create
    endpoint refuses a shorthand a retired club still holds, because it cannot tell the same club
    returning from a different one wanting those two letters.
    """

    # The junction names the club's seasons; their statuses decide the refusal. Two small reads
    # rather than a lookup: sixteen rows and a handful of seasons.
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
        raise DocumentConflictException(error_code=RETIRE_BLOCKED, message=refusal)

    updated_raw = await patch_one_in_db(
        collection=teams_collection,
        filter={"_id": team_id},
        update={"$set": {"inactive_since": today}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"_id": team_id}, error_code="DB-COMMON-001")

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
        raise DocumentNotFoundException(filter={"_id": team_id}, error_code="DB-COMMON-001")

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
    space** (`REQ-ENTER-001..003`, owner 2026-08-07). The bounds are the season's own
    `rules.number_of_groups` and `rules.teams_per_group`. The count-then-insert is not transactional;
    the single-admin surface makes the race a non-concern, and the cost of losing it is one team over
    a planning bound rather than corrupt data.

    One row per team per season, enforced by a unique index; a second attempt is a 409. Creating is a
    plain insert rather than a revive, because no row here is ever retired — a team leaves a season
    only by disqualification (ADR-0033).
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
        # fails loudly here instead of entering a team against a bound nobody chose (ADR-0043's rule).
        rules=FLSaisonRules.model_validate(saison_raw["rules"]),
        occupied=len(occupied_rows),
    )
    if refusal is not None:
        error_code, detail = refusal
        raise DocumentConflictException(error_code=error_code, message=detail)

    await post_one_to_db(
        collection=saison_teams_collection,
        document={
            "saison_id": saison_team_data.saison_id,
            "team_id": team_id,
            "gruppe": saison_team_data.gruppe,
            # Written explicitly rather than left off: the key is required by the validator and by
            # `FLTeam`, and a row without it is unreadable rather than merely undecorated (ADR-0059).
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
) -> FLSaisonTeamResponse:
    """
    Change which group a team is in for a season, or disqualify it.

    Disqualification is how a team leaves a season; there is no delete here (ADR-0033). It is a RECORD
    carrying the reason and the effective date, and `null` is what lifting one looks like — there is no
    boolean beside it to contradict it (ADR-0059). The record is read by `GET /teams` and joined into
    match data rather than copied (ADR-0028), so entering it here reaches every surface that shows a DQ
    badge with no second write to keep in step.

    Both writable fields are required on the payload, so this replaces them wholesale. An omitted
    `disqualifikation` is a 422 rather than a team quietly reinstated by a form that forgot the field.

    **A group CHANGE is held to the season's capacity** (`REQ-ENTER-002`/`003`): the target group must
    be one the season offers and must have space, or the move is a 409. Only the change is checked —
    a disqualification writes the same row without moving anyone, and the season-status gate stays
    the entry endpoint's alone, because the legal window for a group change ("future, or no fixture
    yet") is the page's `gruppeLock` rule rather than a status test.
    """

    existing_raw = await pull_one_from_db(
        collection=saison_teams_collection,
        db_filter={"team_id": team_id, "saison_id": saison_id},
        projection=["gruppe"],
    )
    if saison_team_data.gruppe != existing_raw["gruppe"]:
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id})
        occupied_rows = await pull_many_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "gruppe": saison_team_data.gruppe},
            projection=["_id"],
        )
        refusal = find_entry_refusal(
            # The status gate does not apply to a move, so the check is fed the one status it accepts.
            saison_status="future",
            gruppe=saison_team_data.gruppe,
            rules=FLSaisonRules.model_validate(saison_raw["rules"]),
            occupied=len(occupied_rows),
        )
        if refusal is not None:
            error_code, detail = refusal
            raise DocumentConflictException(error_code=error_code, message=detail)

    updated_raw = await patch_one_in_db(
        collection=saison_teams_collection,
        filter={"team_id": team_id, "saison_id": saison_id},
        update={"$set": saison_team_data.model_dump(mode="json")},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"team_id": team_id, "saison_id": saison_id}, error_code="DB-COMMON-001")

    return FLSaisonTeamResponse(
        saison_id=saison_id,
        team_id=team_id,
        gruppe=saison_team_data.gruppe,
        disqualifikation=saison_team_data.disqualifikation,
    )
