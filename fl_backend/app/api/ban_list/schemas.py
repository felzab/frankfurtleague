import re
from typing import Annotated, Final

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from app.core.exceptions import rule_refusal
from app.shared.schemas.bounds import BAN_REASON_MAX_LENGTH, SAISON_ID_LENGTH
from app.shared.schemas.custom import SINGLE_LINE_PATTERN, CustomDateString, CustomNonEmptyString, CustomObjectId
from app.shared.schemas.kontakt import CustomEmail
from app.shared.schemas.responses import BaseAPIResponse

# A DELIVERABLE shape and never a bare `@`: „Nach Absprache @ Schulleitung" is German prose an
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


class FLBanListEntry(BaseModel):
    """One ban, as `ban_list` stores it and as the list serves it."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    # Folded as every address payload is (`app/shared/folding.py :: league_address`), so a check is an equality.
    address: CustomNonEmptyString
    ban_reason: CustomNonEmptyString
    # The bound actor, on no payload.
    created_by: CustomNonEmptyString
    created_at: CustomDateString
    # The last season the ban covers, INCLUSIVE. Served because a row whose bound nobody can read is
    # one an administrator cannot tell from a standing ban, and the lapse removes it without asking.
    barred_until_saison_id: str = Field(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)


class FLPostBanListEntryPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: CustomEmail
    # Whether the address is told of its ban: only where it has a sign-in account, which the frontend's store alone knows.
    notify: bool
    # Stripped on the WRITE side alone, and single-line because the admin card renders it beside the author and the day.
    # The ceiling counts what arrives and the strip runs after it, so the published `maxLength` is the one the write keeps.
    ban_reason: Annotated[
        str,
        StringConstraints(max_length=BAN_REASON_MAX_LENGTH, pattern=SINGLE_LINE_PATTERN),
        AfterValidator(str.strip),
        StringConstraints(min_length=1),
        AfterValidator(refuse_an_address_in_the_reason),
    ]


class FLBanListResponse(BaseAPIResponse):
    """The bans, newest first, and how many there are.

    `count_total` is what makes a ban past the cap liftable: one enforced and not rendered is a
    person barred by a row nobody can reach.
    """

    ban_list: list[FLBanListEntry]
    count_total: int = Field(ge=0)


class FLPostBanListEntryResponse(BaseAPIResponse):
    """Answers the bound as well as the id: the mail telling the person names the season, and a second read would race the lapse."""

    created_id: CustomObjectId
    barred_until_saison_id: str = Field(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)


class FLBanListWriteResponse(BaseAPIResponse):
    """The removal is hard, so the id is all there is to answer with: no document survives to echo."""

    ban_list_entry_id: CustomObjectId
