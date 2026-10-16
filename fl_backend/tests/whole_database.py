from pymongo.asynchronous.database import AsyncDatabase


async def where_held(database: AsyncDatabase, *values: str, folded: bool = False) -> dict[str, list[str]]:
    """Per value, the collections holding it, looked for where nobody thought to put it.

    Named rather than rendered, so a failure says where. Exact unless `folded`, since a case may tell a typed spelling from
    its stored fold.
    """

    def matchable(text: str) -> str:
        return text.casefold() if folded else text

    rendered = {name: matchable(str(await database[name].find().to_list(length=None))) for name in await database.list_collection_names()}

    return {value: sorted(name for name, text in rendered.items() if matchable(value) in text) for value in values}
