from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.crud import Anchored
from app.shared.schemas.custom import CustomObjectId, FLUtcInstant
from app.shared.schemas.kontakt import CustomEmail, CustomStoredAddress
from app.shared.schemas.literals import FLAdminTier
from app.shared.schemas.responses import BaseAPIResponse

# What a notice is about: an addition, a removal, a handover, or a holder's own address change.
FLGrantChange = Literal["granted", "revoked", "handover", "address"]

# Where that change stands. `granted` never reaches `completed`, as no pass runs when an addition's wait ends.
FLGrantNoticeStage = Literal["started", "withdrawn", "completed"]


class FLGrantRecord(Anchored):
    """One grant as the collection stores it, its address folded as the sign-in folds it, for the record models alone.

    The list reads its rows as `FLGrantRow`, so one stray row is named by the read-back rather than refusing the whole list.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    address: CustomStoredAddress
    admin_tier: FLAdminTier
    # When the grant holds: the future while an addition waits, and the moment of the last address switch or handover, so a
    # session older than it holds nothing.
    effective_from: datetime
    # When a waiting handover makes this row the owner's, stored only while one waits.
    owner_from: datetime | None = None


class FLGrantRow(BaseModel):
    """One grant as the list serves it."""

    id: CustomObjectId
    address: str
    admin_tier: FLAdminTier
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
    """The grant the act named."""

    grant_id: CustomObjectId


class FLGrantHandoverPassResponse(BaseAPIResponse):
    handed_over: int = Field(ge=0)
