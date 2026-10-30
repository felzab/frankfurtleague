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

AktionenCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.AKTIONEN))]

BewerbungenCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.BEWERBUNGEN))]

SperrlisteCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.SPERRLISTE))]

EinladungenCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.EINLADUNGEN))]

RegistrierungenCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.REGISTRIERUNGEN))]

BerechtigungenCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.BERECHTIGUNGEN))]

BerechtigungenAngekuendigtCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.BERECHTIGUNGEN_ANGEKUENDIGT))]

BerechtigungenPostausgangCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.BERECHTIGUNGEN_POSTAUSGANG))]

SpielbestaetigungenCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.SPIELBESTAETIGUNGEN))]

SpielberichteCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.SPIELBERICHTE))]

AdresswechselCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.ADRESSWECHSEL))]

AdresswechselPostausgangCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.ADRESSWECHSEL_POSTAUSGANG))]

DrosselungCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.DROSSELUNG))]

BerechtigungenAntraegeCollection = Annotated[AsyncCollection, Depends(collection_dependency(Collection.BERECHTIGUNGEN_ANTRAEGE))]


# Injected rather than read at the call site, which is what keeps "today" substitutable in tests.
def get_germany_now() -> datetime:
    return clock.now()


def get_german_date_str(germany_now: datetime = Depends(get_germany_now)) -> str:
    return germany_now.strftime("%Y-%m-%d")
