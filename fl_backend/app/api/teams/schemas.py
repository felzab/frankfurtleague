from typing import Annotated, Literal, Mapping, Union, get_args

from pydantic import BaseModel, Field, RootModel, TypeAdapter

from app.shared.schemas.addresses import FLAddress
from app.shared.schemas.custom import CustomExternalUrl, CustomObjectId
from app.shared.schemas.responses import BaseAPIResponse

FLGruppenNames = Literal["A", "B", "C", "D"]


class FLTeamStatistik(BaseModel):
    anzahl_gespielte_spiele: int = Field(0, ge=0)
    siege: int = Field(0, ge=0)
    niederlagen: int = Field(0, ge=0)
    unentschieden: int = Field(0, ge=0)
    tore_geschossen: int = Field(0, ge=0)
    tore_kassiert: int = Field(0, ge=0)
    punkte: int = Field(0, ge=0)


class FLTeam(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through

    name: str = Field(min_length=1)
    gruppe: FLGruppenNames
    statistik: FLTeamStatistik
    is_placeholder: bool
    is_disqualified: bool
    shorthand: str = Field(min_length=2, max_length=2)
    description: str  # May be empty -- not every team writes one.
    full_name: str = Field(min_length=1)
    # Rendered straight into an href on a public page, so the scheme is constrained here as well as
    # in the frontend. See EXTERNAL_URL_REGEX for why this is not AnyHttpUrl.
    website_url: CustomExternalUrl
    address: FLAddress


class FLTeamCompact(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through

    name: str = Field(min_length=1)
    statistik: FLTeamStatistik
    shorthand: str = Field(min_length=2, max_length=2)
    address: FLAddress
    is_disqualified: bool


FLTeamListAdapter = TypeAdapter(list[FLTeam])
FLTeamCompactListAdapter = TypeAdapter(list[FLTeamCompact])


class FLGruppen(RootModel[Mapping[FLGruppenNames, list[FLTeam]]]):
    """
    The four groups, always all four.

    Keyed by FLGruppenNames rather than a free-form str, and seeded with every group, so the
    response shape does not depend on which groups happen to have teams. Previously a
    defaultdict was filled only from the teams present, so a season with nobody in group D
    omitted the "D" key entirely -- and the frontend's FLGruppenSchema requires all four, so
    that response failed to parse and took down /dashboard/saisontabelle. It worked only
    because every season so far has had teams in all four groups.
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


class FLTeamsFilterParams(BaseModel):
    team_id: CustomObjectId | None = Field(default=None, validation_alias="team_id", serialization_alias="_id")
    saison_id: str | None = None
    gruppe: FLGruppenNames | None = None
    is_disqualified: bool | None = None
    in_gruppen: bool | None = None
    compact: bool | None = None
    include_placeholders: bool = False  # Exclude placeholders by default

    limit: int = Field(1024, ge=1, le=1024)
    sort_by: Literal["name"] = Field(default="name")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLTeamsListResponse(BaseAPIResponse):
    format: Literal["list"] = "list"
    teams: list[FLTeam]


class FLTeamsCompactListResponse(BaseAPIResponse):
    format: Literal["compact"] = "compact"
    teams: list[FLTeamCompact]


class FLTeamsGroupedResponse(BaseAPIResponse):
    format: Literal["grouped"] = "grouped"
    gruppen: FLGruppen


# Pydantic uses the 'format' field to decide which model to validate against
FLTeamsResponse = Annotated[
    Union[FLTeamsListResponse, FLTeamsGroupedResponse, FLTeamsCompactListResponse],
    Field(discriminator="format"),
]
