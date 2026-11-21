from datetime import datetime
from typing import Literal

from pydantic import Field

from app.core.crud import Anchored
from app.shared.schemas.custom import CustomObjectId, FLUtcInstant
from app.shared.schemas.kontakt import CustomEmail, CustomStoredAddress
from app.shared.schemas.literals import FLAdminTier
from app.shared.schemas.responses import BasePayload, BaseReadModel

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


class FLGrantRow(BaseReadModel):
    """One grant as the list serves it."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    address: str
    admin_tier: FLAdminTier
    # A future one is an addition still waiting.
    effective_from: FLUtcInstant
    # Set exactly while a handover to this row waits, and stored only then.
    owner_from: FLUtcInstant | None = None


class FLGrantsListResponse(BaseReadModel):
    """Every grant, never in part, a waiting addition among them."""

    grants: list[FLGrantRow]


class FLGrantRemovedResponse(BaseReadModel):
    """The address a removal or a withdrawal took the grant from, as the sign-in folds it."""

    address: str


class FLPostGrantPayload(BasePayload):
    # No tier on the payload: a grant is made as `administration`, and `owner` is reached only by a handover.
    email: CustomEmail


class FLGrantHandoverPassResponse(BaseReadModel):
    handed_over: int = Field(ge=0)
