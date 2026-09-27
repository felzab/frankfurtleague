from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.custom import CustomNonEmptyString, CustomObjectId, CustomStrippedNonEmptyString
from app.shared.schemas.kontakt import CustomEmail
from app.shared.schemas.responses import BaseAPIResponse


def as_utc(moment: datetime) -> datetime:
    """An instant marked as the UTC it is: the driver reads a stored one back with no offset, and served so it reads as local time."""

    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


# Every instant a grants route serves, which then carries its offset.
FLUtcInstant = Annotated[datetime, AfterValidator(as_utc)]

# Closed, and mirrored by `app/core/constraints.py :: _VERWALTUNG`. `owner` holds every power
# `administration` does and is written by no route (`docs/backend/spec.md :: 1.1`).
FLVerwaltung = Literal["owner", "administration"]

# What happened to one grant: added, removed, or its tier changed in place, which only a database
# edit does. An address changed in place is a removal and a grant, never `geaendert`.
FLBerechtigungAenderungArt = Literal["erteilt", "entzogen", "geaendert"]

# Who made a queued change: an administrator through the application, or an edit in the database.
# Stated, since a null actor also stands for one whose address is withheld (`docs/backend/spec.md :: I452`).
FLBerechtigungUrheber = Literal["anwendung", "datenbank"]

# Why a queued row's addresses are withheld. Closed on the one reason there is today; an erasure
# joins as a second member rather than reusing this one.
FLBerechtigungVorenthalten = Literal["gesperrt"]


class FLBerechtigung(BaseModel):
    """One grant as the collection stores it, read only once `app/shared/folding.py :: is_stored_identifier` has passed its address."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    adresse: CustomNonEmptyString
    verwaltung: FLVerwaltung
    # An administrator's address for a grant made here; whatever the paste wrote, an empty string
    # included, for one made in the Playground. No bound on it: that would hide a live grant.
    erteilt_von: str
    erteilt_am: datetime


class FLBerechtigungZeile(BaseModel):
    """One grant as the list serves it."""

    id: CustomObjectId
    # Null exactly where `gesperrt` is set: a barred address is answered on no route
    # (`docs/backend/spec.md :: I452`).
    adresse: str | None
    gesperrt: bool
    verwaltung: FLVerwaltung
    # Null exactly where `erteilt_von_gesperrt` is set, as `adresse` is beside `gesperrt`.
    erteilt_von: str | None
    erteilt_von_gesperrt: bool
    erteilt_am: FLUtcInstant


class FLBerechtigungenListResponse(BaseAPIResponse):
    """Every live grant, uncapped: a list the floor of two is judged over is never served in part."""

    berechtigungen: list[FLBerechtigungZeile]
    # The rows no request can match, left out rather than failing the page (`docs/backend/spec.md :: I453`).
    uebersprungen: int = Field(ge=0)


class FLPostBerechtigungPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # No tier on the payload: the application grants `administration` alone, so an `owner` field
    # here would be a refusal waiting for its first caller.
    email: CustomEmail


class FLPostBerechtigungResponse(BaseAPIResponse):
    created_id: CustomObjectId


class FLBerechtigungWriteResponse(BaseAPIResponse):
    """The removal is hard, so the id is all there is to answer with."""

    berechtigung_id: CustomObjectId


class FLBerechtigungStand(BaseModel):
    """One grant's address and tier at one moment."""

    # Null where the address was barred when it was written or is barred now.
    adresse: str | None
    verwaltung: FLVerwaltung


class FLBerechtigungAngekuendigt(BaseModel):
    """One row of the announced record: keyed on the grant's own id, with the moment it was recorded."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    adresse: CustomNonEmptyString
    verwaltung: FLVerwaltung
    angekuendigt_am: datetime


class FLBerechtigungPostausgangZeile(BaseModel):
    """One outbox row as stored: a change still to be mailed, and the claim a pass holds it under."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    berechtigung_id: CustomObjectId
    art: FLBerechtigungAenderungArt
    urheber: FLBerechtigungUrheber
    jetzt: FLBerechtigungStand | None
    vorher: FLBerechtigungStand | None
    # The administrator whose write made the change, null for one found in the database and for one
    # whose address a ban has withheld; `urheber` tells the two apart.
    geaendert_von: str | None
    # Null where the change was found in the database, nobody knowing when that edit was made.
    geaendert_am: datetime | None
    vorenthalten: FLBerechtigungVorenthalten | None
    erfasst_am: datetime
    beansprucht_bis: datetime | None
    beanspruchung: str | None


class FLBerechtigungAenderung(BaseModel):
    """One claimed change to announce: what the grant is now, what everyone was last told, and who made it."""

    id: CustomObjectId
    berechtigung_id: CustomObjectId
    art: FLBerechtigungAenderungArt
    urheber: FLBerechtigungUrheber
    jetzt: FLBerechtigungStand | None
    vorher: FLBerechtigungStand | None
    # Null exactly where `urheber` is `datenbank` or `geaendert_von_gesperrt` is set.
    geaendert_von: str | None
    geaendert_von_gesperrt: bool
    geaendert_am: FLUtcInstant | None
    # Set where an address of this change, the actor's included, is barred and withheld wherever it would stand.
    gesperrt: bool


class FLBerechtigungAbgleichResponse(BaseAPIResponse):
    # Null together, exactly where nothing was claimed.
    beanspruchung: str | None
    beansprucht_bis: FLUtcInstant | None
    aenderungen: list[FLBerechtigungAenderung]
    # Every live, unbarred holder now; a removed address is read off its change's `vorher`.
    empfaenger: list[str]
    uebersprungen: int = Field(ge=0)


class FLBerechtigungAngekuendigtPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    beanspruchung: CustomStrippedNonEmptyString
    # A repeated id is counted once rather than refused: a pass retrying its own stamp is not wrong.
    ids: list[CustomObjectId] = Field(min_length=1, max_length=LIST_LIMIT_DEFAULT)


class FLBerechtigungAngekuendigtResponse(BaseAPIResponse):
    angekuendigt: int = Field(ge=0)
    # Every distinct id this claim does not hold: unknown, stamped already, or claimed since by another pass.
    ignoriert: int = Field(ge=0)
