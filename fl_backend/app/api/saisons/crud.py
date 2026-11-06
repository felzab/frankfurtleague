from collections.abc import Collection, Mapping
from typing import Any, NamedTuple

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.bewerbungen.services import SAISON_NOT_ENDED_FILTER, saison_nimmt_bewerbungen_an
from app.api.saisons.schemas import FIRST_SAISON_RULES, FLSaisonRules
from app.api.saisons.services import next_saison_id
from app.api.spiele.schemas import FLSpielJoinedInternal, FLSpielJoinedInternalListAdapter
from app.api.spiele.services import build_spiele_pipeline
from app.api.teams.services import TAKEN_PLACE_FIELDS, has_taken_place
from app.core.crud import aggregate_many_from_db, pull_many_from_db, pull_one_from_db
from app.core.exceptions import DocumentNotFoundError
from app.core.readonly import ReadCollection
from app.shared.schemas.bounds import SAISON_ID_LENGTH

CURRENT_SAISON_FILTER = {"status": "active"}


class CreateState(NamedTuple):
    """What the next create makes and judges: the id it mints, the rules it carries on, and whether a `future` season stands."""

    saison_id: str
    rules: FLSaisonRules
    future_stands: bool


async def pull_create_state(*, saisons_collection: ReadCollection, session: AsyncClientSession | None = None) -> CreateState:
    """What the create judges and makes, the list serving its id and its refusal off the same read.

    The rules are the newest season's, the likeliest value, or the league's first season's where none is stored.
    """

    # Among the ids that are a year alone, the greatest by string order being the newest: one stored row of another
    # shape, written by hand, sorting after every year, would otherwise be read as the newest, whose id names no year to
    # mint the next from, answering 500 for the list serving that id and for every create.
    newest = await saisons_collection.find_one(
        {"_id": {"$regex": f"^[0-9]{{{SAISON_ID_LENGTH}}}$"}}, projection={"_id": 1, "rules": 1}, sort=[("_id", -1)], session=session
    )
    future = await saisons_collection.find_one({"status": "future"}, projection={"_id": 1}, session=session)

    return CreateState(
        saison_id=next_saison_id(None if newest is None else str(newest["_id"])),
        rules=FIRST_SAISON_RULES if newest is None else FLSaisonRules.model_validate(newest["rules"]),
        future_stands=future is not None,
    )


async def pull_active_saison_id(saisons_collection: AsyncCollection) -> str:
    """The current season's id; 404 where none is active, rather than degrading to an unfiltered query."""

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter=CURRENT_SAISON_FILTER, projection=["_id"])

    return str(saison_raw["_id"])


async def pull_governing_saison_id(saisons_collection: ReadCollection, session: AsyncClientSession | None = None) -> str | None:
    """The season a count of seasons is reckoned from: the running one.

    `None` rather than a 404 where none runs, so the caller decides what that means.
    """

    try:
        running = await pull_one_from_db(collection=saisons_collection, db_filter=CURRENT_SAISON_FILTER, projection=["_id"], session=session)
    except DocumentNotFoundError:
        # Never the newest `past` season instead: after the first activation no route leaves the
        # league without a running one, and a ban counted from a
        # guessed season bars a person for the wrong five.
        return None

    return str(running["_id"])


async def pull_open_window_saison(*, saisons_collection: AsyncCollection, today: str) -> Mapping[str, Any] | None:
    """The season taking applications today, its window and status alone; `None` where none is.

    Judged by `saison_nimmt_bewerbungen_an`, the rule the submission refuses on, over every season not yet ended, and
    never by a filter restating it, so the landing cannot offer a window the submission refuses. Newest season id
    first, ids being years: two open windows is a state an administrator can create, and an arbitrary pick would move
    between reads.
    """

    candidates = await pull_many_from_db(
        collection=saisons_collection, db_filter=SAISON_NOT_ENDED_FILTER, sort_by=[("_id", -1)], projection=["bewerbung", "status"]
    )

    return next(
        (raw for raw in candidates if saison_nimmt_bewerbungen_an(saison_status=raw["status"], bewerbung=raw.get("bewerbung"), today=today)),
        None,
    )


async def saisons_with_a_spiel_taken_place(
    *,
    spiele_collection: ReadCollection,
    saison_ids: Collection[str],
    # REQUIRED, `None` included: a transactional caller that forgot it would read outside its
    # snapshot in silence, so the omission has to be a TypeError at the call.
    session: AsyncClientSession | None,
) -> set[str]:
    """The seasons among these holding a fixture that has taken place, which fixes a season's start (`saison_start_taken_place`).

    Judged by `has_taken_place`, never by a filter restating it, in one read over every season asked about, whose cursor
    stops once every one of them is found.
    """

    found: set[str] = set()
    async with spiele_collection.find({"saison_id": {"$in": list(saison_ids)}}, ["saison_id", *TAKEN_PLACE_FIELDS], session=session) as spiele:
        async for spiel in spiele:
            if has_taken_place(spiel):
                found.add(spiel["saison_id"])
                if found.issuperset(saison_ids):
                    break

    return found


async def pull_finale_by_saison(*, spiele_collection: ReadCollection, saison_ids: Collection[str]) -> dict[str, list[FLSpielJoinedInternal]]:
    """Each of these seasons' Finale matches, joined as every match read joins them, keyed by season; a season holding none is absent.

    One read for every season asked about: `build_spiele_pipeline` marks the match for third place per fixture's own season,
    so `app/api/saisons/services.py :: decided_podium` reads each season's list as it reads the landing's.
    """

    by_saison: dict[str, list[FLSpielJoinedInternal]] = {}
    for spiel in FLSpielJoinedInternalListAdapter.validate_python(
        await aggregate_many_from_db(
            collection=spiele_collection,
            pipeline=build_spiele_pipeline(db_filter={"saison_id": {"$in": list(saison_ids)}, "saison_phase": "finale"}),
        )
    ):
        by_saison.setdefault(spiel.saison_id, []).append(spiel)

    return by_saison


async def count_teams_by_saison(*, saison_teams_collection: ReadCollection, saison_ids: Collection[str]) -> dict[str, int]:
    """How many clubs each of these seasons holds, counted on every read; a season holding none is absent.

    Every row, a club that left included: a team never leaves a season, and the season's Teams page lists it with its Austritt.
    """

    rows = await aggregate_many_from_db(
        collection=saison_teams_collection,
        pipeline=[{"$match": {"saison_id": {"$in": list(saison_ids)}}}, {"$group": {"_id": "$saison_id", "teams": {"$sum": 1}}}],
    )

    return {str(row["_id"]): int(row["teams"]) for row in rows}


async def count_spiele_by_saison(*, spiele_collection: ReadCollection, saison_ids: Collection[str]) -> dict[str, int]:
    """How many fixtures each of these seasons holds, counted on every read; a season holding none is absent.

    Off the stored fixtures, which every draw write judges, never off a stored copy of the count.
    """

    rows = await aggregate_many_from_db(
        collection=spiele_collection,
        pipeline=[{"$match": {"saison_id": {"$in": list(saison_ids)}}}, {"$group": {"_id": "$saison_id", "spiele": {"$sum": 1}}}],
    )

    return {str(row["_id"]): int(row["spiele"]) for row in rows}


async def pull_saison_id_and_rules(
    saisons_collection: ReadCollection,
    saison_id: str | None,
) -> tuple[str, FLSaisonRules]:
    """A season's id and its scoring rules.

    `saison_id=None` means the current season; an explicit id naming none raises 404.
    """

    db_filter = CURRENT_SAISON_FILTER if saison_id is None else {"_id": saison_id}
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter=db_filter, projection=["_id", "rules"])

    return str(saison_raw["_id"]), FLSaisonRules.model_validate(saison_raw["rules"])
