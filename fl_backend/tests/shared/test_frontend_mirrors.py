import re
from itertools import product
from pathlib import Path
from typing import Final, NamedTuple

import pytest

from app.api.bewerbungen import schemas as bewerbungen_schemas
from app.shared.schemas import bounds
from app.shared.schemas.addresses import HAUSNUMMER_PATTERN
from app.shared.schemas.custom import PHONE_REGEX

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
)

MIRRORED_MODULES: Final = tuple(dict.fromkeys(mirror.module for mirror in MIRRORED_BOUNDS))

INTEGER_EXPORT: Final = re.compile(r"^export const (?P<name>[A-Z][A-Z0-9_]*) = (?P<value>\d+);$", re.MULTILINE)

COMMENT_OPENERS: Final = ("/**", "*/", "*", "//")


def _source(module: str) -> str:
    """One frontend module's text. Source text rather than an import: nothing on this side can load TypeScript."""

    return (FRONTEND_SRC / module).read_text(encoding="utf-8")


def _claimed_mirrors(source: str) -> set[str]:
    """Every integer this module's own prose claims it mirrors, attributed to the comment block above the line."""

    claimed: set[str] = set()
    block = ""
    was_comment = False
    for line in source.splitlines():
        stripped = line.strip()
        is_comment = stripped.startswith(COMMENT_OPENERS)
        if is_comment:
            # A blank line or a statement ends a block, so a claim never carries down to the next one.
            block = f"{block} {stripped}" if was_comment else stripped
        was_comment = is_comment
        found = INTEGER_EXPORT.match(line)
        if found is not None and MIRROR_CLAIM in block:
            claimed.add(found["name"])
    return claimed


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


class Pattern(NamedTuple):
    module: str
    typescript: str
    python: str
    source: str


# The two hand-mirrored patterns. `fl_frontend/src/core/apiContract.test.ts :: FieldFacts` leaves
# patterns out of the contract comparison by design, so nothing else pairs these ends at all.
MIRRORED_PATTERNS: Final = (
    Pattern("shared/schemas.ts", "PHONE_REGEX", "app/shared/schemas/custom.py :: PHONE_REGEX", PHONE_REGEX),
    Pattern("shared/schemas.ts", "HAUSNUMMER_REGEX", "app/shared/schemas/addresses.py :: HAUSNUMMER_PATTERN", HAUSNUMMER_PATTERN),
)

# The constructs this check models. `\s`, `\w` and their negations are refused rather than
# translated: the two engines disagree about what they hold, and `\s` is what the last divergence
# between these two patterns was made of.
MODELLED_ESCAPES: Final = frozenset("d-.\\()[]{}+*?^$|/")

# Probed alongside every character the two spellings mention, because a divergence over a character
# neither one names is one no derived alphabet would reach.
PROBE_CONTROLS: Final = frozenset({"\n", "\r", "\t", " ", "é", "z", "5"})

# Long enough to stand either side of a `{3,20}`-style bound, which no exhaustive short probe reaches.
PROBE_LENGTHS: Final = (4, 5, 19, 20, 21)

ALPHANUMERIC_RANGE: Final = re.compile(r"([0-9A-Za-z])-([0-9A-Za-z])")


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


def _accepted(pattern: str, probes: list[str]) -> set[str]:
    """`fullmatch` rather than `match`: JavaScript's `$` is the end of the input, where Python's also stands before a final newline."""

    compiled = re.compile(pattern, re.ASCII)

    return {probe for probe in probes if compiled.fullmatch(probe) is not None}


@pytest.mark.parametrize("pattern", MIRRORED_PATTERNS, ids=lambda pattern: pattern.typescript)
def test_each_declared_pattern_uses_only_the_constructs_this_check_models(pattern: Pattern):
    """A refusal rather than a silent pass: a construct outside the vocabulary is one the probe below would model wrongly."""

    typescript, flags = _typescript_pattern(pattern.module, pattern.typescript)

    assert flags == "", f"{pattern.typescript} carries the flags '{flags}', which this comparison does not model"
    for spelling in (pattern.source, typescript):
        escapes = {spelling[at + 1] for at, character in enumerate(spelling[:-1]) if character == "\\"}
        assert escapes <= MODELLED_ESCAPES, f"{sorted(escapes - MODELLED_ESCAPES)} in {spelling} is outside this check's vocabulary"
        assert "(?" not in spelling, f"{spelling} carries a group modifier this check does not model"


@pytest.mark.parametrize("pattern", MIRRORED_PATTERNS, ids=lambda pattern: pattern.typescript)
def test_each_declared_pattern_pair_accepts_the_same_values(pattern: Pattern):
    """Compared by what they accept and not as text: the two ends are equivalent today in spellings that differ."""

    typescript, _ = _typescript_pattern(pattern.module, pattern.typescript)
    alphabet = _probe_alphabet(pattern.source, typescript)
    probes = ["".join(run) for length in range(4) for run in product(alphabet, repeat=length)]
    probes += [character * length for character in alphabet for length in PROBE_LENGTHS]

    accepted = _accepted(pattern.source, probes)

    assert accepted, f"{pattern.python} accepts none of {len(probes)} probes, so agreeing with it proves nothing"
    assert len(accepted) < len(probes), f"{pattern.python} accepts every probe, so agreeing with it proves nothing"
    assert accepted == _accepted(typescript, probes), f"{pattern.typescript} and {pattern.python} accept different values"


ANSWER_PAYLOAD: Final = Path(bewerbungen_schemas.__file__)

VALUE_ERROR: Final = re.compile(r'raise ValueError\("([^"]+)"\)')

# A person meets whichever tier judged their body first, so two wordings of one rule read as two
# rules. `None` marks a refusal the frontend deliberately words its own way.
ANSWER_REFUSALS: Final[dict[str, str | None]] = {
    # Not mirrored: the page renders a control for the date, so the missing value is asked for there
    # rather than explained, and the two tiers refuse the same body for the same reason.
    "Zur Einwilligung gehört das eigene Geburtsdatum.": None,
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
