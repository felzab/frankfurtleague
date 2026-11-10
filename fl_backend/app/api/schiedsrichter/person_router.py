from datetime import datetime
from http import HTTPStatus
from typing import Annotated

from fastapi import APIRouter, Body, Depends, status
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.account.crud import press_einwilligung
from app.api.account.services import (
    compose_person_move,
    compose_schiedsrichter_self,
    find_own_entry_refusal,
    withdrawal_line,
)
from app.api.identity.crud import roles_of
from app.api.identity.lookup import SubjectLookup
from app.api.identity.services import is_own_schiedsrichter, may_grant_on_schiedsrichter
from app.api.saisons.schemas import FLOwnSaisonsResponse
from app.api.schiedsrichter.schemas import FLSchiedsrichterSelfResponse, FLSchiedsrichterSpieleResponse
from app.api.schiedsrichter.services import EINWILLIGUNG_FIELD, build_self_referee_filter, build_self_referee_pipeline
from app.core.clock import utc_stamp
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, patch_one_in_db, refuse
from app.core.dependencies import (
    DBClient,
    SchiedsrichterCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exceptions import APIError
from app.core.journal import Journal
from app.core.routing import by_id
from app.core.security import PersonIdentifier, get_person_identifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung_evidence import FLEinwilligungChoice
from app.shared.schemas.custom import CustomRouteObjectId
from app.shared.schemas.einwilligung import FLSchiedsrichterAccountEinwilligungPayload, by_choice

# A person's own router, apart from the admin one and the confirmation one.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter",
    dependencies=[Depends(verify_access_admin), Depends(get_person_identifier)],
)


@router.get("/self", response_model=FLSchiedsrichterSelfResponse, summary="A signed-in referee's own records")
async def get_self(identifier: PersonIdentifier, schiedsrichter_collection: SchiedsrichterCollection) -> FLSchiedsrichterSelfResponse:
    """
    Answer every confirmed referee record the signed-in address holds, with its stored contact details.

    PERSON TIER: the fee set for them per fixture as `payment`, never the confirmation link's bookkeeping. A retired
    record is served too. Its consent is the account page's (`GET /account/einwilligungen`), so none is served here.

    Refuses an address holding no confirmed referee record (`role_not_held`).
    """

    rows = await aggregate_many_from_db(collection=schiedsrichter_collection, pipeline=build_self_referee_pipeline(identifier))
    eigene = [row for row in rows if is_own_schiedsrichter(row, identifier)]
    refuse(find_own_entry_refusal(held=bool(eigene)))

    return FLSchiedsrichterSelfResponse.model_validate({"schiedsrichter": [compose_schiedsrichter_self(row) for row in eigene]})


@router.patch(
    f"/account{by_id('schiedsrichter_id')}/einwilligung",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Change a signed-in referee's own publication and media consent",
)
async def patch_einwilligung(
    schiedsrichter_id: CustomRouteObjectId,
    einwilligung_data: Annotated[FLSchiedsrichterAccountEinwilligungPayload, Body()],
    identifier: PersonIdentifier,
    schiedsrichter_collection: SchiedsrichterCollection,
    records: SubjectLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> None:
    """
    Set the two choices of one of the signed-in referee's own consent records: the publication scope and the media consent.

    Writes those two on this one referee row, each moved choice with its evidence (`evidence.<choice>`), and nothing
    else: the confirmation day, the day given and the wording they confirmed stand, and no fixture is written. The
    public fixture list reads the scope off this row, so a withdrawal takes the name off every fixture page at that
    list's next read. A PATCH moving neither choice writes nothing. A GRANT (`scope` to
    `kader_public` or `media` to `true`) is taken on a live record alone; a withdrawal on a retired one too.

    Refuses, in this order: an id that is no confirmed referee record of this address (`role_not_held`); a
    `evidence_state` other than the record's own, either choice having moved since the page was served
    (`choices_stale`); a grant on a retired record (`giving_not_allowed`); a choice moving onto a grant under a label
    other than its current wording's, the page loaded before a rewording (`grant_wording_stale`); `media` moving to
    `true` where the stored birthdate does not reach `MEDIA_MIN_AGE_YEARS` today or is missing (`media_age`). Each
    refusal writes nothing.

    **The caller drops the cached fixture list after a successful answer**, which reads this row; nothing here can.
    """

    own_entry = build_self_referee_filter(identifier, schiedsrichter_id=schiedsrichter_id)
    chosen: dict[FLEinwilligungChoice, object] = {"scope": einwilligung_data.scope, "media": einwilligung_data.media}
    at = utc_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def write(session: AsyncClientSession) -> None:
        row = await schiedsrichter_collection.find_one(
            own_entry, projection={"kontakt.email": 1, "birth_date": 1, EINWILLIGUNG_FIELD: 1}, session=session
        )
        # The fold decides, as it does for the read: the filter's pattern is the wider rule.
        refuse(find_own_entry_refusal(held=row is not None and is_own_schiedsrichter(row, identifier)))
        assert row is not None
        saved = row[EINWILLIGUNG_FIELD]

        async def may_give() -> bool:
            return may_grant_on_schiedsrichter(await roles_of(identifier, records, session=session), schiedsrichter_id)

        await press_einwilligung(
            blocks=[saved],
            birth_dates=[row.get("birth_date")],
            chosen=chosen,
            evidence_state=einwilligung_data.evidence_state.model_dump(),
            text_versions=einwilligung_data.text_versions,
            may_give=may_give,
            today=today,
        )

        update = compose_person_move(saved=saved, chosen=chosen, at=at, text_versions=by_choice(einwilligung_data.text_versions))
        if update is not None:
            await patch_one_in_db(
                collection=schiedsrichter_collection,
                db_filter={"_id": row["_id"]},
                update=update,
                session=session,
                expected_version=None,
                return_document=ReturnDocument.BEFORE,
            )
        choices = withdrawal_line(blocks=[saved], chosen=chosen)
        if choices is not None:
            journal.note("withdrawal", [f"{Collection.SCHIEDSRICHTER}/{row['_id']}"], choices=list(choices))

    async with journal:
        async with transaction_session(db) as session:
            await session.with_transaction(write)


@router.get(
    "/self/spiele/{saison_id}",
    response_model=FLSchiedsrichterSpieleResponse,
    summary="A signed-in referee's fixtures of one season, one row a fixture",
)
async def get_self_spiele(saison_id: str, identifier: PersonIdentifier) -> FLSchiedsrichterSpieleResponse:
    """
    Every fixture of this season booked to one of the signed-in address's live, confirmed referee records, one row a fixture.

    Each with the fixture as it stands, the state of the booking they were asked to confirm and the row an answer names,
    their own decline's reason, whether the league recorded the answer for them, whether the fixture takes a report
    today, and when its report was first sent. Nobody's address is served, and no reason an administrator entered.

    Refuses an address holding no live, confirmed referee record (`role_not_held`).
    """

    # Session 8: the read goes from the referee's own records to the season's fixtures booking them, each joined to
    # its newest confirmation row and its report.
    raise APIError(HTTPStatus.NOT_IMPLEMENTED, Code.UNHANDLED_CRASH)


@router.get("/self/saisons", response_model=FLOwnSaisonsResponse, summary="The seasons a signed-in referee has fixtures in")
async def get_self_saisons(identifier: PersonIdentifier) -> FLOwnSaisonsResponse:
    """
    Every season in which a fixture is booked to one of the signed-in address's live, confirmed referee records, the newest first.

    A planned season is served as any other. Refuses an address holding no live, confirmed referee record
    (`role_not_held`).
    """

    # Session 8: the read goes from the referee's own records to the seasons of the fixtures booking them.
    raise APIError(HTTPStatus.NOT_IMPLEMENTED, Code.UNHANDLED_CRASH)
