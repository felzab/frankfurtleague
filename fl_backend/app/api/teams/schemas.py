import hashlib
import json
import re
from collections.abc import Mapping
from typing import Annotated, Any, Final, Literal, Self, get_args

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    RootModel,
    StringConstraints,
    TypeAdapter,
    computed_field,
    model_validator,
)

from app.shared.folding import sign_in_identifier
from app.shared.schemas.addresses import FLAddress, FLAddressPayload
from app.shared.schemas.bounds import (
    EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH,
    LIST_LIMIT_DEFAULT,
    LIST_LIMIT_MAX,
    SAISON_ID_LENGTH,
    TEAM_DESCRIPTION_MAX_LENGTH,
    TEAM_FULL_NAME_MAX_LENGTH,
    TEAM_NAME_MAX_LENGTH,
    TEAM_SHORTHAND_LENGTH,
    TEAM_WEBSITE_URL_MAX_LENGTH,
)
from app.shared.schemas.custom import (
    PHONE_REGEX,
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomOptionalDateString,
    CustomOptionalExternalUrl,
    parse_empty_string_to_none,
    validate_external_url,
)
from app.shared.schemas.einwilligung import FLEinwilligungNachweise, FLEinwilligungStand, FLEinwilligungStandPayload
from app.shared.schemas.kontakt import CustomEmail, CustomKontaktName
from app.shared.schemas.responses import BaseAPIResponse
from app.shared.schemas.zustellung import FLBewerbungZustellung

# Spelled rather than derived: a `Literal`'s members must be literal expressions for a type checker
# to read them. `tests/api/test_reference_models.py` holds the spelling to one naming rule, so
# widening the set is arithmetic rather than a choice.
FLGruppenNames = Literal["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"]

# Read off the closed set rather than chosen beside it: a cap over the set size is one
# `app/api/teams/services.py :: offered_gruppen` serves short while refusing nothing.
MAX_NUMBER_OF_GROUPS: Final = len(get_args(FLGruppenNames))

# Two values rather than a free `saison_phase` filter: a table of the Halbfinale alone is not a
# standing, and offering it invites one.
FLTeamStatistikScope = Literal["gruppenphase", "gesamt"]


# A withdrawal is not a sanction, so the two routes out of a season are told apart rather than
# both filed as one. An alias because the bracket fault names it too.
FLAustrittType = Literal["disqualifikation", "rueckzug"]


# Slugs rather than the German the league's CI document spells, for the reason
# `fl_backend/app/api/spieler/schemas.py :: FLSpielerRolle` gives.
FLSchulform = Literal["gymnasium_g8", "gymnasium_g9", "gesamtschule", "privatschule_g8", "privatschule_g9", "oberstufengymnasium"]


# The CI document's palette, slugged for `FLSchulform`'s reason: two of its colours are named in
# German there, and the badge renders a swatch rather than either spelling.
FLTrikotFarbe = Literal[
    "weiss",
    "schwarz",
    "rot",
    "braun",
    "orange",
    "gelb",
    "hellgruen",
    "gruen",
    "tuerkis",
    "hellblau",
    "blau",
    "dunkelblau",
    "violett",
    "magenta",
    "bordeaux",
    "grau",
]


# Which second seat one person may hold beside the Trainer's. A closed set rather than a flag per
# seat: the two are alternatives, and nothing can mean holding both.
FLTrainerZugleich = Literal["ansprechperson", "stellvertretung"]

# The three seats as a closed set, for the wire, in the order `FLSaisonTeamKontakte` declares them;
# `tests/api/test_kontakt_erasure_execution.py :: test_every_slot_the_model_declares_is_covered` holds
# the two equal, order included.
FLKontaktRolle = Literal["trainer", "ansprechperson", "stellvertretung"]

# The one spelling of the seat set every module iterates, so a fourth seat is added in one place.
KONTAKT_ROLLEN: tuple[FLKontaktRolle, ...] = get_args(FLKontaktRolle)

# A season row as a link minted on it sees it: open, or closed by its season ending, which outranks
# its team having left it.
FLKontaktZeile = Literal["offen", "saison_vorbei", "ausgetreten"]


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


class FLAustritt(BaseModel):
    """How a team came to be out of one season, why, and from when.

    `grund` is FREE TEXT and PUBLIC -- it appears on the team's page, and this league publishes no
    disciplinary code an enum could cite.
    """

    type: FLAustrittType
    # A name written here outlives an erasure, which rewrites structured fields (`READ-FREETEXT-002`).
    grund: CustomNonEmptyString
    # The day the exit took effect, not the day somebody typed it in.
    datum: CustomDateString


def strip_austritt_grund(value: Any) -> Any:
    """Strip the reason before `FLAustritt`'s floor counts it, on the WRITE side alone.

    The strip runs BEFORE the floor, so on a read model a stored blank would refuse the club it
    stands on.
    """

    if isinstance(value, Mapping) and isinstance(grund := value.get("grund"), str):
        return {**value, "grund": grund.strip()}
    return value


# Private for `_TeamWritable`'s reason. The two provenance fields are NOT here: the server composes
# both on every write path, and a payload declaring either is a route to an answer nobody gave
# (`docs/backend/spec.md :: I142`).
class _KontaktKenntnisnahmeWritable(BaseModel):
    umfang: Literal["kontaktdaten"]
    # The version of the text they were shown. The text lives in the frontend and is versioned
    # there, so a later rewording never changes what a stored record claims.
    text_version: str
    datum: CustomDateString


# Wider than the administrative payload's: the WhatsApp scope is the person's own, set on their
# confirmation page and moved by their account page's seat PATCH; an administrator's payload offering it
# would transcribe one.
FLKontaktKenntnisnahmeUmfang = Literal["kontaktdaten", "kontaktdaten_whatsapp"]

# What stored seats name as who answered; no write sets it (`app/shared/einwilligung_nachweis.py ::
# SPRECHER`). Whether the person answered is `bestaetigt_am`, and who seated them `eingetragen_von`.
FLKontaktKenntnisnahmeQuelle = Literal["person", "administrativ"]

# Who put this person in the seat: the applicant on the form, or the league's administration (a reseat,
# the contacts editor). Not `verwaltung`, the access tier's word (`docs/glossary.md :: verwaltung`).
FLKontaktEingetragenVon = Literal["bewerbung", "liga"]


class FLKontaktKenntnisnahme(_KontaktKenntnisnahmeWritable):
    """Which wording this person was shown, and how the record came to be held.

    Kenntnisnahme and not Einwilligung: the published basis is Art. 6(1)(b)/(f), and the pupil's
    `fl_backend/app/api/spieler/schemas.py :: FLEinwilligung` holds other values entirely
    (`docs/glossary.md :: Einwilligung`).
    """

    umfang: FLKontaktKenntnisnahmeUmfang
    # For `app/api/spieler/schemas.py :: FLEinwilligung.erteilt_von`'s reason.
    erfasst_von: FLKontaktKenntnisnahmeQuelle | None = None
    # The day this person confirmed the seat themselves; null until they do. Defaulted for
    # `FLTeam.schulform`'s reason: a record stored before the field carries no key.
    bestaetigt_am: CustomOptionalDateString = None
    # The one consent on this record, to photographs, video and interviews, and on the READ model
    # alone for `umfang`'s reason. Defaulted for `bestaetigt_am`'s.
    medien: bool = False
    # Written once, by the write that seats the person, and moved by nothing else: which confirmation
    # page the seat's link opens. Defaulted for `bestaetigt_am`'s reason.
    eingetragen_von: FLKontaktEingetragenVon | None = None
    # Each choice's evidence, empty until the seat's person answers, for `FLEinwilligung.nachweis`'s reasons.
    nachweis: FLEinwilligungNachweise = Field(default_factory=FLEinwilligungNachweise)


class FLKontaktperson(BaseModel):
    """One person the league reaches this team through, for one season."""

    vorname: CustomNonEmptyString
    nachname: CustomNonEmptyString
    email: str
    # The league's whole channel to a team is this number. Whether it may be reached on WhatsApp
    # rests on the optional consent the person gives on their own confirmation page, never on the
    # form's wording.
    telefon: str
    # Null until the person types it on their own confirmation page, so the public form never asks
    # for it (`docs/backend/spec.md :: I141`). Defaulted for `FLTeam.schulform`'s reason.
    geburtsdatum: CustomOptionalDateString = None
    einwilligung: FLKontaktKenntnisnahme


class FLSaisonTeamKontakte(BaseModel):
    """The three people a team is reached through, for ONE season.

    On the junction rather than the club: a school's staff turns over between seasons, and a
    finished season is the record of who was reachable while it ran.
    """

    # Nullable per SLOT: a person's erasure empties the slots naming them and must not reach the
    # two people beside them.
    trainer: FLKontaktperson | None
    ansprechperson: FLKontaktperson | None
    stellvertretung: FLKontaktperson | None
    # Which OTHER seat the Trainer also holds, or nobody. One nullable field rather than two flags,
    # which would let a row claim both at once. Stored rather than derived: two people can share
    # every field, and an assertion is not a coincidence.
    trainer_ist_zugleich: FLTrainerZugleich | None


class FLSaisonTeamBestaetigung(BaseModel):
    """One seat's confirmation link as the season row stores it -- and NO `token_hash`, the raw document key the link's lookup alone reads."""

    verschickt_am: CustomDateString
    # STORED rather than derived from `verschickt_am` and the bound: raising the bound would otherwise
    # move the deadline of every link already in somebody's inbox.
    frist: CustomDateString
    # Beside the slot rather than inside it: a Widerspruch EMPTIES the slot, and a marker in there would go with it.
    abgelehnt_am: CustomOptionalDateString
    # Defaulted: a fresh link knows nothing yet about its message.
    zustellung: FLBewerbungZustellung | None = None


class FLSaisonTeamBestaetigungen(BaseModel):
    """The three seats' links, outside `kontakte` and mirroring its slots; nullable per seat, as the slot beside each is."""

    trainer: FLSaisonTeamBestaetigung | None
    ansprechperson: FLSaisonTeamBestaetigung | None
    stellvertretung: FLSaisonTeamBestaetigung | None


class FLSaisonTeamBestaetigungAnsicht(FLSaisonTeamBestaetigung):
    """One seat's link as the contacts editor reads it: the stored link and whether it has lapsed."""

    # Judged on the read by the rule the seat's press refuses on, at the server's date, so no client
    # compares `frist` to a clock of its own; a read model, since nothing stores it.
    abgelaufen: bool


class FLSaisonTeamBestaetigungenAnsicht(BaseModel):
    trainer: FLSaisonTeamBestaetigungAnsicht | None
    ansprechperson: FLSaisonTeamBestaetigungAnsicht | None
    stellvertretung: FLSaisonTeamBestaetigungAnsicht | None


def _project_seat(value: Any) -> Any:
    """One seat with every READ field spelled, absent or not.

    Every defaulted field arrived after rows existed, so a row missing its key has to answer the same
    token as one storing what the read model reads there.
    """

    # `parse_empty_string_to_none` at every leaf, the coercion the read model makes on the way in: a
    # stored blank it nulls would answer a token no read can mint, and that row would refuse every
    # save made against it.
    if not isinstance(value, Mapping):
        # A value that is no mapping is no seat, which carries `trainer_ist_zugleich` and a fourth
        # seat alike.
        return parse_empty_string_to_none(value)

    projected: dict[str, Any] = {field: _projected_leaf(FLKontaktperson, value, field) for field in FLKontaktperson.model_fields}
    einwilligung = projected.get("einwilligung")
    if isinstance(einwilligung, Mapping):
        # Never `nachweis`: it moves only with a choice or a stamp the token already holds, and its
        # nested defaults would part a stored block's token from its read's.
        projected["einwilligung"] = {
            field: _projected_leaf(FLKontaktKenntnisnahme, einwilligung, field)
            for field in FLKontaktKenntnisnahme.model_fields
            if field != "nachweis"
        }

    return projected


def _projected_leaf(model: type[BaseModel], stored: Mapping[str, Any], field: str) -> Any:
    """One field as the read model answers it, an absent key reading as the field's default.

    Never `None` there: `medien` reads `false`, and null would answer a token no read mints.
    """

    info = model.model_fields[field]
    if field not in stored and not info.is_required():
        return info.get_default(call_default_factory=True)

    return parse_empty_string_to_none(stored.get(field))


# DERIVED and stored nowhere: a version the row carried would have to be bumped by every writer of
# `kontakte`, and a club rename would then refuse a contacts save.
def kontakte_stand_of(block: Any) -> str:
    """The token naming which contact block a save was composed against. A precondition, never a secret."""

    # Projected rather than validated, so a value the read model refuses cannot 500 the very save
    # that repairs it (`docs/backend/spec.md :: I104`).
    projected = {field: _project_seat(block.get(field)) for field in FLSaisonTeamKontakte.model_fields} if isinstance(block, Mapping) else block
    # Sorted keys and `sha256`, never `hash()`, whose seed changes per process
    # (`docs/backend/spec.md :: I192`). `default` reaches only a stored value no model describes,
    # each of which `str` renders the same way twice.
    canonical = json.dumps(projected, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)

    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# The ceilings are here and not on the read models above for `FLAddressPayload`'s reason: refusing a
# stored value on read answers 500 for a whole list over one row, and locks out the write that would
# repair it.
class FLKontaktKenntnisnahmePayload(_KontaktKenntnisnahmeWritable):
    model_config = ConfigDict(extra="forbid")

    # Stripped before the floor counts it, as the names below are: a record whose wording version is
    # spaces cites no text at all, and `min_length` counts characters.
    text_version: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH)]


# Private for `_TeamWritable`'s reason, and a base rather than `FLKontaktperson` itself because
# Pydantic cannot un-inherit a field: no payload takes a birthdate, so none is here, and the two
# below differ on the consent shape alone.
class _KontaktpersonWritablePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Tightened on the WRITE side alone (`docs/backend/spec.md :: I36`), in the type the public
    # application and a referee's name take too, so the editor and the form refuse a name alike.
    vorname: CustomKontaktName
    nachname: CustomKontaktName
    email: CustomEmail
    # Here rather than beside the format: the pattern caps the length inside itself, which makes it
    # a ceiling.
    telefon: str = Field(pattern=PHONE_REGEX)


class FLKontaktpersonPayload(_KontaktpersonWritablePayload):
    # No birthdate on this payload or the public one: the date is the person's own to enter at their
    # confirmation (`docs/backend/spec.md :: I141`, `:: I142`).
    einwilligung: FLKontaktKenntnisnahmePayload


class FLSaisonTeamKontaktePayload(FLSaisonTeamKontakte):
    """The write side of the three, with the empty slot an erasure leaves.

    Three whole people is the editor's own guarantee
    (`fl_frontend/src/features/kontakte/components/forms/AdminKontakteEditForm/FormKontakteSection.tsx`).
    """

    model_config = ConfigDict(extra="forbid")

    # Accepted empty so a row an erasure emptied stays editable; required, any later edit to that row
    # would re-collect the person who asked to be forgotten.
    trainer: FLKontaktpersonPayload | None
    ansprechperson: FLKontaktpersonPayload | None
    stellvertretung: FLKontaktpersonPayload | None

    @model_validator(mode="after")
    def the_trainer_equals_the_seat_they_also_hold(self) -> Self:
        """Where one person holds two seats, the two blocks agree field for field.

        A mismatch is a drifted client, and stored it leaves two records of one person, unpaired by the
        erasure and mailed two links.
        """

        if self.trainer_ist_zugleich is None:
            return self

        seat = getattr(self, self.trainer_ist_zugleich)

        # An empty side is a seat an erasure or a Widerspruch emptied, which names nobody to compare.
        if seat is not None and self.trainer is not None and seat != self.trainer:
            raise ValueError(f"Die Angaben unter '{self.trainer_ist_zugleich}' müssen denen des Trainers entsprechen.")

        return self

    @model_validator(mode="after")
    def the_distinct_people_share_no_email_or_telephone(self) -> Self:
        """Two DIFFERENT people may not be reachable at one address or one number.

        The seat the Trainer also holds is left out of the comparison: it is the same person, and
        the rule above has already held the two blocks equal.
        """

        seats = [seat for seat in KONTAKT_ROLLEN if seat != self.trainer_ist_zugleich]
        people: list[_KontaktpersonWritablePayload] = [person for seat in seats if (person := getattr(self, seat)) is not None]

        # On the sign-in fold: two seats one sign-in reaches are one identity, and `casefold` would
        # refuse „strasse“ beside „straße“, two domains to IDNA 2008.
        emails = [sign_in_identifier(person.email) for person in people]
        if len(set(emails)) != len(emails):
            raise ValueError("Die Kontaktpersonen müssen unterschiedliche E-Mail-Adressen haben.")

        telefone = [normalise_telefon(person.telefon) for person in people]
        if len(set(telefone)) != len(telefone):
            raise ValueError("Die Kontaktpersonen müssen unterschiedliche Telefonnummern haben.")

        return self


class FLTeamStatistik(BaseModel):
    # `default=` by keyword, never `Field(0, ge=0)`: a positional one leaves the field looking
    # required to Pyright while ruff and the tests stay silent.
    anzahl_gespielte_spiele: int = Field(default=0, ge=0)
    siege: int = Field(default=0, ge=0)
    niederlagen: int = Field(default=0, ge=0)
    unentschieden: int = Field(default=0, ge=0)
    tore_geschossen: int = Field(default=0, ge=0)
    tore_kassiert: int = Field(default=0, ge=0)
    punkte: int = Field(default=0, ge=0)
    # Beside the scoring, never inside it: a forfeit is in this figure and in
    # `anzahl_gespielte_spiele` both (`docs/backend/spec.md :: I1d`).
    anzahl_abgesagte_spiele: int = Field(default=0, ge=0)


# Private, so the payloads, the stored record and the read model state these fields once, and the
# base itself publishes no OpenAPI component.
class _TeamWritable(BaseModel):
    name: CustomNonEmptyString
    shorthand: str = Field(min_length=TEAM_SHORTHAND_LENGTH, max_length=TEAM_SHORTHAND_LENGTH)
    # Capped so the public page and the editor's textarea agree on what fits; the bound stays out of
    # the database validator (`docs/backend/spec.md :: I16`).
    description: str = Field(max_length=TEAM_DESCRIPTION_MAX_LENGTH)
    full_name: CustomNonEmptyString
    # NO default here, so the payloads inherit none: `PATCH` replaces the club wholesale, and an
    # omitted key would clear a school form and fan the clearing out as an edit somebody asked for.
    schulform: FLSchulform | None
    # Rendered straight into an href on a public page, so the scheme is constrained here as well as
    # in the frontend (`app/shared/schemas/custom.py :: validate_external_url`). NULL where a school
    # has no site: `""` renders as a link to the page it sits on.
    website_url: CustomOptionalExternalUrl
    # Public on every read: decided 2026-08, Datenschutzexperte consulted. A school's street stays on
    # the base tier, and the form asking for it says so
    # (`fl_frontend/src/features/bewerbungen/components/forms/BewerbungForm/FormSchuleSection.tsx`).
    address: FLAddress


class FLTeam(_TeamWritable):
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")

    # Re-declared with a default, as `FLSpieler` re-declares the junction's newer fields: a club
    # whose document predates the field still has to be describable, and a model that 422s over one
    # describes it as impossible.
    schulform: FLSchulform | None = None

    gruppe: FLGruppenNames
    statistik: FLTeamStatistik
    # Joined from the junction on every read, and copied into no match document.
    austritt: FLAustritt | None
    # The day this CLUB left the league. Leaving one season is `austritt` above.
    inactive_since: CustomOptionalDateString


FLTeamListAdapter = TypeAdapter(list[FLTeam])


class FLTeamRecord(_TeamWritable):
    """The club document as it is STORED, and what the write endpoints echo.

    The season-scoped fields would mean re-running the team pipeline, whose junction join is strict
    -- and a club being created holds no row yet.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    inactive_since: CustomOptionalDateString
    # Defaulted for `FLTeam`'s reason: the retire and reactivate endpoints echo this off a stored
    # document, which is the one a club nobody has edited since is read back through.
    schulform: FLSchulform | None = None


class FLGruppenTeam(BaseModel):
    """One row of a league table: what a standing shows and nothing more.

    Narrower than `FLTeam` on purpose: a public CLIENT component renders this, so every field is
    serialised into the page, and a club's address is a school's street.
    """

    id: CustomObjectId
    name: CustomNonEmptyString
    shorthand: str = Field(min_length=TEAM_SHORTHAND_LENGTH, max_length=TEAM_SHORTHAND_LENGTH)
    statistik: FLTeamStatistik
    # The TYPE alone: a row marks that a club is out, and the club's own page publishes the reason
    # and the date.
    austritt_type: FLAustrittType | None
    # Fixtures neither counted nor called off in the `statistik_scope` asked for, so points are still
    # to be awarded here. REQUIRED with no default: a caller that forgot it would silently strip a
    # placing (`docs/backend/spec.md :: I97`).
    anzahl_ausstehende_spiele: int = Field(ge=0)


class FLGruppen(RootModel[Mapping[FLGruppenNames, list[FLGruppenTeam]]]):
    """Every group the SEASON offers, all of them and no other, in standing order.

    Built by `fl_backend/app/api/teams/services.py :: build_gruppen` alone: the order is the tiebreak
    chain, whose head-to-head criterion reads the season's matches.
    """


class FLTeamMembership(BaseModel):
    """One junction row as seen from its club: which season, which group, and the record if any."""

    saison_id: str
    gruppe: FLGruppenNames
    austritt: FLAustritt | None
    # Defaulted because `$project` omits a key the stored row has not got: a season entered before
    # either field existed would otherwise 500 the whole admin club list.
    trikot_farbe: FLTrikotFarbe | None = None
    kontakte: FLSaisonTeamKontakte | None = None
    # Each seat's link as the editor shows it, the referee editor's twin; defaulted for `kontakte`'s reason.
    bestaetigungen: FLSaisonTeamBestaetigungenAnsicht | None = None

    @computed_field
    @property
    def kontakte_stand(self) -> str:
        """The token a save against this contact block has to echo back (`docs/backend/spec.md :: I192`)."""

        return kontakte_stand_of(None if self.kontakte is None else self.kontakte.model_dump(mode="json"))


class FLTeamWithMemberships(FLTeamRecord):
    """The stored club document plus every season membership it holds.

    A DIFFERENT question from `FLTeam`, not a projection: that one joins strictly against one season,
    so a club outside it is absent by design.
    """

    memberships: list[FLTeamMembership]


FLTeamWithMembershipsListAdapter = TypeAdapter(list[FLTeamWithMemberships])


class FLTeamsMembershipsResponse(BaseAPIResponse):
    """Every club, retired ones included, each with its memberships. Sorted by name."""

    teams: list[FLTeamWithMemberships]


# Private for `_TeamWritable`'s reason. The bounded address sits here rather than on that base, which
# `FLTeam`, `FLTeamRecord` and `FLTeamWithMemberships` share.
class _TeamPayload(_TeamWritable):
    model_config = ConfigDict(extra="forbid")

    address: FLAddressPayload
    # Stripped and CEILINGED on the WRITE side alone, a stored value still reading as it stands
    # (`docs/backend/spec.md :: I36`). `name` reaches a league table row, so a space would show
    # there. The ceilings are the application's: both tiers refuse alike.
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=TEAM_NAME_MAX_LENGTH)]
    full_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=TEAM_FULL_NAME_MAX_LENGTH)]
    # Redeclared for that reason too: the width is a floor as well as a ceiling, and what it holds
    # is the whole of what a league table row names the club by.
    shorthand: Annotated[str, StringConstraints(strip_whitespace=True, min_length=TEAM_SHORTHAND_LENGTH, max_length=TEAM_SHORTHAND_LENGTH)]
    # Stripped on the WRITE side too: `validate_external_url` leaves surrounding whitespace on the
    # value, so a pasted URL would be stored with it. Composed from `str` as the application's twin
    # is, so the ceiling is judged BEFORE the host regex runs.
    website_url: Annotated[
        Annotated[
            str,
            StringConstraints(strip_whitespace=True, max_length=TEAM_WEBSITE_URL_MAX_LENGTH),
            AfterValidator(validate_external_url),
        ]
        | None,
        BeforeValidator(parse_empty_string_to_none),
    ]


# Two names for one shape rather than an alias: the create and the edit are free to diverge, and an
# alias would carry a change to either one into the other.
class FLPostTeamPayload(_TeamPayload):
    pass


class FLPatchTeamPayload(_TeamPayload):
    pass


class FLPostSaisonTeamPayload(BaseModel):
    """One team's membership of one season. `team_id` comes from the path, `saison_id` from here."""

    model_config = ConfigDict(extra="forbid")

    # Stripped before the width is counted, for `app/shared/schemas/custom.py :: CustomStrippedNonEmptyString`'s reason.
    saison_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)]
    gruppe: FLGruppenNames


class FLPatchSaisonTeamPayload(BaseModel):
    """The row's own fields. NO `kontakte`: `FLPatchSaisonTeamKontaktePayload` owns it.

    A stored contact is shapeless on read and bounded on write, so round-tripping it here refuses
    every save a club with one bad row can make.
    """

    model_config = ConfigDict(extra="forbid")

    gruppe: FLGruppenNames
    # No `default=None` on either: `PATCH` replaces every field it takes wholesale, so an omitted key
    # would silently reinstate a team or clear a colour with nobody having asked for it.
    austritt: Annotated[FLAustritt, BeforeValidator(strip_austritt_grund)] | None
    trikot_farbe: FLTrikotFarbe | None


class FLPatchSaisonTeamKontaktePayload(BaseModel):
    """The contact block alone, plus the token naming which block it was composed against.

    `extra="forbid"`: a `gruppe` or an `austritt` sent here is a 422 rather than a value this
    endpoint was never asked to decide.
    """

    model_config = ConfigDict(extra="forbid")

    # Nullable, and required: null CLEARS the block, which is how a team with no recorded contacts is
    # expressed at entry and must stay expressible here.
    kontakte: FLSaisonTeamKontaktePayload | None
    # One opaque token rather than the read block echoed back, which would put a read model on a
    # request body. Required with no default: an omitted precondition judges nothing.
    kontakte_stand: str


class SitzEinwilligungPayload(BaseModel):
    """A seat holder's own two choices for every seat they hold on one row, under the name each seat control publishes.

    Both choices on every press: a page that sent one alone would leave the other judged by nothing.
    """

    model_config = ConfigDict(extra="forbid")

    umfang: FLKontaktKenntnisnahmeUmfang
    medien: bool
    # The label of the account page's seat control the press was given under, recorded on its evidence.
    text_version: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH)]
    # The row's `nachweis_stand` as the page was served it (`docs/backend/spec.md :: I591`).
    nachweis_stand: FLEinwilligungStandPayload


class FLSaisonTeamPersonEinwilligungPayload(SitzEinwilligungPayload):
    pass


class FLReplaceSaisonTeamPayload(BaseModel):
    """Which club takes this season's row over. The path names the club going OUT."""

    model_config = ConfigDict(extra="forbid")

    # The only field: the row keeps the group it stands in, and its copy of the identity is reseeded
    # from the incoming club, so a client-supplied name could only disagree with it.
    incoming_team_id: CustomObjectId


class FLPublicTeamsFilterParams(BaseModel):
    """What `GET /teams` may narrow on. `include_inactive` is on the admin model below alone.

    A standings row names no leaving date, so a base-tier read that un-hid a retired club would say
    nothing about which one had left (`READ-SQUAD-002`).
    """

    # No `team_id`: one team by its id is addressed by `GET /teams/{team_id}`; this narrows a list.
    saison_id: str | None = None
    gruppe: FLGruppenNames | None = None
    # A question about the junction, not a field on it -- nothing stores a boolean. It asks whether
    # the club LEFT, by either route; `austritt_type` below is what narrows to one of them.
    has_austritt: bool | None = None
    # Independent of the boolean rather than nested under it: naming a type already implies having
    # left, so the two combine without either having to imply the other.
    austritt_type: FLAustrittType | None = None
    in_gruppen: bool | None = None

    # Defaults to the GROUP TABLE, so an omitted parameter is the correct standing rather than the
    # playoff-polluted one.
    statistik_scope: FLTeamStatistikScope = Field(default="gruppenphase")

    limit: int = Field(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX)
    sort_by: Literal["name"] = Field(default="name")
    order: Literal["asc", "desc"] = Field(default="asc")


class FLTeamsFilterParams(FLPublicTeamsFilterParams):
    """The same filters plus the one switch a base-tier caller is not offered.

    An extension rather than a second declaration, as `FLSpielerAdminSingleResponse` is: two
    spellings of one filter set drift on every field they share.
    """

    # Retired CLUBS, for the admin pickers and for `GET /teams/{team_id}`, which is handed an id
    # rather than discovering one.
    include_inactive: bool = False


class FLTeamSingleFilterParams(BaseModel):
    """What `GET /teams/{team_id}` accepts: only what chooses WHICH SEASON'S figures to derive."""

    saison_id: str | None = None
    # Spelled again rather than shared with `FLTeamsFilterParams`: a base holding this default would
    # put a ratified one behind an inheritance edit made for some unrelated field.
    statistik_scope: FLTeamStatistikScope = Field(default="gruppenphase")


class FLTeamsListResponse(BaseAPIResponse):
    format: Literal["list"] = "list"
    teams: list[FLTeam]


class FLTeamsGroupedResponse(BaseAPIResponse):
    """The season's groups in standing order, and how many of each advance.

    `qualifiers_per_group` rides along rather than being fetched separately, so a page cannot mark a
    cutoff drawn from a different season than the table it marks.
    """

    format: Literal["grouped"] = "grouped"
    gruppen: FLGruppen
    qualifiers_per_group: int = Field(gt=0)


class FLTeamsSingleResponse(BaseAPIResponse):
    """One team, from `GET /teams/{team_id}`.

    Not part of `FLTeamsResponse`: that union discriminates the shapes ONE endpoint can return.
    """

    format: Literal["single"] = "single"
    team: FLTeam


class FLPostTeamResponse(BaseAPIResponse):
    created_id: CustomObjectId


class FLPatchTeamResponse(BaseAPIResponse):
    updated_document: FLTeamRecord
    # Reported rather than assumed: this fan-out is the half of the endpoint that fails silently (`docs/backend/spec.md :: I13`).
    fanned_out_to_spiele: int
    # Reported for the same reason, and separately: it is scoped to the seasons that are not `past`,
    # so zero means the club holds no row in one of those -- every season closed, or none entered.
    fanned_out_to_saison_teams: int


class FLTeamWriteResponse(BaseAPIResponse):
    """What the retire and reactivate endpoints echo. `FLTeamRecord`, for the reason stated on it."""

    updated_document: FLTeamRecord


class FLSaisonTeamResponse(BaseAPIResponse):
    """A junction row, which has no read model of its own -- so it is echoed as it was written."""

    # No field here carries a default, as none does on the other write echoes: each is built from
    # keywords, so a default would echo what no caller wrote.
    saison_id: str
    team_id: CustomObjectId
    gruppe: FLGruppenNames
    austritt: FLAustritt | None
    # Echoed as the row now stands: entry writes it null and the PATCH replaces it wholesale, so the
    # echo is the only place a client learns what the row ended up holding.
    trikot_farbe: FLTrikotFarbe | None
    # Read off the row rather than off a payload: no endpoint answering with this model writes the
    # block, so what it holds is whatever `PATCH .../kontakte` last put there.
    kontakte: FLSaisonTeamKontakte | None
    # The season's own copy of the club's identity, on no payload: it is seeded from the club at
    # entry and rewritten by the rename fan-out, so a client supplying it could only be stale.
    name: CustomNonEmptyString
    shorthand: str = Field(min_length=TEAM_SHORTHAND_LENGTH, max_length=TEAM_SHORTHAND_LENGTH)


class FLKontaktMint(BaseModel):
    """One person's fresh confirmation link, RAW, for the admin action to mail; it is answered here and in no other response, ever."""

    token: str
    # Every seat the one link answers for, two where the Trainer holds a second: one link per person.
    rollen: list[FLKontaktRolle]
    # As this transaction stored it, never a caller's earlier read: the link has to reach the person it seats.
    email: str
    frist: CustomDateString
    # What the mail names, read in the same transaction as the address: the person's first name as
    # seated, and the club under the name it carries in that season, the link's own page saying the same.
    vorname: str
    schule: str
    # The row's state in the same transaction, so the mail asks what the link's page takes: a closed
    # row's link takes the Widerspruch alone (`docs/backend/spec.md :: I570`).
    zeile: FLKontaktZeile


class FLPatchSaisonTeamKontakteResponse(BaseAPIResponse):
    """The block as STORED after the write, its row, and the links it minted.

    No other field off that row: the caller sent none, and echoing one would invite a client to
    believe this endpoint owns it.
    """

    saison_id: str
    team_id: CustomObjectId
    # The row's own id, which the delivery record of a mailed link is filed against.
    saison_team_id: CustomObjectId
    kontakte: FLSaisonTeamKontakte | None
    # Empty where the save seated nobody new: a seat keeping its person keeps their link.
    bestaetigungen: list[FLKontaktMint]

    @computed_field
    @property
    def kontakte_stand(self) -> str:
        """The AFTER image's token: this save has moved the row past what its caller read, so an undo of it can replay against no other."""

        return kontakte_stand_of(None if self.kontakte is None else self.kontakte.model_dump(mode="json"))


class FLKontaktEinladenResponse(BaseAPIResponse):
    """A fresh link for one seat, and its pair where the Trainer holds both; the old link then opens nothing."""

    saison_id: str
    team_id: CustomObjectId
    saison_team_id: CustomObjectId
    bestaetigung: FLKontaktMint


class FLReplaceSaisonTeamResponse(BaseAPIResponse):
    """The junction row as the replacement left it, plus what it reached beyond that row.

    `austritt` is cleared and not echoed: a club that has not withdrawn needs nothing done about it.
    """

    saison_id: str
    outgoing_team_id: CustomObjectId
    incoming_team_id: CustomObjectId
    # Untouched by the replacement, and echoed because the arriving club has to be told which group
    # it now stands in.
    gruppe: FLGruppenNames
    # The gap: the outgoing school's colour and its three people leave with it, so the season now
    # has no way at all to reach this team.
    trikot_farbe: FLTrikotFarbe | None
    kontakte: FLSaisonTeamKontakte | None
    # Reseeded from the incoming club, exactly as entry seeds them.
    name: CustomNonEmptyString
    shorthand: str = Field(min_length=TEAM_SHORTHAND_LENGTH, max_length=TEAM_SHORTHAND_LENGTH)
    # Reported rather than assumed, as `FLPatchTeamResponse` reports its own
    # (`docs/backend/spec.md :: I13`).
    fanned_out_to_spiele: int
    # Reported for the same reason, and separately: the outgoing club's squad leaves the season with
    # it, and zero is a real answer -- a club can hold a junction row and no squad at all.
    ausgetragene_squad_rows: int


class FLTeamSitz(BaseModel):
    """One seat as the people beside it see it: who holds it and whether they answered their link.

    No address, telephone number or birthdate: the contact page promises that only administrators
    see those (`fl_backend/app/shared/einwilligung.py :: FASSUNGEN`).
    """

    rolle: FLKontaktRolle
    # Null for an empty slot, which is answered rather than omitted: a missing line reads as a team
    # with two seats rather than one with a seat unfilled.
    name: str | None
    # Composed from the stamp and never the stamp itself, so no date about another person crosses.
    bestaetigt: bool


class FLTeamSitzeResponse(BaseAPIResponse):
    """A team's three seats in one season, in the order `KONTAKT_ROLLEN` names them."""

    team_id: CustomObjectId
    saison_id: str
    sitze: list[FLTeamSitz]


class FLSaisonTeamPersonEinwilligungResponse(BaseAPIResponse):
    """Which of the row's seats the press reached, and the two answers they now all hold."""

    team_id: CustomObjectId
    saison_id: str
    rollen: list[FLKontaktRolle]
    umfang: FLKontaktKenntnisnahmeUmfang
    medien: bool
    # The precondition a next press on this row echoes.
    nachweis_stand: FLEinwilligungStand


FLTeamsResponse = Annotated[
    FLTeamsListResponse | FLTeamsGroupedResponse,
    Field(discriminator="format"),
]
