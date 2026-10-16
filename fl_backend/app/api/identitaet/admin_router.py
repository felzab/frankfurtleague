from collections.abc import Callable
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.berechtigungen.crud import read_berechtigungen, read_the_announced
from app.api.berechtigungen.services import lebendige
from app.api.identitaet.crud import JEDE_PERSONENGRUPPE, ErasureJournal, erase_everything, resolve_subject
from app.api.identitaet.schemas import (
    FLAbmeldungPayload,
    FLAbmeldungResponse,
    FLErasureAnsichtPayload,
    FLErasureAnsichtResponse,
    FLErasurePayload,
    FLErasureResponse,
)
from app.api.identitaet.services import (
    build_kader_pipeline,
    build_season_team_pipeline,
    compose_erasure_ansicht_auf_anfrage,
    find_eigene_adresse_refusal,
    find_inhaber_adresse_refusal,
)
from app.api.sperrliste.lookup import SperrlisteLookup
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import aggregate_many_from_db, post_one_to_db, refuse
from app.core.db import get_drosselung_collection
from app.core.dependencies import (
    AktionenCollection,
    BerechtigungenAngekuendigtCollection,
    BerechtigungenCollection,
    BerechtigungenPostausgangCollection,
    BewerbungenCollection,
    DBClient,
    EinladungenCollection,
    RegistrierungenCollection,
    SaisonSpielerCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SperrlisteCollection,
    SpieleCollection,
    SpielerCollection,
    get_germany_now,
)
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, DUPLICATE_KEY_RESPONSE, stores_nothing
from app.core.recording import act_row, anlass_var, log_stamp
from app.core.security import (
    bind_actor,
    get_actor_auth_time,
    get_actor_email,
    get_recent_confirmation_check,
    verify_access_admin,
    verify_actor_is_admin,
    verify_step_up,
)
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/identitaet",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


@router.post(
    "/erasure/ansicht",
    response_model=FLErasureAnsichtResponse,
    summary="Show what an erasure of an address would reach",
    dependencies=[Depends(stores_nothing)],
)
async def get_erasure_ansicht_auf_anfrage(
    ansicht_data: Annotated[FLErasureAnsichtPayload, Body()],
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    spieler_collection: SpielerCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    registrierungen_collection: RegistrierungenCollection,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
) -> FLErasureAnsichtResponse:
    """
    Answer what `POST /identitaet/erasure` would reach for this address, by kind, by name and by the ids a page links each record by.

    ADMIN TIER. Takes that erasure's own payload address and reads through its own selections in one snapshot, so it names
    every record the erasure removes or empties, an unconfirmed seat, a retired row, a pupil's every squad row and a declined
    registration among them, and no other. Another address's referee or pupil row holding a pending change to this address is
    named by its id, the change going and the row standing. No address and no birthdate is answered. `verwaltung` is the
    tier of the live grant the address holds, or null. Stores nothing.

    Refused as the erasure is: the administrator's own address (`REQ-PURGE-003`), an address holding an `owner` grant unless
    the administrator holds an owner's power (`REQ-PURGE-005`), and with a 422 before any read, an address under the reserved
    `invalid` domain, where every referee row stored without an address shares one placeholder.
    """

    identifier = sign_in_identifier(ansicht_data.email)
    akteur = sign_in_identifier(operator)
    refuse(find_eigene_adresse_refusal(identifier=identifier, akteur=akteur))

    # A snapshot, so the reveal names the records of one moment; never a transaction, a read writing
    # nothing having no conflict to retry for.
    async with db.start_session(snapshot=True) as session:
        grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
        announced = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)
        refuse(find_inhaber_adresse_refusal(identifier=identifier, akteur=akteur, auth_time=auth_time, grants=grants, announced=announced))

        subject = await resolve_subject(
            identifier,
            saison_teams_collection=saison_teams_collection,
            bewerbungen_collection=bewerbungen_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            spieler_collection=spieler_collection,
            registrierungen_collection=registrierungen_collection,
            schluessel=config.sperrliste_schluessel,
            session=session,
        )
        kader_rows = (
            await aggregate_many_from_db(
                collection=saison_spieler_collection, pipeline=build_kader_pipeline(row["_id"] for row in subject.spieler), session=session
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

    ansicht = compose_erasure_ansicht_auf_anfrage(
        identifier,
        saison_team_rows=subject.saison_teams,
        bewerbung_rows=subject.bewerbungen,
        referee_rows=subject.schiedsrichter,
        pupil_rows=subject.spieler,
        registrierung_rows=subject.registrierungen,
        adresswechsel_rows=subject.adresswechsel,
        spieler_adresswechsel_rows=subject.spieler_adresswechsel,
        kader_rows=kader_rows,
        team_rows=team_rows,
    )
    # A live row is its own fold, so equality is the fold's judgement (`docs/backend/spec.md :: I453`).
    own = next((grant for grant in lebendige(grants) if grant["adresse"] == identifier), None)

    return FLErasureAnsichtResponse(**ansicht.model_dump(), verwaltung=None if own is None else own["verwaltung"])


@router.post(
    "/erasure",
    response_model=FLErasureResponse,
    summary="Erase every record an address holds, on that person's request",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
    dependencies=[Depends(verify_step_up)],
)
async def erase_auf_anfrage(
    erasure_data: Annotated[FLErasurePayload, Body()],
    spieler_collection: SpielerCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    registrierungen_collection: RegistrierungenCollection,
    drosselung_collection: Annotated[AsyncCollection, Depends(get_drosselung_collection)],
    aktionen_collection: AktionenCollection,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    berechtigungen_postausgang_collection: BerechtigungenPostausgangCollection,
    einladungen_collection: EinladungenCollection,
    sperrliste_collection: SperrlisteCollection,
    sperrliste: SperrlisteLookup,
    refuse_unconfirmed: Annotated[Callable[[], None], Depends(get_recent_confirmation_check)],
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    germany_now: datetime = Depends(get_germany_now),
) -> FLErasureResponse:
    """
    Erase every record an address holds, on a request that person made by mail, at once and as one write, and answer how many of each kind went.

    ADMIN TIER, a step-up write. It runs the erasure `POST /identitaet/selbst/erasure` runs and refuses nothing about the
    person's own state: a pupil in a live squad and a referee booked on a fixture still to be played are erased on one pass.
    Two refusals are about who asks. The administrator's own address is refused (`REQ-PURGE-003`): their account page
    serves it, or another administrator. An address holding a live `owner` grant is refused unless the administrator holds
    an owner's power, signed in since becoming one (`REQ-PURGE-005`), judged inside the write. Erasing another
    administrator's address removes their grant, whatever grants remain, and asks what a revoke asks: an address holding a live
    grant is erased from a sign-in `ENROLMENT_WINDOW_MINUTES` old at most, every other from one inside the step-up window,
    else `REQ-AUTH-009`. An address under the reserved `invalid` domain is refused 422 before any read: every referee row
    stored without an address shares one placeholder there.

    `anlass` names the request the erasure answers, and every log row the erasure files carries it; no other row does. The
    grant notice names this administrator as ending the person's grant. An address holding nothing is answered with every
    count zero. The 404 and the 409 answer only a database changed by hand under the request. The sign-in account is not
    touched here: deleting it is the caller's, once this has answered.
    """

    identifier = sign_in_identifier(erasure_data.email)
    akteur = sign_in_identifier(operator)
    # Before the transaction: who asks is known from the token alone.
    refuse(find_eigene_adresse_refusal(identifier=identifier, akteur=akteur))

    async def erase_the_address(session: AsyncClientSession) -> FLErasureResponse:
        grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
        announced = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)
        refuse(find_inhaber_adresse_refusal(identifier=identifier, akteur=akteur, auth_time=auth_time, grants=grants, announced=announced))
        # Ending a live grant asks what a revoke asks (`docs/backend/spec.md :: I489`). A live row is its own fold,
        # so equality is the fold's judgement (`:: I453`).
        if any(grant["adresse"] == identifier for grant in lebendige(grants)):
            refuse_unconfirmed()

        erased = await erase_everything(
            identifier,
            scope=JEDE_PERSONENGRUPPE,
            spieler_collection=spieler_collection,
            saison_spieler_collection=saison_spieler_collection,
            saison_teams_collection=saison_teams_collection,
            bewerbungen_collection=bewerbungen_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            spiele_collection=spiele_collection,
            registrierungen_collection=registrierungen_collection,
            drosselung_collection=drosselung_collection,
            aktionen_collection=aktionen_collection,
            berechtigungen_collection=berechtigungen_collection,
            berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
            berechtigungen_postausgang_collection=berechtigungen_postausgang_collection,
            einladungen_collection=einladungen_collection,
            sperrliste_collection=sperrliste_collection,
            sperrliste=sperrliste,
            geaendert_von=operator,
            schluessel=config.sperrliste_schluessel,
            stamp=log_stamp(germany_now),
            now=germany_now,
            session=session,
        )

        return FLErasureResponse(**erased.model_dump())

    journal = ErasureJournal[FLErasureResponse](
        identifier, schluessel=config.sperrliste_schluessel, berechtigungen_collection=berechtigungen_collection
    )
    async with journal:
        # Around the whole transaction, every retry inside it, and reset in a `finally`: a value left
        # standing would land on whatever this context records next.
        anlass = anlass_var.set(erasure_data.anlass)
        try:
            async with transaction_session(db) as session:
                answer = journal.took(await session.with_transaction(erase_the_address))
        finally:
            anlass_var.reset(anlass)

    return answer


@router.post("/abmeldung", response_model=FLAbmeldungResponse, summary="Log the ending of every session an address holds")
async def post_abmeldung(
    abmeldung_data: Annotated[FLAbmeldungPayload, Body()],
    aktionen_collection: AktionenCollection,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    db: DBClient,
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
) -> FLAbmeldungResponse:
    """
    File one log row saying that this administrator ended every session of an address, and when, before the caller ends them.

    ADMIN TIER. The sessions live in the sign-in store, which the caller holds and this backend does not, so the row is the
    whole of what this writes: collection `anmeldungen`, operation `delete_many`, the administrator as actor, and no address,
    filter, image or count. Nothing bars the address and nothing is mailed; a person signs in again as before.

    Refused as the erasure is, so a refused call ends no session: the administrator's own address (`REQ-PURGE-003`), an
    address holding an `owner` grant unless the administrator holds an owner's power (`REQ-PURGE-005`), and with a 422 an
    address under the reserved `invalid` domain.
    """

    identifier = sign_in_identifier(abmeldung_data.email)
    akteur = sign_in_identifier(operator)
    refuse(find_eigene_adresse_refusal(identifier=identifier, akteur=akteur))

    async def log_the_act(session: AsyncClientSession) -> None:
        grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
        announced = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)
        refuse(find_inhaber_adresse_refusal(identifier=identifier, akteur=akteur, auth_time=auth_time, grants=grants, announced=announced))

        await post_one_to_db(collection=aktionen_collection, document=act_row("anmeldungen", operation="delete_many"), session=session)

    # In a transaction for its judge: an administrator revoked meanwhile files nothing, and `REQ-PURGE-005` holds at the write.
    async with transaction_session(db) as session:
        await session.with_transaction(log_the_act)

    return FLAbmeldungResponse()
