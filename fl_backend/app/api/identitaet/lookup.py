"""
API · the collections a mailbox's records are read from, as one request holds them

One dependency hands every reader of a person's records the same six handles, so no handler wires
them by hand and a reader left short of one is a type error rather than a list answered empty.
"""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends

from app.core.dependencies import (
    BewerbungenReadCollection,
    RegistrierungenReadCollection,
    SaisonsReadCollection,
    SaisonTeamsReadCollection,
    SchiedsrichterReadCollection,
    SpielerReadCollection,
)
from app.core.readonly import ReadCollection


@dataclass(frozen=True, kw_only=True)
class RecordCollections:
    saison_teams_collection: ReadCollection
    saisons_collection: ReadCollection
    spieler_collection: ReadCollection
    schiedsrichter_collection: ReadCollection
    bewerbungen_collection: ReadCollection
    registrierungen_collection: ReadCollection


def get_record_collections(
    saison_teams_collection: SaisonTeamsReadCollection,
    saisons_collection: SaisonsReadCollection,
    spieler_collection: SpielerReadCollection,
    schiedsrichter_collection: SchiedsrichterReadCollection,
    bewerbungen_collection: BewerbungenReadCollection,
    registrierungen_collection: RegistrierungenReadCollection,
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
