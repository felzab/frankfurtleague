from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints, model_validator

from app.api.spiele.schemas import SONDEREREIGNIS_NO_SHOW, FLSpielElfmeterschiessen, FLSpielElfmeterschiessenPayload, FLSpielortFieldPublic
from app.core.exceptions import rule_refusal
from app.shared.schemas.bounds import SPIELBERICHT_ENTRIES_MAX, SPIELBERICHT_REMARKS_MAX_LENGTH
from app.shared.schemas.custom import (
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomTimeString,
    FLUtcInstant,
    parse_empty_string_to_none,
)
from app.shared.schemas.literals import FLSaisonPhase, FLSonderereignis, FLSpielerPosition, FLSpielSide
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel

# The minute as the DFB's report writes it: the played minute, and stoppage time after a plus, `45+2`.
MINUTE_PATTERN = r"^[0-9]{1,3}(\+[0-9]{1,2})?$"

CustomSpielberichtMinute = Annotated[str, StringConstraints(pattern=MINUTE_PATTERN)]

# Multi-line, unlike a confirmation's reason: the referee's prose about the match, read on the editor's panel alone.
# The ceiling counts what arrives, so the published one is what is accepted; the floor counts after the strip, so
# spaces alone are no remark.
CustomSpielberichtRemarks = Annotated[
    str, StringConstraints(max_length=SPIELBERICHT_REMARKS_MAX_LENGTH), AfterValidator(str.strip), StringConstraints(min_length=1)
]

type FLCardColour = Literal["gelb", "gelb_rot", "rot"]

# The events a referee may propose: the three a match that took place can end in. A fixture called off or struck
# out has no report.
FLSpielberichtSonderereignis = Literal["abgebrochen", "nichtantreten_team1", "nichtantreten_team2"]

# Derived on every read from the report and the fixture, and stored nowhere. `cancelled` is a report on a fixture called
# off or struck out since it was sent: the match took no place, so nothing awaits the administrator.
type FLSpielberichtState = Literal["proposed", "adopted", "differing", "cancelled", "sides_changed"]


class FLSpielberichtVorschlag(BaseModel):
    """The referee's proposed result, which only the administrator's own save applies.

    Each count is the entries credited to that side, written by the report's save and sent by no form. Both null on a
    no-show alone: the save composes its goals from the season's forfeit, which counted goals could never equal.
    """

    team1_tore: Annotated[int, Field(ge=0)] | None
    team2_tore: Annotated[int, Field(ge=0)] | None
    elfmeterschiessen: FLSpielElfmeterschiessen | None
    sonderereignis: FLSpielberichtSonderereignis | None


class FLSpielberichtScorer(BaseModel):
    """One goal. A null `spieler_id` is a scorer nobody named and nothing else: an erasure never nulls an entry, which would read as one."""

    side: FLSpielSide
    spieler_id: CustomObjectId | None
    minute: CustomSpielberichtMinute
    # An own goal keeps the scorer's side and counts for the other one.
    eigentor: bool


class FLSpielberichtCard(BaseModel):
    """One card: who was shown it, when, and its colour.

    A null `spieler_id` is a player nobody named and nothing else, as a scorer's is: a side whose club holds no squad
    still takes cards.
    """

    side: FLSpielSide
    spieler_id: CustomObjectId | None
    minute: CustomSpielberichtMinute
    colour: FLCardColour


class FLSpielberichtScorerPayload(FLSpielberichtScorer):
    """One goal as the referee's save sends it: a key the goal does not declare is refused, never dropped."""

    model_config = ConfigDict(extra="forbid")


class FLSpielberichtCardPayload(FLSpielberichtCard):
    """One card as the referee's save sends it: a key the card does not declare is refused, never dropped."""

    model_config = ConfigDict(extra="forbid")


class FLSpielberichtSides(BaseModel):
    """The clubs the fixture fielded at the block's last write, null on a slot then open.

    Stamped by every write and on no payload: entries go by side, and a knockout correction can re-field one.
    """

    team1: CustomObjectId | None
    team2: CustomObjectId | None


class FLSpielberichtBericht(BaseModel):
    """The referee's account of one match, one proposal, a correction after its adoption reading `differing`."""

    ergebnis_vorschlag: FLSpielberichtVorschlag
    scorers: list[FLSpielberichtScorer]
    cards: list[FLSpielberichtCard]
    # Its length is the payload's: the read keeps a ban reason's floor alone.
    remarks: CustomNonEmptyString | None
    sides: FLSpielberichtSides
    submitted_at: FLUtcInstant
    # Whether the administrator's save took this content over. The referee's every write clears it in the same update,
    # so it never outlives the content it was given for; a job writing the document (an erased pupil's repoint, the
    # season-end strip) leaves it alone.
    adopted: bool


class FLSpielbericht(BaseModel):
    """One fixture's report document, as stored: created by the referee's first save, and the report's alone."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    saison_id: str
    spiel_id: CustomObjectId
    bericht: FLSpielberichtBericht
    # 0 until a write raises it, as the create stamps it.
    version: int = 0


# --- The WRITE: the referee's PUT.


class FLSpielberichtVorschlagPayload(BaseModel):
    """What the referee proposes beside the goals: a shoot-out, or the event the match ended in."""

    model_config = ConfigDict(extra="forbid")

    # Both required as KEYS and null where unused: an omitted key would read as a form that forgot it.
    elfmeterschiessen: FLSpielElfmeterschiessenPayload | None
    sonderereignis: FLSpielberichtSonderereignis | None


class FLSpielberichtBerichtPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ergebnis_vorschlag: FLSpielberichtVorschlagPayload
    # The payload's own item models: a model's `extra` reaches none nested in it, and the stored ones stay lenient.
    scorers: Annotated[list[FLSpielberichtScorerPayload], Field(max_length=SPIELBERICHT_ENTRIES_MAX)]
    cards: Annotated[list[FLSpielberichtCardPayload], Field(max_length=SPIELBERICHT_ENTRIES_MAX)]
    remarks: Annotated[CustomSpielberichtRemarks | None, BeforeValidator(parse_empty_string_to_none)]

    def proposed(self) -> FLSpielberichtVorschlag:
        """The proposal as stored: each side's count is the entries credited to it, an own goal crediting the other side.

        Both counts null on a no-show, whose goals the league composes.
        """

        vorschlag = self.ergebnis_vorschlag
        if vorschlag.sonderereignis in SONDEREREIGNIS_NO_SHOW:
            return FLSpielberichtVorschlag(team1_tore=None, team2_tore=None, **vorschlag.model_dump())

        credited = {"team1": 0, "team2": 0}
        for tor in self.scorers:
            # An own goal is scored by `side` and counts for the other side.
            credited[("team2" if tor.side == "team1" else "team1") if tor.eigentor else tor.side] += 1

        return FLSpielberichtVorschlag(team1_tore=credited["team1"], team2_tore=credited["team2"], **vorschlag.model_dump())

    @model_validator(mode="after")
    def the_proposal_fits_its_entries(self) -> Self:
        """A no-show proposes the event alone, with no shoot-out and no scorer; a shoot-out follows level goals alone."""

        proposed = self.proposed()

        if proposed.sonderereignis in SONDEREREIGNIS_NO_SHOW:
            if proposed.elfmeterschiessen is not None:
                raise rule_refusal("nichtantreten_with_elfmeterschiessen", "a no-show proposes no shoot-out")
            if self.scorers:
                raise rule_refusal("nichtantreten_with_scorers", "a no-show credits no scorer")
            return self

        if proposed.elfmeterschiessen is not None and proposed.team1_tore != proposed.team2_tore:
            raise rule_refusal("elfmeterschiessen_without_draw", "a shoot-out follows a draw alone")

        return self


class FLSpielberichtPayload(BaseModel):
    """The whole `bericht` block, written wholesale by the referee's PUT."""

    model_config = ConfigDict(extra="forbid")

    bericht: FLSpielberichtBerichtPayload
    # The document's `version` the form was served, null where it showed no report: required with no default, since an
    # omitted one would check nothing (`app/core/crud.py :: find_stale_first_save_refusal`).
    version: int | None


# --- The READ of the referee's form: the fixture, both live squads to pick from, and the stored block.


class FLSpielberichtTeam(BaseModel):
    team_id: CustomObjectId
    # Both as the club's row in the fixture's own season holds them.
    name: str
    shorthand: str


class FLSpielberichtSpiel(BaseModel):
    """The fixture a report is about, as its form states it: no money, no booking, no result."""

    spiel_id: CustomObjectId
    saison_id: str
    saison_phase: FLSaisonPhase
    date: CustomDateString | None
    time: CustomTimeString | None
    team1: FLSpielberichtTeam | None
    team2: FLSpielberichtTeam | None
    # The ground the form's lead names beside the day and the hour, null where none is assigned.
    spielort: FLSpielortFieldPublic | None
    sonderereignis: FLSonderereignis | None


class FLSpielberichtSpieler(BaseModel):
    """A pupil a report may name or names, with the names their record holds, both null where an erasure took the record."""

    spieler_id: CustomObjectId
    first_name: str | None
    last_name: str | None
    nummer: str | None


class FLSpielberichtKader(BaseModel):
    """Each side's live squad of the season, the pupils a new entry may name."""

    team1: list[FLSpielberichtSpieler]
    team2: list[FLSpielberichtSpieler]


class FLSpielberichtSchiedsrichterResponse(BaseAPIResponse):
    """The booked referee's form, the stored remarks included."""

    spiel: FLSpielberichtSpiel
    kader: FLSpielberichtKader
    # Every pupil the stored block names outside the squads served -- one ausgetragen since the match, or of a club a
    # knockout slot has since replaced -- so an entry stored before keeps its name.
    named: list[FLSpielberichtSpieler]
    bericht: FLSpielberichtBericht | None
    # The sides fielding another club than the report's last write found there, which reads `sides_changed`.
    sides_changed: list[FLSpielSide]
    # The document's count of writes, null where none is stored: a save sending it back is refused once another write
    # has raised it, the administrator's adoption among them.
    version: int | None
    # The fixture's season has ended: the page shows the report and offers no write (`saison_past`).
    completed: bool


class FLSpielberichtStateEntry(BaseModel):
    """One fixture's report as the triage reads it: its state and what it proposes."""

    spiel_id: CustomObjectId
    state: FLSpielberichtState
    ergebnis_vorschlag: FLSpielberichtVorschlag


class FLSpielberichteSaisonResponse(BaseAPIResponse):
    """Every report of one season that holds a block, each with its state."""

    spielberichte: list[FLSpielberichtStateEntry]


# --- The PUBLIC read: what the match page shows of a report, every pupil through the base tier's mask.

# Which of three things an entry names: a pupil whose consent publishes their name; one whose name is withheld or
# who was erased, their entry repointed at the placeholder; and nobody, a goal no scorer was named for. The words
# for the two absences are the frontend's.
type FLSpielberichtSpielerType = Literal["named", "anonymous", "unknown"]


class FLSpielberichtSpielerPublic(BaseReadModel):
    """One pupil an entry names, as the base tier serves them; no record id (`READ-PUPIL-005`).

    The names only where `type` is `named`, the surname as an initial (`READ-PUPIL-001`); the number and position off
    the pupil's squad row for that side's club in the match's season, kept where the name is withheld.
    """

    type: FLSpielberichtSpielerType
    first_name: str | None
    last_name: str | None
    nummer: str | None
    position: FLSpielerPosition | None


class FLSpielberichtScorerPublic(BaseReadModel):
    """One goal: `side` is the scorer's own club, and an own goal (`eigentor`) counts for the other one."""

    side: FLSpielSide
    minute: CustomSpielberichtMinute
    eigentor: bool
    spieler: FLSpielberichtSpielerPublic


class FLSpielberichtCardPublic(BaseReadModel):
    """One card, `side` its player's club."""

    side: FLSpielSide
    minute: CustomSpielberichtMinute
    colour: FLCardColour
    spieler: FLSpielberichtSpielerPublic


class FLSpielberichtPublic(BaseReadModel):
    """What the public may read of one match's report.

    The scorers and the cards only while the referee's report reads `adopted` -- adopted, unchanged since, and
    matching the result -- each by minute; null otherwise, which is "not official yet" where an empty list is "nobody
    scored".
    """

    scorers: list[FLSpielberichtScorerPublic] | None
    cards: list[FLSpielberichtCardPublic] | None
