from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints, model_validator

from app.api.postausgang.schemas import FLPostausgangLage
from app.api.spiele.schemas import FLSpielOrtFieldPublic
from app.shared.schemas.aktor import FLVonAdmin
from app.shared.schemas.bestaetigung import CustomToken
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH
from app.shared.schemas.custom import (
    SINGLE_LINE_PATTERN,
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomOptionalDateString,
    CustomTimeString,
    parse_empty_string_to_none,
)
from app.shared.schemas.literals import FLKontaktRolle, FLSpielSeite
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel

type FLSpielbestaetigungAntwortArt = Literal["zugesagt", "abgelehnt"]

# Why a row stopped applying. `verworfen` closes an open decline carrying a proposal alone: the decline stands
# as the record, and what is discarded is the administrator's obligation to act on its proposal.
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

# What a reopened link shows; `gesperrt` ranks first. `vorschlag`: the other
# club's decline proposes another date; `abgesagt`: the fixture was called off, whatever was answered;
# `verworfen`: the league discarded this decline's proposal.
FLSpielbestaetigungZustand = Literal[
    "gueltig", "vorschlag", "zugesagt", "abgelehnt", "verworfen", "abgelaufen", "ungueltig", "abgesagt", "gesperrt"
]

# Single-line because the triage card renders it as one, and a stored break would forge a second line
# beside it. The ceiling and the pattern judge what arrives and the floor what the strip leaves, so
# spaces alone are no reason and the published `maxLength` is the one the write keeps.
CustomSpielbestaetigungBegruendung = Annotated[
    str,
    StringConstraints(max_length=SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH, pattern=SINGLE_LINE_PATTERN),
    AfterValidator(str.strip),
    StringConstraints(min_length=1),
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


class FLSpielbestaetigungSitz(BaseReadModel):
    """One seat's link as an administrator reads it -- and NO `token_hashes`, nor the address it was owed to.

    The hashes are raw document keys the token filter alone reads; a model declaring them would serve
    every live link's hash through the admin read.
    """

    # What became of the last mail owed to the seat, read off the Postausgang; null where none was, or on a write's answer.
    zustellung: FLPostausgangLage | None = None


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


class FLSpielbestaetigungVonSchiedsrichter(BaseModel):
    art: Literal["schiedsrichter"]


# A `type` statement, so the document publishes who answered as one component the three answers reference.
type FLSpielbestaetigungVon = Annotated[
    FLSpielbestaetigungVonKontakt | FLVonAdmin | FLSpielbestaetigungVonSchiedsrichter,
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


class _FLSpielbestaetigungFelder(BaseModel):
    """Every field a confirmation row stores and an administrator reads alike: all but its seats."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    saison_id: str
    spiel_id: CustomObjectId
    partei: FLSpielbestaetigungPartei
    ansetzung: FLSpielbestaetigungAnsetzung
    # STORED rather than derived from the fixture's date: raising the bound moves no request already sent.
    frist: CustomDateString
    # Null from the mint until it owes the party a mail, so a row nobody could be asked on reads as never asked.
    angefragt_am: CustomOptionalDateString
    erinnert_am: list[CustomDateString]
    antwort: FLSpielbestaetigungAntwort | None
    geschlossen: FLSpielbestaetigungGeschlossen | None


class FLSpielbestaetigung(_FLSpielbestaetigungFelder):
    """One party's confirmation of one Ansetzung, as an administrator reads it.

    The close reaches an answered row too, so an agreement a move overtook records why it stopped
    applying (`app/api/spielbestaetigungen/services.py :: build_closable_filter`).
    """

    # Null on a referee row, whose referee answers signed in rather than by a link.
    kontakte: FLSpielbestaetigungKontakte | None


class FLSpielbestaetigungSitzRecord(BaseModel):
    """One seat as `spielbestaetigungen` stores it: every link the seat was mailed, by its hash, and the address they went to."""

    token_hashes: list[str]
    email: str


class FLSpielbestaetigungKontakteRecord(BaseModel):
    trainer: FLSpielbestaetigungSitzRecord | None
    ansprechperson: FLSpielbestaetigungSitzRecord | None
    stellvertretung: FLSpielbestaetigungSitzRecord | None


class FLSpielbestaetigungVonKontaktRecord(FLSpielbestaetigungVonKontakt):
    """The pressed seat as stored: the digest of its holder's address, kept for that person's erasure."""

    halter: str | None = None


class FLSpielbestaetigungAntwortRecord(FLSpielbestaetigungAntwort):
    von: Annotated[
        FLSpielbestaetigungVonKontaktRecord | FLVonAdmin | FLSpielbestaetigungVonSchiedsrichter,
        Field(discriminator="art"),
    ]


class FLSpielbestaetigungRecord(_FLSpielbestaetigungFelder):
    """One confirmation as `spielbestaetigungen` stores it, with the keys no read serves."""

    kontakte: FLSpielbestaetigungKontakteRecord | None
    antwort: FLSpielbestaetigungAntwortRecord | None


# --- The ADMINISTRATOR: the season's rows read, a row settled on its party's behalf, a proposal discarded.


class FLSpielbestaetigungenFilterParams(BaseModel):
    """A season's rows, or one fixture's among them. The season is required: rows of every season would answer for fixtures no list shows."""

    saison_id: str
    spiel_id: CustomObjectId | None = None
    limit: int = Field(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX)


class FLSpielbestaetigungenListResponse(BaseAPIResponse):
    """The rows newest first, closed ones included."""

    spielbestaetigungen: list[FLSpielbestaetigung]
    # False where the cut left out rows not holding their question, so a cut list is never read as the season whole.
    vollstaendig: bool


class FLSpielbestaetigungEintragenPayload(BaseModel):
    """The administrator's Zusage for a party that answered elsewhere, and how it was given.

    No way to choose: the one press records a Zusage, and a decline without a proposal would sit in no queue.
    """

    model_config = ConfigDict(extra="forbid")

    # Required: the row is the league's record of how a date was agreed, and the reason is the part no field holds.
    begruendung: CustomSpielbestaetigungBegruendung


class FLSpielbestaetigungWriteResponse(BaseAPIResponse):
    """Shared by the administrator's two presses, both answering the row as it now stands."""

    updated_document: FLSpielbestaetigung


# --- The LINK. The token is the whole credential, so both endpoints are base-tier and every payload
# forbids an undeclared key. Nothing below names a person, a seat's address or a hash
# (`READ-ANSETZUNG-001`).


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
    seite: FLSpielSeite
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

    token: CustomToken
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
FLSpielbestaetigungSchiedsrichterZustand = Literal["gueltig", "zugesagt", "abgelehnt", "abgelaufen", "ungueltig", "abgesagt"]


class FLSpielbestaetigungSelf(BaseModel):
    """One of the signed-in referee's rows, as their panel lists it."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    spiel_id: CustomObjectId
    # Which of the address's referee records the row names.
    schiedsrichter_id: CustomObjectId
    ansetzung: FLSpielbestaetigungAnsichtAnsetzung
    zustand: FLSpielbestaetigungSchiedsrichterZustand
    # The referee's own decline reason, null on every other row.
    begruendung: CustomNonEmptyString | None
    # Whether the league recorded the answer for them, so the panel never shows it as their own; it names nobody.
    eingetragen: bool
    # Whether the Ansetzung's day lies before today in Europe/Berlin, which the panel lists apart: judged here, so a
    # page rendered around midnight agrees with the order the read answered.
    vergangen: bool


class FLSpielbestaetigungenSelfResponse(BaseAPIResponse):
    spielbestaetigungen: list[FLSpielbestaetigungSelf]


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


# --- The PASS, system tier. It owes every mail through the Postausgang, and answers counts alone: no address, no
# link and no name (`READ-ANSETZUNG-002`).


class FLSpielbestaetigungSweepSaisonsResponse(BaseAPIResponse):
    """The `active` seasons a pass visits, oldest first."""

    saison_ids: list[str]


class FLSpielbestaetigungSweepResponse(BaseAPIResponse):
    """One season's pass, counted: what it closed, the rows it asked or reminded, and the mails it owed the Postausgang."""

    saison_id: str
    geschlossen: int
    angefragt: int
    erinnert: int
    # Every mail this pass owed, requests, reminders, Einteilungen and notices alike, one per recipient.
    mails: int
    fehlgeschlagen: int
