from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.api.spielberichte.schemas import FLSpielberichtSpielerPublic, FLSpielberichtTeam
from app.api.spieler.schemas import FLSpielerRolle
from app.core.exceptions import rule_refusal
from app.shared.schemas.bounds import AUFSTELLUNG_STARTERS_MAX
from app.shared.schemas.custom import CustomDateString, CustomObjectId, CustomTimeString, CustomVersion, FLUtcInstant
from app.shared.schemas.literals import FLSpielerPosition
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel

# The most pupils one line-up names, far above any squad: the squad itself is the rule a save is judged by, and this
# only bounds what a request may carry.
AUFSTELLUNG_ENTRIES_MAX = 60

# Where a line-up stands against its fixture's kick-off, by the clock alone: `open` before the due mark, `overdue` from
# it to the lock, `locked` from the lock, for the team alone (`app/shared/schemas/bounds.py :: AUFSTELLUNG_DUE_HOURS`,
# `AUFSTELLUNG_LOCK_HOURS`). Whether one is stored is a second fact beside it: a page combines the two.
type FLAufstellungPhase = Literal["open", "overdue", "locked"]


class FLAufstellungEntry(BaseModel):
    """One pupil a club fields in one match: on the pitch from the start, or on the bench."""

    model_config = ConfigDict(extra="forbid")

    spieler_id: CustomObjectId
    starts: bool


class FLAufstellung(BaseModel):
    """One club's line-up for one fixture, as `aufstellungen` stores it: created by the club's first save, one per club per fixture.

    Keyed by the club and never by a side: a knockout correction re-fielding a side leaves the replaced club's line-up
    its own, which no read of the fixture then joins.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    saison_id: str
    spiel_id: CustomObjectId
    team_id: CustomObjectId
    # In the order the save sent them; an emptied line-up is an empty list, never a removed document.
    spieler: list[FLAufstellungEntry]
    # 0 until a write raises it, as the create stamps it.
    version: int = 0


# --- The WRITE: one payload for a seat's save and an administrator's.


class FLAufstellungPayload(BaseModel):
    """A club's whole line-up for one fixture, written wholesale."""

    model_config = ConfigDict(extra="forbid")

    spieler: Annotated[list[FLAufstellungEntry], Field(max_length=AUFSTELLUNG_ENTRIES_MAX)]
    # The document's `version` the screen was served, null where it showed no line-up: required with no default, since
    # an omitted one would check nothing (`app/core/crud.py :: find_stale_first_save_refusal`).
    version: CustomVersion | None

    @model_validator(mode="after")
    def the_list_names_each_pupil_once_and_eleven_starters_at_most(self) -> Self:
        named = [entry.spieler_id for entry in self.spieler]
        if len(set(named)) != len(named):
            raise rule_refusal("spieler_named_twice", "a line-up names a pupil once")
        if sum(entry.starts for entry in self.spieler) > AUFSTELLUNG_STARTERS_MAX:
            raise rule_refusal("starters_exceed_eleven", "more starters than a side fields", {"max": AUFSTELLUNG_STARTERS_MAX})

        return self


# --- The line-up's SCREEN, read by a seat of the club and by an administrator alike.


class FLAufstellungSpiel(BaseModel):
    """The fixture a line-up is for, as its screen states it."""

    spiel_id: CustomObjectId
    saison_id: str
    date: CustomDateString | None
    time: CustomTimeString | None
    team1: FLSpielberichtTeam | None
    team2: FLSpielberichtTeam | None


class FLAufstellungSpieler(BaseModel):
    """A pupil a line-up may name or names, as the club's own people read them: the whole surname, and what their squad row holds.

    Both names null where an erasure took the record, whose entries name the sentinel.
    """

    spieler_id: CustomObjectId
    first_name: str | None
    last_name: str | None
    nummer: str | None
    position: FLSpielerPosition | None
    rolle: FLSpielerRolle | None
    # A nominee is named only while the line-up names fewer than eleven regular players, and no more of them than the gap
    # (`aufstellung_nominee_without_shortage`).
    is_nachnominiert: bool


class FLAufstellungMarks(BaseReadModel):
    """What a team's read serves about a line-up: whether one is stored, and where the clock stands against its fixture's kick-off.

    Two facts and two instants, never one combined state: a page calls a line-up due where it is `open` with none
    stored, and overdue where the due mark has passed with none stored.
    """

    stored: bool
    phase: FLAufstellungPhase
    due_at: FLUtcInstant
    locks_at: FLUtcInstant


class FLAufstellungResponse(BaseAPIResponse):
    """One club's line-up screen for one fixture: the squad to pick from, the stored line-up and what its save sends back."""

    spiel: FLAufstellungSpiel
    team_id: CustomObjectId
    # The club's live squad of the fixture's season, in shirt-number order.
    kader: list[FLAufstellungSpieler]
    # Every pupil the stored line-up names outside that squad, one deregistered or erased since, so a stored entry keeps
    # its row.
    named: list[FLAufstellungSpieler]
    # The stored line-up in the order it was saved, empty where none is stored: `version` tells the two apart.
    spieler: list[FLAufstellungEntry]
    # The document's count of writes, null where none is stored: a save sends it back.
    version: int | None
    # Null for a fixture holding no day or no hour, which owes no line-up and takes none.
    marks: FLAufstellungMarks | None


# --- The PUBLIC read: a line-up as the match page shows it, every pupil through the base tier's mask.


class FLAufstellungEntryPublic(FLSpielberichtSpielerPublic):
    """One pupil of a line-up, as the base tier serves them, with the captaincy their squad row holds.

    `rolle` only where `type` is `named`: the mark stands beside a name, and beside a withheld one it would say who the
    nameless pupil is.
    """

    starts: bool
    rolle: FLSpielerRolle | None


class FLAufstellungPublic(BaseReadModel):
    """One club's line-up for the match, starters and substitutes in the order the club entered them."""

    spieler: list[FLAufstellungEntryPublic]


class FLAufstellungenPublic(BaseReadModel):
    """Each side's line-up, the one whose club the fixture fields there now; null where that club has stored none."""

    team1: FLAufstellungPublic | None
    team2: FLAufstellungPublic | None
