from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.api.address_change.services import FLAddressChangeNewState, FLAddressChangePreviousState
from app.api.outbox.schemas import FLOutboxStatus
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.confirmation import CustomToken
from app.shared.schemas.custom import (
    CustomDateString,
    CustomObjectId,
    FLUtcInstant,
)
from app.shared.schemas.kontakt import CustomEmail, CustomStoredAddress
from app.shared.schemas.literals import FLAddressChangeEndKind, FLAddressChangeWaitsOn, FLAddressChangeWay, FLAdminTier
from app.shared.schemas.responses import BaseAPIResponse

type FLAddressChangeAnswer = Literal["confirmed", "declined"]


class FLAddressChangeEnded(BaseModel):
    kind: FLAddressChangeEndKind
    at: datetime


class FLAddressChangeMove(BaseModel):
    """The sign-in account an effect still owes to carry, from the replaced address to the new one, both folded."""

    old: CustomStoredAddress
    new: CustomStoredAddress


class FLAddressChange(BaseModel):
    """One change. Its hashes are whole credentials, read by their links' lookups alone and on no read model."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    # Null once ended, as `email` is: a tombstone holds no address.
    address: CustomStoredAddress | None
    email: CustomStoredAddress | None
    way: FLAddressChangeWay
    sent_at: CustomDateString
    valid_until: datetime | None
    released_at: datetime | None
    confirmed_at: datetime | None
    effective_from: datetime | None
    ended: FLAddressChangeEnded | None
    # Set by an effect that carries the account, which the ended record keeps until the carry is done; absent otherwise.
    move: FLAddressChangeMove | None = Field(default=None)


class FLAddressChangeStop(BaseModel):
    """The address on file's link: the person's own change's confirmation or decline until it confirms, then every way's stop."""

    token_hashes: list[str]


class FLAddressChangeRecord(FLAddressChange):
    """One change as `address_changes` stores it, its two links' hashes with it, each minted as its mail is handed out."""

    # Empty until the new mailbox's link is handed out, which on the person's own change waits until its address on file
    # confirms.
    token_hashes: list[str]
    stop: FLAddressChangeStop


class FLAddressChangeOpenMove(BaseModel):
    # The ended change that owes it.
    id: CustomObjectId
    old: str
    new: str


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


class FLAddressChangeAddressPayload(BaseModel):
    """Exactly one key: the new mailbox's link token, or the change a re-send names."""

    model_config = ConfigDict(extra="forbid")

    token: CustomToken | None = None
    address_change_id: CustomObjectId | None = None

    @model_validator(mode="after")
    def exactly_one_key(self) -> Self:
        if (self.token is None) == (self.address_change_id is None):
            raise ValueError("name either the link's token or the change, and not both")

        return self


class FLAddressChangeAddressResponse(BaseAPIResponse):
    """A live change's new address and nothing else, server to server alone."""

    # Folded as the sign-in store keys an account; null where the key names no live change.
    email: str | None


class FLAddressChangeViewNew(BaseModel):
    """What the new mailbox's link opens while the change stands."""

    side: Literal["new"]
    state: FLAddressChangeNewState
    effective_from: FLUtcInstant | None
    way: FLAddressChangeWay
    # The address this link was mailed to, exactly where `valid`: the question its holder answers names it, and the holder
    # of that mailbox knows it.
    email: str | None
    # The German day the new mailbox confirmed it; `effective_from` is the wait's end, a day or a week later.
    confirmed_on: CustomDateString | None


class FLAddressChangeViewPrevious(BaseModel):
    """What the address on file's link opens: the step the change waits on, never whether the new mailbox could confirm it."""

    side: Literal["previous"]
    state: FLAddressChangePreviousState
    effective_from: FLUtcInstant | None
    way: FLAddressChangeWay
    # The new address while the change stands, null past this link's own deadline: the holder of the address on file cannot
    # judge a change without it. Masked on `waiting_period`, whose start may be a pretext for learning a person's new mailbox.
    email: str | None
    # The German day the address on file confirmed the change, which a link opened again names; null before.
    released_on: CustomDateString | None


class FLAddressChangeViewEnded(BaseModel):
    """What either link opens once its change ended, for as long as its record is kept."""

    side: Literal["new", "previous"]
    state: Literal["ended"]
    kind: FLAddressChangeEndKind
    # The German day it ended on, which the page names beside what became of it.
    ended_on: CustomDateString
    # The way it began, which tells the person's own change apart on either side, as the live views do.
    way: FLAddressChangeWay
    # The German day the address on file confirmed it, on the address on file's side once it has; null otherwise.
    released_on: CustomDateString | None
    # The German day the new mailbox confirmed it, on the new side once it has: `ended_on` is the effect's day.
    confirmed_on: CustomDateString | None


class FLAddressChangeViewResponse(BaseAPIResponse):
    """What one address link opens: never a name or the id.

    The new address only where its holder judges by it: the new mailbox's `valid` link, and the address on file's link while
    the change stands, masked on `waiting_period`.
    """

    view: Annotated[FLAddressChangeViewNew | FLAddressChangeViewPrevious | FLAddressChangeViewEnded, Field(discriminator="state")]


class FLAddressChangeAnswerPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: CustomToken
    # Required rather than defaulted: a page that omitted it would have the model answer for the person whether a mailbox is theirs.
    answer: FLAddressChangeAnswer


class FLAddressChangeAnswerResponse(BaseAPIResponse):
    """The answer recorded, and no address of the change: the notices an effect owes are queued, never answered."""

    answer: FLAddressChangeAnswer
    # Set where a change waiting after its confirmation now waits until then.
    effective_from: FLUtcInstant | None
    # Set where the change took effect: its notice is owed in the Postausgang and its account's carry on the record.
    effective: bool


class FLAddressChangeStopResponse(BaseAPIResponse):
    stopped: Literal[True]


class FLAddressChangeAdminOpen(BaseModel):
    """One live change, with both its addresses."""

    id: CustomObjectId
    address: str
    email: str
    # The tier the changing address holds, whose holders a change in its wait mails; null for anyone else.
    holder: FLAdminTier | None
    waits_on: FLAddressChangeWaitsOn
    valid_until: FLUtcInstant | None
    effective_from: FLUtcInstant | None
    # What became of the new mailbox's last link mail; null where none was owed.
    delivery: FLOutboxStatus | None
    # Judged as the hourly pass ends one, so the tool marks a lapsed change without a clock of its own.
    expired: bool


class FLAddressChangeAdminListResponse(BaseAPIResponse):
    """The running changes this administrator may act on, newest first."""

    changes: list[FLAddressChangeAdminOpen]


class FLAddressChangeAdminPayload(BaseModel):
    """The address a change starts on, and the address it goes to."""

    model_config = ConfigDict(extra="forbid")

    address: CustomEmail
    email: CustomEmail


class FLAddressChangeIdResponse(BaseAPIResponse):
    """A started, re-sent or discarded change: its mails are owed in the Postausgang, so no link is answered."""

    id: CustomObjectId


class FLAddressChangeSweepParams(BaseModel):
    """Where in one pass the call starts: after the change the call before it reached, or at the lowest id where none is named."""

    after: CustomObjectId | None = None


class FLAddressChangeSweepResponse(BaseAPIResponse):
    """One call's share of the live changes whose step lapsed or whose waiting time ended."""

    removed: int
    # Due changes a judgement refused at the end of their waiting time, and due ones taken effect, each notice queued.
    discarded: int = Field(ge=0)
    effective: int = Field(ge=0)
    # A change whose ending or effect failed among them: it stays due, so a caller looping on this alone never ends.
    remaining: int
    # The last change this call reached, for the next call's `after`; null once it reached the end, which ends the pass.
    after: CustomObjectId | None
