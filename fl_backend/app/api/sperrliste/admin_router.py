from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.results import InsertOneResult

from app.api.saisons.cache import dropping_the_saison_cache
from app.api.saisons.crud import pull_massgebliche_saison_id
from app.api.sperrliste.crud import address_is_gesperrt, read_sperrliste_page
from app.api.sperrliste.schemas import (
    FLPostSperrlistePayload,
    FLPostSperrlisteResponse,
    FLSperrlisteEintrag,
    FLSperrlisteListResponse,
    FLSperrlisteWriteResponse,
)
from app.api.sperrliste.services import (
    SPERRLISTE_SCHLUESSEL_VERSION,
    adresse_hash,
    compose_gesperrt_bis_saison_id,
    find_keine_saison_refusal,
    find_sperrliste_refusal,
)
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import delete_many_from_db, patch_many_in_db, post_one_to_db, pull_one_from_db, refuse
from app.core.dependencies import DBClient, SaisonsCollection, SperrlisteCollection, get_german_date_str
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, DUPLICATE_KEY_RESPONSE
from app.core.routing import by_id
from app.core.security import bind_actor, get_actor_email, verify_access_admin, verify_actor_is_admin
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/sperrliste",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


async def _pull_the_season_a_ban_counts_from(
    *,
    saisons_collection: AsyncCollection,
    # REQUIRED: the anchor below is what closes the race, so forgetting the session has to be a
    # TypeError at the call rather than a silent reopening of it.
    session: AsyncClientSession,
) -> str:
    """The season a ban's `SPERRE_DAUER_SAISONS` are counted from, refused `REQ-SPERRLISTE-002` while no season is running."""

    # Through the session: the rollover moves the season and sweeps the lapsed bans in one
    # transaction, and a season read outside this snapshot counts a ban one season short against
    # a list already swept (`docs/backend/spec.md :: I273`).
    massgebliche_saison_id = await pull_massgebliche_saison_id(saisons_collection=saisons_collection, session=session)
    refuse(find_keine_saison_refusal(massgebliche_saison_id=massgebliche_saison_id))

    # The rollover demotes this season, and its sweep cannot see a row inserted after its snapshot:
    # without this write both commit, and a bound the sweep never judged stands past its season
    # (`docs/backend/spec.md :: I274`).
    await patch_many_in_db(
        collection=saisons_collection,
        db_filter={"_id": massgebliche_saison_id},
        update={"$inc": {"bounded_writes": 1}},
        session=session,
    )

    # `str` past the refusal, as the re-send's own hashing is past `find_missing_address_refusal`:
    # the composer refuses the spelling `None` would take rather than storing a bound off it.
    return str(massgebliche_saison_id)


@router.get("", response_model=FLSperrlisteListResponse, summary="List the banned addresses")
async def get_sperrliste(sperrliste_collection: SperrlisteCollection) -> FLSperrlisteListResponse:
    """
    List the bans, newest first: why each was entered, by whom and on which day, with how many the list holds.

    No address of the person a ban bars, and nothing one can be recovered from: a row stores a keyed
    hash of it and the read projects that away. `erstellt_von` is the administrator who entered the
    row, and is an address. **The rows are capped at `LIST_LIMIT_DEFAULT` and there is no paging control**,
    so where `anzahl_gesamt` exceeds the rows served, bans are enforced that this answer does not
    show — and a ban nobody can see is one nobody can lift.
    """

    rows, anzahl_gesamt = await read_sperrliste_page(sperrliste_collection=sperrliste_collection, limit=LIST_LIMIT_DEFAULT)

    return FLSperrlisteListResponse(
        sperrliste=[FLSperrlisteEintrag.model_validate(row) for row in rows],
        anzahl_gesamt=anzahl_gesamt,
    )


@router.post(
    "", response_model=FLPostSperrlisteResponse, status_code=201, summary="Ban an email address", responses={409: DUPLICATE_KEY_RESPONSE}
)
async def post_sperrliste_eintrag(
    sperrliste_data: Annotated[FLPostSperrlistePayload, Body()],
    sperrliste_collection: SperrlisteCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    erstellt_von: str = Depends(get_actor_email),
    today: str = Depends(get_german_date_str),
) -> FLPostSperrlisteResponse:
    """
    Ban an address from signing up. The address is hashed under the backend key and dropped; no row and no log line holds it.

    Refused where the list already holds the address (`REQ-SPERRLISTE-001`), and while no season is
    running, there being nothing to count the ban's five seasons from
    (`REQ-SPERRLISTE-002`). The ban covers the fifth season after the one running now — the last one
    it covers is answered as `gesperrt_bis_saison_id` — and it survives that person's erasure.
    """

    gehasht = adresse_hash(str(sperrliste_data.email), schluessel=config.sperrliste_schluessel)

    async def judge_and_ban(session: AsyncClientSession) -> tuple[InsertOneResult, str]:
        """Read the season, ask the list, then write into it. Each is handed this transaction's session, so a retry re-runs all three."""

        massgebliche_saison_id = await _pull_the_season_a_ban_counts_from(saisons_collection=saisons_collection, session=session)
        gesperrt_bis_saison_id = compose_gesperrt_bis_saison_id(massgebliche_saison_id=massgebliche_saison_id)

        gesperrt = await address_is_gesperrt(
            sperrliste_collection=sperrliste_collection,
            adresse_hash=gehasht,
            massgebliche_saison_id=massgebliche_saison_id,
            session=session,
        )
        refuse(find_sperrliste_refusal(gesperrt=gesperrt))

        document: dict[str, Any] = {
            "adresse_hash": gehasht,
            # Stored beside the hash rather than derived from it: which label a row was keyed under is
            # the one thing that would ever let an operator tell the rows a key cannot match.
            "schluessel_version": SPERRLISTE_SCHLUESSEL_VERSION,
            "grund": sperrliste_data.grund,
            # Read from the bound actor rather than a payload, so this cannot disagree with the
            # `aktionen` row recording the same write.
            "erstellt_von": erstellt_von,
            "erstellt_am": today,
            # INCLUSIVE: the season named here is still barred, and „bis“ alone does not say so.
            "gesperrt_bis_saison_id": gesperrt_bis_saison_id,
        }

        # A LAPSED row for this hash passes the check above and is refused HERE on the index, which
        # reads no bound. No route leaves one: the activation that lapses a ban removes it.
        return await post_one_to_db(collection=sperrliste_collection, document=document, session=session), gesperrt_bis_saison_id

    # Whatever field the anchor's own write moved: every season write drops the cache
    # (`docs/backend/spec.md :: I131`).
    with dropping_the_saison_cache():
        async with db.start_session() as session:
            post_operation, gesperrt_bis_saison_id = await session.with_transaction(judge_and_ban)

    return FLPostSperrlisteResponse(
        acknowledged=1 if post_operation.acknowledged else 0,
        created_id=post_operation.inserted_id,
        gesperrt_bis_saison_id=gesperrt_bis_saison_id,
    )


@router.delete(
    by_id("sperrliste_id"), response_model=FLSperrlisteWriteResponse, summary="Lift a ban", responses={404: DOCUMENT_NOT_FOUND_RESPONSE}
)
async def delete_sperrliste_eintrag(
    sperrliste_id: CustomRouteObjectId,
    sperrliste_collection: SperrlisteCollection,
    db: DBClient,
) -> FLSperrlisteWriteResponse:
    """
    Lift a ban before it lapses, removing the row. HARD, no soft form.

    Nothing reverses it from here: the address a row was taken from cannot be recovered out of the
    hash, so re-entering the ban means being told the address again. 404 where no row holds the id.

    **The action log keeps a copy of the removed row** — the hash, its key label, the reason and the
    administrator who entered it, and no address of the person it barred — for the twelve months
    `docs/backend/spec.md :: I119` gives every stamped log row. The lifted ban is therefore readable
    at `GET /aktionen` for that period and enforced by nothing from the moment this answers.
    """

    async def lift_the_ban(session: AsyncClientSession) -> None:
        """Resolve the row, then remove it. Both in-session, so a retry re-resolves it."""

        # Resolved first so a miss is a 404 before anything is logged: `delete_many_from_db` taking
        # no row is an ordinary empty removal and would answer the caller 200.
        await pull_one_from_db(collection=sperrliste_collection, db_filter={"_id": sperrliste_id}, projection=["_id"], session=session)

        await delete_many_from_db(collection=sperrliste_collection, db_filter={"_id": sperrliste_id}, session=session)

    async with db.start_session() as session:
        await session.with_transaction(lift_the_ban)

    return FLSperrlisteWriteResponse(sperrliste_id=sperrliste_id)
