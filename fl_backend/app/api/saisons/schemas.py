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

# The league's school-level vocabulary, imported rather than restated: `rules.erlaubte_stufen` names
# WHICH of it a season runs and must not be able to name a level the league does not have (ADR-0061).
# Acyclic -- the spieler slice imports nothing from this one.
from app.api.spieler.schemas import FLSpielerStufe
from app.shared.schemas.custom import CustomDateString
from app.shared.schemas.responses import BaseAPIResponse

FLSaisonStatus = Literal["past", "active", "future"]
FLSaisonsSortOptions = Literal["_id", "start_date", "end_date"]


class FLSaisonRules(BaseModel):
    win_points: int = Field(gt=0)
    draw_points: int = Field(ge=0)
    # How many of each group's teams reach the first knockout round. English, like the two above: it
    # configures the competition rather than naming anything in it (ADR-0043).
    #
    # REQUIRED, with no default, and that is the load-bearing part. A default would let a season
    # document that has never carried the key read as though it had, and the number would then be a
    # constant chosen in this file -- which is what ADR-0026 refused for 3/1/0. It is read on every
    # `GET /teams`, so a season missing it fails loudly on the next read rather than seeding a bracket
    # from a guess. See the runbook in ADR-0043.
    qualifiers_per_group: int = Field(gt=0)

    # The season's capacity, read by `POST /teams/{team_id}/saisons` (owner, 2026-08-07): a team
    # enters only a group the season offers -- the first `number_of_groups` of the closed A-D set,
    # which is what bounds it at 4 -- and only while that group holds fewer than `teams_per_group`
    # rows. REQUIRED with no default for exactly the reason `qualifiers_per_group` is; both keys are
    # owed on every existing document before this deploys, and `--check` reports which still lack
    # them.
    number_of_groups: int = Field(gt=0, le=4)
    teams_per_group: int = Field(gt=0)

    # Which school levels this season's squads may hold (owner, 2026-08-07). A SUBSET of the closed
    # set `FLSpielerStufe` declares -- that Literal is the vocabulary, and this is which of it a given
    # season runs, exactly as `number_of_groups` picks a prefix of the closed A-D set rather than
    # redefining it (ADR-0061).
    #
    # REQUIRED with no default, for the reason `qualifiers_per_group` is: a default would let a
    # season that has never carried the key read as though it had, and the offered levels would then
    # be a constant chosen in this file. `--check` reports a document still lacking it.
    #
    # Not enforced against `saison_spieler` by any validator, and deliberately: a row's `stufe` is
    # held to the LEAGUE's set, not to one season's, so narrowing a season cannot retroactively
    # invalidate the squads of a season already played. This bounds what the form offers.
    erlaubte_stufen: list[FLSpielerStufe] = Field(min_length=1)


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
