"""
CORE · which values of a consent record the application composes, and which only survive as stored ones

A guardian's `erteilt_von` is a value the vocabulary admits and no code writes: every record
carrying it is one already stored, and the next writer of a consent is the admission that copies a
confirmed registration. The enum stays open so those rows go on validating, which makes "nothing
writes it" the assertion rather than "nothing names it".

See: docs/backend/spec.md
"""

import ast
from typing import Final, get_args

import pytest

from app.api.spieler.schemas import FLEinwilligung
from app.core.constraints import _EINWILLIGUNG_QUELLEN
from tests.core.app_source import APP_ROOT, BACKEND_ROOT, parsed

# A guardian filing for a pupil: the one provenance value stored records carry and no route collects.
GUARDIAN: Final = "erziehungsberechtigt"

# The adult's own word, which a pupil's confirmation and a referee's both compose: what the floor
# below reads to show the walk reaches real source.
ADULT: Final = "volljaehrig"

# The five shapes a composed value arrives in, beside the two that only DECLARE it. A sample too:
# every surviving hit in the tree is a declaration, so the tree alone cannot show a write would be seen.
A_WRITE: Final = 'FLEinwilligung(umfang="kader_oeffentlich", erteilt_von="erziehungsberechtigt")'
A_STORED_WRITE: Final = 'document = {"einwilligung": {"erteilt_von": "erziehungsberechtigt"}}'
# Not hypothetical: `app/api/registrierungen/services.py :: REGISTRIERUNG_ERTEILT_VON` is this shape.
A_NAMED_WRITE: Final = 'ERTEILT_VON: Final = "erziehungsberechtigt"'
A_RETURNED_WRITE: Final = 'def compose(): return "erziehungsberechtigt"'
A_DEFAULTED_WRITE: Final = 'def compose(erteilt_von="erziehungsberechtigt"): return erteilt_von'
A_TYPE_DECLARATION: Final = 'Quelle = Literal["erziehungsberechtigt", "volljaehrig"]'
A_ENUM_DECLARATION: Final = '_QUELLEN = ["erziehungsberechtigt", "volljaehrig"]'


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


def _modules_writing(value: str) -> set[str]:
    return {path.relative_to(BACKEND_ROOT).as_posix() for path in sorted(APP_ROOT.rglob("*.py")) if _writes(parsed(path), value)}


class TestTheReader:
    @pytest.mark.parametrize("source", [A_WRITE, A_STORED_WRITE, A_NAMED_WRITE, A_RETURNED_WRITE, A_DEFAULTED_WRITE])
    def test_it_sees_a_composed_record(self, source):
        assert _writes(ast.parse(source), GUARDIAN)

    @pytest.mark.parametrize("source", [A_TYPE_DECLARATION, A_ENUM_DECLARATION])
    def test_it_leaves_a_declaration_alone(self, source):
        assert not _writes(ast.parse(source), GUARDIAN)


def test_no_module_composes_a_guardians_consent():
    # The floor: the walk and the reader really do find a composed value in this tree, so the empty
    # set above is the guardian's word going unwritten rather than a sweep that read nothing.
    assert _modules_writing(ADULT)

    assert _modules_writing(GUARDIAN) == set()


def test_the_vocabulary_still_admits_it():
    """The floor, and the point: a stored record naming a guardian has to go on validating, so the value outlives its writer."""

    assert GUARDIAN in get_args(FLEinwilligung.model_fields["erteilt_von"].annotation)
    assert GUARDIAN in _EINWILLIGUNG_QUELLEN
