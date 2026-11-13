from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

from app.api.outbox.schemas import FLOutboxStatus
from app.api.spielbestaetigungen.schemas import FLSpielbestaetigungSchiedsrichterState
from app.api.spiele.schemas import FLSpielortFieldPublic
from app.api.spieler.schemas import FLEinwilligung
from app.core.crud import Anchored
from app.shared.schemas.bounds import SCHIEDSRICHTER_SCHULE_MAX_LENGTH
from app.shared.schemas.confirmation import CustomToken, FLConfirmation
from app.shared.schemas.custom import (
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomOptionalDateString,
    CustomOptionalString,
    CustomTimeString,
    CustomVersion,
    FLUtcInstant,
)
from app.shared.schemas.einwilligung import FLSchiedsrichterTextVersions, cite_their_kind, refuse_a_stale_grant
from app.shared.schemas.kontakt import CustomKontaktName, CustomStoredAddress, FLKontakt, FLKontaktPayload
from app.shared.schemas.literals import FLEinwilligungScope, FLSonderereignis
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel

# What a referee's link shows reopened. `declined` beside the states every link page shares: the referee objects
# through the same link, and the entry stays until its clock runs out.
type FLSchiedsrichterConfirmationState = Literal["valid", "confirmed", "declined", "expired"]


class _SchiedsrichterWritable(BaseModel):
    kontakt: FLKontakt
    name: CustomNonEmptyString
    schule: CustomOptionalString
    # No default, as a venue's `default_mietpreis` has none: the patch writes wholesale.
    default_payment: int = Field(ge=0)


# No `id` on any payload: the path names the referee, the body describes the change (RFC 5789).
class _SchiedsrichterPayload(_SchiedsrichterWritable):
    model_config = ConfigDict(extra="forbid")

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

    deadline: CustomDateString
    # The address the mail is owed to, read in the write's own transaction, so the answer names the mailbox the link
    # goes to rather than one a rival save has replaced.
    email: CustomNonEmptyString


class FLSchiedsrichterConfirmation(FLConfirmation):
    """A referee's confirmation bookkeeping as an administrator reads it, the objection's day with it."""

    # Null until the person objects through their link.
    declined_at: CustomOptionalDateString = None


class FLSchiedsrichter(_SchiedsrichterWritable, BaseReadModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    # Without the payload's ceiling and pattern: a read refusing a stored name would answer 500 for the whole list.
    name: CustomNonEmptyString
    # Redeclared without the payload's empty-string coercion: a read answers with the value as
    # stored, never a repaired copy of it.
    schule: str | None
    # On no payload: deactivation goes through the delete endpoint, which stamps the date itself.
    inactive_since: CustomOptionalDateString
    # Defaulted, on no payload: the create stores no record or birthdate before confirmation, and an address
    # correction on a retired, unconfirmed referee drops the link.
    # Refusing an absent key would 500 the list.
    confirmation: FLSchiedsrichterConfirmation | None = None
    einwilligung: FLEinwilligung | None = None
    birth_date: CustomOptionalDateString = None
    # The writes counted so far, which the editor's save sends back.
    version: int = 0


class FLSchiedsrichterConfirmationRecord(FLSchiedsrichterConfirmation):
    """One referee's confirmation bookkeeping as `schiedsrichter` stores it, its links' hashes with it."""

    # Empty until the hand-out mints the link the write owed; each hand-out's link replaces the one before it.
    token_hashes: list[str]


class FLSchiedsrichterKontaktRecord(FLKontakt):
    """A referee's channel as stored: the address in the fold every lookup of the referee compares, which the read-back holds."""

    # Required as the payloads require it: every referee is entered by an administrator, and the address is how the
    # person learns of it.
    email: CustomStoredAddress


class FLSchiedsrichterRecord(FLSchiedsrichter, Anchored):
    """A referee as `schiedsrichter` stores them."""

    kontakt: FLSchiedsrichterKontaktRecord
    confirmation: FLSchiedsrichterConfirmationRecord | None = None
    # Held while the entry is unanswered or declined, and absent once confirmed, which the hourly pass never erases.
    erase_at: datetime | None = None

    @model_validator(mode="after")
    def _cites_a_referees_wordings(self) -> Self:
        if self.einwilligung is not None:
            cite_their_kind(self.einwilligung.evidence, FLSchiedsrichterTextVersions)
        return self


FLSchiedsrichterListAdapter = TypeAdapter(list[FLSchiedsrichter])


class FLSchiedsrichterFilterParams(BaseModel):
    include_inactive: bool = False


class FLSchiedsrichterListResponse(BaseAPIResponse):
    schiedsrichter: list[FLSchiedsrichter]


class FLPostSchiedsrichterResponse(BaseAPIResponse):
    # Never null: the payload requires an address, and entering one is the invitation.
    confirmation: FLSchiedsrichterMint

    created_id: CustomObjectId


class FLPatchSchiedsrichterResponse(BaseAPIResponse):
    # The referee's version after the save, which the editor's next save sends.
    version: int
    # Null unless the save moved an unconfirmed referee's address, which retires the link posted to
    # the mailbox nobody reads.
    confirmation: FLSchiedsrichterMint | None = None


class FLSchiedsrichterReactivateResponse(BaseAPIResponse):
    """The reactivation's answer: its own rather than the retire's, being the one of the pair that can mint."""

    # Null unless the row came back unanswered and holding an address a link can go to.
    confirmation: FLSchiedsrichterMint | None = None


class FLSchiedsrichterSweepResponse(BaseAPIResponse):
    """One pass of the unconfirmed entries' clock: the entries it erased and the ones it passed over, which stay due."""

    erased: int
    failed: int


class FLSchiedsrichterMintResponse(BaseAPIResponse):
    """The re-send's answer. Never null: where no link may be minted a refusal answers instead."""

    confirmation: FLSchiedsrichterMint


class FLSchiedsrichterConfirmationViewResponse(BaseAPIResponse):
    """What one confirmation link opens, and nothing that says who its person is.

    The link went to an address an administrator typed and nobody has confirmed, which behind a typo is a stranger's.
    """

    state: FLSchiedsrichterConfirmationState
    minimum_age: int
    # Served, so the page bounds the birthdate by the limits the write judges, never a copy.
    maximum_age: int = Field(gt=0)
    deadline: CustomDateString
    # The day of the person's own answer, so a reopened link says what they did and when; null on every state showing
    # no answer. A leaked token learns from it nothing past the state it already shows: the person's own day, never who
    # they are.
    answered_at: CustomOptionalDateString


class FLSchiedsrichterConfirmationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: CustomToken
    birth_date: CustomDateString
    scope: FLEinwilligungScope
    # Required rather than defaulted: a page that omitted it would store the model's answer in place
    # of the person's, and an off switch is an answer.
    media: bool
    # The wordings the page showed beside the two choices.
    text_versions: FLSchiedsrichterTextVersions

    @model_validator(mode="after")
    def _grants_name_the_current_wording(self) -> Self:
        refuse_a_stale_grant(self.text_versions, {"scope": self.scope, "media": self.media})
        return self


class FLSchiedsrichterConfirmationResponse(BaseAPIResponse):
    """What the person just recorded, as their press sent it.

    A caller holding a leaked token learns nothing it did not already post.
    """

    scope: FLEinwilligungScope
    media: bool
    confirmed_at: CustomDateString


class FLSchiedsrichterSingleResponse(BaseAPIResponse):
    schiedsrichter: FLSchiedsrichter
    # Whether the link's deadline has passed today, judged by the rule its press refuses on, so the
    # editor reads no day of its own; false where the row holds no such link.
    confirmation_expired: bool
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


class FLSchiedsrichterSpiel(BaseReadModel):
    """One fixture booked to the signed-in referee, as their one list shows it: the booking they were asked about and the report they owe."""

    spiel_id: CustomObjectId
    team1_name: str | None
    team2_name: str | None
    # Null on a fixture holding no day or no hour yet.
    date: CustomOptionalDateString
    time: CustomTimeString | None
    spielort: FLSpielortFieldPublic | None
    # What befell the fixture, which the list words by the event's own word, as every match block does.
    sonderereignis: FLSonderereignis | None
    # The newest row asking them to confirm the fixture, which an answer names
    # (`POST /spielbestaetigungen/{spielbestaetigung_id}/answer`); null where none asks them.
    spielbestaetigung_id: CustomObjectId | None
    # Null exactly where `spielbestaetigung_id` is.
    state: FLSpielbestaetigungSchiedsrichterState | None
    # Their own decline's reason, null on every other row.
    reason: CustomNonEmptyString | None
    # Whether the league recorded the answer for them, so the list never shows it as their own.
    entered: bool
    # Whether the fixture has been played: from its kick-off, or from its day where it holds no time. Judged here, by the
    # rule that closes the booking, so a page agrees with the order the read answered.
    past: bool
    # Whether the fixture takes a report now: played, not called off or struck out, its season running. Played from
    # the kick-off, or from the day where the fixture holds no time.
    reportable: bool
    # When its report was first sent, whoever wrote it; null where none stands.
    submitted_at: FLUtcInstant | None
    # Whether the referee owes its report now, which puts the fixture among the open work: one it takes and none sent,
    # on a fixture that kept its slot, an abandoned one included; a no-show's report stays open to write, owed by nobody.
    bericht_owed: bool


class FLSchiedsrichterSpieleResponse(BaseAPIResponse):
    """A referee's fixtures of one season, open work first."""

    saison_id: str
    spiele: list[FLSchiedsrichterSpiel]
