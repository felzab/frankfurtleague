from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.berechtigungen.crud import verwaltung_of
from app.api.identitaet.crud import JEDE_PERSONENGRUPPE, after_the_erasure_commits, erase_everything, resolve_subject
from app.api.identitaet.schemas import FLErasureResponse, FLSelbstErasureAnsichtResponse
from app.api.identitaet.services import build_registrierung_team_pipeline, compose_erasure_ansicht
from app.api.sperrliste.lookup import SperrlisteLookup
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import aggregate_many_from_db
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
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, DUPLICATE_KEY_RESPONSE
from app.core.recording import log_stamp
from app.core.security import PERSON_ACTOR_BINDERS, KontaktIdentifier, verify_access_admin
from app.core.transactions import transaction_session

# `kontakt` bound, as the account page's router binds it: a person erases themselves holding no
# Funktion at all, and the erasure's own log rows lose this actor to the marker before it commits.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/identitaet/selbst",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["kontakt"])],
)


@router.post(
    "/erasure",
    response_model=FLErasureResponse,
    summary="Erase every record the signed-in address holds",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
)
async def erase_selbst(
    identifier: KontaktIdentifier,
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
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLErasureResponse:
    """
    Erase every record the signed-in address holds, at once and as one write, and answer how many of each kind went.

    PERSON TIER, refusing nothing about the person: no precondition stands in front of a person's own request, a pupil in a
    live squad and a referee booked on a fixture still to be played included. Nothing is counted against the person's day.

    Removed: the pupil record and every squad row it holds, so the team reads one player fewer; the referee record, every
    fixture it was booked on moving to the one row that holds no person and keeping its own fee; every registration at the
    address, pending or declined; another referee's or pupil's pending address change naming this address, that row itself
    standing; every grant the address holds, an `owner` grant and the last two among them, every administrator being told it
    ended; and the person's day counts. Emptied: every contact seat the address holds on a team's season row and on an
    application of any status, the row and its other seats standing. The log images of those records are emptied. Every
    record the person made as an administrator or decided as a seat holder -- a grant, a ban, an invitation, an
    application's or a registration's decision -- and every log row they wrote name a fixed marker in their place, this
    erasure's own rows included.

    An address holding nothing is answered with every count zero rather than refused. The 404 and the 409 answer only a
    database changed by hand under the request. The sign-in account is not touched here: deleting it is the caller's, once
    this has answered.
    """

    async def erase_the_address(session: AsyncClientSession) -> FLErasureResponse:
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
            geaendert_von=identifier,
            schluessel=config.sperrliste_schluessel,
            stamp=log_stamp(germany_now),
            now=germany_now,
            session=session,
        )

        return FLErasureResponse(**erased.model_dump())

    async with transaction_session(db) as session:
        answer = await session.with_transaction(erase_the_address)

    await after_the_erasure_commits(
        identifier, answer, schluessel=config.sperrliste_schluessel, berechtigungen_collection=berechtigungen_collection
    )

    return answer


@router.get(
    "/erasure/ansicht",
    response_model=FLSelbstErasureAnsichtResponse,
    summary="Show what an erasure of the signed-in address would remove",
)
async def get_erasure_ansicht(
    identifier: KontaktIdentifier,
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    spieler_collection: SpielerCollection,
    registrierungen_collection: RegistrierungenCollection,
    berechtigungen_collection: BerechtigungenCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
) -> FLSelbstErasureAnsichtResponse:
    """
    Answer what `POST /identitaet/selbst/erasure` would remove for the signed-in address, by kind and by name.

    Read through that erasure's own selections, so it names every record the erasure reaches, an unconfirmed seat, a retired
    row and a declined registration among them, and no other. No address and no birthdate is answered. A pending address
    change on another address's referee row is counted and not named, that row not being this address's until the change is
    confirmed. `verwaltung` is the grant the address holds, or null.
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
            schluessel=config.sperrliste_schluessel,
            session=session,
        )
        # A registration holds its team's id alone, and the season row is what names the club that season.
        team_rows = (
            await aggregate_many_from_db(
                collection=saison_teams_collection, pipeline=build_registrierung_team_pipeline(subject.registrierungen), session=session
            )
            if subject.registrierungen
            else []
        )

    grant = await verwaltung_of(berechtigungen_collection=berechtigungen_collection, adresse=identifier)

    ansicht = compose_erasure_ansicht(
        identifier,
        saison_team_rows=subject.saison_teams,
        bewerbung_rows=subject.bewerbungen,
        referee_rows=subject.schiedsrichter,
        pupil_rows=subject.spieler,
        registrierung_rows=subject.registrierungen,
        adresswechsel_rows=[*subject.adresswechsel, *subject.spieler_adresswechsel],
        team_rows=team_rows,
    )

    return FLSelbstErasureAnsichtResponse(**ansicht.model_dump(), verwaltung=None if grant is None else grant[0])
