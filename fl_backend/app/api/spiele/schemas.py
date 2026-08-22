from collections.abc import Mapping
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, TypeAdapter, model_validator

from app.api.teams.schemas import FLAustritt, FLAustrittType, FLGruppenNames
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

# What happened to a fixture beyond being played. Nullable rather than total: `null` is "nothing to
# say", so no read site spells an ordinary fixture out. Distinct from `FLSpielStatus`, which is
# derived and about time rather than event.
FLSonderereignis = Literal["ausgefallen", "nichtantreten_team1", "nichtantreten_team2", "abgebrochen", "annulliert"]

# Each tuple below answers ONE consumer's question. They are deliberately NOT one predicate: a single
# boolean would make independent consumers agree by accident, and a field telling five events apart
# has a different right answer per consumer.

# Two sides of ONE partition -- did the fixture use up its slot, or does it record a non-event?
# Held complementary by `tests/api/test_spiele.py :: test_the_slot_partition_is_exhaustive`.
SONDEREREIGNIS_KEEPING_ITS_SLOT: tuple[FLSonderereignis | None, ...] = (None, "abgebrochen")
SONDEREREIGNIS_RECORDING_AN_ABSENCE: tuple[FLSonderereignis, ...] = (
    "ausgefallen",
    "nichtantreten_team1",
    "nichtantreten_team2",
    "annulliert",
)

# `REQ-STATE-002`'s subject, and by construction also the fixtures that can never award a point: a
# state barred from carrying a result reaches no figure the table is scored on.
SONDEREREIGNIS_WITHOUT_A_RESULT: tuple[FLSonderereignis, ...] = ("ausgefallen", "annulliert")

# A no-show and an abandonment both leave a record a group swap would rewrite; a fixture called off
# or struck out leaves none.
SONDEREREIGNIS_PRODUCING_A_RECORD: tuple[FLSonderereignis, ...] = (
    "abgebrochen",
    "nichtantreten_team1",
    "nichtantreten_team2",
)

# `anzahl_abgesagte_spiele` counts fixtures that did not take place, so an annulment is in it and
# only an abandonment -- played until it stopped -- is out. Equal to the absence half above by
# accident, never by derivation: the questions differ.
SONDEREREIGNIS_COUNTED_AS_ABSAGE: tuple[FLSonderereignis, ...] = (
    "ausgefallen",
    "nichtantreten_team1",
    "nichtantreten_team2",
    "annulliert",
)

# The side that failed to appear, so the award goes the other way.
SONDEREREIGNIS_NO_SHOW: Mapping[str, Literal["team1", "team2"]] = {
    "nichtantreten_team1": "team1",
    "nichtantreten_team2": "team2",
}

# The one declaration of this competition's rounds; the order is the order they are PLAYED.
PHASE_ORDER: tuple[FLSaisonPhase, ...] = ("gruppenphase", "achtelfinale", "viertelfinale", "halbfinale", "finale")

PHASE_RANK: Mapping[FLSaisonPhase, int] = {phase: rank for rank, phase in enumerate(PHASE_ORDER)}

KNOCKOUT_PHASES: tuple[FLSaisonPhase, ...] = PHASE_ORDER[1:]

# A knockout ladder halves each round down to one final, so the cap is what the phases can hold.
MAX_QUALIFIERS: int = 2 ** len(KNOCKOUT_PHASES)


# Declared BEFORE what references them: below, they resolve only through PEP 649 deferred
# annotations, so touching the core schema before the first validation raises `PydanticUserError`.
class FLSpielTeamFieldPayload(BaseModel):
    """One side of a fixture as the admin PATCH SUBMITS it.

    No name and no shorthand: the season's `saison_teams` row is where a club's name lives, so a copy
    a client typed could only disagree with it. The server composes them.
    """

    team_id: CustomObjectId
    tore: Annotated[int, Field(ge=0)] | None


class FLSpielTeamField(FLSpielTeamFieldPayload):
    """One side of a fixture as the DOCUMENT stores it.

    Nothing joined belongs here: the payload is written back wholesale, so a field added reaches the
    document on the next edit.
    """

    name: str = Field(min_length=1)
    shorthand: str = Field(min_length=TEAM_SHORTHAND_LENGTH, max_length=TEAM_SHORTHAND_LENGTH)


class FLSpielTeamFieldJoined(FLSpielTeamField):
    """One side as a BASE-TIER read serves it, produced only by `build_spiele_pipeline`.

    Narrower than the junction row: every public surface listing a fixture carries this side, and
    only a club's own page renders the free text a withdrawal names.
    """

    # The TYPE alone, as `fl_backend/app/api/teams/schemas.py :: FLGruppenTeam` narrows a league
    # table row: a card says WHICH way a club left, its own page publishes the reason and the date.
    # Null ALSO covers a team holding no row at all.
    austritt_type: FLAustrittType | None


class FLSpielTeamFieldJoinedInternal(FLSpielTeamFieldJoined):
    """The same side with the record behind the type, for `find_departed_occupants` alone.

    On NO endpoint, so no response carries a reason: the walk orders a fault on the DAY a club
    left, which the type cannot answer.
    """

    # Beside the inherited type, and never a second answer to it: one `$let` in `_joined_side`
    # produces both out of one junction row.
    austritt: FLAustritt | None


# Private, so the payload and the served shape state the booked id once and publish no component of
# their own. Each extends THIS rather than one extending the other: composing a name onto a payload
# is what `docs/backend/spec.md :: I3` forbids.
class _SpielOrtBooking(BaseModel):
    spielort_id: CustomObjectId


class FLSpielOrtFieldPayload(_SpielOrtBooking):
    """The venue as the admin PATCH SUBMITS it: which ground, and what this fixture pays for it."""

    # No default, and it stays on the payload where the name does not: this is THIS fixture's rent
    # rather than a copy of the venue's current default (`docs/backend/spec.md :: I6`).
    mietpreis: int = Field(ge=0)


class FLSpielOrtFieldPublic(_SpielOrtBooking):
    """The venue as a BASE-TIER read serves it: which ground, and where to find it.

    No `mietpreis`: what one fixture agreed to pay is admin-tier (`READ-MONEY-001`).
    """

    name: str = Field(min_length=1)
    # Free text rather than a URL, per `fl_backend/app/api/spielorte/schemas.py :: FLSpielort` (COR-2).
    maps_link: str = Field(min_length=1)


class FLSpielOrtField(FLSpielOrtFieldPublic):
    """The venue as the DOCUMENT holds it, and as the admin editor reads it back to round-trip the rent."""

    mietpreis: int = Field(ge=0)


# The venue booking's twin, and private for its reason.
class _SpielSchiedsrichterBooking(BaseModel):
    schiedsrichter_id: CustomObjectId


class FLSpielSchiedsrichterFieldPayload(_SpielSchiedsrichterBooking):
    """The referee as the admin PATCH SUBMITS it; `payment` stays for `mietpreis`' reason."""

    payment: int = Field(ge=0)


class FLSpielSchiedsrichterFieldPublic(_SpielSchiedsrichterBooking):
    """The referee as a BASE-TIER read serves it. `payment` is withheld for `mietpreis`' reason."""

    name: str = Field(min_length=1)


class FLSpielSchiedsrichterField(FLSpielSchiedsrichterFieldPublic):
    """The referee as the DOCUMENT holds it, and as the admin editor reads it back."""

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

    No `sieger`: a stored one could contradict the counts, and the `$expr` barring it is outside the
    database validators' ratified scope (`docs/backend/spec.md :: I25`).
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
    """One fixture fielding a team that left the season before the day it is played.

    Derived beside the bracket walk rather than inside it, so no phase is out of its reach; nothing
    is emptied (`fl_backend/app/core/domain.py :: UNENFORCED`).
    """

    reason: Literal["departed_occupant"]
    side: Literal["team1", "team2"]
    team_id: CustomObjectId
    team_name: str = Field(min_length=1)
    # Carried so the surface can name the route out: a withdrawal reported as a disqualification is
    # the untruth the neutral record exists to prevent.
    austritt_type: FLAustrittType
    # Both dates, so a reader sees the ordering that makes it a fault without opening a document.
    ausgeschieden_seit: CustomDateString
    spiel_datum: CustomOptionalDateString


class FLBracketFaultSpieltag(_BracketFault):
    """A club standing more than once on one Spieltag.

    One entry per APPEARANCE, the granularity `fl_backend/app/core/constraints.py :: report_relations`
    counts in -- never deduplicated, because which to correct is a competition decision.
    """

    reason: Literal["fielded_twice"]
    # Carried because it is what GROUPS the entries: one clash is every appearance sharing this id
    # and a club, and the entries reach a reader as one flat list.
    spieltag_id: CustomObjectId
    side: Literal["team1", "team2"]
    team_id: CustomObjectId
    team_name: str = Field(min_length=1)


# Discriminated, not flattened: a flat model expresses a cycle carrying a `platz`.
FLBracketFault = Annotated[
    FLBracketFaultGruppe | FLBracketFaultQuelle | FLBracketFaultSpiel | FLBracketFaultOccupant | FLBracketFaultSpieltag,
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

    # `empty_strings_to_none` turns an unpicked select's "" into null, the ordinary fixture, so
    # clearing the control and choosing nothing are one answer rather than two.
    sonderereignis: FLSonderereignis | None

    team1: FLSpielTeamFieldPayload | None
    team2: FLSpielTeamFieldPayload | None

    # Written wholesale with `$set`: a field the request omits is OVERWRITTEN, so leaving these off
    # would erase a bracket's wiring on the first edit of anything else.
    team1_quelle: FLSpielQuelle | None
    team2_quelle: FLSpielQuelle | None

    # Here for the same `$set` reason; the handler discards it unless the goals are level.
    elfmeterschiessen: FLSpielElfmeterschiessen | None

    datum: CustomOptionalDateString
    uhrzeit: CustomOptionalTimeString
    ort: FLSpielOrtFieldPayload | None
    schiedsrichter: FLSpielSchiedsrichterFieldPayload | None

    # Here for the same `$set` reason. An emptied textarea arrives as "" and the validator below
    # turns it to None, which is how a note is removed.
    notiz: str | None

    @model_validator(mode="before")
    @classmethod
    def empty_strings_to_none(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: (None if isinstance(v, str) and v.strip() == "" else v) for k, v in data.items()}
        return data


# The stored and the served shapes both extend THIS rather than one extending the other: they differ
# in OPPOSITE directions, the stored one adding the two money fields and the served one each side's
# joined season state.
class FLSpielCommon(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    # `None` while the occupant is unknown: absence is MODELLED, never impersonated by a placeholder.
    team1: FLSpielTeamField | None
    team2: FLSpielTeamField | None

    # Null on a group fixture, and on any slot an admin took over by clearing it.
    team1_quelle: FLSpielQuelle | None
    team2_quelle: FLSpielQuelle | None

    datum: CustomDateString | None
    uhrzeit: CustomTimeString | None

    ort: FLSpielOrtFieldPublic | None
    schiedsrichter: FLSpielSchiedsrichterFieldPublic | None

    ergebnis: CustomErgebnisString | None

    # Kept out of `ergebnis`: a third number in that string reads as malformed on every card.
    elfmeterschiessen: FLSpielElfmeterschiessen | None

    spieltag_id: CustomObjectId
    spiel_nr: CustomSpielNr

    sonderereignis: FLSonderereignis | None
    saison_phase: FLSaisonPhase
    saison_id: str = Field(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)

    # DEFAULTED, unlike `elfmeterschiessen`: nothing tells a missing key from a stored null.
    notiz: str | None = None


class FLSpiel(FLSpielCommon):
    """One fixture as the `spiele` collection STORES it, and the shape every write composes.

    The money is re-declared because `$set` writes this model's dump, and a shape without it would
    erase `mietpreis` and `payment` on the next edit of anything else.
    """

    ort: FLSpielOrtField | None
    schiedsrichter: FLSpielSchiedsrichterField | None


class FLSpielJoined(FLSpielCommon):
    """One fixture as a BASE-TIER endpoint serves it: stored fields plus each side's joined season state.

    A model rather than a default on the stored side, which would make every internal read of a raw
    document quietly assert that nobody is disqualified.
    """

    team1: FLSpielTeamFieldJoined | None
    team2: FLSpielTeamFieldJoined | None


class FLSpielJoinedAdmin(FLSpielJoined):
    """The same fixture, carrying the two figures the base tier withholds (`READ-MONEY-001`).

    A second model rather than a projection per caller: a response whose shape follows the
    credential is one no Zod mirror can express.
    """

    ort: FLSpielOrtField | None
    schiedsrichter: FLSpielSchiedsrichterField | None


class FLSpielJoinedInternal(FLSpielJoined):
    """The base-tier fixture with each side's record behind its type; on no endpoint, for `FLSpielTeamFieldJoinedInternal`'s reason."""

    team1: FLSpielTeamFieldJoinedInternal | None
    team2: FLSpielTeamFieldJoinedInternal | None


FLSpielListAdapter = TypeAdapter(list[FLSpiel])
FLSpielJoinedListAdapter = TypeAdapter(list[FLSpielJoined])
FLSpielJoinedInternalListAdapter = TypeAdapter(list[FLSpielJoinedInternal])


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


class FLSpieleAdminSingleResponse(BaseAPIResponse):
    """What `GET /spiele/{spiel_id}/admin` answers: the fixture the editor round-trips, money included."""

    spiel: FLSpielJoinedAdmin


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
    # Only ever a no-show: `ausgefallen`, `annulliert` and `abgebrochen` name no side, so a replaced
    # occupant leaves each of them true and none of them is cleared.
    voided_sonderereignis: FLSonderereignis | None


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
