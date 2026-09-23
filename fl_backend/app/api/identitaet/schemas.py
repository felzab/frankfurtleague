from pydantic import BaseModel, ConfigDict

# The wire's spelling of the three seats, imported rather than restated as
# `app/api/kontakte/schemas.py` imports it: a second closed set here would name a seat no other
# endpoint publishes.
from app.api.bewerbungen.schemas import FLKontaktRolle
from app.api.saisons.schemas import FLSaisonStatus
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.kontakt import CustomEmail
from app.shared.schemas.responses import BaseAPIResponse


class FLSubjektPayload(BaseModel):
    """Which mailbox is asking, folded to the one spelling the join, the header and the log agree on."""

    model_config = ConfigDict(extra="forbid")

    # In the BODY and on no path or query: an address in a URL reaches the edge's access line, which
    # `docs/logging/spec.md :: L11` keeps a credential out of and an identifier is no better in.
    email: CustomEmail


class FLSubjektSitz(BaseModel):
    """One contact seat the mailbox holds on a season's junction row.

    Per seat and never per person, as `app/api/kontakte/schemas.py :: FLKontaktSitz` is: one row
    seats one person twice where `trainer_ist_zugleich` says so.
    """

    saison_id: str
    team_id: CustomObjectId
    # The contact-seat sense of the word, never the captaincy's, which `docs/glossary.md` holds
    # apart (`app/api/spieler/schemas.py :: FLSpielerRolle`).
    rolle: FLKontaktRolle
    # The junction row's own name, the one the club was PLAYED under (`docs/backend/spec.md :: I13`):
    # a club renamed since is still named here as its seats were held.
    team_name: str
    # The one read this lookup makes of `saisons`. The current-season narrowing is the caller's, and
    # the status is what lets it narrow from this answer rather than from a second round trip.
    saison_status: FLSaisonStatus


class FLSubjektSpieler(BaseModel):
    """One pupil record the mailbox names.

    The id alone: the caller composed the address it asked about, and anything else here hands a
    machine read a fresh copy of somebody's own data for nothing.
    """

    spieler_id: CustomObjectId


class FLSubjektSchiedsrichter(BaseModel):
    """One referee record the mailbox names, carrying the id alone for `FLSubjektSpieler`'s reason."""

    schiedsrichter_id: CustomObjectId


class FLSubjektResponse(BaseAPIResponse):
    """Which league records one mailbox matches, as three lists rather than three optional records.

    A list under each because one inbox holds seats at two clubs and two pupils share an address
    (`docs/datenschutz.md :: "Colleagues sharing a school inbox"`).
    """

    sitze: list[FLSubjektSitz]
    spieler: list[FLSubjektSpieler]
    schiedsrichter: list[FLSubjektSchiedsrichter]
