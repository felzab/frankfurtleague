from collections import defaultdict

from pydantic import BaseModel, Field, TypeAdapter, model_validator

from app.shared.schemas.custom_types import CustomObjectId


class FLSpieler(BaseModel):
    id: CustomObjectId = Field(alias="_id")  # So the _id field can be accesed through

    vorname: str | None
    nachname: str | None
    stufe: str | None
    nummer: str | None
    position: str | None
    nachgetragen: bool = False
    team_id: CustomObjectId


FLSpielerListAdapter = TypeAdapter(list[FLSpieler])


class FLTeamStatistik(BaseModel):
    anzahl_gespielte_spiele: int
    siege: int
    niederlagen: int
    unentschieden: int
    tore_geschossen: int
    tore_kassiert: int
    punkte: int


class FLTeamAddress(BaseModel):
    strasse: str
    hausnummer: str
    plz: str = Field(min_length=5, max_length=5)
    stadtteil: str
    stadt: str


class FLTeam(BaseModel):
    id: CustomObjectId = Field(alias="_id")  # So the _id field can be accesed through

    name: str
    gruppe: str
    statistik: FLTeamStatistik
    is_placeholder: bool
    is_disqualified: bool
    shorthand: str = Field(min_length=2, max_length=2)
    description: str
    full_name: str
    website_url: str
    address: FLTeamAddress


class FLTeamCompact(BaseModel):
    id: CustomObjectId = Field(alias="_id")  # So the _id field can be accesed through

    name: str
    statistik: FLTeamStatistik
    shorthand: str = Field(min_length=2, max_length=2)
    address: FLTeamAddress


class FLTeamWithSpieler(FLTeam):
    spieler: list[FLSpieler]


FLTeamListAdapter = TypeAdapter(list[FLTeam])
FLTeamWithSpielerListAdapter = TypeAdapter(list[FLTeamWithSpieler])
FLTeamCompactListAdapter = TypeAdapter(list[FLTeamCompact])


class FLGruppen(BaseModel):
    A: list[FLTeam]
    B: list[FLTeam]
    C: list[FLTeam]
    D: list[FLTeam]

    @classmethod
    def from_teams(cls, teams: list[FLTeam]):
        grouped = defaultdict(list)
        for team in teams:
            # We enforce the logic here, explicitly
            group_key = team.gruppe.upper()
            if group_key in cls.model_fields:
                grouped[group_key].append(team)

        # We instantiate the class with the dictionary we just built
        return cls(**grouped)

    # Sort teams primarily by points and secondarily by goal-difference
    @model_validator(mode="after")
    def sort_all_groups(self) -> "FLGruppen":
        for field_name in self.__class__.model_fields:
            value = getattr(self, field_name)

            if isinstance(value, list):
                value.sort(
                    key=lambda team: (
                        (team.statistik.punkte),
                        (team.statistik.tore_geschossen - team.statistik.tore_kassiert),
                    ),
                    reverse=True,
                )
        return self
