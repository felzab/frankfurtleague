from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter

# The delivery state has ONE shape at every home `app/api/zustellung/services.py :: ZIEL_PFADE`
# names, so the referee's carrier declares the application's model rather than a twin of it.
from app.api.bewerbungen.schemas import FLBewerbungZustellung
from app.api.spieler.schemas import FLEinwilligung, SelbstEinwilligungPayload
from app.shared.schemas.bounds import (
    BEWERBUNG_TOKEN_MAX_LENGTH,
    EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH,
    LIST_LIMIT_DEFAULT,
    LIST_LIMIT_MAX,
)
from app.shared.schemas.custom import (
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomOptionalDateString,
    CustomOptionalString,
)
from app.shared.schemas.einwilligung import FLEinwilligungStand
from app.shared.schemas.kontakt import CustomKontaktName, FLKontakt, FLKontaktPayload
from app.shared.schemas.responses import BaseAPIResponse

# A SECOND spelling of `app/api/spieler/schemas.py :: FLEinwilligung`'s own, which is inline and so
# cannot be imported. Widened alone it would take a scope mongod refuses, and the press would 500:
# `fl_backend/tests/api/test_schiedsrichter_bestaetigung_refusal.py` holds the two equal.
FLSchiedsrichterUmfang = Literal["kader_oeffentlich", "intern"]

# What a reopened link shows. `abgelaufen` outranks nothing: a stamp is read first, so a referee who
# confirmed on the last valid day still sees that they did. `gesperrt` ranks first
# (`docs/backend/spec.md :: I515`).
FLSchiedsrichterBestaetigungZustand = Literal["gueltig", "bestaetigt", "abgelaufen", "gesperrt"]

# What an address link shows. No `bestaetigt`: an answer removes the block the link opens.
# `nicht_bestaetigbar`, a barred REPLACED address, is named apart from `gesperrt` so the new mailbox
# learns nothing of the ban.
FLSchiedsrichterAdresswechselZustand = Literal["gueltig", "abgelaufen", "gesperrt", "nicht_bestaetigbar"]

FLSchiedsrichterAdresswechselAntwort = Literal["bestaetigt", "abgelehnt"]

# The raw token as it arrives on the two base-tier endpoints. `BEWERBUNG_TOKEN_MAX_LENGTH` and not a
# referee's own: one `mint_token` spells every confirmation link this application hands out.
CustomSchiedsrichterToken = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=BEWERBUNG_TOKEN_MAX_LENGTH)]


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
    # the whole list over one row (`docs/backend/spec.md :: I36`). The type every person's name
    # takes, one ceiling for them all.
    name: CustomKontaktName
    # Tightened here for the same reason, the telephone rule having been narrowed after rows existed.
    kontakt: FLKontaktPayload


# One shape under two names, and they stay two: each endpoint publishes its own OpenAPI component,
# which `fl_frontend/src/core/apiContract.test.ts` pairs with a Zod mirror by name.
class FLPostSchiedsrichterPayload(_SchiedsrichterPayload):
    pass


class FLPatchSchiedsrichterPayload(_SchiedsrichterPayload):
    pass


class FLSchiedsrichterBestaetigung(BaseModel):
    """One referee's confirmation bookkeeping as the editor reads it -- and NO `token_hash`.

    The hash is a raw document key the confirm query alone reads, as
    `app/api/bewerbungen/schemas.py :: FLBewerbungBestaetigung` keeps its own off the wire.
    """

    verschickt_am: CustomDateString
    erinnert_am: CustomOptionalDateString
    # Stored beside the send rather than derived from it: raising the bound would otherwise move the
    # deadline of a link already in somebody's inbox.
    frist: CustomDateString
    # Null on every fresh mint: nothing is yet known about the message that link went out in.
    zustellung: FLBewerbungZustellung | None = None


class FLSchiedsrichterMint(BaseModel):
    """A freshly minted link, answered ONCE and stored nowhere.

    The raw token exists here and in the recipient's inbox; the database holds its hash. Admin-tier
    whole — every mint answering it is on `app/api/schiedsrichter/admin_router.py`.
    """

    token: str
    frist: CustomDateString
    # The address this link was minted FOR, read in the mint's own transaction. A caller mailing the
    # address it read BEFORE the mint sends the credential to a mailbox a rival save has replaced.
    email: CustomNonEmptyString


class FLSchiedsrichterAdresswechsel(BaseModel):
    """A confirmed referee's address waiting on its own mailbox, as the editor reads it -- and NO `token_hash`.

    Kept off the wire for `FLSchiedsrichterBestaetigung`'s reason.
    """

    email: str
    verschickt_am: CustomDateString
    # Stored for `FLSchiedsrichterBestaetigung.frist`'s reason.
    frist: CustomDateString
    zustellung: FLBewerbungZustellung | None = None


class FLSchiedsrichterAdresswechselMint(FLSchiedsrichterMint):
    """A freshly minted address link, answered once, with the address the change was asked from.

    The caller tells the stored address that a change was asked, so a change nobody wanted is
    noticed by the person still holding the record.
    """

    # Null only where the row holds no address to tell.
    bisherige_email: str | None


class FLSchiedsrichter(_SchiedsrichterWritable):
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
    # All three defaulted, and on no payload. The ghost carries none of them, and every row entered
    # before this flow carries none either, so a read refusing an absent key would 500 the list.
    bestaetigung: FLSchiedsrichterBestaetigung | None = None
    einwilligung: FLEinwilligung | None = None
    geburtsdatum: CustomOptionalDateString = None
    # Defaulted and on no payload, for the three above's reasons: only a confirmed referee whose
    # address an administrator moved carries one.
    adresswechsel: FLSchiedsrichterAdresswechsel | None = None


FLSchiedsrichterListAdapter = TypeAdapter(list[FLSchiedsrichter])


class FLSchiedsrichterFilterParams(BaseModel):
    default_payment: int | None = None
    include_inactive: bool = False

    limit: int = Field(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX)
    sort_by: Literal["name", "default_payment"] = Field(default="name")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLSchiedsrichterListResponse(BaseAPIResponse):
    schiedsrichter: list[FLSchiedsrichter]


class FLPostSchiedsrichterResponse(BaseAPIResponse):
    # Never null: the payload requires an address, and entering one is the invitation.
    bestaetigung: FLSchiedsrichterMint

    created_id: CustomObjectId


class FLPatchSchiedsrichterResponse(BaseAPIResponse):
    updated_document: FLSchiedsrichter
    # Reported rather than assumed: this fan-out is the half of the endpoint that fails silently (`docs/backend/spec.md :: I13`).
    fanned_out_to_spiele: int
    # Null unless the save moved an UNCONFIRMED referee's address, which retires the link posted to
    # the mailbox nobody reads.
    bestaetigung: FLSchiedsrichterMint | None = None
    # Null unless the save moved a CONFIRMED referee's address, which waits on the new mailbox.
    # Never both: a referee is confirmed or not.
    adresswechsel: FLSchiedsrichterAdresswechselMint | None = None


class FLSchiedsrichterReactivateResponse(BaseAPIResponse):
    """The reactivation's answer: its own rather than the retire's, being the one of the pair that can mint."""

    updated_document: FLSchiedsrichter
    # Null unless the row came back unanswered and holding an address a link can go to.
    bestaetigung: FLSchiedsrichterMint | None = None


class FLSchiedsrichterMintResponse(BaseAPIResponse):
    """The re-send's answer. Never null: where no link may be minted a refusal answers instead."""

    bestaetigung: FLSchiedsrichterMint


class FLSchiedsrichterAdresswechselMintResponse(BaseAPIResponse):
    """The address link's re-send answer. Never null: where no change is pending a 404 answers instead."""

    adresswechsel: FLSchiedsrichterAdresswechselMint


class FLSchiedsrichterAdresswechselAnsichtPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: CustomSchiedsrichterToken


class FLSchiedsrichterAdresswechselAnsichtResponse(BaseAPIResponse):
    """What one address link opens, and nothing a leaked one should not learn (`READ-REFEREE-003`).

    A first name and a deadline: never either address, the school, the fee or the id.
    """

    zustand: FLSchiedsrichterAdresswechselZustand
    vorname: CustomNonEmptyString | None
    frist: CustomDateString


class FLSchiedsrichterAdresswechselPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: CustomSchiedsrichterToken
    # Required rather than defaulted: a page that omitted it would have the model answer for the
    # person whether a mailbox is theirs.
    antwort: FLSchiedsrichterAdresswechselAntwort


class FLSchiedsrichterAdresswechselResponse(BaseAPIResponse):
    """The answer recorded, and nothing of the row: a leaked link learns only what it posted."""

    antwort: FLSchiedsrichterAdresswechselAntwort


class FLSchiedsrichterBestaetigungAnsichtPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: CustomSchiedsrichterToken


class FLSchiedsrichterBestaetigungAnsichtResponse(BaseAPIResponse):
    """What one confirmation link opens, and nothing a leaked one should not learn (`READ-REFEREE-002`).

    A first name and a role: never the full name, the school, the contact details, the fee, the
    birthdate or the id.
    """

    zustand: FLSchiedsrichterBestaetigungZustand
    # The first part of the stored name, which is one field rather than two on this collection. Null
    # for the row an administrator entered without one.
    vorname: CustomNonEmptyString | None
    # The wording the stored record cites, so a reopened link shows the version answered under
    # rather than the one the page would show today.
    text_version: CustomOptionalString
    mindestalter: int
    # Served for `mindestalter`'s reason: the page offers the media switch only from this age, and a
    # copy of its own would offer it where the write refuses.
    medien_mindestalter: int
    frist: CustomDateString


class FLSchiedsrichterBestaetigungPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: CustomSchiedsrichterToken
    geburtsdatum: CustomDateString
    umfang: FLSchiedsrichterUmfang
    # Required rather than defaulted: a page that omitted it would store the model's answer in place
    # of the person's, and an off switch is an answer.
    medien: bool
    # The label of the words the page showed: the write refuses any but the running one
    # (`docs/backend/spec.md :: I550`).
    text_version: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH)]


class FLSchiedsrichterBestaetigungResponse(BaseAPIResponse):
    """What the person just recorded, read back off the updated document.

    Bounded by `READ-REFEREE-002` as the view above is: the page confirms the answer, and a
    caller holding a leaked token learns nothing it did not already post.
    """

    vorname: CustomNonEmptyString | None
    umfang: FLSchiedsrichterUmfang
    medien: bool
    bestaetigt_am: CustomDateString


class FLSchiedsrichterWriteResponse(BaseAPIResponse):
    """Shared by delete and anonymisieren.

    The retirement answers with the referee as they now stand; the erasure answers with the ghost,
    the row it named being gone (`app/api/schiedsrichter/admin_router.py :: anonymise_schiedsrichter`).
    """

    updated_document: FLSchiedsrichter


class FLSchiedsrichterSingleResponse(BaseAPIResponse):
    schiedsrichter: FLSchiedsrichter


class FLSchiedsrichterKontext(BaseModel):
    """What the referee confirmation page's slots name for this record today: the one stored name's first part."""

    vorname: str | None


class FLSchiedsrichterSelbst(BaseModel):
    """One referee record as its own person reads it: their contact details, fee and consent, never the link's bookkeeping."""

    schiedsrichter_id: CustomObjectId
    name: CustomNonEmptyString
    schule: str | None
    kontakt: FLKontakt
    # `default_payment`, named as the screen names it: the confirmation page lists it among what is stored.
    honorar: int
    geburtsdatum: CustomOptionalDateString = None
    inactive_since: CustomOptionalDateString
    # Required: only a confirmed record is served.
    einwilligung: FLEinwilligung
    # For `app/api/spieler/schemas.py :: FLSpielerSelbst`'s reason.
    bestaetigt_text_version: str | None
    # For `app/api/spieler/schemas.py :: FLSpielerSelbst`'s reason.
    nachweis_stand: FLEinwilligungStand
    # For `app/api/spieler/schemas.py :: FLSpielerSelbst`'s reason.
    erteilbar: bool
    medien_angeboten: bool
    kontext: FLSchiedsrichterKontext


class FLSchiedsrichterSelbstResponse(BaseAPIResponse):
    """Every confirmed referee record the signed-in address holds, the ghost never among them."""

    schiedsrichter: list[FLSchiedsrichterSelbst]


class FLSchiedsrichterSelbstEinwilligungPayload(SelbstEinwilligungPayload):
    pass


class FLSchiedsrichterSelbstEinwilligungResponse(BaseAPIResponse):
    """The record as it stands after the write, everything the person did not move unchanged."""

    schiedsrichter_id: CustomObjectId
    einwilligung: FLEinwilligung
    # For `app/api/spieler/schemas.py :: FLSpielerSelbstEinwilligungResponse`'s reason.
    nachweis_stand: FLEinwilligungStand
