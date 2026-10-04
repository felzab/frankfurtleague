from pydantic import BaseModel

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
    rollen: list[FLKontaktRolle]
    # The first held slot's, for `app/api/spieler/schemas.py :: FLSpielerSelbst`'s reason.
    bestaetigt_text_version: str | None
    medien: bool
    # Over every held slot, for `app/api/spieler/schemas.py :: FLSpielerSelbst`'s reason.
    nachweis_stand: FLMedienStand
    medien_angeboten: bool
    erteilbar: bool
    kontext: FLSitzKontext


class FLKontoEinwilligungenResponse(BaseAPIResponse):
    """Every confirmed consent record the signed-in address holds, for the account page; empty where it holds none.

    The referees a list where the pupil is one: `spieler.email` is unique, a referee's typed address is not.
    """

    spieler: FLSpielerSelbst | None
    schiedsrichter: list[FLSchiedsrichterSelbst]
    sitze: list[FLKontoSitzEinwilligung]
