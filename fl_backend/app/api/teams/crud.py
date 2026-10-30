from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.saisons.schemas import FLSaisonRules
from app.api.spielbestaetigungen.services import SeatVoid, build_team_rows_filter, group_seat_voids
from app.api.teams.services import find_entry_refusal
from app.core.crud import anchor_in_db, patch_many_in_db, pull_many_from_db, pull_one_from_db, refuse
from app.shared.schemas.bounds import LIST_LIMIT_MAX
from app.shared.schemas.literals import FLGruppenNames


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
    # entry in its write set.
    await anchor_in_db(
        collection=teams_collection,
        db_filter={"_id": team_id},
        session=session,
    )

    return club


async def pull_team_names(
    *, teams_collection: AsyncCollection, team_ids: Iterable[Any], session: AsyncClientSession | None = None
) -> dict[Any, str]:
    """These clubs' names off their `teams` documents, one read and no command for none; a club no document holds is absent."""

    wanted = list({team_id for team_id in team_ids if team_id is not None})
    if not wanted:
        return {}

    teams = await pull_many_from_db(
        collection=teams_collection, db_filter={"_id": {"$in": wanted}}, projection=["name"], limit=LIST_LIMIT_MAX, session=session
    )

    return {team["_id"]: str(team.get("name") or "") for team in teams}


async def void_moved_seats(
    *,
    spielbestaetigungen_collection: AsyncCollection,
    # One per season row the transaction wrote, from `app/api/spielbestaetigungen/services.py :: seat_void_of`.
    voids: Sequence[SeatVoid | None],
    # REQUIRED: the void commits with the seat writes or neither does, so the old holder's link dies at the write.
    session: AsyncClientSession,
) -> None:
    """Null the links of every seat these writes emptied or handed on, on their teams' confirmations.

    Once per transaction, after its seat writes: a call costs the same however many rows it covers.
    """

    for seats, pairs in group_seat_voids([void for void in voids if void is not None]):
        await patch_many_in_db(
            collection=spielbestaetigungen_collection,
            db_filter=build_team_rows_filter(pairs),
            # Spelled here, so the write traces read the seat entries it sets, none of them a unique key.
            update={"$set": {f"kontakte.{seat}": None for seat in seats}},
            session=session,
        )
