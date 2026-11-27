from collections.abc import Iterable, Mapping
from http import HTTPStatus
from typing import Any

from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.bewerbungen.services import find_already_entered_refusal
from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import FLSpielListAdapter
from app.api.teams.schemas import FLTabelle, FLTeamListAdapter
from app.api.teams.services import (
    ZERO_STATISTIK,
    build_statistik_by_team,
    build_team_pipeline,
    build_team_spiele_filter,
    compose_saison_team,
    find_entry_refusal,
    find_entry_saison_refusal,
    find_gruppe_move_refusal,
    find_shorthand_refusal,
    find_team_entry_refusal,
)
from app.api.teams.standings import build_tabelle
from app.core.codes import Code
from app.core.concurrency import concurrently
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
    refuse_faults,
)
from app.core.exceptions import FieldFault
from app.core.readonly import ReadCollection
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.literals import FLGruppenNames, FLTrikotFarbe


async def refuse_a_taken_colour(
    *,
    saison_teams_collection: AsyncCollection,
    saison_id: str,
    trikot_farbe: FLTrikotFarbe | None,
    # The row the write saves, whose own colour is no other's; `None` for an entry.
    own_id: Any,
    # Required: the count must read inside the caller's transaction, whose season anchor closes the race, so forgetting
    # the session has to be a TypeError at the call.
    session: AsyncClientSession,
) -> None:
    """Refuse `trikot_farbe_taken`: another row of the season holds this colour, a club that left it among them.

    A row that left keeps its colour for the rest of the season, its kit being on the fixtures it played; a replacement
    alone frees it. No colour is free for any number of rows. Reached from two packages, as the capacity rule is.
    """

    if trikot_farbe is None:
        return

    # A lookup is a read, so two writes naming one colour pass unless they meet in one write set: every caller anchors the
    # season in this transaction, before the lookup or after it.
    other_rows = {} if own_id is None else {"_id": {"$ne": own_id}}
    held = await saison_teams_collection.find_one(
        {"saison_id": saison_id, "trikot_farbe": trikot_farbe, **other_rows}, projection={"_id": 1}, session=session
    )
    if held is not None:
        refuse_faults(FieldFault(path=("trikot_farbe",), code=Code.TRIKOT_FARBE_TAKEN, status=HTTPStatus.CONFLICT))


async def refuse_a_full_gruppe(
    *,
    saison_teams_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    saison_id: str,
    gruppe: FLGruppenNames,
    rules: FLSaisonRules,
    # Required: the anchor below is what closes the race, so forgetting the session has to be a
    # TypeError at the call rather than a silent reopening of it.
    session: AsyncClientSession,
) -> None:
    """Refuse `entry_gruppe_not_offered` and `entry_gruppe_full` for one club placed into one group, by an entry or a move.

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

    occupied = await saison_teams_collection.count_documents({"saison_id": saison_id, "gruppe": gruppe}, session=session)

    refuse(find_entry_refusal(gruppe=gruppe, rules=rules, occupied=occupied))


async def pull_a_team_to_enter(
    *,
    teams_collection: AsyncCollection,
    team_id: Any,
    # Required: the anchor below closes the race, so forgetting the session has to be a TypeError at the call.
    session: AsyncClientSession,
) -> Mapping[str, Any]:
    """The club a junction row is about to name, read for `team_retired` and for the identity the row copies.

    In this module because the entry, the acceptance and the replacement all name a club, from two packages, and a rule
    reached from two packages is one a package can enter past.
    """

    team = await pull_one_from_db(
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

    return team


async def found_a_team(*, teams_collection: AsyncCollection, team: Mapping[str, Any], session: AsyncClientSession) -> Any:
    """Write a new club, its `shorthand` judged against every other, a retired one included; its id."""

    taken = await is_held_elsewhere(collection=teams_collection, key="shorthand", value=team["shorthand"], own_id=None, session=session)
    refuse_faults(find_shorthand_refusal(taken=taken))

    return (await insert_live(collection=teams_collection, document=dict(team), session=session)).inserted_id


async def enter_a_team(
    *,
    teams_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    team_id: Any,
    saison_id: str,
    gruppe: FLGruppenNames,
    trikot_farbe: FLTrikotFarbe | None,
    session: AsyncClientSession,
) -> str:
    """Judge this club's entry into the season and write its row, in the caller's transaction, answering the club's name."""

    # The one read of the club, and it earns its place twice over: an id naming nothing 404s here rather than inserting
    # a row pointing at no club, and the season's own copy of the name and shorthand is seeded from it.
    team_raw = await pull_a_team_to_enter(teams_collection=teams_collection, team_id=team_id, session=session)
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)

    # Before the count: the club's standing in the league cannot be repaired by picking another group, so nobody should
    # be handed a capacity figure to act on first.
    refuse(find_team_entry_refusal(inactive_since=team_raw.get("inactive_since")))

    # A club a dialog offered and an acceptance entered since: by this code, ahead of the junction's unique index, which
    # answers only a race.
    entered = await saison_teams_collection.find_one({"saison_id": saison_id, "team_id": team_id}, projection={"_id": 1}, session=session)
    refuse(find_already_entered_refusal(entered=entered is not None))

    refuse(find_entry_saison_refusal(saison_status=str(saison_raw["status"])))
    await refuse_a_full_gruppe(
        saison_teams_collection=saison_teams_collection,
        saisons_collection=saisons_collection,
        saison_id=saison_id,
        gruppe=gruppe,
        # Validated, not read raw: a season missing the capacity keys fails here rather than admitting a team against a
        # bound nobody chose.
        rules=FLSaisonRules.model_validate(saison_raw["rules"]),
        session=session,
    )
    await refuse_a_taken_colour(
        saison_teams_collection=saison_teams_collection,
        saison_id=saison_id,
        trikot_farbe=trikot_farbe,
        own_id=None,
        session=session,
    )

    document = compose_saison_team(
        saison_id=saison_id, team_id=team_id, gruppe=gruppe, trikot_farbe=trikot_farbe, name=team_raw["name"], shorthand=team_raw["shorthand"]
    )
    await post_one_to_db(collection=saison_teams_collection, document=document, session=session)

    return str(team_raw["name"])


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
    """Refuse moving this club into `gruppe` while its fixtures are drawn or the group is full, the entry's status gate aside."""

    drawn = (
        await spiele_collection.find_one(build_team_spiele_filter(saison_id=saison_id, team_id=team_id), {"_id": 1}, session=session)
        is not None
    )
    refuse(find_gruppe_move_refusal(drawn=drawn))

    await refuse_a_full_gruppe(
        saison_teams_collection=saison_teams_collection,
        saisons_collection=saisons_collection,
        saison_id=saison_id,
        gruppe=gruppe,
        rules=rules,
        session=session,
    )


async def write_the_team(
    *,
    teams_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    team_id: Any,
    team: Mapping[str, Any],
    session: AsyncClientSession,
) -> Mapping[str, Any]:
    """Write a club and rewrite the name and shorthand its unfinished seasons' rows carry; the stored club.

    The caller judged its version, on reads this transaction's writes conflict with.

    Every fixture reads its sides' names from their season rows, so a rename reaches the fixtures of each season it
    rewrites; a `past` season keeps the name it was played under.
    """

    taken = await is_held_elsewhere(collection=teams_collection, key="shorthand", value=team["shorthand"], own_id=team_id, session=session)
    refuse_faults(find_shorthand_refusal(taken=taken))
    stored = await patch_one_in_db(
        collection=teams_collection,
        db_filter={"_id": team_id},
        update={"$set": dict(team)},
        expected_version=None,
        session=session,
        return_document=ReturnDocument.AFTER,
    )

    # Read through the session, so a season closed by a concurrent write cannot leave the junction rewritten and its
    # fixtures not, or the reverse.
    open_saisons = await pull_whole_from_db(
        collection=saisons_collection, db_filter={"status": {"$ne": "past"}}, projection=["_id"], session=session
    )
    open_saison_ids = [row["_id"] for row in open_saisons]
    # A read alone joins no write set, and the rollover writes no club row, so without this a season closed under the
    # rename would have its rows renamed after it closed; anchored, the rollover's demotion conflicts with the rename and
    # the retry reads the season `past`.
    await anchor_in_db(collection=saisons_collection, db_filter={"_id": {"$in": open_saison_ids}}, session=session)

    await patch_many_in_db(
        collection=saison_teams_collection,
        db_filter={"team_id": team_id, "saison_id": {"$in": open_saison_ids}},
        update={"$set": {"name": team["name"], "shorthand": team["shorthand"]}},
        session=session,
    )

    return stored


async def pull_tabelle(
    *, teams_collection: ReadCollection, spiele_collection: ReadCollection, saison_id: str, rules: FLSaisonRules
) -> FLTabelle:
    """One season's standing over the group phase, every row placed; the clubs and the group fixtures read at once.

    Each club's figures are counted off the fixtures read here, the ones the tiebreak chain weighs, as the bracket counts
    them: one derivation for both surfaces.
    """

    teams_raw, spiele_raw = await concurrently(
        aggregate_many_from_db(collection=teams_collection, pipeline=build_team_pipeline(saison_id=saison_id), collation=GERMAN_COLLATION),
        pull_whole_from_db(
            collection=spiele_collection,
            db_filter={"saison_id": saison_id, "saison_phase": "gruppenphase"},
        ),
    )
    spiele = FLSpielListAdapter.validate_python(spiele_raw)
    by_team = build_statistik_by_team(spiele, rules)
    teams = FLTeamListAdapter.validate_python([{**team, "statistik": by_team.get(team["_id"], ZERO_STATISTIK)} for team in teams_raw])

    return build_tabelle(teams=teams, spiele=spiele, rules=rules)


async def pull_team_names_and_codes(*, teams_collection: ReadCollection, team_ids: Iterable[Any]) -> tuple[dict[Any, str], dict[Any, str]]:
    """These clubs' names and codes off their `teams` documents, in one read and no command for none; a club no document holds is absent."""

    wanted = list({team_id for team_id in team_ids if team_id is not None})
    teams = (
        []
        if not wanted
        else await pull_many_from_db(
            collection=teams_collection, db_filter={"_id": {"$in": wanted}}, projection=["name", "shorthand"], limit=LIST_LIMIT_DEFAULT
        )
    )

    return {team["_id"]: str(team.get("name") or "") for team in teams}, {team["_id"]: str(team.get("shorthand") or "") for team in teams}


async def pull_saison_team_names(*, saison_teams_collection: ReadCollection, saison_id: str) -> Mapping[CustomObjectId, str]:
    """Each club of the season by the name it plays that season under, never today's: a list of the season shows that name."""

    rows = await pull_whole_from_db(
        collection=saison_teams_collection,
        db_filter={"saison_id": saison_id},
        projection=["team_id", "name"],
    )

    return {row["team_id"]: str(row["name"]) for row in rows}
