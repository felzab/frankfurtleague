from fastapi import APIRouter, status
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.schiedsrichter.crud import erase_referee_in_session
from app.api.schiedsrichter.schemas import (
    FLSchiedsrichterConfirmationPayload,
    FLSchiedsrichterConfirmationViewResponse,
)
from app.api.schiedsrichter.services import (
    CONFIRMATION_FIELD,
    CONFIRMATION_FIELDS,
    EINWILLIGUNG_FIELD,
    build_token_filter,
    compose_confirmation_update,
    confirmation_view,
    find_already_answered_refusal,
    find_expired_token_refusal,
)
from app.core.clock import utc_stamp
from app.core.collections import Collection
from app.core.crud import patch_past_the_version_in_db, pull_by_token, refuse, refuse_faults
from app.core.dependencies import (
    DBClient,
    GermanDay,
    GermanyNow,
    SchiedsrichterCollection,
    SchiedsrichterReadCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
)
from app.core.journal import Journal
from app.core.recording import ACT_BY_SCHIEDSRICHTER, record_act
from app.core.routing import SAFE
from app.core.security import BASE_TIER
from app.core.transactions import transact
from app.shared.einwilligung import find_self_media_refusal
from app.shared.links import find_age_refusal
from app.shared.schemas.bounds import SCHIEDSRICHTER_MIN_AGE_YEARS
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.schemas.einwilligung import by_choice
from app.shared.tokens import hash_token

# Beside the admin and person routers, each guarded whole: the token is the whole credential, so
# these three endpoints alone are base-tier.
router = APIRouter(
    prefix="/schiedsrichter/confirmation",
    dependencies=BASE_TIER,
)


@router.post(
    "/view",
    summary="What one Schiedsrichter confirmation link opens",
    openapi_extra=SAFE,
)
async def get_confirmation_view(
    view_data: FLTokenPayload,
    schiedsrichter_collection: SchiedsrichterReadCollection,
    today: GermanDay,
) -> FLSchiedsrichterConfirmationViewResponse:
    """What this token opens: the link's state, a standing link's deadline and age bounds, and a confirmed one's day.

    A confirmed or an expired link is served in that state rather than refused, so a reopened link shows what became of it;
    an objection erased the entry, so its link opens nothing.
    """

    # A POST that reads, so the token travels in a body and never in a URL.
    token_hash = hash_token(view_data.token)

    raw = await pull_by_token(
        collection=schiedsrichter_collection, db_filter=build_token_filter(token_hash=token_hash), projection=CONFIRMATION_FIELDS
    )

    return confirmation_view(einwilligung=raw.get(EINWILLIGUNG_FIELD), confirmation=raw[CONFIRMATION_FIELD], today=today)


@router.post(
    "",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Confirm one Schiedsrichter's entry and consent",
)
async def post_confirmation(
    answer_data: FLSchiedsrichterConfirmationPayload,
    schiedsrichter_collection: SchiedsrichterCollection,
    db: DBClient,
    today: GermanDay,
    germany_now: GermanyNow,
) -> None:
    """Record a referee's own answer for the entry their link opens: their date of birth and the consent, in one update.

    The caller drops the cached fixture list after a successful answer, or a withheld name goes on being served for as
    long as that entry lives.
    """

    token_hash = hash_token(answer_data.token)

    async def answer_for_the_person(session: AsyncClientSession) -> None:
        """One transaction for a single update, so a second press landing between the read and the write is refused by the stamp.

        Outside one, it would overwrite the answer already given.
        """

        raw = await pull_by_token(
            collection=schiedsrichter_collection,
            db_filter=build_token_filter(token_hash=token_hash),
            projection=CONFIRMATION_FIELDS,
            session=session,
        )

        # The stamp is asked first, as `state_of` ranks it: a person who answered on the last
        # valid day and presses again is told their answer stands, never that the link expired and
        # to ask for another.
        refuse(find_already_answered_refusal(einwilligung=raw.get(EINWILLIGUNG_FIELD)))
        refuse(find_expired_token_refusal(deadline=raw[CONFIRMATION_FIELD]["deadline"], today=today))
        age = find_age_refusal(birth_date=answer_data.birth_date, today=today, minimum_age=SCHIEDSRICHTER_MIN_AGE_YEARS)
        # The media switch is judged on the birthdate, which means nothing once refused.
        refuse_faults(
            age, None if age else find_self_media_refusal(saved=None, media=answer_data.media, birth_date=answer_data.birth_date, today=today)
        )

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

    await transact(db, answer_for_the_person)


@router.post(
    "/decline",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Decline one Schiedsrichter's entry",
)
async def post_decline(
    decline_data: FLTokenPayload,
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    db: DBClient,
    today: GermanDay,
    germany_now: GermanyNow,
) -> None:
    """Erase the entry the referee's link opens, on their objection, as a contact seat's objection empties the seat.

    The entry goes as the hourly pass erases one: its coming bookings removed, a played fixture's kept naming nobody.
    """

    token_hash = hash_token(decline_data.token)
    journal = Journal()

    @journal.attempted
    async def object_for_the_person(session: AsyncClientSession) -> None:
        """One transaction, so a consent landing between the read and the erasure conflicts rather than being erased unseen."""

        raw = await pull_by_token(
            collection=schiedsrichter_collection,
            db_filter=build_token_filter(token_hash=token_hash),
            projection=CONFIRMATION_FIELDS,
            session=session,
        )

        refuse(find_already_answered_refusal(einwilligung=raw.get(EINWILLIGUNG_FIELD)))
        refuse(find_expired_token_refusal(deadline=raw[CONFIRMATION_FIELD]["deadline"], today=today))

        await erase_referee_in_session(
            schiedsrichter_collection=schiedsrichter_collection,
            spiele_collection=spiele_collection,
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            schiedsrichter_id=raw["_id"],
            now=germany_now,
            session=session,
        )
        # Nameless, as the pass's erasure is: the entry it would name is gone.
        await record_act(collection=schiedsrichter_collection, action="schiedsrichter.objected", by=ACT_BY_SCHIEDSRICHTER, session=session)
        # The restore's replay reads the erased record's id off this line and erases it again.
        journal.note("objection", [f"{Collection.SCHIEDSRICHTER}/{raw['_id']}"])

    async with journal:
        await transact(db, object_for_the_person)
