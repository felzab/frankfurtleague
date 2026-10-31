"""Read every stored document back through its record model, and name each one that model refuses.

Read-only, for after a migration paste: `python -m app.readback` in the backend's container.
It prints a document's id and the location of each error, never a value, and exits 0 when every
document validates, 1 when any is refused, and 2 when the database could not be read.
"""

import asyncio
from collections.abc import Mapping

from pydantic import BaseModel, ValidationError
from pymongo import AsyncMongoClient
from pymongo.errors import PyMongoError

from app.api.adresswechsel.schemas import FLAdresswechselRecord
from app.api.aktionen.schemas import FLAktionRecord
from app.api.berechtigungen.schemas import FLBerechtigung, FLBerechtigungAngekuendigt, FLBerechtigungAntrag
from app.api.bewerbungen.schemas import FLBewerbungRecord
from app.api.einladungen.schemas import FLEinladungRecord
from app.api.outbox.schemas import FLOutboxRow
from app.api.registrierungen.schemas import FLRegistrierungRecord
from app.api.saisons.schemas import FLSaisonRecord
from app.api.schiedsrichter.schemas import FLSchiedsrichterRecord
from app.api.sperrliste.schemas import FLSperrlisteEintragRecord
from app.api.spielberichte.schemas import FLSpielbericht
from app.api.spielbestaetigungen.schemas import FLSpielbestaetigungRecord
from app.api.spiele.schemas import FLSpiel
from app.api.spieler.schemas import FLSaisonSpielerRecord, FLSpielerRecord
from app.api.spielorte.schemas import FLSpielort
from app.api.spieltage.schemas import FLSpieltagRecord
from app.api.teams.schemas import FLSaisonTeamRecord, FLTeamRecord
from app.core.collections import EDITED_COLLECTIONS, Collection
from app.core.config import get_config  # noqa: TID251
from app.core.crud import VERSION_FIELD
from app.core.db import SERVER_SELECTION_TIMEOUT_MS

RECORD_MODELS: Mapping[Collection, type[BaseModel]] = {
    Collection.SAISONS: FLSaisonRecord,
    Collection.SAISON_TEAMS: FLSaisonTeamRecord,
    Collection.SAISON_SPIELER: FLSaisonSpielerRecord,
    Collection.SPIELE: FLSpiel,
    Collection.SPIELTAGE: FLSpieltagRecord,
    Collection.TEAMS: FLTeamRecord,
    Collection.SPIELER: FLSpielerRecord,
    Collection.SPIELORTE: FLSpielort,
    Collection.SCHIEDSRICHTER: FLSchiedsrichterRecord,
    Collection.BEWERBUNGEN: FLBewerbungRecord,
    Collection.ACTION_LOG: FLAktionRecord,
    Collection.SPERRLISTE: FLSperrlisteEintragRecord,
    Collection.INVITATIONS: FLEinladungRecord,
    Collection.REGISTRIERUNGEN: FLRegistrierungRecord,
    Collection.GRANTS: FLBerechtigung,
    Collection.GRANTS_ANNOUNCED: FLBerechtigungAngekuendigt,
    Collection.SPIELBESTAETIGUNGEN: FLSpielbestaetigungRecord,
    Collection.SPIELBERICHTE: FLSpielbericht,
    Collection.ADDRESS_CHANGES: FLAdresswechselRecord,
    Collection.GRANT_APPROVAL_REQUESTS: FLBerechtigungAntrag,
    Collection.OUTBOX: FLOutboxRow,
}

if missing := set(Collection) - RECORD_MODELS.keys():
    raise RuntimeError(f"No record model for {', '.join(sorted(missing))}: add one to RECORD_MODELS.")


async def read_back(client: AsyncMongoClient, database_name: str) -> int:
    refused = read = 0
    for collection, model in RECORD_MODELS.items():
        async for document in client[database_name][collection].find({}):
            read += 1
            # Checked here rather than by the model, whose `version` defaults to 0 for the runtime reads: a
            # document without one is served as 0, and every save of it is then refused as stale.
            locations = [VERSION_FIELD] if collection in EDITED_COLLECTIONS and VERSION_FIELD not in document else []
            try:
                model.model_validate(document, extra="forbid")
            except ValidationError as error:
                locations += [
                    ".".join(str(step) for step in detail["loc"])
                    for detail in error.errors(include_input=False, include_context=False, include_url=False)
                ]
            if locations:
                refused += 1
                for location in locations:
                    print(f"{collection} {document.get('_id')} {location}")

    print(f"{read} documents read, {refused} refused.")
    return 1 if refused else 0


async def _main() -> int:
    config = get_config()
    client = AsyncMongoClient(host=config.mongodb_uri.get_secret_value(), serverSelectionTimeoutMS=SERVER_SELECTION_TIMEOUT_MS)
    try:
        return await read_back(client, config.db_base_name)
    # The type alone: the driver's message names the host it resolved out of the secret.
    except PyMongoError as failure:
        print(f"The database could not be read ({type(failure).__name__}).")
        return 2
    finally:
        await client.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
