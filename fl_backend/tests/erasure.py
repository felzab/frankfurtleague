from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime
from typing import Any

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identity.crud import ERASURE_STEPS
from app.api.identity.person_router import post_account_erasure
from app.core.collections import Collection
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.shared.folding import sign_in_identifier
from app.shared.schemas.literals import KONTAKT_ROLLEN


def erasure_collections(database: AsyncDatabase | Mapping[Collection, Any], **replaced: Any) -> dict[str, Any]:
    """Every collection the registry's steps reach, keyed as the routes take them, any replaced by name.

    Read off `app/api/identity/crud.py :: ERASURE_STEPS`: a step reaching a collection no route takes, or the reverse,
    fails the call.
    """

    handles = {f"{collection.name.lower()}_collection": database[collection] for step in ERASURE_STEPS for collection in sorted(step.reaches)}
    return {**handles, **replaced}


async def erased(
    database: AsyncDatabase | Mapping[Collection, Any], client: AsyncMongoClient, address: str, *, germany_now: datetime, **replaced: Any
) -> None:
    """Every record `address` holds, erased by the person route's own function outside a request, any collection replaced by name.

    Folded here as the route's binder folds the signed address: handed on as typed, it would match no stored record.
    """

    await post_account_erasure(
        identifier=sign_in_identifier(address),
        **erasure_collections(database, **replaced),
        db=client,
        germany_now=germany_now,
    )


type Snapshot = Mapping[str, Sequence[Mapping[str, Any]]]


def seats_cleared(before: Iterable[Mapping[str, Any]], after: Iterable[Mapping[str, Any]]) -> int:
    """The contact seats held before and empty after, whoever held them, so a seat cleared past the address counts too."""

    def held(rows: Iterable[Mapping[str, Any]]) -> set[tuple[Any, str]]:
        return {(row["_id"], seat) for row in rows for seat in KONTAKT_ROLLEN if isinstance((row.get("kontakte") or {}).get(seat), Mapping)}

    return len(held(before) - held(after))


def what_the_erasure_took(before: Snapshot, after: Snapshot) -> dict[str, int]:
    """Each kind the erasure preview counts, read off the stored data on either side of the erasure, keyed as the preview's answer.

    Address-blind, so a step reaching past the address counts what it took, and one skipping a collection counts short.
    """

    def ids(name: Collection, snapshot: Snapshot) -> set[Any]:
        return {row["_id"] for row in snapshot.get(name, [])}

    def gone(name: Collection) -> int:
        return len(ids(name, before) - ids(name, after))

    def by_id(name: Collection, snapshot: Snapshot) -> dict[Any, Mapping[str, Any]]:
        return {row["_id"]: row for row in snapshot.get(name, [])}

    def referee_of(spiel: Mapping[str, Any] | None) -> Any:
        return ((spiel or {}).get("schiedsrichter") or {}).get("schiedsrichter_id")

    spiele_after = by_id(Collection.SPIELE, after)
    changes_after = by_id(Collection.ADDRESS_CHANGES, after)

    return {
        "spieler": gone(Collection.SPIELER),
        "schiedsrichter": gone(Collection.SCHIEDSRICHTER),
        "kontakt_seats": seats_cleared(before.get(Collection.SAISON_TEAMS, []), after.get(Collection.SAISON_TEAMS, [])),
        "bewerbung_seats": seats_cleared(before.get(Collection.BEWERBUNGEN, []), after.get(Collection.BEWERBUNGEN, [])),
        "registrierungen": gone(Collection.REGISTRIERUNGEN),
        # Moved onto the ghost, played or not: the preview counts only those still to be played.
        "spiele": sum(
            1
            for spiel_id, spiel in by_id(Collection.SPIELE, before).items()
            if referee_of(spiel) != GHOST_SCHIEDSRICHTER_ID and referee_of(spiele_after.get(spiel_id)) == GHOST_SCHIEDSRICHTER_ID
        ),
        "address_change": sum(
            1
            for change_id, change in by_id(Collection.ADDRESS_CHANGES, before).items()
            if change.get("ended") is None and (changes_after.get(change_id) or {}).get("ended") is not None
        ),
        "grants": gone(Collection.GRANTS),
    }
