from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.identitaet.crud import funktionen_of
from app.api.identitaet.lookup import SubjektLookup
from app.api.identitaet.services import ist_eigener_schiedsrichter, may_grant_on_schiedsrichter
from app.api.konto.crud import press_einwilligung
from app.api.konto.services import (
    KONTO_SEITE_SCHIEDSRICHTER,
    compose_person_move,
    compose_schiedsrichter_selbst,
    find_eigener_eintrag_refusal,
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
from app.core.recording import log_stamp
from app.core.routing import by_id
from app.core.security import PERSON_ACTOR_BINDERS, SchiedsrichterIdentifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung_nachweis import FLEinwilligungWahl, nachweis_stand_of
from app.shared.schemas.custom import CustomRouteObjectId

# A person's own router, apart from the admin one and the confirmation one, each binding its own actor
# at router level (`docs/backend/spec.md :: I41`): this one records every write under the referee's Funktion.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter/selbst",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["schiedsrichter"])],
)


@router.get("", response_model=FLSchiedsrichterSelbstResponse, summary="A signed-in referee's own records")
async def get_selbst(
    identifier: SchiedsrichterIdentifier,
    schiedsrichter_collection: SchiedsrichterCollection,
    records: SubjektLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSchiedsrichterSelbstResponse:
    """
    Answer every confirmed referee record the signed-in address holds, with its contact details and consent record.

    PERSON TIER: the fee set for them per fixture as `honorar`, never the confirmation link's bookkeeping. A retired
    record is served too, its consent being the person's to withdraw; `erteilbar` says whether a grant is admitted on
    it, and `medien_angeboten` whether the media consent may be switched on.

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

        return FLSchiedsrichterSelbstResponse.model_validate(
            {
                "schiedsrichter": [
                    compose_schiedsrichter_selbst(row, erteilbar=may_grant_on_schiedsrichter(subjekt, row["_id"]), today=today)
                    for row in eigene
                ]
            }
        )


@router.patch(
    f"{by_id('schiedsrichter_id')}/einwilligung",
    response_model=FLSchiedsrichterSelbstEinwilligungResponse,
    summary="Change a signed-in referee's own publication and media consent",
)
async def patch_einwilligung(
    schiedsrichter_id: CustomRouteObjectId,
    einwilligung_data: Annotated[FLSchiedsrichterSelbstEinwilligungPayload, Body()],
    identifier: SchiedsrichterIdentifier,
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

    Refuses, in this order: an id that is no confirmed referee record of this address (`REQ-FUNKTION-001`); a
    `nachweis_stand` other than the record's own, either choice having moved since the page was served
    (`REQ-EINWILLIGUNG-003`); a grant on a retired record (`REQ-EINWILLIGUNG-004`); a `text_version` naming no version of
    the account page's referee control, or a grant naming any but the page's running one (`REQ-EINWILLIGUNG-001`);
    `medien` moving to `true` where the stored birthdate does not reach `MEDIEN_MIN_AGE_YEARS` today or is missing
    (`REQ-EINWILLIGUNG-002`); and a grant past the person's ceiling for the German day (`REQ-DROSSELUNG-001`), which
    counts grants alone, so a withdrawal is never refused for it. Each refusal writes nothing.

    **The caller drops the cached fixture list after a successful answer**, ahead of the fixture read joining this
    row; nothing here can.
    """

    eigener_eintrag = build_selbst_referee_filter(identifier, schiedsrichter_id=schiedsrichter_id)
    gewaehlt: dict[FLEinwilligungWahl, object] = {"umfang": einwilligung_data.umfang, "medien": einwilligung_data.medien}

    async def write(session: AsyncClientSession) -> FLSchiedsrichterSelbstEinwilligungResponse:
        row = await schiedsrichter_collection.find_one(
            eigener_eintrag, projection={"kontakt.email": 1, "geburtsdatum": 1, EINWILLIGUNG_FELD: 1}, session=session
        )
        # The fold decides, as it does for the read: the filter's pattern is the wider rule.
        refuse(find_eigener_eintrag_refusal(gehalten=row is not None and ist_eigener_schiedsrichter(row, identifier)))
        assert row is not None
        gespeichert = row[EINWILLIGUNG_FELD]

        async def darf_erteilen() -> bool:
            return may_grant_on_schiedsrichter(await funktionen_of(identifier, records, session=session), schiedsrichter_id)

        await press_einwilligung(
            bloecke=[gespeichert],
            geburtsdaten=[row.get("geburtsdatum")],
            gewaehlt=gewaehlt,
            nachweis_stand=einwilligung_data.nachweis_stand.model_dump(),
            text_version=einwilligung_data.text_version,
            seite=KONTO_SEITE_SCHIEDSRICHTER,
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
                collection=schiedsrichter_collection,
                db_filter={"_id": row["_id"]},
                update=update,
                session=session,
                return_document=ReturnDocument.AFTER,
            )
        )
        # A press moving neither choice is no act, so nothing was written and the record answers as stored.
        einwilligung = gespeichert if updated is None else updated[EINWILLIGUNG_FELD]

        return FLSchiedsrichterSelbstEinwilligungResponse.model_validate(
            {
                "schiedsrichter_id": schiedsrichter_id,
                "einwilligung": einwilligung,
                "nachweis_stand": nachweis_stand_of(bloecke=[einwilligung]),
            }
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(write)
