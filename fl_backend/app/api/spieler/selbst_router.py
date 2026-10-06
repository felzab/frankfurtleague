from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.identitaet.crud import funktionen_of
from app.api.identitaet.lookup import SubjektLookup
from app.api.identitaet.services import ist_eigener_spieler, may_grant_on_spieler
from app.api.konto.crud import press_einwilligung
from app.api.konto.services import (
    KONTO_SEITE_SPIELER,
    compose_person_move,
    compose_spieler_selbst,
    find_eigener_eintrag_refusal,
)
from app.api.spieler.schemas import (
    FLSpielerSelbstEinwilligungPayload,
    FLSpielerSelbstEinwilligungResponse,
    FLSpielerSelbstResponse,
)
from app.api.spieler.services import build_selbst_pupil_filter, build_selbst_pupil_pipeline
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, patch_one_in_db, refuse
from app.core.dependencies import (
    DBClient,
    SpielerCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.drosselung import Drossel
from app.core.recording import log_stamp
from app.core.security import PERSON_ACTOR_BINDERS, SpielerIdentifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung_nachweis import FLEinwilligungWahl, nachweis_stand_of

# A module of its own: `app/api/spieler/person_router.py` binds the `kontakt` Funktion at ROUTER level
# (`docs/backend/spec.md :: I41`), and a second binder on one of its routes would record these writes
# under the wrong Funktion, nothing failing.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieler/selbst",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["spieler"])],
)


@router.get("", response_model=FLSpielerSelbstResponse, summary="A signed-in pupil's own record")
async def get_selbst(identifier: SpielerIdentifier, spieler_collection: SpielerCollection) -> FLSpielerSelbstResponse:
    """
    Answer the signed-in address's own pupil record's stored data with every squad row it holds.

    PERSON TIER: the whole surname and the birthdate, never masked, and never the sign-in address itself. A retired
    record is served too. Its consent is the account page's (`GET /konto/einwilligungen`), so none is served here.

    Refuses an address holding no confirmed pupil record (`REQ-FUNKTION-001`).
    """

    rows = await aggregate_many_from_db(collection=spieler_collection, pipeline=build_selbst_pupil_pipeline(identifier))
    row = rows[0] if rows else None
    refuse(find_eigener_eintrag_refusal(gehalten=row is not None and ist_eigener_spieler(row)))
    assert row is not None

    return FLSpielerSelbstResponse.model_validate({"spieler": compose_spieler_selbst(row)})


@router.patch(
    "/einwilligung",
    response_model=FLSpielerSelbstEinwilligungResponse,
    summary="Change a signed-in pupil's own publication and media consent",
)
async def patch_einwilligung(
    einwilligung_data: Annotated[FLSpielerSelbstEinwilligungPayload, Body()],
    identifier: SpielerIdentifier,
    spieler_collection: SpielerCollection,
    records: SubjektLookup,
    db: DBClient,
    drossel: Drossel,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLSpielerSelbstEinwilligungResponse:
    """
    Set the two choices of the signed-in address's own pupil consent record: the publication scope and the media consent.

    Writes those two on this one record, each moved choice with its evidence (`nachweis.<choice>`), and nothing else:
    the confirmation day, the day given and the wording they confirmed stand, and no other document is written. A
    PATCH moving neither choice writes nothing. A GRANT (`umfang` to `kader_oeffentlich` or `medien` to `true`) is
    taken on a live record alone; a withdrawal on a retired one too.

    Refuses, in this order: an address holding no confirmed pupil record (`REQ-FUNKTION-001`); a `nachweis_stand`
    other than the record's own, either choice having moved since the page was served (`REQ-EINWILLIGUNG-003`); a
    grant on a retired record (`REQ-EINWILLIGUNG-004`); a `text_version` naming no version of the account page's pupil
    control, or a grant naming any but the page's running one (`REQ-EINWILLIGUNG-001`); `medien` moving to `true` where
    the stored birthdate does not reach `MEDIEN_MIN_AGE_YEARS` today or is missing (`REQ-EINWILLIGUNG-002`); and a
    grant past the person's ceiling for the German day (`REQ-DROSSELUNG-001`), which counts grants alone, so a
    withdrawal is never refused for it. Each refusal writes nothing.

    **The caller drops the cached squad lists after a successful answer**: the publication scope decides whether a
    name is served, and nothing here can.
    """

    eigener_eintrag = build_selbst_pupil_filter(identifier)
    gewaehlt: dict[FLEinwilligungWahl, object] = {"umfang": einwilligung_data.umfang, "medien": einwilligung_data.medien}

    async def write(session: AsyncClientSession) -> FLSpielerSelbstEinwilligungResponse:
        row = await spieler_collection.find_one(eigener_eintrag, projection={"einwilligung": 1, "geburtsdatum": 1}, session=session)
        refuse(find_eigener_eintrag_refusal(gehalten=row is not None and ist_eigener_spieler(row)))
        assert row is not None
        gespeichert = row["einwilligung"]

        async def darf_erteilen() -> bool:
            return may_grant_on_spieler(await funktionen_of(identifier, records, session=session), row["_id"])

        await press_einwilligung(
            bloecke=[gespeichert],
            geburtsdaten=[row.get("geburtsdatum")],
            gewaehlt=gewaehlt,
            nachweis_stand=einwilligung_data.nachweis_stand.model_dump(),
            text_version=einwilligung_data.text_version,
            seite=KONTO_SEITE_SPIELER,
            darf_erteilen=darf_erteilen,
            drossel=drossel,
            today=today,
        )

        update = compose_person_move(
            gespeichert=gespeichert, gewaehlt=gewaehlt, am=log_stamp(germany_now), text_version=einwilligung_data.text_version
        )
        updated = (
            None
            if update is None
            else await patch_one_in_db(
                collection=spieler_collection,
                db_filter={"_id": row["_id"]},
                update=update,
                session=session,
                return_document=ReturnDocument.AFTER,
            )
        )
        # A press moving neither choice is no act, so nothing was written and the record answers as stored.
        einwilligung = gespeichert if updated is None else updated["einwilligung"]

        return FLSpielerSelbstEinwilligungResponse.model_validate(
            {"spieler_id": row["_id"], "einwilligung": einwilligung, "nachweis_stand": nachweis_stand_of(bloecke=[einwilligung])}
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(write)
