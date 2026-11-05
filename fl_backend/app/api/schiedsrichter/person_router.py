from datetime import datetime
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
from app.api.schiedsrichter.schemas import (
    FLSchiedsrichterSelfResponse,
)
from app.api.schiedsrichter.services import EINWILLIGUNG_FELD, build_self_referee_filter, build_self_referee_pipeline
from app.api.sperrliste.guard import PERSON_ACTOR_BINDERS, SchiedsrichterIdentifier
from app.core.collections import Collection
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import aggregate_many_from_db, patch_one_in_db, refuse
from app.core.dependencies import (
    DBClient,
    SchiedsrichterCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.journal import Journal
from app.core.recording import log_stamp
from app.core.routing import by_id
from app.core.security import erasure_journal_hash, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung_evidence import FLEinwilligungChoice
from app.shared.schemas.custom import CustomRouteObjectId
from app.shared.schemas.einwilligung import FLSchiedsrichterAccountEinwilligungPayload, by_choice

# A person's own router, apart from the admin one and the confirmation one, each binding its own actor
# at router level: this one records every write under the referee's Funktion.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["schiedsrichter"])],
)


@router.get("/self", response_model=FLSchiedsrichterSelfResponse, summary="A signed-in referee's own records")
async def get_self(identifier: SchiedsrichterIdentifier, schiedsrichter_collection: SchiedsrichterCollection) -> FLSchiedsrichterSelfResponse:
    """
    Answer every confirmed referee record the signed-in address holds, with its stored contact details.

    PERSON TIER: the fee set for them per fixture as `honorar`, never the confirmation link's bookkeeping. A retired
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
    identifier: SchiedsrichterIdentifier,
    schiedsrichter_collection: SchiedsrichterCollection,
    records: SubjectLookup,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> None:
    """
    Set the two choices of one of the signed-in referee's own consent records: the publication scope and the media consent.

    Writes those two on this one referee row, each moved choice with its evidence (`evidence.<choice>`), and nothing
    else: the confirmation day, the day given and the wording they confirmed stand, and no fixture is written. The
    public fixture list reads the scope off this row, so a withdrawal takes the name off every fixture page at that
    list's next read. A PATCH moving neither choice writes nothing. A GRANT (`umfang` to
    `kader_oeffentlich` or `media` to `true`) is taken on a live record alone; a withdrawal on a retired one too.

    Refuses, in this order: an id that is no confirmed referee record of this address (`role_not_held`); a
    `evidence_state` other than the record's own, either choice having moved since the page was served
    (`choices_stale`); a grant on a retired record (`giving_not_allowed`); a choice moving onto a grant under a label
    other than its current wording's, the page loaded before a rewording (`grant_wording_stale`); `media` moving to
    `true` where the stored birthdate does not reach `MEDIA_MIN_AGE_YEARS` today or is missing (`media_age`). Each
    refusal writes nothing.

    **The caller drops the cached fixture list after a successful answer**, which reads this row; nothing here can.
    """

    eigener_eintrag = build_self_referee_filter(identifier, schiedsrichter_id=schiedsrichter_id)
    chosen: dict[FLEinwilligungChoice, object] = {"umfang": einwilligung_data.umfang, "media": einwilligung_data.media}
    # For `app/api/spieler/person_router.py :: patch_einwilligung`'s reason: a replay stamps the moment the person pressed.
    at = log_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def write(session: AsyncClientSession) -> None:
        row = await schiedsrichter_collection.find_one(
            eigener_eintrag, projection={"kontakt.email": 1, "geburtsdatum": 1, EINWILLIGUNG_FELD: 1}, session=session
        )
        # The fold decides, as it does for the read: the filter's pattern is the wider rule.
        refuse(find_own_entry_refusal(held=row is not None and is_own_schiedsrichter(row, identifier)))
        assert row is not None
        saved = row[EINWILLIGUNG_FELD]

        async def may_give() -> bool:
            return may_grant_on_schiedsrichter(await roles_of(identifier, records, session=session), schiedsrichter_id)

        await press_einwilligung(
            blocks=[saved],
            birth_dates=[row.get("geburtsdatum")],
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
                return_document=ReturnDocument.BEFORE,
            )
        line = withdrawal_line(
            person_hash=erasure_journal_hash(identifier, key=config.sperrliste_key),
            collection=Collection.SCHIEDSRICHTER,
            record_id=row["_id"],
            blocks=[saved],
            chosen=chosen,
            at=at,
            text_versions=by_choice(einwilligung_data.text_versions),
        )
        if line is not None:
            journal.note(line)

    async with journal:
        async with transaction_session(db) as session:
            await session.with_transaction(write)
