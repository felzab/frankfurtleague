from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.berechtigungen.guard import verify_actor_is_admin
from app.api.schiedsrichter.crud import owe_the_bestaetigung
from app.api.schiedsrichter.schemas import (
    FLPatchSchiedsrichterPayload,
    FLPatchSchiedsrichterResponse,
    FLPostSchiedsrichterPayload,
    FLPostSchiedsrichterResponse,
    FLSchiedsrichter,
    FLSchiedsrichterMint,
    FLSchiedsrichterMintResponse,
    FLSchiedsrichterReactivateResponse,
    FLSchiedsrichterWriteResponse,
)
from app.api.schiedsrichter.services import (
    BESTAETIGUNG_FELD,
    EINLADEN_FIELDS,
    EINWILLIGUNG_FELD,
    bestaetigung_frist_from,
    build_assignment_filter,
    build_referee_filter,
    build_unplayed_assignment_filter,
    compose_bestaetigung,
    compose_korrektur_update,
    compose_mint_update,
    find_already_confirmed_refusal,
    find_bestaetigte_adresse_refusal,
    find_gesperrt_refusal,
    find_missing_address_refusal,
    find_referee_retire_refusal,
    find_retired_refusal,
    first_stamped,
    owes_reactivation_mint,
    save_moves_the_link,
)
from app.api.sperrliste.lookup import SperrlisteLookup, hash_gesperrt, sperrliste_saison
from app.core.config import API_VERSION
from app.core.crud import (
    VERSION_FIELD,
    insert_live,
    patch_many_in_db,
    patch_one_in_db,
    pull_many_from_db,
    pull_one_from_db,
    refuse,
    set_inactive_since,
)
from app.core.dependencies import (
    DBClient,
    PostausgangCollection,
    SchiedsrichterCollection,
    SpieleCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.routing import by_id
from app.core.security import SessionActor, bind_actor, verify_access_admin, verify_admin_actor, verify_step_up
from app.core.transactions import transaction_session
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


@router.post(
    "",
    response_model=FLPostSchiedsrichterResponse,
    status_code=201,
    summary="Create a Schiedsrichter",
    dependencies=[Depends(verify_step_up)],
)
async def post_schiedsrichter(
    schiedsrichter_data: Annotated[FLPostSchiedsrichterPayload, Body()],
    schiedsrichter_collection: SchiedsrichterCollection,
    postausgang_collection: PostausgangCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> FLPostSchiedsrichterResponse:
    """
    Create a referee and owe them their confirmation link.

    `inactive_since` is set to null here and is on no payload. **Entering a referee IS the
    invitation**: the payload requires an email address, and there is no second press deciding
    whether this person is asked, because a referee nobody asked is a name nobody consented to
    publish. The link goes out through the Postausgang, which mints it; the answer names the address and the deadline.

    Refused `schiedsrichter_adresse_gesperrt` where the address given is on the ban list.
    """

    email = schiedsrichter_data.kontakt.email
    # Outside the transaction, whose callback may run again: the hash reads nothing, and the season
    # may be read before it (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    gehasht = sperrliste.hash_of(email)
    massgebliche_saison_id = await sperrliste_saison(sperrliste)

    async def judge_and_create(session: AsyncClientSession) -> Any:
        """Ask the ban list, then write. The check is handed the transaction's session, so a retry re-asks it."""

        # The season stays `None` while no season is running, and the ban list is asked on the
        # hash alone, as the correction and the re-send ask it (`schiedsrichter_adresse_gesperrt`).
        gesperrt = await hash_gesperrt(sperrliste, gehasht, massgebliche_saison_id=massgebliche_saison_id, session=session)
        refuse(find_gesperrt_refusal(gesperrt=gesperrt))

        created = await insert_live(
            collection=schiedsrichter_collection,
            document={
                **schiedsrichter_data.model_dump(mode="json"),
                BESTAETIGUNG_FELD: compose_bestaetigung(today=today),
            },
            session=session,
        )
        await owe_the_bestaetigung(
            postausgang_collection=postausgang_collection,
            schiedsrichter_id=created.inserted_id,
            email=email,
            frist=bestaetigung_frist_from(today=today),
            version=0,
            now=now,
            session=session,
        )

        return created

    # ONE transaction over the judgement, the insert and the mail: a row written outside it would stand with a link
    # owed that an administrator was then told had been refused.
    async with transaction_session(db) as session:
        post_operation = await session.with_transaction(judge_and_create)

    return FLPostSchiedsrichterResponse(
        created_id=post_operation.inserted_id,
        # The payload's own address, which this transaction wrote: there is no earlier row for a
        # rival save to have moved between the caller's read and the write.
        bestaetigung=FLSchiedsrichterMint(frist=bestaetigung_frist_from(today=today), email=email),
    )


@router.patch(
    by_id("schiedsrichter_id"),
    response_model=FLPatchSchiedsrichterResponse,
    summary="Update a Schiedsrichter and fan the change out",
)
async def patch_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_data: Annotated[FLPatchSchiedsrichterPayload, Body()],
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    postausgang_collection: PostausgangCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    actor: Annotated[SessionActor, Depends(verify_admin_actor)],
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> FLPatchSchiedsrichterResponse:
    """
    Update a referee, then update the embedded name on every Spiel that uses them.

    Only the name. `payment` is NOT propagated: the fee on a match is what was agreed for it.

    **A corrected address on an UNCONFIRMED referee retires their link and owes a fresh one** to the
    new address, named in `bestaetigung`: the old link was posted to a mailbox nobody reads, and
    leaving it live is a credential in the wrong inbox.

    **A CONFIRMED referee's address is refused here** (`schiedsrichter_adresse_nur_per_wechsel`), retired or not: it is who signs in as the
    person, and moves only through an address change: the address tool, `POST /adresswechsel`, or the person's own account page.
    A save keeping it lands, a pending change standing.

    **A RETIRED unconfirmed referee's corrected address is stored and mails nothing**: no consent is
    collected for a role nobody gives them. Their old link is retired all the same, and the
    reactivation mints the fresh one. Where a link is minted, a banned new address is refused
    `schiedsrichter_adresse_gesperrt`. A save retiring or minting a link is refused `confirmation_required` from a
    sign-in or confirmation older than `STEP_UP_WINDOW_HOURS`.

    The ghost answers 404 here as it does to every read: a name written onto it would appear on the
    fixtures of every referee already erased.
    """

    payload = schiedsrichter_data.model_dump(mode="json")
    email = schiedsrichter_data.kontakt.email
    gehasht = sperrliste.hash_of(email)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`), and read on every
    # save: whether a mint is owed is decided in-session below.
    massgebliche_saison_id = await sperrliste_saison(sperrliste)

    async def rename_and_fan_out(session: AsyncClientSession) -> tuple[FLPatchSchiedsrichterResponse, bool]:
        # In-session, so the judgement below reads the address and the record this save replaces
        # rather than a snapshot a rival write has already moved.
        stored = await pull_one_from_db(
            collection=schiedsrichter_collection,
            db_filter=build_referee_filter(schiedsrichter_id),
            projection={"kontakt.email": 1, EINWILLIGUNG_FELD: 1, "inactive_since": 1},
            session=session,
        )
        refuse(find_bestaetigte_adresse_refusal(stored=stored, payload_email=email))
        if save_moves_the_link(stored=stored, payload_email=email):
            verify_step_up(actor)
        update, minted = compose_korrektur_update(stored=stored, payload=payload, payload_email=email, today=today)

        # The season is NOT a condition here: it is `None` while no season is running, and the
        # ban list is asked on the hash alone then (`schiedsrichter_adresse_gesperrt`).
        if minted:
            gesperrt = await hash_gesperrt(sperrliste, gehasht, massgebliche_saison_id=massgebliche_saison_id, session=session)
            refuse(find_gesperrt_refusal(gesperrt=gesperrt))

        updated_document_raw = await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter=build_referee_filter(schiedsrichter_id),
            update=update,
            session=session,
            return_document=ReturnDocument.AFTER,
        )
        updated_document = FLSchiedsrichter(**updated_document_raw)
        if minted:
            # The CORRECTED address this transaction wrote, never the stored one it replaced: mailing the link to the
            # address the save moved away from is the defect the fresh link exists to end.
            await owe_the_bestaetigung(
                postausgang_collection=postausgang_collection,
                schiedsrichter_id=updated_document.id,
                email=email,
                frist=bestaetigung_frist_from(today=today),
                version=updated_document.version,
                now=now,
                session=session,
            )

        fan_out = await patch_many_in_db(
            collection=spiele_collection,
            db_filter=build_assignment_filter(updated_document.id),
            update={"$set": {"schiedsrichter.name": updated_document.name}},
            session=session,
        )

        answer = FLPatchSchiedsrichterResponse(updated_document=updated_document, fanned_out_to_spiele=fan_out.modified_count)

        return answer, minted

    # One transaction: a rename landing on the referee and not on their fixtures is the stale copy
    # the fan-out exists to prevent. Every write derives from the payload and an in-session read,
    # so a `with_transaction` retry is safe.
    async with transaction_session(db) as session:
        answer, re_minted = await session.with_transaction(rename_and_fan_out)

    if re_minted:
        answer.bestaetigung = FLSchiedsrichterMint(frist=bestaetigung_frist_from(today=today), email=email)

    return answer


@router.delete(
    by_id("schiedsrichter_id"),
    response_model=FLSchiedsrichterWriteResponse,
    summary="Deactivate a Schiedsrichter (soft delete)",
)
async def delete_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSchiedsrichterWriteResponse:
    """Deactivate a referee. SOFT, for the same reason as venues: matches embed a copy."""

    async def retire_the_referee(session: AsyncClientSession) -> Mapping[str, Any]:
        """Judge the referee's unplayed fixtures, then stamp them. Everything judged is read in-session, so a retry re-judges it."""

        # The row FIRST: the ghost is not a referee this endpoint addresses, and judging its
        # fixtures before reading it would answer 409 for a row the API says is not there.
        stored = await pull_one_from_db(
            collection=schiedsrichter_collection,
            db_filter=build_referee_filter(schiedsrichter_id),
            projection={"inactive_since": 1},
            session=session,
        )

        assigned = await pull_many_from_db(
            collection=spiele_collection,
            db_filter=build_unplayed_assignment_filter(schiedsrichter_id),
            projection={"spiel_nr": 1},
            session=session,
        )
        refuse(find_referee_retire_refusal(upcoming_spiel_nrs=sorted(int(row["spiel_nr"]) for row in assigned)))

        return await set_inactive_since(
            collection=schiedsrichter_collection,
            db_filter=build_referee_filter(schiedsrichter_id),
            # `first_stamped` and never `today`: a second press would move the day they stopped
            # officiating, which is the day a fee is reconciled against.
            when=first_stamped(stored=stored, field="inactive_since", today=today),
            session=session,
        )

    # The stamp inside the judgement's transaction, so a booking committing after the read of the
    # fixtures conflicts on the referee it anchors rather than landing unseen
    # (`app/api/spiele/crud.py :: anchor_a_booked_referee`).
    async with transaction_session(db) as session:
        updated_document_raw = await session.with_transaction(retire_the_referee)

    return FLSchiedsrichterWriteResponse(updated_document=FLSchiedsrichter(**updated_document_raw))


@router.post(
    f"{by_id('schiedsrichter_id')}/reactivate",
    response_model=FLSchiedsrichterReactivateResponse,
    summary="Bring a deactivated Schiedsrichter back",
)
async def reactivate_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    postausgang_collection: PostausgangCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    actor: Annotated[SessionActor, Depends(verify_admin_actor)],
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterReactivateResponse:
    """Clear `inactive_since`, putting the referee back into the picker and every default read.

    **A retired referee who has not answered is owed a fresh link**, named in `bestaetigung`: a
    retired referee's save stores a new address and mails nothing, so coming back is what
    asks them. A row holding no address a link can go to comes back unasked, and so does one whose
    person has answered. Where a link is minted, an address on the ban list is refused
    `schiedsrichter_adresse_gesperrt` and the row stays retired, and one from a sign-in or confirmation older than
    `STEP_UP_WINDOW_HOURS` is refused `confirmation_required`.

    The ghost answers 404 here too: cleared on it, the picker would offer a bookable row with no
    person behind it.
    """

    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await sperrliste_saison(sperrliste)

    async def reactivate_and_ask(session: AsyncClientSession) -> tuple[Mapping[str, Any], str | None]:
        """Judged on the row as the transaction reads it, so a retry re-judges it."""

        stored = await pull_one_from_db(
            collection=schiedsrichter_collection,
            db_filter=build_referee_filter(schiedsrichter_id),
            projection=dict(EINLADEN_FIELDS),
            session=session,
        )
        email = str((stored.get("kontakt") or {}).get("email")) if owes_reactivation_mint(stored=stored) else None

        if email is not None:
            verify_step_up(actor)
            gesperrt = await hash_gesperrt(
                sperrliste, sperrliste.hash_of(email), massgebliche_saison_id=massgebliche_saison_id, session=session
            )
            refuse(find_gesperrt_refusal(gesperrt=gesperrt))

        # ONE write, the mint riding the revival's `$set`: the press is one action, and two writes file
        # two log rows for it.
        minted = compose_mint_update(today=today) if email is not None else {}
        updated = await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter=build_referee_filter(schiedsrichter_id),
            update={"$set": {"inactive_since": None, **minted}},
            session=session,
            return_document=ReturnDocument.AFTER,
        )
        if email is not None:
            await owe_the_bestaetigung(
                postausgang_collection=postausgang_collection,
                schiedsrichter_id=updated["_id"],
                email=email,
                frist=bestaetigung_frist_from(today=today),
                version=updated[VERSION_FIELD],
                now=now,
                session=session,
            )

        return updated, email

    # One transaction, so a row never comes back without the link it was owed.
    async with transaction_session(db) as session:
        updated_document_raw, gemintet_fuer = await session.with_transaction(reactivate_and_ask)

    return FLSchiedsrichterReactivateResponse(
        updated_document=FLSchiedsrichter(**updated_document_raw),
        bestaetigung=None if gemintet_fuer is None else FLSchiedsrichterMint(frist=bestaetigung_frist_from(today=today), email=gemintet_fuer),
    )


@router.post(
    f"{by_id('schiedsrichter_id')}/bestaetigung/einladen",
    response_model=FLSchiedsrichterMintResponse,
    summary="Send a Schiedsrichter a fresh confirmation link",
    dependencies=[Depends(verify_step_up)],
)
async def einladen_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    postausgang_collection: PostausgangCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterMintResponse:
    """
    Owe this referee a fresh confirmation link, which the Postausgang mints and mails, and answer where it goes.

    It replaces the whole block, so the previous link stops working at once. The deadline restarts from today.

    Refused where the referee is retired (`schiedsrichter_retired`), where they have already
    answered (`bestaetigung_vorhanden`), where they carry no email address
    (`schiedsrichter_keine_adresse`), and where that address is on the ban list
    (`schiedsrichter_adresse_gesperrt`). 404 for an id no referee holds, an erased referee's among them, and
    for the ghost, which every by-id route filters out.

    **A referee who has already answered is refused rather than sent a second link**: the
    confirmation refuses every such press, so minting one would replace a live block with a
    credential that can never be spent.
    """

    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await sperrliste_saison(sperrliste)

    async def judge_and_mint(session: AsyncClientSession) -> str:
        """Judge, then replace the block and owe the link, and answer the address it is owed to.

        Everything judged is read in-session, so a retry re-judges it against the row as it stands
        rather than against a snapshot.
        """

        stored = await pull_one_from_db(
            collection=schiedsrichter_collection,
            db_filter=build_referee_filter(schiedsrichter_id),
            projection=dict(EINLADEN_FIELDS),
            session=session,
        )

        refuse(find_retired_refusal(inactive_since=stored.get("inactive_since")))
        refuse(find_already_confirmed_refusal(einwilligung=stored.get(EINWILLIGUNG_FELD)))

        email = (stored.get("kontakt") or {}).get("email")
        refuse(find_missing_address_refusal(email=email))

        # Hashed inside the callback, where the ban endpoint hoists its own: the address is not known
        # until the read above, and the hash reads no document a retry could see differently.
        gehasht = sperrliste.hash_of(str(email))
        gesperrt = await hash_gesperrt(sperrliste, gehasht, massgebliche_saison_id=massgebliche_saison_id, session=session)
        refuse(find_gesperrt_refusal(gesperrt=gesperrt))

        updated = await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter=build_referee_filter(schiedsrichter_id),
            update={"$set": compose_mint_update(today=today)},
            session=session,
            return_document=ReturnDocument.AFTER,
        )
        await owe_the_bestaetigung(
            postausgang_collection=postausgang_collection,
            schiedsrichter_id=updated["_id"],
            email=str(email),
            frist=bestaetigung_frist_from(today=today),
            version=updated[VERSION_FIELD],
            now=now,
            session=session,
        )

        return str(email)

    # The address ANSWERED is the one read in-session above, never one the caller read before this
    # request: a save moving it in between would otherwise send the link to the previous mailbox.
    async with transaction_session(db) as session:
        gemintet_fuer = await session.with_transaction(judge_and_mint)

    return FLSchiedsrichterMintResponse(bestaetigung=FLSchiedsrichterMint(frist=bestaetigung_frist_from(today=today), email=gemintet_fuer))
