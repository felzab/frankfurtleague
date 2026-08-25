from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

from app.api.spiele.schemas import FLSaisonPhase
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, SAISON_ID_LENGTH
from app.shared.schemas.custom import CustomDateString, CustomObjectId, refuse_reversed_span
from app.shared.schemas.responses import BaseAPIResponse


class FLSpieltag(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    # NULLABLE where the payload's pair is not: a drawn matchday carries no span until somebody sets
    # one. No span check here either -- a read refusing a stored reversal would hide the row from the
    # edit that repairs it.
    beginn: CustomDateString | None
    ende: CustomDateString | None

    # DERIVED, on no document. `ge=0`, because a matchday in a phase the bracket does not reach
    # expects none.
    anzahl_spiele: int = Field(ge=0)
    # STORED, and unique within one phase of one season. `ge=1` because the reader renders this very
    # number -- "1. Spieltag", "Viertelfinale (2)" -- so a zero would be a matchday nobody counts.
    position: int = Field(ge=1)
    saison_phase: FLSaisonPhase
    saison_id: str = Field(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)


FLSpieltagListAdapter = TypeAdapter(list[FLSpieltag])


class FLSpieltageFilterParams(BaseModel):
    saison_id: str | None = None
    saison_phase: Literal["playoffs"] | FLSaisonPhase | None = None

    limit: int = Field(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX)
    # `natural` is the played order -- the phase, then `position`. `anzahl_spiele` is absent because
    # a Mongo sort cannot order by a value no document holds.
    sort_by: Literal["natural", "beginn", "ende"] = Field(default="natural")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLPatchSpieltagPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The span alone: `saison_id`, `saison_phase` and `position` are settled when the season's
    # schedule is generated, and the fixtures drawn against them are not rewritten here.

    # Both REQUIRED, unlike the read model's pair: this payload exists to set them, so a null here
    # would be a request to undate a matchday, which nothing asks for and nothing else expresses.
    beginn: CustomDateString
    ende: CustomDateString

    @model_validator(mode="after")
    def the_matchday_ends_after_it_begins(self) -> Self:
        """A span running backwards is a typo in one of the two dates, and nothing downstream can tell which one."""

        refuse_reversed_span(start=self.beginn, end=self.ende, start_label="dem Beginn", end_label="Das Ende")

        return self


class FLSpieltageListResponse(BaseAPIResponse):
    spieltage: list[FLSpieltag]


class FLSpieltageSingleResponse(BaseAPIResponse):
    spieltag: FLSpieltag


class FLSpieltagWriteResponse(BaseAPIResponse):
    spieltag_id: CustomObjectId
    updated_document: FLSpieltag
