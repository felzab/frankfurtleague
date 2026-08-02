"""
SAISONS · models

The season model, its filter options and the two response shapes.

The 4-character id constraint is the load-bearing part: `FLSpiel.saison_id` and `FLSpieltag.saison_id`
both require exactly that of whatever they reference, so a longer id validates here and then breaks
every match and matchday pointing at it on read.

`status` appears on no payload. It is not an ordinary field: exactly one season carries `active` and no
validator can express that, so the value is reachable only through `POST /saisons/{id}/activate`, which
moves the incumbent aside in the same transaction (ADR-0033). A season is never deleted either -- an
old one is `past`, which is what "gone" means here.
"""

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
    # No `saison_id`. Selecting one season by its id is an identity, and identities are addressed by
    # `GET /saisons/{saison_id}` -- what remains here narrows a list, which is what a filter is for.
    status: FLSaisonStatus | None = None

    limit: int = Field(default=1024, ge=1, le=1024)
    sort_by: FLSaisonsSortOptions = Field(default="_id")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLPostSaisonPayload(BaseModel):
    # The id is CHOSEN, not generated: `saisons._id` is the four-character season string every
    # `saison_id` in the database references. So this is the one create payload that carries one.
    id: str = Field(min_length=4, max_length=4)

    start_date: CustomDateString
    end_date: CustomDateString
    rules: FLSaisonRules


class FLPatchSaisonPayload(BaseModel):
    start_date: CustomDateString
    end_date: CustomDateString
    rules: FLSaisonRules


class FLSaisonsListResponse(BaseAPIResponse):
    format: Literal["list"] = "list"
    saisons: list[FLSaison]


class FLSaisonsSingleResponse(BaseAPIResponse):
    format: Literal["single"] = "single"
    saison: FLSaison


class FLPostSaisonResponse(BaseAPIResponse):
    created_id: str


class FLPatchSaisonResponse(BaseAPIResponse):
    updated_document: FLSaison


class FLActivateSaisonResponse(BaseAPIResponse):
    """The season now active, plus how many were moved off it -- normally exactly one."""

    updated_document: FLSaison
    deactivated: int
