"""
SPIELTAGE · models

**A matchday's position is DERIVED and no field holds one** (ADR-0064). The order is `saison_phase` in
bracket order, then `beginn`, then `name` -- fields that already have to be right for other reasons, so
there is nothing to set, nothing to collide and nothing to reorder. `order_spieltage` is the one place
that order is expressed.

`FLSaisonPhase` and `PHASE_RANK` are imported from the spiele slice rather than redeclared, so the set
and its ordering cannot drift from the rules that refuse a feeder played too late.
"""

from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.api.spiele.schemas import FLSaisonPhase
from app.shared.schemas.custom import CustomDateString, CustomObjectId, CustomOptionalDateString
from app.shared.schemas.responses import BaseAPIResponse


class FLSpieltag(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through
    name: str = Field(min_length=1)

    beginn: CustomDateString
    ende: CustomDateString
    anzahl_spiele: int = Field(gt=0)
    saison_phase: FLSaisonPhase
    saison_id: str = Field(min_length=4, max_length=4)
    # The day this matchday was retired, or null while it is live (ADR-0032). Retiring one leaves its
    # matches alone -- `spiele.spieltag_id` still resolves, which is why this is not a delete.
    inactive_since: CustomOptionalDateString


FLSpieltagListAdapter = TypeAdapter(list[FLSpieltag])


class FLSpieltageFilterParams(BaseModel):
    saison_id: str | None = None
    saison_phase: Literal["playoffs"] | FLSaisonPhase | None = None
    include_inactive: bool = False

    limit: int = Field(default=1024, ge=1, le=1024)
    # `natural` is the derived order and the default: `saison_phase` in bracket order, then `beginn`,
    # then `name` (ADR-0064). The three explicit alternatives remain because a caller may genuinely
    # want a date or a size ordering; none of them is what a bracket reads.
    sort_by: Literal["natural", "beginn", "ende", "anzahl_spiele"] = Field(default="natural")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLPostSpieltagPayload(BaseModel):
    name: str = Field(min_length=1)
    beginn: CustomDateString
    ende: CustomDateString
    anzahl_spiele: int = Field(gt=0)
    saison_phase: FLSaisonPhase
    saison_id: str = Field(min_length=4, max_length=4)


class FLPatchSpieltagPayload(BaseModel):
    name: str = Field(min_length=1)
    beginn: CustomDateString
    ende: CustomDateString
    anzahl_spiele: int = Field(gt=0)
    saison_phase: FLSaisonPhase
    # `saison_id` is absent: moving a matchday between seasons would strand its matches, which carry
    # their own `saison_id` and are not rewritten here.


class FLSpieltageListResponse(BaseAPIResponse):
    spieltage: list[FLSpieltag]


class FLSpieltageSingleResponse(BaseAPIResponse):
    spieltag: FLSpieltag


class FLSpieltagWriteResponse(BaseAPIResponse):
    spieltag_id: CustomObjectId
    # Absent on create, where the document is echoed by its id alone.
    updated_document: FLSpieltag | None = None
