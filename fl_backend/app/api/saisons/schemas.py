"""
SAISONS · models

The season model, its filter options and the response shapes.

Invariants:
- `status` is on no payload: exactly one season carries `active`, no validator can express that, and
  `POST /saisons/{saison_id}/activate` moves the incumbent aside in one transaction (ADR-0026).
- A season is never deleted -- an old one is `past`, which is what "gone" means here (ADR-0026).
"""

from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter, model_validator

# The phase set, imported rather than restated, exactly as `spieltage/schemas.py` imports it. Acyclic --
# the spiele slice imports from `teams` and `shared` and from neither this one nor `spieler`.
from app.api.spiele.schemas import FLSaisonPhase

# The league's school-level vocabulary, imported rather than restated: `rules.erlaubte_stufen` names
# which of it a season runs, and cannot name a level the league lacks (ADR-0048). Acyclic -- the
# spieler slice imports nothing from here.
from app.api.spieler.schemas import FLSpielerStufe

# The closed group set, imported rather than restated, for the reason the two above are. Acyclic -- the
# teams slice's MODELS import nothing but `app.shared`; it is `teams/services.py` that reads this file.
from app.api.teams.schemas import FLGruppenNames
from app.shared.schemas.custom import CustomDateString, CustomObjectId, refuse_reversed_span
from app.shared.schemas.responses import BaseAPIResponse

FLSaisonStatus = Literal["past", "active", "future"]
FLSaisonsSortOptions = Literal["_id", "start_date", "end_date"]


class FLSaisonRules(BaseModel):
    win_points: int = Field(gt=0)
    draw_points: int = Field(ge=0)
    # How many of each group's teams reach the first knockout round. REQUIRED with no default: one
    # would make the number a constant chosen in this file, which is what ADR-0019 refused for 3/1/0.
    # See the runbook in ADR-0035.
    qualifiers_per_group: int = Field(gt=0)

    # The season's capacity, read by `POST /teams/{team_id}/saisons`: a team enters only a group the
    # season offers -- a prefix of the closed A-D set -- and only while that group has room. No
    # default, for the reason `qualifiers_per_group` has none.
    number_of_groups: int = Field(gt=0, le=4)
    teams_per_group: int = Field(gt=0)

    # A SUBSET of the closed set `FLSpielerStufe` declares (ADR-0048), required with no default. No
    # validator holds `saison_spieler` to it -- this bounds what the FORM offers, so narrowing a season
    # cannot invalidate one already played.
    erlaubte_stufen: list[FLSpielerStufe] = Field(min_length=1)


class FLSaisonPhaseSchedule(BaseModel):
    """
    One phase of a season: how many matchdays it takes, and how many matches each of those holds.

    Mirrors `fl_backend/app/api/saisons/schedule.py :: PhaseSchedule`, which is the derivation; this is the wire
    shape for it. A phase this season's bracket does not reach is absent rather than present with zeroes,
    so the list IS the phases the season plays, in playing order.
    """

    phase: FLSaisonPhase
    matchdays: int = Field(ge=0)
    matches_per_matchday: int = Field(ge=0)


class FLSaison(BaseModel):
    # Exactly 4 characters, because FLSpiel.saison_id and FLSpieltag.saison_id both demand that of
    # the value referencing this one. Without it a saison id like "2026/27" validates here and then
    # every spiel and spieltag pointing at it fails to parse on read.
    id: str = Field(validation_alias="_id", serialization_alias="id", min_length=4, max_length=4)

    start_date: CustomDateString
    end_date: CustomDateString
    status: FLSaisonStatus
    rules: FLSaisonRules

    # DERIVED, and on no document (ADR-0052). Served because the matchday editor needs the count for a
    # phase the matchday does not have yet. Injected before validation, because a computed field would
    # close an import cycle.
    schedule: tuple[FLSaisonPhaseSchedule, ...]


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

    @model_validator(mode="after")
    def the_season_ends_after_it_starts(self) -> "FLPostSaisonPayload":
        refuse_reversed_span(start=self.start_date, end=self.end_date, start_label="dem Startdatum", end_label="Das Enddatum")

        return self


class FLPatchSaisonPayload(BaseModel):
    start_date: CustomDateString
    end_date: CustomDateString
    rules: FLSaisonRules

    @model_validator(mode="after")
    def the_season_ends_after_it_starts(self) -> "FLPatchSaisonPayload":
        """
        The same rule as on the create, and it is the one rule a `past` season's edit can still fail.

        `find_rules_refusal` freezes the competitive fields of a finished season and leaves the dates
        editable precisely so a mistyped one can be repaired (ADR-0052) -- so this is what makes that
        repair land on a value that is actually in order rather than on a second wrong one.
        """

        refuse_reversed_span(start=self.start_date, end=self.end_date, start_label="dem Startdatum", end_label="Das Enddatum")

        return self


class FLSwapGruppenPayload(BaseModel):
    """
    The two clubs a group swap exchanges. Symmetric -- neither side is the one being moved.

    **Neither side carries a `gruppe`, and that absence is the design** (ADR-0062). The groups being
    exchanged are what the two `saison_teams` rows already hold, so reading them from the payload would
    let a form built against a season that has since moved write a group nobody is standing in. The
    season is in the path, because a swap belongs to the season (ADR-0057).
    """

    team1_id: CustomObjectId
    team2_id: CustomObjectId


class FLSwapGruppenResponse(BaseAPIResponse):
    """
    Both junction rows as the swap left them: each club, and the group it now holds.

    Flat rather than two nested sides, because there is nothing else on a junction row this write
    touches -- `disqualifikation` is `PATCH /teams/{team_id}/saisons/{saison_id}`'s and is not read here.
    """

    saison_id: str
    team1_id: CustomObjectId
    team1_gruppe: FLGruppenNames
    team2_id: CustomObjectId
    team2_gruppe: FLGruppenNames


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
