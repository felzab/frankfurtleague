"""
SPIELTAGE · models

**A matchday stores no POSITION, no MATCH COUNT and no NAME, and all three absences are decisions.** The
position is `saison_phase` in bracket order, then `beginn`, then `_id` (ADR-0064) -- fields that already
have to be right for other reasons, so there is nothing to set and nothing to collide. The count follows
from the season's rules, because a single round robin per group determines it exactly (ADR-0065), so
`anzahl_spiele` is on the read model and on neither payload: it is served, never written. And the name
carries no information at all -- a group matchday is its ordinal and a knockout matchday is its round --
so it is composed by the reader from `saison_phase` and the position, and this model has no field for it
(ADR-0064).

**The name is composed on the FRONTEND rather than served from here**, because it is German display text.
`quelle` set the same precedent: a reference carries no label, and what a card shows is derived where it is
shown (ADR-0042). The backend has no German vocabulary for the phases and gains none for this.

`FLSaisonPhase` and `PHASE_RANK` are imported from the spiele slice rather than redeclared, so the set
and its ordering cannot drift from the rules that refuse a feeder played too late.
"""

from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter, model_validator

from app.api.spiele.schemas import FLSaisonPhase
from app.shared.schemas.custom import CustomDateString, CustomObjectId, CustomOptionalDateString, refuse_reversed_span
from app.shared.schemas.responses import BaseAPIResponse


class FLSpieltag(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through

    beginn: CustomDateString
    ende: CustomDateString
    # DERIVED, and on no document (ADR-0065). A single round robin per group determines exactly how many
    # matches a matchday of a given phase holds, so this is `app/api/saisons/schedule.py ::
    # expected_matches` over the season's `rules` -- the same shape `FLTeam.statistik` has. `ge=0` rather
    # than `gt=0` because a matchday in a phase this season's bracket does not reach expects none, which
    # is the honest answer and the one the admin list reports.
    anzahl_spiele: int = Field(ge=0)
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
    # then `_id` (ADR-0064). The two alternatives are the only other SORTABLE fields -- `anzahl_spiele`
    # left this list with the stored column, because a Mongo sort cannot order by a value no document
    # holds (ADR-0065).
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
    # `saison_id` is absent: moving a matchday between seasons would strand its matches, which carry
    # their own `saison_id` and are not rewritten here.

    @model_validator(mode="after")
    def the_matchday_ends_after_it_begins(self) -> "FLPatchSpieltagPayload":
        """
        The same rule as on the create -- and here it also protects the ORDER of the season's list.

        Matchdays are sorted by `beginn` within a phase (ADR-0064), so a span running backwards is a
        matchday whose own two dates disagree about where it sits.
        """

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
