from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.shared.schemas.custom import CustomDateString
from app.shared.schemas.responses import BaseAPIResponse

FLSaisonStatus = Literal["past", "active", "future"]
FLSaisonsSortOptions = Literal["_id", "start_date", "end_date"]


class FLSaisonRules(BaseModel):
    win_points: int = Field(gt=0)
    draw_points: int = Field(ge=0)


class FLSaison(BaseModel):
    # Exactly 4 characters, because FLSpiel.saison_id and FLSpieltag.saison_id both demand that of
    # the value referencing this one. Without it a saison id like "2026/27" validates here and then
    # every spiel and spieltag pointing at it fails to parse on read.
    id: str = Field(validation_alias="_id", serialization_alias="id", min_length=4, max_length=4)

    start_date: CustomDateString
    end_date: CustomDateString
    status: FLSaisonStatus
    rules: FLSaisonRules


FLSaisonsListAdapter = TypeAdapter(list[FLSaison])


class FLSaisonsFilterOptions(BaseModel):
    saison_id: str | None = Field(default=None, validation_alias="saison_id", serialization_alias="_id")

    status: FLSaisonStatus | None = None

    limit: int = Field(1024, ge=1, le=1024)
    sort_by: FLSaisonsSortOptions = Field(default="_id")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLSaisonsListResponse(BaseAPIResponse):
    format: Literal["list"] = "list"
    saisons: list[FLSaison]


class FLSaisonsSingleResponse(BaseAPIResponse):
    format: Literal["single"] = "single"
    saison: FLSaison
