import ast
import importlib
import inspect
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel
from pydantic.fields import FieldInfo

from app.api.bewerbungen.services import next_saison_id
from app.api.saisons import schemas as saison_schemas
from app.api.saisons.schemas import FIRST_SAISON_YEAR, FLPostSaisonPayload
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


# A digit `\d` matches and `[0-9]` does not: Arabic-Indic and fullwidth, each spelling 2026.
NON_ASCII_YEARS = ["٢٠٢٦", "２０２６"]


# Matched on the attribute name alone, so a clock reached through an alias or a module this sweep
# has never heard of is still caught. Nothing legitimately calls one of these at import.
CLOCK_READS = frozenset({"today", "now", "utcnow"})


def _import_time_nodes(node: ast.AST) -> Iterator[ast.AST]:
    """Every node the module evaluates while it is being imported.

    A function's BODY is the one part that is not, which is the distinction this sweep draws; its
    decorators and argument defaults run with the `def`.
    """

    for child in ast.iter_child_nodes(node):
        if isinstance(child, ast.FunctionDef | ast.AsyncFunctionDef | ast.Lambda):
            decorators = getattr(child, "decorator_list", [])
            for evaluated in (*decorators, *child.args.defaults, *(default for default in child.args.kw_defaults if default is not None)):
                yield evaluated
                yield from _import_time_nodes(evaluated)
            continue

        yield child
        yield from _import_time_nodes(child)


def _clock_reads(source: str) -> tuple[list[str], list[str]]:
    """Every clock read in one module, parted into those evaluated at import and those a call defers."""

    tree = ast.parse(source)
    at_import = {id(node) for node in _import_time_nodes(tree)}
    reads = [
        node for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in CLOCK_READS
    ]

    return (
        [ast.unparse(node) for node in reads if id(node) in at_import],
        [ast.unparse(node) for node in reads if id(node) not in at_import],
    )


class TestTheCreatedSeasonsIdIsAYear:
    """The one field that MINTS a season id: every other declaration references one already stored, so the range is this field's alone."""

    @pytest.fixture
    def new_saison(self, saison) -> dict[str, Any]:
        """Narrowed rather than passed whole: `extra="forbid"` refuses the three keys only storage carries."""

        stored = saison()

        return {
            "id": stored["_id"],
            "start_date": stored["start_date"],
            "end_date": stored["end_date"],
            "rules": stored["rules"],
            "bewerbung": None,
        }

    def test_the_unmodified_body_is_accepted(self, new_saison):
        """Non-vacuity: every case below moves the id alone, and a body refused for a second reason would pass them all."""

        assert FLPostSaisonPayload.model_validate(new_saison).id == new_saison["id"]

    @pytest.mark.parametrize(
        "value",
        ["20a6", "２0２6", *NON_ASCII_YEARS],
        ids=["a letter", "two fullwidth digits", "arabic-indic", "fullwidth"],
    )
    def test_it_refuses_an_id_that_is_not_ascii_digits(self, new_saison, value, assert_rejects):
        """The refusal is the PATTERN and not the range: `int` reads three of these as 2026, so a range check alone would store them."""

        error = assert_rejects(FLPostSaisonPayload, {**new_saison, "id": value}, "id")

        assert {entry["type"] for entry in error.errors()} == {"string_pattern_mismatch"}

    @pytest.mark.parametrize(
        "value",
        [str(FIRST_SAISON_YEAR - 1), "1900", str(date.today().year + 2)],
        ids=["the year before the first season", "long before the league", "two years out"],
    )
    def test_it_refuses_a_year_the_league_can_have_no_season_in(self, new_saison, value, assert_rejects):
        """A digits-only pattern cannot express either bound, so the refusal has to arrive as the validator's rather than the pattern's."""

        error = assert_rejects(FLPostSaisonPayload, {**new_saison, "id": value}, "id")

        assert {entry["type"] for entry in error.errors()} == {"value_error"}

    # Padded from the constant rather than spelled: the width is `SAISON_ID_LENGTH`'s alone, so a
    # pattern restating it would refuse these ids the moment that constant moved.
    @pytest.mark.parametrize(
        "value",
        [str(FIRST_SAISON_YEAR).zfill(SAISON_ID_LENGTH), str(date.today().year + 1).zfill(SAISON_ID_LENGTH)],
        ids=["the league's first season", "next year"],
    )
    def test_it_accepts_a_year_inside_the_range(self, new_saison, value):
        assert FLPostSaisonPayload.model_validate({**new_saison, "id": value}).id == value


class TestTheCeilingIsComputedRatherThanBoundAtImport:
    """A range computed once at import is frozen for the life of the process.

    The first January after a long-running deploy then refuses next season's id, and every
    clock-relative case here still passes, having asked the same frozen constant.
    """

    def test_no_name_in_the_schema_module_binds_a_clock_read_at_import(self):
        at_import, _ = _clock_reads(inspect.getsource(saison_schemas))

        assert at_import == []

    def test_the_module_reads_the_clock_inside_a_call(self):
        """The floor against vacuity: with the range gone the clause above passes over a module consulting no clock at all."""

        _, deferred = _clock_reads(inspect.getsource(saison_schemas))

        assert deferred

    def test_the_sweep_reports_a_bind_this_module_could_grow(self):
        """Planted as TEXT rather than in the tree: a sweep nobody has driven red is one that cannot fail."""

        source = inspect.getsource(saison_schemas)
        before, _ = _clock_reads(source)

        at_import, _ = _clock_reads(f"{source}\n\nNEWEST_SAISON_YEAR = date.today().year + 1\n")

        assert at_import.count("date.today()") == before.count("date.today()") + 1


class TestTheSeasonAfterIsNamedInTheSameDigits:
    @pytest.mark.parametrize("value", NON_ASCII_YEARS, ids=["arabic-indic", "fullwidth"])
    def test_a_non_ascii_year_stops_the_retention_pass(self, value: str):
        """`int` reads each of these as 2026 and the successor comes back ASCII.

        The pass would then go looking for a season the one it was derived from cannot be matched to.
        """

        with pytest.raises(ValueError):
            next_saison_id(value)

    def test_an_ascii_year_still_names_its_successor(self):
        """Non-vacuity: a guard refusing everything would pass the case above without naming any season at all."""

        assert next_saison_id(str(FIRST_SAISON_YEAR)) == str(FIRST_SAISON_YEAR + 1)
