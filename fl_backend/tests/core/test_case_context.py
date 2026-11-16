"""
TESTS · the context an async case runs in

pytest-asyncio runs each case in a copy of pytest's context, on one loop the session shares. A runner keeping every case
in one task instead, as anyio's plugin does, would hand each case whatever the case before it set.

Invariants:
- A case sees the administrator the suite binds.
- A case sees nothing an earlier case set, nor a binding an earlier case's fixture left behind.

The cases run in the order written, which `--dist loadfile` keeps on one worker.
"""

import pytest

from app.core.logging import NO_REQUEST_SENTINEL, trace_id_var
from app.core.recording import actor_var

# What the earlier case sets and leaves: neither is a value anything else in the suite binds.
LEFT_BEHIND_ACTOR = "left.behind@example.com"
LEFT_BEHIND_TRACE = "0af7651916cd43dd8448eb211c80319c"


async def test_a_case_sees_the_administrator_the_suite_binds():
    assert actor_var.get() == "admin@frankfurtleague.de"


async def test_a_case_sets_both_and_resets_neither():
    actor_var.set(LEFT_BEHIND_ACTOR)
    trace_id_var.set(LEFT_BEHIND_TRACE)

    assert (actor_var.get(), trace_id_var.get()) == (LEFT_BEHIND_ACTOR, LEFT_BEHIND_TRACE)


class TestTheNextCase:
    @pytest.fixture
    def an_administrator_bound(self) -> None:
        """Binds nobody, so what the case reads is whatever the case before it left behind."""

    async def test_meets_neither_what_the_case_before_it_set_nor_that_case_s_binding(self):
        assert (actor_var.get(), trace_id_var.get()) == (None, NO_REQUEST_SENTINEL)
