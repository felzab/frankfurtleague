from pydantic import BaseModel, Field

from app.api.bewerbungen.schemas import FLKontaktRolle
from app.api.schiedsrichter.schemas import FLSchiedsrichterSelbst
from app.api.spieler.schemas import FLSpielerSelbst
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.einwilligung import FLMedienStand
from app.shared.schemas.responses import BaseAPIResponse


class FLSitzKontext(BaseModel):
    """What the contact confirmation page's slots name for this seat today; `rolle` the first held slot's."""

    vorname: str | None
    team: str
    # The club's own name, today; null where its document is gone.
    schule: str | None
    saison: str
    rolle: FLKontaktRolle


class FLKontoSitzEinwilligung(BaseModel):
    """One team season on which the address holds a confirmed contact seat, with its media choice.

    Per season row and not per slot: one person holding two of a row's slots answers one choice for both.
    """

    team_id: CustomObjectId
    # The season row's own name (`docs/backend/spec.md :: I13`): a past season is listed as it was played.
    team_name: str
    saison_id: str
    # Never empty: an entry exists for a held seat alone, and the published floor is what the page parses against.
    rollen: list[FLKontaktRolle] = Field(min_length=1)
    # The first held slot's, for `app/api/spieler/schemas.py :: FLSpielerSelbst`'s reason.
    bestaetigt_text_version: str | None
    medien: bool
    # Over every held slot, for `app/api/spieler/schemas.py :: FLSpielerSelbst`'s reason.
    nachweis_stand: FLMedienStand
    medien_angeboten: bool
    erteilbar: bool
    kontext: FLSitzKontext


class FLKontoBewerbungSitzEinwilligung(BaseModel):
    """One pending application on which the address holds a confirmed contact seat, with its media choice to withdraw.

    Pending alone: an accepted application's seats are its season row's, listed under `sitze`.
    """

    bewerbung_id: CustomObjectId
    # The school as the application names it, or the picked club's own name today.
    schule: str
    saison_id: str
    # For `FLKontoSitzEinwilligung.rollen`'s reason.
    rollen: list[FLKontaktRolle] = Field(min_length=1)
    # For `FLKontoSitzEinwilligung`'s reasons.
    bestaetigt_text_version: str | None
    medien: bool
    nachweis_stand: FLMedienStand
    kontext: FLSitzKontext


class FLKontoEinwilligungenResponse(BaseAPIResponse):
    """Every confirmed consent record the signed-in address holds, for the account page; empty where it holds none.

    The referees a list where the pupil is one: `spieler.email` is unique, a referee's typed address is not.
    """

    spieler: FLSpielerSelbst | None
    schiedsrichter: list[FLSchiedsrichterSelbst]
    sitze: list[FLKontoSitzEinwilligung]
    # Withdraw-only on the page: nothing on an application grants a panel to answer a grant against.
    bewerbungen: list[FLKontoBewerbungSitzEinwilligung]
