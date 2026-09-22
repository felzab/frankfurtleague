from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter

# The delivery state has ONE shape at every home `app/api/zustellung/services.py :: ZIEL_PFADE`
# names, so the referee's carrier declares the application's model rather than a twin of it.
from app.api.bewerbungen.schemas import FLBewerbungZustellung
from app.api.spieler.schemas import FLEinwilligung
from app.shared.schemas.bounds import (
    BEWERBUNG_TOKEN_MAX_LENGTH,
    EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH,
    LIST_LIMIT_DEFAULT,
    LIST_LIMIT_MAX,
)
from app.shared.schemas.custom import (
    PERSON_NAME_PATTERN,
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomOptionalDateString,
    CustomOptionalString,
)
from app.shared.schemas.kontakt import FLKontakt, FLKontaktPayload
from app.shared.schemas.responses import BaseAPIResponse

# A SECOND spelling of `app/api/spieler/schemas.py :: FLEinwilligung`'s own, which is inline and so
# cannot be imported. Widened alone it would take a scope mongod refuses, and the press would 500:
# `fl_backend/tests/api/test_schiedsrichter_bestaetigung_refusal.py` holds the two equal.
FLSchiedsrichterUmfang = Literal["kader_oeffentlich", "intern"]

# What a reopened link shows. `abgelaufen` outranks nothing: a stamp is read first, so a referee who
# confirmed on the last valid day still sees that they did.
FLSchiedsrichterBestaetigungZustand = Literal["gueltig", "bestaetigt", "abgelaufen"]

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
    # the whole list over one row (`docs/backend/spec.md :: I36`). Stripped first, so the padding
    # the pattern's trailing space class admits never reaches a match document.
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, pattern=PERSON_NAME_PATTERN)]
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
    whole — the three mints answering it are all on `app/api/schiedsrichter/admin_router.py`.
    """

    token: str
    frist: CustomDateString
    # The address this link was minted FOR, read in the mint's own transaction. A caller mailing the
    # address it read BEFORE the mint sends the credential to a mailbox a rival save has replaced.
    email: CustomNonEmptyString


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
    # Null exactly where the create was given no address, which mails nothing and can mail nothing.
    bestaetigung: FLSchiedsrichterMint | None = None

    created_id: CustomObjectId


class FLPatchSchiedsrichterResponse(BaseAPIResponse):
    updated_document: FLSchiedsrichter
    # Reported rather than assumed: this fan-out is the half of the endpoint that fails silently (`docs/backend/spec.md :: I13`).
    fanned_out_to_spiele: int
    # Null unless the save moved an UNCONFIRMED referee's address, which retires the link posted to
    # the mailbox nobody reads. A confirmed referee's address change mints nothing.
    bestaetigung: FLSchiedsrichterMint | None = None


class FLSchiedsrichterMintResponse(BaseAPIResponse):
    """The re-send's answer. Never null: where no link may be minted a refusal answers instead."""

    bestaetigung: FLSchiedsrichterMint


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
    frist: CustomDateString


class FLSchiedsrichterBestaetigungPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: CustomSchiedsrichterToken
    geburtsdatum: CustomDateString
    umfang: FLSchiedsrichterUmfang
    # Required rather than defaulted: a page that omitted it would store the model's answer in place
    # of the person's, and an off switch is an answer.
    medien: bool
    # The label the ROUTE HANDLER stamped and never one the browser composed
    # (`docs/frontend/spec.md :: I148`).
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
    """Shared by delete, reactivate and anonymisieren.

    The first two answer with the referee as they now stand; the erasure answers with the ghost,
    the row it named being gone (`app/api/schiedsrichter/admin_router.py :: anonymise_schiedsrichter`).
    """

    updated_document: FLSchiedsrichter


class FLSchiedsrichterSingleResponse(BaseAPIResponse):
    schiedsrichter: FLSchiedsrichter
