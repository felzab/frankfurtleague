from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from app.shared.schemas.custom import CustomNonEmptyString, CustomObjectId
from app.shared.schemas.kontakt import CustomEmail
from app.shared.schemas.literals import FLAdresswechselEinsehbarVerwehrt, FLAdresswechselWeg, FLGenehmigungVerwehrt, FLVerwaltung
from app.shared.schemas.responses import BaseAPIResponse


def as_utc(moment: datetime) -> datetime:
    """An instant marked as the UTC it is: the driver reads a stored one back with no offset, and served so it reads as local time."""

    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


# Every instant a grants route serves, which then carries its offset.
FLUtcInstant = Annotated[datetime, AfterValidator(as_utc)]

# What happened to one grant: added, removed, or its tier changed in place, by the tier change or by
# a database edit. An address changed in place is a removal and a grant, never `geaendert`.
FLBerechtigungAenderungArt = Literal["erteilt", "entzogen", "geaendert"]

# What a grant's notice tells: a change to a grant, or, no change of one yet, a grant or promotion asked for, waiting on
# an approval (`app/api/postausgang/schemas.py :: FLBerechtigungDaten`).
FLBerechtigungMitteilungArt = Literal[FLBerechtigungAenderungArt, Literal["beantragt"]]

# Who made a queued change: an administrator through the application, or an edit in the database.
# Stated, since a null actor also stands for one whose address is withheld.
FLBerechtigungUrheber = Literal["anwendung", "datenbank"]

# Why a queued notice's GRANT address is withheld: its holder barred, or erased. Never the actor's,
# whose `geaendert_von` says it alone: null for a ban, `app/core/recording.py :: ERASED_ACTOR_MARKER`
# for an erasure.
FLBerechtigungVorenthalten = Literal["gesperrt", "geloescht"]


class FLBerechtigungFortgefuehrt(BaseModel):
    """The since-whens a grant moved by its holder's own address change carries of the row it replaced."""

    berechtigt_seit: datetime
    # Null where the replaced row held no owner's power.
    inhaber_seit: datetime | None


class FLBerechtigung(BaseModel):
    """One grant as the collection stores it, read only once `app/shared/folding.py :: is_stored_identifier` has passed its address."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    adresse: CustomNonEmptyString
    verwaltung: FLVerwaltung
    # An administrator's address for a grant made here, `app/core/recording.py :: ERASED_ACTOR_MARKER`
    # once they are erased, and the marker the paste names itself by for one made in the Playground.
    erteilt_von: CustomNonEmptyString
    erteilt_am: datetime
    # Absent until a comparison finds the row new, and never written by a grant made here: a paste's
    # `erteilt_am` is whatever was typed, and an address changed in place keeps the old one.
    gefunden_am: datetime | None = None
    # Written once, by the first pass to read the row, dead or live, or by the write here that first
    # records it: a row carrying it and no record was edited after it was seen.
    gesehen_am: datetime | None = None
    # When the row last became `owner` by a promotion, written by the tier change and by a comparison
    # finding one made in the database: an older session holds no owner's power.
    ernannt_am: datetime | None = None
    # Written by an address change's move alone, read by the four-eyes rule and never by a session's check.
    fortgefuehrt: FLBerechtigungFortgefuehrt | None = None
    # 0 until a write raises it, as the grant's insert stamps it.
    version: int = 0


class FLBerechtigungAdresswechsel(BaseModel):
    """The change of this grant's address that waits on an administrator's approval."""

    id: CustomObjectId
    # Null where withheld: on the ban list (`email_gesperrt`), as a grant's barred address is, or from a non-owner.
    email: str | None
    email_gesperrt: bool
    weg: FLAdresswechselWeg
    # The administrator who started it, null on the person's own start (`konto`), where withheld as `email` is, or where
    # `gestartet_von_gesperrt` is set.
    gestartet_von: str | None
    gestartet_von_gesperrt: bool
    # The reason an administrator recorded for a lost mailbox, null on every other way and where withheld as `email` is.
    grund: str | None
    # Whether the new mailbox has confirmed, so the approval would make the change take effect.
    bestaetigt: bool
    bis: FLUtcInstant
    # Why the reader may not approve it, or null where they may.
    verwehrt: FLGenehmigungVerwehrt | None
    # Why the address tool refuses it the reader, null where it opens it: a refused approval sends them to discard it there.
    einsehbar_verwehrt: FLAdresswechselEinsehbarVerwehrt | None


class FLBerechtigungZeile(BaseModel):
    """One grant as the list serves it."""

    id: CustomObjectId
    # Null exactly where `gesperrt` is set: a barred address is answered on no route.
    adresse: str | None
    gesperrt: bool
    verwaltung: FLVerwaltung
    # Null exactly where `erteilt_von_gesperrt` is set, as `adresse` is beside `gesperrt`.
    erteilt_von: str | None
    erteilt_von_gesperrt: bool
    erteilt_am: FLUtcInstant
    # Null on a barred row, whose change the ban refuses anyway.
    adresswechsel: FLBerechtigungAdresswechsel | None
    # The count of the grant's writes, which a tier change sends back to be refused once another write has raised it.
    version: int


class FLBerechtigungAntragGenehmigung(BaseModel):
    """What a request waits on, the block an address change's approval keeps too, so one judgement reads both."""

    # The tier the request asks for, and the one its approver and its requester must hold.
    verwaltung: FLVerwaltung
    angefragt_am: datetime
    bis: datetime
    # Folded, as `erteilt_von` stores an administrator.
    gestartet_von: CustomNonEmptyString


class FLBerechtigungAntrag(BaseModel):
    """One request as the collection stores it: never an approval, which writes the grant and removes the request at once."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    # Folded: the address the grant goes to, or the address of the grant a promotion names.
    adresse: CustomNonEmptyString
    # The grant a promotion raises, null for a grant: its approval finds nothing where that grant has gone since.
    berechtigung_id: CustomObjectId | None
    genehmigung: FLBerechtigungAntragGenehmigung


class FLBerechtigungAntragZeile(BaseModel):
    """One request as the list serves it, while it may still be decided."""

    id: CustomObjectId
    # Null exactly where `gesperrt` is set, as on a grant's row.
    adresse: str | None
    gesperrt: bool
    berechtigung_id: CustomObjectId | None
    verwaltung: FLVerwaltung
    # Null exactly where `gestartet_von_gesperrt` is set.
    gestartet_von: str | None
    gestartet_von_gesperrt: bool
    angefragt_am: FLUtcInstant
    bis: FLUtcInstant
    # Whether its requester still holds, since before it, the tier it asks for: a request outlives no revoke, demotion or ban
    # of the person who made it.
    steht: bool
    # Why the reader may not approve it, or null where they may; a requester refuses their own all the same.
    verwehrt: FLGenehmigungVerwehrt | None


class FLBerechtigungenListResponse(BaseAPIResponse):
    """Every live grant, never in part, and every request still waiting."""

    berechtigungen: list[FLBerechtigungZeile]
    # The rows no request can match, left out rather than failing the page.
    uebersprungen: int = Field(ge=0)
    # Every request not yet lapsed, oldest first.
    antraege: list[FLBerechtigungAntragZeile]


class FLPostBerechtigungPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # No tier on the payload: a grant is made as `administration`, and `owner` is reached only by an
    # owner's tier change, so an `owner` field here would be a refusal waiting for its first caller.
    email: CustomEmail


class FLPatchBerechtigungPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    verwaltung: FLVerwaltung
    # The `version` the list served the grant at; absent, the change is checked against nothing.
    version: int | None = None


class FLPostBerechtigungResponse(BaseAPIResponse):
    # The grant's id, or the request's where `beantragt` is set.
    created_id: CustomObjectId
    # Whether the grant waits on another administrator's approval rather than taking effect.
    beantragt: bool


class FLBerechtigungWriteResponse(BaseAPIResponse):
    """The grant a revoke removed or an approval wrote or promoted."""

    berechtigung_id: CustomObjectId


class FLBerechtigungStufeResponse(BaseAPIResponse):
    """The grant a tier change named, and whether its promotion waits on another owner's approval rather than taking effect."""

    berechtigung_id: CustomObjectId
    beantragt: bool


class FLBerechtigungAntragAbgelehntResponse(BaseAPIResponse):
    """The request a refusal or a withdrawal removed: a removal is hard, so the id is all there is to answer with."""

    antrag_id: CustomObjectId


class FLBerechtigungAbgleichResponse(BaseAPIResponse):
    # The changes made in the database that this comparison found, each now owed to every administrator.
    aenderungen: int = Field(ge=0)


class FLBerechtigungStand(BaseModel):
    """One grant's address and tier at one moment."""

    # Null where the address was barred when it was written or is barred now, or its holder is erased.
    adresse: str | None
    verwaltung: FLVerwaltung


class FLBerechtigungAngekuendigt(BaseModel):
    """One row of the announced record: keyed on the grant's own id, with the moment it was recorded."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    adresse: CustomNonEmptyString
    verwaltung: FLVerwaltung
    angekuendigt_am: datetime
