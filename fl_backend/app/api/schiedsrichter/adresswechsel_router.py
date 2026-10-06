from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.services import hash_token
from app.api.schiedsrichter.schemas import (
    FLSchiedsrichterAdresswechselAnsichtPayload,
    FLSchiedsrichterAdresswechselAnsichtResponse,
    FLSchiedsrichterAdresswechselPayload,
    FLSchiedsrichterAdresswechselResponse,
)
from app.api.schiedsrichter.services import (
    ADRESSWECHSEL_ANSICHT_FIELDS,
    ADRESSWECHSEL_FELD,
    adresswechsel_adressen,
    adresswechsel_zustand_of,
    build_adresswechsel_filter,
    compose_adresswechsel_antwort,
    find_bestaetigung_gesperrt_refusal,
    find_ersetzte_adresse_gesperrt_refusal,
    find_expired_token_refusal,
    find_unknown_token_refusal,
    frist_of,
    vorname_of,
)
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, sperrliste_saison
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import patch_many_in_db, patch_one_in_db, refuse
from app.core.dependencies import AktionenCollection, DBClient, SchiedsrichterCollection, get_german_date_str, get_germany_now
from app.core.exception_handlers import stores_nothing
from app.core.recording import build_redaction_filter, build_redaction_update, log_stamp
from app.core.security import bind_public_actor, verify_access_base
from app.core.transactions import transaction_session

# A router of its own beside the consent link's, for that one's reason: the token is the whole
# credential, so these two endpoints are base-tier and bind the public actor.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter/adresswechsel",
    dependencies=[Depends(verify_access_base), Depends(bind_public_actor)],
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
    sperrliste: SperrlisteLookup,
    today: str = Depends(get_german_date_str),
) -> FLSchiedsrichterAdresswechselAnsichtResponse:
    """
    Answer what this token opens: the referee's first name, the link's state and its deadline.

    **A first name and nothing else about the row** (`READ-REFEREE-003`): never either address, the school, the fee or the id. A POST
    that reads, so the token travels in a body and never in a second URL.

    Refuses only a token no referee holds (`REQ-SCHIEDSRICHTER-002`), which an answered, replaced or discarded change is too: an
    answer removes what the link opens. An expired link is SERVED in that state rather than refused, and the state is `gesperrt`,
    ahead of every other, wherever the ban list holds the address the link was mailed to (`REQ-SCHIEDSRICHTER-009`), and
    `nicht_bestaetigbar`, behind the deadline, wherever it holds the address the change would replace (`REQ-SCHIEDSRICHTER-010`):
    each state the confirmation would be refused in.
    """

    token_hash = hash_token(ansicht_data.token)

    # `find_one` rather than `pull_one_from_db`: a miss is this endpoint's own refusal, never a 404.
    raw = await schiedsrichter_collection.find_one(
        build_adresswechsel_filter(token_hash=token_hash), projection=dict(ADRESSWECHSEL_ANSICHT_FIELDS)
    )
    wechsel = None if raw is None else raw.get(ADRESSWECHSEL_FELD)
    frist = frist_of(wechsel)
    # An unreadable deadline is answered as the dead link, for the consent link's view's reason.
    refuse(find_unknown_token_refusal(found=isinstance(frist, str)))
    assert raw is not None and wechsel is not None

    # Both addresses in one read, so the page never offers a confirmation the press refuses.
    neue, ersetzte = adresswechsel_adressen(raw)
    gesperrt = await adressen_gesperrt(sperrliste, [neue, ersetzte])

    return FLSchiedsrichterAdresswechselAnsichtResponse(
        zustand=adresswechsel_zustand_of(wechsel=wechsel, today=today, gesperrt=neue in gesperrt, ersetzte_gesperrt=ersetzte in gesperrt),
        vorname=vorname_of(raw.get("name")),
        frist=frist,
    )


@router.post(
    "",
    response_model=FLSchiedsrichterAdresswechselResponse,
    summary="Confirm or decline one Schiedsrichter's pending address",
)
async def post_adresswechsel(
    antwort_data: Annotated[FLSchiedsrichterAdresswechselPayload, Body()],
    schiedsrichter_collection: SchiedsrichterCollection,
    sperrliste: SperrlisteLookup,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterAdresswechselResponse:
    """
    Record whether the mailbox this link was sent to is the referee's: `bestaetigt` moves their address to it, `abgelehnt` discards the change.

    Either answer ends the change, so the link opens nothing afterwards. The confirmation asks no consent and writes none: the
    consent record stands as the referee gave it, and only `kontakt.email` moves.

    Refuses a token no referee holds (`REQ-SCHIEDSRICHTER-002`), and a CONFIRMATION through a link whose deadline has passed
    (`REQ-SCHIEDSRICHTER-003`), one mailed to an address the ban list holds now (`REQ-SCHIEDSRICHTER-009`), and one whose change
    would replace an address the ban list holds now (`REQ-SCHIEDSRICHTER-010`), so a barred person cannot move their record off
    the address the ban keys on. **A decline is refused
    neither**: it removes an address nobody proved, which a lapsed or barred link has no reason to keep, and it empties every image
    the action log holds of this referee, those of every write while the change stood, a re-send included, carrying that address.
    """

    token_hash = hash_token(antwort_data.token)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await sperrliste_saison(sperrliste)

    async def answer_for_the_mailbox(session: AsyncClientSession) -> FLSchiedsrichterAdresswechselResponse:
        """Judge, then write, everything judged read in-session, so a second press is refused by the gone block rather than writing twice."""

        raw = await schiedsrichter_collection.find_one(
            build_adresswechsel_filter(token_hash=token_hash), projection=dict(ADRESSWECHSEL_ANSICHT_FIELDS), session=session
        )
        wechsel = None if raw is None else raw.get(ADRESSWECHSEL_FELD)
        refuse(find_unknown_token_refusal(found=isinstance(wechsel, dict)))
        assert raw is not None and isinstance(wechsel, dict)

        if antwort_data.antwort == "bestaetigt":
            refuse(find_expired_token_refusal(frist=frist_of(wechsel), today=today))
            neue, ersetzte = adresswechsel_adressen(raw)
            gesperrt = await adressen_gesperrt(sperrliste, [neue, ersetzte], massgebliche_saison_id=massgebliche_saison_id, session=session)
            # The link's own address first: where both are barred, its holder is the barred person.
            refuse(find_bestaetigung_gesperrt_refusal(gesperrt=neue in gesperrt))
            refuse(find_ersetzte_adresse_gesperrt_refusal(gesperrt=ersetzte in gesperrt))

        await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": raw["_id"]},
            update=compose_adresswechsel_antwort(antwort=antwort_data.antwort, email=wechsel.get("email")),
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

        if antwort_data.antwort == "abgelehnt":
            # LAST, for the contact's Widerspruch's reason: it reaches the pre-image the patch above
            # just filed, which still holds the address its holder disowned.
            await patch_many_in_db(
                collection=aktionen_collection,
                db_filter=build_redaction_filter([(Collection.SCHIEDSRICHTER, [raw["_id"]])]),
                update=build_redaction_update(at=log_stamp(germany_now)),
                session=session,
            )

        return FLSchiedsrichterAdresswechselResponse(antwort=antwort_data.antwort)

    async with transaction_session(db) as session:
        return await session.with_transaction(answer_for_the_mailbox)
