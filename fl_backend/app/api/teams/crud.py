from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.saisons.schemas import FLSaisonRules
from app.api.teams.schemas import FLGruppenNames
from app.api.teams.services import find_entry_refusal
from app.core.crud import patch_many_in_db, pull_many_from_db, refuse


async def refuse_a_full_gruppe(
    *,
    saison_teams_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    saison_id: str,
    gruppe: FLGruppenNames,
    saison_status: str,
    rules: FLSaisonRules,
    # REQUIRED: the anchor below is what closes the race, so forgetting the session has to be a
    # TypeError at the call rather than a silent reopening of it.
    session: AsyncClientSession,
) -> None:
    """Refuse `REQ-ENTER-001` through `REQ-ENTER-003` for one entry into one group.

    Its own module rather than a private helper, because a rule reached from two packages is one a
    package can enter past.
    """

    # A count is a read, which a snapshot re-validates nowhere, so two entrants pass one figure
    # unless something puts them in one write set.
    await patch_many_in_db(
        collection=saisons_collection,
        db_filter={"_id": saison_id},
        update={"$inc": {"bounded_writes": 1}},
        session=session,
    )

    occupied_rows = await pull_many_from_db(
        collection=saison_teams_collection,
        db_filter={"saison_id": saison_id, "gruppe": gruppe},
        projection=["_id"],
        session=session,
    )

    refuse(find_entry_refusal(saison_status=saison_status, gruppe=gruppe, rules=rules, occupied=len(occupied_rows)))
