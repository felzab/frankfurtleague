from datetime import datetime

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.core.crud import patch_many_in_db
from app.shared.schemas.custom import CustomObjectId


async def stamp_the_adoption(
    *,
    spielberichte_collection: AsyncCollection,
    spiel_id: CustomObjectId,
    version: int,
    now: datetime,
    # REQUIRED: the fixture save's own, so a save that does not commit takes its stamp back with it.
    session: AsyncClientSession,
) -> None:
    """Stamp the report adopted at `version`, matching it only while it still stands there (`docs/backend/spec.md :: I816`).

    `patch_many_in_db` because its miss writes nothing, where `patch_one_in_db`'s raises and takes the fixture's save with it.
    """

    await patch_many_in_db(
        collection=spielberichte_collection,
        db_filter={"spiel_id": spiel_id, "bericht.version": version},
        update={
            "$set": {
                "bericht.uebernommen_am": now,
                "bericht.uebernommen_von": {"art": "admin"},
                "bericht.uebernommene_version": version,
            }
        },
        session=session,
    )
