from typing import Annotated, Final, Literal, Self

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints, model_validator

from app.api.spiele.schemas import FLSpielOrtFieldPublic
from app.api.teams.schemas import FLKontaktRolle
from app.shared.schemas.bounds import BEWERBUNG_TOKEN_MAX_LENGTH, SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH
from app.shared.schemas.custom import (
    SINGLE_LINE_PATTERN,
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomOptionalDateString,
    CustomTimeString,
    parse_empty_string_to_none,
)
from app.shared.schemas.responses import BaseAPIResponse

# One delivery shape at every home `app/api/zustellung/services.py :: ZIEL_PFADE` names, as the
# referee's carrier declares it.
from app.shared.schemas.zustellung import FLBewerbungZustellung

FLSpielbestaetigungAntwortArt = Literal["zugesagt", "abgelehnt"]

# Why a row stopped applying. `verworfen` closes an answered row alone: the decline stands as the
# record, and what is discarded is the administrator's obligation to act on its proposal.
FLSpielbestaetigungGrund = Literal[
    "ansetzung_geaendert",
    "austritt",
    "spiel_entschieden",
    "abgesagt",
    "schiedsrichter_gewechselt",
    # A referee's own decline, closed in its write: the row reads as that decline, and a re-booking is asked afresh.
    "schiedsrichter_abgelehnt",
    "verworfen",
    "spiel_vergangen",
]

# What a reopened link shows; `gesperrt` ranks first (`docs/backend/spec.md :: I515`). `vorschlag` is a
# link still answerable while the other club's decline proposes another date for the same Ansetzung.
FLSpielbestaetigungZustand = Literal["gueltig", "vorschlag", "zugesagt", "abgelehnt", "abgelaufen", "ungueltig", "gesperrt"]

FLSpielbestaetigungSeite = Literal["team1", "team2"]

# `BEWERBUNG_TOKEN_MAX_LENGTH` and not a bound of its own: one `mint_token` spells every link.
CustomSpielbestaetigungToken = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=BEWERBUNG_TOKEN_MAX_LENGTH)]

# Single-line because the triage card renders it as one, and a stored break would forge a second line
# beside it. Stripped before the floor counts, so spaces alone are no reason.
CustomSpielbestaetigungBegruendung = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH, pattern=SINGLE_LINE_PATTERN),
]


class FLSpielbestaetigungParteiTeam(BaseModel):
    art: Literal["team"]
    team_id: CustomObjectId


class FLSpielbestaetigungParteiSchiedsrichter(BaseModel):
    art: Literal["schiedsrichter"]
    schiedsrichter_id: CustomObjectId


FLSpielbestaetigungPartei = Annotated[FLSpielbestaetigungParteiTeam | FLSpielbestaetigungParteiSchiedsrichter, Field(discriminator="art")]


class FLSpielbestaetigungAnsetzung(BaseModel):
    """The Ansetzung a row answers about: every input of `stand`, stored beside it.

    A digest is opaque to an aggregation, so the public fixture's verdict compares these five values
    rather than `stand` (`app/api/spielbestaetigungen/services.py :: ANSETZUNG_QUELLEN`).
    """

    datum: CustomDateString
    uhrzeit: CustomTimeString
    spielort_id: CustomObjectId | None
    team1_id: CustomObjectId
    team2_id: CustomObjectId
    stand: str


class FLSpielbestaetigungSitz(BaseModel):
    """One seat's link bookkeeping as an administrator reads it -- and NO `token_hashes`.

    The hashes are raw document keys the token filter alone reads; a model declaring them would serve
    every live link's hash through the admin read.
    """

    # Null until a delivery report names the message this seat's link went out in.
    zustellung: FLBewerbungZustellung | None = None


class FLSpielbestaetigungKontakte(BaseModel):
    """The three seats, mirroring `kontakte`'s slots. Null per SEAT: an empty, barred or voided seat holds no link."""

    trainer: FLSpielbestaetigungSitz | None
    ansprechperson: FLSpielbestaetigungSitz | None
    stellvertretung: FLSpielbestaetigungSitz | None


class FLSpielbestaetigungTermin(BaseModel):
    """A date and time without a ground: a team's proposal, and the slot a moved fixture left."""

    datum: CustomDateString
    uhrzeit: CustomTimeString


class FLSpielbestaetigungVonKontakt(BaseModel):
    """The seat whose link was pressed, never the person: two seats one person holds share a link, and the first seat in order is recorded."""

    art: Literal["kontakt"]
    rolle: FLKontaktRolle


class FLSpielbestaetigungVonAdmin(BaseModel):
    """An administrator's settlement, naming nobody: the row is the league's record of how a date was agreed, not of who typed it."""

    art: Literal["admin"]


class FLSpielbestaetigungVonSchiedsrichter(BaseModel):
    art: Literal["schiedsrichter"]


FLSpielbestaetigungVon = Annotated[
    FLSpielbestaetigungVonKontakt | FLSpielbestaetigungVonAdmin | FLSpielbestaetigungVonSchiedsrichter,
    Field(discriminator="art"),
]


class FLSpielbestaetigungAntwort(BaseModel):
    """Written once, while the row is open: a second press finds the row answered and changes nothing."""

    art: FLSpielbestaetigungAntwortArt
    am: CustomDateString
    von: FLSpielbestaetigungVon
    vorschlag: FLSpielbestaetigungTermin | None
    # Its length and its one line are the payload's: the read keeps a ban reason's floor alone, as
    # `app/api/sperrliste/schemas.py`'s row does.
    begruendung: CustomNonEmptyString | None


class FLSpielbestaetigungGeschlossen(BaseModel):
    am: CustomDateString
    grund: FLSpielbestaetigungGrund


class FLSpielbestaetigung(BaseModel):
    """One party's confirmation of one Ansetzung, as stored and as an administrator reads it.

    The close reaches an answered row too, so an agreement a move overtook records why it stopped
    applying (`app/api/spielbestaetigungen/services.py :: build_closable_filter`).
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    saison_id: str
    spiel_id: CustomObjectId
    partei: FLSpielbestaetigungPartei
    ansetzung: FLSpielbestaetigungAnsetzung
    # STORED rather than derived from the fixture's date: raising the bound moves no request already sent.
    frist: CustomDateString
    # Null from the mint until the mail went out, so a bounce never reads as a silence.
    angefragt_am: CustomOptionalDateString
    erinnert_am: list[CustomDateString]
    # Null on a referee row, whose referee answers signed in rather than by a link.
    kontakte: FLSpielbestaetigungKontakte | None
    antwort: FLSpielbestaetigungAntwort | None
    geschlossen: FLSpielbestaetigungGeschlossen | None


# --- The LINK. The token is the whole credential, so both endpoints are base-tier and every payload
# forbids an undeclared key. Nothing below names a person, a seat's address or a hash
# (`READ-ANSETZUNG-001`).


class FLSpielbestaetigungAnsichtPayload(BaseModel):
    """A POST that reads: the token travels in a body, never in a second URL."""

    model_config = ConfigDict(extra="forbid")

    token: CustomSpielbestaetigungToken


class FLSpielbestaetigungAnsichtAnsetzung(BaseModel):
    """The clubs, the day, the hour and the ground a page or a message states.

    The fixture as it stands, or on a link whose fixture moved since, the Ansetzung the row asked about.
    """

    team1_name: str
    team2_name: str
    datum: CustomDateString
    uhrzeit: CustomTimeString
    spielort: FLSpielOrtFieldPublic | None


class FLSpielbestaetigungAnsichtResponse(BaseAPIResponse):
    """What one link's page renders, filled in every state; the frontend narrows a spent one to its `zustand`."""

    zustand: FLSpielbestaetigungZustand
    seite: FLSpielbestaetigungSeite
    ansetzung: FLSpielbestaetigungAnsichtAnsetzung
    frist: CustomDateString
    # The OTHER club's proposal, on `vorschlag` alone and null otherwise: its date and hour alone, never
    # that club's reason or which of its seats answered.
    vorschlag: FLSpielbestaetigungTermin | None
    # Non-null exactly on `zugesagt` and `abgelehnt`: a role, never a name.
    beantwortet_von: FLSpielbestaetigungVon | None


class FLSpielbestaetigungVorschlagPayload(FLSpielbestaetigungTermin):
    model_config = ConfigDict(extra="forbid")


class FLSpielbestaetigungAntwortPayload(BaseModel):
    """One club's answer about one Ansetzung, from whichever of its seats pressed first."""

    model_config = ConfigDict(extra="forbid")

    token: CustomSpielbestaetigungToken
    antwort: FLSpielbestaetigungAntwortArt
    # Both required as KEYS and null where unused: an omitted key would read as a client that forgot it.
    vorschlag: FLSpielbestaetigungVorschlagPayload | None
    begruendung: Annotated[CustomSpielbestaetigungBegruendung | None, BeforeValidator(parse_empty_string_to_none)]

    @model_validator(mode="after")
    def a_decline_proposes_and_an_acceptance_says_nothing_more(self) -> Self:
        """A 422 like every shape rule about the body: the page offers no decline without a date, and no reason beside an acceptance."""

        if self.antwort == "abgelehnt" and self.vorschlag is None:
            raise ValueError("Wer absagt, schlägt einen anderen Termin vor.")

        if self.antwort == "zugesagt" and (self.vorschlag is not None or self.begruendung is not None):
            raise ValueError("Eine Zusage trägt keinen Terminvorschlag und keine Begründung.")

        return self


class FLSpielbestaetigungAntwortResponse(BaseAPIResponse):
    """What the answer recorded: its way, its role, and the answering club's own proposal, which no view of the link serves.

    So a page shows that proposal from this response, never from a re-read. No receipt is mailed off it.
    """

    zustand: FLSpielbestaetigungAntwortArt
    beantwortet_von: FLSpielbestaetigungVon
    vorschlag: FLSpielbestaetigungTermin | None


# --- A REFEREE'S OWN ROWS, read and answered signed in on the person lane. No deadline is served: a
# referee answers until the fixture's day, which the Einteilung states.

# Never `gesperrt`, the binder refusing a barred person first, nor `vorschlag`, a referee proposing no date.
FLSpielbestaetigungSchiedsrichterZustand = Literal["gueltig", "zugesagt", "abgelehnt", "abgelaufen", "ungueltig"]


class FLSpielbestaetigungSelbst(BaseModel):
    """One of the signed-in referee's rows, as their panel lists it."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    spiel_id: CustomObjectId
    # Which of the address's referee records the row names.
    schiedsrichter_id: CustomObjectId
    ansetzung: FLSpielbestaetigungAnsichtAnsetzung
    zustand: FLSpielbestaetigungSchiedsrichterZustand
    # The referee's own decline reason, null on every other row.
    begruendung: CustomNonEmptyString | None


class FLSpielbestaetigungenSelbstResponse(BaseAPIResponse):
    spielbestaetigungen: list[FLSpielbestaetigungSelbst]


class FLSpielbestaetigungSchiedsrichterAntwortPayload(BaseModel):
    """A referee's answer about one row naming them: a decline gives a reason, which the administrator reads."""

    model_config = ConfigDict(extra="forbid")

    antwort: FLSpielbestaetigungAntwortArt
    # Required as a KEY and null where unused, as the club's answer spells it.
    begruendung: Annotated[CustomSpielbestaetigungBegruendung | None, BeforeValidator(parse_empty_string_to_none)]

    @model_validator(mode="after")
    def a_decline_gives_a_reason_and_an_acceptance_none(self) -> Self:
        """A 422 like every shape rule about the body: the panel offers no decline without a reason."""

        if self.antwort == "abgelehnt" and self.begruendung is None:
            raise ValueError("Wer absagt, nennt einen Grund.")

        if self.antwort == "zugesagt" and self.begruendung is not None:
            raise ValueError("Eine Zusage trägt keine Begründung.")

        return self


class FLSpielbestaetigungSchiedsrichterAntwortResponse(BaseAPIResponse):
    spielbestaetigung_id: CustomObjectId
    zustand: FLSpielbestaetigungAntwortArt


# --- The PASS, system tier. The backend decides and mints, the frontend mails: what leaves here is
# what a message needs and no name (`READ-ANSETZUNG-002`).


class FLSpielbestaetigungSweepSaisonsResponse(BaseAPIResponse):
    """The `active` seasons a pass visits, and the day a pass last ran over any of them."""

    saison_ids: list[str]
    # The newest stamp among them, as `GET /bewerbungen/sweep` answers its own: a season activated since
    # the last pass carries none. Null means no pass ever ran over these seasons.
    spiel_sweep_gelaufen_am: CustomDateString | None


class FLSpielbestaetigungSweepLink(BaseModel):
    """One LINK and its mailbox; the RAW token exists here and in the mail alone.

    Per link: one person on two seats gets one button naming both roles, two people on one inbox two.
    """

    address: str
    rollen: list[FLKontaktRolle]
    token: str


class FLSpielbestaetigungSweepAnfrage(BaseModel):
    """One team row's request or reminder: the fixture, the stored deadline, and every link due a message."""

    spielbestaetigung_id: CustomObjectId
    spiel_id: CustomObjectId
    seite: FLSpielbestaetigungSeite
    ansetzung: FLSpielbestaetigungAnsichtAnsetzung
    frist: CustomDateString
    links: list[FLSpielbestaetigungSweepLink]


class FLSpielbestaetigungSweepEinteilung(BaseModel):
    """A referee row just minted, or one no stamp records as told: the referee is told to the panel, with no token."""

    spielbestaetigung_id: CustomObjectId
    spiel_id: CustomObjectId
    ansetzung: FLSpielbestaetigungAnsichtAnsetzung
    address: str


class FLSpielbestaetigungSweepEmpfaenger(BaseModel):
    """A mailbox told something without a link."""

    address: str
    rollen: list[FLKontaktRolle]


class FLSpielbestaetigungSweepNeueAnsetzung(BaseModel):
    """A team row a move closed, so a link in its mailboxes is known void before the fresh request arrives."""

    spielbestaetigung_id: CustomObjectId
    spiel_id: CustomObjectId
    team1_name: str
    team2_name: str
    # The slot the row was about. The fixture's new one may be undated, so it is not stated here.
    alt: FLSpielbestaetigungTermin
    empfaenger: list[FLSpielbestaetigungSweepEmpfaenger]


class FLSpielbestaetigungSweepSchiedsrichterNeueAnsetzung(BaseModel):
    """The same for a referee row: one address, no seat, the delivery lane recording no seat."""

    spielbestaetigung_id: CustomObjectId
    spiel_id: CustomObjectId
    team1_name: str
    team2_name: str
    alt: FLSpielbestaetigungTermin
    address: str


class FLSpielbestaetigungSweepSchiedsrichterGewechselt(BaseModel):
    """A referee row closed because its referee was taken off the fixture after their Einteilung went out: the slot they were told of."""

    spielbestaetigung_id: CustomObjectId
    spiel_id: CustomObjectId
    team1_name: str
    team2_name: str
    alt: FLSpielbestaetigungTermin
    address: str


class FLSpielbestaetigungSweepResponse(BaseAPIResponse):
    """One season's pass: the requests still to stamp, the reminders already stamped, and the void notices."""

    saison_id: str
    # Unstamped until `/angefragt` names them, so a send that failed leaves a row visibly never asked.
    anfragen: list[FLSpielbestaetigungSweepAnfrage]
    # Stamped before this answers, so a failed send costs one reminder rather than a daily repeat.
    erinnerungen: list[FLSpielbestaetigungSweepAnfrage]
    einteilungen: list[FLSpielbestaetigungSweepEinteilung]
    neue_ansetzungen: list[FLSpielbestaetigungSweepNeueAnsetzung]
    schiedsrichter_neue_ansetzungen: list[FLSpielbestaetigungSweepSchiedsrichterNeueAnsetzung]
    schiedsrichter_gewechselt: list[FLSpielbestaetigungSweepSchiedsrichterGewechselt]
    geschlossen: int
    fehlgeschlagen: int


# Three commands a row beside the call's other 3
# (`tests/api/test_spielbestaetigung_sweep_refusal.py :: test_a_full_share_finishes_inside_the_deadline_at_the_round_trip_its_comment_names`):
# 252 commands at a 38 ms round trip plus 1.32 ms take 9.91 s of `app/core/middlewares.py :: REQUEST_DEADLINE_S`.
ANFRAGEN_LISTED_PER_PASS: Final = 83


class FLSpielbestaetigungSweepAngefragtPayload(BaseModel):
    """Which rows' first messages went. Stamped whether or not answered or closed since: the stamp records the send."""

    model_config = ConfigDict(extra="forbid")

    spielbestaetigung_ids: list[CustomObjectId] = Field(max_length=ANFRAGEN_LISTED_PER_PASS)


class FLSpielbestaetigungSweepAngefragtResponse(BaseAPIResponse):
    saison_id: str
    angefragt: int
    fehlgeschlagen: int
