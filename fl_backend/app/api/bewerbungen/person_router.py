from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.schemas import FLBewerbungAccountEinwilligungResponse
from app.api.identitaet.services import eigene_sitze
from app.api.konto.crud import press_widerruf
from app.api.konto.services import (
    KONTO_SEITE_KONTAKT,
    compose_sitz_move,
    find_eigener_eintrag_refusal,
    geaenderte_sitz_wahlen,
    sitz_wahlen_der_zeile,
    widerruf_line,
)
from app.api.sperrliste.guard import PERSON_ACTOR_BINDERS, KontaktIdentifier
from app.core.collections import Collection
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import patch_one_in_db, refuse
from app.core.dependencies import BewerbungenCollection, DBClient, get_germany_now
from app.core.journal import Journal
from app.core.recording import log_stamp
from app.core.security import erasure_journal_hash, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung_nachweis import FLEinwilligungChoice, nachweis_stand_of
from app.shared.schemas.custom import CustomRouteObjectId
from app.shared.schemas.einwilligung import FLSeatEinwilligungPayload
from app.shared.schemas.literals import KONTAKT_ROLLEN

# The person lane's binder, as `app/api/teams/person_router.py` declares it and for its reason.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/bewerbungen",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["kontakt"])],
)


# `/account/einwilligung`, its own segment, for `app/api/teams/person_router.py :: get_team_sitze`'s reason.
@router.patch(
    "/{bewerbung_id:objectid}/account/einwilligung",
    response_model=FLBewerbungAccountEinwilligungResponse,
    summary="Withdraw a seat holder's own WhatsApp and media consent on a pending Bewerbung",
)
async def patch_einwilligung(
    bewerbung_id: CustomRouteObjectId,
    einwilligung_data: Annotated[FLSeatEinwilligungPayload, Body()],
    identifier: KontaktIdentifier,
    bewerbungen_collection: BewerbungenCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLBewerbungAccountEinwilligungResponse:
    """Withdraw the signed-in person's WhatsApp and media consents on every seat they hold on this pending application.

    A grant is refused. Refuses, writing nothing: `role_not_held`, `wording_not_allowed` (the choices moved since the
    page was served), `giving_not_allowed` and `wording_not_allowed`.
    """

    gedrueckt: dict[FLEinwilligungChoice, object] = {"umfang": einwilligung_data.umfang, "medien": einwilligung_data.medien}
    # For `app/api/spieler/person_router.py :: patch_einwilligung`'s reason: a replay stamps the moment the person pressed.
    am = log_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def write(session: AsyncClientSession) -> FLBewerbungAccountEinwilligungResponse:
        # Pending alone: an accepted application's seats are its season row's, and a declined one is decided.
        bewerbung = await bewerbungen_collection.find_one(
            {"_id": bewerbung_id, "status": "submitted"},
            {f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_ROLLEN for field in ("email", "einwilligung")},
            session=session,
        )
        rollen = [] if bewerbung is None else eigene_sitze(bewerbung, identifier)
        refuse(find_eigener_eintrag_refusal(gehalten=bool(rollen)))
        assert bewerbung is not None
        sitze = {slot: bewerbung["kontakte"][slot] for slot in rollen}
        gewaehlt = geaenderte_sitz_wahlen(bloecke=[sitz["einwilligung"] for sitz in sitze.values()], gedrueckt=gedrueckt)

        # Withdraw-only: nothing on an application grants a panel to answer a grant against.
        await press_widerruf(
            bloecke=[sitz["einwilligung"] for sitz in sitze.values()],
            gewaehlt=gewaehlt,
            nachweis_stand=einwilligung_data.nachweis_stand.model_dump(),
            text_version=einwilligung_data.text_version,
            seite=KONTO_SEITE_KONTAKT,
        )

        update = compose_sitz_move(
            sitze={slot: sitz["einwilligung"] for slot, sitz in sitze.items()},
            gewaehlt=gewaehlt,
            am=am,
            text_version=einwilligung_data.text_version,
        )
        updated = (
            None
            if update is None
            else await patch_one_in_db(
                collection=bewerbungen_collection,
                db_filter={"_id": bewerbung["_id"]},
                update=update,
                session=session,
                return_document=ReturnDocument.AFTER,
            )
        )
        line = widerruf_line(
            person_hash=erasure_journal_hash(identifier, key=config.sperrliste_key),
            collection=Collection.BEWERBUNGEN,
            record_id=bewerbung["_id"],
            bloecke=[sitz["einwilligung"] for sitz in sitze.values()],
            gewaehlt=gewaehlt,
            am=am,
            text_version=einwilligung_data.text_version,
        )
        if line is not None:
            journal.note(line)
        kontakte = bewerbung["kontakte"] if updated is None else updated["kontakte"]
        bloecke = [kontakte[slot]["einwilligung"] for slot in rollen]

        # For `app/api/teams/person_router.py :: patch_einwilligung`'s reason.
        return FLBewerbungAccountEinwilligungResponse.model_validate(
            {
                "bewerbung_id": bewerbung_id,
                "rollen": rollen,
                **sitz_wahlen_der_zeile(bloecke),
                "nachweis_stand": nachweis_stand_of(bloecke=bloecke),
            }
        )

    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(write)
