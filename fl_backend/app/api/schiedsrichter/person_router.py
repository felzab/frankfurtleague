from fastapi import APIRouter, status
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.account.services import Grants, find_own_entry_refusal, press_own_einwilligung
from app.api.identity.crud import roles_of
from app.api.identity.lookup import SubjectLookup
from app.api.identity.services import is_own_schiedsrichter, may_grant_on_schiedsrichter
from app.api.saisons.schemas import FLOwnSaisonsResponse
from app.api.schiedsrichter.schemas import FLSchiedsrichterSpieleResponse
from app.api.schiedsrichter.services import (
    EINWILLIGUNG_FIELD,
    build_self_referee_filter,
    build_self_saisons_pipeline,
    build_self_spiele_pipeline,
    compose_self_spiel,
)
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, patch_past_the_version_in_db, refuse
from app.core.dependencies import (
    DBClient,
    GermanDay,
    GermanyNow,
    SchiedsrichterCollection,
    SnapshotSession,
    SpieleReadCollection,
)
from app.core.routing import by_id
from app.core.security import PERSON_TIER, PersonIdentifier
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.einwilligung import FLSchiedsrichterAccountEinwilligungPayload

# A person's own router, apart from the admin one and the confirmation one.
router = APIRouter(
    prefix="/schiedsrichter",
    dependencies=PERSON_TIER,
)


@router.patch(
    f"{by_id('schiedsrichter_id')}/einwilligung",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Change a signed-in referee's own publication and media consent",
)
async def patch_einwilligung(
    schiedsrichter_id: CustomObjectId,
    einwilligung_data: FLSchiedsrichterAccountEinwilligungPayload,
    identifier: PersonIdentifier,
    schiedsrichter_collection: SchiedsrichterCollection,
    records: SubjectLookup,
    db: DBClient,
    today: GermanDay,
    germany_now: GermanyNow,
) -> None:
    """Set the two choices of one of the signed-in referee's own consent records: the publication scope and the media consent.

    The public fixture list reads the scope off this row, so the caller drops its cached copy after a successful answer.
    """

    async def may_give(session: AsyncClientSession) -> bool:
        return may_grant_on_schiedsrichter(await roles_of(identifier, records, session=session), schiedsrichter_id)

    await press_own_einwilligung(
        einwilligung_data=einwilligung_data,
        kind=Collection.SCHIEDSRICHTER,
        collection=schiedsrichter_collection,
        own_entry=build_self_referee_filter(identifier, schiedsrichter_id=schiedsrichter_id),
        projection={"kontakt.email": 1, "birth_date": 1, EINWILLIGUNG_FIELD: 1},
        # The fold decides, as it does for the read: the filter's pattern is the wider rule.
        owns=lambda row: is_own_schiedsrichter(row, identifier),
        grants=Grants(may_give=may_give, today=today),
        # Past the record's `version`: the consent is no field the editor saves, and the press's read, in its
        # transaction, is what a second press is judged on.
        write=patch_past_the_version_in_db,
        db=db,
        now=germany_now,
    )


@router.get(
    "/self/saisons/{saison_id}/spiele",
    summary="A signed-in referee's fixtures of one season, one row a fixture",
)
async def get_self_spiele(
    saison_id: str,
    identifier: PersonIdentifier,
    spiele_collection: SpieleReadCollection,
    records: SubjectLookup,
    session: SnapshotSession,
    germany_now: GermanyNow,
) -> FLSchiedsrichterSpieleResponse:
    """Every fixture of this season booked to the signed-in address's live, confirmed referee records, in the order the draw numbered them.

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

    return FLSchiedsrichterSpieleResponse(saison_id=saison_id, spiele=[compose_self_spiel(spiel, now=germany_now) for spiel in spiele])


@router.get("/self/saisons", summary="The seasons a signed-in referee has fixtures in")
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

    return FLOwnSaisonsResponse.model_validate({"saisons": saisons})
