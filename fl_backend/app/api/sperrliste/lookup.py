"""
API · the ban list as one request asks it

One dependency holds the list's collection, the key its rows are hashed under and the collection the
season a ban is judged against is read from, so no handler wires the three by hand. Every question
below reads the running season itself unless handed one: the queries under them read no bound for
`None`, which holds every ban standing. Functions rather than methods, so the transaction sweeps
follow a session handed to one (`fl_backend/tests/core/app_source.py :: session_handoffs`).
"""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Annotated, Final

from fastapi import Depends
from pydantic import SecretStr
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.saisons.crud import pull_massgebliche_saison_id
from app.api.sperrliste.crud import address_is_gesperrt, gesperrte_adressen, gesperrte_hashes
from app.api.sperrliste.services import adresse_hash
from app.core.config import BackendConfig, get_app_config
from app.core.db import get_saisons_collection, get_sperrliste_collection


class RunningSeason:
    """The default season of every question below: the running one, read in the caller's session where it passes one."""


RUNNING_SEASON: Final = RunningSeason()

# A season a caller already holds, or the running one read afresh.
Saison = str | None | RunningSeason


@dataclass(frozen=True)
class BanList:
    sperrliste_collection: AsyncCollection
    saisons_collection: AsyncCollection
    schluessel: SecretStr

    def hash_of(self, adresse: str) -> str:
        """The stored form of an address a payload carries, keyed from its own spelling."""

        return adresse_hash(adresse, schluessel=self.schluessel)


async def sperrliste_saison(sperrliste: BanList, *, session: AsyncClientSession | None = None) -> str | None:
    """The season a ban is judged against, for a caller reading it once ahead of several questions."""

    return await pull_massgebliche_saison_id(sperrliste.saisons_collection, session=session)


async def _saison(sperrliste: BanList, saison: Saison, *, session: AsyncClientSession | None) -> str | None:
    return await sperrliste_saison(sperrliste, session=session) if isinstance(saison, RunningSeason) else saison


async def adressen_gesperrt(
    sperrliste: BanList,
    adressen: Iterable[str],
    *,
    session: AsyncClientSession | None = None,
    massgebliche_saison_id: Saison = RUNNING_SEASON,
) -> set[str]:
    """Which of these stored addresses a standing ban holds (`app/api/sperrliste/crud.py :: gesperrte_adressen`)."""

    return await gesperrte_adressen(
        adressen,
        sperrliste_collection=sperrliste.sperrliste_collection,
        schluessel=sperrliste.schluessel,
        massgebliche_saison_id=await _saison(sperrliste, massgebliche_saison_id, session=session),
        session=session,
    )


async def hash_gesperrt(
    sperrliste: BanList,
    gehasht: str,
    *,
    session: AsyncClientSession | None = None,
    massgebliche_saison_id: Saison = RUNNING_SEASON,
) -> bool:
    """Whether a standing ban holds this hash (`app/api/sperrliste/crud.py :: address_is_gesperrt`)."""

    return await address_is_gesperrt(
        sperrliste_collection=sperrliste.sperrliste_collection,
        adresse_hash=gehasht,
        massgebliche_saison_id=await _saison(sperrliste, massgebliche_saison_id, session=session),
        session=session,
    )


async def hashes_gesperrt(
    sperrliste: BanList,
    hashes: Iterable[str],
    *,
    session: AsyncClientSession | None = None,
    massgebliche_saison_id: Saison = RUNNING_SEASON,
) -> set[str]:
    """Which of these hashes a standing ban holds, in one read (`app/api/sperrliste/crud.py :: gesperrte_hashes`)."""

    return await gesperrte_hashes(
        sperrliste_collection=sperrliste.sperrliste_collection,
        adresse_hashes=hashes,
        massgebliche_saison_id=await _saison(sperrliste, massgebliche_saison_id, session=session),
        session=session,
    )


def get_ban_list(
    sperrliste_collection: Annotated[AsyncCollection, Depends(get_sperrliste_collection)],
    saisons_collection: Annotated[AsyncCollection, Depends(get_saisons_collection)],
    config: Annotated[BackendConfig, Depends(get_app_config)],
) -> BanList:
    """The request's ban list, keyed as every row of it is (`docs/backend/spec.md :: I463`)."""

    return BanList(sperrliste_collection=sperrliste_collection, saisons_collection=saisons_collection, schluessel=config.sperrliste_schluessel)


SperrlisteLookup = Annotated[BanList, Depends(get_ban_list)]
