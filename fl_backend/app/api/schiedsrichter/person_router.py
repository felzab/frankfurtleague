from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends, status
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.account.crud import press_einwilligung
from app.api.account.services import (
    compose_person_move,
    find_own_entry_refusal,
    withdrawal_line,
)
from app.api.identity.crud import roles_of
from app.api.identity.lookup import SubjectLookup
from app.api.identity.services import is_own_schiedsrichter, may_grant_on_schiedsrichter
from app.api.saisons.schemas import FLOwnSaisonsResponse, FLSaisonFrameEntryListAdapter
from app.api.schiedsrichter.schemas import FLSchiedsrichterSpieleResponse
from app.api.schiedsrichter.services import (
    EINWILLIGUNG_FIELD,
    build_self_referee_filter,
    build_self_saisons_pipeline,
    build_self_spiele_pipeline,
    compose_self_spiel,
    order_self_spiele,
)
from app.core.clock import utc_stamp
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, patch_past_the_version_in_db, refuse
from app.core.dependencies import (
    DBClient,
    SchiedsrichterCollection,
    SnapshotSession,
    SpieleReadCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.journal import Journal
from app.core.routing import by_id
from app.core.security import PersonIdentifier, get_person_identifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung_evidence import FLEinwilligungChoice
from app.shared.schemas.custom import CustomRouteObjectId
from app.shared.schemas.einwilligung import FLSchiedsrichterAccountEinwilligungPayload, by_choice

# A person's own router, apart from the admin one and the confirmation one.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter",
    dependencies=[Depends(verify_access_admin), Depends(get_person_identifier)],
)


@router.patch(
    f"/account{by_id('schiedsrichter_id')}/einwilligung",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Change a signed-in referee's own publication and media consent",
)
async def patch_einwilligung(
    schiedsrichter_id: CustomRouteObjectId,
    einwilligung_data: Annotated[FLSchiedsrichterAccountEinwilligungPayload, Body()],
    identifier: PersonIdentifier,
    schiedsrichter_collection: SchiedsrichterCollection,
    records: SubjectLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> None:
    """Set the two choices of one of the signed-in referee's own consent records: the publication scope and the media consent.

    The public fixture list reads the scope off this row, so the caller drops its cached copy after a successful answer.
    """

    own_entry = build_self_referee_filter(identifier, schiedsrichter_id=schiedsrichter_id)
    chosen: dict[FLEinwilligungChoice, object] = {"scope": einwilligung_data.scope, "media": einwilligung_data.media}
    at = utc_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def write(session: AsyncClientSession) -> None:
        row = await schiedsrichter_collection.find_one(
            own_entry, projection={"kontakt.email": 1, "birth_date": 1, EINWILLIGUNG_FIELD: 1}, session=session
        )
        # The fold decides, as it does for the read: the filter's pattern is the wider rule.
        refuse(find_own_entry_refusal(held=row is not None and is_own_schiedsrichter(row, identifier)))
        assert row is not None
        saved = row[EINWILLIGUNG_FIELD]

        async def may_give() -> bool:
            return may_grant_on_schiedsrichter(await roles_of(identifier, records, session=session), schiedsrichter_id)

        await press_einwilligung(
            blocks=[saved],
            birth_dates=[row.get("birth_date")],
            chosen=chosen,
            evidence_state=einwilligung_data.evidence_state.model_dump(),
            text_versions=einwilligung_data.text_versions,
            may_give=may_give,
            today=today,
        )

        update = compose_person_move(saved=saved, chosen=chosen, at=at, text_versions=by_choice(einwilligung_data.text_versions))
        if update is not None:
            # Past the record's `version`: the consent is no field the editor saves, and the read above, in this
            # transaction, is what a second press is judged on.
            await patch_past_the_version_in_db(
                collection=schiedsrichter_collection, db_filter={"_id": row["_id"]}, update=update, session=session
            )
        choices = withdrawal_line(blocks=[saved], chosen=chosen)
        if choices is not None:
            journal.note("withdrawal", [f"{Collection.SCHIEDSRICHTER}/{row['_id']}"], choices=list(choices))

    async with journal:
        async with transaction_session(db) as session:
            await session.with_transaction(write)


@router.get(
    "/self/spiele/{saison_id}",
    response_model=FLSchiedsrichterSpieleResponse,
    summary="A signed-in referee's fixtures of one season, one row a fixture",
)
async def get_self_spiele(
    saison_id: str,
    identifier: PersonIdentifier,
    spiele_collection: SpieleReadCollection,
    records: SubjectLookup,
    session: SnapshotSession,
    now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterSpieleResponse:
    """Every fixture of this season booked to one of the signed-in address's live, confirmed referee records, open work first.

    Nobody's address is served, and no reason an administrator entered.
    """

    # A snapshot, so each fixture is judged against the records, rows and report of one moment; never a transaction,
    # which a read writing nothing has no conflict to retry.
    subject = await roles_of(identifier, records, session=session)
    refuse(find_own_entry_refusal(held=bool(subject.schiedsrichter)))
    spiele = await aggregate_many_from_db(
        collection=spiele_collection,
        pipeline=build_self_spiele_pipeline(
            saison_id=saison_id, schiedsrichter_ids=[record.schiedsrichter_id for record in subject.schiedsrichter]
        ),
        session=session,
    )

    return FLSchiedsrichterSpieleResponse(
        saison_id=saison_id, spiele=order_self_spiele([compose_self_spiel(spiel, now=now) for spiel in spiele])
    )


@router.get("/self/saisons", response_model=FLOwnSaisonsResponse, summary="The seasons a signed-in referee has fixtures in")
async def get_self_saisons(
    identifier: PersonIdentifier,
    spiele_collection: SpieleReadCollection,
    records: SubjectLookup,
    session: SnapshotSession,
) -> FLOwnSaisonsResponse:
    """Every season in which a fixture is booked to one of the signed-in address's live, confirmed referee records, the newest first."""

    subject = await roles_of(identifier, records, session=session)
    refuse(find_own_entry_refusal(held=bool(subject.schiedsrichter)))
    saisons = await aggregate_many_from_db(
        collection=spiele_collection,
        pipeline=build_self_saisons_pipeline([record.schiedsrichter_id for record in subject.schiedsrichter]),
        session=session,
    )

    return FLOwnSaisonsResponse(saisons=FLSaisonFrameEntryListAdapter.validate_python(saisons))
