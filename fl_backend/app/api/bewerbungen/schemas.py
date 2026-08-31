import re
from datetime import date
from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints, TypeAdapter, model_validator

# Imported rather than restated: an application's three people BECOME the junction's three people at
# acceptance, so a second declaration of the block is one the two would drift apart on. Acyclic --
# no model in `teams` imports this slice.
from app.api.teams.schemas import (
    FLGruppenNames,
    FLKontaktpersonPayload,
    FLSaisonTeamKontakte,
    FLSaisonTeamKontaktePayload,
    FLSchulform,
    FLTrikotFarbe,
)

# `app/core/` imports no slice, so this is acyclic. Imported rather than restated so the public
# payload's "today" is the one every endpoint of this application already means.
from app.core.dependencies import get_german_date_str, get_germany_now
from app.shared.schemas.addresses import FLAddress, FLAddressPayload
from app.shared.schemas.bounds import (
    ADDRESS_STADTTEIL_MAX_LENGTH,
    BEWERBUNG_GRUND_MAX_LENGTH,
    BEWERBUNG_KADER_GROESSE_MAX,
    BEWERBUNG_KONTAKT_MAX_AGE_YEARS,
    BEWERBUNG_KONTAKT_MIN_AGE_YEARS,
    BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH,
    BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH,
    EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH,
    LIST_LIMIT_DEFAULT,
    LIST_LIMIT_MAX,
    SAISON_ID_LENGTH,
    TEAM_FULL_NAME_MAX_LENGTH,
    TEAM_NAME_MAX_LENGTH,
    TEAM_SHORTHAND_LENGTH,
    TEAM_WEBSITE_URL_MAX_LENGTH,
)
from app.shared.schemas.custom import (
    SINGLE_LINE_PATTERN,
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    parse_empty_string_to_none,
    validate_external_url,
)
from app.shared.schemas.responses import BaseAPIResponse

# `eingereicht` is the only state a submission arrives in; the other two are the triage's, and
# `app/api/bewerbungen/admin_router.py` is the only writer of either.
FLBewerbungStatus = Literal["eingereicht", "angenommen", "abgelehnt"]

FLBewerbungenSortOptions = Literal["eingereicht_am", "saison_id"]


class FLBewerbungSchule(BaseModel):
    """The club a new school proposes, in the shape acceptance will create it in.

    While the application is `eingereicht`, exactly one of this and `team_id` carries a value, held
    by the write path rather than the validator (`docs/backend/spec.md :: I16`).
    """

    # `team_name`, not `name`: it becomes the club's SHORT name beside `full_name`, and `name` inside
    # a block called `schule` would read as the school's own.
    team_name: CustomNonEmptyString
    full_name: CustomNonEmptyString
    shorthand: str = Field(min_length=TEAM_SHORTHAND_LENGTH, max_length=TEAM_SHORTHAND_LENGTH)
    schulform: FLSchulform | None
    address: FLAddress
    # A plain string, unlike `_TeamWritable.website_url`: stored values are typed only
    # (`docs/backend/spec.md :: I16`), and refusing one on read would 500 the triage list.
    website_url: str | None


class FLBewerbungTrikot(BaseModel):
    """What kit the school already owns, and the colour it would like.

    Never copied onto the team: `saison_teams.trikot_farbe` is the colour an administrator ASSIGNED,
    and two schools may wish for one colour.
    """

    vorhandener_satz: str
    wunschfarbe: FLTrikotFarbe | None


class FLBewerbungKader(BaseModel):
    """The school's own estimate of its squad, on the application alone.

    Unbounded on read for `FLBewerbungSchule.website_url`'s reason. Nothing checks either number
    against a squad afterwards -- they are what the school expected, not what it fielded.
    """

    voraussichtliche_groesse: int
    # Non-nullable, as the validator stores it: the form asks for a count, and none of them is zero.
    gute_spieler: int


class FLBewerbungEntscheidung(BaseModel):
    """Who decided this application, when, and -- on a decline -- why.

    `von` is the administrator the request was attributed to, so a decision and the `aktionen` row
    recording it can never name two different people.
    """

    getroffen_am: CustomDateString
    von: str
    # Null on an acceptance: what an acceptance did is the club and the junction row it wrote, and a
    # reason field filled in with "angenommen" would be a second, weaker record of that.
    grund: str | None


class FLBewerbung(BaseModel):
    """One school's application to play one season, as it is stored.

    The submission is never rewritten: only `status`, `entscheidung` and `team_id` move, and only
    through the two triage endpoints.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    saison_id: str
    eingereicht_am: CustomDateString
    status: FLBewerbungStatus
    # The club the applicant PICKED, null where they proposed a new school. Acceptance writes the
    # created club's id back here, so a decided application always names one.
    team_id: CustomObjectId | None
    schule: FLBewerbungSchule | None
    kontakte: FLSaisonTeamKontakte
    trikot: FLBewerbungTrikot
    kader: FLBewerbungKader
    # A FREE STRING, never a club reference: the school may name an applicant the league has not
    # accepted yet, and a picker over the accepted ones would give a LATER applicant the longer list.

    # Beside `trikot` and `kader` rather than inside either: it is a fact about the fixture this
    # school wants, and neither the kit it owns nor its own estimate of its squad.

    # Defaulted for `app/api/teams/schemas.py :: FLTeam`'s reason: an application stored before the
    # field carries no key, and a model that 422s over one describes a stored document as impossible.
    wunschgegner: str | None = None
    entscheidung: FLBewerbungEntscheidung | None


FLBewerbungListAdapter = TypeAdapter(list[FLBewerbung])


class FLBewerbungenFilterParams(BaseModel):
    """What the triage list may narrow on. No `bewerbung_id`: `GET /bewerbungen/{bewerbung_id}` names one."""

    saison_id: str | None = None
    status: FLBewerbungStatus | None = None

    # Bounded on BOTH sides, and no null sentinel: this is the one list an anonymous party writes
    # rows into, so `le` caps a caller naming more rather than obeying it, and the default is the
    # ceiling rather than "everything".
    limit: int = Field(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX)
    # Newest first by default: the triage is a queue, and the oldest open application is the one an
    # administrator has already seen.
    sort_by: FLBewerbungenSortOptions = Field(default="eingereicht_am")
    order: Literal["asc", "desc"] = Field(default="desc")


class FLAnnehmenBewerbungPayload(BaseModel):
    """Which group the school enters, and the kit colour the league assigns it.

    No `saison_id`: the application names its own season, so a payload carrying one could only
    disagree with it.
    """

    model_config = ConfigDict(extra="forbid")

    gruppe: FLGruppenNames
    # Assigned rather than read off `trikot.wunschfarbe`: a wish is not an assignment, and two
    # schools may wish for one colour.
    trikot_farbe: FLTrikotFarbe | None


class FLAblehnenBewerbungPayload(BaseModel):
    """Why the application was declined.

    Its own declaration and never shared with the acceptance's: the two are not inverses, and a
    payload reaching both would let a value typed for one arrive at the other.
    """

    model_config = ConfigDict(extra="forbid")

    # Required, and STRIPPED before either bound counts: both count characters, so spaces alone
    # would reach the application and the applicants' email as a decline stating nothing, and a
    # padded reason is trimmed to fit rather than refused.
    grund: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=BEWERBUNG_GRUND_MAX_LENGTH)]


class FLBewerbungenListResponse(BaseAPIResponse):
    """The queue, newest first, and whether that is the whole of it.

    The list is served WHOLE by design -- the page marks duplicate submissions across it, and a
    split set would leave a pair unmarked with nothing saying so.
    """

    bewerbungen: list[FLBewerbung]
    # German, unlike the envelope fields around it, because `complete` reads as "the read finished"
    # as readily as "the list is whole" -- and this flag decides whether an admin may trust the list.
    vollstaendig: bool


class FLBewerbungSingleResponse(BaseAPIResponse):
    bewerbung: FLBewerbung


class FLAnnehmenBewerbungResponse(BaseAPIResponse):
    """The application as the acceptance left it, plus what the acceptance wrote beyond it."""

    updated_document: FLBewerbung
    # The club now standing in the season: the one the applicant picked, or the one this acceptance
    # created. Echoed because a created club has an id the caller has no other way to learn.
    team_id: CustomObjectId
    # Whether this acceptance created that club, which the admin surface words differently either
    # way. Derivable from `updated_document.schule` and served anyway: what the caller renders is
    # what this call DID, not what the application holds.
    created_team: bool
    # Unconstrained, as an echo of a stored id is (`docs/backend/spec.md :: I5`).
    saison_id: str
    gruppe: FLGruppenNames
    trikot_farbe: FLTrikotFarbe | None


class FLAblehnenBewerbungResponse(BaseAPIResponse):
    updated_document: FLBewerbung


# --- The PUBLIC submission. Every model below is reached from a request body alone, so each forbids
# an undeclared key; the read models above stay lax (`docs/backend/spec.md :: I49`).


def _whole_years_between(*, born: str, today: str) -> int:
    """Whole years elapsed, so a birthday later this year has not been reached yet."""

    birth, now = date.fromisoformat(born), date.fromisoformat(today)

    return now.year - birth.year - ((now.month, now.day) < (birth.month, birth.day))


def refuse_age_outside_the_bounds(*, geburtsdatum: str, today: str) -> None:
    """Refuse a contact person the league would not hold details for, in whole years against `today`.

    A PARAMETER, as `refuse_reversed_span`'s span is, so both boundaries are pinnable without a
    clock. German, because it surfaces as a 422.
    """

    age = _whole_years_between(born=geburtsdatum, today=today)

    if age < BEWERBUNG_KONTAKT_MIN_AGE_YEARS:
        raise ValueError(f"Eine Kontaktperson muss mindestens {BEWERBUNG_KONTAKT_MIN_AGE_YEARS} Jahre alt sein.")

    if age > BEWERBUNG_KONTAKT_MAX_AGE_YEARS:
        raise ValueError(f"Ein Geburtsdatum, das auf ein Alter über {BEWERBUNG_KONTAKT_MAX_AGE_YEARS} Jahre führt, ist kein gültiges Datum.")


def _judge_age_against_the_german_day(value: str) -> str:
    """The clock, and nothing else: a field validator takes no dependency, so this is where one is read.

    Overriding `get_germany_now` does NOT move the day this judges against. Pin the bound through
    `refuse_age_outside_the_bounds`, which takes `today`.
    """

    refuse_age_outside_the_bounds(geburtsdatum=value, today=get_german_date_str(get_germany_now()))

    return value


# On the PUBLIC payload alone, which is why it is not `CustomDateString` itself: a stored date is
# read back by the triage whatever it holds, and an administrator's own edit answers to nobody's age.
CustomBewerbungGeburtsdatum = Annotated[CustomDateString, AfterValidator(_judge_age_against_the_german_day)]

# Both spellings of the country code. Neither arm can take the other's value -- `0049…` does not
# start with `49` -- so the order carries nothing.
_TELEFON_COUNTRY_CODES = ("0049", "49")


def normalise_telefon(value: str) -> str:
    """One spelling per telephone number, so `+49 170 …` and `0170 …` compare equal.

    Digits alone, `PHONE_REGEX` admitting spaces, brackets, hyphens and dots. No German area code
    starts with the trunk `0`, so a leading country code folds back to it.
    """

    digits = re.sub(r"[^0-9]", "", value)

    for country_code in _TELEFON_COUNTRY_CODES:
        if digits.startswith(country_code):
            # The second `removeprefix` takes the trunk zero written as `(0)`, which is the standard
            # German notation and the commonest spelling of all. An international-format number
            # carries no real leading zero, so dropping one can only be right.
            return f"0{digits.removeprefix(country_code).removeprefix('0')}"

    return digits


class FLBewerbungEinwilligungPayload(BaseModel):
    """What the applicant agreed to, and nothing about how the record of it is composed.

    `umfang`, `erteilt_von` and `datum` are the SERVER's: a client offered them could claim an
    administrative transcription, or backdate a consent.
    """

    model_config = ConfigDict(extra="forbid")

    # Stripped before the floor counts it, as the junction payload's is: a record whose wording
    # version is spaces cites no text at all.
    text_version: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH)]
    # `True` and no other value: a form submitted with the box unticked is a body this endpoint
    # refuses, never a stored record saying somebody declined.
    erteilt: Literal[True]


class FLBewerbungKontaktpersonPayload(FLKontaktpersonPayload):
    """One of the three people, as a member of the public submits them.

    The junction payload plus the two things only a public form needs: a bounded age, and a consent
    the person gives themselves.
    """

    # Bounded HERE and on no other date field in the application: this is the one a stranger types
    # about themselves, unreviewed. The name ceilings are inherited: the junction payload states
    # `KONTAKT_NAME_MAX_LENGTH` itself, so both tiers refuse alike with no redeclaration to drift.
    geburtsdatum: CustomBewerbungGeburtsdatum
    einwilligung: FLBewerbungEinwilligungPayload


class FLBewerbungKontaktePayload(FLSaisonTeamKontaktePayload):
    """The three people an application is reached through, all three REQUIRED and non-null.

    Unlike the junction payload, whose nulls keep a row an erasure emptied editable: an application
    is the form those three filled in, and there is nothing yet to erase.
    """

    trainer: FLBewerbungKontaktpersonPayload
    ansprechperson: FLBewerbungKontaktpersonPayload
    stellvertretung: FLBewerbungKontaktpersonPayload

    @model_validator(mode="after")
    def the_trainer_equals_the_seat_they_also_hold(self) -> Self:
        """Where one person holds two seats, the two blocks must agree field for field.

        The form fills the second seat from the first, so a mismatch is a client that has drifted --
        and storing it would leave two records of one person the erasure cannot pair up.
        """

        if self.trainer_ist_zugleich is None:
            return self

        seat: FLBewerbungKontaktpersonPayload = getattr(self, self.trainer_ist_zugleich)

        if seat != self.trainer:
            raise ValueError(f"Die Angaben unter '{self.trainer_ist_zugleich}' müssen denen des Trainers entsprechen.")

        return self

    @model_validator(mode="after")
    def the_distinct_people_share_no_email_or_telephone(self) -> Self:
        """Two DIFFERENT people may not be reachable at one address or one number.

        The seat the Trainer also holds is left out of the comparison: it is the same person, and
        the rule above has already held the two blocks equal.
        """

        seats = [seat for seat in ("trainer", "ansprechperson", "stellvertretung") if seat != self.trainer_ist_zugleich]
        people: list[FLBewerbungKontaktpersonPayload] = [getattr(self, seat) for seat in seats]

        # Case-insensitively: a mailbox is addressed the same however the local part is capitalised,
        # and two seats spelled differently would otherwise pass as two people.
        emails = [person.email.casefold() for person in people]
        if len(set(emails)) != len(emails):
            raise ValueError("Die Kontaktpersonen müssen unterschiedliche E-Mail-Adressen haben.")

        telefone = [normalise_telefon(person.telefon) for person in people]
        if len(set(telefone)) != len(telefone):
            raise ValueError("Die Kontaktpersonen müssen unterschiedliche Telefonnummern haben.")

        return self


class FLBewerbungAddressPayload(FLAddressPayload):
    """The school's address, with the Stadtteil REQUIRED.

    Its own subclass rather than a change to `FLAddressPayload`, which an admin address shares: a
    venue can genuinely lack a district, and a Frankfurt school does not.
    """

    # Stripped before the floor counts it, as every payload string carrying one is: `min_length`
    # counts characters, so spaces alone would clear it.
    stadtteil: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=ADDRESS_STADTTEIL_MAX_LENGTH)]


class FLBewerbungSchulePayload(FLBewerbungSchule):
    """The club a new school proposes, bounded and stripped for the write side.

    A subclass rather than a second declaration, as `FLKontaktpersonPayload` is: the field set is the
    stored block's, and two spellings of it would drift on every field they share.
    """

    model_config = ConfigDict(extra="forbid")

    # Stripped before either floor counts it: `team_name` and `shorthand` reach a league table row.
    # The ceilings are here and not on the read model, which the triage reads a stored one through.

    # `SINGLE_LINE_PATTERN` carries the class and the reason for it. CR and LF earn a second one
    # here: the decision mail renders these two as `label: value` rows, so a name holding either
    # forges a line the reader cannot tell from a stated fact.
    team_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=TEAM_NAME_MAX_LENGTH, pattern=SINGLE_LINE_PATTERN)
    ]
    full_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=TEAM_FULL_NAME_MAX_LENGTH, pattern=SINGLE_LINE_PATTERN)
    ]
    shorthand: Annotated[str, StringConstraints(strip_whitespace=True, min_length=TEAM_SHORTHAND_LENGTH, max_length=TEAM_SHORTHAND_LENGTH)]
    # Required and NON-NULL here alone: the form offers the six real Schulformen and no "keine
    # Angabe". The stored field stays nullable, for `app/core/constraints.py :: teams.schulform`'s reason.
    schulform: FLSchulform
    address: FLBewerbungAddressPayload
    # Constrained here where the read model leaves it a bare string: acceptance parses this block
    # through `FLPostTeamPayload`, so a value refused there is one an administrator cannot accept.

    # Composed from `str` rather than wrapping `CustomExternalUrl`, so the ceiling is judged BEFORE
    # the host regex runs -- `validate_external_url` reads the scheme and the host and no length.
    website_url: Annotated[
        Annotated[
            str,
            StringConstraints(strip_whitespace=True, max_length=TEAM_WEBSITE_URL_MAX_LENGTH),
            AfterValidator(validate_external_url),
        ]
        | None,
        BeforeValidator(parse_empty_string_to_none),
    ]


class FLBewerbungTrikotPayload(FLBewerbungTrikot):
    model_config = ConfigDict(extra="forbid")

    # No floor: a school that owns no kit writes nothing here, so the empty string is the honest
    # answer. A ceiling all the same -- an anonymous caller writes it, and it is stored.
    vorhandener_satz: str = Field(max_length=BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH)
    # Required here and NULLABLE on the stored shape: an applicant names the colour they want, while
    # the administrator who assigns the real one at acceptance may leave it open.
    wunschfarbe: FLTrikotFarbe


class FLBewerbungKaderPayload(FLBewerbungKader):
    model_config = ConfigDict(extra="forbid")

    # `default=` is not passed at all -- both are required and neither is nullable. `ge=1` because a
    # squad of nobody enters no season; `gute_spieler` counts a subset of it, so zero is its floor.

    # The CEILING keeps an int32 validator from answering 500 where this endpoint promises 422.
    voraussichtliche_groesse: int = Field(ge=1, le=BEWERBUNG_KADER_GROESSE_MAX)
    gute_spieler: int = Field(ge=0, le=BEWERBUNG_KADER_GROESSE_MAX)

    @model_validator(mode="after")
    def the_strong_players_are_a_subset_of_the_squad(self) -> Self:
        """A subset cannot outnumber the whole, and both figures are one school's own estimate.

        A 422 like the distinctness rule: a shape rule about the body, judged against no database.
        Equal is fine -- a school may rate its whole squad.
        """

        if self.gute_spieler > self.voraussichtliche_groesse:
            raise ValueError("Die Anzahl der guten Spieler darf die voraussichtliche Kadergröße nicht überschreiten.")

        return self


class FLPostBewerbungPayload(BaseModel):
    """One school's application, as the public form submits it.

    `status`, `eingereicht_am` and `entscheidung` are on no payload: the server sets all three, so a
    client can neither arrive already accepted nor backdate its own submission.
    """

    model_config = ConfigDict(extra="forbid")

    # Stripped before the width is counted, for `CustomStrippedNonEmptyString`'s reason.
    saison_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)]
    # The club picked off the autocomplete, null where the applicant proposed a new school. Exactly
    # one of this and `schule` carries a value, which `REQ-BEWERBUNG-005` holds: types cannot state
    # it (`docs/backend/spec.md :: I16`).
    team_id: CustomObjectId | None
    schule: FLBewerbungSchulePayload | None
    kontakte: FLBewerbungKontaktePayload
    trikot: FLBewerbungTrikotPayload
    kader: FLBewerbungKaderPayload
    # DEFAULTED where this payload's other nullable keys are required: `scripts/deploy.sh` recreates
    # both packages at one pinned build, so the only form older than this field is a page already
    # open in a visitor's browser across a recreate.

    # What the default costs: `extra="forbid"` makes a misspelled key a 422 while an omitted one is a
    # silent null, so a frontend regression that stops sending this ships green -- where every
    # sibling's omission is a 422.

    # `SINGLE_LINE_PATTERN` carries the class and its reason. CR and LF earn a second one here:
    # `fl_frontend/src/core/bewerbungEmail.ts :: wunschgegnerSatz` sets this inside a sentence, and a
    # break there still opens a line in a line-oriented text body.

    # No floor, `parse_empty_string_to_none` leaving nothing between null and a real name:
    # `min_length` counts characters, so spaces alone would be stored as a wish the school made.
    wunschgegner: Annotated[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH, pattern=SINGLE_LINE_PATTERN)]
        | None,
        BeforeValidator(parse_empty_string_to_none),
    ] = None


class FLBewerbungSchuleOption(BaseModel):
    """One club as the public form offers it: an autocomplete row, and nothing more.

    An allow-list declared from nothing, never a narrowing of `FLTeam` (`READ-BEWERBUNG-001`): an
    anonymous visitor picks from it, and a club's address is a school's street.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    name: CustomNonEmptyString


FLBewerbungSchuleOptionListAdapter = TypeAdapter(list[FLBewerbungSchuleOption])


class FLBewerbungFensterResponse(BaseAPIResponse):
    """One season's application window, and NOTHING else about that season.

    A season taking applications is `future`, which `docs/backend/spec.md :: I47` withholds whole --
    so the window gets its own shape rather than widening a season read.
    """

    saison_id: str
    offen: bool
    von: CustomDateString
    bis: CustomDateString
    # The whole judgement, computed server-side: `offen` AND today inside the span. Served rather
    # than left to the client, which would re-derive it against a clock this server does not share.
    laeuft: bool


class FLBewerbungSchulenResponse(BaseAPIResponse):
    schulen: list[FLBewerbungSchuleOption]


class FLBewerbungKuerzelResponse(BaseAPIResponse):
    """Whether a proposed Kürzel is already a club's. ONE neutral answer.

    It names no club and does not tell an active one from a retired one: the uniqueness it mirrors
    spans both, and a shape distinguishing them would publish which schools have left.
    """

    shorthand: str
    vergeben: bool


class FLBewerbungTrikotFarbenResponse(BaseAPIResponse):
    """Which kit colours one season has already ASSIGNED. A set, and nothing about who holds one.

    An allow-list declared from nothing, as `FLBewerbungSchuleOption` is (`READ-BEWERBUNG-001`): a
    colour beside a club would publish which kit that school wears.
    """

    saison_id: str
    # `vergeben` as the Kürzel read means it -- taken, and by nobody this answer names. A LIST rather
    # than a set, JSON having none; `assigned_trikot_farben` is what makes it distinct and ordered.
    vergeben: list[FLTrikotFarbe]


class FLPostBewerbungResponse(BaseAPIResponse):
    """What the submission wrote, and nothing the submission carried.

    The three people's details went one way, and a body repeating them is a copy in a browser's
    cache and in every proxy between.
    """

    created_id: CustomObjectId
    saison_id: str
    eingereicht_am: CustomDateString
