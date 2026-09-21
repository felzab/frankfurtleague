import re
import unicodedata
from collections.abc import Callable
from pathlib import Path
from typing import Final, NamedTuple

import pytest

from app.shared.folding import sign_in_identifier

REPO_ROOT: Final = Path(__file__).resolve().parents[3]

FRONTEND_MODULE: Final = "fl_frontend/src/core/emailAddress.ts"

FRONTEND_FUNCTION: Final = "asSignInIdentifier"

# One statement over the argument, which is the shape that lets the steps be read off the text at
# all: a body spread over statements fails the vocabulary case below rather than being guessed at.
FRONTEND_CHAIN: Final = re.compile(
    rf"export function {FRONTEND_FUNCTION}\(value: string\): string \{{(?:.*\n)*?  return value(?P<chain>(?:\.\w+\([^()]*\))+);\n\}}"
)

# Named rather than written into the probes below, where the character itself shows a reader nothing.
NEXT_LINE: Final = chr(0x85)
ZERO_WIDTH_NO_BREAK_SPACE: Final = chr(0xFEFF)
COMBINING_DIAERESIS: Final = chr(0x308)
MATHEMATICAL_BOLD_CAPITAL_A: Final = chr(0x1D400)
# Lowercases to TWO code points, and is the letter a locale-aware fold answers differently again.
LATIN_CAPITAL_I_WITH_DOT_ABOVE: Final = chr(0x130)
# A case pair Unicode added late, so two runtimes built against different releases part here first.
CHEROKEE_LETTER_A: Final = chr(0x13A0)


def _separators_and_python_whitespace() -> tuple[frozenset[str], frozenset[str]]:
    """Unicode's `Space_Separator`, and every character `str.strip()` removes, in one walk of the code space."""

    separators: set[str] = set()
    python_whitespace: set[str] = set()
    for point in range(0x110000):
        character = chr(point)
        if unicodedata.category(character) == "Zs":
            separators.add(character)
        if character.isspace():
            python_whitespace.add(character)

    return frozenset(separators), frozenset(python_whitespace)


SEPARATORS, PYTHON_WHITESPACE = _separators_and_python_whitespace()

# ECMAScript's `WhiteSpace` and `LineTerminator`, which is what `String.prototype.trim` removes.
# Derived from the category here and spelled out by hand in `app/shared/folding.py`, so a Unicode
# release adding a separator parts the two rather than moving both at once.
ECMASCRIPT_TRIMMED: Final = "".join(sorted(SEPARATORS | {chr(point) for point in (0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x2028, 0x2029, 0xFEFF)}))


def _normalised(value: str) -> str:
    return unicodedata.normalize("NFKC", value)


def _casefolded(value: str) -> str:
    return _normalised(value).casefold().strip(ECMASCRIPT_TRIMMED)


def _python_stripped(value: str) -> str:
    return _normalised(value).lower().strip()


def _folded_before_normalising(value: str) -> str:
    return _normalised(value.lower()).strip(ECMASCRIPT_TRIMMED)


class Alternative(NamedTuple):
    name: str
    fold: Callable[[str], str]
    probe: str


# Each row is a spelling somebody could write in `sign_in_identifier` instead, with the probe that
# parts it from the one written there. A corpus reaching none of them would report the two ends
# equal while the wrong spelling shipped.
ALTERNATIVES: Final = (
    Alternative("casefold rather than lower", _casefolded, "Poststraße@Schule.DE"),
    Alternative("str.strip takes U+0085", _python_stripped, f"wiltrudis@schule.de{NEXT_LINE}"),
    Alternative("str.strip leaves U+FEFF", _python_stripped, f"{ZERO_WIDTH_NO_BREAK_SPACE}wiltrudis@schule.de"),
    Alternative("the fold before the normalisation", _folded_before_normalising, f"{MATHEMATICAL_BOLD_CAPITAL_A}nna@Schule.DE"),
)

COMPOSED_UMLAUT: Final = "Jürgen@Schule.de"

DECOMPOSED_UMLAUT: Final = f"Ju{COMBINING_DIAERESIS}rgen@Schule.de"

NAMED_PROBES: Final = (
    "Wiltrudis@Schule.DE",
    COMPOSED_UMLAUT,
    DECOMPOSED_UMLAUT,
    f"{LATIN_CAPITAL_I_WITH_DOT_ABOVE}lknur@Schule.de",
    f"{CHEROKEE_LETTER_A}yv@Schule.de",
    *(alternative.probe for alternative in ALTERNATIVES),
)

# Every character either trim could reach, at both edges and between them: a run the folding must
# leave standing is the half of the comparison an edge-only corpus never reaches.
EDGE_CHARACTERS: Final = tuple(sorted(set(ECMASCRIPT_TRIMMED) | PYTHON_WHITESPACE))

CORPUS: Final = (
    *NAMED_PROBES,
    *(f"{character}anna@schule.de" for character in EDGE_CHARACTERS),
    *(f"anna@schule.de{character}" for character in EDGE_CHARACTERS),
    *(f"an{character}na@schule.de" for character in EDGE_CHARACTERS),
)

# Every step this check can run, each spelled from ECMAScript's own definition of the method it
# names rather than from `app/shared/folding.py`, whose drift a model built out of it would follow.

# Python stands in for two of them rather than Node running the real module:
# `.github/workflows/verify.yml`'s `backend` job sets up uv alone, so the Node a driver found there
# would be the runner image's rather than this repository's own pin.
JAVASCRIPT_STEPS: Final[dict[str, Callable[[str], str]]] = {
    'normalize("NFKC")': _normalised,
    "toLowerCase()": str.lower,
    "trim()": lambda value: value.strip(ECMASCRIPT_TRIMMED),
}


def _frontend_chain() -> tuple[str, ...]:
    """The steps `asSignInIdentifier` runs, in its own order.

    Source text rather than an import, for the reason `tests/shared/test_frontend_mirrors.py :: _source` records.
    """

    found = FRONTEND_CHAIN.search((REPO_ROOT / FRONTEND_MODULE).read_text(encoding="utf-8"))

    assert found is not None, f"{FRONTEND_MODULE} no longer spells {FRONTEND_FUNCTION} as one chain over its argument"

    return tuple(step for step in found["chain"].split(".") if step)


def _as_the_frontend_folds(value: str) -> str:
    folded = value
    for step in _frontend_chain():
        folded = JAVASCRIPT_STEPS[step](folded)

    return folded


def test_the_frontend_chain_holds_only_steps_this_check_models():
    """A refusal rather than a silent pass: a step outside the vocabulary is one the comparison below would model wrongly."""

    chain = _frontend_chain()

    assert chain, f"{FRONTEND_FUNCTION} runs no step, so agreeing with it proves nothing"
    assert set(chain) <= set(JAVASCRIPT_STEPS), f"{sorted(set(chain) - set(JAVASCRIPT_STEPS))} is outside this check's vocabulary"


@pytest.mark.parametrize("probe", CORPUS, ids=ascii)
def test_both_spellings_answer_the_same_string(probe: str):
    """Two of the three steps are MODELLED rather than driven.

    `normalize("NFKC")` and `toLowerCase()` answer through Python; `trim()` alone is built from the
    category walk above.
    """

    assert sign_in_identifier(probe) == _as_the_frontend_folds(probe)


def test_the_corpus_holds_probes_the_folding_changes_and_probes_it_leaves():
    """The anti-vacuity floor: a corpus the folding answers unchanged throughout would agree with any spelling of it."""

    changed = {probe for probe in CORPUS if sign_in_identifier(probe) != probe}

    assert changed, "the folding leaves every probe alone, so agreeing with it proves nothing"
    assert len(changed) < len(CORPUS), "the folding changes every probe, so no probe holds it to leaving one alone"


@pytest.mark.parametrize("alternative", ALTERNATIVES, ids=lambda alternative: alternative.name)
def test_every_alternative_spelling_parts_from_this_one_on_a_probe_the_corpus_holds(alternative: Alternative):
    """Both directions: a probe no alternative reaches earns nothing, and an alternative no probe reaches could ship."""

    assert alternative.probe in CORPUS, f"{alternative.probe!r} is outside the corpus, so nothing drives {alternative.name}"
    assert sign_in_identifier(alternative.probe) != alternative.fold(alternative.probe), (
        f"{alternative.name} answers {alternative.probe!r} the same way, so no probe here refuses it"
    )


def test_the_two_spellings_of_one_umlaut_reach_one_row():
    """What the normalisation is for: a person typing the composed umlaut and a mailbox holding the decomposed one are one."""

    assert sign_in_identifier(COMPOSED_UMLAUT) == sign_in_identifier(DECOMPOSED_UMLAUT)
