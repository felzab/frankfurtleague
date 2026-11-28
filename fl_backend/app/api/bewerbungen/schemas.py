from datetime import datetime
from typing import Annotated, Final, Literal, Self

from pydantic import AfterValidator, BaseModel, BeforeValidator, Field, StringConstraints, TypeAdapter, model_validator

from app.api.outbox.schemas import FLOutboxStatus

# Imported rather than restated: an application's three people become the junction's three people at acceptance, so a
# second declaration of the block is one the two would drift apart on. Acyclic: no model in `teams` imports this slice.
from app.api.teams.schemas import FLSaisonTeamKontakteAdmin, FLSaisonTeamKontakteRecord, FLTrainerAlso, _KontaktpersonWritablePayload
from app.core.crud import Anchored
from app.core.exceptions import rule_refusal
from app.shared.schemas.addresses import FLAddress, FLAddressPayload
from app.shared.schemas.bounds import ADDRESS_DISTRICT_MAX_LENGTH, SAISON_ID_LENGTH, TEAM_FULL_NAME_MAX_LENGTH, TEAM_NAME_MAX_LENGTH
from app.shared.schemas.confirmation import CustomToken
from app.shared.schemas.custom import (
    PARAGRAPH_PATTERN,
    SINGLE_LINE_PATTERN,
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomOptionalDateString,
    CustomOptionalWebsiteUrl,
    CustomShorthand,
    CustomVersion,
    parse_empty_string_to_none,
)
from app.shared.schemas.einwilligung import FLSeatTextVersions
from app.shared.schemas.literals import (
    FLGruppenNames,
    FLKontaktRow,
    FLKontaktSeat,
    FLSaisonStatus,
    FLSchulform,
    FLTrikotFarbe,
)
from app.shared.schemas.responses import BasePayload, BaseReadModel

# `submitted` is the only state a submission arrives in; the other two are the triage's, written by an administrator's
# decision alone.
type FLBewerbungStatus = Literal["submitted", "accepted", "declined"]


# Where one seat of an application stands, as its link and the triage both say it. `expired` is a spent link, its deadline
# passed or its application decided, said one way.
FLBewerbungSeatState = Literal["valid", "confirmed", "declined", "expired"]


class _FLBewerbungSeatState(BaseReadModel):
    """One seat's confirmation bookkeeping, as the record and the read share it."""

    # The day the link was last mailed; a re-send moves it. Null on a seat the submission owed no mail, its mailbox holding
    # `OPEN_LINKS_PER_MAILBOX` unanswered links, until an administrator sends one.
    sent_at: CustomOptionalDateString
    # The day this seat's link stops working, counted from that mail, and the application goes with it if its person
    # never answers. Not the season's `Bewerbungsfrist`, which is the window the form is open in.
    deadline: CustomDateString
    # Beside the seat rather than inside it: a decline empties the person's seat, and a marker in
    # there would go with it.
    declined_at: CustomOptionalDateString


class FLBewerbungConfirmation(_FLBewerbungSeatState):
    """One seat's confirmation bookkeeping as the triage reads it, without its link's hashes."""

    # What became of the last mail owed this seat, as the read joins it from the Postausgang: no seat stores it, and null
    # where none was ever owed.
    delivery: FLOutboxStatus | None
    # Judged on the server's date, so a page reads no day of its own and derives no state.
    state: FLBewerbungSeatState


class FLBewerbungConfirmations(BaseModel):
    """The three seats' bookkeeping, each null where an erasure emptied the seat."""

    trainer: FLBewerbungConfirmation | None
    ansprechperson: FLBewerbungConfirmation | None
    stellvertretung: FLBewerbungConfirmation | None


class FLBewerbungSchule(BaseModel):
    """The club a new school proposes, in the shape acceptance will create it in.

    While the application is `submitted`, exactly one of this and `team_id` carries a value.
    """

    # `team_name`, not `name`: it becomes the club's short name beside `full_name`, and `name` inside
    # a block called `schule` would read as the school's own.
    team_name: CustomNonEmptyString
    full_name: CustomNonEmptyString
    schulform: FLSchulform | None
    address: FLAddress
    # A plain string, unlike `_TeamWritable.website_url`: stored values are typed only,
    # and refusing one on read would 500 the triage list.
    website_url: str | None


class FLBewerbungTrikot(BaseModel):
    """What kit the school already owns, and the colour it would like; never copied onto the team."""

    existing_set: str
    wunschfarbe: FLTrikotFarbe


class FLBewerbungKader(BaseModel):
    """The school's own estimate of its squad, which nothing checks afterwards."""

    expected_size: int
    # Non-nullable: the form asks for a count, and none of them is zero.
    good_spieler: int


class FLBewerbungDecision(BaseModel):
    """When this application was decided, and on a decline why."""

    made_at: CustomDateString
    # Null on an acceptance: what an acceptance did is the club and the junction row it wrote, and a
    # reason field filled in with "angenommen" would be a second, weaker record of that.
    reason: str | None


class FLBewerbung(BaseReadModel):
    """One school's application to play one season, as stored."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    # What a decision or a seat write sends back, so one over an application another write moved since is refused as stale.
    version: int
    saison_id: str
    submitted_at: CustomDateString
    status: FLBewerbungStatus
    # The club the applicant picked, null where they proposed a new school. Acceptance writes the
    # created club's id back here, so a decided application always names one.
    team_id: CustomObjectId | None
    schule: FLBewerbungSchule | None
    # As the team editor serves a season row's seats: no birthdate and no evidence, which no page of the administration
    # shows. The record re-declares the stored block.
    kontakte: FLSaisonTeamKontakteAdmin
    trikot: FLBewerbungTrikot
    kader: FLBewerbungKader
    # How many pupils the school's whole Abi-Jahrgang holds, which the applicant states and nothing
    # later checks.
    stufengroesse: int
    # A free string, never a club reference: the school may name an applicant the league has not
    # accepted yet, and a picker over the accepted ones would give a later applicant the longer list.
    wunschgegner: str | None
    decision: FLBewerbungDecision | None
    confirmations: FLBewerbungConfirmations


class FLBewerbungConfirmationRecord(_FLBewerbungSeatState):
    """One seat's bookkeeping as `bewerbungen` stores it: the hash of every link it was mailed, each live until a re-send."""

    token_hashes: list[str]
    # The day this seat's one reminder was owed. A re-send and a seat write clear it. Served to nobody: the reminder
    # clock reads it, and no page does.
    reminded_at: CustomOptionalDateString
    # The day this seat's person confirmed it, kept here by the acceptance, which moves the person to the season row and
    # empties the seat: a reopened link still shows what they did and when. Null while the seat holds its own stamp.
    confirmed_on: CustomOptionalDateString


class FLBewerbungConfirmationsRecord(FLBewerbungConfirmations):
    trainer: FLBewerbungConfirmationRecord | None
    ansprechperson: FLBewerbungConfirmationRecord | None
    stellvertretung: FLBewerbungConfirmationRecord | None


class FLBewerbungRecord(FLBewerbung):
    """One application as `bewerbungen` stores it: what no read serves beside what every read does."""

    kontakte: FLSaisonTeamKontakteRecord
    confirmations: FLBewerbungConfirmationsRecord
    # The retention sweep's announcement, and the submission's replay key.
    erasure_announced_at: str | None = None
    idempotency_key: str | None = None

    @model_validator(mode="after")
    def a_submitted_application_names_one_school(self) -> Self:
        """No write stores both or neither, and acceptance no longer refuses either, so the read-back is what names one.

        On the record alone: a served read refusing a hand-edited row would fail the whole triage list.
        """

        if self.status == "submitted" and (self.team_id is None) == (self.schule is None):
            raise ValueError("a submitted application names its school by `team_id` or by `schule`, and not both")

        return self


class FLMailboxAnchorRecord(Anchored):
    """One mailbox a public form named, as `mailbox_anchors` stores it; no read serves it."""

    # The mailbox's hash, never the address.
    id: str = Field(validation_alias="_id")
    anchored_at: datetime


class FLAcceptBewerbungPayload(BasePayload):
    """Which group the school enters, and the kit colour the league assigns it; the season is the application's own."""

    gruppe: FLGruppenNames
    # Assigned rather than read off `trikot.wunschfarbe`: a wish is not an assignment, and two
    # schools may wish for one colour.
    trikot_farbe: FLTrikotFarbe | None
    # The club's code for a new school, null for a picked club, which holds its own. The administrator sets it here and
    # the applicant never does, so a taken one is refused on this box (`duplicate_key`, naming `shorthand`).
    shorthand: CustomShorthand | None
    version: CustomVersion


# Why an application was declined, which is mailed as well as stored.
BEWERBUNG_DECISION_REASON_MAX_LENGTH: Final = 1000


class FLDeclineBewerbungPayload(BasePayload):
    """Why the application was declined."""

    # The ceiling counts what arrives and the floor what is left after the strip, so the published `maxLength` is what the
    # write accepts and spaces alone are no reason.
    reason: Annotated[
        str,
        StringConstraints(max_length=BEWERBUNG_DECISION_REASON_MAX_LENGTH, pattern=PARAGRAPH_PATTERN),
        AfterValidator(str.strip),
        StringConstraints(min_length=1),
    ]
    version: CustomVersion


class FLBewerbungGruppeOffer(BaseModel):
    """One group an acceptance may name, and whether it has room."""

    gruppe: FLGruppenNames
    # The places left, none where it is full: the bulk accept's cards take their own run's picks off this.
    free: int


class FLBewerbungEntryOffer(BaseReadModel):
    """What an acceptance into one season would meet, so a caller offers what the write takes without deriving it."""

    # An application is accepted into a `future` season alone (`entry_saison_not_future`).
    status: FLSaisonStatus
    # The groups the season's rules offer, in their order.
    gruppen: list[FLBewerbungGruppeOffer]
    # The kit colours another row of the season holds, in the palette's order, which the dialog and the bulk card disable.
    taken: list[FLTrikotFarbe]


class FLBewerbungListRow(BaseReadModel):
    """One application of a season's list, holding nothing of a person."""

    id: CustomObjectId
    version: int
    status: FLBewerbungStatus
    submitted_at: CustomDateString
    # The school as submitted, or the picked club's own name.
    name: str
    # Stated by `schule`, which an acceptance leaves in place.
    new_school: bool
    # The code of the club it names; a new school takes one from the acceptance.
    shorthand: str | None
    wunschfarbe: FLTrikotFarbe
    # What the bulk accept's card shows beside the colour, so its run takes no read per card.
    stufengroesse: int
    expected_kader: int
    wunschgegner: str | None
    seats_confirmed: int
    # The people its seats name, one person holding two counting once: whom an acceptance mails.
    people: int
    # Whether this open application and another one for the season name the same club (`Dublette`).
    duplicate: bool
    # Whether this open application holds a seat past `OPEN_LINKS_PER_MAILBOX`, which the sweep erases with the application
    # unless an administrator sends its link.
    unmailed: bool


class FLBewerbungenAdminListResponse(BaseReadModel):
    """The season's applications and what an acceptance would meet there."""

    saison: FLBewerbungEntryOffer
    bewerbungen: list[FLBewerbungListRow]


class FLBewerbungEntry(BaseModel):
    """Where an accepted application's club stands in the season, which the decision itself does not record."""

    gruppe: FLGruppenNames
    trikot_farbe: FLTrikotFarbe | None


class FLBewerbungSingleResponse(BaseReadModel):
    """One application, with what an acceptance of it would meet."""

    bewerbung: FLBewerbung
    # Null until an acceptance enters the club.
    entry: FLBewerbungEntry | None
    # The school as submitted, or the picked club's own name.
    name: str
    # The code of the club it names, which the acceptance shows closed; null for a new school until it is accepted.
    shorthand: str | None
    seats_confirmed: int
    # What `FLBewerbungListRow.duplicate` says of this application, which that row's one chip may leave unsaid.
    duplicate: bool
    saison: FLBewerbungEntryOffer


# Every model of the public submission below is reached from a request body alone, so each forbids an undeclared key;
# the read models above stay lax.


class FLBewerbungKontaktpersonPayload(_KontaktpersonWritablePayload):
    """One of the three people, as a member of the public submits them, without a birthdate."""


class FLBewerbungKontaktePayload(BasePayload):
    """The three people an application is reached through, all three required."""

    trainer: FLBewerbungKontaktpersonPayload
    ansprechperson: FLBewerbungKontaktpersonPayload
    stellvertretung: FLBewerbungKontaktpersonPayload
    trainer_is_also: FLTrainerAlso | None

    @model_validator(mode="after")
    def the_trainer_equals_the_seat_they_also_hold(self) -> Self:
        """Where one person holds two seats, the two blocks agree field for field.

        A mismatch is a drifted client, and stored it leaves two records of one person, unpaired by the
        erasure and mailed two links.
        """

        if self.trainer_is_also is not None and getattr(self, self.trainer_is_also) != self.trainer:
            raise ValueError(f"the seat '{self.trainer_is_also}' the Trainer also holds carries other details than the Trainer's")

        return self


class FLBewerbungAddressPayload(FLAddressPayload):
    """The school's address, with the district required."""

    # The ceiling on what arrives and the floor after the strip, so spaces alone are no district.
    district: Annotated[
        str, StringConstraints(max_length=ADDRESS_DISTRICT_MAX_LENGTH), AfterValidator(str.strip), StringConstraints(min_length=1)
    ]


class FLBewerbungSchulePayload(FLBewerbungSchule, BasePayload):
    """The club a new school proposes, bounded and stripped for the write."""

    # Stripped before the floor counts it: `team_name` reaches a league table row. The ceilings are
    # here and not on the read model, which the triage reads a stored one through.

    # `SINGLE_LINE_PATTERN` earns a second reason on these two: the decision mail renders them as
    # `label: value` rows, so a name holding a CR or an LF forges a line the reader cannot tell from
    # a stated fact.
    team_name: Annotated[
        str,
        StringConstraints(max_length=TEAM_NAME_MAX_LENGTH, pattern=SINGLE_LINE_PATTERN),
        AfterValidator(str.strip),
        StringConstraints(min_length=1),
    ]
    full_name: Annotated[
        str,
        StringConstraints(max_length=TEAM_FULL_NAME_MAX_LENGTH, pattern=SINGLE_LINE_PATTERN),
        AfterValidator(str.strip),
        StringConstraints(min_length=1),
    ]
    # Required and non-null here alone: the form offers the real Schulformen and no "keine
    # Angabe". The stored field stays nullable.
    schulform: FLSchulform
    address: FLBewerbungAddressPayload
    # Constrained here where the read model leaves it a bare string: acceptance parses this block
    # through `FLPostTeamPayload`, so a value refused there is one an administrator cannot accept.

    website_url: CustomOptionalWebsiteUrl


# What kit the school already owns, in its own words, bounded because an anonymous caller writes it and it is
# stored. Lower than a decline's reason, because a colour, a count and a size need nothing like a page.
BEWERBUNG_TRIKOT_SET_MAX_LENGTH: Final = 500


class FLBewerbungTrikotPayload(FLBewerbungTrikot, BasePayload):
    # No floor: a school that owns no kit writes nothing here, so the empty string is the honest
    # answer. A ceiling all the same -- an anonymous caller writes it, and it is stored.
    existing_set: str = Field(max_length=BEWERBUNG_TRIKOT_SET_MAX_LENGTH)


# The school's estimate of its squad, and the strong players inside it. A ceiling that is a squad
# size, not `int32`: past this the number is a typo. Not the season's `max_kader_size`, which an
# application is held true against nothing of.
BEWERBUNG_KADER_SIZE_MAX: Final = 200


class FLBewerbungKaderPayload(FLBewerbungKader, BasePayload):
    # `ge=1` because a squad of nobody enters no season; `good_spieler` counts a subset of it, so
    # zero is its floor.

    # The ceiling keeps an int32 validator from answering 500 where this endpoint promises 422.
    expected_size: int = Field(ge=1, le=BEWERBUNG_KADER_SIZE_MAX)
    good_spieler: int = Field(ge=0, le=BEWERBUNG_KADER_SIZE_MAX)

    @model_validator(mode="after")
    def the_strong_players_are_a_subset_of_the_kader(self) -> Self:
        """A subset cannot outnumber the whole, and both figures are one school's own estimate.

        A 422 like the distinctness rule: a shape rule about the body, judged against no database.
        Equal is fine -- a school may rate its whole squad.
        """

        if self.good_spieler > self.expected_size:
            raise rule_refusal("good_spieler_exceed_kader", "more strong players than the expected squad", {"max": self.expected_size})

        return self


# How many pupils one Abi-Jahrgang holds, the ones who never play included. A ceiling that is a
# cohort rather than `int32`: no German school graduates a thousand pupils in one year.
BEWERBUNG_STUFENGROESSE_MAX: Final = 999

# The opponent a school would like on the first Spieltag, typed freely rather than picked, so a school's full name
# fits: nothing holds an applicant to a league short name.
BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH: Final = TEAM_FULL_NAME_MAX_LENGTH


class FLPostBewerbungPayload(BasePayload):
    """One school's application, as the public form submits it.

    `status`, `submitted_at` and `decision` are the server's.
    """

    # The width on what arrives and again after the strip, so the published bound is what the write accepts.
    saison_id: Annotated[
        str,
        StringConstraints(max_length=SAISON_ID_LENGTH),
        AfterValidator(str.strip),
        StringConstraints(min_length=SAISON_ID_LENGTH),
    ]
    # The club picked off the autocomplete, null where the applicant proposed a new school;
    # `bewerbung_submission_subject_unresolved` holds exactly one of this and `schule` filled in.
    team_id: CustomObjectId | None
    schule: FLBewerbungSchulePayload | None
    kontakte: FLBewerbungKontaktePayload
    trikot: FLBewerbungTrikotPayload
    kader: FLBewerbungKaderPayload
    # Required where `wunschgegner` is defaulted: a wish has a null answer and a cohort's size has
    # none, so an omitted key is a 422. `ge=1` -- a school with no Abi-Jahrgang fields no team.
    stufengroesse: int = Field(ge=1, le=BEWERBUNG_STUFENGROESSE_MAX)
    # Defaulted where this payload's other nullable keys are required: the deploy recreates both packages at one pinned
    # build, so the only form older than this field is a page already open in a visitor's browser across a recreate.

    # What the default costs: `extra="forbid"` makes a misspelled key a 422 while an omitted one is a
    # silent null, so a frontend regression that stops sending this ships green -- where every
    # sibling's omission is a 422.

    # No floor, `parse_empty_string_to_none` leaving nothing between null and a real name:
    # `min_length` counts characters, so spaces alone would be stored as a wish the school made.
    wunschgegner: Annotated[
        Annotated[
            str,
            StringConstraints(max_length=BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH, pattern=SINGLE_LINE_PATTERN),
            AfterValidator(str.strip),
        ]
        | None,
        BeforeValidator(parse_empty_string_to_none),
    ] = None


class FLBewerbungSchuleOption(BaseModel):
    """One club as the public form offers it: its id and its name."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    name: CustomNonEmptyString


FLBewerbungSchuleOptionListAdapter = TypeAdapter(list[FLBewerbungSchuleOption])


# Where a season's window stands today: taking applications, opening on its `start`, shut, or over with its season.
# `closed` folds a pause into a window past its end, which the submission's refusal tells no anonymous visitor apart,
# and a pause names no day it lifts. `ended` serves nothing the rule withholds: `future` and
# `active` answer alike, and a finished season reads as over whatever dates it stores.
FLBewerbungWindowState = Literal["running", "upcoming", "closed", "ended"]


class FLBewerbungFormWindow(BaseModel):
    """A season's application window as the form's page shows it."""

    # The day an `upcoming` window opens.
    start: CustomDateString
    # The whole judgement, computed server-side, so the page reads no day of its own against a clock this server does not share.
    state: FLBewerbungWindowState


class FLBewerbungFormResponse(BaseReadModel):
    """What one season's application form shows, whichever state its page takes."""

    # Null where the season records no window.
    window: FLBewerbungFormWindow | None
    # Empty unless the window runs: a page showing no form asks for neither, and a season not taking applications tells this
    # tier nothing of its colours.
    schulen: list[FLBewerbungSchuleOption]
    # Taken, and by nobody this answer names.
    taken: list[FLTrikotFarbe]


# A confirmation's token is the whole credential, as a sign-in code is, so every payload below forbids an undeclared key.

# What a reopened link shows: where its seat stands.
# `saison_past`, a season row's alone, takes a Widerspruch and no consent (`kontakt_saison_past`).
FLBewerbungEinwilligungState = Literal[FLBewerbungSeatState, "saison_past"]

# Which record a link's seat sits on: an application, or a team's season row an administrator seated
# the person on. The page picks its wording by it.
FLEinwilligungRecordKind = Literal["bewerbung", "saison"]


class _FLBewerbungEinwilligungSeatView(BaseReadModel):
    """The seat a link asks about, as a page that still offers a press names it, and nothing of the person."""

    saison_id: str
    # The school's name as submitted, or the picked club's; on a season row, the name the club
    # carries in that season.
    schule: str
    seat: FLKontaktSeat
    # The second seat this link's answer writes, and never `trainer_is_also` itself: null on every other seat, so no link
    # says whether two other seats are one person.
    also_seat: FLKontaktSeat | None


class FLBewerbungEinwilligungViewValid(_FLBewerbungEinwilligungSeatView):
    """A standing link: the question, until its day, judged by the age bounds of the seats it answers for."""

    state: Literal["valid"]
    record: FLEinwilligungRecordKind
    # The person's floor over the seats this link answers for, so the page bounds its date control
    # and fills its own sentences from what the answer will judge rather than from a constant.
    minimum_age: int
    # The ceiling beside it, `confirmation_age`'s other bound.
    maximum_age: int
    # The day this seat's link stops working, which the page's text names.
    deadline: CustomDateString


class FLBewerbungEinwilligungViewSaisonPast(_FLBewerbungEinwilligungSeatView):
    """A season row's link once its season ended or its club left: it takes a Widerspruch and no consent."""

    state: Literal["saison_past"]
    record: Literal["saison"]
    # The row's state, read as the mint reads it, so the page can name why it takes no consent.
    row: FLKontaktRow


class FLBewerbungEinwilligungViewAnswered(BaseReadModel):
    """A link opened again after its person's consent or Widerspruch."""

    state: Literal["confirmed", "declined"]
    # The day the person answered, which the page says.
    answered_at: CustomDateString


class FLBewerbungEinwilligungViewExpired(BaseReadModel):
    """A spent link, its deadline passed or its application decided, which opens nothing more."""

    state: Literal["expired"]


# One member per state, as the landing's season is: each state is served with exactly the fields its page reads, so an
# answered link holding no day is a refused answer rather than a null the page must guess about, and no application's
# link can be written as a closed row.
FLBewerbungEinwilligungViewResponse = Annotated[
    FLBewerbungEinwilligungViewValid
    | FLBewerbungEinwilligungViewSaisonPast
    | FLBewerbungEinwilligungViewAnswered
    | FLBewerbungEinwilligungViewExpired,
    Field(discriminator="state"),
]


class FLBewerbungEinwilligungGiven(BasePayload):
    """One person's consent for one seat: their own birthdate, their two choices and the wording they saw."""

    answer: Literal["given"]
    token: CustomToken
    # Unbounded here: the age is its own code (`confirmation_age`), never a `payload_refused`.
    birth_date: CustomDateString
    whatsapp: bool
    # Required as `whatsapp` is: a page that forgot the switch is refused rather than read as a no.
    media: bool
    # The wordings the confirming person saw beside the two switches, which their evidence cites.
    text_versions: FLSeatTextVersions


class FLBewerbungEinwilligungDeclined(BasePayload):
    """One person's Widerspruch for one seat, which empties their seat: it carries nothing of them."""

    answer: Literal["declined"]
    token: CustomToken


# Tagged by `answer`, Pydantic's discriminated union, so each answer carries exactly its own fields. A route takes it
# as its body's plain annotation: beside FastAPI's `Body()` the tag is dropped, and the union is tried member by member.
FLBewerbungEinwilligungAnswerPayload = Annotated[FLBewerbungEinwilligungGiven | FLBewerbungEinwilligungDeclined, Field(discriminator="answer")]


class FLBewerbungKontaktSeatPayload(_KontaktpersonWritablePayload):
    """The person a seat is to hold, who has agreed to nothing yet, and the `version` the page read the application at."""

    version: CustomVersion


class FLBewerbungKontaktSeatResponse(BaseReadModel):
    """A seat's address as the write left it; the link is owed there in the same write."""

    # Answered rather than re-derived by the caller, so one function decides the form a message is sent to.
    email: str


class FLBewerbungSweepResponse(BaseReadModel):
    """One season's pass: the rows it passed over, which the next pass meets again."""

    # One sum over every clock rather than a count a clock: the line logging each row names its clock.
    failed: int
