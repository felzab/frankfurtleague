"""
What makes `app/core/domain.py` a checked declaration rather than a second document.

The module states the domain model as data: seven aggregates over nine collections, twelve references with
a referential action each, thirty-odd field policies and thirteen refusal rules. None of it runs, so
without this file it would drift exactly the way a comment drifts -- silently, and only discovered by
somebody who trusted it.

Every assertion here answers one question about that declaration:

  • does it COVER the system?      every collection in exactly one aggregate; every `REQ-*` code the
                                   application defines present, and no invented ones
  • does it NAME real things?      every field path resolves against a model or a validator, every
                                   `implemented_by` imports, every `tested_by` file and class exist
  • is it still a DECLARATION?     no application module imports it

The fourth is the one worth defending: the moment production code reads this module, it becomes an engine
a write can forget to consult, which is the design ADR-0066 rejected.
"""

import ast
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
from app.core.constraints import COLLECTION_VALIDATORS
from app.core.domain import (
    AGGREGATES,
    FIELD_POLICIES,
    REFERENCES,
    RULES,
    UNENFORCED,
    Editability,
)

BACKEND_ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = BACKEND_ROOT / "app"

# The READ model of each collection that has one. `saison_teams` and `saison_spieler` are absent because
# neither has a model of the ROW -- their fields are declared only by their `$jsonSchema`, which is why
# field resolution below consults both sources rather than either alone.
ROOT_MODELS: Mapping[str, type[BaseModel]] = {
    "saisons": FLSaison,
    "spieltage": FLSpieltag,
    "spiele": FLSpiel,
    "teams": FLTeam,
    "spieler": FLSpieler,
    "spielorte": FLSpielort,
    "schiedsrichter": FLSchiedsrichter,
}

# Codes that are NOT domain rules and therefore have no row in `RULES`. Each is a property of the
# transport rather than of the league: who you are, whether the body parses, whether an id is an ObjectId.
# They live in `app/core/`, which is what the coverage test below keys on -- so this set is a statement
# about a boundary rather than an exception list that grows.
PROTOCOL_CODES = frozenset({"REQ-AUTH-001", "REQ-AUTH-002", "REQ-AUTH-003", "REQ-AUTH-004", "REQ-VAL-001", "REQ-OID-001"})

_CODE_PATTERN = "REQ-"


def _codes_in(root: Path) -> set[str]:
    """Every `REQ-*` code appearing anywhere under `root`, comments included."""

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


def _validator_properties(collection: str) -> Mapping[str, Any]:
    return COLLECTION_VALIDATORS[collection]["$jsonSchema"]["properties"]


def _resolves_in_validator(collection: str, path: str) -> bool:
    """Walk a dotted path through the collection's `$jsonSchema`."""

    properties = _validator_properties(collection)
    *ancestors, leaf = path.split(".")
    for segment in ancestors:
        nested = properties.get(segment)
        if not isinstance(nested, Mapping) or "properties" not in nested:
            return False
        properties = nested["properties"]
    return leaf in properties


def _resolves_in_model(collection: str, path: str) -> bool:
    """
    Whether a SINGLE-segment path is a field of the collection's read model.

    Only one segment, deliberately: a nested path through a Pydantic union -- `team1_quelle.spiel_nr`,
    whose annotation is a discriminated union of two variants -- has no single answer, and the validator
    resolves those completely. So the model is consulted for the fields the validator lacks, which are
    exactly the derived ones, and those are all top-level.
    """

    model = ROOT_MODELS.get(collection)

    return model is not None and "." not in path and path in model.model_fields


def _resolves(collection: str, path: str) -> bool:
    return _resolves_in_validator(collection, path) or _resolves_in_model(collection, path)


def _import_symbol(dotted: str) -> Any:
    module_path, _, symbol = dotted.rpartition(".")
    module = importlib.import_module(module_path)

    return getattr(module, symbol)


# =====================================================================================================
# DOES IT COVER THE SYSTEM
# =====================================================================================================


def test_every_collection_belongs_to_exactly_one_aggregate():
    """
    A collection in two aggregates has two consistency boundaries, which is not a boundary.

    Keyed on `COLLECTION_VALIDATORS` rather than a list here, so adding a tenth collection to the
    database fails this test until somebody decides which aggregate owns it.
    """

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
    """
    The coverage assertion, and the reason this file is not decoration.

    A refusal added to a write path without a row here is a rule nothing documents -- so the scan is over
    `app/api/`, where the domain lives, and `app/core/` is excluded because its codes describe the
    transport (`PROTOCOL_CODES`).
    """

    declared = {rule.code for rule in RULES}
    in_api = _codes_in(APP_ROOT / "api")

    assert not (in_api - declared - PROTOCOL_CODES), f"refusals in app/api with no row in RULES: {sorted(in_api - declared - PROTOCOL_CODES)}"
    assert not (declared - in_api), f"RULES names codes no endpoint raises: {sorted(declared - in_api)}"


def test_the_protocol_codes_are_the_ones_outside_the_api_layer():
    """
    Pins the boundary the test above relies on.

    If a code moves out of `app/core/` into a slice, or a new transport-level code appears, this fails
    rather than letting `PROTOCOL_CODES` silently start excusing a real domain rule.
    """

    in_core = _codes_in(APP_ROOT / "core") - {rule.code for rule in RULES}

    assert in_core == PROTOCOL_CODES


def test_no_rule_code_is_declared_twice():
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


# =====================================================================================================
# DOES IT NAME REAL THINGS
# =====================================================================================================


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
    """
    `DERIVED` claims the field is computed on read and stored nowhere, and this is what makes that true.

    The distinction against `COMPOSED` is the whole point of having two values: `spiele.ergebnis` is also
    never accepted from a client, and it IS stored -- so calling it derived would assert something false
    about the database.
    """

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
    """
    A `tested_by` citation is only worth having if it is checked; a renamed class makes it a dead link.

    Parsed rather than imported: reading the class names out of the AST needs no fixtures and cannot run
    another module's collection-time code.
    """

    path, _, class_name = rule.tested_by.partition("::")
    file = BACKEND_ROOT / path

    assert file.is_file(), f"{rule.code} cites {path}, which does not exist"

    tree = ast.parse(file.read_text(encoding="utf-8"))
    declared = {node.name for node in tree.body if isinstance(node, ast.ClassDef)}

    assert class_name in declared, f"{rule.code} cites {rule.tested_by}, and that file declares {sorted(declared)}"


def test_every_declaration_carries_its_reason():
    """
    An empty `boundary`, `note` or `reason` is the failure mode this module exists to prevent.

    The rows are readable without them; they are just no longer an explanation, and a table of actions
    with no reasons is what a reader would have had to reconstruct from the code anyway.
    """

    for aggregate in AGGREGATES:
        assert aggregate.boundary.strip(), f"{aggregate.name} states no boundary"
    for reference in REFERENCES:
        assert reference.note.strip(), f"{reference.source}.{reference.fields[0]} states no reason"
    for policy in FIELD_POLICIES:
        if policy.editability is not Editability.EDITABLE:
            assert policy.condition.strip(), f"{policy.collection}.{policy.field} is {policy.editability.value} and says nothing about when"
    for entry in UNENFORCED:
        assert entry.reason.strip(), f"'{entry.subject}' is unenforced and states no reason"


# =====================================================================================================
# IS IT STILL A DECLARATION
# =====================================================================================================


def test_no_application_module_imports_the_domain_model():
    """
    The invariant that keeps this a declaration.

    A production caller reading these tables turns them into an engine every write must remember to
    consult -- which is bypassable, and is the design ADR-0066 rejected in favour of the refusal living
    at the endpoint that owns the write. Tests and documentation may read it; nothing under `app/` may.
    """

    importers = [
        path.relative_to(BACKEND_ROOT).as_posix()
        for path in sorted(APP_ROOT.rglob("*.py"))
        if path.name != "domain.py" and "core.domain" in path.read_text(encoding="utf-8")
    ]

    assert not importers, f"application code reads the declaration: {importers}"
