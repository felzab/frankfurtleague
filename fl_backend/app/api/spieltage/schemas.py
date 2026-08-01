"""
SPIELTAGE · models

`order_val` is the ordering the bracket depends on, and it is the default sort -- not `beginn`.
Matchdays routinely share dates, so ordering by date interleaves playoff rounds unpredictably.

`FLSaisonPhase` is imported from the spiele slice rather than redeclared, so the two cannot drift.
"""

from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.api.spiele.schemas import FLSaisonPhase
from app.shared.schemas.custom import CustomDateString, CustomObjectId
from app.shared.schemas.responses import BaseAPIResponse


class FLSpieltag(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through
    name: str = Field(min_length=1)

    beginn: CustomDateString
    ende: CustomDateString
    anzahl_spiele: int = Field(gt=0)
    order_val: int = Field(ge=0)
    saison_phase: FLSaisonPhase
    saison_id: str = Field(min_length=4, max_length=4)


FLSpieltagListAdapter = TypeAdapter(list[FLSpieltag])


class FLSpieltageFilterParams(BaseModel):
    saison_id: str | None = None
    saison_phase: Literal["playoffs"] | FLSaisonPhase | None = None

    limit: int = Field(1024, ge=1, le=1024)
    sort_by: Literal["beginn", "ende", "anzahl_spiele", "order_val"] = Field(default="order_val")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLSpieltageListResponse(BaseAPIResponse):
    spieltage: list[FLSpieltag]
