from datetime import datetime
from typing import Annotated, Final, Literal, Self

from pydantic import BaseModel, Field, model_validator

from app.api.outbox.schemas import FLOutboxStatus
from app.api.saisons.schemas import FLTeamPageSpiel
from app.api.spielbestaetigungen.schemas import FLSpielbestaetigungSchiedsrichterState
from app.api.spieler.schemas import FLEinwilligung
from app.core.crud import Anchored
from app.shared.schemas.bounds import TEAM_FULL_NAME_MAX_LENGTH
from app.shared.schemas.confirmation import CustomToken, FLConfirmation
from app.shared.schemas.custom import (
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomOptionalDateString,
    CustomOptionalString,
    CustomVersion,
    FLUtcInstant,
)
from app.shared.schemas.einwilligung import FLSchiedsrichterTextVersions, cite_their_kind
from app.shared.schemas.kontakt import CustomKontaktName, CustomStoredAddress, FLKontakt, FLKontaktPayload
from app.shared.schemas.literals import FLEinwilligungScope
from app.shared.schemas.responses import BasePayload, BaseReadModel, FLCreatedResponse


class _SchiedsrichterWritable(BaseModel):
    kontakt: FLKontakt
    name: CustomNonEmptyString
    schule: CustomOptionalString
    # No default: the patch writes wholesale.
    default_payment: int = Field(ge=0)


# The school a referee teaches at, named as a school's full name is.
SCHIEDSRICHTER_SCHULE_MAX_LENGTH: Final = TEAM_FULL_NAME_MAX_LENGTH


# No `id` on any payload: the path names the referee, the body describes the change (RFC 5789).
class _SchiedsrichterPayload(_SchiedsrichterWritable, BasePayload):
    # Tightened on the write side alone: a read model refusing a stored name would answer 500 for
    # the whole list over one row. The type every person's name
    # takes, one ceiling for them all.
    name: CustomKontaktName
    # Tightened here for the same reason, the telephone rule having been narrowed after rows existed.
    kontakt: FLKontaktPayload
    # Ceilinged on the write side alone, so a stored longer school still reads.
    schule: CustomOptionalString = Field(max_length=SCHIEDSRICHTER_SCHULE_MAX_LENGTH)


# One shape under two names, and they stay two: each endpoint publishes its own OpenAPI component, which
# the generated client and its Zod schemas name it by.
class FLPostSchiedsrichterPayload(_SchiedsrichterPayload):
    pass


class FLPatchSchiedsrichterPayload(_SchiedsrichterPayload):
    # The `version` the editor was served, required: a save checked against nothing overwrites a rival's unseen.
    version: CustomVersion


class FLSchiedsrichterMint(BaseModel):
    """The confirmation link a write owed the referee, which the Postausgang mints and mails: never the link itself."""

    # The address the mail is owed to, read in the write's own transaction, so the answer names the mailbox the link
    # goes to rather than one a rival save has replaced.
    email: CustomNonEmptyString


class FLSchiedsrichter(_SchiedsrichterWritable, BaseReadModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    # Without the payload's ceiling and pattern: a read refusing a stored name would answer 500 for the whole list.
    name: CustomNonEmptyString
    # Redeclared without the payload's empty-string coercion: a read answers with the value as
    # stored, never a repaired copy of it.
    schule: str | None
    # On no payload: deactivation goes through the delete endpoint, which stamps the date itself.
    inactive_since: CustomOptionalDateString
    # On no payload, each stored null until it holds a value: the create stores no record or birthdate before
    # confirmation, and an address correction on a retired, unconfirmed referee nulls the link.
    confirmation: FLConfirmation | None
    einwilligung: FLEinwilligung | None
    birth_date: CustomOptionalDateString
    # The writes counted so far, which the editor's save sends back.
    version: int


class FLSchiedsrichterConfirmationRecord(FLConfirmation):
    """One referee's confirmation bookkeeping as `schiedsrichter` stores it, its links' hashes with it."""

    # Empty until the hand-out mints the link the write owed; each hand-out's link replaces the one before it.
    token_hashes: list[str]


class FLSchiedsrichterKontakt(FLKontakt):
    """A referee's channel as the administration reads it."""

    # Required as the record requires it, and with no rule: a row stored before the address rule moved still reads,
    # rather than answering 500 for the whole list.
    email: str


class FLSchiedsrichterKontaktRecord(FLSchiedsrichterKontakt):
    """A referee's channel as stored: the address in the fold every lookup of the referee compares, which the read-back holds."""

    # Required as the payloads require it: every referee is entered by an administrator, and the address is how the
    # person learns of it.
    email: CustomStoredAddress


class FLSchiedsrichterRecord(FLSchiedsrichter, Anchored):
    """A referee as `schiedsrichter` stores them."""

    kontakt: FLSchiedsrichterKontaktRecord
    confirmation: FLSchiedsrichterConfirmationRecord | None
    # Held while the entry is unanswered, and null once confirmed, which the hourly pass never erases.
    erase_at: datetime | None

    @model_validator(mode="after")
    def _cites_a_referees_wordings(self) -> Self:
        if self.einwilligung is not None:
            cite_their_kind(self.einwilligung.evidence, FLSchiedsrichterTextVersions)
        return self


# Where a referee's entry stands as the administration reads it: the link page's states, and `unasked` for an entry no
# link has gone to, a retired one whose corrected address was stored unmailed. Its own type and not the link page's:
# that page never opens on an entry without a link. An objection erases the entry, so none stands objected.
type FLSchiedsrichterEntryState = Literal["unasked", "valid", "expired", "confirmed"]


class FLSchiedsrichterAdminRow(BaseReadModel):
    """One referee as the administration's list shows them: the name, where the entry stands, and how to reach them."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    # Without the payload's ceiling and pattern: a read refusing a stored name would answer 500 for the whole list.
    name: CustomNonEmptyString
    kontakt: FLSchiedsrichterKontakt
    inactive_since: CustomOptionalDateString
    # Judged on the read by the rule the link refuses on, at the server's date, so no page compares a deadline to a
    # clock of its own.
    state: FLSchiedsrichterEntryState


class FLSchiedsrichterAnswer(BaseReadModel):
    """What a referee answered through their link, as the administration reads it: the day and the two choices, never the evidence."""

    confirmed_at: CustomDateString
    scope: FLEinwilligungScope
    media: bool


class FLSchiedsrichterAdmin(FLSchiedsrichterAdminRow):
    """One referee as their editor reads them: the list's row, the fields the save writes, and the link's days.

    No birthdate: it is asked once for the age check, and no page of the administration shows it.
    """

    # Redeclared without the payload's empty-string coercion: a read answers with the value as stored.
    schule: str | None
    default_payment: int
    # The writes counted so far, which the editor's save sends back.
    version: int
    # Null until a link is owed, and after an address correction on a retired, unconfirmed referee.
    confirmation: FLConfirmation | None
    # Null until the referee confirms.
    einwilligung: FLSchiedsrichterAnswer | None


class FLSchiedsrichterListResponse(BaseReadModel):
    schiedsrichter: list[FLSchiedsrichterAdminRow]


class FLPatchSchiedsrichterResponse(BaseReadModel):
    # The referee's version after the save, which the editor's next save sends.
    version: CustomVersion
    # Null unless the save moved an unconfirmed referee's address, which retires the link posted to
    # the mailbox nobody reads.
    confirmation: FLSchiedsrichterMint | None = None


class FLSchiedsrichterSweepResponse(BaseReadModel):
    """One pass of the unconfirmed entries' clock: the entries it erased and the ones it passed over, which stay due."""

    erased: int
    failed: int


class FLSchiedsrichterReactivateResponse(BaseReadModel):
    # Null unless the press brought back a referee who has not answered and holds an address a link
    # can go to, which owes them a fresh link.
    confirmation: FLSchiedsrichterMint | None


class FLPostSchiedsrichterResponse(FLCreatedResponse):
    """The created referee and the link the create owed them, which every create owes."""

    confirmation: FLSchiedsrichterMint


class FLSchiedsrichterConfirmationViewValid(BaseReadModel):
    """A standing link: the question's day and the age bounds its answer is judged by."""

    state: Literal["valid"]
    minimum_age: int
    # Served, so the page bounds the birthdate by the limits the write judges, never a copy.
    maximum_age: int = Field(gt=0)
    deadline: CustomDateString


class FLSchiedsrichterConfirmationViewConfirmed(BaseReadModel):
    """A link opened again after its consent."""

    state: Literal["confirmed"]
    # The day of the person's own answer, so the page says when. A leaked token learns from it nothing past the state it
    # already shows: the person's own day, never who they are.
    answered_at: CustomDateString


class FLSchiedsrichterConfirmationViewExpired(BaseReadModel):
    """A lapsed link, which opens nothing more."""

    state: Literal["expired"]


# One member per state, as the landing's season is: each state is served with exactly the fields its page reads, so a
# confirmed link holding no day is a refused answer rather than a null the page must guess about. Nothing that says who
# the person is: the link went to an address an administrator typed and nobody has confirmed, which behind a typo is a
# stranger's.
FLSchiedsrichterConfirmationViewResponse = Annotated[
    FLSchiedsrichterConfirmationViewValid | FLSchiedsrichterConfirmationViewConfirmed | FLSchiedsrichterConfirmationViewExpired,
    Field(discriminator="state"),
]


class FLSchiedsrichterConfirmationPayload(BasePayload):
    token: CustomToken
    birth_date: CustomDateString
    scope: FLEinwilligungScope
    # Required rather than defaulted: a page that omitted it would store the model's answer in place
    # of the person's, and an off switch is an answer.
    media: bool
    # The wordings the page showed beside the two choices.
    text_versions: FLSchiedsrichterTextVersions


class FLSchiedsrichterSingleResponse(BaseReadModel):
    schiedsrichter: FLSchiedsrichterAdmin
    # What became of the last confirmation mail the referee was owed; null where none was.
    delivery: FLOutboxStatus | None


class FLSchiedsrichterSelfPerson(BaseReadModel):
    """One referee record's stored data as its own person reads it: contact details, never the link's bookkeeping.

    Its consent is the account page's, whose entry extends this.
    """

    schiedsrichter_id: CustomObjectId
    name: CustomNonEmptyString
    schule: str | None
    kontakt: FLKontakt
    birth_date: CustomOptionalDateString = None


class FLSchiedsrichterSpiel(FLTeamPageSpiel):
    """One fixture booked to the signed-in referee, as their one list shows it.

    The fixture as the public reads serve it, with its matchday, as a club's own list serves its matches; and the booking
    they were asked about and the report they owe.
    """

    # The newest row asking them to confirm the fixture, which an answer names
    # (`POST /spielbestaetigungen/{spielbestaetigung_id}/answer`); null where none asks them.
    spielbestaetigung_id: CustomObjectId | None
    # Null exactly where `spielbestaetigung_id` is.
    state: FLSpielbestaetigungSchiedsrichterState | None
    # Whether they still referee it: false once a club's exit ends it unplayed, as the pass's notice told them; nothing is then
    # answered or reported.
    officiates: bool
    # Whether the fixture has been played: from its kick-off, or from its day where it holds no time. Judged here, by the
    # rule that closes the booking, so a page offers no answer the booking no longer takes.
    past: bool
    # When its report was first sent, whoever wrote it; null where none stands.
    submitted_at: FLUtcInstant | None
    # Whether the referee writes its report now, as the Spielbericht read's `reportable` judges the same fixture: booked to
    # them still, played, neither called off nor struck out, its season running. A no-show's included, which nobody owes.
    reportable: bool
    # Whether the referee owes its report now, which the list marks as work open on the fixture.
    bericht_owed: bool


class FLSchiedsrichterSpieleResponse(BaseReadModel):
    """A referee's fixtures of one season, in the order the draw numbered them."""

    saison_id: str
    spiele: list[FLSchiedsrichterSpiel]
