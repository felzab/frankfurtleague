from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.shared.schemas.custom import CustomNonEmptyString, CustomObjectId, CustomStrippedNonEmptyString
from app.shared.schemas.kontakt import CustomEmail
from app.shared.schemas.responses import BaseAPIResponse

# Closed, and mirrored by `app/core/constraints.py :: _VERWALTUNG`. `owner` holds every power
# `administration` does and is written by no route (`docs/backend/spec.md :: 1.1`).
FLVerwaltung = Literal["owner", "administration"]

# What happened to one grant between the last announcement and now.
FLBerechtigungAenderungArt = Literal["erteilt", "entzogen", "geaendert"]


class FLBerechtigung(BaseModel):
    """One grant, as the collection stores it and the list serves it."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    # The folded sign-in identifier, the one spelling `verify_actor_is_admin` looks a header up by.
    adresse: CustomNonEmptyString
    verwaltung: FLVerwaltung
    # An administrator's address for a grant made here; whatever the paste wrote for one made in the
    # Playground, which is why no reader decides anything from it.
    erteilt_von: CustomNonEmptyString
    erteilt_am: datetime


class FLBerechtigungenListResponse(BaseAPIResponse):
    """Every grant, uncapped: a list the floor of two is judged over is never served in part."""

    berechtigungen: list[FLBerechtigung]


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


class FLBerechtigungEintrag(BaseModel):
    """One grant's address and tier, as it stands or as it was last announced."""

    adresse: CustomNonEmptyString
    verwaltung: FLVerwaltung


class FLBerechtigungEintragPayload(FLBerechtigungEintrag):
    # Derived from the read shape and never the other way round: `extra` is inherited, so forbidding
    # on the base would refuse a stored key the collection has grown (`docs/backend/spec.md :: I114`).
    model_config = ConfigDict(extra="forbid")

    adresse: CustomStrippedNonEmptyString


class FLBerechtigungAngekuendigt(FLBerechtigungEintrag):
    """One row of the announced record: keyed on the grant's own id, with the moment it was stamped."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    angekuendigt_am: datetime


class FLBerechtigungAenderung(BaseModel):
    """One change to announce: what the grant is now, what everyone was last told, and who made it."""

    berechtigung_id: CustomObjectId
    art: FLBerechtigungAenderungArt
    # Null where the grant is gone, and `vorher` null where nobody was ever told of it: the pair is
    # what the stamp is handed back.
    jetzt: FLBerechtigungEintrag | None
    vorher: FLBerechtigungEintrag | None
    # The administrator whose recorded write made this change, or null where no recorded write did:
    # a change made in the database directly, or one whose log row has expired.
    geaendert_von: str | None
    # That log row's own instant, in its UTC spelling; null exactly where `geaendert_von` is.
    geaendert_am: str | None
    # Whether the address in `jetzt` is barred, which only a change made outside the application can
    # leave true (`REQ-BERECHTIGUNG-003` refuses it here).
    gesperrt: bool


class FLBerechtigungAbgleichResponse(BaseAPIResponse):
    aenderungen: list[FLBerechtigungAenderung]
    # Every address holding a grant now, each told of every change; a removed address is in no
    # grant and so is read off its change instead.
    empfaenger: list[str]


class FLBerechtigungAnkuendigung(BaseModel):
    """One change the caller has mailed, handed back as the state it announced."""

    model_config = ConfigDict(extra="forbid")

    berechtigung_id: CustomObjectId
    # Null announces the grant's removal. Carried rather than re-read: the grant may have moved
    # since, and stamping the moved state would mark a change as told that nobody was told of.
    jetzt: FLBerechtigungEintragPayload | None


class FLBerechtigungAngekuendigtPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    aenderungen: list[FLBerechtigungAnkuendigung] = Field(min_length=1)


class FLBerechtigungAngekuendigtResponse(BaseAPIResponse):
    angekuendigt: int = Field(ge=0)
