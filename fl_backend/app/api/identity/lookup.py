"""The handles a person's records are read and written through, one bundle per path, each built by one dependency.

No handler wires them by hand, so a reader or a write left short of one is a type error rather than a list answered
empty or a record left standing. Each bundle takes the same per-collection dependencies every route takes, so an
override of one collection reaches it.
"""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends
from pymongo.asynchronous.collection import AsyncCollection

from app.core.dependencies import (
    ActionLogCollection,
    AddressChangeCollection,
    AufstellungenCollection,
    BewerbungenCollection,
    BewerbungenReadCollection,
    GrantsCollection,
    MailboxAnchorsCollection,
    OutboxCollection,
    RegistrierungenCollection,
    RegistrierungenReadCollection,
    SaisonSpielerCollection,
    SaisonTeamsCollection,
    SaisonTeamsReadCollection,
    SchiedsrichterCollection,
    SchiedsrichterReadCollection,
    SpielberichteCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
    SpielerCollection,
    SpielerReadCollection,
)
from app.core.readonly import ReadCollection


@dataclass(frozen=True, kw_only=True)
class RecordCollections:
    saison_teams_collection: ReadCollection
    spieler_collection: ReadCollection
    schiedsrichter_collection: ReadCollection
    bewerbungen_collection: ReadCollection
    registrierungen_collection: ReadCollection


def get_record_collections(
    saison_teams_collection: SaisonTeamsReadCollection,
    spieler_collection: SpielerReadCollection,
    schiedsrichter_collection: SchiedsrichterReadCollection,
    bewerbungen_collection: BewerbungenReadCollection,
    registrierungen_collection: RegistrierungenReadCollection,
) -> RecordCollections:
    return RecordCollections(
        saison_teams_collection=saison_teams_collection,
        spieler_collection=spieler_collection,
        schiedsrichter_collection=schiedsrichter_collection,
        bewerbungen_collection=bewerbungen_collection,
        registrierungen_collection=registrierungen_collection,
    )


SubjectLookup = Annotated[RecordCollections, Depends(get_record_collections)]


@dataclass(frozen=True, kw_only=True)
class ErasureCollections:
    """Every collection an erasure of one address writes or reads, handed from the route to each step as one argument."""

    spieler_collection: AsyncCollection
    saison_spieler_collection: AsyncCollection
    saison_teams_collection: AsyncCollection
    bewerbungen_collection: AsyncCollection
    schiedsrichter_collection: AsyncCollection
    spiele_collection: AsyncCollection
    spielbestaetigungen_collection: AsyncCollection
    spielberichte_collection: AsyncCollection
    aufstellungen_collection: AsyncCollection
    registrierungen_collection: AsyncCollection
    action_log_collection: AsyncCollection
    grants_collection: AsyncCollection
    outbox_collection: AsyncCollection
    address_changes_collection: AsyncCollection

    @property
    def records(self) -> RecordCollections:
        """The five a person's records are judged by, the same handles read-only."""

        return RecordCollections(
            saison_teams_collection=self.saison_teams_collection,
            spieler_collection=self.spieler_collection,
            schiedsrichter_collection=self.schiedsrichter_collection,
            bewerbungen_collection=self.bewerbungen_collection,
            registrierungen_collection=self.registrierungen_collection,
        )


def get_erasure_collections(
    spieler_collection: SpielerCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spielberichte_collection: SpielberichteCollection,
    aufstellungen_collection: AufstellungenCollection,
    registrierungen_collection: RegistrierungenCollection,
    action_log_collection: ActionLogCollection,
    grants_collection: GrantsCollection,
    outbox_collection: OutboxCollection,
    address_changes_collection: AddressChangeCollection,
) -> ErasureCollections:
    return ErasureCollections(
        spieler_collection=spieler_collection,
        saison_spieler_collection=saison_spieler_collection,
        saison_teams_collection=saison_teams_collection,
        bewerbungen_collection=bewerbungen_collection,
        schiedsrichter_collection=schiedsrichter_collection,
        spiele_collection=spiele_collection,
        spielbestaetigungen_collection=spielbestaetigungen_collection,
        spielberichte_collection=spielberichte_collection,
        aufstellungen_collection=aufstellungen_collection,
        registrierungen_collection=registrierungen_collection,
        action_log_collection=action_log_collection,
        grants_collection=grants_collection,
        outbox_collection=outbox_collection,
        address_changes_collection=address_changes_collection,
    )


ErasureHandles = Annotated[ErasureCollections, Depends(get_erasure_collections)]


@dataclass(frozen=True, kw_only=True)
class MoveCollections:
    """Every collection an address change's effect writes or reads, handed from the route to the move as one argument."""

    address_changes_collection: AsyncCollection
    spieler_collection: AsyncCollection
    schiedsrichter_collection: AsyncCollection
    saison_teams_collection: AsyncCollection
    bewerbungen_collection: AsyncCollection
    registrierungen_collection: AsyncCollection
    grants_collection: AsyncCollection
    outbox_collection: AsyncCollection
    action_log_collection: AsyncCollection
    mailbox_anchors_collection: AsyncCollection

    @property
    def records(self) -> RecordCollections:
        """The five the address's holdings are judged by, the same handles read-only."""

        return RecordCollections(
            saison_teams_collection=self.saison_teams_collection,
            spieler_collection=self.spieler_collection,
            schiedsrichter_collection=self.schiedsrichter_collection,
            bewerbungen_collection=self.bewerbungen_collection,
            registrierungen_collection=self.registrierungen_collection,
        )


def get_move_collections(
    address_changes_collection: AddressChangeCollection,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    registrierungen_collection: RegistrierungenCollection,
    grants_collection: GrantsCollection,
    outbox_collection: OutboxCollection,
    action_log_collection: ActionLogCollection,
    mailbox_anchors_collection: MailboxAnchorsCollection,
) -> MoveCollections:
    return MoveCollections(
        address_changes_collection=address_changes_collection,
        spieler_collection=spieler_collection,
        schiedsrichter_collection=schiedsrichter_collection,
        saison_teams_collection=saison_teams_collection,
        bewerbungen_collection=bewerbungen_collection,
        registrierungen_collection=registrierungen_collection,
        grants_collection=grants_collection,
        outbox_collection=outbox_collection,
        action_log_collection=action_log_collection,
        mailbox_anchors_collection=mailbox_anchors_collection,
    )


MoveHandles = Annotated[MoveCollections, Depends(get_move_collections)]
