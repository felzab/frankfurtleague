import ast
from typing import Any, Callable

from app.api.bewerbungen.services import parse_new_club
from app.api.saisons.services import RECORDED_FACT_FIELDS
from app.api.spiele.schemas import FLPatchSpielDataPayload
from app.api.spiele.services import apply_payload_to_spiel
from app.api.teams.admin_router import post_team
from app.core.collections import Collection
from app.core.constraints import COLLECTION_VALIDATORS
from app.core.domain import AGGREGATES
from tests.core.app_source import (
    DRIVER_READS,
    READ_HELPERS,
    REMOVAL_HELPERS,
    WRITE_HELPERS,
    crud_helpers_taking_a_session,
    declared,
    removals,
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


def _model_dump_keywords(function: Callable[..., Any]) -> list[frozenset[tuple[str, str]]]:
    """Every `model_dump` one function calls, as the keywords it passes -- which is what decides the shape of the values dumped."""

    return [
        frozenset((keyword.arg or "**", ast.unparse(keyword.value)) for keyword in call.keywords)
        for call in ast.walk(declared(function))
        if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and call.func.attr == "model_dump"
    ]


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


class TestWhatARemovalFilterMayName:
    """That a removal's filter is what BOUNDS it, and that each one names enough -- and only what it may.

    Three clauses over one sweep, and each fails its own way -- the method below it names which.
    """

    def test_the_sweep_reads_every_removal_and_places_every_collection(self):
        """The floor under all three: a sweep matching nothing passes each clause below over any application at all."""

        found = removals()

        # Both helpers reached, so a clause is never green because one of them went unseen.
        assert {removal.helper for removal in found} == REMOVAL_HELPERS

        # Derived, so it needs no editing -- and pinned, so a derivation that silently empties is
        # caught rather than passing the season clause over nothing. `bewerbungen` is in the set and
        # contributes nothing to the clause below, no endpoint removing an application at all.
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


class TestEveryReadInsideATransactionCarriesIt:
    """That what a callback judges is read inside the transaction it writes in.

    A read left off the session sees a document this callback already wrote as it stood before, and
    two of them can straddle a commit and compose a state the database never held.
    """

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
