from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.shared.schemas.custom_types import CustomStrDate
from app.shared.schemas.responses import BaseAPIResponse

FLSaisonStatus = Literal["past", "active", "future"]
FLSaisonsSortOptions = Literal["_id", "start_date", "end_date"]


class FLSaisonRules(BaseModel):
    win_points: int
    draw_points: int


class FLSaison(BaseModel):
    id: str = Field(validation_alias="_id", serialization_alias="id")

    start_date: CustomStrDate
    end_date: CustomStrDate
    status: FLSaisonStatus
    rules: FLSaisonRules


FLSaisonsListAdapter = TypeAdapter(list[FLSaison])


class FLSaisonsFilterOptions(BaseModel):
    saison_id: str = Field(validation_alias="saison_id", serialization_alias="_id")

    status: FLSaisonStatus

    limit: int = Field(1024, ge=1, le=1024)
    sort_by: FLSaisonsSortOptions = Field(default="_id")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLSaisonsListResponse(BaseAPIResponse):
    format: Literal["list"] = "list"
    saisons: list[FLSaison]


class FLSaisonsSingleResponse(BaseAPIResponse):
    format: Literal["single"] = "single"
    saison: FLSaison
