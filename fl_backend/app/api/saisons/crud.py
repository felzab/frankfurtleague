from collections.abc import Collection, Mapping
from typing import Any

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.bewerbungen.services import SAISON_NOT_ENDED_FILTER, saison_nimmt_bewerbungen_an
from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import has_started
from app.api.teams.services import TAKEN_PLACE_FIELDS, has_taken_place
from app.core.crud import pull_many_from_db, pull_one_from_db
from app.core.exceptions import DocumentNotFoundError
from app.core.readonly import ReadCollection

CURRENT_SAISON_FILTER = {"status": "active"}


async def pull_active_saison(saisons_collection: AsyncCollection) -> Mapping[str, Any]:
    """The season marked `active`.

    Raises 404 when none is active rather than degrading to an unfiltered query.
    """

    return await pull_one_from_db(collection=saisons_collection, db_filter=CURRENT_SAISON_FILTER)


async def pull_active_saison_id(saisons_collection: AsyncCollection) -> str:
    """The current season's id."""

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter=CURRENT_SAISON_FILTER, projection=["_id"])

    return str(saison_raw["_id"])


async def pull_massgebliche_saison_id(saisons_collection: ReadCollection, session: AsyncClientSession | None = None) -> str | None:
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


async def saisons_with_a_fixture_taken_place(
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
    async with spiele_collection.find(
        {"saison_id": {"$in": list(saison_ids)}}, ["saison_id", *TAKEN_PLACE_FIELDS], session=session
    ) as fixtures:
        async for spiel in fixtures:
            if has_taken_place(spiel):
                found.add(spiel["saison_id"])
                if found.issuperset(saison_ids):
                    break

    return found


async def nachnominierung_laeuft_in(*, saisons_collection: ReadCollection, saison_id: str, today: str) -> bool:
    """Whether an entry into this season's squads on `today` is a Nachnominierung: one made once the season has started.

    The start every start lock reads (`app/api/saisons/services.py :: has_started`), so the marker and the locks
    cannot disagree about when the season began. 404 where no season has this id.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["start_date"])

    return has_started(start_date=saison_raw["start_date"], today=today)


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
