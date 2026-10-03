from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.identitaet.crud import funktionen_of
from app.api.konto.services import (
    KONTO_SEITE_SPIELER,
    build_kontext_teams_pipeline,
    compose_selbst_einwilligung_move,
    compose_spieler_selbst,
    erteilt_etwas,
    find_eigener_eintrag_refusal,
    find_konto_fassung_refusal,
    find_selbst_medien_refusal,
    kontext_zeile,
)
from app.api.spieler.schemas import (
    FLSpielerSelbstEinwilligungPayload,
    FLSpielerSelbstEinwilligungResponse,
    FLSpielerSelbstResponse,
)
from app.api.spieler.services import SELBST_WEG_SPIELER, build_selbst_pupil_filter, build_selbst_pupil_pipeline
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, patch_one_in_db, refuse
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielerCollection,
    TeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, DUPLICATE_KEY_RESPONSE
from app.core.recording import log_stamp
from app.core.security import PERSON_ACTOR_BINDERS, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung import is_confirmed

# A module of its own: `app/api/spieler/person_router.py` binds the `kontakt` Funktion at ROUTER level
# (`docs/backend/spec.md :: I41`), and a second binder on one of its routes would record these writes
# under the wrong Funktion, nothing failing.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieler/selbst",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["spieler"])],
)

# The router's own binder, answered from its run: the folded address the token names.
Identifier = Annotated[str, Depends(PERSON_ACTOR_BINDERS["spieler"])]


@router.get("", response_model=FLSpielerSelbstResponse, summary="A signed-in pupil's own record")
async def get_selbst(
    identifier: Identifier,
    spieler_collection: SpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    teams_collection: TeamsCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSpielerSelbstResponse:
    """
    Answer the signed-in address's own pupil record with every squad row it holds.

    PERSON TIER: the whole surname, the birthdate and the consent record, never masked, and never the sign-in address
    itself. A retired record is served too, its consent being the person's to withdraw; `erteilbar` says whether a
    grant is admitted on it, and `medien_angeboten` whether the media consent may be switched on.

    Refuses an address holding no confirmed pupil record (`REQ-FUNKTION-001`).
    """

    # A snapshot, so every record is answered as of one moment; never a transaction, which a read
    # writing nothing has no conflict to retry for.
    async with db.start_session(snapshot=True) as session:
        rows = await aggregate_many_from_db(collection=spieler_collection, pipeline=build_selbst_pupil_pipeline(identifier), session=session)
        row = rows[0] if rows else None
        refuse(find_eigener_eintrag_refusal(gehalten=row is not None and is_confirmed(row.get("einwilligung"))))
        assert row is not None

        subjekt = await funktionen_of(
            identifier,
            saison_teams_collection=saison_teams_collection,
            saisons_collection=saisons_collection,
            spieler_collection=spieler_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            session=session,
        )

        # The derivation the PATCH authorises a grant against, never a copy of its rule.
        erteilbar = any(eintrag.spieler_id == row["_id"] for eintrag in subjekt.spieler)

        zeile = kontext_zeile(row)
        teams = await aggregate_many_from_db(
            collection=teams_collection, pipeline=build_kontext_teams_pipeline([] if zeile is None else [zeile["team_id"]]), session=session
        )

        return FLSpielerSelbstResponse.model_validate(
            {"spieler": compose_spieler_selbst(row, erteilbar=erteilbar, today=today, team=teams[0] if teams else None)}
        )


@router.patch(
    "/einwilligung",
    response_model=FLSpielerSelbstEinwilligungResponse,
    summary="Change a signed-in pupil's own publication and media consent",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
)
async def patch_einwilligung(
    einwilligung_data: Annotated[FLSpielerSelbstEinwilligungPayload, Body()],
    identifier: Identifier,
    spieler_collection: SpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLSpielerSelbstEinwilligungResponse:
    """
    Set the two choices of the signed-in address's own pupil consent record: the publication scope and the media consent.

    Writes those two on this one record, and nothing else: the confirmation day, the day given, who gave it and the
    wording they confirmed stand, and no other document is written. A PATCH moving neither choice writes
    nothing. A GRANT (`umfang` to `kader_oeffentlich` or `medien` to `true`) is taken on a live record alone; a
    withdrawal on a retired one too.

    Refuses, in this order: an address holding no confirmed pupil record, or a grant on a retired one
    (`REQ-FUNKTION-001`); a `text_version` naming no version of the account page's pupil control, or a grant naming
    any but the page's running one (`REQ-EINWILLIGUNG-001`); and `medien` moving to `true` where the stored birthdate
    does not reach `MEDIEN_MIN_AGE_YEARS` today or is missing (`REQ-EINWILLIGUNG-002`). Each refusal writes nothing.

    **The caller drops the cached squad lists after a successful answer**: the publication scope decides whether a
    name is served, and nothing here can.
    """

    eigener_eintrag = build_selbst_pupil_filter(identifier)

    async def write(session: AsyncClientSession) -> FLSpielerSelbstEinwilligungResponse:
        row = await spieler_collection.find_one(eigener_eintrag, projection={"einwilligung": 1, "geburtsdatum": 1}, session=session)
        gespeichert = None if row is None else row.get("einwilligung")
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
            refuse(find_eigener_eintrag_refusal(gehalten=any(eintrag.spieler_id == row["_id"] for eintrag in subjekt.spieler)))

        refuse(find_konto_fassung_refusal(seite=KONTO_SEITE_SPIELER, text_version=einwilligung_data.text_version, erteilt=erteilt))
        refuse(
            find_selbst_medien_refusal(
                geburtsdatum=row.get("geburtsdatum"),
                medien_erteilt=einwilligung_data.medien and gespeichert.get("medien") is not True,
                today=today,
            )
        )

        update = compose_selbst_einwilligung_move(
            bloecke=(("einwilligung", gespeichert),),
            umfang=einwilligung_data.umfang,
            medien=einwilligung_data.medien,
            ueber=SELBST_WEG_SPIELER,
            am=log_stamp(germany_now),
            text_version=einwilligung_data.text_version,
        )
        # A press moving neither choice is no act, so nothing is written and no entry appended.
        if update is None:
            return FLSpielerSelbstEinwilligungResponse.model_validate({"spieler_id": row["_id"], "einwilligung": gespeichert})

        updated = await patch_one_in_db(
            collection=spieler_collection,
            db_filter={"_id": row["_id"]},
            update=update,
            session=session,
            return_document=ReturnDocument.AFTER,
        )

        return FLSpielerSelbstEinwilligungResponse.model_validate({"spieler_id": row["_id"], "einwilligung": updated["einwilligung"]})

    async with transaction_session(db) as session:
        return await session.with_transaction(write)
