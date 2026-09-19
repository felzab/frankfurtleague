"""
CORE · the source sweeps holding a rule judged on a read to the write that closes its race

A snapshot re-validates no read, so a rule decided on one is held only where every writer that
judges it also WRITES the document that read is scoped by: the season a count is taken in, or the
club, the venue or the referee a retirement stamps. The helpers below do that, and what this module
proves is that no site can reach one of those rules past its helper, and that no caller can reach a
helper without the transaction's session: the parameter is required, so an omission is a `TypeError`
at the call rather than a race under a rule that reads as held.

`tests/api/test_capacity_isolation.py` and `tests/api/test_reference_isolation.py` drive the
conflicts themselves against a replica set.
"""

import ast
import inspect
from collections.abc import Callable
from typing import Any

import pytest

from app.api.spiele.admin_router import patch_spiel_data
from app.api.spiele.crud import anchor_a_booked_referee, anchor_a_booked_venue, pull_booked_referee, pull_booked_venue
from app.api.spieler.admin_router import _refuse_a_full_squad
from app.api.spieltage.admin_router import _refuse_an_out_of_order_beginn
from app.api.teams.crud import pull_a_club_to_enter, refuse_a_full_gruppe
from tests.core.app_source import (
    WRITE_HELPERS,
    app_calls,
    callee,
    calls_in,
    carries_session,
    declared,
    module_of,
    session_handoffs,
    transactional_callbacks,
)

# The `app/core/crud.py` helper each anchor is made through: one log row carrying the filter and the
# count, where `patch_one_in_db` would log a whole season pre-image on every bounded write.
ANCHOR_HELPER = "patch_many_in_db"

# The one field every anchor advances. One rather than one per rule: a further rule the season's own
# bounds decide takes it with no decision, and two admin writes contending is a retry.
ANCHOR_FIELD = "bounded_writes"

# Each choke point, the rule it decides, and every scope that may reach that rule. Pinned rather
# than counted: what reopens a race is a site added beside the helper, which a count never names.
CHOKE_POINTS: tuple[tuple[Callable[..., Any], str, frozenset[str]], ...] = (
    (
        refuse_a_full_gruppe,
        "find_entry_refusal",
        frozenset({"app/api/teams/crud.py :: refuse_a_full_gruppe"}),
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
    # The acceptance reaches the rule through the helper, so it belongs among the callers: a site named
    # beside the helper instead is one judging the count outside the season's own write.
    "refuse_a_full_gruppe": frozenset(
        {
            "app/api/teams/admin_router.py :: enter_the_club",
            "app/api/teams/admin_router.py :: move_the_club",
            "app/api/bewerbungen/admin_router.py :: accept_and_enter_the_school",
        }
    ),
    "_refuse_a_full_squad": frozenset(
        {
            "app/api/spieler/admin_router.py :: add_the_player",
            "app/api/spieler/admin_router.py :: move_the_player",
            "app/api/spieler/admin_router.py :: bring_the_player_back",
        }
    ),
    "_refuse_an_out_of_order_beginn": frozenset({"app/api/spieltage/admin_router.py :: redate_the_matchday"}),
    "pull_a_club_to_enter": frozenset(
        {
            "app/api/teams/admin_router.py :: enter_the_club",
            "app/api/teams/admin_router.py :: hand_the_row_over",
            "app/api/bewerbungen/admin_router.py :: accept_and_enter_the_school",
        }
    ),
    # One callback for both routes that book a fixture, the replay going through the editor's own.
    "anchor_a_booked_venue": frozenset({"app/api/spiele/admin_router.py :: write_and_resolve_the_bracket"}),
    "anchor_a_booked_referee": frozenset({"app/api/spiele/admin_router.py :: write_and_resolve_the_bracket"}),
}

CHOKE_POINT_FUNCTIONS = tuple(function for function, _, _ in CHOKE_POINTS)

# Every anchoring helper, and the collection dependency its anchor writes spelled as the parameter it takes.
ANCHORS: tuple[tuple[Callable[..., Any], str], ...] = (
    *((function, "saisons_collection") for function in CHOKE_POINT_FUNCTIONS),
    (pull_a_club_to_enter, "teams_collection"),
    (anchor_a_booked_venue, "spielorte_collection"),
    (anchor_a_booked_referee, "schiedsrichter_collection"),
)

ANCHORING_FUNCTIONS = tuple(function for function, _ in ANCHORS)

# Every helper whose read a guarded refusal is judged on. The two booking reads sit apart from their
# anchors, which the save takes once the whole payload is judged, so they are held here by name.
JUDGED_READS: tuple[Callable[..., Any], ...] = (*CHOKE_POINT_FUNCTIONS, pull_a_club_to_enter, pull_booked_venue, pull_booked_referee)

# Every scope reaching a rule judged BESIDE its anchor rather than inside the helper taking it, or
# choosing what such a rule judges: a site added beside these judges a row nothing conflicts with.
JUDGED_BESIDE_THE_ANCHOR: dict[str, frozenset[str]] = {
    # Beside the club's helper: the replacement asks `REQ-ENTER-005` in an order `find_replacement_refusal` keeps.
    "find_club_entry_refusal": frozenset(
        {
            "app/api/teams/admin_router.py :: enter_the_club",
            "app/api/bewerbungen/admin_router.py :: accept_and_enter_the_school",
            "app/api/teams/services.py :: find_replacement_refusal",
        }
    ),
    "find_replacement_refusal": frozenset({"app/api/teams/admin_router.py :: hand_the_row_over"}),
    # Beside the save's anchors, which it takes once the whole payload is judged, off the one set `judge` hands back.
    "find_booking_refusal": frozenset({"app/api/spiele/admin_router.py :: judge"}),
    "find_clash_refusal": frozenset({"app/api/spiele/admin_router.py :: judge"}),
    "find_references_to_anchor": frozenset({"app/api/spiele/admin_router.py :: judge"}),
    "find_new_bookings": frozenset(
        {"app/api/spiele/services.py :: find_booking_refusal", "app/api/spiele/services.py :: find_references_to_anchor"}
    ),
    "find_claims_made": frozenset({"app/api/spiele/admin_router.py :: judge", "app/api/spiele/services.py :: find_references_to_anchor"}),
    "find_slot_claims": frozenset(
        {
            "app/api/spiele/services.py :: find_claims_made",
            # The fault report's read and its judgement: a report writes nothing, so it has nothing to anchor.
            "app/api/spiele/crud.py :: find_bracket_faults",
            "app/api/spiele/services.py :: find_double_bookings",
        }
    ),
}


def _app_callers_of(called: str) -> set[str]:
    """Every scope under `app/` calling `called`, the module before the innermost function around it."""

    return {f"{module} :: {scope}" for module, scope, call in app_calls() if callee(call) == called}


def _anchor_calls(function: Callable[..., Any]) -> list[ast.Call]:
    """Every `patch_many_in_db` one function makes, read off its own source."""

    return [call for call in ast.walk(declared(function)) if isinstance(call, ast.Call) and callee(call) == ANCHOR_HELPER]


def _keyword(call: ast.Call, name: str) -> ast.expr | None:
    return next((keyword.value for keyword in call.keywords if keyword.arg == name), None)


@pytest.mark.parametrize("function", ANCHORING_FUNCTIONS, ids=lambda function: function.__name__)
def test_a_choke_point_cannot_be_called_without_the_transactions_session(function: Callable[..., Any]):
    """Forgetting the anchor write means forgetting the session, which is a `TypeError` at the call.

    Keyword-only and undefaulted, so neither a positional argument nor an omission reaches the body.
    """

    session = inspect.signature(function).parameters["session"]

    assert session.kind is inspect.Parameter.KEYWORD_ONLY
    assert session.default is inspect.Parameter.empty


@pytest.mark.parametrize(("function", "rule", "sites"), CHOKE_POINTS, ids=lambda value: getattr(value, "__name__", ""))
def test_every_site_reaching_the_rule_is_pinned(function: Callable[..., Any], rule: str, sites: frozenset[str]):
    """A site added beside a helper rather than through it is what reopens one of these races, and only this names it."""

    assert _app_callers_of(rule) == sites


@pytest.mark.parametrize(("rule", "sites"), sorted(JUDGED_BESIDE_THE_ANCHOR.items()), ids=lambda value: value if isinstance(value, str) else "")
def test_every_site_judging_a_rule_beside_its_anchor_is_pinned(rule: str, sites: frozenset[str]):
    assert _app_callers_of(rule) == sites


def test_every_callback_judging_a_retired_club_reads_the_club_through_its_helper():
    judging = {site for rule in ("find_club_entry_refusal", "find_replacement_refusal") for site in JUDGED_BESIDE_THE_ANCHOR[rule]}

    assert judging - {"app/api/teams/services.py :: find_replacement_refusal"} == CALLERS["pull_a_club_to_enter"]


def test_every_transaction_judging_a_booking_anchors_it():
    """The anchors sit in the callback around `judge`, which the preview reaches too.

    A second transaction handed `judge` that anchors nothing books a row no retirement conflicts with.
    """

    judging_callbacks = {
        handoff.where for handoff in session_handoffs() if handoff.called == "judge" and handoff.declared_in == module_of(patch_spiel_data)
    }

    assert judging_callbacks, "no transaction is seen handing `judge` its session, so the clause below is vacuous"
    assert judging_callbacks == CALLERS["anchor_a_booked_venue"] == CALLERS["anchor_a_booked_referee"]


@pytest.mark.parametrize(("function", "collection_parameter"), ANCHORS, ids=lambda value: getattr(value, "__name__", ""))
def test_a_choke_point_anchors_the_document_its_read_is_scoped_by(function: Callable[..., Any], collection_parameter: str):
    """Drop the `$inc` and this fails, where the refusal itself and every suite over it stay green."""

    anchors = _anchor_calls(function)

    assert len(anchors) == 1, f"{function.__name__} makes {len(anchors)} anchor writes, and the race is closed by exactly one"

    anchor = anchors[0]
    collection = _keyword(anchor, "collection")

    assert isinstance(collection, ast.Name) and collection.id == collection_parameter
    assert carries_session(anchor), "the anchor commits on its own, so no rival contends with it"

    db_filter = _keyword(anchor, "db_filter")

    assert isinstance(db_filter, ast.Dict)
    assert [key.value for key in db_filter.keys if isinstance(key, ast.Constant)] == ["_id"], (
        "the anchor is keyed on something other than one document, so two writers of it may miss each other"
    )


def test_every_anchor_advances_one_field():
    """Spelled at every site rather than shared from one, so this is what holds the spellings together.

    An `$inc` too: a `$set` of a constant rewrites nothing the second time and joins no write set.
    """

    updates = {function.__name__: _keyword(_anchor_calls(function)[0], "update") for function in ANCHORING_FUNCTIONS}

    assert all(update is not None for update in updates.values()), f"an anchor passes no `update` at all: {updates}"

    spelled = {name: ast.unparse(update) for name, update in updates.items() if update is not None}

    assert set(spelled.values()) == {"{'$inc': {'" + ANCHOR_FIELD + "': 1}}"}, spelled


@pytest.mark.parametrize("function", JUDGED_READS, ids=lambda function: function.__name__)
def test_a_choke_point_judges_on_reads_of_its_own_session(function: Callable[..., Any]):
    """Held by NAME where `tests/core/test_write_shapes.py` holds these by reach.

    A choke point called from no transactional callback leaves that sweep's population and stays in
    this one, and a read left off the session judges what committed last.
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
