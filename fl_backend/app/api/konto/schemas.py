from pydantic import BaseModel, ConfigDict, Field

from app.api.adresswechsel.schemas import FLAddressChangeApprovalStand
from app.api.berechtigungen.schemas import FLUtcInstant
from app.api.schiedsrichter.schemas import FLSchiedsrichterSelf
from app.api.spieler.schemas import FLEinwilligung, FLSpielerContext, FLSpielerSelf
from app.shared.schemas.custom import CustomObjectId, CustomOptionalDateString
from app.shared.schemas.einwilligung import FLEinwilligungStand
from app.shared.schemas.kontakt import CustomEmail
from app.shared.schemas.literals import (
    FLAddressChangeWaitsOn,
    FLAddressChangeWay,
    FLEinwilligungUmfang,
    FLKontaktKenntnisnahmeUmfang,
    FLKontaktRolle,
    FLSpielerPosition,
    FLSpielerStufe,
)
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel


class FLSeatContext(BaseModel):
    """What the contact confirmation page's slots name for this seat today."""

    vorname: str | None
    team: str
    # The club's own name, today; null where its document is gone.
    schule: str | None
    saison: str


class FLAccountSpielerEinwilligung(FLSpielerSelf):
    """The pupil's record on the account page: its stored data and the consent the page moves."""

    inactive_since: CustomOptionalDateString
    # Required: only a confirmed record is served, so the block is always there.
    einwilligung: FLEinwilligung
    # The block's `text_version` under the name the page reads it by: the words shown read-only beside the
    # control are the ones confirmed, never an account-page press's.
    confirmed_text_version: str
    # What the consent PATCH echoes back, computed by the function its precondition compares with.
    nachweis_stand: FLEinwilligungStand
    # Served rather than derived on the page, which would judge a grant with a second copy of the rule.
    givable: bool
    medien_offered: bool
    # The floors the record's confirmation page named, so the page fills its words from the rule.
    minimum_age: int
    medien_minimum_age: int = Field(gt=0)
    context: FLSpielerContext


class FLAccountSchiedsrichterEinwilligung(FLSchiedsrichterSelf, BaseReadModel):
    """One referee record on the account page: its stored data and the consent the page moves."""

    inactive_since: CustomOptionalDateString
    einwilligung: FLEinwilligung
    confirmed_text_version: str
    nachweis_stand: FLEinwilligungStand
    givable: bool
    medien_offered: bool
    minimum_age: int
    medien_minimum_age: int = Field(gt=0)


class FLSeatConfirmed(BaseModel):
    """One confirmation a person gave on a row: the seats it answered, its words and the floor its page named."""

    rollen: list[FLKontaktRolle] = Field(min_length=1)
    text_version: str
    confirmed_at: CustomOptionalDateString
    # The age floor that page named over these roles, which the page fills `{minAlter}` from.
    minimum_age: int
    context: FLSeatContext


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
    medien: bool
    # Over every held slot, for `app/api/spieler/schemas.py :: FLSpielerSelf`'s reason.
    nachweis_stand: FLEinwilligungStand
    medien_offered: bool
    givable: bool
    # Never empty, a held seat being a confirmed one.
    confirmed: list[FLSeatConfirmed] = Field(min_length=1)
    # One per entry: every confirmation and the control's own words name the same media floor.
    medien_minimum_age: int = Field(gt=0)


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
    medien: bool
    nachweis_stand: FLEinwilligungStand
    confirmed: list[FLSeatConfirmed] = Field(min_length=1)
    # One per entry: every confirmation and the control's own words name the same media floor.
    medien_minimum_age: int = Field(gt=0)


class FLAccountRegistrierungEinwilligung(BaseModel):
    """One pending registration its pupil confirmed: its choices to withdraw, and what it stores."""

    registrierung_id: CustomObjectId
    team_id: CustomObjectId
    # The club's own name, today; null where its document is gone.
    team_name: str | None
    saison_id: str
    confirmed_text_version: str
    # Both null on a returning pupil's registration, which asked none: the page shows its stored data
    # and offers no consent control, the person's own record holding their choices.
    umfang: FLEinwilligungUmfang | None
    medien: bool | None
    nachweis_stand: FLEinwilligungStand
    # For `app/api/spieler/schemas.py :: FLSpielerSelf`'s reason.
    minimum_age: int
    # For `app/api/spieler/schemas.py :: FLSpielerSelf`'s reason.
    medien_minimum_age: int = Field(gt=0)
    # What the pupil's confirmation page filled its words with, read today.
    context: FLSpielerContext
    # As the registration stores them: the account page shows what is kept about the pupil.
    vorname: str
    nachname: str
    geburtsdatum: CustomOptionalDateString
    nummer: str | None
    position: FLSpielerPosition | None
    stufe: FLSpielerStufe | None


class FLAccountAddressChangeOpen(BaseModel):
    """The address's live change as its own account page reads it."""

    # What the approval names, so a tab drawn before a later start approves nothing it never showed.
    id: CustomObjectId
    # Whole where the person typed it on this page; masked where an administrator started the change, which may be a
    # pretext whose target the holder of the address on file must not learn (`app/api/adresswechsel/services.py :: maskierte_adresse`).
    email: str
    way: FLAddressChangeWay
    waits_on: FLAddressChangeWaitsOn
    valid_until: FLUtcInstant | None
    effective_from: FLUtcInstant | None
    approval: FLAddressChangeApprovalStand | None
    # Judged as the hourly pass ends one, so the page closes a lapsed step's press without a clock of its own.
    expired: bool


class FLAccountAddressChangeResponse(BaseAPIResponse):
    """Whether the signed-in address may change, and the change pending on it."""

    # The address holds anything a change moves, a grant included.
    possible: bool
    open: FLAccountAddressChangeOpen | None


class FLAccountAddressChangePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: CustomEmail


class FLAccountAddressChangeMintResponse(BaseAPIResponse):
    """The change a start or an approval wrote, and the mailbox its link is owed in the Postausgang: no link is answered."""

    id: CustomObjectId
    valid_until: FLUtcInstant
    email: str


class FLAccountAddressChangeReleasePayload(BaseModel):
    """The change the page showed: an administrator's later start replaces it, and the approval then reaches nothing."""

    model_config = ConfigDict(extra="forbid")

    id: CustomObjectId


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
