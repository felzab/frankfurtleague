from collections.abc import Iterator, Mapping, Sequence
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.core.collections import Collection
from app.shared.folding import sign_in_identifier

# The fields keeping an id by design, each saying what a write or a mail was about rather than whose it
# was: a log row's document and filter, and an owed mail's key and record, which a revoke leaves alike.
_ABOUT: Mapping[str, tuple[str, ...]] = {
    Collection.AKTIONEN: ("document_id", "db_filter"),
    Collection.POSTAUSGANG: ("schluessel", "bezug"),
}


async def where_held(database: AsyncDatabase, *values: str, folded: bool = False, beside: Sequence[str] = ()) -> dict[str, list[str]]:
    """Per value, the collections holding it, looked for where nobody thought to put it.

    Named rather than rendered, so a failure says where. Exact unless `folded`, since a case may tell a typed spelling from
    its stored fold.
    """

    def matchable(text: str) -> str:
        return text.casefold() if folded else text

    # Out before the search, each of `beside` being somebody else's text that spells a value: an address sharing the
    # person's local part spells their names.
    def searched(text: str) -> str:
        for other in map(matchable, beside):
            text = text.replace(other, "")
        return text

    rendered = {
        name: searched(matchable(str(await database[name].find().to_list(length=None)))) for name in await database.list_collection_names()
    }

    return {value: sorted(name for name, text in rendered.items() if matchable(value) in text) for value in values}


def _leaves(value: Any) -> Iterator[Any]:
    if isinstance(value, Mapping):
        for member in value.values():
            yield from _leaves(member)
    elif isinstance(value, list):
        for member in value:
            yield from _leaves(member)
    else:
        yield value


async def _leaves_by_collection(database: AsyncDatabase, *, apart: Mapping[str, tuple[str, ...]]) -> dict[str, list[Any]]:
    leaves: dict[str, list[Any]] = {}
    for name in await database.list_collection_names():
        for document in await database[name].find().to_list(length=None):
            kept = {key: member for key, member in document.items() if key not in apart.get(name, ())}
            leaves.setdefault(name, []).extend(_leaves(kept))

    return leaves


async def where_folded_to(database: AsyncDatabase, identifier: str) -> list[str]:
    """The collections holding a string the sign-in fold reads as `identifier`, where no case-blind match would see it.

    A fullwidth or decomposed domain is the person's address all the same.
    """

    return sorted(
        name
        for name, leaves in (await _leaves_by_collection(database, apart={})).items()
        if any(isinstance(leaf, str) and sign_in_identifier(leaf) == identifier for leaf in leaves)
    )


async def where_referenced(database: AsyncDatabase, *ids: Any) -> dict[Any, list[str]]:
    """Per id, the collections holding it as a value or inside a string, the fields saying what a write or a notice was about apart."""

    by_collection = await _leaves_by_collection(database, apart=_ABOUT)

    def names(leaf: Any, record_id: Any) -> bool:
        return leaf == record_id or (isinstance(leaf, str) and str(record_id) in leaf)

    return {
        record_id: sorted(name for name, leaves in by_collection.items() if any(names(leaf, record_id) for leaf in leaves)) for record_id in ids
    }
