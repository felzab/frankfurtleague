import re
from pathlib import Path
from typing import Final

import pytest

from app.api.saisons.services import REDRAWABLE_SHAPE_FIELD, SHAPE_RULES_FIELDS

REPO_ROOT: Final = Path(__file__).resolve().parents[3]

SAISONS: Final = REPO_ROOT / "fl_frontend" / "src" / "features" / "saisons"

# Source text rather than an import: both German sites are TypeScript, and no pytest module runs
# TypeScript. Exporting the mapper buys nothing here, and it is module-private besides
# (`docs/frontend/spec.md` section 1.9).
ACTIONS: Final = (SAISONS / "actions.ts").read_text(encoding="utf-8")
REGELN_PANEL: Final = (SAISONS / "components" / "forms" / "AdminSaisonEditForm" / "FormRegelnSection.tsx").read_text(encoding="utf-8")

SHAPE_REFUSAL: Final = "REQ-RULES-011"

# One German noun phrase per frozen field. Each German site states one sentence per repair, so a
# further shape field would go unnamed at both while nothing on this side failed.
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


LITERAL: Final = re.compile(r'"((?:[^"\\]|\\.)*)"')


def _joined(block: str, at: int) -> str:
    """Every literal one value concatenates, and nothing where it ends in a shape this cannot read.

    The mapper's arm beside it already concatenates, and a first literal alone states a repair fewer
    while reading as the whole note.
    """

    parts: list[str] = []
    while True:
        while at < len(block) and block[at] in " \t\r\n+":
            at += 1
        literal = LITERAL.match(block, at)
        if literal is None:
            break
        parts.append(literal.group(1))
        at = literal.end()

    return "".join(parts) if parts and block[at : at + 1] == "," else ""


def _shape_note_open() -> str:
    """The note for the state where BOTH repairs are open.

    Cut out of `SHAPE_NOTE` itself, so no other `open:` key is read for it, and empty where either
    boundary is gone, so the cut fails its own test.
    """

    start = REGELN_PANEL.find("const SHAPE_NOTE")
    if start == -1:
        return ""
    end = REGELN_PANEL.find("\n};", start)
    if end == -1:
        return ""

    block = REGELN_PANEL[start:end]
    opened = re.search(r"\n\s*open:", block)

    return "" if opened is None else _joined(block, opened.end())


OPEN_NOTE: Final = _shape_note_open()

# One sentence per repair. The panel words them as two jobs because `find_rules_refusal` composes
# them as two, so which sentence a field stands in IS the partition rather than a formatting accident.
OPEN_REPAIRS: Final = [satz for satz in re.split(r"(?<=\.)\s+", OPEN_NOTE) if satz]


def _names(german: str, text: str) -> bool:
    """Whether one phrase stands in a text as a whole word.

    German compounds a term into a longer word meaning something else, so `Gruppenphase` satisfies a
    substring search for the group COUNT while naming no count at all.
    """

    return re.search(rf"(?<!\w){re.escape(german)}(?!\w)", text) is not None


def _repairs_naming(field: str) -> set[int]:
    """Which of the panel's repairs name one field, by position."""

    return {index for index, satz in enumerate(OPEN_REPAIRS) if _names(GERMAN_OF[field], satz)}


def test_a_value_written_as_two_literals_is_read_whole_or_not_at_all():
    """The reader on input: the panel writes one literal today, so the tree cannot tell the two apart."""

    joined = 'const SHAPE_NOTE = {\n  open:\n    "Erste Reparatur. " +\n    "Zweite Reparatur.",\n  recorded: "x",'
    composed = 'const SHAPE_NOTE = {\n  open: "Erste Reparatur. " + satzFuer(state),\n  recorded: "x",'
    absent = 'const SHAPE_NOTE = {\n  open: satzFuer(state),\n  recorded: "x",'

    after = len("open:")

    assert _joined(joined, joined.index("open:") + after) == "Erste Reparatur. Zweite Reparatur."
    assert _joined(composed, composed.index("open:") + after) == "", "a literal joined to an expression read as the whole value"
    assert _joined(absent, absent.index("open:") + after) == ""


def test_a_phrase_inside_a_longer_german_word_names_no_field():
    """The reader on input: every site in the tree spells these phrases as whole words already."""

    assert _names("Gruppen", "Für Gruppen und Teams pro Gruppe")
    assert not _names("Gruppen", "Die Gruppenphase ist gesperrt")
    assert not _names("Qualifikant", "Die Qualifikanten pro Gruppe")


def test_the_german_sites_are_still_where_this_module_cuts_them():
    """Anti-vacuity: a boundary that stopped matching would leave every case below true of an empty string."""

    assert ARM, f"no {SHAPE_REFUSAL} case was cut out of the saisons mapper"
    assert len(ARM) < len(ACTIONS), "the cut reaches the whole module, so it separates nothing"
    assert OPEN_NOTE, "no open arm was cut out of the Regeln panel's SHAPE_NOTE"
    assert len(OPEN_REPAIRS) > 1, "the open arm states one repair, so it parts no field from another"


def test_the_table_names_exactly_the_fields_the_write_path_freezes():
    """The authority is `SHAPE_RULES_FIELDS` and not this table, so a further shape field fails here rather than in silence."""

    assert set(GERMAN_OF) == set(SHAPE_RULES_FIELDS), f"unnamed: {sorted(set(SHAPE_RULES_FIELDS) - set(GERMAN_OF))}"
    assert len(set(GERMAN_OF.values())) == len(GERMAN_OF), "two fields share one phrase, so one of them is named by nothing"
    assert REDRAWABLE_SHAPE_FIELD in GERMAN_OF, f"{REDRAWABLE_SHAPE_FIELD} is the field a redraw moves and this table names no phrase for it"


@pytest.mark.parametrize(("field", "german"), sorted(GERMAN_OF.items()))
def test_the_german_arm_names_every_field_the_refusal_freezes(field: str, german: str):
    """The failure this guards: an arm naming a repair for some of the frozen fields reads as complete and is not."""

    assert _names(german, ARM), f"{SHAPE_REFUSAL} freezes {field} and its message never names {german}"


@pytest.mark.parametrize(("field", "german"), sorted(GERMAN_OF.items()))
def test_the_panel_names_a_repair_for_every_field_the_refusal_freezes(field: str, german: str):
    """The arm is a bare message sending the administrator to the reloaded panel, so a field the panel leaves out has no route named for it."""

    assert _names(german, OPEN_NOTE), f"{SHAPE_REFUSAL} freezes {field} and the reloaded panel names no repair naming {german}"


def test_the_panel_parts_the_redrawable_field_from_the_ones_the_entries_pin():
    """Two repairs because they are two jobs.

    Raising a pinned field needs clubs entered between an undraw and a redraw, which a redraw
    alone never asks for: one sentence for all three sends an administrator on the wrong job.
    """

    redrawable = _repairs_naming(REDRAWABLE_SHAPE_FIELD)
    pinned = {field: _repairs_naming(field) for field in GERMAN_OF if field != REDRAWABLE_SHAPE_FIELD}

    assert redrawable, f"no repair in the panel names {REDRAWABLE_SHAPE_FIELD}"
    assert pinned, "every frozen field is the one a redraw moves, so this parts nothing"

    for field, wo in pinned.items():
        assert wo, f"no repair in the panel names {field}"
        assert not wo & redrawable, f"one repair names {field} beside {REDRAWABLE_SHAPE_FIELD}, and a redraw moves only the second"

    assert set.intersection(*pinned.values()), "the fields the entries pin take different repairs, where the write path composes them one"
