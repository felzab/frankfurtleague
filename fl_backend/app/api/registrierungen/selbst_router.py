from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.identitaet.services import ist_eigene_registrierung
from app.api.konto.crud import press_widerruf
from app.api.konto.services import KONTO_SEITE_SPIELER, compose_person_move, find_eigener_eintrag_refusal
from app.api.registrierungen.schemas import FLRegistrierungSelbstEinwilligungPayload, FLRegistrierungSelbstEinwilligungResponse
from app.api.registrierungen.services import traegt_wahlen
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, refuse
from app.core.dependencies import DBClient, RegistrierungenCollection, get_germany_now
from app.core.recording import log_stamp
from app.core.routing import by_id
from app.core.security import PERSON_ACTOR_BINDERS, SpielerIdentifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung_nachweis import FLEinwilligungWahl, nachweis_stand_of
from app.shared.schemas.custom import CustomRouteObjectId

# A module of its own, for `app/api/spieler/selbst_router.py`'s reason: `app/api/registrierungen/person_router.py`
# binds the `kontakt` Funktion at router level, and a pending registrant writes as the pupil they registered as.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/registrierungen/selbst",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["spieler"])],
)


@router.patch(
    f"{by_id('registrierung_id')}/einwilligung",
    response_model=FLRegistrierungSelbstEinwilligungResponse,
    summary="Withdraw a pupil's own publication and media consent on their pending registration",
)
async def patch_einwilligung(
    registrierung_id: CustomRouteObjectId,
    einwilligung_data: Annotated[FLRegistrierungSelbstEinwilligungPayload, Body()],
    identifier: SpielerIdentifier,
    registrierungen_collection: RegistrierungenCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLRegistrierungSelbstEinwilligungResponse:
    """
    Withdraw the publication scope or the media consent the signed-in pupil gave on their own pending registration.

    WITHDRAW-ONLY until the admission: a grant is the team's admission's to make possible, after which the pupil's own
    record takes it on the account page; this one is offered so taking a consent back is as easy as giving it was
    (Art. 7(3) DSGVO). Writes those two on this one registration, and nothing else: the confirmation day, the day given
    and the wording the pupil confirmed stand. A PATCH moving neither choice writes nothing, and nothing is counted
    against the person's ceiling. The admission carries a withdrawal made here onto the person, as it carries every
    choice the registration set later than the person's own.

    Refuses, in this order: an id that is no pending registration of this address, confirmed by its pupil and carrying
    their choices (`REQ-FUNKTION-001`); a `nachweis_stand` other than the registration's own, either choice having
    moved since the page was served (`REQ-EINWILLIGUNG-003`); a grant of either choice (`REQ-FUNKTION-001`); and a
    `text_version` naming no version of the account page's pupil control (`REQ-EINWILLIGUNG-001`). Each refusal writes
    nothing.
    """

    gewaehlt: dict[FLEinwilligungWahl, object] = {"umfang": einwilligung_data.umfang, "medien": einwilligung_data.medien}

    async def write(session: AsyncClientSession) -> FLRegistrierungSelbstEinwilligungResponse:
        # By the id alone: the predicate judges the status, the fold, the confirmation and the choices.
        row = await registrierungen_collection.find_one(
            {"_id": registrierung_id}, projection={"status": 1, "email": 1, "einwilligung": 1}, session=session
        )
        # A returning pupil's is the address's own and holds no choice to withdraw, its person's own record holding them.
        refuse(
            find_eigener_eintrag_refusal(
                gehalten=row is not None and ist_eigene_registrierung(row, identifier) and traegt_wahlen(row["einwilligung"])
            )
        )
        assert row is not None
        gespeichert = row["einwilligung"]

        # Withdraw-only: a pending registration grants no panel to answer a grant against.
        await press_widerruf(
            bloecke=[gespeichert],
            gewaehlt=gewaehlt,
            nachweis_stand=einwilligung_data.nachweis_stand.model_dump(),
            text_version=einwilligung_data.text_version,
            seite=KONTO_SEITE_SPIELER,
        )

        update = compose_person_move(
            gespeichert=gespeichert, gewaehlt=gewaehlt, am=log_stamp(germany_now), text_version=einwilligung_data.text_version
        )
        updated = (
            None
            if update is None
            else await patch_one_in_db(
                collection=registrierungen_collection,
                db_filter={"_id": row["_id"]},
                update=update,
                session=session,
                return_document=ReturnDocument.AFTER,
            )
        )
        # A press moving neither choice is no act, so nothing was written and the record answers as stored.
        einwilligung = gespeichert if updated is None else updated["einwilligung"]

        return FLRegistrierungSelbstEinwilligungResponse.model_validate(
            {
                "registrierung_id": row["_id"],
                "einwilligung": einwilligung,
                "nachweis_stand": nachweis_stand_of(bloecke=[einwilligung]),
            }
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(write)
