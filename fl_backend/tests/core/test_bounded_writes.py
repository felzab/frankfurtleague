"""
CORE · the source sweeps holding a count-then-insert rule to the write that closes its race

A count is a read, and a snapshot re-validates no read, so a rule decided on one is held only where
every writer that judges it also WRITES the document the count is scoped by. Three helpers do that
here, and what this module proves is that no site can reach one of those rules past its helper, and
that no caller can reach a helper without the transaction's session: the parameter is required, so
an omission is a `TypeError` at the call rather than a race under a rule that reads as held.

`tests/api/test_capacity_isolation.py` drives the conflict itself against a replica set.
"""

import ast
import inspect
from typing import Any, Callable

import pytest

from app.api.spieler.admin_router import _refuse_a_full_squad
from app.api.spieltage.admin_router import _refuse_an_out_of_order_beginn
from app.api.teams.crud import refuse_a_full_gruppe
from tests.core.app_source import WRITE_HELPERS, app_calls, callee, calls_in, carries_session, declared, module_of, transactional_callbacks

# The `app/core/crud.py` helper each anchor is made through: one log row carrying the filter and the
# count, where `patch_one_in_db` would log a whole season pre-image on every bounded write.
ANCHOR_HELPER = "patch_many_in_db"

# The collection dependency every anchor writes, spelled as the parameter its helper takes.
ANCHOR_COLLECTION = "saisons_collection"

# The one field all three advance. One rather than one per rule: a fourth rule the season's own
# bounds decide takes it with no decision, and two admin writes contending is a retry.
ANCHOR_FIELD = "bounded_writes"

# Each choke point, the rule it decides, and every scope that may reach that rule. Pinned rather
# than counted: what reopens a race is a site added beside the helper, which a count never names.
CHOKE_POINTS: tuple[tuple[Callable[..., Any], str, frozenset[str]], ...] = (
    (
        refuse_a_full_gruppe,
        "find_entry_refusal",
        frozenset(
            {
                "app/api/teams/crud.py :: refuse_a_full_gruppe",
                # The one site outside the helper, which `app/core/domain.py :: UNENFORCED` declares.
                "app/api/bewerbungen/admin_router.py :: accept_and_enter_the_school",
            }
        ),
    ),
    (
        _refuse_a_full_squad,
        "find_squad_capacity_refusal",
        frozenset({"app/api/spieler/admin_router.py :: _refuse_a_full_squad"}),
    ),
    (
        _refuse_an_out_of_order_beginn,
        "find_spieltag_order_refusal",
        frozenset({"app/api/spieltage/admin_router.py :: _refuse_an_out_of_order_beginn"}),
    ),
)

# Every scope calling a choke point, each of which is the callback an endpoint runs its transaction
# over -- so the session it hands on is a transaction's rather than a bare session's.
CALLERS: dict[str, frozenset[str]] = {
    "refuse_a_full_gruppe": frozenset({"app/api/teams/admin_router.py :: enter_the_club", "app/api/teams/admin_router.py :: move_the_club"}),
    "_refuse_a_full_squad": frozenset(
        {
            "app/api/spieler/admin_router.py :: add_the_player",
            "app/api/spieler/admin_router.py :: move_the_player",
            "app/api/spieler/admin_router.py :: bring_the_player_back",
        }
    ),
    "_refuse_an_out_of_order_beginn": frozenset({"app/api/spieltage/admin_router.py :: redate_the_matchday"}),
}

CHOKE_POINT_FUNCTIONS = tuple(function for function, _, _ in CHOKE_POINTS)


def _app_callers_of(called: str) -> set[str]:
    """Every scope under `app/` calling `called`, the module before the innermost function around it."""

    return {f"{module} :: {scope}" for module, scope, call in app_calls() if callee(call) == called}


def _anchor_calls(function: Callable[..., Any]) -> list[ast.Call]:
    """Every `patch_many_in_db` one function makes, read off its own source."""

    return [call for call in ast.walk(declared(function)) if isinstance(call, ast.Call) and callee(call) == ANCHOR_HELPER]


def _keyword(call: ast.Call, name: str) -> ast.expr | None:
    return next((keyword.value for keyword in call.keywords if keyword.arg == name), None)


@pytest.mark.parametrize("function", CHOKE_POINT_FUNCTIONS, ids=lambda function: function.__name__)
def test_a_choke_point_cannot_be_called_without_the_transactions_session(function: Callable[..., Any]):
    """The answer to the objection the register raised: forgetting the write means forgetting the session, which is a `TypeError`.

    Keyword-only and undefaulted, so neither a positional argument nor an omission reaches the body.
    """

    session = inspect.signature(function).parameters["session"]

    assert session.kind is inspect.Parameter.KEYWORD_ONLY
    assert session.default is inspect.Parameter.empty


@pytest.mark.parametrize(("function", "rule", "sites"), CHOKE_POINTS, ids=lambda value: getattr(value, "__name__", ""))
def test_every_site_reaching_the_rule_is_pinned(function: Callable[..., Any], rule: str, sites: frozenset[str]):
    """A site added beside a helper rather than through it is what reopens one of these races, and only this names it."""

    assert _app_callers_of(rule) == sites


@pytest.mark.parametrize("function", CHOKE_POINT_FUNCTIONS, ids=lambda function: function.__name__)
def test_a_choke_point_anchors_the_season_the_count_is_scoped_by(function: Callable[..., Any]):
    """Drop the `$inc` and this fails, where the refusal itself and every suite over it stay green."""

    anchors = _anchor_calls(function)

    assert len(anchors) == 1, f"{function.__name__} makes {len(anchors)} anchor writes, and the race is closed by exactly one"

    anchor = anchors[0]
    collection = _keyword(anchor, "collection")

    assert isinstance(collection, ast.Name) and collection.id == ANCHOR_COLLECTION
    assert carries_session(anchor), "the anchor commits on its own, so no rival contends with it"

    db_filter = _keyword(anchor, "db_filter")

    assert isinstance(db_filter, ast.Dict)
    assert [key.value for key in db_filter.keys if isinstance(key, ast.Constant)] == ["_id"], (
        "the anchor is keyed on something other than the season, so two writers of one season may miss each other"
    )


def test_the_three_anchors_advance_one_field():
    """Spelled at three sites rather than shared from one, so this is what holds the three spellings together."""

    updates = {function.__name__: _keyword(_anchor_calls(function)[0], "update") for function in CHOKE_POINT_FUNCTIONS}

    assert all(update is not None for update in updates.values()), f"an anchor passes no `update` at all: {updates}"

    spelled = {name: ast.unparse(update) for name, update in updates.items() if update is not None}

    assert set(spelled.values()) == {"{'$inc': {'" + ANCHOR_FIELD + "': 1}}"}, spelled


@pytest.mark.parametrize("function", CHOKE_POINT_FUNCTIONS, ids=lambda function: function.__name__)
def test_a_choke_point_judges_on_reads_of_its_own_session(function: Callable[..., Any]):
    """`tests/core/test_write_shapes.py` sweeps a callback's LEXICAL body, so a helper it calls answers here instead.

    A read left off the session judges what committed last, and the retry re-decides on that same
    stale figure.
    """

    name = function.__name__
    module = module_of(function)
    reads = [
        (callee(call), carries_session(call))
        for scope, call in calls_in(declared(function), name)
        if callee(call) in {"count_documents", "find_one", "pull_one_from_db", "pull_many_from_db"}
    ]

    assert reads, f"{module.name} :: {name} is seen making no read at all, so the clause below is vacuous"
    assert [read for read, carries in reads if not carries] == []


@pytest.mark.parametrize(("function", "callers"), sorted(CALLERS.items()), ids=lambda value: value if isinstance(value, str) else "")
def test_every_caller_hands_the_choke_point_a_transactions_session(function: str, callers: frozenset[str]):
    """Both halves: the callers are pinned, and each is the callback a `with_transaction` runs.

    A caller outside one hands a session that commits on its own, which no rival can conflict with.
    """

    assert _app_callers_of(function) == callers

    transactional = {callback.where for callback in transactional_callbacks(WRITE_HELPERS)}

    assert callers <= transactional, f"{sorted(callers - transactional)} call {function} outside any transaction"

    for module, scope, call in app_calls():
        if callee(call) == function:
            assert carries_session(call), f"{module} :: {scope} reaches {function} without the session"
