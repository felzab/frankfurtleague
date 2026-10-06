from pydantic import BaseModel, Field

from app.api.bewerbungen.schemas import FLKontaktRolle
from app.api.schiedsrichter.schemas import FLSchiedsrichterSelbst
from app.api.spieler.schemas import FLEinwilligungUmfang, FLSpielerKontext, FLSpielerPosition, FLSpielerSelbst, FLSpielerStufe
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

    spieler: FLSpielerSelbst | None
    schiedsrichter: list[FLSchiedsrichterSelbst]
    sitze: list[FLKontoSitzEinwilligung]
    # Withdraw-only on the page: nothing on an application grants a panel to answer a grant against.
    bewerbungen: list[FLKontoBewerbungSitzEinwilligung]
    # Withdraw-only too, until the admission makes the pupil's own record the place for a grant.
    registrierungen: list[FLKontoRegistrierungEinwilligung]
