"""
SPIELER · models

Only `vorname` is required. Everything else may be null while a squad entry is still being filled in,
so every consumer must handle a missing surname, number or position. `nummer` is a STRING, not an int.

Mirrored by FLSpielerSchema in the frontend.
"""

from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.shared.schemas.custom import CustomObjectId
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


FLSpielerListAdapter = TypeAdapter(list[FLSpieler])


class FLSpielerFilterParams(BaseModel):
    team_id: CustomObjectId | None = None
    saison_id: str | None = None
    is_nachgetragen: bool | None = None
    stufe: str | None = None

    limit: int = Field(1024, ge=1, le=1024)
    sort_by: FLSpielerSortOptions = Field(default="position")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLSpielerListResponse(BaseAPIResponse):
    spieler: list[FLSpieler]
