from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.shared.schemas.custom_types import CustomObjectId, CustomStrDate, CustomStrTime
from app.shared.schemas.responses import BaseAPIResponse

FLSaisonPhase = Literal["gruppenphase", "viertelfinale", "halbfinale", "finale"]
FLSpielStatus = Literal["ausstehend", "vergangen", "heute", "abgesagt", "unbekannt"]


class FLSpielTeamField(BaseModel):
    team_id: CustomObjectId
    name: str
    tore: int | None
    shorthand: str = Field(min_length=2, max_length=2)


class FLSpiel(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through id

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
    saison_phase: FLSaisonPhase


FLSpielListAdapter = TypeAdapter(list[FLSpiel])


class FLSpieltag(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through
    name: str

    beginn: CustomStrDate
    ende: CustomStrDate
    anzahl_spiele: int
    order_val: int
    saison_phase: FLSaisonPhase


class FLSpieltagWithSpiele(FLSpieltag):
    spiele: list[FLSpiel]


FLSpieltagListAdapter = TypeAdapter(list[FLSpieltag])
FLSpieltagWithSpieleListAdapter = TypeAdapter(list[FLSpieltagWithSpiele])


class FLSpielplan(BaseModel):
    spieltage: list[FLSpieltagWithSpiele]


class FLSpieleFilterParams(BaseModel):
    saison_id: str | None = None
    saison_phase: Literal["playoffs"] | FLSaisonPhase | None = None
    spiel_status: FLSpielStatus | None = None
    team_id: CustomObjectId | None = None

    limit: int = Field(1024, ge=1, le=1024)
    sort_by: Literal["datum", "uhrzeit", "spiel_nr", "saison_phase"] = Field(default="datum")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLSpieleListResponse(BaseAPIResponse):
    spiele: list[FLSpiel]
