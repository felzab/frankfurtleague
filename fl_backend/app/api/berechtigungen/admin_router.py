from collections.abc import Mapping, Sequence, Set
from datetime import datetime
from typing import Annotated, Any

from bson import ObjectId
from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.adresswechsel.services import build_awaiting_genehmigung_filter
from app.api.berechtigungen.antraege import (
    antrag_line,
    antrag_steht,
    clear_the_address_in_session,
    compose_antrag,
    find_antrag_verfallen_refusal,
    find_genehmigung_verwehrt_refusal,
    pull_the_antrag,
    read_the_antraege,
    remove_the_antrag_in_session,
)
from app.api.berechtigungen.crud import (
    grant_in_session,
    owe_in_session,
    pull_the_list_to_judge,
    read_berechtigungen,
    read_the_announced,
    revoke_in_session,
)
from app.api.berechtigungen.guard import verify_actor_is_admin
from app.api.berechtigungen.schemas import (
    FLBerechtigung,
    FLBerechtigungAdresswechsel,
    FLBerechtigungAntragAbgelehntResponse,
    FLBerechtigungAntragZeile,
    FLBerechtigungenListResponse,
    FLBerechtigungStand,
    FLBerechtigungStufeResponse,
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
    compose_mitteilung,
    find_gesperrt_refusal,
    find_inhaber_refusal,
    find_letzter_inhaber_refusal,
    find_mindestzahl_refusal,
    find_nur_inhaber_refusal,
    find_vorhanden_refusal,
    gefunden,
    genehmiger_of,
    genehmigung_verwehrt,
    holds_an_owners_power,
    stand_of,
)
from app.api.identitaet.services import adresswechsel_einsehbar_verwehrt
from app.api.postausgang.schemas import FLPostausgangBezug
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, hash_gesperrt
from app.api.sperrliste.services import withheld_actor
from app.core.collections import Collection
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import VERSION_FIELD, aggregate_many_from_db, loeschen_many_from_db, patch_one_in_db, post_one_to_db, refuse
from app.core.dependencies import (
    AdresswechselCollection,
    BerechtigungenAngekuendigtCollection,
    BerechtigungenAntraegeCollection,
    BerechtigungenCollection,
    DBClient,
    PostausgangCollection,
    get_germany_now,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.journal import Journal
from app.core.recording import log_stamp
from app.core.routing import by_id
from app.core.security import bind_actor, get_actor_auth_time, get_actor_email, verify_access_admin, verify_recent_confirmation, verify_step_up
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
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    adresswechsel_collection: AdresswechselCollection,
    berechtigungen_antraege_collection: BerechtigungenAntraegeCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    now: datetime = Depends(get_germany_now),
) -> FLBerechtigungenListResponse:
    """
    List every grant of access to the administration, by address: its tier, who granted it and when.

    Uncapped, as few people hold one. An address on the ban list is answered as `null` beside `gesperrt`,
    never in plain, and so is a barred `erteilt_von`, beside `erteilt_von_gesperrt`; it is otherwise an administrator's address
    for a grant made here and whatever the database edit wrote for one made there.

    `adresswechsel` names the change of a grant's address waiting on an administrator's approval: its new address, how it was
    started (`weg`), the administrator who started it and the reason they recorded, and why this administrator may not approve
    it, where they may not: their own, one they started, or an owner's without an owner's power
    (`POST /adresswechsel/{adresswechsel_id}/genehmigung`); and why the address tool refuses it them (`einsehbar_verwehrt`). An
    owner's change withholds its new address, starter and reason from that non-owner, as the address tool refuses them an
    owner's address; a barred new address or starter is withheld as on a grant's row. A change any step of which lapsed is
    left out: its approval is refused, and the next hourly pass ends it.

    `antraege` lists every grant and promotion waiting on a second administrator's approval and not yet lapsed, oldest first:
    the address, the tier asked, who asked and when, until when it waits, whether its requester still holds that tier since
    before it (`steht`), and why this administrator may not approve it, where they may not. A barred address is withheld as on a
    grant's row.
    """

    akteur = sign_in_identifier(operator)
    # A snapshot, so the grants, their records and the changes waiting on an approval are read as of one moment.
    async with db.start_session(snapshot=True) as session:
        rows = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
        announced = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)
        antraege = await read_the_antraege(berechtigungen_antraege_collection=berechtigungen_antraege_collection, now=now, session=session)
        grants = [FLBerechtigung.model_validate(row) for row in rows]
        barred = await adressen_gesperrt(
            sperrliste,
            [grant.adresse for grant in grants]
            + [sign_in_identifier(grant.erteilt_von) for grant in grants]
            + [str(antrag["adresse"]) for antrag in antraege]
            + [str(antrag["genehmigung"]["gestartet_von"]) for antrag in antraege],
            session=session,
        )
        wartend = {
            record["adresse"]: record
            for record in await aggregate_many_from_db(
                collection=adresswechsel_collection,
                pipeline=[
                    {"$match": build_awaiting_genehmigung_filter([grant.adresse for grant in grants if grant.adresse not in barred], now=now)}
                ],
                session=session,
            )
        }
        # A pending new address and an administrator's start are judged as every address the page serves is.
        barred_im_wechsel = await adressen_gesperrt(
            sperrliste,
            [str(record["email"]) for record in wartend.values()]
            + [str(record["genehmigung"]["gestartet_von"]) for record in wartend.values()],
            session=session,
        )
    inhaber = holds_an_owners_power(akteur=akteur, auth_time=auth_time, grants=rows, announced=announced)

    served = []
    for grant in grants:
        gesperrt = grant.adresse in barred
        erteilt_von = withheld_actor(grant.erteilt_von, barred)
        record = None if gesperrt else wartend.get(grant.adresse)
        served.append(
            FLBerechtigungZeile(
                id=grant.id,
                adresse=None if gesperrt else grant.adresse,
                gesperrt=gesperrt,
                verwaltung=grant.verwaltung,
                erteilt_von=erteilt_von,
                erteilt_von_gesperrt=erteilt_von is None,
                erteilt_am=grant.erteilt_am,
                adresswechsel=None
                if record is None
                else _adresswechsel_zeile(
                    record, akteur=akteur, auth_time=auth_time, inhaber=inhaber, grants=rows, announced=announced, barred=barred_im_wechsel
                ),
                version=grant.version,
            )
        )

    return FLBerechtigungenListResponse(
        berechtigungen=served,
        antraege=[
            _antrag_zeile(antrag, akteur=akteur, inhaber=inhaber, grants=rows, announced=announced, barred=barred) for antrag in antraege
        ],
    )


def _adresswechsel_zeile(
    record: Mapping[str, Any],
    *,
    akteur: str,
    auth_time: int,
    inhaber: bool,
    grants: Sequence[Mapping[str, Any]],
    announced: Sequence[Mapping[str, Any]],
    barred: Set[str],
) -> FLBerechtigungAdresswechsel:
    genehmigung, weg = record["genehmigung"], record["weg"]
    verwehrt = genehmigung_verwehrt(
        betroffen=record["adresse"], genehmigung=genehmigung, akteur=akteur, inhaber=inhaber, grants=grants, announced=announced
    )
    # `verwaltung_adresse`'s reach: the tool refuses a non-owner an owner's address, so this row tells them no more of it.
    withheld = verwehrt == "inhaber"
    email = str(record["email"])
    # On the person's own start the starter is the address on file, the row's own.
    von = None if weg == "konto" else str(genehmigung["gestartet_von"])

    return FLBerechtigungAdresswechsel(
        id=record["_id"],
        email=None if withheld or email in barred else email,
        email_gesperrt=email in barred,
        weg=weg,
        gestartet_von=None if withheld else withheld_actor(von, barred),
        gestartet_von_gesperrt=von is not None and withheld_actor(von, barred) is None,
        grund=None if withheld else record.get("grund"),
        bestaetigt=record.get("bestaetigt_am") is not None,
        bis=genehmigung["bis"],
        verwehrt=verwehrt,
        einsehbar_verwehrt=adresswechsel_einsehbar_verwehrt(
            record["adresse"], akteur=akteur, auth_time=auth_time, grants=grants, announced=announced
        ),
    )


def _antrag_zeile(
    antrag: Mapping[str, Any],
    *,
    akteur: str,
    inhaber: bool,
    grants: Sequence[Mapping[str, Any]],
    announced: Sequence[Mapping[str, Any]],
    barred: Set[str],
) -> FLBerechtigungAntragZeile:
    adresse, genehmigung = str(antrag["adresse"]), antrag["genehmigung"]
    von = withheld_actor(str(genehmigung["gestartet_von"]), barred)

    return FLBerechtigungAntragZeile(
        id=antrag["_id"],
        adresse=None if adresse in barred else adresse,
        gesperrt=adresse in barred,
        berechtigung_id=antrag["berechtigung_id"],
        verwaltung=genehmigung["verwaltung"],
        gestartet_von=von,
        gestartet_von_gesperrt=von is None,
        angefragt_am=genehmigung["angefragt_am"],
        bis=genehmigung["bis"],
        steht=antrag_steht(antrag, grants=grants, announced=announced, gesperrt=barred),
        verwehrt=genehmigung_verwehrt(
            betroffen=adresse, genehmigung=genehmigung, akteur=akteur, inhaber=inhaber, grants=grants, announced=announced
        ),
    )


@router.post(
    "",
    response_model=FLPostBerechtigungResponse,
    status_code=201,
    summary="Grant access to the administration",
    dependencies=[Depends(verify_recent_confirmation)],
)
async def post_berechtigung(
    berechtigung_data: Annotated[FLPostBerechtigungPayload, Body()],
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    postausgang_collection: PostausgangCollection,
    berechtigungen_antraege_collection: BerechtigungenAntraegeCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    erteilt_von: str = Depends(get_actor_email),
    now: datetime = Depends(get_germany_now),
) -> FLPostBerechtigungResponse:
    """
    Grant an address access to the administration, as `administration`, or ask another administrator to. No request grants `owner`.

    **Four eyes**: where another administrator could approve it -- a live, unbarred grant in effect now, neither this administrator
    nor the address -- the grant is not made: a request is, answered with `beantragt` set and its id, and the grant takes effect
    only on that approval (`POST /berechtigungen/antraege/{antrag_id}/genehmigung`). A lone administrator grants alone.

    The address is stored folded to its sign-in identifier, the spelling every admin-tier request is judged by. Refused where a live
    grant already holds the address (`berechtigung_vorhanden`), where the ban list
    holds it (`berechtigung_gesperrt`), and where a request about it waits already (`berechtigung_antrag_offen`). The grant takes effect on
    the next request, for a session signed in after it alone -- an older one is refused `session_refused` on every admin-tier route -- and
    its announcement is owed to every administrator in the same transaction. Like a revoke and a tier
    change, it takes a passkey sign-in or confirmation no older than `ENROLMENT_WINDOW_MINUTES`, refused `confirmation_required` otherwise.
    """

    adresse = sign_in_identifier(str(berechtigung_data.email))
    akteur = sign_in_identifier(erteilt_von)
    # Keyed from the payload's own value, as the ban write keys it (`app/api/identitaet/system_router.py :: get_subjekt`).
    gehasht = sperrliste.hash_of(str(berechtigung_data.email))

    async def judge_and_grant(session: AsyncClientSession) -> tuple[ObjectId, bool]:
        """Anchor and read the list, ask the ban list, then write the request, or the grant and its announced row, owing its notice."""

        grants = await pull_the_list_to_judge(berechtigungen_collection=berechtigungen_collection, session=session)
        refuse(find_vorhanden_refusal(adresse=adresse, grants=grants))

        gesperrt = await hash_gesperrt(sperrliste, gehasht, session=session)
        refuse(find_gesperrt_refusal(gesperrt=gesperrt))

        await clear_the_address_in_session(
            berechtigungen_antraege_collection=berechtigungen_antraege_collection, adresse=adresse, now=now, session=session
        )
        if genehmiger := await _genehmiger(
            ADMINISTRATION,
            ausgenommen={adresse, akteur},
            grants=grants,
            berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
            sperrliste=sperrliste,
            now=now,
            session=session,
        ):
            created = await post_one_to_db(
                collection=berechtigungen_antraege_collection,
                document=compose_antrag(adresse=adresse, verwaltung=ADMINISTRATION, berechtigung_id=None, gestartet_von=akteur, now=now),
                session=session,
            )
            await _queue_the_request(
                created.inserted_id,
                adresse=adresse,
                verwaltung=ADMINISTRATION,
                gestartet_von=erteilt_von,
                genehmiger=genehmiger,
                berechtigungen_collection=berechtigungen_collection,
                postausgang_collection=postausgang_collection,
                now=now,
                session=session,
            )

            return created.inserted_id, True

        created_id = await grant_in_session(
            adresse=adresse,
            verwaltung=ADMINISTRATION,
            erteilt_von=erteilt_von,
            gesperrt=frozenset(),
            berechtigungen_collection=berechtigungen_collection,
            berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
            postausgang_collection=postausgang_collection,
            now=now,
            session=session,
        )

        return created_id, False

    async with transaction_session(db) as session:
        created_id, beantragt = await session.with_transaction(judge_and_grant)

    return FLPostBerechtigungResponse(created_id=created_id, beantragt=beantragt)


async def _queue_the_request(
    antrag_id: ObjectId,
    *,
    adresse: str,
    verwaltung: str,
    gestartet_von: str,
    genehmiger: Sequence[str],
    berechtigungen_collection: AsyncCollection,
    postausgang_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Owe the request to whoever could approve it now, about the request itself, so its decision settles what is still unsent."""

    await owe_in_session(
        [
            compose_mitteilung(
                berechtigung_id=antrag_id,
                art="beantragt",
                jetzt=FLBerechtigungStand.model_validate({"adresse": adresse, "verwaltung": verwaltung}),
                vorher=None,
                geaendert_von=gestartet_von,
                now=now,
                # Neither address is barred: the request's own write refused a barred one, and a barred actor writes nothing.
                gesperrt=frozenset(),
            )
        ],
        postausgang_collection=postausgang_collection,
        berechtigungen_collection=berechtigungen_collection,
        now=now,
        session=session,
        an=genehmiger,
        bezug=FLPostausgangBezug(sammlung=Collection.BERECHTIGUNGEN_ANTRAEGE, id=antrag_id, sitz=None),
    )


async def _genehmiger(
    verwaltung: str,
    *,
    ausgenommen: Set[str],
    grants: Sequence[Mapping[str, Any]],
    berechtigungen_angekuendigt_collection: AsyncCollection,
    sperrliste: SperrlisteLookup,
    now: datetime,
    session: AsyncClientSession,
) -> list[str]:
    """Everybody but `ausgenommen` who could approve an act on a grant of `verwaltung` asked now.

    Judged on the grants the caller anchored, so a grant or a revoke beside it conflicts.
    """

    announced = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)
    barred = await adressen_gesperrt(sperrliste, [str(row["adresse"]) for row in grants], session=session)

    return genehmiger_of(verwaltung=verwaltung, ausgenommen=ausgenommen, grants=grants, announced=announced, gesperrt=barred, vor=now)


@router.delete(
    by_id("berechtigung_id"),
    response_model=FLBerechtigungWriteResponse,
    summary="Revoke access to the administration",
    dependencies=[Depends(verify_recent_confirmation)],
)
async def delete_berechtigung(
    berechtigung_id: CustomRouteObjectId,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    postausgang_collection: PostausgangCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    entzogen_von: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    now: datetime = Depends(get_germany_now),
) -> FLBerechtigungWriteResponse:
    """
    Revoke one grant, removing the row. HARD, no soft form; the revoked address meets `actor_not_admin` on its next request.

    Only an `owner` revokes (`berechtigung_nur_inhaber`), judged on the actor's own grant inside the transaction, and before anything
    about the target is answered; an owner's sign-in older than the moment they became one is refused the same. 404 where no grant
    has the id. Refused for an `owner` row (`berechtigung_inhaber`), which is made an
    administrator first, and where fewer than two live, unbarred grants would remain (`berechtigung_mindestzahl`). The removal's
    announcement is queued in the same transaction, after any change to the row made in the database and not yet announced. A sign-in
    or confirmation older than `ENROLMENT_WINDOW_MINUTES` is refused `confirmation_required`, as the grant's is.
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
            raise DocumentNotFoundError()

        refuse(find_inhaber_refusal(grant=grant))

        live = grants
        barred = await adressen_gesperrt(sperrliste, [str(row["adresse"]) for row in live], session=session)
        remaining = [row for row in live if row["_id"] != berechtigung_id and row["adresse"] not in barred]
        refuse(find_mindestzahl_refusal(remaining=len(remaining)))

        await revoke_in_session(
            grant=grant,
            announced=[record for record in records if record["_id"] == berechtigung_id],
            entzogen_von=entzogen_von,
            gesperrt=barred,
            berechtigungen_collection=berechtigungen_collection,
            berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
            postausgang_collection=postausgang_collection,
            now=now,
            session=session,
        )

    async with transaction_session(db) as session:
        await session.with_transaction(judge_and_revoke)

    return FLBerechtigungWriteResponse(berechtigung_id=berechtigung_id)


@router.patch(
    by_id("berechtigung_id"),
    response_model=FLBerechtigungStufeResponse,
    summary="Change a grant between administrator and owner",
    dependencies=[Depends(verify_recent_confirmation)],
)
async def patch_berechtigung(
    berechtigung_id: CustomRouteObjectId,
    berechtigung_data: Annotated[FLPatchBerechtigungPayload, Body()],
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    postausgang_collection: PostausgangCollection,
    berechtigungen_antraege_collection: BerechtigungenAntraegeCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    geaendert_von: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    now: datetime = Depends(get_germany_now),
) -> FLBerechtigungStufeResponse:
    """
    Make an administrator an owner, or an owner an administrator; an owner steps down by naming their own grant.

    Only an `owner` changes a tier (`berechtigung_nur_inhaber`), judged on the actor's own grant inside the transaction, and before
    anything about the target is answered; an owner's sign-in older than the moment they became one is refused the same.

    **Four eyes on a promotion**: where another owner could approve it -- a live, unbarred `owner` grant in effect now, neither this
    owner nor the promoted address -- the tier is not moved: a request is, answered with `beantragt` set, and the promotion takes
    effect only on that approval (`POST /berechtigungen/antraege/{antrag_id}/genehmigung`). A lone owner promotes alone. A demotion
    and a step-down take effect at once.

    A promotion holds for a sign-in after it alone: the promoted administrator's older sessions keep administering and take no owner's
    step until they sign in again. A demotion takes the tier from every session at once. 404 where no live grant has the id. A
    promotion of an address on the ban list is refused (`berechtigung_gesperrt`), one whose request waits already
    (`berechtigung_antrag_offen`), and a demotion leaving no live, unbarred owner (`berechtigung_letzter_inhaber`). Naming the tier the grant
    holds changes nothing and answers 200. The change reaches the next request; its announcement is queued in the same transaction, after
    any change to the row made in the database and not yet announced, and a grant found that way is stamped `gefunden_am` as
    `POST /berechtigungen/abgleich` stamps one. A sign-in or confirmation older than `ENROLMENT_WINDOW_MINUTES` is refused
    `confirmation_required`, as the grant's is.
    """

    akteur = sign_in_identifier(geaendert_von)
    verwaltung = berechtigung_data.verwaltung

    async def judge_and_change(session: AsyncClientSession) -> bool:
        """Read the list, judge the actor and the row against it, then anchor and ask for the promotion, or move the tier."""

        grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
        records = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)
        refuse(find_nur_inhaber_refusal(akteur=akteur, auth_time=auth_time, grants=grants, announced=records))

        live = grants
        # A live row alone: the list serves no other, and an owner nobody can sign in as could demote nobody back.
        grant = next((row for row in live if row["_id"] == berechtigung_id), None)
        if grant is None:
            raise DocumentNotFoundError()

        # Ahead of the anchor, so the tier already held writes nothing, not even an `aktionen` row: an
        # answer that writes nothing is a snapshot no rival can make wrong.
        if grant["verwaltung"] == verwaltung:
            return False

        # Rereads this snapshot's rows and writes each, so a rival judging the list conflicts.
        await pull_the_list_to_judge(berechtigungen_collection=berechtigungen_collection, session=session)

        barred = await adressen_gesperrt(sperrliste, [str(row["adresse"]) for row in live], session=session)
        if verwaltung == OWNER:
            refuse(find_gesperrt_refusal(gesperrt=grant["adresse"] in barred))
            await clear_the_address_in_session(
                berechtigungen_antraege_collection=berechtigungen_antraege_collection, adresse=str(grant["adresse"]), now=now, session=session
            )
            if genehmiger := await _genehmiger(
                OWNER,
                ausgenommen={str(grant["adresse"]), akteur},
                grants=grants,
                berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
                sperrliste=sperrliste,
                now=now,
                session=session,
            ):
                created = await post_one_to_db(
                    collection=berechtigungen_antraege_collection,
                    document=compose_antrag(
                        adresse=str(grant["adresse"]), verwaltung=OWNER, berechtigung_id=berechtigung_id, gestartet_von=akteur, now=now
                    ),
                    session=session,
                )
                await _queue_the_request(
                    created.inserted_id,
                    adresse=str(grant["adresse"]),
                    verwaltung=OWNER,
                    gestartet_von=geaendert_von,
                    genehmiger=genehmiger,
                    berechtigungen_collection=berechtigungen_collection,
                    postausgang_collection=postausgang_collection,
                    now=now,
                    session=session,
                )
                return True
        else:
            owners = [row for row in live if row["verwaltung"] == OWNER and row["_id"] != berechtigung_id and row["adresse"] not in barred]
            refuse(find_letzter_inhaber_refusal(remaining_owners=len(owners)))

        await _move_the_tier_in_session(
            grant,
            verwaltung=verwaltung,
            version=berechtigung_data.version,
            records=records,
            barred=barred,
            geaendert_von=geaendert_von,
            berechtigungen_collection=berechtigungen_collection,
            berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
            postausgang_collection=postausgang_collection,
            now=now,
            session=session,
        )

        return False

    async with transaction_session(db) as session:
        beantragt = await session.with_transaction(judge_and_change)

    return FLBerechtigungStufeResponse(berechtigung_id=berechtigung_id, beantragt=beantragt)


async def _move_the_tier_in_session(
    grant: Mapping[str, Any],
    *,
    verwaltung: str,
    # Required, so no caller forgets the form's version: the payload's, or `None` where no form was read.
    version: int | None,
    records: Sequence[Mapping[str, Any]],
    barred: Set[str],
    geaendert_von: str,
    berechtigungen_collection: AsyncCollection,
    berechtigungen_angekuendigt_collection: AsyncCollection,
    postausgang_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Move one live grant's tier, its announced row and its notice, as the tier change and a promotion's approval both do."""

    berechtigung_id = grant["_id"]
    announced = [record for record in records if record["_id"] == berechtigung_id]
    # A database edit to this row nobody was told of goes out first, as the revoke's does.
    pending = compare(grants=[grant], announced=announced)

    await patch_one_in_db(
        collection=berechtigungen_collection,
        db_filter={"_id": berechtigung_id},
        # Stamped and seen as the pass stamps and sees a grant it finds, since the announced row moved
        # below leaves the pass nothing of this grant to find.
        update={
            "$set": {
                "verwaltung": verwaltung,
                **({"gefunden_am": now} if gefunden(pending) else {}),
                **({"gesehen_am": now} if grant.get("gesehen_am") is None else {}),
                # Its owner's power dates from now, so the promoted holder's older sessions keep
                # administering and hold none of it.
                **({"ernannt_am": now} if verwaltung == OWNER else {}),
                # Taken into the filter by the helper: a tier change opened before another write is refused.
                VERSION_FIELD: version,
            }
        },
        session=session,
        return_document=ReturnDocument.BEFORE,
    )

    vorher = stand_of(grant)
    jetzt = vorher.model_copy(update={"verwaltung": verwaltung})
    await owe_in_session(
        [
            *(
                compose_mitteilung(berechtigung_id=changed_id, art=art, jetzt=was, vorher=before, geaendert_von=None, now=now, gesperrt=barred)
                for changed_id, art, was, before in pending
            ),
            compose_mitteilung(
                berechtigung_id=berechtigung_id,
                art="geaendert",
                jetzt=jetzt,
                vorher=vorher,
                geaendert_von=geaendert_von,
                now=now,
                gesperrt=barred,
            ),
        ],
        postausgang_collection=postausgang_collection,
        berechtigungen_collection=berechtigungen_collection,
        now=now,
        session=session,
    )
    # The announced row is bookkeeping, so replaced with no image.
    await loeschen_many_from_db(collection=berechtigungen_angekuendigt_collection, db_filter={"_id": berechtigung_id}, session=session)
    await post_one_to_db(
        collection=berechtigungen_angekuendigt_collection,
        document=compose_announced(berechtigung_id=berechtigung_id, stand=jetzt, now=now),
        session=session,
    )


@router.post(
    f"/antraege{by_id('antrag_id')}/genehmigung",
    response_model=FLBerechtigungWriteResponse,
    summary="Approve a grant or a promotion another administrator asked for",
    # The enrolment window a grant takes, not the step-up's: the approval hands access to the administration over.
    dependencies=[Depends(verify_recent_confirmation)],
)
async def post_antrag_genehmigung(
    antrag_id: CustomRouteObjectId,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    postausgang_collection: PostausgangCollection,
    berechtigungen_antraege_collection: BerechtigungenAntraegeCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    now: datetime = Depends(get_germany_now),
) -> FLBerechtigungWriteResponse:
    """
    Approve a request, the second pair of eyes a grant or a promotion waits on.

    The grant is made, or the tier moved, and the request removed, in one transaction, the change announced to every
    administrator as one made directly is, under this administrator's name.

    Refused to the address the request is about and to the administrator who made it (`berechtigung_genehmigung_verwehrt`), to anyone but an
    owner, signed in since becoming one, for a promotion (`berechtigung_genehmigung_inhaber`), to an administrator whose grant, or owner's tier,
    took effect after the request (`berechtigung_genehmigung_juenger`), and where the requester does not hold that tier since before it,
    revoked, demoted or barred since (`berechtigung_antrag_verfallen`); and, as the direct act would be, where the address holds a grant by now
    (`berechtigung_vorhanden`) or is on the ban list (`berechtigung_gesperrt`). 404 for an id naming no request, a request decided, withdrawn or
    lapsed among them, and for a promotion whose grant has gone. A promotion whose grant is an owner's already removes the request and changes
    nothing. A sign-in or confirmation older than `ENROLMENT_WINDOW_MINUTES` is refused `confirmation_required`, as a grant's is.
    """

    akteur = sign_in_identifier(operator)

    async def approve_the_antrag(session: AsyncClientSession) -> ObjectId:
        """Read the request and anchor the list, judge the approver and the requester, then remove the request and make the act."""

        antrag = await pull_the_antrag(
            berechtigungen_antraege_collection=berechtigungen_antraege_collection, antrag_id=antrag_id, now=now, session=session
        )
        adresse = str(antrag["adresse"])
        # Written, so a revoke or a demotion of the approver or the requester committing beside it conflicts.
        grants = await pull_the_list_to_judge(berechtigungen_collection=berechtigungen_collection, session=session)
        records = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)
        barred = await adressen_gesperrt(sperrliste, [str(row["adresse"]) for row in grants] + [adresse], session=session)

        inhaber = holds_an_owners_power(akteur=akteur, auth_time=auth_time, grants=grants, announced=records)
        refuse(
            find_genehmigung_verwehrt_refusal(
                verwehrt=genehmigung_verwehrt(
                    betroffen=adresse, genehmigung=antrag["genehmigung"], akteur=akteur, inhaber=inhaber, grants=grants, announced=records
                )
            )
        )
        refuse(find_antrag_verfallen_refusal(steht=antrag_steht(antrag, grants=grants, announced=records, gesperrt=barred)))

        # Removed by the write that reads it, so a second approval, a refusal or an erasure beside this one conflicts and finds none.
        await remove_the_antrag_in_session(
            berechtigungen_antraege_collection=berechtigungen_antraege_collection,
            postausgang_collection=postausgang_collection,
            antrag_id=antrag_id,
            now=now,
            session=session,
        )

        if antrag["berechtigung_id"] is None:
            refuse(find_vorhanden_refusal(adresse=adresse, grants=grants))
            refuse(find_gesperrt_refusal(gesperrt=adresse in barred))
            created_id = await grant_in_session(
                adresse=adresse,
                verwaltung=ADMINISTRATION,
                erteilt_von=operator,
                gesperrt=frozenset(),
                berechtigungen_collection=berechtigungen_collection,
                berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
                postausgang_collection=postausgang_collection,
                now=now,
                session=session,
            )
            return created_id

        # The grant the request named, at the address it named: one repointed in the database since is somebody else's.
        grant = next((row for row in grants if row["_id"] == antrag["berechtigung_id"] and row["adresse"] == adresse), None)
        if grant is None:
            raise DocumentNotFoundError()
        if grant["verwaltung"] != OWNER:
            refuse(find_gesperrt_refusal(gesperrt=adresse in barred))
            await _move_the_tier_in_session(
                grant,
                verwaltung=OWNER,
                # An approval saves no form, so it is checked against no version.
                version=None,
                records=records,
                barred=barred,
                geaendert_von=operator,
                berechtigungen_collection=berechtigungen_collection,
                berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
                postausgang_collection=postausgang_collection,
                now=now,
                session=session,
            )

        return grant["_id"]

    async with transaction_session(db) as session:
        berechtigung_id = await session.with_transaction(approve_the_antrag)

    return FLBerechtigungWriteResponse(berechtigung_id=berechtigung_id)


@router.delete(
    f"/antraege{by_id('antrag_id')}",
    response_model=FLBerechtigungAntragAbgelehntResponse,
    summary="Refuse a grant or a promotion another administrator asked for, or withdraw one's own",
    dependencies=[Depends(verify_step_up)],
)
async def delete_antrag(
    antrag_id: CustomRouteObjectId,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    berechtigungen_antraege_collection: BerechtigungenAntraegeCollection,
    postausgang_collection: PostausgangCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    now: datetime = Depends(get_germany_now),
) -> FLBerechtigungAntragAbgelehntResponse:
    """
    Refuse a request, or withdraw one's own: it is removed, and nothing it asked for happens. HARD, no soft form.

    Decided by whoever may approve it, refused with the approval's own codes otherwise (`berechtigung_genehmigung_verwehrt`,
    `berechtigung_genehmigung_inhaber`, `berechtigung_genehmigung_juenger`), and withdrawn by the administrator who made it, whatever their tier
    now. 404 for an id naming no request, a request decided, withdrawn or lapsed among them. A restore from a snapshot taken before it brings
    the request back only until the replay of its journal line.

    A refusal queues, in the same transaction, a notice to the request's requester naming the address and tier it asked for and
    nobody who refused it, for `POST /berechtigungen/abgleich` to hand out; a withdrawal tells nobody.
    """

    akteur = sign_in_identifier(operator)
    journal = Journal()

    @journal.attempted
    async def refuse_the_antrag(session: AsyncClientSession) -> None:
        antrag = await pull_the_antrag(
            berechtigungen_antraege_collection=berechtigungen_antraege_collection, antrag_id=antrag_id, now=now, session=session
        )
        grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
        records = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)
        verwehrt = genehmigung_verwehrt(
            betroffen=antrag["adresse"],
            genehmigung=antrag["genehmigung"],
            akteur=akteur,
            inhaber=holds_an_owners_power(akteur=akteur, auth_time=auth_time, grants=grants, announced=records),
            grants=grants,
            announced=records,
        )
        # Its requester withdraws it: who made a request may always take it back.
        zurueckgezogen = verwehrt == "gestartet"
        refuse(find_genehmigung_verwehrt_refusal(verwehrt=None if zurueckgezogen else verwehrt))

        await remove_the_antrag_in_session(
            berechtigungen_antraege_collection=berechtigungen_antraege_collection,
            postausgang_collection=postausgang_collection,
            antrag_id=antrag_id,
            now=now,
            session=session,
        )
        journal.note(
            antrag_line(
                antrag=antrag,
                art="antrag_zurueckgezogen" if zurueckgezogen else "antrag_abgelehnt",
                am=log_stamp(now),
                schluessel=config.sperrliste_schluessel,
            )
        )

    async with journal:
        async with transaction_session(db) as session:
            await session.with_transaction(refuse_the_antrag)

    return FLBerechtigungAntragAbgelehntResponse(antrag_id=antrag_id)
