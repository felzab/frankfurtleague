from pydantic import BaseModel, ConfigDict, Field

from app.api.schiedsrichter.schemas import FLSchiedsrichterSelfPerson
from app.api.spieler.schemas import FLSpielerSelfPerson
from app.shared.schemas.custom import CustomObjectId, CustomOptionalDateString, FLUtcInstant
from app.shared.schemas.einwilligung import FLEinwilligungState
from app.shared.schemas.kontakt import CustomEmail
from app.shared.schemas.literals import (
    FLAddressChangeWaitsOn,
    FLAddressChangeWay,
    FLAdminTier,
    FLEinwilligungScope,
    FLKontaktKenntnisnahmeScope,
    FLKontaktRolle,
)
from app.shared.schemas.responses import BaseAPIResponse


class FLAccountEinwilligung(BaseModel):
    """A person's own record's two consent choices."""

    scope: FLEinwilligungScope
    media: bool


class FLAccountSpielerEinwilligung(FLSpielerSelfPerson):
    """The signed-in pupil's own record: its stored data and its consent."""

    # Required: only a confirmed record is served, so the block is always there.
    einwilligung: FLAccountEinwilligung
    # What the consent PATCH echoes back, computed by the function its precondition compares with.
    evidence_state: FLEinwilligungState
    # Whether the media consent may be switched on, by the person's age today.
    media_offered: bool


class FLAccountSchiedsrichterEinwilligung(FLSchiedsrichterSelfPerson):
    """One of the signed-in person's referee records: its stored data, its fee and its consent."""

    default_payment: int
    einwilligung: FLAccountEinwilligung
    evidence_state: FLEinwilligungState
    # Whether the record admits a grant.
    givable: bool
    media_offered: bool


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
    scope: FLKontaktKenntnisnahmeScope
    media: bool
    # Over every held slot.
    evidence_state: FLEinwilligungState
    media_offered: bool
    givable: bool


class FLAccountBewerbungSeatEinwilligung(BaseModel):
    """One pending application on which the address holds a confirmed contact seat, with its two choices to withdraw.

    Pending alone: an accepted application's seats are its season row's, listed under `seats`.
    """

    bewerbung_id: CustomObjectId
    # The school as the application names it, or the picked club's own name today.
    schule: str
    saison_id: str
    rollen: list[FLKontaktRolle] = Field(min_length=1)
    scope: FLKontaktKenntnisnahmeScope
    media: bool
    evidence_state: FLEinwilligungState


class FLAccountRegistrierungEinwilligung(BaseModel):
    """One pending registration its pupil confirmed: its choices to withdraw, and what it stores."""

    registrierung_id: CustomObjectId
    # The club's own name, today; null where its document is gone.
    team_name: str | None
    saison_id: str
    scope: FLEinwilligungScope
    media: bool
    evidence_state: FLEinwilligungState
    # As the registration stores them: the facts the account page's box names its pupil by.
    first_name: str
    last_name: str
    birth_date: CustomOptionalDateString


class FLAccountAddressChangeOpen(BaseModel):
    """The signed-in address's live change."""

    id: CustomObjectId
    # Whole where the person typed it on this page; masked where an administrator started the change, which may be a
    # pretext whose target the holder of the address on file must not learn.
    email: str
    way: FLAddressChangeWay
    waits_on: FLAddressChangeWaitsOn
    valid_until: FLUtcInstant | None
    effective_from: FLUtcInstant | None
    # Judged as the hourly pass ends one, so the page closes a lapsed step's press without a clock of its own.
    expired: bool


class FLAccountAddressChangeResponse(BaseAPIResponse):
    """The change pending on the signed-in address."""

    open: FLAccountAddressChangeOpen | None
    # The tier whose wait a change of this address serves, `None` for an address holding no grant. Never the stored
    # `admin_tier`, which the erasure lock reads: a row a handover names waits the owner's.
    wait_tier: FLAdminTier | None


class FLAccountAddressChangePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: CustomEmail


class FLAccountAddressChangeMintResponse(BaseAPIResponse):
    """The change started, whose link reaches the address on file by mail alone."""

    id: CustomObjectId
    valid_until: FLUtcInstant
    # The change's new address, which that link asks the address on file about.
    email: str


class FLAccountEinwilligungenResponse(BaseAPIResponse):
    """Every confirmed consent record the signed-in address holds, empty where it holds none.

    The referees a list where the pupil is one: `spieler.email` is unique, a referee's typed address is not.
    """

    spieler: FLAccountSpielerEinwilligung | None
    schiedsrichter: list[FLAccountSchiedsrichterEinwilligung]
    seats: list[FLAccountSeatEinwilligung]
    # Withdraw-only on the page: nothing on an application grants a panel to answer a grant against.
    bewerbungen: list[FLAccountBewerbungSeatEinwilligung]
    # Withdraw-only too, until the admission makes the pupil's own record the place for a grant.
    registrierungen: list[FLAccountRegistrierungEinwilligung]
