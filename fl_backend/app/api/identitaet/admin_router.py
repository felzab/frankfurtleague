from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.adresswechsel.crud import others_naming
from app.api.berechtigungen.antraege import read_the_antraege_of
from app.api.berechtigungen.crud import read_berechtigungen, read_the_announced
from app.api.berechtigungen.guard import verify_actor_is_admin
from app.api.identitaet.crud import JEDE_PERSONENGRUPPE, LoeschungJournal, loeschen_everything, resolve_subject
from app.api.identitaet.schemas import (
    FLErasureAdressePayload,
    FLErasurePayload,
    FLErasureResponse,
    FLErasureViewResponse,
    FLSignOutResponse,
)
from app.api.identitaet.services import (
    JEDE_VERWALTUNG,
    NUR_INHABER,
    adresswechsel_einsehbar_verwehrt,
    build_loeschung_kader_pipeline,
    build_season_team_pipeline,
    build_unplayed_saison_pipeline,
    compose_loeschung_ansicht_auf_anfrage,
    find_eigene_adresse_refusal,
    find_fremder_adresswechsel_refusal,
    find_verwaltung_adresse_refusal,
)
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import aggregate_many_from_db, post_one_to_db, refuse
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
from app.core.recording import act_row, anlass_var, log_stamp
from app.core.security import (
    SessionActor,
    bind_actor,
    get_actor_auth_time,
    get_actor_email,
    verify_access_admin,
    verify_admin_actor,
    verify_recent_confirmation,
    verify_step_up,
)
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier
from app.shared.schemas.literals import FLAddressChangeViewableDenied

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/identity",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


@router.post(
    "/erasure/view",
    response_model=FLErasureViewResponse,
    summary="Show what an erasure of an address would remove",
)
async def get_erasure_view(
    ansicht_data: Annotated[FLErasureAdressePayload, Body()],
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    spieler_collection: SpielerCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    registrierungen_collection: RegistrierungenCollection,
    spiele_collection: SpieleCollection,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    berechtigungen_antraege_collection: BerechtigungenAntraegeCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    germany_now: datetime = Depends(get_germany_now),
) -> FLErasureViewResponse:
    """
    Answer which of this address's records `POST /identitaet/loeschung` would remove or empty, by kind, name and the ids a page links each by.

    ADMIN TIER. Takes that erasure's own payload address and reads through its own selections in one snapshot, so it names
    every one of them, an unconfirmed seat, a retired row, a pupil's every squad row and a declined registration among them,
    and no other. Another address's pending change to this address is named by its id, the change going and that address's
    records standing, beside why the address tool refuses that change this administrator, or null where it opens it; a change
    of an address holding a grant is left out for an administrator without an owner's power, as the administrators page
    withholds it, since naming it would answer whether a typed address is its new one. The address's own live change is
    named by its id, ending with the records it would move. Every request for a grant about the address (`betroffen`) or
    made by it (`gestellt`) is named by its id and the tier it asks; a lapsed one is gone to every reader already and is
    left out, though the erasure removes its row too. A squad
    row and a referee row each carry the day it was retired, null while live, and a referee row every season holding a
    fixture still to be played that it is booked on, as `schiedsrichter_still_assigned` judges one. Reached and not named: the fixtures
    booking a referee row, which move onto the ghost, and the referee's name in each of those fixtures' log images, which
    goes; the match reports a referee row sent, which stand naming the ghost, in
    their log images too; the confirmations a referee row was asked for, which go, and its id
    and reason in a removed season's log images; the links its contact seats were mailed on their teams' open match
    confirmations, which stop answering; every reason typed from the address answering a match confirmation, from any seat,
    which goes from its row and its log images, the answer standing; the grants, bans, invitations and decisions the address made for
    others, which name a marker in its place; its rows in the log; every log image of a record the
    erasure removes, emptied whole whether or not it holds the address, and every other log image holding the address;
    a dead spelling of its grant, which admits nobody, each grant's announced row, and an announced row holding the
    address under another grant's id; and the address in every notice still queued, withheld. Written besides: the
    notice that the address's grant ended, which every administrator is sent. No address and no birthdate is answered.
    `verwaltung` is the tier of the live grant the address holds, or null. `barred` is whether a standing ban holds the
    address, judged as a stored address is; the erasure leaves a ban standing. Stores nothing.

    Refused as the erasure is: the administrator's own address (`own_adresse`), an address holding a live grant unless
    the administrator holds an owner's power (`verwaltung_adresse`).
    """

    identifier = sign_in_identifier(ansicht_data.email)
    akteur = sign_in_identifier(operator)
    refuse(find_eigene_adresse_refusal(identifier=identifier, akteur=akteur))

    # A snapshot, so the reveal names the records of one moment; never a transaction, a read writing
    # nothing having no conflict to retry for.
    async with db.start_session(snapshot=True) as session:
        grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
        announced = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)
        refuse(
            find_verwaltung_adresse_refusal(
                identifier=identifier, akteur=akteur, auth_time=auth_time, grants=grants, announced=announced, geschuetzt=JEDE_VERWALTUNG
            )
        )

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
        kader_rows = (
            await aggregate_many_from_db(
                collection=saison_spieler_collection,
                pipeline=build_loeschung_kader_pipeline(row["_id"] for row in subject.spieler),
                session=session,
            )
            if subject.spieler
            else []
        )
        # A registration and a squad row hold their team's id alone, and the season row is what names the club that season.
        named = [*subject.registrierungen, *kader_rows]
        team_rows = (
            await aggregate_many_from_db(collection=saison_teams_collection, pipeline=build_season_team_pipeline(named), session=session)
            if named
            else []
        )
        unplayed_rows = (
            await aggregate_many_from_db(
                collection=spiele_collection,
                pipeline=build_unplayed_saison_pipeline(row["_id"] for row in subject.schiedsrichter),
                session=session,
            )
            if subject.schiedsrichter
            else []
        )
        # The stored-address judgement, as the Postausgang's hand-out judges a mail's address: an address no rule
        # keys a ban under answers false, where keying the payload's spelling would raise.
        gesperrt = await adressen_gesperrt(sperrliste, [ansicht_data.email], session=session)
        antrag_rows = await read_the_antraege_of(
            berechtigungen_antraege_collection=berechtigungen_antraege_collection, identifier=identifier, now=germany_now, session=session
        )

    verwehrt: dict[str, FLAddressChangeViewableDenied] = {
        str(row["adresse"]): grund
        for row in others_naming(subject.adresswechsel, identifier)
        if (
            grund := adresswechsel_einsehbar_verwehrt(
                str(row["adresse"]), akteur=akteur, auth_time=auth_time, grants=grants, announced=announced
            )
        )
        is not None
    }
    # A grant holder's change is withheld from whoever the tool refuses it, as the administrators page withholds it: named
    # here, a typed address would answer whether it is that change's new one.
    naming = [row for row in others_naming(subject.adresswechsel, identifier) if verwehrt.get(str(row["adresse"])) != "verwaltung"]
    ansicht = compose_loeschung_ansicht_auf_anfrage(
        identifier,
        saison_team_rows=subject.saison_teams,
        bewerbung_rows=subject.bewerbungen,
        referee_rows=subject.schiedsrichter,
        pupil_rows=subject.spieler,
        registrierung_rows=subject.registrierungen,
        adresswechsel_rows=naming,
        denied=verwehrt,
        own_address_change=next((row for row in subject.adresswechsel if row.get("adresse") == identifier), None),
        antrag_rows=antrag_rows,
        kader_rows=kader_rows,
        team_rows=team_rows,
        unplayed_rows=unplayed_rows,
    )
    # A live row is its own fold, so equality is the fold's judgement.
    own = next((grant for grant in grants if grant["adresse"] == identifier), None)

    return FLErasureViewResponse(**ansicht.model_dump(), verwaltung=None if own is None else own["verwaltung"], barred=bool(gesperrt))


@router.post(
    "/erasure",
    response_model=FLErasureResponse,
    summary="Erase every record an address holds, on that person's request",
    dependencies=[Depends(verify_step_up)],
)
async def post_erasure(
    loeschung_data: Annotated[FLErasurePayload, Body()],
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
    actor: Annotated[SessionActor, Depends(verify_admin_actor)],
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    germany_now: datetime = Depends(get_germany_now),
) -> FLErasureResponse:
    """
    Erase every record an address holds, on a request that person made by mail, at once and as one write, and answer how many of each kind went.

    ADMIN TIER, a step-up write. It runs the erasure `POST /identitaet/konto/loeschung` runs and refuses nothing about the
    person's own state: a pupil in a live squad and a referee booked on a fixture still to be played are erased on one pass.
    Three refusals are about who asks. The administrator's own address is refused (`own_adresse`): their account page
    serves it, or an owner. An address holding a live grant is refused unless the administrator holds an owner's power,
    signed in since becoming one (`verwaltung_adresse`), judged inside the write: erasing it removes the grant, whatever grants
    remain, so it asks what a revoke asks, an owner's power and a sign-in `ENROLMENT_WINDOW_MINUTES` old at most. Every
    other address is erased from a sign-in inside the step-up window. Either window missed answers `confirmation_required`. An
    address another address's pending change would move to is refused, judged inside the write, where that address holds a
    live grant and the administrator no owner's power (`foreign_address_change`): the erasure ends the change, a discard only an
    owner makes of it. The refusal tells that administrator some change the preview withholds names the address.

    `anlass` names the request the erasure answers, and every log row the erasure files carries it; no other row does.
    No redaction reaches it, so it is refused 422 where it holds an address. The grant notice names this administrator
    as ending the person's grant. An address holding nothing is answered with every count zero. The 404 and the 409
    answer only a database changed by hand under the request. The sign-in account is not touched here: deleting it is
    the caller's, once this has answered.
    """

    identifier = sign_in_identifier(loeschung_data.email)
    akteur = sign_in_identifier(operator)
    # Before the transaction: who asks is known from the token alone.
    refuse(find_eigene_adresse_refusal(identifier=identifier, akteur=akteur))

    async def loeschen_the_address(session: AsyncClientSession) -> FLErasureResponse:
        grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
        announced = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)
        refuse(
            find_verwaltung_adresse_refusal(
                identifier=identifier, akteur=akteur, auth_time=auth_time, grants=grants, announced=announced, geschuetzt=JEDE_VERWALTUNG
            )
        )
        # Ending a live grant asks what a revoke asks. A live row is its own fold,
        # so equality is the fold's judgement.
        if any(grant["adresse"] == identifier for grant in grants):
            verify_recent_confirmation(actor)

        # Ahead of the erasure's first write, and in its snapshot: a retry judges the changes afresh.
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
        # Ending a grant holder's change is a discard, which only an owner makes.
        refuse(
            find_fremder_adresswechsel_refusal(
                adressen=[str(row["adresse"]) for row in others_naming(subject.adresswechsel, identifier)],
                akteur=akteur,
                auth_time=auth_time,
                grants=grants,
                announced=announced,
            )
        )

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
            changed_by=operator,
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
        # Around the whole transaction, every retry inside it, and reset in a `finally`: a value left
        # standing would land on whatever this context records next.
        anlass = anlass_var.set(loeschung_data.anlass)
        try:
            async with transaction_session(db) as session:
                answer = journal.took(await session.with_transaction(loeschen_the_address))
        finally:
            anlass_var.reset(anlass)

    return answer


@router.post(
    "/sign_out",
    response_model=FLSignOutResponse,
    summary="Log the ending of every session an address holds",
    # The frontend ends the address's sessions once this answers, and nothing brings them back: unasked, a stolen
    # administrator's session could sign other administrators out again and again.
    dependencies=[Depends(verify_step_up)],
)
async def post_sign_out(
    abmeldung_data: Annotated[FLErasureAdressePayload, Body()],
    aktionen_collection: AktionenCollection,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    db: DBClient,
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
) -> FLSignOutResponse:
    """
    File one log row saying that this administrator ended every session of an address, and when, before the caller ends them.

    ADMIN TIER, a step-up write. The sessions live in the sign-in store, which the caller holds and this backend does not, so
    the row is the whole of what this writes: collection `anmeldungen`, operation `delete_many`, the administrator as actor,
    and no address, filter, image or count. Nothing bars the address and nothing is mailed; a person signs in again as before.

    Refused so that a refused call ends no session: from a sign-in older than the step-up window (`confirmation_required`), the
    administrator's own address (`own_adresse`), an address holding an `owner` grant unless the administrator holds an
    owner's power (`verwaltung_adresse`). Unlike the erasure, it
    ends another administrator's sessions for an administrator holding no owner's power: signing in again repairs it.
    """

    identifier = sign_in_identifier(abmeldung_data.email)
    akteur = sign_in_identifier(operator)
    refuse(find_eigene_adresse_refusal(identifier=identifier, akteur=akteur))

    async def log_the_act(session: AsyncClientSession) -> None:
        grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
        announced = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)
        refuse(
            find_verwaltung_adresse_refusal(
                identifier=identifier, akteur=akteur, auth_time=auth_time, grants=grants, announced=announced, geschuetzt=NUR_INHABER
            )
        )

        await post_one_to_db(collection=aktionen_collection, document=act_row("anmeldungen", operation="delete_many"), session=session)

    # In a transaction for its judge: an administrator revoked meanwhile files nothing, and `verwaltung_adresse` holds at the write.
    async with transaction_session(db) as session:
        await session.with_transaction(log_the_act)

    return FLSignOutResponse()
