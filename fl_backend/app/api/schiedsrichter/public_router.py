from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends, status
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.einwilligung.services import find_self_media_refusal
from app.api.schiedsrichter.schemas import (
    FLSchiedsrichterConfirmationPayload,
    FLSchiedsrichterConfirmationResponse,
    FLSchiedsrichterConfirmationViewResponse,
)
from app.api.schiedsrichter.services import (
    CONFIRMATION_ANSWER_FIELDS,
    CONFIRMATION_FIELD,
    CONFIRMATION_VIEW_FIELDS,
    EINWILLIGUNG_FIELD,
    answered_at_of,
    build_token_filter,
    compose_confirmation_update,
    compose_decline_update,
    find_age_refusal,
    find_already_answered_refusal,
    find_expired_token_refusal,
    find_unknown_token_refusal,
    state_of,
)
from app.core.clock import utc_stamp
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import patch_past_the_version_in_db, refuse
from app.core.dependencies import (
    DBClient,
    SchiedsrichterCollection,
    SchiedsrichterReadCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.journal import Journal
from app.core.routing import SAFE
from app.core.security import verify_access_base
from app.core.transactions import transaction_session
from app.shared.schemas.bounds import BEWERBUNG_KONTAKT_MAX_AGE_YEARS, SCHIEDSRICHTER_MIN_AGE_YEARS
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.schemas.einwilligung import by_choice
from app.shared.tokens import hash_token

# Beside the admin and person routers, each guarded whole: the token is the whole credential, so
# these three endpoints alone are base-tier.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter/confirmation",
    dependencies=[Depends(verify_access_base)],
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
    today: str = Depends(get_german_date_str),
) -> FLSchiedsrichterConfirmationViewResponse:
    """What this token opens: the link's state and deadline, the age bounds and the day of the person's own answer.

    A confirmed or an expired link is served in that state rather than refused, so a reopened link shows what became of it.
    """

    # A POST that reads, so the token travels in a body and never in a URL.
    token_hash = hash_token(view_data.token)

    # `find_one` rather than `pull_one_from_db`: a miss is this endpoint's own refusal, never a 404.
    raw = await schiedsrichter_collection.find_one(build_token_filter(token_hash=token_hash), projection=dict(CONFIRMATION_VIEW_FIELDS))
    refuse(find_unknown_token_refusal(found=raw is not None))
    assert raw is not None

    block = raw[CONFIRMATION_FIELD]
    einwilligung = raw.get(EINWILLIGUNG_FIELD)

    state = state_of(einwilligung=einwilligung, confirmation=block, today=today)

    return FLSchiedsrichterConfirmationViewResponse(
        state=state,
        # Served rather than retyped on the page: the floor the write is judged by is the one the
        # paragraph a person reads before consenting has to state.
        minimum_age=SCHIEDSRICHTER_MIN_AGE_YEARS,
        maximum_age=BEWERBUNG_KONTAKT_MAX_AGE_YEARS,
        deadline=block["deadline"],
        answered_at=answered_at_of(state=state, einwilligung=einwilligung, confirmation=block),
    )


@router.post(
    "",
    response_model=FLSchiedsrichterConfirmationResponse,
    summary="Confirm one Schiedsrichter's entry and consent",
)
async def post_confirmation(
    answer_data: Annotated[FLSchiedsrichterConfirmationPayload, Body()],
    schiedsrichter_collection: SchiedsrichterCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterConfirmationResponse:
    """Record a referee's own answer for the entry their link opens: their date of birth and the consent, in one update.

    The caller drops the cached fixture list after a successful answer, or a withheld name goes on being served for as
    long as that entry lives.
    """

    token_hash = hash_token(answer_data.token)

    async def answer_for_the_person(session: AsyncClientSession) -> FLSchiedsrichterConfirmationResponse:
        """Judge, then write, everything judged read in-session.

        One transaction for a single update, so a second press landing between the read and the
        write is refused by the stamp rather than overwriting the answer already given.
        """

        raw = await schiedsrichter_collection.find_one(
            build_token_filter(token_hash=token_hash), projection=dict(CONFIRMATION_ANSWER_FIELDS), session=session
        )
        refuse(find_unknown_token_refusal(found=raw is not None))
        assert raw is not None

        # The stamp is asked first, as `state_of` ranks it: a person who answered on the last
        # valid day and presses again is told their answer stands, never that the link expired and
        # to ask for another.
        refuse(find_already_answered_refusal(einwilligung=raw.get(EINWILLIGUNG_FIELD), confirmation=raw[CONFIRMATION_FIELD]))
        refuse(find_expired_token_refusal(deadline=raw[CONFIRMATION_FIELD]["deadline"], today=today))
        refuse(find_age_refusal(birth_date=answer_data.birth_date, today=today))
        refuse(find_self_media_refusal(saved=None, media=answer_data.media, birth_date=answer_data.birth_date, today=today))

        # The person's own press, judged on the read above, on fields the referee editor never saves: an editor's save
        # read before it still lands. No fixture is written: the scope has one home, which the fixture list joins at read
        # time.
        await patch_past_the_version_in_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": raw["_id"]},
            update=compose_confirmation_update(
                birth_date=answer_data.birth_date,
                scope=answer_data.scope,
                media=answer_data.media,
                text_versions=by_choice(answer_data.text_versions),
                today=today,
                at=utc_stamp(germany_now),
            ),
            session=session,
        )

        # The press's own answer rather than the stored row, which carries the whole referee: this answer is bounded to
        # what the page renders.
        return FLSchiedsrichterConfirmationResponse(
            scope=answer_data.scope,
            media=answer_data.media,
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
    """Record the referee's objection to the entry their link opens: its day, and nothing else of the person.

    The entry is erased at the midnight after its link's deadline, and until then no booking takes it and nobody asks
    the person again.
    """

    token_hash = hash_token(decline_data.token)
    journal = Journal()

    @journal.attempted
    async def object_for_the_person(session: AsyncClientSession) -> None:
        """Judge, then write, everything judged read in-session, so a second press is refused by the first answer."""

        raw = await schiedsrichter_collection.find_one(
            build_token_filter(token_hash=token_hash), projection=dict(CONFIRMATION_ANSWER_FIELDS), session=session
        )
        refuse(find_unknown_token_refusal(found=raw is not None))
        assert raw is not None

        refuse(find_already_answered_refusal(einwilligung=raw.get(EINWILLIGUNG_FIELD), confirmation=raw[CONFIRMATION_FIELD]))
        refuse(find_expired_token_refusal(deadline=raw[CONFIRMATION_FIELD]["deadline"], today=today))

        # Past the count: the objection's day is no field the editor saves.
        await patch_past_the_version_in_db(
            collection=schiedsrichter_collection, db_filter={"_id": raw["_id"]}, update=compose_decline_update(today=today), session=session
        )
        journal.note("objection", [f"{Collection.SCHIEDSRICHTER}/{raw['_id']}"])

    async with journal:
        async with transaction_session(db) as session:
            await session.with_transaction(object_for_the_person)
