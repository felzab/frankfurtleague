from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.services import hash_token
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, sperrliste_saison
from app.api.spieler.crud import another_pupil_holds, discard_spieler_adresswechsel_in_session
from app.api.spieler.schemas import (
    FLSpielerAdresswechselAnsichtPayload,
    FLSpielerAdresswechselAnsichtResponse,
    FLSpielerAdresswechselAntwortPayload,
    FLSpielerAdresswechselAntwortResponse,
)
from app.api.spieler.services import (
    SPIELER_ADRESSWECHSEL_ANSICHT_FIELDS,
    SPIELER_ADRESSWECHSEL_FELD,
    build_spieler_adresswechsel_filter,
    compose_spieler_adresswechsel_antwort,
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
from app.core.dependencies import AktionenCollection, DBClient, SpielerCollection, get_german_date_str, get_germany_now
from app.core.exception_handlers import DUPLICATE_KEY_RESPONSE, stores_nothing
from app.core.journal import Journal, JournalLine
from app.core.recording import log_stamp
from app.core.security import bind_public_actor, loeschung_journal_hash, verify_access_base
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier

# A router of its own beside the admin one under the same prefix, for the referee's address link's
# reason (`app/api/schiedsrichter/adresswechsel_router.py`): the token is the whole credential, so
# these two endpoints are base-tier and bind the public actor.
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
    today: str = Depends(get_german_date_str),
) -> FLSpielerAdresswechselAnsichtResponse:
    """
    Answer what this token opens: the link's state and its deadline.

    **Nothing else about the row** (`READ-PUPIL-005`): never a name, either address or the id. A POST that reads, so the token
    travels in a body and never in a second URL.

    Refuses only a token no pupil holds (`REQ-SPIELER-001`), which an answered, replaced or discarded change is too: an answer
    removes what the link opens. An expired link is SERVED in that state rather than refused. The state is `gesperrt`, ahead
    of every other, wherever the ban list holds the address the link was mailed to, and `nicht_bestaetigbar`, behind the
    deadline, wherever it holds the address the change would replace, the pupil holds no address, or another pupil signs in on
    the new one: each state the confirmation would be refused in. Those three read alike here, though the press answers each by
    its own code; what keeps the link's holder from telling them apart is the edge, where `nginx/shared/site.conf` routes no
    public call to this service and the frontend's route handler for the link's page answers all three as this one state.
    """

    token_hash = hash_token(ansicht_data.token)

    # `find_one` rather than `pull_one_from_db`: a miss is this endpoint's own refusal, never a 404.
    raw = await spieler_collection.find_one(
        build_spieler_adresswechsel_filter(token_hash=token_hash), projection=dict(SPIELER_ADRESSWECHSEL_ANSICHT_FIELDS)
    )
    wechsel = None if raw is None else raw.get(SPIELER_ADRESSWECHSEL_FELD)
    frist = wechsel.get("frist") if isinstance(wechsel, dict) else None
    # An unreadable deadline is answered as the dead link, for the referee's view's reason.
    refuse(find_spieler_token_unknown_refusal(found=isinstance(frist, str)))
    assert raw is not None and isinstance(wechsel, dict) and isinstance(frist, str)

    # Every judgement the press makes, read here too, so the page never offers a confirmation the press refuses.
    neue, ersetzte = spieler_adresswechsel_adressen(raw)
    gesperrt = await adressen_gesperrt(sperrliste, [neue, ersetzte])
    vergeben = await another_pupil_holds(
        spieler_collection=spieler_collection, identifier=sign_in_identifier(neue), spieler_id=raw["_id"], session=None
    )

    return FLSpielerAdresswechselAnsichtResponse(
        zustand=spieler_adresswechsel_zustand_of(
            wechsel=wechsel,
            today=today,
            gesperrt=neue in gesperrt,
            ersetzte_gesperrt=ersetzte in gesperrt,
            keine_adresse=not holds_an_address(raw.get("email")),
            vergeben=vergeben,
        ),
        frist=frist,
    )


@router.post(
    "",
    response_model=FLSpielerAdresswechselAntwortResponse,
    summary="Confirm or decline one Spieler's pending address",
    # `uniq_spieler_email` answers the sentinel given the address by hand, which the in-session holder read passes over.
    # A rival committing after that read meets the write as a conflict, and the retry's read refuses it.
    responses={409: DUPLICATE_KEY_RESPONSE},
)
async def post_adresswechsel_antwort(
    antwort_data: Annotated[FLSpielerAdresswechselAntwortPayload, Body()],
    spieler_collection: SpielerCollection,
    sperrliste: SperrlisteLookup,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLSpielerAdresswechselAntwortResponse:
    """
    Record whether the mailbox this link was sent to is the pupil's: `bestaetigt` moves their address to it, `abgelehnt` discards the change.

    Either answer ends the change, so the link opens nothing afterwards. The confirmation stores the address as the sign-in
    compares it, asks no consent and writes none: the consent record stands as it was, and only `email` moves.

    Refuses a token no pupil holds (`REQ-SPIELER-001`), and a CONFIRMATION through a link whose deadline has passed
    (`REQ-SPIELER-002`), one mailed to an address the ban list holds now (`REQ-SPIELER-004`), one whose change would replace an
    address the ban list holds now (`REQ-SPIELER-005`), so a barred person cannot move their record off the address the ban
    keys on, one for a pupil who has come to hold no address (`REQ-SPIELER-008`), which a change corrects and never enters, and
    one to an address another pupil has come to sign in on (`REQ-SPIELER-006`). **A decline is refused none of these**: it
    removes an address nobody proved, and it takes that address out of every image the action log holds of this pupil, those of
    every write while the change stood, a re-send included. The rest of each image stays.

    The last three codes, and `DB-COMMON-002` for an address the erased pupils' sentinel was given by hand, tell a caller what
    the view's `nicht_bestaetigbar` keeps alike. Only the edge keeps them from the link's holder: `nginx/shared/site.conf` routes no public
    call to this service, and the frontend's route handler for the link's page answers all four as that one state.
    """

    token_hash = hash_token(antwort_data.token)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await sperrliste_saison(sperrliste)
    am = log_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def answer_for_the_mailbox(session: AsyncClientSession) -> FLSpielerAdresswechselAntwortResponse:
        """Judge, then write, everything judged read in-session, so a second press is refused by the gone block rather than writing twice."""

        raw = await spieler_collection.find_one(
            build_spieler_adresswechsel_filter(token_hash=token_hash), projection=dict(SPIELER_ADRESSWECHSEL_ANSICHT_FIELDS), session=session
        )
        wechsel = None if raw is None else raw.get(SPIELER_ADRESSWECHSEL_FELD)
        refuse(find_spieler_token_unknown_refusal(found=isinstance(wechsel, dict)))
        assert raw is not None and isinstance(wechsel, dict)

        if antwort_data.antwort == "bestaetigt":
            refuse(find_spieler_token_expired_refusal(frist=wechsel.get("frist"), today=today))
            neue, ersetzte = spieler_adresswechsel_adressen(raw)
            gesperrt = await adressen_gesperrt(sperrliste, [neue, ersetzte], massgebliche_saison_id=massgebliche_saison_id, session=session)
            # The link's own address first: where both are barred, its holder is the barred person.
            refuse(find_spieler_bestaetigung_gesperrt_refusal(gesperrt=neue in gesperrt))
            # A row edited by hand alone holds a change and no address; confirming it would enter one.
            refuse(find_keine_adresse_refusal(email=raw.get("email")))
            refuse(find_spieler_ersetzte_adresse_gesperrt_refusal(gesperrt=ersetzte in gesperrt))
            vergeben = await another_pupil_holds(
                spieler_collection=spieler_collection, identifier=sign_in_identifier(neue), spieler_id=raw["_id"], session=session
            )
            refuse(find_adresse_vergeben_refusal(vergeben=vergeben))

            await patch_one_in_db(
                collection=spieler_collection,
                db_filter={"_id": raw["_id"]},
                update=compose_spieler_adresswechsel_antwort(antwort=antwort_data.antwort, email=wechsel.get("email")),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )

            return FLSpielerAdresswechselAntwortResponse(antwort=antwort_data.antwort)

        # The discard's own body, for the referee's twin's reason.
        await discard_spieler_adresswechsel_in_session(
            spieler_collection=spieler_collection,
            aktionen_collection=aktionen_collection,
            db_filter={"_id": raw["_id"]},
            stamp=am,
            return_document=ReturnDocument.BEFORE,
            session=session,
        )
        hashed = loeschung_journal_hash(str(wechsel.get("email") or ""), schluessel=config.sperrliste_schluessel)
        journal.note(JournalLine(person_hash=hashed, art="adresswechsel_abgelehnt", collection=Collection.SPIELER, record_id=raw["_id"], am=am))

        return FLSpielerAdresswechselAntwortResponse(antwort=antwort_data.antwort)

    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(answer_for_the_mailbox)
