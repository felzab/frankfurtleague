from pathlib import Path
from typing import Final

import pytest

from app.api.saisons.services import SHAPE_RULES_FIELDS

REPO_ROOT: Final = Path(__file__).resolve().parents[3]

# Source text rather than an import: the mapper is TypeScript, and the backend holds no second copy
# of its German that could be read instead.
ACTIONS: Final = (REPO_ROOT / "fl_frontend" / "src" / "features" / "saisons" / "actions.ts").read_text(encoding="utf-8")

SHAPE_REFUSAL: Final = "REQ-RULES-011"

# One German noun phrase per frozen field. The backend composes its own message per field that
# moved; the German arm is one static sentence, so a further shape field would go unnamed in it
# while nothing on this side failed.
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

    assert german in ARM, f"{SHAPE_REFUSAL} freezes {field} and its message never names it"
