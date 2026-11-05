from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends, status
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.schiedsrichter.schemas import (
    FLSchiedsrichterConfirmationPayload,
    FLSchiedsrichterConfirmationResponse,
    FLSchiedsrichterConfirmationViewResponse,
)
from app.api.schiedsrichter.services import (
    BESTAETIGUNG_ANSICHT_FIELDS,
    BESTAETIGUNG_ANTWORT_FIELDS,
    BESTAETIGUNG_FELD,
    EINWILLIGUNG_FELD,
    build_token_filter,
    compose_confirmation_update,
    compose_decline_update,
    find_already_answered_refusal,
    find_alter_refusal,
    find_confirmation_barred_refusal,
    find_expired_token_refusal,
    find_medien_refusal,
    find_unknown_token_refusal,
    zustand_of,
)
from app.api.sperrliste.lookup import BanListLookup, ban_list_saison, barred_addresses
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, refuse
from app.core.dependencies import (
    DBClient,
    SchiedsrichterCollection,
    SchiedsrichterReadCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.recording import log_stamp
from app.core.routing import SAFE
from app.core.security import bind_public_actor, verify_access_base
from app.core.transactions import transaction_session
from app.shared.schemas.bounds import MEDIA_MIN_AGE_YEARS, SCHIEDSRICHTER_MIN_AGE_YEARS
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.schemas.einwilligung import by_choice
from app.shared.tokens import hash_token

# Beside the admin and person routers, each guarded whole: the token is the whole credential, so
# these three endpoints alone are base-tier and bind the public actor — no browser sends the
# `X-FL-Actor`.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter/confirmation",
    dependencies=[Depends(verify_access_base), Depends(bind_public_actor)],
)


@router.post(
    "/view",
    response_model=FLSchiedsrichterConfirmationViewResponse,
    summary="What one Schiedsrichter confirmation link opens",
    openapi_extra=SAFE,
)
async def get_confirmation_view(
    view_data: Annotated[FLTokenPayload, Body()],
    schiedsrichter_collection: SchiedsrichterReadCollection,
    ban_list: BanListLookup,
    today: str = Depends(get_german_date_str),
) -> FLSchiedsrichterConfirmationViewResponse:
    """
    Answer what this token opens: the link's state and deadline, and both age floors.

    **Nothing else** (`READ-REFEREE-002`): never a name, the school, the contact details, the fee, the birthdate or the
    entry's id, all of which are behind `READ-CONTACT-001`. The link went to an address an administrator typed and nobody has
    confirmed, which behind a typo is a stranger's. A POST that reads, so the token travels in a body and never in a second
    URL.

    Refuses only a token no referee holds (`link_invalid`): a confirmed or an expired link
    is SERVED in that state rather than refused, so a reopened link shows what became of it. The state is `barred`,
    ahead of every other, wherever the ban list holds the address the link was mailed to (`link_barred`),
    so the page offers a barred referee nothing to press.
    """

    token_hash = hash_token(view_data.token)

    # `find_one` rather than `pull_one_from_db`: a miss is this endpoint's own refusal, never a 404.
    raw = await schiedsrichter_collection.find_one(build_token_filter(token_hash=token_hash), projection=dict(BESTAETIGUNG_ANSICHT_FIELDS))
    refuse(find_unknown_token_refusal(found=raw is not None))
    assert raw is not None

    bestaetigung = raw[BESTAETIGUNG_FELD]
    einwilligung = raw.get(EINWILLIGUNG_FELD)

    barred = await barred_addresses(ban_list, [str((raw.get("kontakt") or {}).get("email") or "")])

    return FLSchiedsrichterConfirmationViewResponse(
        state=zustand_of(einwilligung=einwilligung, confirmation=bestaetigung, today=today, barred=bool(barred)),
        # Served rather than retyped on the page: the floor the write is judged by is the one the
        # paragraph a person reads before consenting has to state.
        minimum_age=SCHIEDSRICHTER_MIN_AGE_YEARS,
        media_minimum_age=MEDIA_MIN_AGE_YEARS,
        frist=bestaetigung["frist"],
    )


@router.post(
    "",
    response_model=FLSchiedsrichterConfirmationResponse,
    summary="Confirm one Schiedsrichter's entry and consent",
)
async def post_confirmation(
    antwort_data: Annotated[FLSchiedsrichterConfirmationPayload, Body()],
    schiedsrichter_collection: SchiedsrichterCollection,
    ban_list: BanListLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterConfirmationResponse:
    """
    Record a referee's own answer for the entry their link opens: their date of birth and the consent, in one update.

    The consent carries the publication scope they chose, the media answer beside it, the stamp and, on each choice's
    evidence, the wording they were shown. It reaches this one collection and writes nothing on any fixture: a referee's
    publication scope has one home, which the fixture list joins at read time to decide whether to publish the name each
    fixture stores.

    Refuses, in this order: a token no referee holds (`link_invalid`), an entry already answered, confirmed or
    declined (`confirmation_exists`), a link whose deadline has passed (`link_expired`), a link mailed to an address the ban
    list holds now, whenever the link was minted (`link_barred`), an age outside what this consent asks
    (`confirmation_age`), and a media consent from a referee below `media_minimum_age` (`media_age`) -- the last two
    judged before anything is written, so a mistyped year spends nothing.

    **The caller drops the cached fixture list after a successful answer**, which reads this record. Nothing here can:
    a withheld name would go on being served for as long as that entry lives.
    """

    token_hash = hash_token(antwort_data.token)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_barred`).
    governing_saison_id = await ban_list_saison(ban_list)

    async def answer_for_the_person(session: AsyncClientSession) -> FLSchiedsrichterConfirmationResponse:
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
        refuse(find_already_answered_refusal(einwilligung=raw.get(EINWILLIGUNG_FELD), confirmation=raw[BESTAETIGUNG_FELD]))
        refuse(find_expired_token_refusal(frist=raw[BESTAETIGUNG_FELD]["frist"], today=today))
        # Asked at the press rather than only at the mint: a ban entered after the link went out
        # stops it here, and one lifted while it runs lets it answer again.
        barred = await barred_addresses(
            ban_list, [str((raw.get("kontakt") or {}).get("email") or "")], governing_saison_id=governing_saison_id, session=session
        )
        refuse(find_confirmation_barred_refusal(barred=bool(barred)))
        refuse(find_alter_refusal(geburtsdatum=antwort_data.geburtsdatum, today=today))
        refuse(find_medien_refusal(geburtsdatum=antwort_data.geburtsdatum, media=antwort_data.media, today=today))

        await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": raw["_id"]},
            update=compose_confirmation_update(
                geburtsdatum=antwort_data.geburtsdatum,
                scope=antwort_data.scope,
                media=antwort_data.media,
                text_versions=by_choice(antwort_data.text_versions),
                today=today,
                at=log_stamp(germany_now),
            ),
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )

        # Read off the document the filter found rather than the update's echo: the echo carries the
        # whole row, and this answer is bounded to what the page renders.
        return FLSchiedsrichterConfirmationResponse(
            scope=antwort_data.scope,
            media=antwort_data.media,
            confirmed_at=today,
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(answer_for_the_person)


@router.post(
    "/decline",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Decline one Schiedsrichter's entry",
)
async def post_decline(
    decline_data: Annotated[FLTokenPayload, Body()],
    schiedsrichter_collection: SchiedsrichterCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> None:
    """
    Record the referee's objection to the entry their link opens: its day, and nothing else of the person.

    The entry then goes on the clock its link started, the midnight after the deadline, as the privacy notice says of an
    unconfirmed or declined one (`app/core/constraints.py :: TTL_INDEXES`). Until then no booking takes it and no
    re-send or reactivation asks the person again.

    Refuses, in the confirmation's order: a token no referee holds (`link_invalid`), an entry already answered,
    confirmed or declined (`confirmation_exists`), and a link whose deadline has passed (`link_expired`). The ban list
    is not asked: an objection gives the league nothing a ban withholds.
    """

    token_hash = hash_token(decline_data.token)

    async def object_for_the_person(session: AsyncClientSession) -> None:
        """Judge, then write, everything judged read in-session, so a second press is refused by the first answer."""

        raw = await schiedsrichter_collection.find_one(
            build_token_filter(token_hash=token_hash), projection=dict(BESTAETIGUNG_ANTWORT_FIELDS), session=session
        )
        refuse(find_unknown_token_refusal(found=raw is not None))
        assert raw is not None

        refuse(find_already_answered_refusal(einwilligung=raw.get(EINWILLIGUNG_FELD), confirmation=raw[BESTAETIGUNG_FELD]))
        refuse(find_expired_token_refusal(frist=raw[BESTAETIGUNG_FELD]["frist"], today=today))

        await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": raw["_id"]},
            update=compose_decline_update(today=today),
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )

    async with transaction_session(db) as session:
        await session.with_transaction(object_for_the_person)
