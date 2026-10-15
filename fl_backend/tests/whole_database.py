from pymongo.asynchronous.database import AsyncDatabase


async def where_held(database: AsyncDatabase, *values: str) -> dict[str, list[str]]:
    """Per value, every collection a document holding it sits in, so a value is looked for where nobody thought to put it.

    The collections named rather than the database rendered: a failure then says where the value is. Case-folded on both
    sides, so a spelling typed in capitals is found too.
    """

    rendered = {name: str(await database[name].find().to_list(length=None)).casefold() for name in await database.list_collection_names()}

    return {value: sorted(name for name, text in rendered.items() if value.casefold() in text) for value in values}
