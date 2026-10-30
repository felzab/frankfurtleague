from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from app.api.postausgang.schemas import FLOutboxState
from app.api.spieler.schemas import FLEinwilligung
from app.core.crud import Anchored
from app.shared.schemas.bestaetigung import CustomToken, FLConfirmation
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, SCHIEDSRICHTER_SCHULE_MAX_LENGTH
from app.shared.schemas.custom import (
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomOptionalDateString,
    CustomOptionalString,
)
from app.shared.schemas.einwilligung import CustomEinwilligungTextVersion, FLEinwilligungStand
from app.shared.schemas.kontakt import CustomKontaktName, FLKontakt, FLKontaktPayload
from app.shared.schemas.literals import FLAddressChangeViewableDenied, FLConfirmationState, FLEinwilligungUmfang, FLSortOrder
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel


class _SchiedsrichterWritable(BaseModel):
    kontakt: FLKontakt
    name: CustomNonEmptyString
    schule: CustomOptionalString
    # No default, as a venue's `default_mietpreis` has none: the patch writes wholesale.
    default_payment: int = Field(ge=0)


# No `id` on any payload: the path names the referee, the body describes the change (RFC 5789).
class _SchiedsrichterPayload(_SchiedsrichterWritable):
    model_config = ConfigDict(extra="forbid")

    # Tightened on the WRITE side alone: a read model refusing a stored name would answer 500 for
    # the whole list over one row. The type every person's name
    # takes, one ceiling for them all.
    name: CustomKontaktName
    # Tightened here for the same reason, the telephone rule having been narrowed after rows existed.
    kontakt: FLKontaktPayload
    # Ceilinged on the WRITE side alone, for `name`'s reason.
    schule: CustomOptionalString = Field(max_length=SCHIEDSRICHTER_SCHULE_MAX_LENGTH)


# One shape under two names, and they stay two: each endpoint publishes its own OpenAPI component, which
# the generated client and its Zod schemas name it by.
class FLPostSchiedsrichterPayload(_SchiedsrichterPayload):
    pass


class FLPatchSchiedsrichterPayload(_SchiedsrichterPayload):
    # The `version` the editor was served; absent, the save is checked against nothing.
    version: int | None = None


class FLSchiedsrichterMint(BaseModel):
    """The confirmation link a write owed the referee, which the Postausgang mints and mails: never the link itself."""

    frist: CustomDateString
    # The address the mail is owed to, read in the write's own transaction, so the answer names the mailbox the link
    # goes to rather than one a rival save has replaced.
    email: CustomNonEmptyString


class FLSchiedsrichter(_SchiedsrichterWritable, BaseReadModel):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    # Nullable where the payload is not, for the one row that stands behind nobody
    # (`app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`). The floor stays on the string branch, an
    # empty one being the sentinel this design exists to remove.
    name: CustomNonEmptyString | None
    # Redeclared without the payload's empty-string coercion: a read answers with the value as
    # stored, never a repaired copy of it.
    schule: str | None
    # On no payload: deactivation goes through the delete endpoint, which stamps the date itself.
    inactive_since: CustomOptionalDateString
    # Defaulted, on no payload: the ghost carries none, the create no record or birthdate before
    # confirmation, and an address correction on a retired, unconfirmed referee drops the link.
    # Refusing an absent key would 500 the list.
    confirmation: FLConfirmation | None = None
    einwilligung: FLEinwilligung | None = None
    geburtsdatum: CustomOptionalDateString = None
    # The writes counted so far, which the editor's save sends back.
    version: int = 0


class FLSchiedsrichterBestaetigungRecord(FLConfirmation):
    """One referee's confirmation bookkeeping as `schiedsrichter` stores it, its links' hashes with it."""

    # Empty until the hand-out mints the link the write owed; each hand-out's link replaces the one before it.
    token_hashes: list[str]


class FLSchiedsrichterRecord(FLSchiedsrichter, Anchored):
    """A referee as `schiedsrichter` stores them."""

    confirmation: FLSchiedsrichterBestaetigungRecord | None = None


FLSchiedsrichterListAdapter = TypeAdapter(list[FLSchiedsrichter])


class FLSchiedsrichterFilterParams(BaseModel):
    default_payment: int | None = None
    include_inactive: bool = False

    limit: int = Field(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX)
    sort_by: Literal["name", "default_payment"] = Field(default="name")
    order: FLSortOrder = Field(default="asc")


class FLSchiedsrichterListResponse(BaseAPIResponse):
    schiedsrichter: list[FLSchiedsrichter]


class FLPostSchiedsrichterResponse(BaseAPIResponse):
    # Never null: the payload requires an address, and entering one is the invitation.
    confirmation: FLSchiedsrichterMint

    created_id: CustomObjectId


class FLPatchSchiedsrichterResponse(BaseAPIResponse):
    # Reported rather than assumed: this fan-out is the half of the endpoint that fails silently.
    fanned_out_to_spiele: int
    # Null unless the save moved an UNCONFIRMED referee's address, which retires the link posted to
    # the mailbox nobody reads.
    confirmation: FLSchiedsrichterMint | None = None


class FLSchiedsrichterReactivateResponse(BaseAPIResponse):
    """The reactivation's answer: its own rather than the retire's, being the one of the pair that can mint."""

    # Null unless the row came back unanswered and holding an address a link can go to.
    confirmation: FLSchiedsrichterMint | None = None


class FLSchiedsrichterMintResponse(BaseAPIResponse):
    """The re-send's answer. Never null: where no link may be minted a refusal answers instead."""

    confirmation: FLSchiedsrichterMint


class FLSchiedsrichterConfirmationViewResponse(BaseAPIResponse):
    """What one confirmation link opens, and nothing a leaked one should not learn (`READ-REFEREE-002`).

    Never a name, the school, the contact details, the fee, the birthdate or the id.
    """

    state: FLConfirmationState
    minimum_age: int
    # Served for `minimum_age`'s reason: the page offers the media switch only from this age, and a
    # copy of its own would offer it where the write refuses.
    medien_minimum_age: int = Field(gt=0)
    frist: CustomDateString


class FLSchiedsrichterConfirmationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: CustomToken
    geburtsdatum: CustomDateString
    umfang: FLEinwilligungUmfang
    # Required rather than defaulted: a page that omitted it would store the model's answer in place
    # of the person's, and an off switch is an answer.
    medien: bool
    # The label of the words the page showed: the write refuses any but the running one.
    text_version: CustomEinwilligungTextVersion


class FLSchiedsrichterConfirmationResponse(BaseAPIResponse):
    """What the person just recorded, read back off the updated document.

    Bounded by `READ-REFEREE-002` as the view above is: the page confirms the answer, and a
    caller holding a leaked token learns nothing it did not already post.
    """

    umfang: FLEinwilligungUmfang
    medien: bool
    confirmed_at: CustomDateString


class FLSchiedsrichterSingleResponse(BaseAPIResponse):
    schiedsrichter: FLSchiedsrichter
    # Whether the link's deadline has passed today, judged by the rule its press refuses on, so the
    # editor reads no day of its own; false where the row holds no such link.
    confirmation_expired: bool
    # The live change of the referee's address, which the address tool shows; null where none stands.
    address_change_id: CustomObjectId | None
    # Why the address tool refuses that change this administrator; null where it opens it or none stands.
    address_change_viewable_denied: FLAddressChangeViewableDenied | None
    # What became of the last confirmation mail the referee was owed; null where none was.
    delivery: FLOutboxState | None


class FLSchiedsrichterSelf(BaseReadModel):
    """One referee record's stored data as its own person reads it: contact details and fee, never the link's bookkeeping.

    For `app/api/spieler/schemas.py :: FLSpielerSelf`'s reason, the account page's entry extends it.
    """

    schiedsrichter_id: CustomObjectId
    name: CustomNonEmptyString
    schule: str | None
    kontakt: FLKontakt
    # `default_payment`, named as the screen names it: the confirmation page lists it among what is stored.
    honorar: int
    geburtsdatum: CustomOptionalDateString = None


class FLSchiedsrichterSelfResponse(BaseAPIResponse):
    """Every confirmed referee record the signed-in address holds, the ghost never among them."""

    schiedsrichter: list[FLSchiedsrichterSelf]


class FLSchiedsrichterAccountEinwilligungResponse(BaseAPIResponse):
    """The record as it stands after the write, everything the person did not move unchanged."""

    schiedsrichter_id: CustomObjectId
    einwilligung: FLEinwilligung
    # For `app/api/spieler/schemas.py :: FLSpielerAccountEinwilligungResponse`'s reason.
    nachweis_stand: FLEinwilligungStand
