"""
API · the ban list as one request asks it

One dependency holds the list's collection, the key its rows are hashed under and the collection the
season a ban is judged against is read from, so no handler wires the three by hand. Every question
below reads the running season itself unless handed one: the queries under them read no bound for
`None`, which holds every ban standing.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Annotated, Final

from fastapi import Depends
from pydantic import SecretStr
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.saisons.crud import pull_massgebliche_saison_id
from app.api.sperrliste.crud import address_is_barred, read_barred_addresses, read_barred_hashes
from app.api.sperrliste.services import address_hash
from app.core.config import BackendConfig, get_app_config
from app.core.dependencies import BanListReadCollection, SaisonsReadCollection
from app.core.readonly import ReadCollection


class RunningSeason:
    """The default season of every question below: the running one, read in the caller's session where it passes one."""


RUNNING_SEASON: Final = RunningSeason()

# A season a caller already holds, or the running one read afresh.
Saison = str | None | RunningSeason


@dataclass(frozen=True)
class BanList:
    ban_list_collection: ReadCollection
    saisons_collection: ReadCollection
    key: SecretStr

    def hash_of(self, address: str) -> str:
        """The stored form of an address a payload carries, keyed from its own spelling."""

        return address_hash(address, key=self.key)


async def ban_list_saison(ban_list: BanList, *, session: AsyncClientSession | None = None) -> str | None:
    """The season a ban is judged against, for a caller reading it once ahead of several questions."""

    return await pull_massgebliche_saison_id(ban_list.saisons_collection, session=session)


async def _saison(ban_list: BanList, saison: Saison, *, session: AsyncClientSession | None) -> str | None:
    return await ban_list_saison(ban_list, session=session) if isinstance(saison, RunningSeason) else saison


async def barred_addresses(
    ban_list: BanList,
    addresses: Iterable[str],
    *,
    session: AsyncClientSession | None = None,
    governing_saison_id: Saison = RUNNING_SEASON,
) -> set[str]:
    """Which of these stored addresses a standing ban holds (`app/api/sperrliste/crud.py :: read_barred_addresses`)."""

    return await read_barred_addresses(
        addresses,
        ban_list_collection=ban_list.ban_list_collection,
        key=ban_list.key,
        governing_saison_id=await _saison(ban_list, governing_saison_id, session=session),
        session=session,
    )


async def hash_barred(
    ban_list: BanList,
    hashed: str,
    *,
    session: AsyncClientSession | None = None,
    governing_saison_id: Saison = RUNNING_SEASON,
) -> bool:
    """Whether a standing ban holds this hash (`app/api/sperrliste/crud.py :: address_is_barred`)."""

    return await address_is_barred(
        ban_list_collection=ban_list.ban_list_collection,
        address_hash=hashed,
        governing_saison_id=await _saison(ban_list, governing_saison_id, session=session),
        session=session,
    )


async def barred_hashes(
    ban_list: BanList,
    hashes: Iterable[str],
    *,
    session: AsyncClientSession | None = None,
    governing_saison_id: Saison = RUNNING_SEASON,
) -> set[str]:
    """Which of these hashes a standing ban holds, in one read (`app/api/sperrliste/crud.py :: read_barred_hashes`)."""

    return await read_barred_hashes(
        ban_list_collection=ban_list.ban_list_collection,
        address_hashes=hashes,
        governing_saison_id=await _saison(ban_list, governing_saison_id, session=session),
        session=session,
    )


def get_ban_list(
    ban_list_collection: BanListReadCollection,
    saisons_collection: SaisonsReadCollection,
    config: Annotated[BackendConfig, Depends(get_app_config)],
) -> BanList:
    """The request's ban list, keyed as every row of it is."""

    return BanList(ban_list_collection=ban_list_collection, saisons_collection=saisons_collection, key=config.sperrliste_key)


BanListLookup = Annotated[BanList, Depends(get_ban_list)]
