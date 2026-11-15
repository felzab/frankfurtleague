"""What a team's own pages read, its Übersicht and its matches, and what the team editor reads.

Apart from `schemas.py`, which the fixture's models import: these read models are built from a fixture's and a
confirmation's, so they stand above both.
"""

from pydantic import BaseModel, Field

from app.api.aufstellungen.schemas import FLAufstellungMarks
from app.api.invitations.schemas import FLTeamLinkState
from app.api.saisons.schemas import FLTeamPageSpiel
from app.api.spielbestaetigungen.schemas import FLSpielbestaetigungAppointment, FLSpielbestaetigungTeamState, FLSpielbestaetigungViewAnsetzung
from app.api.spiele.schemas import FLSpielRecipient
from app.api.teams.schemas import FLTeamGruppeOffer, FLTeamMembership, FLTeamRecord, FLTeamSaisonFacts, FLTeamSeat
from app.shared.schemas.custom import CustomDateString, CustomNonEmptyString, CustomObjectId, CustomOptionalDateString
from app.shared.schemas.literals import FLKontaktRolle, FLSpielerPosition, FLSpielerStufe, FLSpielSide, FLTrikotFarbe
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel


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
    # Null for a fixture holding no day or no hour, or one decided, called off or fielding a club out by its day, each
    # owing no line-up.
    aufstellung: FLAufstellungMarks | None


class FLTeamSpieleResponse(BaseAPIResponse):
    """Every fixture of one team in one season, in the order the draw numbered them."""

    team_id: CustomObjectId
    saison_id: str
    spiele: list[FLTeamPanelSpiel]


class FLAustrittRecipients(BaseReadModel):
    """Whom an exit of the club mails, by the day it reaches them from: an exit dated on or before `date` mails them."""

    # Null where an exit of any day reaches them, as it reaches an undated fixture.
    date: CustomOptionalDateString
    # Each by the name its own record holds: an opponent through a confirmed seat, and a referee the pass tells.
    recipients: list[FLSpielRecipient]


class FLTeamSaisonAdminResponse(BaseAPIResponse):
    """What the team editor shows in one read: the club, its row of the season, and what each of its acts would meet."""

    # The one count this page saves on (`composite_version`).
    version: int = Field(ge=0)
    team: FLTeamRecord
    saison: FLTeamSaisonFacts
    # Null for a club holding no row of the season, a retired one reached through the list's filter.
    membership: FLTeamMembership | None
    gruppen: list[FLTeamGruppeOffer]
    # Whether the group's write would refuse `entry_gruppe_locked`, the club's fixtures being drawn.
    gruppe_locked: bool
    # The colours another row of the season holds, which `trikot_farbe_taken` refuses; this club's own stays open to it.
    taken_trikot_farben: list[FLTrikotFarbe]
    # The newest running or planned season the club stands in, which `retire_blocked` refuses over.
    retire_blocked_by: str | None
    # Null with `membership`.
    link: FLTeamLinkState | None
    # Whom an exit would mail, as its write and the next pass would; empty for a club holding no row of the season, and
    # once it has left, an exit being recorded once.
    austritt_recipients: list[FLAustrittRecipients]
