from typing import Annotated, Literal, Mapping, Union, get_args

from pydantic import BaseModel, Field, RootModel, TypeAdapter

from app.api.spieler.schemas import FLSpieler
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


class FLTeamWithSpieler(FLTeam):
    spieler: list[FLSpieler]


FLTeamListAdapter = TypeAdapter(list[FLTeam])
FLTeamWithSpielerListAdapter = TypeAdapter(list[FLTeamWithSpieler])
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
        grouped: dict[str, list[FLTeam]] = {name: [] for name in get_args(FLGruppenNames)}

        for team in teams:
            # A team with no group has nowhere to go. Raising surfaces the bad row; the previous
            # "UNKNOWN" bucket was silently dropped by the frontend, so the team just vanished
            # from the league table with no error anywhere.
            if not team.gruppe:
                raise ValueError(f"Team {team.id} has no gruppe and cannot be grouped")
            grouped[team.gruppe.upper()].append(team)

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


class FLTeamsGruppenResponse(BaseAPIResponse):
    format: Literal["grouped"] = "grouped"
    gruppen: FLGruppen


# Pydantic uses the 'format' field to decide which model to validate against
FLTeamsResponse = Annotated[
    Union[FLTeamsListResponse, FLTeamsGruppenResponse, FLTeamsCompactListResponse],
    Field(discriminator="format"),
]
