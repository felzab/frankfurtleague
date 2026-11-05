from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends, status
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.account.crud import press_withdrawal
from app.api.account.services import (
    changed_seat_choices,
    compose_seat_move,
    find_own_entry_refusal,
    withdrawal_line,
)
from app.api.identity.services import own_seats
from app.api.sperrliste.guard import PERSON_ACTOR_BINDERS, KontaktIdentifier
from app.core.collections import Collection
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import patch_one_in_db, refuse
from app.core.dependencies import BewerbungenCollection, DBClient, get_germany_now
from app.core.journal import Journal
from app.core.recording import log_stamp
from app.core.security import erasure_journal_hash, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung_evidence import FLEinwilligungChoice
from app.shared.schemas.custom import CustomRouteObjectId
from app.shared.schemas.einwilligung import FLSeatEinwilligungPayload, by_choice
from app.shared.schemas.literals import KONTAKT_ROLLEN

# The person lane's binder, as `app/api/teams/person_router.py` declares it and for its reason.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/bewerbungen",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["kontakt"])],
)


# `/account/einwilligung`, its own segment, for `app/api/teams/person_router.py :: get_team_sitze`'s reason.
@router.patch(
    "/{bewerbung_id:objectid}/account/einwilligung",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Withdraw a seat holder's own WhatsApp and media consent on a pending Bewerbung",
)
async def patch_einwilligung(
    bewerbung_id: CustomRouteObjectId,
    einwilligung_data: Annotated[FLSeatEinwilligungPayload, Body()],
    identifier: KontaktIdentifier,
    bewerbungen_collection: BewerbungenCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> None:
    """Withdraw the signed-in person's WhatsApp and media consents on every seat they hold on this pending application.

    A grant is refused. Refuses, writing nothing: `role_not_held`, `choices_stale` and
    `giving_not_allowed`.
    """

    pressed: dict[FLEinwilligungChoice, object] = {"umfang": einwilligung_data.umfang, "media": einwilligung_data.media}
    # For `app/api/spieler/person_router.py :: patch_einwilligung`'s reason: a replay stamps the moment the person pressed.
    at = log_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def write(session: AsyncClientSession) -> None:
        # Pending alone: an accepted application's seats are its season row's, and a declined one is decided.
        bewerbung = await bewerbungen_collection.find_one(
            {"_id": bewerbung_id, "status": "submitted"},
            {f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_ROLLEN for field in ("email", "einwilligung")},
            session=session,
        )
        rollen = [] if bewerbung is None else own_seats(bewerbung, identifier)
        refuse(find_own_entry_refusal(held=bool(rollen)))
        assert bewerbung is not None
        seats = {slot: bewerbung["kontakte"][slot] for slot in rollen}
        chosen = changed_seat_choices(blocks=[seat["einwilligung"] for seat in seats.values()], pressed=pressed)

        # Withdraw-only: nothing on an application grants a panel to answer a grant against.
        await press_withdrawal(
            blocks=[seat["einwilligung"] for seat in seats.values()],
            chosen=chosen,
            evidence_state=einwilligung_data.evidence_state.model_dump(),
        )

        update = compose_seat_move(
            seats={slot: seat["einwilligung"] for slot, seat in seats.items()},
            chosen=chosen,
            at=at,
            text_versions=by_choice(einwilligung_data.text_versions),
        )
        if update is not None:
            await patch_one_in_db(
                collection=bewerbungen_collection,
                db_filter={"_id": bewerbung["_id"]},
                update=update,
                session=session,
                return_document=ReturnDocument.BEFORE,
            )
        line = withdrawal_line(
            person_hash=erasure_journal_hash(identifier, key=config.sperrliste_key),
            collection=Collection.BEWERBUNGEN,
            record_id=bewerbung["_id"],
            blocks=[seat["einwilligung"] for seat in seats.values()],
            chosen=chosen,
            at=at,
            text_versions=by_choice(einwilligung_data.text_versions),
        )
        if line is not None:
            journal.note(line)

    async with journal:
        async with transaction_session(db) as session:
            await session.with_transaction(write)
