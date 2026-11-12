from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from app.api.spieler.schemas import SQUAD_NUMMER_PATTERN, FLEinwilligung
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
    refuse_a_stale_grant,
)
from app.shared.schemas.kontakt import CustomEmail, CustomKontaktName, CustomStoredAddress
from app.shared.schemas.literals import (
    FLConfirmationState,
    FLEinwilligungScope,
    FLRegistrierungStatus,
    FLSaisonStatus,
    FLSpielerPosition,
    FLSpielerStufe,
)
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel

# --- The invite's read, the submission and the administrator's read of what it stored. Every
# payload below is reached from a request body alone, so each forbids an undeclared key; the read
# models stay lax.


class FLRegistrierungDecision(BaseModel):
    """When this registration was declined, and why."""

    made_at: CustomDateString
    reason: str | None


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
    idempotency_key: str | None = None


class FLInvitationViewResponse(BaseAPIResponse):
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


class FLPostRegistrierungPayload(BaseModel):
    """One pupil registering through a team's link.

    The team, the season, the state, the deadline and the confirmation link come from the invite and the clock, never from this body.
    """

    model_config = ConfigDict(extra="forbid")

    token: CustomToken
    first_name: CustomKontaktName
    last_name: CustomKontaktName
    email: CustomEmail
    # Each nullable with the caller stating the null rather than omitting it, as a squad payload's
    # three are: the answer is then the pupil's and not a default nobody chose.
    position: FLSpielerPosition | None
    # Tightened on the write side alone, as a squad row's is.
    nummer: str | None = Field(pattern=SQUAD_NUMMER_PATTERN)
    stufe: FLSpielerStufe | None


class FLPostRegistrierungResponse(BaseAPIResponse):
    """The stored registration, the one a replayed key wrote first; its confirmation mail is owed in the same write."""

    registrierung_id: CustomObjectId


class FLRegistrierungAdminRow(BaseReadModel):
    """One pending registration as the Registrierungen list shows it: the pupil's name and nothing else of them."""

    id: CustomObjectId
    first_name: CustomNonEmptyString
    last_name: CustomNonEmptyString
    team_id: CustomObjectId
    # The name the club plays the season under; null for a club no longer standing in the season.
    team_name: str | None
    submitted_at: CustomDateString
    # Composed by the read, off the consent record's own stamp (`registrierung_is_confirmed`).
    confirmed: bool
    # Composed by the read, off the mail's own stamp (`registrierung_was_left_unmailed`).
    unmailed: bool


class FLRegistrierungenAdminFilterParams(BaseModel):
    """Which season's pending registrations the list reads, whole up to the cap: its page narrows them."""

    saison_id: str


class FLRegistrierungenAdminListResponse(BaseAPIResponse):
    """One season's pending registrations, newest first."""

    registrierungen: list[FLRegistrierungAdminRow]
    # Whether every row was served, which an administrator must be able to trust.
    complete: bool


# --- The confirmation. The token is the whole credential, as it is for the application's link, so
# both endpoints are base-tier and every payload forbids an undeclared key.


class FLRegistrierungConfirmationViewResponse(BaseAPIResponse):
    """What one confirmation link opens, and no field past the ones declared here."""

    state: FLConfirmationState
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
    # The day of the pupil's own answer, so a reopened link says what they did and when; null on every state showing
    # no answer, as a referee's confirmation view serves it.
    answered_at: CustomOptionalDateString


class FLRegistrierungConfirmationPayload(BaseModel):
    """One pupil's own answer: their date of birth and the two consents."""

    model_config = ConfigDict(extra="forbid")

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

    @model_validator(mode="after")
    def _grants_name_the_current_wording(self) -> Self:
        refuse_a_stale_grant(self.text_versions, {"scope": self.scope, "media": self.media})
        return self


class FLRegistrierungConfirmationResponse(BaseAPIResponse):
    """What the pupil just recorded, echoed so the answer panel states it rather than opening the link a second time."""

    # One member: this page has no Widerspruch door. A pupil who does not want to be registered lets
    # the link expire, and the sweep takes the row.
    outcome: Literal["confirmed"]
    birth_date: CustomDateString
    scope: FLEinwilligungScope
    media: bool


# --- The retention sweep, system tier. The backend decides and erases; nothing a pupil's record holds leaves here.


class FLRegistrierungSweepResponse(BaseAPIResponse):
    """One season's pass: the erasures made, each committed."""

    saison_id: str
    erased_unconfirmed: int
    erased_without_decision: int
    erased_declined: int
    # One sum over every clock rather than a count per clock: the line logging each row names its clock.
    failed: int


# --- The team's decision, person tier. No model below declares `email`, `phone`, `birth_date` or
# `einwilligung`: a seat holder reads who registered and decides, and a pupil's address and birthdate
# are the league administrators' alone.


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


class FLOpenRegistrierungenResponse(BaseAPIResponse):
    """One team's pending registrations for one season, newest first."""

    team_id: CustomObjectId
    saison_id: str
    registrierungen: list[FLOpenRegistrierung]
    # Whether every pending registration is listed: false where the read's cap cut some, the confirmed ones kept first.
    complete: bool


class FLRegistrierungAdmitPayload(BaseModel):
    """The team's answer to the question the read asked: the person this registration is admitted into, or none."""

    model_config = ConfigDict(extra="forbid")

    # Required with no default: a client that omitted it would be read as answering "a new person",
    # which is the one answer that can put a returning pupil into the league twice.
    spieler_id: CustomObjectId | None


class FLRegistrierungAdmissionResponse(BaseAPIResponse):
    """The squad entry the admission wrote, and the person it belongs to."""

    # The admitted registration's id, deleted with it, so a caller can drop the row it pressed.
    registrierung_id: CustomObjectId
    spieler_id: CustomObjectId
    team_id: CustomObjectId
    saison_id: str
    first_name: CustomNonEmptyString
    last_name: CustomNonEmptyString
    nummer: str | None
    position: FLSpielerPosition | None
    stufe: FLSpielerStufe | None
    is_nachnominiert: bool


# One member, and never free text: the reason reaches the pupil's mail, and a team's own words about
# a pupil would be personal data the league then holds about them.
FLRegistrierungDecisionReason = Literal["other_person"]


class FLRegistrierungDeclinePayload(BaseModel):
    """Why the team declines, from a closed set or not at all."""

    model_config = ConfigDict(extra="forbid")

    # Required with no default, so an omission is never read as declining without a reason: the
    # reason picks the sentence the pupil is mailed.
    reason: FLRegistrierungDecisionReason | None


class FLRegistrierungDeclineResponse(BaseAPIResponse):
    """The declined registration, and the first name the seat holder is told the decision by."""

    registrierung_id: CustomObjectId
    first_name: CustomNonEmptyString
