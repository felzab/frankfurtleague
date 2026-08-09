"""
SPIELE · models

The Spiel read model, the admin patch payload, and the embedded field models they share. All are
hand-mirrored by `fl_frontend/src/features/spiele/schemas.ts`: a gate check compares presence,
requiredness, nullability, primitive types and enum members (ADR-0040) — patterns, lengths and
ranges stay yours to keep in step by hand.

Invariants:
- The embedded field models are declared before the payload and `FLSpiel` that reference them.
- The stored shape and the joined read shape are two models, and the stored one is the base (ADR-0028).
- A side is `None` until its occupant is known; `teamN_quelle` is an independent sibling (ADR-0042).
- Money fields carry no default: the patch writes wholesale, so a default would zero real values.
- `ergebnis` uses `[0-9]`, never `\\d` — the two ends must agree about what a digit is.
- A shoot-out is its own scoreline in `elfmeterschiessen`, never inside `ergebnis` (ADR-0044).

See:
- docs/backend/spec.md — section 4, the field-constraint table
- docs/glossary.md — Ergebnis, Tore, saison_phase
"""

from collections.abc import Mapping
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints, TypeAdapter, model_validator

from app.api.teams.schemas import FLDisqualifikation, FLGruppenNames
from app.shared.schemas.custom import CustomDateString, CustomObjectId, CustomOptionalDateString, CustomOptionalTimeString, CustomTimeString
from app.shared.schemas.responses import BaseAPIResponse

FLSaisonPhase = Literal["gruppenphase", "achtelfinale", "viertelfinale", "halbfinale", "finale"]
FLSpielStatus = Literal["ausstehend", "vergangen", "heute", "abgesagt", "unbekannt"]

# ── The competition's shape, derived from the phase set ──────────────────────────────────────────────
#
# **`PHASE_ORDER` is the one declaration of how many knockout rounds this competition can have, and
# adding one is adding a member to it.** Everything below reads the tuple rather than a literal count:
# the ladder, the bracket's capacity, and how many matches a round holds. A `sechzehntelfinale` between
# `gruppenphase` and `achtelfinale` would raise the ceiling from 16 qualifiers to 32 and change nothing
# else in this file (ADR-0065).
#
# The order is the order the rounds are PLAYED, so the group phase is first and the final is last. That
# ordering is what `find_wiring_refusal` needs to refuse a feeder played too late, and what
# `order_spieltage` needs because a matchday's position is derived rather than stored (ADR-0064).
PHASE_ORDER: tuple[FLSaisonPhase, ...] = ("gruppenphase", "achtelfinale", "viertelfinale", "halbfinale", "finale")

# The rank of each phase, built from the order above so the two cannot disagree. A Mapping because both
# callers ask "which rank is this phase" rather than "what is at rank n" -- the frontend's
# `SAISON_PHASE_OPTIONS` is the array form and mirrors `PHASE_ORDER` the way every schema there mirrors
# one here.
PHASE_RANK: Mapping[FLSaisonPhase, int] = {phase: rank for rank, phase in enumerate(PHASE_ORDER)}

# The knockout rounds, largest first: every phase except the group phase, which is not a round.
KNOCKOUT_PHASES: tuple[FLSaisonPhase, ...] = PHASE_ORDER[1:]

# How many teams a season may send into the bracket. A knockout ladder halves each round down to one
# final, so it needs a power of two -- and the ceiling is what the phase set can hold: 2**4 = 16 with
# the five phases above.
MAX_QUALIFIERS: int = 2 ** len(KNOCKOUT_PHASES)


# The three embedded field models are declared BEFORE the payload and FLSpiel that reference them.
# With them below, those models resolved only through PEP 649 deferred annotations plus pydantic's
# lazy rebuild -- __pydantic_complete__ stayed False until the first validation, so anything reaching
# into the core schema earlier raised PydanticUserError instead of a clean ValidationError.
class FLSpielTeamField(BaseModel):
    """
    One side of a fixture as the DOCUMENT stores it, and as the admin PATCH writes it back.

    Every key here is either embedded on `spiele` or derived from what is. Nothing joined belongs on
    this model: `patch_spiel_data` writes the payload back wholesale with `$set` and
    `advance_bracket_winners` dumps a resolved side straight into one, so a field added here reaches
    the document on the next edit -- which is the denormalisation ADR-0028 rule 4 refuses, arriving
    through the write path instead of through a fan-out. `FLSpielTeamFieldJoined` below is where a
    joined field goes.
    """

    team_id: CustomObjectId
    name: str = Field(min_length=1)
    tore: Annotated[int, Field(ge=0)] | None
    shorthand: str = Field(min_length=2, max_length=2)


class FLSpielTeamFieldJoined(FLSpielTeamField):
    """
    One side as a READ serves it: the stored copy above, plus this season's state joined onto it.

    Produced only by `build_spiele_pipeline`, never by a write and never by a validation of a raw
    `spiele` document. The distinction is the whole reason there are two models -- see `FLSpielJoined`.
    """

    # Out of THIS fixture's season, with the reason and the date, or null while the team competes.
    # JOINED from the `saison_teams` row keyed on the fixture's own `saison_id` and this side's
    # `team_id`, and copied into no document (ADR-0028 rule 4, ADR-0059), so a disqualification
    # entered on the junction reaches every match card at once and the two cannot drift.
    #
    # The whole record rather than a boolean, matching `FLTeam.disqualifikation` exactly: the badge
    # needs only its presence, but one shape across both models means every reader asks the same
    # question -- `disqualifikation is not None` -- and the popover can say WHY without a second read.
    #
    # Null ALSO covers a side whose team holds no `saison_teams` row for the season at all. That is a
    # different fact from competing (`find_eligibility_refusal` refuses it as `REQ-ELIGIBILITY-002`),
    # but it is not a disqualification, and this field answers only that question.
    disqualifikation: FLDisqualifikation | None


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


class FLSpielQuelleGruppe(BaseModel):
    """A slot fed by the group phase: the team finishing `platz` in `gruppe`."""

    # `type`, not the German `Art`: the discriminator names the shape of this object rather than
    # anything in the competition, so it is structural vocabulary and stays English -- as `format` on
    # the teams response already does. The two VALUES it takes are domain terms and stay German.
    type: Literal["gruppe"]
    gruppe: FLGruppenNames
    platz: int = Field(gt=0)


class FLSpielQuelleSpiel(BaseModel):
    """A slot fed by an earlier fixture: the side that came out of match `spiel_nr` as `ausgang`."""

    type: Literal["spiel"]
    # Deliberately a spiel_nr and not an ObjectId. A bracket is drawn by match number, the number is
    # unique within a season (`fl_backend/app/core/constraints.py :: UNIQUE_INDEXES`), and an id would
    # make the draw depend on which documents already exist.
    spiel_nr: int = Field(gt=0)
    # `verlierer` exists because a third-place play-off is fed by the two losing semi-finals. Nothing
    # writes it yet; the bracket cannot express one without it.
    ausgang: Literal["sieger", "verlierer"]


# The two ways a bracket slot is fed, and there is no third. The first knockout round is always seeded
# from the group phase; every round after it is fed by matches in the round before (ADR-0042). Tagged
# rather than a bare union: `type` is what lets Pydantic, the Zod mirror and every reader pick a variant
# without inspecting which keys happen to be present.
FLSpielQuelle = Annotated[FLSpielQuelleGruppe | FLSpielQuelleSpiel, Field(discriminator="type")]


class FLSpielElfmeterschiessen(BaseModel):
    """
    The penalty shoot-out that settled a knockout fixture whose goals finished level (ADR-0044).

    **A `gruppenphase` fixture never carries one**, and that is not expressible here: `saison_phase` is a
    sibling field, so pairing the two would be a cross-field rule failing on READ for a hand-edited
    document and taking the bracket page down with it (ADR-0042, invariant I22). `patch_spiel_data`
    discards a shoot-out arriving on a group fixture, and `_outcome_of` refuses to read one.

    The two counts are the SHOOT-OUT's own scoreline and are never added to `tore`: a shoot-out win is a
    draw for the league table, and only the bracket reads the winner off this (ADR-0026).

    `team1` and `team2` name the same two sides the fixture does, so the winner is DERIVED here exactly
    as it is from the goals. There is deliberately no `sieger` field: a second statement of the same
    fact could contradict the counts, and no `$jsonSchema` validator could express that it must not --
    the reasoning that kept an `is_manual` flag off `quelle` (ADR-0042) and made `inactive_since` a date
    (ADR-0032).
    """

    team1: int = Field(ge=0)
    team2: int = Field(ge=0)

    @model_validator(mode="after")
    def a_shootout_names_a_winner(self) -> "FLSpielElfmeterschiessen":
        """
        Refuse a level shoot-out: it is the one value this field could hold and still name nobody.

        It fails on READ as well as on write, which is the same bargain `ergebnis`'s pattern and
        `mietpreis`'s `ge=0` already strike: the database validator asserts types, presence and enums
        only (ADR-0027), so a hand edit in Compass is what this catches, loudly and immediately. The
        alternative is a fixture that looks settled, advances nobody, and says nothing about why --
        which is the state FB-8 exists to remove rather than to reproduce behind a filled-in field.
        """

        if self.team1 == self.team2:
            raise ValueError("Ein Elfmeterschiessen kann nicht unentschieden enden -- eine Seite hat mehr Treffer als die andere.")

        return self


class FLBracketFaultGruppe(BaseModel):
    """
    One bracket slot whose `gruppe` reference names a placing the standings will never hand it.

    Both reasons need a person, which is what separates them from the ordinary state of a group that is
    simply still being played -- that one is reported by nobody, because "not yet" is not a problem
    (ADR-0043).

    `gruppe_too_small` is a data-entry mistake: the group holds fewer teams that can hold a placing than
    the `platz` asks for, so no result will ever produce it. Like a `spiel_nr` naming no match, the slot
    is left exactly as it stands -- erasing a team over a typo destroys more than it reports (ADR-0042).

    `tie_unresolved` is a real outcome: the group is played out and the tiebreak chain still cannot
    separate two teams at that placing. The slot IS emptied, because naming either team would be a
    guess, and clearing the `quelle` and entering a side by hand is the route past it.
    """

    reason: Literal["gruppe_too_small", "tie_unresolved"]
    spiel_id: CustomObjectId
    spiel_nr: int = Field(gt=0)
    gruppe: FLGruppenNames
    platz: int = Field(gt=0)


class FLBracketFaultQuelle(BaseModel):
    """
    One bracket slot whose `spiel` reference names a match that cannot state an outcome.

    `spiel_missing` is a number the season has no match for; `reference_cycle` is a chain of references
    that closes on itself, and it is reported on every fixture the loop reaches, because each of them is
    equally underivable. `quelle_spiel_nr` is the number the slot names, which is the value to correct.

    Both leave the slot exactly as it stands (ADR-0042), and neither is reachable through the write path
    any more (ADR-0046) -- so a stored one is a hand edit, which is the caller this model reports to.
    """

    reason: Literal["spiel_missing", "reference_cycle"]
    spiel_id: CustomObjectId
    spiel_nr: int = Field(gt=0)
    quelle_spiel_nr: int = Field(gt=0)


class FLBracketFaultSpiel(BaseModel):
    """
    One fixture whose two references resolve to the SAME club, so it would be a team against itself.

    Unlike the other four, this one survives every write-path rule: the refusal keys a source by its
    identity, so two DIFFERENT sources that happen to name one club pass it (ADR-0046). A manual side
    holding a club, against a side fed by a match that club then wins, is the reachable shape.

    The fixture keeps its stored sides and everything downstream keeps deriving from them.
    """

    reason: Literal["same_team"]
    spiel_id: CustomObjectId
    spiel_nr: int = Field(gt=0)


class FLBracketFaultOccupant(BaseModel):
    """
    One fixture that fields a team the season disqualified before the day it is played.

    **Not a fault of the bracket, and the only one here that is not.** The other five are contradictions
    between a slot's references and what the season can produce; this one is a contradiction between a
    fixture's DATE and a decision recorded on the junction row, and it applies to a group-phase fixture
    exactly as much as to a knockout slot. It shares this union because it shares the channel: a derived
    contradiction that needs a person, reported on the same triage list (ADR-0047, ADR-0056).

    **A fixture played BEFORE the disqualification is not a fault.** The team was eligible on the day, so
    the match and its result stand -- `find_eligibility_refusal` permits entering that result for the same
    reason (decided 2026-08-08). What is reported is a fixture on or after the effective day.

    `spiel_datum` is null where the fixture carries no date, which is reported: an undated fixture cannot
    be shown to have been played in time, and that is the same refuse-by-default reading the write path
    takes.

    Nothing is emptied. The fixture keeps both sides, because the answer -- cancel it, award it, or
    replace the team -- is a competition decision and not one a derivation may take (roadmap FB-9).
    """

    reason: Literal["disqualified_occupant"]
    spiel_id: CustomObjectId
    spiel_nr: int = Field(gt=0)
    side: Literal["team1", "team2"]
    team_id: CustomObjectId
    team_name: str = Field(min_length=1)
    # The day the disqualification took effect, and the day this fixture is played, so a reader can see
    # the ordering that makes it a fault without opening either document.
    disqualifiziert_seit: CustomDateString
    spiel_datum: CustomOptionalDateString


# The six derived faults, tagged on `reason` so each variant carries exactly the fields its own fault
# needs and no reader has to know which of them are meaningful together. Discriminated rather than
# flattened with optional fields, for the same reason `FLSpielQuelle` is: a flat model can express a
# cycle carrying a `platz`, which means nothing, and no validator here could refuse it (ADR-0047).
FLBracketFault = Annotated[
    FLBracketFaultGruppe | FLBracketFaultQuelle | FLBracketFaultSpiel | FLBracketFaultOccupant,
    Field(discriminator="reason"),
]


class FLSpielBooking(BaseModel):
    """
    The three fields the clash rule reads off ANOTHER fixture, validated (decided 2026-08-08).

    Its own model rather than `FLSpiel`, because the clash read spans every season and projects three keys
    -- validating whole fixtures there would read every field of every match in the database to compare two
    times. And a validated model rather than raw dict access, because `find_clash_refusal` ACTS on these
    values: `uhrzeit` is split into three parts to compare, so a hand-edited `18:00` raised `ValueError` and
    answered 500 on a legitimate edit. `CustomTimeString` refuses it at the boundary with a loud, specific
    error instead -- which is the reason every other Mongo read on this path is validated too.

    Neither field is nullable: the query filters both out, so a document reaching this model has them.
    """

    spiel_nr: int = Field(gt=0)
    datum: CustomDateString
    uhrzeit: CustomTimeString


FLSpielBookingListAdapter = TypeAdapter(list[FLSpielBooking])


class FLPatchSpielDataPayload(BaseModel):
    # No `spiel_id`: the match being changed is named by the path (RFC 5789 -- the Request-URI
    # identifies the resource, the body describes the change).
    is_canceled: bool

    team1: FLSpielTeamField | None
    team2: FLSpielTeamField | None

    # On the payload because it is written wholesale with `$set`: a field the request omits is
    # OVERWRITTEN, not preserved, so leaving these off would erase a bracket's wiring on the first
    # edit of any other field.
    team1_quelle: FLSpielQuelle | None
    team2_quelle: FLSpielQuelle | None

    # On the payload for the same `$set` reason as the two above. The handler discards it unless the
    # goals it accompanies are level, so a shoot-out cannot end up stored against a fixture one side
    # already won (ADR-0044).
    elfmeterschiessen: FLSpielElfmeterschiessen | None

    datum: CustomOptionalDateString
    uhrzeit: CustomOptionalTimeString
    ort: FLSpielOrtField | None
    schiedsrichter: FLSpielSchiedsrichterField | None

    # On the payload for the `$set` reason the fields above are: omitted would mean erased. An
    # emptied textarea arrives as "" and leaves as None through the validator below, which is how a
    # note is removed. Free text and public, the same trust `disqualifikation.grund` and
    # `teams.description` already carry (ADR-0059).
    notiz: str | None

    @model_validator(mode="before")
    @classmethod
    def empty_strings_to_none(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: (None if isinstance(v, str) and v.strip() == "" else v) for k, v in data.items()}
        return data


class FLSpiel(BaseModel):
    """
    One fixture as the `spiele` collection STORES it -- every field read off the document itself.

    This is what the write path holds and what a raw document validates as, at eight sites: both
    reads below, the three season reads inside `patch_spiel_data`, `find_bracket_faults`,
    `advance_bracket_winners` and the grouped table's match read in `teams/router.py`. Six of those
    eight neither want nor could supply a joined field, which is why `FLSpielJoined` is a second model
    rather than a default on this one -- a default would make those six quietly assert that nobody is
    disqualified.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")  # So the _id field can be accesed through id

    # `None` while the occupant is unknown -- a playoff slot the group phase has not filled yet. The
    # opponent is MODELLED as absent rather than impersonated by a placeholder team (ADR-0042).
    team1: FLSpielTeamField | None
    team2: FLSpielTeamField | None

    # Where each side comes from, as a REFERENCE the bracket is drawn from -- never derived and never
    # fanned out into, unlike the `name` above, which is a display copy of `teams.name` (ADR-0028,
    # rule 3). Null on a group-phase fixture, and null on any slot an admin has taken manual charge of.
    team1_quelle: FLSpielQuelle | None
    team2_quelle: FLSpielQuelle | None

    datum: CustomDateString | None
    uhrzeit: CustomTimeString | None

    ort: FLSpielOrtField | None
    schiedsrichter: FLSpielSchiedsrichterField | None

    # "Tore:Tore", or null when the match has not been played. Parsed as structured data by the
    # frontend, which derives win/draw/loss from it -- so a malformed value renders as a loss for both
    # teams, which is what the pattern is here to refuse.
    ergebnis: Annotated[str, StringConstraints(pattern=r"^[0-9]+:[0-9]+$")] | None

    # How a knockout that finished level was settled, or null -- which is every match that was not, and
    # therefore almost all of them. Kept OUT of `ergebnis`: both ends parse that string to derive
    # win/draw/loss, and a third number in it would read as a malformed value on every card (ADR-0044).
    elfmeterschiessen: FLSpielElfmeterschiessen | None

    spieltag_id: CustomObjectId
    spiel_nr: int = Field(gt=0)

    is_canceled: bool
    saison_phase: FLSaisonPhase
    saison_id: str = Field(min_length=4, max_length=4)

    # An optional free-text note on the fixture -- exciting moments, anything worth a sentence
    # (decided 2026-08-02). DEFAULTED, unlike `elfmeterschiessen`'s required key: nothing anywhere
    # distinguishes a missing key from a stored null -- both mean "no note" -- so requiring the key
    # would buy a backfill of every live document for a distinction with no consumer. The bracket
    # resolution never touches it: a voided fixture keeps its note for the admin to rewrite, because
    # silently destroying entered prose is the behaviour ADR-0051 exists to make visible.
    notiz: str | None = None


class FLSpielJoined(FLSpiel):
    """
    One fixture as an ENDPOINT serves it.

    The stored document above, with each side's season state joined onto it by `build_spiele_pipeline`.

    **This is the wire shape of every response carrying matches**, and that uniformity is load-bearing
    rather than tidy: the frontend mirrors all of them with one `FLSpielSchema`, so a route serving the
    narrower shape would leave `SpielTeamSlot` with no badge to render and nothing would report it
    (ADR-0040 compares the published document, and a field absent from one route is still published).

    **A subclass, so a joined fixture is still an `FLSpiel`.** The bracket resolution takes the stored
    shape and reads none of what is added here, and `find_bracket_faults` reports faults over documents
    it has already joined for display -- so narrowing the two sides keeps one read serving both instead
    of forcing a second query per faulted fixture. Nothing assigns to `team1` or `team2` after
    validation; a joined fixture is built by the pipeline and read.

    **The direction of the inheritance is deliberate and must not be flipped.** The stored shape is the
    one a write can reach, so it is the one that stays free of derived fields. Adding
    `disqualifikation` to `FLSpielTeamField` and stripping it on write would put the burden on every
    future writer instead of on the type.
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

    limit: int = Field(default=1024, ge=1, le=1024)
    sort_by: Literal["datum", "uhrzeit", "spiel_nr", "saison_phase"] = Field(default="datum")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLSpieleListResponse(BaseAPIResponse):
    spiele: list[FLSpielJoined]


class FLSpieleSingleResponse(BaseAPIResponse):
    spiel: FLSpielJoined


class FLSpieleActionRequiredResponse(BaseAPIResponse):
    """
    What `get_spiele_action_required` returns: the matches needing attention, and why the bracket ones do.

    `spiele` carries every match the route's filter selected PLUS every match named by a fault below, so
    the client always holds the document behind a fault and can render it as an ordinary card. A fault is
    joined to its match by `spiel_id`, never by `spiel_nr`, which repeats across seasons
    (`fl_backend/app/core/constraints.py :: UNIQUE_INDEXES`) and this route spans them.

    `bracket_faults` is DERIVED on every request and stored nowhere (ADR-0047). It is the same list
    `PATCH /spiele/{spiel_id}` reports in its response, computed over every season instead of one.

    The matches are `FLSpielJoined`, as the two read endpoints' are. This route's list renders through
    the same `SpielCard`, so a narrower shape here would be a DQ badge that the public grids show and
    the admin triage list silently does not.
    """

    spiele: list[FLSpielJoined]
    bracket_faults: list[FLBracketFault] = Field(default_factory=list)


class FLSpielAdvancement(BaseModel):
    """
    One fixture the bracket resolution rewrote, and the result that rewrite destroyed.

    **The two are separate facts and the second is the one an admin needs.** A slot filling from empty
    is the ordinary, harmless case; a slot whose occupant changed while the fixture already held a
    scoreline loses that scoreline in the same transaction (ADR-0042, ADR-0044) -- which a response
    reporting only that a `Paarung` was updated cannot convey (ADR-0051).

    Both voided fields are `None` on the harmless case, so "was anything destroyed here" is a null
    check rather than a comparison against the fixture's earlier state — which the caller does not
    have.
    """

    spiel_nr: int = Field(gt=0)
    # The scoreline the fixture held at the moment the resolution ran, copied out before the write
    # cleared it. Same pattern as `FLSpiel.ergebnis`, because that is exactly what this is.
    voided_ergebnis: Annotated[str, StringConstraints(pattern=r"^[0-9]+:[0-9]+$")] | None
    voided_elfmeterschiessen: FLSpielElfmeterschiessen | None


class FLSpielReleasedSide(BaseModel):
    """
    One side another fixture gave up so a team could be fielded on the same Spieltag (ADR-0052).

    A team plays at most one match per matchday, so fielding it here takes it out of there. Only a
    side the admin owns is moved this way: a side carrying a `quelle` is the resolution's, emptying it
    would be undone on the next pass, and that case is refused instead.

    `team_name` rather than an id, because the message quoting this has no `spiele` list to join
    against. It cannot go stale — the rename fan-out maintains the copy it is read from (ADR-0028,
    rule 3) and this is derived per request.
    """

    spiel_nr: int = Field(gt=0)
    # English, like `type` on a quelle: it names a field of the document rather than anything in the
    # competition.
    side: Literal["team1", "team2"]
    team_name: str = Field(min_length=1)
    voided_ergebnis: Annotated[str, StringConstraints(pattern=r"^[0-9]+:[0-9]+$")] | None
    voided_elfmeterschiessen: FLSpielElfmeterschiessen | None


class FLPatchSpielDataResponse(BaseAPIResponse):
    """
    What `patch_spiel_data` returns: the envelope, plus every fixture it moved and what that cost.

    `advanced_to` carries one entry per bracket fixture whose sides the result entry resolved — a
    semi-final that gained its winner, and, when a result was corrected, a later fixture that lost an
    occupant it should never have had (ADR-0042). It reports what happened rather than what was asked
    for, so it names a fixture that was emptied as readily as one that was filled, and each entry
    carries the result the rewrite destroyed rather than leaving the reader to infer it (ADR-0051).

    `released_sides` carries the other kind of write this endpoint can make: a side of another fixture
    on the same Spieltag, emptied because the team it held is now fielded here (ADR-0052).

    Reported for the same reason `PATCH /teams/{team_id}` reports `fanned_out_to_spiele`: a write that
    silently changes documents the caller did not name is one whose failures are invisible. Both lists
    are empty for the ordinary group-phase edit.

    **`dry_run=true` returns this same shape and writes nothing.** One model, because a preview that
    could disagree with the save it previews is worse than no preview (ADR-0051).

    `bracket_faults` carries every stored contradiction the resolution walked past in this season: a
    `gruppe` reference that cannot be honoured and will not become honourable by waiting (ADR-0043), a
    `spiel` reference naming no match or sitting on a cycle, and a fixture whose two sides resolve to one
    club. A group still being played is in none of them: a placing that is not decided yet is the
    ordinary state and needs nobody.

    The same list is derived on `GET /spiele/action_required`, which is where it can be re-asked for
    (ADR-0047). Reported here as well because the save that introduces a fault is the moment its cause
    is known.
    """

    advanced_to: list[FLSpielAdvancement] = Field(default_factory=list)
    released_sides: list[FLSpielReleasedSide] = Field(default_factory=list)
    bracket_faults: list[FLBracketFault] = Field(default_factory=list)
