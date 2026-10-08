"""
API · the collections a mailbox's records are read from, as one request holds them

One dependency hands every reader of a person's records the same six handles, so no handler wires
them by hand and a reader left short of one is a type error rather than a list answered empty.
"""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends
from pymongo.asynchronous.collection import AsyncCollection

from app.core.db import (
    get_bewerbungen_collection,
    get_registrierungen_collection,
    get_saison_teams_collection,
    get_saisons_collection,
    get_schiedsrichter_collection,
    get_spieler_collection,
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
    saison_teams_collection: Annotated[AsyncCollection, Depends(get_saison_teams_collection)],
    saisons_collection: Annotated[AsyncCollection, Depends(get_saisons_collection)],
    spieler_collection: Annotated[AsyncCollection, Depends(get_spieler_collection)],
    schiedsrichter_collection: Annotated[AsyncCollection, Depends(get_schiedsrichter_collection)],
    bewerbungen_collection: Annotated[AsyncCollection, Depends(get_bewerbungen_collection)],
    registrierungen_collection: Annotated[AsyncCollection, Depends(get_registrierungen_collection)],
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
