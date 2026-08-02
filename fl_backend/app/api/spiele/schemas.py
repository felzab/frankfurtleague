"""
SPIELE · models

The Spiel read model, the admin patch payload, and the three embedded field models they share.

These are HAND-MIRRORED by `fl_frontend/src/features/spiele/schemas.ts` in Zod. There is no generation
step, so a constraint changed here must be changed there in the same commit. This is the main drift risk
in the codebase and the first thing to check when behaviour looks impossible.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • The three embedded field models are declared BEFORE the payload and FLSpiel that reference them --
    see the note below, this has bitten before.
  • Money fields (`mietpreis`, `payment`) carry NO default. The admin patch writes the payload back
    wholesale with `$set`, so a default lets a request omitting the field silently overwrite a real
    value with 0.
  • `ergebnis` is pattern-constrained rather than free text, and uses `[0-9]` rather than `\\d`: the
    backend's regex engine treats `\\d` as Unicode-aware, and `Number("٢")` in JavaScript is NaN, so the
    two ends would disagree about what a digit is.
  • `saison_id` is exactly 4 characters, matching FLSaison.id.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/backend/spec.md -- section 4, the field-constraint table
  docs/glossary.md -- Ergebnis, Tore, saison_phase
"""

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
    # No `spiel_id`: the match being changed is named by the path (RFC 5789 -- the Request-URI
    # identifies the resource, the body describes the change).
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

    limit: int = Field(default=1024, ge=1, le=1024)
    sort_by: Literal["datum", "uhrzeit", "spiel_nr", "saison_phase"] = Field(default="datum")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLSpieleListResponse(BaseAPIResponse):
    spiele: list[FLSpiel]


class FLSpieleSingleResponse(BaseAPIResponse):
    spiel: FLSpiel


class FLPatchSpielDataResponse(BaseAPIResponse):
    """The `{"acknowledged": 1}` body patch_spiel_data returns, declared rather than implied."""
