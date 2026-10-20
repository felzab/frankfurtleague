from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.services import hash_token
from app.api.identitaet.lookup import SubjektLookup
from app.api.konto.adresswechsel import (
    discard_the_change_in_session,
    ending_line,
    move_the_address_in_session,
    read_the_bestand,
    wirksam_line,
)
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, sperrliste_saison
from app.api.spieler.crud import another_pupil_holds
from app.api.spieler.schemas import (
    FLAdresswechselMitteilung,
    FLSpielerAdresswechselAnsichtBisherig,
    FLSpielerAdresswechselAnsichtNeu,
    FLSpielerAdresswechselAnsichtPayload,
    FLSpielerAdresswechselAnsichtResponse,
    FLSpielerAdresswechselAntwortPayload,
    FLSpielerAdresswechselAntwortResponse,
    FLSpielerAdresswechselStoppPayload,
    FLSpielerAdresswechselStoppResponse,
)
from app.api.spieler.services import (
    SPIELER_ADRESSWECHSEL_ANSICHT_FIELDS,
    SPIELER_ADRESSWECHSEL_FELD,
    build_spieler_adresswechsel_filter,
    build_spieler_stopp_filter,
    find_adresse_vergeben_refusal,
    find_keine_adresse_refusal,
    find_spieler_bestaetigung_gesperrt_refusal,
    find_spieler_ersetzte_adresse_gesperrt_refusal,
    find_spieler_token_expired_refusal,
    find_spieler_token_unknown_refusal,
    holds_an_address,
    spieler_adresswechsel_adressen,
    spieler_adresswechsel_zustand_of,
)
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

# A router of its own beside the admin one under the same prefix, for the referee's address link's
# reason (`app/api/schiedsrichter/adresswechsel_router.py`): the token is the whole credential, so
# these endpoints are base-tier and bind the public actor.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieler/adresswechsel",
    dependencies=[Depends(verify_access_base), Depends(bind_public_actor)],
)


@router.post(
    "/ansicht",
    response_model=FLSpielerAdresswechselAnsichtResponse,
    summary="What one Spieler address link opens",
    dependencies=[Depends(stores_nothing)],
)
async def get_adresswechsel_ansicht(
    ansicht_data: Annotated[FLSpielerAdresswechselAnsichtPayload, Body()],
    spieler_collection: SpielerCollection,
    sperrliste: SperrlisteLookup,
    germany_now: datetime = Depends(get_germany_now),
) -> FLSpielerAdresswechselAnsichtResponse:
    """
    Answer what this token opens: the new mailbox's link, or the stop link the address on file was mailed.

    **Nothing else about the row** (`READ-PUPIL-005`): never a name, either address or the id. A POST that reads, so the token
    travels in a body and never in a second URL.

    Refuses only a token no pupil holds (`REQ-SPIELER-001`), which an answered, stopped, replaced or discarded change is too.
    The new mailbox's side is served in a state: `gesperrt` ahead of every other wherever the ban list holds the address the
    link was mailed to, then `abgelaufen`, then `nicht_bestaetigbar` wherever it holds the address the change would replace,
    the pupil holds no address, or another pupil signs in on the new one, each a state the confirmation would be refused in.
    Those three read alike here, though the press answers each by its own code; what keeps the link's holder from telling
    them apart is the edge, where `nginx/shared/site.conf` routes no public call to this service. The stop side answers the
    step the change waits on and until when, and never whether it could be confirmed: the stop is refused nothing.
    """

    token_hash = hash_token(ansicht_data.token)
    projection = dict(SPIELER_ADRESSWECHSEL_ANSICHT_FIELDS)

    # `find_one` rather than `pull_one_from_db`: a miss is this endpoint's own refusal, never a 404.
    raw = await spieler_collection.find_one(build_spieler_adresswechsel_filter(token_hash=token_hash), projection=projection)
    if raw is None:
        bisherig = await spieler_collection.find_one(build_spieler_stopp_filter(stopp_hash=token_hash), projection=projection)
        wechsel = None if bisherig is None else bisherig.get(SPIELER_ADRESSWECHSEL_FELD)
        refuse(find_spieler_token_unknown_refusal(found=isinstance(wechsel, dict)))
        assert isinstance(wechsel, dict)

        return FLSpielerAdresswechselAnsichtResponse(
            ansicht=FLSpielerAdresswechselAnsichtBisherig(
                seite="bisherig",
                zustand=bisherig_zustand(wechsel),
                gueltig_bis=als_utc(wechsel.get("gueltig_bis")),
                wirksam_ab=als_utc(wechsel.get("wirksam_ab")),
            )
        )

    wechsel = raw.get(SPIELER_ADRESSWECHSEL_FELD)
    gueltig_bis = als_utc(wechsel.get("gueltig_bis")) if isinstance(wechsel, dict) else None
    # An unreadable deadline is answered as the dead link, for the referee's view's reason.
    refuse(find_spieler_token_unknown_refusal(found=gueltig_bis is not None))
    assert isinstance(wechsel, dict) and gueltig_bis is not None

    # Every judgement the press makes, read here too, so the page never offers a confirmation the press refuses.
    neue, ersetzte = spieler_adresswechsel_adressen(raw)
    gesperrt = await adressen_gesperrt(sperrliste, [neue, ersetzte])
    vergeben = await another_pupil_holds(
        spieler_collection=spieler_collection, identifier=sign_in_identifier(neue), spieler_id=raw["_id"], session=None
    )

    return FLSpielerAdresswechselAnsichtResponse(
        ansicht=FLSpielerAdresswechselAnsichtNeu(
            seite="neu",
            zustand=spieler_adresswechsel_zustand_of(
                wechsel=wechsel,
                now=germany_now,
                gesperrt=neue in gesperrt,
                ersetzte_gesperrt=ersetzte in gesperrt,
                keine_adresse=not holds_an_address(raw.get("email")),
                vergeben=vergeben,
            ),
            gueltig_bis=gueltig_bis,
        )
    )


@router.post(
    "",
    response_model=FLSpielerAdresswechselAntwortResponse,
    summary="Confirm or decline one Spieler's pending address",
    # `uniq_spieler_email` answers the sentinel given the address by hand, which the in-session holder read passes over.
    # A rival committing after that read meets the write as a conflict, and the retry's read refuses it.
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
)
async def post_adresswechsel_antwort(
    antwort_data: Annotated[FLSpielerAdresswechselAntwortPayload, Body()],
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
) -> FLSpielerAdresswechselAntwortResponse:
    """
    Record whether the mailbox this link was sent to is the pupil's: `bestaetigt` confirms it, `abgelehnt` discards the change.

    **A confirmation moves the person, not the row.** Unless an administrator started the change with a recorded reason, it takes
    effect in this transaction: every pupil row, confirmed referee row, confirmed contact seat and open registration the replaced
    address holds moves to the new one, asking no consent and writing none, and `mitteilung` names the replaced address and the
    first name for the caller's completion notice. A change started with a reason is confirmed alone, answering `wirksam_ab`,
    from which the hourly pass makes it take effect. Either answer spends the link.

    Refuses a token no pupil holds (`REQ-SPIELER-001`), and, in the order the link's view ranks its states, a CONFIRMATION through
    a link mailed to an address the ban list holds now (`REQ-SPIELER-004`), one past its deadline (`REQ-SPIELER-002`), one for a
    pupil who has come to hold no address (`REQ-SPIELER-008`), one whose change would replace an address the ban list holds now
    (`REQ-SPIELER-005`), so a barred person cannot move their record off the address the ban keys on, and one to an address another
    pupil has come to sign in on (`REQ-SPIELER-006`). **A decline is refused none of these**: it removes an address nobody proved,
    and it takes that address out of every image the action log holds of this pupil. The rest of each image stays.

    The last three codes, and `DB-COMMON-002` for an address the erased pupils' sentinel was given by hand, tell a caller what
    the view's `nicht_bestaetigbar` keeps alike. Only the edge keeps them from the link's holder: `nginx/shared/site.conf` routes
    no public call to this service, and the frontend's route handler answers all four as that one state.
    """

    token_hash = hash_token(antwort_data.token)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await sperrliste_saison(sperrliste)
    stamp = log_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def answer_for_the_mailbox(session: AsyncClientSession) -> FLSpielerAdresswechselAntwortResponse:
        """Judge, then write, everything judged read in-session, so a second press is refused by the spent link rather than writing twice."""

        raw = await spieler_collection.find_one(
            build_spieler_adresswechsel_filter(token_hash=token_hash), projection=dict(SPIELER_ADRESSWECHSEL_ANSICHT_FIELDS), session=session
        )
        wechsel = None if raw is None else raw.get(SPIELER_ADRESSWECHSEL_FELD)
        refuse(find_spieler_token_unknown_refusal(found=isinstance(wechsel, dict)))
        assert raw is not None and isinstance(wechsel, dict)
        neue, ersetzte = spieler_adresswechsel_adressen(raw)

        if antwort_data.antwort == "abgelehnt":
            await discard_the_change_in_session(
                collection=Collection.SPIELER,
                spieler_collection=spieler_collection,
                schiedsrichter_collection=schiedsrichter_collection,
                aktionen_collection=aktionen_collection,
                db_filter={"_id": raw["_id"], **build_spieler_adresswechsel_filter(token_hash=token_hash)},
                stamp=stamp,
                session=session,
            )
            journal.note(
                JournalLine(
                    person_hash=loeschung_journal_hash(neue, schluessel=config.sperrliste_schluessel),
                    art="adresswechsel_abgelehnt",
                    collection=Collection.SPIELER,
                    record_id=raw["_id"],
                    am=stamp,
                )
            )
            return FLSpielerAdresswechselAntwortResponse(antwort="abgelehnt", wirksam_ab=None, mitteilung=None)

        gesperrt = await adressen_gesperrt(sperrliste, [neue, ersetzte], massgebliche_saison_id=massgebliche_saison_id, session=session)
        # In the view's order (`app/api/spieler/services.py :: spieler_adresswechsel_zustand_of`), so a refused press names
        # what a reload shows: the link's own address first, its holder being the barred person where both are barred.
        refuse(find_spieler_bestaetigung_gesperrt_refusal(gesperrt=neue in gesperrt))
        refuse(find_spieler_token_expired_refusal(block=wechsel, now=germany_now))
        # A row edited by hand alone holds a change and no address; confirming it would enter one.
        refuse(find_keine_adresse_refusal(email=raw.get("email")))
        refuse(find_spieler_ersetzte_adresse_gesperrt_refusal(gesperrt=ersetzte in gesperrt))
        vergeben = await another_pupil_holds(
            spieler_collection=spieler_collection, identifier=sign_in_identifier(neue), spieler_id=raw["_id"], session=session
        )
        refuse(find_adresse_vergeben_refusal(vergeben=vergeben))

        if wechsel.get("weg") == "wartezeit":
            await patch_one_in_db(
                collection=spieler_collection,
                db_filter={"_id": raw["_id"]},
                update=compose_wartezeit_update(now=germany_now),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )
            return FLSpielerAdresswechselAntwortResponse(antwort="bestaetigt", wirksam_ab=wirksam_ab_von(germany_now), mitteilung=None)

        bestand = await read_the_bestand(ersetzte, records=records, session=session)
        traeger = bestand.zeile(Collection.SPIELER, raw["_id"])
        assert traeger is not None
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

        return FLSpielerAdresswechselAntwortResponse(
            antwort="bestaetigt",
            wirksam_ab=None,
            mitteilung=FLAdresswechselMitteilung(bisherige_email=mitteilung.bisherige_email, vorname=mitteilung.vorname),
        )

    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(answer_for_the_mailbox)


@router.post(
    "/stopp",
    response_model=FLSpielerAdresswechselStoppResponse,
    summary="Stop one Spieler's pending address change",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
async def post_adresswechsel_stopp(
    stopp_data: Annotated[FLSpielerAdresswechselStoppPayload, Body()],
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLSpielerAdresswechselStoppResponse:
    """
    Stop the change the address on file was told of: the block goes, its new address out of every log image of the pupil.

    **Refused nothing but a token no pupil holds** (`REQ-SPIELER-001`): a stop hands nothing over, so it answers past every
    deadline, a barred address's holder too, for as long as the change stands, until it takes effect.
    """

    stopp_hash = hash_token(stopp_data.token)
    journal = Journal()

    @journal.attempted
    async def stop_the_change(session: AsyncClientSession) -> FLSpielerAdresswechselStoppResponse:
        raw = await spieler_collection.find_one(
            build_spieler_stopp_filter(stopp_hash=stopp_hash), projection={f"{SPIELER_ADRESSWECHSEL_FELD}.email": 1}, session=session
        )
        refuse(find_spieler_token_unknown_refusal(found=raw is not None))
        assert raw is not None

        await discard_the_change_in_session(
            collection=Collection.SPIELER,
            spieler_collection=spieler_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            aktionen_collection=aktionen_collection,
            db_filter={"_id": raw["_id"], **build_spieler_stopp_filter(stopp_hash=stopp_hash)},
            stamp=log_stamp(germany_now),
            session=session,
        )
        journal.note(
            ending_line(
                art="adresswechsel_gestoppt",
                neue=str(raw[SPIELER_ADRESSWECHSEL_FELD]["email"]),
                collection=Collection.SPIELER,
                record_id=raw["_id"],
                am=log_stamp(germany_now),
                schluessel=config.sperrliste_schluessel,
            )
        )

        return FLSpielerAdresswechselStoppResponse(gestoppt=True)

    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(stop_the_change)
