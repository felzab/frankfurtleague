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
PROTOCOL_CODES = frozenset({"REQ-AUTH-001", "REQ-AUTH-002", "REQ-AUTH-003", "REQ-AUTH-004", "REQ-VAL-001", "REQ-OID-001"})

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
def _declared_classes(file: Path) -> frozenset[str]:
    """Every class the file declares, at any nesting depth.

    Walked rather than read off `tree.body`, because a case class nested inside another would
    otherwise report as missing. Cached across the rules citing the same file.
    """

    tree = ast.parse(file.read_text(encoding="utf-8"))

    return frozenset(node.name for node in ast.walk(tree) if isinstance(node, ast.ClassDef))


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

    used_actions = {reference.on_target_change for reference in REFERENCES} | {reference.on_target_removed for reference in REFERENCES}
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
def test_every_rule_is_implemented_by_a_callable(rule):
    assert callable(_import_symbol(rule.implemented_by))


@pytest.mark.parametrize("rule", RULES, ids=lambda rule: rule.code)
def test_every_rule_names_a_test_that_exists(rule):
    """Parsed rather than imported: the AST needs no fixtures and cannot run another module's collection-time code."""

    path, _, class_name = rule.tested_by.partition("::")
    file = BACKEND_ROOT / path

    assert file.is_file(), f"{rule.code} cites {path}, which does not exist"

    declared = _declared_classes(file)

    assert class_name in declared, f"{rule.code} cites {rule.tested_by}, and that file declares {sorted(declared)}"


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
