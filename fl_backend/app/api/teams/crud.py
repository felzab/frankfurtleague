from collections.abc import Mapping, Sequence
from typing import Any, NamedTuple

from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.saisons.schemas import FLSaisonRules
from app.api.spielbestaetigungen.services import build_open_seat_rows_pipeline, compose_seat_void, group_seat_voids, seat_void_of
from app.api.teams.schemas import FLGruppenNames
from app.api.teams.services import find_entry_refusal
from app.core.crud import aggregate_many_from_db, anchor_in_db, patch_many_in_db, patch_one_in_db, pull_many_from_db, pull_one_from_db, refuse


async def refuse_a_full_gruppe(
    *,
    saison_teams_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    saison_id: str,
    gruppe: FLGruppenNames,
    saison_status: str,
    rules: FLSaisonRules,
    # REQUIRED: the anchor below is what closes the race, so forgetting the session has to be a
    # TypeError at the call rather than a silent reopening of it.
    session: AsyncClientSession,
) -> None:
    """Refuse `REQ-ENTER-001` through `REQ-ENTER-003` for one entry into one group.

    Its own module rather than a private helper, because a rule reached from two packages is one a
    package can enter past.
    """

    # A count is a read, which a snapshot re-validates nowhere, so two entrants pass one figure
    # unless something puts them in one write set.
    await anchor_in_db(
        collection=saisons_collection,
        db_filter={"_id": saison_id},
        session=session,
    )

    occupied_rows = await pull_many_from_db(
        collection=saison_teams_collection,
        db_filter={"saison_id": saison_id, "gruppe": gruppe},
        projection=["_id"],
        session=session,
    )

    refuse(find_entry_refusal(saison_status=saison_status, gruppe=gruppe, rules=rules, occupied=len(occupied_rows)))


async def pull_a_club_to_enter(
    *,
    teams_collection: AsyncCollection,
    team_id: Any,
    # REQUIRED for `refuse_a_full_gruppe`'s reason: the anchor below closes the race.
    session: AsyncClientSession,
) -> Mapping[str, Any]:
    """The club a junction row is about to name, read for `REQ-ENTER-005` and for the identity the row copies.

    Its own module for `refuse_a_full_gruppe`'s reason: the entry, the acceptance and the replacement
    all name a club, from two packages.
    """

    club = await pull_one_from_db(
        collection=teams_collection,
        db_filter={"_id": team_id},
        projection=["name", "shorthand", "inactive_since"],
        session=session,
    )

    # A retirement judges junction rows and writes only the club, so only a write to the club puts an
    # entry in its write set (`docs/backend/spec.md :: I53`).
    await anchor_in_db(
        collection=teams_collection,
        db_filter={"_id": team_id},
        session=session,
    )

    return club


class SeatWrite(NamedTuple):
    """One season row's seat write: the row, and the update setting its block or whole seats."""

    db_filter: Mapping[str, Any]
    update: Mapping[str, Any]


async def write_saison_team_kontakte(
    *,
    saison_teams_collection: AsyncCollection,
    spielbestaetigungen_collection: AsyncCollection,
    writes: Sequence[SeatWrite],
    return_document: bool,
    # REQUIRED: the void commits with the seat write or neither does, so the old holder's link dies at the write.
    session: AsyncClientSession,
) -> list[Mapping[str, Any]]:
    """Every write of an existing season row's seats, each row's image answered in order (`docs/backend/spec.md :: I758`).

    Several rows in one call, so a pass clearing many pays the void once rather than per row.
    """

    befores: list[Mapping[str, Any]] = []
    for write in writes:
        # A patch per row, never one `patch_many_in_db`, which logs no pre-image: a redaction finds a row's people
        # by its own images. `BEFORE`, so the holder change is judged on what this write replaced.
        befores.append(
            await patch_one_in_db(
                collection=saison_teams_collection,
                db_filter=write.db_filter,
                update=write.update,
                session=session,
                return_document=ReturnDocument.BEFORE,
            )
        )

    voids = [void for before, write in zip(befores, writes, strict=True) if (void := seat_void_of(before=before, update=write.update))]
    # No read for none, and no write for a group the read left empty: a fan-out matching nothing still files a log row.
    if voids:
        open_rows = await aggregate_many_from_db(
            collection=spielbestaetigungen_collection, pipeline=build_open_seat_rows_pipeline(voids), session=session
        )
        for seats, ids in group_seat_voids(voids=voids, open_rows=open_rows):
            db_filter, update = compose_seat_void(seats=seats, ids=ids)
            await patch_many_in_db(collection=spielbestaetigungen_collection, db_filter=db_filter, update=update, session=session)

    if return_document is ReturnDocument.BEFORE:
        return befores

    return [await pull_one_from_db(collection=saison_teams_collection, db_filter={"_id": before["_id"]}, session=session) for before in befores]
