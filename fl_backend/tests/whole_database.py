from pymongo.asynchronous.database import AsyncDatabase


async def every_collection_as_text(database: AsyncDatabase) -> str:
    """The whole database rendered, so a value can be looked for where nobody thought to put it."""

    return str([await database[name].find().to_list(length=None) for name in await database.list_collection_names()])
