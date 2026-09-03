import importlib
import inspect
from pathlib import Path

import pytest
from pydantic import BaseModel
from pydantic.fields import FieldInfo

from app.api.teams.schemas import FLTeamMembership
from app.shared.schemas.bounds import SAISON_ID_LENGTH

BACKEND_ROOT = Path(__file__).resolve().parents[2]

# Globbed rather than listed, so a slice added later is swept without an edit here.
SCHEMA_PATHS = sorted(BACKEND_ROOT.glob("app/api/*/schemas.py")) + sorted(BACKEND_ROOT.glob("app/shared/schemas/*.py"))

TOO_SHORT = "2" * (SAISON_ID_LENGTH - 1)
TOO_LONG = "2" * (SAISON_ID_LENGTH + 1)

LENGTH_REFUSALS = frozenset({"string_too_short", "string_too_long"})

# The shape a bound keeps out of a payload, and which a read of a stored row must still serve.
STORED_WRONG_LENGTH_ID = "2026/27"


def _bound(field: FieldInfo, attribute: str) -> int | None:
    """Read off the constraint objects: `Field(min_length=...)` lands in `metadata`, not in the annotation."""

    return next((getattr(constraint, attribute) for constraint in field.metadata if hasattr(constraint, attribute)), None)


def _fields_pinned_to_a_season_id() -> list[tuple[str, type[BaseModel], str]]:
    """Every field bounded to `SAISON_ID_LENGTH`, with the input key that reaches it.

    EITHER end of the pair, so one broken in half stays swept and fails on the side that was dropped.
    """

    pinned: list[tuple[str, type[BaseModel], str]] = []
    for path in SCHEMA_PATHS:
        module_name = ".".join(path.relative_to(BACKEND_ROOT).with_suffix("").parts)
        module = importlib.import_module(module_name)
        for model in vars(module).values():
            if not inspect.isclass(model) or not issubclass(model, BaseModel) or model.__module__ != module_name:
                continue
            for name, field in model.model_fields.items():
                if SAISON_ID_LENGTH not in (_bound(field, "min_length"), _bound(field, "max_length")):
                    continue
                # The key, not the attribute name: an alias is what a payload carries, and what a
                # refusal is reported against.
                key = field.validation_alias if isinstance(field.validation_alias, str) else field.alias or name
                pinned.append((f"{model.__name__}.{key}", model, key))

    return pinned


PINNED_FIELDS = _fields_pinned_to_a_season_id()
PINNED_IDS = [label for label, _, _ in PINNED_FIELDS]

# Ahead of `pyproject.toml :: empty_parameter_set_mark`, which refuses an empty parametrize without
# naming what to look at when the sweep stops matching.
assert PINNED_FIELDS, "no model carries the season-id length bound; the schema modules or the bound itself have moved"


@pytest.mark.parametrize("wrong_length_id", [TOO_SHORT, TOO_LONG], ids=["one short", "one long"])
@pytest.mark.parametrize("label,model,key", PINNED_FIELDS, ids=PINNED_IDS)
def test_a_model_accepting_a_season_id_refuses_one_of_the_wrong_length(
    label: str, model: type[BaseModel], key: str, wrong_length_id: str, assert_rejects
):
    """The refusal has to be about the LENGTH: every other field is absent from this payload, so something would refuse it anyway."""
    error = assert_rejects(model, {key: wrong_length_id}, key)

    refused_for = {entry["type"] for entry in error.errors() if entry["loc"] and entry["loc"][-1] == key}

    assert refused_for & LENGTH_REFUSALS, f"{label} refused {wrong_length_id!r} for {sorted(refused_for)} rather than its length"


def test_a_membership_model_still_accepts_a_stored_id_a_payload_would_refuse():
    """The other half of `docs/backend/spec.md :: I5`, pinned so the asymmetry reads as chosen.

    A read model refusing one stored row would answer 500 for the whole list it appears in.
    """
    membership = FLTeamMembership.model_validate({"saison_id": STORED_WRONG_LENGTH_ID, "gruppe": "A", "austritt": None})

    assert membership.saison_id == STORED_WRONG_LENGTH_ID
