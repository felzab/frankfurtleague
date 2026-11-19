from typing import Annotated, Final

from pydantic import AfterValidator, BaseModel, Field, StringConstraints

from app.shared.schemas.bounds import SAISON_ID_LENGTH
from app.shared.schemas.custom import SINGLE_LINE_PATTERN, CustomDateString, CustomNonEmptyString, CustomObjectId
from app.shared.schemas.kontakt import CustomEmail, CustomStoredAddress
from app.shared.schemas.responses import BasePayload, BaseReadModel


class FLBanListRow(BaseModel):
    """One ban as the list serves it."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    # Folded as every address payload is, so a check is an equality.
    address: CustomNonEmptyString
    ban_reason: CustomNonEmptyString
    created_at: CustomDateString
    # The last season the ban covers, inclusive. Served because a row whose bound nobody can read is
    # one an administrator cannot tell from a standing ban, and the lapse removes it without asking.
    barred_until_saison_id: str = Field(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)


class FLBanListRecord(FLBanListRow):
    """One ban as the collection stores it, its address folded as the sign-in folds it, for the record models alone.

    The list serves `FLBanListRow` with the plain address, so one stray row is named by the read-back rather than refusing
    the whole list it stands in.
    """

    address: CustomStoredAddress


# Why an address was barred, in an administrator's own words: a sentence rather than a page, read on a card.
BAN_REASON_MAX_LENGTH: Final = 500


class FLPostBanListEntryPayload(BasePayload):
    email: CustomEmail
    # Whether the address is told of its ban: only where it has a sign-in account, which the frontend's store alone knows.
    notify: bool
    # Stripped on the write side alone, and single-line because the admin card renders it beside the day.
    # The ceiling counts what arrives and the strip runs after it, so the published `maxLength` is the one the write keeps.
    ban_reason: Annotated[
        str,
        StringConstraints(max_length=BAN_REASON_MAX_LENGTH, pattern=SINGLE_LINE_PATTERN),
        AfterValidator(str.strip),
        StringConstraints(min_length=1),
    ]


class FLBanListResponse(BaseReadModel):
    """Every ban, newest first."""

    ban_list: list[FLBanListRow]
