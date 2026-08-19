from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter, model_validator

from app.api.spiele.schemas import FLSaisonPhase
from app.shared.schemas.custom import CustomDateString, CustomObjectId, CustomOptionalDateString, refuse_reversed_span
from app.shared.schemas.responses import BaseAPIResponse


class FLSpieltag(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    beginn: CustomDateString
    ende: CustomDateString
    # DERIVED, on no document. `ge=0`, because a matchday in a phase the bracket does not reach
    # expects none.
    anzahl_spiele: int = Field(ge=0)
    saison_phase: FLSaisonPhase
    saison_id: str = Field(min_length=4, max_length=4)
    # Retiring leaves the matches alone: `spiele.spieltag_id` still resolves, which is why this is
    # not a delete.
    inactive_since: CustomOptionalDateString


FLSpieltagListAdapter = TypeAdapter(list[FLSpieltag])


class FLSpieltageFilterParams(BaseModel):
    saison_id: str | None = None
    saison_phase: Literal["playoffs"] | FLSaisonPhase | None = None
    include_inactive: bool = False

    limit: int = Field(default=1024, ge=1, le=1024)
    # `natural` is the derived order. `anzahl_spiele` is absent because a Mongo sort cannot order by
    # a value no document holds.
    sort_by: Literal["natural", "beginn", "ende"] = Field(default="natural")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLPostSpieltagPayload(BaseModel):
    beginn: CustomDateString
    ende: CustomDateString
    saison_phase: FLSaisonPhase
    saison_id: str = Field(min_length=4, max_length=4)

    @model_validator(mode="after")
    def the_matchday_ends_after_it_begins(self) -> "FLPostSpieltagPayload":
        refuse_reversed_span(start=self.beginn, end=self.ende, start_label="dem Beginn", end_label="Das Ende")

        return self


class FLPatchSpieltagPayload(BaseModel):
    beginn: CustomDateString
    ende: CustomDateString
    saison_phase: FLSaisonPhase
    # No `saison_id`: moving a matchday between seasons would strand its matches, which carry their
    # own and are not rewritten here.

    @model_validator(mode="after")
    def the_matchday_ends_after_it_begins(self) -> "FLPatchSpieltagPayload":
        """Also the ORDER of the season's list: matchdays sort by `beginn`, so a reversed span disagrees with itself."""

        refuse_reversed_span(start=self.beginn, end=self.ende, start_label="dem Beginn", end_label="Das Ende")

        return self


class FLSpieltageListResponse(BaseAPIResponse):
    spieltage: list[FLSpieltag]


class FLSpieltageSingleResponse(BaseAPIResponse):
    spieltag: FLSpieltag


class FLSpieltagWriteResponse(BaseAPIResponse):
    spieltag_id: CustomObjectId
    # Absent on create, where the document is echoed by its id alone.
    updated_document: FLSpieltag | None = None
