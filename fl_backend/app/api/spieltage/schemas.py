from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationInfo, field_validator

from app.api.spiele.schemas import FLSpielJoined, FLSpielJoinedAdmin
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, SAISON_ID_LENGTH
from app.shared.schemas.custom import CustomDateString, CustomObjectId, CustomVersion, refuse_reversed_span
from app.shared.schemas.literals import FLSaisonPhase, FLSortOrder
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel


class FLSpieltagRecord(BaseModel):
    """A matchday as `spieltage` stores it, which `FLSpieltag` serves with its derived count."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    # NULLABLE where the payload's pair is not: a drawn matchday carries no span until somebody sets
    # one. No span check here either -- a read refusing a stored reversal would hide the row from the
    # edit that repairs it.
    beginn: CustomDateString | None
    ende: CustomDateString | None

    # STORED, and unique within one phase of one season. `ge=1` because the reader renders this very
    # number -- "1. Spieltag", "Viertelfinale (2)" -- so a zero would be a matchday nobody counts.
    position: int = Field(ge=1)
    saison_phase: FLSaisonPhase
    saison_id: str = Field(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)
    # 0 until a write raises it, as the create stamps it.
    version: int = 0


class FLSpieltag(FLSpieltagRecord, BaseReadModel):
    # DERIVED, on no document. `ge=0`, because a matchday in a phase the bracket does not reach
    # expects none.
    count_spiele: int = Field(ge=0)


FLSpieltagListAdapter = TypeAdapter(list[FLSpieltag])


class FLSpieltageFilterParams(BaseModel):
    saison_id: str | None = None
    saison_phase: Literal["playoffs"] | FLSaisonPhase | None = None

    limit: int = Field(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX)
    # `natural` is the played order -- the phase, then `position`. `count_spiele` is absent because
    # a Mongo sort cannot order by a value no document holds.
    sort_by: Literal["natural", "beginn", "ende"] = Field(default="natural")
    order: FLSortOrder = Field(default="asc")


class FLPatchSpieltagPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The span alone: `saison_id`, `saison_phase` and `position` are settled when the season's
    # schedule is generated, and the fixtures drawn against them are not rewritten here.

    # Both REQUIRED, unlike the read model's pair: this payload exists to set them, so a null here
    # would be a request to undate a matchday, which nothing asks for and nothing else expresses.
    beginn: CustomDateString
    ende: CustomDateString
    # The `version` the editor was served, required: a save checked against nothing overwrites a rival's unseen.
    version: CustomVersion

    # A field validator at the end it judges, reading the start off `info.data`: a model validator's refusal sits at the
    # model, a path no box answers. `beginn` is declared first, so it is validated first; where it failed it is absent from
    # `info.data`, and its own refusal is the one answered.
    @field_validator("ende")
    @classmethod
    def the_matchday_ends_after_it_begins(cls, ende: str, info: ValidationInfo) -> str:
        """A span running backwards is a typo in one of the two dates, and nothing downstream can tell which one."""

        if "beginn" in info.data:
            refuse_reversed_span(start=info.data["beginn"], end=ende, kind="spieltag_ends_before_start")

        return ende


class FLSpieltageListResponse(BaseAPIResponse):
    spieltage: list[FLSpieltag]


class FLSpielplanSpieltag(FLSpieltag):
    """One matchday as the Spielplan shows it, holding its matches in the order the draw numbered them."""

    spiele: list[FLSpielJoined]


FLSpielplanSpieltagListAdapter = TypeAdapter(list[FLSpielplanSpieltag])


class FLSpielplanSpieltagAdmin(FLSpielplanSpieltag):
    """One matchday as the administrator's Spiele list shows it, its matches in the admin shape."""

    spiele: list[FLSpielJoinedAdmin]


FLSpielplanSpieltagAdminListAdapter = TypeAdapter(list[FLSpielplanSpieltagAdmin])


class FLSpielplanResponse(BaseAPIResponse):
    """A season's matchdays in the order they are played, and the one the Spielplan opens on.

    `current_spieltag_id` is the first matchday holding a match still to be played, else the last; in a finished
    season, the last. Null for a season with no matchday.
    """

    spieltage: list[FLSpielplanSpieltag]
    current_spieltag_id: CustomObjectId | None


class FLSpieleSpielplanAdminResponse(BaseAPIResponse):
    """A season's matchdays and knockout rounds in playing order, matches in the admin shape, and the one to open on.

    `current_spieltag_id` is the Spielplan's own: the first matchday holding a match still to be played, else the last;
    in a finished season, the last. Null for a season with no matchday.
    """

    spieltage: list[FLSpielplanSpieltagAdmin]
    current_spieltag_id: CustomObjectId | None


class FLKoRundeResponse(BaseAPIResponse):
    """A season's knockout matchdays in the order they are played, each holding its matches.

    A side whose club is not yet known is null, and its `quelle` says where it comes from.
    """

    spieltage: list[FLSpielplanSpieltag]


class FLSpieltageSingleResponse(BaseAPIResponse):
    spieltag: FLSpieltag


class FLSpieltagWriteResponse(BaseAPIResponse):
    spieltag_id: CustomObjectId
