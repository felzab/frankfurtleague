"""
SPIELER · write endpoints

People, and their membership of a team's squad for a season — two surfaces, because a player
moving clubs is not a new person. Guarded at router level by `verify_access_admin` (ADR-0027).

Invariants:
- Deletion is soft on both collections, and they retire independently (ADR-0025).
- Creating a squad row 409s on a repeat — `reactivate` is what brings a player back (ADR-0025).
- `nummer` is a string: squad numbers are worn, not counted.
- `position` and `stufe` are closed sets (ADR-0048), here and in the `saison_spieler` validator.
- `/spieler/{spieler_id}/saisons/{saison_id}` addresses a junction row, never the season (ADR-0027).
- `GET /memberships` returns people carrying junction rows — deliberately, like the teams twin.

See:
- docs/glossary.md — "the season junctions"
"""

from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument

from app.api.spieler.schemas import (
    FLPatchSaisonSpielerPayload,
    FLPatchSpielerPayload,
    FLPostSaisonSpielerPayload,
    FLPostSpielerPayload,
    FLSaisonSpielerResponse,
    FLSpielerMembershipsResponse,
    FLSpielerSingleResponse,
    FLSpielerWithMemberships,
    FLSpielerWriteResponse,
)
from app.api.spieler.services import build_spieler_memberships_pipeline, find_squad_refusal
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, patch_one_in_db, post_one_to_db, pull_one_from_db
from app.core.dependencies import SaisonSpielerCollection, SaisonTeamsCollection, SpielerCollection, get_german_date_str
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieler",
    dependencies=[Depends(verify_access_admin)],
)


def _as_single(document) -> FLSpielerSingleResponse:
    return FLSpielerSingleResponse(
        spieler_id=document["_id"],
        vorname=document["vorname"],
        nachname=document.get("nachname"),
        inactive_since=document.get("inactive_since"),
    )


def _as_junction(document) -> FLSaisonSpielerResponse:
    return FLSaisonSpielerResponse(
        spieler_id=document["spieler_id"],
        saison_id=document["saison_id"],
        team_id=document["team_id"],
        nummer=document.get("nummer"),
        position=document.get("position"),
        stufe=document.get("stufe"),
        is_nachgetragen=document["is_nachgetragen"],
        # `.get` with a default rather than a subscript: this echoes rows the reactivate and delete
        # endpoints read back, and a row missing the key would KeyError on a request that changed
        # nothing. `python -m app.core.constraints --check` finds one.
        is_captain=document.get("is_captain", False),
        inactive_since=document.get("inactive_since"),
    )


@router.get("/memberships", response_model=FLSpielerMembershipsResponse, summary="Every Spieler with their squad rows")
async def get_spieler_memberships(spieler_collection: SpielerCollection) -> FLSpielerMembershipsResponse:
    """
    Every player, retired ones included, each with every squad row they hold. Sorted by name.

    The admin list's one read. `GET /spieler` cannot answer it at any filter setting, and the reasons
    are three separate ones: with a `saison_id` its junction join is strict, so a player with no row
    for that season is invisible to the only list that could give them one; without a `saison_id` it
    unwinds the junction and a player with no row at all comes back missing the `team_id` `FLSpieler`
    requires; and `FLSpieler` carries no `saison_id`, so a player who has played two seasons comes
    back as two rows nothing can tell apart. This is the player-centric question as one aggregation.

    In the admin router rather than the read router because only the admin surface asks it — the same
    split that puts `GET /teams/memberships` beside the team writes (ADR-0027).

    A static path beside `by_id` routes: the id convertor takes 24 hex characters, so
    `/spieler/memberships` can never be captured by an id route regardless of declaration order.
    """

    spieler_raw = await aggregate_many_from_db(collection=spieler_collection, pipeline=build_spieler_memberships_pipeline())

    return FLSpielerMembershipsResponse(spieler=[FLSpielerWithMemberships.model_validate(spieler) for spieler in spieler_raw])


@router.post("", response_model=FLSpielerWriteResponse, status_code=201, summary="Create a Spieler")
async def post_spieler(
    spieler_data: Annotated[FLPostSpielerPayload, Body()],
    spieler_collection: SpielerCollection,
) -> FLSpielerWriteResponse:
    """
    Create a player — the person, and nothing else.

    A player created here belongs to no team and appears in no squad list until they have a junction
    row, which is `POST /spieler/{spieler_id}/saisons`. That split is what makes a player who changes
    club next season the same person rather than a second record of them.

    There is deliberately **no uniqueness rule on a name**. Two people genuinely can share one, and a
    league that refused the second would be wrong about the world rather than careful.
    """

    post_operation = await post_one_to_db(
        collection=spieler_collection,
        document={**spieler_data.model_dump(mode="json"), "inactive_since": None},
    )

    return FLSpielerWriteResponse(
        acknowledged=1 if post_operation.acknowledged else 0,
        spieler_id=post_operation.inserted_id,
    )


@router.patch(by_id("spieler_id"), response_model=FLSpielerSingleResponse, summary="Update a Spieler's name")
async def patch_spieler(
    spieler_id: CustomRouteObjectId,
    spieler_data: Annotated[FLPatchSpielerPayload, Body()],
    spieler_collection: SpielerCollection,
) -> FLSpielerSingleResponse:
    """
    Update a player's name.

    No fan-out: unlike a team or a venue, a player's name is embedded in no other document. Squad lists
    read it through a `$lookup` at request time, so a correction here is visible everywhere at once.
    """

    updated_raw = await patch_one_in_db(
        collection=spieler_collection,
        filter={"_id": spieler_id},
        update={"$set": spieler_data.model_dump(mode="json")},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"_id": spieler_id}, error_code="DB-COMMON-001")

    return _as_single(updated_raw)


@router.delete(by_id("spieler_id"), response_model=FLSpielerSingleResponse, summary="Retire a Spieler (soft delete)")
async def delete_spieler(
    spieler_id: CustomRouteObjectId,
    spieler_collection: SpielerCollection,
    today: str = Depends(get_german_date_str),
) -> FLSpielerSingleResponse:
    """
    Retire a player from the league. SOFT: it stamps `inactive_since` and the document stays.

    Their squad rows are **left alone**. The seasons they played still happened, and a squad list for a
    past season should still name them — retiring the person says nothing about their history.

    The date is what a future scheduled purge selects on; without it "retired" could only ever mean
    "eventually" (open item BE-12).
    """

    updated_raw = await patch_one_in_db(
        collection=spieler_collection,
        filter={"_id": spieler_id},
        update={"$set": {"inactive_since": today}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"_id": spieler_id}, error_code="DB-COMMON-001")

    return _as_single(updated_raw)


@router.post(f"{by_id('spieler_id')}/reactivate", response_model=FLSpielerSingleResponse, summary="Bring a retired Spieler back")
async def reactivate_spieler(
    spieler_id: CustomRouteObjectId,
    spieler_collection: SpielerCollection,
) -> FLSpielerSingleResponse:
    """Clear `inactive_since`, putting the player back into every read that hides retired ones."""

    updated_raw = await patch_one_in_db(
        collection=spieler_collection,
        filter={"_id": spieler_id},
        update={"$set": {"inactive_since": None}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"_id": spieler_id}, error_code="DB-COMMON-001")

    return _as_single(updated_raw)


@router.post(f"{by_id('spieler_id')}/saisons", response_model=FLSaisonSpielerResponse, status_code=201, summary="Add a Spieler to a squad")
async def post_saison_spieler(
    spieler_id: CustomRouteObjectId,
    saison_spieler_data: Annotated[FLPostSaisonSpielerPayload, Body()],
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
) -> FLSaisonSpielerResponse:
    """
    Put a player in a team's squad for a season, with their number, position and stufe.

    One row per player per season, enforced by a unique index — a player cannot be in two squads at
    once, and moving them is a PATCH of `team_id` rather than a second row.

    A repeat is a **409, including against a retired row**, because the index keeps holding the key.
    Bringing a player back into a season they already have a row for is
    `POST /spieler/{spieler_id}/saisons/{saison_id}/reactivate` — reviving inside create would quietly
    overwrite the number and position the old row still carries.
    """

    # The club has to be in the season, and the number has to be free (`REQ-SQUAD-001`/`002`). Read here
    # rather than in a service, because both facts live in other collections.
    team_in_saison = (
        await saison_teams_collection.count_documents(
            {"saison_id": saison_spieler_data.saison_id, "team_id": saison_spieler_data.team_id}, limit=1
        )
    ) > 0
    taken = [
        row.get("nummer")
        async for row in saison_spieler_collection.find(
            {
                "saison_id": saison_spieler_data.saison_id,
                "team_id": saison_spieler_data.team_id,
                "spieler_id": {"$ne": spieler_id},
                "inactive_since": None,
            },
            {"nummer": 1},
        )
    ]
    squad_refusal = find_squad_refusal(
        team_in_saison=team_in_saison,
        proposed_nummer=saison_spieler_data.nummer,
        stored_nummer=None,
        taken_nummern=taken,
    )
    if squad_refusal is not None:
        error_code, detail = squad_refusal
        raise DocumentConflictException(error_code=error_code, message=detail)

    document = {
        "spieler_id": spieler_id,
        **saison_spieler_data.model_dump(mode="json", exclude={"team_id"}),
        "team_id": saison_spieler_data.team_id,
        "inactive_since": None,
    }
    await post_one_to_db(collection=saison_spieler_collection, document=document)

    return _as_junction(document)


@router.patch(f"{by_id('spieler_id')}/saisons/{{saison_id}}", response_model=FLSaisonSpielerResponse, summary="Update a squad entry")
async def patch_saison_spieler(
    spieler_id: CustomRouteObjectId,
    saison_id: str,
    saison_spieler_data: Annotated[FLPatchSaisonSpielerPayload, Body()],
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
) -> FLSaisonSpielerResponse:
    """
    Update a player's squad entry — their team, number, position or stufe for that season.

    Changing `team_id` here is how a transfer is recorded, and it is the whole reason the junction
    exists separately from the person.

    `position` and `stufe` are closed sets (ADR-0048), so a value outside either is a 422 rather than
    a second spelling of a position the league already has. `nummer` stays free TEXT — a squad number is
    worn rather than counted — but it must not newly collide: `REQ-SQUAD-002` refuses a number this
    write would take from another player in the same squad (decided 2026-08-08). Resubmitting the
    stored number always passes, so an existing duplicate stays editable.
    """

    # What this row holds today, so the number rule can tell a NEW collision from an existing one.
    stored_raw = await pull_one_from_db(
        collection=saison_spieler_collection,
        db_filter={"spieler_id": spieler_id, "saison_id": saison_id},
        projection=["nummer"],
    )

    # The two facts `find_squad_refusal` decides on, read here because both live in other collections.
    team_in_saison = (
        await saison_teams_collection.count_documents({"saison_id": saison_id, "team_id": saison_spieler_data.team_id}, limit=1)
    ) > 0
    taken = [
        row.get("nummer")
        async for row in saison_spieler_collection.find(
            {"saison_id": saison_id, "team_id": saison_spieler_data.team_id, "spieler_id": {"$ne": spieler_id}, "inactive_since": None},
            {"nummer": 1},
        )
    ]
    squad_refusal = find_squad_refusal(
        team_in_saison=team_in_saison,
        proposed_nummer=saison_spieler_data.nummer,
        stored_nummer=stored_raw.get("nummer"),
        taken_nummern=taken,
    )
    if squad_refusal is not None:
        error_code, detail = squad_refusal
        raise DocumentConflictException(error_code=error_code, message=detail)

    updated_raw = await patch_one_in_db(
        collection=saison_spieler_collection,
        filter={"spieler_id": spieler_id, "saison_id": saison_id},
        update={
            "$set": {
                **saison_spieler_data.model_dump(mode="json", exclude={"team_id"}),
                "team_id": saison_spieler_data.team_id,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"spieler_id": spieler_id, "saison_id": saison_id}, error_code="DB-COMMON-001")

    return _as_junction(updated_raw)


@router.delete(f"{by_id('spieler_id')}/saisons/{{saison_id}}", response_model=FLSaisonSpielerResponse, summary="Remove a Spieler from a squad")
async def delete_saison_spieler(
    spieler_id: CustomRouteObjectId,
    saison_id: str,
    saison_spieler_collection: SaisonSpielerCollection,
    today: str = Depends(get_german_date_str),
) -> FLSaisonSpielerResponse:
    """
    Take a player out of a season's squad. SOFT: it stamps `inactive_since` and the row stays.

    The row is preserved rather than removed because it is the record that this player was in this
    squad, wearing this number — which stays true after they leave. Every read hides it by default;
    `include_inactive=true` is how an admin list gets it back.
    """

    updated_raw = await patch_one_in_db(
        collection=saison_spieler_collection,
        filter={"spieler_id": spieler_id, "saison_id": saison_id},
        update={"$set": {"inactive_since": today}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"spieler_id": spieler_id, "saison_id": saison_id}, error_code="DB-COMMON-001")

    return _as_junction(updated_raw)


@router.post(
    f"{by_id('spieler_id')}/saisons/{{saison_id}}/reactivate",
    response_model=FLSaisonSpielerResponse,
    summary="Put a Spieler back in a squad they left",
)
async def reactivate_saison_spieler(
    spieler_id: CustomRouteObjectId,
    saison_id: str,
    saison_spieler_collection: SaisonSpielerCollection,
) -> FLSaisonSpielerResponse:
    """
    Clear a squad row's `inactive_since`, restoring the entry with the number and position it had.

    This is the endpoint a repeat create is redirected to. `uniq_spieler_id_saison_id` means the
    retired row still holds the key, so a second create cannot succeed — and reviving inside create
    would silently overwrite the number, position and stufe the old row still carries, which is
    precisely the information worth keeping.
    """

    updated_raw = await patch_one_in_db(
        collection=saison_spieler_collection,
        filter={"spieler_id": spieler_id, "saison_id": saison_id},
        update={"$set": {"inactive_since": None}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"spieler_id": spieler_id, "saison_id": saison_id}, error_code="DB-COMMON-001")

    return _as_junction(updated_raw)
