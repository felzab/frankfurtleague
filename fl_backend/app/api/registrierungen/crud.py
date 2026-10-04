"""
API · the reads a pupil's confirmation and a team's decision on a registration are judged against

Here rather than in `services.py`, which decides from its arguments and names no handle
(`fl_backend/tests/core/test_write_shapes.py :: TestEveryServiceModuleDecidesFromItsArguments`).
"""

from collections.abc import Mapping, Sequence
from typing import Any

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.registrierungen.services import (
    PERSON_IDENTITY_FIELDS,
    SUBMITTED,
    WITHOUT_TOKEN_HASHES,
    build_adressen_filter,
    build_offene_filter,
    build_registrierungen_sort,
)
from app.core.crud import aggregate_many_from_db, pull_one_from_db
from app.shared.folding import sign_in_identifier

# What the admission reads of a person: who they are, for the question, and what it overwrites.
PERSON_FIELDS: tuple[str, ...] = (*PERSON_IDENTITY_FIELDS, "geburtsdatum", "email")

# What a confirmation link reads of a person: who they are and whether they confirmed, for the page,
# and what the returning page shows back. No evidence: a base-tier read carries nothing it does not show.
PERSON_ANSICHT_FIELDS: tuple[str, ...] = (
    *PERSON_IDENTITY_FIELDS,
    "geburtsdatum",
    "einwilligung.bestaetigt_am",
    "einwilligung.umfang",
    "einwilligung.medien",
)


async def person_at_the_address(
    *, spieler_collection: AsyncCollection, registrierung_raw: Mapping[str, Any], session: AsyncClientSession | None
) -> Mapping[str, Any] | None:
    """The one person `uniq_spieler_email` holds to this registration's address, matched on the folded form `spieler.email` stores."""

    return await spieler_collection.find_one(
        build_adressen_filter([sign_in_identifier(str(registrierung_raw.get("email") or ""))]),
        projection=list(PERSON_ANSICHT_FIELDS),
        session=session,
    )


async def pull_offene_registrierung(
    *, registrierungen_collection: AsyncCollection, registrierung_id: Any, session: AsyncClientSession
) -> Mapping[str, Any]:
    """The pending registration this id names, or a 404: an admitted one is gone, and a declined one is decided."""

    return await pull_one_from_db(
        collection=registrierungen_collection,
        db_filter={"_id": registrierung_id, "status": SUBMITTED},
        projection=dict(WITHOUT_TOKEN_HASHES),
        session=session,
    )


async def pull_offene_registrierungen(
    *, registrierungen_collection: AsyncCollection, saison_id: str, team_id: Any, limit: int, order: str, session: AsyncClientSession
) -> list[Mapping[str, Any]]:
    """One row past `limit`, so the caller tells a whole list from a cut one without counting."""

    return await aggregate_many_from_db(
        collection=registrierungen_collection,
        pipeline=[
            {"$match": build_offene_filter(saison_id=saison_id, team_id=team_id)},
            {"$sort": dict(build_registrierungen_sort(sort_by="eingereicht_am", order=order))},
            {"$limit": limit + 1},
            # An inclusion: nothing beyond the form's own fields, the consent stamp and the address
            # the join runs on reaches this handler, let alone the wire.
            {
                "$project": {
                    **{field: 1 for field in ("eingereicht_am", *PERSON_IDENTITY_FIELDS, "nummer", "position", "stufe")},
                    **{field: 1 for field in ("email", "geburtsdatum", "einwilligung.bestaetigt_am")},
                }
            },
        ],
        session=session,
    )


async def persons_at(
    *, spieler_collection: AsyncCollection, adressen: Sequence[str], session: AsyncClientSession | None
) -> list[Mapping[str, Any]]:
    """The stored persons these folded addresses resolve to, one per address under `uniq_spieler_email`."""

    if not adressen:
        return []

    return await aggregate_many_from_db(
        collection=spieler_collection,
        pipeline=[{"$match": build_adressen_filter(adressen)}, {"$project": {field: 1 for field in PERSON_FIELDS}}],
        session=session,
    )


async def persons_without_an_address(*, spieler_collection: AsyncCollection, session: AsyncClientSession | None) -> list[Mapping[str, Any]]:
    """Every stored person holding no address, whom a name may be proposed for.

    Unbounded and unindexed on purpose: every person the admission makes or matches takes an address
    and nothing else creates one, so this set only shrinks.
    """

    return await aggregate_many_from_db(
        collection=spieler_collection,
        pipeline=[{"$match": {"email": None}}, {"$project": {field: 1 for field in PERSON_FIELDS}}],
        session=session,
    )


async def nummern_rows(
    *, saison_spieler_collection: AsyncCollection, saison_id: str, team_id: Any, session: AsyncClientSession | None
) -> list[Mapping[str, Any]]:
    """The live squad's shirt numbers, as `app/api/spieler/services.py :: build_live_squad_filter` counts the squad."""

    return await aggregate_many_from_db(
        collection=saison_spieler_collection,
        pipeline=[{"$match": {"saison_id": saison_id, "team_id": team_id, "inactive_since": None}}, {"$project": {"nummer": 1}}],
        session=session,
    )
