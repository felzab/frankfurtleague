"""
API · every read of the matchdays that another slice judges by

Here rather than in `services.py`, which decides from its arguments and names no handle at all
(`fl_backend/tests/core/test_write_shapes.py :: TestEveryServiceModuleDecidesFromItsArguments`).
"""

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.spieltage.services import build_erster_spieltag_filter, nachnominierung_laeuft


async def nachnominierung_laeuft_in(
    *,
    spieltage_collection: AsyncCollection,
    saison_id: str,
    today: str,
    # REQUIRED, `None` included: a transactional caller that forgot it would read outside its
    # snapshot in silence, so the omission has to be a TypeError at the call.
    session: AsyncClientSession | None,
) -> bool:
    """Whether an entry into this season's squads on `today` is a Nachnominierung (`docs/backend/spec.md :: I334`).

    A season holding no matchday 1 answers `False`, as an undated one does: nothing has begun.
    """

    erster_spieltag = await spieltage_collection.find_one(build_erster_spieltag_filter(saison_id=saison_id), {"beginn": 1}, session=session)

    return nachnominierung_laeuft(beginn=(erster_spieltag or {}).get("beginn"), today=today)
