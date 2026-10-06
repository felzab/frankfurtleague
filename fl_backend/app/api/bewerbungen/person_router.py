from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.schemas import FLBewerbungPersonEinwilligungPayload, FLBewerbungPersonEinwilligungResponse
from app.api.identitaet.services import eigene_sitze
from app.api.konto.crud import press_widerruf
from app.api.konto.services import (
    KONTO_SEITE_KONTAKT,
    compose_sitz_move,
    find_eigener_eintrag_refusal,
    geaenderte_sitz_wahlen,
    sitz_wahlen_der_zeile,
)
from app.api.teams.schemas import KONTAKT_ROLLEN
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, refuse
from app.core.dependencies import BewerbungenCollection, DBClient, get_germany_now
from app.core.recording import log_stamp
from app.core.security import PERSON_ACTOR_BINDERS, KontaktIdentifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung_nachweis import FLEinwilligungWahl, nachweis_stand_of
from app.shared.schemas.custom import CustomRouteObjectId

# The person lane's binder, as `app/api/teams/person_router.py` declares it and for its reason.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/bewerbungen",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["kontakt"])],
)


# `/person/einwilligung`, its own segment, for `app/api/teams/person_router.py :: get_team_sitze`'s reason.
@router.patch(
    "/{bewerbung_id:objectid}/person/einwilligung",
    response_model=FLBewerbungPersonEinwilligungResponse,
    summary="Withdraw a seat holder's own WhatsApp and media consent on a pending Bewerbung",
)
async def patch_einwilligung(
    bewerbung_id: CustomRouteObjectId,
    einwilligung_data: Annotated[FLBewerbungPersonEinwilligungPayload, Body()],
    identifier: KontaktIdentifier,
    bewerbungen_collection: BewerbungenCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLBewerbungPersonEinwilligungResponse:
    """
    Withdraw the signed-in person's WhatsApp and media consents on every seat they hold on this pending application.

    WITHDRAW-ONLY: the season seat's payload, a grant of either choice being the confirmation page's alone; the
    account page offers it so taking a consent back is as easy as giving it was (Art. 7(3) DSGVO). One answer for
    every seat the person holds there, each choice moving only where it differs from the application as the page
    served it; no other seat, field or document is written, and a press moving no seat writes nothing. Nothing is
    counted against the person's ceiling.

    Refuses, in this order: an application that is decided or holds no confirmed seat of the address
    (`REQ-FUNKTION-001`); a `nachweis_stand` other than the held seats' own, either choice having moved since the
    page was served (`REQ-EINWILLIGUNG-003`); a grant of either choice (`REQ-EINWILLIGUNG-004`); and a `text_version`
    naming no version of the account page's seat control (`REQ-EINWILLIGUNG-001`). Each refusal writes nothing.
    """

    gedrueckt: dict[FLEinwilligungWahl, object] = {"umfang": einwilligung_data.umfang, "medien": einwilligung_data.medien}

    async def write(session: AsyncClientSession) -> FLBewerbungPersonEinwilligungResponse:
        # Pending alone: an accepted application's seats are its season row's, and a declined one is decided.
        bewerbung = await bewerbungen_collection.find_one(
            {"_id": bewerbung_id, "status": "eingereicht"},
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
            am=log_stamp(germany_now),
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
        kontakte = bewerbung["kontakte"] if updated is None else updated["kontakte"]
        bloecke = [kontakte[slot]["einwilligung"] for slot in rollen]

        # For `app/api/teams/person_router.py :: patch_einwilligung`'s reason.
        return FLBewerbungPersonEinwilligungResponse.model_validate(
            {
                "bewerbung_id": bewerbung_id,
                "rollen": rollen,
                **sitz_wahlen_der_zeile(bloecke),
                "nachweis_stand": nachweis_stand_of(bloecke=bloecke),
            }
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(write)
