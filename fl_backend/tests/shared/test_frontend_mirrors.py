import math
import re
import string
from itertools import product
from pathlib import Path
from typing import Annotated, Any, Final, NamedTuple, get_args

import pytest
from bson import ObjectId
from pydantic import BaseModel, StringConstraints, TypeAdapter, ValidationError

from app.api.aktionen.schemas import HERKUNFT_JE_KIND
from app.api.bewerbungen import schemas as bewerbungen_schemas
from app.api.saisons.schemas import TeamsPerGroup
from app.api.spiele.schemas import MAX_QUALIFIERS
from app.api.spieler.schemas import FLPostSaisonSpielerPayload
from app.api.teams.schemas import MAX_NUMBER_OF_GROUPS
from app.core.config import INTERNAL_API_KEY_CHARACTERS
from app.core.logging import NEEDS_QUOTING
from app.core.middlewares import TRACEPARENT
from app.core.routing import OBJECT_ID_REGEX
from app.shared.schemas import bounds
from app.shared.schemas.addresses import HAUSNUMMER_PATTERN, FLAddress
from app.shared.schemas.custom import (
    PERSON_NAME_PATTERN,
    PHONE_REGEX,
    SINGLE_LINE_PATTERN,
    CustomErgebnisString,
    CustomObjectId,
    CustomTimeString,
)

REPO_ROOT: Final = Path(__file__).resolve().parents[3]
FRONTEND_SRC: Final = REPO_ROOT / "fl_frontend" / "src"

# What a frontend comment writes when it says a number below it was retyped from this package.
MIRROR_CLAIM: Final = "bounds.py"


class Mirror(NamedTuple):
    module: str
    typescript: str
    python: str


# Declared rather than matched by name: four of these pairs are spelled one way on the frontend and
# another in `bounds.py`, so a sweep keyed on the identifier passes over exactly the pairs whose
# drift nothing else shows.
MIRRORED_BOUNDS: Final = (
    Mirror("shared/schemas.ts", "ADDRESS_STRASSE_MAX_LENGTH", "ADDRESS_STRASSE_MAX_LENGTH"),
    Mirror("shared/schemas.ts", "ADDRESS_STADT_MAX_LENGTH", "ADDRESS_STADT_MAX_LENGTH"),
    Mirror("shared/schemas.ts", "ADDRESS_STADTTEIL_MAX_LENGTH", "ADDRESS_STADTTEIL_MAX_LENGTH"),
    Mirror("shared/schemas.ts", "ADDRESS_HAUSNUMMER_MAX_LENGTH", "ADDRESS_HAUSNUMMER_MAX_LENGTH"),
    Mirror("shared/schemas.ts", "KONTAKT_EMAIL_MAX_LENGTH", "KONTAKT_EMAIL_MAX_LENGTH"),
    Mirror("features/bewerbungen/constants.ts", "BEWERBUNG_GRUND_MAX_LENGTH", "BEWERBUNG_GRUND_MAX_LENGTH"),
    Mirror("features/bewerbungen/constants.ts", "BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH", "BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH"),
    Mirror("features/bewerbungen/constants.ts", "BEWERBUNG_KADER_GROESSE_MAX", "BEWERBUNG_KADER_GROESSE_MAX"),
    Mirror("features/bewerbungen/constants.ts", "BEWERBUNG_STUFENGROESSE_MAX", "BEWERBUNG_STUFENGROESSE_MAX"),
    Mirror("features/bewerbungen/constants.ts", "BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH", "BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH"),
    Mirror("features/bewerbungen/constants.ts", "BEWERBUNG_MIN_ALTER", "BEWERBUNG_KONTAKT_MIN_AGE_YEARS"),
    Mirror("features/bewerbungen/constants.ts", "BEWERBUNG_MAX_ALTER", "BEWERBUNG_KONTAKT_MAX_AGE_YEARS"),
    Mirror("features/bewerbungen/constants.ts", "KUERZEL_LAENGE", "TEAM_SHORTHAND_LENGTH"),
    Mirror("features/bewerbungen/constants.ts", "BEWERBUNG_BESTAETIGUNG_FRIST_TAGE", "BEWERBUNG_BESTAETIGUNG_FRIST_TAGE"),
    Mirror("features/bewerbungen/constants.ts", "BEWERBUNG_ERINNERUNG_TAGE", "BEWERBUNG_ERINNERUNG_TAGE"),
    Mirror("features/teams/constants.ts", "DESCRIPTION_MAX_LENGTH", "TEAM_DESCRIPTION_MAX_LENGTH"),
    Mirror("features/teams/constants.ts", "TEAM_NAME_MAX_LENGTH", "TEAM_NAME_MAX_LENGTH"),
    Mirror("features/teams/constants.ts", "TEAM_FULL_NAME_MAX_LENGTH", "TEAM_FULL_NAME_MAX_LENGTH"),
    Mirror("features/teams/constants.ts", "TEAM_WEBSITE_URL_MAX_LENGTH", "TEAM_WEBSITE_URL_MAX_LENGTH"),
    Mirror("features/teams/constants.ts", "KONTAKT_NAME_MAX_LENGTH", "KONTAKT_NAME_MAX_LENGTH"),
    Mirror("features/teams/constants.ts", "EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH", "EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH"),
    Mirror("features/spiele/constants.ts", "NOTIZ_MAX_LENGTH", "SPIEL_NOTIZ_MAX_LENGTH"),
    Mirror("features/saisons/constants.ts", "SAISON_ID_LENGTH", "SAISON_ID_LENGTH"),
    Mirror("features/bewerbungen/constants.ts", "BEWERBUNG_TOKEN_MAX_LENGTH", "BEWERBUNG_TOKEN_MAX_LENGTH"),
)

# Every integer `bounds.py` declares that no frontend module retypes, with why none does. A bound in
# neither register fails the direction below rather than reading as covered.
UNMIRRORED_BOUNDS: Final[dict[str, str]] = {
    "LIST_LIMIT_DEFAULT": "the page size a read applies for a caller that asks for none",
    "LIST_LIMIT_MAX": "the ceiling on what a caller may ask for; every frontend read sends the size it needs or none",
    "AKTION_RETENTION_SECONDS": "the log index's own `expireAfterSeconds`; no surface counts a row's age",
}

MIRRORED_MODULES: Final = tuple(dict.fromkeys(mirror.module for mirror in MIRRORED_BOUNDS))

INTEGER_EXPORT: Final = re.compile(r"^export const (?P<name>[A-Z][A-Z0-9_]*) = (?P<value>\d+);$", re.MULTILINE)

COMMENT_OPENERS: Final = ("/**", "*/", "*", "//")


def _source(module: str) -> str:
    """One frontend module's text. Source text rather than an import: nothing on this side can load TypeScript."""

    return (FRONTEND_SRC / module).read_text(encoding="utf-8")


def _attributed(source: str, declaration: re.Pattern[str], claim: str) -> set[str]:
    """Every name `declaration` matches whose own comment block names `claim`.

    One reader for the bounds and the patterns alike, so a claim the two directions read differently
    cannot be covered by one and passed over by the other.
    """

    named: set[str] = set()
    block = ""
    was_comment = False
    for line in source.splitlines():
        stripped = line.strip()
        is_comment = stripped.startswith(COMMENT_OPENERS)
        if is_comment:
            # A blank line or a statement ends a block, so a claim never carries down to the next one.
            block = f"{block} {stripped}" if was_comment else stripped
        was_comment = is_comment
        found = declaration.match(line)
        if found is not None and claim in block:
            named.add(found["name"])
    return named


def _claimed_mirrors(source: str) -> set[str]:
    """Every integer this module's own prose claims it mirrors, attributed to the comment block above the line."""

    return _attributed(source, INTEGER_EXPORT, MIRROR_CLAIM)


def _declared_bounds() -> dict[str, int]:
    """Every integer `bounds.py` declares, read off the imported module rather than out of its text."""

    return {name: value for name, value in vars(bounds).items() if name.isupper() and isinstance(value, int)}


def _modules_naming_the_source() -> set[str]:
    """Every non-test frontend module whose prose names `bounds.py`, which is the claim this register has to cover."""

    return {
        path.relative_to(FRONTEND_SRC).as_posix()
        for path in FRONTEND_SRC.rglob("*.ts*")
        if not path.name.endswith((".test.ts", ".test.tsx"))
        if MIRROR_CLAIM in path.read_text(encoding="utf-8")
    }


@pytest.mark.parametrize("mirror", MIRRORED_BOUNDS, ids=lambda mirror: f"{mirror.python}->{mirror.typescript}")
def test_every_declared_pair_names_a_bound_this_package_still_declares(mirror: Mirror):
    assert mirror.python in _declared_bounds(), f"{mirror.python} is declared nowhere in bounds.py, so its mirror is compared to nothing"


@pytest.mark.parametrize("mirror", MIRRORED_BOUNDS, ids=lambda mirror: f"{mirror.python}->{mirror.typescript}")
def test_every_declared_pair_agrees_on_the_number(mirror: Mirror):
    """Past the backend's ceiling the API answers a bare `REQ-VAL-001` carrying no field detail, so a looser mirror marks no box."""

    found = re.search(rf"^export const {mirror.typescript} = (\d+);$", _source(mirror.module), re.MULTILINE)

    assert found is not None, f"{mirror.module} no longer exports {mirror.typescript} as a bare integer"
    assert int(found[1]) == _declared_bounds()[mirror.python], f"{mirror.typescript} disagrees with {mirror.python}"


def test_every_bound_this_package_declares_is_paired_or_named_unmirrored():
    """The direction that starts from `bounds.py`.

    Both cases below start from what the frontend claims, so a bound it never names is compared by
    nothing and reads as covered.
    """

    declared = set(_declared_bounds())
    paired = {mirror.python for mirror in MIRRORED_BOUNDS}
    named = set(UNMIRRORED_BOUNDS)

    assert declared, "no integer was read off bounds.py, so this case passes over nothing"
    assert not paired & named, f"{sorted(paired & named)} is both paired with a mirror and named as retyped nowhere"
    assert declared == paired | named


def test_every_module_claiming_a_mirror_is_one_this_register_covers():
    """The other direction: a fifth module retyping a bound would otherwise be compared by nothing and read as covered."""

    assert _modules_naming_the_source() == set(MIRRORED_MODULES)


@pytest.mark.parametrize("module", MIRRORED_MODULES)
def test_every_constant_a_module_says_it_mirrors_is_declared_here(module: str):
    """Anti-vacuity as well as coverage: a reader that stopped attributing claims would return an empty set and pass silently."""

    claimed = _claimed_mirrors(_source(module))
    declared = {mirror.typescript for mirror in MIRRORED_BOUNDS if mirror.module == module}

    assert claimed, f"{module} names {MIRROR_CLAIM} and no claim was attributed to any constant in it"
    assert claimed <= declared, f"{module} claims {sorted(claimed - declared)}, which this register does not pair with anything"


class ModelBound(NamedTuple):
    module: str
    typescript: str
    model: type[BaseModel]
    field: str


# The ceilings the delivery-event endpoint states at its own fields rather than in `bounds.py`, one
# field stating each. Read off the model's metadata, so a constraint respelled there still pairs.
MIRRORED_MODEL_BOUNDS: Final = (
    ModelBound(
        "features/bewerbungen/schemas.ts",
        "ZUSTELLUNG_GRUND_MAX_LENGTH",
        bewerbungen_schemas.FLBewerbungZustellungEreignisPayload,
        "grund",
    ),
    ModelBound(
        "features/bewerbungen/schemas.ts",
        "ZUSTELLUNG_NACHRICHT_ID_MAX_LENGTH",
        bewerbungen_schemas.FLBewerbungZustellungEreignisPayload,
        "nachricht_id",
    ),
    ModelBound(
        "features/bewerbungen/schemas.ts",
        "ZUSTELLUNG_ZEITPUNKT_MAX_LENGTH",
        bewerbungen_schemas.FLBewerbungZustellungEreignisPayload,
        "am",
    ),
)


def _model_max_length(model: type[BaseModel], field: str) -> int:
    """Off the model rather than its text: a ceiling respelled still pairs, and one dropped fails rather than reading as covered."""

    stated = [
        constraint.max_length
        for constraint in model.model_fields[field].metadata
        if isinstance(constraint, StringConstraints) and constraint.max_length is not None
    ]

    assert len(stated) == 1, f"{model.__name__}.{field} states {len(stated)} ceilings, so no one number pairs with the frontend's"

    return stated[0]


@pytest.mark.parametrize("mirror", MIRRORED_MODEL_BOUNDS, ids=lambda mirror: f"{mirror.model.__name__}.{mirror.field}->{mirror.module}")
def test_every_model_bound_agrees_with_its_frontend_constant(mirror: ModelBound):
    """The webhook fills these from a provider's envelope, and its route answers a 422 with 200, so a looser mirror loses the event."""

    found = re.search(rf"^(?:export )?const {mirror.typescript} = (\d+);$", _source(mirror.module), re.MULTILINE)

    assert found is not None, f"{mirror.module} no longer spells {mirror.typescript} as a bare integer"
    assert int(found[1]) == _model_max_length(mirror.model, mirror.field), f"{mirror.typescript} disagrees with {mirror.field}'s ceiling"


def test_every_ceiling_the_event_payload_states_is_paired_here():
    """The other direction, off the model's own field list: a fourth ceiling would otherwise be mirrored by nothing and read as covered."""

    payload = bewerbungen_schemas.FLBewerbungZustellungEreignisPayload
    bounded = {
        name
        for name, field in payload.model_fields.items()
        if any(isinstance(constraint, StringConstraints) and constraint.max_length is not None for constraint in field.metadata)
    }

    assert bounded == {mirror.field for mirror in MIRRORED_MODEL_BOUNDS if mirror.model is payload}


class ShapeBound(NamedTuple):
    module: str
    typescript: str
    python: str
    value: int


def _alias_bound(alias: Any, name: str, attribute: str) -> int:
    """`_alias_pattern`'s reading for a numeric constraint, so a bound respelled at the alias still pairs and one dropped fails."""

    stated = [
        getattr(constraint, attribute)
        for part in get_args(alias)[1:]
        for constraint in (part, *getattr(part, "metadata", ()))
        if getattr(constraint, attribute, None) is not None
    ]

    assert len(stated) == 1, f"{name} states {len(stated)} {attribute} bounds, so no one number pairs with the frontend's"

    return stated[0]


# The season form's own numbers, which this package fixes at a field rather than in `bounds.py`:
# `MIRRORED_BOUNDS` cannot hold them, its own case holding every pair to a name that module declares.
MIRRORED_SHAPE_BOUNDS: Final = (
    ShapeBound(
        "features/saisons/shapeOffer.ts",
        "MIN_TEAMS_PER_GROUP",
        "app/api/saisons/schemas.py :: TeamsPerGroup",
        _alias_bound(TeamsPerGroup, "TeamsPerGroup", "ge"),
    ),
    ShapeBound(
        "features/saisons/shapeOffer.ts",
        "MAX_TEAMS_PER_GROUP",
        "app/api/saisons/schemas.py :: TeamsPerGroup",
        _alias_bound(TeamsPerGroup, "TeamsPerGroup", "le"),
    ),
)

# The closed set as the frontend spells it, and the phase list its bracket ceiling counts. One reader
# for both, `as const` and `z.enum` alike: what fixes the literal read is the name beside it.
GRUPPEN_SET: Final = ("features/teams/constants.ts", "GRUPPEN_OPTIONS")

PHASE_SET: Final = ("features/saisons/schemas.ts", "FLSaisonPhaseSchema")

# The one text the ceiling is spelled as. Nothing here evaluates TypeScript, so a respelled
# derivation fails the case below rather than leaving its arithmetic modelling the wrong expression.
QUALIFIER_CEILING: Final = ("features/saisons/schemas.ts", "MAX_QUALIFIERS", "2 ** (FLSaisonPhaseSchema.options.length - 1)")

STRING_MEMBER: Final = re.compile(r'"([^"]+)"')


def _declared_members(module: str, name: str) -> tuple[str, ...]:
    """One frontend list literal's members. A member this reader cannot see fails a case below rather than dropping quietly out of it."""

    found = re.search(rf"^export const {name} = (?:z\.enum\()?\[(?P<members>[^\]]*)\]", _source(module), re.MULTILINE)

    assert found is not None, f"{module} no longer opens {name} as one list literal on one line"

    return tuple(STRING_MEMBER.findall(found["members"]))


@pytest.mark.parametrize("bound", MIRRORED_SHAPE_BOUNDS, ids=lambda bound: f"{bound.python}->{bound.typescript}")
def test_every_shape_bound_agrees_with_the_declaration_that_fixes_it(bound: ShapeBound):
    """A looser mirror opens a team count the save refuses, and a tighter one hides one the save takes."""

    found = re.search(rf"^export const {bound.typescript} = (\d+);$", _source(bound.module), re.MULTILINE)

    assert found is not None, f"{bound.module} no longer exports {bound.typescript} as a bare integer"
    assert int(found[1]) == bound.value, f"{bound.typescript} disagrees with {bound.python}"


def test_the_group_offer_holds_as_many_names_as_this_package_caps_a_season_at():
    """The frontend reads its own cap off this set's length, where this package derives the same number from the closed `Literal`."""

    module, name = GRUPPEN_SET
    offered = _declared_members(module, name)

    assert len(offered) == MAX_NUMBER_OF_GROUPS, (
        f"{name} holds {len(offered)} names, where this package caps a season at {MAX_NUMBER_OF_GROUPS}"
    )


def test_the_bracket_ceiling_the_offer_opens_is_the_one_this_package_caps_a_season_at():
    """Both ends derive it from their own phase list, so the pair parts when either derivation moves rather than when the lists do."""

    module, name, spelling = QUALIFIER_CEILING

    assert f"export const {name} = {spelling};" in _source(module), f"{name} is no longer spelled `{spelling}`, which is the arithmetic below"

    phases = _declared_members(*PHASE_SET)

    assert phases, f"{PHASE_SET[1]} names no phase, so the ceiling derived from it below rests on nothing"
    assert 2 ** (len(phases) - 1) == MAX_QUALIFIERS, (
        f"{name} opens a bracket of {2 ** (len(phases) - 1)}, where this package caps one at {MAX_QUALIFIERS}"
    )


# The frontend's copy of the kind-to-origin mapping. `Record<FLAktor["kind"], AktionHerkunft>` refuses
# a kind nobody places and takes a row moved to another origin, so only a comparison holds the two
# ends to one origin per kind.
KIND_ORIGINS: Final = ("features/aktionen/constants.ts", "AKTOR_HERKUNFT")

OBJECT_ROW: Final = re.compile(r'^ +(?P<key>[a-z_]+): "(?P<value>[a-z_]+)",$', re.MULTILINE)

# The literal's close, matched on the brace alone: `as const` or a `.parse()` after it would otherwise
# carry the read into the next literal, whose rows this one would take for its own.
OBJECT_CLOSE: Final = re.compile(r"^\}", re.MULTILINE)


def _object_literal(module: str, name: str) -> dict[str, str]:
    """One frontend object literal's string rows.

    A row this reader cannot see is one the comparison below fails on rather than one that drops
    quietly out of it.
    """

    source = _source(module)
    opens = re.search(rf"^export const {name}[^=]*= \{{$", source, re.MULTILINE)

    assert opens is not None, f"{module} no longer opens {name} as an object literal on one line"

    closes = OBJECT_CLOSE.search(source, opens.end())

    assert closes is not None, f"{module} no longer closes {name} at the start of a line"

    return {row["key"]: row["value"] for row in OBJECT_ROW.finditer(source[opens.end() : closes.start()])}


def test_the_log_files_every_actor_kind_under_the_origin_this_package_files_it_under():
    """A disagreement answers a told count with an empty table.

    The filter narrows the read on this package's mapping, and the page filters the rows it served on
    the frontend's (`fl_frontend/src/shared/utils/facets.ts :: applyFacets`).
    """

    module, name = KIND_ORIGINS
    filed = _object_literal(module, name)

    assert filed, f"{module} no longer spells {name} as one origin per row, so this case compares nothing"
    assert filed == dict(HERKUNFT_JE_KIND), f"{name} files {sorted(filed.items())}, where this package files {sorted(HERKUNFT_JE_KIND.items())}"


class Pattern(NamedTuple):
    module: str
    typescript: str
    python: str
    source: str
    # Values the composed corpus cannot reach: it changes an accepted string by one character, so a
    # drift shortening or lengthening a match by more than that is graded over nothing.
    probes: tuple[str, ...] = ()


def _field_pattern(model: type[BaseModel], field: str) -> str:
    """Off the model rather than its text, so an alphabet respelled at the field still pairs and one dropped fails.

    `Field(pattern=...)` and `StringConstraints(pattern=...)` land in `metadata` alike, neither
    reaching the annotation.
    """

    stated = [constraint.pattern for constraint in model.model_fields[field].metadata if getattr(constraint, "pattern", None) is not None]

    assert len(stated) == 1, f"{model.__name__}.{field} states {len(stated)} patterns, so no one alphabet pairs with the frontend's"

    return stated[0]


def _alias_pattern(alias: Any, name: str) -> str:
    """`_field_pattern`'s reading for an `Annotated` alias, whose constraint the fields carrying it never restate."""

    stated = [part.pattern for part in get_args(alias)[1:] if getattr(part, "pattern", None) is not None]

    assert len(stated) == 1, f"{name} states {len(stated)} patterns, so no one alphabet pairs with the frontend's"

    return stated[0]


# The scoreline rule, which this package spells once and the frontend twice: the parser's copy carries
# the groups it reads the two numbers out of, and both copies are paired with this one below.
ERGEBNIS_RULE: Final = _alias_pattern(CustomErgebnisString, "CustomErgebnisString")

# Read off the alias rather than off `TIME_REGEX`, so a rule respelled at `CustomTimeString` keeps
# this pair standing rather than leaving it comparing a constant nothing applies.
TIME_RULE: Final = _alias_pattern(CustomTimeString, "CustomTimeString")

# Every hand-mirrored pattern this comparison reaches, `UNPAIRABLE_PATTERNS` below holding the rest.
# `fl_frontend/src/core/apiContract.test.ts :: FieldFacts` leaves patterns out of the contract
# comparison by design, so nothing else pairs these ends at all.
MIRRORED_PATTERNS: Final = (
    Pattern("shared/schemas.ts", "PHONE_REGEX", "app/shared/schemas/custom.py :: PHONE_REGEX", PHONE_REGEX),
    Pattern("shared/schemas.ts", "HAUSNUMMER_REGEX", "app/shared/schemas/addresses.py :: HAUSNUMMER_PATTERN", HAUSNUMMER_PATTERN),
    Pattern(
        "shared/schemas.ts",
        "TIME_REGEX",
        "app/shared/schemas/custom.py :: CustomTimeString",
        TIME_RULE,
        # The two values `fl_frontend/src/shared/schemas.ts :: CustomTimeStringSchema` names as why it
        # spells a regular expression rather than taking `z.iso.time()`.
        ("14:30", "14:30:00.5"),
    ),
    # Two pairs spelling one class two ways: a JavaScript `\d` is `[0-9]`, where the Rust engine's takes
    # every Unicode decimal digit, so each agrees only because the backend spells the range.
    Pattern("shared/schemas.ts", "PLZ_REGEX", "app/shared/schemas/addresses.py :: FLAddress", _field_pattern(FLAddress, "plz")),
    Pattern(
        "features/spieler/schemas.ts",
        "SQUAD_NUMMER_REGEX",
        "app/api/spieler/schemas.py :: SQUAD_NUMMER_PATTERN",
        _field_pattern(FLPostSaisonSpielerPayload, "nummer"),
    ),
    Pattern("features/spiele/schemas.ts", "ERGEBNIS_REGEX", "app/shared/schemas/custom.py :: CustomErgebnisString", ERGEBNIS_RULE),
    Pattern("features/spiele/utils.ts", "ERGEBNIS_PATTERN", "app/shared/schemas/custom.py :: CustomErgebnisString", ERGEBNIS_RULE),
)


class Unpairable(NamedTuple):
    module: str
    typescript: str
    python: str
    reason: str


# The hand-mirrored patterns the comparison above cannot reach, each with what puts it out of reach.
# A case below holds every entry to what CAN be compared, so an entry here narrows a check rather
# than dropping one.
UNPAIRABLE_PATTERNS: Final = (
    Unpairable(
        "shared/schemas.ts",
        "PERSON_NAME_REGEX",
        "app/shared/schemas/custom.py :: PERSON_NAME_PATTERN",
        r"`\p{L}` is a Unicode property class `re` cannot compile, and `re` is the only engine `_javascript_accepted` has",
    ),
    Unpairable(
        "shared/schemas.ts",
        "OBJECT_ID_REGEX",
        "app/shared/schemas/custom.py :: CustomObjectIdAnnotation",
        "the backend end builds a `bson.ObjectId` rather than stating a pattern, so no pattern string reaches `_pydantic_accepted`",
    ),
    Unpairable(
        "features/bewerbungen/zustellung.ts",
        "EINZEILIG",
        "app/shared/schemas/custom.py :: SINGLE_LINE_PATTERN",
        "`MODELLED_ESCAPES` covers no codepoint escape, and every spelling of this class is written as codepoint escapes",
    ),
    Unpairable(
        "features/bewerbungen/schemas.ts",
        "NICHT_EINZEILIG",
        "app/shared/schemas/custom.py :: SINGLE_LINE_PATTERN",
        "the same codepoint escapes, and this spelling is the class NEGATED: the form refuses the value it matches",
    ),
    Unpairable(
        "core/logFormat.ts",
        "NEEDS_QUOTING",
        "app/core/logging.py :: NEEDS_QUOTING",
        "codepoint escapes again, and neither end is anchored: both SEARCH a value where the comparison above full-matches one",
    ),
    Unpairable(
        "core/trace.ts",
        "TRACEPARENT",
        "app/core/middlewares.py :: TRACEPARENT",
        r"the backend end anchors with `\A` and `\Z`, which the Rust engine `_pydantic_accepted` grades through cannot compile",
    ),
    Unpairable(
        "core/config.ts",
        "INTERNAL_API_KEY",
        "app/core/config.py :: INTERNAL_API_KEY_CHARACTERS",
        "the frontend end is a literal inside a `z.string()` chain rather than the named constant `_typescript_pattern` reads",
    ),
)

# The third site of the ObjectId alphabet, and the only one on this side stating it AS a pattern.
ROUTE_ID_SITE: Final = "app/core/routing.py :: OBJECT_ID_REGEX"

# Only running it says what an id is: `CustomObjectIdAnnotation` states no pattern.
OBJECT_ID_ADAPTER: Final = TypeAdapter(CustomObjectId)

# The constructs this check models. `\s`, `\w` and their negations are refused rather than
# translated: the two engines disagree about what they hold, and `\s` is what the last divergence
# in the telephone pair was made of.
MODELLED_ESCAPES: Final = frozenset("d-.\\()[]{}+*?^$|/")

# A decimal digit outside ASCII, probed because `\d` holds it in Rust's engine and not in JavaScript's:
# a pair spelling one class two ways agrees on every ASCII probe and parts here.
NON_ASCII_DIGIT: Final = "٥"

# Probed alongside every character the two spellings mention, because a divergence over a character
# neither one names is one no derived alphabet would reach.
PROBE_CONTROLS: Final = frozenset({"\n", "\r", "\t", " ", "é", "z", "5", NON_ASCII_DIGIT})

# Runs standing on both sides of every repetition bound the pairs above state, the exhaustive short
# probes reaching neither side of a long one; a bound that outgrows them is refused by
# `test_the_probe_runs_reach_past_every_bound_the_declared_patterns_state`.
PROBE_LENGTHS: Final = (4, 5, 19, 20, 21)

ALPHANUMERIC_RANGE: Final = re.compile(r"([0-9A-Za-z])-([0-9A-Za-z])")

REPETITION_BOUND: Final = re.compile(r"\{(\d+)(?:,(\d+))?\}")


def _typescript_pattern(module: str, name: str) -> tuple[str, str]:
    """One regular-expression literal as the frontend spells it, with its flags — a flag changes meaning and is compared too."""

    found = re.search(rf"^(?:export )?const {name} = (?:new RegExp\()?/(?P<source>.+?)/(?P<flags>[a-z]*)\)?;$", _source(module), re.MULTILINE)

    assert found is not None, f"{module} no longer spells {name} as one regular-expression literal on one line"

    return found["source"], found["flags"]


def _probe_alphabet(*patterns: str) -> list[str]:
    """Every character either spelling mentions, ranges expanded, plus the controls neither one names."""

    characters = set(PROBE_CONTROLS)
    for pattern in patterns:
        characters.update(pattern)
        for start, end in ALPHANUMERIC_RANGE.findall(pattern):
            characters.update(chr(point) for point in range(ord(start), ord(end) + 1))
    return sorted(characters)


# The composed corpus is exhaustive over a pattern's own language or it is not built at all: a
# partial one would call two ends equal over values neither of them reaches. A larger language is
# refused rather than sampled.
COMPOSED_LANGUAGE_MAX: Final = 200_000

# What ends the composable grammar outside a character class. Each is a quantifier, a wildcard or an
# escape introducer, and a composition guessing at one would enumerate a language neither engine has.
UNCOMPOSABLE_CONSTRUCTS: Final = frozenset(".*+?{}\\")


def _class_members(body: str) -> set[str] | None:
    """One character class as the characters it names, or `None` where this grammar cannot read it.

    A backslash is refused rather than translated, for `MODELLED_ESCAPES`'s reason: the two engines
    disagree about what a class escape holds.
    """

    if not body or body.startswith("^") or "\\" in body:
        return None

    members: set[str] = set()
    at = 0
    while at < len(body):
        if at + 2 < len(body) and body[at + 1] == "-":
            start, end = ord(body[at]), ord(body[at + 2])
            if end < start:
                return None
            members.update(chr(point) for point in range(start, end + 1))
            at += 3
        else:
            members.add(body[at])
            at += 1

    return members


def _fragments(body: str) -> tuple[tuple[str, ...], ...] | None:
    """A pattern body as the run of segments it concatenates, each the strings it contributes, or `None` outside this grammar."""

    segments: list[tuple[str, ...]] = []
    at = 0
    while at < len(body):
        character = body[at]
        if character in UNCOMPOSABLE_CONSTRUCTS or character in "^$)]|":
            return None
        if character == "[":
            closes = body.find("]", at)
            members = None if closes == -1 else _class_members(body[at + 1 : closes])
            if members is None:
                return None
            segments.append(tuple(sorted(members)))
            at = closes + 1
        elif character == "(":
            closes = body.find(")", at)
            if closes == -1 or "(" in body[at + 1 : closes]:
                return None
            branches: list[tuple[tuple[str, ...], ...]] = []
            for branch in body[at + 1 : closes].split("|"):
                parts = _fragments(branch)
                if parts is None:
                    return None
                branches.append(parts)
            segments.append(tuple(sorted({"".join(run) for parts in branches for run in product(*parts)})))
            at = closes + 1
        else:
            segments.append((character,))
            at += 1

    return tuple(segments)


def _segment_baselines(segments: tuple[tuple[str, ...], ...]) -> list[str]:
    """One accepted value per fragment of every segment, the rest at their first: what a change does can depend on the branch it stands in."""

    first = [segment[0] for segment in segments]
    baselines = {"".join(first)}
    for at, segment in enumerate(segments):
        baselines.update("".join([*first[:at], fragment, *first[at + 1 :]]) for fragment in segment)

    return sorted(baselines)


def _one_character_changes(value: str, alphabet: list[str]) -> set[str]:
    """Every substitution, insertion and deletion of one character: a class widened by one, a segment made optional, a tail admitted."""

    changed = {value[:at] + value[at + 1 :] for at in range(len(value))}
    changed.update(value[:at] + character + value[at + 1 :] for at in range(len(value)) for character in alphabet)
    changed.update(value[:before] + character + value[before:] for before in range(len(value) + 1) for character in alphabet)

    return changed


def _composed_probes(*patterns: str) -> list[str]:
    """Values composed FROM the patterns' own text, with every one-character change to them.

    Every other probe here is short or one character repeated, so the time pair would be graded over
    a corpus it accepts nothing in.
    """

    alphabet = _probe_alphabet(*patterns)
    composed: set[str] = set()
    for pattern in patterns:
        segments = _fragments(pattern[1:-1]) if pattern.startswith("^") and pattern.endswith("$") else None
        if segments is None:
            continue

        assert math.prod(len(segment) for segment in segments) <= COMPOSED_LANGUAGE_MAX, (
            f"{pattern} composes past {COMPOSED_LANGUAGE_MAX} values, so no corpus below reaches its whole language"
        )

        composed.update("".join(run) for run in product(*segments))
        for baseline in _segment_baselines(segments):
            composed.update(_one_character_changes(baseline, alphabet))

    return sorted(composed)


def _pydantic_accepted(pattern: str, probes: list[str]) -> set[str]:
    r"""The BACKEND spelling, graded through pydantic as the API grades it: Rust's engine, where `\d` is every Unicode decimal digit."""

    adapter = TypeAdapter(Annotated[str, StringConstraints(pattern=pattern)])
    accepted: set[str] = set()
    for probe in probes:
        try:
            adapter.validate_python(probe)
        except ValidationError:
            continue
        accepted.add(probe)

    return accepted


def _javascript_accepted(pattern: str, probes: list[str]) -> set[str]:
    r"""The FRONTEND spelling, graded as JavaScript reads it.

    `re.ASCII` for its `\d`, and `fullmatch` because JavaScript's `$` is the end of the input where
    Python's also stands before a final newline.
    """

    compiled = re.compile(pattern, re.ASCII)

    return {probe for probe in probes if compiled.fullmatch(probe) is not None}


@pytest.mark.parametrize("pattern", MIRRORED_PATTERNS, ids=lambda pattern: pattern.typescript)
def test_each_declared_pattern_uses_only_the_constructs_this_check_models(pattern: Pattern):
    """A refusal rather than a silent pass: a construct outside the vocabulary is one the probe below would model wrongly."""

    typescript, flags = _typescript_pattern(pattern.module, pattern.typescript)

    assert flags == "", f"{pattern.typescript} carries the flags '{flags}', which this comparison does not model"
    # Both anchors, because `.test()` and `.match()` SEARCH: an unanchored frontend spelling accepts a
    # value with the scoreline buried in it, and the full match below would call the two ends equal.
    assert typescript.startswith("^") and typescript.endswith("$"), (
        f"{pattern.typescript} is unanchored, which the full match below models as anchored"
    )
    for spelling in (pattern.source, typescript):
        escapes = {spelling[at + 1] for at, character in enumerate(spelling[:-1]) if character == "\\"}
        assert escapes <= MODELLED_ESCAPES, f"{sorted(escapes - MODELLED_ESCAPES)} in {spelling} is outside this check's vocabulary"
        assert "(?" not in spelling, f"{spelling} carries a group modifier this check does not model"


@pytest.mark.parametrize("pattern", MIRRORED_PATTERNS, ids=lambda pattern: pattern.typescript)
def test_the_probe_runs_reach_past_every_bound_the_declared_patterns_state(pattern: Pattern):
    """A refusal like the one above: a bound raised past the longest run leaves the pair agreeing on every probe short of it."""

    typescript, _ = _typescript_pattern(pattern.module, pattern.typescript)
    stated = {
        int(bound) for spelling in (pattern.source, typescript) for group in REPETITION_BOUND.findall(spelling) for bound in group if bound
    }

    assert not stated or max(PROBE_LENGTHS) > max(stated), (
        f"{pattern.typescript} states {max(stated)}, past the longest run probed at {max(PROBE_LENGTHS)}"
    )


@pytest.mark.parametrize("pattern", MIRRORED_PATTERNS, ids=lambda pattern: pattern.typescript)
def test_each_declared_pattern_pair_accepts_the_same_values(pattern: Pattern):
    """Compared by what they accept and not as text: the two ends are equivalent today in spellings that differ."""

    typescript, _ = _typescript_pattern(pattern.module, pattern.typescript)
    alphabet = _probe_alphabet(pattern.source, typescript)
    probes = ["".join(run) for length in range(4) for run in product(alphabet, repeat=length)]
    probes += [character * length for character in alphabet for length in PROBE_LENGTHS]
    probes += _composed_probes(pattern.source, typescript)
    probes += list(pattern.probes)

    accepted = _pydantic_accepted(pattern.source, probes)

    assert accepted, f"{pattern.python} accepts none of {len(probes)} probes, so agreeing with it proves nothing"
    assert len(accepted) < len(probes), f"{pattern.python} accepts every probe, so agreeing with it proves nothing"
    assert accepted == _javascript_accepted(typescript, probes), f"{pattern.typescript} and {pattern.python} accept different values"


def test_every_named_probe_stands_outside_the_composed_corpus_and_is_refused_at_both_ends():
    """Both directions: a probe the corpus already reaches adds nothing, and one either end accepts today is not the drift its row names."""

    named = [(pattern, probe) for pattern in MIRRORED_PATTERNS for probe in pattern.probes]

    assert named, "no pair names a probe, so this case is checked against nothing"

    for pattern, probe in named:
        typescript, _ = _typescript_pattern(pattern.module, pattern.typescript)

        assert probe not in set(_composed_probes(pattern.source, typescript)), (
            f"{pattern.typescript} names {probe!r}, which the composed corpus reaches on its own"
        )
        assert not _pydantic_accepted(pattern.source, [probe]), f"{pattern.python} accepts {probe!r}, so no drift toward it parts the two ends"
        assert not _javascript_accepted(typescript, [probe]), f"{pattern.typescript} accepts {probe!r}, where {pattern.python} refuses it"


def _unpairable(name: str) -> Unpairable:
    """The record standing behind one frontend spelling: a case whose entry left fails here rather than holding a pattern nothing records."""

    found = [record for record in UNPAIRABLE_PATTERNS if record.typescript == name]

    assert len(found) == 1, f"{name} is recorded {len(found)} times as unpairable, so no one reason stands beside it"

    return found[0]


def test_the_name_rule_is_spelled_one_way_at_both_tiers_and_still_grades_letters():
    r"""Compared as TEXT, which no other pair here is, so the flag check is what makes the comparison mean anything.

    Without `u` a JavaScript `\p{L}` is the letter `p`, and the two identical spellings would accept different values.
    """

    record = _unpairable("PERSON_NAME_REGEX")
    typescript, flags = _typescript_pattern(record.module, record.typescript)

    assert flags == "u", rf"{record.typescript} carries the flags '{flags}', and `\p{{L}}` is a property class under 'u' alone"
    assert typescript == PERSON_NAME_PATTERN, f"{record.typescript} spells {typescript}, where {record.python} spells {PERSON_NAME_PATTERN}"

    # An umlaut for the alphabet an ASCII rule would refuse, a digit and a symbol for what a name
    # field keeps out, and a leading space and the empty string for the class the rule opens with.
    probes = ["Körner", "Ada", "O'Neill", "Jean-Luc", "Anna Lena", "R2", "Ada!", " Ada", ""]
    accepted = _pydantic_accepted(PERSON_NAME_PATTERN, probes)

    assert accepted == {"Körner", "Ada", "O'Neill", "Jean-Luc", "Anna Lena"}, f"{record.python} accepts {sorted(accepted)} of {probes}"


def test_every_id_the_frontend_class_takes_is_one_this_package_builds_and_serves_back():
    """One direction: an id the class takes has to reach the API and come back in a spelling the class takes again.

    An id served back that the class refuses fails a whole list's parse rather than one row.
    """

    record = _unpairable("OBJECT_ID_REGEX")
    typescript, flags = _typescript_pattern(record.module, record.typescript)

    assert flags == "", f"{record.typescript} carries the flags '{flags}', which this comparison does not model"

    # A served id and its upper-case spelling, then the three near misses: one character short, one
    # long, and one outside the alphabet.
    probes = [
        "0123456789abcdef01234567",
        "0123456789ABCDEF01234567",
        "0123456789abcdef0123456",
        "0123456789abcdef012345678",
        "0123456789abcdef0123456g",
    ]
    taken = _javascript_accepted(typescript, probes)

    assert taken, f"{record.typescript} accepts none of {probes}, so agreeing with it proves nothing"
    assert len(taken) < len(probes), f"{record.typescript} accepts every one of {probes}, so agreeing with it proves nothing"

    for value in sorted(taken):
        try:
            stored = OBJECT_ID_ADAPTER.validate_python(value)
        except ValidationError:
            pytest.fail(f"{record.typescript} takes {value}, which {record.python} refuses")

        assert _javascript_accepted(typescript, [str(stored)]), f"{record.python} stores {value} as {stored}, which {record.typescript} refuses"


# A well-formed id carrying one ASCII whitespace character twice, once per character `bytes.fromhex`
# skips. Composed from `string.whitespace` rather than retyped from
# `fl_backend/tests/shared/test_custom.py`, so the two cases reach the same six by two routes.
IDS_BSON_DECODES_SHORT: Final = tuple(f"6890a1b2{character}c3d4e5f6{character}071829" for character in string.whitespace)


def test_every_id_this_package_takes_is_one_the_frontend_class_takes():
    """The fold in `CustomObjectIdAnnotation` is what closes this direction.

    bson keeps each of these as the eleven-byte id `bytes.fromhex` decoded, so a loosened fold stores
    an id nobody sent and serves back one the class refuses.
    """

    record = _unpairable("OBJECT_ID_REGEX")
    typescript, _ = _typescript_pattern(record.module, record.typescript)

    # Both halves of the premise: a probe of another width would be refused for its width at either
    # end, and one bson itself refuses would say nothing about the fold.
    for probe in IDS_BSON_DECODES_SHORT:
        assert len(probe) == 24, f"{probe!r} is not the width an id is, so refusing it says nothing about the alphabet"
        assert ObjectId.is_valid(probe), f"bson refuses {probe!r}, so this package refusing it is not the fold's doing"

    # A served id, its upper-case spelling, and one character outside the alphabet: the last is what
    # no fold can make this package take, so the comparison below fails ahead of the guard over it.
    probes = [*IDS_BSON_DECODES_SHORT, "6890a1b2c3d4e5f607182930", "6890A1B2C3D4E5F607182930", "6890a1b2c3d4e5f60718293g"]
    taken: set[str] = set()
    for probe in probes:
        try:
            OBJECT_ID_ADAPTER.validate_python(probe)
        except ValidationError:
            continue
        taken.add(probe)

    class_takes = _javascript_accepted(typescript, probes)

    assert taken, f"{record.python} takes none of {len(probes)} probes, so agreeing with it proves nothing"
    assert len(taken) < len(probes), f"{record.python} takes every probe, so agreeing with it proves nothing"
    assert taken <= class_takes, f"{record.python} takes {sorted(taken - class_takes)}, which {record.typescript} refuses"


def test_the_route_convertor_states_the_alphabet_the_frontend_class_states():
    """A widened spelling routes a malformed id to the handler, which answers 422 where the path contract is a 404.

    (`docs/backend/spec.md :: "A malformed id: 404 in a path, 422 in a query"`)
    """

    record = _unpairable("OBJECT_ID_REGEX")
    typescript, flags = _typescript_pattern(record.module, record.typescript)

    assert flags == "", f"{record.typescript} carries the flags '{flags}', which this comparison does not model"
    # Compared as text: Starlette compiles this into the route's own expression, so nothing here can
    # hand it a value; the anchors are the whole path's, which is why the convertor's spelling carries none.
    assert typescript == f"^{OBJECT_ID_REGEX}$", f"{record.typescript} spells {typescript}, where {ROUTE_ID_SITE} states {OBJECT_ID_REGEX}"


def test_the_backend_grader_reads_a_digit_class_the_way_production_does():
    r"""Neither half of this reaches a `\d` on the Python side alone.

    `re.ASCII` would grade both ends as JavaScript, and an ASCII-only corpus would find them equal
    whichever engine read them.
    """

    probes = [NON_ASCII_DIGIT * 5]

    assert _pydantic_accepted(r"^\d{5}$", probes) == set(probes)
    assert _javascript_accepted(r"^\d{5}$", probes) == set()


# Both frontend spellings of `SINGLE_LINE_PATTERN`, and what each MATCHES: the value a screen takes,
# or the character that makes a form refuse. Declared rather than read off the anchors, which a
# negated class carrying them would fool.
SINGLE_LINE_SCREEN: Final = (("EINZEILIG", True), ("NICHT_EINZEILIG", False))

# `m` is the flag that would change what this class accepts, `$` then standing at every line break --
# which is the whole rule. Neither `u` nor the bare spelling moves a BMP-only class.
SINGLE_LINE_FLAGS: Final = ("", "u")

CODEPOINT_ESCAPE: Final = re.compile(r"\\(?:x(?P<narrow>[0-9A-Fa-f]{2})|u(?P<wide>[0-9A-Fa-f]{4})|(?P<named>[nrtvf0]))")

NAMED_ESCAPE: Final = {"n": "\n", "r": "\r", "t": "\t", "v": "\v", "f": "\f", "0": "\0"}


def _spelled_codepoints(pattern: str) -> set[str]:
    """Every codepoint the pattern SPELLS as an escape, decoded to the character itself.

    The class names U+2028 and carries none, so an alphabet built from the characters present would
    never probe the ones at issue.
    """

    spelled: set[str] = set()
    for found in CODEPOINT_ESCAPE.finditer(pattern):
        narrow, wide, named = found["narrow"], found["wide"], found["named"]
        spelled.add(chr(int(narrow or wide, 16)) if named is None else NAMED_ESCAPE[named])

    return spelled


@pytest.mark.parametrize(("name", "matches_a_legal_value"), SINGLE_LINE_SCREEN)
def test_each_frontend_copy_refuses_the_single_line_class_the_endpoint_refuses(name: str, matches_a_legal_value: bool):
    """A copy admitting one character more composes a reason the endpoint refuses.

    The event route answers the provider 200, so that bounce is lost, not retried; the form's copy
    turns a school away at a field the API would take.
    """

    record = _unpairable(name)
    found = re.search(rf"^const {name} = /(?P<source>.+?)/(?P<flags>[a-z]*);$", _source(record.module), re.MULTILINE)

    assert found is not None, f"{record.module} no longer spells {name} as one regular-expression literal on one line"
    assert found["flags"] in SINGLE_LINE_FLAGS, f"{name} carries the flags '{found['flags']}', which change what the class accepts"

    alphabet = sorted(_spelled_codepoints(SINGLE_LINE_PATTERN) | _spelled_codepoints(found["source"]) | PROBE_CONTROLS)
    probes = [*alphabet, *(f"Goethe{character}Startgeld" for character in alphabet)]

    accepted = _pydantic_accepted(SINGLE_LINE_PATTERN, probes)
    if matches_a_legal_value:
        taken = _javascript_accepted(found["source"], probes)
    else:
        # `.test` SEARCHES, and this spelling is what the refinement refuses: the value carrying no
        # member of the class is the one the form takes.
        refuses = re.compile(found["source"])
        taken = {probe for probe in probes if refuses.search(probe) is None}

    assert accepted, f"{record.python} accepts none of {len(probes)} probes, so agreeing with it proves nothing"
    assert len(accepted) < len(probes), f"{record.python} accepts every probe, so agreeing with it proves nothing"
    assert accepted == taken, f"{name} and {record.python} accept different values"


# The characters `fl_backend/app/core/logging.py :: NEEDS_QUOTING` names as why neither end takes a
# shorthand: a class respelled as one parts from its twin here and nowhere else.
QUOTING_DIVERGENCES: Final = ("\x1c", "\x1d", "\x1e", "\x1f", "\u0085", "\ufeff")

# The whole plane, because the class names ranges rather than characters and a corpus built from the
# characters it spells would never probe inside one.
BMP: Final = 0x10000


def test_the_console_quotes_the_field_the_frontend_logger_quotes():
    """A school name pasted out of Word carries U+00A0.

    One tier quoting that field while the other writes it bare parts a logfmt reader's pairs on the
    ops console, and the two lines then say different things about one request.
    """

    record = _unpairable("NEEDS_QUOTING")
    typescript, flags = _typescript_pattern(record.module, record.typescript)

    assert flags == "u", f"{record.typescript} carries the flags '{flags}', and only 'u' leaves a BMP class reading as it is written"

    frontend = re.compile(typescript)
    parting = [point for point in range(BMP) if (NEEDS_QUOTING.search(chr(point)) is None) != (frontend.search(chr(point)) is None)]

    assert not parting, f"{record.typescript} and {record.python} disagree about {[hex(point) for point in parting[:8]]}"
    for character in (*QUOTING_DIVERGENCES, " "):
        assert NEEDS_QUOTING.search(character), f"{record.python} no longer quotes U+{ord(character):04X}, which spelling the class out buys"


def test_the_two_trace_header_readers_take_the_same_headers():
    """A header one tier takes and the other mints over files one request under two ids."""

    record = _unpairable("TRACEPARENT")
    typescript, flags = _typescript_pattern(record.module, record.typescript)

    assert flags == "", f"{record.typescript} carries the flags '{flags}', which this comparison does not model"
    # Both anchors, because the grader below full-matches: an unanchored frontend spelling accepts a
    # header with a well-formed one buried in it, and the comparison would call the two ends equal.
    assert typescript.startswith("^") and typescript.endswith("$"), f"{record.typescript} is unanchored, which the grader models as anchored"

    # A well-formed header, then the drifts each end could take alone: another version, a trailing
    # newline, upper-case hex, a trace id one short, and a second span field.
    probes = [
        "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        "01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01\n",
        "00-0AF7651916CD43DD8448EB211C80319C-b7ad6b7169203331-01",
        "00-0af7651916cd43dd8448eb211c80319-b7ad6b7169203331-01",
        "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01-b7ad6b7169203331",
    ]
    # `\A` and `\Z` rather than `^` and `$`, which is what refuses that trailing newline under a
    # search as well as under the full match below.
    assert TRACEPARENT.search(probes[2]) is None, f"{record.python} no longer refuses a header carrying a trailing newline"

    taken = {probe for probe in probes if TRACEPARENT.fullmatch(probe) is not None}

    assert taken, f"{record.python} takes none of {len(probes)} probes, so agreeing with it proves nothing"
    assert len(taken) < len(probes), f"{record.python} takes every probe, so agreeing with it proves nothing"
    assert taken == _javascript_accepted(typescript, probes), f"{record.typescript} and {record.python} take different headers"


def test_the_two_ends_pin_an_internal_key_to_the_same_alphabet():
    """A key one tier boots on and the other refuses is a deployment already broken (`docs/ops/spec.md :: I11`)."""

    record = _unpairable("INTERNAL_API_KEY")
    source = _source(record.module)
    # Cut out of that one declaration: a second `.regex()` anywhere in the module would otherwise
    # answer for this alphabet.
    declaration = source[source.index(f"export const {record.typescript} = z") :]
    found = re.search(r"\.regex\(/(?P<source>.+?)/(?P<flags>[a-z]*), ", declaration[: declaration.index(";")])

    assert found is not None, f"{record.module} no longer states {record.typescript}'s alphabet as one regular-expression literal"
    assert found["flags"] == "", f"{record.typescript} carries the flags '{found['flags']}', which this comparison does not model"

    # A legal key, then a space, a tab, DEL just past the range's top, an umlaut, and the empty
    # string the `+` refuses.
    probes = ["Kf7", "Kf 7", "Kf\t7", "Kf\x7f7", "Kfö7", ""]
    taken = {probe for probe in probes if INTERNAL_API_KEY_CHARACTERS.fullmatch(probe) is not None}

    assert taken, f"{record.python} takes none of {len(probes)} probes, so agreeing with it proves nothing"
    assert len(taken) < len(probes), f"{record.python} takes every probe, so agreeing with it proves nothing"
    assert taken == _javascript_accepted(found["source"], probes), f"{record.typescript} and {record.python} pin different alphabets"


# What a frontend comment writes when it says the class beside it is one this package also spells:
# the path of the module holding the other end.
PATTERN_CLAIM: Final = "fl_backend/"

REGEX_EXPORT: Final = re.compile(r"^(?:export )?const (?P<name>[A-Z][A-Z0-9_]*) = (?:new RegExp\()?/.+?/[a-z]*\)?;$", re.MULTILINE)

# Where a frontend spelling is paired by a register other than this one, with that register. An entry
# here narrows the direction below to what this file can hold rather than dropping the claim.
PATTERNS_HELD_ELSEWHERE: Final = (("features/saisons/schemas.ts", "SAISON_ID_PATTERN", "features/saisons/saisonIdMirror.test.ts"),)

# The two shapes a module-level regular expression is written in here: a name this package reserves
# for one, or a call that compiles one whatever it is called.
NAMED_PATTERN: Final = re.compile(r"^(?P<name>[A-Z][A-Z0-9_]*(?:_PATTERN|_REGEX))(?::\s*[^=]+)?\s*=\s*r?[\"']", re.MULTILINE)

COMPILED_PATTERN: Final = re.compile(r"^(?P<name>[A-Z][A-Z0-9_]*)(?::\s*[^=]+)?\s*=\s*re\.compile\(", re.MULTILINE)

# Every regular expression this package declares that no frontend module spells a second time, with
# why none does. One in neither this map nor a register above fails the direction below rather than
# reading as covered.
UNMIRRORED_PATTERNS: Final[dict[str, str]] = {
    "app/shared/schemas/custom.py :: TIME_REGEX": "paired through `CustomTimeString`, the alias the fields carry rather than this constant",
    "app/shared/schemas/custom.py :: DATE_REGEX": "`fl_frontend/src/shared/schemas.ts` takes `z.iso.date()` and one refinement instead",
    "app/shared/schemas/custom.py :: DOMAIN_REGEX": "byte-for-byte `z.regexes.domain`, which the frontend reads off zod rather than retyping",
    "app/core/config.py :: HOSTNAME": "the shape `TrustedHostMiddleware` reads an allowlist entry in, which no request carries",
    "app/core/config.py :: ORIGIN": "the shape `CORSMiddleware` reads an allowlist entry in; the browser composes what it grades",
    "app/core/security.py :: WELL_FORMED_ACTOR": "a loose shape check on a composed header, where the frontend mirrors `EmailStr` instead",
}


def _claimed_pattern_mirrors() -> set[tuple[str, str]]:
    """Every frontend regular-expression constant whose own comment block names a module in this package."""

    claimed: set[tuple[str, str]] = set()
    for path in FRONTEND_SRC.rglob("*.ts*"):
        if path.name.endswith((".test.ts", ".test.tsx")):
            continue
        module = path.relative_to(FRONTEND_SRC).as_posix()
        claimed.update((module, name) for name in _attributed(path.read_text(encoding="utf-8"), REGEX_EXPORT, PATTERN_CLAIM))
    return claimed


def _declared_backend_patterns() -> set[str]:
    """`<module> :: <name>` for every module-level regular expression under `app/`.

    Text rather than an import, so a module no register imports is walked too: exactly the module a
    new pattern would be added to and compared by nothing.
    """

    declared: set[str] = set()
    for path in (REPO_ROOT / "fl_backend" / "app").rglob("*.py"):
        source = path.read_text(encoding="utf-8")
        module = path.relative_to(REPO_ROOT / "fl_backend").as_posix()
        for reader in (NAMED_PATTERN, COMPILED_PATTERN):
            declared.update(f"{module} :: {found['name']}" for found in reader.finditer(source))
    return declared


def test_every_frontend_pattern_claiming_a_twin_here_is_one_a_register_pairs():
    """`fl_frontend/src/core/apiContract.test.ts :: FieldFacts` leaves patterns out of the contract comparison by design.

    A hand-mirrored class in no register is therefore compared by nothing at all.
    """

    claimed = _claimed_pattern_mirrors()
    covered = (
        {(pattern.module, pattern.typescript) for pattern in MIRRORED_PATTERNS}
        | {(record.module, record.typescript) for record in UNPAIRABLE_PATTERNS}
        | {(module, name) for module, name, _ in PATTERNS_HELD_ELSEWHERE}
    )

    assert claimed, f"no frontend constant was attributed a claim on {PATTERN_CLAIM}, so this case passes over nothing"
    assert claimed <= covered, f"{sorted(claimed - covered)} names this package beside a class and is paired by nothing"


@pytest.mark.parametrize(("module", "name", "register"), PATTERNS_HELD_ELSEWHERE)
def test_every_pattern_held_elsewhere_names_a_register_that_still_holds_it(module: str, name: str, register: str):
    """Anti-vacuity on the one escape above: an entry naming a register that stopped reading it would narrow that case silently."""

    assert name in _source(register), f"{register} no longer names {name}, so nothing pairs {module} :: {name}"


def test_every_pattern_this_package_declares_is_paired_or_named_unmirrored():
    """The direction that starts from this package.

    Every case above starts from what the frontend spells, so a pattern no frontend module names is
    compared by nothing and reads as covered.
    """

    declared = _declared_backend_patterns()
    paired = {pattern.python for pattern in MIRRORED_PATTERNS} | {record.python for record in UNPAIRABLE_PATTERNS} | {ROUTE_ID_SITE}
    named = set(UNMIRRORED_PATTERNS)

    assert declared, "no regular expression was read off this package, so this case passes over nothing"
    assert not paired & named, f"{sorted(paired & named)} is both paired with a mirror and named as spelled once"
    assert named <= declared, f"{sorted(named - declared)} is named as spelled once and declared nowhere"
    assert declared <= paired | named, f"{sorted(declared - (paired | named))} is spelled here and compared by nothing"


ANSWER_PAYLOAD: Final = Path(bewerbungen_schemas.__file__)

VALUE_ERROR: Final = re.compile(r'raise ValueError\("([^"]+)"\)')

# A person meets whichever tier judged their body first, so two wordings of one rule read as two
# rules. `None` marks a refusal the frontend deliberately words its own way.
ANSWER_REFUSALS: Final[dict[str, str | None]] = {
    # Not mirrored: the page renders a control for the date, so the missing value is asked for there
    # rather than explained, and the two tiers refuse the same body for the same reason.
    "Zur Bestätigung gehört das eigene Geburtsdatum.": None,
    "Ein Widerspruch speichert kein Geburtsdatum.": "features/bewerbungen/schemas.ts",
    "Ein Widerspruch speichert keine WhatsApp-Einwilligung.": "features/bewerbungen/schemas.ts",
}

MIRRORED_REFUSALS: Final = tuple(message for message, module in ANSWER_REFUSALS.items() if module is not None)
UNMIRRORED_REFUSALS: Final = tuple(message for message, module in ANSWER_REFUSALS.items() if module is None)


def _answer_payload_refusals() -> set[str]:
    """Read off the class's own text: a validator yields its message only by being handed the one shape that trips it."""

    source = ANSWER_PAYLOAD.read_text(encoding="utf-8")
    block = source[source.index("class FLBewerbungEinwilligungAntwortPayload(BaseModel):") :]
    ends = block.find("\nclass ")

    return set(VALUE_ERROR.findall(block if ends == -1 else block[:ends]))


def test_the_register_holds_every_refusal_the_answer_payload_raises():
    """Both directions, so a reworded message fails here rather than in the frontend half, and an entry whose message is gone fails too."""

    raised = _answer_payload_refusals()

    assert raised, "no refusal was attributed to the answer payload, so every case below passes over nothing"
    assert raised == set(ANSWER_REFUSALS)


@pytest.mark.parametrize("message", MIRRORED_REFUSALS)
def test_each_mirrored_refusal_is_spelled_the_same_way_on_the_frontend(message: str):
    module = ANSWER_REFUSALS[message]

    assert module is not None
    assert message in _source(module), f"{module} no longer spells this refusal the way the endpoint raises it"


@pytest.mark.parametrize("message", UNMIRRORED_REFUSALS)
def test_each_unmirrored_refusal_is_still_spelled_only_here(message: str):
    """A message that grew a mirror pairs up in the register rather than being compared by nothing."""

    for module in {module for module in ANSWER_REFUSALS.values() if module is not None}:
        assert message not in _source(module), f"{module} mirrors this refusal now, so the register has to pair the two"
