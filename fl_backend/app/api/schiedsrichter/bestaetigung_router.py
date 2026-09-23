from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.services import hash_token
from app.api.schiedsrichter.schemas import (
    FLSchiedsrichterBestaetigungAnsichtPayload,
    FLSchiedsrichterBestaetigungAnsichtResponse,
    FLSchiedsrichterBestaetigungPayload,
    FLSchiedsrichterBestaetigungResponse,
)
from app.api.schiedsrichter.services import (
    BESTAETIGUNG_ANSICHT_FIELDS,
    BESTAETIGUNG_ANTWORT_FIELDS,
    BESTAETIGUNG_FELD,
    EINWILLIGUNG_FELD,
    build_token_filter,
    compose_confirmation_update,
    find_already_confirmed_refusal,
    find_alter_refusal,
    find_expired_token_refusal,
    find_medien_refusal,
    find_unknown_token_refusal,
    frist_of,
    vorname_of,
    zustand_of,
)
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, refuse
from app.core.dependencies import DBClient, SchiedsrichterCollection, get_german_date_str
from app.core.exception_handlers import stores_nothing
from app.core.security import bind_public_actor, verify_access_base
from app.shared.schemas.bounds import MEDIEN_MIN_AGE_YEARS, SCHIEDSRICHTER_MIN_AGE_YEARS

# A THIRD router beside the admin one and the reference read, both guarded whole: the token is the
# whole credential, so these two endpoints alone are base-tier and bind the public actor — no
# browser sends the `X-FL-Actor`.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter/bestaetigung",
    dependencies=[Depends(verify_access_base), Depends(bind_public_actor)],
)


@router.post(
    "/ansicht",
    response_model=FLSchiedsrichterBestaetigungAnsichtResponse,
    summary="What one Schiedsrichter confirmation link opens",
    dependencies=[Depends(stores_nothing)],
)
async def get_bestaetigung_ansicht(
    ansicht_data: Annotated[FLSchiedsrichterBestaetigungAnsichtPayload, Body()],
    schiedsrichter_collection: SchiedsrichterCollection,
    today: str = Depends(get_german_date_str),
) -> FLSchiedsrichterBestaetigungAnsichtResponse:
    """
    Answer what this token opens: the referee's first name, the link's state and deadline, both age floors, and the wording's version.

    **A first name and a role, and nothing else** (`READ-REFEREE-002`): never the full name, the school, the contact
    details, the fee, the birthdate or the entry's id, all of which are behind `READ-CONTACT-001`. A POST that reads, so the
    token travels in a body and never in a second URL.

    Refuses only a token no referee holds (`REQ-SCHIEDSRICHTER-002`): a confirmed or an expired link
    is SERVED in that state rather than refused, so a reopened link shows what became of it.
    """

    token_hash = hash_token(ansicht_data.token)

    # `find_one` rather than `pull_one_from_db`: a miss is this endpoint's own refusal, never a 404.
    raw = await schiedsrichter_collection.find_one(build_token_filter(token_hash=token_hash), projection=dict(BESTAETIGUNG_ANSICHT_FIELDS))
    bestaetigung = None if raw is None else raw.get(BESTAETIGUNG_FELD)
    frist = frist_of(bestaetigung)
    # A matched row carries the block its hash sits in, so an unreadable deadline is a shape no
    # validator admits: answered as the dead link rather than as the string "None", which the
    # response model 500s on.
    refuse(find_unknown_token_refusal(found=isinstance(frist, str)))
    assert raw is not None

    einwilligung = raw.get(EINWILLIGUNG_FELD)

    return FLSchiedsrichterBestaetigungAnsichtResponse(
        zustand=zustand_of(einwilligung=einwilligung, bestaetigung=bestaetigung, today=today),
        vorname=vorname_of(raw.get("name")),
        text_version=None if not isinstance(einwilligung, dict) else einwilligung.get("text_version"),
        # Served rather than retyped on the page: the floor the write is judged by is the one the
        # paragraph a person reads before consenting has to state.
        mindestalter=SCHIEDSRICHTER_MIN_AGE_YEARS,
        medien_mindestalter=MEDIEN_MIN_AGE_YEARS,
        frist=frist,
    )


@router.post("", response_model=FLSchiedsrichterBestaetigungResponse, summary="Confirm one Schiedsrichter's entry and consent")
async def post_bestaetigung(
    antwort_data: Annotated[FLSchiedsrichterBestaetigungPayload, Body()],
    schiedsrichter_collection: SchiedsrichterCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSchiedsrichterBestaetigungResponse:
    """
    Record a referee's own answer for the entry their link opens: their date of birth and the consent, in one update.

    The consent carries the publication scope they chose, the media answer beside it, the stamp and the wording they were
    shown. It reaches this one collection and writes nothing on any fixture: a referee's publication scope has one home,
    and the fixture list reads it there.

    Refuses, in this order: a token no referee holds (`REQ-SCHIEDSRICHTER-002`), an entry already confirmed
    (`REQ-SCHIEDSRICHTER-004`), a link whose deadline has passed (`REQ-SCHIEDSRICHTER-003`), an age outside what this
    consent asks (`REQ-SCHIEDSRICHTER-005`), and a media consent from a referee below `medien_mindestalter`
    (`REQ-SCHIEDSRICHTER-008`) -- the last two judged before anything is written, so a mistyped year spends nothing.

    **The caller drops the cached fixture list after a successful answer.** Nothing here can: a withheld
    name goes on being served for as long as that entry lives.
    """

    token_hash = hash_token(antwort_data.token)

    async def answer_for_the_person(session: AsyncClientSession) -> FLSchiedsrichterBestaetigungResponse:
        """Judge, then write, everything judged read in-session.

        One transaction for a single update, so a second press landing between the read and the
        write is refused by the stamp rather than overwriting the answer already given.
        """

        raw = await schiedsrichter_collection.find_one(
            build_token_filter(token_hash=token_hash), projection=dict(BESTAETIGUNG_ANTWORT_FIELDS), session=session
        )
        refuse(find_unknown_token_refusal(found=raw is not None))
        assert raw is not None

        # The STAMP is asked first, as `zustand_of` ranks it: a person who answered on the last
        # valid day and presses again is told their answer stands, never that the link expired and
        # to ask for another.
        refuse(find_already_confirmed_refusal(einwilligung=raw.get(EINWILLIGUNG_FELD)))
        refuse(find_expired_token_refusal(frist=frist_of(raw.get(BESTAETIGUNG_FELD)), today=today))
        refuse(find_alter_refusal(geburtsdatum=antwort_data.geburtsdatum, today=today))
        refuse(find_medien_refusal(geburtsdatum=antwort_data.geburtsdatum, medien=antwort_data.medien, today=today))

        await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": raw["_id"]},
            update=compose_confirmation_update(
                geburtsdatum=antwort_data.geburtsdatum,
                umfang=antwort_data.umfang,
                medien=antwort_data.medien,
                text_version=antwort_data.text_version,
                today=today,
            ),
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

        # Read off the document the filter found rather than the update's echo: the echo carries the
        # whole row, and this answer is bounded to what the page renders.
        return FLSchiedsrichterBestaetigungResponse(
            vorname=vorname_of(raw.get("name")),
            umfang=antwort_data.umfang,
            medien=antwort_data.medien,
            bestaetigt_am=today,
        )

    async with db.start_session() as session:
        return await session.with_transaction(answer_for_the_person)
