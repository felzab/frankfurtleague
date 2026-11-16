from collections.abc import Mapping
from typing import Any

from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.core.collections import Collection


async def the_row(database: AsyncDatabase, collection: Collection, which: ObjectId | Mapping[str, Any]) -> Mapping[str, Any]:
    """The one row `which` names, by its `_id` or by a filter, refused where none stands rather than read as a null.

    Handed on to `find_one` as it came, which reads a value other than a mapping as an `_id`.
    """

    found = await database[collection].find_one(which)
    assert found is not None, f"the {collection} collection holds no row matching {which}"

    return found
