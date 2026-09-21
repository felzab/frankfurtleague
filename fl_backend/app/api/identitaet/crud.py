from collections.abc import Mapping, Sequence

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.identitaet.schemas import FLSubjektResponse, FLSubjektSchiedsrichter, FLSubjektSitz, FLSubjektSpieler
from app.api.identitaet.services import build_pupil_pipeline, build_referee_pipeline, build_seat_pipeline, folds_to, seats_naming
from app.core.crud import aggregate_many_from_db


async def _statuses_of(
    *, saisons_collection: AsyncCollection, saison_ids: Sequence[str], session: AsyncClientSession | None
) -> Mapping[str, str]:
    """One read of `saisons` for every season the seats sit in, the junction row carrying no copy of its season's `status`.

    Made after the fold has judged, so a row the pre-filter alone reached is never read for.
    """

    rows = await aggregate_many_from_db(
        collection=saisons_collection,
        pipeline=[{"$match": {"_id": {"$in": sorted(set(saison_ids))}}}, {"$project": {"status": 1}}],
        session=session,
    )
    statuses = {row["_id"]: row["status"] for row in rows}

    if missing := sorted(set(saison_ids) - statuses.keys()):
        # Raised rather than dropped: a seat whose season has no row is a database this read cannot
        # answer truthfully for, and a silently shorter list is a person shown no panel at all.
        raise RuntimeError(f"saison_teams holds seats in {missing}, which saisons has no row for")

    return statuses


async def find_subjekt(
    identifier: str,
    *,
    saison_teams_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    spieler_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    # Carried rather than defaulted, so a later caller judging a Funktion inside its own transaction
    # states which session this read belongs to instead of silently opening a second one.
    session: AsyncClientSession | None,
) -> FLSubjektResponse:
    """Every league record this folded identifier matches.

    Unbounded on all four reads, as `app/api/kontakte/admin_router.py`'s are: a capped list reads as
    a person holding fewer records rather than as a truncated answer.
    """

    seat_rows = await aggregate_many_from_db(collection=saison_teams_collection, pipeline=build_seat_pipeline(identifier), session=session)
    referee_rows = await aggregate_many_from_db(
        collection=schiedsrichter_collection, pipeline=build_referee_pipeline(identifier), session=session
    )
    pupil_rows = await aggregate_many_from_db(collection=spieler_collection, pipeline=build_pupil_pipeline(identifier), session=session)

    seats = seats_naming(seat_rows, identifier)
    statuses = await _statuses_of(saisons_collection=saisons_collection, saison_ids=[row["saison_id"] for row, _ in seats], session=session)

    return FLSubjektResponse(
        sitze=[
            # `model_validate` rather than the constructor: the slot is a plain string here, and the
            # wire's closed set is what refuses one no endpoint publishes.
            FLSubjektSitz.model_validate(
                {
                    "saison_id": row["saison_id"],
                    "team_id": row["team_id"],
                    "rolle": slot,
                    "team_name": row["name"],
                    "saison_status": statuses[row["saison_id"]],
                }
            )
            for row, slot in seats
        ],
        spieler=[FLSubjektSpieler(spieler_id=row["_id"]) for row in pupil_rows],
        schiedsrichter=[
            # Judged here for `seats_naming`'s reason: the pre-filter is the wider rule, so a
            # referee it reached is a referee this fold may still refuse.
            FLSubjektSchiedsrichter(schiedsrichter_id=row["_id"])
            for row in referee_rows
            if folds_to((row.get("kontakt") or {}).get("email"), identifier)
        ],
    )
