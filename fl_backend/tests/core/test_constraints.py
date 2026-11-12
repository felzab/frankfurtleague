from datetime import datetime
from typing import Any, get_args

import pytest
from pydantic import BaseModel

from app.core.collections import Collection
from app.core.constraints import TTL_INDEXES, TTLIndex
from app.readback import RECORD_MODELS

# The TTL index keyed on a date a live row never holds: the row expires once ended, its key's parent then written whole.
# MongoDB expires no row lacking a date there (https://www.mongodb.com/docs/manual/core/index-ttl/, which moves without us;
# read 2026-10-20).
ENDED_ROW_TTL_INDEXES = frozenset({"address_change_ended_at"})


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
