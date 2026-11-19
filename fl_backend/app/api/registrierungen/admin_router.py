from collections.abc import Mapping
from typing import Any

from fastapi import APIRouter, status
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.account.services import held_by_the_record, withdraw_by_mail
from app.api.grants.guard import ADMIN_TIER
from app.core.collections import Collection
from app.core.dependencies import DBClient, GermanyNow, RegistrierungenCollection
from app.core.recording import record_act
from app.core.routing import by_id
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.einwilligung import WITHHELD_BY_A_PERSON, FLEinwilligungWithdrawalPayload

# Admin-guarded, not base: a registration holds a pupil's name, their address and, once they have confirmed, their date
# of birth. The public and person routers share this prefix at their own tiers.
router = APIRouter(
    prefix="/registrierungen",
    dependencies=ADMIN_TIER,
)


@router.post(
    f"{by_id('registrierung_id')}/einwilligung/withdrawal",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Enter a withdrawal of a registration's consent that its pupil asked for by mail",
)
async def withdraw_registrierung_einwilligung(
    registrierung_id: CustomObjectId,
    withdrawal_data: FLEinwilligungWithdrawalPayload,
    registrierungen_collection: RegistrierungenCollection,
    db: DBClient,
    germany_now: GermanyNow,
) -> None:
    """Withdraw the named choices of the consent a pupil gave on a registration, which an admission would carry onto them.

    A decided registration takes it too. A choice already withheld stays as it is, so a second mail or a registration
    its pupil never confirmed writes nothing, and nothing is ever granted.
    """

    async def record(row: Mapping[str, Any], session: AsyncClientSession) -> None:
        await record_act(
            collection=registrierungen_collection, action="registrierung.einwilligung_withdrawn", record_id=row["_id"], session=session
        )

    await withdraw_by_mail(
        kind=Collection.REGISTRIERUNGEN,
        collection=registrierungen_collection,
        db_filter={"_id": registrierung_id},
        projection={"einwilligung": 1},
        held_of=held_by_the_record,
        withheld={choice: WITHHELD_BY_A_PERSON[choice] for choice in withdrawal_data.choices},
        act=record,
        db=db,
        now=germany_now,
    )
