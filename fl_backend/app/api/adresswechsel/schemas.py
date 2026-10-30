from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.api.adresswechsel.services import FLAdresswechselBisherigZustand, FLAdresswechselNeuZustand
from app.api.berechtigungen.schemas import FLUtcInstant
from app.api.postausgang.schemas import FLOutboxState
from app.api.sperrliste.schemas import refuse_an_address_in_the_reason
from app.shared.schemas.bestaetigung import CustomToken
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LOESCHUNG_ANLASS_MAX_LENGTH
from app.shared.schemas.custom import (
    SINGLE_LINE_PATTERN,
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
)
from app.shared.schemas.kontakt import CustomEmail
from app.shared.schemas.literals import FLAddressChangeEndArt, FLAddressChangeWaitsOn, FLAddressChangeWay, FLVerwaltung
from app.shared.schemas.responses import BaseAPIResponse

type FLAddressChangeAntwort = Literal["confirmed", "declined"]

# How an administrator checked who asks, where the address on file is gone: the erasure occasion's ceiling, being
# copied onto the start's log row as that occasion is. An address typed here would outlive every redaction of the change.
# The ceiling counts what arrives and the strip runs after it, so the published `maxLength` is the one the write keeps.
CustomAdresswechselGrund = Annotated[
    str,
    StringConstraints(max_length=LOESCHUNG_ANLASS_MAX_LENGTH, pattern=SINGLE_LINE_PATTERN),
    AfterValidator(str.strip),
    StringConstraints(min_length=1),
    AfterValidator(refuse_an_address_in_the_reason),
]


# --- The record as `adresswechsel` stores it.


class FLAdresswechselGenehmigung(BaseModel):
    """The approval a change moving a grant waits on."""

    verwaltung: FLVerwaltung
    asked_at: datetime
    bis: datetime
    started_by: str
    approved_at: datetime | None
    approved_by: str | None


class FLAdresswechselBeendet(BaseModel):
    art: FLAddressChangeEndArt
    am: datetime


class FLAdresswechselUmgezogen(BaseModel):
    """The effect's two addresses as the erasure journal hashes them: the new one, and the one it replaced."""

    person_hash: str
    before: str


class FLAdresswechselUmzug(BaseModel):
    """The sign-in account an effect still owes to carry, from the replaced address to the new one, both folded."""

    von: str
    nach: str


class FLAdresswechsel(BaseModel):
    """One change. Its hashes are whole credentials, read by their links' lookups alone and on no read model."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    # Null once ended, as `email` and `grund` are: a tombstone holds no address.
    adresse: str | None
    email: str | None
    way: FLAddressChangeWay
    sent_at: CustomDateString
    valid_until: datetime | None
    released_at: datetime | None
    grund: str | None
    confirmed_at: datetime | None
    effective_from: datetime | None
    approval: FLAdresswechselGenehmigung | None
    ended: FLAdresswechselBeendet | None
    # Set by an effect that carries the account, which the ended record keeps until the carry is done; absent otherwise.
    move: FLAdresswechselUmzug | None = Field(default=None)
    # Set by every effect, until the erasure of the new address takes it.
    moved: FLAdresswechselUmgezogen | None = Field(default=None)


class FLAdresswechselStopp(BaseModel):
    """The address on file's stop link."""

    token_hashes: list[str]


class FLAdresswechselRecord(FLAdresswechsel):
    """One change as `adresswechsel` stores it, its two links' hashes with it, each minted as its mail is handed out."""

    # Empty until the new mailbox's link is handed out, and on the `release` way until the address on file approves.
    token_hashes: list[str]
    stop: FLAdresswechselStopp


class FLAddressChangeOpenMove(BaseModel):
    # The ended change that owes it.
    id: CustomObjectId
    von: str
    nach: str


class FLAddressChangeMovesResponse(BaseAPIResponse):
    """The sign-in accounts the effects still owe to carry, server to server alone: each names two addresses.

    A page at a time; a full page means more wait.
    """

    moves: list[FLAddressChangeOpenMove]


class FLAddressChangeMovesDonePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ids: list[CustomObjectId] = Field(min_length=1, max_length=LIST_LIMIT_DEFAULT)


class FLAddressChangeMovesDoneResponse(BaseAPIResponse):
    # The carries this call took off their changes; an id owing none is not counted.
    done: int = Field(ge=0)


class FLAddressChangeAdressePayload(BaseModel):
    """Exactly one key: the new mailbox's link token, or the change an approval names."""

    model_config = ConfigDict(extra="forbid")

    token: CustomToken | None = None
    address_change_id: CustomObjectId | None = None

    @model_validator(mode="after")
    def exactly_one_key(self) -> Self:
        if (self.token is None) == (self.address_change_id is None):
            raise ValueError("name either the link's token or the change, and not both")

        return self


class FLAddressChangeAdresseResponse(BaseAPIResponse):
    """A live change's new address and nothing else, server to server alone."""

    # Folded as the sign-in store keys an account; null where the key names no live change.
    email: str | None


class FLAddressChangeApprovalStand(BaseModel):
    """The approval a change of the person's own grant waits on, as their account page reads it: never who gave it."""

    # `owner`: another owner approves.
    verwaltung: FLVerwaltung
    approved: bool
    bis: FLUtcInstant


# --- The two links, public.


class FLAddressChangeViewNew(BaseModel):
    """What the new mailbox's link opens while the change stands."""

    seite: Literal["new"]
    state: FLAdresswechselNeuZustand
    # Null exactly where the change is confirmed: it waits on no deadline of this link's.
    valid_until: FLUtcInstant | None
    effective_from: FLUtcInstant | None
    way: FLAddressChangeWay
    # Null exactly where not `confirmed`: whether the confirmed change waits on another administrator's approval.
    approval_open: bool | None


class FLAddressChangeViewPrevious(BaseModel):
    """What the address on file's stop link opens: the step the change waits on, never whether it could be confirmed."""

    seite: Literal["previous"]
    state: FLAdresswechselBisherigZustand
    valid_until: FLUtcInstant | None
    effective_from: FLUtcInstant | None
    way: FLAddressChangeWay


class FLAddressChangeViewEnded(BaseModel):
    """What either link opens once its change ended, for as long as its record is kept."""

    seite: Literal["new", "previous"]
    state: Literal["ended"]
    art: FLAddressChangeEndArt


class FLAddressChangeViewResponse(BaseAPIResponse):
    """What one address link opens: never a name, either address or the id."""

    view: Annotated[FLAddressChangeViewNew | FLAddressChangeViewPrevious | FLAddressChangeViewEnded, Field(discriminator="state")]


class FLAddressChangeAntwortPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: CustomToken
    # Required rather than defaulted: a page that omitted it would have the model answer for the person whether a mailbox is theirs.
    antwort: FLAddressChangeAntwort


class FLAddressChangeAntwortResponse(BaseAPIResponse):
    """The answer recorded, and no address of the change: the notices an effect owes are queued, never answered."""

    antwort: FLAddressChangeAntwort
    # Set where a change waiting after its confirmation now waits until then.
    effective_from: FLUtcInstant | None
    # Set where the change now waits on another administrator's approval of its grant's move.
    approval_open: bool
    # Set where the change took effect: its notice is owed in the Postausgang and its account's carry on the record.
    effective: bool


class FLAddressChangeStopResponse(BaseAPIResponse):
    stopped: Literal[True]


# --- The administrator's tool, keyed by the address it types.


class FLAddressChangeVerwaltungViewPayload(BaseModel):
    """Exactly one key: the address typed, or the change a page links to."""

    model_config = ConfigDict(extra="forbid")

    adresse: CustomEmail | None = None
    address_change_id: CustomObjectId | None = None

    @model_validator(mode="after")
    def exactly_one_key(self) -> Self:
        if (self.adresse is None) == (self.address_change_id is None):
            raise ValueError("name either the address or the change, and not both")

        return self


class FLAddressChangeVerwaltungHoldings(BaseModel):
    """What the address holds that a change moves, counted: the tool names the kinds, the editors the records."""

    spieler: int = Field(ge=0)
    schiedsrichter: int = Field(ge=0)
    seats: int = Field(ge=0)
    bewerbung_seats: int = Field(ge=0)
    registrierungen: int = Field(ge=0)
    grant: FLVerwaltung | None


class FLAddressChangeVerwaltungApproval(BaseModel):
    """The approval a change moving a grant waits on, read-only here: the administrators page approves it.

    Never who approved: a barred administrator's address is answered on no read.
    """

    verwaltung: FLVerwaltung
    bis: FLUtcInstant
    approved_at: FLUtcInstant | None


class FLAddressChangeVerwaltungOpen(BaseModel):
    """The address's live change whole, admin tier: the new address and the reason included, never a hash."""

    id: CustomObjectId
    email: str
    way: FLAddressChangeWay
    grund: str | None
    waits_on: FLAddressChangeWaitsOn
    sent_at: CustomDateString
    valid_until: FLUtcInstant | None
    released_at: FLUtcInstant | None
    confirmed_at: FLUtcInstant | None
    effective_from: FLUtcInstant | None
    # What became of the new mailbox's last link mail; null where none was owed.
    delivery: FLOutboxState | None
    # Judged as the hourly pass ends one, so the tool marks a lapsed change without a clock of its own.
    expired: bool
    approval: FLAddressChangeVerwaltungApproval | None


class FLAddressChangeVerwaltungViewResponse(BaseAPIResponse):
    adresse: str
    holdings: FLAddressChangeVerwaltungHoldings
    possible: bool
    open: FLAddressChangeVerwaltungOpen | None


class FLAddressChangeVerwaltungPayload(BaseModel):
    """The address a change starts on, the address it goes to, and the reason where the address on file is gone."""

    model_config = ConfigDict(extra="forbid")

    adresse: CustomEmail
    email: CustomEmail
    # Required, null meaning the address on file is asked first: a form forgetting the box must not start the change
    # that hands the records over without that address.
    grund: CustomAdresswechselGrund | None


class FLAddressChangeVerwaltungMintResponse(BaseAPIResponse):
    """A started or re-sent change, whose mails are owed in the Postausgang: no link is answered."""

    id: CustomObjectId
    way: FLAddressChangeWay
    valid_until: FLUtcInstant
    email: CustomNonEmptyString


class FLAddressChangeIdResponse(BaseAPIResponse):
    id: CustomObjectId


class FLAddressChangeApprovalResponse(BaseAPIResponse):
    id: CustomObjectId
    # Whether the approval made the change take effect, the new mailbox having confirmed and no waiting time left.
    effective: bool


# --- The hourly pass.


class FLAdresswechselSweepParams(BaseModel):
    """Where in one pass the call starts: after the change the call before it reached, or at the lowest id where none is named."""

    nach: CustomObjectId | None = None


class FLAddressChangeSweepResponse(BaseAPIResponse):
    """One call's share of the live changes whose step lapsed or whose waiting time ended."""

    removed: int
    # Due changes a judgement refused at the end of their waiting time, and due ones taken effect, each notice queued.
    discarded: int = Field(ge=0)
    effective: int = Field(ge=0)
    # A change whose ending or effect failed among them: it stays due, so a caller looping on this alone never ends.
    remaining: int
    # The last change this call reached, for the next call's `nach`; null once it reached the end, which ends the pass.
    nach: CustomObjectId | None
