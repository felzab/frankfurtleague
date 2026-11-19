from typing import Annotated, Final, Literal

from pydantic import AfterValidator, BaseModel, BeforeValidator, Field, StringConstraints, ValidationInfo, field_validator

from app.api.spiele.schemas import FLSpielbestaetigungParty, FLSpielortFieldPublic
from app.core.crud import Anchored
from app.core.exceptions import rule_refusal
from app.shared.schemas.custom import (
    PARAGRAPH_PATTERN,
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomOptionalDateString,
    CustomTimeString,
    parse_empty_string_to_none,
)
from app.shared.schemas.literals import FLKontaktSeat
from app.shared.schemas.responses import BasePayload, BaseReadModel

type FLSpielbestaetigungAnswerKind = Literal["agreed", "declined"]

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

# What a row reads as, the first state matching winning (`state_of`).
# `vorschlag`: the other club's decline proposes another date; `cancelled`: the fixture was called off, whatever was answered.
FLSpielbestaetigungState = Literal["valid", "vorschlag", "agreed", "declined", "expired", "invalid", "cancelled"]


# A sentence read on a card, as a ban's reason is, neither mailed as a decline's reason is nor kept on a
# log row as an erasure's reference is.
SPIELBESTAETIGUNG_REASON_MAX_LENGTH: Final = 500


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
    """The Ansetzung a row answers about, as the fixture held it at the mint: compared value by value with the fixture's."""

    date: CustomDateString
    time: CustomTimeString
    spielort_id: CustomObjectId | None
    team1_id: CustomObjectId
    team2_id: CustomObjectId


class FLSpielbestaetigungAppointment(BaseModel):
    """A date and time without a ground: a team's proposal, and the slot a row asked about, one a moved fixture left among them."""

    date: CustomDateString
    time: CustomTimeString


class FLSpielbestaetigungByKontakt(BaseModel):
    """The seat its holder answered from, never the person: of two seats one person holds, the first in order is recorded."""

    kind: Literal["kontakt"]
    seat: FLKontaktSeat


class FLByAdmin(BaseModel):
    """An administrator's act, naming nobody: the record keeps how a thing was settled, not who typed it."""

    kind: Literal["admin"]


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
    # Its ceiling and its pattern are the payload's: the read keeps the floor alone, so no stored reason fails a read.
    reason: CustomNonEmptyString | None


class FLSpielbestaetigungClosedRecord(BaseModel):
    reason: FLSpielbestaetigungClosedReason
    # True on a discard the pass closed again, `reason` then naming that end: ended for neither a move nor a call-off,
    # the row reads as the agreement the public fixture counted where it answered the fixture at its end (`matched`),
    # and as `reason` reads otherwise. Absent from a row no such close wrote.
    discarded: bool = Field(default=False)
    # Whether the row answered its fixture as the pass's close that ended it read the fixture, so a correction since
    # re-judges nothing. Null where no such close wrote it: held, closed otherwise, or closed before the close stored
    # it, each judged against the fixture as it stands.
    matched: bool | None = None


class FLSpielbestaetigungRecord(Anchored):
    """One confirmation as `spielbestaetigungen` stores it.

    The close reaches an answered row too, so an agreement a move overtook records why it stopped applying.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    saison_id: str
    spiel_id: CustomObjectId
    party: FLSpielbestaetigungParty
    ansetzung: FLSpielbestaetigungAnsetzung
    # Stored rather than derived from the fixture's date: raising the bound moves no request already sent.
    deadline: CustomDateString
    # Null from the mint until it owes the party a mail, so a row nobody could be asked on reads as never asked.
    asked_at: CustomOptionalDateString
    # The day the one reminder went, null until it does.
    reminded_at: CustomOptionalDateString
    answer: FLSpielbestaetigungAnswer | None
    closed: FLSpielbestaetigungClosedRecord | None


# --- The administrator: a row settled on its party's behalf.


class FLSpielbestaetigungEnterPayload(BasePayload):
    """The administrator's Zusage for a party that answered elsewhere, and how it was given.

    No way to choose: the one press records a Zusage, and a decline without a proposal would sit in no queue.
    """

    # Required: the row is the league's record of how a date was agreed, and the reason is the part no field holds.
    reason: CustomSpielbestaetigungReason


# --- A club's answer, signed in on the person lane, and the fixture its pages state. Every payload forbids an undeclared
# key. Nothing below names a person, a seat's address or a hash.


class FLSpielbestaetigungViewAnsetzung(BaseModel):
    """The clubs, the day, the hour and the ground a page or a message states, the fixture's as it stands."""

    team1_name: str
    team2_name: str
    date: CustomDateString
    time: CustomTimeString
    spielort: FLSpielortFieldPublic | None


class FLSpielbestaetigungVorschlagPayload(FLSpielbestaetigungAppointment, BasePayload):
    pass


def _an_acceptance_gives_no_reason(reason: str | None, info: ValidationInfo) -> str | None:
    """`acceptance_with_reason` on the reason's box, which a club's and a referee's answer both carry."""

    if info.data.get("answer") == "agreed" and reason is not None:
        raise rule_refusal("acceptance_with_reason", "an acceptance carries no reason")

    return reason


# A team's date as its own pages read it, while its row is open or answered: `valid` asks for its answer, `vorschlag`
# asks while the other club's decline proposes another date, `expired` is unanswered past its deadline, and `agreed` and
# `declined` are its own answer. A row closed since reads as none of them: nothing then asks the team.
type FLSpielbestaetigungTeamState = Literal["valid", "vorschlag", "expired", "agreed", "declined"]


class FLSpielbestaetigungTeamAnswerPayload(BasePayload):
    """One club's answer about one Ansetzung, from whichever of its seats presses first."""

    answer: FLSpielbestaetigungAnswerKind
    # Both required as keys and null where unused: an omitted key would read as a client that forgot it.
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
        if answer == "agreed" and vorschlag is not None:
            raise rule_refusal("acceptance_with_proposal", "an acceptance carries no proposal")

        return vorschlag

    @field_validator("reason")
    @classmethod
    def an_acceptance_gives_no_reason(cls, reason: str | None, info: ValidationInfo) -> str | None:
        return _an_acceptance_gives_no_reason(reason, info)


# --- A referee's own rows, answered signed in on the person lane. No deadline binds them: a referee answers until the
# fixture's kick-off, which the Einteilung states.

# A referee's row as their own list reads it. Never `vorschlag`, a referee proposing no date.
FLSpielbestaetigungSchiedsrichterState = Literal["valid", "agreed", "declined", "expired", "invalid", "cancelled"]


class FLSpielbestaetigungSchiedsrichterAnswerPayload(BasePayload):
    """A referee's answer about one row naming them: a decline gives a reason, which the administrator reads."""

    answer: FLSpielbestaetigungAnswerKind
    # Required as a key and null where unused, as the club's answer spells it.
    reason: Annotated[CustomSpielbestaetigungReason | None, BeforeValidator(parse_empty_string_to_none)]

    # On the reason's box rather than the body, which no box answers: the panel offers no decline without a reason.
    @field_validator("reason")
    @classmethod
    def a_decline_gives_a_reason_and_an_acceptance_none(cls, reason: str | None, info: ValidationInfo) -> str | None:
        if info.data.get("answer") == "declined" and reason is None:
            raise rule_refusal("decline_without_reason", "a decline names its reason")

        return _an_acceptance_gives_no_reason(reason, info)


# --- The pass, system tier. It owes every mail through the Postausgang, and answers counts alone: no address, no
# link and no name.


class FLSpielbestaetigungSweepResponse(BaseReadModel):
    """One season's pass, counted: what it closed, the rows it asked or reminded, and the mails it owed the Postausgang."""

    closed: int
    asked: int
    reminded: int
    # Every mail this pass owed, requests, reminders, Einteilungen and notices alike, one per recipient.
    mails: int
    failed: int
