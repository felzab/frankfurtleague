from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints

from app.api.berechtigungen.schemas import FLUtcInstant

# The wire's spelling of the three seats, imported rather than restated: a second closed set here
# would name a seat no other endpoint publishes.
from app.api.sperrliste.schemas import ADDRESS_IN_FREE_TEXT
from app.shared.folding import trimmed
from app.shared.schemas.bounds import ERASURE_ANLASS_MAX_LENGTH, KONTAKT_EMAIL_MAX_LENGTH, REFERENZEN_ADRESSEN_MAX
from app.shared.schemas.custom import SINGLE_LINE_PATTERN, CustomObjectId, CustomOptionalDateString
from app.shared.schemas.kontakt import CustomEmail
from app.shared.schemas.literals import FLAdresswechselEinsehbarVerwehrt, FLKontaktRolle, FLRegistrierungStatus, FLSaisonStatus, FLVerwaltung
from app.shared.schemas.responses import BaseAPIResponse


class FLSubjektPayload(BaseModel):
    """Which mailbox is asking, folded to the one spelling the join, the header and the log agree on."""

    model_config = ConfigDict(extra="forbid")

    # In the BODY and on no path or query: an address in a URL reaches the edge's access line, which
    # the rule keeps a credential out of and an identifier is no better in.
    email: CustomEmail


class FLSubjektSitz(BaseModel):
    """One contact seat the mailbox holds on a season's junction row.

    Per seat and never per person, as the erasure's `FLSelbstErasureSitz` is: one row seats one
    person twice where `trainer_ist_zugleich` says so.
    """

    saison_id: str
    team_id: CustomObjectId
    # The contact-seat sense of the word, never the captaincy's, which `docs/glossary.md` holds
    # apart (`app/api/spieler/schemas.py :: FLSpielerRolle`).
    rolle: FLKontaktRolle
    # The junction row's own name, the one the club was PLAYED under:
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
    # panel and none is confirmed, which empty lists alone would report as nothing held.
    unbestaetigt: bool


class FLSubjektResponse(FLSubjekt, BaseAPIResponse):
    """Which confirmed, live records one mailbox matches, and whether the address is on the ban list.

    The ban narrows none of the records: whether a barred person signs in is the sign-in gate's to decide.
    """

    # The endpoint's alone and not `FLSubjekt`'s: a person endpoint judging a Funktion reads the
    # records, and the ban is keyed under a secret only this operation needs.
    gesperrt: bool
    # The grant this mailbox holds, or null: stored, where the lists beside it are derived, so it is
    # the endpoint's alone for `gesperrt`'s reason too -- no person endpoint authorises against it.
    verwaltung: FLVerwaltung | None
    # Null exactly where `verwaltung` is. Named for the grant and not the tier: a tier change leaves it
    # where it stands.
    berechtigt_seit: FLUtcInstant | None
    # Null exactly where `verwaltung` is not `owner`: a session older than it administers and holds no
    # owner's power.
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


class FLErasure(BaseModel):
    """How many of each kind of record one erasure removed or emptied, zero for a kind the address held none of.

    Records alone: an emptied log row is no record of the person's, and two passes may reach one.
    """

    spieler: int = Field(ge=0)
    saison_spieler: int = Field(ge=0)
    schiedsrichter: int = Field(ge=0)
    # The fixtures moved onto the ghost, which stay as the league's record of the match.
    spiele: int = Field(ge=0)
    # Per seat and never per row, as both reveals name them: one row seats one person twice.
    kontakt_sitze: int = Field(ge=0)
    registrierungen: int = Field(ge=0)
    # Another address's pending change naming this one, ended alone: the records it would move stay that address's.
    adresswechsel: int = Field(ge=0)
    # The person's own grants, a dead spelling of their address among them.
    berechtigungen: int = Field(ge=0)
    # Every request about the address or made by it, a lapsed one among them.
    berechtigungen_antraege: int = Field(ge=0)


class FLErasureResponse(FLErasure, BaseAPIResponse):
    pass


class FLSelbstErasureSpieler(BaseModel):
    vorname: str
    nachname: str | None


class FLSelbstErasureSchiedsrichter(BaseModel):
    name: str | None


class FLSelbstErasureSitz(BaseModel):
    """One seat on a team's season row, named as the row names it."""

    saison_id: str
    # The row's own name, the one the club played that season under.
    team_name: str
    rolle: FLKontaktRolle
    vorname: str
    nachname: str


class FLSelbstErasureBewerbung(BaseModel):
    """One seat on an application, of any status."""

    saison_id: str
    rolle: FLKontaktRolle
    vorname: str
    nachname: str


class FLSelbstErasureRegistrierung(BaseModel):
    """One registration, pending or declined."""

    saison_id: str
    # Null where no season row of that season names the registration's team, a replacement having repointed it.
    team_name: str | None
    vorname: str
    nachname: str


class FLSelbstErasureAnsicht(BaseModel):
    """What an erasure of one address would remove, by kind and by name, and never an address or a birthdate."""

    spieler: list[FLSelbstErasureSpieler]
    schiedsrichter: list[FLSelbstErasureSchiedsrichter]
    sitze: list[FLSelbstErasureSitz]
    bewerbungen: list[FLSelbstErasureBewerbung]
    registrierungen: list[FLSelbstErasureRegistrierung]
    # A count and no name: each is another address's pending change whose link reached this mailbox.
    adresswechsel: int = Field(ge=0)


class FLSelbstErasureAnsichtResponse(FLSelbstErasureAnsicht, BaseAPIResponse):
    # The tier of the live grant the address holds, read in the preview's snapshot as the press reads it.
    verwaltung: FLVerwaltung | None
    # Advisory: read apart from the erasure's transaction, whose own `REQ-PURGE-004` alone decides.
    letzter_inhaber: bool


class FLReferenzenPayload(BaseModel):
    """The sign-in addresses a pass of the account sweep asks about."""

    model_config = ConfigDict(extra="forbid")

    # Each held to no address rule, nor to a length: one address refused refuses the whole batch, and every
    # pass asks again, so the sweep would delete nothing ever after.
    identifiers: list[str] = Field(min_length=1, max_length=REFERENZEN_ADRESSEN_MAX)


class FLReferenzenResponse(BaseAPIResponse):
    """Which of them nothing references, and nothing of the records that reference the others."""

    unreferenziert: list[str]


# --- The ADMINISTRATOR's erasure on a mailed request, and its reveal.


def _trimmed_as_the_page_trims(value: Any) -> Any:
    return trimmed(value) if isinstance(value, str) else value


# A lookup asking no more than any payload stores, an `@` within the stored ceiling:
# a record stored under an older rule stays erasable.
ErasureAdresse = Annotated[
    str,
    StringConstraints(max_length=KONTAKT_EMAIL_MAX_LENGTH, pattern="@"),
    # Never `strip_whitespace`, whose set adds U+0085, which the page keeps: one spelling's records would be erased and
    # another spelling's sign-in account left (`fl_backend/tests/shared/test_email_address.py`).
    BeforeValidator(_trimmed_as_the_page_trims),
]

# German, as the ban's `grund` words its own, and like it read on the log line alone: the box words
# its own, held to this one's verdict by `fl_backend/tests/shared/erasure_refusals.json`.
ANLASS_HOLDS_AN_ADDRESS = "Der Anlass darf keine E-Mail-Adresse enthalten."


def refuse_an_address_in_the_anlass(value: str) -> str:
    """The log keeps `anlass` twelve months and no erasure's redaction reaches it, so an address typed here outlives the erasure it answers."""

    if ADDRESS_IN_FREE_TEXT.search(value) is not None:
        raise ValueError(ANLASS_HOLDS_AN_ADDRESS)

    return value


class FLErasureAdressePayload(BaseModel):
    """The mailbox an erasure, its preview or a sign-out of every session is looked up by."""

    model_config = ConfigDict(extra="forbid")

    # In the BODY for `FLSubjektPayload`'s reason.
    email: ErasureAdresse


class FLErasurePayload(FLErasureAdressePayload):
    """The mailbox, and the request the erasure answers, which every log row the erasure files keeps."""

    # The ceiling counts what arrives and the strip runs after it, so the published `maxLength` is the one the write keeps.
    anlass: Annotated[
        str,
        StringConstraints(max_length=ERASURE_ANLASS_MAX_LENGTH, pattern=SINGLE_LINE_PATTERN),
        AfterValidator(str.strip),
        StringConstraints(min_length=1),
        AfterValidator(refuse_an_address_in_the_anlass),
    ]


class FLErasureAnsichtKader(BaseModel):
    """One squad row of a pupil the erasure reaches."""

    saison_id: str
    team_id: CustomObjectId
    # The season row's name, null where no season row names the team that season.
    team_name: str | None
    # Null on a live row: a ban's dialog offers to take out only a row still in the squad.
    inactive_since: CustomOptionalDateString


class FLErasureAnsichtSpieler(FLSelbstErasureSpieler):
    spieler_id: CustomObjectId
    # A retired row too: the pupil's step removes every squad row of the person.
    kader: list[FLErasureAnsichtKader]


class FLErasureAnsichtSchiedsrichter(FLSelbstErasureSchiedsrichter):
    schiedsrichter_id: CustomObjectId
    # Null on a live row: a ban's dialog offers to retire only a referee still active.
    inactive_since: CustomOptionalDateString
    # Every season, in order, holding a fixture still to be played that this referee is booked on, as
    # `REQ-RETIRE-004` judges one: the fixture search opens on one season, so each is reached in its own.
    spiele_ohne_ergebnis_saison_ids: list[str]


class FLErasureAnsichtSitz(FLSelbstErasureSitz):
    team_id: CustomObjectId


class FLErasureAnsichtBewerbung(FLSelbstErasureBewerbung):
    bewerbung_id: CustomObjectId


class FLErasureAnsichtRegistrierung(FLSelbstErasureRegistrierung):
    registrierung_id: CustomObjectId
    team_id: CustomObjectId
    # The administrator's registrations list serves the pending ones alone, so a ban's dialog links no declined one.
    status: FLRegistrierungStatus


class FLErasureAnsichtAdresswechsel(BaseModel):
    """Another address's live change naming this one as its new address: the change ends, its address's records standing."""

    adresswechsel_id: CustomObjectId
    # Why the address tool refuses it this administrator, null where it opens it: the page links them there to discard it.
    einsehbar_verwehrt: FLAdresswechselEinsehbarVerwehrt | None


class FLErasureAnsichtEigenerAdresswechsel(BaseModel):
    """The address's own live change, which the erasure ends with the records it would move."""

    adresswechsel_id: CustomObjectId


FLErasureAntragRolle = Literal["betroffen", "gestellt"]


class FLErasureAnsichtAntrag(BaseModel):
    """An open request for a grant, about the address (`betroffen`) or made by it (`gestellt`), which the erasure removes."""

    antrag_id: CustomObjectId
    verwaltung: FLVerwaltung
    rolle: FLErasureAntragRolle


class FLErasureAnsicht(BaseModel):
    """What the administrator's erasure of one address reaches, by kind, name and the ids the page links by.

    Never an address or a birthdate, at any depth.
    """

    spieler: list[FLErasureAnsichtSpieler]
    schiedsrichter: list[FLErasureAnsichtSchiedsrichter]
    sitze: list[FLErasureAnsichtSitz]
    bewerbungen: list[FLErasureAnsichtBewerbung]
    registrierungen: list[FLErasureAnsichtRegistrierung]
    adresswechsel: list[FLErasureAnsichtAdresswechsel]
    eigener_adresswechsel: FLErasureAnsichtEigenerAdresswechsel | None
    antraege: list[FLErasureAnsichtAntrag]


class FLErasureAnsichtResponse(FLErasureAnsicht, BaseAPIResponse):
    # The tier of the live grant the address holds, which the erasure removes with the rest.
    verwaltung: FLVerwaltung | None
    # Whether a standing ban holds the address, which the erasure leaves standing: the ban's dialog refuses it before its press.
    gesperrt: bool


class FLAbmeldungResponse(BaseAPIResponse):
    """The envelope alone: the log row it filed names no address to answer with."""


class FLLoeschungLaufParams(BaseModel):
    """Where in one pass the call starts: after the pupil the call before it reached, or at the lowest id where none is named."""

    nach: CustomObjectId | None = None


class FLLoeschungLaufResponse(BaseAPIResponse):
    """One call's share of the season-after rule: what it erased, whom it passed over, and how many are still due."""

    # The latest `past` season, which the rule keeps a squad row in; null where none is `past`, nobody then being due.
    abgeschlossene_saison_id: str | None
    spieler: int
    saison_spieler: int
    registrierungen: int
    # Due when the call read them and not in their own transaction: a squad row or a registration arrived between.
    uebersprungen: int
    fehlgeschlagen: int
    # The failed among them: a person whose erasure failed stays due, so a caller looping on this alone never ends.
    verbleibend: int
    # The last pupil this call reached, for the next call's `nach`; null once it reached the end, which ends the pass.
    nach: CustomObjectId | None


class FLLoeschungVorschauResponse(BaseAPIResponse):
    """How many pupils the run erases once this season is activated, counted and never named."""

    # The season that activation turns `past`; null where none is `active` but the target.
    abgeschlossene_saison_id: str | None
    spieler: int
