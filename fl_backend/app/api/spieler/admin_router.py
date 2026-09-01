from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends
from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorCollection

from app.api.saisons.schemas import FLSaisonRules
from app.api.spieler.schemas import (
    FLPatchSaisonSpielerPayload,
    FLPatchSpielerPayload,
    FLPostSaisonSpielerPayload,
    FLPostSpielerPayload,
    FLSaisonSpielerResponse,
    FLSpielerAdminSingleResponse,
    FLSpielerErasureResponse,
    FLSpielerMembershipsResponse,
    FLSpielerRolle,
    FLSpielerWithMemberships,
    FLSpielerWriteResponse,
)
from app.api.spieler.services import (
    build_live_rolle_filter,
    build_live_squad_filter,
    build_spieler_memberships_pipeline,
    find_erasure_refusal,
    find_squad_capacity_refusal,
    find_squad_refusal,
    find_squad_rolle_refusal,
    registration_einwilligung,
)
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import (
    GERMAN_COLLATION,
    aggregate_many_from_db,
    erase_many_from_db,
    insert_live,
    patch_many_in_db,
    patch_one_in_db,
    post_one_to_db,
    pull_one_from_db,
    refuse,
    set_inactive_since,
)
from app.core.dependencies import (
    AktionenCollection,
    DBClient,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonTeamsCollection,
    SpielerCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.recording import build_redaction_filter, build_redaction_update, log_stamp
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin
from app.shared.schemas.custom import CustomObjectId, CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieler",
    dependencies=[Depends(verify_access_admin), Depends(bind_actor)],
)


def _as_single(document) -> FLSpielerAdminSingleResponse:
    """The admin tier's echo: the surname whole, and the retirement date `DELETE` and `reactivate` exist to set."""

    return FLSpielerAdminSingleResponse(
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
        # `.get` with a default on BOTH, not a subscript: a row missing either key would KeyError on
        # a request that changed nothing, and `rolle` is on no stored row that predates it.
        # `python -m app.core.constraints --check` finds one.
        is_nachgetragen=document.get("is_nachgetragen", False),
        rolle=document.get("rolle"),
        inactive_since=document.get("inactive_since"),
    )


async def _refuse_a_full_squad(
    *,
    saison_spieler_collection: AsyncIOMotorCollection,
    saisons_collection: AsyncIOMotorCollection,
    saison_id: str,
    team_id: CustomObjectId,
    spieler_id: CustomObjectId,
) -> None:
    """Refuse `REQ-SQUAD-003` when this team's squad for this season is already at the season's cap.

    Shared by create, transfer and reactivate: the cap is a property of the DESTINATION squad, not
    of the verb.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["rules"])
    squad_size = await saison_spieler_collection.count_documents(
        build_live_squad_filter(saison_id=saison_id, team_id=team_id, excluding_spieler_id=spieler_id)
    )

    refuse(
        find_squad_capacity_refusal(
            squad_size=squad_size,
            # Validated, not read raw: a season missing the key fails here rather than admitting a
            # player against a bound nobody chose.
            max_kadergroesse=FLSaisonRules.model_validate(saison_raw["rules"]).max_kadergroesse,
        )
    )


async def _refuse_a_taken_rolle(
    *,
    saison_spieler_collection: AsyncIOMotorCollection,
    saison_id: str,
    team_id: CustomObjectId,
    spieler_id: CustomObjectId,
    rolle: FLSpielerRolle | None,
) -> None:
    """Refuse `REQ-SQUAD-004` when another live row in this squad already holds `rolle`.

    Shared by all three writes for the reason the cap is: the role belongs to the DESTINATION squad,
    never to the verb.
    """

    if rolle is None:
        return

    taken = (
        await saison_spieler_collection.count_documents(
            build_live_rolle_filter(saison_id=saison_id, team_id=team_id, rolle=rolle, excluding_spieler_id=spieler_id),
            limit=1,
        )
    ) > 0

    refuse(find_squad_rolle_refusal(rolle=rolle, taken=taken))


# A static path beside `by_id` routes: the id convertor takes 24 hex characters, so no id route can
# capture this one whatever the declaration order.
@router.get("/memberships", response_model=FLSpielerMembershipsResponse, summary="Every Spieler with their squad rows")
async def get_spieler_memberships(spieler_collection: SpielerCollection) -> FLSpielerMembershipsResponse:
    """
    Every player, retired ones included, each with every squad row they hold.

    `GET /spieler` answers it at no setting: the junction join is strict with a `saison_id`, and
    without one a player with no live row has `nummer` and `position` null.
    """

    spieler_raw = await aggregate_many_from_db(
        collection=spieler_collection, pipeline=build_spieler_memberships_pipeline(), collation=GERMAN_COLLATION
    )

    return FLSpielerMembershipsResponse(spieler=[FLSpielerWithMemberships.model_validate(spieler) for spieler in spieler_raw])


@router.post("", response_model=FLSpielerWriteResponse, status_code=201, summary="Create a Spieler")
async def post_spieler(
    spieler_data: Annotated[FLPostSpielerPayload, Body()],
    spieler_collection: SpielerCollection,
    today: str = Depends(get_german_date_str),
) -> FLSpielerWriteResponse:
    """
    Create a player -- the person, and nothing else.

    They belong to no team until they have a junction row, and no uniqueness rule applies to a name.
    The consent record is COMPOSED here rather than taken from the body, so no admin can write one.
    """

    post_operation = await insert_live(
        collection=spieler_collection,
        document={
            **spieler_data.model_dump(mode="json"),
            "einwilligung": registration_einwilligung(today=today).model_dump(mode="json"),
        },
    )

    return FLSpielerWriteResponse(
        acknowledged=1 if post_operation.acknowledged else 0,
        spieler_id=post_operation.inserted_id,
    )


@router.patch(by_id("spieler_id"), response_model=FLSpielerAdminSingleResponse, summary="Update a Spieler's name")
async def patch_spieler(
    spieler_id: CustomRouteObjectId,
    spieler_data: Annotated[FLPatchSpielerPayload, Body()],
    spieler_collection: SpielerCollection,
) -> FLSpielerAdminSingleResponse:
    """Update a player's name. No fan-out: unlike a team or a venue, it is embedded in no other document."""

    updated_raw = await patch_one_in_db(
        collection=spieler_collection,
        db_filter={"_id": spieler_id},
        update={"$set": spieler_data.model_dump(mode="json")},
    )

    return _as_single(updated_raw)


@router.delete(by_id("spieler_id"), response_model=FLSpielerAdminSingleResponse, summary="Retire a Spieler (soft delete)")
async def delete_spieler(
    spieler_id: CustomRouteObjectId,
    spieler_collection: SpielerCollection,
    today: str = Depends(get_german_date_str),
) -> FLSpielerAdminSingleResponse:
    """Retire a player. SOFT: it stamps `inactive_since`, and their squad rows are LEFT ALONE."""

    updated_raw = await set_inactive_since(collection=spieler_collection, db_filter={"_id": spieler_id}, when=today)

    return _as_single(updated_raw)


@router.post(f"{by_id('spieler_id')}/reactivate", response_model=FLSpielerAdminSingleResponse, summary="Bring a retired Spieler back")
async def reactivate_spieler(
    spieler_id: CustomRouteObjectId,
    spieler_collection: SpielerCollection,
) -> FLSpielerAdminSingleResponse:
    """Clear `inactive_since`: the PERSON is back in the league. A squad row they left is revived by its own reactivate."""

    updated_raw = await set_inactive_since(collection=spieler_collection, db_filter={"_id": spieler_id}, when=None)

    return _as_single(updated_raw)


@router.delete(f"{by_id('spieler_id')}/erasure", response_model=FLSpielerErasureResponse, summary="Erase a Spieler (hard delete)")
async def erase_spieler(
    spieler_id: CustomRouteObjectId,
    spieler_collection: SpielerCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLSpielerErasureResponse:
    """
    Erase a player: the person, their squad rows, and their values in the log.

    HARD and refused until retirement (`REQ-PURGE-001`); the soft `DELETE` stays.
    No log row is dropped: images are emptied in place and stamped (`docs/backend/spec.md :: I42`).
    """

    async def erase_the_person_and_their_record(session: AsyncIOMotorClientSession) -> FLSpielerErasureResponse:
        """Judge, then remove both collections and redact the log. Everything judged is read in-session."""

        stored_raw = await pull_one_from_db(
            collection=spieler_collection,
            db_filter={"_id": spieler_id},
            projection=["inactive_since"],
            session=session,
        )
        refuse(find_erasure_refusal(inactive_since=stored_raw.get("inactive_since")))

        # Read BEFORE the removal and unbounded: a log row names a squad row by its own `_id`, which
        # nothing can recover once the row is gone, so a capped read would leave the rows it dropped
        # holding this person's values with no way left to find them.
        squad_rows = await aggregate_many_from_db(
            collection=saison_spieler_collection,
            pipeline=[{"$match": {"spieler_id": spieler_id}}, {"$project": {"_id": 1}}],
            session=session,
        )

        # The squad rows first: the public read `$lookup`s outward from the person, so a row left
        # behind is orphaned invisibly rather than surfacing as a fault somebody would notice.
        erased_rows = await erase_many_from_db(collection=saison_spieler_collection, db_filter={"spieler_id": spieler_id}, session=session)
        await erase_many_from_db(collection=spieler_collection, db_filter={"_id": spieler_id}, session=session)

        # Last, and it passes over the two rows the removals above just recorded: those carry a
        # filter and a count and no `document_id`, so the erasure stays legible as an action.
        redacted = await patch_many_in_db(
            collection=aktionen_collection,
            db_filter=build_redaction_filter(
                # The squad branch is empty where the person held no row, which matches nothing.
                [(Collection.SPIELER, [spieler_id]), (Collection.SAISON_SPIELER, [row["_id"] for row in squad_rows])]
            ),
            update=build_redaction_update(at=log_stamp(germany_now)),
            session=session,
        )

        return FLSpielerErasureResponse(
            spieler_id=spieler_id,
            erased_saison_spieler=erased_rows.deleted_count,
            redacted_aktionen=redacted.modified_count,
        )

    # ONE transaction over all THREE (D83): a person removed while the log still holds their
    # values reports an erasure that did not happen. `with_transaction` over a bare one -- the
    # callback re-reads everything it judges, so a retry is safe.
    async with await db.start_session() as session:
        return await session.with_transaction(erase_the_person_and_their_record)


@router.post(f"{by_id('spieler_id')}/saisons", response_model=FLSaisonSpielerResponse, status_code=201, summary="Add a Spieler to a squad")
async def post_saison_spieler(
    spieler_id: CustomRouteObjectId,
    saison_spieler_data: Annotated[FLPostSaisonSpielerPayload, Body()],
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
) -> FLSaisonSpielerResponse:
    """
    Put a player in a team's squad for a season.

    One row per player per season: moving a player is a PATCH of `team_id`, and a repeat is a 409
    even where the row is retired (`docs/backend/spec.md :: I20`). A squad holds each `rolle` once
    (`REQ-SQUAD-004`).
    """

    # The club has to be in the season, and that fact lives in another collection.
    team_in_saison = (
        await saison_teams_collection.count_documents(
            {"saison_id": saison_spieler_data.saison_id, "team_id": saison_spieler_data.team_id}, limit=1
        )
    ) > 0
    # Asked first: a cap on a squad the club does not have is not a fact worth reporting.
    refuse(find_squad_refusal(team_in_saison=team_in_saison))

    # Count-then-insert, not transactional, as `post_saison_team` is: losing the race costs one
    # player over a planning bound rather than corrupt data, on a single-admin surface.
    await _refuse_a_full_squad(
        saison_spieler_collection=saison_spieler_collection,
        saisons_collection=saisons_collection,
        saison_id=saison_spieler_data.saison_id,
        team_id=saison_spieler_data.team_id,
        spieler_id=spieler_id,
    )

    # Last of the three: a role is the least of a caller's problems where the club is not in the
    # season or the squad has no room.
    await _refuse_a_taken_rolle(
        saison_spieler_collection=saison_spieler_collection,
        saison_id=saison_spieler_data.saison_id,
        team_id=saison_spieler_data.team_id,
        spieler_id=spieler_id,
        rolle=saison_spieler_data.rolle,
    )

    # Stated here rather than through `insert_live`: the echo below reads THIS dict and not the
    # driver's result, so a field the helper added would be missing from the answer.
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
    saisons_collection: SaisonsCollection,
) -> FLSaisonSpielerResponse:
    """
    Update a player's squad entry for that season.

    Changing `team_id` is how a transfer is recorded. A DUPLICATE `nummer` is permitted
    (`fl_backend/app/core/domain.py :: UNENFORCED`); a `rolle` another live row holds is not
    (`REQ-SQUAD-004`).
    """

    # The one fact `find_squad_refusal` decides on, and it lives in another collection.
    team_in_saison = (
        await saison_teams_collection.count_documents({"saison_id": saison_id, "team_id": saison_spieler_data.team_id}, limit=1)
    ) > 0
    refuse(find_squad_refusal(team_in_saison=team_in_saison))

    # The team the payload NAMES, never the one the row currently holds: a transfer is judged
    # against where the player is going.
    await _refuse_a_full_squad(
        saison_spieler_collection=saison_spieler_collection,
        saisons_collection=saisons_collection,
        saison_id=saison_id,
        team_id=saison_spieler_data.team_id,
        spieler_id=spieler_id,
    )

    # Judged against the team the PAYLOAD names, as the cap is: a transfer takes the armband to the
    # squad it is joining.
    await _refuse_a_taken_rolle(
        saison_spieler_collection=saison_spieler_collection,
        saison_id=saison_id,
        team_id=saison_spieler_data.team_id,
        spieler_id=spieler_id,
        rolle=saison_spieler_data.rolle,
    )

    updated_raw = await patch_one_in_db(
        collection=saison_spieler_collection,
        db_filter={"spieler_id": spieler_id, "saison_id": saison_id},
        update={
            "$set": {
                **saison_spieler_data.model_dump(mode="json", exclude={"team_id"}),
                "team_id": saison_spieler_data.team_id,
            }
        },
    )

    return _as_junction(updated_raw)


@router.delete(f"{by_id('spieler_id')}/saisons/{{saison_id}}", response_model=FLSaisonSpielerResponse, summary="Remove a Spieler from a squad")
async def delete_saison_spieler(
    spieler_id: CustomRouteObjectId,
    saison_id: str,
    saison_spieler_collection: SaisonSpielerCollection,
    today: str = Depends(get_german_date_str),
) -> FLSaisonSpielerResponse:
    """
    Take a player out of a season's squad. SOFT: the row stays.

    The row records that this player wore this number in this squad, which stays true after they
    leave. `GET /spieler/memberships` is where an admin reads it back, marked by `inactive_since`.
    """

    updated_raw = await set_inactive_since(
        collection=saison_spieler_collection,
        db_filter={"spieler_id": spieler_id, "saison_id": saison_id},
        when=today,
    )

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
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
) -> FLSaisonSpielerResponse:
    """
    Clear a squad row's `inactive_since`, with the number and position it had.

    Where a repeat create is redirected (`docs/backend/spec.md :: I20`): a create reviving the row
    would overwrite both. Refused where the squad has filled up, where its club left, or where the
    `rolle` the row carries has been given to somebody else since (`REQ-SQUAD-004`).
    """

    # Read for its `team_id` and its `rolle`: the row names the squad it is returning to and the
    # role it comes back holding, and the payload carries neither.
    # A missing row 404s here rather than inside `set_inactive_since`, which would answer the same.
    stored_raw = await pull_one_from_db(
        collection=saison_spieler_collection,
        db_filter={"spieler_id": spieler_id, "saison_id": saison_id},
        projection=["team_id", "rolle"],
    )

    # The STORED club, no payload naming one: `POST /teams/{team_id}/saisons/{saison_id}/replace`
    # hands a junction row to another club and retires this one's squad, so the season it returns
    # to may hold its club no longer.
    team_in_saison = (await saison_teams_collection.count_documents({"saison_id": saison_id, "team_id": stored_raw["team_id"]}, limit=1)) > 0
    # Asked before the cap, as both siblings ask it: a full squad is not a fact worth reporting
    # about a club the season does not hold.
    refuse(find_squad_refusal(team_in_saison=team_in_saison))

    await _refuse_a_full_squad(
        saison_spieler_collection=saison_spieler_collection,
        saisons_collection=saisons_collection,
        saison_id=saison_id,
        team_id=stored_raw["team_id"],
        spieler_id=spieler_id,
    )

    # `.get`, not a subscript: a row stored before the field existed carries no key at all.
    await _refuse_a_taken_rolle(
        saison_spieler_collection=saison_spieler_collection,
        saison_id=saison_id,
        team_id=stored_raw["team_id"],
        spieler_id=spieler_id,
        rolle=stored_raw.get("rolle"),
    )

    updated_raw = await set_inactive_since(
        collection=saison_spieler_collection,
        db_filter={"spieler_id": spieler_id, "saison_id": saison_id},
        when=None,
    )

    return _as_junction(updated_raw)
