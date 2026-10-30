from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints, TypeAdapter, model_validator
from pydantic_core import PydanticCustomError

from app.api.outbox.schemas import FLOutboxStatus
from app.api.teams.schemas import FLSaisonTeamKontakte, FLSaisonTeamKontaktePayload, _KontaktpersonWritablePayload
from app.shared.alter import whole_years_between
from app.shared.schemas.addresses import FLAddress, FLAddressPayload
from app.shared.schemas.bounds import (
    ADDRESS_STADTTEIL_MAX_LENGTH,
    BEWERBUNG_GRUND_MAX_LENGTH,
    BEWERBUNG_KADER_SIZE_MAX,
    BEWERBUNG_KONTAKT_MAX_AGE_YEARS,
    BEWERBUNG_STUFENGROESSE_MAX,
    BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH,
    BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH,
    LIST_LIMIT_DEFAULT,
    LIST_LIMIT_MAX,
    SAISON_ID_LENGTH,
    TEAM_FULL_NAME_MAX_LENGTH,
    TEAM_NAME_MAX_LENGTH,
    TEAM_WEBSITE_URL_MAX_LENGTH,
)
from app.shared.schemas.confirmation import CustomToken
from app.shared.schemas.custom import (
    SINGLE_LINE_PATTERN,
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomOptionalDateString,
    CustomShorthand,
    parse_empty_string_to_none,
    validate_external_url,
)
from app.shared.schemas.einwilligung import CustomEinwilligungTextVersion, FLEinwilligungStand
from app.shared.schemas.kontakt import CustomEmail

# Imported rather than restated: an application's three people BECOME the junction's three people at
# acceptance, so a second declaration of the block is one the two would drift apart on. Acyclic --
# no model in `teams` imports this slice.
from app.shared.schemas.literals import (
    FLGruppenNames,
    FLKontaktKenntnisnahmeUmfang,
    FLKontaktRolle,
    FLKontaktRow,
    FLSchulform,
    FLSortOrder,
    FLTrikotFarbe,
)
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel

# `submitted` is the only state a submission arrives in; the other two are the triage's, and
# `app/api/bewerbungen/admin_router.py` is the only writer of either.
type FLBewerbungStatus = Literal["submitted", "accepted", "declined"]

# Which seasons a read covers, RELATIVE to the `saison_id` beside it and never a season of its own:
# the triage bar asks about the season an administrator came here about, and no stored field carries
# that answer.
type FLBewerbungSaisonReference = Literal["diese_saison", "other_saison"]

# One key, and it is the one every `bewerbungen` index sorts on: the collection grows with each
# submission and no path removes a row, so a second order would plan a blocking sort over an archive
# nothing bounds.
FLBewerbungenSortOptions = Literal["submitted_at"]


class _FLBewerbungSitzStand(BaseReadModel):
    """One seat's confirmation bookkeeping, as the record and the read share it."""

    # The day the link was last mailed; a re-send moves it.
    sent_at: CustomDateString
    reminded_at: CustomOptionalDateString
    # Beside the slot rather than inside it: a decline EMPTIES the person's slot, and a marker in
    # there would go with it.
    declined_at: CustomOptionalDateString


class FLBewerbungConfirmation(_FLBewerbungSitzStand):
    """One seat's confirmation bookkeeping as the triage reads it, without its link's hashes."""

    # What became of the last mail owed this seat, as the read joins it from the Postausgang: no seat stores it, and null
    # where none was ever owed.
    delivery: FLOutboxStatus | None


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
    shorthand: CustomShorthand
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
    von: str
    # Null on an acceptance: what an acceptance did is the club and the junction row it wrote, and a
    # reason field filled in with "angenommen" would be a second, weaker record of that.
    grund: str | None


class FLBewerbungDecisionRow(FLBewerbungEntscheidung):
    """A decision as every read serves it: the stored one, its administrator withheld where the ban list holds that address."""

    # Null exactly where `by_barred` is set, as the grants list withholds its actors.
    von: str | None
    by_barred: bool


class FLBewerbung(BaseModel):
    """One school's application to play one season, as stored, its decision as served."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
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
    # The day an unconfirmed application is deleted and its links expire. NOT the season's
    # `Bewerbungsfrist`, which is the window the form is open in.
    confirmation_deadline: CustomDateString
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


FLBewerbungListAdapter = TypeAdapter(list[FLBewerbung])


class FLBewerbungenFilterParams(BaseModel):
    """What the triage list may narrow on."""

    saison_id: str | None = None
    # A list for `status`'s reason below, the facet offering these being multi-select. What each
    # value narrows to is published at `app/api/bewerbungen/admin_router.py :: get_bewerbungen`.
    saison_reference: list[FLBewerbungSaisonReference] | None = None
    # A LIST, because the facet offering these is multi-select: one key per value, FastAPI's repeated
    # query parameter. Absent is the facet turned off, `$in` of no value answering nothing.
    status: list[FLBewerbungStatus] | None = None

    # Bounded on BOTH sides, and no null sentinel: this is the one list an anonymous party writes
    # rows into, so `le` caps a caller naming more rather than obeying it, and the default is the
    # ceiling rather than "everything".
    limit: int = Field(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX)
    # Newest first by default: the triage is a queue, and the oldest open application is the one an
    # administrator has already seen.
    sort_by: FLBewerbungenSortOptions = Field(default="submitted_at")
    order: FLSortOrder = Field(default="desc")


class FLAcceptBewerbungPayload(BaseModel):
    """Which group the school enters, and the kit colour the league assigns it; the season is the application's own."""

    model_config = ConfigDict(extra="forbid")

    gruppe: FLGruppenNames
    # Assigned rather than read off `trikot.wunschfarbe`: a wish is not an assignment, and two
    # schools may wish for one colour.
    trikot_farbe: FLTrikotFarbe | None


class FLDeclineBewerbungPayload(BaseModel):
    """Why the application was declined."""

    model_config = ConfigDict(extra="forbid")

    # The ceiling counts what arrives and the floor what is left after the strip, so the published `maxLength` is what the
    # write accepts and spaces alone are no reason.
    grund: Annotated[str, StringConstraints(max_length=BEWERBUNG_GRUND_MAX_LENGTH), AfterValidator(str.strip), StringConstraints(min_length=1)]


class FLBewerbungenListResponse(BaseAPIResponse):
    """The queue, newest first, and whether that is the whole of it.

    `duplicates_key` is taken over every open application, so a pair the cap parted is named at both ends.
    """

    bewerbungen: list[FLBewerbung]
    # German, unlike the envelope fields around it, because `complete` reads as "the read finished"
    # as readily as "the list is whole" -- and this flag decides whether an admin may trust the list.
    complete: bool
    # Counted on the SERVER: the answer holds only the statuses the request asked for, so a caller
    # counting the rows it was served reads zero for each one the server hid and would offer no way
    # back to them.
    count_per_status: dict[FLBewerbungStatus, int]
    # The same, for the season relation the read narrows on: the side it left out has no rows here,
    # and a caller counting what it holds would strand an administrator in one season.
    count_per_saison_reference: dict[FLBewerbungSaisonReference, int]
    # KEYS and never the colliding applications' ids: one school submitting for hours is ONE group,
    # and `$push` over it answers past the 16MB a document may hold -- a 500 an anonymous form could
    # time.
    duplicates_key: list[str]


class FLBewerbungSingleResponse(BaseAPIResponse):
    bewerbung: FLBewerbung
    # Whether the confirmation deadline has passed today, judged on the server's date so the editor
    # reads no day of its own; false where the application holds no deadline.
    confirmation_deadline_expired: bool


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


def age_outside_the_bounds(*, geburtsdatum: str, today: str, minimum_age: int) -> bool:
    """Whether the league would hold no details for this contact person, in whole years against `today`.

    `today` a parameter, so both boundaries are pinnable without a clock; above the ceiling the date is a typo.
    """

    age = whole_years_between(born=geburtsdatum, today=today)

    # The CALLER's floor, never a constant read here: a person's is the highest of the seats they
    # hold (`app/api/bewerbungen/services.py :: mindestalter_for`).
    return not minimum_age <= age <= BEWERBUNG_KONTAKT_MAX_AGE_YEARS


class FLBewerbungEinwilligungPayload(BaseModel):
    """What the applicant agreed to; the scope and the date are the server's."""

    model_config = ConfigDict(extra="forbid")

    # Stripped before the floor counts it, as the junction payload's is: a record whose wording
    # version is spaces cites no text at all.
    text_version: CustomEinwilligungTextVersion
    # `True` and no other value: a form submitted with the box unticked is a body this endpoint
    # refuses, never a stored record saying somebody declined.
    given: Literal[True]


class FLBewerbungKontaktpersonPayload(_KontaktpersonWritablePayload):
    """One of the three people, as a member of the public submits them, without a birthdate."""

    einwilligung: FLBewerbungEinwilligungPayload


class FLBewerbungKontaktePayload(FLSaisonTeamKontaktePayload):
    """The three people an application is reached through, all three required."""

    trainer: FLBewerbungKontaktpersonPayload
    ansprechperson: FLBewerbungKontaktpersonPayload
    stellvertretung: FLBewerbungKontaktpersonPayload


class FLBewerbungAddressPayload(FLAddressPayload):
    """The school's address, with the Stadtteil required."""

    # The ceiling on what arrives, the floor after the strip, as `grund`'s.
    stadtteil: Annotated[
        str, StringConstraints(max_length=ADDRESS_STADTTEIL_MAX_LENGTH), AfterValidator(str.strip), StringConstraints(min_length=1)
    ]


class FLBewerbungSchulePayload(FLBewerbungSchule):
    """The club a new school proposes, bounded and stripped for the write."""

    model_config = ConfigDict(extra="forbid")

    # Stripped before either floor counts it: `team_name` and `shorthand` reach a league table row.
    # The ceilings are here and not on the read model, which the triage reads a stored one through.

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
    shorthand: CustomShorthand
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
            raise PydanticCustomError("good_spieler_exceed_kader", "more strong players than the expected squad")

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


class FLBewerbungWindowResponse(BaseAPIResponse):
    """One season's application window and whether that season has ended, and nothing else about it."""

    saison_id: str
    offen: bool
    von: CustomDateString
    bis: CustomDateString
    # The whole judgement, computed server-side: `offen` AND today inside the span. Served rather
    # than left to the client, which would re-derive it against a clock this server does not share.
    running: bool
    # A boolean rather than the status: `future` and `active` answer alike, so this serves nothing
    # the rule withholds, and a finished season still reads as over whatever dates it stores.
    saison_ended: bool


class FLBewerbungNoWindowResponse(BaseAPIResponse):
    """A season that records no application window: its id, and `window` always null."""

    saison_id: str
    # Always null, and carried all the same: it is the key `FLBewerbungWindowResponse` has not got,
    # so one endpoint's two bodies part on a field rather than on which one a parser tries first.
    window: None


class FLBewerbungSchulenResponse(BaseAPIResponse):
    schulen: list[FLBewerbungSchuleOption]


class FLBewerbungKuerzelResponse(BaseAPIResponse):
    """Whether a proposed Kürzel is already a club's, active or retired, naming no club."""

    shorthand: str
    taken: bool


class FLBewerbungTrikotFarbenResponse(BaseAPIResponse):
    """Which kit colours one season has already assigned, naming no club."""

    saison_id: str
    # `vergeben` as the Kürzel read means it -- taken, and by nobody this answer names. A LIST rather
    # than a set, JSON having none; `assigned_trikot_farben` is what makes it distinct and ordered.
    taken: list[FLTrikotFarbe]


# --- The CONFIRMATION. The token is the whole credential, as a sign-in code is, so both
# endpoints are base-tier and every payload forbids an undeclared key.

# What a reopened link shows. `abgelaufen` is a spent link, its deadline passed or its application
# decided, said one way; `barred` ranks first.
# `saison_past`, a season row's alone, takes a Widerspruch and no consent (`kontakt_saison_past`).
FLBewerbungEinwilligungZustand = Literal["valid", "confirmed", "declined", "expired", "saison_past", "barred"]

# Which record a link's seat sits on: an application, or a team's season row an administrator seated
# the person on. The page picks its wording by it, and the route handler mails an application's
# messages for the first alone.
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
    # The label the page renders and its answer must name: the applicant's page, or the one for a
    # person an administrator seated, decided from how the seat was filled (`kontakt_seite_of`).
    running_wording: str
    # The PERSON's floor over the seats this link answers for, so the page bounds its date control
    # and fills its own sentences from what the answer will judge rather than from a constant.
    minimum_age: int
    # The age from which the page offers the media switch, `medien_age`'s floor.
    medien_minimum_age: int = Field(gt=0)


class FLBewerbungEinwilligungGiven(BaseModel):
    """One person's consent for one seat: their own birthdate, their two choices and the wording they saw."""

    model_config = ConfigDict(extra="forbid")

    antwort: Literal["given"]
    token: CustomToken
    # Unbounded here: the age is its own code (`confirmation_age`), never a `payload_refused`.
    geburtsdatum: CustomDateString
    whatsapp: bool
    # Required as `whatsapp` is: a page that forgot the switch is refused rather than read as a no.
    medien: bool
    # The wording the CONFIRMING person saw, which is what a confirmed seat then cites: the label
    # the applicant ticked for them may be an older one.
    text_version: CustomEinwilligungTextVersion


class FLBewerbungEinwilligungDeclined(BaseModel):
    """One person's Widerspruch for one seat, which empties their slot: it carries nothing of them."""

    model_config = ConfigDict(extra="forbid")

    antwort: Literal["declined"]
    token: CustomToken


# Tagged by `antwort`, Pydantic's discriminated union, so each answer carries exactly its own fields. A route takes it
# as its body's plain annotation: beside FastAPI's `Body()` the tag is dropped, and the union is tried member by member.
FLBewerbungEinwilligungAntwortPayload = Annotated[
    FLBewerbungEinwilligungGiven | FLBewerbungEinwilligungDeclined, Field(discriminator="antwort")
]


class FLBewerbungEinwilligungAntwortResponse(BaseAPIResponse):
    """What the answer did; a Widerspruch's notice to the submitter is owed in the same write."""

    quelle: Literal["bewerbung"] = "bewerbung"
    ergebnis: FLEinwilligungErgebnis
    geburtsdatum: CustomOptionalDateString
    whatsapp: bool
    # As stored on every seat the answer wrote, as the referee's answer carries it: `false` after a
    # Widerspruch, which stores no answer.
    medien: bool


class FLSaisonTeamEinwilligungAntwortResponse(BaseAPIResponse):
    """What an answer on a season row's link did; nobody is told, so nothing composes a message."""

    quelle: Literal["saison"] = "saison"
    ergebnis: FLEinwilligungErgebnis
    geburtsdatum: CustomOptionalDateString
    whatsapp: bool
    # `FLBewerbungEinwilligungAntwortResponse.medien`'s.
    medien: bool


FLEinwilligungAntwortResponse = Annotated[
    FLBewerbungEinwilligungAntwortResponse | FLSaisonTeamEinwilligungAntwortResponse,
    Field(discriminator="quelle"),
]


class FLBewerbungEinwilligungResendResponse(BaseAPIResponse):
    """The seat whose link was replaced and where its fresh one is owed; the old one opens nothing."""

    rolle: FLKontaktRolle
    # Off the image the write replaced, never the caller's earlier read: a correction landing between
    # the two moved the address this link has to go to.
    email: str
    rollen: list[FLKontaktRolle]
    confirmation_deadline: CustomDateString


class FLBewerbungKontaktSeatPayload(_KontaktpersonWritablePayload):
    """The person seated where a contact person stepped out, who has agreed to nothing yet."""

    # The label alone, `compose_einwilligung` requiring one and the registry naming it
    # (`fl_backend/app/shared/einwilligung.py :: FASSUNGEN`). Stripped before the floor counts it: a
    # version that is spaces cites no text.
    text_version: CustomEinwilligungTextVersion


class FLBewerbungKontaktEmailPayload(BaseModel):
    """The corrected address and the one the page showed on the seat, and nothing else of the person."""

    model_config = ConfigDict(extra="forbid")

    # `_KontaktpersonWritablePayload.email`'s declaration, so an address this refuses is one the
    # public form refused too and a correction cannot store what a submission could not.
    email: CustomEmail
    # The address the page showed on the seat: a seat another person took since is refused rather than handed
    # the address typed for the one who left (`bewerbung_seat_differently_seated`).
    previous_email: CustomEmail


class FLBewerbungKontaktEmailResponse(BaseAPIResponse):
    """A seat's address as a correction or a new person left it, and every seat it reached; the link is owed there in the same write."""

    # Answered rather than re-derived by the caller, so one function decides the form a message is sent to.
    email: str
    # Plural: one person may hold two seats, a mirrored pair the claim `kontakte.trainer_is_also` records, and the
    # write reaches both, as a re-send does (`app/api/bewerbungen/services.py :: compose_erneut_update`).
    rollen: list[FLKontaktRolle]
    confirmation_deadline: CustomDateString


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
    redacted_action_log: int
    # One sum over every clock rather than a count a clock: the line logging each row names its clock.
    failed: int


class FLBewerbungAccountEinwilligungResponse(BaseAPIResponse):
    """Which of the application's seats the withdrawal reached, and the two answers they now all hold."""

    bewerbung_id: CustomObjectId
    rollen: list[FLKontaktRolle]
    umfang: FLKontaktKenntnisnahmeUmfang
    medien: bool
    # The precondition a next press on this application echoes.
    nachweis_stand: FLEinwilligungStand
