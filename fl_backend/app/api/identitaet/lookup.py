"""
API · the collections a mailbox's records are read from, as one request holds them

One dependency hands every reader of a person's records the same six handles, so no handler wires
them by hand and a reader left short of one is a type error rather than a list answered empty.
"""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends
from pymongo.asynchronous.collection import AsyncCollection

from app.core.dependencies import (
    BewerbungenCollection,
    RegistrierungenCollection,
    SaisonsCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielerCollection,
)


@dataclass(frozen=True, kw_only=True)
class RecordCollections:
    saison_teams_collection: AsyncCollection
    saisons_collection: AsyncCollection
    spieler_collection: AsyncCollection
    schiedsrichter_collection: AsyncCollection
    bewerbungen_collection: AsyncCollection
    registrierungen_collection: AsyncCollection


def get_record_collections(
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    bewerbungen_collection: BewerbungenCollection,
    registrierungen_collection: RegistrierungenCollection,
) -> RecordCollections:
    return RecordCollections(
        saison_teams_collection=saison_teams_collection,
        saisons_collection=saisons_collection,
        spieler_collection=spieler_collection,
        schiedsrichter_collection=schiedsrichter_collection,
        bewerbungen_collection=bewerbungen_collection,
        registrierungen_collection=registrierungen_collection,
    )


SubjektLookup = Annotated[RecordCollections, Depends(get_record_collections)]
