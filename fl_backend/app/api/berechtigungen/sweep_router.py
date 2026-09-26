import contextlib
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.berechtigungen.crud import read_berechtigungen, read_the_announced, read_who_changed
from app.api.berechtigungen.schemas import (
    FLBerechtigungAbgleichResponse,
    FLBerechtigungAenderung,
    FLBerechtigungAngekuendigtPayload,
    FLBerechtigungAngekuendigtResponse,
)
from app.api.berechtigungen.services import compare, compose_announced
from app.api.saisons.crud import pull_massgebliche_saison_id
from app.api.sperrliste.crud import gesperrte_hashes
from app.api.sperrliste.services import adresse_hash
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import delete_many_from_db, post_many_to_db
from app.core.dependencies import (
    AktionenCollection,
    BerechtigungenAngekuendigtCollection,
    BerechtigungenCollection,
    DBClient,
    SaisonsCollection,
    SperrlisteCollection,
    get_germany_now,
)
from app.core.exception_handlers import stores_nothing
from app.core.security import bind_system_actor, verify_access_system

# System tier and the system actor, as the application sweep's own router is: the pass holds no
# session, and an out-of-band change has no administrator to attribute its stamp to.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/berechtigungen/abgleich",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)


@router.post(
    "",
    response_model=FLBerechtigungAbgleichResponse,
    summary="Say how the grants differ from what was last announced",
    dependencies=[Depends(stores_nothing)],
)
async def post_berechtigungen_abgleich(
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    aktionen_collection: AktionenCollection,
    sperrliste_collection: SperrlisteCollection,
    saisons_collection: SaisonsCollection,
    config: Annotated[BackendConfig, Depends(get_app_config)],
) -> FLBerechtigungAbgleichResponse:
    """
    Answer every grant whose state differs from what every administrator was last told, and who to tell. Stores nothing.

    A grant added, removed or changed by any route counts, a change made in the database directly included: the comparison is with
    the announced record rather than with the log, so a grant deleted by hand, which leaves nothing behind in `berechtigungen`, is
    still found. Each change carries the administrator whose recorded write made it, or null where no recorded write did -- a
    change made in the database directly, or one older than the log's twelve months. `gesperrt` says whether the address a grant
    now names is on the ban list, which only a change made outside the application can leave true.

    `empfaenger` is every address holding a grant now; a removed address is on none, so it is read off its own change. Nothing is
    marked as told here: the caller mails, then hands back what it announced to `POST /berechtigungen/abgleich/angekuendigt`, so a
    send that failed is found again by the next call. Answers an empty list where nothing changed.
    """

    grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection)
    changes = compare(
        grants=grants, announced=await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection)
    )

    who = await read_who_changed(
        aktionen_collection=aktionen_collection, changes=[(berechtigung_id, art) for berechtigung_id, art, _, _ in changes]
    )

    hashes: dict[str, str] = {}
    for _, _, jetzt, _ in changes:
        # A row typed in by hand may hold an address the address rule refuses, and no ban can key
        # one of those either: it is left unjudged rather than failing the whole pass.
        if jetzt is not None:
            with contextlib.suppress(ValueError):
                hashes[jetzt.adresse] = adresse_hash(jetzt.adresse, schluessel=config.sperrliste_schluessel)
    gesperrt = await gesperrte_hashes(
        sperrliste_collection=sperrliste_collection,
        adresse_hashes=hashes.values(),
        massgebliche_saison_id=await pull_massgebliche_saison_id(saisons_collection=saisons_collection),
    )

    aenderungen: list[FLBerechtigungAenderung] = []
    for berechtigung_id, art, jetzt, vorher in changes:
        row = who.get((berechtigung_id, art))
        aenderungen.append(
            FLBerechtigungAenderung(
                berechtigung_id=berechtigung_id,
                art=art,
                jetzt=jetzt,
                vorher=vorher,
                geaendert_von=None if row is None else str(row["actor"]["email"]),
                geaendert_am=None if row is None else str(row["at"]),
                gesperrt=jetzt is not None and hashes.get(jetzt.adresse) in gesperrt,
            )
        )

    return FLBerechtigungAbgleichResponse(aenderungen=aenderungen, empfaenger=[str(grant["adresse"]) for grant in grants])


@router.post("/angekuendigt", response_model=FLBerechtigungAngekuendigtResponse, summary="Record which grant changes were announced")
async def post_berechtigungen_angekuendigt(
    angekuendigt_data: Annotated[FLBerechtigungAngekuendigtPayload, Body()],
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    db: DBClient,
    now: datetime = Depends(get_germany_now),
) -> FLBerechtigungAngekuendigtResponse:
    """
    Record each change the caller announced as the state it announced, and nothing else.

    Each entry names a grant and the state the mail told everyone of, or null for a removal; the record takes exactly that, whatever
    the grant holds by now, so a change made since is found by the next call to `POST /berechtigungen/abgleich`. Repeating a call
    records the same state again. One transaction, recorded under the system actor, so an announcement of a change made in the
    database directly leaves a log row too. `angekuendigt` is how many entries were recorded.
    """

    ids = [ankuendigung.berechtigung_id for ankuendigung in angekuendigt_data.aenderungen]
    documents = compose_announced(ankuendigungen=angekuendigt_data.aenderungen, now=now)

    async def stamp(session: AsyncClientSession) -> None:
        """Remove each named grant's announced row, then insert what was announced, on this transaction's session.

        Not an update: a repeated stamp lands the same rows, and the log keeps each replaced row's image.
        """

        await delete_many_from_db(collection=berechtigungen_angekuendigt_collection, db_filter={"_id": {"$in": ids}}, session=session)
        if documents:
            await post_many_to_db(collection=berechtigungen_angekuendigt_collection, documents=documents, session=session)

    async with db.start_session() as session:
        await session.with_transaction(stamp)

    return FLBerechtigungAngekuendigtResponse(angekuendigt=len(angekuendigt_data.aenderungen))
