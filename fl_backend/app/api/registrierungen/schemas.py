from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field

from app.api.spieler.schemas import KADER_NUMMER_MAX_LENGTH, KADER_NUMMER_PATTERN, FLEinwilligung
from app.shared.schemas.confirmation import CustomToken, FLConfirmation
from app.shared.schemas.custom import (
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomOptionalDateString,
)
from app.shared.schemas.einwilligung import (
    FLEinwilligungEvidenceSet,
    FLSpielerTextVersions,
    cite_their_kind,
)
from app.shared.schemas.kontakt import CustomEmail, CustomKontaktName, CustomStoredAddress
from app.shared.schemas.literals import (
    FLEinwilligungScope,
    FLRegistrierungStatus,
    FLSaisonStatus,
    FLSpielerPosition,
    FLSpielerStufe,
)
from app.shared.schemas.responses import BasePayload, BaseReadModel

# Every payload below is reached from a request body alone, so each forbids an undeclared key; the
# read models stay lax.


# One member, and never free text: the reason reaches the pupil's mail, and a team's own words about
# a pupil would be personal data the league then holds about them.
FLRegistrierungDecisionReason = Literal["other_person"]


class FLRegistrierungDecision(BaseModel):
    """When this registration was declined, and why."""

    made_at: CustomDateString
    reason: FLRegistrierungDecisionReason | None


class FLRegistrierungEinwilligung(FLEinwilligung, BaseReadModel):
    """A pending registration's consent record, as its pupil's own confirmation wrote it whole."""

    # A pupil's wordings alone: a registration becomes the pupil's record.
    evidence: Annotated[FLEinwilligungEvidenceSet, AfterValidator(lambda evidence_set: cite_their_kind(evidence_set, FLSpielerTextVersions))]


class _RegistrierungStored(BaseModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    saison_id: str
    team_id: CustomObjectId
    # The invite the token opened, so a row can be read back to the link that produced it after that
    # link has been revoked and replaced.
    invitation_id: CustomObjectId
    submitted_at: CustomDateString
    status: FLRegistrierungStatus
    first_name: CustomNonEmptyString
    last_name: CustomNonEmptyString
    email: CustomStoredAddress
    # The three a squad often does not know at registration, each stated by the caller rather than
    # defaulted.
    position: FLSpielerPosition | None
    # Patterned on the submission's payload alone.
    nummer: str | None
    stufe: FLSpielerStufe | None
    # Null until the pupil confirms.
    birth_date: CustomOptionalDateString
    einwilligung: FLRegistrierungEinwilligung | None


class FLRegistrierungConfirmationRecord(FLConfirmation):
    """One registration's bookkeeping as `registrierungen` stores it: the hash of every link it was mailed, each live."""

    # Null on a row past `OPEN_LINKS_PER_MAILBOX`, which was owed no mail.
    sent_at: CustomOptionalDateString
    token_hashes: list[str]


class FLRegistrierungRecord(_RegistrierungStored):
    """One registration as `registrierungen` stores it, with what no read serves."""

    confirmation: FLRegistrierungConfirmationRecord | None
    decision: FLRegistrierungDecision | None
    # The submission's replay key.
    idempotency_key: str


class FLInvitationViewResponse(BaseReadModel):
    """What an invite's holder is told before they type anything, and the bounds the form is held to."""

    team: CustomNonEmptyString
    # The club's `full_name`, a club here being a school: the consent copy names it, and a slot with
    # no value renders as a hole in a consent text.
    schule: CustomNonEmptyString
    saison_id: str
    saison_status: FLSaisonStatus
    running: bool
    allowed_stufen: list[FLSpielerStufe]
    # Whether the season holds the invite's team at all. False is a state the page words rather than
    # a form to fill in: every submission through it meets `registrierung_closed`.
    team_entered: bool
    # Whether the squad has room today. The write asks again: this answer is a form's, and two
    # submissions for one remaining place both pass it.
    kader_free: bool
    nachnominierung: bool


class FLPostRegistrierungPayload(BasePayload):
    """One pupil registering through a team's link.

    The team, the season, the state, the deadline and the confirmation link come from the invite and the clock, never from this body.
    """

    token: CustomToken
    first_name: CustomKontaktName
    last_name: CustomKontaktName
    email: CustomEmail
    # Each nullable with the caller stating the null rather than omitting it: the answer is then the
    # pupil's and not a default nobody chose.
    position: FLSpielerPosition | None
    # Tightened on the write side alone.
    nummer: str | None = Field(pattern=KADER_NUMMER_PATTERN, max_length=KADER_NUMMER_MAX_LENGTH)
    stufe: FLSpielerStufe | None


# The confirmation's token is the whole credential, so both its endpoints are base-tier and every
# payload forbids an undeclared key.


class FLRegistrierungConfirmationViewValid(BaseReadModel):
    """A standing link: what the pupil registered for, until when, and the age bounds their answer is judged by."""

    state: Literal["valid"]
    # The club's short name and its own `full_name`, a club here being a school: the consent text
    # renders both, and a slot with no value renders as a hole in it.
    team: CustomNonEmptyString
    schule: CustomNonEmptyString
    saison_id: str
    # Served rather than read from a constant of the page's own: the floor the write judges by is
    # the one the paragraph a pupil reads before consenting has to state.
    minimum_age: int
    # Served too: the page bounds the birthdate by the limits the write judges, never a copy.
    maximum_age: int = Field(gt=0)
    # The link's last day, stored at the mint: the page states it as the mail did.
    deadline: CustomDateString


class FLRegistrierungConfirmationViewConfirmed(BaseReadModel):
    """A link opened again after the pupil's own answer."""

    state: Literal["confirmed"]
    # The day of that answer, so the page says when.
    answered_at: CustomDateString


class FLRegistrierungConfirmationViewExpired(BaseReadModel):
    """A lapsed link, or one whose club left the season, which opens nothing more."""

    state: Literal["expired"]


# One member per state, as the landing's season is: each state is served with exactly the fields its page reads, so a
# confirmed link holding no day is a refused answer rather than a null the page must guess about.
FLRegistrierungConfirmationViewResponse = Annotated[
    FLRegistrierungConfirmationViewValid | FLRegistrierungConfirmationViewConfirmed | FLRegistrierungConfirmationViewExpired,
    Field(discriminator="state"),
]


class FLRegistrierungConfirmationPayload(BasePayload):
    """One pupil's own answer: their date of birth and the two consents."""

    token: CustomToken
    # Unbounded: the age is a 422 with its own code, never a `payload_refused`, so the page marks its one
    # field and keeps the typed date.
    birth_date: CustomDateString
    # Required rather than defaulted: a page omitting one would store this model's answer in place of
    # the person's.
    scope: FLEinwilligungScope
    media: bool
    # The wordings the page showed beside the two choices.
    text_versions: FLSpielerTextVersions


class FLRegistrierungSweepResponse(BaseReadModel):
    """One season's pass: the rows it passed over, which the next pass meets again."""

    # One sum over every clock rather than a count per clock: the line logging each row names its clock.
    failed: int


# No model below declares `email`, `phone`, `birth_date` or `einwilligung`: a seat holder reads who
# registered and decides, and a pupil's address and birthdate are the league administrators' alone.


class FLRegistrierungPerson(BaseModel):
    """The stored person a confirmed registration's address resolves to, named so the team can be asked whether it is the same one."""

    spieler_id: CustomObjectId
    first_name: CustomNonEmptyString
    last_name: str | None
    # A flag and never the two values: the stored birthdate is shown to administrators alone, and
    # the question needs only that something differs.
    deviates_from: bool


class FLOpenRegistrierung(BaseModel):
    """One pending registration as the team deciding it reads it."""

    registrierung_id: CustomObjectId
    submitted_at: CustomDateString
    first_name: CustomNonEmptyString
    last_name: CustomNonEmptyString
    nummer: str | None
    position: FLSpielerPosition | None
    stufe: FLSpielerStufe | None
    # Whether the pupil answered their own link, which is what makes the row one the team may admit.
    admissible: bool
    # Whether admitting this row now meets `kader_full`, by the verdict the admission refuses on: the squad stands at
    # its cap and this entry is no Nachnominierung. Judged apart from `admissible`; an unconfirmed row resolves to
    # nobody, so its window alone decides whether it enters as one.
    kader_full: bool
    nummer_double: bool
    # Empty on an unconfirmed row: its address is unproven, and resolving it would show the team
    # whoever stands behind an address anybody typed into the form.
    person: FLRegistrierungPerson | None


class FLOpenRegistrierungenResponse(BaseReadModel):
    """One team's pending registrations for one season, newest first."""

    team_id: CustomObjectId
    saison_id: str
    registrierungen: list[FLOpenRegistrierung]


class FLRegistrierungAdmitPayload(BasePayload):
    """The team's answer to the question the read asked: the person this registration is admitted into, or none."""

    # Required with no default: a client that omitted it would be read as answering "a new person",
    # which is the one answer that can put a returning pupil into the league twice.
    spieler_id: CustomObjectId | None


class FLRegistrierungDeclinePayload(BasePayload):
    """Why the team declines, from a closed set or not at all."""

    # Required with no default, so an omission is never read as declining without a reason: the
    # reason picks the sentence the pupil is mailed.
    reason: FLRegistrierungDecisionReason | None
