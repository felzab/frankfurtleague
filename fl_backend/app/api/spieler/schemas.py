"""
SPIELER · models

Only `vorname` is required. Everything else may be null while a squad entry is still being filled in,
so every consumer must handle a missing surname, number or position. `nummer` is a STRING, not an int.

Mirrored by FLSpielerSchema in the frontend.
"""

from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.shared.schemas.custom import CustomObjectId, CustomOptionalDateString
from app.shared.schemas.responses import BaseAPIResponse

FLSpielerSortOptions = Literal["vorname", "nachname", "stufe", "nummer", "position"]


class FLSpieler(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through

    # A player must at least have a first name; everything else may be absent while a squad entry
    # is still being filled in. Mirrored by FLSpielerSchema in the frontend.
    vorname: str = Field(min_length=1)
    nachname: str | None
    stufe: str | None
    nummer: str | None
    position: str | None
    is_nachgetragen: bool = False
    team_id: CustomObjectId
    # The day this PERSON left the league, or null. Distinct from the squad row's own
    # `inactive_since`: a player who left one team's squad has a retired junction row and is very much
    # still a player (ADR-0032).
    inactive_since: CustomOptionalDateString


FLSpielerListAdapter = TypeAdapter(list[FLSpieler])


class FLSpielerFilterParams(BaseModel):
    # `team_id` and `saison_id` stay here and are NOT paths. They narrow which players come back --
    # "the squad of that team" -- rather than naming which player, which is `GET /spieler/{spieler_id}`.
    team_id: CustomObjectId | None = None
    saison_id: str | None = None
    is_nachgetragen: bool | None = None
    stufe: str | None = None
    include_inactive: bool = False

    limit: int = Field(default=1024, ge=1, le=1024)
    sort_by: FLSpielerSortOptions = Field(default="position")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLPostSpielerPayload(BaseModel):
    """The PERSON. Everything a squad list shows is season-scoped and lives on the junction below."""

    vorname: str = Field(min_length=1)
    nachname: str | None = None


class FLPatchSpielerPayload(BaseModel):
    vorname: str = Field(min_length=1)
    nachname: str | None = None


class FLPostSaisonSpielerPayload(BaseModel):
    """One player's membership of one team's squad for one season. `spieler_id` comes from the path."""

    saison_id: str = Field(min_length=4, max_length=4)
    team_id: CustomObjectId
    nummer: str | None = None
    position: str | None = None
    stufe: str | None = None
    is_nachgetragen: bool = False


class FLPatchSaisonSpielerPayload(BaseModel):
    # `team_id` is editable here because a player really does move between teams mid-season, and the
    # junction row is where that fact lives.
    team_id: CustomObjectId
    nummer: str | None = None
    position: str | None = None
    stufe: str | None = None
    is_nachgetragen: bool = False


class FLSpielerListResponse(BaseAPIResponse):
    spieler: list[FLSpieler]


class FLSpielerSingleResponse(BaseAPIResponse):
    """
    One player, from `GET /spieler/{spieler_id}`.

    Carries only the person: `vorname`, `nachname` and whether they are retired. The squad fields on
    `FLSpieler` -- team, number, position, stufe -- are season-scoped, so a player addressed without a
    season has none of them, and inventing a season here would make the answer depend on a default the
    caller never stated.
    """

    spieler_id: CustomObjectId
    vorname: str
    nachname: str | None
    inactive_since: str | None


class FLSpielerWriteResponse(BaseAPIResponse):
    spieler_id: CustomObjectId


class FLSaisonSpielerResponse(BaseAPIResponse):
    """A junction row, which has no read model of its own -- so it is echoed as it was written."""

    spieler_id: CustomObjectId
    saison_id: str
    team_id: CustomObjectId
    nummer: str | None
    position: str | None
    stufe: str | None
    is_nachgetragen: bool
    inactive_since: str | None
