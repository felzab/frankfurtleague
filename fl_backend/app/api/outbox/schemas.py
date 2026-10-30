from datetime import datetime
from typing import Annotated, Final, Literal, Self, get_args

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, computed_field, model_validator

from app.api.berechtigungen.schemas import FLBerechtigungMitteilungArt, FLBerechtigungUrheber, FLBerechtigungVorenthalten, FLGrantStand
from app.api.registrierungen.schemas import FLRegistrierungAblehnungsgrund
from app.core.collections import Collection
from app.shared.schemas.custom import SINGLE_LINE_PATTERN, CustomDateString, CustomObjectId, CustomStrippedNonEmptyString, CustomTimeString
from app.shared.schemas.kontakt import CustomEmail
from app.shared.schemas.literals import FLAddressChangeWay, FLGruppenNames, FLKontaktRolle, FLKontaktRow, FLTrikotFarbe
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel

# Each kind of mail is one member of `FLOutboxData` below, carrying the facts its builder renders and never a
# sentence: a date where the mail prints one, a seat where it names one. A kind joins with the write that owes it, its
# member written from the facts that write holds.

# --- The sign-in library's mails, each owed through `POST /postausgang/anmeldung` and never by a league write. Each
# secret one rides in the row's `secret`, never here.


class FLSignInCodeData(BaseModel):
    art: Literal["sign_in_code"]


class FLPasskeyData(BaseModel):
    art: Literal["passkey_hinzugefuegt", "passkey_erased"]
    instant: AwareDatetime
    # The reader's own account page, a path on the site's origin, which is where either event is acted on.
    account: Annotated[str, StringConstraints(pattern=r"^/[a-z0-9/_-]*$", max_length=256)]


class FLAccountErasureData(BaseModel):
    art: Literal["account_erasure"]


FLOutboxSignInData = Annotated[FLSignInCodeData | FLPasskeyData | FLAccountErasureData, Field(discriminator="art")]

# --- The league's mails.


class FLSperreData(BaseModel):
    """The ban's own notice, the one mail a ban does not stop (`app/api/postausgang/services.py :: UNGESPERRT`)."""

    art: Literal["sperre"]
    grund: str
    barred_until_saison_id: str


class FLGrantData(BaseModel):
    """A change to a grant, or a grant or promotion asked for, as the notice to each administrator states it."""

    art: Literal["grant"]
    change: FLBerechtigungMitteilungArt
    author: FLBerechtigungUrheber
    now: FLGrantStand | None
    before: FLGrantStand | None
    # The administrator whose write made it; null where it was found in the database, or where a ban withholds them,
    # `author` telling the two apart; `app/core/recording.py :: ERASED_ACTOR_MARKER` for one erased since.
    changed_by: str | None
    # Null where it was found in the database, nobody knowing when that edit was made.
    changed_at: AwareDatetime | None
    # Why a grant address above is null.
    withheld: FLBerechtigungVorenthalten | None


class FLAddressChangeLinkData(BaseModel):
    """The new mailbox's link to confirm an address change, minted at the hand-out into the change's `token_hashes`."""

    art: Literal["address_change_link"]
    way: FLAddressChangeWay
    # When the link lapses, which the mail states.
    valid_until: AwareDatetime


class FLAddressChangeHinweisData(BaseModel):
    """The address on file's notice of an address change, its stop link minted at the hand-out into `stop.token_hashes`."""

    art: Literal["address_change_hinweis"]
    way: FLAddressChangeWay
    # The approval's deadline, which only the `release` way's notice states.
    valid_until: AwareDatetime
    # Null on the lost-mailbox way: that mailbox may have passed to a stranger, so the notice greets nobody.
    vorname: str | None


class FLAddressChangeEffectiveData(BaseModel):
    """The replaced address's notice that the change took effect."""

    art: Literal["address_change_effective"]
    # The effect's own instant.
    instant: AwareDatetime
    vorname: str | None


class FLAddressChangeDiscardedData(BaseModel):
    """The new mailbox's notice that a confirmed change did not take effect: never why, nor the address on file."""

    art: Literal["address_change_discarded"]


class FLSchiedsrichterConfirmationData(BaseModel):
    """A referee's confirmation link, owed by their entry, a corrected address, a re-send or their return."""

    art: Literal["schiedsrichter_confirmation"]
    # The link's last day, the one date the mail states.
    frist: CustomDateString


class FLSpielMailAppointment(BaseModel):
    """A fixture's slot as a mail names it: its two sides in the fixture's order, its day and its hour."""

    team1: str
    team2: str
    datum: CustomDateString
    uhrzeit: CustomTimeString


class FLSpielMailAnsetzung(FLSpielMailAppointment):
    """A fixture as a mail asking about it states it, its ground among the rest."""

    # The ground's name; null where nobody assigned one.
    ort: str | None


class FLSpielRequestData(BaseModel):
    """A club's request to confirm a fixture, or the reminder of it, each carrying a link of its own."""

    art: Literal["spiel_request", "spiel_reminder"]
    # The reader's own club, one of the two sides.
    team: str
    ansetzung: FLSpielMailAnsetzung
    # The row's stored deadline, which a reminder repeats.
    frist: CustomDateString


class FLSpielEinteilungData(BaseModel):
    """A referee's word that they are booked onto a fixture, which they answer on their own panel."""

    art: Literal["spiel_einteilung"]
    ansetzung: FLSpielMailAnsetzung


class FLSpielHinweisData(BaseModel):
    """A party's word that a fixture it was asked about moved or was called off: the slot it was asked about."""

    art: Literal["spiel_new_angesetzt", "spiel_abgesagt"]
    # A club was asked by a link, a referee was booked; each is told what of theirs no longer stands.
    recipient: Literal["team", "schiedsrichter"]
    appointment: FLSpielMailAppointment


class FLSpielEinteilungLiftedData(BaseModel):
    """A referee's word that they were taken off a fixture after being told of it: the slot they were told of."""

    art: Literal["spiel_einteilung_lifted"]
    appointment: FLSpielMailAppointment


class FLSpielVorschlagDiscardedData(BaseModel):
    """A club's word that the league kept the date it declined and proposed another for: the slot that stands."""

    art: Literal["spiel_vorschlag_discarded"]
    appointment: FLSpielMailAppointment


# --- The season's and the applications' mails.


class FLRegistrierungLinkData(BaseModel):
    """A pupil's confirmation link, first or as the one reminder, which joins the first link rather than replacing it."""

    art: Literal["registrierung_confirmation", "registrierung_reminder"]
    # The junction row's name, else the club's: what the pupil registered for.
    team: str
    saison_id: str
    # The window in days, never a date: the reminder states that the window has not moved.
    frist_days: int = Field(ge=1)


class FLRegistrierungAbsageData(BaseModel):
    """A team's decline, to a pupil whose address was confirmed."""

    art: Literal["registrierung_absage"]
    vorname: str
    team: str
    saison_id: str
    grund: FLRegistrierungAblehnungsgrund | None


class FLInvitationData(BaseModel):
    """A team's registration link, to one confirmed contact seat, for the pupils to register through."""

    art: Literal["invitation"]
    # The junction row's name: a seat holding two teams tells them apart by it.
    team: str
    saison_id: str


class FLBewerbungLinkData(BaseModel):
    """One person's confirmation link on an application: at its submission, a re-send, a correction or a reseat, or the one reminder.

    `rollen` are every seat the link answers, two where the Trainer holds a second; the reminder's link joins the first.
    """

    art: Literal["bewerbung_confirmation", "bewerbung_reminder"]
    saison_id: str
    # The school as submitted, or the picked club's name: a contact who never heard of the application places it by this.
    schule: str
    rollen: list[FLKontaktRolle] = Field(min_length=1)
    # The day the links stop working, which the reminder repeats rather than moves.
    frist: CustomDateString


class FLBewerbungPerson(BaseModel):
    """Another person's seats, as a mail names them to the submitter: a first name where one stands, and the seats."""

    vorname: str | None
    rollen: list[FLKontaktRolle] = Field(min_length=1)


class FLBewerbungReceivedData(BaseModel):
    """The submitter's receipt, which carries their own link: the Ansprechperson's seats and every other person still to answer."""

    art: Literal["bewerbung_received"]
    saison_id: str
    rollen: list[FLKontaktRolle] = Field(min_length=1)
    pending: list[FLBewerbungPerson]
    frist: CustomDateString


class FLBewerbungZusageData(BaseModel):
    """An acceptance, to one person of the application, naming the seats they were entered for."""

    art: Literal["bewerbung_zusage"]
    team: str
    saison_id: str
    rollen: list[FLKontaktRolle] = Field(min_length=1)
    gruppe: FLGruppenNames
    # Null while no kit colour is assigned; the mail then says so rather than guessing one.
    trikot_farbe: FLTrikotFarbe | None
    # As the school submitted it, null where it named none.
    wunschgegner: str | None


class FLBewerbungAbsageData(BaseModel):
    """A decline, to one person of the application, with the administrator's reason verbatim."""

    art: Literal["bewerbung_absage"]
    team: str
    saison_id: str
    rollen: list[FLKontaktRolle] = Field(min_length=1)
    grund: str


class FLBewerbungErasureData(BaseModel):
    """The fourteen-day deletion notice, to the submitter, naming who never confirmed; owed in the erasure's own write."""

    art: Literal["bewerbung_erasure"]
    saison_id: str
    rollen: list[FLKontaktRolle] = Field(min_length=1)
    pending: list[FLBewerbungPerson]


class FLBewerbungWiderspruchData(BaseModel):
    """A contact's Widerspruch, to the submitter, naming the person who refused: it stands as the deletion notice too."""

    art: Literal["bewerbung_widerspruch"]
    saison_id: str
    rollen: list[FLKontaktRolle] = Field(min_length=1)
    declined: FLBewerbungPerson
    frist: CustomDateString


class FLKontaktLinkData(BaseModel):
    """One person an administrator seated on a team's season row, asked to confirm: no name, the address being unconfirmed."""

    art: Literal["kontakt_confirmation"]
    saison_id: str
    # The team's name in that season, which is the school the reader is asked about.
    schule: str
    rollen: list[FLKontaktRolle] = Field(min_length=1)
    frist: CustomDateString
    # The row's state at the write: a closed row's link takes the Widerspruch alone, and the mail asks only that.
    row: FLKontaktRow


FLOutboxData = Annotated[
    FLSignInCodeData
    | FLPasskeyData
    | FLAccountErasureData
    | FLSperreData
    | FLGrantData
    | FLAddressChangeLinkData
    | FLAddressChangeHinweisData
    | FLAddressChangeEffectiveData
    | FLAddressChangeDiscardedData
    | FLSchiedsrichterConfirmationData
    | FLSpielRequestData
    | FLSpielEinteilungData
    | FLSpielHinweisData
    | FLSpielEinteilungLiftedData
    | FLSpielVorschlagDiscardedData
    | FLRegistrierungLinkData
    | FLRegistrierungAbsageData
    | FLInvitationData
    | FLBewerbungLinkData
    | FLBewerbungReceivedData
    | FLBewerbungZusageData
    | FLBewerbungAbsageData
    | FLBewerbungErasureData
    | FLBewerbungWiderspruchData
    | FLKontaktLinkData,
    Field(discriminator="art"),
]

# Every member's `art`, spelled again as one closed set for the row's own field, which outlives its data.
FLOutboxArt = Literal[
    "sign_in_code",
    "passkey_hinzugefuegt",
    "passkey_erased",
    "account_erasure",
    "sperre",
    "grant",
    "address_change_link",
    "address_change_hinweis",
    "address_change_effective",
    "address_change_discarded",
    "schiedsrichter_confirmation",
    "spiel_request",
    "spiel_reminder",
    "spiel_einteilung",
    "spiel_new_angesetzt",
    "spiel_abgesagt",
    "spiel_einteilung_lifted",
    "spiel_vorschlag_discarded",
    "registrierung_confirmation",
    "registrierung_reminder",
    "registrierung_absage",
    "invitation",
    "bewerbung_confirmation",
    "bewerbung_reminder",
    "bewerbung_received",
    "bewerbung_zusage",
    "bewerbung_absage",
    "bewerbung_erasure",
    "bewerbung_widerspruch",
    "kontakt_confirmation",
]


_MEMBER_ARTEN = {art for member in get_args(get_args(FLOutboxData)[0]) for art in get_args(member.model_fields["art"].annotation)}
if set(get_args(FLOutboxArt)) != _MEMBER_ARTEN:
    raise RuntimeError("`FLOutboxArt` and the members of `FLOutboxData` name different kinds: add the kind to both.")

# `open` until a hand-out's report or the deadline settles it; each other state is final.
FLOutboxStand = Literal["open", "sent", "withheld", "barred", "dropped", "abandoned"]

# What the provider reports about a message it accepted. `sent` is the row's own state and no event's.
type FLOutboxDeliveryStand = Literal["delivered", "delayed", "undeliverable", "suppressed", "complaint"]

# The reports a reader of a seat's delivery takes as the mail not having arrived: refused by the provider's suppression
# list, bounced for good, or marked as spam.
UNDELIVERABLE: Final[frozenset[FLOutboxDeliveryStand]] = frozenset({"undeliverable", "suppressed", "complaint"})

# Wide over the 36 characters the provider's id spells today, and a ceiling all the same: the value arrives from outside
# and is stored.
CustomMessageId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]

# The provider's own token for a refusal, bounded and on one line, never its prose.
CustomDeliveryGrund = Annotated[str, StringConstraints(strip_whitespace=True, max_length=128, pattern=SINGLE_LINE_PATTERN)]


class FLOutboxReference(BaseModel):
    """The record a mail is about, and the contact seat on it where the record has seats: what a delivery state is read by."""

    collection: Collection
    id: CustomObjectId
    seat: FLKontaktRolle | None


class FLOutboxLink(BaseModel):
    """Where the hand-out stores the hash of the link it mints, and what the record must still say for it to mint one."""

    # The dotted path of each `token_hashes` array the link answers through: one per seat, a person holding two seats
    # being sent one link for both.
    paths: list[Annotated[str, StringConstraints(pattern=r"^([a-z_]+\.)*token_hashes$")]] = Field(min_length=1)
    # The dotted paths holding the recipient's address on the record. The link is minted only while each still holds the
    # row's `an`: a seat emptied, handed on or re-addressed since the mail was owed mints nothing, and the mail is dropped.
    # Empty where the record holds no address to judge: a team's registration link, which is the team's and no person's
    # credential, its recipients standing on another record.
    adressen: list[Annotated[str, StringConstraints(pattern=r"^[a-z_]+(\.[a-z_]+)*$")]]
    # Set where the fresh link supersedes every link the arrays held; clear where the earlier ones stay valid beside it.
    replaced: bool


class FLOutboxDelivery(BaseModel):
    stand: FLOutboxDeliveryStand
    grund: str | None
    am: datetime


class FLOutboxState(BaseReadModel):
    """What became of the last mail owed about one record and seat, as an editor reads it beside the link."""

    stand: FLOutboxStand
    delivery: FLOutboxDelivery | None

    @computed_field
    @property
    def undeliverable(self) -> bool:
        """Whether the mail did not arrive: given up, or refused, suppressed or marked as spam by its recipient.

        The one judgement of it, which the backend's refusals and every page showing the seat read.
        """

        return self.stand == "abandoned" or (self.delivery is not None and self.delivery.stand in UNDELIVERABLE)


class FLOutboxRow(BaseModel):
    """One owed mail as `outbox` stores it."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    key: str
    art: FLOutboxArt
    an: str
    # Both removed by the row's final state, after which only its delivery is read.
    data: FLOutboxData | None = Field(default=None)
    # Ciphertext the backend cannot read, under the frontend's key.
    secret: str | None = Field(default=None)
    # Null on a sign-in mail, which no league record holds.
    reference: FLOutboxReference | None
    link: FLOutboxLink | None
    stand: FLOutboxStand
    recorded_at: datetime
    # The last moment a hand-out may send the mail; a row still open after it is given up.
    frist: datetime
    erase_at: datetime
    lease: str | None
    leased_until: datetime | None
    # How many claims have handed the row out; each claim raises it in its own transaction.
    attempts: int = Field(ge=0)
    message_id: str | None
    # The provider's own name for the refusal the last failed send met; defaulted, as a row a send never failed holds
    # none and a row owed before the field was written has none stored.
    grund: str | None = Field(default=None)
    delivery: FLOutboxDelivery | None


class FLOutboxHandout(BaseModel):
    """One owed mail a claim hands out, server to server alone: it names its recipient and may carry a live link or secret."""

    id: CustomObjectId
    an: str
    data: FLOutboxData
    # The raw link token minted for this hand-out, whose hash alone the record keeps; null on a mail carrying no link.
    token: str | None
    secret: str | None
    # This hand-out's number, the row's `attempts` after the claim. The send's idempotency key is
    # `postausgang/<id>/<versuch>`: one per hand-out, since each mints its own link and the provider refuses one key for
    # two bodies.
    attempt: int = Field(ge=1)


class FLOutboxHandoutResponse(BaseAPIResponse):
    """The owed mails one claim holds, oldest first; `lease` is null exactly where it holds none."""

    lease: str | None
    mails: list[FLOutboxHandout]
    # Rows this claim found past their deadline and gave up, which no report will count.
    abandoned: int = Field(ge=0)


FLOutboxResultArt = Literal["sent", "retry", "abandon", "withheld"]


class FLOutboxResultPayload(BaseModel):
    """The outcome of one handed-out mail's send, reported as the send returns."""

    model_config = ConfigDict(extra="forbid")

    lease: CustomStrippedNonEmptyString
    id: CustomObjectId
    result: FLOutboxResultArt
    # The provider's id for the accepted message: an operator's one way from the row to the message there, its dashboard's
    # page or `GET /emails/{id}` (https://resend.com/docs/api-reference/emails/retrieve-email), the provider offering no
    # search by tag. No event needs it, each finding its row by the row's own id.
    message_id: CustomMessageId | None
    # The provider's own name for the refusal a failed send met, the row's one record of why.
    grund: CustomDeliveryGrund | None

    # Only a sent mail names a message, and a sent one may name none: the provider accepted it, and its answer carried no
    # readable id. Only a failed send names a refusal, and one that never reached the provider names none.
    @model_validator(mode="after")
    def each_outcome_names_only_its_own(self) -> Self:
        if self.message_id is not None and self.result != "sent":
            raise ValueError("Only a sent mail names a message.")
        if self.grund is not None and self.result not in ("retry", "abandon"):
            raise ValueError("Only a failed send names a refusal.")

        return self


class FLOutboxResultResponse(BaseAPIResponse):
    sent: int = Field(ge=0)
    repeated: int = Field(ge=0)
    abandoned: int = Field(ge=0)
    withheld: int = Field(ge=0)
    # Every distinct id this claim does not hold: unknown, settled already, or claimed since by another drain.
    ignored: int = Field(ge=0)


class FLOutboxSignInPayload(BaseModel):
    """One mail of the sign-in library, owed to the address it names."""

    model_config = ConfigDict(extra="forbid")

    an: CustomEmail
    data: FLOutboxSignInData
    # Encrypted by the frontend before it leaves it, under a key the backend never holds: the code, or the deletion token.
    secret: Annotated[str, StringConstraints(min_length=1, max_length=4096)] | None
    # When what the mail carries stops working: its last send and its deletion both. Required beside a secret.
    valid_until: AwareDatetime | None

    @model_validator(mode="after")
    def a_secret_names_when_it_lapses(self) -> Self:
        if self.secret is not None and self.valid_until is None:
            raise ValueError("A secret names when it lapses.")

        return self


class FLOutboxEventPayload(BaseModel):
    """One delivery event about a message the provider accepted, named by the row the message was sent from."""

    model_config = ConfigDict(extra="forbid")

    # The row's own id, which the send carries as a tag and the provider echoes on every event, so an event arriving
    # before the send's report finds its row all the same.
    id: CustomObjectId
    stand: FLOutboxDeliveryStand
    grund: CustomDeliveryGrund | None
    # The provider's stamp, stored with the state; the order of states decides, never the order of stamps.
    am: AwareDatetime


class FLOutboxEventResponse(BaseAPIResponse):
    """Whether the event reached a row; false where no row has the id, or the row's state may not follow into it.

    False rather than a refusal: the provider repeats a settled event for hours if anything but a success answers it.
    """

    applied: bool
