import ast
import functools
import importlib
import json
import re
from collections.abc import Iterator, Mapping
from pathlib import Path
from types import ModuleType
from typing import Any

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
from app.core.config import API_VERSION
from app.core.constraints import COLLECTION_VALIDATORS, SUPPORT_INDEXES, TTL_INDEXES, UNIQUE_INDEXES
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
from app.core.exception_handlers import MALFORMED_OBJECT_ID, PAYLOAD_REFUSED
from app.core.exceptions import WriteRefusal
from app.core.security import MISSING_ACTOR, MISSING_TOKEN, WRONG_ADMIN_KEY, WRONG_BASE_KEY, WRONG_SYSTEM_KEY
from tests.core.app_source import Declaration, declared, module_of, parsed, resolve_callee, scoped_calls

BACKEND_ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = BACKEND_ROOT / "app"
# The frontend, because `Unenforced.surfaced_by` names the page or component reporting the state.
REPO_ROOT = BACKEND_ROOT.parent

# One file, so the pairing below can be exact in both directions.
UNENFORCED_TESTS = "tests/core/test_unenforced.py"

FRONTEND_APP = REPO_ROOT / "fl_frontend" / "src" / "app"
_ROUTE_GROUP = re.compile(r"^\(.+\)$")

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
PROTOCOL_CODES = frozenset(
    {MISSING_TOKEN, WRONG_BASE_KEY, WRONG_SYSTEM_KEY, WRONG_ADMIN_KEY, MISSING_ACTOR, PAYLOAD_REFUSED, MALFORMED_OBJECT_ID}
)

_CODE_PATTERN = "REQ-"

# The declaration's own module, which never answers for a reason's own text: it is dropped from
# every listing built out of the source trees (`docs/_standard/standard.md :: PRE-4`).
DECLARATION = APP_ROOT / "core" / "domain.py"
DECLARATION_MODULE = "app.core.domain"

# What a `reason=` cites, by shape. Each kind carries its own idea of resolving, so a token is
# classified before it is looked up, and one matching no shape at all fails rather than passing.
_REASON_TOKEN = re.compile(r"`([^`]+)`")
# The shapes the documentation gate resolves, each an address the corpus answers for; passed over
# here, and read there, spelled as that gate spells them
# (`scripts/checks/docs_gate/reasons.py :: check_handed_over_shapes`).
_GATE_SHAPES = tuple(
    re.compile(pattern)
    for pattern in (
        r"^(?:REQ|READ)-[A-Z]+-\d+$",
        r"^((?:REQ|READ)-[A-Z]+-)\*$",
        r"^(\S+\.\w+) :: (.+)$",
        r"^[\w.\-]+(?:/[\w.\-]*)+$",
        r"^[IL]\d{1,3}[a-z]?$",
    )
)
_ENDPOINT = re.compile(r"^(GET|POST|PUT|PATCH|DELETE) (/\S*)$")
_SURFACE = re.compile(r"^/\S*$")
_INDEX_KEY = re.compile(r"^\(([a-z_]+(?:, [a-z_]+)+)\)$")
_NAME = re.compile(r"^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$")
_WORD = re.compile(r"[A-Za-z_]\w*")

# The kinds that name no address, spared by shape and never by a list of tokens: a stored value, a
# field beside the value it holds, and a type expression.
_VALUE = re.compile(r"^\d+$")
_FIELD_VALUE = re.compile(r"^[\w.]+: \S+$")
_TYPE_EXPRESSION = re.compile(r"^[\w\[\], |]*[\[|][\w\[\], |]*$")


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


def _page_serves(url: str, app_dir: Path = FRONTEND_APP) -> bool:
    """Whether a `page.tsx` serves `url`, through any route group.

    A folder named `(name)` is left out of the URL (https://nextjs.org/docs/app/api-reference/file-conventions/route-groups,
    Next.js 16.3.6, read 2026-09-24), so a page moved into one keeps its address and must keep resolving.
    """

    def serves(folder: Path, segments: list[str]) -> bool:
        groups = [child for child in folder.iterdir() if child.is_dir() and _ROUTE_GROUP.match(child.name)] if folder.is_dir() else []
        here = (folder / "page.tsx").is_file() if not segments else serves(folder / segments[0], segments[1:])

        return here or any(serves(group, segments) for group in groups)

    segments = [segment for segment in url.split("/") if segment]

    return not any(_ROUTE_GROUP.match(segment) for segment in segments) and serves(app_dir, segments)


@functools.cache
def _declared_index_keys() -> frozenset[tuple[str, ...]]:
    """Key fields alone, the sort direction dropped: a reason names the group an index covers, never the order it walks it in."""

    return frozenset(
        {tuple(index.keys) for index in UNIQUE_INDEXES}
        | {tuple(field for field, _ in support.keys) for support in SUPPORT_INDEXES}
        | {(ttl.key,) for ttl in TTL_INDEXES}
    )


@functools.cache
def _published_routes() -> Mapping[str, Any]:
    """`openapi.json` rather than the application object.

    The published document is the surface a route claim is about, and the gate holds it to the
    endpoints it describes.
    """

    return json.loads((BACKEND_ROOT / "openapi.json").read_text(encoding="utf-8"))["paths"]


@functools.cache
def _names_the_source_trees_spell() -> frozenset[str]:
    """Weak on purpose, because the rot it answers is a rename.

    A name neither tree spells is gone, whatever it named -- a field, a symbol, an index, or a
    label a page prints.
    """

    words: set[str] = set()
    for root, suffixes in ((APP_ROOT, ("*.py",)), (REPO_ROOT / "fl_frontend" / "src", ("*.ts", "*.tsx", "*.css"))):
        for suffix in suffixes:
            for path in root.rglob(suffix):
                if path != DECLARATION:
                    words.update(_WORD.findall(path.read_text(encoding="utf-8")))

    return frozenset(words)


def _classify(token: str) -> tuple[str, bool | None]:
    """The kind, and whether it resolves -- `None` where the kind has no address, parting a spared value from one nothing answers for."""

    # Ahead of every shape below: an `I<n>` is also a name either tree spells.
    if any(shape.match(token) for shape in _GATE_SHAPES):
        return "the documentation gate's", None

    if endpoint := _ENDPOINT.match(token):
        route, method = endpoint.group(2), endpoint.group(1).lower()
        # The whole path, never its end: `/saisons/{saison_id}` also ends the team and player routes,
        # which would go on resolving a season route renamed away.
        return "endpoint", method in _published_routes().get(f"/api/v{API_VERSION}{route}", {})

    if _SURFACE.match(token):
        return "surface", _page_serves(token)

    if key := _INDEX_KEY.match(token):
        return "index key", tuple(key.group(1).split(", ")) in _declared_index_keys()

    if _NAME.match(token):
        return "name", all(segment in _names_the_source_trees_spell() for segment in token.split("."))

    if _VALUE.match(token) or _FIELD_VALUE.match(token) or _TYPE_EXPRESSION.match(token):
        return "value", None

    return "a shape this check does not read", False


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


@functools.cache
def _import_origins(file: Path) -> Mapping[str, tuple[str, str]]:
    """Each `from x import y` name in the file, as `(module, symbol)`, so a value resolves without importing the file."""

    origins: dict[str, tuple[str, str]] = {}
    for node in ast.walk(parsed(file)):
        if isinstance(node, ast.ImportFrom) and node.module:
            for alias in node.names:
                origins[alias.asname or alias.name] = (node.module, alias.name)

    return origins


def _modules_imported(file: Path, tree: ast.Module | None = None) -> frozenset[str]:
    """Every module the file imports, and every name it imports from one read as a submodule, relative levels resolved against its package."""

    # A module's package and an `__init__.py`'s package are both the path without its last part.
    package = file.relative_to(BACKEND_ROOT).with_suffix("").parts[:-1]
    found: set[str] = set()
    for node in ast.walk(tree or parsed(file)):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = ".".join((*package[: len(package) - node.level + 1], *([node.module] if node.module else []))) if node.level else node.module
            found.add(base or "")
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
        getattr(module, referenced, None) == code
        for module, function in _reached_functions(dotted)
        for referenced in _names_referenced(function)
    )


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
            yield _resolved(spelled["error_code"], module), _resolved(spelled["status"], module)


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


@pytest.mark.parametrize("rule", RULES, ids=lambda rule: rule.code)
def test_every_rule_names_operations_the_document_publishes(rule):
    """No refusal is raised from `operation`, so a route it names wrongly is read by a person and caught by nothing."""

    for token in rule.operation.split(OPERATION_SEPARATOR):
        assert _classify(token) == ("endpoint", True), f"{rule.code} declares {token!r}, which the published document does not serve"


@pytest.mark.parametrize("rule", RULES, ids=lambda rule: rule.code)
def test_every_rule_is_tested_where_it_says(rule):
    """The CLAIM again: a class that asserts on messages alone proves the wording, never the contract a client maps."""

    path, _, class_name = rule.tested_by.partition("::")
    file = BACKEND_ROOT / path

    assert file.is_file(), f"{rule.code} cites {path}, which does not exist"

    declared = _declared_classes(file)

    assert class_name in declared, f"{rule.code} cites {rule.tested_by}, and that file declares {sorted(declared)}"
    assert _test_class_asserts_code(rule.tested_by, rule.code), f"{rule.tested_by} never asserts on {rule.code}"


# No separate check that a `RULES` row claims no `UNENFORCED` subject: the pairing below executes
# each entry, so a rule that starts refusing a declared state fails that entry's own test.
@pytest.mark.parametrize("entry", UNENFORCED, ids=lambda entry: entry.subject)
def test_every_unenforced_entry_names_the_rule_a_reader_would_expect(entry):
    """`UNENFORCED`'s entry bar, as a check: a state sitting near no rule surprises nobody, so it is a comment rather than a row."""

    assert entry.near, f"'{entry.subject}' names no adjacent rule and so clears no entry bar"

    defined = _codes_in(APP_ROOT, skip=DECLARATION)
    unknown = [code for code in entry.near if code not in defined]

    assert not unknown, f"'{entry.subject}' sits near {unknown}, which the application defines nowhere"


@pytest.mark.parametrize("entry", UNENFORCED, ids=lambda entry: entry.subject)
def test_every_unenforced_surface_resolves(entry):
    """A dead surface is the rot this catches: an entry claiming a person can see the state, pointing at a page that is gone."""

    if not entry.surfaced_by:
        return

    served = _page_serves(entry.surfaced_by) if entry.surfaced_by.startswith("/") else (REPO_ROOT / entry.surfaced_by).is_file()

    assert served, f"'{entry.subject}' is surfaced by {entry.surfaced_by}, which resolves to no file"


def test_a_surface_resolves_through_a_route_group_and_never_to_the_groups_own_name(tmp_path: Path):
    """A synthetic tree, so the arm is pinned whether or not a page in the real one sits in a group today."""

    (tmp_path / "admin" / "(current-saison)" / "action_required").mkdir(parents=True)
    (tmp_path / "admin" / "(current-saison)" / "action_required" / "page.tsx").touch()

    assert _page_serves("/admin/action_required", tmp_path)
    assert not _page_serves("/admin/(current-saison)/action_required", tmp_path)
    assert not _page_serves("/admin/elsewhere", tmp_path)


@pytest.mark.parametrize("entry", UNENFORCED, ids=lambda entry: entry.subject)
def test_every_anchor_a_reason_names_resolves(entry):
    """The entry's argument, held to the bar its three addressed fields meet.

    A reason arguing from a rule, a page or an index renamed away reads as evidence and is none.
    """

    unresolved = []
    for token in _REASON_TOKEN.findall(entry.reason):
        kind, resolved = _classify(token)
        if resolved is False:
            unresolved.append(f"`{token}` ({kind})")

    assert not unresolved, f"'{entry.subject}' argues from {unresolved}, which this repository answers for nowhere"


def test_an_endpoint_resolves_against_the_whole_published_path():
    """The second token ends the published season route and names no route at all."""

    assert _classify("PATCH /saisons/{saison_id}") == ("endpoint", True)
    assert _classify("PATCH /{saison_id}") == ("endpoint", False)


def test_every_kind_of_anchor_a_reason_names_resolves_at_least_once():
    """Per kind: one arm resolving whatever the trees spell satisfies a bare floor for all of them.

    A listing that answers nothing is then named here, rather than reaching
    `fl_backend/tests/core/test_domain.py :: test_every_anchor_a_reason_names_resolves` alone, as
    reasons that invented their evidence.
    """

    present: set[str] = set()
    resolved: set[str] = set()
    for entry in UNENFORCED:
        for token in _REASON_TOKEN.findall(entry.reason):
            kind, answer = _classify(token)
            if answer is None:
                continue
            present.add(kind)
            if answer:
                resolved.add(kind)

    assert present, "no reason names anything with an address, so the per-entry sweep passed over nothing"
    assert present == resolved, f"nothing resolved for {sorted(present - resolved)}, so the listing behind that kind answers for nothing"


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
