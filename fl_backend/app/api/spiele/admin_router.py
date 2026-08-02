"""
SPIELE · write endpoints, and the one admin-only read

Every mutation sits beside the reads for the resource it changes, in a second router whose guard is
`verify_access_admin` (ADR-0034).

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `verify_access_admin` is attached at ROUTER level, so every endpoint added here is guarded by
    construction. Never move the guard onto an individual endpoint.
  • `ergebnis` is DERIVED from the two `tore` values and is never accepted from the client.
  • The payload is written wholesale with `$set`, so a field absent from it is overwritten rather than
    preserved. That is why the money fields carry no Pydantic default.
  • `patch_spiel_data` writes ONLY the match document. Team statistics are derived from the matches on
    read (ADR-0026), so there is no second write to keep in step and no team to look up here.

 WHY `/action_required` DOES NOT COLLIDE WITH `/{spiel_id}` ────────────────────────────────────────────────

  They are the same path shape at the same depth, in two routers with different authorization -- so
  declaration order cannot separate them. The `objectid` convertor does: `GET /spiele/{spiel_id}` in
  `router.py` matches only 24 hex characters, so "action_required" is not a candidate for it and routing
  reaches this endpoint whatever order the routers are included in. See `app/core/routing.py`.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/backend/spec.md -- section 3, the write path step by step
"""

from typing import Annotated

from fastapi import APIRouter, Body, Depends, status
from fastapi.responses import JSONResponse

from app.api.spiele.schemas import (
    FLPatchSpielDataPayload,
    FLPatchSpielDataResponse,
    FLSpieleListResponse,
    FLSpielListAdapter,
)
from app.core.config import backend_config
from app.core.crud import patch_one_in_db, pull_many_from_db
from app.core.dependencies import DBClient, SpieleCollection, get_german_date_str
from app.core.exceptions import DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{backend_config.api_version}/spiele",
    dependencies=[Depends(verify_access_admin)],
)


@router.get("/action_required", response_model=FLSpieleListResponse, summary="Spiele needing attention")
async def get_spiele_action_required(spiele_collection: SpieleCollection, today: str = Depends(get_german_date_str)) -> FLSpieleListResponse:
    """
    List Spiele that need an admin's attention.

    A match qualifies if it is cancelled, is missing a date, time, venue or referee, or is in the past
    with no result recorded. Not season-filtered: it spans every season.

    Deliberately uncached on the frontend — admin-authorized data does not belong in a shared cache
    (ADR-0013).
    """

    # Fetch all games with either a missing attribute or games which have a date in the past but don't have a final score
    spiele_raw = await pull_many_from_db(
        collection=spiele_collection,
        db_filter={
            "$or": [
                {"is_canceled": True},
                {"datum": None},
                {"uhrzeit": None},
                {"ort": None},
                {"schiedsrichter": None},
                {"datum": {"$lt": today}, "ergebnis": None},
            ]
        },
    )
    spiele = FLSpielListAdapter.validate_python(spiele_raw)

    return FLSpieleListResponse(spiele=spiele)


@router.patch(by_id("spiel_id"), response_model=FLPatchSpielDataResponse, summary="Update a Spiel")
async def patch_spiel_data(
    spiel_id: CustomRouteObjectId,
    spiel_data: Annotated[FLPatchSpielDataPayload, Body()],
    db: DBClient,
    spiele_collection: SpieleCollection,
) -> JSONResponse:
    """
    Update one Spiel.

    `ergebnis` is derived from the two `tore` values and must not be submitted. The payload is written
    wholesale, so every field must be present -- an omitted field is overwritten, not preserved.

    The league table follows on its own: team statistics are computed from the match documents by
    `GET /teams`, so a result entered here is reflected the next time that table is read.

    `saison_id` is deliberately not part of the payload: it is not declared on the model and Pydantic
    would discard it. The frontend passes it separately, for cache invalidation only.
    """

    updated_ergebnis_field = (
        f"{spiel_data.team1.tore}:{spiel_data.team2.tore}" if spiel_data.team1.tore is not None and spiel_data.team2.tore is not None else None
    )

    # One document, and still a transaction: the write stays atomic with whatever this endpoint grows
    # next, and a session costs nothing here (ADR-0026 removed the second write, not the guarantee).
    async with await db.start_session() as session:
        async with session.start_transaction():
            patched_spiel_raw = await patch_one_in_db(
                collection=spiele_collection,
                filter={"_id": spiel_id},
                update={
                    "$set": {
                        **spiel_data.model_dump(context={"keep_oid": True}),
                        "ergebnis": updated_ergebnis_field,
                    }
                },
                session=session,
            )
            # `find_one_and_update` returns None only when nothing matched, so this is the 404 branch
            # rather than an error check -- the document is not read for its contents.
            if patched_spiel_raw is None:
                raise DocumentNotFoundException(
                    filter={"_id": spiel_id},
                    error_code="DB-COMMON-001",
                )

    return JSONResponse(
        content={
            "acknowledged": 1,
        },
        status_code=status.HTTP_200_OK,
    )
