from datetime import datetime

from fastapi import APIRouter, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.address_change.crud import known_to_the_new_mailbox, others_naming
from app.api.ban_list.guard import PERSON_ACTOR_BINDERS, KontaktIdentifier
from app.api.grants.crud import read_grants
from app.api.identity.crud import EACH_PERSON_GROUP, ErasureJournal, erase_everything, resolve_subject
from app.api.identity.schemas import FLAccountErasureViewResponse, FLErasureResponse
from app.api.identity.services import build_season_team_pipeline, compose_account_erasure_view, find_last_owner_erasure_refusal
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, refuse
from app.core.dependencies import (
    ActionLogCollection,
    AddressChangeCollection,
    BanListCollection,
    BewerbungenCollection,
    DBClient,
    GrantsCollection,
    InvitationsCollection,
    OutboxCollection,
    RegistrierungenCollection,
    SaisonSpielerCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielberichteCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
    SpielerCollection,
    get_germany_now,
)
from app.core.security import verify_access_admin
from app.core.transactions import transaction_session

# `kontakt` bound, as the account page's router binds it: a person erases themselves holding no Funktion at all.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/identity/account",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["kontakt"])],
)


@router.post(
    "/erasure",
    response_model=FLErasureResponse,
    summary="Erase every record the signed-in address holds",
)
async def post_account_erasure(
    identifier: KontaktIdentifier,
    spieler_collection: SpielerCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spielberichte_collection: SpielberichteCollection,
    registrierungen_collection: RegistrierungenCollection,
    action_log_collection: ActionLogCollection,
    grants_collection: GrantsCollection,
    outbox_collection: OutboxCollection,
    invitations_collection: InvitationsCollection,
    ban_list_collection: BanListCollection,
    address_changes_collection: AddressChangeCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLErasureResponse:
    """
    Erase every record the signed-in address holds, at once and as one write, and answer how many of each kind went.

    PERSON TIER. The owner is refused until a handover (`last_owner_erasure`), since nobody else could name an owner, and a
    person holding a grant erases it with the rest. No other precondition stands in front of a person's own request, a
    pupil in a live squad and a referee booked on a fixture still to be played included. Nothing is counted against the
    person's day.

    Removed: the pupil record and every squad row it holds, so the team reads one player fewer; the referee record,
    every fixture it was booked on moving to the one row that holds no person and keeping its own fee, and every
    confirmation it was asked for, answered or not; every registration at the address, pending or declined; another
    address's pending change naming this one as its new address, every record it would move standing at its own; every
    grant the address holds, every administrator being told it ended.
    Emptied: every contact seat the address holds on a team's season row and on an application of any status, the row
    and its other seats standing, an emptied seat's links on its team's open match confirmations stopping to answer.
    Every reason the person typed answering a match confirmation, from any seat they held, goes from its row, the answer
    standing. Every match report the referee record sent stands, its remarks and entries included, naming the row that
    holds no person in its place. Every record the person made as an administrator or decided as a seat holder -- a grant,
    a ban, an invitation, an application's or a registration's decision -- and every log row naming their address name a
    fixed marker in their place.

    An address holding nothing is answered with every count zero rather than refused. The 409 answers only a database
    changed by hand, a second nameless referee meeting the ghost's name index. The 404 is published for the steps' reads by
    id, which no request can meet: every id comes from the subject read in the same snapshot. The sign-in account is not
    touched here: deleting it is the caller's, once this has answered.
    """

    journal = ErasureJournal(grants_collection=grants_collection)

    async def erase_the_address(session: AsyncClientSession) -> FLErasureResponse:
        grants = await read_grants(grants_collection=grants_collection, session=session)
        # Before any write. A handover finishing meanwhile writes the row this erasure deletes, so the two conflict and the
        # retry reads the new owner.
        refuse(find_last_owner_erasure_refusal(identifier=identifier, grants=grants))

        return journal.took(
            await erase_everything(
                identifier,
                scope=EACH_PERSON_GROUP,
                spieler_collection=spieler_collection,
                saison_spieler_collection=saison_spieler_collection,
                saison_teams_collection=saison_teams_collection,
                bewerbungen_collection=bewerbungen_collection,
                schiedsrichter_collection=schiedsrichter_collection,
                spiele_collection=spiele_collection,
                spielbestaetigungen_collection=spielbestaetigungen_collection,
                spielberichte_collection=spielberichte_collection,
                registrierungen_collection=registrierungen_collection,
                action_log_collection=action_log_collection,
                grants_collection=grants_collection,
                outbox_collection=outbox_collection,
                invitations_collection=invitations_collection,
                ban_list_collection=ban_list_collection,
                address_changes_collection=address_changes_collection,
                changed_by=identifier,
                for_the_person=True,
                now=germany_now,
                session=session,
            )
        )

    async with journal:
        async with transaction_session(db) as session:
            answer = await session.with_transaction(erase_the_address)

    return answer


@router.get(
    "/erasure/view",
    response_model=FLAccountErasureViewResponse,
    summary="Show what an erasure of the signed-in address would remove",
)
async def get_account_erasure_view(
    identifier: KontaktIdentifier,
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    spieler_collection: SpielerCollection,
    registrierungen_collection: RegistrierungenCollection,
    address_changes_collection: AddressChangeCollection,
    grants_collection: GrantsCollection,
    db: DBClient,
) -> FLAccountErasureViewResponse:
    """
    Answer what `POST /identity/account/erasure` would remove for the signed-in address, by kind and by name.

    Read through that erasure's own selections in one snapshot, so it names every record of the person's own the erasure
    removes or empties, an unconfirmed seat, a retired row and a declined registration among them, and no other. No address
    and no birthdate is answered. Another address's pending change naming this one is counted and not named, once its link
    has reached this mailbox: its records are not this address's until it takes effect. Reached and not named: the fixtures
    booking their referee record, which move onto the ghost; the confirmations their referee record was asked for, which go;
    the match reports their referee record sent, which stand naming the ghost; the links their contact seats were mailed on
    their teams' match confirmations, which stop answering; every reason they typed answering a match confirmation, from any
    seat they held, which goes from its row, the answer standing; what the person made or decided for others, which names a
    marker in their place; and the log rows naming their address. Written besides: the notice that their grant ended, which
    every administrator is sent. `admin_tier` is the tier of the grant the address holds, or null; a dead spelling of the
    address, which admits nobody, goes with the erasure unnamed.
    """

    # A snapshot, so the preview names the records of one moment; never a transaction, a read
    # writing nothing having no conflict to retry for.
    async with db.start_session(snapshot=True) as session:
        subject = await resolve_subject(
            identifier,
            saison_teams_collection=saison_teams_collection,
            bewerbungen_collection=bewerbungen_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            spieler_collection=spieler_collection,
            registrierungen_collection=registrierungen_collection,
            address_changes_collection=address_changes_collection,
            grants_collection=grants_collection,
            session=session,
        )
        # A registration holds its team's id alone, and the season row is what names the club that season.
        team_rows = (
            await aggregate_many_from_db(
                collection=saison_teams_collection, pipeline=build_season_team_pipeline(subject.registrierungen), session=session
            )
            if subject.registrierungen
            else []
        )
        grants = await read_grants(grants_collection=grants_collection, session=session)
        # A live row is its own fold, so equality is the fold's judgement.
        own = next((grant for grant in grants if grant["address"] == identifier), None)

    view = compose_account_erasure_view(
        identifier,
        saison_team_rows=subject.saison_teams,
        bewerbung_rows=subject.bewerbungen,
        referee_rows=subject.schiedsrichter,
        pupil_rows=subject.spieler,
        registrierung_rows=subject.registrierungen,
        # The person's own preview counts only what reached their mailbox, which an administrator's request has not yet.
        address_change_rows=known_to_the_new_mailbox(others_naming(subject.address_change, identifier)),
        team_rows=team_rows,
    )

    return FLAccountErasureViewResponse(**view.model_dump(), admin_tier=None if own is None else own["admin_tier"])
