from pydantic import BaseModel, Field

from app.api.bewerbungen.schemas import FLKontaktRolle
from app.api.schiedsrichter.schemas import FLSchiedsrichterKontext, FLSchiedsrichterSelbst
from app.api.spieler.schemas import FLEinwilligung, FLEinwilligungUmfang, FLSpielerKontext, FLSpielerPosition, FLSpielerSelbst, FLSpielerStufe
from app.api.teams.schemas import FLKontaktKenntnisnahmeUmfang
from app.shared.schemas.custom import CustomObjectId, CustomOptionalDateString
from app.shared.schemas.einwilligung import FLEinwilligungStand
from app.shared.schemas.responses import BaseAPIResponse


class FLSitzKontext(BaseModel):
    """What the contact confirmation page's slots name for this seat today."""

    vorname: str | None
    team: str
    # The club's own name, today; null where its document is gone.
    schule: str | None
    saison: str


class FLKontoSpielerEinwilligung(FLSpielerSelbst):
    """The pupil's record on the account page: its stored data and the consent the page moves."""

    inactive_since: CustomOptionalDateString
    # Required: only a confirmed record is served, so the block is always there.
    einwilligung: FLEinwilligung
    # The block's `text_version` under the name the page reads it by: the words shown read-only beside the
    # control are the ones confirmed, never an account-page press's.
    bestaetigt_text_version: str | None
    # What the consent PATCH echoes back, computed by the function its precondition compares with.
    nachweis_stand: FLEinwilligungStand
    # Served rather than derived on the page, which would judge a grant with a second copy of the rule.
    erteilbar: bool
    medien_angeboten: bool
    # The floors the record's confirmation page named, so the page fills its words from the rule.
    mindestalter: int
    medien_mindestalter: int
    kontext: FLSpielerKontext


class FLKontoSchiedsrichterEinwilligung(FLSchiedsrichterSelbst):
    """One referee record on the account page, for `FLKontoSpielerEinwilligung`'s reasons."""

    inactive_since: CustomOptionalDateString
    einwilligung: FLEinwilligung
    bestaetigt_text_version: str | None
    nachweis_stand: FLEinwilligungStand
    erteilbar: bool
    medien_angeboten: bool
    mindestalter: int
    medien_mindestalter: int
    kontext: FLSchiedsrichterKontext


class FLSitzBestaetigt(BaseModel):
    """One confirmation a person gave on a row: the seats it answered, its words and the floor its page named."""

    rollen: list[FLKontaktRolle] = Field(min_length=1)
    text_version: str | None
    bestaetigt_am: CustomOptionalDateString
    # The age floor that page named over these roles, which the page fills `{minAlter}` from.
    mindestalter: int
    kontext: FLSitzKontext


class FLKontoSitzEinwilligung(BaseModel):
    """One team season on which the address holds a confirmed contact seat, with its WhatsApp and media choices.

    Per season row and not per slot: one person holding two of a row's slots answers one choice for both.
    """

    team_id: CustomObjectId
    # The season row's own name (`docs/backend/spec.md :: I13`): a past season is listed as it was played.
    team_name: str
    saison_id: str
    # Never empty: an entry exists for a held seat alone, and the published floor is what the page parses against.
    rollen: list[FLKontaktRolle] = Field(min_length=1)
    # Each on where any held slot's is, so a withdrawal stays offered.
    umfang: FLKontaktKenntnisnahmeUmfang
    medien: bool
    # Over every held slot, for `app/api/spieler/schemas.py :: FLSpielerSelbst`'s reason.
    nachweis_stand: FLEinwilligungStand
    medien_angeboten: bool
    erteilbar: bool
    # Never empty, a held seat being a confirmed one.
    bestaetigt: list[FLSitzBestaetigt] = Field(min_length=1)
    # One per entry: every confirmation and the control's own words name the same media floor.
    medien_mindestalter: int


class FLKontoBewerbungSitzEinwilligung(BaseModel):
    """One pending application on which the address holds a confirmed contact seat, with its two choices to withdraw.

    Pending alone: an accepted application's seats are its season row's, listed under `sitze`.
    """

    bewerbung_id: CustomObjectId
    # The school as the application names it, or the picked club's own name today.
    schule: str
    saison_id: str
    # For `FLKontoSitzEinwilligung.rollen`'s reason.
    rollen: list[FLKontaktRolle] = Field(min_length=1)
    # For `FLKontoSitzEinwilligung`'s reasons.
    umfang: FLKontaktKenntnisnahmeUmfang
    medien: bool
    nachweis_stand: FLEinwilligungStand
    bestaetigt: list[FLSitzBestaetigt] = Field(min_length=1)
    # One per entry: every confirmation and the control's own words name the same media floor.
    medien_mindestalter: int


class FLKontoRegistrierungEinwilligung(BaseModel):
    """One pending registration its pupil confirmed: its choices to withdraw, and what it stores."""

    registrierung_id: CustomObjectId
    team_id: CustomObjectId
    # The club's own name, today; null where its document is gone.
    team_name: str | None
    saison_id: str
    bestaetigt_text_version: str | None
    # Both null on a returning pupil's registration, which asked none: the page shows its stored data
    # and offers no consent control, the person's own record holding their choices.
    umfang: FLEinwilligungUmfang | None
    medien: bool | None
    nachweis_stand: FLEinwilligungStand
    # For `app/api/spieler/schemas.py :: FLSpielerSelbst`'s reason.
    mindestalter: int
    # For `app/api/spieler/schemas.py :: FLSpielerSelbst`'s reason.
    medien_mindestalter: int
    # What the pupil's confirmation page filled its words with, read today.
    kontext: FLSpielerKontext
    # As the registration stores them: the account page shows what is kept about the pupil.
    vorname: str
    nachname: str
    geburtsdatum: CustomOptionalDateString
    nummer: str | None
    position: FLSpielerPosition | None
    stufe: FLSpielerStufe | None


class FLKontoEinwilligungenResponse(BaseAPIResponse):
    """Every confirmed consent record the signed-in address holds, for the account page; empty where it holds none.

    The referees a list where the pupil is one: `spieler.email` is unique, a referee's typed address is not.
    """

    spieler: FLKontoSpielerEinwilligung | None
    schiedsrichter: list[FLKontoSchiedsrichterEinwilligung]
    sitze: list[FLKontoSitzEinwilligung]
    # Withdraw-only on the page: nothing on an application grants a panel to answer a grant against.
    bewerbungen: list[FLKontoBewerbungSitzEinwilligung]
    # Withdraw-only too, until the admission makes the pupil's own record the place for a grant.
    registrierungen: list[FLKontoRegistrierungEinwilligung]
