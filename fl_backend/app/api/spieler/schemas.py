from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.responses import BaseAPIResponse

FLSpielerSortOptions = Literal["vorname", "nachname", "stufe", "nummer", "position"]


class FLSpieler(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through

    vorname: str | None
    nachname: str | None
    stufe: str | None
    nummer: str | None
    position: str | None
    nachgetragen: bool = False
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
