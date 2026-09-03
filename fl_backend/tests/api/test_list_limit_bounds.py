import ast
import importlib
import inspect
from pathlib import Path

import pytest
from pydantic import BaseModel, ValidationError

from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX

BACKEND_ROOT = Path(__file__).resolve().parents[2]

# Globbed rather than listed, so a slice added later is swept without an edit here.
SCHEMA_PATHS = sorted(BACKEND_ROOT.glob("app/api/*/schemas.py")) + sorted(BACKEND_ROOT.glob("app/shared/schemas/*.py"))

LIMIT = "limit"

FILTER_SUFFIX = "FilterParams"

# Spelled here rather than imported: `app/shared/schemas/bounds.py` names a bound only where a
# second field states it, and nothing but a page floor asks for this one.
LIMIT_FLOOR = 1

# The filter reaching no list: `GET /teams/{team_id}` is handed the id, so it has nothing to page.
UNPAGED_BY_DECISION = frozenset({"FLTeamSingleFilterParams"})


def _declared_models() -> list[type[BaseModel]]:
    """Every model the schema modules declare, the private bases among them, each read off the module that declares it."""

    declared: list[type[BaseModel]] = []
    for path in SCHEMA_PATHS:
        module_name = ".".join(path.relative_to(BACKEND_ROOT).with_suffix("").parts)
        module = importlib.import_module(module_name)
        declared.extend(
            model
            for model in vars(module).values()
            if inspect.isclass(model) and issubclass(model, BaseModel) and model.__module__ == module_name
        )

    return declared


def _field_call(declaration: ast.AnnAssign) -> ast.Call | None:
    """The `Field(...)` inside one declaration, wherever it sits: after the `=`, or in an `Annotated`."""

    return next(
        (node for node in ast.walk(declaration) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "Field"),
        None,
    )


def _limit_declarations() -> list[tuple[str, ast.Call]]:
    """Every `limit` the schema modules declare, with the class declaring it.

    Refuses one it cannot read rather than passing over it: a page size composed some other way is
    what this sweep would otherwise go quiet on.
    """

    found: list[tuple[str, ast.Call]] = []
    for path in SCHEMA_PATHS:
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not isinstance(node, ast.ClassDef):
                continue
            for statement in node.body:
                if not isinstance(statement, ast.AnnAssign) or not isinstance(statement.target, ast.Name) or statement.target.id != LIMIT:
                    continue

                call = _field_call(statement)
                assert call is not None, f"{node.name}.{LIMIT} carries no `Field(...)`, so nothing here can read the bounds it was given"
                found.append((node.name, call))

    return found


def _name_given(call: ast.Call, keyword: str) -> str | None:
    """What one keyword was handed, as the NAME it was spelled with -- `None` where it was handed a value instead."""

    given = next((entry.value for entry in call.keywords if entry.arg == keyword), None)

    return given.id if isinstance(given, ast.Name) else None


def _value_given(call: ast.Call, keyword: str) -> object:
    """What one keyword was handed, as the literal it was spelled with -- `None` where it was handed a name instead."""

    given = next((entry.value for entry in call.keywords if entry.arg == keyword), None)

    return given.value if isinstance(given, ast.Constant) else None


DECLARED = _declared_models()

# The runtime reading: what a request pages with, inherited fields included -- `FLTeamsFilterParams`
# extends the public filter rather than restating it, and pages by that inheritance alone.
PAGED = sorted(((model.__name__, model) for model in DECLARED if LIMIT in model.model_fields), key=lambda pair: pair[0])

LIMIT_DECLARATIONS = _limit_declarations()

# `empty_parameter_set_mark` defaults to skip, so a sweep that matched nothing would pass in silence.
assert PAGED, "no model carries a `limit`; the schema modules or the field's name have moved"
assert LIMIT_DECLARATIONS, "no schema module declares a `limit`; the reading below is over nothing"


@pytest.mark.parametrize("label,model", PAGED, ids=[label for label, _ in PAGED])
def test_a_paged_filter_takes_the_shared_default_and_refuses_either_side_of_the_shared_bounds(label: str, model: type[BaseModel]):
    """Asked as a REQUEST, so a bound restated through `Annotated` or a validator is swept the same."""

    served = model.model_validate({}).model_dump()

    assert served[LIMIT] == LIST_LIMIT_DEFAULT, f"{label} pages a caller who asked for nothing at {served[LIMIT]}"

    for accepted in (LIMIT_FLOOR, LIST_LIMIT_MAX):
        assert model.model_validate({LIMIT: accepted}).model_dump()[LIMIT] == accepted, f"{label} refuses {accepted}, inside the shared bounds"

    for refused in (LIMIT_FLOOR - 1, LIST_LIMIT_MAX + 1):
        with pytest.raises(ValidationError):
            model.model_validate({LIMIT: refused})


@pytest.mark.parametrize("owner,call", LIMIT_DECLARATIONS, ids=[owner for owner, _ in LIMIT_DECLARATIONS])
def test_a_limit_is_declared_from_the_two_constants_rather_than_from_the_number_they_share(owner: str, call: ast.Call):
    """Read off the declaration: no request can tell the two apart while they agree (`app/shared/schemas/bounds.py :: LIST_LIMIT_MAX`)."""

    assert _name_given(call, "default") == "LIST_LIMIT_DEFAULT", f"{owner}.{LIMIT} defaults to something other than the shared default"
    assert _value_given(call, "ge") == LIMIT_FLOOR, f"{owner}.{LIMIT} floors a page somewhere other than at {LIMIT_FLOOR}"
    assert _name_given(call, "le") == "LIST_LIMIT_MAX", f"{owner}.{LIMIT} ceilings a page at something other than the shared ceiling"


def test_the_source_and_the_models_reach_the_same_limits():
    """The two readings required to agree (`docs/_standard/standard.md :: PRE-4`): one places a page size the other cannot see."""

    declaring = {owner for owner, _ in LIMIT_DECLARATIONS}

    unread = sorted(declaring - {base.__name__ for _, model in PAGED for base in model.__mro__})
    assert unread == [], f"{unread} declare a `limit` no model carries, so its bounds are asked of no request"

    unplaced = sorted(label for label, model in PAGED if not declaring & {base.__name__ for base in model.__mro__})
    assert unplaced == [], f"{unplaced} page a request from a declaration nothing here could read"


def test_every_filter_a_slice_declares_pages_or_is_named_as_one_that_cannot():
    """What a NEW slice breaks in silence: a filter shipped with no `limit` offers a caller no page size at all."""

    filters = {model.__name__ for model in DECLARED if model.__name__.endswith(FILTER_SUFFIX)}
    unpaged = filters - {label for label, _ in PAGED}

    assert sorted(unpaged - UNPAGED_BY_DECISION) == [], f"{sorted(unpaged - UNPAGED_BY_DECISION)} narrow a list a caller cannot page"
    assert sorted(UNPAGED_BY_DECISION - unpaged) == [], f"{sorted(UNPAGED_BY_DECISION - unpaged)} page after all, and need no exemption"
