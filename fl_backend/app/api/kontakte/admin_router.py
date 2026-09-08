from datetime import datetime
from typing import Annotated, Any, Mapping, Sequence

from fastapi import APIRouter, Body, Depends
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.kontakte.schemas import (
    FLKontaktErasureAnsichtResponse,
    FLKontaktErasurePayload,
    FLKontaktErasureResponse,
    FLKontaktSitz,
)
from app.api.kontakte.services import (
    build_clearing_update,
    build_matching_rows_pipeline,
    build_matching_seats_pipeline,
    build_orphaned_image_filter,
    find_matching_slots,
)
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, patch_many_in_db, patch_one_in_db
from app.core.dependencies import AktionenCollection, BewerbungenCollection, DBClient, SaisonTeamsCollection, get_germany_now
from app.core.recording import build_redaction_filter, build_redaction_update, log_stamp
from app.core.security import bind_actor, verify_access_admin

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/kontakte",
    dependencies=[Depends(verify_access_admin), Depends(bind_actor)],
)


async def _clear_each(collection: AsyncCollection, rows: Sequence[Mapping[str, Any]], email: str, session: AsyncClientSession) -> int:
    """Null this person's slots row by row, and answer how many slots.

    `patch_one_in_db` per row and never `patch_many_in_db`, which records no `document_id`
    (`docs/backend/spec.md :: I40`): the redaction below must be able to match the row it logs.
    """

    cleared = 0
    for row in rows:
        slots = find_matching_slots(row, email)
        update = build_clearing_update(slots, bestaetigungen=isinstance(row.get("bestaetigungen"), Mapping))
        await patch_one_in_db(collection=collection, db_filter={"_id": row["_id"]}, update=update, session=session)
        cleared += len(slots)

    return cleared


def _seats_of(rows: Sequence[Mapping[str, Any]], email: str) -> list[FLKontaktSitz]:
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
        for slot in find_matching_slots(row, email)
    ]


@router.post("/erasure/ansicht", response_model=FLKontaktErasureAnsichtResponse, summary="Show whom an erasure would reach")
async def get_kontakt_erasure_ansicht(
    erasure_data: Annotated[FLKontaktErasurePayload, Body()],
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
) -> FLKontaktErasureAnsichtResponse:
    """
    Answer who stands in every seat `POST /kontakte/erasure` would clear for this address, by name and season.

    Stores nothing, and takes that write's own payload: a confirmation cannot then be shown for one address and performed for another.
    """

    email = str(erasure_data.email)

    # Unbounded, as the erasure's own reads are: a capped reveal names fewer people than the write
    # clears, which is the confirmation reading best exactly where it is least complete.
    saison_team_rows = await aggregate_many_from_db(collection=saison_teams_collection, pipeline=build_matching_seats_pipeline(email))
    bewerbung_rows = await aggregate_many_from_db(collection=bewerbungen_collection, pipeline=build_matching_seats_pipeline(email))

    return FLKontaktErasureAnsichtResponse(saison_teams=_seats_of(saison_team_rows, email), bewerbungen=_seats_of(bewerbung_rows, email))


@router.post("/erasure", response_model=FLKontaktErasureResponse, summary="Erase a Kontaktperson's records")
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
        """Find, then clear, then redact. Everything judged is read in-session, so a retry re-reads it."""

        email = str(erasure_data.email)

        # BOTH reads before either write, and unbounded: the `$set` below stops the address matching,
        # and a capped read would leave rows holding the person with nothing left to find them by
        # (`app/api/spieler/admin_router.py :: erase_spieler` does the same).
        saison_team_rows = await aggregate_many_from_db(
            collection=saison_teams_collection, pipeline=build_matching_rows_pipeline(email), session=session
        )
        bewerbung_rows = await aggregate_many_from_db(
            collection=bewerbungen_collection, pipeline=build_matching_rows_pipeline(email), session=session
        )

        cleared_slots = await _clear_each(saison_teams_collection, saison_team_rows, email, session)
        cleared_slots += await _clear_each(bewerbungen_collection, bewerbung_rows, email, session)

        # ONE stamp for both passes below, so a row cannot say which of the two reached it.
        stamp = log_stamp(germany_now)

        # LAST, so it reaches the pre-images the clearing patches above just filed, each still holding
        # this person. An `$in` of no ids matches nothing, so an address naming nobody redacts nothing
        # rather than everything.
        redacted = await patch_many_in_db(
            collection=aktionen_collection,
            db_filter=build_redaction_filter(
                [
                    (Collection.SAISON_TEAMS, [row["_id"] for row in saison_team_rows]),
                    (Collection.BEWERBUNGEN, [row["_id"] for row in bewerbung_rows]),
                ]
            ),
            update=build_redaction_update(at=stamp),
            session=session,
        )

        # The rows no id above can name: a swap left this person in a pre-image of a row that has
        # since stopped naming them. SECOND, so the pass above has already nulled `before` on
        # everything it took and the two counts below can never cover one row twice.
        orphaned = await patch_many_in_db(
            collection=aktionen_collection,
            db_filter=build_orphaned_image_filter(email),
            update=build_redaction_update(at=stamp),
            session=session,
        )

        return FLKontaktErasureResponse(
            cleared_saison_teams=len(saison_team_rows),
            cleared_bewerbungen=len(bewerbung_rows),
            cleared_kontakt_slots=cleared_slots,
            redacted_aktionen=redacted.modified_count + orphaned.modified_count,
        )

    # ONE transaction over all of it (`docs/backend/spec.md :: I42`): rows cleared while the log
    # still holds the block reports an erasure that did not happen, and clearing one collection
    # without the other answers the request in name only.
    async with db.start_session() as session:
        return await session.with_transaction(clear_the_person_and_their_record)
