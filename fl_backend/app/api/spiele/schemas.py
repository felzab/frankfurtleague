from collections.abc import Mapping
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, TypeAdapter, model_validator

from app.api.teams.schemas import FLDisqualifikation, FLGruppenNames
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, SAISON_ID_LENGTH, TEAM_SHORTHAND_LENGTH
from app.shared.schemas.custom import (
    CustomDateString,
    CustomErgebnisString,
    CustomObjectId,
    CustomOptionalDateString,
    CustomOptionalTimeString,
    CustomSpielNr,
    CustomTimeString,
)
from app.shared.schemas.responses import BaseAPIResponse

FLSaisonPhase = Literal["gruppenphase", "achtelfinale", "viertelfinale", "halbfinale", "finale"]
FLSpielStatus = Literal["ausstehend", "vergangen", "heute", "abgesagt", "unbekannt"]

# The one declaration of this competition's rounds; the order is the order they are PLAYED.
PHASE_ORDER: tuple[FLSaisonPhase, ...] = ("gruppenphase", "achtelfinale", "viertelfinale", "halbfinale", "finale")

PHASE_RANK: Mapping[FLSaisonPhase, int] = {phase: rank for rank, phase in enumerate(PHASE_ORDER)}

KNOCKOUT_PHASES: tuple[FLSaisonPhase, ...] = PHASE_ORDER[1:]

# A knockout ladder halves each round down to one final, so the cap is what the phases can hold.
MAX_QUALIFIERS: int = 2 ** len(KNOCKOUT_PHASES)


# Declared BEFORE what references them: below, they resolve only through PEP 649 deferred
# annotations, so touching the core schema before the first validation raises `PydanticUserError`.
class FLSpielTeamField(BaseModel):
    """One side of a fixture as the DOCUMENT stores it and the admin PATCH writes it back.

    Nothing joined belongs here: the payload is written back wholesale, so a field added reaches the
    document on the next edit.
    """

    team_id: CustomObjectId
    name: str = Field(min_length=1)
    tore: Annotated[int, Field(ge=0)] | None
    shorthand: str = Field(min_length=TEAM_SHORTHAND_LENGTH, max_length=TEAM_SHORTHAND_LENGTH)


class FLSpielTeamFieldJoined(FLSpielTeamField):
    """One side as a READ serves it, produced only by `build_spiele_pipeline` and never by a write."""

    # The whole record, not a boolean (`docs/backend/spec.md :: I31`). Null ALSO covers a team
    # holding no row at all.
    disqualifikation: FLDisqualifikation | None


class FLSpielOrtField(BaseModel):
    spielort_id: CustomObjectId
    name: str = Field(min_length=1)
    # Free text rather than a URL, per `fl_backend/app/api/spielorte/schemas.py :: FLSpielort` (COR-2).
    maps_link: str = Field(min_length=1)
    # No default: the payload is written back wholesale, and one would overwrite a real rent with 0
    # (`docs/backend/spec.md :: I6`).
    mietpreis: int = Field(ge=0)


class FLSpielSchiedsrichterField(BaseModel):
    schiedsrichter_id: CustomObjectId
    name: str = Field(min_length=1)
    payment: int = Field(ge=0)


class FLSpielQuelleGruppe(BaseModel):
    """A slot fed by the group phase: the team finishing `platz` in `gruppe`."""

    # `type`, not the German `Art`: a name for the object's shape rather than for anything in the
    # competition, so it stays English while its values stay German.
    type: Literal["gruppe"]
    gruppe: FLGruppenNames
    platz: int = Field(gt=0)


class FLSpielQuelleSpiel(BaseModel):
    """A slot fed by an earlier fixture: the side that came out of match `spiel_nr` as `ausgang`."""

    type: Literal["spiel"]
    # A `spiel_nr`, never an ObjectId: an id would make the draw depend on which documents exist.
    spiel_nr: CustomSpielNr
    # `verlierer` is what a third-place play-off is fed by: the two losing semi-finals.
    ausgang: Literal["sieger", "verlierer"]


# Tagged rather than a bare union, so a reader picks a variant without inspecting which keys exist.
FLSpielQuelle = Annotated[FLSpielQuelleGruppe | FLSpielQuelleSpiel, Field(discriminator="type")]


class FLSpielElfmeterschiessen(BaseModel):
    """The penalty shoot-out that settled a knockout fixture whose goals finished level.

    No `sieger`: a second statement of the same fact could contradict the counts, and I16 puts the
    `$expr` that would bar it out of scope (`docs/backend/spec.md :: I25`).
    """

    team1: int = Field(ge=0)
    team2: int = Field(ge=0)

    @model_validator(mode="after")
    def a_shootout_names_a_winner(self) -> "FLSpielElfmeterschiessen":
        """Refuse a level shoot-out: the one value this field could hold and still name nobody.

        It fails on READ as well as on write, which is what catches a hand edit;
        `docs/backend/spec.md :: I16` leaves this to the model, not the database validator.
        """

        if self.team1 == self.team2:
            raise ValueError("Ein Elfmeterschiessen kann nicht unentschieden enden -- eine Seite hat mehr Treffer als die andere.")

        return self


# Private, so the variants name the faulted fixture once: a base no endpoint names publishes no
# OpenAPI component.
class _BracketFault(BaseModel):
    spiel_id: CustomObjectId
    spiel_nr: CustomSpielNr


class FLBracketFaultGruppe(_BracketFault):
    """One bracket slot whose `gruppe` reference names a placing no standing will hand it.

    `gruppe_too_small` is a typo and the slot is left alone; `tie_unresolved` is a played-out group
    the chain cannot separate, so the slot IS emptied.
    """

    reason: Literal["gruppe_too_small", "tie_unresolved"]
    gruppe: FLGruppenNames
    platz: int = Field(gt=0)


class FLBracketFaultQuelle(_BracketFault):
    """One bracket slot whose `spiel` reference names a match that cannot state an outcome.

    Both leave the slot as it stands, and neither is reachable through the write path. A cycle is
    reported on every fixture it reaches.
    """

    reason: Literal["spiel_missing", "reference_cycle"]
    quelle_spiel_nr: CustomSpielNr


class FLBracketFaultSpiel(_BracketFault):
    """One fixture whose two references resolve to the SAME club.

    It survives the write-path rule, which keys a source by identity, so two DIFFERENT sources
    naming one club pass. The fixture keeps its stored sides.
    """

    reason: Literal["same_team"]


class FLBracketFaultOccupant(_BracketFault):
    """One fixture fielding a team the season disqualified before the day it is played.

    A fixture's DATE against a junction record rather than a bracket fault, so it covers a group
    fixture too. Nothing is emptied: that is a competition decision.
    """

    reason: Literal["disqualified_occupant"]
    side: Literal["team1", "team2"]
    team_id: CustomObjectId
    team_name: str = Field(min_length=1)
    # Both dates, so a reader sees the ordering that makes it a fault without opening a document.
    disqualifiziert_seit: CustomDateString
    spiel_datum: CustomOptionalDateString


# Discriminated, not flattened: a flat model expresses a cycle carrying a `platz`.
FLBracketFault = Annotated[
    FLBracketFaultGruppe | FLBracketFaultQuelle | FLBracketFaultSpiel | FLBracketFaultOccupant,
    Field(discriminator="reason"),
]


class FLSpielBooking(BaseModel):
    """The fields the clash rule reads off ANOTHER fixture.

    Its own model, not `FLSpiel`: that read spans every season, and validating whole fixtures would
    read every field of every match to compare two times.
    """

    spiel_nr: CustomSpielNr
    datum: CustomDateString
    # Validated, not raw: `find_clash_refusal` SPLITS this, so a hand-edited `18:00` would raise on
    # a legitimate edit and answer 500.
    uhrzeit: CustomTimeString


FLSpielBookingListAdapter = TypeAdapter(list[FLSpielBooking])


class FLPatchSpielDataPayload(BaseModel):
    # No `spiel_id`: the path names the match, the body describes the change (RFC 5789).
    is_canceled: bool

    team1: FLSpielTeamField | None
    team2: FLSpielTeamField | None

    # Written wholesale with `$set`: a field the request omits is OVERWRITTEN, so leaving these off
    # would erase a bracket's wiring on the first edit of anything else.
    team1_quelle: FLSpielQuelle | None
    team2_quelle: FLSpielQuelle | None

    # Here for the same `$set` reason; the handler discards it unless the goals are level.
    elfmeterschiessen: FLSpielElfmeterschiessen | None

    datum: CustomOptionalDateString
    uhrzeit: CustomOptionalTimeString
    ort: FLSpielOrtField | None
    schiedsrichter: FLSpielSchiedsrichterField | None

    # Here for the same `$set` reason. An emptied textarea arrives as "" and the validator below
    # turns it to None, which is how a note is removed.
    notiz: str | None

    @model_validator(mode="before")
    @classmethod
    def empty_strings_to_none(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: (None if isinstance(v, str) and v.strip() == "" else v) for k, v in data.items()}
        return data


class FLSpiel(BaseModel):
    """One fixture as the `spiele` collection STORES it.

    `FLSpielJoined` is a second model rather than a default here: a default would make every internal
    read of a raw document quietly assert that nobody is disqualified.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    # `None` while the occupant is unknown: absence is MODELLED, never impersonated by a placeholder.
    team1: FLSpielTeamField | None
    team2: FLSpielTeamField | None

    # Null on a group fixture, and on any slot an admin took over by clearing it.
    team1_quelle: FLSpielQuelle | None
    team2_quelle: FLSpielQuelle | None

    datum: CustomDateString | None
    uhrzeit: CustomTimeString | None

    ort: FLSpielOrtField | None
    schiedsrichter: FLSpielSchiedsrichterField | None

    ergebnis: CustomErgebnisString | None

    # Kept out of `ergebnis`: a third number in that string reads as malformed on every card.
    elfmeterschiessen: FLSpielElfmeterschiessen | None

    spieltag_id: CustomObjectId
    spiel_nr: CustomSpielNr

    is_canceled: bool
    saison_phase: FLSaisonPhase
    saison_id: str = Field(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)

    # DEFAULTED, unlike `elfmeterschiessen`: nothing tells a missing key from a stored null.
    notiz: str | None = None


class FLSpielJoined(FLSpiel):
    """One fixture as an ENDPOINT serves it: the stored document plus each side's joined season state.

    **A subclass, and the direction must not be flipped**: the stored shape is the one a write can
    reach, so it stays free of derived fields.
    """

    team1: FLSpielTeamFieldJoined | None
    team2: FLSpielTeamFieldJoined | None


FLSpielListAdapter = TypeAdapter(list[FLSpiel])
FLSpielJoinedListAdapter = TypeAdapter(list[FLSpielJoined])


class FLSpieleFilterParams(BaseModel):
    saison_id: str | None = None
    saison_phase: Literal["playoffs"] | FLSaisonPhase | None = None
    spiel_status: FLSpielStatus | None = None
    team_id: CustomObjectId | None = None

    limit: int = Field(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX)
    sort_by: Literal["datum", "uhrzeit", "spiel_nr", "saison_phase"] = Field(default="datum")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLSpieleListResponse(BaseAPIResponse):
    spiele: list[FLSpielJoined]


class FLSpieleSingleResponse(BaseAPIResponse):
    spiel: FLSpielJoined


class FLSpieleActionRequiredResponse(BaseAPIResponse):
    """The matches needing attention, and why the bracket ones do.

    A fault joins its match by `spiel_id`, never `spiel_nr`, which repeats across the seasons this
    route spans. `spiele` carries every match a fault names.
    """

    spiele: list[FLSpielJoined]
    bracket_faults: list[FLBracketFault] = Field(default_factory=list)


# Private for `_BracketFault`'s reason: the reports state the destroyed result once.
class _VoidedResult(BaseModel):
    spiel_nr: CustomSpielNr
    voided_ergebnis: CustomErgebnisString | None
    voided_elfmeterschiessen: FLSpielElfmeterschiessen | None


class FLSpielAdvancement(_VoidedResult):
    """One fixture the bracket resolution rewrote, and the result that rewrite destroyed.

    Both voided fields are `None` where a slot merely filled from empty, so "was anything destroyed"
    is a null check.
    """


class FLSpielReleasedSide(_VoidedResult):
    """One side another fixture gave up so a team can play this Spieltag.

    `team_name` rather than an id: the message quoting this has no `spiele` list to join against,
    and the rename fan-out keeps the copy it reads fresh.
    """

    # English, like `type` on a quelle: it names a document field.
    side: Literal["team1", "team2"]
    team_name: str = Field(min_length=1)


class FLPatchSpielDataResponse(BaseAPIResponse):
    """What `patch_spiel_data` returns: every fixture it moved, and what that cost.

    Both lists report writes the caller did not ask for, each carrying the result it destroyed.
    """

    advanced_to: list[FLSpielAdvancement] = Field(default_factory=list)
    released_sides: list[FLSpielReleasedSide] = Field(default_factory=list)
    bracket_faults: list[FLBracketFault] = Field(default_factory=list)
