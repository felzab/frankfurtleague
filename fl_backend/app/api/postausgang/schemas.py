from datetime import datetime
from typing import Annotated, Literal, Self, get_args

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.api.berechtigungen.schemas import FLBerechtigungMitteilungArt, FLBerechtigungStand, FLBerechtigungUrheber, FLBerechtigungVorenthalten
from app.api.teams.schemas import FLKontaktRolle
from app.core.collections import Collection
from app.shared.schemas.custom import SINGLE_LINE_PATTERN, CustomObjectId, CustomStrippedNonEmptyString
from app.shared.schemas.kontakt import CustomEmail
from app.shared.schemas.literals import FLAdresswechselWeg
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel

# Each kind of mail is one member of `FLPostausgangDaten` below, carrying the facts its builder renders and never a
# sentence: a date where the mail prints one, a seat where it names one. A kind joins with the write that owes it, its
# member written from the facts that write holds.

# --- The sign-in library's mails, each owed through `POST /postausgang/anmeldung` and never by a league write. Each
# secret one rides in the row's `geheim`, never here.


class FLAnmeldecodeDaten(BaseModel):
    art: Literal["anmeldecode"]


class FLPasskeyDaten(BaseModel):
    art: Literal["passkey_hinzugefuegt", "passkey_geloescht"]
    zeitpunkt: AwareDatetime
    # The reader's own account page, a path on the site's origin, which is where either event is acted on.
    konto: Annotated[str, StringConstraints(pattern=r"^/[a-z0-9/_-]*$", max_length=256)]


class FLKontoLoeschungDaten(BaseModel):
    art: Literal["konto_loeschung"]


FLPostausgangAnmeldeDaten = Annotated[FLAnmeldecodeDaten | FLPasskeyDaten | FLKontoLoeschungDaten, Field(discriminator="art")]

# --- The league's mails.


class FLSperreDaten(BaseModel):
    """The ban's own notice, the one mail a ban does not stop (`app/api/postausgang/services.py :: UNGESPERRT`)."""

    art: Literal["sperre"]
    grund: str
    gesperrt_bis_saison_id: str


class FLBerechtigungDaten(BaseModel):
    """A change to a grant, or a grant or promotion asked for, as the notice to each administrator states it."""

    art: Literal["berechtigung"]
    aenderung: FLBerechtigungMitteilungArt
    urheber: FLBerechtigungUrheber
    jetzt: FLBerechtigungStand | None
    vorher: FLBerechtigungStand | None
    # The administrator whose write made it; null where it was found in the database, or where a ban withholds them,
    # `urheber` telling the two apart; `app/core/recording.py :: ERASED_ACTOR_MARKER` for one erased since.
    geaendert_von: str | None
    # Null where it was found in the database, nobody knowing when that edit was made.
    geaendert_am: AwareDatetime | None
    # Why a grant address above is null.
    vorenthalten: FLBerechtigungVorenthalten | None


class FLAdresswechselLinkDaten(BaseModel):
    """The new mailbox's link to confirm an address change, minted at the hand-out into the change's `token_hashes`."""

    art: Literal["adresswechsel_link"]
    weg: FLAdresswechselWeg
    # When the link lapses, which the mail states.
    gueltig_bis: AwareDatetime


class FLAdresswechselHinweisDaten(BaseModel):
    """The address on file's notice of an address change, its stop link minted at the hand-out into `stopp.token_hashes`."""

    art: Literal["adresswechsel_hinweis"]
    weg: FLAdresswechselWeg
    # The approval's deadline, which only the `freigabe` way's notice states.
    gueltig_bis: AwareDatetime
    # Null on the lost-mailbox way: that mailbox may have passed to a stranger, so the notice greets nobody.
    vorname: str | None


class FLAdresswechselWirksamDaten(BaseModel):
    """The replaced address's notice that the change took effect."""

    art: Literal["adresswechsel_wirksam"]
    # The effect's own instant.
    zeitpunkt: AwareDatetime
    vorname: str | None


class FLAdresswechselVerworfenDaten(BaseModel):
    """The new mailbox's notice that a confirmed change did not take effect: never why, nor the address on file."""

    art: Literal["adresswechsel_verworfen"]


FLPostausgangDaten = Annotated[
    FLAnmeldecodeDaten
    | FLPasskeyDaten
    | FLKontoLoeschungDaten
    | FLSperreDaten
    | FLBerechtigungDaten
    | FLAdresswechselLinkDaten
    | FLAdresswechselHinweisDaten
    | FLAdresswechselWirksamDaten
    | FLAdresswechselVerworfenDaten,
    Field(discriminator="art"),
]

# Every member's `art`, spelled again as one closed set for the row's own field, which outlives its data.
FLPostausgangArt = Literal[
    "anmeldecode",
    "passkey_hinzugefuegt",
    "passkey_geloescht",
    "konto_loeschung",
    "sperre",
    "berechtigung",
    "adresswechsel_link",
    "adresswechsel_hinweis",
    "adresswechsel_wirksam",
    "adresswechsel_verworfen",
]

_MEMBER_ARTEN = {art for member in get_args(get_args(FLPostausgangDaten)[0]) for art in get_args(member.model_fields["art"].annotation)}
if set(get_args(FLPostausgangArt)) != _MEMBER_ARTEN:
    raise RuntimeError("`FLPostausgangArt` and the members of `FLPostausgangDaten` name different kinds: add the kind to both.")

# `offen` until a hand-out's report or the deadline settles it; each other state is final.
FLPostausgangStand = Literal["offen", "gesendet", "zurueckgehalten", "gesperrt", "entfallen", "aufgegeben"]

# What the provider reports about a message it accepted. `gesendet` is the row's own state and no event's.
FLPostausgangZustellStand = Literal["zugestellt", "verzoegert", "unzustellbar", "unterdrueckt", "beschwerde"]

# Wide over the 36 characters the provider's id spells today, and a ceiling all the same: the value arrives from outside
# and is stored.
CustomNachrichtId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]

# The provider's own token for a refusal, bounded and on one line, never its prose.
CustomZustellGrund = Annotated[str, StringConstraints(strip_whitespace=True, max_length=128, pattern=SINGLE_LINE_PATTERN)]

# The caller's identity of one owed mail. Bounded, as it is stored and indexed.
CustomPostausgangSchluessel = Annotated[str, StringConstraints(min_length=1, max_length=256, pattern=SINGLE_LINE_PATTERN)]


class FLPostausgangBezug(BaseModel):
    """The record a mail is about, and the contact seat on it where the record has seats: what a delivery state is read by."""

    sammlung: Collection
    id: CustomObjectId
    sitz: FLKontaktRolle | None


class FLPostausgangLink(BaseModel):
    """Where the hand-out stores the hash of the link it mints, and what the record must still say for it to mint one."""

    # The dotted path of each `token_hashes` array the link answers through: one per seat, a person holding two seats
    # being sent one link for both.
    pfade: list[Annotated[str, StringConstraints(pattern=r"^([a-z_]+\.)*token_hashes$")]] = Field(min_length=1)
    # The dotted paths holding the recipient's address on the record. The link is minted only while each still holds the
    # row's `an`: a seat emptied, handed on or re-addressed since the mail was owed mints nothing, and the mail is dropped.
    adressen: list[Annotated[str, StringConstraints(pattern=r"^[a-z_]+(\.[a-z_]+)*$")]] = Field(min_length=1)
    # Set where the fresh link supersedes every link the arrays held; clear where the earlier ones stay valid beside it.
    ersetzt: bool


class FLPostausgangZustellung(BaseModel):
    stand: FLPostausgangZustellStand
    grund: str | None
    am: datetime


class FLPostausgangLage(BaseReadModel):
    """What became of the last mail owed about one record and seat, as an editor reads it beside the link."""

    stand: FLPostausgangStand
    zustellung: FLPostausgangZustellung | None


class FLPostausgangZeile(BaseModel):
    """One owed mail as `postausgang` stores it."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    schluessel: str
    art: FLPostausgangArt
    an: str
    # Both removed by the row's final state, after which only its delivery is read.
    daten: FLPostausgangDaten | None = Field(default=None)
    # Ciphertext the backend cannot read, under the frontend's key.
    geheim: str | None = Field(default=None)
    # Null on a sign-in mail, which no league record holds.
    bezug: FLPostausgangBezug | None
    link: FLPostausgangLink | None
    stand: FLPostausgangStand
    erfasst_am: datetime
    # The last moment a hand-out may send the mail; a row still open after it is given up.
    frist: datetime
    loeschen_am: datetime
    beanspruchung: str | None
    beansprucht_bis: datetime | None
    # How many claims have handed the row out; each claim raises it in its own transaction.
    versuche: int = Field(ge=0)
    nachricht_id: str | None
    zustellung: FLPostausgangZustellung | None


class FLPostausgangAusgabe(BaseModel):
    """One owed mail a claim hands out, server to server alone: it names its recipient and may carry a live link or secret."""

    id: CustomObjectId
    an: str
    daten: FLPostausgangDaten
    # The raw link token minted for this hand-out, whose hash alone the record keeps; null on a mail carrying no link.
    token: str | None
    geheim: str | None
    # This hand-out's number, the row's `versuche` after the claim. The send's idempotency key is
    # `postausgang/<id>/<versuch>`: one per hand-out, since each mints its own link and the provider refuses one key for
    # two bodies.
    versuch: int = Field(ge=1)


class FLPostausgangAusgabeResponse(BaseAPIResponse):
    """The owed mails one claim holds, oldest first; `beanspruchung` and `beansprucht_bis` are null exactly where it holds none."""

    beanspruchung: str | None
    beansprucht_bis: AwareDatetime | None
    mails: list[FLPostausgangAusgabe]
    # Rows this claim found past their deadline and gave up, which no report will count.
    aufgegeben: int = Field(ge=0)


FLPostausgangErgebnisArt = Literal["gesendet", "wiederholen", "aufgeben", "zurueckgehalten"]


class FLPostausgangErgebnis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: CustomObjectId
    ergebnis: FLPostausgangErgebnisArt
    # The provider's id for the accepted message, kept as the row's record of it.
    nachricht_id: CustomNachrichtId | None

    # Only a sent mail names a message, and a sent one may name none: the provider accepted it, and its answer carried no
    # readable id, which no event needs, each finding its row by the row's own id.
    @model_validator(mode="after")
    def only_a_sent_mail_names_a_message(self) -> Self:
        if self.nachricht_id is not None and self.ergebnis != "gesendet":
            raise ValueError("Nur eine gesendete Mail nennt eine Nachricht.")

        return self


class FLPostausgangErgebnisPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    beanspruchung: CustomStrippedNonEmptyString
    ergebnisse: list[FLPostausgangErgebnis] = Field(min_length=1, max_length=64)


class FLPostausgangErgebnisResponse(BaseAPIResponse):
    gesendet: int = Field(ge=0)
    wiederholt: int = Field(ge=0)
    aufgegeben: int = Field(ge=0)
    zurueckgehalten: int = Field(ge=0)
    # Every distinct id this claim does not hold: unknown, settled already, or claimed since by another drain.
    ignoriert: int = Field(ge=0)


class FLPostausgangAnmeldungPayload(BaseModel):
    """One mail of the sign-in library, owed to the address it names."""

    model_config = ConfigDict(extra="forbid")

    schluessel: CustomPostausgangSchluessel
    an: CustomEmail
    daten: FLPostausgangAnmeldeDaten
    # Encrypted by the frontend before it leaves it, under a key the backend never holds: the code, or the deletion token.
    geheim: Annotated[str, StringConstraints(min_length=1, max_length=4096)] | None
    # When what the mail carries stops working: its last send and its deletion both. Required beside a secret.
    gueltig_bis: AwareDatetime | None

    @model_validator(mode="after")
    def a_secret_names_when_it_lapses(self) -> Self:
        if self.geheim is not None and self.gueltig_bis is None:
            raise ValueError("Ein Geheimnis nennt, wann es verfällt.")

        return self


class FLPostausgangAnmeldungResponse(BaseAPIResponse):
    # The row the mail waits in: the one a replay of the same key wrote first.
    id: CustomObjectId


class FLPostausgangEreignisPayload(BaseModel):
    """One delivery event about a message the provider accepted, named by the row the message was sent from."""

    model_config = ConfigDict(extra="forbid")

    # The row's own id, which the send carries as a tag and the provider echoes on every event, so an event arriving
    # before the send's report finds its row all the same.
    id: CustomObjectId
    stand: FLPostausgangZustellStand
    grund: CustomZustellGrund | None
    # The provider's stamp, stored with the state; the order of states decides, never the order of stamps.
    am: AwareDatetime


class FLPostausgangEreignisResponse(BaseAPIResponse):
    """Whether the event reached a row; false where no row has the id, or the row's state may not follow into it.

    False rather than a refusal: the provider repeats a settled event for hours if anything but a success answers it.
    """

    angewendet: bool
