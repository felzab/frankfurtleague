from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

from app.api.berechtigungen.schemas import FLUtcInstant, FLVerwaltung

# The wire's spelling of the three seats, imported rather than restated as
# `app/api/kontakte/schemas.py` imports it: a second closed set here would name a seat no other
# endpoint publishes.
from app.api.bewerbungen.schemas import FLKontaktRolle
from app.api.saisons.schemas import FLSaisonStatus
from app.shared.schemas.bounds import KONTAKT_EMAIL_MAX_LENGTH
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


class FLSubjekt(BaseModel):
    """Which confirmed, live records one mailbox matches, as three lists rather than three optional records.

    One person holds seats at two clubs, and nothing enforces one pupil record per address
    (`docs/datenschutz.md :: "One address is one person"`).
    """

    sitze: list[FLSubjektSitz]
    spieler: list[FLSubjektSpieler]
    schiedsrichter: list[FLSubjektSchiedsrichter]
    # Its own field and never read off empty lists: set, the mailbox holds records that could grant a
    # panel and none is confirmed, which empty lists alone would report as nothing held
    # (`docs/backend/spec.md :: I374`).
    unbestaetigt: bool


class FLSubjektResponse(FLSubjekt, BaseAPIResponse):
    """Which confirmed, live records one mailbox matches, and whether the address is on the ban list.

    The ban narrows none of the records: whether a barred person signs in is the sign-in gate's to decide.
    """

    # The endpoint's alone and not `FLSubjekt`'s: a person endpoint judging a Funktion reads the
    # records, and the ban is keyed under a secret only this operation needs (`docs/backend/spec.md :: I389`).
    gesperrt: bool
    # The grant this mailbox holds, or null: stored, where the lists beside it are derived, so it is
    # the endpoint's alone for `gesperrt`'s reason too -- no person endpoint authorises against it.
    verwaltung: FLVerwaltung | None
    # Null exactly where `verwaltung` is. Named for the grant and not the tier: a tier change leaves it
    # where it stands (`docs/backend/spec.md :: I525`).
    berechtigt_seit: FLUtcInstant | None
    # Null exactly where `verwaltung` is not `owner`: a session older than it administers and holds no
    # owner's power (`docs/backend/spec.md :: I534`).
    inhaber_seit: FLUtcInstant | None


class FLAnmeldung(BaseModel):
    """What the records one mailbox holds say about its sign-in."""

    # `FLSubjekt`'s own flag, from the same judgement.
    unbestaetigt: bool
    # Whether the account page serves the mailbox anything, a Funktion or not: a person holding only
    # a retired record or a pending application still has a consent there to take back.
    konto: bool


class FLAnmeldungResponse(FLAnmeldung, BaseAPIResponse):
    """The sign-in gate's whole answer: the records' two flags, the ban and the grant, and no record itself.

    The ban narrows neither flag: whether a barred person signs in is the gate's to decide.
    """

    gesperrt: bool
    verwaltung: FLVerwaltung | None


class FLGesperrtPayload(BaseModel):
    """The one address a message is about to go to."""

    model_config = ConfigDict(extra="forbid")

    # Held to no address rule, as the erasure's lookup is: a seat stored under an older rule is still
    # mailed, and refusing it here would close the mailer on an address no ban can key.
    email: Annotated[str, StringConstraints(max_length=KONTAKT_EMAIL_MAX_LENGTH, pattern="@")]


class FLGesperrtResponse(BaseAPIResponse):
    """Whether a standing ban holds that address, and nothing of any record: the mailer needs none."""

    gesperrt: bool
