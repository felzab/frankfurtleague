from typing import Annotated, Any, Literal, Mapping, Union

from pydantic import BaseModel, BeforeValidator, ConfigDict, EmailStr, Field, RootModel, StringConstraints, TypeAdapter

from app.shared.schemas.addresses import FLAddress, FLAddressPayload
from app.shared.schemas.bounds import (
    EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH,
    KONTAKT_EMAIL_MAX_LENGTH,
    LIST_LIMIT_DEFAULT,
    LIST_LIMIT_MAX,
    SAISON_ID_LENGTH,
    TEAM_DESCRIPTION_MAX_LENGTH,
    TEAM_SHORTHAND_LENGTH,
)
from app.shared.schemas.custom import (
    PERSON_NAME_PATTERN,
    PHONE_REGEX,
    CustomDateString,
    CustomNonEmptyString,
    CustomObjectId,
    CustomOptionalDateString,
    CustomOptionalExternalUrl,
    CustomStrippedNonEmptyString,
    CustomStrippedOptionalExternalUrl,
)
from app.shared.schemas.responses import BaseAPIResponse

FLGruppenNames = Literal["A", "B", "C", "D"]

# Two values rather than a free `saison_phase` filter: a table of the Halbfinale alone is not a
# standing, and offering it invites one.
FLTeamStatistikScope = Literal["gruppenphase", "gesamt"]


# A withdrawal is not a sanction, so the two routes out of a season are told apart rather than
# both filed as one. An alias because the bracket fault names it too.
FLAustrittType = Literal["disqualifikation", "rueckzug"]


# Slugs rather than the German the league's CI document spells, for the reason
# `fl_backend/app/api/spieler/schemas.py :: FLSpielerRolle` gives: a stored German word becomes a
# third spelling for a label and a badge to drift from.
FLSchulform = Literal["gymnasium_g8", "gymnasium_g9", "gesamtschule", "privatschule_g8", "privatschule_g9", "oberstufengymnasium"]


# The CI document's palette, slugged for the reason above: two of its colours are named in German
# there, and the badge renders a swatch rather than either spelling.
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


class FLAustritt(BaseModel):
    """How a team came to be out of one season, why, and from when.

    `grund` is FREE TEXT and PUBLIC -- it appears on the team's page, and this league publishes no
    disciplinary code an enum could cite.
    """

    type: FLAustrittType
    grund: CustomNonEmptyString
    # The day the exit took effect, not the day somebody typed it in.
    datum: CustomDateString


def strip_austritt_grund(value: Any) -> Any:
    """Strip the reason before `FLAustritt`'s floor counts it, on the WRITE side alone.

    Never on `FLAustritt`, which every read of a club embeds and must take a stored value as it
    stands: the strip runs BEFORE the floor, so a stored blank would refuse.
    """

    if isinstance(value, Mapping) and isinstance(grund := value.get("grund"), str):
        return {**value, "grund": grund.strip()}
    return value


class FLKontaktEinwilligung(BaseModel):
    """What this person agreed to, and which wording they agreed to.

    NOT `fl_backend/app/api/spieler/schemas.py :: FLEinwilligung`, which records what may be
    PUBLISHED about a pupil, is written once, and has an open Datenschutz question in front of it.
    """

    umfang: Literal["kontaktdaten"]
    # Who gave it. Distinguishing the two is what stops an admin's transcription reading as a
    # person's own consent.
    erteilt_von: Literal["person", "administrativ"]
    # The version of the text they were shown. The text lives in the frontend and is versioned
    # there, so a later rewording never changes what a stored record claims.
    text_version: str
    datum: CustomDateString


class FLKontaktperson(BaseModel):
    """One person the league reaches this team through, for one season."""

    vorname: CustomNonEmptyString
    nachname: CustomNonEmptyString
    email: str
    # Reachable on WhatsApp, which the consent text states: the league's whole channel to a team is
    # this number.
    telefon: str
    geburtsdatum: CustomDateString
    einwilligung: FLKontaktEinwilligung


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


# The bounded copies the junction PATCH embeds. The ceilings are here and not on the read models
# above for `FLAddressPayload`'s reason: refusing a stored value on read answers 500 for a whole
# list over one row. For these, the bound is the write side's.
class FLKontaktEinwilligungPayload(FLKontaktEinwilligung):
    model_config = ConfigDict(extra="forbid")

    # Stripped before the floor counts it, as the names below are: a record whose wording version is
    # spaces cites no text at all, and `min_length` counts characters.
    text_version: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH)]


class FLKontaktpersonPayload(FLKontaktperson):
    model_config = ConfigDict(extra="forbid")

    # Tightened on the WRITE side alone, as a referee's name is (`docs/backend/spec.md :: I36`), and
    # stripped there for the same reason.
    vorname: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, pattern=PERSON_NAME_PATTERN)]
    nachname: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, pattern=PERSON_NAME_PATTERN)]
    # On the write side, not the read: `GET /teams/memberships` is the ONLY route to repairing a bad
    # row, so a value it refused would lock itself in. The ceiling is stated rather than left to
    # email-validator, whose refusal names no field.
    email: Annotated[EmailStr, StringConstraints(max_length=KONTAKT_EMAIL_MAX_LENGTH)]
    # Here for the same reason, and on this side rather than beside the format: the pattern caps the
    # length at 20 inside itself, which makes it a ceiling -- and a ceiling is the write side's, a
    # read refusing a stored value refusing the row that repairs it.
    telefon: str = Field(pattern=PHONE_REGEX)
    einwilligung: FLKontaktEinwilligungPayload


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
    # The two READ models below add one back.
    schulform: FLSchulform | None
    # Rendered straight into an href on a public page, so the scheme is constrained here as well as
    # in the frontend (`app/shared/schemas/custom.py :: validate_external_url`). NULL where a school
    # has no site: `""` renders as a link to the page it sits on.
    website_url: CustomOptionalExternalUrl
    # Public wherever a read serves it: decided 2026-08, Datenschutzexperte consulted. A club's
    # address is a school's street and stays on the base tier, and the application form says so
    # where the address is asked for.
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
    # placing (`docs/backend/spec.md :: I24b`).
    anzahl_ausstehende_spiele: int = Field(ge=0)


class FLGruppen(RootModel[Mapping[FLGruppenNames, list[FLGruppenTeam]]]):
    """The four groups, always all four, in standing order.

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

    # The one model here Pydantic validates a stored document into. The write echoes take these
    # fields with NO default: each is built from keywords, so an absent key is the endpoint's to
    # answer for and a default would echo what no caller wrote.
    trikot_farbe: FLTrikotFarbe | None = None
    kontakte: FLSaisonTeamKontakte | None = None


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
    # Stripped on the WRITE side alone, the read models taking a stored value as it stands: `name` is
    # copied onto the season's junction row and onto every fixture side, so spaces alone would reach
    # a league table row.
    name: CustomStrippedNonEmptyString
    full_name: CustomStrippedNonEmptyString
    # Redeclared for that reason too: the width is a floor as well as a ceiling, and what it holds
    # is the whole of what a league table row names the club by.
    shorthand: Annotated[str, StringConstraints(strip_whitespace=True, min_length=TEAM_SHORTHAND_LENGTH, max_length=TEAM_SHORTHAND_LENGTH)]
    # Stripped on the WRITE side alone, as the three above are: `validate_external_url` leaves
    # surrounding whitespace on the value, so a pasted URL would be stored with it.
    website_url: CustomStrippedOptionalExternalUrl


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
    """The contact block alone, so the editor that owns the people never writes the row's other fields.

    ONE field, `extra="forbid"`: a `gruppe` or an `austritt` sent here is a 422 rather than a value
    this endpoint was never asked to decide.
    """

    model_config = ConfigDict(extra="forbid")

    # Nullable, and required: null CLEARS the block, which is how a team with no recorded contacts is
    # expressed at entry and must stay expressible here.
    kontakte: FLSaisonTeamKontaktePayload | None


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
    """The four groups in standing order, and how many of each advance.

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


class FLPatchSaisonTeamKontakteResponse(BaseAPIResponse):
    """The block as STORED after the write, and the row it was written to.

    No other field off that row: the caller sent none of them, and echoing one would invite a client
    to believe this endpoint owns it.
    """

    saison_id: str
    team_id: CustomObjectId
    kontakte: FLSaisonTeamKontakte | None


class FLReplaceSaisonTeamResponse(BaseAPIResponse):
    """The junction row as the replacement left it, plus what it reached beyond that row.

    Of the three fields a replacement clears, the two that leave a GAP are echoed; `austritt` is
    not, a club that has not withdrawn needing nothing done about it.
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
    # Reported rather than assumed, as `FLPatchTeamResponse` reports its own: this fan-out is the
    # half of the endpoint that fails silently (`docs/backend/spec.md :: I13`).
    fanned_out_to_spiele: int
    # Reported for the same reason, and separately: the outgoing club's squad leaves the season with
    # it, and zero is a real answer -- a club can hold a junction row and no squad at all.
    ausgetragene_squad_rows: int


FLTeamsResponse = Annotated[
    Union[FLTeamsListResponse, FLTeamsGroupedResponse],
    Field(discriminator="format"),
]
