from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints, TypeAdapter, model_validator

from app.api.outbox.schemas import FLOutboxStatus
from app.api.teams.schemas import FLSaisonTeamKontakte, FLTrainerAlso, _KontaktpersonWritablePayload
from app.core.exceptions import rule_refusal
from app.shared.age import whole_years_between
from app.shared.schemas.addresses import FLAddress, FLAddressPayload
from app.shared.schemas.bounds import (
    ADDRESS_STADTTEIL_MAX_LENGTH,
    BEWERBUNG_DECISION_REASON_MAX_LENGTH,
    BEWERBUNG_KADER_SIZE_MAX,
    BEWERBUNG_KONTAKT_MAX_AGE_YEARS,
    BEWERBUNG_STUFENGROESSE_MAX,
    BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH,
    BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH,
    SAISON_ID_LENGTH,
    TEAM_FULL_NAME_MAX_LENGTH,
    TEAM_NAME_MAX_LENGTH,
    TEAM_WEBSITE_URL_MAX_LENGTH,
)
from app.shared.schemas.confirmation import CustomToken
from app.shared.schemas.custom import (
    PARAGRAPH_PATTERN,
    SINGLE_LINE_PATTERN,
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomOptionalDateString,
    CustomShorthand,
    CustomVersion,
    parse_empty_string_to_none,
    validate_external_url,
)
from app.shared.schemas.einwilligung import FLSeatTextVersions, refuse_a_stale_grant

# Imported rather than restated: an application's three people BECOME the junction's three people at
# acceptance, so a second declaration of the block is one the two would drift apart on. Acyclic --
# no model in `teams` imports this slice.
from app.shared.schemas.literals import (
    FLGruppenNames,
    FLKontaktRolle,
    FLKontaktRow,
    FLSaisonStatus,
    FLSchulform,
    FLTrikotFarbe,
)
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel

# `submitted` is the only state a submission arrives in; the other two are the triage's, and
# `app/api/bewerbungen/admin_router.py` is the only writer of either.
type FLBewerbungStatus = Literal["submitted", "accepted", "declined"]


# Where one seat of an application stands, as its link and the triage both say it. `expired` is a spent link, its deadline
# passed or its application decided, said one way.
FLBewerbungSeatState = Literal["valid", "confirmed", "declined", "expired"]


class _FLBewerbungSitzStand(BaseReadModel):
    """One seat's confirmation bookkeeping, as the record and the read share it."""

    # The day the link was last mailed; a re-send moves it. Null on a seat the submission owed no mail, its mailbox holding
    # `app/api/bewerbungen/services.py :: OPEN_LINKS_PER_MAILBOX` unanswered links, until an administrator sends one.
    sent_at: CustomOptionalDateString
    # The day this seat's link stops working, counted from that mail, and the application goes with it if its person
    # never answers. NOT the season's `Bewerbungsfrist`, which is the window the form is open in.
    deadline: CustomDateString
    reminded_at: CustomOptionalDateString
    # Beside the slot rather than inside it: a decline EMPTIES the person's slot, and a marker in
    # there would go with it.
    declined_at: CustomOptionalDateString


class FLBewerbungConfirmation(_FLBewerbungSitzStand):
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

    # `team_name`, not `name`: it becomes the club's SHORT name beside `full_name`, and `name` inside
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

    existing_satz: str
    wunschfarbe: FLTrikotFarbe


class FLBewerbungKader(BaseModel):
    """The school's own estimate of its squad, which nothing checks afterwards."""

    expected_size: int
    # Non-nullable: the form asks for a count, and none of them is zero.
    good_spieler: int


class FLBewerbungEntscheidung(BaseModel):
    """Who decided this application, when, and on a decline why."""

    made_at: CustomDateString
    by: str
    # Null on an acceptance: what an acceptance did is the club and the junction row it wrote, and a
    # reason field filled in with "angenommen" would be a second, weaker record of that.
    reason: str | None


class FLBewerbungDecisionRow(FLBewerbungEntscheidung):
    """A decision as every read serves it: the stored one, its administrator withheld where the ban list holds that address."""

    # Null exactly where `by_barred` is set, as the grants list withholds its actors.
    by: str | None
    by_barred: bool


class FLBewerbung(BaseReadModel):
    """One school's application to play one season, as stored, its decision as served."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    # What a decision or a seat write sends back, so one over an application another write moved since is refused as stale.
    version: int = 0
    saison_id: str
    submitted_at: CustomDateString
    status: FLBewerbungStatus
    # The club the applicant PICKED, null where they proposed a new school. Acceptance writes the
    # created club's id back here, so a decided application always names one.
    team_id: CustomObjectId | None
    schule: FLBewerbungSchule | None
    kontakte: FLSaisonTeamKontakte
    trikot: FLBewerbungTrikot
    kader: FLBewerbungKader
    # How many pupils the school's whole Abi-Jahrgang holds, which the applicant states and nothing
    # later checks.
    stufengroesse: int
    # A FREE STRING, never a club reference: the school may name an applicant the league has not
    # accepted yet, and a picker over the accepted ones would give a LATER applicant the longer list.
    wunschgegner: str | None
    # As served, so a row reaches the wire only through
    # `app/api/bewerbungen/services.py :: mit_vorenthaltener_entscheidung`.
    decision: FLBewerbungDecisionRow | None
    confirmations: FLBewerbungConfirmations


class FLBewerbungBestaetigungRecord(_FLBewerbungSitzStand):
    """One seat's bookkeeping as `bewerbungen` stores it: the hash of every link it was mailed, each live until a re-send."""

    token_hashes: list[str]


class FLBewerbungBestaetigungenRecord(FLBewerbungConfirmations):
    trainer: FLBewerbungBestaetigungRecord | None
    ansprechperson: FLBewerbungBestaetigungRecord | None
    stellvertretung: FLBewerbungBestaetigungRecord | None


class FLBewerbungRecord(FLBewerbung):
    """One application as `bewerbungen` stores it: its decision before any administrator is withheld, and what no read serves."""

    decision: FLBewerbungEntscheidung | None
    confirmations: FLBewerbungBestaetigungenRecord
    # The retention sweep's announcement, and the submission's replay key and digest.
    erasure_announced_at: str | None = None
    idempotency_key: str | None = None
    idempotency_fingerprint: str | None = None


class FLAcceptBewerbungPayload(BaseModel):
    """Which group the school enters, and the kit colour the league assigns it; the season is the application's own."""

    model_config = ConfigDict(extra="forbid")

    gruppe: FLGruppenNames
    # Assigned rather than read off `trikot.wunschfarbe`: a wish is not an assignment, and two
    # schools may wish for one colour.
    trikot_farbe: FLTrikotFarbe | None
    # The club's code for a new school, null for a picked club, which holds its own. The administrator sets it here and
    # the applicant never does, so a taken one is refused on this box (`duplicate_key`, naming `shorthand`).
    shorthand: CustomShorthand | None
    version: CustomVersion


class FLDeclineBewerbungPayload(BaseModel):
    """Why the application was declined."""

    model_config = ConfigDict(extra="forbid")

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
    """What an acceptance into one season would meet, so its dialog offers what the write takes: no page derives it."""

    # An application is accepted into a `future` season alone (`entry_saison_not_future`).
    status: FLSaisonStatus
    # The groups the season's rules offer, in their order.
    gruppen: list[FLBewerbungGruppeOffer]
    # The kit colours another row of the season holds, in the palette's order, which the dialog and the bulk card disable.
    taken: list[FLTrikotFarbe]


class FLBewerbungListRow(BaseReadModel):
    """One application as the season's list shows it, holding nothing of a person."""

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
    # The people its seats name, one person holding two counting once: whom a decision mails.
    people: int
    # Whether this open application and another one for the season name the same club (`Dublette`).
    duplicate: bool


class FLBewerbungenAdminListResponse(BaseAPIResponse):
    """The season's applications and what an acceptance would meet there."""

    saison: FLBewerbungEntryOffer
    bewerbungen: list[FLBewerbungListRow]
    # Whether every row was served, which an administrator must be able to trust: this is the one list an anonymous
    # party writes rows into. A cut drops unconfirmed rows alone, the oldest first.
    complete: bool


class FLBewerbungEntry(BaseModel):
    """Where an accepted application's club stands in the season, which the decision itself does not record."""

    gruppe: FLGruppenNames
    trikot_farbe: FLTrikotFarbe | None


class FLBewerbungSingleResponse(BaseAPIResponse):
    """One application as its review page shows it."""

    bewerbung: FLBewerbung
    # Null until an acceptance enters the club.
    entry: FLBewerbungEntry | None
    # The school as submitted, or the picked club's own name.
    name: str
    # The code of the club it names, which the acceptance shows closed; null for a new school until it is accepted.
    shorthand: str | None
    seats_confirmed: int
    saison: FLBewerbungEntryOffer


class FLAcceptBewerbungResponse(BaseAPIResponse):
    """What the acceptance wrote beyond the application: the club in the season, and where; its mails are owed in the same write."""

    # The club now standing in the season: the one the applicant picked, or the one this acceptance
    # created. Echoed because a created club has an id the caller has no other way to learn.
    team_id: CustomObjectId
    # Whether this acceptance created that club, which the admin surface words differently either
    # way: what the caller renders is what this call DID, not what the application holds.
    created_team: bool
    # Unconstrained, as an echo of a stored id is.
    saison_id: str
    gruppe: FLGruppenNames
    trikot_farbe: FLTrikotFarbe | None


class FLDeclineBewerbungResponse(BaseAPIResponse):
    """The declined application; its mails are owed in the same write."""

    id: CustomObjectId


# --- The PUBLIC submission. Every model below is reached from a request body alone, so each forbids
# an undeclared key; the read models above stay lax.


def age_outside_the_bounds(*, birth_date: str, today: str, minimum_age: int) -> bool:
    """Whether the league would hold no details for this contact person, in whole years against `today`.

    `today` a parameter, so both boundaries are pinnable without a clock; above the ceiling the date is a typo.
    """

    age = whole_years_between(born=birth_date, today=today)

    # The CALLER's floor, never a constant read here: a person's is the highest of the seats they
    # hold (`app/api/bewerbungen/services.py :: mindestalter_for`).
    return not minimum_age <= age <= BEWERBUNG_KONTAKT_MAX_AGE_YEARS


class FLBewerbungKontaktpersonPayload(_KontaktpersonWritablePayload):
    """One of the three people, as a member of the public submits them, without a birthdate."""


class FLBewerbungKontaktePayload(BaseModel):
    """The three people an application is reached through, all three required."""

    model_config = ConfigDict(extra="forbid")

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
    """The school's address, with the Stadtteil required."""

    # The ceiling on what arrives, the floor after the strip, as `reason`'s.
    stadtteil: Annotated[
        str, StringConstraints(max_length=ADDRESS_STADTTEIL_MAX_LENGTH), AfterValidator(str.strip), StringConstraints(min_length=1)
    ]


class FLBewerbungSchulePayload(FLBewerbungSchule):
    """The club a new school proposes, bounded and stripped for the write."""

    model_config = ConfigDict(extra="forbid")

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
    # Required and NON-NULL here alone: the form offers the real Schulformen and no "keine
    # Angabe". The stored field stays nullable (`app/api/teams/schemas.py :: _TeamWritable.schulform`).
    schulform: FLSchulform
    address: FLBewerbungAddressPayload
    # Constrained here where the read model leaves it a bare string: acceptance parses this block
    # through `FLPostTeamPayload`, so a value refused there is one an administrator cannot accept.

    # Composed from `str` rather than wrapping `CustomExternalUrl`, so the ceiling is judged BEFORE
    # the host regex runs -- `validate_external_url` reads the scheme and the host and no length.
    website_url: Annotated[
        Annotated[
            str,
            StringConstraints(max_length=TEAM_WEBSITE_URL_MAX_LENGTH),
            AfterValidator(str.strip),
            AfterValidator(validate_external_url),
        ]
        | None,
        BeforeValidator(parse_empty_string_to_none),
    ]


class FLBewerbungTrikotPayload(FLBewerbungTrikot):
    model_config = ConfigDict(extra="forbid")

    # No floor: a school that owns no kit writes nothing here, so the empty string is the honest
    # answer. A ceiling all the same -- an anonymous caller writes it, and it is stored.
    existing_satz: str = Field(max_length=BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH)


class FLBewerbungKaderPayload(FLBewerbungKader):
    model_config = ConfigDict(extra="forbid")

    # `ge=1` because a squad of nobody enters no season; `good_spieler` counts a subset of it, so
    # zero is its floor.

    # The CEILING keeps an int32 validator from answering 500 where this endpoint promises 422.
    expected_size: int = Field(ge=1, le=BEWERBUNG_KADER_SIZE_MAX)
    good_spieler: int = Field(ge=0, le=BEWERBUNG_KADER_SIZE_MAX)

    @model_validator(mode="after")
    def the_strong_players_are_a_subset_of_the_squad(self) -> Self:
        """A subset cannot outnumber the whole, and both figures are one school's own estimate.

        A 422 like the distinctness rule: a shape rule about the body, judged against no database.
        Equal is fine -- a school may rate its whole squad.
        """

        if self.good_spieler > self.expected_size:
            raise rule_refusal("good_spieler_exceed_kader", "more strong players than the expected squad", {"max": self.expected_size})

        return self


class FLPostBewerbungPayload(BaseModel):
    """One school's application, as the public form submits it.

    `status`, `submitted_at` and `decision` are the server's.
    """

    model_config = ConfigDict(extra="forbid")

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
    # DEFAULTED where this payload's other nullable keys are required: `scripts/ops/deploy.sh` recreates
    # both packages at one pinned build, so the only form older than this field is a page already
    # open in a visitor's browser across a recreate.

    # What the default costs: `extra="forbid"` makes a misspelled key a 422 while an omitted one is a
    # silent null, so a frontend regression that stops sending this ships green -- where every
    # sibling's omission is a 422.

    # `SINGLE_LINE_PATTERN` earns a second reason here:
    # `fl_frontend/src/core/bewerbungEmail.ts :: wunschgegnerAbsatz` sets this inside a sentence, and a
    # break there still opens a line in a line-oriented text body.

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
# `closed` folds a pause into a window past its end, which `app/api/bewerbungen/services.py :: find_window_refusal` tells no
# anonymous visitor apart, and a pause names no day it lifts. `ended` serves nothing the rule withholds: `future` and
# `active` answer alike, and a finished season reads as over whatever dates it stores.
FLBewerbungWindowState = Literal["running", "upcoming", "closed", "ended"]


class FLBewerbungFormWindow(BaseModel):
    """A season's application window as the form's page shows it."""

    # The day an `upcoming` window opens.
    start: CustomDateString
    # The whole judgement, computed server-side, so the page reads no day of its own against a clock this server does not share.
    state: FLBewerbungWindowState


class FLBewerbungFormResponse(BaseAPIResponse):
    """What one season's application form shows, whichever state its page takes."""

    # Null where the season records no window.
    window: FLBewerbungFormWindow | None
    # Empty unless the window runs: a page showing no form asks for neither, and a season not taking applications tells this
    # tier nothing of its colours.
    schulen: list[FLBewerbungSchuleOption]
    # Taken, and by nobody this answer names.
    taken: list[FLTrikotFarbe]


# --- The CONFIRMATION. The token is the whole credential, as a sign-in code is, so both
# endpoints are base-tier and every payload forbids an undeclared key.

# What a reopened link shows: where its seat stands, with `barred` ranking first.
# `saison_past`, a season row's alone, takes a Widerspruch and no consent (`kontakt_saison_past`).
FLBewerbungEinwilligungZustand = Literal[FLBewerbungSeatState, "saison_past", "barred"]

# Which record a link's seat sits on: an application, or a team's season row an administrator seated
# the person on. The page picks its wording by it.
FLEinwilligungQuelle = Literal["bewerbung", "saison"]

# What an answer on either kind of link did.
type FLEinwilligungErgebnis = Literal["confirmed", "declined"]


class FLBewerbungEinwilligungViewResponse(BaseAPIResponse):
    """What the page renders for one seat, and nothing of the person."""

    quelle: FLEinwilligungQuelle
    state: FLBewerbungEinwilligungZustand
    # A season row's state now, read as the mint reads it, so a closed row's page can name why it takes
    # no consent; null on an application's link, which no season or withdrawal closes.
    row: FLKontaktRow | None
    saison_id: str
    # The school's name as submitted, or the picked club's; on a season row, the name the club
    # carries in that season.
    schule: str
    rolle: FLKontaktRolle
    # The second seat this link's answer writes (`app/api/bewerbungen/services.py :: paired_seat`),
    # and never `trainer_is_also` itself: null on every other seat, so no link says whether two
    # OTHER seats are one person.
    also_rolle: FLKontaktRolle | None
    # The PERSON's floor over the seats this link answers for, so the page bounds its date control
    # and fills its own sentences from what the answer will judge rather than from a constant.
    minimum_age: int
    # The ceiling beside it, `confirmation_age`'s other bound.
    maximum_age: int
    # The day this seat's link stops working, which the page's text names; null on a seat holding none.
    deadline: CustomOptionalDateString
    # The day the person answered, which a reopened link says; null while they have not.
    answered_at: CustomOptionalDateString
    # The age from which the page offers the media switch, `media_age`'s floor.
    media_minimum_age: int = Field(gt=0)


class FLBewerbungEinwilligungGiven(BaseModel):
    """One person's consent for one seat: their own birthdate, their two choices and the wording they saw."""

    model_config = ConfigDict(extra="forbid")

    answer: Literal["given"]
    token: CustomToken
    # Unbounded here: the age is its own code (`confirmation_age`), never a `payload_refused`.
    birth_date: CustomDateString
    whatsapp: bool
    # Required as `whatsapp` is: a page that forgot the switch is refused rather than read as a no.
    media: bool
    # The wordings the confirming person saw beside the two switches, which their evidence cites.
    text_versions: FLSeatTextVersions

    @model_validator(mode="after")
    def _grants_name_the_current_wording(self) -> Self:
        refuse_a_stale_grant(self.text_versions, {"scope": "kontaktdaten_whatsapp" if self.whatsapp else "kontaktdaten", "media": self.media})
        return self


class FLBewerbungEinwilligungDeclined(BaseModel):
    """One person's Widerspruch for one seat, which empties their slot: it carries nothing of them."""

    model_config = ConfigDict(extra="forbid")

    answer: Literal["declined"]
    token: CustomToken


# Tagged by `answer`, Pydantic's discriminated union, so each answer carries exactly its own fields. A route takes it
# as its body's plain annotation: beside FastAPI's `Body()` the tag is dropped, and the union is tried member by member.
FLBewerbungEinwilligungAnswerPayload = Annotated[FLBewerbungEinwilligungGiven | FLBewerbungEinwilligungDeclined, Field(discriminator="answer")]


class FLBewerbungEinwilligungAnswerResponse(BaseAPIResponse):
    """What the answer did; a Widerspruch's notice to the Ansprechperson is owed in the same write."""

    quelle: Literal["bewerbung"] = "bewerbung"
    ergebnis: FLEinwilligungErgebnis
    birth_date: CustomOptionalDateString
    whatsapp: bool
    # As stored on every seat the answer wrote, as the referee's answer carries it: `false` after a
    # Widerspruch, which stores no answer.
    media: bool


class FLSaisonTeamEinwilligungAnswerResponse(BaseAPIResponse):
    """What an answer on a season row's link did; nobody is told, so nothing composes a message."""

    quelle: Literal["saison"] = "saison"
    ergebnis: FLEinwilligungErgebnis
    birth_date: CustomOptionalDateString
    whatsapp: bool
    # `FLBewerbungEinwilligungAnswerResponse.media`'s.
    media: bool


FLEinwilligungAnswerResponse = Annotated[
    FLBewerbungEinwilligungAnswerResponse | FLSaisonTeamEinwilligungAnswerResponse,
    Field(discriminator="quelle"),
]


class FLBewerbungEinwilligungResendResponse(BaseAPIResponse):
    """The seat whose link was replaced and where its fresh one is owed; the old one opens nothing."""

    rolle: FLKontaktRolle
    # Off the image the write replaced, never the caller's earlier read: a seat write landing between
    # the two moved the address this link has to go to.
    email: str
    rollen: list[FLKontaktRolle]
    confirmation_deadline: CustomDateString


class FLBewerbungKontaktSeatPayload(_KontaktpersonWritablePayload):
    """The person a seat is to hold, who has agreed to nothing yet, and the `version` the page read the application at."""

    version: CustomVersion


class FLBewerbungKontaktSeatResponse(BaseAPIResponse):
    """A seat's address as the write left it; the link is owed there in the same write."""

    # Answered rather than re-derived by the caller, so one function decides the form a message is sent to.
    email: str


# --- The retention SWEEP, system tier. The backend decides, erases and owes each mail in the Postausgang; nothing a
# person's record holds leaves here (`READ-BEWERBUNG-004`).


class FLBewerbungSweepResponse(BaseAPIResponse):
    """One season's pass: each clock's count, every reminder and deletion notice owed in the write it belongs to."""

    saison_id: str
    # The applications reminded: each person due their one chase is owed it.
    reminded: int
    # The fourteen-day clock's erasures, each owed its notice in its own transaction where none went out before.
    erased: int
    erased_declined: int
    erased_accepted: int
    # The applications nobody decided, taken by the end of the season they applied for. Counted apart
    # from the two decided ones: folded in, a pass that erased where nobody decided would read as a
    # decision.
    erased_without_decision: int
    kontakt_blocks_emptied: int
    # A season row's seats past their own day unconfirmed, whatever the season's status.
    kontakt_seats_emptied: int
    redacted_action_log: int
    # One sum over every clock rather than a count a clock: the line logging each row names its clock.
    failed: int
