from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.bewerbungen.services import hash_token
from app.api.identitaet.lookup import SubjektLookup
from app.api.konto.adresswechsel import (
    discard_the_change_in_session,
    ending_line,
    move_the_address_in_session,
    read_the_bestand,
    wirksam_line,
)
from app.api.schiedsrichter.schemas import (
    FLSchiedsrichterAdresswechselAnsichtBisherig,
    FLSchiedsrichterAdresswechselAnsichtNeu,
    FLSchiedsrichterAdresswechselAnsichtPayload,
    FLSchiedsrichterAdresswechselAnsichtResponse,
    FLSchiedsrichterAdresswechselAntwortPayload,
    FLSchiedsrichterAdresswechselAntwortResponse,
    FLSchiedsrichterAdresswechselStoppPayload,
    FLSchiedsrichterAdresswechselStoppResponse,
)
from app.api.schiedsrichter.services import (
    ADRESSWECHSEL_ANSICHT_FIELDS,
    ADRESSWECHSEL_FELD,
    adresswechsel_adressen,
    adresswechsel_zustand_of,
    build_adresswechsel_filter,
    build_stopp_filter,
    find_adresswechsel_expired_refusal,
    find_bestaetigung_gesperrt_refusal,
    find_ersetzte_adresse_gesperrt_refusal,
    find_unknown_token_refusal,
)
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, sperrliste_saison
from app.api.spieler.crud import another_pupil_holds
from app.api.spieler.schemas import FLAdresswechselMitteilung
from app.api.spieler.services import build_selbst_pupil_filter, find_adresse_vergeben_refusal
from app.core.collections import Collection
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import patch_one_in_db, refuse
from app.core.dependencies import (
    AdressankerCollection,
    AktionenCollection,
    BewerbungenCollection,
    DBClient,
    RegistrierungenCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielbestaetigungenCollection,
    SpielerCollection,
    get_germany_now,
)
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, DUPLICATE_KEY_RESPONSE, stores_nothing
from app.core.journal import Journal, JournalLine
from app.core.recording import log_stamp
from app.core.security import bind_public_actor, loeschung_journal_hash, verify_access_base
from app.core.transactions import transaction_session
from app.shared.adresswechsel import als_utc, bisherig_zustand, compose_wartezeit_update, wirksam_ab_von
from app.shared.folding import sign_in_identifier

# A router of its own beside the consent link's, for that one's reason: the token is the whole
# credential, so these endpoints are base-tier and bind the public actor.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter/adresswechsel",
    dependencies=[Depends(verify_access_base), Depends(bind_public_actor)],
)


async def _another_pupil_takes(*, spieler_collection: AsyncCollection, ersetzte: str, neue: str, session: AsyncClientSession | None) -> bool:
    """Whether the change would move the replaced address's pupil row onto an address another pupil signs in on."""

    pupil = await spieler_collection.find_one(build_selbst_pupil_filter(sign_in_identifier(ersetzte)), projection={"_id": 1}, session=session)
    if pupil is None:
        return False

    return await another_pupil_holds(
        spieler_collection=spieler_collection, identifier=sign_in_identifier(neue), spieler_id=pupil["_id"], session=session
    )


@router.post(
    "/ansicht",
    response_model=FLSchiedsrichterAdresswechselAnsichtResponse,
    summary="What one Schiedsrichter address link opens",
    dependencies=[Depends(stores_nothing)],
)
async def get_adresswechsel_ansicht(
    ansicht_data: Annotated[FLSchiedsrichterAdresswechselAnsichtPayload, Body()],
    schiedsrichter_collection: SchiedsrichterCollection,
    spieler_collection: SpielerCollection,
    sperrliste: SperrlisteLookup,
    germany_now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterAdresswechselAnsichtResponse:
    """
    Answer what this token opens: the new mailbox's link, or the stop link the address on file was mailed.

    **Nothing else about the row** (`READ-REFEREE-003`): never a name, either address, the school, the fee or the id. The link
    went to an address nobody has confirmed, which behind a typo is a stranger's. A POST that reads, so the token travels in a
    body and never in a second URL.

    Refuses only a token no referee holds (`REQ-SCHIEDSRICHTER-002`), which an answered, stopped, replaced or discarded change
    is too. The new mailbox's side is served in a state: `gesperrt` ahead of every other wherever the ban list holds the address
    the link was mailed to, then `abgelaufen`, then `nicht_bestaetigbar` wherever it holds the address the change would replace
    or another pupil signs in on the new one where the change moves a pupil row too. The stop side answers the step the change
    waits on and until when, and never whether it could be confirmed: the stop is refused nothing.
    """

    token_hash = hash_token(ansicht_data.token)
    projection = dict(ADRESSWECHSEL_ANSICHT_FIELDS)

    # `find_one` rather than `pull_one_from_db`: a miss is this endpoint's own refusal, never a 404.
    raw = await schiedsrichter_collection.find_one(build_adresswechsel_filter(token_hash=token_hash), projection=projection)
    if raw is None:
        bisherig = await schiedsrichter_collection.find_one(build_stopp_filter(stopp_hash=token_hash), projection=projection)
        wechsel = None if bisherig is None else bisherig.get(ADRESSWECHSEL_FELD)
        refuse(find_unknown_token_refusal(found=isinstance(wechsel, Mapping)))
        assert isinstance(wechsel, Mapping)

        return FLSchiedsrichterAdresswechselAnsichtResponse(
            ansicht=FLSchiedsrichterAdresswechselAnsichtBisherig(
                seite="bisherig",
                zustand=bisherig_zustand(wechsel),
                gueltig_bis=als_utc(wechsel.get("gueltig_bis")),
                wirksam_ab=als_utc(wechsel.get("wirksam_ab")),
            )
        )

    wechsel = raw.get(ADRESSWECHSEL_FELD)
    gueltig_bis = als_utc(wechsel.get("gueltig_bis")) if isinstance(wechsel, Mapping) else None
    # An unreadable deadline is answered as the dead link, for the consent link's view's reason.
    refuse(find_unknown_token_refusal(found=gueltig_bis is not None))
    assert isinstance(wechsel, Mapping) and gueltig_bis is not None

    # Every judgement the press makes, read here too, so the page never offers a confirmation the press refuses.
    neue, ersetzte = adresswechsel_adressen(raw)
    gesperrt = await adressen_gesperrt(sperrliste, [neue, ersetzte])
    vergeben = await _another_pupil_takes(spieler_collection=spieler_collection, ersetzte=ersetzte, neue=neue, session=None)

    return FLSchiedsrichterAdresswechselAnsichtResponse(
        ansicht=FLSchiedsrichterAdresswechselAnsichtNeu(
            seite="neu",
            zustand=adresswechsel_zustand_of(
                wechsel=wechsel, now=germany_now, gesperrt=neue in gesperrt, ersetzte_gesperrt=ersetzte in gesperrt, vergeben=vergeben
            ),
            gueltig_bis=gueltig_bis,
        )
    )


@router.post(
    "",
    response_model=FLSchiedsrichterAdresswechselAntwortResponse,
    summary="Confirm or decline one Schiedsrichter's pending address",
    # `uniq_spieler_email` answers where the change moves a pupil row onto an address the sentinel was given by hand.
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
)
async def post_adresswechsel(
    antwort_data: Annotated[FLSchiedsrichterAdresswechselAntwortPayload, Body()],
    records: SubjektLookup,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    registrierungen_collection: RegistrierungenCollection,
    sperrliste: SperrlisteLookup,
    aktionen_collection: AktionenCollection,
    adressanker_collection: AdressankerCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterAdresswechselAntwortResponse:
    """
    Record whether the mailbox this link was sent to is the referee's: `bestaetigt` confirms it, `abgelehnt` discards the change.

    **A confirmation moves the person, not the row**, as the pupil's twin does (`POST /spieler/adresswechsel`): unless an
    administrator started the change with a recorded reason it takes effect here, every pupil row, confirmed referee row,
    confirmed contact seat and open registration the replaced address holds moving to the new one, and `mitteilung` naming
    whom the caller's completion notice goes to; a change started with a reason is confirmed alone, answering `wirksam_ab`.

    Refuses a token no referee holds (`REQ-SCHIEDSRICHTER-002`), and, in this order, a CONFIRMATION through a link mailed to an
    address the ban list holds now (`REQ-SCHIEDSRICHTER-009`), one past its deadline (`REQ-SCHIEDSRICHTER-003`), one whose change
    would replace an address the ban list holds now (`REQ-SCHIEDSRICHTER-010`), and one that would move the replaced address's
    pupil row onto an address another pupil signs in on (`REQ-SPIELER-006`): the order the link's view ranks its states in.
    **A decline is refused none of these**: it removes an address nobody proved, and takes it out of every image the action log
    holds of this referee. The rest of each image stays, the referee's own earlier states among it. A change whose referee row a
    hand edit has taken out of its address's own records is discarded as the hourly pass discards one, and the press answers
    `REQ-SCHIEDSRICHTER-002`, the link opening nothing since.
    """

    token_hash = hash_token(antwort_data.token)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await sperrliste_saison(sperrliste)
    stamp = log_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def answer_for_the_mailbox(session: AsyncClientSession) -> FLSchiedsrichterAdresswechselAntwortResponse | None:
        """Judge, then write, everything judged read in-session, so a second press is refused by the spent link rather than writing twice."""

        raw: Mapping[str, Any] | None = await schiedsrichter_collection.find_one(
            build_adresswechsel_filter(token_hash=token_hash), projection=dict(ADRESSWECHSEL_ANSICHT_FIELDS), session=session
        )
        wechsel = None if raw is None else raw.get(ADRESSWECHSEL_FELD)
        refuse(find_unknown_token_refusal(found=isinstance(wechsel, Mapping)))
        assert raw is not None and isinstance(wechsel, Mapping)
        neue, ersetzte = adresswechsel_adressen(raw)

        if antwort_data.antwort == "abgelehnt":
            await discard_the_change_in_session(
                collection=Collection.SCHIEDSRICHTER,
                spieler_collection=spieler_collection,
                schiedsrichter_collection=schiedsrichter_collection,
                aktionen_collection=aktionen_collection,
                db_filter={"_id": raw["_id"], **build_adresswechsel_filter(token_hash=token_hash)},
                stamp=stamp,
                session=session,
            )
            journal.note(
                JournalLine(
                    person_hash=loeschung_journal_hash(neue, schluessel=config.sperrliste_schluessel),
                    art="adresswechsel_abgelehnt",
                    collection=Collection.SCHIEDSRICHTER,
                    record_id=raw["_id"],
                    am=stamp,
                )
            )
            return FLSchiedsrichterAdresswechselAntwortResponse(antwort="abgelehnt", wirksam_ab=None, mitteilung=None)

        gesperrt = await adressen_gesperrt(sperrliste, [neue, ersetzte], massgebliche_saison_id=massgebliche_saison_id, session=session)
        # In the view's order (`app/api/schiedsrichter/services.py :: adresswechsel_zustand_of`), so a refused press names
        # what a reload shows: the link's own address first, its holder being the barred person where both are barred.
        refuse(find_bestaetigung_gesperrt_refusal(gesperrt=neue in gesperrt))
        refuse(find_adresswechsel_expired_refusal(block=wechsel, now=germany_now))
        refuse(find_ersetzte_adresse_gesperrt_refusal(gesperrt=ersetzte in gesperrt))
        vergeben = await _another_pupil_takes(spieler_collection=spieler_collection, ersetzte=ersetzte, neue=neue, session=session)
        refuse(find_adresse_vergeben_refusal(vergeben=vergeben))

        if wechsel.get("weg") == "wartezeit":
            await patch_one_in_db(
                collection=schiedsrichter_collection,
                db_filter={"_id": raw["_id"]},
                update=compose_wartezeit_update(now=germany_now),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )
            return FLSchiedsrichterAdresswechselAntwortResponse(antwort="bestaetigt", wirksam_ab=wirksam_ab_von(germany_now), mitteilung=None)

        bestand = await read_the_bestand(ersetzte, records=records, session=session)
        traeger = bestand.zeile(Collection.SCHIEDSRICHTER, raw["_id"])
        if traeger is None:
            # Only a confirmed referee's change is started, so a hand edit alone takes the row out of its address's own
            # records: the hourly pass discards such a change, and so does its press (`docs/backend/spec.md :: I795`).
            await discard_the_change_in_session(
                collection=Collection.SCHIEDSRICHTER,
                spieler_collection=spieler_collection,
                schiedsrichter_collection=schiedsrichter_collection,
                aktionen_collection=aktionen_collection,
                db_filter={"_id": raw["_id"], **build_adresswechsel_filter(token_hash=token_hash)},
                stamp=stamp,
                session=session,
            )
            journal.note(
                ending_line(
                    art="adresswechsel_verworfen",
                    neue=neue,
                    collection=Collection.SCHIEDSRICHTER,
                    record_id=raw["_id"],
                    am=stamp,
                    schluessel=config.sperrliste_schluessel,
                )
            )
            return None
        mitteilung = await move_the_address_in_session(
            bestand=bestand,
            traeger=traeger,
            neue=neue,
            spieler_collection=spieler_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            saison_teams_collection=saison_teams_collection,
            bewerbungen_collection=bewerbungen_collection,
            registrierungen_collection=registrierungen_collection,
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            aktionen_collection=aktionen_collection,
            adressanker_collection=adressanker_collection,
            schluessel=config.sperrliste_schluessel,
            stamp=stamp,
            session=session,
        )
        journal.note(wirksam_line(neue=neue, traeger=traeger, now=germany_now, schluessel=config.sperrliste_schluessel))

        return FLSchiedsrichterAdresswechselAntwortResponse(
            antwort="bestaetigt",
            wirksam_ab=None,
            mitteilung=FLAdresswechselMitteilung(bisherige_email=mitteilung.bisherige_email, vorname=mitteilung.vorname),
        )

    async with journal:
        async with transaction_session(db) as session:
            answered = await session.with_transaction(answer_for_the_mailbox)

    # After the commit, the discard standing: the link now opens nothing.
    refuse(find_unknown_token_refusal(found=answered is not None))
    assert answered is not None

    return answered


@router.post(
    "/stopp",
    response_model=FLSchiedsrichterAdresswechselStoppResponse,
    summary="Stop one Schiedsrichter's pending address change",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
async def post_adresswechsel_stopp(
    stopp_data: Annotated[FLSchiedsrichterAdresswechselStoppPayload, Body()],
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterAdresswechselStoppResponse:
    """
    Stop the change the address on file was told of: the block goes, its new address out of every log image of the referee.

    **Refused nothing but a token no referee holds** (`REQ-SCHIEDSRICHTER-002`), as the pupil's twin is
    (`POST /spieler/adresswechsel/stopp`): a stop hands nothing over, so it answers for as long as the change stands.
    """

    stopp_hash = hash_token(stopp_data.token)
    journal = Journal()

    @journal.attempted
    async def stop_the_change(session: AsyncClientSession) -> FLSchiedsrichterAdresswechselStoppResponse:
        raw = await schiedsrichter_collection.find_one(
            build_stopp_filter(stopp_hash=stopp_hash), projection={f"{ADRESSWECHSEL_FELD}.email": 1}, session=session
        )
        refuse(find_unknown_token_refusal(found=raw is not None))
        assert raw is not None

        await discard_the_change_in_session(
            collection=Collection.SCHIEDSRICHTER,
            spieler_collection=spieler_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            aktionen_collection=aktionen_collection,
            db_filter={"_id": raw["_id"], **build_stopp_filter(stopp_hash=stopp_hash)},
            stamp=log_stamp(germany_now),
            session=session,
        )
        journal.note(
            ending_line(
                art="adresswechsel_gestoppt",
                neue=str(raw[ADRESSWECHSEL_FELD]["email"]),
                collection=Collection.SCHIEDSRICHTER,
                record_id=raw["_id"],
                am=log_stamp(germany_now),
                schluessel=config.sperrliste_schluessel,
            )
        )

        return FLSchiedsrichterAdresswechselStoppResponse(gestoppt=True)

    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(stop_the_change)
