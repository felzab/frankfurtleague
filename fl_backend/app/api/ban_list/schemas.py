import re
from typing import Annotated, Final

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from app.core.exceptions import rule_refusal
from app.shared.schemas.bounds import BAN_REASON_MAX_LENGTH, SAISON_ID_LENGTH
from app.shared.schemas.custom import SINGLE_LINE_PATTERN, CustomDateString, CustomNonEmptyString, CustomObjectId
from app.shared.schemas.kontakt import CustomEmail, CustomStoredAddress
from app.shared.schemas.responses import BaseAPIResponse

# A deliverable shape and never a bare `@`: „Nach Absprache @ Schulleitung" is German prose an
# administrator writes, and refusing it catches the rare case by refusing the ordinary one.
ADDRESS_IN_FREE_TEXT: Final = re.compile(r"[^\s@]+@[^\s@]+\.[A-Za-z]{2,}")


def refuse_an_address_in_the_reason(value: str) -> str:
    """Refuse an address in free text a row keeps past its person's erasure.

    `ban_reason` is served, mailed and outlives the erasure, so an address typed here is a second
    person's, kept on a row that person has no way to reach.
    """

    if ADDRESS_IN_FREE_TEXT.search(value) is not None:
        raise rule_refusal("address_in_free_text", "the text holds an email address")

    return value


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


class FLPostBanListEntryPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

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
        AfterValidator(refuse_an_address_in_the_reason),
    ]


class FLBanListResponse(BaseAPIResponse):
    """Every ban, newest first."""

    ban_list: list[FLBanListRow]


class FLPostBanListEntryResponse(BaseAPIResponse):
    created_id: CustomObjectId


class FLBanListWriteResponse(BaseAPIResponse):
    """The id of the ban lifted, whose row is gone."""

    ban_list_entry_id: CustomObjectId
