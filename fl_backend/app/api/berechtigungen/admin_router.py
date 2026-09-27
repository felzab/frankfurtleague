from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.results import InsertOneResult

from app.api.berechtigungen.crud import gesperrte_adressen, pull_the_list_to_judge, read_berechtigungen
from app.api.berechtigungen.schemas import (
    FLBerechtigung,
    FLBerechtigungenListResponse,
    FLBerechtigungWriteResponse,
    FLBerechtigungZeile,
    FLPostBerechtigungPayload,
    FLPostBerechtigungResponse,
)
from app.api.berechtigungen.services import (
    compare,
    compose_announced,
    compose_postausgang,
    find_gesperrt_refusal,
    find_inhaber_refusal,
    find_mindestzahl_refusal,
    find_nur_inhaber_refusal,
    find_ohne_zugang_refusal,
    find_vorhanden_refusal,
    lebendige,
    lebendige_adresse,
    stand_of,
    withheld_actor,
)
from app.api.saisons.crud import pull_massgebliche_saison_id
from app.api.sperrliste.crud import address_is_gesperrt
from app.api.sperrliste.services import adresse_hash
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import delete_many_from_db, post_one_to_db, pull_many_from_db, refuse
from app.core.dependencies import (
    BerechtigungenAngekuendigtCollection,
    BerechtigungenCollection,
    BerechtigungenPostausgangCollection,
    DBClient,
    SaisonsCollection,
    SperrlisteCollection,
    get_germany_now,
)
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, DUPLICATE_KEY_RESPONSE
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import bind_actor, get_actor_email, verify_access_admin, verify_actor_is_admin
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/berechtigungen",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)

# The one tier a request grants: `owner` is written in the database directly and nowhere here.
ADMINISTRATION = "administration"


@router.get("", response_model=FLBerechtigungenListResponse, summary="List who may enter the administration")
async def get_berechtigungen(
    berechtigungen_collection: BerechtigungenCollection,
    sperrliste_collection: SperrlisteCollection,
    saisons_collection: SaisonsCollection,
    config: Annotated[BackendConfig, Depends(get_app_config)],
) -> FLBerechtigungenListResponse:
    """
    List every live grant of access to the administration, by address: its tier, who granted it and when.

    Uncapped, as few people hold one. A row whose address no request can match -- empty, unfolded or refused by the address rule --
    admits nobody and is left out, counted in `uebersprungen`. An address on the ban list is answered as `null` beside `gesperrt`,
    never in plain, and so is a barred `erteilt_von`, which is otherwise an administrator's address for a grant made here and
    whatever the database edit wrote for one made there.
    """

    rows = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection)
    live = lebendige(rows)
    grants = [FLBerechtigung.model_validate(row) for row in live]
    barred = await gesperrte_adressen(
        [grant.adresse for grant in grants] + [sign_in_identifier(grant.erteilt_von) for grant in grants],
        sperrliste_collection=sperrliste_collection,
        saisons_collection=saisons_collection,
        schluessel=config.sperrliste_schluessel,
        session=None,
    )

    served = []
    for grant in grants:
        gesperrt = grant.adresse in barred
        served.append(
            FLBerechtigungZeile(
                id=grant.id,
                adresse=None if gesperrt else grant.adresse,
                gesperrt=gesperrt,
                verwaltung=grant.verwaltung,
                erteilt_von=withheld_actor(grant.erteilt_von, barred),
                erteilt_am=grant.erteilt_am,
            )
        )

    return FLBerechtigungenListResponse(berechtigungen=served, uebersprungen=len(rows) - len(live))


@router.post(
    "",
    response_model=FLPostBerechtigungResponse,
    status_code=201,
    summary="Grant access to the administration",
    responses={409: DUPLICATE_KEY_RESPONSE},
)
async def post_berechtigung(
    berechtigung_data: Annotated[FLPostBerechtigungPayload, Body()],
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    berechtigungen_postausgang_collection: BerechtigungenPostausgangCollection,
    sperrliste_collection: SperrlisteCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    erteilt_von: str = Depends(get_actor_email),
    now: datetime = Depends(get_germany_now),
) -> FLPostBerechtigungResponse:
    """
    Grant an address access to the administration, as `administration`. No request grants `owner`; any administrator may grant.

    The address is stored folded to its sign-in identifier, the spelling every admin-tier request is judged by. Refused where a live
    grant already holds the address (`REQ-BERECHTIGUNG-001`) -- a dead row of another spelling blocks nothing -- where the ban list
    holds it (`REQ-BERECHTIGUNG-003`), and where the acting administrator's own grant has gone by the time the write is judged
    (`REQ-BERECHTIGUNG-006`). The grant takes effect on the next request, and its announcement is queued in the same transaction for
    `POST /berechtigungen/abgleich` to hand out.
    """

    adresse = sign_in_identifier(str(berechtigung_data.email))
    akteur = sign_in_identifier(erteilt_von)
    # Keyed from the payload's own value, as the ban write keys it (`app/api/identitaet/router.py :: get_subjekt`).
    gehasht = adresse_hash(str(berechtigung_data.email), schluessel=config.sperrliste_schluessel)

    async def judge_and_grant(session: AsyncClientSession) -> InsertOneResult:
        """Anchor and read the list, ask the ban list, then write the grant, its announced row and its outbox row, on one transaction."""

        grants = await pull_the_list_to_judge(berechtigungen_collection=berechtigungen_collection, session=session)
        refuse(find_ohne_zugang_refusal(akteur=akteur, grants=grants))
        refuse(find_vorhanden_refusal(adresse=adresse, grants=grants))

        gesperrt = await address_is_gesperrt(
            sperrliste_collection=sperrliste_collection,
            adresse_hash=gehasht,
            massgebliche_saison_id=await pull_massgebliche_saison_id(saisons_collection=saisons_collection, session=session),
            session=session,
        )
        refuse(find_gesperrt_refusal(gesperrt=gesperrt))

        document: dict[str, Any] = {
            "adresse": adresse,
            "verwaltung": ADMINISTRATION,
            # The bound actor rather than a payload field, so the grant and its `aktionen` row name one person.
            "erteilt_von": erteilt_von,
            "erteilt_am": now,
        }
        created = await post_one_to_db(collection=berechtigungen_collection, document=document, session=session)

        stand = stand_of(document)
        # The announced row moves with the grant and the outbox row carries its notice, so the
        # comparison finds nothing of this write to announce twice (`docs/backend/spec.md :: I451`).
        await post_one_to_db(
            collection=berechtigungen_angekuendigt_collection,
            document=compose_announced(berechtigung_id=created.inserted_id, stand=stand, now=now),
            session=session,
        )
        await post_one_to_db(
            collection=berechtigungen_postausgang_collection,
            document=compose_postausgang(
                berechtigung_id=created.inserted_id, art="erteilt", jetzt=stand, vorher=None, geaendert_von=erteilt_von, now=now, gesperrt=()
            ),
            session=session,
        )

        return created

    async with db.start_session() as session:
        post_operation = await session.with_transaction(judge_and_grant)

    return FLPostBerechtigungResponse(acknowledged=1 if post_operation.acknowledged else 0, created_id=post_operation.inserted_id)


@router.delete(
    by_id("berechtigung_id"),
    response_model=FLBerechtigungWriteResponse,
    summary="Revoke access to the administration",
    # 409 `DB-COMMON-002` cannot occur here, and is published all the same: the trace behind it reads
    # a write by collection and never by field (`tests/core/test_duplicate_key_publication.py`).
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
)
async def delete_berechtigung(
    berechtigung_id: CustomRouteObjectId,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    berechtigungen_postausgang_collection: BerechtigungenPostausgangCollection,
    sperrliste_collection: SperrlisteCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    entzogen_von: str = Depends(get_actor_email),
    now: datetime = Depends(get_germany_now),
) -> FLBerechtigungWriteResponse:
    """
    Revoke one grant, removing the row. HARD, no soft form; the revoked address meets `REQ-AUTH-006` on its next request.

    Only an `owner` revokes (`REQ-BERECHTIGUNG-005`), judged on the actor's own grant inside the transaction, and before anything
    about the target is answered. 404 where no grant has the id. Refused for an `owner` row (`REQ-BERECHTIGUNG-002`), which is changed
    in the database directly, and where fewer than two live, unbarred grants would remain (`REQ-BERECHTIGUNG-004`). The removal's
    announcement is queued in the same transaction, after any change to the row made in the database and not yet announced.
    """

    akteur = sign_in_identifier(entzogen_von)

    async def judge_and_revoke(session: AsyncClientSession) -> None:
        """Anchor and read the list, judge the actor and the row against it, then remove the row, its announced row, and queue both notices."""

        grants = await pull_the_list_to_judge(berechtigungen_collection=berechtigungen_collection, session=session)
        refuse(find_nur_inhaber_refusal(akteur=akteur, grants=grants))

        grant = next((row for row in grants if row["_id"] == berechtigung_id), None)
        if grant is None:
            # Resolved from the list already read rather than a second query, so a miss is a 404 before
            # anything is removed: `delete_many_from_db` taking no row would answer 200.
            raise DocumentNotFoundException(filter={"_id": berechtigung_id}, error_code=DOCUMENT_NOT_FOUND)

        refuse(find_inhaber_refusal(grant=grant))

        live = lebendige(grants)
        barred = await gesperrte_adressen(
            [str(row["adresse"]) for row in live],
            sperrliste_collection=sperrliste_collection,
            saisons_collection=saisons_collection,
            schluessel=config.sperrliste_schluessel,
            session=session,
        )
        remaining = [row for row in live if row["_id"] != berechtigung_id and row["adresse"] not in barred]
        refuse(find_mindestzahl_refusal(remaining=len(remaining)))

        announced = await pull_many_from_db(
            collection=berechtigungen_angekuendigt_collection, db_filter={"_id": berechtigung_id}, limit=1, session=session
        )
        # A database edit to this row nobody was told of goes out first, as it happened, or the
        # revoke's own notice would be the only trace of it (`docs/backend/spec.md :: I451`).
        pending = compare(grants=[grant], announced=announced)
        for changed_id, art, jetzt, vorher in pending:
            await post_one_to_db(
                collection=berechtigungen_postausgang_collection,
                document=compose_postausgang(
                    berechtigung_id=changed_id, art=art, jetzt=jetzt, vorher=vorher, geaendert_von=None, now=now, gesperrt=barred
                ),
                session=session,
            )

        if lebendige_adresse(grant) is not None:
            await post_one_to_db(
                collection=berechtigungen_postausgang_collection,
                document=compose_postausgang(
                    berechtigung_id=berechtigung_id,
                    art="entzogen",
                    jetzt=None,
                    vorher=stand_of(grant),
                    geaendert_von=entzogen_von,
                    now=now,
                    gesperrt=barred,
                ),
                session=session,
            )

        await delete_many_from_db(collection=berechtigungen_collection, db_filter={"_id": berechtigung_id}, session=session)
        await delete_many_from_db(collection=berechtigungen_angekuendigt_collection, db_filter={"_id": berechtigung_id}, session=session)

    async with db.start_session() as session:
        await session.with_transaction(judge_and_revoke)

    return FLBerechtigungWriteResponse(berechtigung_id=berechtigung_id)
