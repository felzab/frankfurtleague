import asyncio
from datetime import datetime
from functools import partial
from typing import Any, get_args

import pytest
from pydantic import BaseModel

from app.core.collections import Collection
from app.core.constraints import TTL_INDEXES, TTLIndex, _apply_concurrently
from app.readback import RECORD_MODELS

# The TTL index keyed on a date a live row never holds: the row expires once ended, its key's parent then written whole.
# MongoDB expires no row lacking a date there (https://www.mongodb.com/docs/manual/core/index-ttl/, which moves without us;
# read 2026-10-20).
ENDED_ROW_TTL_INDEXES = frozenset({"adresswechsel_beendet_am"})


def _model_in(annotation: Any) -> type[BaseModel]:
    """The one model an optional or plain field holds."""

    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return annotation
    (model,) = [argument for argument in get_args(annotation) if isinstance(argument, type) and issubclass(argument, BaseModel)]
    return model


@pytest.mark.parametrize("ttl", [ttl for ttl in TTL_INDEXES if ttl.collection in RECORD_MODELS], ids=lambda ttl: ttl.name)
def test_every_ttl_index_expires_on_a_required_date(ttl: TTLIndex):
    """A TTL index over a string, or over a key a row may leave out, builds, serves reads and expires nothing, reporting neither."""

    *parents, key = ttl.key.split(".")
    model = RECORD_MODELS[Collection(ttl.collection)]
    for parent in parents:
        holder = model.model_fields[parent]
        assert holder.is_required(), f"{ttl.name} expires on {ttl.key!r}, and {parent!r} may be left out"
        # Where the key sits in a block a live row holds null, that block is all a live row may hold there.
        assert (ttl.name in ENDED_ROW_TTL_INDEXES) is (type(None) in get_args(holder.annotation)), ttl.name
        model = _model_in(holder.annotation)

    field = model.model_fields[key]
    assert (field.annotation, field.is_required()) == (datetime, True), f"{ttl.name} expires on {ttl.key!r}, typed {field.annotation}"


def test_the_failure_raised_is_the_one_declared_first_not_the_one_that_arrives_first():
    """The one difference a concurrent apply can make, and the happy path cannot see it.

    `asyncio.gather` reports whichever operation loses the race, so without the declared-order rule
    a refused boot's sentence would depend on server timing.
    """
    arrivals: list[str] = []

    async def fail_after(delay: float, label: str) -> None:
        await asyncio.sleep(delay)
        arrivals.append(label)
        raise RuntimeError(label)

    declared: list[tuple[str, Any]] = [
        ("saisons", partial(fail_after, 0.05, "declared first")),
        ("teams", partial(fail_after, 0.0, "declared second")),
    ]

    with pytest.raises(RuntimeError) as raised:
        asyncio.run(_apply_concurrently(declared))

    # The premise of the test rather than a detail: the later one really did fail first.
    assert arrivals == ["declared second", "declared first"]
    assert str(raised.value) == "declared first"


def test_one_namespace_keeps_its_declared_order_and_stops_at_its_own_failure():
    """Two builds racing on one collection are documented nowhere, and the one after a failure is work no sequential apply ever did."""
    ran: list[str] = []

    async def succeed(label: str) -> None:
        ran.append(label)

    async def fail(label: str) -> None:
        ran.append(label)
        raise RuntimeError(label)

    after_the_failure = "aktionen second"
    declared: list[tuple[str, Any]] = [
        ("aktionen", partial(fail, "aktionen first")),
        ("aktionen", partial(succeed, after_the_failure)),
        ("bewerbungen", partial(succeed, "bewerbungen only")),
    ]

    with pytest.raises(RuntimeError, match="aktionen first"):
        asyncio.run(_apply_concurrently(declared))

    assert after_the_failure not in ran, "a namespace carried on past its own failure"
    assert "bewerbungen only" in ran, "an unrelated namespace was cancelled by someone else's failure"


def test_the_declared_rank_is_global_and_not_each_lane_counting_from_zero():
    """Two failures, and the earlier-declared one sits at a NON-ZERO position inside its lane.

    Numbering per lane reports the other one. Every other case puts the failure first in its lane,
    where the two numberings agree and the wrong one passes.
    """
    ran: list[str] = []

    async def succeed(label: str) -> None:
        ran.append(label)

    async def fail(label: str) -> None:
        ran.append(label)
        raise RuntimeError(label)

    declared: list[tuple[str, Any]] = [
        ("aktionen", partial(succeed, "aktionen queue")),
        ("aktionen", partial(fail, "declared second, lane position 1")),
        ("bewerbungen", partial(fail, "declared third, lane position 0")),
    ]

    with pytest.raises(RuntimeError) as raised:
        asyncio.run(_apply_concurrently(declared))

    # The premise, not a detail: with the failure first in its own lane the case proves nothing.
    assert ran.index("aktionen queue") < ran.index("declared second, lane position 1")
    assert str(raised.value) == "declared second, lane position 1"


def test_the_failure_chosen_is_not_the_first_lane_s_but_the_first_declared():
    """Two lanes fail, and the one that OPENS first is the one that fails LATER.

    `lanes` is insertion-ordered, so the first-opened lane's failure is the first `gather` hands
    back -- and in every other case here that is also the first declared.
    """
    ran: list[str] = []

    async def succeed(label: str) -> None:
        ran.append(label)

    async def fail(label: str) -> None:
        ran.append(label)
        raise RuntimeError(label)

    declared: list[tuple[str, Any]] = [
        ("aktionen", partial(succeed, "aktionen opens the first lane")),
        ("bewerbungen", partial(fail, "declared second")),
        ("aktionen", partial(fail, "declared third")),
    ]

    with pytest.raises(RuntimeError) as raised:
        asyncio.run(_apply_concurrently(declared))

    # The premise, not a detail: one failure orders nothing, and the first lane has to be the one
    # holding the later-declared of the two.
    assert {"declared second", "declared third"} <= set(ran)
    assert str(raised.value) == "declared second"
