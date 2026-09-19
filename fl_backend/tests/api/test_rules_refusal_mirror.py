import re
from pathlib import Path
from typing import Final

import pytest

from app.api.saisons.services import SHAPE_RULES_FIELDS

REPO_ROOT: Final = Path(__file__).resolve().parents[3]

SAISONS: Final = REPO_ROOT / "fl_frontend" / "src" / "features" / "saisons"

# Source text rather than a call: the sentence is a server action's return, and calling one outside
# a request raises Next's request-scope error, the mapper being module-private besides -- the
# standing exception (`fl_frontend/src/features/saisons/actions.ts :: mapRulesRefusal`).
ACTIONS: Final = (SAISONS / "actions.ts").read_text(encoding="utf-8")

SHAPE_REFUSAL: Final = "REQ-RULES-011"

# One German noun phrase per frozen field. The arm states one sentence per repair, so a further
# shape field would go unnamed in it while nothing on this side failed.
GERMAN_OF: Final = {
    "number_of_groups": "Gruppen",
    "teams_per_group": "Teams pro Gruppe",
    "qualifiers_per_group": "Qualifikanten",
}


def _arm(code: str) -> str:
    """One `case` of the German mapper, up to the next — empty where either boundary is gone, so the cut fails its own test."""

    opening = f'case "{code}":'
    start = ACTIONS.find(opening)
    if start == -1:
        return ""
    end = ACTIONS.find('case "', start + len(opening))

    return "" if end == -1 else ACTIONS[start:end]


ARM: Final = _arm(SHAPE_REFUSAL)


def _names(german: str, text: str) -> bool:
    """Whether one phrase stands in a text as a whole word.

    German compounds a term into a longer word meaning something else, so `Gruppenphase` satisfies a
    substring search for the group COUNT while naming no count at all.
    """

    return re.search(rf"(?<!\w){re.escape(german)}(?!\w)", text) is not None


def test_a_phrase_inside_a_longer_german_word_names_no_field():
    """The reader on input: every site in the tree spells these phrases as whole words already."""

    assert _names("Gruppen", "Für Gruppen und Teams pro Gruppe")
    assert not _names("Gruppen", "Die Gruppenphase ist gesperrt")
    assert not _names("Qualifikant", "Die Qualifikanten pro Gruppe")


def test_the_german_arm_is_still_where_this_module_cuts_it():
    """Anti-vacuity: a boundary that stopped matching would leave every case below true of an empty string."""

    assert ARM, f"no {SHAPE_REFUSAL} case was cut out of the saisons mapper"
    assert len(ARM) < len(ACTIONS), "the cut reaches the whole module, so it separates nothing"


def test_the_table_names_exactly_the_fields_the_write_path_freezes():
    """The authority is `SHAPE_RULES_FIELDS` and not this table, so a further shape field fails here rather than in silence."""

    assert set(GERMAN_OF) == set(SHAPE_RULES_FIELDS), f"unnamed: {sorted(set(SHAPE_RULES_FIELDS) - set(GERMAN_OF))}"
    assert len(set(GERMAN_OF.values())) == len(GERMAN_OF), "two fields share one phrase, so one of them is named by nothing"


@pytest.mark.parametrize(("field", "german"), sorted(GERMAN_OF.items()))
def test_the_german_arm_names_every_field_the_refusal_freezes(field: str, german: str):
    """The failure this guards: an arm naming a repair for some of the frozen fields reads as complete and is not."""

    assert _names(german, ARM), f"{SHAPE_REFUSAL} freezes {field} and its message never names {german}"
