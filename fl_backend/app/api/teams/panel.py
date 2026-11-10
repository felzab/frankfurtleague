"""
API · what a team's own pages read: its Übersicht and its matches

Apart from `schemas.py`, which the fixture's models import: these read models are built from a fixture's and a
confirmation's, so they stand above both.
"""

from pydantic import BaseModel

from app.api.aufstellungen.schemas import FLAufstellungMarks
from app.api.saisons.schemas import FLTeamPageSpiel
from app.api.spielbestaetigungen.schemas import FLSpielbestaetigungAppointment, FLSpielbestaetigungTeamState, FLSpielbestaetigungViewAnsetzung
from app.api.teams.schemas import FLTeamSeat
from app.shared.schemas.custom import CustomDateString, CustomNonEmptyString, CustomObjectId
from app.shared.schemas.literals import FLKontaktRolle, FLSpielSide, FLTrikotFarbe
from app.shared.schemas.responses import BaseAPIResponse


class FLTeamPanelTermin(BaseModel):
    """One date the league asked the team to confirm, while it still holds work for the team or waits on the league.

    An agreed date is no row here. A declined one stays, with the team's own proposal, until the league adopts or
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
    # On `vorschlag` the other club's proposed date and hour, never its reason or which of its seats answered; on
    # `declined` the team's own; null otherwise.
    vorschlag: FLSpielbestaetigungAppointment | None
    # The team's own reason on `declined`, null otherwise and where it gave none.
    reason: CustomNonEmptyString | None


class FLTeamPanelAufstellung(BaseModel):
    """One coming fixture of the team holding a day and an hour, with its line-up's marks."""

    spiel_id: CustomObjectId
    ansetzung: FLSpielbestaetigungViewAnsetzung
    side: FLSpielSide
    marks: FLAufstellungMarks


class FLTeamPanelRegistrierung(BaseModel):
    """One pending registration as the Übersicht names it: who waits, since when, and whether the team may admit them yet."""

    registrierung_id: CustomObjectId
    first_name: CustomNonEmptyString
    last_name: CustomNonEmptyString
    submitted_at: CustomDateString
    # Whether the pupil answered their own link (`app/api/registrierungen/schemas.py :: FLOpenRegistrierung.admissible`).
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
    termine: list[FLTeamPanelTermin]
    aufstellungen: list[FLTeamPanelAufstellung]
    registrierungen: list[FLTeamPanelRegistrierung]
    # Always three, an empty slot answered with no name.
    seats: list[FLTeamSeat]


class FLTeamPanelSpiel(FLTeamPageSpiel):
    """One of the team's matches as its own list shows it: the fixture and its matchday, and the two things that can be open on it."""

    # The state of the date the league asked the team to confirm, null where no row asks the team about the fixture as it stands.
    termin: FLSpielbestaetigungTeamState | None
    # Null for a fixture holding no day or no hour, which owes no line-up.
    aufstellung: FLAufstellungMarks | None


class FLTeamSpieleResponse(BaseAPIResponse):
    """Every fixture of one team in one season, in the order the draw numbered them."""

    team_id: CustomObjectId
    saison_id: str
    spiele: list[FLTeamPanelSpiel]
