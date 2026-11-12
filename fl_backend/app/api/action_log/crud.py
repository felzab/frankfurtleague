from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.core.crud import patch_many_in_db
from app.shared.folding import sign_in_identifier


async def reattribute_administrator_in_session(
    *, action_log_collection: AsyncCollection, identifier: str, value: str, session: AsyncClientSession
) -> int:
    """Put `value` where this address stands in the log, as who acted or as a grant act's grantee, answering how many rows changed.

    The one write the log takes after the fact, inside the transaction of the act that owes it.
    """

    # Folded, as the log stores every address.
    address = sign_in_identifier(identifier)

    changed = 0
    for field in ("by", "label"):
        result = await patch_many_in_db(
            collection=action_log_collection, db_filter={field: address}, update={"$set": {field: value}}, session=session
        )
        changed += result.modified_count

    return changed
