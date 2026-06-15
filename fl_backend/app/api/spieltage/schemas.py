from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.api.spiele.schemas import FLSaisonPhase
from app.shared.schemas.custom_types import CustomObjectId, CustomStrDate
from app.shared.schemas.responses import BaseAPIResponse


class FLSpieltag(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through
    name: str

    beginn: CustomStrDate
    ende: CustomStrDate
    anzahl_spiele: int
    order_val: int
    saison_phase: FLSaisonPhase


FLSpieltagListAdapter = TypeAdapter(list[FLSpieltag])


class FLSpieltageFilterParams(BaseModel):
    saison_id: str | None = None
    saison_phase: Literal["playoffs"] | FLSaisonPhase | None = None

    limit: int = Field(1024, ge=1, le=1024)
    sort_by: Literal["beginn", "ende", "anzahl_spiele", "order_val"] = Field(default="order_val")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLSpieltageListResponse(BaseAPIResponse):
    spieltage: list[FLSpieltag]
