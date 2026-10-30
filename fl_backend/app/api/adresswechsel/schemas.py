from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.api.adresswechsel.services import FLAdresswechselBisherigZustand, FLAdresswechselNeuZustand, FLAdresswechselVerwaltung
from app.api.berechtigungen.schemas import FLUtcInstant
from app.api.sperrliste.schemas import refuse_an_address_in_the_reason
from app.shared.schemas.bounds import BEWERBUNG_TOKEN_MAX_LENGTH, ERASURE_ANLASS_MAX_LENGTH, LIST_LIMIT_DEFAULT
from app.shared.schemas.custom import (
    SINGLE_LINE_PATTERN,
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomStrippedNonEmptyString,
)
from app.shared.schemas.kontakt import CustomEmail
from app.shared.schemas.literals import FLAdresswechselEndeArt, FLAdresswechselWartetAuf, FLAdresswechselWeg
from app.shared.schemas.responses import BaseAPIResponse
from app.shared.schemas.zustellung import FLBewerbungZustellung

type FLAdresswechselAntwort = Literal["bestaetigt", "abgelehnt"]

# The raw token as it arrives on the base-tier endpoints, under the one ceiling every link this application mints is spelled to.
CustomAdresswechselToken = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=BEWERBUNG_TOKEN_MAX_LENGTH)]

# How an administrator checked who asks, where the address on file is gone: the erasure occasion's ceiling, being
# copied onto the start's log row as that occasion is. An address typed here would outlive every redaction of the change.
# The ceiling counts what arrives and the strip runs after it, so the published `maxLength` is the one the write keeps.
CustomAdresswechselGrund = Annotated[
    str,
    StringConstraints(max_length=ERASURE_ANLASS_MAX_LENGTH, pattern=SINGLE_LINE_PATTERN),
    AfterValidator(str.strip),
    StringConstraints(min_length=1),
    AfterValidator(refuse_an_address_in_the_reason),
]


# --- The record as `adresswechsel` stores it.


class FLAdresswechselGenehmigung(BaseModel):
    """The approval a change moving a grant waits on."""

    verwaltung: FLAdresswechselVerwaltung
    angefragt_am: datetime
    bis: datetime
    gestartet_von: str
    genehmigt_am: datetime | None
    genehmigt_von: str | None


class FLAdresswechselBeendet(BaseModel):
    art: FLAdresswechselEndeArt
    am: datetime


class FLAdresswechselVersand(BaseModel):
    """The delivery carrier of the new mailbox's link (`app/api/zustellung/services.py :: ZIEL_PFADE`)."""

    zustellung: FLBewerbungZustellung | None = None


class FLAdresswechsel(BaseModel):
    """One change. Its hashes are whole credentials, read by their links' lookups alone and on no read model."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    # Null once ended, as `email` and `grund` are: a tombstone holds no address.
    adresse: str | None
    email: str | None
    weg: FLAdresswechselWeg
    verschickt_am: CustomDateString
    gueltig_bis: datetime | None
    freigegeben_am: datetime | None
    grund: str | None
    bestaetigt_am: datetime | None
    wirksam_ab: datetime | None
    versand: FLAdresswechselVersand | None
    genehmigung: FLAdresswechselGenehmigung | None
    beendet: FLAdresswechselBeendet | None


class FLAdresswechselRecord(FLAdresswechsel):
    """One change as `adresswechsel` stores it, its two links' hashes with it."""

    # Null on the `freigabe` way, which mails the new mailbox no link.
    token_hash: str | None
    stopp_hash: str


# What an end owes after its commit: an effect's completion notice and account carry, or a refused due change's notice.
FLAdresswechselPostausgangArt = Literal["wirksam", "verworfen"]


class FLAdresswechselPostausgang(BaseModel):
    """One owed notice as `adresswechsel_postausgang` stores it."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    art: FLAdresswechselPostausgangArt
    bisherige_email: str | None
    email: str
    vorname: str | None
    weg: FLAdresswechselWeg | None
    erfasst_am: datetime
    beansprucht_bis: datetime | None
    beanspruchung: str | None
    # How many claims have handed the row out; each claim raises it in its own transaction.
    versuche: int = Field(ge=0)


class FLAdresswechselPostausgangZeile(BaseModel):
    """One owed notice a pass claimed, server to server alone: no browser receives an address of it.

    `wirksam`: whom the completion notice greets, and the sign-in account to carry. `verworfen`: the new address alone,
    never told why.
    """

    id: CustomObjectId
    art: FLAdresswechselPostausgangArt
    bisherige_email: str | None
    # The new address as stored, which the sign-in account is carried to.
    email: str
    # Null on the lost-mailbox way and on a refusal: that mailbox may be a stranger's, and the new one is greeted by nobody.
    vorname: str | None
    # A change that waited carries no sign-in account: whatever its old mailbox's holder enrolled meanwhile would follow.
    weg: FLAdresswechselWeg | None
    # Past the last hand-out: the caller mails nothing, logs it by its id, and stamps it.
    aufgegeben: bool


class FLAdresswechselPostausgangResponse(BaseAPIResponse):
    """The owed notices one claim holds, oldest first; `beanspruchung` and `beansprucht_bis` null exactly where it holds none."""

    beanspruchung: str | None
    beansprucht_bis: FLUtcInstant | None
    mitteilungen: list[FLAdresswechselPostausgangZeile]


class FLAdresswechselZugestelltPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    beanspruchung: CustomStrippedNonEmptyString
    # A repeated id is counted once rather than refused: a pass retrying its own stamp is not wrong.
    ids: list[CustomObjectId] = Field(min_length=1, max_length=LIST_LIMIT_DEFAULT)


class FLAdresswechselZugestelltResponse(BaseAPIResponse):
    zugestellt: int = Field(ge=0)
    # Every distinct id this claim does not hold: unknown, stamped already, or claimed since by another pass.
    ignoriert: int = Field(ge=0)


class FLAdresswechselAdressePayload(BaseModel):
    """Exactly one key: the new mailbox's link token, or the change an approval names."""

    model_config = ConfigDict(extra="forbid")

    token: CustomAdresswechselToken | None = None
    adresswechsel_id: CustomObjectId | None = None

    @model_validator(mode="after")
    def exactly_one_key(self) -> Self:
        if (self.token is None) == (self.adresswechsel_id is None):
            raise ValueError("name either the link's token or the change, and not both")

        return self


class FLAdresswechselAdresseResponse(BaseAPIResponse):
    """A live change's new address and nothing else, server to server alone."""

    # Folded as the sign-in store keys an account; null where the key names no live change.
    email: str | None


class FLAdresswechselGenehmigungStand(BaseModel):
    """The approval a change of the person's own grant waits on, as their account page reads it: never who gave it."""

    # `owner`: another owner approves.
    verwaltung: FLAdresswechselVerwaltung
    genehmigt: bool
    bis: FLUtcInstant


# --- The two links, public.


class FLAdresswechselAnsichtPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: CustomAdresswechselToken


class FLAdresswechselAnsichtNeu(BaseModel):
    """What the new mailbox's link opens while the change stands."""

    seite: Literal["neu"]
    zustand: FLAdresswechselNeuZustand
    # Null exactly where the change is confirmed: it waits on no deadline of this link's.
    gueltig_bis: FLUtcInstant | None
    wirksam_ab: FLUtcInstant | None
    weg: FLAdresswechselWeg
    # Null exactly where not `bestaetigt`: whether the confirmed change waits on another administrator's approval.
    genehmigung_offen: bool | None


class FLAdresswechselAnsichtBisherig(BaseModel):
    """What the address on file's stop link opens: the step the change waits on, never whether it could be confirmed."""

    seite: Literal["bisherig"]
    zustand: FLAdresswechselBisherigZustand
    gueltig_bis: FLUtcInstant | None
    wirksam_ab: FLUtcInstant | None
    weg: FLAdresswechselWeg


class FLAdresswechselAnsichtBeendet(BaseModel):
    """What either link opens once its change ended, for as long as its record is kept."""

    seite: Literal["neu", "bisherig"]
    zustand: Literal["beendet"]
    art: FLAdresswechselEndeArt


class FLAdresswechselAnsichtResponse(BaseAPIResponse):
    """What one address link opens: never a name, either address or the id."""

    ansicht: Annotated[
        FLAdresswechselAnsichtNeu | FLAdresswechselAnsichtBisherig | FLAdresswechselAnsichtBeendet, Field(discriminator="zustand")
    ]


class FLAdresswechselAntwortPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: CustomAdresswechselToken
    # Required rather than defaulted: a page that omitted it would have the model answer for the person whether a mailbox is theirs.
    antwort: FLAdresswechselAntwort


class FLAdresswechselAntwortResponse(BaseAPIResponse):
    """The answer recorded, and no address of the change: the notices an effect owes are queued, never answered."""

    antwort: FLAdresswechselAntwort
    # Set where a change waiting after its confirmation now waits until then.
    wirksam_ab: FLUtcInstant | None
    # Set where the change now waits on another administrator's approval of its grant's move.
    genehmigung_offen: bool
    # Set where the change took effect: its notice is queued (`FLAdresswechselPostausgangZeile`), never answered here.
    wirksam: bool


class FLAdresswechselStoppPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: CustomAdresswechselToken


class FLAdresswechselStoppResponse(BaseAPIResponse):
    gestoppt: Literal[True]


# --- The administrator's tool, keyed by the address it types.


class FLAdresswechselVerwaltungAnsichtPayload(BaseModel):
    """Exactly one key: the address typed, or the change a page links to."""

    model_config = ConfigDict(extra="forbid")

    adresse: CustomEmail | None = None
    adresswechsel_id: CustomObjectId | None = None

    @model_validator(mode="after")
    def exactly_one_key(self) -> Self:
        if (self.adresse is None) == (self.adresswechsel_id is None):
            raise ValueError("name either the address or the change, and not both")

        return self


class FLAdresswechselVerwaltungBestand(BaseModel):
    """What the address holds that a change moves, counted: the tool names the kinds, the editors the records."""

    spieler: int = Field(ge=0)
    schiedsrichter: int = Field(ge=0)
    sitze: int = Field(ge=0)
    bewerbungssitze: int = Field(ge=0)
    registrierungen: int = Field(ge=0)
    berechtigung: FLAdresswechselVerwaltung | None


class FLAdresswechselVerwaltungGenehmigung(BaseModel):
    """The approval a change moving a grant waits on, read-only here: the administrators page approves it.

    Never who approved: a barred administrator's address is answered on no read.
    """

    verwaltung: FLAdresswechselVerwaltung
    bis: FLUtcInstant
    genehmigt_am: FLUtcInstant | None


class FLAdresswechselVerwaltungOffen(BaseModel):
    """The address's live change whole, admin tier: the new address and the reason included, never a hash."""

    id: CustomObjectId
    email: str
    weg: FLAdresswechselWeg
    grund: str | None
    wartet_auf: FLAdresswechselWartetAuf
    verschickt_am: CustomDateString
    gueltig_bis: FLUtcInstant | None
    freigegeben_am: FLUtcInstant | None
    bestaetigt_am: FLUtcInstant | None
    wirksam_ab: FLUtcInstant | None
    zustellung: FLBewerbungZustellung | None
    # Judged as the hourly pass ends one, so the tool marks a lapsed change without a clock of its own.
    abgelaufen: bool
    genehmigung: FLAdresswechselVerwaltungGenehmigung | None


class FLAdresswechselVerwaltungAnsichtResponse(BaseAPIResponse):
    adresse: str
    bestand: FLAdresswechselVerwaltungBestand
    moeglich: bool
    offen: FLAdresswechselVerwaltungOffen | None


class FLAdresswechselVerwaltungPayload(BaseModel):
    """The address a change starts on, the address it goes to, and the reason where the address on file is gone."""

    model_config = ConfigDict(extra="forbid")

    adresse: CustomEmail
    email: CustomEmail
    # Required, null meaning the address on file is asked first: a form forgetting the box must not start the change
    # that hands the records over without that address.
    grund: CustomAdresswechselGrund | None


class FLAdresswechselVerwaltungMintResponse(BaseAPIResponse):
    """A started or re-sent change's raw links, answered ONCE and stored nowhere, admin-tier whole."""

    id: CustomObjectId
    weg: FLAdresswechselWeg
    # Null on a change asking the address on file first: nothing goes to the new mailbox before its approval.
    token: str | None
    # Null on a re-send: the stop link already in the address on file's mailbox keeps working.
    stopp_token: str | None
    gueltig_bis: FLUtcInstant
    email: CustomNonEmptyString
    bisherige_email: str
    # Null on the lost-mailbox way: the address on file may have passed to a stranger, so its notice greets nobody.
    vorname: str | None
    # How many could approve the grant's move, 0 where none moves; never who: the grants' outbox reads them at its claim,
    # and the caller only branches on a wait.
    genehmiger_anzahl: int = Field(ge=0)


class FLAdresswechselIdResponse(BaseAPIResponse):
    id: CustomObjectId


class FLAdresswechselGenehmigungResponse(BaseAPIResponse):
    id: CustomObjectId
    # Whether the approval made the change take effect, the new mailbox having confirmed and no waiting time left.
    wirksam: bool


# --- The hourly pass.


class FLAdresswechselSweepParams(BaseModel):
    """Where in one pass the call starts: after the change the call before it reached, or at the lowest id where none is named."""

    nach: CustomObjectId | None = None


class FLAdresswechselSweepResponse(BaseAPIResponse):
    """One call's share of the live changes whose step lapsed or whose waiting time ended."""

    entfernt: int
    # Due changes a judgement refused at the end of their waiting time, and due ones taken effect, each notice queued.
    verworfen: int = Field(ge=0)
    wirksam: int = Field(ge=0)
    # A change whose ending or effect failed among them: it stays due, so a caller looping on this alone never ends.
    verbleibend: int
    # The last change this call reached, for the next call's `nach`; null once it reached the end, which ends the pass.
    nach: CustomObjectId | None
