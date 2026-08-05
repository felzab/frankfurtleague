"""
TEAMS · models

The read shapes `GET /teams` discriminates by `format`, the single-team shape, the write payloads and
their echoes, plus the statistics model and the four-group container.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `FLTeam` is FLATTENED from more than one source: the season-independent `teams` record, the
    `gruppe` and `is_disqualified` of the `saison_teams` junction row, and a `statistik` computed from
    the season's matches. That is why fields exist here that no single collection carries.
  • There is ONE team shape. Never add a reduced projection beside it (ADR-0034).
  • `FLGruppen` always emits all four group keys, even empty ones. A map built from the teams present
    omits "D" for a season with nobody in it, and the frontend schema requires all four.
  • Statistics fields are all `ge=0` and default to 0. The default is load-bearing: a team whose season
    holds no counting match is served a zeroed object, not an absent one.
  • `statistik_scope` decides WHICH matches those seven numbers count, and it defaults to
    `"gruppenphase"`. The response shape is identical either way, so a caller that gets the scope wrong
    gets a plausible table rather than an error -- which is why the safe value is the default.
  • The `format` discriminator is what lets one endpoint return a list or the four groups. Adding a
    shape means adding a literal, not widening an existing model.
  • `FLTeam` is a READ shape and `FLTeamRecord` is the STORED one. A write endpoint echoes the record:
    it changed no season-scoped field, and re-reading one through the pipeline would 404 for a club
    with no junction row in the current season.

 DECISIONS ────────────────────────────────────────────────────────────────────────────────────────────────

  ADR-0026  statistik is derived from the matches on every read
  ADR-0029  the table counts the Gruppenphase, and that is the default scope
  ADR-0032  `inactive_since` is the day the club left the league
  ADR-0034  one team shape, no reduced projection

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  app/api/teams/services.py -- the join that flattens the three sources
"""

from typing import Annotated, Literal, Mapping, Union, get_args

from pydantic import BaseModel, Field, RootModel, TypeAdapter

from app.shared.schemas.addresses import FLAddress
from app.shared.schemas.custom import CustomExternalUrl, CustomObjectId, CustomOptionalDateString
from app.shared.schemas.responses import BaseAPIResponse

FLGruppenNames = Literal["A", "B", "C", "D"]

# Which matches the derived table counts (ADR-0029). Two values rather than a free `saison_phase`
# filter: a table of the Halbfinale alone is not a standing anybody wants, and offering it invites
# one. `"gruppenphase"` is spelled exactly as the stored `FLSpiel.saison_phase` value it filters on.
FLTeamStatistikScope = Literal["gruppenphase", "gesamt"]


class FLTeamStatistik(BaseModel):
    # `default=` by keyword, never `Field(0, ge=0)`. Pydantic treats the two identically; the type
    # checker does not. Pyright reads a field specifier's default by ARGUMENT NAME, so a positional
    # one leaves it believing the field is required -- and every construction that omits it is then
    # flagged in the editor while the tests and ruff stay silent.
    anzahl_gespielte_spiele: int = Field(default=0, ge=0)
    siege: int = Field(default=0, ge=0)
    niederlagen: int = Field(default=0, ge=0)
    unentschieden: int = Field(default=0, ge=0)
    tore_geschossen: int = Field(default=0, ge=0)
    tore_kassiert: int = Field(default=0, ge=0)
    punkte: int = Field(default=0, ge=0)


class FLTeam(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through

    name: str = Field(min_length=1)
    gruppe: FLGruppenNames
    statistik: FLTeamStatistik
    is_disqualified: bool
    shorthand: str = Field(min_length=2, max_length=2)
    description: str  # May be empty -- not every team writes one.
    full_name: str = Field(min_length=1)
    # Rendered straight into an href on a public page, so the scheme is constrained here as well as
    # in the frontend. See validate_external_url for why this is not AnyHttpUrl.
    website_url: CustomExternalUrl
    address: FLAddress
    # The day this CLUB left the league, or null while it plays (ADR-0032). Not the same thing as
    # leaving one season: a team never leaves a season except by disqualification, which is
    # `is_disqualified` above and lives on the junction (ADR-0033).
    inactive_since: CustomOptionalDateString


FLTeamListAdapter = TypeAdapter(list[FLTeam])


class FLTeamRecord(BaseModel):
    """
    The club document as it is STORED — `FLTeam` minus the three fields no `teams` document carries.

    What the write endpoints echo back. A write to `teams` changes the club and nothing season-scoped,
    so `gruppe`, `is_disqualified` and `statistik` are not this endpoint's to report — and reading them
    would mean re-running the team pipeline, whose junction join is strict. A club with no
    `saison_teams` row for the current season drops out of that pipeline entirely, which is the normal
    state for a club being created, retired or reactivated.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    name: str = Field(min_length=1)
    shorthand: str = Field(min_length=2, max_length=2)
    description: str
    full_name: str = Field(min_length=1)
    website_url: CustomExternalUrl
    address: FLAddress
    inactive_since: CustomOptionalDateString


class FLGruppen(RootModel[Mapping[FLGruppenNames, list[FLTeam]]]):
    """
    The four groups, always all four.

    Keyed by FLGruppenNames rather than a free-form str, and seeded with every group, so the
    response shape does not depend on which groups happen to have teams. Never build it from the
    teams present alone: a season with nobody in group D would omit the "D" key, the frontend's
    FLGruppenSchema requires all four, and /dashboard/saisontabelle fails to parse the response.
    Every season so far has had teams in all four groups, so that failure hides until it does not.
    """

    @classmethod
    def from_teams(cls, teams: list[FLTeam]):
        # Keyed by FLGruppenNames, not str: Mapping's key type is invariant, so a dict[str, ...]
        # is not assignable to the RootModel's Mapping[FLGruppenNames, ...].
        grouped: dict[FLGruppenNames, list[FLTeam]] = {name: [] for name in get_args(FLGruppenNames)}

        for team in teams:
            # FLTeam.gruppe is FLGruppenNames, so validation already rejects a blank or unknown
            # group -- earlier and louder than here. This still guards the one way round that: an
            # FLTeam built with model_construct, which skips validation entirely.
            #
            # Tested against `grouped` rather than for falsiness: `not team.gruppe` catches "" and
            # None but lets "X" through to a bare KeyError -- an unhandled 500 instead of the
            # deliberate error this guard exists to raise.
            if team.gruppe not in grouped:
                raise ValueError(f"Team {team.id} has gruppe {team.gruppe!r}, which is not one of A/B/C/D")
            # No .upper(): the Literal has already pinned the value to exactly A/B/C/D.
            grouped[team.gruppe].append(team)

        # Sort each list inside the dict
        for group_name in grouped:
            grouped[group_name].sort(
                key=lambda team: (
                    team.statistik.punkte,
                    (team.statistik.tore_geschossen - team.statistik.tore_kassiert),
                ),
                reverse=True,
            )
        return cls(grouped)


class FLPostTeamPayload(BaseModel):
    name: str = Field(min_length=1)
    shorthand: str = Field(min_length=2, max_length=2)
    description: str
    full_name: str = Field(min_length=1)
    website_url: CustomExternalUrl
    address: FLAddress


class FLPatchTeamPayload(BaseModel):
    name: str = Field(min_length=1)
    shorthand: str = Field(min_length=2, max_length=2)
    description: str
    full_name: str = Field(min_length=1)
    website_url: CustomExternalUrl
    address: FLAddress


class FLPostSaisonTeamPayload(BaseModel):
    """One team's membership of one season. `team_id` comes from the path, `saison_id` from here."""

    saison_id: str = Field(min_length=4, max_length=4)
    gruppe: FLGruppenNames


class FLPatchSaisonTeamPayload(BaseModel):
    gruppe: FLGruppenNames
    # A bare boolean today. FB-2 replaces it with a record carrying a reason and a date, and this is
    # the field that becomes it -- there is no second copy anywhere, because FLSpiel joins the flag
    # rather than storing it (ADR-0028).
    is_disqualified: bool


class FLTeamsFilterParams(BaseModel):
    # No `team_id`. One team by its id is an identity and is addressed by `GET /teams/{team_id}`;
    # what stays here narrows a list.
    saison_id: str | None = None
    gruppe: FLGruppenNames | None = None
    is_disqualified: bool | None = None
    in_gruppen: bool | None = None
    include_inactive: bool = False  # Exclude clubs that have left the league by default

    # Defaults to the GROUP TABLE, so an omitted parameter is the correct standing rather than the
    # playoff-polluted one (ADR-0029). The all-games figures are an explicit ask.
    statistik_scope: FLTeamStatistikScope = Field(default="gruppenphase")

    limit: int = Field(default=1024, ge=1, le=1024)
    sort_by: Literal["name"] = Field(default="name")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLTeamSingleFilterParams(BaseModel):
    """
    What `GET /teams/{team_id}` accepts, which is deliberately far less than the list endpoint.

    A separate model rather than reusing `FLTeamsFilterParams`, whose remaining fields are meaningless
    here: `in_gruppen` groups a set of one, and `limit`/`sort_by`/`order` order a list that cannot have
    more than one member. Only the two choosing WHICH SEASON'S figures to derive belong, and those are
    genuine -- a team's `gruppe` and `statistik` do not exist outside a season (ADR-0026, ADR-0029).
    """

    saison_id: str | None = None
    statistik_scope: FLTeamStatistikScope = Field(default="gruppenphase")


class FLTeamsListResponse(BaseAPIResponse):
    format: Literal["list"] = "list"
    teams: list[FLTeam]


class FLTeamsGroupedResponse(BaseAPIResponse):
    format: Literal["grouped"] = "grouped"
    gruppen: FLGruppen


class FLTeamsSingleResponse(BaseAPIResponse):
    """
    One team, from `GET /teams/{team_id}`.

    Deliberately not part of `FLTeamsResponse`: that union discriminates the shapes ONE endpoint can
    return, and this is a different endpoint returning exactly one shape.
    """

    format: Literal["single"] = "single"
    team: FLTeam


class FLPostTeamResponse(BaseAPIResponse):
    created_id: CustomObjectId


class FLPatchTeamResponse(BaseAPIResponse):
    updated_document: FLTeamRecord
    # How many embedded copies the rename reached. Reported rather than assumed: the fan-out is the
    # half of this endpoint that fails silently, so the count is the thing worth seeing.
    fanned_out_to_spiele: int


class FLTeamWriteResponse(BaseAPIResponse):
    """What the retire and reactivate endpoints echo. `FLTeamRecord`, for the reason stated on it."""

    updated_document: FLTeamRecord


class FLSaisonTeamResponse(BaseAPIResponse):
    """A junction row, which has no read model of its own -- so it is echoed as it was written."""

    saison_id: str
    team_id: CustomObjectId
    gruppe: FLGruppenNames
    is_disqualified: bool


# Pydantic uses the 'format' field to decide which model to validate against
FLTeamsResponse = Annotated[
    Union[FLTeamsListResponse, FLTeamsGroupedResponse],
    Field(discriminator="format"),
]
