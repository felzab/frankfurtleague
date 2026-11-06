from collections.abc import Mapping
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.address_change.crud import denied_addresses
from app.api.berechtigungen.guard import verify_actor_is_admin
from app.api.spieler.crud import (
    refuse_a_full_squad,
    refuse_a_taken_rolle,
)
from app.api.spieler.schemas import (
    FLPatchKaderRowPayload,
    FLPatchSpielerPayload,
    FLSaisonSpielerResponse,
    FLSpielerAdminSingleResponse,
    FLSpielerSaisonsResponse,
    FLSpielerWithMemberships,
)
from app.api.spieler.services import (
    build_spieler_filter,
    build_spieler_saisons_pipeline,
    find_squad_refusal,
)
from app.core.config import API_VERSION
from app.core.crud import (
    GERMAN_COLLATION,
    VERSION_FIELD,
    aggregate_many_from_db,
    patch_one_in_db,
    pull_one_from_db,
    refuse,
    set_inactive_since,
)
from app.core.dependencies import (
    DBClient,
    GrantsAnnouncedCollection,
    GrantsCollection,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonTeamsCollection,
    SpielerCollection,
    get_german_date_str,
)
from app.core.routing import by_id
from app.core.security import bind_actor, get_actor_auth_time, get_actor_email, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieler",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


def _as_single(document: Mapping[str, Any]) -> FLSpielerAdminSingleResponse:
    """The admin tier's echo: the surname whole."""

    return FLSpielerAdminSingleResponse(
        spieler_id=document["_id"],
        first_name=document["first_name"],
        last_name=document.get("last_name"),
        version=document.get(VERSION_FIELD, 0),
    )


def _as_junction(document: Mapping[str, Any]) -> FLSaisonSpielerResponse:
    return FLSaisonSpielerResponse(
        spieler_id=document["spieler_id"],
        saison_id=document["saison_id"],
        team_id=document["team_id"],
        nummer=document.get("nummer"),
        position=document.get("position"),
        stufe=document.get("stufe"),
        is_nachnominiert=document["is_nachnominiert"],
        rolle=document["rolle"],
        inactive_since=document.get("inactive_since"),
        version=document.get(VERSION_FIELD, 0),
    )


# A static path beside `by_id` routes: the id convertor takes 24 hex characters, so no id route can
# capture this one whatever the declaration order.
@router.get("/saisons", response_model=FLSpielerSaisonsResponse, summary="Every Spieler with their squad rows")
async def get_spieler_saisons(
    spieler_collection: SpielerCollection,
    grants_collection: GrantsCollection,
    grants_announced_collection: GrantsAnnouncedCollection,
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
) -> FLSpielerSaisonsResponse:
    """
    Every player, each with every squad row they hold.

    A club page's squad cannot answer it: it serves one team's squad in one season, and so never a
    player outside that squad or their other rows.

    `address_change_id` names the live change of the pupil's address, which the address tool shows, and
    `address_change_viewable_denied` why the tool refuses it this administrator, null where it opens it.
    """

    spieler_raw = await aggregate_many_from_db(
        collection=spieler_collection, pipeline=build_spieler_saisons_pipeline(), collation=GERMAN_COLLATION
    )
    denied = await denied_addresses(
        (str(spieler["email"]) for spieler in spieler_raw if spieler.get("address_change_id") is not None),
        actor=sign_in_identifier(operator),
        auth_time=auth_time,
        grants_collection=grants_collection,
        grants_announced_collection=grants_announced_collection,
        session=None,
    )

    return FLSpielerSaisonsResponse(
        spieler=[
            FLSpielerWithMemberships.model_validate({**spieler, "address_change_viewable_denied": denied.get(str(spieler.get("email")))})
            for spieler in spieler_raw
        ]
    )


@router.patch(
    by_id("spieler_id"),
    response_model=FLSpielerAdminSingleResponse,
    summary="Update a Spieler's name",
)
async def patch_spieler(
    spieler_id: CustomRouteObjectId,
    spieler_data: Annotated[FLPatchSpielerPayload, Body()],
    spieler_collection: SpielerCollection,
    db: DBClient,
) -> FLSpielerAdminSingleResponse:
    """Replace a player's own facts wholesale. No fan-out: unlike a team or a venue, a person is embedded in no other document."""

    async def rewrite_the_player(session: AsyncClientSession) -> Mapping[str, Any]:
        return await patch_one_in_db(
            collection=spieler_collection,
            db_filter=build_spieler_filter(spieler_id),
            update={"$set": spieler_data.model_dump(mode="json", exclude={"version"})},
            expected_version=spieler_data.version,
            session=session,
            return_document=ReturnDocument.AFTER,
        )

    async with transaction_session(db) as session:
        updated_raw = await session.with_transaction(rewrite_the_player)

    return _as_single(updated_raw)


@router.patch(
    f"{by_id('spieler_id')}/saisons/{{saison_id}}",
    response_model=FLSaisonSpielerResponse,
    summary="Update a squad entry",
)
async def patch_saison_spieler(
    spieler_id: CustomRouteObjectId,
    saison_id: str,
    saison_spieler_data: Annotated[FLPatchKaderRowPayload, Body()],
    saison_spieler_collection: SaisonSpielerCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
) -> FLSaisonSpielerResponse:
    """
    Update a player's squad entry for that season. The team stays the stored row's: no player moves between teams.

    A DUPLICATE `nummer` is permitted (`docs/domain.md`'s what the model permits on purpose); a `rolle`
    another live row holds is not (`kader_rolle_taken`).
    """

    async def edit_the_row(session: AsyncClientSession) -> Mapping[str, Any]:
        """Judge, then rewrite the row. Everything judged is read in-session."""

        # Read for its `team_id`, the squad the role is judged in; the 404 where the player holds no row in this season.
        stored_raw = await pull_one_from_db(
            collection=saison_spieler_collection,
            db_filter={"spieler_id": spieler_id, "saison_id": saison_id},
            projection=["team_id"],
            session=session,
        )

        await refuse_a_taken_rolle(
            saison_spieler_collection=saison_spieler_collection,
            saisons_collection=saisons_collection,
            saison_id=saison_id,
            team_id=stored_raw["team_id"],
            spieler_id=spieler_id,
            rolle=saison_spieler_data.rolle,
            session=session,
        )

        return await patch_one_in_db(
            collection=saison_spieler_collection,
            db_filter={"spieler_id": spieler_id, "saison_id": saison_id},
            update={"$set": saison_spieler_data.model_dump(mode="json", exclude={"version"})},
            expected_version=saison_spieler_data.version,
            session=session,
            return_document=ReturnDocument.AFTER,
        )

    async with transaction_session(db) as session:
        edited = await session.with_transaction(edit_the_row)

    return _as_junction(edited)


@router.delete(
    f"{by_id('spieler_id')}/saisons/{{saison_id}}",
    response_model=FLSaisonSpielerResponse,
    summary="Remove a Spieler from a squad",
)
async def delete_saison_spieler(
    spieler_id: CustomRouteObjectId,
    saison_id: str,
    saison_spieler_collection: SaisonSpielerCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSaisonSpielerResponse:
    """
    Take a player out of a season's squad. SOFT: the row stays.

    The row records that this player wore this number in this squad, which stays true after they
    leave. `GET /spieler/saisons` is where an admin reads it back, marked by `inactive_since`.
    """

    async def take_the_player_out(session: AsyncClientSession) -> Mapping[str, Any]:
        return await set_inactive_since(
            collection=saison_spieler_collection,
            db_filter={"spieler_id": spieler_id, "saison_id": saison_id},
            when=today,
            session=session,
        )

    async with transaction_session(db) as session:
        updated_raw = await session.with_transaction(take_the_player_out)

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
    db: DBClient,
) -> FLSaisonSpielerResponse:
    """
    Clear a squad row's `inactive_since`, with the number and position it had.

    Refused where the squad has filled up, a nominee's row standing outside that cap, where its club
    left, or where the `rolle` the row carries has been given to somebody else since (`kader_rolle_taken`).
    """

    async def bring_the_player_back(session: AsyncClientSession) -> Mapping[str, Any]:
        """Judge, then revive the row. Everything judged is read in-session."""

        # Read for its `team_id` and its `rolle`: the row names the squad it is returning to and the
        # role it comes back holding, and the payload carries neither.
        # A missing row 404s here rather than inside `set_inactive_since`, which would answer the same.
        stored_raw = await pull_one_from_db(
            collection=saison_spieler_collection,
            db_filter={"spieler_id": spieler_id, "saison_id": saison_id},
            projection=["team_id", "rolle", "is_nachnominiert"],
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

        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["rules"], session=session)
        await refuse_a_full_squad(
            saison_spieler_collection=saison_spieler_collection,
            saisons_collection=saisons_collection,
            saison_id=saison_id,
            rules=saison_raw["rules"],
            team_id=stored_raw["team_id"],
            spieler_id=spieler_id,
            nominee=stored_raw["is_nachnominiert"],
            session=session,
        )

        await refuse_a_taken_rolle(
            saison_spieler_collection=saison_spieler_collection,
            saisons_collection=saisons_collection,
            saison_id=saison_id,
            team_id=stored_raw["team_id"],
            spieler_id=spieler_id,
            rolle=stored_raw["rolle"],
            session=session,
        )

        return await set_inactive_since(
            collection=saison_spieler_collection,
            db_filter={"spieler_id": spieler_id, "saison_id": saison_id},
            when=None,
            session=session,
        )

    async with transaction_session(db) as session:
        revived = await session.with_transaction(bring_the_player_back)

    return _as_junction(revived)
