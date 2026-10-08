from collections.abc import Mapping
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.identitaet.crud import refuse_without_a_seat
from app.api.identitaet.lookup import SubjektLookup
from app.api.saisons.cache import dropping_the_saison_cache
from app.api.saisons.schemas import FLSaisonRules
from app.api.spieler.crud import refuse_a_taken_rolle
from app.api.spieler.schemas import FLKaderResponse, FLKaderZeile, FLKaderZeileResponse, FLPatchKaderZeilePayload, FLSpielerStufe
from app.api.spieler.services import build_kader_pipeline, find_kader_stufe_refusal, mark_shared_nummern
from app.core.config import API_VERSION
from app.core.crud import GERMAN_COLLATION, aggregate_many_from_db, patch_one_in_db, pull_one_from_db, refuse, set_inactive_since
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonSpielerCollection,
    get_german_date_str,
)
from app.core.drosselung import gedrosselt
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import PERSON_ACTOR_BINDERS, KontaktIdentifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.schemas.custom import CustomObjectId, CustomRouteObjectId

# The person lane's binder IN PLACE of `bind_actor` and the grants check, which a seat holder holding
# no grant would fail; the binder refuses a barred person on every method, so no handler asks again.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieler/kader",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["kontakt"])],
)

SQUAD_PATH = f"{by_id('team_id')}/{{saison_id}}"
ROW_PATH = f"{SQUAD_PATH}{by_id('spieler_id')}"


def _live_row(*, team_id: CustomObjectId, saison_id: str, spieler_id: CustomObjectId) -> Mapping[str, Any]:
    """The team in the filter, so another team's pupil named under this path matches nothing; live, so an ausgetragen row is read-only."""

    return {"spieler_id": spieler_id, "saison_id": saison_id, "team_id": team_id, "inactive_since": None}


async def _read_the_squad(
    *, saison_spieler_collection: AsyncCollection, team_id: CustomObjectId, saison_id: str, session: AsyncClientSession
) -> list[FLKaderZeile]:
    """The whole squad, each row's shirt marker judged against every other: no single row carries what it is compared with."""

    rows = await aggregate_many_from_db(
        collection=saison_spieler_collection,
        pipeline=build_kader_pipeline(saison_id=saison_id, team_id=team_id),
        collation=GERMAN_COLLATION,
        session=session,
    )

    return [FLKaderZeile.model_validate(row) for row in mark_shared_nummern(rows)]


async def _erlaubte_stufen(*, saisons_collection: AsyncCollection, saison_id: str, session: AsyncClientSession) -> list[FLSpielerStufe]:
    # `find_one` rather than `pull_one_from_db`: every caller passed `refuse_without_a_seat` first on this
    # session, which read this season for the seat, and no season is ever deleted, so a miss is a broken
    # invariant rather than a 404.
    saison_raw = await saisons_collection.find_one({"_id": saison_id}, projection={"rules": 1}, session=session)
    assert saison_raw is not None

    # Through the model the rules are written under, as `refuse_a_full_squad` reads the cap: a list
    # that model refuses, an empty one included, fails here rather than reaching the page.
    return FLSaisonRules.model_validate(saison_raw["rules"]).erlaubte_stufen


async def _the_row_as_written(
    *,
    saison_spieler_collection: AsyncCollection,
    team_id: CustomObjectId,
    saison_id: str,
    spieler_id: CustomObjectId,
    session: AsyncClientSession,
) -> FLKaderZeileResponse:
    """Read back inside the write's own transaction, so the shirt marker is the squad's after this write and before any other."""

    kader = await _read_the_squad(saison_spieler_collection=saison_spieler_collection, team_id=team_id, saison_id=saison_id, session=session)
    zeile = next((zeile for zeile in kader if zeile.spieler_id == spieler_id), None)

    # A row whose person is gone, a hand edit the squad read drops, is answered as the live-row
    # filter answers a row it misses; raised inside the transaction, the write it follows is undone.
    if zeile is None:
        raise DocumentNotFoundException(
            filter={"spieler_id": spieler_id, "saison_id": saison_id, "team_id": team_id}, error_code=DOCUMENT_NOT_FOUND
        )

    return FLKaderZeileResponse.model_validate(zeile.model_dump())


@router.get(SQUAD_PATH, response_model=FLKaderResponse, summary="Read a team's squad as its seat holder")
async def get_kader(
    team_id: CustomRouteObjectId,
    saison_id: str,
    identifier: KontaktIdentifier,
    saison_spieler_collection: SaisonSpielerCollection,
    saisons_collection: SaisonsCollection,
    records: SubjektLookup,
    db: DBClient,
) -> FLKaderResponse:
    """
    The squad of one team in one season, for a person holding any contact seat on it.

    Every row, ausgetragen ones included and marked by `inactive_since`; each surname whole, and no
    e-mail address or telephone number of anybody. `nummer_doppelt` marks a live row whose number
    another live row of the squad wears, compared as stored. `erlaubte_stufen` is what the season's
    rules offer an edit. Refused `REQ-FUNKTION-001` where the signed-in person holds no seat on this
    team in this season, a seat on a `past` season holding none.
    """

    # A snapshot, so the squad served is the one the seat was judged against; never a transaction,
    # which a read writing nothing has no conflict to retry and no anchor to take.
    async with db.start_session(snapshot=True) as session:
        await refuse_without_a_seat(identifier, records, team_id=team_id, saison_id=saison_id, session=session)

        return FLKaderResponse(
            team_id=team_id,
            saison_id=saison_id,
            erlaubte_stufen=await _erlaubte_stufen(saisons_collection=saisons_collection, saison_id=saison_id, session=session),
            kader=await _read_the_squad(
                saison_spieler_collection=saison_spieler_collection, team_id=team_id, saison_id=saison_id, session=session
            ),
        )


@router.patch(
    ROW_PATH,
    response_model=FLKaderZeileResponse,
    summary="Update a squad entry as its team's seat holder",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
    dependencies=[Depends(gedrosselt)],
)
async def patch_kader_zeile(
    team_id: CustomRouteObjectId,
    saison_id: str,
    spieler_id: CustomRouteObjectId,
    zeile_data: Annotated[FLPatchKaderZeilePayload, Body()],
    identifier: KontaktIdentifier,
    saison_spieler_collection: SaisonSpielerCollection,
    saisons_collection: SaisonsCollection,
    records: SubjektLookup,
    db: DBClient,
) -> FLKaderZeileResponse:
    """
    Replace a live squad row's `nummer`, `position`, `stufe` and `rolle`, as any contact seat of its team may.

    The team and the Nachnominierung flag stay the stored row's. 404 where this team holds no live
    row for the player in this season: another team's pupil and an ausgetragen row answer alike, and
    nothing is written. Refused `REQ-FUNKTION-001` without a seat, `REQ-SQUAD-005` for a `stufe` the
    season's `erlaubte_stufen` does not offer unless the row already holds it, and `REQ-SQUAD-004`
    for a `rolle` another live row of the squad holds. A shared `nummer` is permitted.
    """

    row = _live_row(team_id=team_id, saison_id=saison_id, spieler_id=spieler_id)

    async def edit_the_row(session: AsyncClientSession) -> FLKaderZeileResponse:
        """Judge, then rewrite the row. Everything judged is read in-session."""

        await refuse_without_a_seat(identifier, records, team_id=team_id, saison_id=saison_id, session=session)

        # The 404 before any rule: a rule judged on a row this team does not hold would tell the
        # caller something about another team's squad.
        stored_raw = await pull_one_from_db(collection=saison_spieler_collection, db_filter=row, projection=["stufe"], session=session)

        refuse(
            find_kader_stufe_refusal(
                stufe=zeile_data.stufe,
                stored_stufe=stored_raw.get("stufe"),
                erlaubte_stufen=await _erlaubte_stufen(saisons_collection=saisons_collection, saison_id=saison_id, session=session),
            )
        )

        # The captaincy alone and never the cap: a live row edited inside its own squad leaves the
        # squad's size where it was.
        await refuse_a_taken_rolle(
            saison_spieler_collection=saison_spieler_collection,
            saisons_collection=saisons_collection,
            saison_id=saison_id,
            team_id=team_id,
            spieler_id=spieler_id,
            rolle=zeile_data.rolle,
            session=session,
        )

        # `BEFORE`: the answer is read back below with the whole squad, so the driver's image is discarded.
        await patch_one_in_db(
            collection=saison_spieler_collection,
            db_filter=row,
            update={"$set": zeile_data.model_dump(mode="json")},
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

        return await _the_row_as_written(
            saison_spieler_collection=saison_spieler_collection, team_id=team_id, saison_id=saison_id, spieler_id=spieler_id, session=session
        )

    # The captaincy's anchor writes the season, and every season write drops the cache
    # (`docs/backend/spec.md :: I131`).
    with dropping_the_saison_cache():
        async with transaction_session(db) as session:
            return await session.with_transaction(edit_the_row)


@router.delete(
    ROW_PATH,
    response_model=FLKaderZeileResponse,
    summary="Take a Spieler out of the squad as its team's seat holder (austragen)",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
    dependencies=[Depends(gedrosselt)],
)
async def delete_kader_zeile(
    team_id: CustomRouteObjectId,
    saison_id: str,
    spieler_id: CustomRouteObjectId,
    identifier: KontaktIdentifier,
    saison_spieler_collection: SaisonSpielerCollection,
    records: SubjektLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLKaderZeileResponse:
    """
    Take a player out of this team's squad for the season, as any contact seat of the team may. SOFT: the row stays.

    Stamps the row's `inactive_since`; the person stays in the league, and only an administrator
    brings the row back. 404 where this team holds no live row for the player in this season,
    another team's pupil and an ausgetragen row alike. Refused `REQ-FUNKTION-001` without a seat.
    """

    async def take_the_row_out(session: AsyncClientSession) -> FLKaderZeileResponse:
        """Judge the seat, then stamp the row: the live-row filter is the write's own, so an ausgetragen row is a 404 here."""

        await refuse_without_a_seat(identifier, records, team_id=team_id, saison_id=saison_id, session=session)

        await set_inactive_since(
            collection=saison_spieler_collection,
            db_filter=_live_row(team_id=team_id, saison_id=saison_id, spieler_id=spieler_id),
            when=today,
            session=session,
        )

        return await _the_row_as_written(
            saison_spieler_collection=saison_spieler_collection, team_id=team_id, saison_id=saison_id, spieler_id=spieler_id, session=session
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(take_the_row_out)
