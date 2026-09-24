import re
from typing import Annotated, Final

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from app.shared.schemas.bounds import SAISON_ID_LENGTH, SPERRLISTE_GRUND_MAX_LENGTH
from app.shared.schemas.custom import SINGLE_LINE_PATTERN, CustomDateString, CustomNonEmptyString, CustomObjectId
from app.shared.schemas.kontakt import CustomEmail
from app.shared.schemas.responses import BaseAPIResponse

# A DELIVERABLE shape and never a bare `@`: „Nach Absprache @ Schulleitung" is German prose an
# administrator writes, and refusing it catches the rare case by refusing the ordinary one.
ADDRESS_IN_FREE_TEXT: Final = re.compile(r"[^\s@]+@[^\s@]+\.[A-Za-z]{2,}")

# German, because it surfaces as a 422 in the reason box
# (`fl_backend/app/shared/schemas/custom.py :: refuse_reversed_span` words its own the same way).
GRUND_HOLDS_AN_ADDRESS = "Der Grund darf keine E-Mail-Adresse enthalten."


def refuse_an_address_in_the_reason(value: str) -> str:
    """The one way a plain address still reaches this collection.

    `grund` is served, copied whole into a removal's log image and outlives the erasure, so an
    address typed here survives every place the hash keeps one out of.
    """

    if ADDRESS_IN_FREE_TEXT.search(value) is not None:
        raise ValueError(GRUND_HOLDS_AN_ADDRESS)

    return value


class FLSperrlisteEintrag(BaseModel):
    """One ban as it is served. `adresse_hash` is on no model, so no read can recover the lookup key."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    grund: CustomNonEmptyString
    # The bound actor, on no payload: a ban and its `aktionen` row cannot then name two people.
    erstellt_von: CustomNonEmptyString
    erstellt_am: CustomDateString
    # The last season the ban covers, INCLUSIVE. Served because a row whose bound nobody can read is
    # one an administrator cannot tell from a standing ban, and the lapse removes it without asking.
    gesperrt_bis_saison_id: str = Field(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)


class FLPostSperrlistePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The one place an address reaches this slice. It is hashed at the endpoint and dropped there,
    # so nothing below this line has a plain address to store, log or echo.
    email: CustomEmail
    # Stripped on the WRITE side alone (`docs/backend/spec.md :: I36`), and single-line because the
    # admin card renders it beside the author and the day.
    grund: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=SPERRLISTE_GRUND_MAX_LENGTH, pattern=SINGLE_LINE_PATTERN),
        AfterValidator(refuse_an_address_in_the_reason),
    ]


class FLSperrlisteListResponse(BaseAPIResponse):
    """The bans, newest first, and how many there are.

    `anzahl_gesamt` is what makes a ban past the cap liftable: one enforced and not rendered is a
    person barred by a row nobody can reach.
    """

    sperrliste: list[FLSperrlisteEintrag]
    # German, unlike the envelope field beside it, for the reason
    # `fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungenListResponse` gives `vollstaendig`.
    anzahl_gesamt: int = Field(ge=0)


class FLPostSperrlisteResponse(BaseAPIResponse):
    """Answers the bound as well as the id: the mail telling the person names the season, and a second read would race the lapse."""

    created_id: CustomObjectId
    gesperrt_bis_saison_id: str = Field(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)


class FLSperrlisteWriteResponse(BaseAPIResponse):
    """The removal is hard, so the id is all there is to answer with: no document survives to echo."""

    sperrliste_id: CustomObjectId
