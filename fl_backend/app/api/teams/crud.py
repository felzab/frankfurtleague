import asyncio
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.saisons.schemas import FLSaisonRules
from app.api.spielbestaetigungen.services import SeatVoid, build_team_rows_filter, group_seat_voids
from app.api.spiele.schemas import FLSpielListAdapter
from app.api.teams.schemas import FLTabelle, FLTeamListAdapter, FLTeamsFilterParams
from app.api.teams.services import (
    build_tabelle,
    build_team_pipeline,
    build_team_spiele_filter,
    compose_saison_team,
    find_club_entry_refusal,
    find_entry_refusal,
    find_gruppe_move_refusal,
    find_shorthand_refusal,
)
from app.core.crud import (
    GERMAN_COLLATION,
    aggregate_many_from_db,
    anchor_in_db,
    insert_live,
    is_held_elsewhere,
    patch_many_in_db,
    patch_one_in_db,
    post_one_to_db,
    pull_many_from_db,
    pull_one_from_db,
    pull_whole_from_db,
    refuse,
)
from app.core.readonly import ReadCollection
from app.shared.schemas.bounds import LIST_LIMIT_MAX
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.literals import FLGruppenNames, FLTrikotFarbe


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
    """Refuse `entry_saison_not_future` through `entry_gruppe_full` for one entry into one group.

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
    """The club a junction row is about to name, read for `team_retired` and for the identity the row copies.

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


async def found_a_club(*, teams_collection: AsyncCollection, club: Mapping[str, Any], session: AsyncClientSession) -> Any:
    """Write a new club, its `shorthand` judged against every other, a retired one included; its id."""

    taken = await is_held_elsewhere(collection=teams_collection, key="shorthand", value=club["shorthand"], own_id=None, session=session)
    refuse(find_shorthand_refusal(taken=taken))

    return (await insert_live(collection=teams_collection, document=dict(club), session=session)).inserted_id


async def enter_a_club(
    *,
    teams_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    team_id: Any,
    saison_id: str,
    gruppe: FLGruppenNames,
    trikot_farbe: FLTrikotFarbe | None,
    session: AsyncClientSession,
) -> Mapping[str, Any]:
    """Judge this club's entry into the season and write its row, in the caller's transaction; everything judged is read in-session."""

    # The one read of the club, and it earns its place twice over: an id naming nothing 404s here rather than inserting
    # a row pointing at no club, and the season's own copy of the name and shorthand is seeded from it.
    team_raw = await pull_a_club_to_enter(teams_collection=teams_collection, team_id=team_id, session=session)
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)

    # Before the count: the club's standing in the LEAGUE cannot be repaired by picking another group, so nobody should
    # be handed a capacity figure to act on first.
    refuse(find_club_entry_refusal(inactive_since=team_raw.get("inactive_since")))

    await refuse_a_full_gruppe(
        saison_teams_collection=saison_teams_collection,
        saisons_collection=saisons_collection,
        saison_id=saison_id,
        gruppe=gruppe,
        saison_status=str(saison_raw["status"]),
        # Validated, not read raw: a season missing the capacity keys fails here rather than admitting a team against a
        # bound nobody chose.
        rules=FLSaisonRules.model_validate(saison_raw["rules"]),
        session=session,
    )

    document = compose_saison_team(
        saison_id=saison_id, team_id=team_id, gruppe=gruppe, trikot_farbe=trikot_farbe, name=team_raw["name"], shorthand=team_raw["shorthand"]
    )
    await post_one_to_db(collection=saison_teams_collection, document=document, session=session)

    return document


async def refuse_a_gruppe_move(
    *,
    spiele_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    team_id: Any,
    saison_id: str,
    gruppe: FLGruppenNames,
    rules: FLSaisonRules,
    session: AsyncClientSession,
) -> None:
    """Refuse moving this club into `gruppe` while its fixtures are drawn or the group is full, its status gate aside."""

    spiele_drawn = await spiele_collection.count_documents(build_team_spiele_filter(saison_id=saison_id, team_id=team_id), session=session)
    refuse(find_gruppe_move_refusal(spiele_drawn=spiele_drawn))

    await refuse_a_full_gruppe(
        saison_teams_collection=saison_teams_collection,
        saisons_collection=saisons_collection,
        saison_id=saison_id,
        gruppe=gruppe,
        # A MOVE is not an entry -- the club already holds a row -- so the status gate on entering does not judge it, and
        # only its two group gates apply.
        saison_status="future",
        rules=rules,
        session=session,
    )


async def write_the_club(
    *,
    teams_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    team_id: Any,
    club: Mapping[str, Any],
    expected_version: int | None,
    session: AsyncClientSession,
) -> tuple[Mapping[str, Any], int]:
    """Write a club and rewrite the name and shorthand its unfinished seasons' rows carry; the stored club and how many rows moved.

    Every fixture reads its sides' names from their season rows, so a rename reaches the fixtures of each season it
    rewrites; a `past` season keeps the name it was played under.
    """

    taken = await is_held_elsewhere(collection=teams_collection, key="shorthand", value=club["shorthand"], own_id=team_id, session=session)
    refuse(find_shorthand_refusal(taken=taken))
    stored = await patch_one_in_db(
        collection=teams_collection,
        db_filter={"_id": team_id},
        update={"$set": dict(club)},
        expected_version=expected_version,
        session=session,
        return_document=ReturnDocument.AFTER,
    )

    # Read through the session, so a season closed by a concurrent write cannot leave the junction rewritten and its
    # fixtures not, or the reverse.
    open_saisons = await pull_many_from_db(
        collection=saisons_collection, db_filter={"status": {"$ne": "past"}}, projection=["_id"], session=session
    )
    # One season per year against a 1024-row read: the list cannot truncate this century.
    open_saison_ids = [row["_id"] for row in open_saisons]
    # A read alone joins no write set, and the rollover writes no club row, so without this a season closed under the
    # rename would have its rows renamed after it closed; anchored, the rollover's demotion conflicts with the rename and
    # the retry reads the season `past`.
    await anchor_in_db(collection=saisons_collection, db_filter={"_id": {"$in": open_saison_ids}}, session=session)

    junction = await patch_many_in_db(
        collection=saison_teams_collection,
        db_filter={"team_id": team_id, "saison_id": {"$in": open_saison_ids}},
        update={"$set": {"name": club["name"], "shorthand": club["shorthand"]}},
        session=session,
    )

    return stored, junction.modified_count


async def pull_tabelle(
    *, teams_collection: AsyncCollection, spiele_collection: AsyncCollection, saison_id: str, rules: FLSaisonRules
) -> FLTabelle:
    """One season's standing over the group phase, every row placed; the clubs and the group fixtures read at once.

    The fixtures beside the clubs, because the tiebreak chain weighs a head-to-head table over the same set the
    statistics counted.
    """

    teams_raw, spiele_raw = await asyncio.gather(
        aggregate_many_from_db(
            collection=teams_collection,
            pipeline=build_team_pipeline(filters=FLTeamsFilterParams(saison_id=saison_id), rules=rules),
            collation=GERMAN_COLLATION,
        ),
        pull_many_from_db(collection=spiele_collection, db_filter={"saison_id": saison_id, "saison_phase": "gruppenphase"}),
    )

    return build_tabelle(teams=FLTeamListAdapter.validate_python(teams_raw), spiele=FLSpielListAdapter.validate_python(spiele_raw), rules=rules)


async def pull_team_names(
    *, teams_collection: ReadCollection, team_ids: Iterable[Any], session: AsyncClientSession | None = None
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


async def pull_saison_team_names(*, saison_teams_collection: ReadCollection, saison_id: str) -> Mapping[CustomObjectId, str]:
    """Each club of the season by the name it plays that season under, never today's: a list of the season shows that name."""

    rows = await pull_whole_from_db(
        collection=saison_teams_collection,
        db_filter={"saison_id": saison_id},
        what=f"season {saison_id}'s clubs",
        projection=["team_id", "name"],
    )

    return {row["team_id"]: str(row["name"]) for row in rows}
