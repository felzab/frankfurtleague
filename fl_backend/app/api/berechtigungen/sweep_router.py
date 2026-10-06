import secrets
from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.berechtigungen.crud import (
    pull_the_list_to_judge,
    read_berechtigungen,
    read_the_announced,
    read_the_claimable,
)
from app.api.berechtigungen.schemas import (
    FLBerechtigungAbgleichResponse,
    FLBerechtigungAenderung,
    FLBerechtigungAngekuendigtPayload,
    FLBerechtigungAngekuendigtResponse,
    FLBerechtigungPostausgangZeile,
)
from app.api.berechtigungen.services import (
    BEANSPRUCHUNG_DAUER,
    VERSUCHE_HOECHSTENS,
    compare,
    compose_announced,
    compose_postausgang,
    ernannt,
    gefunden,
    lebendige,
    withheld,
)
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, sperrliste_saison
from app.api.sperrliste.services import withheld_actor
from app.core.config import API_VERSION
from app.core.crud import erase_many_from_db, patch_many_in_db, post_many_to_db, pull_many_from_db
from app.core.dependencies import (
    BerechtigungenAngekuendigtCollection,
    BerechtigungenCollection,
    BerechtigungenPostausgangCollection,
    DBClient,
    get_germany_now,
)
from app.core.exception_handlers import DUPLICATE_KEY_RESPONSE
from app.core.security import bind_system_actor, verify_access_system
from app.core.transactions import transaction_session

# System tier and the system actor, as the application sweep's own router is: the pass holds no
# session, and an out-of-band change has no administrator to attribute its rows to.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/berechtigungen/abgleich",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)


@router.post(
    "",
    response_model=FLBerechtigungAbgleichResponse,
    summary="Claim the grant changes still to be announced",
    responses={409: DUPLICATE_KEY_RESPONSE},
)
async def post_berechtigungen_abgleich(
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    berechtigungen_postausgang_collection: BerechtigungenPostausgangCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    now: datetime = Depends(get_germany_now),
) -> FLBerechtigungAbgleichResponse:
    """
    Queue every change made to the grants in the database directly, then claim the unannounced changes and answer who to tell.

    Every grant and revoke made through the application queued its own notice when it was made, naming the administrator who made
    it. What was changed in the database directly is found here, by comparing the grants with the record of what is already
    accounted for, and queued naming nobody: `geaendert_von` and `geaendert_am` null. A database change undone again before any
    call to this endpoint is found by nothing. A row whose address no request can match counts as no grant, and `uebersprungen`
    counts those rows. A grant found here -- a new row, or an address changed in place -- is stamped `gefunden_am` with this call's
    time, which `POST /identitaet/subjekt` then answers as `berechtigt_seit`: a session signed in before it administers nothing. Every
    row a call reads for the first time, one no request can match included, is stamped `gesehen_am`, and a row carrying it beside no
    record of its own was changed in the database since a call read it: it is no grant until a call finds it.

    The call then claims, oldest first and a page at a time, every queued change no claim holds or whose claim has lapsed, for ten
    minutes from now. A second call inside that time is answered none of them. The caller mails each change and then hands the ids it
    mailed, with `beanspruchung`, to `POST /berechtigungen/abgleich/angekuendigt`. Where a lease lapses before that, the next call
    claims those changes again. `beanspruchung` and `beansprucht_bis` are null exactly where nothing was claimed.

    `urheber` says who made each change: `anwendung` for an administrator through the application, `datenbank` for an edit
    found here. No barred address is answered in plain: wherever one would stand -- `jetzt`, `vorher`, `geaendert_von`,
    `empfaenger` -- it is `null` or left out, and the change carries `gesperrt`; a withheld `geaendert_von` carries
    `geaendert_von_gesperrt` as well. An address changed in place is two changes, its removal and the new address's grant.
    `empfaenger` is every live, unbarred grant holder now; a removed address is read off its change.
    """

    async def queue_and_claim(session: AsyncClientSession) -> tuple[list[dict[str, Any]], list[str], int, str | None]:
        """Read the grants, the record and the ban list, queue what differs, then claim, each on this transaction's session."""

        grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
        live = lebendige(grants)
        announced = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)
        changes = compare(grants=grants, announced=announced)
        if changes:
            # Anchored before the pass writes, so a revoke or a ban judging these rows conflicts with it
            # (`docs/backend/spec.md :: I462`). The read repeats this snapshot's, and a pass queueing
            # nothing logs no anchor.
            await pull_the_list_to_judge(berechtigungen_collection=berechtigungen_collection, session=session)

        stored = {str(row["adresse"]) for row in live} | {
            stand.adresse for _, _, jetzt, vorher in changes for stand in (jetzt, vorher) if stand is not None and stand.adresse is not None
        }
        massgebliche_saison_id = await sperrliste_saison(sperrliste, session=session)
        barred = await adressen_gesperrt(sperrliste, stored, massgebliche_saison_id=massgebliche_saison_id, session=session)

        if changes:
            await post_many_to_db(
                collection=berechtigungen_postausgang_collection,
                documents=[
                    compose_postausgang(
                        berechtigung_id=berechtigung_id, art=art, jetzt=jetzt, vorher=vorher, geaendert_von=None, now=now, gesperrt=barred
                    )
                    for berechtigung_id, art, jetzt, vorher in changes
                ],
                session=session,
            )
            # The record now accounts for each change, the notice for it standing queued.
            # Bookkeeping, so removed with no image: an image carries the address into a log every
            # administrator reads for twelve months (`docs/backend/spec.md :: I465`).
            await erase_many_from_db(
                collection=berechtigungen_angekuendigt_collection,
                db_filter={"_id": {"$in": [berechtigung_id for berechtigung_id, _, _, _ in changes]}},
                session=session,
            )
            current = [
                compose_announced(berechtigung_id=grant_id, stand=jetzt, now=now) for grant_id, _, jetzt, _ in changes if jetzt is not None
            ]
            if current:
                await post_many_to_db(collection=berechtigungen_angekuendigt_collection, documents=current, session=session)
            # This pass's clock and not the row's `erteilt_am`, which a paste typed and a repoint kept
            # from the address before (`docs/backend/spec.md :: I525`).
            if found := gefunden(changes):
                await patch_many_in_db(
                    collection=berechtigungen_collection,
                    db_filter={"_id": {"$in": found}},
                    update={"$set": {"gefunden_am": now}},
                    session=session,
                )
            # Nothing dates the promotion's edit, so its owner's power dates from this pass, as the tier
            # change dates one made there (`docs/backend/spec.md :: I534`).
            if raised := ernannt(changes):
                await patch_many_in_db(
                    collection=berechtigungen_collection,
                    db_filter={"_id": {"$in": raised}},
                    update={"$set": {"ernannt_am": now}},
                    session=session,
                )

        # Every row no pass has read, a dead one included: once its record is gone, this mark tells an
        # edit made since from a paste nothing has seen (`docs/backend/spec.md :: I529`). The unseen
        # alone, so a quiet pass writes nothing.
        if unseen := [row["_id"] for row in grants if row.get("gesehen_am") is None]:
            await patch_many_in_db(
                collection=berechtigungen_collection,
                db_filter={"_id": {"$in": unseen}},
                update={"$set": {"gesehen_am": now}},
                session=session,
            )

        claimable = await read_the_claimable(
            berechtigungen_postausgang_collection=berechtigungen_postausgang_collection, now=now, session=session
        )
        token = None
        if claimable:
            token = secrets.token_urlsafe(24)
            # Every claimed row written, so two overlapping calls conflict on the rows both read and
            # the retry sees them held (`docs/backend/spec.md :: I454`); the count rises in this write,
            # so a retried claim counts once (`:: I480`).
            await patch_many_in_db(
                collection=berechtigungen_postausgang_collection,
                db_filter={"_id": {"$in": [row["_id"] for row in claimable]}},
                update={"$set": {"beanspruchung": token, "beansprucht_bis": now + BEANSPRUCHUNG_DAUER}, "$inc": {"versuche": 1}},
                session=session,
            )

        recipients = [str(row["adresse"]) for row in live if row["adresse"] not in barred]
        # Barred addresses queued before a ban are withheld at the answer, not only at the queueing.
        claimed_addresses = {
            adresse
            for row in claimable
            for stand in (row.get("jetzt"), row.get("vorher"))
            if stand is not None and (adresse := stand.get("adresse")) is not None
        } | {str(row["geaendert_von"]) for row in claimable if row.get("geaendert_von") is not None}
        barred |= await adressen_gesperrt(
            sperrliste, claimed_addresses - stored, massgebliche_saison_id=massgebliche_saison_id, session=session
        )

        answered = [_answered(row, barred) for row in claimable]

        return answered, recipients, len(grants) - len(live), token

    async with transaction_session(db) as session:
        answered, recipients, uebersprungen, token = await session.with_transaction(queue_and_claim)

    return FLBerechtigungAbgleichResponse(
        beanspruchung=token,
        beansprucht_bis=None if token is None else now + BEANSPRUCHUNG_DAUER,
        aenderungen=[FLBerechtigungAenderung.model_validate(row) for row in answered],
        empfaenger=recipients,
        uebersprungen=uebersprungen,
    )


def _answered(row: Mapping[str, Any], barred: set[str]) -> dict[str, Any]:
    """One claimed row as the answer carries it, every barred address in it withheld."""

    zeile = FLBerechtigungPostausgangZeile.model_validate(row)
    jetzt, vorher = withheld(zeile.jetzt, barred), withheld(zeile.vorher, barred)
    geaendert_von = withheld_actor(zeile.geaendert_von, barred)
    withheld_now = (jetzt, vorher, geaendert_von) != (zeile.jetzt, zeile.vorher, zeile.geaendert_von)

    return {
        "id": zeile.id,
        "berechtigung_id": zeile.berechtigung_id,
        "art": zeile.art,
        "urheber": zeile.urheber,
        "jetzt": jetzt,
        "vorher": vorher,
        "geaendert_von": geaendert_von,
        # Only a withheld actor is null on a change the application made.
        "geaendert_von_gesperrt": zeile.urheber == "anwendung" and geaendert_von is None,
        "geaendert_am": zeile.geaendert_am,
        # The stored reason, or a ban entered since the row was queued; never read off a null address.
        "gesperrt": zeile.vorenthalten == "gesperrt" or withheld_now,
        # The row as read before this claim raised its count.
        "aufgegeben": zeile.versuche + 1 > VERSUCHE_HOECHSTENS,
    }


@router.post("/angekuendigt", response_model=FLBerechtigungAngekuendigtResponse, summary="Remove the announced changes a claim holds")
async def post_berechtigungen_angekuendigt(
    angekuendigt_data: Annotated[FLBerechtigungAngekuendigtPayload, Body()],
    berechtigungen_postausgang_collection: BerechtigungenPostausgangCollection,
    db: DBClient,
) -> FLBerechtigungAngekuendigtResponse:
    """
    Remove each named change from the queue, where the named claim still holds it, and nothing else.

    A change the claim does not hold -- unknown, removed already, or claimed since by another call after this claim lapsed -- is
    left alone and counted in `ignoriert`, so a caller can mark as told only what the server itself holds as queued under its own
    claim. A repeated id counts once. One transaction, recorded under the system actor.
    """

    ids = sorted(set(angekuendigt_data.ids))

    async def stamp(session: AsyncClientSession) -> int:
        """Remove the rows this claim still holds, on this transaction's session."""

        held = await pull_many_from_db(
            collection=berechtigungen_postausgang_collection,
            db_filter={"_id": {"$in": ids}, "beanspruchung": angekuendigt_data.beanspruchung},
            limit=len(ids),
            projection=["_id"],
            session=session,
        )
        if not held:
            return 0

        # By the ids the claim holds, with no image: the rows carry addresses, and an imageless
        # removal's filter is all the log keeps (`docs/backend/spec.md :: I465`).
        removed = await erase_many_from_db(
            collection=berechtigungen_postausgang_collection, db_filter={"_id": {"$in": [row["_id"] for row in held]}}, session=session
        )

        return removed.deleted_count

    async with transaction_session(db) as session:
        angekuendigt = await session.with_transaction(stamp)

    return FLBerechtigungAngekuendigtResponse(angekuendigt=angekuendigt, ignoriert=len(ids) - angekuendigt)
