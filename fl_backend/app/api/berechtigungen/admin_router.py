from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.results import InsertOneResult

from app.api.berechtigungen.crud import pull_the_list_to_judge, read_berechtigungen, read_the_announced
from app.api.berechtigungen.schemas import (
    FLBerechtigung,
    FLBerechtigungenListResponse,
    FLBerechtigungWriteResponse,
    FLBerechtigungZeile,
    FLPatchBerechtigungPayload,
    FLPostBerechtigungPayload,
    FLPostBerechtigungResponse,
)
from app.api.berechtigungen.services import (
    OWNER,
    compare,
    compose_announced,
    compose_postausgang,
    find_gesperrt_refusal,
    find_inhaber_refusal,
    find_letzter_inhaber_refusal,
    find_mindestzahl_refusal,
    find_nur_inhaber_refusal,
    find_vorhanden_refusal,
    gefunden,
    lebendige,
    lebendige_adresse,
    stand_of,
)
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, hash_gesperrt
from app.api.sperrliste.services import withheld_actor
from app.core.config import API_VERSION
from app.core.crud import delete_many_from_db, erase_many_from_db, patch_one_in_db, post_one_to_db, refuse
from app.core.dependencies import (
    BerechtigungenAngekuendigtCollection,
    BerechtigungenCollection,
    BerechtigungenPostausgangCollection,
    DBClient,
    get_germany_now,
)
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, DUPLICATE_KEY_RESPONSE
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import (
    bind_actor,
    get_actor_auth_time,
    get_actor_email,
    verify_access_admin,
    verify_actor_is_admin,
    verify_recent_confirmation,
)
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/berechtigungen",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)

# The one tier a grant is made with: `owner` is reached only by an owner's tier change.
ADMINISTRATION = "administration"


@router.get("", response_model=FLBerechtigungenListResponse, summary="List who may enter the administration")
async def get_berechtigungen(
    berechtigungen_collection: BerechtigungenCollection,
    sperrliste: SperrlisteLookup,
) -> FLBerechtigungenListResponse:
    """
    List every live grant of access to the administration, by address: its tier, who granted it and when.

    Uncapped, as few people hold one. A row whose address no request can match -- empty, unfolded or refused by the address rule --
    admits nobody and is left out, counted in `uebersprungen`. An address on the ban list is answered as `null` beside `gesperrt`,
    never in plain, and so is a barred `erteilt_von`, beside `erteilt_von_gesperrt`; it is otherwise an administrator's address
    for a grant made here and whatever the database edit wrote for one made there.
    """

    rows = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection)
    live = lebendige(rows)
    grants = [FLBerechtigung.model_validate(row) for row in live]
    barred = await adressen_gesperrt(
        sperrliste, [grant.adresse for grant in grants] + [sign_in_identifier(grant.erteilt_von) for grant in grants]
    )

    served = []
    for grant in grants:
        gesperrt = grant.adresse in barred
        erteilt_von = withheld_actor(grant.erteilt_von, barred)
        served.append(
            FLBerechtigungZeile(
                id=grant.id,
                adresse=None if gesperrt else grant.adresse,
                gesperrt=gesperrt,
                verwaltung=grant.verwaltung,
                erteilt_von=erteilt_von,
                erteilt_von_gesperrt=erteilt_von is None,
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
    dependencies=[Depends(verify_recent_confirmation)],
)
async def post_berechtigung(
    berechtigung_data: Annotated[FLPostBerechtigungPayload, Body()],
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    berechtigungen_postausgang_collection: BerechtigungenPostausgangCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    erteilt_von: str = Depends(get_actor_email),
    now: datetime = Depends(get_germany_now),
) -> FLPostBerechtigungResponse:
    """
    Grant an address access to the administration, as `administration`. No request grants `owner`; any administrator may grant.

    The address is stored folded to its sign-in identifier, the spelling every admin-tier request is judged by. Refused where a live
    grant already holds the address (`REQ-BERECHTIGUNG-001`) -- a dead row of another spelling blocks nothing -- and where the ban list
    holds it (`REQ-BERECHTIGUNG-003`). The grant takes effect on the next request, for a session signed in after it alone -- an older one is
    refused `REQ-AUTH-007` on every admin-tier route -- and its announcement is queued in the same transaction for
    `POST /berechtigungen/abgleich` to hand out. Like a revoke and a tier change, it takes a passkey sign-in or confirmation no older than
    `ENROLMENT_WINDOW_MINUTES` when the actor token was minted, refused `REQ-AUTH-009` otherwise.
    """

    adresse = sign_in_identifier(str(berechtigung_data.email))
    # Keyed from the payload's own value, as the ban write keys it (`app/api/identitaet/router.py :: get_subjekt`).
    gehasht = sperrliste.hash_of(str(berechtigung_data.email))

    async def judge_and_grant(session: AsyncClientSession) -> InsertOneResult:
        """Anchor and read the list, ask the ban list, then write the grant, its announced row and its outbox row, on one transaction."""

        grants = await pull_the_list_to_judge(berechtigungen_collection=berechtigungen_collection, session=session)
        refuse(find_vorhanden_refusal(adresse=adresse, grants=grants))

        gesperrt = await hash_gesperrt(sperrliste, gehasht, session=session)
        refuse(find_gesperrt_refusal(gesperrt=gesperrt))

        document: dict[str, Any] = {
            "adresse": adresse,
            "verwaltung": ADMINISTRATION,
            # The bound actor rather than a payload field, so the grant and its `aktionen` row name one person.
            "erteilt_von": erteilt_von,
            "erteilt_am": now,
            # Seen as it is written, so a copy of it put back after a revoke reads as an edit rather
            # than a fresh paste (`docs/backend/spec.md :: I529`).
            "gesehen_am": now,
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

    async with transaction_session(db) as session:
        post_operation = await session.with_transaction(judge_and_grant)

    return FLPostBerechtigungResponse(acknowledged=1 if post_operation.acknowledged else 0, created_id=post_operation.inserted_id)


@router.delete(
    by_id("berechtigung_id"),
    response_model=FLBerechtigungWriteResponse,
    summary="Revoke access to the administration",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
    dependencies=[Depends(verify_recent_confirmation)],
)
async def delete_berechtigung(
    berechtigung_id: CustomRouteObjectId,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    berechtigungen_postausgang_collection: BerechtigungenPostausgangCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    entzogen_von: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    now: datetime = Depends(get_germany_now),
) -> FLBerechtigungWriteResponse:
    """
    Revoke one grant, removing the row. HARD, no soft form; the revoked address meets `REQ-AUTH-006` on its next request.

    Only an `owner` revokes (`REQ-BERECHTIGUNG-005`), judged on the actor's own grant inside the transaction, and before anything
    about the target is answered; an owner's sign-in older than the moment they became one is refused the same. 404 where no grant
    has the id. Refused for an `owner` row (`REQ-BERECHTIGUNG-002`), which is made an
    administrator first, and where fewer than two live, unbarred grants would remain (`REQ-BERECHTIGUNG-004`). The removal's
    announcement is queued in the same transaction, after any change to the row made in the database and not yet announced. A sign-in
    or confirmation older than `ENROLMENT_WINDOW_MINUTES` is refused `REQ-AUTH-009`, as the grant's is.
    """

    akteur = sign_in_identifier(entzogen_von)

    async def judge_and_revoke(session: AsyncClientSession) -> None:
        """Anchor and read the list, judge the actor and the row against it, then remove the row, its announced row, and queue both notices."""

        grants = await pull_the_list_to_judge(berechtigungen_collection=berechtigungen_collection, session=session)
        records = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)
        refuse(find_nur_inhaber_refusal(akteur=akteur, auth_time=auth_time, grants=grants, announced=records))

        grant = next((row for row in grants if row["_id"] == berechtigung_id), None)
        if grant is None:
            # Resolved from the list already read rather than a second query, so a miss is a 404 before
            # anything is removed: `delete_many_from_db` taking no row would answer 200.
            raise DocumentNotFoundException(filter={"_id": berechtigung_id}, error_code=DOCUMENT_NOT_FOUND)

        refuse(find_inhaber_refusal(grant=grant))

        live = lebendige(grants)
        barred = await adressen_gesperrt(sperrliste, [str(row["adresse"]) for row in live], session=session)
        remaining = [row for row in live if row["_id"] != berechtigung_id and row["adresse"] not in barred]
        refuse(find_mindestzahl_refusal(remaining=len(remaining)))

        announced = [record for record in records if record["_id"] == berechtigung_id]
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
        # The grant keeps its image, the administrator's act; its announced row is bookkeeping and keeps
        # none (`docs/backend/spec.md :: I465`).
        await erase_many_from_db(collection=berechtigungen_angekuendigt_collection, db_filter={"_id": berechtigung_id}, session=session)

    async with transaction_session(db) as session:
        await session.with_transaction(judge_and_revoke)

    return FLBerechtigungWriteResponse(berechtigung_id=berechtigung_id)


@router.patch(
    by_id("berechtigung_id"),
    response_model=FLBerechtigungWriteResponse,
    summary="Change a grant between administrator and owner",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
    dependencies=[Depends(verify_recent_confirmation)],
)
async def patch_berechtigung(
    berechtigung_id: CustomRouteObjectId,
    berechtigung_data: Annotated[FLPatchBerechtigungPayload, Body()],
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    berechtigungen_postausgang_collection: BerechtigungenPostausgangCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    geaendert_von: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    now: datetime = Depends(get_germany_now),
) -> FLBerechtigungWriteResponse:
    """
    Make an administrator an owner, or an owner an administrator; an owner steps down by naming their own grant.

    Only an `owner` changes a tier (`REQ-BERECHTIGUNG-005`), judged on the actor's own grant inside the transaction, and before
    anything about the target is answered; an owner's sign-in older than the moment they became one is refused the same. A promotion
    holds for a sign-in after it alone: the promoted administrator's older sessions keep administering and take no owner's step until
    they sign in again. A demotion takes the tier from every session at once. 404 where no live grant has the id. A promotion of an
    address on the ban list is refused (`REQ-BERECHTIGUNG-003`), and so is a demotion leaving no live, unbarred owner
    (`REQ-BERECHTIGUNG-007`). Naming the tier the grant holds changes nothing and answers 200. The change reaches the next request; its
    announcement is queued in the same
    transaction, after any change to the row made in the database and not yet announced, and a grant found that way is stamped
    `gefunden_am` as `POST /berechtigungen/abgleich` stamps one. A sign-in or confirmation older than
    `ENROLMENT_WINDOW_MINUTES` is refused `REQ-AUTH-009`, as the grant's is.
    """

    akteur = sign_in_identifier(geaendert_von)
    verwaltung = berechtigung_data.verwaltung

    async def judge_and_change(session: AsyncClientSession) -> None:
        """Read the list, judge the actor and the row against it, then anchor and move the tier, its announced row and queue its notice."""

        grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
        records = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)
        refuse(find_nur_inhaber_refusal(akteur=akteur, auth_time=auth_time, grants=grants, announced=records))

        live = lebendige(grants)
        # A live row alone: the list serves no other, and an owner nobody can sign in as could demote nobody back.
        grant = next((row for row in live if row["_id"] == berechtigung_id), None)
        if grant is None:
            raise DocumentNotFoundException(filter={"_id": berechtigung_id}, error_code=DOCUMENT_NOT_FOUND)

        # Ahead of the anchor, so the tier already held writes nothing, not even an `aktionen` row: an
        # answer that writes nothing is a snapshot no rival can make wrong.
        if grant["verwaltung"] == verwaltung:
            return

        # Rereads this snapshot's rows and writes each, so a rival judging the list conflicts (`docs/backend/spec.md :: I438`).
        await pull_the_list_to_judge(berechtigungen_collection=berechtigungen_collection, session=session)

        barred = await adressen_gesperrt(sperrliste, [str(row["adresse"]) for row in live], session=session)
        if verwaltung == OWNER:
            refuse(find_gesperrt_refusal(gesperrt=grant["adresse"] in barred))
        else:
            owners = [row for row in live if row["verwaltung"] == OWNER and row["_id"] != berechtigung_id and row["adresse"] not in barred]
            refuse(find_letzter_inhaber_refusal(remaining_owners=len(owners)))

        announced = [record for record in records if record["_id"] == berechtigung_id]
        # A database edit to this row nobody was told of goes out first, as the revoke's does (`docs/backend/spec.md :: I451`).
        pending = compare(grants=[grant], announced=announced)
        for changed_id, art, jetzt, vorher in pending:
            await post_one_to_db(
                collection=berechtigungen_postausgang_collection,
                document=compose_postausgang(
                    berechtigung_id=changed_id, art=art, jetzt=jetzt, vorher=vorher, geaendert_von=None, now=now, gesperrt=barred
                ),
                session=session,
            )

        await patch_one_in_db(
            collection=berechtigungen_collection,
            db_filter={"_id": berechtigung_id},
            # Stamped and seen as the pass stamps and sees a grant it finds, since the announced row moved
            # below leaves the pass nothing of this grant to find (`docs/backend/spec.md :: I525`, `:: I529`).
            update={
                "$set": {
                    "verwaltung": verwaltung,
                    **({"gefunden_am": now} if gefunden(pending) else {}),
                    **({"gesehen_am": now} if grant.get("gesehen_am") is None else {}),
                    # Its owner's power dates from now, so the promoted holder's older sessions keep
                    # administering and hold none of it (`docs/backend/spec.md :: I534`).
                    **({"ernannt_am": now} if verwaltung == OWNER else {}),
                }
            },
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

        vorher = stand_of(grant)
        jetzt = vorher.model_copy(update={"verwaltung": verwaltung})
        await post_one_to_db(
            collection=berechtigungen_postausgang_collection,
            document=compose_postausgang(
                berechtigung_id=berechtigung_id,
                art="geaendert",
                jetzt=jetzt,
                vorher=vorher,
                geaendert_von=geaendert_von,
                now=now,
                gesperrt=barred,
            ),
            session=session,
        )
        # The announced row is bookkeeping, so replaced with no image (`docs/backend/spec.md :: I465`).
        await erase_many_from_db(collection=berechtigungen_angekuendigt_collection, db_filter={"_id": berechtigung_id}, session=session)
        await post_one_to_db(
            collection=berechtigungen_angekuendigt_collection,
            document=compose_announced(berechtigung_id=berechtigung_id, stand=jetzt, now=now),
            session=session,
        )

    async with transaction_session(db) as session:
        await session.with_transaction(judge_and_change)

    return FLBerechtigungWriteResponse(berechtigung_id=berechtigung_id)
