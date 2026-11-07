from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from app.core.crud import Anchored
from app.shared.schemas.custom import CustomNonEmptyString, CustomObjectId
from app.shared.schemas.kontakt import CustomEmail
from app.shared.schemas.literals import FLAdminTier
from app.shared.schemas.responses import BaseAPIResponse


def as_utc(moment: datetime) -> datetime:
    """An instant marked as the UTC it is: the driver reads a stored one back with no offset, and served so it reads as local time."""

    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


# Every instant a grants route serves, which then carries its offset.
FLUtcInstant = Annotated[datetime, AfterValidator(as_utc)]

# What a notice is about: an addition, a removal, a handover, or a holder's own address change.
FLGrantChange = Literal["granted", "revoked", "handover", "address"]

# Where that change stands. `granted` never reaches `completed`, as no pass runs when an addition's wait ends.
FLGrantNoticeStage = Literal["started", "withdrawn", "completed"]


class FLGrantRecord(Anchored):
    """One grant as the collection stores it, its address folded as the sign-in folds it."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    address: CustomNonEmptyString
    admin_tier: FLAdminTier
    # An administrator's address for a grant made here, `app/core/recording.py :: ERASED_ACTOR_MARKER`
    # once they are erased, and the marker the paste names itself by for one made in the Playground.
    granted_by: CustomNonEmptyString
    # When the grant holds: the future while an addition waits, and the moment of the last address switch or handover, so a
    # session older than it holds nothing.
    effective_from: datetime
    # When a waiting handover makes this row the owner's, stored only while one waits.
    owner_from: datetime | None = None
    # 0 until a write raises it, as the grant's insert stamps it.
    version: int = 0


class FLGrantRow(BaseModel):
    """One grant as the list serves it."""

    id: CustomObjectId
    address: str
    admin_tier: FLAdminTier
    granted_by: str
    # A future one is an addition still waiting.
    effective_from: FLUtcInstant
    # Set exactly while a handover to this row waits.
    owner_from: FLUtcInstant | None


class FLGrantsListResponse(BaseAPIResponse):
    """Every grant, never in part, a waiting addition among them."""

    grants: list[FLGrantRow]


class FLPostGrantPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # No tier on the payload: a grant is made as `administration`, and `owner` is reached only by a handover.
    email: CustomEmail


class FLGrantWriteResponse(BaseAPIResponse):
    """The grant an act named: a removal is hard, so the id is all there is to answer with."""

    grant_id: CustomObjectId


class FLGrantHandoverPassResponse(BaseAPIResponse):
    handed_over: int = Field(ge=0)
