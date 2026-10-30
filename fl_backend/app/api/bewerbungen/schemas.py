from typing import Annotated, Any, Literal, Self

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints, TypeAdapter, model_validator

from app.api.postausgang.schemas import FLPostausgangLage
from app.api.teams.schemas import FLSaisonTeamKontakte, FLSaisonTeamKontaktePayload, _KontaktpersonWritablePayload
from app.shared.alter import whole_years_between
from app.shared.schemas.addresses import FLAddress, FLAddressPayload
from app.shared.schemas.bestaetigung import CustomToken
from app.shared.schemas.bounds import (
    ADDRESS_STADTTEIL_MAX_LENGTH,
    BEWERBUNG_GRUND_MAX_LENGTH,
    BEWERBUNG_KADER_GROESSE_MAX,
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
    FLKontaktZeile,
    FLSchulform,
    FLSortOrder,
    FLTrikotFarbe,
)
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel

# `eingereicht` is the only state a submission arrives in; the other two are the triage's, and
# `app/api/bewerbungen/admin_router.py` is the only writer of either.
type FLBewerbungStatus = Literal["eingereicht", "angenommen", "abgelehnt"]

# Which seasons a read covers, RELATIVE to the `saison_id` beside it and never a season of its own:
# the triage bar asks about the season an administrator came here about, and no stored field carries
# that answer.
FLBewerbungSaisonbezug = Literal["diese_saison", "andere_saison"]

# One key, and it is the one every `bewerbungen` index sorts on: the collection grows with each
# submission and no path removes a row, so a second order would plan a blocking sort over an archive
# nothing bounds.
FLBewerbungenSortOptions = Literal["eingereicht_am"]


class _FLBewerbungSitzStand(BaseReadModel):
    """One seat's confirmation bookkeeping, as the record and the read share it."""

    # The day the link was last mailed; a re-send moves it.
    verschickt_am: CustomDateString
    erinnert_am: CustomOptionalDateString
    # Beside the slot rather than inside it: a decline EMPTIES the person's slot, and a marker in
    # there would go with it.
    abgelehnt_am: CustomOptionalDateString


class FLBewerbungBestaetigung(_FLBewerbungSitzStand):
    """One seat's confirmation bookkeeping as the triage reads it, without its link's hashes."""

    # What became of the last mail owed this seat, as the read joins it from the Postausgang: no seat stores it, and null
    # where none was ever owed.
    zustellung: FLPostausgangLage | None


class FLBewerbungBestaetigungen(BaseModel):
    """The three seats' bookkeeping, each null where an erasure emptied the seat."""

    trainer: FLBewerbungBestaetigung | None
    ansprechperson: FLBewerbungBestaetigung | None
    stellvertretung: FLBewerbungBestaetigung | None


class FLBewerbungSchule(BaseModel):
    """The club a new school proposes, in the shape acceptance will create it in.

    While the application is `eingereicht`, exactly one of this and `team_id` carries a value.
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

    vorhandener_satz: str
    wunschfarbe: FLTrikotFarbe


class FLBewerbungKader(BaseModel):
    """The school's own estimate of its squad, which nothing checks afterwards."""

    voraussichtliche_groesse: int
    # Non-nullable: the form asks for a count, and none of them is zero.
    gute_spieler: int


class FLBewerbungEntscheidung(BaseModel):
    """Who decided this application, when, and on a decline why."""

    getroffen_am: CustomDateString
    von: str
    # Null on an acceptance: what an acceptance did is the club and the junction row it wrote, and a
    # reason field filled in with "angenommen" would be a second, weaker record of that.
    grund: str | None


class FLBewerbungEntscheidungZeile(FLBewerbungEntscheidung):
    """A decision as every read serves it: the stored one, its administrator withheld where the ban list holds that address."""

    # Null exactly where `von_gesperrt` is set, as the grants list withholds its actors.
    von: str | None
    von_gesperrt: bool


class FLBewerbung(BaseModel):
    """One school's application to play one season, as stored, its decision as served."""

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
    # How many pupils the school's whole Abi-Jahrgang holds, which the applicant states and nothing
    # later checks.
    stufengroesse: int
    # A FREE STRING, never a club reference: the school may name an applicant the league has not
    # accepted yet, and a picker over the accepted ones would give a LATER applicant the longer list.
    wunschgegner: str | None
    # As served, so a row reaches the wire only through
    # `app/api/bewerbungen/services.py :: mit_vorenthaltener_entscheidung`.
    entscheidung: FLBewerbungEntscheidungZeile | None
    # The day an unconfirmed application is deleted and its links expire. NOT the season's
    # `Bewerbungsfrist`, which is the window the form is open in.
    bestaetigungsfrist: CustomDateString
    bestaetigungen: FLBewerbungBestaetigungen


class FLBewerbungBestaetigungRecord(_FLBewerbungSitzStand):
    """One seat's bookkeeping as `bewerbungen` stores it: the hash of every link it was mailed, each live until a re-send."""

    token_hashes: list[str]


class FLBewerbungBestaetigungenRecord(FLBewerbungBestaetigungen):
    trainer: FLBewerbungBestaetigungRecord | None
    ansprechperson: FLBewerbungBestaetigungRecord | None
    stellvertretung: FLBewerbungBestaetigungRecord | None


class FLBewerbungRecord(FLBewerbung):
    """One application as `bewerbungen` stores it: its decision before any administrator is withheld, and what no read serves."""

    entscheidung: FLBewerbungEntscheidung | None
    bestaetigungen: FLBewerbungBestaetigungenRecord
    # The retention sweep's announcement, and the submission's replay key and digest.
    loeschung_angekuendigt_am: str | None = None
    idempotenz_schluessel: str | None = None
    idempotenz_fingerabdruck: str | None = None


FLBewerbungListAdapter = TypeAdapter(list[FLBewerbung])


def parse_status_list(value: Any) -> Any:
    """Comma-joined as well as repeated, so the page forwards the parameter it read rather than re-encoding it.

    `fl_frontend/src/core/api.ts :: apiClient` sends one value per key, and the queue's URL spells a
    multi-select selection comma-joined.
    """

    if value is None:
        return None

    picked: list[Any] = []
    for item in value if isinstance(value, list) else [value]:
        # A non-string is passed on untouched, so Pydantic refuses it rather than this splitter
        # dropping it into a narrowing nobody asked for.
        picked.extend(item.split(",") if isinstance(item, str) else [item])

    # `None` and never `[]`: an emptied parameter is the facet turned off, and `$in: []` would
    # answer that with a page holding nothing.
    return [part for part in picked if part != ""] or None


class FLBewerbungenFilterParams(BaseModel):
    """What the triage list may narrow on."""

    saison_id: str | None = None
    # A list for `status`'s reason below, the facet offering these being multi-select. What each
    # value narrows to is published at `app/api/bewerbungen/admin_router.py :: get_bewerbungen`.
    saisonbezug: Annotated[list[FLBewerbungSaisonbezug] | None, BeforeValidator(parse_status_list, json_schema_input_type=str)] = None
    # A LIST, because the facet offering these is multi-select and a two-status selection has no
    # other request that expresses it. Published as the STRING it arrives as.
    status: Annotated[list[FLBewerbungStatus] | None, BeforeValidator(parse_status_list, json_schema_input_type=str)] = None

    # Bounded on BOTH sides, and no null sentinel: this is the one list an anonymous party writes
    # rows into, so `le` caps a caller naming more rather than obeying it, and the default is the
    # ceiling rather than "everything".
    limit: int = Field(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX)
    # Newest first by default: the triage is a queue, and the oldest open application is the one an
    # administrator has already seen.
    sort_by: FLBewerbungenSortOptions = Field(default="eingereicht_am")
    order: FLSortOrder = Field(default="desc")


class FLAnnehmenBewerbungPayload(BaseModel):
    """Which group the school enters, and the kit colour the league assigns it; the season is the application's own."""

    model_config = ConfigDict(extra="forbid")

    gruppe: FLGruppenNames
    # Assigned rather than read off `trikot.wunschfarbe`: a wish is not an assignment, and two
    # schools may wish for one colour.
    trikot_farbe: FLTrikotFarbe | None


class FLAblehnenBewerbungPayload(BaseModel):
    """Why the application was declined."""

    model_config = ConfigDict(extra="forbid")

    # The ceiling counts what arrives and the floor what is left after the strip, so the published `maxLength` is what the
    # write accepts and spaces alone are no reason.
    grund: Annotated[str, StringConstraints(max_length=BEWERBUNG_GRUND_MAX_LENGTH), AfterValidator(str.strip), StringConstraints(min_length=1)]


class FLBewerbungenListResponse(BaseAPIResponse):
    """The queue, newest first, and whether that is the whole of it.

    `dubletten_schluessel` is taken over every open application, so a pair the cap parted is named at both ends.
    """

    bewerbungen: list[FLBewerbung]
    # German, unlike the envelope fields around it, because `complete` reads as "the read finished"
    # as readily as "the list is whole" -- and this flag decides whether an admin may trust the list.
    vollstaendig: bool
    # Counted on the SERVER: the answer holds only the statuses the request asked for, so a caller
    # counting the rows it was served reads zero for each one the server hid and would offer no way
    # back to them.
    anzahl_je_status: dict[FLBewerbungStatus, int]
    # The same, for the season relation the read narrows on: the side it left out has no rows here,
    # and a caller counting what it holds would strand an administrator in one season.
    anzahl_je_saisonbezug: dict[FLBewerbungSaisonbezug, int]
    # KEYS and never the colliding applications' ids: one school submitting for hours is ONE group,
    # and `$push` over it answers past the 16MB a document may hold -- a 500 an anonymous form could
    # time.
    dubletten_schluessel: list[str]


class FLBewerbungSingleResponse(BaseAPIResponse):
    bewerbung: FLBewerbung
    # Whether the confirmation deadline has passed today, judged on the server's date so the editor
    # reads no day of its own; false where the application holds no deadline.
    bestaetigungsfrist_abgelaufen: bool


class FLAnnehmenBewerbungResponse(BaseAPIResponse):
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


class FLAblehnenBewerbungResponse(BaseAPIResponse):
    """The declined application; its mails are owed in the same write."""

    id: CustomObjectId


# --- The PUBLIC submission. Every model below is reached from a request body alone, so each forbids
# an undeclared key; the read models above stay lax.


def refuse_age_outside_the_bounds(*, geburtsdatum: str, today: str, mindestalter: int) -> None:
    """Refuse a contact person the league would not hold details for, in whole years against `today`.

    A PARAMETER, as `refuse_reversed_span`'s span is, so both boundaries are pinnable without a
    clock. Both messages reach the log alone.
    """

    age = whole_years_between(born=geburtsdatum, today=today)

    # The CALLER's floor, never a constant read here: a person's is the highest of the seats they
    # hold (`app/api/bewerbungen/services.py :: mindestalter_for`).
    if age < mindestalter:
        raise ValueError(f"Eine Kontaktperson muss mindestens {mindestalter} Jahre alt sein.")

    if age > BEWERBUNG_KONTAKT_MAX_AGE_YEARS:
        raise ValueError(f"Ein Geburtsdatum, das auf ein Alter über {BEWERBUNG_KONTAKT_MAX_AGE_YEARS} Jahre führt, ist kein gültiges Datum.")


class FLBewerbungEinwilligungPayload(BaseModel):
    """What the applicant agreed to; the scope and the date are the server's."""

    model_config = ConfigDict(extra="forbid")

    # Stripped before the floor counts it, as the junction payload's is: a record whose wording
    # version is spaces cites no text at all.
    text_version: CustomEinwilligungTextVersion
    # `True` and no other value: a form submitted with the box unticked is a body this endpoint
    # refuses, never a stored record saying somebody declined.
    erteilt: Literal[True]


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
    vorhandener_satz: str = Field(max_length=BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH)


class FLBewerbungKaderPayload(FLBewerbungKader):
    model_config = ConfigDict(extra="forbid")

    # `ge=1` because a squad of nobody enters no season; `gute_spieler` counts a subset of it, so
    # zero is its floor.

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

    `status`, `eingereicht_am` and `entscheidung` are the server's.
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


class FLBewerbungFensterResponse(BaseAPIResponse):
    """One season's application window and whether that season has ended, and nothing else about it."""

    saison_id: str
    offen: bool
    von: CustomDateString
    bis: CustomDateString
    # The whole judgement, computed server-side: `offen` AND today inside the span. Served rather
    # than left to the client, which would re-derive it against a clock this server does not share.
    laeuft: bool
    # A boolean rather than the status: `future` and `active` answer alike, so this serves nothing
    # the rule withholds, and a finished season still reads as over whatever dates it stores.
    saison_beendet: bool


class FLBewerbungKeinFensterResponse(BaseAPIResponse):
    """A season that records no application window: its id, and `fenster` always null."""

    saison_id: str
    # Always null, and carried all the same: it is the key `FLBewerbungFensterResponse` has not got,
    # so one endpoint's two bodies part on a field rather than on which one a parser tries first.
    fenster: None


class FLBewerbungSchulenResponse(BaseAPIResponse):
    schulen: list[FLBewerbungSchuleOption]


class FLBewerbungKuerzelResponse(BaseAPIResponse):
    """Whether a proposed Kürzel is already a club's, active or retired, naming no club."""

    shorthand: str
    vergeben: bool


class FLBewerbungTrikotFarbenResponse(BaseAPIResponse):
    """Which kit colours one season has already assigned, naming no club."""

    saison_id: str
    # `vergeben` as the Kürzel read means it -- taken, and by nobody this answer names. A LIST rather
    # than a set, JSON having none; `assigned_trikot_farben` is what makes it distinct and ordered.
    vergeben: list[FLTrikotFarbe]


class FLPostBewerbungResponse(BaseAPIResponse):
    """The stored application, the one a replayed key wrote first; its mails are owed in the same write."""

    created_id: CustomObjectId


# --- The CONFIRMATION. The token is the whole credential, as a sign-in code is, so both
# endpoints are base-tier and every payload forbids an undeclared key.

# What a reopened link shows. `abgelaufen` is a spent link, its deadline passed or its application
# decided, said one way; `gesperrt` ranks first.
# `saison_vorbei`, a season row's alone, takes a Widerspruch and no consent (`kontakt_saison_vorbei`).
FLBewerbungEinwilligungZustand = Literal["gueltig", "bestaetigt", "abgelehnt", "abgelaufen", "saison_vorbei", "gesperrt"]

# Which record a link's seat sits on: an application, or a team's season row an administrator seated
# the person on. The page picks its wording by it, and the route handler mails an application's
# messages for the first alone.
FLEinwilligungQuelle = Literal["bewerbung", "saison"]

# What an answer on either kind of link did.
type FLEinwilligungErgebnis = Literal["bestaetigt", "abgelehnt"]


class FLBewerbungEinwilligungAnsichtResponse(BaseAPIResponse):
    """What the page renders for one seat, and nothing of the person."""

    quelle: FLEinwilligungQuelle
    zustand: FLBewerbungEinwilligungZustand
    # A season row's state now, read as the mint reads it, so a closed row's page can name why it takes
    # no consent; null on an application's link, which no season or withdrawal closes.
    zeile: FLKontaktZeile | None
    saison_id: str
    # The school's name as submitted, or the picked club's; on a season row, the name the club
    # carries in that season.
    schule: str
    rolle: FLKontaktRolle
    # The second seat this link's answer writes (`app/api/bewerbungen/services.py :: paired_seat`),
    # and never `trainer_ist_zugleich` itself: null on every other seat, so no link says whether two
    # OTHER seats are one person.
    zugleich_rolle: FLKontaktRolle | None
    # The label the page renders and its answer must name: the applicant's page, or the one for a
    # person an administrator seated, decided from how the seat was filled (`kontakt_seite_of`).
    laufende_fassung: str
    # The PERSON's floor over the seats this link answers for, so the page bounds its date control
    # and fills its own sentences from what the answer will judge rather than from a constant.
    mindestalter: int
    # The age from which the page offers the media switch, `medien_alter`'s floor.
    medien_mindestalter: int = Field(gt=0)


class FLBewerbungEinwilligungAntwortPayload(BaseModel):
    """One person's answer for one seat: the consent, or a decline that empties their slot."""

    model_config = ConfigDict(extra="forbid")

    token: CustomToken
    antwort: Literal["erteilt", "abgelehnt"]
    # Required as a KEY and null on a decline: the date is the consent's, and a decline stores no
    # person at all. Unbounded here -- the age is its own code with its own German at 422, never a
    # `payload_refused`.
    geburtsdatum: CustomOptionalDateString
    whatsapp: bool
    # Required as `whatsapp` is: a page that forgot the switch is refused rather than read as a no.
    medien: bool
    # The wording the CONFIRMING person saw, which is what a confirmed seat then cites: the label
    # the applicant ticked for them may be an older one.
    text_version: CustomEinwilligungTextVersion

    @model_validator(mode="after")
    def the_date_comes_with_the_consent_and_never_with_a_decline(self) -> Self:
        """A 422, like every shape rule about the body: the person answered, and one of the two fields contradicts the answer."""

        if self.antwort == "erteilt" and self.geburtsdatum is None:
            raise ValueError("Zur Bestätigung gehört das eigene Geburtsdatum.")

        if self.antwort == "abgelehnt" and self.geburtsdatum is not None:
            raise ValueError("Ein Widerspruch speichert kein Geburtsdatum.")

        return self

    @model_validator(mode="after")
    def the_whatsapp_consent_comes_with_the_consent_too(self) -> Self:
        """A decline empties the slot, so a `True` here would echo a scope back to the page that no seat records."""

        if self.antwort == "abgelehnt" and self.whatsapp:
            raise ValueError("Ein Widerspruch speichert keine WhatsApp-Einwilligung.")

        return self


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


class FLBewerbungEinwilligungErneutResponse(BaseAPIResponse):
    """The seat whose link was replaced and where its fresh one is owed; the old one opens nothing."""

    rolle: FLKontaktRolle
    # Off the image the write replaced, never the caller's earlier read: a correction landing between
    # the two moved the address this link has to go to.
    email: str
    rollen: list[FLKontaktRolle]
    bestaetigungsfrist: CustomDateString


class FLBewerbungKontaktSitzPayload(_KontaktpersonWritablePayload):
    """The person seated where a contact person stepped out, who has agreed to nothing yet."""

    # The label alone, `compose_einwilligung` requiring one and the registry naming it
    # (`fl_backend/app/shared/einwilligung.py :: FASSUNGEN`). Stripped before the floor counts it: a
    # version that is spaces cites no text.
    text_version: CustomEinwilligungTextVersion


class FLBewerbungKontaktSitzResponse(BaseAPIResponse):
    """The new person's address as stored and every seat they now hold; their link is owed there in the same write."""

    # Answered rather than re-derived by the caller, so one function decides the form a message is sent to.
    email: str
    # Plural as the correction's is: a mirrored pair is one person, and both seats are written from
    # the claim `kontakte.trainer_ist_zugleich` records.
    rollen: list[FLKontaktRolle]
    bestaetigungsfrist: CustomDateString


class FLBewerbungKontaktEmailPayload(BaseModel):
    """The corrected address and the one the page showed on the seat, and nothing else of the person."""

    model_config = ConfigDict(extra="forbid")

    # `_KontaktpersonWritablePayload.email`'s declaration, so an address this refuses is one the
    # public form refused too and a correction cannot store what a submission could not.
    email: CustomEmail
    # The address the page showed on the seat: a seat another person took since is refused rather than handed
    # the address typed for the one who left (`bewerbung_sitz_anders_besetzt`).
    bisherige_email: CustomEmail


class FLBewerbungKontaktEmailResponse(BaseAPIResponse):
    """The corrected address as stored and every seat it reached; the fresh link is owed there in the same write."""

    email: str
    # Plural: one person may hold two seats, and the correction writes the address and the link to
    # both, as a re-send does (`app/api/bewerbungen/services.py :: compose_erneut_update`).
    rollen: list[FLKontaktRolle]
    bestaetigungsfrist: CustomDateString


# --- The retention SWEEP, system tier. The backend decides, erases and owes each mail in the Postausgang; nothing a
# person's record holds leaves here (`READ-BEWERBUNG-004`).


class FLBewerbungSweepResponse(BaseAPIResponse):
    """One season's pass: each clock's count, every reminder and deletion notice owed in the write it belongs to."""

    saison_id: str
    # The applications reminded: each person due their one chase is owed it.
    erinnert: int
    # The fourteen-day clock's erasures, each owed its notice in its own transaction where none went out before.
    geloescht: int
    abgelehnte_geloescht: int
    angenommene_geloescht: int
    # The applications nobody decided, taken by the end of the season they applied for. Counted apart
    # from the two decided ones: folded in, a pass that erased where nobody decided would read as a
    # decision.
    ohne_entscheidung_geloescht: int
    kontaktbloecke_geleert: int
    redigierte_aktionen: int
    # One sum over every clock rather than a count a clock: the line logging each row names its clock.
    fehlgeschlagen: int


class FLBewerbungSweepSaisonsResponse(BaseAPIResponse):
    """Every season's id, for the caller to sweep one by one."""

    saison_ids: list[str]


class FLBewerbungKontoEinwilligungResponse(BaseAPIResponse):
    """Which of the application's seats the withdrawal reached, and the two answers they now all hold."""

    bewerbung_id: CustomObjectId
    rollen: list[FLKontaktRolle]
    umfang: FLKontaktKenntnisnahmeUmfang
    medien: bool
    # The precondition a next press on this application echoes.
    nachweis_stand: FLEinwilligungStand
