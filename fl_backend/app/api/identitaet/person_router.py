from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.adresswechsel.crud import known_to_the_new_mailbox, others_naming
from app.api.berechtigungen.crud import pull_the_list_to_judge, read_berechtigungen
from app.api.identitaet.crud import JEDE_PERSONENGRUPPE, LoeschungJournal, loeschen_everything, resolve_subject
from app.api.identitaet.schemas import FLAccountErasureViewResponse, FLErasureResponse
from app.api.identitaet.services import (
    build_season_team_pipeline,
    compose_loeschung_ansicht,
    find_letzter_inhaber_loeschung_refusal,
    holds_an_owner_grant,
)
from app.api.sperrliste.guard import PERSON_ACTOR_BINDERS, KontaktIdentifier
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import aggregate_many_from_db, refuse
from app.core.dependencies import (
    AdresswechselCollection,
    AktionenCollection,
    BerechtigungenAngekuendigtCollection,
    BerechtigungenAntraegeCollection,
    BerechtigungenCollection,
    BewerbungenCollection,
    DBClient,
    EinladungenCollection,
    PostausgangCollection,
    RegistrierungenCollection,
    SaisonSpielerCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SperrlisteCollection,
    SpielberichteCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
    SpielerCollection,
    get_germany_now,
)
from app.core.recording import log_stamp
from app.core.security import SessionActor, verify_access_admin, verify_person_actor, verify_person_passkey_confirmation
from app.core.transactions import transaction_session

# `kontakt` bound, as the account page's router binds it: a person erases themselves holding no
# Funktion at all, and the erasure's own log rows lose this actor to the marker before it commits.
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
    aktionen_collection: AktionenCollection,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    postausgang_collection: PostausgangCollection,
    einladungen_collection: EinladungenCollection,
    sperrliste_collection: SperrlisteCollection,
    adresswechsel_collection: AdresswechselCollection,
    berechtigungen_antraege_collection: BerechtigungenAntraegeCollection,
    sperrliste: SperrlisteLookup,
    actor: Annotated[SessionActor, Depends(verify_person_actor)],
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLErasureResponse:
    """
    Erase every record the signed-in address holds, at once and as one write, and answer how many of each kind went.

    PERSON TIER. The last live, unbarred `owner` of the administration is refused until another administrator is made one
    (`last_owner_erasure`), since nobody else could ever make an owner again; a person holding a live grant erases it with the rest
    from a passkey sign-in `ENROLMENT_WINDOW_MINUTES` old at most, as a revoke asks, else `confirmation_required`. No other
    precondition stands in front of a person's own request, a pupil in a live squad and a referee booked on a fixture still
    to be played included. Nothing is counted against the person's day.

    Removed: the pupil record and every squad row it holds, so the team reads one player fewer; the referee record,
    every fixture it was booked on moving to the one row that holds no person and keeping its own fee, and every
    confirmation it was asked for, answered or not; every registration at the address, pending or declined; another
    address's pending change naming this one as its new address, every record it would move standing at its own; every
    grant the address holds, an `owner` grant and the last two among them, every administrator being told it ended.
    Emptied: every contact seat the address holds on a team's season row and on an application of any status, the row
    and its other seats standing, an emptied seat's links on its team's open match confirmations stopping to answer.
    Every reason the person typed answering a match confirmation, from any seat they held, goes from its row and its log
    images, the answer standing. Every match report the referee record sent stands, its remarks and entries included,
    naming the row that holds no person in its place, in its log images too. Every record the person made as an
    administrator or decided as a seat holder -- a grant, a ban, an invitation, an application's or a registration's
    decision -- and every log row they wrote name a fixed marker in their place, this erasure's own rows included. The
    log images of the removed records are emptied, and every other image holding the address loses it, the people beside
    them keeping theirs.

    An address holding nothing is answered with every count zero rather than refused. The 409 answers only a database
    changed by hand, a second nameless referee meeting the ghost's name index. The 404 is published for the steps' reads by
    id, which no request can meet: every id comes from the subject read in the same snapshot. The sign-in account is not
    touched here: deleting it is the caller's, once this has answered.
    """

    async def loeschen_the_address(session: AsyncClientSession) -> FLErasureResponse:
        grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
        # A grant holder's grants go with the rest, so the erasure asks the passkey a revoke asks. A live
        # row is its own fold, so equality is the fold's judgement.
        if any(grant["adresse"] == identifier for grant in grants):
            verify_person_passkey_confirmation(actor)
        # Before any write, and for an owner alone: no other erasure can leave the administration without one.
        if holds_an_owner_grant(identifier, grants):
            # Rereads this snapshot's rows and writes each, so two owners erasing themselves at once conflict, and
            # the one retried finds itself the last.
            await pull_the_list_to_judge(berechtigungen_collection=berechtigungen_collection, session=session)
            barred = await adressen_gesperrt(sperrliste, [str(grant["adresse"]) for grant in grants], session=session)
            refuse(find_letzter_inhaber_loeschung_refusal(identifier=identifier, grants=grants, barred=barred))

        geloescht = await loeschen_everything(
            identifier,
            scope=JEDE_PERSONENGRUPPE,
            spieler_collection=spieler_collection,
            saison_spieler_collection=saison_spieler_collection,
            saison_teams_collection=saison_teams_collection,
            bewerbungen_collection=bewerbungen_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            spiele_collection=spiele_collection,
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            spielberichte_collection=spielberichte_collection,
            registrierungen_collection=registrierungen_collection,
            aktionen_collection=aktionen_collection,
            berechtigungen_collection=berechtigungen_collection,
            berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
            postausgang_collection=postausgang_collection,
            einladungen_collection=einladungen_collection,
            sperrliste_collection=sperrliste_collection,
            adresswechsel_collection=adresswechsel_collection,
            berechtigungen_antraege_collection=berechtigungen_antraege_collection,
            sperrliste=sperrliste,
            changed_by=identifier,
            key=config.sperrliste_schluessel,
            stamp=log_stamp(germany_now),
            now=germany_now,
            session=session,
        )

        return FLErasureResponse(**geloescht.model_dump())

    journal = LoeschungJournal[FLErasureResponse](
        identifier, key=config.sperrliste_schluessel, berechtigungen_collection=berechtigungen_collection
    )
    async with journal:
        async with transaction_session(db) as session:
            answer = journal.took(await session.with_transaction(loeschen_the_address))

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
    berechtigungen_collection: BerechtigungenCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
) -> FLAccountErasureViewResponse:
    """
    Answer what `POST /identitaet/konto/loeschung` would remove for the signed-in address, by kind and by name.

    Read through that erasure's own selections in one snapshot, so it names every record of the person's own the erasure
    removes or empties, an unconfirmed seat, a retired row and a declined registration among them, and no other. No address
    and no birthdate is answered. Another address's pending change naming this one is counted and not named, once its link
    has reached this mailbox: its records are not this address's until it takes effect. Reached and not named: the fixtures booking
    their referee record, which move onto the ghost, and their name in each of those fixtures' log images, which goes; the
    confirmations their referee record was asked for, which go, and its id and reason in a removed season's log images;
    the match reports their referee record sent, which stand naming the ghost, in their log images too;
    the links their contact seats were mailed on their teams' match confirmations, answered and closed ones too, which stop
    answering, and those links and their mails' delivery records in the confirmations' log images, which go; every reason
    they typed answering a match confirmation, from any seat they held, which goes from its row and its log images, the
    answer standing; what the person made or decided for others, which names a marker in their place; every
    request for a grant about their address or made by it, which goes; their rows in the
    log; every log image of a record the erasure removes, emptied whole whether or not it holds the address, and every
    other log image holding the address; each grant's announced row, and an announced row holding the address under
    another grant's id; and the address in every notice still queued, withheld. Written besides: the notice that their
    grant ended, which every administrator is sent. `verwaltung` is the tier of the live grant the address holds, or
    null; a dead spelling of the address, which admits nobody, goes with the erasure unnamed.

    `last_owner` says whether the press would be refused `last_owner_erasure` as the grants stand at this read: the address
    holds the last live `owner` grant, a barred owner counting as none. Read outside the press's transaction, it is advisory;
    the press judges again, and its answer alone decides.
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
            key=config.sperrliste_schluessel,
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
        # The press's own judgement, on this snapshot rather than the press's: two owners can still leave between them.
        grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
        # A live row is its own fold, so equality is the fold's judgement.
        own = next((grant for grant in grants if grant["adresse"] == identifier), None)
        letzter_inhaber = holds_an_owner_grant(identifier, grants) and (
            find_letzter_inhaber_loeschung_refusal(
                identifier=identifier,
                grants=grants,
                barred=await adressen_gesperrt(sperrliste, [str(grant["adresse"]) for grant in grants], session=session),
            )
            is not None
        )

    ansicht = compose_loeschung_ansicht(
        identifier,
        saison_team_rows=subject.saison_teams,
        bewerbung_rows=subject.bewerbungen,
        referee_rows=subject.schiedsrichter,
        pupil_rows=subject.spieler,
        registrierung_rows=subject.registrierungen,
        # The person's own preview counts only what reached their mailbox, which an administrator's request has not yet.
        adresswechsel_rows=known_to_the_new_mailbox(others_naming(subject.adresswechsel, identifier)),
        team_rows=team_rows,
    )

    return FLAccountErasureViewResponse(
        **ansicht.model_dump(), verwaltung=None if own is None else own["verwaltung"], last_owner=letzter_inhaber
    )
