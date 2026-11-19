from fastapi import APIRouter, status
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.account.services import (
    changed_seat_choices,
    compose_seat_move,
    find_own_entry_refusal,
    press_withdrawal,
    withdrawal_line,
)
from app.api.identity.services import own_seats
from app.core.clock import utc_stamp
from app.core.collections import Collection
from app.core.crud import patch_past_the_version_in_db, refuse
from app.core.dependencies import BewerbungenCollection, DBClient, GermanyNow
from app.core.journal import Journal
from app.core.routing import by_id
from app.core.security import PERSON_TIER, PersonIdentifier
from app.core.transactions import transact
from app.shared.einwilligung_evidence import FLEinwilligungChoice
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.einwilligung import FLSeatEinwilligungPayload, by_choice
from app.shared.schemas.literals import KONTAKT_SEATS

# A person's route in place of `bind_actor`: a seat holder signs in by code and holds no grant, so the administrator's
# actor check would refuse every one of them.
router = APIRouter(prefix="/bewerbungen", dependencies=PERSON_TIER)


@router.patch(
    f"{by_id('bewerbung_id')}/einwilligung",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Withdraw a seat holder's own WhatsApp and media consent on a pending Bewerbung",
)
async def patch_einwilligung(
    bewerbung_id: CustomObjectId,
    einwilligung_data: FLSeatEinwilligungPayload,
    identifier: PersonIdentifier,
    bewerbungen_collection: BewerbungenCollection,
    db: DBClient,
    germany_now: GermanyNow,
) -> None:
    """Withdraw the signed-in person's WhatsApp and media consents on every seat they hold on this pending application; a grant is refused."""

    pressed: dict[FLEinwilligungChoice, object] = {"scope": einwilligung_data.scope, "media": einwilligung_data.media}
    # One instant for every attempt, so a retried transaction stamps the press as its first attempt did.
    at = utc_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def write(session: AsyncClientSession) -> None:
        # Pending alone: an accepted application's seats are its season row's, and a declined one is decided.
        bewerbung = await bewerbungen_collection.find_one(
            {"_id": bewerbung_id, "status": "submitted"},
            {f"kontakte.{seat}.{field}": 1 for seat in KONTAKT_SEATS for field in ("email", "einwilligung")},
            session=session,
        )
        seats = [] if bewerbung is None else own_seats(bewerbung, identifier)
        refuse(find_own_entry_refusal(held=bool(seats)))
        assert bewerbung is not None
        held = {seat: bewerbung["kontakte"][seat] for seat in seats}
        chosen = changed_seat_choices(blocks=[person["einwilligung"] for person in held.values()], pressed=pressed)

        # Withdraw-only: nothing on an application grants a panel to answer a grant against.
        await press_withdrawal(
            blocks=[person["einwilligung"] for person in held.values()],
            chosen=chosen,
            evidence_state=einwilligung_data.evidence_state.model_dump(),
        )

        update = compose_seat_move(
            seats={seat: person["einwilligung"] for seat, person in held.items()},
            chosen=chosen,
            at=at,
            text_versions=by_choice(einwilligung_data.text_versions),
        )
        if update is not None:
            # The person's own press, judged on the read above: an administrator's decision read before it still lands.
            await patch_past_the_version_in_db(
                collection=bewerbungen_collection, db_filter={"_id": bewerbung["_id"]}, update=update, session=session
            )
        if moved := withdrawal_line(blocks=[person["einwilligung"] for person in held.values()], chosen=chosen):
            journal.note("withdrawal", [f"{Collection.BEWERBUNGEN}/{bewerbung['_id']}"], choices=list(moved), seats=seats)

    async with journal:
        await transact(db, write)
