from pymongo.asynchronous.database import AsyncDatabase


async def where_held(database: AsyncDatabase, *values: str) -> dict[str, list[str]]:
    """Per value, every collection holding it, so a value is looked for where nobody thought to put it.

    Named rather than rendered, so a failure says where; case-folded on both sides, so a capitalised spelling is found too.
    """

    rendered = {name: str(await database[name].find().to_list(length=None)).casefold() for name in await database.list_collection_names()}

    return {value: sorted(name for name, text in rendered.items() if value.casefold() in text) for value in values}
