import ast
import functools
import importlib
from collections.abc import Iterator, Mapping
from importlib.util import resolve_name
from itertools import combinations
from pathlib import Path
from types import ModuleType
from typing import Any, get_args, get_origin

import pytest
from pydantic import BaseModel

from app.api.aktionen.crud import redact_address_in_images
from app.api.berechtigungen.erasure import erase_grants_and_authorship_in_session
from app.api.identitaet.crud import ERASURE_STEPS, JEDE_PERSONENGRUPPE, Personengruppe, _runs, erase_everything
from app.api.saisons.schemas import FLSaison
from app.api.schiedsrichter.crud import remove_pending_addresses_in_session
from app.api.schiedsrichter.schemas import FLSchiedsrichter
from app.api.spiele.schemas import FLSpiel
from app.api.spieler.crud import remove_pending_pupil_addresses_in_session
from app.api.spieler.schemas import FLSpieler
from app.api.spielorte.schemas import FLSpielort
from app.api.spieltage.schemas import FLSpieltag
from app.api.teams.schemas import FLTeam
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.constraints import COLLECTION_VALIDATORS
from app.core.domain import (
    AGGREGATES,
    FIELD_POLICIES,
    OPERATION_SEPARATOR,
    REFERENCES,
    RULES,
    UNENFORCED,
    UNUSED_ACTIONS,
    Action,
    Editability,
)
from app.core.exceptions import WriteRefusal
from app.main import PROTOCOL_CODES, PROTOCOL_FAMILIES_EXTENSION, create_app, refusal_family
from tests.config import build_test_config
from tests.core.app_source import SESSION_TYPE_MODULE, Declaration, api_routes, declared, module_of, parsed, resolve_callee, scoped_calls
from tests.openapi_document import build_document

BACKEND_ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = BACKEND_ROOT / "app"

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

_CODE_PATTERN = "REQ-"

# The declaration's own module, which never answers for a reason's own text: it is dropped from
# every listing built out of the source trees (`docs/_standard/standard.md :: PRE-4`).
DECLARATION = APP_ROOT / "core" / "domain.py"
DECLARATION_MODULE = "app.core.domain"


def _codes_in(root: Path, skip: Path | None = None) -> set[str]:
    """Every `REQ-*` code under `root`, comments included; `skip` drops a file that must not answer for its own text."""

    found: set[str] = set()
    for path in sorted(root.rglob("*.py")):
        if path == skip:
            continue
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
def _declared_classes(file: Path) -> frozenset[str]:
    """Every class the file declares, at any nesting depth.

    Walked rather than read off `tree.body`, because a case class nested inside another would
    otherwise report as missing.
    """

    return frozenset(node.name for node in ast.walk(parsed(file)) if isinstance(node, ast.ClassDef))


def _names_referenced(node: ast.AST) -> frozenset[str]:
    """Every bare name and attribute name under `node` -- the candidates for a constant or a helper it reaches."""

    return frozenset(
        child.id if isinstance(child, ast.Name) else child.attr for child in ast.walk(node) if isinstance(child, (ast.Name, ast.Attribute))
    )


def _module_imported_from(file: Path, node: ast.ImportFrom) -> str:
    # A module's package and an `__init__.py`'s package are both the path without its last part.
    package = ".".join(file.relative_to(BACKEND_ROOT).with_suffix("").parts[:-1])

    return resolve_name("." * node.level + (node.module or ""), package)


@functools.cache
def _import_origins(file: Path) -> Mapping[str, tuple[str, str]]:
    """Each `from x import y` name in the file, as `(module, symbol)`, so a value resolves without importing the file."""

    origins: dict[str, tuple[str, str]] = {}
    for node in ast.walk(parsed(file)):
        if isinstance(node, ast.ImportFrom):
            module = _module_imported_from(file, node)
            for alias in node.names:
                origins[alias.asname or alias.name] = (module, alias.name)

    return origins


def _modules_imported(file: Path, tree: ast.Module | None = None) -> frozenset[str]:
    """Every module the file imports, and every name it imports from one read as a submodule, relative levels resolved against its package."""

    found: set[str] = set()
    for node in ast.walk(tree or parsed(file)):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = _module_imported_from(file, node)
            found.add(base)
            found.update(f"{base}.{alias.name}" for alias in node.names)

    return frozenset(found)


def _module_of(file: Path) -> ModuleType:
    return importlib.import_module(".".join(file.relative_to(BACKEND_ROOT).with_suffix("").parts))


def _reached_functions(dotted: str) -> list[tuple[ModuleType, Declaration]]:
    """The callable at `dotted` and every application function it calls, each with the module its names resolve in.

    Calls are followed because a shared builder is where a code several messages carry ends up
    (`app/api/spiele/services.py :: _wiring_refusal`).
    """

    function = _import_symbol(dotted)
    pending = [(declared(function), module_of(function))]
    reached: dict[tuple[Path, int], tuple[ModuleType, Declaration]] = {}
    while pending:
        declaration, path = pending.pop()
        if (path, declaration.lineno) in reached:
            continue
        reached[(path, declaration.lineno)] = (_module_of(path), declaration)
        pending.extend(found for chain, call in scoped_calls(declaration, (declaration,)) if (found := resolve_callee(call, chain, path)))

    return list(reached.values())


def _reaches_code(dotted: str, code: str) -> bool:
    """Whether the callable at `dotted` reaches the constant holding `code`."""

    return any(
        code in _codes_held(getattr(module, referenced, None))
        for module, function in _reached_functions(dotted)
        for referenced in _names_referenced(function)
    )


def _codes_held(value: Any) -> tuple[Any, ...]:
    """A constant's code, or each code a mapping of codes hands out: a draw twin is spelled as one."""

    return tuple(value.values()) if isinstance(value, Mapping) else (value,)


def _resolved(node: ast.expr, module: ModuleType) -> Any:
    """The value a bare name or an attribute chain spells in `module`, which is how every refusal spells its code and its status."""

    if isinstance(node, ast.Name):
        return getattr(module, node.id)
    if isinstance(node, ast.Attribute):
        return getattr(_resolved(node.value, module), node.attr)
    raise TypeError(f"line {node.lineno} spells a value the trace cannot resolve: {ast.unparse(node)}")


def _refusals_built(module: ModuleType, node: ast.AST) -> Iterator[tuple[str, Any]]:
    """Each `WriteRefusal` constructed under `node`, as the code and the status it spells."""

    for call in ast.walk(node):
        if isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == WriteRefusal.__name__:
            spelled = {keyword.arg: keyword.value for keyword in call.keywords}
            code = spelled["error_code"]
            # A code read off a mapping by the refusal it re-codes is every code the mapping holds.
            codes = _codes_held(_resolved(code.value, module)) if isinstance(code, ast.Subscript) else (_resolved(code, module),)
            status = _resolved(spelled["status"], module)
            yield from ((each, status) for each in codes)


def _test_class_asserts_code(tested_by: str, code: str) -> bool:
    """Whether the cited class ASSERTS on an imported name holding `code`.

    Inside an `assert` and nowhere else, so importing the constant or naming it in a parametrize id
    does not count. A literal is refused too: every code is bound to a constant.
    """

    path, _, class_name = tested_by.partition("::")
    file = BACKEND_ROOT / path
    node = next((entry for entry in ast.walk(parsed(file)) if isinstance(entry, ast.ClassDef) and entry.name == class_name), None)
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


def test_no_family_holds_both_a_protocol_code_and_a_rule_s():
    """What lets the frontend classify a code by its family alone (`fl_frontend/src/core/errors.ts :: isRefusalCode`)."""

    rule_families = {refusal_family(rule.code) for rule in RULES if rule.code.startswith(_CODE_PATTERN)}

    assert not {refusal_family(code) for code in PROTOCOL_CODES} & rule_families


def test_the_document_publishes_every_protocol_family_and_no_other():
    """The frontend's half is `fl_frontend/src/core/protocolFamilies.test.ts`, against the committed document."""

    assert build_document()[PROTOCOL_FAMILIES_EXTENSION] == sorted({refusal_family(code) for code in PROTOCOL_CODES})


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
def test_every_rule_is_answered_at_the_status_it_declares(rule):
    """The row publishes the status and the check answers it, so a disagreement is a response the document never names."""

    built = {
        status
        for module, function in _reached_functions(rule.implemented_by)
        for code, status in _refusals_built(module, function)
        if code == rule.code
    }

    assert built == {rule.status}, f"{rule.code} declares {rule.status!r} and {rule.implemented_by} builds {built}"


def test_every_refusal_the_application_builds_is_answered_at_its_rules_status():
    """Over every construction under `app/`, a code's second implementer included, which no `implemented_by` names."""

    statuses = {rule.code: rule.status for rule in RULES}
    built = [
        (path.relative_to(BACKEND_ROOT).as_posix(), code, status)
        for path in sorted(APP_ROOT.rglob("*.py"))
        if f"{WriteRefusal.__name__}(" in path.read_text(encoding="utf-8")
        for code, status in _refusals_built(_module_of(path), parsed(path))
    ]

    assert len(built) >= len(RULES), "fewer refusals were found than rules declared, so the walk reads less than the tree holds"
    assert [entry for entry in built if statuses.get(entry[1]) != entry[2]] == []


def _field_of(model: Any, path: tuple[str | int, ...]) -> bool:
    """Whether `path` names a field inside `model`, an index stepping into a list's item type."""

    current: Any = model
    for step in path:
        # `Optional[...]`, `Annotated[...]` and a union step to the one member a path can walk into.
        while get_origin(current) is not None and get_origin(current) is not list:
            current = next((member for member in get_args(current) if member is not type(None)), None)
        if isinstance(step, int):
            if get_origin(current) is not list:
                return False
            current = get_args(current)[0]
        elif isinstance(current, type) and issubclass(current, BaseModel):
            field = next((info for name, info in current.model_fields.items() if step in (name, info.alias)), None)
            if field is None:
                return False
            current = field.annotation
        else:
            return False

    return True


@functools.cache
def _body_models() -> Mapping[str, Any]:
    """Each served operation's body model, keyed as `RULES` spells an operation."""

    prefix = f"/api/v{API_VERSION}"

    return {
        f"{method} {route.path_format.removeprefix(prefix)}": route.dependant.body_params[0].field_info.annotation
        for route in api_routes(create_app(build_test_config()))
        if route.dependant.body_params
        for method in route.methods or ()
    }


def test_every_field_a_refusal_names_is_a_field_of_the_body_its_operations_take():
    """A form marks the field a 422 names, and the frontend throws on a path its form does not hold.

    Resolved on the body of every operation `RULES` names for the refusal's code.
    """

    operations = {rule.code: rule.operation.split(OPERATION_SEPARATOR) for rule in RULES}
    named: list[tuple[str, str, tuple[str | int, ...]]] = []
    for path in sorted(APP_ROOT.rglob("*.py")):
        if f"{WriteRefusal.__name__}(" not in path.read_text(encoding="utf-8"):
            continue
        module = _module_of(path)
        for call in ast.walk(parsed(path)):
            if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == WriteRefusal.__name__):
                continue
            spelled = {keyword.arg: keyword.value for keyword in call.keywords}
            if "fields" in spelled:
                code = _resolved(spelled["error_code"], module)
                named.extend((code, operation, field) for field in ast.literal_eval(spelled["fields"]) for operation in operations[code])

    unresolved = [entry for entry in named if not _field_of(_body_models().get(entry[1]), entry[2])]

    assert len(named) >= NAMED_FIELDS_FLOOR, "fewer named fields were found than the tree holds, so the walk reads less than it should"
    assert unresolved == []


# The (code, operation, field) triples the sweep above found on the tree this was written against,
# so a walk that read nothing cannot pass it.
NAMED_FIELDS_FLOOR = 12


@pytest.mark.parametrize("rule", RULES, ids=lambda rule: rule.code)
def test_every_rule_is_tested_where_it_says(rule):
    """The CLAIM again: a class that asserts on messages alone proves the wording, never the contract a client maps."""

    path, _, class_name = rule.tested_by.partition("::")
    file = BACKEND_ROOT / path

    assert file.is_file(), f"{rule.code} cites {path}, which does not exist"

    declared = _declared_classes(file)

    assert class_name in declared, f"{rule.code} cites {rule.tested_by}, and that file declares {sorted(declared)}"
    assert _test_class_asserts_code(rule.tested_by, rule.code), f"{rule.tested_by} never asserts on {rule.code}"


def test_a_cited_class_asserting_on_a_relatively_imported_name_is_read():
    """A rule may cite a class under `tests/api/`, whose suites import their siblings relatively.

    Read as a top-level module, such a name raises rather than resolving.
    """

    assert _test_class_asserts_code("tests/core/cited_relatively.py::TestAssertsOnARelativelyImportedName", SESSION_TYPE_MODULE)


# No separate check that a `RULES` row claims no `UNENFORCED` subject: the pairing below executes
# each entry, so a rule that starts refusing a declared state fails that entry's own test.
@pytest.mark.parametrize("entry", UNENFORCED, ids=lambda entry: entry.subject)
def test_every_unenforced_entry_names_the_rule_a_reader_would_expect(entry):
    """`UNENFORCED`'s entry bar, as a check: a state sitting near no rule surprises nobody, so it is a comment rather than a row."""

    assert entry.near, f"'{entry.subject}' names no adjacent rule and so clears no entry bar"

    defined = _codes_in(APP_ROOT, skip=DECLARATION)
    unknown = [code for code in entry.near if code not in defined]

    assert not unknown, f"'{entry.subject}' sits near {unknown}, which the application defines nowhere"


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


# The collections a person's own document sits in, whose references an erasure owes a step.
PERSON_COLLECTIONS = frozenset({Collection.SPIELER, Collection.SCHIEDSRICHTER})

REFERENCES_TO_A_PERSON = [reference for reference in REFERENCES if reference.target in PERSON_COLLECTIONS]

# Every scope `erase_everything` could be handed, so a step moved into a narrower one fails before any caller asks for that scope.
SCOPES = [frozenset(scope) for size in range(len(JEDE_PERSONENGRUPPE) + 1) for scope in combinations(sorted(JEDE_PERSONENGRUPPE), size)]


def _steps_reaching(collection: Collection, scope: frozenset[Personengruppe] = JEDE_PERSONENGRUPPE) -> list[int]:
    return [index for index, step in enumerate(ERASURE_STEPS) if collection in step.reaches and _runs(step.run, scope)]


def test_every_reference_to_a_person_has_an_erasure_step_reaching_its_source():
    """A reference to a person no step reaches outlives their erasure, naming a document that is gone.

    Programme 3's lineups, scorers and cards each add a row here, and fail until a step reaches them.
    """

    assert REFERENCES_TO_A_PERSON, "no reference targets a person, so the comparison below holds of nothing"
    assert [f"{reference.source}.{reference.fields[0]}" for reference in REFERENCES_TO_A_PERSON if not _steps_reaching(reference.source)] == []


def test_in_every_scope_a_cascade_onto_a_persons_references_runs_before_the_person_goes():
    """A step serving no one kind runs in the full scope alone, so a repoint declared so passes there.

    In the pupil scope it leaves the reference naming nobody; one running after the removal finds no person to repoint from.
    """

    cascading = [reference for reference in REFERENCES_TO_A_PERSON if reference.on_target_removed is Action.CASCADE]
    late = [
        (sorted(scope), f"{reference.source}.{reference.fields[0]}")
        for scope in SCOPES
        for reference in cascading
        if (removing := _steps_reaching(reference.target, scope))
        and min(_steps_reaching(reference.source, scope), default=len(ERASURE_STEPS)) > max(removing)
    ]

    assert cascading, "no reference cascades onto a person, so the comparison below holds of nothing"
    assert late == []


def test_the_registry_runs_every_step_by_name_in_its_declared_order():
    """`ERASURE_STEPS` is the population every case here reads: a step declared but never called, or out of order, misleads them all.

    By name, never through the tuple: the transaction sweeps follow a session handed on by a bare name alone.
    """

    names = {step.run.__name__ for step in ERASURE_STEPS}
    # In source order: `ast.walk` visits breadth-first.
    called = sorted(
        (node.lineno, node.func.id)
        for node in ast.walk(declared(erase_everything))
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in names
    )

    assert list(dict.fromkeys(name for _, name in called)) == [step.run.__name__ for step in ERASURE_STEPS]


# The steps whose writes leave the address in images no step of theirs redacts: another record the person made or names.
_LEAVING_THE_ADDRESS_IN_IMAGES = (
    erase_grants_and_authorship_in_session,
    remove_pending_addresses_in_session,
    remove_pending_pupil_addresses_in_session,
)


def test_no_scope_runs_a_step_leaving_the_address_in_an_image_without_the_address_pass():
    """Running without the pass, such a step leaves the address in the images its writes filed."""

    unredacted = [
        sorted(scope)
        for scope in SCOPES
        if any(_runs(run, scope) for run in _LEAVING_THE_ADDRESS_IN_IMAGES) and not _runs(redact_address_in_images, scope)
    ]

    assert any(_runs(redact_address_in_images, scope) for scope in SCOPES), "no scope runs the pass, so the comparison holds of nothing"
    assert unredacted == []


def test_the_document_publisher_is_the_one_application_module_reading_the_domain_model():
    """A write reading these tables turns them into an engine every write must remember to consult; the refusal lives at the endpoint.

    Exact, so a second reader and a publisher that stopped reading both fail.
    """

    importers = [
        path.relative_to(BACKEND_ROOT).as_posix() for path in sorted(APP_ROOT.rglob("*.py")) if DECLARATION_MODULE in _modules_imported(path)
    ]

    assert importers == ["app/main.py"], f"the declaration is read by {importers}, where `app/main.py :: declared_refusals` alone may read it"


def test_the_importer_reading_resolves_every_spelling_of_the_import():
    """Relative and plain imports name the module without the dotted path a text search keys on."""

    spellings = ["import app.core.domain", "from app.core import domain", "from . import domain", "from .domain import RULES"]
    beside = APP_ROOT / "core" / "reader.py"

    assert all(DECLARATION_MODULE in _modules_imported(beside, ast.parse(source)) for source in spellings)
    assert DECLARATION_MODULE not in _modules_imported(beside, ast.parse("from . import collections"))


# What `erase_everything` hands its session to ahead of any step, erasing nothing of the person: the address anchor,
# the subject read, and the two sentinels a step repoints onto.
NOT_A_STEP = frozenset({"anchor_the_addresses", "resolve_subject", "ensure_ghost_schiedsrichter", "ensure_ghost_spieler"})


class TestEveryCallTheErasureHandsItsSessionIsADeclaredStep:
    def test_the_calls_are_the_registry_and_the_named_prelude(self):
        """Read off the body rather than `ERASURE_STEPS`: a step called but never declared is in no scope's reckoning.

        By the session, which every step requires (`docs/backend/spec.md :: I52`), so an undeclared one is handed it too.
        """

        handed = {
            node.func.id
            for node in ast.walk(declared(erase_everything))
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and any(keyword.arg == "session" for keyword in node.keywords)
        }

        assert NOT_A_STEP <= handed, f"{sorted(NOT_A_STEP - handed)} named here but never called, so the name excuses the next such call"
        assert handed - NOT_A_STEP == {step.run.__name__ for step in ERASURE_STEPS}
