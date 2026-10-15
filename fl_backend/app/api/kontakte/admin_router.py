from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.kontakte.crud import erase_kontaktperson_in_session
from app.api.kontakte.schemas import (
    FLKontaktErasureAnsichtResponse,
    FLKontaktErasurePayload,
    FLKontaktErasureResponse,
    FLKontaktSitz,
)
from app.api.kontakte.services import build_matching_rows_pipeline, build_matching_seats_pipeline, find_matching_slots, rows_naming
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db
from app.core.dependencies import AktionenCollection, BewerbungenCollection, DBClient, SaisonTeamsCollection, get_germany_now
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, stores_nothing
from app.core.recording import log_stamp
from app.core.security import bind_actor, verify_access_admin, verify_actor_is_admin, verify_step_up
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/kontakte",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


def _seats_of(rows: Sequence[Mapping[str, Any]], identifier: str) -> list[FLKontaktSitz]:
    """Every seat these rows hold for the address.

    `find_matching_slots` and not a second reading of the projection: a reveal deciding which slots
    matched on its own terms would confirm a write against a different set of people.
    """

    return [
        # `model_validate` rather than the constructor: the slot is read off the model as a plain
        # string, and the wire's closed set is what refuses one no client has been told about.
        FLKontaktSitz.model_validate(
            {"saison_id": row.get("saison_id"), "rolle": slot, **{field: row["kontakte"][slot].get(field) for field in ("vorname", "nachname")}}
        )
        for row in rows
        for slot in find_matching_slots(row, identifier)
    ]


@router.post(
    "/erasure/ansicht",
    response_model=FLKontaktErasureAnsichtResponse,
    summary="Show whom an erasure would reach",
    dependencies=[Depends(stores_nothing)],
)
async def get_kontakt_erasure_ansicht(
    erasure_data: Annotated[FLKontaktErasurePayload, Body()],
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
) -> FLKontaktErasureAnsichtResponse:
    """
    Answer who stands in every seat `POST /kontakte/erasure` would clear for this address, by name and season.

    Stores nothing, and takes that write's own payload: a confirmation cannot then be shown for one address and performed for another.
    """

    identifier = sign_in_identifier(str(erasure_data.email))

    # Unbounded, as the erasure's own reads are: a capped reveal names fewer people than the write
    # clears, which is the confirmation reading best exactly where it is least complete.
    saison_team_rows = await aggregate_many_from_db(collection=saison_teams_collection, pipeline=build_matching_seats_pipeline(identifier))
    bewerbung_rows = await aggregate_many_from_db(collection=bewerbungen_collection, pipeline=build_matching_seats_pipeline(identifier))

    return FLKontaktErasureAnsichtResponse(
        saison_teams=_seats_of(saison_team_rows, identifier), bewerbungen=_seats_of(bewerbung_rows, identifier)
    )


@router.post(
    "/erasure",
    response_model=FLKontaktErasureResponse,
    summary="Erase a Kontaktperson's records",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
    dependencies=[Depends(verify_step_up)],
)
async def erase_kontaktperson(
    erasure_data: Annotated[FLKontaktErasurePayload, Body()],
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLKontaktErasureResponse:
    """
    Clear one contact person from every season's junction row, every application, and the log.

    The SLOT is nulled, never the block, so the others keep their records. `POST` and not
    `DELETE`: RFC 9110 §9.3.5 gives a `DELETE` body no semantics.
    """

    async def clear_the_person_and_their_record(session: AsyncClientSession) -> FLKontaktErasureResponse:
        """Find, then clear. Everything judged is read in-session, so a retry re-reads it."""

        identifier = sign_in_identifier(str(erasure_data.email))
        # BOTH reads before either write, and unbounded: a cleared row stops matching, and a capped
        # read would leave rows holding the person with nothing left to find them by.
        saison_team_rows = rows_naming(
            await aggregate_many_from_db(
                collection=saison_teams_collection, pipeline=build_matching_rows_pipeline(identifier), session=session
            ),
            identifier,
        )
        bewerbung_rows = rows_naming(
            await aggregate_many_from_db(collection=bewerbungen_collection, pipeline=build_matching_rows_pipeline(identifier), session=session),
            identifier,
        )

        cleared = await erase_kontaktperson_in_session(
            saison_teams_collection=saison_teams_collection,
            bewerbungen_collection=bewerbungen_collection,
            aktionen_collection=aktionen_collection,
            identifier=identifier,
            saison_team_rows=saison_team_rows,
            bewerbung_rows=bewerbung_rows,
            stamp=log_stamp(germany_now),
            session=session,
        )

        return FLKontaktErasureResponse(
            cleared_saison_teams=len(saison_team_rows),
            cleared_bewerbungen=len(bewerbung_rows),
            cleared_kontakt_slots=cleared.kontakt_slots,
            redacted_aktionen=cleared.redacted_aktionen,
        )

    # ONE transaction over all of it (`docs/backend/spec.md :: I42`): rows cleared while the log
    # still holds the block reports an erasure that did not happen, and clearing one collection
    # without the other answers the request in name only.
    async with transaction_session(db) as session:
        return await session.with_transaction(clear_the_person_and_their_record)
