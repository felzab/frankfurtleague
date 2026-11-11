from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationInfo, field_validator

from app.api.spiele.schemas import FLSpielJoined, FLSpielJoinedAdmin
from app.shared.schemas.bounds import SAISON_ID_LENGTH
from app.shared.schemas.custom import CustomDateString, CustomObjectId, CustomVersion, refuse_reversed_span
from app.shared.schemas.literals import FLSaisonPhase, FLSaisonStatus
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel


class FLSpieltagRecord(BaseModel):
    """A matchday as `spieltage` stores it, which `FLSpieltag` serves with its derived count."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    # Nullable where the payload's pair is not: a drawn matchday carries no span until somebody sets
    # one. No span check here either -- a read refusing a stored reversal would hide the row from the
    # edit that repairs it.
    start: CustomDateString | None
    end: CustomDateString | None

    # Stored, and unique within one phase of one season. `ge=1` because the reader renders this very
    # number -- "1. Spieltag", "Viertelfinale (2)" -- so a zero would be a matchday nobody counts.
    position: int = Field(ge=1)
    saison_phase: FLSaisonPhase
    saison_id: str = Field(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)
    version: int = 0


class FLSpieltag(FLSpieltagRecord, BaseReadModel):
    # Derived, on no document. `ge=0`, because a matchday in a phase the bracket does not reach
    # expects none.
    count_spiele: int = Field(ge=0)


class FLSpieltagAdmin(FLSpieltag):
    """A matchday as its editor reads it, with how many matchdays its phase holds, by which a page names a round's legs."""

    # Derived, on no document: the phase's matchdays as the season stores them, this one included. Named as the public
    # schemas name the same count.
    count_spieltage_in_phase: int = Field(ge=1)


class FLPatchSpieltagPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The span alone: `saison_id`, `saison_phase` and `position` are settled when the season's
    # schedule is generated, and the fixtures drawn against them are not rewritten here.

    # Both required, unlike the read model's pair: this payload exists to set them, so a null here
    # would be a request to undate a matchday, which nothing asks for and nothing else expresses.
    start: CustomDateString
    end: CustomDateString
    version: CustomVersion

    # A field validator at the end it judges, reading the start off `info.data`: a model validator's refusal sits at the
    # model, a path no box answers. `start` is declared first, so it is validated first; where it failed it is absent from
    # `info.data`, and its own refusal is the one answered.
    @field_validator("end")
    @classmethod
    def the_matchday_ends_after_it_begins(cls, end: str, info: ValidationInfo) -> str:
        """A span running backwards is a typo in one of the two dates, and nothing downstream can tell which one."""

        if "start" in info.data:
            refuse_reversed_span(start=info.data["start"], end=end, kind="spieltag_ends_before_start")

        return end


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


# The status on the response rather than on the matchday: a matchday carries no season-scoped state.
class FLSpieltagAdminResponse(BaseAPIResponse):
    """One matchday and its season's `status`, which says whether the matchday can still be re-dated."""

    spieltag: FLSpieltagAdmin
    saison_status: FLSaisonStatus


class FLSpieltagWriteResponse(BaseAPIResponse):
    spieltag_id: CustomObjectId
    # The matchday's version after the save, which the editor's next save sends.
    version: int
