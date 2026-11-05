from pydantic import BaseModel, ConfigDict, Field

from app.api.address_change.schemas import FLAddressChangeApprovalState
from app.api.berechtigungen.schemas import FLUtcInstant
from app.api.schiedsrichter.schemas import FLSchiedsrichterSelfPerson
from app.api.spieler.schemas import FLSpielerSelfPerson
from app.shared.schemas.custom import CustomObjectId, CustomOptionalDateString
from app.shared.schemas.einwilligung import FLEinwilligungStand
from app.shared.schemas.kontakt import CustomEmail
from app.shared.schemas.literals import (
    FLAddressChangeWaitsOn,
    FLAddressChangeWay,
    FLEinwilligungUmfang,
    FLKontaktKenntnisnahmeUmfang,
    FLKontaktRolle,
)
from app.shared.schemas.responses import BaseAPIResponse


class FLAccountEinwilligung(BaseModel):
    """A person's own record's two choices as its box shows them.

    The choices alone: the box names no day and no label, and `evidence_state` stands for each choice's evidence in the
    precondition a press echoes.
    """

    umfang: FLEinwilligungUmfang
    media: bool


class FLAccountSpielerEinwilligung(FLSpielerSelfPerson):
    """The pupil's record on the account page: its stored data and the consent the page moves."""

    # Required: only a confirmed record is served, so the block is always there.
    einwilligung: FLAccountEinwilligung
    # What the consent PATCH echoes back, computed by the function its precondition compares with.
    evidence_state: FLEinwilligungStand
    # Served rather than derived on the page, which would judge a grant with a second copy of the rule.
    givable: bool
    media_offered: bool
    # The media floor, which the page names where the record is short of it.
    media_minimum_age: int = Field(gt=0)


class FLAccountSchiedsrichterEinwilligung(FLSchiedsrichterSelfPerson):
    """One referee record on the account page: the stored data its box shows and the consent the page moves."""

    einwilligung: FLAccountEinwilligung
    evidence_state: FLEinwilligungStand
    givable: bool
    media_offered: bool
    media_minimum_age: int = Field(gt=0)


class FLAccountSeatEinwilligung(BaseModel):
    """One team season on which the address holds a confirmed contact seat, with its WhatsApp and media choices.

    Per season row and not per slot: one person holding two of a row's slots answers one choice for both.
    """

    team_id: CustomObjectId
    # The season row's own name: a past season is listed as it was played.
    team_name: str
    saison_id: str
    # Never empty: an entry exists for a held seat alone, and the published floor is what the page parses against.
    rollen: list[FLKontaktRolle] = Field(min_length=1)
    # Each on where any held slot's is, so a withdrawal stays offered.
    umfang: FLKontaktKenntnisnahmeUmfang
    media: bool
    # Over every held slot, for `FLAccountSpielerEinwilligung.evidence_state`'s reason.
    evidence_state: FLEinwilligungStand
    media_offered: bool
    givable: bool
    # One per entry: the control's own words name the media floor every held seat shares.
    media_minimum_age: int = Field(gt=0)


class FLAccountBewerbungSeatEinwilligung(BaseModel):
    """One pending application on which the address holds a confirmed contact seat, with its two choices to withdraw.

    Pending alone: an accepted application's seats are its season row's, listed under `seats`.
    """

    bewerbung_id: CustomObjectId
    # The school as the application names it, or the picked club's own name today.
    schule: str
    saison_id: str
    # For `FLAccountSeatEinwilligung.rollen`'s reason.
    rollen: list[FLKontaktRolle] = Field(min_length=1)
    # For `FLAccountSeatEinwilligung`'s reasons.
    umfang: FLKontaktKenntnisnahmeUmfang
    media: bool
    evidence_state: FLEinwilligungStand


class FLAccountRegistrierungEinwilligung(BaseModel):
    """One pending registration its pupil confirmed: its choices to withdraw, and what it stores."""

    registrierung_id: CustomObjectId
    # The club's own name, today; null where its document is gone.
    team_name: str | None
    saison_id: str
    # Both null on a returning pupil's registration, which asked none: the page shows its stored data
    # and offers no consent control, the person's own record holding their choices.
    umfang: FLEinwilligungUmfang | None
    media: bool | None
    evidence_state: FLEinwilligungStand
    # As the registration stores them: the facts the account page's box names its pupil by.
    vorname: str
    nachname: str
    geburtsdatum: CustomOptionalDateString


class FLAccountAddressChangeOpen(BaseModel):
    """The address's live change as its own account page reads it."""

    # What the approval names, so a tab drawn before a later start approves nothing it never showed.
    id: CustomObjectId
    # Whole where the person typed it on this page; masked where an administrator started the change, which may be a
    # pretext whose target the holder of the address on file must not learn (`app/api/address_change/services.py :: masked_address`).
    email: str
    way: FLAddressChangeWay
    waits_on: FLAddressChangeWaitsOn
    valid_until: FLUtcInstant | None
    effective_from: FLUtcInstant | None
    approval: FLAddressChangeApprovalState | None
    # Judged as the hourly pass ends one, so the page closes a lapsed step's press without a clock of its own.
    expired: bool


class FLAccountAddressChangeResponse(BaseAPIResponse):
    """The change pending on the signed-in address."""

    open: FLAccountAddressChangeOpen | None


class FLAccountAddressChangePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: CustomEmail


class FLAccountAddressChangeMintResponse(BaseAPIResponse):
    """The change a start wrote: no link is answered, the one owed the address on file waiting in the Postausgang."""

    id: CustomObjectId
    valid_until: FLUtcInstant
    # The change's new address, which that link asks the address on file about.
    email: str


class FLAccountEinwilligungenResponse(BaseAPIResponse):
    """Every confirmed consent record the signed-in address holds, for the account page; empty where it holds none.

    The referees a list where the pupil is one: `spieler.email` is unique, a referee's typed address is not.
    """

    spieler: FLAccountSpielerEinwilligung | None
    schiedsrichter: list[FLAccountSchiedsrichterEinwilligung]
    seats: list[FLAccountSeatEinwilligung]
    # Withdraw-only on the page: nothing on an application grants a panel to answer a grant against.
    bewerbungen: list[FLAccountBewerbungSeatEinwilligung]
    # Withdraw-only too, until the admission makes the pupil's own record the place for a grant.
    registrierungen: list[FLAccountRegistrierungEinwilligung]
