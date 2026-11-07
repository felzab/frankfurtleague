from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints, ValidationInfo, field_validator

from app.api.outbox.schemas import FLOutboxStatus
from app.api.spiele.schemas import FLSpielbestaetigungParty, FLSpielortFieldPublic
from app.core.crud import Anchored
from app.core.exceptions import rule_refusal
from app.shared.schemas.actor import FLByAdmin
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, SPIELBESTAETIGUNG_REASON_MAX_LENGTH
from app.shared.schemas.confirmation import CustomToken
from app.shared.schemas.custom import (
    PARAGRAPH_PATTERN,
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomOptionalDateString,
    CustomTimeString,
    parse_empty_string_to_none,
)
from app.shared.schemas.literals import FLKontaktRolle, FLSpielSide
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel

type FLSpielbestaetigungAnswerKind = Literal["zugesagt", "declined"]

# Why a row stopped applying. `discarded` closes an open decline carrying a proposal alone: the decline stands
# as the record, and what is discarded is the administrator's obligation to act on its proposal.
FLSpielbestaetigungClosedReason = Literal[
    "ansetzung_changed",
    "austritt",
    "spiel_decided",
    "cancelled",
    "schiedsrichter_switched",
    # A referee's own decline, closed in its write: the row reads as that decline, and a re-booking is asked afresh.
    "schiedsrichter_declined",
    "discarded",
    "spiel_past",
]

# What a reopened link shows; `barred` ranks first. `vorschlag`: the other
# club's decline proposes another date; `cancelled`: the fixture was called off, whatever was answered;
# `discarded`: the league discarded this decline's proposal.
FLSpielbestaetigungState = Literal["valid", "vorschlag", "zugesagt", "declined", "discarded", "expired", "invalid", "cancelled", "barred"]

# A paragraph, its line breaks kept, since it is written in a text area and every place showing it keeps them. The
# ceiling and the pattern judge what arrives and the floor what the strip leaves, so spaces alone are no reason and the
# published `maxLength` is the one the write keeps.
CustomSpielbestaetigungReason = Annotated[
    str,
    StringConstraints(max_length=SPIELBESTAETIGUNG_REASON_MAX_LENGTH, pattern=PARAGRAPH_PATTERN),
    AfterValidator(str.strip),
    StringConstraints(min_length=1),
]


class FLSpielbestaetigungAnsetzung(BaseModel):
    """The Ansetzung a row answers about: every input of `stand`, stored beside it.

    A digest is opaque to an aggregation, so the public fixture's verdict compares these five values
    rather than `stand` (`app/api/spielbestaetigungen/services.py :: ANSETZUNG_QUELLEN`).
    """

    date: CustomDateString
    time: CustomTimeString
    spielort_id: CustomObjectId | None
    team1_id: CustomObjectId
    team2_id: CustomObjectId
    stand: str


class FLSpielbestaetigungSeat(BaseReadModel):
    """One seat's link as an administrator reads it -- and NO `token_hashes`, nor the address it was owed to.

    The hashes are raw document keys the token filter alone reads; a model declaring them would serve
    every live link's hash through the admin read.
    """

    # What became of the last mail owed to the seat, read off the Postausgang; null where none was, or on a write's answer.
    delivery: FLOutboxStatus | None = None


class FLSpielbestaetigungKontakte(BaseModel):
    """The three seats, mirroring `kontakte`'s slots. Null per SEAT: an empty, barred or voided seat holds no link."""

    trainer: FLSpielbestaetigungSeat | None
    ansprechperson: FLSpielbestaetigungSeat | None
    stellvertretung: FLSpielbestaetigungSeat | None


class FLSpielbestaetigungAppointment(BaseModel):
    """A date and time without a ground: a team's proposal, and the slot a moved fixture left."""

    date: CustomDateString
    time: CustomTimeString


class FLSpielbestaetigungByKontakt(BaseModel):
    """The seat whose link was pressed, never the person: two seats one person holds share a link, and the first seat in order is recorded."""

    kind: Literal["kontakt"]
    rolle: FLKontaktRolle


class FLSpielbestaetigungBySchiedsrichter(BaseModel):
    kind: Literal["schiedsrichter"]


# A `type` statement, so the document publishes who answered as one component the three answers reference.
type FLSpielbestaetigungBy = Annotated[
    FLSpielbestaetigungByKontakt | FLByAdmin | FLSpielbestaetigungBySchiedsrichter,
    Field(discriminator="kind"),
]


class FLSpielbestaetigungAnswer(BaseModel):
    """Written once, while the row is open: a second press finds the row answered and changes nothing."""

    kind: FLSpielbestaetigungAnswerKind
    at: CustomDateString
    by: FLSpielbestaetigungBy
    vorschlag: FLSpielbestaetigungAppointment | None
    # Its length and its one line are the payload's: the read keeps a ban reason's floor alone, as
    # `app/api/ban_list/schemas.py`'s row does.
    reason: CustomNonEmptyString | None


class FLSpielbestaetigungClosed(BaseModel):
    at: CustomDateString
    reason: FLSpielbestaetigungClosedReason


class _FLSpielbestaetigungFields(BaseModel):
    """Every field a confirmation row stores and an administrator reads alike: all but its seats."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    saison_id: str
    spiel_id: CustomObjectId
    party: FLSpielbestaetigungParty
    ansetzung: FLSpielbestaetigungAnsetzung
    # STORED rather than derived from the fixture's date: raising the bound moves no request already sent.
    deadline: CustomDateString
    # Null from the mint until it owes the party a mail, so a row nobody could be asked on reads as never asked.
    asked_at: CustomOptionalDateString
    # The day the one reminder went, null until it does.
    reminded_at: CustomOptionalDateString
    answer: FLSpielbestaetigungAnswer | None
    closed: FLSpielbestaetigungClosed | None


class FLSpielbestaetigung(_FLSpielbestaetigungFields):
    """One party's confirmation of one Ansetzung, as an administrator reads it.

    The close reaches an answered row too, so an agreement a move overtook records why it stopped
    applying (`app/api/spielbestaetigungen/services.py :: build_closable_filter`).
    """

    # Null on a referee row, whose referee answers signed in rather than by a link.
    kontakte: FLSpielbestaetigungKontakte | None


class FLSpielbestaetigungSeatRecord(BaseModel):
    """One seat as `spielbestaetigungen` stores it: every link the seat was mailed, by its hash, and the address they went to."""

    token_hashes: list[str]
    email: str


class FLSpielbestaetigungKontakteRecord(BaseModel):
    trainer: FLSpielbestaetigungSeatRecord | None
    ansprechperson: FLSpielbestaetigungSeatRecord | None
    stellvertretung: FLSpielbestaetigungSeatRecord | None


class FLSpielbestaetigungRecord(_FLSpielbestaetigungFields, Anchored):
    """One confirmation as `spielbestaetigungen` stores it, with the keys no read serves."""

    kontakte: FLSpielbestaetigungKontakteRecord | None


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
    complete: bool


class FLSpielbestaetigungEnterPayload(BaseModel):
    """The administrator's Zusage for a party that answered elsewhere, and how it was given.

    No way to choose: the one press records a Zusage, and a decline without a proposal would sit in no queue.
    """

    model_config = ConfigDict(extra="forbid")

    # Required: the row is the league's record of how a date was agreed, and the reason is the part no field holds.
    reason: CustomSpielbestaetigungReason


# --- The LINK. The token is the whole credential, so both endpoints are base-tier and every payload
# forbids an undeclared key. Nothing below names a person, a seat's address or a hash
# (`READ-ANSETZUNG-001`).


class FLSpielbestaetigungViewAnsetzung(BaseModel):
    """The clubs, the day, the hour and the ground a page or a message states.

    The fixture as it stands, or on a link whose fixture moved since, the Ansetzung the row asked about.
    """

    team1_name: str
    team2_name: str
    date: CustomDateString
    time: CustomTimeString
    spielort: FLSpielortFieldPublic | None


class FLSpielbestaetigungViewResponse(BaseAPIResponse):
    """What one link's page renders, filled in every state; the frontend narrows a spent one to its `state`."""

    state: FLSpielbestaetigungState
    side: FLSpielSide
    ansetzung: FLSpielbestaetigungViewAnsetzung
    deadline: CustomDateString
    # The OTHER club's proposal, on `vorschlag` alone and null otherwise: its date and hour alone, never
    # that club's reason or which of its seats answered.
    vorschlag: FLSpielbestaetigungAppointment | None
    # Non-null exactly on `zugesagt` and `declined`: a role, never a name.
    answered_by: FLSpielbestaetigungBy | None


class FLSpielbestaetigungVorschlagPayload(FLSpielbestaetigungAppointment):
    model_config = ConfigDict(extra="forbid")


def _an_acceptance_gives_no_reason(reason: str | None, info: ValidationInfo) -> str | None:
    """`acceptance_with_reason` on the reason's box, which a club's and a referee's answer both carry."""

    if info.data.get("answer") == "zugesagt" and reason is not None:
        raise rule_refusal("acceptance_with_reason", "an acceptance carries no reason")

    return reason


class FLSpielbestaetigungAnswerPayload(BaseModel):
    """One club's answer about one Ansetzung, from whichever of its seats pressed first."""

    model_config = ConfigDict(extra="forbid")

    token: CustomToken
    answer: FLSpielbestaetigungAnswerKind
    # Both required as KEYS and null where unused: an omitted key would read as a client that forgot it.
    vorschlag: FLSpielbestaetigungVorschlagPayload | None
    reason: Annotated[CustomSpielbestaetigungReason | None, BeforeValidator(parse_empty_string_to_none)]

    # Field validators, each on the box its rule names, reading `answer` off `info.data`: a model validator's refusal
    # sits at the body, a path no box answers. `answer` is declared first, so it is validated first; where it failed
    # it is absent, and its own refusal is the one answered. A 422 like every shape rule about the body: the page offers
    # no decline without a date, and no proposal or reason beside an acceptance.
    @field_validator("vorschlag")
    @classmethod
    def a_decline_proposes_and_an_acceptance_does_not(
        cls, vorschlag: FLSpielbestaetigungVorschlagPayload | None, info: ValidationInfo
    ) -> FLSpielbestaetigungVorschlagPayload | None:
        answer = info.data.get("answer")
        if answer == "declined" and vorschlag is None:
            raise rule_refusal("decline_without_proposal", "a decline proposes another date")
        if answer == "zugesagt" and vorschlag is not None:
            raise rule_refusal("acceptance_with_proposal", "an acceptance carries no proposal")

        return vorschlag

    @field_validator("reason")
    @classmethod
    def an_acceptance_gives_no_reason(cls, reason: str | None, info: ValidationInfo) -> str | None:
        return _an_acceptance_gives_no_reason(reason, info)


class FLSpielbestaetigungAnswerResponse(BaseAPIResponse):
    """What the answer recorded: its way, its role, and the answering club's own proposal, which no view of the link serves.

    So a page shows that proposal from this response, never from a re-read. No receipt is mailed off it.
    """

    state: FLSpielbestaetigungAnswerKind
    answered_by: FLSpielbestaetigungBy
    vorschlag: FLSpielbestaetigungAppointment | None


# --- A REFEREE'S OWN ROWS, read and answered signed in on the person lane. No deadline is served: a
# referee answers until the fixture's day, which the Einteilung states.

# Never `barred`, the binder refusing a barred person first, nor `vorschlag`, a referee proposing no date.
FLSpielbestaetigungSchiedsrichterState = Literal["valid", "zugesagt", "declined", "expired", "invalid", "cancelled"]


class FLSpielbestaetigungSelf(BaseModel):
    """One of the signed-in referee's rows, as their panel lists it."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    spiel_id: CustomObjectId
    # Which of the address's referee records the row names.
    schiedsrichter_id: CustomObjectId
    ansetzung: FLSpielbestaetigungViewAnsetzung
    state: FLSpielbestaetigungSchiedsrichterState
    # The referee's own decline reason, null on every other row.
    reason: CustomNonEmptyString | None
    # Whether the league recorded the answer for them, so the panel never shows it as their own; it names nobody.
    entered: bool
    # Whether the Ansetzung's day lies before today in Europe/Berlin, which the panel lists apart: judged here, so a
    # page rendered around midnight agrees with the order the read answered.
    past: bool


class FLSpielbestaetigungenSelfResponse(BaseAPIResponse):
    spielbestaetigungen: list[FLSpielbestaetigungSelf]


class FLSpielbestaetigungSchiedsrichterAnswerPayload(BaseModel):
    """A referee's answer about one row naming them: a decline gives a reason, which the administrator reads."""

    model_config = ConfigDict(extra="forbid")

    answer: FLSpielbestaetigungAnswerKind
    # Required as a KEY and null where unused, as the club's answer spells it.
    reason: Annotated[CustomSpielbestaetigungReason | None, BeforeValidator(parse_empty_string_to_none)]

    # On the reason's box, for the club's answer's reason: the panel offers no decline without a reason.
    @field_validator("reason")
    @classmethod
    def a_decline_gives_a_reason_and_an_acceptance_none(cls, reason: str | None, info: ValidationInfo) -> str | None:
        if info.data.get("answer") == "declined" and reason is None:
            raise rule_refusal("decline_without_reason", "a decline names its reason")

        return _an_acceptance_gives_no_reason(reason, info)


class FLSpielbestaetigungSchiedsrichterAnswerResponse(BaseAPIResponse):
    spielbestaetigung_id: CustomObjectId
    state: FLSpielbestaetigungAnswerKind


# --- The PASS, system tier. It owes every mail through the Postausgang, and answers counts alone: no address, no
# link and no name (`READ-ANSETZUNG-002`).


class FLSpielbestaetigungSweepResponse(BaseAPIResponse):
    """One season's pass, counted: what it closed, the rows it asked or reminded, and the mails it owed the Postausgang."""

    saison_id: str
    closed: int
    asked: int
    reminded: int
    # Every mail this pass owed, requests, reminders, Einteilungen and notices alike, one per recipient.
    mails: int
    failed: int
