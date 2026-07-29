from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, TypeAdapter, model_validator

from app.shared.schemas.custom import CustomDateString, CustomObjectId, CustomOptionalDateString, CustomOptionalTimeString, CustomTimeString
from app.shared.schemas.responses import BaseAPIResponse

FLSaisonPhase = Literal["gruppenphase", "viertelfinale", "halbfinale", "finale"]
FLSpielStatus = Literal["ausstehend", "vergangen", "heute", "abgesagt", "unbekannt"]


class PatchSpielDataPayload(BaseModel):
    spiel_id: CustomObjectId
    is_canceled: bool

    team1: FLSpielTeamField
    team2: FLSpielTeamField

    datum: CustomOptionalDateString
    uhrzeit: CustomOptionalTimeString
    ort: FLSpielOrtField | None
    schiedsrichter: FLSpielSchiedsrichterField | None

    @model_validator(mode="before")
    @classmethod
    def empty_strings_to_none(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: (None if isinstance(v, str) and v.strip() == "" else v) for k, v in data.items()}
        return data


class FLSpielTeamField(BaseModel):
    team_id: CustomObjectId
    name: str
    tore: Annotated[int, Field(ge=0)] | None
    shorthand: str = Field(min_length=2, max_length=2)


class FLSpielOrtField(BaseModel):
    spielort_id: CustomObjectId
    name: str
    maps_link: str
    mietpreis: float = 0


class FLSpielSchiedsrichterField(BaseModel):
    schiedsrichter_id: CustomObjectId
    name: str
    payment: int


class FLSpiel(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through id

    team1: FLSpielTeamField
    team2: FLSpielTeamField

    datum: CustomDateString | None
    uhrzeit: CustomTimeString | None

    ort: FLSpielOrtField | None
    schiedsrichter: FLSpielSchiedsrichterField | None

    ergebnis: str | None
    spieltag_id: CustomObjectId
    spiel_nr: int

    is_canceled: bool
    saison_phase: FLSaisonPhase
    saison_id: str = Field(min_length=4, max_length=4)


FLSpielListAdapter = TypeAdapter(list[FLSpiel])


class FLSpieltag(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through
    name: str

    beginn: CustomDateString
    ende: CustomDateString
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
