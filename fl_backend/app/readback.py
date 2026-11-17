"""Read every stored document back through its record model, and name each one that model refuses.

Read-only, for after a migration's files have run: `python -m app.readback` in the backend's container.
It prints a document's id and the location of each error, never a value, and closes on `CLOSING_LINE`. It
exits 0 when every document validates, 1 when any is refused, 2 when its settings could not be loaded or
the database could not be read, and 3 when the read-back itself failed. A 1 is the read-back's own only
beside its closing line, which is how a caller tells it from Python's own 1 for a module that never ran.
"""

import asyncio
import traceback
from collections.abc import Mapping
from typing import Final, NoReturn

from pydantic import BaseModel, ValidationError
from pymongo import AsyncMongoClient
from pymongo.errors import PyMongoError

from app.api.action_log.schemas import FLActionLogRecord
from app.api.address_change.schemas import FLAddressChangeRecord
from app.api.aufstellungen.schemas import FLAufstellung
from app.api.ban_list.schemas import FLBanListRecord
from app.api.bewerbungen.schemas import FLBewerbungRecord, FLMailboxAnchorRecord
from app.api.grants.schemas import FLGrantRecord
from app.api.invitations.schemas import FLInvitationRecord
from app.api.outbox.schemas import FLOutboxRow
from app.api.registrierungen.schemas import FLRegistrierungRecord
from app.api.saisons.schemas import FLSaisonRecord
from app.api.schiedsrichter.schemas import FLSchiedsrichterRecord
from app.api.spielberichte.schemas import FLSpielbericht
from app.api.spielbestaetigungen.schemas import FLSpielbestaetigungRecord
from app.api.spiele.schemas import FLSpiel
from app.api.spieler.schemas import FLSaisonSpielerRow, FLSpielerRecord
from app.api.spielorte.schemas import FLSpielort
from app.api.spieltage.schemas import FLSpieltagRecord
from app.api.teams.schemas import FLSaisonTeamRecord, FLTeamRecord
from app.core.collections import EDITED_COLLECTIONS, Collection
from app.core.config import EnvironmentValidationError, get_config  # noqa: TID251
from app.core.crud import VERSION_FIELD
from app.core.db import new_client

# The exit contract the scripts read: 0 clean, 1 a document to correct, 2 could not judge, 3 crashed.
REFUSED: Final = 1
UNJUDGED: Final = 2
CRASHED: Final = 3

# The read-back's last line. A script running it reads a 1 without this line, a document refused in it, as Compose's
# or Python's, a crash, so the read-back's tests hold this wording to the pattern that script matches.
CLOSING_LINE: Final = "{read} documents read, {refused} refused."

RECORD_MODELS: Mapping[Collection, type[BaseModel]] = {
    Collection.SAISONS: FLSaisonRecord,
    Collection.SAISON_TEAMS: FLSaisonTeamRecord,
    Collection.SAISON_SPIELER: FLSaisonSpielerRow,
    Collection.SPIELE: FLSpiel,
    Collection.SPIELTAGE: FLSpieltagRecord,
    Collection.TEAMS: FLTeamRecord,
    Collection.SPIELER: FLSpielerRecord,
    Collection.SPIELORTE: FLSpielort,
    Collection.SCHIEDSRICHTER: FLSchiedsrichterRecord,
    Collection.BEWERBUNGEN: FLBewerbungRecord,
    Collection.ACTION_LOG: FLActionLogRecord,
    Collection.BAN_LIST: FLBanListRecord,
    Collection.INVITATIONS: FLInvitationRecord,
    Collection.REGISTRIERUNGEN: FLRegistrierungRecord,
    Collection.GRANTS: FLGrantRecord,
    Collection.SPIELBESTAETIGUNGEN: FLSpielbestaetigungRecord,
    Collection.SPIELBERICHTE: FLSpielbericht,
    Collection.AUFSTELLUNGEN: FLAufstellung,
    Collection.ADDRESS_CHANGES: FLAddressChangeRecord,
    Collection.OUTBOX: FLOutboxRow,
    Collection.MAILBOX_ANCHORS: FLMailboxAnchorRecord,
}

if missing := set(Collection) - RECORD_MODELS.keys():
    raise RuntimeError(f"No record model for {', '.join(sorted(missing))}: add one to RECORD_MODELS.")


def _crashed(error: BaseException) -> NoReturn:
    """The crash by its type and where it was raised: a message, or a traceback's locals, can carry a secret's value."""

    frames = traceback.extract_tb(error.__traceback__)
    where = f" at {frames[-1].filename}:{frames[-1].lineno}" if frames else ""
    print(f"The read-back crashed ({type(error).__name__}{where}).")
    raise SystemExit(CRASHED) from None


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

    print(CLOSING_LINE.format(read=read, refused=refused))
    return REFUSED if refused else 0


async def _main() -> int:
    try:
        config = get_config()
    # Its message names variables, files and failure types, never a value, as the backend's boot logs it.
    except EnvironmentValidationError as refusal:
        print(f"The settings could not be loaded: {refusal}")
        return UNJUDGED
    client = new_client(config.mongodb_uri.get_secret_value())
    try:
        return await read_back(client, config.db_base_name)
    # The type alone: the driver's message names the host it resolved out of the secret.
    except PyMongoError as failure:
        print(f"The database could not be read ({type(failure).__name__}).")
        return UNJUDGED
    finally:
        await client.close()


if __name__ == "__main__":
    try:
        code = asyncio.run(_main())
    except Exception as error:
        _crashed(error)
    raise SystemExit(code)
