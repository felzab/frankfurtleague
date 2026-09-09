from collections.abc import Mapping
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator, model_validator

from app.api.teams.schemas import FLAustritt, FLAustrittType, FLGruppenNames
from app.shared.schemas.bounds import (
    LIST_LIMIT_DEFAULT,
    LIST_LIMIT_MAX,
    SAISON_ID_LENGTH,
    SPIEL_NOTIZ_MAX_LENGTH,
    TEAM_SHORTHAND_LENGTH,
)
from app.shared.schemas.custom import (
    CustomDateString,
    CustomErgebnisString,
    CustomNonEmptyString,
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


def records_an_absence(*, side: str, sonderereignis: FLSonderereignis | None, saison_phase: FLSaisonPhase) -> bool:
    """Whether this state accounts for the named side's absence -- `REQ-ELIGIBILITY-001`'s carve-out.

    ONE question with three askers -- the refusal, its report and `REQ-SWAP-006` -- so the state clearing the 409 clears the other two.
    """

    # Directional, because a no-show COMPOSES a result the table scores: exempting the side that
    # turned up would credit a departed club the forfeit and put it back in the standings.
    stayed_away = SONDEREREIGNIS_NO_SHOW.get(sonderereignis or "") == side

    # A GROUP fixture that awards nothing carries a departed club on either side legitimately. A
    # knockout slot still has to say who advances, and an ABANDONED fixture is one that happened
    # -- a departed club standing on it is the fault this rule catches.
    awards_nothing = sonderereignis in SONDEREREIGNIS_WITHOUT_A_RESULT

    # Only `awards_nothing` takes the phase gate: a cancelled knockout advances nobody, where a
    # no-show names the absent side and composes a result advancing the other -- which rests on
    # `REQ-RULES-010` barring a level forfeit here.
    return stayed_away or (awards_nothing and saison_phase == "gruppenphase")


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

    No name and no shorthand: the server composes them from the season's `saison_teams` row
    (`docs/backend/spec.md :: I3`). A submitted copy is IGNORED rather than refused, as
    `docs/backend/spec.md :: I114` allows.
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

    model_config = ConfigDict(extra="forbid")

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


def public_referee_name(name: str | None) -> str | None:
    """`READ-REFEREE-001`, over the one free-text field a referee's name is.

    Partitioned on the FIRST space rather than the last: `Ada van der Berg` would otherwise serve as
    `Ada van der B.`, publishing the particle.
    """

    # An erased referee stays erased: an initial composed for a name nobody holds would read as a name.
    if name is None:
        return None

    vorname, separator, nachname = name.partition(" ")

    if not separator:
        return name

    # The reduction IS the privacy measure, so two referees whose names reduce to one string are
    # indistinguishable on the public page deliberately: a disambiguator would undo it.

    # Sliced on a `str`, which is by code point as `$substrCP` is: a byte slice halves `Öztürk`.
    return f"{vorname} {nachname[:1]}."


# The venue booking's twin, and private for its reason.
class _SpielSchiedsrichterBooking(BaseModel):
    schiedsrichter_id: CustomObjectId


# The name sits on a shared private base rather than on the served shape, so the stored shape below
# can carry it without inheriting the reduction the served one applies.
class _SpielSchiedsrichterBooked(_SpielSchiedsrichterBooking):
    # Nullable, unlike the venue's: a referee is a person, and their erasure nulls this copy on every
    # fixture they officiated. The word a reader is shown instead is the frontend's
    # (`fl_frontend/src/features/schiedsrichter/constants.ts :: SCHIEDSRICHTER_ANONYM_LABEL`).
    name: CustomNonEmptyString | None


class FLSpielSchiedsrichterFieldPayload(_SpielSchiedsrichterBooking):
    """The referee as the admin PATCH SUBMITS it; `payment` stays for `mietpreis`' reason."""

    model_config = ConfigDict(extra="forbid")

    payment: int = Field(ge=0)


class FLSpielSchiedsrichterFieldPublic(_SpielSchiedsrichterBooked):
    """The referee as a BASE-TIER read serves it: a forename and a surname initial (`READ-REFEREE-001`).

    `payment` is withheld for `mietpreis`' reason.
    """

    @field_validator("name", mode="after")
    @classmethod
    def _reduce_the_surname(cls, name: str | None) -> str | None:
        # On the model and not in the pipeline: one aggregation feeds both tiers, so a stage
        # reducing there would reduce the admin editor's read with it.
        return public_referee_name(name)


class FLSpielSchiedsrichterField(_SpielSchiedsrichterBooked):
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

        It fails on READ as well as on write, which is what catches a hand edit.
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

    `tie_unresolved` alone empties the slot: every other reason names wiring the season cannot hold,
    and a slot is never emptied over one.
    """

    reason: Literal["gruppe_too_small", "gruppe_not_run", "seed_past_the_opening_round", "tie_unresolved"]
    gruppe: FLGruppenNames
    platz: int = Field(gt=0)


class FLBracketFaultQuelle(_BracketFault):
    """One bracket slot whose `spiel` reference names a match that cannot feed it.

    Each leaves the slot as it stands, and a cycle is reported on every fixture it reaches.
    """

    reason: Literal["spiel_missing", "reference_cycle", "gruppenphase_feeder", "feeder_not_played_first"]
    quelle_spiel_nr: CustomSpielNr


class FLBracketFaultSlot(_BracketFault):
    """One slot carrying a reference it must not carry, whatever that reference names.

    The reference travels whole rather than decomposed: it groups the entries of a shared source, and
    a toast arrives with no fixture to read it off.
    """

    reason: Literal["gruppenphase_fixture_wired", "source_feeds_another_fixture"]
    side: Literal["team1", "team2"]
    quelle: FLSpielQuelle


class FLBracketFaultSpiel(_BracketFault):
    """One fixture whose two references resolve to the SAME club.

    It survives the write-path rule, which keys a source by identity, so two DIFFERENT sources
    naming one club pass. The fixture keeps its stored sides.
    """

    reason: Literal["same_team"]


class FLBracketFaultOccupant(_BracketFault):
    """One fixture fielding a team that left the season (`docs/backend/spec.md :: I28`).

    The date rule and the carve-out are `REQ-ELIGIBILITY-001`'s. Nothing is emptied
    (`fl_backend/app/core/domain.py :: UNENFORCED`).
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


# Discriminated, not flattened: a flat model expresses a cycle carrying a `platz`. Every reason the
# write path refuses too reaches a stored document by hand edit alone.
FLBracketFault = Annotated[
    FLBracketFaultGruppe | FLBracketFaultQuelle | FLBracketFaultSpiel | FLBracketFaultSlot | FLBracketFaultOccupant | FLBracketFaultSpieltag,
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
    model_config = ConfigDict(extra="forbid")

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

    # Here for the same `$set` reason; "" becomes None below, which is how a note is removed.
    # The bound is the log row's ceiling (`app/shared/schemas/bounds.py`), no read model's business.
    notiz: str | None = Field(max_length=SPIEL_NOTIZ_MAX_LENGTH)

    @model_validator(mode="before")
    @classmethod
    def empty_strings_to_none(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: (None if isinstance(v, str) and v.strip() == "" else v) for k, v in data.items()}
        return data


# Every wholesale-payload field outside the Paarung, named once: the report and the restore read this
# list, so a field one end can move is a field the other reads.
FLSpielRestorableField = Literal["team1_quelle", "team2_quelle", "datum", "uhrzeit", "ort", "schiedsrichter", "notiz"]


class FLSpielPriorOrt(_SpielOrtBooking):
    """The venue a restore names: which ground, and what that fixture agreed to pay for it.

    Lax where `FLSpielOrtFieldPayload` forbids, because a RESPONSE reaches this one
    (`docs/backend/spec.md :: I114`), which is also why the two cannot be one class.
    """

    # Declared again rather than shared with the payload's, as `docs/backend/spec.md :: I6` has every
    # model holding this figure declare it.
    mietpreis: int = Field(ge=0)


class FLSpielPriorSchiedsrichter(_SpielSchiedsrichterBooking):
    """The referee a restore names, and the fee that fixture agreed; lax and re-declared for `FLSpielPriorOrt`'s reasons."""

    payment: int = Field(ge=0)


def other_fields_of(spiel: "FLSpiel") -> dict[FLSpielRestorableField, Any]:
    """One fixture's fields outside the Paarung, as a restore names them.

    ONE spelling for the restore's completion and for the report's comparison: read apart, the two
    could disagree about whether a write replaced a field.
    """

    return {
        "team1_quelle": spiel.team1_quelle,
        "team2_quelle": spiel.team2_quelle,
        "datum": spiel.datum,
        "uhrzeit": spiel.uhrzeit,
        # Composed names left behind, so a venue renamed since is not read as a field this write
        # replaced. The rent stays: it is what THIS fixture pays (`docs/backend/spec.md :: I6`).
        "ort": None if spiel.ort is None else FLSpielPriorOrt(spielort_id=spiel.ort.spielort_id, mietpreis=spiel.ort.mietpreis),
        "schiedsrichter": (
            None
            if spiel.schiedsrichter is None
            else FLSpielPriorSchiedsrichter(schiedsrichter_id=spiel.schiedsrichter.schiedsrichter_id, payment=spiel.schiedsrichter.payment)
        ),
        "notiz": spiel.notiz,
    }


class FLSpielPriorOtherFields(BaseModel):
    """One fixture's fields as they stood outside its Paarung, and which of them a write REPLACED.

    `replaced` rather than omitted keys: a response cannot omit one, and each field's `null` is a
    value a restore may write.
    """

    # Never empty: a write that replaced nothing here carries no report at all, so the null and the
    # empty list would be two spellings of one answer.
    replaced: list[FLSpielRestorableField] = Field(min_length=1)

    team1_quelle: FLSpielQuelle | None
    team2_quelle: FLSpielQuelle | None
    datum: CustomOptionalDateString
    uhrzeit: CustomOptionalTimeString
    ort: FLSpielPriorOrt | None
    schiedsrichter: FLSpielPriorSchiedsrichter | None
    notiz: str | None = Field(max_length=SPIEL_NOTIZ_MAX_LENGTH)


# Private, so the request and the report below state these four fields once and neither publishes a
# component of its own for them.
class _SpielPaarung(BaseModel):
    """The whole of what a bracket resolution can rewrite on a fixture it was not asked about."""

    team1: FLSpielTeamFieldPayload | None
    team2: FLSpielTeamFieldPayload | None

    # Named rather than derived from the goals: a rewrite clears the record along with the scoreline
    # that needed it, so putting a level score back does not bring the record back with it.
    elfmeterschiessen: FLSpielElfmeterschiessen | None

    # The STORED event rather than the cleared one: only a no-show is ever cleared, so a fixture that
    # was abandoned keeps its event through the rewrite and has to be re-sent unchanged.
    sonderereignis: FLSonderereignis | None


# A second private base rather than four more fields on the one above, which states what a bracket
# resolution reaches and is read for exactly that.
class _SpielRestore(_SpielPaarung):
    """A Paarung beside the fields outside it one write replaced: the whole of what an undo of that write puts back."""

    other_fields: FLSpielPriorOtherFields | None


class FLPatchSpielPaarungPayload(_SpielRestore):
    """One fixture of a replay: its Paarung and the fields this entry names beyond it, leaving every other field as stored.

    Its own route rather than a mode on the wholesale patch, where naming a field is what OVERWRITES it.
    """

    model_config = ConfigDict(extra="forbid")

    # On the BODY where every other patch takes its target from the path (RFC 5789): the route
    # addresses the list, so nothing but the entry can say which fixture it restores.
    spiel_id: CustomObjectId

    def completed_with(self, stored: "FLSpiel") -> FLPatchSpielDataPayload:
        """This request as the wholesale payload, the document answering what it does not restore.

        Completed rather than written field by field, so the refusals, the composed `ergebnis` and
        the resolution run on the one shape they were written for.
        """

        beyond = other_fields_of(stored)
        if self.other_fields is not None:
            # `replaced` alone: a field the undone write left standing is read off the document, so a
            # value moved between that write and this restore is not reverted.
            beyond |= {field: getattr(self.other_fields, field) for field in self.other_fields.replaced}

        ort, schiedsrichter = beyond.pop("ort"), beyond.pop("schiedsrichter")

        return FLPatchSpielDataPayload(
            sonderereignis=self.sonderereignis,
            team1=self.team1,
            team2=self.team2,
            elfmeterschiessen=self.elfmeterschiessen,
            # Re-shaped rather than passed on: the wholesale payload's booking blocks forbid a key
            # they do not declare, which is what keeps a composed name off a save (`docs/backend/spec.md :: I49`).
            ort=None if ort is None else FLSpielOrtFieldPayload(spielort_id=ort.spielort_id, mietpreis=ort.mietpreis),
            schiedsrichter=(
                None
                if schiedsrichter is None
                else FLSpielSchiedsrichterFieldPayload(schiedsrichter_id=schiedsrichter.schiedsrichter_id, payment=schiedsrichter.payment)
            ),
            **beyond,
        )


class FLPatchSpielePaarungenPayload(BaseModel):
    """Restore every fixture one save moved, in the order the report named them."""

    model_config = ConfigDict(extra="forbid")

    # The floor: a save's report leads with the fixture it named, so an empty list is a body no save
    # produced. The ceiling is the season read's, no legitimate replay naming more fixtures than one
    # season can hold.
    paarungen: list[FLPatchSpielPaarungPayload] = Field(min_length=1, max_length=LIST_LIMIT_DEFAULT)

    @model_validator(mode="after")
    def one_entry_per_fixture(self) -> "FLPatchSpielePaarungenPayload":
        """A fixture named twice is restored twice, and its first restore's collateral then reads as the replay's own doing.

        `fl_backend/app/api/spiele/crud.py :: report_prior_paarungen` reports each fixture once.
        """

        named = [entry.spiel_id for entry in self.paarungen]
        if len(set(named)) != len(named):
            raise ValueError("Eine Rücknahme nennt jedes Spiel genau einmal.")

        return self


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
    # Public BY DECISION, and a name typed into it outlives an erasure (`READ-FREETEXT-001`).
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


class FLSpielJoinedInternal(FLSpielJoinedAdmin):
    """The fixture with each side's record behind its type; on no endpoint, for `FLSpielTeamFieldJoinedInternal`'s reason.

    On the ADMIN shape because its one reader hands the faulted matches to
    `GET /spiele/action_required`, whose cards print the referee's name.
    """

    team1: FLSpielTeamFieldJoinedInternal | None
    team2: FLSpielTeamFieldJoinedInternal | None


FLSpielListAdapter = TypeAdapter(list[FLSpiel])
FLSpielJoinedListAdapter = TypeAdapter(list[FLSpielJoined])
FLSpielJoinedAdminListAdapter = TypeAdapter(list[FLSpielJoinedAdmin])
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


class FLSpieleAdminListResponse(BaseAPIResponse):
    """The admin surfaces' fixture list.

    The base tier reduces a referee's surname to an initial (`READ-REFEREE-001`) and the admin
    fixture search matches on that name, so a surname typed there would find nothing.
    """

    spiele: list[FLSpielJoinedAdmin]


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

    # The ADMIN shape, not the base tier's: a card on this page opens the modal that prints the
    # referee's name, which the base tier serves reduced (`READ-REFEREE-001`).
    spiele: list[FLSpielJoinedAdmin]
    bracket_faults: list[FLBracketFault] = Field(default_factory=list)


# Private for `_BracketFault`'s reason: the reports state the destroyed result once.
class _VoidedResult(BaseModel):
    # Beside the number, as a bracket fault carries it: a message names a fixture by `spiel_nr`, and
    # a caller matching that number against a list it read BEFORE the save can match the wrong one.
    spiel_id: CustomObjectId
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


class FLSpielPriorPaarung(_SpielRestore):
    """One fixture this write changed, as it stood before it -- the body `PATCH /spiele/paarungen` takes back.

    One entry per FIXTURE and never per rewrite, so a fixture both reports name is restored once.
    """

    spiel_id: CustomObjectId


class FLPatchSpielDataResponse(BaseAPIResponse):
    """What `patch_spiel_data` returns: every fixture it moved, and what that cost.

    Both lists report writes the caller did not ask for, each carrying the result it destroyed.
    """

    advanced_to: list[FLSpielAdvancement] = Field(default_factory=list)
    released_sides: list[FLSpielReleasedSide] = Field(default_factory=list)
    bracket_faults: list[FLBracketFault] = Field(default_factory=list)

    # The lists above are what an admin READS; this is what an undo SENDS -- a fixture both of them
    # name is restored once, and neither reports the sides.
    # ORDER-BEARING: the fixture the request named leads it (`docs/backend/spec.md :: I215`).
    prior_paarungen: list[FLSpielPriorPaarung] = Field(default_factory=list)


class FLPatchSpielePaarungenResponse(BaseAPIResponse):
    """What a whole replay cost beyond the fixtures it was asked to restore, and the season's faults once it had.

    No `prior_paarungen`: a restore this reports would be an undo of an undo, which no surface offers
    (`fl_frontend/src/shared/utils/undoDispatch.ts :: offerUndo`).
    """

    # A fixture the replay itself puts back after this rewrite is left out of both: it is the
    # mechanism the order exists for (`docs/backend/spec.md :: I223`) rather than something an admin
    # lost.
    advanced_to: list[FLSpielAdvancement] = Field(default_factory=list)
    released_sides: list[FLSpielReleasedSide] = Field(default_factory=list)

    # The LAST entry's, never a union: an earlier entry's faults describe a season the replay has
    # since moved past, and only the committed one is a fault an admin can act on.
    bracket_faults: list[FLBracketFault] = Field(default_factory=list)
