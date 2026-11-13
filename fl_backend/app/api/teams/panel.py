"""What a team's own pages read: its Übersicht and its matches.

Apart from `schemas.py`, which the fixture's models import: these read models are built from a fixture's and a
confirmation's, so they stand above both.
"""

from pydantic import BaseModel

from app.api.aufstellungen.schemas import FLAufstellungMarks
from app.api.saisons.schemas import FLTeamPageSpiel
from app.api.spielbestaetigungen.schemas import FLSpielbestaetigungAppointment, FLSpielbestaetigungTeamState, FLSpielbestaetigungViewAnsetzung
from app.api.teams.schemas import FLTeamSeat
from app.shared.schemas.custom import CustomDateString, CustomNonEmptyString, CustomObjectId
from app.shared.schemas.literals import FLKontaktRolle, FLSpielerPosition, FLSpielerStufe, FLSpielSide, FLTrikotFarbe
from app.shared.schemas.responses import BaseAPIResponse


class FLTeamPanelSpielbestaetigung(BaseModel):
    """One date the league asked the team to confirm, while it still holds work for the team or waits on the league.

    An agreed date is no row here, and a declined one stays, with the team's own proposal, until the league adopts or
    discards it.
    """

    # The row an answer names (`POST /spielbestaetigungen/{spielbestaetigung_id}/answer/team`).
    spielbestaetigung_id: CustomObjectId
    spiel_id: CustomObjectId
    ansetzung: FLSpielbestaetigungViewAnsetzung
    # Which side of the fixture the team plays.
    side: FLSpielSide
    state: FLSpielbestaetigungTeamState
    deadline: CustomDateString
    # The day the team's answer lapsed, its `deadline`; null on any other row, a row an exit ended before its deadline
    # included, which never lapsed.
    lapsed_on: CustomDateString | None
    # On `vorschlag` the other club's proposed date and hour, never which of its seats answered; on
    # `declined` the team's own; null otherwise.
    vorschlag: FLSpielbestaetigungAppointment | None


class FLTeamPanelAufstellung(BaseModel):
    """One coming fixture of the team holding a day and an hour, with its line-up's marks."""

    spiel_id: CustomObjectId
    ansetzung: FLSpielbestaetigungViewAnsetzung
    side: FLSpielSide
    marks: FLAufstellungMarks


class FLTeamPanelRegistrierung(BaseModel):
    """One pending registration as the Übersicht names it: who waits, since when, as what, and whether the team may admit them yet."""

    registrierung_id: CustomObjectId
    first_name: CustomNonEmptyString
    last_name: CustomNonEmptyString
    submitted_at: CustomDateString
    # The registration's own answers, null where the pupil left one open.
    position: FLSpielerPosition | None
    stufe: FLSpielerStufe | None
    # Whether the pupil answered their own link.
    admissible: bool


class FLTeamOverviewResponse(BaseAPIResponse):
    """A team's Übersicht in one read: who the team is, the work open for it, and its three seats.

    The three lists are open work alone and carry no totals: the dates awaiting the team's answer or the league's
    decision, the coming fixtures the team has entered no line-up for, and the registrations awaiting its decision.
    """

    team_id: CustomObjectId
    saison_id: str
    # The season row's own name and code, and the club's full name, which the page's head and the frame's account row show.
    name: CustomNonEmptyString
    shorthand: CustomNonEmptyString
    full_name: CustomNonEmptyString
    trikot_farbe: FLTrikotFarbe | None
    # The seats the signed-in person holds on this team, in `KONTAKT_ROLLEN` order: never empty, the read refusing
    # anybody holding none.
    rollen: list[FLKontaktRolle]
    spielbestaetigungen: list[FLTeamPanelSpielbestaetigung]
    aufstellungen: list[FLTeamPanelAufstellung]
    registrierungen: list[FLTeamPanelRegistrierung]
    # Whether every pending registration is listed, as `FLOpenRegistrierungenResponse.complete` says of the same read: the
    # box draws the whole list, so a cut one says so there too.
    registrierungen_complete: bool
    # One per person, an empty slot answered with no name: three, or two where the Trainer holds a second seat.
    seats: list[FLTeamSeat]


class FLTeamPanelSpiel(FLTeamPageSpiel):
    """One of the team's matches as its own list shows it: the fixture and its matchday, and the two things that can be open on it."""

    # The state of the date the league asked the team to confirm, null where no row asks the team about the fixture as it stands.
    spielbestaetigung: FLSpielbestaetigungTeamState | None
    # Null for a fixture holding no day or no hour, which owes no line-up.
    aufstellung: FLAufstellungMarks | None


class FLTeamSpieleResponse(BaseAPIResponse):
    """Every fixture of one team in one season, in the order the draw numbered them."""

    team_id: CustomObjectId
    saison_id: str
    spiele: list[FLTeamPanelSpiel]
