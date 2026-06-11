from pydantic import BaseModel, Field, TypeAdapter

from app.shared.schemas.custom_types import CustomObjectId, CustomStrDate, CustomStrTime


class FLSpielTeamField(BaseModel):
    team_id: CustomObjectId
    name: str
    tore: int | None


class FLSpiel(BaseModel):
    id: CustomObjectId = Field(alias="_id")  # So the _id field can be accesed through id

    team1: FLSpielTeamField
    team2: FLSpielTeamField

    datum: CustomStrDate | None
    uhrzeit: CustomStrTime | None
    ort: str | None

    schiedsrichter: str | None
    mietpreis: float = 0

    ergebnis: str | None
    spieltag_id: CustomObjectId
    spiel_nr: int

    is_canceled: bool


FLSpielListAdapter = TypeAdapter(list[FLSpiel])


class FLSpieltag(BaseModel):
    id: CustomObjectId = Field(alias="_id")  # So the _id field can be accesed through
    name: str

    beginn: CustomStrDate
    ende: CustomStrDate
    anzahl_spiele: int
    order_val: int


class FLSpieltagWithSpiele(FLSpieltag):
    spiele: list[FLSpiel]


FLSpieltagListAdapter = TypeAdapter(list[FLSpieltag])
FLSpieltagWithSpieleListAdapter = TypeAdapter(list[FLSpieltagWithSpiele])


class FLSpielplan(BaseModel):
    spieltage: list[FLSpieltagWithSpiele]
