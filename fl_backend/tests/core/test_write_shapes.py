import ast
from dataclasses import dataclass
from importlib import import_module
from pathlib import Path
from typing import Any, Callable, Iterator, Mapping, get_type_hints

from app.api.bewerbungen.services import parse_new_club
from app.api.saisons.services import RECORDED_FACT_FIELDS, _a_side_is_off_the_draw, holds_a_recorded_fact
from app.api.spiele.schemas import FLPatchSpielDataPayload
from app.api.spiele.services import apply_payload_to_spiel
from app.api.teams.admin_router import post_team
from app.core.collections import Collection
from app.core.constraints import COLLECTION_VALIDATORS
from app.core.domain import AGGREGATES
from app.main import SYSTEM_WRITE_ROUTERS, WRITE_ROUTERS
from tests.core.app_source import (
    APP_ROOT,
    BACKEND_ROOT,
    COLLECTION_ARGUMENT_SUFFIX,
    DRIVER_READS,
    READ_HELPERS,
    REMOVAL_HELPERS,
    WRITE_HELPERS,
    app_declares,
    callee,
    carries_session,
    crud_helpers_taking_a_session,
    declared,
    driver_reads_named_by_the_crud_header,
    parsed,
    removals,
    session_carriers,
    session_handoffs,
    transactional_callbacks,
)

# The one of the two that keeps NO pre-image, so the filter is all the log holds of what it took --
# and the log stores a filter's values as text (`app/core/crud.py :: erase_many_from_db`).
ERASURE_HELPER = "erase_many_from_db"

# The aggregate roots a season PARTITIONS: every row belongs to one season, so a removal there takes
# a season's set or every season's. A MEMBER is out -- a squad row is legitimately reached through
# the person it belongs to.
SEASON_PARTITIONED_ROOTS: frozenset[str] = frozenset(
    str(aggregate.root) for aggregate in AGGREGATES if "saison_id" in COLLECTION_VALIDATORS[aggregate.root]["$jsonSchema"].get("required", [])
)

# Every `app/core/crud.py` helper that reaches a document, the removals included: each takes a
# `session`, and each commits on its own without one.
SESSION_TAKING_HELPERS = WRITE_HELPERS | REMOVAL_HELPERS

# What a save may move on a fixture while nothing counts as recorded against it: rescheduling is
# what a replace and an undraw are FOR, and `delete_many_from_db` keeps both in the images it logs.
NOT_A_RECORD: frozenset[str] = frozenset({"datum", "uhrzeit"})

# The whole of what the recorded-fact window reads, the private helper included. A helper outside this
# tuple takes its own reads out of every clause below, which is what the closure clause holds it to.
RECORDED_FACT_PREDICATES: tuple[Callable[..., Any], ...] = (holds_a_recorded_fact, _a_side_is_off_the_draw)

# What a key composed at run time becomes in a path: the projection clause can say nothing about
# such a key, so it lands in that clause's failure list rather than dropping out of the sweep.
COMPOSED_KEY = "<composed at run time>"

# Every package under `app/api/` declaring a services module, pinned beside the glob that finds
# them: a glob narrowing to nothing would pass every clause below over no module at all.
# `app/api/system/` declares none.
SERVICE_PACKAGES: frozenset[str] = frozenset(
    {"aktionen", "bewerbungen", "kontakte", "saisons", "schiedsrichter", "spiele", "spieler", "spielorte", "spieltage", "teams"}
)

# The driver itself, and the two modules that hand a live handle out. `bson` is deliberately
# absent: an `ObjectId` is a value, and `app/api/aktionen/services.py` composes one.
DATABASE_MODULES: tuple[str, ...] = ("pymongo", "motor", "app.core.db", "app.core.dependencies")

# Where a handle's annotations are declared. Read rather than listed, so a collection alias added
# there is covered here with no edit.
DEPENDENCIES_MODULE = APP_ROOT / "core" / "dependencies.py"


def _model_dump_keywords(function: Callable[..., Any]) -> list[frozenset[tuple[str, str]]]:
    """Every `model_dump` one function calls, as the keywords it passes -- which is what decides the shape of the values dumped."""

    return [
        frozenset((keyword.arg or "**", ast.unparse(keyword.value)) for keyword in call.keywords)
        for call in ast.walk(declared(function))
        if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and call.func.attr == "model_dump"
    ]


def _subscripted_constants(functions: tuple[Callable[..., Any], ...]) -> set[str]:
    """Every key these functions name in a literal, read off the `get` calls they make."""

    return {
        argument.value
        for function in functions
        for call in ast.walk(declared(function))
        if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and call.func.attr == "get"
        for argument in call.args
        if isinstance(argument, ast.Constant) and isinstance(argument.value, str)
    }


def _fallback_free(node: ast.expr) -> ast.expr:
    """One receiver with its `or {}` guard stripped, which is how the window reaches a slot inside a side."""

    return node.values[0] if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.Or) and node.values else node


def _key_read(node: ast.AST) -> tuple[ast.expr, ast.expr] | None:
    """One key read as its receiver and the expression naming the key: `x.get("k")` and `x["k"]` alike."""

    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "get" and node.args:
        return node.func.value, node.args[0]

    if isinstance(node, ast.Subscript):
        return node.value, node.slice

    return None


def _read_chain(node: ast.AST) -> tuple[ast.expr, tuple[str, ...]] | None:
    """One key read as the expression it bottoms out on and the keys named along the way, or `None` where it reads no key."""

    read = _key_read(node)
    if read is None:
        return None

    receiver, key = read
    named = key.value if isinstance(key, ast.Constant) and isinstance(key.value, str) else COMPOSED_KEY
    beneath = _fallback_free(receiver)
    under = _read_chain(beneath)

    return (beneath, (named,)) if under is None else (under[0], (*under[1], named))


def _statement_nodes(node: ast.AST) -> Iterator[ast.AST]:
    """Every node under one statement, an annotation's own subtree left out: `Mapping[str, Any]` is a subscript that reads nothing."""

    for child in ast.iter_child_nodes(node):
        if isinstance(node, ast.AnnAssign) and child is node.annotation:
            continue

        yield child
        yield from _statement_nodes(child)


def _read_paths(functions: tuple[Callable[..., Any], ...]) -> set[str]:
    """Every dotted path these functions read off the fixture they are handed.

    Rooted rather than flattened: `team1.tore` is fetched where a top-level `tore` is not, and a
    sweep over the segments alone reads the two as one key.
    """

    paths: set[str] = set()
    for function in functions:
        declaration = declared(function)
        fixture = declaration.args.args[0].arg

        # The BODY alone, so the signature's own annotations are no part of what the predicate reads.
        for statement in declaration.body:
            for node in (statement, *_statement_nodes(statement)):
                chain = _read_chain(node)
                if chain is None:
                    continue

                bottom, named = chain
                path = ".".join(named)
                # A chain bottoming out anywhere but that argument keeps its receiver in the path, so
                # a read this sweep cannot place fails the clause below rather than dropping out of it.
                paths.add(path if isinstance(bottom, ast.Name) and bottom.id == fixture else f"{ast.unparse(bottom)}.{path}")

    return paths


def _projected_paths() -> frozenset[str]:
    """Every path the projection fetches, each prefix of one beside it: a side is read whole to reach the slot inside it."""

    return frozenset(".".join(path.split(".")[: depth + 1]) for path in RECORDED_FACT_FIELDS for depth in range(len(path.split("."))))


def _application_calls(function: Callable[..., Any]) -> set[str]:
    """Every function of the application's own that one function hands off to, by the name at the call site.

    A bare `ast.Name` would miss a helper reached through its module, taking its reads out of the
    closure.
    """

    return {callee(call) for call in ast.walk(declared(function)) if isinstance(call, ast.Call)} & app_declares()


def _model_copy_keys(function: Callable[..., Any]) -> set[str]:
    """The field names one function's `model_copy(update={...})` literal carries -- the document it composes."""

    return {
        key.value
        for call in ast.walk(declared(function))
        if isinstance(call, ast.Call)
        for keyword in call.keywords
        if keyword.arg == "update" and isinstance(keyword.value, ast.Dict)
        for key in keyword.value.keys
        if isinstance(key, ast.Constant) and isinstance(key.value, str)
    }


def _service_modules() -> list[Path]:
    """Every services module, off the DIRECTORY rather than off the purity below.

    One selected by the property under test drops out of the population the moment it breaks the
    rule; one selected by its path stays in and fails.
    """

    return sorted(APP_ROOT.glob("api/*/services.py"))


def _database_annotations() -> frozenset[str]:
    """Every name that annotates a live handle: the driver types `app/core/dependencies.py` imports, and the aliases built on them.

    Derived there rather than listed here, so a collection added to that module is covered with no
    edit.
    """

    tree = parsed(DEPENDENCIES_MODULE)
    driver = {
        alias.asname or alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and (node.module or "").startswith("pymongo")
        for alias in node.names
    }

    return frozenset(
        driver
        | {
            target.id
            for node in tree.body
            if isinstance(node, ast.Assign)
            for target in node.targets
            if isinstance(target, ast.Name) and {name.id for name in ast.walk(node.value) if isinstance(name, ast.Name)} & driver
        }
    )


def _annotation_names(annotation: ast.expr | None) -> set[str]:
    """Every name one annotation mentions, a dotted one's attribute included, so an alias reached through its module reads too."""

    if annotation is None:
        return set()

    return {node.id for node in ast.walk(annotation) if isinstance(node, ast.Name)} | {
        node.attr for node in ast.walk(annotation) if isinstance(node, ast.Attribute)
    }


def _parameters(tree: ast.Module) -> Iterator[tuple[str, ast.arg]]:
    """Every parameter one module declares, with the function around it -- every position, so one taken by keyword alone is read too."""

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            arguments = node.args
            for argument in [*arguments.posonlyargs, *arguments.args, *arguments.kwonlyargs, arguments.vararg, arguments.kwarg]:
                if argument is not None:
                    yield node.name, argument


def _imported_modules(tree: ast.Module) -> Iterator[str]:
    """Every module one module imports, by the name the import spells."""

    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            yield node.module or ""
        elif isinstance(node, ast.Import):
            yield from (alias.name for alias in node.names)


class TestWhatARemovalFilterMayName:
    """That a removal's filter is what BOUNDS it, that each names enough and only what it may, and which helper takes an application.

    Four clauses over one sweep, each failing its own way -- the method below names which.
    """

    def test_the_sweep_reads_every_removal_and_places_every_collection(self):
        """The floor under all three: a sweep matching nothing passes each clause below over any application at all."""

        found = removals()

        # Both helpers reached, so a clause is never green because one of them went unseen.
        assert {removal.helper for removal in found} == REMOVAL_HELPERS

        # Derived, so it needs no editing -- and pinned, so a derivation that silently empties is
        # caught rather than passing the season clause over nothing. `bewerbungen` is in the set, and
        # the retention sweep's erasures are what the clause below holds to one season.
        assert SEASON_PARTITIONED_ROOTS == {str(Collection.SPIELE), str(Collection.SPIELTAGE), str(Collection.BEWERBUNGEN)}

    def test_every_removal_is_keyed_on_a_field_compared_to_a_value(self):
        """Empty either `db_filter` in `undraw_spielplan` and this fails; the whole db tier does not.

        A season-scoped delete given `{}` takes every season's fixtures and matchdays, a `past`
        season's league table with them.
        """

        unbounded = [f"{removal.helper} on {removal.collection}" for removal in removals() if not removal.keyed_on]

        assert unbounded == []

    def test_a_removal_from_a_season_partitioned_root_names_its_season(self):
        """Narrow either delete to `{"_id": ...}` and this fails: one fixture would go where a season's set is the boundary."""

        unscoped = [
            f"{removal.helper} on {removal.collection}"
            for removal in removals()
            if removal.collection in SEASON_PARTITIONED_ROOTS and "saison_id" not in removal.keyed_on
        ]

        assert unscoped == []

    def test_every_removal_from_bewerbungen_is_an_erasure(self):
        """Swap one sweep call to `delete_many_from_db` and this fails.

        That helper logs a pre-image of exactly what the retention clocks destroy, and the filter
        clauses above pass either way: an erasure and a delete take the same arguments.
        """

        kept = [
            f"{removal.collection} is removed by {removal.helper}"
            for removal in removals()
            if removal.collection == str(Collection.BEWERBUNGEN) and removal.helper != ERASURE_HELPER
        ]

        assert kept == []

    def test_an_erasure_names_identities_and_nothing_else(self):
        """Add `nachname` beside the id and this fails: the log stores a filter's values as text, so it would outlive the erasure.

        Operators are passed over: an `$in` of ids is no quarrel of this rule. Keys at any depth, so
        one nested under one is read too.
        """

        preserved = [
            f"{removal.collection} is erased by {field}"
            for removal in removals()
            if removal.helper == ERASURE_HELPER
            for field in sorted(removal.names)
            if not field.startswith("$") and field != "_id" and not field.endswith("_id")
        ]

        assert preserved == []


class TestTheTwoSeasonRemovalsRunInOneOrder:
    """That the draw's replace and the undraw take the same collections in the same order.

    The two are written apart on purpose (`app/api/saisons/admin_router.py :: draw_the_whole_season`),
    so nothing but this holds the second to the first.
    """

    def test_the_replace_removes_in_the_same_order_as_the_undraw(self):
        """Reverse either pair and this fails: fixtures go first, so no log row or restore holds a fixture whose matchday is gone."""

        found = removals()
        drawn = [(removal.helper, removal.collection) for removal in found if removal.scope == "draw_the_whole_season"]
        undrawn = [(removal.helper, removal.collection) for removal in found if removal.scope == "undraw_the_whole_season"]

        # Both non-empty, or a renamed callback passes this by comparing two empty lists.
        assert drawn and undrawn, f"the draw contributes {len(drawn)} removals and the undraw {len(undrawn)}"

        assert drawn == undrawn


class TestEveryFieldAPatchWritesIsWeighedOrNamed:
    """That no field the fixture patch writes reaches a fixture unseen by the window a replace and an undraw run in.

    The payload is `$set` wholesale, so a new field reaches every fixture while a predicate that
    never heard of it reads them as untouched.
    """

    def test_every_key_the_patch_writes_is_weighed_by_the_window_or_named_as_no_record(self):
        """Add a field to `FLPatchSpielDataPayload` and this fails until `RECORDED_FACT_FIELDS` or `NOT_A_RECORD` answers for it."""

        written = _model_copy_keys(apply_payload_to_spiel)

        # The floor, and a cross-check on the reader: this is the `include=` set `patch_spiel_data`
        # dumps into its `$set`, so a key the sweep missed shows up here rather than passing.
        assert written == set(FLPatchSpielDataPayload.model_fields) | {"ergebnis"}

        # The head of each path: the projection reads `team1.tore`, and what a payload writes is
        # `team1` whole.
        weighed = {path.split(".")[0] for path in RECORDED_FACT_FIELDS}

        assert sorted(written - weighed - NOT_A_RECORD) == []

    def test_nothing_named_as_no_record_is_weighed_anyway(self):
        """An exclusion the predicate answers regardless is a line nobody revisits, and the next field lands quietly beside it."""

        weighed = {path.split(".")[0] for path in RECORDED_FACT_FIELDS}

        assert sorted(NOT_A_RECORD & weighed) == []


class TestThePredicateReadsNoKeyItsProjectionMisses:
    """That the recorded-fact window names no key `RECORDED_FACT_FIELDS` leaves unfetched.

    An unfetched key reads `None` on every fixture, so the window stops closing on the fact it was
    added to weigh and every other test stays green.
    """

    def test_the_swept_predicates_are_closed_and_both_slots_are_spelled_out(self):
        """A helper grown below any swept predicate joins the tuple or fails here.

        The clause below reads that tuple alone, so a helper outside it takes its own reads with it.
        """

        handed_off = {name for predicate in RECORDED_FACT_PREDICATES for name in _application_calls(predicate)}

        # The floor: the hand-off the window does make is SEEN, so the closure below is asked of a
        # matcher that matched something.
        assert handed_off, "no hand-off is seen inside the window, so the closure clause below is vacuous"

        # The name at the CALL SITE, so a helper reached through a variable or a `getattr` is still
        # invisible here; following one would take a call graph rather than a sweep.
        assert sorted(handed_off - {predicate.__name__ for predicate in RECORDED_FACT_PREDICATES}) == []

        # Both slots by literal name, which is what the window is written slot by slot for
        # (`app/api/saisons/services.py :: _a_side_is_off_the_draw`).
        assert {"team1", "team2", "team1_quelle", "team2_quelle"} <= _subscripted_constants(RECORDED_FACT_PREDICATES)

    def test_every_path_the_window_reads_is_projected(self):
        """Read one field the projection misses and this fails; nothing else moves, the key reading `None` on every fixture.

        A top-level `tore` counts as missed while `team1.tore` is fetched, so the two must not
        collapse onto one name.
        """

        assert sorted(_read_paths(RECORDED_FACT_PREDICATES) - _projected_paths()) == []


class TestEveryWriteInsideATransactionCarriesIt:
    """That a write in a `with_transaction` callback is bound to it rather than committing on its own.

    The regression is the keyword going missing while the call stays put: an abort takes back
    everything but that one write (`docs/backend/spec.md :: I46`).
    """

    def test_the_sweep_reads_every_callback_and_sees_a_write_in_each(self):
        """The floor: a callback whose writes the sweep cannot see passes the clause below while carrying anything at all."""

        callbacks = transactional_callbacks(SESSION_TAKING_HELPERS)

        assert callbacks
        assert [callback.where for callback in callbacks if not callback.writes] == []

    def test_no_write_inside_one_is_left_off_its_session(self):
        """Drop `session=` from the `$unset` in `undraw_spielplan` and this fails.

        That clear then commits on its own, so the abort restoring the fixtures and the matchdays
        leaves a season holding a schedule it no longer claims.
        """

        loose = [
            f"{callback.where} calls {helper}"
            for callback in transactional_callbacks(SESSION_TAKING_HELPERS)
            for helper, carries in callback.writes
            if not carries
        ]

        assert loose == []


class TestTheCrudHeaderNamesEveryDriverRead:
    """The header is what a router author reads before adding a direct read, and nothing else holds it to the set the sweeps match."""

    def test_the_header_names_exactly_the_reads_the_sweeps_match(self):
        """Drop a name from that header clause, or add a sixth read to `DRIVER_READS` alone, and this fails."""

        assert driver_reads_named_by_the_crud_header() == DRIVER_READS


class TestEveryReadInsideATransactionCarriesIt:
    """That what a callback judges is read inside the transaction it writes in.

    A read left off the session sees a document this callback already wrote as it stood before, and
    two of them can straddle a commit and compose a state the database never held.
    """

    def test_a_session_written_as_a_literal_none_is_not_read_as_carried(self):
        """Take `tests/core/app_source.py :: carries_session` back to a keyword-presence check and this fails.

        No application read is spelled that way, so nothing else here would notice that arm going quiet.
        """

        spelled = [node.value for node in ast.parse("f(session=session)\nf(session=None)\nf()").body if isinstance(node, ast.Expr)]

        assert [carries_session(call) for call in spelled if isinstance(call, ast.Call)] == [True, False, False]

    def test_every_crud_helper_taking_a_session_is_named_by_one_of_the_three_sets(self):
        """The floor under every clause here: rename a helper in `app/core/crud.py`, or add a fourth read, and this fails.

        Each sweep recognises a helper by name, so one no set names is a call site all of them pass
        over while looking wired.
        """

        assert READ_HELPERS | SESSION_TAKING_HELPERS == crud_helpers_taking_a_session()

    def test_the_sweep_sees_both_kinds_of_read_and_one_in_every_callback_promising_them(self):
        """A matcher that matches nothing passes the read clause below over any application at all."""

        callbacks = transactional_callbacks(SESSION_TAKING_HELPERS)
        seen = {helper for callback in callbacks for helper, _ in callback.reads}

        assert seen & READ_HELPERS, "no callback is seen reading through `app/core/crud.py` at all"

        # The half that can go inert on its own: it rests on the receiver still being spelled
        # `*_collection`, which is a convention rather than a name this repository owns.
        assert seen & DRIVER_READS, "no direct driver read is seen, so the receiver rule matches nothing"

        # The vacuous pass: a callback promising a reader that its judgement is read in-session,
        # every read of which sits in some helper this sweep does not follow.
        unseen = [callback.where for callback in callbacks if callback.promises_in_session and not callback.reads]

        assert unseen == []

    def test_the_sweep_follows_a_helper_declared_inside_a_callback(self):
        """Narrow `tests/core/app_source.py :: transactional_callbacks` back to its top scope and this fails.

        A read moved into a helper declared inside the callback still runs in the transaction, so
        the clause below has to reach it.
        """

        seen = {callback.where: {helper for helper, _ in callback.reads} for callback in transactional_callbacks(SESSION_TAKING_HELPERS)}

        # `movable_figures` is the only reader nested inside the season patch's callback, and its
        # squad aggregate is the only `aggregate` anywhere under that callback.
        assert "aggregate" in seen["app/api/saisons/admin_router.py :: judge_and_write_the_rules"]

    def test_every_call_handing_the_session_on_is_placed(self):
        """Drop a name from `DRIVER_READS` and this fails, where the read clause below would only go quiet.

        A call handing `session=` on is a read, a write, or a hand-off to a helper answering for its
        own; anything else no rule here reaches.
        """

        unplaced = [
            f"{callback.where} calls {helper}" for callback in transactional_callbacks(SESSION_TAKING_HELPERS) for helper in callback.unplaced
        ]

        assert unplaced == []

    def test_no_read_inside_one_is_left_off_its_session(self):
        """Drop `session=` from any of the eight reads in `judge_and_write_the_rules` and this fails; the db tier does not.

        That read judges the season as whatever committed last left it, and the patch beneath it
        lands in a snapshot that never held it.
        """

        loose = [
            f"{callback.where} reads with {helper}"
            for callback in transactional_callbacks(SESSION_TAKING_HELPERS)
            for helper, carries in callback.reads
            if not carries
        ]

        assert loose == []


# A profile rather than a set of loose sites: two calls to one helper collapse in a set, so turning
# the in-session call into a second `None` would join an exemption in silence.

# Each is a re-judgement after the write, reading what the transaction cannot
# (`docs/backend/spec.md :: I118`).
HANDED_OUTSIDE_THE_TRANSACTION: Mapping[str, tuple[str, ...]] = {
    "app/api/saisons/admin_router.py :: judge_and_write_the_rules hands movable_figures": ("session", "None"),
    "app/api/saisons/admin_router.py :: judge_and_roll_the_league_over hands the_targets_status": ("session", "None"),
    "app/api/schiedsrichter/admin_router.py :: clear_the_details_and_the_record hands stored_referee": ("session", "None"),
}


def _handed_profiles() -> dict[str, tuple[str, ...]]:
    """In SOURCE order, which is what the pinned profile above reads: the in-session judgement comes before the re-judgement outside."""

    profiles: dict[str, list[str]] = {}
    for handoff in session_handoffs():
        profiles.setdefault(f"{handoff.where} hands {handoff.called}", []).append(handoff.binding.argument)

    return {key: tuple(arguments) for key, arguments in profiles.items()}


class TestEverySessionHandOffInsideATransactionCarriesIt:
    """Where the read clause above cannot reach: a helper handed `None` positionally still spells `session=` on every read in its own body."""

    def test_the_sweep_reaches_a_hand_off_and_both_ways_of_binding_one(self):
        """A matcher matching nothing, or a positional arm gone quiet, would pass the clause below over the calls it exists for."""

        handoffs = session_handoffs()

        assert handoffs

        # Both arms: the keyword one every `app/core/crud.py` call takes, and the positional one a
        # helper nested in a callback is reached through, which is the arm the exemptions above use.
        assert {handoff.binding.by_position for handoff in handoffs} == {False, True}

    def test_a_callee_is_resolved_lexically_rather_than_by_its_name(self):
        """Two declarations here are named `judge` and one of them takes a session.

        Read by name alone, the season patch's `judge(figures)` would be reported as a hand-off whose
        first argument is no session at all.
        """

        resolved = {handoff.where for handoff in session_handoffs() if handoff.called == "judge"}

        assert resolved, "no `judge` resolves to a session-taking declaration, so the clause below is vacuous"
        assert "app/api/saisons/admin_router.py :: judge_and_write_the_rules" not in resolved

    def test_the_two_listings_of_a_callbacks_crud_calls_agree(self):
        """PRE-4's two listings: one matches a helper by NAME, the other resolves the declaration a call site reaches.

        A resolver that quietly stops following a call takes that hand-off out of the clause below,
        and neither listing alone would notice.
        """

        crud = READ_HELPERS | SESSION_TAKING_HELPERS

        by_name: dict[str, list[str]] = {}
        for callback in transactional_callbacks(SESSION_TAKING_HELPERS):
            by_name.setdefault(callback.where, []).extend(helper for helper, _ in (*callback.reads, *callback.writes) if helper in crud)

        resolved: dict[str, list[str]] = {where: [] for where in by_name}
        for handoff in session_handoffs():
            if handoff.called in crud:
                resolved.setdefault(handoff.where, []).append(handoff.called)

        assert {where: sorted(names) for where, names in resolved.items()} == {where: sorted(names) for where, names in by_name.items()}

    def test_no_hand_off_inside_one_is_left_off_the_transactions_session(self):
        """Take `movable_figures(session)` to `movable_figures(None)` and this fails, where the read clause above stays green.

        The judged figures and the write then sit in two snapshots, so a refusal is decided on a
        league state that never existed.
        """

        profiles = _handed_profiles()
        loose = {f"{handoff.where} hands {handoff.called}" for handoff in session_handoffs() if not handoff.in_session}

        assert {key: profiles[key] for key in loose} == dict(HANDED_OUTSIDE_THE_TRANSACTION)


class TestEveryHelperTheTransactionReachesReadsInSession:
    """`transactional_callbacks` reads a callback's own lexical body, so a read a module away answers in no clause above."""

    def test_the_sweep_reaches_every_session_taking_crud_helper(self):
        """The floor, derived on both sides rather than listed.

        Every `app/core/crud.py` helper taking a session is reached from some callback, or the
        resolver has stopped following calls and the clause below is asked of less than it reads.
        """

        carriers = session_carriers()
        unreached = crud_helpers_taking_a_session() - {carrier.called for carrier in carriers}

        assert unreached == frozenset(), f"{sorted(unreached)} is reached from no transactional callback"

        # The receiver rule `tests/core/app_source.py :: reads_the_database` rests on cannot see this
        # one: `app/core/crud.py` reads through its own `collection` parameter.
        assert {read for carrier in carriers if carrier.called == "pull_one_from_db" for read, _ in carrier.reads} == {"find_one"}

    def test_no_read_inside_one_is_left_off_the_session_it_was_handed(self):
        """Drop `session=` from the count in `app/api/spieler/admin_router.py :: _refuse_a_taken_rolle` and this fails.

        The refusal then decides on what committed last while the write beside it is in the
        transaction, so the retry re-decides on that same stale count.
        """

        loose = [f"{carrier.where} reads with {read}" for carrier in session_carriers() for read, carries in carrier.reads if not carries]

        assert loose == []


class TestTheTwoPathsIntoTeamsDumpTheClubAlike:
    """One school makes one club document, so an acceptance owes the dump `post_team` makes.

    Every field of the payload is a string today, which is why the modes agree and why a mode
    dropped here surfaces only once a club field stops being one.
    """

    def test_both_paths_dump_the_club_payload_with_the_same_keywords(self):
        """Drop `mode="json"` from `parse_new_club` and this fails; nothing else in either tier does.

        Read off the source: the calls answer with equal documents today, so nothing asked of
        the objects at runtime tells them apart.
        """

        dumped = _model_dump_keywords(parse_new_club)

        # The floor: a matcher that saw neither call would compare empty lists and pass.
        assert dumped, "no `model_dump` is seen in `parse_new_club`, so the comparison below is vacuous"

        assert dumped == _model_dump_keywords(post_team)


class TestEveryServiceModuleDecidesFromItsArguments:
    """That no services module reaches the database, which keeps its tests off the container tier.

    A read added to one goes green by SHRINKING: its test would need `@pytest.mark.db`, which
    deselects it from the tier running with no container.
    """

    def test_the_sweep_reads_every_service_module_and_every_handle_name(self):
        """The floor: a glob matching nothing, or a derivation that empties, passes each clause below over any application."""

        assert {module.parent.name for module in _service_modules()} == SERVICE_PACKAGES

        handles = _database_annotations()

        # Both halves, so neither goes inert: the driver's own types, and the aliases every router's
        # parameters are actually annotated with.
        assert {"AsyncCollection", "AsyncDatabase", "AsyncMongoClient"} <= handles
        assert {"SpieleCollection", "TeamsCollection", "DB", "DBClient"} <= handles

    def test_no_service_module_awaits(self):
        """Give a services module an `await` and this fails, and keeps failing once `@pytest.mark.db` has repaired the tests around it."""

        awaiting = [
            module.relative_to(BACKEND_ROOT).as_posix()
            for module in _service_modules()
            if any(isinstance(node, (ast.Await, ast.AsyncFunctionDef, ast.AsyncFor, ast.AsyncWith)) for node in ast.walk(parsed(module)))
        ]

        assert awaiting == []

    def test_no_database_handle_reaches_a_service_module(self):
        """Give one a `spiele_collection` parameter, or an `AsyncCollection` annotation, and this fails.

        The name and the annotation are separate ways in: an unannotated parameter carries neither
        type nor alias, and a handle named `db` carries no suffix.
        """

        handles = _database_annotations()
        reached = [
            f"{module.relative_to(BACKEND_ROOT).as_posix()} :: {function} takes {argument.arg}"
            for module in _service_modules()
            for function, argument in _parameters(parsed(module))
            if argument.arg.endswith(COLLECTION_ARGUMENT_SUFFIX) or _annotation_names(argument.annotation) & handles
        ]

        assert reached == []

    def test_no_service_module_imports_the_database(self):
        """Import `app.core.dependencies` into one and this fails, where the handle clause would go quiet.

        An alias must be imported to be written, so this holds the handle clause from being routed
        around by a spelling it does not know.
        """

        imported = [
            f"{module.relative_to(BACKEND_ROOT).as_posix()} imports {name}"
            for module in _service_modules()
            for name in _imported_modules(parsed(module))
            if any(name == database or name.startswith(f"{database}.") for database in DATABASE_MODULES)
        ]

        assert imported == []

    def test_no_service_module_names_a_helper_that_reaches_the_database(self):
        """Name `pull_one_from_db` in one and this fails, `await` or none.

        A coroutine composed here and awaited by its caller carries no `await` of its own, so the
        await clause passes it.
        """

        # `build_query` and `build_sort` take no session, so neither is in the set this reads.
        session_taking = crud_helpers_taking_a_session()
        called = [
            f"{module.relative_to(BACKEND_ROOT).as_posix()} names {node.id}"
            for module in _service_modules()
            for node in ast.walk(parsed(module))
            if isinstance(node, ast.Name) and node.id in session_taking
        ]

        assert called == []


# --- appended by the coordinator: the create sweep -------------------------------------------------

#: What `app/core/crud.py :: insert_live` stamps for every caller, so a router that omits it is right
#: to. `_id` is the driver's.
STAMPED_FOR_THE_CALLER: frozenset[str] = frozenset({"inactive_since", "_id"})

#: The one helper a create goes through. `post_one_to_db` is reached only through it in the routers,
#: and a create that stopped using it would drop out of this sweep -- which the floor below catches.
CREATE_HELPER = "insert_live"

#: Asserted equal to what the sweep finds, so a create that stops being readable fails rather than
#: leaving the population.
UNREADABLE_CREATES: frozenset[str] = frozenset(
    {
        # No single expression at its call site names the document. `post_team` covers the same
        # collection from the same payload model.
        "annehmen_bewerbung",
    }
)


def _base_name(node: ast.expr) -> str | None:
    """The name a call chain starts from: `FLPostTeamPayload.model_validate(x).model_dump()` is that class."""

    while True:
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            node = node.value
        elif isinstance(node, ast.Call):
            node = node.func
        else:
            return None


def _fields_of(dump: ast.expr, *, hints: Mapping[str, Any], module: Any) -> set[str]:
    """The payload model a dump comes from: a parameter through the endpoint's hints, a class through its module."""

    if not isinstance(dump, ast.Call) or "model_dump" not in ast.dump(dump.func):
        return set()
    name = _base_name(dump.func)
    if name is None:
        return set()
    model = hints.get(name) or getattr(module, name, None)
    return set(model.model_fields) if model is not None and hasattr(model, "model_fields") else set()


def _through_a_local(name: str, *, endpoint: Callable[..., Any], module: Any) -> ast.expr | None:
    """What a local was assigned, following one call into the app so a composed document resolves."""

    for statement in ast.walk(declared(endpoint)):
        if not isinstance(statement, ast.Assign) or len(statement.targets) != 1:
            continue
        target = statement.targets[0]
        if not isinstance(target, ast.Name) or target.id != name:
            continue
        assigned = statement.value
        if isinstance(assigned, ast.Await):
            assigned = assigned.value
        helper: Callable[..., Any] | None = getattr(module, _base_name(assigned) or "", None)
        if helper is not None and callable(helper) and not hasattr(helper, "model_fields"):
            returned = next((node.value for node in ast.walk(declared(helper)) if isinstance(node, ast.Return) and node.value), None)
            if returned is not None:
                return returned
        return assigned
    return None


@dataclass(frozen=True)
class Creation:
    """One document a create composes, read off its own call site and its own payload model."""

    endpoint: str
    collection: str
    #: Every key the document literal spells, a module constant resolved to its value.
    literal_keys: frozenset[str]
    #: Every field of every model whose `model_dump()` the literal spreads.
    spread_fields: frozenset[str]

    @property
    def composed(self) -> frozenset[str]:
        return self.literal_keys | self.spread_fields


def _resolved_key(key: ast.expr, module: Any) -> str | None:
    """A literal key, or a module constant naming one -- `ANONYMISIERT_AM` is spelled the second way."""

    if isinstance(key, ast.Constant) and isinstance(key.value, str):
        return key.value
    if isinstance(key, ast.Name):
        found = getattr(module, key.id, None)
        return found if isinstance(found, str) else None
    return None


def creations() -> tuple[list[Creation], frozenset[str]]:
    """Every create the application makes, composed keys beside the collection they land in.

    Neither side is written twice, so the two can disagree: the keys come from the router's own source
    and its payload model's fields, the requirement from `COLLECTION_VALIDATORS`.
    """

    found: list[Creation] = []
    unreadable: set[str] = set()
    for router in (*WRITE_ROUTERS, *SYSTEM_WRITE_ROUTERS):
        for route in router.routes:
            found_endpoint: Callable[..., Any] | None = getattr(route, "endpoint", None)
            if found_endpoint is None:
                continue
            # Bound to a narrowed name because the readers below close over it, and a narrowing does not
            # cross a closure.
            endpoint: Callable[..., Any] = found_endpoint
            module = import_module(endpoint.__module__)
            hints = get_type_hints(endpoint)
            for call in ast.walk(declared(endpoint)):
                if not isinstance(call, ast.Call) or callee(call) != CREATE_HELPER:
                    continue
                arguments = {keyword.arg: keyword.value for keyword in call.keywords}
                collection_argument = arguments.get("collection")
                document = arguments.get("document")
                if not isinstance(collection_argument, ast.Name):
                    unreadable.add(endpoint.__name__)
                    continue

                # Two shapes: the payload dumped whole, or that dump spread into a literal adding
                # what no payload carries. Anything else is recorded rather than skipped.
                if isinstance(document, ast.Name):
                    resolved_document = _through_a_local(document.id, endpoint=endpoint, module=module)
                    if resolved_document is None:
                        unreadable.add(endpoint.__name__)
                        continue
                    document = resolved_document
                if isinstance(document, ast.Call):
                    literal, spread = set(), _fields_of(document, hints=hints, module=module)
                    if not spread:
                        unreadable.add(endpoint.__name__)
                        continue
                elif isinstance(document, ast.Dict):
                    literal = {resolved for key in document.keys if key is not None and (resolved := _resolved_key(key, module)) is not None}
                    spread, unread_spread = set(), False
                    for key, value in zip(document.keys, document.values, strict=True):
                        if key is None:
                            fields = _fields_of(value, hints=hints, module=module)
                            # A spread this reader cannot resolve leaves the document PARTLY read, and a
                            # partial read is worse than none: it would report keys as missing that the
                            # unread half supplies.
                            unread_spread = unread_spread or not fields
                            spread |= fields
                    if unread_spread:
                        unreadable.add(endpoint.__name__)
                        continue
                else:
                    unreadable.add(endpoint.__name__)
                    continue
                found.append(
                    Creation(
                        endpoint=endpoint.__name__,
                        collection=collection_argument.id.removesuffix(COLLECTION_ARGUMENT_SUFFIX),
                        literal_keys=frozenset(literal),
                        spread_fields=frozenset(spread),
                    )
                )
    return found, frozenset(unreadable)


class TestEveryCreateCarriesWhatItsValidatorRequires:
    """The half of a required key nothing else holds.

    Dropping the key from a create leaves the whole estate green while production refuses every insert
    at `validationAction: error`. Two create endpoints are named by no test at all.
    """

    def test_the_sweep_reaches_every_create_the_routers_make(self) -> None:
        composed, unreadable = creations()
        # A floor rather than non-emptiness: a create that stops going through `insert_live`, or a
        # call this reader stops resolving, shrinks the population and the assertion together.
        assert len(composed) >= 4, f"only {len(composed)} create(s) resolved: {[creation.endpoint for creation in composed]}"
        assert unreadable == UNREADABLE_CREATES, f"the set this reader cannot follow moved: {sorted(unreadable)}"

    def test_each_create_composes_every_key_its_collection_requires(self) -> None:
        composed, _ = creations()
        for creation in composed:
            schema = COLLECTION_VALIDATORS[Collection(creation.collection)]["$jsonSchema"]
            required = frozenset(schema.get("required", ())) - STAMPED_FOR_THE_CALLER
            missing = required - creation.composed
            assert not missing, (
                f"{creation.endpoint} composes no {sorted(missing)}, which the {creation.collection} validator requires -- "
                f"the insert is refused at `validationAction: error` and the create answers 500"
            )
