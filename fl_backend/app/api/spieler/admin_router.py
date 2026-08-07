"""
SPIELER · write endpoints

People, and their membership of a team's squad for a season. Two surfaces, because those are two
different facts: a player moving clubs is not a new person, and a person leaving the league is not the
same as a squad row ending.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `verify_access_admin` is attached at ROUTER level, so every endpoint added here is guarded by
    construction. Never move the guard onto an individual endpoint.
  • Deletion is SOFT on both collections, and they retire INDEPENDENTLY. Retiring a person leaves their
    squad history intact; retiring a squad row leaves the person playing elsewhere.
  • Creating a squad row is a plain insert and 409s on a repeat, because `uniq_spieler_id_saison_id`
    keeps indexing a retired one. Bringing a player back into a season they already have a row for is
    `POST .../saisons/{saison_id}/reactivate`, never a second create.
  • `nummer` is a STRING. Squad numbers are worn, not counted.
  • `position` and `stufe` are CLOSED SETS (ADR-0061), enforced by the payload models here and by the
    `saison_spieler` validator underneath them.
  • `/spieler/{spieler_id}/saisons/{saison_id}` addresses a JUNCTION ROW -- this player's team, number,
    position and stufe for that season -- and never the season document, which lives at
    `/saisons/{saison_id}`. A GET added here must return junction rows (ADR-0034).
  • `GET /memberships` is the exception to the line above and is deliberate: it is player-centric, so it
    returns PEOPLE carrying their junction rows rather than junction rows. It sits here because only the
    admin surface asks it, exactly as `GET /teams/memberships` does.

 DECISIONS ────────────────────────────────────────────────────────────────────────────────────────────────

  ADR-0032  soft deletion is a date, and creating never revives
  ADR-0034  the junction is addressed by its natural key, under the entity
  ADR-0061  position and stufe are closed sets

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/glossary.md -- "the season junctions"
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
from app.api.spieler.services import build_spieler_memberships_pipeline
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, patch_one_in_db, post_one_to_db
from app.core.dependencies import SaisonSpielerCollection, SpielerCollection, get_german_date_str
from app.core.exceptions import DocumentNotFoundException
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
        # endpoints read back, and a row written before the field existed would otherwise KeyError on
        # a request that changed nothing about it. The migration seeds every live row.
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
    split that puts `GET /teams/memberships` beside the team writes (ADR-0034).

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
) -> FLSaisonSpielerResponse:
    """
    Update a player's squad entry — their team, number, position or stufe for that season.

    Changing `team_id` here is how a transfer is recorded, and it is the whole reason the junction
    exists separately from the person.

    `position` and `stufe` are closed sets (ADR-0061), so a value outside either is a 422 rather than
    a second spelling of a position the league already has. `nummer` stays free text: a squad number
    is worn rather than counted, and it is not unique within a squad.
    """

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
