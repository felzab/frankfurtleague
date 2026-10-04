from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.einwilligung.services import find_selbst_medien_refusal
from app.api.identitaet.crud import funktionen_of
from app.api.identitaet.lookup import SubjektLookup
from app.api.identitaet.services import folds_to, ist_eigener_schiedsrichter
from app.api.konto.services import (
    KONTO_SEITE_SCHIEDSRICHTER,
    compose_schiedsrichter_selbst,
    compose_selbst_einwilligung_move,
    erteilt_etwas,
    find_eigener_eintrag_refusal,
    find_konto_fassung_refusal,
    find_nachweis_stand_refusal,
)
from app.api.schiedsrichter.schemas import (
    FLSchiedsrichterSelbstEinwilligungPayload,
    FLSchiedsrichterSelbstEinwilligungResponse,
    FLSchiedsrichterSelbstResponse,
)
from app.api.schiedsrichter.services import EINWILLIGUNG_FELD, build_selbst_referee_filter, build_selbst_referee_pipeline
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, patch_one_in_db, refuse
from app.core.dependencies import (
    DBClient,
    SchiedsrichterCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.drosselung import Drossel
from app.core.exception_handlers import DUPLICATE_KEY_RESPONSE
from app.core.recording import log_stamp
from app.core.routing import by_id
from app.core.security import PERSON_ACTOR_BINDERS, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung import is_confirmed
from app.shared.einwilligung_nachweis import WAHLEN, nachweis_stand_of
from app.shared.schemas.custom import CustomRouteObjectId

# A person's own router, apart from the admin one and the confirmation one, each binding its own actor
# at router level (`docs/backend/spec.md :: I41`): this one records every write under the referee's Funktion.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter/selbst",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["schiedsrichter"])],
)

# The router's own binder, answered from its run: the folded address the token names.
Identifier = Annotated[str, Depends(PERSON_ACTOR_BINDERS["schiedsrichter"])]


@router.get("", response_model=FLSchiedsrichterSelbstResponse, summary="A signed-in referee's own records")
async def get_selbst(
    identifier: Identifier,
    schiedsrichter_collection: SchiedsrichterCollection,
    records: SubjektLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSchiedsrichterSelbstResponse:
    """
    Answer every confirmed referee record the signed-in address holds, with its contact details and consent record.

    PERSON TIER: never the fee or the confirmation link's bookkeeping. A retired record is served too, its consent being
    the person's to withdraw; `erteilbar` says whether a grant is admitted on it, and `medien_angeboten` whether the
    media consent may be switched on.

    Refuses an address holding no confirmed referee record (`REQ-FUNKTION-001`).
    """

    # A snapshot, so every record is answered as of one moment; never a transaction, which a read
    # writing nothing has no conflict to retry for.
    async with db.start_session(snapshot=True) as session:
        rows = await aggregate_many_from_db(
            collection=schiedsrichter_collection, pipeline=build_selbst_referee_pipeline(identifier), session=session
        )
        eigene = [row for row in rows if ist_eigener_schiedsrichter(row, identifier)]
        refuse(find_eigener_eintrag_refusal(gehalten=bool(eigene)))

        subjekt = await funktionen_of(identifier, records, session=session)
        # The derivation every person endpoint authorises a grant against, never a copy of its rule.
        erteilbar = {eintrag.schiedsrichter_id for eintrag in subjekt.schiedsrichter}

        return FLSchiedsrichterSelbstResponse.model_validate(
            {"schiedsrichter": [compose_schiedsrichter_selbst(row, erteilbar=row["_id"] in erteilbar, today=today) for row in eigene]}
        )


@router.patch(
    f"{by_id('schiedsrichter_id')}/einwilligung",
    response_model=FLSchiedsrichterSelbstEinwilligungResponse,
    summary="Change a signed-in referee's own publication and media consent",
    responses={409: DUPLICATE_KEY_RESPONSE},
)
async def patch_einwilligung(
    schiedsrichter_id: CustomRouteObjectId,
    einwilligung_data: Annotated[FLSchiedsrichterSelbstEinwilligungPayload, Body()],
    identifier: Identifier,
    schiedsrichter_collection: SchiedsrichterCollection,
    records: SubjektLookup,
    db: DBClient,
    drossel: Drossel,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterSelbstEinwilligungResponse:
    """
    Set the two choices of one of the signed-in referee's own consent records: the publication scope and the media consent.

    Writes those two on this one referee row, each moved choice with its evidence (`nachweis.<choice>`), and nothing
    else: the confirmation day, the day given and the wording they confirmed stand, and no fixture is written. The
    fixture list does not read the scope yet: it serves the name each fixture stores, so a withdrawal here changes no
    fixture page until its read joins this row. A PATCH moving neither choice writes nothing. A GRANT (`umfang` to
    `kader_oeffentlich` or `medien` to `true`) is taken on a live record alone; a withdrawal on a retired one too.

    Refuses, in this order: an id that is no confirmed referee record of this address, or a grant on a retired one
    (`REQ-FUNKTION-001`); a `nachweis_stand` other than the record's own, either choice's evidence having moved since
    the page was served (`REQ-EINWILLIGUNG-003`); a `text_version` naming no version of the account page's referee control, or a grant naming
    any but the page's running one (`REQ-EINWILLIGUNG-001`); `medien` moving to `true` where the stored birthdate does
    not reach `MEDIEN_MIN_AGE_YEARS` today or is missing (`REQ-EINWILLIGUNG-002`); and a grant past the person's ceiling
    for the German day (`REQ-DROSSELUNG-001`), which counts grants alone, so a withdrawal is never refused for it. Each
    refusal writes nothing.

    **The caller drops the cached fixture list after a successful answer**, ahead of the fixture read joining this
    row; nothing here can.
    """

    eigener_eintrag = build_selbst_referee_filter(identifier, schiedsrichter_id=schiedsrichter_id)

    async def write(session: AsyncClientSession) -> FLSchiedsrichterSelbstEinwilligungResponse:
        row = await schiedsrichter_collection.find_one(
            eigener_eintrag, projection={"kontakt.email": 1, "geburtsdatum": 1, EINWILLIGUNG_FELD: 1}, session=session
        )
        # The fold decides, as it does for the read: the filter's pattern is the wider rule.
        gespeichert = row.get(EINWILLIGUNG_FELD) if row is not None and folds_to((row.get("kontakt") or {}).get("email"), identifier) else None
        refuse(find_eigener_eintrag_refusal(gehalten=is_confirmed(gespeichert)))
        assert row is not None and gespeichert is not None
        refuse(find_nachweis_stand_refusal(erwartet=einwilligung_data.nachweis_stand.model_dump(), bloecke=[gespeichert], wahlen=WAHLEN))

        erteilt = erteilt_etwas(gespeichert=gespeichert, umfang=einwilligung_data.umfang, medien=einwilligung_data.medien)
        if erteilt:
            subjekt = await funktionen_of(identifier, records, session=session)
            refuse(
                find_eigener_eintrag_refusal(gehalten=any(eintrag.schiedsrichter_id == schiedsrichter_id for eintrag in subjekt.schiedsrichter))
            )

        refuse(find_konto_fassung_refusal(seite=KONTO_SEITE_SCHIEDSRICHTER, text_version=einwilligung_data.text_version, erteilt=erteilt))
        refuse(
            find_selbst_medien_refusal(
                geburtsdatum=row.get("geburtsdatum"),
                medien_erteilt=einwilligung_data.medien and gespeichert.get("medien") is not True,
                today=today,
            )
        )
        # Last, so a press another rule refuses spends nothing; and a grant alone, so taking a consent
        # back stays as easy as giving it was (Art. 7(3) DSGVO).
        if erteilt:
            await drossel()

        update = compose_selbst_einwilligung_move(
            bloecke=((EINWILLIGUNG_FELD, gespeichert),),
            umfang=einwilligung_data.umfang,
            medien=einwilligung_data.medien,
            am=log_stamp(germany_now),
            text_version=einwilligung_data.text_version,
        )
        # A press moving neither choice is no act, so nothing is written and no evidence restamped.
        if update is None:
            return FLSchiedsrichterSelbstEinwilligungResponse.model_validate(
                {
                    "schiedsrichter_id": schiedsrichter_id,
                    "einwilligung": gespeichert,
                    "nachweis_stand": nachweis_stand_of(bloecke=[gespeichert], wahlen=WAHLEN),
                }
            )

        updated = await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": row["_id"]},
            update=update,
            session=session,
            return_document=ReturnDocument.AFTER,
        )

        return FLSchiedsrichterSelbstEinwilligungResponse.model_validate(
            {
                "schiedsrichter_id": schiedsrichter_id,
                "einwilligung": updated[EINWILLIGUNG_FELD],
                "nachweis_stand": nachweis_stand_of(bloecke=[updated[EINWILLIGUNG_FELD]], wahlen=WAHLEN),
            }
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(write)
