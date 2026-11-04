from datetime import datetime
from typing import Annotated

from fastapi import Depends
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase

from app.core import clock
from app.core.collections import Collection
from app.core.db import collection_dependency, get_database, get_db_client, get_snapshot_session
from app.core.readonly import ReadCollection

DBClient = Annotated[AsyncMongoClient, Depends(get_db_client)]

DB = Annotated[AsyncDatabase, Depends(get_database)]

SpieleCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.SPIELE))]

SpielerCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.SPIELER))]

SpieltageCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.SPIELTAGE))]

TeamsCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.TEAMS))]

SaisonsCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.SAISONS))]

SpielorteCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.SPIELORTE))]

SchiedsrichterCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.SCHIEDSRICHTER))]

SaisonTeamsCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.SAISON_TEAMS))]

SaisonSpielerCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.SAISON_SPIELER))]

ActionLogCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.ACTION_LOG))]

BewerbungenCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.BEWERBUNGEN))]

SperrlisteCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.SPERRLISTE))]

InvitationsCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.INVITATIONS))]

RegistrierungenCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.REGISTRIERUNGEN))]

GrantsCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.GRANTS))]

GrantsAnnouncedCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.GRANTS_ANNOUNCED))]

SpielbestaetigungenCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.SPIELBESTAETIGUNGEN))]

SpielberichteCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.SPIELBERICHTE))]

AddressChangeCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.ADDRESS_CHANGES))]

GrantApprovalRequestsCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.GRANT_APPROVAL_REQUESTS))]

OutboxCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.OUTBOX))]

# The same collections typed for reading alone (`app/core/readonly.py`), for an operation the contract marks as
# writing nothing (`app/core/routing.py :: SAFE`). The same dependency as the writable alias, so an override and
# FastAPI's per-request cache both still key on it.
SpieleReadCollection = Annotated[ReadCollection, Depends(collection_dependency(Collection.SPIELE))]

SpielerReadCollection = Annotated[ReadCollection, Depends(collection_dependency(Collection.SPIELER))]

TeamsReadCollection = Annotated[ReadCollection, Depends(collection_dependency(Collection.TEAMS))]

SaisonsReadCollection = Annotated[ReadCollection, Depends(collection_dependency(Collection.SAISONS))]

SpielorteReadCollection = Annotated[ReadCollection, Depends(collection_dependency(Collection.SPIELORTE))]

SchiedsrichterReadCollection = Annotated[ReadCollection, Depends(collection_dependency(Collection.SCHIEDSRICHTER))]

SaisonTeamsReadCollection = Annotated[ReadCollection, Depends(collection_dependency(Collection.SAISON_TEAMS))]

SaisonSpielerReadCollection = Annotated[ReadCollection, Depends(collection_dependency(Collection.SAISON_SPIELER))]

BewerbungenReadCollection = Annotated[ReadCollection, Depends(collection_dependency(Collection.BEWERBUNGEN))]

SperrlisteReadCollection = Annotated[ReadCollection, Depends(collection_dependency(Collection.SPERRLISTE))]

InvitationsReadCollection = Annotated[ReadCollection, Depends(collection_dependency(Collection.INVITATIONS))]

RegistrierungenReadCollection = Annotated[ReadCollection, Depends(collection_dependency(Collection.REGISTRIERUNGEN))]

GrantsReadCollection = Annotated[ReadCollection, Depends(collection_dependency(Collection.GRANTS))]

GrantsAnnouncedReadCollection = Annotated[ReadCollection, Depends(collection_dependency(Collection.GRANTS_ANNOUNCED))]

SpielbestaetigungenReadCollection = Annotated[ReadCollection, Depends(collection_dependency(Collection.SPIELBESTAETIGUNGEN))]

AddressChangeReadCollection = Annotated[ReadCollection, Depends(collection_dependency(Collection.ADDRESS_CHANGES))]

GrantApprovalRequestsReadCollection = Annotated[ReadCollection, Depends(collection_dependency(Collection.GRANT_APPROVAL_REQUESTS))]

OutboxReadCollection = Annotated[ReadCollection, Depends(collection_dependency(Collection.OUTBOX))]

# Ended when the handler returns, before the response is sent (FastAPI's `scope="function"`), so no session outlives
# the reads it served. Cached per request as every dependency is: an admin view shares its guard's, one after the other.
SnapshotSession = Annotated[AsyncClientSession, Depends(get_snapshot_session, scope="function")]


# Injected rather than read at the call site, which is what keeps "today" substitutable in tests.
def get_germany_now() -> datetime:
    return clock.now()


def get_german_date_str(germany_now: datetime = Depends(get_germany_now)) -> str:
    return germany_now.strftime("%Y-%m-%d")
