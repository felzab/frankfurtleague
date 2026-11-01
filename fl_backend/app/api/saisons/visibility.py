from typing import NamedTuple

from pymongo.asynchronous.collection import AsyncCollection

from app.api.saisons.crud import CURRENT_SAISON_FILTER
from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import base_tier_status_term
from app.core.crud import pull_one_from_db
from app.shared.schemas.literals import FLSaisonStatus


class PublicSaison(NamedTuple):
    """The season a base-tier read is scoped by, with what its reads derive from: the scoring rules and the status."""

    id: str
    rules: FLSaisonRules
    status: FLSaisonStatus


async def resolve_public_saison(*, saisons_collection: AsyncCollection, saison_id: str | None) -> PublicSaison:
    """The season named, else the `active` one; 404 where none is, and where the one named is withheld from this tier.

    One read: the withheld status is a term of the filter, so a season being drawn up misses exactly as an id naming
    none does, and no 403 confirms that it exists.
    """

    db_filter = CURRENT_SAISON_FILTER if saison_id is None else {"_id": saison_id, **base_tier_status_term()}
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter=db_filter, projection=["_id", "rules", "status"])

    return PublicSaison(id=str(saison_raw["_id"]), rules=FLSaisonRules.model_validate(saison_raw["rules"]), status=saison_raw["status"])
