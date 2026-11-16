"""
TESTS · the collections a handler takes, each wired off one database by its parameter's name

A handler names each collection it takes `<collection>_collection`, the collection's stored name before the suffix, so
reading them off its signature wires a route that gains one without an edit here.
"""

import inspect
from collections.abc import Callable, Mapping
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.core.collections import Collection

_SUFFIX = "_collection"


def wired(handler: Callable[..., Any], database: AsyncDatabase | Mapping[Collection, Any], **replaced: Any) -> dict[str, Any]:
    """Every collection `handler` takes, by its parameter's name, any of them, or any other parameter, replaced by name.

    A parameter naming no collection fails here, at `Collection(...)`, rather than as a handle on a collection nothing
    holds.
    """

    handles = {
        name: database[Collection(name.removesuffix(_SUFFIX))] for name in inspect.signature(handler).parameters if name.endswith(_SUFFIX)
    }

    return {**handles, **replaced}
