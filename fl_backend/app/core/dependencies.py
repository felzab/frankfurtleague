from datetime import datetime
from typing import Annotated

from fastapi import Depends
from pymongo import AsyncMongoClient
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase

from app.core import clock
from app.core.collections import Collection
from app.core.db import collection_dependency, get_database, get_db_client

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

GrantsApprovalRequestsCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.GRANT_APPROVAL_REQUESTS))]

OutboxCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.OUTBOX))]


# Injected rather than read at the call site, which is what keeps "today" substitutable in tests.
def get_germany_now() -> datetime:
    return clock.now()


def get_german_date_str(germany_now: datetime = Depends(get_germany_now)) -> str:
    return germany_now.strftime("%Y-%m-%d")
