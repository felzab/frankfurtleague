from collections import defaultdict
from typing import Annotated, Literal, Mapping, Union

from pydantic import BaseModel, Field, RootModel, TypeAdapter

from app.api.spieler.schemas import FLSpieler
from app.shared.schemas.addresses import FLAddress
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.responses import BaseAPIResponse

FLGruppenNames = Literal["A", "B", "C", "D"]


class FLTeamStatistik(BaseModel):
    anzahl_gespielte_spiele: int = 0
    siege: int = 0
    niederlagen: int = 0
    unentschieden: int = 0
    tore_geschossen: int = 0
    tore_kassiert: int = 0
    punkte: int = 0


class FLTeam(BaseModel):
    id: CustomObjectId = Field(
        validation_alias="_id", serialization_alias="id"
    )  # So the _id field can be accesed through

    name: str
    gruppe: str
    statistik: FLTeamStatistik
    is_placeholder: bool
    is_disqualified: bool
    shorthand: str = Field(min_length=2, max_length=2)
    description: str
    full_name: str
    website_url: str
    address: FLAddress


class FLTeamCompact(BaseModel):
    id: CustomObjectId = Field(
        validation_alias="_id", serialization_alias="id"
    )  # So the _id field can be accesed through

    name: str
    statistik: FLTeamStatistik
    shorthand: str = Field(min_length=2, max_length=2)
    address: FLAddress


class FLTeamWithSpieler(FLTeam):
    spieler: list[FLSpieler]


FLTeamListAdapter = TypeAdapter(list[FLTeam])
FLTeamWithSpielerListAdapter = TypeAdapter(list[FLTeamWithSpieler])
FLTeamCompactListAdapter = TypeAdapter(list[FLTeamCompact])


class FLGruppen(RootModel[Mapping[str, list[FLTeam]]]):
    @classmethod
    def from_teams(cls, teams: list[FLTeam]):
        grouped = defaultdict(list)
        for team in teams:
            group_key = team.gruppe.upper() if team.gruppe else "UNKNOWN"
            grouped[group_key].append(team)

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
    team_id: CustomObjectId | None = Field(
        default=None, validation_alias="team_id", serialization_alias="_id"
    )
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
