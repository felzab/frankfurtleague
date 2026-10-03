from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.identitaet.crud import funktionen_of
from app.api.identitaet.services import folds_to
from app.api.konto.services import (
    KONTO_SEITE_SCHIEDSRICHTER,
    bewegt_etwas,
    compose_schiedsrichter_selbst,
    compose_selbst_einwilligung_update,
    erteilt_etwas,
    find_eigener_eintrag_refusal,
    find_konto_fassung_refusal,
    find_selbst_medien_refusal,
)
from app.api.schiedsrichter.schemas import (
    FLSchiedsrichterSelbstEinwilligungPayload,
    FLSchiedsrichterSelbstEinwilligungResponse,
    FLSchiedsrichterSelbstResponse,
)
from app.api.schiedsrichter.services import EINWILLIGUNG_FELD, SELBST_FIELDS, build_selbst_referee_filter
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, patch_one_in_db, refuse
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielerCollection,
    get_german_date_str,
)
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, DUPLICATE_KEY_RESPONSE
from app.core.routing import by_id
from app.core.security import PERSON_ACTOR_BINDERS, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung import is_confirmed
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
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spieler_collection: SpielerCollection,
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
        # Unbounded, as `app/api/identitaet/crud.py :: find_subjekt` reads: a capped list reads as a
        # person holding fewer records.
        rows = await aggregate_many_from_db(
            collection=schiedsrichter_collection,
            pipeline=[{"$match": build_selbst_referee_filter(identifier)}, {"$project": dict(SELBST_FIELDS)}, {"$sort": {"_id": 1}}],
            session=session,
        )
        eigene = [
            row for row in rows if folds_to((row.get("kontakt") or {}).get("email"), identifier) and is_confirmed(row.get(EINWILLIGUNG_FELD))
        ]
        refuse(find_eigener_eintrag_refusal(gehalten=bool(eigene)))

        subjekt = await funktionen_of(
            identifier,
            saison_teams_collection=saison_teams_collection,
            saisons_collection=saisons_collection,
            spieler_collection=spieler_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            session=session,
        )
        # The derivation every person endpoint authorises a grant against, never a copy of its rule.
        erteilbar = {eintrag.schiedsrichter_id for eintrag in subjekt.schiedsrichter}

        return FLSchiedsrichterSelbstResponse.model_validate(
            {"schiedsrichter": [compose_schiedsrichter_selbst(row, erteilbar=row["_id"] in erteilbar, today=today) for row in eigene]}
        )


@router.patch(
    f"{by_id('schiedsrichter_id')}/einwilligung",
    response_model=FLSchiedsrichterSelbstEinwilligungResponse,
    summary="Change a signed-in referee's own publication and media consent",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
)
async def patch_einwilligung(
    schiedsrichter_id: CustomRouteObjectId,
    einwilligung_data: Annotated[FLSchiedsrichterSelbstEinwilligungPayload, Body()],
    identifier: Identifier,
    schiedsrichter_collection: SchiedsrichterCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spieler_collection: SpielerCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSchiedsrichterSelbstEinwilligungResponse:
    """
    Set the two choices of one of the signed-in referee's own consent records: the publication scope and the media consent.

    Writes those two on this one referee row, and nothing else: the confirmation day, the day given, who gave it and
    the wording they confirmed stand, and no fixture is written -- the fixture list reads the scope
    on this row. A PATCH moving neither choice writes nothing. A GRANT (`umfang` to `kader_oeffentlich` or `medien` to
    `true`) is taken on a live record alone; a withdrawal on a retired one too.

    Refuses, in this order: an id that is no confirmed referee record of this address, or a grant on a retired one
    (`REQ-FUNKTION-001`); a `text_version` naming no version of the account page's referee control, or a grant naming
    any but the page's running one (`REQ-EINWILLIGUNG-001`); and `medien` moving to `true` where the stored birthdate does
    not reach `MEDIEN_MIN_AGE_YEARS` today or is missing (`REQ-EINWILLIGUNG-002`). Each refusal writes nothing.

    **The caller drops the cached fixture list after a successful answer**: it serves the referee's name by this scope,
    and nothing here can.
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

        erteilt = erteilt_etwas(gespeichert=gespeichert, umfang=einwilligung_data.umfang, medien=einwilligung_data.medien)
        if erteilt:
            subjekt = await funktionen_of(
                identifier,
                saison_teams_collection=saison_teams_collection,
                saisons_collection=saisons_collection,
                spieler_collection=spieler_collection,
                schiedsrichter_collection=schiedsrichter_collection,
                session=session,
            )
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

        if not bewegt_etwas(gespeichert=gespeichert, umfang=einwilligung_data.umfang, medien=einwilligung_data.medien):
            return FLSchiedsrichterSelbstEinwilligungResponse.model_validate(
                {"schiedsrichter_id": schiedsrichter_id, "einwilligung": gespeichert}
            )

        updated = await patch_one_in_db(
            collection=schiedsrichter_collection,
            # The row judged, by id: the fold above has already confirmed the address is this person's.
            db_filter={"_id": row["_id"]},
            update=compose_selbst_einwilligung_update(
                pfade=(EINWILLIGUNG_FELD,),
                umfang=einwilligung_data.umfang,
                medien=einwilligung_data.medien,
            ),
            session=session,
            return_document=ReturnDocument.AFTER,
        )

        return FLSchiedsrichterSelbstEinwilligungResponse.model_validate(
            {"schiedsrichter_id": schiedsrichter_id, "einwilligung": updated[EINWILLIGUNG_FELD]}
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(write)
