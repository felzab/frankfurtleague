from typing import Annotated, Any

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints

from app.shared.folding import refuse_a_domain_beyond_ascii, trimmed
from app.shared.schemas.bounds import ERASURE_REASON_MAX_LENGTH, KONTAKT_EMAIL_MAX_LENGTH, REFERENCES_ADDRESSES_MAX
from app.shared.schemas.custom import SINGLE_LINE_PATTERN, CustomDateString, CustomObjectId, FLUtcInstant
from app.shared.schemas.kontakt import CustomEmail

# The wire's spelling of the three seats, imported rather than restated: a second closed set here
# would name a seat no other endpoint publishes.
from app.shared.schemas.literals import FLAdminTier, FLKontaktRolle, FLSaisonStatus
from app.shared.schemas.responses import BaseAPIResponse


class FLSubjectPayload(BaseModel):
    """Which mailbox is asking, folded to the one spelling the join, the header and the log agree on."""

    model_config = ConfigDict(extra="forbid")

    # In the BODY and on no path or query: an address in a URL reaches the edge's access line, which
    # the rule keeps a credential out of and an identifier is no better in.
    email: CustomEmail


class FLSubjectSeat(BaseModel):
    """One contact seat the mailbox holds on a season's junction row.

    Per seat and never per person, as the erasure's `FLAccountErasureSeat` is: one row seats one
    person twice where `trainer_is_also` says so.
    """

    saison_id: str
    team_id: CustomObjectId
    # The contact-seat sense of the word, never the captaincy's, which `docs/glossary.md` holds
    # apart (`app/api/spieler/schemas.py :: FLSpielerRolle`).
    rolle: FLKontaktRolle
    # The junction row's own name and code, the ones the club was PLAYED under:
    # a club renamed since is still named here as its seats were held.
    team_name: str
    team_shorthand: str
    # The one read this lookup makes of `saisons`. The current-season narrowing is the caller's, and
    # the status is what lets it narrow from this answer rather than from a second round trip.
    saison_status: FLSaisonStatus
    # The season's span, which a frame names it by: a seat on a `future` season grants a panel, and no public read
    # serves that season.
    saison_start_date: CustomDateString
    saison_end_date: CustomDateString


class FLSubjectSpieler(BaseModel):
    """One pupil record the mailbox names.

    The id alone: the caller composed the address it asked about, and anything else here hands a
    machine read a fresh copy of somebody's own data for nothing.
    """

    spieler_id: CustomObjectId


class FLSubjectSchiedsrichter(BaseModel):
    """One referee record the mailbox names, carrying the id alone for `FLSubjectSpieler`'s reason."""

    schiedsrichter_id: CustomObjectId


class FLSubject(BaseModel):
    """Which confirmed, live records one mailbox matches, as three lists rather than three optional records.

    One person holds seats at two clubs, and nothing enforces one pupil record per address
    (`docs/datenschutz.md :: "One address is one person"`).
    """

    seats: list[FLSubjectSeat]
    spieler: list[FLSubjectSpieler]
    schiedsrichter: list[FLSubjectSchiedsrichter]
    # Its own field and never read off empty lists: set, the mailbox holds records that could grant a
    # panel and none is confirmed, which empty lists alone would report as nothing held.
    unconfirmed: bool


class FLSubjectResponse(FLSubject, BaseAPIResponse):
    """Which confirmed, live records one mailbox matches, and the grant it holds."""

    # The grant this mailbox holds, or null: stored, where the lists beside it are derived, so it is
    # the endpoint's alone: no person endpoint authorises against it.
    admin_tier: FLAdminTier | None
    # Null exactly where `admin_tier` is.
    granted_since: FLUtcInstant | None


class FLSignIn(BaseModel):
    """What the records one mailbox holds say about its sign-in."""

    # `FLSubject`'s own flag, from the same judgement.
    unconfirmed: bool
    # Whether the account page serves the mailbox anything, a Funktion or not: a person holding only
    # a retired record or a pending application still has a consent there to take back.
    account: bool


class FLSignInResponse(FLSignIn, BaseAPIResponse):
    """The sign-in gate's whole answer: the records' two flags, the ban and the grant, and no record itself.

    The ban narrows neither flag: whether a barred person signs in is the gate's to decide.
    """

    barred: bool
    admin_tier: FLAdminTier | None


class FLErasure(BaseModel):
    """How many of each kind of record one erasure removed or emptied, zero for a kind the address held none of."""

    spieler: int = Field(ge=0)
    saison_spieler: int = Field(ge=0)
    schiedsrichter: int = Field(ge=0)
    # The fixtures moved onto the ghost, which stay as the league's record of the match.
    spiele: int = Field(ge=0)
    # Per seat and never per row, as both reveals name them: one row seats one person twice.
    kontakt_seats: int = Field(ge=0)
    registrierungen: int = Field(ge=0)
    # Another address's pending change naming this one, ended alone: the records it would move stay that address's.
    address_change: int = Field(ge=0)
    # The person's own grants, a dead spelling of their address among them.
    grants: int = Field(ge=0)


class FLErasureResponse(FLErasure, BaseAPIResponse):
    pass


class FLAccountErasureSpieler(BaseModel):
    first_name: str
    last_name: str | None


class FLAccountErasureSchiedsrichter(BaseModel):
    name: str | None


class FLAccountErasureSeat(BaseModel):
    """One seat on a team's season row, named as the row names it."""

    saison_id: str
    # The row's own name, the one the club played that season under.
    team_name: str
    rolle: FLKontaktRolle
    first_name: str
    last_name: str


class FLAccountErasureBewerbung(BaseModel):
    """One seat on an application, of any status."""

    saison_id: str
    rolle: FLKontaktRolle
    first_name: str
    last_name: str


class FLAccountErasureRegistrierung(BaseModel):
    """One registration, pending or declined."""

    saison_id: str
    # Null where no season row of that season names the registration's team, a replacement having repointed it.
    team_name: str | None
    first_name: str
    last_name: str


class FLAccountErasureView(BaseModel):
    """What an erasure of one address would remove, by kind and by name, and never an address or a birthdate."""

    spieler: list[FLAccountErasureSpieler]
    schiedsrichter: list[FLAccountErasureSchiedsrichter]
    seats: list[FLAccountErasureSeat]
    bewerbungen: list[FLAccountErasureBewerbung]
    registrierungen: list[FLAccountErasureRegistrierung]
    # A count and no name: each is another address's pending change whose link reached this mailbox.
    address_change: int = Field(ge=0)


class FLAccountErasureViewResponse(FLAccountErasureView, BaseAPIResponse):
    # The tier of the live grant the address holds, read in the preview's snapshot as the press reads it.
    admin_tier: FLAdminTier | None


class FLReferencesPayload(BaseModel):
    """The sign-in addresses a pass of the account sweep asks about."""

    model_config = ConfigDict(extra="forbid")

    # Each held to no address rule, nor to a length: one address refused refuses the whole batch, and every
    # pass asks again, so the sweep would delete nothing ever after.
    identifiers: list[str] = Field(min_length=1, max_length=REFERENCES_ADDRESSES_MAX)


class FLReferencesResponse(BaseAPIResponse):
    """Which of them nothing references, and nothing of the records that reference the others."""

    unreferenced: list[str]


# --- The ADMINISTRATOR's erasure on a mailed request, and its counts.


def _trimmed_as_the_page_trims(value: Any) -> Any:
    return trimmed(value) if isinstance(value, str) else value


# A lookup asking no more than any payload stores, an `@` within the stored ceiling: a record stored under an older rule
# stays erasable, a local part beyond ASCII among them. Its domain alone is held to ASCII, as every stored domain is, an
# international one in punycode: one typed in Unicode is refused with the address rule's own refusal rather than answered
# as holding nothing.
ErasureAddress = Annotated[
    str,
    StringConstraints(max_length=KONTAKT_EMAIL_MAX_LENGTH, pattern="@"),
    # Published, since no schema keyword carries the after-validator: a generated client would take the Unicode domain.
    Field(description="Its domain, after the last `@`, in ASCII alone, an international one in punycode; else `email_not_accepted`."),
    # Never `strip_whitespace`, whose set adds U+0085, which the page keeps: one spelling's records would be erased and
    # another spelling's sign-in account left (`fl_backend/tests/shared/test_email_address.py`).
    BeforeValidator(_trimmed_as_the_page_trims),
    AfterValidator(refuse_a_domain_beyond_ascii),
]


class FLErasureAddressPayload(BaseModel):
    """The mailbox an erasure or its counts are looked up by."""

    model_config = ConfigDict(extra="forbid")

    # In the BODY for `FLSubjectPayload`'s reason.
    email: ErasureAddress


class FLErasurePayload(FLErasureAddressPayload):
    """The mailbox, and the reference to the request the erasure answers, free text the log's row keeps."""

    # The ceiling counts what arrives and the strip runs after it, so the published `maxLength` is the one the write keeps.
    reason: Annotated[
        str,
        StringConstraints(max_length=ERASURE_REASON_MAX_LENGTH, pattern=SINGLE_LINE_PATTERN),
        AfterValidator(str.strip),
        StringConstraints(min_length=1),
    ]


class FLErasureViewResponse(BaseAPIResponse):
    """What the administrator's erasure of one address reaches, counted and never named, so the confirmation shows no person."""

    spieler: int = Field(ge=0)
    schiedsrichter: int = Field(ge=0)
    # Per seat, as `FLErasure` counts one.
    kontakt_seats: int = Field(ge=0)
    bewerbung_seats: int = Field(ge=0)
    registrierungen: int = Field(ge=0)
    # The fixtures still to be played that book a referee row, each needing a new referee afterwards.
    spiele: int = Field(ge=0)
    # The address's own live change, and each other address's naming it that this administrator may see.
    address_change: int = Field(ge=0)
    grants: int = Field(ge=0)


class FLErasureSweepParams(BaseModel):
    """Where in one pass the call starts: after the pupil the call before it reached, or at the lowest id where none is named."""

    after: CustomObjectId | None = None


class FLErasureSweepResponse(BaseAPIResponse):
    """One call's share of the season-after rule: what it erased, whom it passed over, and how many are still due."""

    # The latest `past` season, which the rule keeps a squad row in; null where none is `past`, nobody then being due.
    completed_saison_id: str | None
    spieler: int
    saison_spieler: int
    registrierungen: int
    # Due when the call read them and not in their own transaction: a squad row or a registration arrived between.
    skipped: int
    failed: int
    # The failed among them: a person whose erasure failed stays due, so a caller looping on this alone never ends.
    remaining: int
    # The last pupil this call reached, for the next call's `after`; null once it reached the end, which ends the pass.
    after: CustomObjectId | None
