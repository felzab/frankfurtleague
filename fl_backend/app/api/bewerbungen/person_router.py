from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.schemas import FLBewerbungPersonEinwilligungPayload, FLBewerbungPersonEinwilligungResponse
from app.api.kontakte.services import KONTAKT_SLOTS
from app.api.konto.services import (
    KONTO_SEITE_KONTAKT,
    SITZ_WAHLEN,
    compose_selbst_einwilligung_move,
    find_eigener_eintrag_refusal,
    find_konto_fassung_refusal,
    find_nachweis_stand_refusal,
    gehaltene_sitze,
)
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, refuse
from app.core.dependencies import BewerbungenCollection, DBClient, get_germany_now
from app.core.exception_handlers import DUPLICATE_KEY_RESPONSE
from app.core.recording import log_stamp
from app.core.security import PERSON_ACTOR_BINDERS, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung_nachweis import nachweis_stand_of
from app.shared.schemas.custom import CustomRouteObjectId

# The person lane's binder, as `app/api/teams/person_router.py` declares it and for its reason.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/bewerbungen",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["kontakt"])],
)

Kontakt = Annotated[str, Depends(PERSON_ACTOR_BINDERS["kontakt"])]


# `/person/einwilligung`, its own segment, for `app/api/teams/person_router.py :: get_team_sitze`'s reason.
@router.patch(
    "/{bewerbung_id:objectid}/person/einwilligung",
    response_model=FLBewerbungPersonEinwilligungResponse,
    summary="Withdraw a seat holder's own media consent on a pending Bewerbung",
    responses={409: DUPLICATE_KEY_RESPONSE},
)
async def patch_einwilligung(
    bewerbung_id: CustomRouteObjectId,
    einwilligung_data: Annotated[FLBewerbungPersonEinwilligungPayload, Body()],
    identifier: Kontakt,
    bewerbungen_collection: BewerbungenCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLBewerbungPersonEinwilligungResponse:
    """
    Withdraw the signed-in person's media consent on every seat they hold on this pending application, and nothing else.

    WITHDRAW-ONLY: the payload's `medien` is `false`, a grant being the confirmation page's alone; the account page
    offers it so taking a consent back is as easy as giving it was (Art. 7(3) DSGVO). One answer for every seat the
    person holds there; no other seat, field or document is written, and a withdrawal finding every seat off writes
    nothing.

    Refuses, in this order: an application that is decided or holds no confirmed seat of the address
    (`REQ-FUNKTION-001`); a `nachweis_stand` other than the held seats' own, their media evidence having moved since
    the page was served (`REQ-EINWILLIGUNG-003`); and a `text_version` naming no version of the account page's seat
    control (`REQ-EINWILLIGUNG-001`). Each refusal writes nothing.
    """

    async def write(session: AsyncClientSession) -> FLBewerbungPersonEinwilligungResponse:
        # Pending alone: an accepted application's seats are its season row's, and a declined one is decided.
        bewerbung = await bewerbungen_collection.find_one(
            {"_id": bewerbung_id, "status": "eingereicht"},
            {f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_SLOTS for field in ("email", "einwilligung")},
            session=session,
        )
        rollen = [] if bewerbung is None else gehaltene_sitze(bewerbung, identifier)
        refuse(find_eigener_eintrag_refusal(gehalten=bool(rollen)))
        assert bewerbung is not None
        bloecke = [bewerbung["kontakte"][slot]["einwilligung"] for slot in rollen]

        refuse(find_nachweis_stand_refusal(erwartet=einwilligung_data.nachweis_stand.model_dump(), bloecke=bloecke, wahlen=SITZ_WAHLEN))
        refuse(find_konto_fassung_refusal(seite=KONTO_SEITE_KONTAKT, text_version=einwilligung_data.text_version, erteilt=False))

        update = compose_selbst_einwilligung_move(
            bloecke=tuple((f"kontakte.{slot}.einwilligung", block) for slot, block in zip(rollen, bloecke, strict=True)),
            umfang=None,
            medien=einwilligung_data.medien,
            am=log_stamp(germany_now),
            text_version=einwilligung_data.text_version,
        )
        if update is not None:
            updated = await patch_one_in_db(
                collection=bewerbungen_collection,
                db_filter={"_id": bewerbung["_id"]},
                update=update,
                session=session,
                return_document=ReturnDocument.AFTER,
            )
            bloecke = [updated["kontakte"][slot]["einwilligung"] for slot in rollen]

        return FLBewerbungPersonEinwilligungResponse.model_validate(
            {
                "bewerbung_id": bewerbung_id,
                "rollen": rollen,
                "medien": einwilligung_data.medien,
                "nachweis_stand": nachweis_stand_of(bloecke=bloecke, wahlen=SITZ_WAHLEN),
            }
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(write)
