"""
CORE · which parts of a consent record the application composes, and which only survive as stored ones

Who answered (`erteilt_von` on a person's record, `erfasst_von` on a seat) is a value stored records
carry and no code writes. The vocabularies stay open so those rows go on validating, which makes
"nothing writes it" the assertion rather than "nothing names it".

See: docs/backend/spec.md
"""

import ast
from typing import Final, get_args

import pytest

from app.api.spieler.schemas import FLEinwilligungQuelle
from app.api.teams.schemas import FLKontaktKenntnisnahmeQuelle
from app.core.constraints import _EINWILLIGUNG_QUELLEN, _KONTAKT_KENNTNISNAHME_QUELLEN
from tests.core.app_source import APP_ROOT, BACKEND_ROOT, parsed

# A guardian filing for a pupil: one provenance value stored records carry and no route collects.
GUARDIAN: Final = "erziehungsberechtigt"

# Every speaker a stored record carries: each was written until no write named who answered any
# longer, so each has to go on validating however the vocabularies change.
STORED_ERTEILT_VON: Final = frozenset({GUARDIAN, "volljaehrig", "bestandsuebernahme"})
STORED_ERFASST_VON: Final = frozenset({"person", "administrativ"})

# A value the seat's composer does write, so the walk is seen to reach real source.
WRITTEN: Final = "kontaktdaten"

# The five shapes a composed value arrives in, beside the two that only DECLARE it. A sample too:
# every surviving hit in the tree is a declaration, so the tree alone cannot show a write would be seen.
A_WRITE: Final = 'FLEinwilligung(umfang="kader_oeffentlich", erteilt_von="erziehungsberechtigt")'
A_STORED_WRITE: Final = 'document = {"einwilligung": {"erteilt_von": "erziehungsberechtigt"}}'
A_NAMED_WRITE: Final = 'ERTEILT_VON: Final = "erziehungsberechtigt"'
A_RETURNED_WRITE: Final = 'def compose(): return "erziehungsberechtigt"'
A_DEFAULTED_WRITE: Final = 'def compose(erteilt_von="erziehungsberechtigt"): return erteilt_von'
A_TYPE_DECLARATION: Final = 'Quelle = Literal["erziehungsberechtigt", "volljaehrig"]'
A_ENUM_DECLARATION: Final = '_QUELLEN = ["erziehungsberechtigt", "volljaehrig"]'

# A seat's speaker is judged by its KEY: its values, `person` among them, are words the whole tree uses.
SEAT_SPEAKER: Final = "erfasst_von"
# A key the seat's composer does write, for `WRITTEN`'s reason.
WRITTEN_KEY: Final = "eingetragen_von"
KEYED_WRITES: Final = (
    'block = {"erfasst_von": "administrativ"}',
    'gesetzt[f"kontakte.{seat}.einwilligung.erfasst_von"] = "person"',
    'block["erfasst_von"] = "person"',
    'FLKontaktKenntnisnahme(umfang="kontaktdaten", erfasst_von="person")',
)
KEYED_NON_WRITES: Final = (
    'projection = {"kontakte.trainer.einwilligung.erfasst_von": 1}',
    'value = block["erfasst_von"]',
    'SPRECHER = ("erteilt_von", "erfasst_von")',
    'properties = {"erfasst_von": {"bsonType": "string", "enum": ["person"]}}',
)


def _writes(tree: ast.Module, value: str) -> bool:
    """Whether the value is composed here rather than merely declared.

    A `Literal[…]` subscript and an enum sequence sit the value inside a container rather than
    binding it whole, which is what keeps the vocabulary's declarations out of the answer.
    """

    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            handed = [*node.args, *(keyword.value for keyword in node.keywords)]
        elif isinstance(node, ast.Dict):
            handed = [item for item in node.values if item is not None]
        elif isinstance(node, (ast.Assign, ast.AnnAssign, ast.Return)):
            handed = [node.value] if node.value is not None else []
        elif isinstance(node, ast.arguments):
            # A default is a write nobody has to spell at the call, which is the quietest of the five.
            handed = [default for default in (*node.defaults, *node.kw_defaults) if default is not None]
        else:
            continue

        if any(isinstance(item, ast.Constant) and item.value == value for item in handed):
            return True

    return False


def _names(key: ast.AST | None, field: str) -> bool:
    """A constant or f-string key whose literal tail is the field, as a dotted path spells one."""

    if isinstance(key, ast.Constant) and isinstance(key.value, str):
        tail = key.value
    elif isinstance(key, ast.JoinedStr) and key.values and isinstance(key.values[-1], ast.Constant):
        tail = str(key.values[-1].value)
    else:
        return False

    return tail.split(".")[-1] == field


def _declares(value: ast.AST | None) -> bool:
    """A projection's integer flag, or a validator's sub-schema: a value naming the field without setting it."""

    if isinstance(value, ast.Constant):
        return type(value.value) is int
    return isinstance(value, ast.Dict) and any(isinstance(key, ast.Constant) and key.value == "bsonType" for key in value.keys)


def _writes_key(tree: ast.Module, field: str) -> bool:
    """Whether a mapping, an assigned subscript or a keyword argument sets the field."""

    for node in ast.walk(tree):
        if isinstance(node, ast.Dict) and any(
            _names(key, field) and not _declares(value) for key, value in zip(node.keys, node.values, strict=True)
        ):
            return True
        if isinstance(node, ast.Call) and any(keyword.arg == field for keyword in node.keywords):
            return True
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, (ast.AugAssign, ast.AnnAssign)) else []
        if any(isinstance(target, ast.Subscript) and _names(target.slice, field) for target in targets):
            return True

    return False


def _modules_writing(value: str) -> set[str]:
    return {path.relative_to(BACKEND_ROOT).as_posix() for path in sorted(APP_ROOT.rglob("*.py")) if _writes(parsed(path), value)}


def _modules_writing_key(field: str) -> set[str]:
    return {path.relative_to(BACKEND_ROOT).as_posix() for path in sorted(APP_ROOT.rglob("*.py")) if _writes_key(parsed(path), field)}


class TestTheReaders:
    @pytest.mark.parametrize("source", [A_WRITE, A_STORED_WRITE, A_NAMED_WRITE, A_RETURNED_WRITE, A_DEFAULTED_WRITE])
    def test_the_value_reader_sees_a_composed_record(self, source):
        assert _writes(ast.parse(source), GUARDIAN)

    @pytest.mark.parametrize("source", [A_TYPE_DECLARATION, A_ENUM_DECLARATION])
    def test_the_value_reader_leaves_a_declaration_alone(self, source):
        assert not _writes(ast.parse(source), GUARDIAN)

    @pytest.mark.parametrize("source", KEYED_WRITES)
    def test_the_key_reader_sees_each_shape_a_field_is_set_in(self, source):
        assert _writes_key(ast.parse(source), SEAT_SPEAKER)

    @pytest.mark.parametrize("source", KEYED_NON_WRITES)
    def test_the_key_reader_leaves_a_projection_a_read_and_a_declaration_alone(self, source):
        assert not _writes_key(ast.parse(source), SEAT_SPEAKER)


@pytest.mark.parametrize("value", get_args(FLEinwilligungQuelle))
def test_no_module_composes_who_answered_on_a_persons_record(value: str):
    # The floor: the walk and the reader really do find a composed value in this tree, so the empty
    # set below is the speaker going unwritten rather than a sweep that read nothing.
    assert _modules_writing(WRITTEN)

    assert _modules_writing(value) == set()


def test_no_module_sets_who_answered_on_a_seat():
    # The floor, for the key reader.
    assert _modules_writing_key(WRITTEN_KEY)

    assert _modules_writing_key(SEAT_SPEAKER) == set()


def test_the_vocabularies_still_admit_what_stored_records_carry():
    """The point: a stored record naming a speaker has to go on validating, so the value outlives its writer.

    Against the type and the validator's list alike: `tests/core/test_constraints.py :: MIRRORED_ENUMS`
    holds the two equal, which both narrowed together still are.
    """

    assert STORED_ERTEILT_VON <= set(get_args(FLEinwilligungQuelle))
    assert STORED_ERTEILT_VON <= set(_EINWILLIGUNG_QUELLEN)
    assert STORED_ERFASST_VON <= set(get_args(FLKontaktKenntnisnahmeQuelle))
    assert STORED_ERFASST_VON <= set(_KONTAKT_KENNTNISNAHME_QUELLEN)
