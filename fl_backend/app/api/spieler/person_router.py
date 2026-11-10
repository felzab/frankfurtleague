from collections.abc import Mapping
from datetime import datetime
from http import HTTPStatus
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, status
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.account.crud import may_always_give, press_einwilligung
from app.api.account.services import (
    compose_person_move,
    compose_spieler_self,
    find_own_entry_refusal,
    withdrawal_line,
)
from app.api.identity.crud import refuse_without_a_seat
from app.api.identity.lookup import RecordCollections, SubjectLookup
from app.api.identity.services import is_own_spieler
from app.api.saisons.schemas import FLOwnSaisonsResponse, FLSaisonRules
from app.api.spieler.crud import refuse_a_taken_rolle
from app.api.spieler.panel import FLSpielerSaisonSelfResponse
from app.api.spieler.schemas import (
    FLKaderResponse,
    FLKaderRow,
    FLPatchKaderRowPayload,
    FLSpielerSelfResponse,
)
from app.api.spieler.services import (
    build_kader_pipeline,
    build_self_pupil_filter,
    build_self_pupil_pipeline,
    find_kader_stufe_refusal,
    mark_shared_nummern,
)
from app.core.clock import utc_stamp
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import GERMAN_COLLATION, aggregate_many_from_db, patch_one_in_db, pull_one_from_db, refuse, set_inactive_since
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonSpielerCollection,
    SpielerCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exceptions import APIError
from app.core.journal import Journal
from app.core.recording import ACT_BY_KONTAKT, FLAction, record_act
from app.core.routing import by_id
from app.core.security import PersonIdentifier, get_person_identifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung_evidence import FLEinwilligungChoice
from app.shared.schemas.custom import CustomObjectId, CustomRouteObjectId
from app.shared.schemas.einwilligung import FLAccountEinwilligungPayload, by_choice
from app.shared.schemas.literals import FLSpielerStufe

# The person lane's identifier IN PLACE of `bind_actor` and the grants check, which a seat holder holding
# no grant would fail.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieler/kader",
    dependencies=[Depends(verify_access_admin), Depends(get_person_identifier)],
)


SQUAD_PATH = f"{by_id('team_id')}/{{saison_id}}"
ROW_PATH = f"{SQUAD_PATH}{by_id('spieler_id')}"


async def _record_the_seats_act(
    action: FLAction,
    *,
    collection: AsyncCollection,
    records: RecordCollections,
    team_id: CustomObjectId,
    saison_id: str,
    spieler_id: CustomObjectId,
    session: AsyncClientSession,
) -> None:
    """One row of a seat's act on a pupil: the seat's club by its name at the act, the pupil by id alone."""

    verein = await pull_one_from_db(
        collection=records.saison_teams_collection,
        db_filter={"team_id": team_id, "saison_id": saison_id},
        projection=["name"],
        session=session,
    )
    await record_act(
        collection=collection,
        action=action,
        by=ACT_BY_KONTAKT,
        team=str(verein["name"]),
        record_id=spieler_id,
        label=saison_id,
        session=session,
    )


def _live_row(*, team_id: CustomObjectId, saison_id: str, spieler_id: CustomObjectId) -> Mapping[str, Any]:
    """The team in the filter, so another team's pupil named under this path matches nothing; live, so an ausgetragen row is read-only."""

    return {"spieler_id": spieler_id, "saison_id": saison_id, "team_id": team_id, "inactive_since": None}


async def _read_the_squad(
    *, saison_spieler_collection: AsyncCollection, team_id: CustomObjectId, saison_id: str, session: AsyncClientSession
) -> list[FLKaderRow]:
    """The whole squad, each row's shirt marker judged against every other: no single row carries what it is compared with."""

    rows = await aggregate_many_from_db(
        collection=saison_spieler_collection,
        pipeline=build_kader_pipeline(saison_id=saison_id, team_id=team_id),
        collation=GERMAN_COLLATION,
        session=session,
    )

    return [FLKaderRow.model_validate(row) for row in mark_shared_nummern(rows)]


async def _allowed_stufen(*, saisons_collection: AsyncCollection, saison_id: str, session: AsyncClientSession) -> list[FLSpielerStufe]:
    # `find_one` rather than `pull_one_from_db`: every caller passed `refuse_without_a_seat` first on this
    # session, which read this season for the seat, and no season is ever deleted, so a miss is a broken
    # invariant rather than a 404.
    saison_raw = await saisons_collection.find_one({"_id": saison_id}, projection={"rules": 1}, session=session)
    assert saison_raw is not None

    # Through the model the rules are written under, as `refuse_a_full_squad` reads the cap: a list
    # that model refuses, an empty one included, fails here rather than reaching the page.
    return FLSaisonRules.model_validate(saison_raw["rules"]).allowed_stufen


async def _the_row_as_written(
    *,
    saison_spieler_collection: AsyncCollection,
    team_id: CustomObjectId,
    saison_id: str,
    spieler_id: CustomObjectId,
    session: AsyncClientSession,
) -> FLKaderRow:
    """Read back inside the write's own transaction, so the shirt marker is the squad's after this write and before any other."""

    kader = await _read_the_squad(saison_spieler_collection=saison_spieler_collection, team_id=team_id, saison_id=saison_id, session=session)
    [row] = [row for row in kader if row.spieler_id == spieler_id]

    return row


@router.get(SQUAD_PATH, response_model=FLKaderResponse, summary="Read a team's squad as its seat holder")
async def get_kader(
    team_id: CustomRouteObjectId,
    saison_id: str,
    identifier: PersonIdentifier,
    saison_spieler_collection: SaisonSpielerCollection,
    saisons_collection: SaisonsCollection,
    records: SubjectLookup,
    db: DBClient,
) -> FLKaderResponse:
    """
    The squad of one team in one season, for a person holding any contact seat on it.

    Every row, ausgetragen ones included and marked by `inactive_since`; each surname whole, and no
    e-mail address or telephone number of anybody. `nummer_double` marks a live row whose number
    another live row of the squad wears, compared as stored. `allowed_stufen` is what the season's
    rules offer an edit. Refused `role_not_held` where the signed-in person holds no seat on this
    team in this season, a seat on a `past` season holding none.
    """

    # A snapshot, so the squad served is the one the seat was judged against; never a transaction,
    # which a read writing nothing has no conflict to retry and no anchor to take.
    async with db.start_session(snapshot=True) as session:
        await refuse_without_a_seat(identifier, records, team_id=team_id, saison_id=saison_id, session=session)

        return FLKaderResponse(
            team_id=team_id,
            saison_id=saison_id,
            allowed_stufen=await _allowed_stufen(saisons_collection=saisons_collection, saison_id=saison_id, session=session),
            kader=await _read_the_squad(
                saison_spieler_collection=saison_spieler_collection, team_id=team_id, saison_id=saison_id, session=session
            ),
        )


@router.patch(
    ROW_PATH,
    response_model=FLKaderRow,
    summary="Update a squad entry as its team's seat holder",
)
async def patch_kader_row(
    team_id: CustomRouteObjectId,
    saison_id: str,
    spieler_id: CustomRouteObjectId,
    row_data: Annotated[FLPatchKaderRowPayload, Body()],
    identifier: PersonIdentifier,
    saison_spieler_collection: SaisonSpielerCollection,
    saisons_collection: SaisonsCollection,
    records: SubjectLookup,
    db: DBClient,
) -> FLKaderRow:
    """
    Replace a live squad row's `nummer`, `position`, `stufe` and `rolle`, as any contact seat of its team may.

    The team and the Nachnominierung flag stay the stored row's. 404 where this team holds no live
    row for the player in this season: another team's pupil and an ausgetragen row answer alike, and
    nothing is written. Refused `role_not_held` without a seat, `kader_stufe_not_allowed` for a `stufe` the
    season's `allowed_stufen` does not offer unless the row already holds it, and `kader_rolle_taken`
    for a `rolle` another live row of the squad holds. A shared `nummer` is permitted.
    """

    row = _live_row(team_id=team_id, saison_id=saison_id, spieler_id=spieler_id)

    async def edit_the_row(session: AsyncClientSession) -> FLKaderRow:
        """Judge, then rewrite the row. Everything judged is read in-session."""

        await refuse_without_a_seat(identifier, records, team_id=team_id, saison_id=saison_id, session=session)

        # The 404 before any rule: a rule judged on a row this team does not hold would tell the
        # caller something about another team's squad.
        stored_raw = await pull_one_from_db(collection=saison_spieler_collection, db_filter=row, projection=["stufe"], session=session)

        refuse(
            find_kader_stufe_refusal(
                stufe=row_data.stufe,
                stored_stufe=stored_raw.get("stufe"),
                allowed_stufen=await _allowed_stufen(saisons_collection=saisons_collection, saison_id=saison_id, session=session),
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
            rolle=row_data.rolle,
            session=session,
        )

        # `BEFORE`: the answer is read back below with the whole squad, so the driver's image is discarded.
        await patch_one_in_db(
            collection=saison_spieler_collection,
            db_filter=row,
            update={"$set": row_data.model_dump(mode="json", exclude={"version"})},
            expected_version=row_data.version,
            session=session,
            return_document=ReturnDocument.BEFORE,
        )
        await _record_the_seats_act(
            "spieler.changed",
            collection=saison_spieler_collection,
            records=records,
            team_id=team_id,
            saison_id=saison_id,
            spieler_id=spieler_id,
            session=session,
        )

        return await _the_row_as_written(
            saison_spieler_collection=saison_spieler_collection, team_id=team_id, saison_id=saison_id, spieler_id=spieler_id, session=session
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(edit_the_row)


@router.delete(
    ROW_PATH,
    response_model=FLKaderRow,
    summary="Take a Spieler out of the squad as its team's seat holder (retire)",
)
async def delete_kader_row(
    team_id: CustomRouteObjectId,
    saison_id: str,
    spieler_id: CustomRouteObjectId,
    identifier: PersonIdentifier,
    saison_spieler_collection: SaisonSpielerCollection,
    records: SubjectLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLKaderRow:
    """
    Take a player out of this team's squad for the season, as any contact seat of the team may. SOFT: the row stays.

    Stamps the row's `inactive_since`; the person stays in the league, and only an administrator
    brings the row back. 404 where this team holds no live row for the player in this season,
    another team's pupil and an ausgetragen row alike. Refused `role_not_held` without a seat.
    """

    async def take_the_row_out(session: AsyncClientSession) -> FLKaderRow:
        """Judge the seat, then stamp the row: the live-row filter is the write's own, so an ausgetragen row is a 404 here."""

        await refuse_without_a_seat(identifier, records, team_id=team_id, saison_id=saison_id, session=session)

        await set_inactive_since(
            collection=saison_spieler_collection,
            db_filter=_live_row(team_id=team_id, saison_id=saison_id, spieler_id=spieler_id),
            when=today,
            session=session,
        )
        await _record_the_seats_act(
            "spieler.deregistered",
            collection=saison_spieler_collection,
            records=records,
            team_id=team_id,
            saison_id=saison_id,
            spieler_id=spieler_id,
            session=session,
        )

        return await _the_row_as_written(
            saison_spieler_collection=saison_spieler_collection, team_id=team_id, saison_id=saison_id, spieler_id=spieler_id, session=session
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(take_the_row_out)


# A router of its own for its prefix.
spieler_router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieler",
    dependencies=[Depends(verify_access_admin), Depends(get_person_identifier)],
)


@spieler_router.get("/self", response_model=FLSpielerSelfResponse, summary="A signed-in pupil's own record")
async def get_self(identifier: PersonIdentifier, spieler_collection: SpielerCollection) -> FLSpielerSelfResponse:
    """
    Answer the signed-in address's own pupil record's stored data with every squad row it holds.

    PERSON TIER: the whole surname and the birthdate, never masked, and never the sign-in address itself.
    Its consent is the account page's (`GET /account/einwilligungen`), so none is served here.

    Refuses an address holding no confirmed pupil record (`role_not_held`).
    """

    rows = await aggregate_many_from_db(collection=spieler_collection, pipeline=build_self_pupil_pipeline(identifier))
    row = rows[0] if rows else None
    refuse(find_own_entry_refusal(held=row is not None and is_own_spieler(row)))
    assert row is not None

    return FLSpielerSelfResponse.model_validate({"spieler": compose_spieler_self(row)})


@spieler_router.patch(
    "/account/einwilligung",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Change a signed-in pupil's own publication and media consent",
)
async def patch_einwilligung(
    einwilligung_data: Annotated[FLAccountEinwilligungPayload, Body()],
    identifier: PersonIdentifier,
    spieler_collection: SpielerCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> None:
    """
    Set the two choices of the signed-in address's own pupil consent record: the publication scope and the media consent.

    Writes those two on this one record, each moved choice with its evidence (`evidence.<choice>`), and nothing else:
    the confirmation day, the day given and the wording they confirmed stand, and no other document is written. A
    PATCH moving neither choice writes nothing.

    Refuses, in this order: an address holding no confirmed pupil record (`role_not_held`); a `evidence_state`
    other than the record's own, either choice having moved since the page was served (`choices_stale`); a choice
    moving onto a grant under a label other than its
    current wording's, the page loaded before a rewording (`grant_wording_stale`); `media` moving to `true` where
    the stored birthdate does not reach `MEDIA_MIN_AGE_YEARS` today or is missing (`media_age`). Each
    refusal writes nothing.

    **The caller drops the cached squad lists after a successful answer**: the publication scope decides whether a
    name is served, and nothing here can.
    """

    own_entry = build_self_pupil_filter(identifier)
    chosen: dict[FLEinwilligungChoice, object] = {"scope": einwilligung_data.scope, "media": einwilligung_data.media}
    at = utc_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def write(session: AsyncClientSession) -> None:
        row = await spieler_collection.find_one(own_entry, projection={"einwilligung": 1, "birth_date": 1}, session=session)
        refuse(find_own_entry_refusal(held=row is not None and is_own_spieler(row)))
        assert row is not None
        saved = row["einwilligung"]

        await press_einwilligung(
            blocks=[saved],
            birth_dates=[row.get("birth_date")],
            chosen=chosen,
            evidence_state=einwilligung_data.evidence_state.model_dump(),
            text_versions=einwilligung_data.text_versions,
            may_give=may_always_give,
            today=today,
        )

        update = compose_person_move(saved=saved, chosen=chosen, at=at, text_versions=by_choice(einwilligung_data.text_versions))
        if update is not None:
            await patch_one_in_db(
                collection=spieler_collection,
                db_filter={"_id": row["_id"]},
                update=update,
                session=session,
                expected_version=None,
                return_document=ReturnDocument.BEFORE,
            )
        choices = withdrawal_line(blocks=[saved], chosen=chosen)
        if choices is not None:
            journal.note("withdrawal", [f"{Collection.SPIELER}/{row['_id']}"], choices=list(choices))

    async with journal:
        async with transaction_session(db) as session:
            await session.with_transaction(write)


# Declared ahead of `/self/{saison_id}`, whose parameter would otherwise take the word (FastAPI's "Order matters").
@spieler_router.get("/self/saisons", response_model=FLOwnSaisonsResponse, summary="The seasons a signed-in pupil holds a squad row in")
async def get_self_saisons(identifier: PersonIdentifier) -> FLOwnSaisonsResponse:
    """
    Every season the signed-in pupil holds a squad row in, a deregistered one included, the newest first, each with its span.

    A planned season is served as any other. Refuses an address holding no confirmed pupil record (`role_not_held`).
    """

    # Session 8: the read goes from the pupil's own record through their squad rows to those rows' seasons.
    raise APIError(HTTPStatus.NOT_IMPLEMENTED, Code.UNHANDLED_CRASH)


@spieler_router.get(
    "/self/{saison_id}",
    response_model=FLSpielerSaisonSelfResponse,
    summary="A signed-in pupil's own season: their squad row and their team's fixtures",
)
async def get_self_saison(saison_id: str, identifier: PersonIdentifier) -> FLSpielerSaisonSelfResponse:
    """
    What the signed-in pupil's own page shows of one season, in one read.

    Their squad row of this season with the name its club plays the season under, null where they hold none; and
    that club's fixtures in the order the draw numbered them, each with
    whether the club's stored line-up starts them (`starts` true), benches them (false) or does not name them, or
    none is stored (null).

    Refuses an address holding no confirmed pupil record (`role_not_held`).
    """

    # Session 8: the read goes from the pupil's own record through this season's squad row to its club's fixtures and
    # the line-ups naming the pupil.
    raise APIError(HTTPStatus.NOT_IMPLEMENTED, Code.UNHANDLED_CRASH)
