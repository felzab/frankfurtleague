from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints, TypeAdapter, model_validator

from app.shared.schemas.custom import CustomDateString, CustomObjectId, CustomOptionalDateString, CustomOptionalTimeString, CustomTimeString
from app.shared.schemas.responses import BaseAPIResponse

FLSaisonPhase = Literal["gruppenphase", "viertelfinale", "halbfinale", "finale"]
FLSpielStatus = Literal["ausstehend", "vergangen", "heute", "abgesagt", "unbekannt"]


# The three embedded field models are declared BEFORE the payload and FLSpiel that reference them.
# With them below, those models resolved only through PEP 649 deferred annotations plus pydantic's
# lazy rebuild -- __pydantic_complete__ stayed False until the first validation, so anything reaching
# into the core schema earlier raised PydanticUserError instead of a clean ValidationError.
class FLSpielTeamField(BaseModel):
    team_id: CustomObjectId
    name: str = Field(min_length=1)
    tore: Annotated[int, Field(ge=0)] | None
    shorthand: str = Field(min_length=2, max_length=2)


class FLSpielOrtField(BaseModel):
    spielort_id: CustomObjectId
    name: str = Field(min_length=1)
    # Free text (venue name + address) searched on Google Maps, NOT a URL -- so no scheme check.
    maps_link: str = Field(min_length=1)
    # int, not float: a rental price is whole euros. Stored values are already integral.
    #
    # Required, with no default, on BOTH paths this model serves:
    #   write -- the admin PATCH writes the payload back wholesale with $set (admin/router.py), so a
    #            default let a request omitting the field silently overwrite a venue's rent with 0,
    #            while the sibling `payment` below correctly 422'd in the same situation.
    #   read  -- FLSpielOrtField is embedded in FLSpiel, so this also validates every document read
    #            out of Mongo. Verified before removing the default: 25 of 25 spiele with an `ort`
    #            carry `mietpreis`, and the frontend's FLSpielOrtFieldSchema has always required it,
    #            so a document without it would already have been failing the client-side parse.
    mietpreis: int = Field(ge=0)


class FLSpielSchiedsrichterField(BaseModel):
    schiedsrichter_id: CustomObjectId
    name: str = Field(min_length=1)
    payment: int = Field(ge=0)


class FLPatchSpielDataPayload(BaseModel):
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


class FLSpiel(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through id

    team1: FLSpielTeamField
    team2: FLSpielTeamField

    datum: CustomDateString | None
    uhrzeit: CustomTimeString | None

    ort: FLSpielOrtField | None
    schiedsrichter: FLSpielSchiedsrichterField | None

    # "Tore:Tore", or null when the match has not been played. Parsed as structured data by the
    # frontend, which derives win/draw/loss from it -- a malformed value rendered as a loss for
    # both teams before this was constrained.
    ergebnis: Annotated[str, StringConstraints(pattern=r"^[0-9]+:[0-9]+$")] | None
    spieltag_id: CustomObjectId
    spiel_nr: int = Field(gt=0)

    is_canceled: bool
    saison_phase: FLSaisonPhase
    saison_id: str = Field(min_length=4, max_length=4)


FLSpielListAdapter = TypeAdapter(list[FLSpiel])


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
