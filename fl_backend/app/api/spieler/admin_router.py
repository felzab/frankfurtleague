from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.saisons.cache import dropping_the_saison_cache
from app.api.saisons.schemas import FLSaisonRules
from app.api.spieler.schemas import (
    FLPatchSaisonSpielerPayload,
    FLPatchSpielerPayload,
    FLPostSaisonSpielerPayload,
    FLSaisonSpielerResponse,
    FLSpielerAdminSingleResponse,
    FLSpielerErasureResponse,
    FLSpielerMembershipsResponse,
    FLSpielerNachnominierungResponse,
    FLSpielerRolle,
    FLSpielerWithMemberships,
)
from app.api.spieler.services import (
    build_live_rolle_filter,
    build_live_squad_filter,
    build_spieler_memberships_pipeline,
    find_erasure_refusal,
    find_squad_capacity_refusal,
    find_squad_refusal,
    find_squad_rolle_refusal,
)
from app.api.spieltage.crud import nachnominierung_laeuft_in
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import (
    GERMAN_COLLATION,
    aggregate_many_from_db,
    erase_many_from_db,
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
    SpieltageCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, DUPLICATE_KEY_RESPONSE
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
        # A fall-back rather than a subscript, here and on `rolle`: a row missing the key would
        # KeyError on a request that changed nothing. The old spelling is read while rows written
        # under it survive (`docs/backend/spec.md :: I302`).
        ist_nachnominiert=document.get("ist_nachnominiert", document.get("is_nachgetragen", False)),
        # `rolle` is on no stored row that predates it, and `python -m app.core.constraints --check` finds one.
        rolle=document.get("rolle"),
        inactive_since=document.get("inactive_since"),
    )


async def _refuse_a_full_squad(
    *,
    saison_spieler_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    saison_id: str,
    team_id: CustomObjectId,
    spieler_id: CustomObjectId,
    # REQUIRED: the anchor below is what closes the race, so forgetting the session has to be a
    # TypeError at the call rather than a silent reopening of it.
    session: AsyncClientSession,
) -> None:
    """Refuse `REQ-SQUAD-003` when this team's squad for this season is already at the season's cap.

    Shared by create, transfer and reactivate: the cap is a property of the DESTINATION squad, not
    of the verb.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["rules"], session=session)

    # A count is a read, which a snapshot re-validates nowhere, so two writers pass one figure
    # unless something puts them in one write set.

    # `patch_many_in_db`, not `patch_one_in_db`: this lands on every squad write, and that helper
    # would log a whole season pre-image each time where this one logs a filter and a count.
    await patch_many_in_db(
        collection=saisons_collection,
        db_filter={"_id": saison_id},
        update={"$inc": {"bounded_writes": 1}},
        session=session,
    )

    squad_size = await saison_spieler_collection.count_documents(
        build_live_squad_filter(saison_id=saison_id, team_id=team_id, excluding_spieler_id=spieler_id), session=session
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
    saison_spieler_collection: AsyncCollection,
    saison_id: str,
    team_id: CustomObjectId,
    spieler_id: CustomObjectId,
    rolle: FLSpielerRolle | None,
    session: AsyncClientSession,
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
            session=session,
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


@router.get(
    "/nachnominierung/{saison_id}",
    response_model=FLSpielerNachnominierungResponse,
    summary="Whether a squad entry into a season today is a Nachnominierung",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
async def get_spieler_nachnominierung(
    saison_id: str,
    saisons_collection: SaisonsCollection,
    spieltage_collection: SpieltageCollection,
    today: str = Depends(get_german_date_str),
) -> FLSpielerNachnominierungResponse:
    """
    Whether a player entered into this season's squads today would be marked a Nachnominierung.

    `POST /spieler/{spieler_id}/saisons` derives the stored marker from this same test: from the first
    day of matchday 1 of the season's first phase. A season whose matchday 1 is undated, or which
    holds none yet, answers `false`. 404 where no season has this id.
    """

    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])

    return FLSpielerNachnominierungResponse(
        saison_id=saison_id,
        nachnominierung=await nachnominierung_laeuft_in(
            spieltage_collection=spieltage_collection, saison_id=saison_id, today=today, session=None
        ),
    )


@router.patch(
    by_id("spieler_id"),
    response_model=FLSpielerAdminSingleResponse,
    summary="Update a Spieler's name",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
async def patch_spieler(
    spieler_id: CustomRouteObjectId,
    spieler_data: Annotated[FLPatchSpielerPayload, Body()],
    spieler_collection: SpielerCollection,
) -> FLSpielerAdminSingleResponse:
    """Replace a player's own facts wholesale. No fan-out: unlike a team or a venue, a person is embedded in no other document."""

    updated_raw = await patch_one_in_db(
        collection=spieler_collection,
        db_filter={"_id": spieler_id},
        update={"$set": spieler_data.model_dump(mode="json")},
        return_document=ReturnDocument.AFTER,
    )

    return _as_single(updated_raw)


@router.delete(
    by_id("spieler_id"),
    response_model=FLSpielerAdminSingleResponse,
    summary="Retire a Spieler (soft delete)",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
async def delete_spieler(
    spieler_id: CustomRouteObjectId,
    spieler_collection: SpielerCollection,
    today: str = Depends(get_german_date_str),
) -> FLSpielerAdminSingleResponse:
    """Retire a player. SOFT: it stamps `inactive_since`, and their squad rows are LEFT ALONE."""

    updated_raw = await set_inactive_since(collection=spieler_collection, db_filter={"_id": spieler_id}, when=today)

    return _as_single(updated_raw)


@router.post(
    f"{by_id('spieler_id')}/reactivate",
    response_model=FLSpielerAdminSingleResponse,
    summary="Bring a retired Spieler back",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
async def reactivate_spieler(
    spieler_id: CustomRouteObjectId,
    spieler_collection: SpielerCollection,
) -> FLSpielerAdminSingleResponse:
    """Clear `inactive_since`: the PERSON is back in the league. A squad row they left is revived by its own reactivate."""

    updated_raw = await set_inactive_since(collection=spieler_collection, db_filter={"_id": spieler_id}, when=None)

    return _as_single(updated_raw)


@router.delete(
    f"{by_id('spieler_id')}/erasure",
    response_model=FLSpielerErasureResponse,
    summary="Erase a Spieler (hard delete)",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
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

    async def erase_the_person_and_their_record(session: AsyncClientSession) -> FLSpielerErasureResponse:
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

    # ONE transaction over all THREE (`docs/backend/spec.md :: I42`): a person removed while the log
    # still holds their values reports an erasure that did not happen.
    async with db.start_session() as session:
        # `with_transaction` over a bare one -- the callback re-reads everything it judges, so a
        # retry is safe.
        return await session.with_transaction(erase_the_person_and_their_record)


@router.post(
    f"{by_id('spieler_id')}/saisons",
    response_model=FLSaisonSpielerResponse,
    status_code=201,
    summary="Add a Spieler to a squad",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
)
async def post_saison_spieler(
    spieler_id: CustomRouteObjectId,
    saison_spieler_data: Annotated[FLPostSaisonSpielerPayload, Body()],
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spieltage_collection: SpieltageCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSaisonSpielerResponse:
    """
    Put a player in a team's squad for a season.

    One row per player per season: moving a player is a PATCH of `team_id`, and a repeat is a 409
    even where the row is retired (`docs/backend/spec.md :: I20`). A squad holds each `rolle` once
    (`REQ-SQUAD-004`). `ist_nachnominiert` is derived here and never taken from the body: it is true
    from the first day of the season's matchday 1, and false while that matchday is undated.
    """

    async def add_the_player(session: AsyncClientSession) -> dict[str, Any]:
        """Judge, then write the row. Everything judged is read in-session, the squad's own count inside `_refuse_a_full_squad`."""

        # The club has to be in the season, and that fact lives in another collection.
        team_in_saison = (
            await saison_teams_collection.count_documents(
                {"saison_id": saison_spieler_data.saison_id, "team_id": saison_spieler_data.team_id}, limit=1, session=session
            )
        ) > 0
        # Asked first: a cap on a squad the club does not have is not a fact worth reporting.
        refuse(find_squad_refusal(team_in_saison=team_in_saison))

        await _refuse_a_full_squad(
            saison_spieler_collection=saison_spieler_collection,
            saisons_collection=saisons_collection,
            saison_id=saison_spieler_data.saison_id,
            team_id=saison_spieler_data.team_id,
            spieler_id=spieler_id,
            session=session,
        )

        # Last of the three: a role is the least of a caller's problems where the club is not in the
        # season or the squad has no room.
        await _refuse_a_taken_rolle(
            saison_spieler_collection=saison_spieler_collection,
            saison_id=saison_spieler_data.saison_id,
            team_id=saison_spieler_data.team_id,
            spieler_id=spieler_id,
            rolle=saison_spieler_data.rolle,
            session=session,
        )

        # Stated here rather than through `insert_live`: the echo below reads THIS dict and not the
        # driver's result, so a field the helper added would be missing from the answer.
        document = {
            "spieler_id": spieler_id,
            **saison_spieler_data.model_dump(mode="json", exclude={"team_id"}),
            "team_id": saison_spieler_data.team_id,
            "ist_nachnominiert": await nachnominierung_laeuft_in(
                spieltage_collection=spieltage_collection, saison_id=saison_spieler_data.saison_id, today=today, session=session
            ),
            "inactive_since": None,
        }
        await post_one_to_db(collection=saison_spieler_collection, document=document, session=session)

        return document

    # Whatever field the refusal helper's own write moved: every season write drops the cache
    # (`docs/backend/spec.md :: I131`).
    with dropping_the_saison_cache():
        # One transaction over the row and the season write inside `_refuse_a_full_squad`, which is what
        # makes two writers into one squad contend, and a re-date of matchday 1 contend with the marker
        # (`app/api/spieltage/admin_router.py :: _refuse_an_out_of_order_beginn` writes the same season).
        async with db.start_session() as session:
            entered = await session.with_transaction(add_the_player)

    return _as_junction(entered)


@router.patch(
    f"{by_id('spieler_id')}/saisons/{{saison_id}}",
    response_model=FLSaisonSpielerResponse,
    summary="Update a squad entry",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
)
async def patch_saison_spieler(
    spieler_id: CustomRouteObjectId,
    saison_id: str,
    saison_spieler_data: Annotated[FLPatchSaisonSpielerPayload, Body()],
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
) -> FLSaisonSpielerResponse:
    """
    Update a player's squad entry for that season.

    Changing `team_id` is how a transfer is recorded. A DUPLICATE `nummer` is permitted
    (`fl_backend/app/core/domain.py :: UNENFORCED`); a `rolle` another live row holds is not
    (`REQ-SQUAD-004`).
    """

    async def move_the_player(session: AsyncClientSession) -> Mapping[str, Any]:
        """Judge, then rewrite the row. Everything judged is read in-session."""

        # The one fact `find_squad_refusal` decides on, and it lives in another collection.
        team_in_saison = (
            await saison_teams_collection.count_documents(
                {"saison_id": saison_id, "team_id": saison_spieler_data.team_id}, limit=1, session=session
            )
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
            session=session,
        )

        # Judged against the team the PAYLOAD names, as the cap is: a transfer takes the armband to
        # the squad it is joining.
        await _refuse_a_taken_rolle(
            saison_spieler_collection=saison_spieler_collection,
            saison_id=saison_id,
            team_id=saison_spieler_data.team_id,
            spieler_id=spieler_id,
            rolle=saison_spieler_data.rolle,
            session=session,
        )

        return await patch_one_in_db(
            collection=saison_spieler_collection,
            db_filter={"spieler_id": spieler_id, "saison_id": saison_id},
            update={
                "$set": {
                    **saison_spieler_data.model_dump(mode="json", exclude={"team_id"}),
                    "team_id": saison_spieler_data.team_id,
                }
            },
            session=session,
            return_document=ReturnDocument.AFTER,
        )

    # Whatever field the refusal helper's own write moved: every season write drops the cache
    # (`docs/backend/spec.md :: I131`).
    with dropping_the_saison_cache():
        async with db.start_session() as session:
            moved = await session.with_transaction(move_the_player)

    return _as_junction(moved)


@router.delete(
    f"{by_id('spieler_id')}/saisons/{{saison_id}}",
    response_model=FLSaisonSpielerResponse,
    summary="Remove a Spieler from a squad",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
)
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
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
)
async def reactivate_saison_spieler(
    spieler_id: CustomRouteObjectId,
    saison_id: str,
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
) -> FLSaisonSpielerResponse:
    """
    Clear a squad row's `inactive_since`, with the number and position it had.

    Where a repeat create is redirected (`docs/backend/spec.md :: I20`): a create reviving the row
    would overwrite both. Refused where the squad has filled up, where its club left, or where the
    `rolle` the row carries has been given to somebody else since (`REQ-SQUAD-004`).
    """

    async def bring_the_player_back(session: AsyncClientSession) -> Mapping[str, Any]:
        """Judge, then revive the row. Everything judged is read in-session."""

        # Read for its `team_id` and its `rolle`: the row names the squad it is returning to and the
        # role it comes back holding, and the payload carries neither.
        # A missing row 404s here rather than inside `set_inactive_since`, which would answer the same.
        stored_raw = await pull_one_from_db(
            collection=saison_spieler_collection,
            db_filter={"spieler_id": spieler_id, "saison_id": saison_id},
            projection=["team_id", "rolle"],
            session=session,
        )

        # The STORED club, no payload naming one: `POST /teams/{team_id}/saisons/{saison_id}/replace`
        # hands a junction row to another club and retires this one's squad, so the club this row
        # returns to may stand outside that season by now.
        team_in_saison = (
            await saison_teams_collection.count_documents({"saison_id": saison_id, "team_id": stored_raw["team_id"]}, limit=1, session=session)
        ) > 0
        # Asked before the cap, as both siblings ask it: a full squad is not a fact worth reporting
        # about a club the season does not hold.
        refuse(find_squad_refusal(team_in_saison=team_in_saison))

        await _refuse_a_full_squad(
            saison_spieler_collection=saison_spieler_collection,
            saisons_collection=saisons_collection,
            saison_id=saison_id,
            team_id=stored_raw["team_id"],
            spieler_id=spieler_id,
            session=session,
        )

        # `.get`, not a subscript: a row stored before the field existed carries no key at all.
        await _refuse_a_taken_rolle(
            saison_spieler_collection=saison_spieler_collection,
            saison_id=saison_id,
            team_id=stored_raw["team_id"],
            spieler_id=spieler_id,
            rolle=stored_raw.get("rolle"),
            session=session,
        )

        return await set_inactive_since(
            collection=saison_spieler_collection,
            db_filter={"spieler_id": spieler_id, "saison_id": saison_id},
            when=None,
            session=session,
        )

    # Whatever field the refusal helper's own write moved: every season write drops the cache
    # (`docs/backend/spec.md :: I131`).
    with dropping_the_saison_cache():
        async with db.start_session() as session:
            revived = await session.with_transaction(bring_the_player_back)

    return _as_junction(revived)
