import ast
import functools
import importlib
from pathlib import Path
from typing import Any, Mapping

import pytest
from pydantic import BaseModel

from app.api.saisons.schemas import FLSaison
from app.api.schiedsrichter.schemas import FLSchiedsrichter
from app.api.spiele.schemas import FLSpiel
from app.api.spieler.schemas import FLSpieler
from app.api.spielorte.schemas import FLSpielort
from app.api.spieltage.schemas import FLSpieltag
from app.api.teams.schemas import FLTeam
from app.core.collections import Collection
from app.core.constraints import COLLECTION_VALIDATORS
from app.core.domain import AGGREGATES, FIELD_POLICIES, REFERENCES, RULES, UNENFORCED, UNUSED_ACTIONS, Action, Editability

BACKEND_ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = BACKEND_ROOT / "app"
# The frontend, because `Unenforced.surfaced_by` names the page or component reporting the state.
REPO_ROOT = BACKEND_ROOT.parent

# One file, so the pairing below can be exact in both directions.
UNENFORCED_TESTS = "tests/core/test_unenforced.py"

# `saison_teams` and `saison_spieler` have no row model: their fields are declared by their
# `$jsonSchema` alone.
ROOT_MODELS: Mapping[Collection, type[BaseModel]] = {
    Collection.SAISONS: FLSaison,
    Collection.SPIELTAGE: FLSpieltag,
    Collection.SPIELE: FLSpiel,
    Collection.TEAMS: FLTeam,
    Collection.SPIELER: FLSpieler,
    Collection.SPIELORTE: FLSpielort,
    Collection.SCHIEDSRICHTER: FLSchiedsrichter,
}

# Not domain rules: each is a property of the transport, and sitting in `app/core/` is what the
# coverage test keys on — a boundary rather than an exception list.
PROTOCOL_CODES = frozenset({"REQ-AUTH-001", "REQ-AUTH-002", "REQ-AUTH-003", "REQ-AUTH-004", "REQ-AUTH-005", "REQ-VAL-001", "REQ-OID-001"})

_CODE_PATTERN = "REQ-"


def _codes_in(root: Path) -> set[str]:
    """Every `REQ-*` code under `root`, comments included."""

    found: set[str] = set()
    for path in sorted(root.rglob("*.py")):
        for token in path.read_text(encoding="utf-8").split():
            start = token.find(_CODE_PATTERN)
            if start == -1:
                continue
            code = token[start:].rstrip("`\"',.;:)]}")
            # A code is `REQ-<AREA>-<NNN>`. Anything shorter is prose that happens to contain the prefix.
            if code.count("-") == 2 and code.rsplit("-", 1)[1].isdigit():
                found.add(code)
    return found


def _validator_properties(collection: Collection) -> Mapping[str, Any]:
    return COLLECTION_VALIDATORS[collection]["$jsonSchema"]["properties"]


def _resolves_in_validator(collection: Collection, path: str) -> bool:
    properties = _validator_properties(collection)
    *ancestors, leaf = path.split(".")
    for segment in ancestors:
        nested = properties.get(segment)
        if not isinstance(nested, Mapping) or "properties" not in nested:
            return False
        properties = nested["properties"]
    return leaf in properties


def _resolves_in_model(collection: Collection, path: str) -> bool:
    """One segment deliberately: a nested path through a discriminated union has no single answer, and the validator resolves those."""

    model = ROOT_MODELS.get(collection)

    return model is not None and "." not in path and path in model.model_fields


def _resolves(collection: Collection, path: str) -> bool:
    return _resolves_in_validator(collection, path) or _resolves_in_model(collection, path)


@functools.cache
def _parsed(file: Path) -> ast.Module:
    """Cached across the declarations citing one file; every walk below starts here."""

    return ast.parse(file.read_text(encoding="utf-8"))


@functools.cache
def _declared_classes(file: Path) -> frozenset[str]:
    """Every class the file declares, at any nesting depth.

    Walked rather than read off `tree.body`, because a case class nested inside another would
    otherwise report as missing.
    """

    return frozenset(node.name for node in ast.walk(_parsed(file)) if isinstance(node, ast.ClassDef))


@functools.cache
def _declared_functions(file: Path) -> Mapping[str, ast.FunctionDef | ast.AsyncFunctionDef]:
    """Every function the file declares, by name. A shadowed name resolves to the last one, as the module itself would."""

    return {node.name: node for node in ast.walk(_parsed(file)) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}


def _names_referenced(node: ast.AST) -> frozenset[str]:
    """Every bare name and attribute name under `node` -- the candidates for a constant or a helper it reaches."""

    return frozenset(
        child.id if isinstance(child, ast.Name) else child.attr for child in ast.walk(node) if isinstance(child, (ast.Name, ast.Attribute))
    )


@functools.cache
def _import_origins(file: Path) -> Mapping[str, tuple[str, str]]:
    """Each `from x import y` name in the file, as `(module, symbol)`, so a value resolves without importing the file."""

    origins: dict[str, tuple[str, str]] = {}
    for node in ast.walk(_parsed(file)):
        if isinstance(node, ast.ImportFrom) and node.module:
            for alias in node.names:
                origins[alias.asname or alias.name] = (node.module, alias.name)

    return origins


def _module_file(dotted: str) -> Path:
    return Path(importlib.import_module(dotted).__file__ or "")


def _reaches_code(dotted: str, code: str) -> bool:
    """Whether the callable at `dotted` reaches the constant holding `code`.

    Same-module helpers are followed, because a shared refusal builder is exactly where a code that
    several messages carry ends up (`app/api/spiele/services.py :: _wiring_refusal`).
    """

    module_path, _, symbol = dotted.rpartition(".")
    module = importlib.import_module(module_path)
    functions = _declared_functions(_module_file(module_path))

    seen: set[str] = set()
    pending = [symbol]
    while pending:
        name = pending.pop()
        if name in seen or name not in functions:
            continue
        seen.add(name)
        for referenced in _names_referenced(functions[name]):
            if getattr(module, referenced, None) == code:
                return True
            pending.append(referenced)

    return False


def _test_class_asserts_code(tested_by: str, code: str) -> bool:
    """Whether the cited class ASSERTS on an imported name holding `code`.

    Inside an `assert` and nowhere else, so importing the constant or naming it in a parametrize id
    does not count. A literal is refused too: every code is bound to a constant.
    """

    path, _, class_name = tested_by.partition("::")
    file = BACKEND_ROOT / path
    node = next((entry for entry in ast.walk(_parsed(file)) if isinstance(entry, ast.ClassDef) and entry.name == class_name), None)
    if node is None:
        return False

    origins = _import_origins(file)
    asserted = {name for statement in ast.walk(node) if isinstance(statement, ast.Assert) for name in _names_referenced(statement)}
    for referenced in asserted:
        origin = origins.get(referenced)
        if origin is not None and getattr(importlib.import_module(origin[0]), origin[1], None) == code:
            return True

    return False


def _import_symbol(dotted: str) -> Any:
    module_path, _, symbol = dotted.rpartition(".")
    module = importlib.import_module(module_path)

    return getattr(module, symbol)


def test_every_collection_belongs_to_exactly_one_aggregate():
    """Keyed on `COLLECTION_VALIDATORS` rather than a list: a new collection fails here until an aggregate owns it."""

    placements: dict[str, list[str]] = {collection: [] for collection in COLLECTION_VALIDATORS}
    for aggregate in AGGREGATES:
        for collection in (aggregate.root, *aggregate.members):
            assert collection in placements, f"{aggregate.name} names `{collection}`, which is not a collection this database has"
            placements[collection].append(aggregate.name)

    unplaced = [collection for collection, owners in placements.items() if not owners]
    shared = {collection: owners for collection, owners in placements.items() if len(owners) > 1}

    assert not unplaced, f"no aggregate covers {unplaced}"
    assert not shared, f"more than one aggregate claims {shared}"


def test_every_domain_rule_the_application_defines_is_declared():
    """Scanned over `app/api/` alone: `app/core/`'s codes describe the transport, not the league."""

    declared = {rule.code for rule in RULES}
    in_api = _codes_in(APP_ROOT / "api")

    assert not (in_api - declared - PROTOCOL_CODES), f"refusals in app/api with no row in RULES: {sorted(in_api - declared - PROTOCOL_CODES)}"
    assert not (declared - in_api), f"RULES names codes no endpoint raises: {sorted(declared - in_api)}"


def test_the_protocol_codes_are_the_ones_outside_the_api_layer():
    """Pins the boundary the coverage test rests on, so `PROTOCOL_CODES` cannot start excusing a real rule."""

    in_core = _codes_in(APP_ROOT / "core") - {rule.code for rule in RULES}

    assert in_core == PROTOCOL_CODES


def test_every_collection_is_declared_once():
    """`db.py`'s accessors, `constraints.py`'s validator keys and `Collection` would otherwise drift, and a new one could reach only some."""

    declared = {collection.value for collection in Collection}
    validated = {str(collection) for collection in COLLECTION_VALIDATORS}
    accessed = {
        line.split("Collection.")[1].split("]")[0]
        for line in (APP_ROOT / "core" / "db.py").read_text(encoding="utf-8").splitlines()
        if "return db[Collection." in line
    }

    assert validated == declared, "a collection the database validates is missing from `Collection`, or the reverse"
    assert {getattr(Collection, member).value for member in accessed} == declared, (
        "a collection has no DI accessor, or one names a member nothing declares"
    )


def test_every_declared_value_is_used():
    """`UNUSED_ACTIONS` is asserted exact rather than as a floor: an unused new member and a used listed one both fail."""

    used_actions = {
        action
        for reference in REFERENCES
        for action in (reference.on_reference_created, reference.on_target_change, reference.on_target_removed)
    }
    used_editability = {policy.editability for policy in FIELD_POLICIES}

    assert set(Action) - used_actions == UNUSED_ACTIONS
    assert set(Editability) - used_editability == set(), "an editability nothing uses describes no field in this system"


def test_no_rule_code_is_declared_twice():
    """A code reused for a second rule makes a refusal on the wire ambiguous to the client mapping it."""
    codes = [rule.code for rule in RULES]

    assert len(codes) == len(set(codes))


def test_every_rule_names_a_declared_aggregate():
    names = {aggregate.name for aggregate in AGGREGATES}

    for rule in RULES:
        assert rule.aggregate in names, f"{rule.code} is scoped to `{rule.aggregate}`, which is not an aggregate"


def test_no_field_policy_is_declared_twice():
    """Two rows for one field are two answers to 'when may this be written', and a reader gets the first."""

    keys = [(policy.collection, policy.field) for policy in FIELD_POLICIES]

    assert len(keys) == len(set(keys))


@pytest.mark.parametrize("reference", REFERENCES, ids=lambda reference: f"{reference.source}->{reference.target}:{reference.fields[0]}")
def test_every_reference_names_real_collections_and_real_fields(reference):
    assert reference.source in COLLECTION_VALIDATORS
    assert reference.target in COLLECTION_VALIDATORS

    for path in reference.fields:
        assert _resolves(reference.source, path), f"{reference.source}.{path} is on neither the model nor the validator"


@pytest.mark.parametrize("policy", FIELD_POLICIES, ids=lambda policy: f"{policy.collection}.{policy.field}")
def test_every_field_policy_names_a_real_field(policy):
    assert policy.collection in COLLECTION_VALIDATORS
    assert _resolves(policy.collection, policy.field), f"{policy.collection}.{policy.field} is on neither the model nor the validator"


@pytest.mark.parametrize("policy", FIELD_POLICIES, ids=lambda policy: f"{policy.collection}.{policy.field}")
def test_a_derived_field_is_on_no_document(policy):
    """What separates `DERIVED` from `COMPOSED`: `spiele.ergebnis` is also never accepted from a client and IS stored."""

    if policy.editability is not Editability.DERIVED:
        return

    assert not _resolves_in_validator(policy.collection, policy.field), (
        f"{policy.collection}.{policy.field} is declared DERIVED and the validator stores it"
    )
    assert _resolves_in_model(policy.collection, policy.field), (
        f"{policy.collection}.{policy.field} is declared DERIVED and no read model produces it"
    )


@pytest.mark.parametrize(
    "policy", [policy for policy in FIELD_POLICIES if policy.enforced_by], ids=lambda policy: f"{policy.collection}.{policy.field}"
)
def test_every_named_enforcer_resolves(policy):
    assert callable(_import_symbol(policy.enforced_by))


@pytest.mark.parametrize("rule", RULES, ids=lambda rule: rule.code)
def test_every_rule_is_implemented_where_it_says(rule):
    """The CLAIM, not the address: a callable that no longer carries the code has stopped implementing the rule."""

    assert callable(_import_symbol(rule.implemented_by))
    assert _reaches_code(rule.implemented_by, rule.code), f"{rule.implemented_by} reaches no constant holding {rule.code}"


@pytest.mark.parametrize("rule", RULES, ids=lambda rule: rule.code)
def test_every_rule_is_tested_where_it_says(rule):
    """The CLAIM again: a class that asserts on messages alone proves the wording, never the contract a client maps."""

    path, _, class_name = rule.tested_by.partition("::")
    file = BACKEND_ROOT / path

    assert file.is_file(), f"{rule.code} cites {path}, which does not exist"

    declared = _declared_classes(file)

    assert class_name in declared, f"{rule.code} cites {rule.tested_by}, and that file declares {sorted(declared)}"
    assert _test_class_asserts_code(rule.tested_by, rule.code), f"{rule.tested_by} never asserts on {rule.code}"


@pytest.mark.parametrize("entry", UNENFORCED, ids=lambda entry: entry.subject)
def test_every_unenforced_entry_names_the_rule_a_reader_would_expect(entry):
    """D76's entry bar, as a check: a state sitting near no rule surprises nobody, so it is a comment rather than a row."""

    assert entry.near, f"'{entry.subject}' names no adjacent rule and so clears no entry bar"

    defined = _codes_in(APP_ROOT)
    unknown = [code for code in entry.near if code not in defined]

    assert not unknown, f"'{entry.subject}' sits near {unknown}, which the application defines nowhere"


@pytest.mark.parametrize("entry", UNENFORCED, ids=lambda entry: entry.subject)
def test_every_unenforced_surface_resolves(entry):
    """A dead surface is the rot this catches: an entry claiming a person can see the state, pointing at a page that is gone."""

    if not entry.surfaced_by:
        return

    target = REPO_ROOT / (f"fl_frontend/src/app{entry.surfaced_by}/page.tsx" if entry.surfaced_by.startswith("/") else entry.surfaced_by)

    assert target.is_file(), f"'{entry.subject}' is surfaced by {entry.surfaced_by}, which resolves to no file"


def test_every_unenforced_entry_is_paired_with_the_test_that_proves_it():
    """Both directions, because either half alone rots: an entry nothing executes, or a test no entry claims."""

    file = BACKEND_ROOT / UNENFORCED_TESTS
    claimed = {entry.proven_by for entry in UNENFORCED}
    misfiled = sorted(cited for cited in claimed if not cited.startswith(f"{UNENFORCED_TESTS}::"))

    assert not misfiled, f"an entry proves itself outside {UNENFORCED_TESTS}: {misfiled}"

    declared = {f"{UNENFORCED_TESTS}::{name}" for name in _declared_classes(file)}

    assert claimed == declared, f"unproven: {sorted(claimed - declared)}; unclaimed: {sorted(declared - claimed)}"


def test_every_collection_that_retires_declares_when_that_field_is_written():
    """`FIELD_POLICIES`' other direction, at the one place it is mechanical: a collection that retires declares when that field is written."""

    declared = {(policy.collection, policy.field) for policy in FIELD_POLICIES}
    retiring = {collection for collection in COLLECTION_VALIDATORS if _resolves_in_validator(collection, "inactive_since")}
    undeclared = sorted(str(collection) for collection in retiring if (collection, "inactive_since") not in declared)

    assert not undeclared, f"{undeclared} carry `inactive_since` and declare nothing about when it may be written"


def test_every_declaration_carries_its_reason():
    for aggregate in AGGREGATES:
        assert aggregate.boundary.strip(), f"{aggregate.name} states no boundary"
    for reference in REFERENCES:
        assert reference.note.strip(), f"{reference.source}.{reference.fields[0]} states no reason"
    for policy in FIELD_POLICIES:
        if policy.editability is not Editability.EDITABLE:
            assert policy.condition.strip(), f"{policy.collection}.{policy.field} is {policy.editability} and says nothing about when"
    for entry in UNENFORCED:
        assert entry.reason.strip(), f"'{entry.subject}' is unenforced and states no reason"


def test_no_application_module_imports_the_domain_model():
    """A caller reading these tables turns them into an engine every write must remember to consult; the refusal lives at the endpoint."""

    importers = [
        path.relative_to(BACKEND_ROOT).as_posix()
        for path in sorted(APP_ROOT.rglob("*.py"))
        if path.name != "domain.py" and "core.domain" in path.read_text(encoding="utf-8")
    ]

    assert not importers, f"application code reads the declaration: {importers}"
