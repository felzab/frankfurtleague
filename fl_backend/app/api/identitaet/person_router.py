from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.berechtigungen.crud import pull_the_list_to_judge, read_berechtigungen
from app.api.berechtigungen.services import lebendige
from app.api.identitaet.crud import JEDE_PERSONENGRUPPE, ErasureJournal, erase_everything, resolve_subject
from app.api.identitaet.schemas import FLErasureResponse, FLSelbstErasureAnsichtResponse
from app.api.identitaet.services import (
    build_season_team_pipeline,
    compose_erasure_ansicht,
    find_letzter_inhaber_erasure_refusal,
    holds_an_owner_grant,
)
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import aggregate_many_from_db, refuse
from app.core.db import get_drosselung_collection
from app.core.dependencies import (
    AdressankerCollection,
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
from app.core.security import (
    PERSON_ACTOR_BINDERS,
    KontaktIdentifier,
    StepUpCheck,
    get_person_confirmation_check,
    verify_access_admin,
)
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
    adressanker_collection: AdressankerCollection,
    sperrliste: SperrlisteLookup,
    refuse_unconfirmed: Annotated[StepUpCheck, Depends(get_person_confirmation_check)],
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLErasureResponse:
    """
    Erase every record the signed-in address holds, at once and as one write, and answer how many of each kind went.

    PERSON TIER. The last live, unbarred `owner` of the administration is refused until another administrator is made one
    (`REQ-PURGE-004`), since nobody else could ever make an owner again; a person holding a live grant erases it with the rest
    from a passkey sign-in `ENROLMENT_WINDOW_MINUTES` old at most, as a revoke asks, else `REQ-AUTH-009`. No other
    precondition stands in front of a person's own request, a pupil in a live squad and a referee booked on a fixture still
    to be played included. Nothing is counted against the person's day.

    Removed: the pupil record and every squad row it holds, so the team reads one player fewer; the referee record, every
    fixture it was booked on moving to the one row that holds no person and keeping its own fee; every registration at the
    address, pending or declined; another referee's or pupil's pending address change naming this address, that row itself
    standing; every grant the address holds, an `owner` grant and the last two among them, every administrator being told it
    ended; and the person's day counts. Emptied: every contact seat the address holds on a team's season row and on an
    application of any status, the row and its other seats standing. Every record the person made as an administrator or
    decided as a seat holder -- a grant, a ban, an invitation, an application's or a registration's decision -- and every
    log row they wrote name a fixed marker in their place, this erasure's own rows included. The log images of the removed
    records are emptied, and every other image holding the address loses it, the people beside them keeping theirs.

    An address holding nothing is answered with every count zero rather than refused. The 409 answers only a database
    changed by hand, a second nameless referee meeting the ghost's name index. The 404 is published for the steps' reads by
    id, which no request can meet: every id comes from the subject read in the same snapshot. The sign-in account is not
    touched here: deleting it is the caller's, once this has answered.
    """

    async def erase_the_address(session: AsyncClientSession) -> FLErasureResponse:
        grants = lebendige(await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session))
        # A grant holder's grants go with the rest, so the erasure asks the passkey a revoke asks. A live
        # row is its own fold, so equality is the fold's judgement (`docs/backend/spec.md :: I453`).
        if any(grant["adresse"] == identifier for grant in grants):
            refuse_unconfirmed()
        # Before any write, and for an owner alone: no other erasure can leave the administration without one.
        if holds_an_owner_grant(identifier, grants):
            # Rereads this snapshot's rows and writes each, so two owners erasing themselves at once conflict, and
            # the one retried finds itself the last (`docs/backend/spec.md :: I438`).
            await pull_the_list_to_judge(berechtigungen_collection=berechtigungen_collection, session=session)
            barred = await adressen_gesperrt(sperrliste, [str(grant["adresse"]) for grant in grants], session=session)
            refuse(find_letzter_inhaber_erasure_refusal(identifier=identifier, grants=grants, barred=barred))

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
            adressanker_collection=adressanker_collection,
            sperrliste=sperrliste,
            geaendert_von=identifier,
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
        async with transaction_session(db) as session:
            answer = journal.took(await session.with_transaction(erase_the_address))

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
    sperrliste: SperrlisteLookup,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
) -> FLSelbstErasureAnsichtResponse:
    """
    Answer what `POST /identitaet/selbst/erasure` would remove for the signed-in address, by kind and by name.

    Read through that erasure's own selections in one snapshot, so it names every record of the person's own the erasure
    removes or empties, an unconfirmed seat, a retired row and a declined registration among them, and no other. No address
    and no birthdate is answered. A pending address change on another address's referee or pupil row is counted and not
    named, that row not being this address's until the change is confirmed. Reached and not named: the fixtures booking
    their referee record, which move onto the ghost, and their name in each of those fixtures' log images, which goes;
    what the person made or decided for others, which names a marker in their place; their day counts; their rows in the
    log; every log image of a record the erasure removes, emptied whole whether or not it holds the address, and every
    other log image holding the address; each grant's announced row, and an announced row holding the address under
    another grant's id; and the address in every notice still queued, withheld. Written besides: the notice that their
    grant ended, which every administrator is sent. `verwaltung` is the tier of the live grant the address holds, or
    null; a dead spelling of the address, which admits nobody, goes with the erasure unnamed.

    `letzter_inhaber` says whether the press would be refused `REQ-PURGE-004` as the grants stand at this read: the address
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
            schluessel=config.sperrliste_schluessel,
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
        grants = lebendige(await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session))
        # A live row is its own fold, so equality is the fold's judgement (`docs/backend/spec.md :: I453`).
        own = next((grant for grant in grants if grant["adresse"] == identifier), None)
        letzter_inhaber = holds_an_owner_grant(identifier, grants) and (
            find_letzter_inhaber_erasure_refusal(
                identifier=identifier,
                grants=grants,
                barred=await adressen_gesperrt(sperrliste, [str(grant["adresse"]) for grant in grants], session=session),
            )
            is not None
        )

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

    return FLSelbstErasureAnsichtResponse(
        **ansicht.model_dump(), verwaltung=None if own is None else own["verwaltung"], letzter_inhaber=letzter_inhaber
    )
