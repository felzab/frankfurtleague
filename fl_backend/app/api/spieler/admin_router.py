import asyncio
from typing import Annotated, Final

from fastapi import APIRouter, Body, Depends, status
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.grants.guard import verify_actor_is_admin
from app.api.saisons.schemas import FLSaisonRules
from app.api.spieler.crud import (
    refuse_a_full_squad,
    refuse_a_taken_rolle,
)
from app.api.spieler.schemas import (
    FLPatchSpielerSaisonPayload,
    FLPatchSpielerSaisonResponse,
    FLSpielerAdminListResponse,
    FLSpielerAdminRow,
    FLSpielerSaisonAdminResponse,
    FLSpielerSaisonKader,
    FLSpielerSaisonPerson,
)
from app.api.spieler.services import (
    build_held_rollen_filter,
    build_kader_pipeline,
    find_kader_stufe_refusal,
    find_squad_refusal,
    mark_shared_nummern,
)
from app.api.teams.crud import pull_saison_team_names
from app.core.config import API_VERSION
from app.core.crud import (
    GERMAN_COLLATION,
    VERSION_FIELD,
    aggregate_many_from_db,
    composite_version,
    find_stale_save_refusal,
    patch_one_in_db,
    pull_many_from_db,
    pull_one_from_db,
    refuse,
    set_inactive_since,
)
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonSpielerReadCollection,
    SaisonsReadCollection,
    SaisonTeamsCollection,
    SaisonTeamsReadCollection,
    SpielerCollection,
    SpielerReadCollection,
    get_german_date_str,
)
from app.core.recording import record_act
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieler",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


# What the editor's one save replaces on each of its two documents.
PERSON_SAVE_FIELDS: Final = ("first_name", "last_name", "birth_date")
ROW_SAVE_FIELDS: Final = ("nummer", "position", "stufe", "rolle")


# Two static segments, matching `GET /saisons/list/admin`.
@router.get("/list/admin", response_model=FLSpielerAdminListResponse, summary="One Saison's squad rows for its list")
async def get_spieler_admin(
    saison_id: str,
    saison_spieler_collection: SaisonSpielerReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    saisons_collection: SaisonsReadCollection,
) -> FLSpielerAdminListResponse:
    """
    The Spieler page in one read: every squad row of the season, live and ausgetragen alike, each named and with its club.

    Read whole, as every list but the Protokoll is, the page narrowing what it holds. `nummer_double` marks a live row
    whose number another live row of its own squad wears, compared as stored. 404 where no season holds that id.
    """

    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])
    rows, team_names = await asyncio.gather(
        aggregate_many_from_db(
            collection=saison_spieler_collection, pipeline=build_kader_pipeline(saison_id=saison_id, team_id=None), collation=GERMAN_COLLATION
        ),
        pull_saison_team_names(saison_teams_collection=saison_teams_collection, saison_id=saison_id),
    )

    return FLSpielerAdminListResponse(
        spieler=[FLSpielerAdminRow.model_validate({**row, "team_name": team_names.get(row["team_id"])}) for row in mark_shared_nummern(rows)]
    )


@router.get(
    f"{by_id('spieler_id')}/saisons/{{saison_id}}/admin",
    response_model=FLSpielerSaisonAdminResponse,
    summary="What the Spieler editor shows, in one read",
)
async def get_spieler_saison(
    spieler_id: CustomRouteObjectId,
    saison_id: str,
    spieler_collection: SpielerReadCollection,
    saison_spieler_collection: SaisonSpielerReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    saisons_collection: SaisonsReadCollection,
) -> FLSpielerSaisonAdminResponse:
    """
    Return what the Spieler editor shows in one read: the person, their squad row of the season, and what its boxes offer.

    `version` is what the one save sends. `allowed_stufen` is what the season's rules offer, `taken_rollen` each role
    another live row of the squad holds. Read outside a transaction: a write landing under this read is judged by its own
    write. 404 where no person, no season or no squad row of the person in that season holds those ids: the page stands
    under a season, and a person out of its squad is no row of that season's list.
    """

    person_raw, row_raw, saison_raw = await asyncio.gather(
        pull_one_from_db(collection=spieler_collection, db_filter={"_id": spieler_id}),
        pull_one_from_db(collection=saison_spieler_collection, db_filter={"spieler_id": spieler_id, "saison_id": saison_id}),
        pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["rules"]),
    )
    team_id = row_raw["team_id"]
    held, club = await asyncio.gather(
        pull_many_from_db(
            collection=saison_spieler_collection,
            db_filter=build_held_rollen_filter(saison_id=saison_id, team_id=team_id, excluding_spieler_id=spieler_id),
            projection=["rolle"],
        ),
        # `find_one`: a club a replacement took out of the season holds no row, and this page still opens.
        saison_teams_collection.find_one({"saison_id": saison_id, "team_id": team_id}, ["name"]),
    )

    return FLSpielerSaisonAdminResponse(
        version=composite_version(person_raw, row_raw),
        person=FLSpielerSaisonPerson.model_validate(person_raw),
        kader=FLSpielerSaisonKader.model_validate({**row_raw, "team_name": (club or {}).get("name")}),
        allowed_stufen=FLSaisonRules.model_validate(saison_raw["rules"]).allowed_stufen,
        taken_rollen=[row["rolle"] for row in held],
    )


@router.patch(
    f"{by_id('spieler_id')}/saisons/{{saison_id}}/admin",
    response_model=FLPatchSpielerSaisonResponse,
    summary="Save the Spieler editor: the person and their squad row of the season, in one transaction",
)
async def patch_spieler_saison(
    spieler_id: CustomRouteObjectId,
    saison_id: str,
    spieler_data: Annotated[FLPatchSpielerSaisonPayload, Body()],
    spieler_collection: SpielerCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
) -> FLPatchSpielerSaisonResponse:
    """
    Save the Spieler editor's one version: the person's own facts and their squad row of the season.

    The team stays the stored row's: no player moves between teams. Refused `version_stale` once the person or the row has
    moved since the editor read them, whichever it was; `kader_stufe_not_allowed` for a `stufe` the season's rules do not
    offer unless the row already holds it; `kader_rolle_taken` for a `rolle` another live row of the squad holds. A shared
    `nummer` is permitted (`docs/domain.md`'s what the model permits on purpose). 404 where the person holds no row of the
    season. No fan-out: unlike a team or a venue, a person is embedded in no other document.
    """

    person_filter = {"_id": spieler_id}
    row_filter = {"spieler_id": spieler_id, "saison_id": saison_id}
    person_part = spieler_data.model_dump(mode="json", include=set(PERSON_SAVE_FIELDS))
    row_part = spieler_data.model_dump(mode="json", include=set(ROW_SAVE_FIELDS))

    async def save_the_person_and_their_row(session: AsyncClientSession) -> FLPatchSpielerSaisonResponse:
        """Judge both parts, then write what moved. Everything judged is read in-session, so a retry re-judges it."""

        person_raw = await pull_one_from_db(
            collection=spieler_collection, db_filter=person_filter, projection=[*PERSON_SAVE_FIELDS, VERSION_FIELD], session=session
        )
        row_raw = await pull_one_from_db(
            collection=saison_spieler_collection,
            db_filter=row_filter,
            projection=["team_id", *ROW_SAVE_FIELDS, VERSION_FIELD],
            session=session,
        )
        refuse(find_stale_save_refusal(person_raw, row_raw, version=spieler_data.version))

        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["rules"], session=session)
        refuse(
            find_kader_stufe_refusal(
                stufe=spieler_data.stufe,
                stored_stufe=row_raw.get("stufe"),
                allowed_stufen=FLSaisonRules.model_validate(saison_raw["rules"]).allowed_stufen,
            )
        )
        await refuse_a_taken_rolle(
            saison_spieler_collection=saison_spieler_collection,
            saisons_collection=saisons_collection,
            saison_id=saison_id,
            team_id=row_raw["team_id"],
            spieler_id=spieler_id,
            rolle=spieler_data.rolle,
            session=session,
        )

        # A part left as stored is not written. The sum above judged both, on reads this transaction's writes conflict with.
        if any(person_raw.get(field) != value for field, value in person_part.items()):
            person_raw = await patch_one_in_db(
                collection=spieler_collection,
                db_filter=person_filter,
                update={"$set": person_part},
                expected_version=None,
                session=session,
                return_document=ReturnDocument.AFTER,
            )
        if any(row_raw.get(field) != value for field, value in row_part.items()):
            row_raw = await patch_one_in_db(
                collection=saison_spieler_collection,
                db_filter=row_filter,
                update={"$set": row_part},
                expected_version=None,
                session=session,
                return_document=ReturnDocument.AFTER,
            )
        await record_act(collection=saison_spieler_collection, action="spieler.changed", record_id=spieler_id, label=saison_id, session=session)

        return FLPatchSpielerSaisonResponse(version=composite_version(person_raw, row_raw))

    # One transaction, or a refusal of the row's part leaves the person's half saved under an editor reading it as failed.
    # `with_transaction` is safe to retry, every write deriving from the payload and an in-session read.
    async with transaction_session(db) as session:
        return await session.with_transaction(save_the_person_and_their_row)


@router.delete(
    f"{by_id('spieler_id')}/saisons/{{saison_id}}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a Spieler from a squad",
)
async def delete_saison_spieler(
    spieler_id: CustomRouteObjectId,
    saison_id: str,
    saison_spieler_collection: SaisonSpielerCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> None:
    """
    Take a player out of a season's squad. SOFT: the row stays.

    The row records that this player wore this number in this squad, which stays true after they
    leave. `GET /spieler/list/admin` is where an admin reads it back, marked by `inactive_since`.
    """

    async def take_the_player_out(session: AsyncClientSession) -> None:
        deregistered = await set_inactive_since(
            collection=saison_spieler_collection,
            db_filter={"spieler_id": spieler_id, "saison_id": saison_id},
            when=today,
            session=session,
        )
        if deregistered is not None:
            await record_act(
                collection=saison_spieler_collection, action="spieler.deregistered", record_id=spieler_id, label=saison_id, session=session
            )

    async with transaction_session(db) as session:
        await session.with_transaction(take_the_player_out)


@router.post(
    f"{by_id('spieler_id')}/saisons/{{saison_id}}/reactivate",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Put a Spieler back in a squad they left",
)
async def reactivate_saison_spieler(
    spieler_id: CustomRouteObjectId,
    saison_id: str,
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
) -> None:
    """
    Clear a squad row's `inactive_since`, with the number and position it had.

    Refused where the squad has filled up, a nominee's row standing outside that cap, where its club
    left, or where the `rolle` the row carries has been given to somebody else since (`kader_rolle_taken`).
    """

    async def bring_the_player_back(session: AsyncClientSession) -> None:
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

        revived = await set_inactive_since(
            collection=saison_spieler_collection,
            db_filter={"spieler_id": spieler_id, "saison_id": saison_id},
            when=None,
            session=session,
        )
        if revived is not None:
            await record_act(
                collection=saison_spieler_collection, action="spieler.reactivated", record_id=spieler_id, label=saison_id, session=session
            )

    async with transaction_session(db) as session:
        await session.with_transaction(bring_the_player_back)
