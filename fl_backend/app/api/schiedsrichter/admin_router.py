from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.services import mint_token
from app.api.saisons.crud import pull_massgebliche_saison_id
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
    build_booked_image_filter,
    build_ghost_repoint,
    build_ghost_schiedsrichter,
    build_referee_filter,
    build_unplayed_assignment_filter,
    compose_bestaetigung,
    compose_korrektur_update,
    compose_mint_update,
    find_already_confirmed_refusal,
    find_gesperrt_refusal,
    find_ghost_erasure_refusal,
    find_missing_address_refusal,
    find_referee_retire_refusal,
    find_retired_refusal,
    first_stamped,
    owes_reactivation_mint,
)
from app.api.sperrliste.crud import address_is_gesperrt
from app.api.sperrliste.services import adresse_hash
from app.core.collections import Collection
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import (
    erase_many_from_db,
    insert_live,
    patch_many_in_db,
    patch_one_in_db,
    post_one_to_db,
    pull_many_from_db,
    pull_one_from_db,
    refuse,
    set_inactive_since,
)
from app.core.dependencies import (
    AktionenCollection,
    DBClient,
    SaisonsCollection,
    SchiedsrichterCollection,
    SperrlisteCollection,
    SpieleCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, DUPLICATE_KEY_RESPONSE
from app.core.recording import build_redaction_filter, build_redaction_update, log_stamp
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter",
    dependencies=[Depends(verify_access_admin), Depends(bind_actor)],
)


@router.post(
    "",
    response_model=FLPostSchiedsrichterResponse,
    status_code=201,
    summary="Create a Schiedsrichter",
    responses={409: DUPLICATE_KEY_RESPONSE},
)
async def post_schiedsrichter(
    schiedsrichter_data: Annotated[FLPostSchiedsrichterPayload, Body()],
    schiedsrichter_collection: SchiedsrichterCollection,
    sperrliste_collection: SperrlisteCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    today: str = Depends(get_german_date_str),
) -> FLPostSchiedsrichterResponse:
    """
    Create a referee and mint their confirmation link.

    `inactive_since` is set to null here and is on no payload. **Entering a referee IS the
    invitation**: the payload requires an email address, and there is no second press deciding
    whether this person is asked, because a referee nobody asked is a name nobody consented to
    publish. The raw token is answered once, for the caller to mail, and the row stores only its hash.

    Refused `REQ-SCHIEDSRICHTER-007` where the address given is on the ban list.
    """

    email = schiedsrichter_data.kontakt.email
    raw_token, token_hash = mint_token()
    # Outside the transaction, whose callback may run again: the hash reads nothing, and the season
    # may be read before it (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    gehasht = adresse_hash(email, schluessel=config.sperrliste_schluessel)
    massgebliche_saison_id = await pull_massgebliche_saison_id(saisons_collection=saisons_collection)

    async def judge_and_create(session: AsyncClientSession) -> Any:
        """Ask the ban list, then write. The check is handed the transaction's session, so a retry re-asks it."""

        # The season stays `None` while no season is running, and the ban list is asked on the
        # hash alone, as the correction and the re-send ask it (`REQ-SCHIEDSRICHTER-007`).
        gesperrt = await address_is_gesperrt(
            sperrliste_collection=sperrliste_collection,
            adresse_hash=gehasht,
            massgebliche_saison_id=massgebliche_saison_id,
            session=session,
        )
        refuse(find_gesperrt_refusal(gesperrt=gesperrt))

        # Spelled at the call site rather than assembled above it, so
        # `fl_backend/tests/core/test_write_shapes.py :: creations` can still read what this create
        # composes against the validator's `required`.
        return await insert_live(
            collection=schiedsrichter_collection,
            document={
                **schiedsrichter_data.model_dump(mode="json"),
                BESTAETIGUNG_FELD: compose_bestaetigung(token_hash=token_hash, today=today),
            },
            session=session,
        )

    # ONE transaction over the judgement and the insert: a row written outside it would stand with a
    # live link an administrator was then told had been refused.
    async with db.start_session() as session:
        post_operation = await session.with_transaction(judge_and_create)

    return FLPostSchiedsrichterResponse(
        acknowledged=1 if post_operation.acknowledged else 0,
        created_id=post_operation.inserted_id,
        # The payload's own address, which this transaction wrote: there is no earlier row for a
        # rival save to have moved between the caller's read and the mint.
        bestaetigung=FLSchiedsrichterMint(token=raw_token, frist=bestaetigung_frist_from(today=today), email=email),
    )


@router.patch(
    by_id("schiedsrichter_id"),
    response_model=FLPatchSchiedsrichterResponse,
    summary="Update a Schiedsrichter and fan the change out",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
)
async def patch_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_data: Annotated[FLPatchSchiedsrichterPayload, Body()],
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    sperrliste_collection: SperrlisteCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    today: str = Depends(get_german_date_str),
) -> FLPatchSchiedsrichterResponse:
    """
    Update a referee, then update the embedded name on every Spiel that uses them.

    Only the name. `payment` is NOT propagated: the fee on a match is what was agreed for it.

    **A corrected address on an UNCONFIRMED referee retires their link and answers a fresh one**, for
    the caller to mail to the new address: the old link was posted to a mailbox nobody reads, and
    leaving it live is a credential in the wrong inbox. A CONFIRMED referee's address change mints
    nothing and answers `bestaetigung: null`, the record being already given; the administrator tells
    them by hand (`docs/ops/runbooks.md` §5).

    **A RETIRED referee's corrected address is stored and mails nothing**: no consent is collected for
    a role nobody gives them. Their old link is retired all the same, and the reactivation mints the
    fresh one. Where a fresh link is minted, a banned new address is refused `REQ-SCHIEDSRICHTER-007`.

    The ghost answers 404 here as it does to every read: a name written onto it would appear on the
    fixtures of every referee already erased.
    """

    payload = schiedsrichter_data.model_dump(mode="json")
    email = schiedsrichter_data.kontakt.email
    # Minted before the judgement and discarded where none is owed: the raw half must never sit in
    # the same structure as the document, and random bytes cost nothing unused.
    raw_token, token_hash = mint_token()
    gehasht = adresse_hash(email, schluessel=config.sperrliste_schluessel)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`), and read on every
    # save: whether a mint is owed is decided in-session below.
    massgebliche_saison_id = await pull_massgebliche_saison_id(saisons_collection=saisons_collection)

    async def rename_and_fan_out(session: AsyncClientSession) -> tuple[FLPatchSchiedsrichterResponse, bool]:
        # In-session, so the judgement below reads the address and the record this save replaces
        # rather than a snapshot a rival write has already moved.
        stored = await pull_one_from_db(
            collection=schiedsrichter_collection,
            db_filter=build_referee_filter(schiedsrichter_id),
            projection={"kontakt.email": 1, EINWILLIGUNG_FELD: 1, "inactive_since": 1},
            session=session,
        )
        update, minted = compose_korrektur_update(stored=stored, payload=payload, payload_email=email, token_hash=token_hash, today=today)

        # The season is NOT a condition here: it is `None` while no season is running, and the
        # ban list is asked on the hash alone then (`REQ-SCHIEDSRICHTER-007`).
        if minted:
            gesperrt = await address_is_gesperrt(
                sperrliste_collection=sperrliste_collection,
                adresse_hash=gehasht,
                massgebliche_saison_id=massgebliche_saison_id,
                session=session,
            )
            refuse(find_gesperrt_refusal(gesperrt=gesperrt))

        updated_document_raw = await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter=build_referee_filter(schiedsrichter_id),
            update=update,
            session=session,
            return_document=ReturnDocument.AFTER,
        )
        updated_document = FLSchiedsrichter(**updated_document_raw)

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
    async with db.start_session() as session:
        answer, re_minted = await session.with_transaction(rename_and_fan_out)

    if re_minted:
        # The CORRECTED address this transaction wrote, never the stored one it replaced: mailing
        # the link to the address the save moved away from is the defect the re-mint exists to end.
        answer.bestaetigung = FLSchiedsrichterMint(token=raw_token, frist=bestaetigung_frist_from(today=today), email=email)

    return answer


@router.delete(
    by_id("schiedsrichter_id"),
    response_model=FLSchiedsrichterWriteResponse,
    summary="Deactivate a Schiedsrichter (soft delete)",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
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
    async with db.start_session() as session:
        updated_document_raw = await session.with_transaction(retire_the_referee)

    return FLSchiedsrichterWriteResponse(updated_document=FLSchiedsrichter(**updated_document_raw))


@router.post(
    f"{by_id('schiedsrichter_id')}/reactivate",
    response_model=FLSchiedsrichterReactivateResponse,
    summary="Bring a deactivated Schiedsrichter back",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
)
async def reactivate_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    sperrliste_collection: SperrlisteCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    today: str = Depends(get_german_date_str),
) -> FLSchiedsrichterReactivateResponse:
    """Clear `inactive_since`, putting the referee back into the picker and every default read.

    **A retired referee who has not answered is minted a fresh link**, answered once for the caller
    to mail: a retired referee's save stores a new address and mails nothing, so coming back is what
    asks them. A row holding no address a link can go to comes back unasked, and so does one whose
    person has answered. Where a link is minted, an address on the ban list is refused
    `REQ-SCHIEDSRICHTER-007` and the row stays retired.

    The ghost answers 404 here too: cleared on it, the picker would offer a bookable row with no
    person behind it.
    """

    raw_token, token_hash = mint_token()
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await pull_massgebliche_saison_id(saisons_collection=saisons_collection)

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
            gesperrt = await address_is_gesperrt(
                sperrliste_collection=sperrliste_collection,
                adresse_hash=adresse_hash(email, schluessel=config.sperrliste_schluessel),
                massgebliche_saison_id=massgebliche_saison_id,
                session=session,
            )
            refuse(find_gesperrt_refusal(gesperrt=gesperrt))

        # ONE write, the mint riding the revival's `$set`: the press is one action, and two writes file
        # two log rows for it.
        minted = compose_mint_update(token_hash=token_hash, today=today) if email is not None else {}
        updated = await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter=build_referee_filter(schiedsrichter_id),
            update={"$set": {"inactive_since": None, **minted}},
            session=session,
            return_document=ReturnDocument.AFTER,
        )

        return updated, email

    # One transaction, so a row never comes back with the link it was owed unminted.
    async with db.start_session() as session:
        updated_document_raw, gemintet_fuer = await session.with_transaction(reactivate_and_ask)

    return FLSchiedsrichterReactivateResponse(
        updated_document=FLSchiedsrichter(**updated_document_raw),
        bestaetigung=None
        if gemintet_fuer is None
        else FLSchiedsrichterMint(token=raw_token, frist=bestaetigung_frist_from(today=today), email=gemintet_fuer),
    )


@router.post(
    f"{by_id('schiedsrichter_id')}/bestaetigung/einladen",
    response_model=FLSchiedsrichterMintResponse,
    summary="Send a Schiedsrichter a fresh confirmation link",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
)
async def einladen_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    sperrliste_collection: SperrlisteCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    today: str = Depends(get_german_date_str),
) -> FLSchiedsrichterMintResponse:
    """
    Mint a fresh confirmation link for this referee and answer the raw token once, for the caller to mail.

    It replaces the whole block, so the previous link stops working at once and the delivery state
    of the message that link went out in goes with it — a bounce recorded against a replaced address
    would otherwise hold the fresh link's referee unreachable for ever. The deadline restarts from
    today.

    Refused where the referee is retired (`REQ-SCHIEDSRICHTER-001`), where they have already
    answered (`REQ-SCHIEDSRICHTER-004`), where they carry no email address
    (`REQ-SCHIEDSRICHTER-006`), and where that address is on the ban list
    (`REQ-SCHIEDSRICHTER-007`). 404 for an id no referee holds, an erased referee's among them, and
    for the ghost, which every by-id route filters out.

    **A referee who has already answered is refused rather than sent a second link**: the
    confirmation refuses every such press, so minting one would replace a live block with a
    credential that can never be spent.
    """

    raw_token, token_hash = mint_token()
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await pull_massgebliche_saison_id(saisons_collection=saisons_collection)

    async def judge_and_mint(session: AsyncClientSession) -> str:
        """Judge, then replace the block, and answer the address the link was minted for.

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
        gehasht = adresse_hash(str(email), schluessel=config.sperrliste_schluessel)
        gesperrt = await address_is_gesperrt(
            sperrliste_collection=sperrliste_collection,
            adresse_hash=gehasht,
            massgebliche_saison_id=massgebliche_saison_id,
            session=session,
        )
        refuse(find_gesperrt_refusal(gesperrt=gesperrt))

        await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter=build_referee_filter(schiedsrichter_id),
            update={"$set": compose_mint_update(token_hash=token_hash, today=today)},
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

        return str(email)

    # The address ANSWERED is the one read in-session above, never one the caller read before this
    # request: a save moving it in between would otherwise send the link to the previous mailbox.
    async with db.start_session() as session:
        gemintet_fuer = await session.with_transaction(judge_and_mint)

    return FLSchiedsrichterMintResponse(
        bestaetigung=FLSchiedsrichterMint(token=raw_token, frist=bestaetigung_frist_from(today=today), email=gemintet_fuer)
    )


@router.post(
    f"{by_id('schiedsrichter_id')}/anonymisieren",
    response_model=FLSchiedsrichterWriteResponse,
    summary="Anonymise a Schiedsrichter",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
)
async def anonymise_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterWriteResponse:
    """Delete the referee's document and repoint every fixture that named them at the ghost.

    The row does not survive, and nothing on it is nulled in place: the fixtures keep their own
    `payment` and read from then on as officiated by nobody. It cannot be undone, and an id already
    erased answers 404. Erasing the ghost itself is refused (`REQ-ANONYMISE-004`).

    **The response carries the ghost rather than the person**: the row the path named is gone, and
    answering an erasure with the name and contact details it just destroyed would serve them once
    more. `updated_document.id` is therefore the ghost's, which is what those fixtures now name.

    **The repointed fixtures inherit the ghost's retirement**, so one still to be played is reported
    by `GET /spiele/action_required` as a retired booking until somebody assigns a referee to it, and
    a save putting a played or called-off one back among those still to be played is refused it
    (`REQ-BOOKING-001`).
    """

    # Before the transaction: the ghost is refused whatever the database holds, and a read of it
    # inside the callback would answer 404 and hide the reason.
    refuse(find_ghost_erasure_refusal(schiedsrichter_id=schiedsrichter_id))

    async def erase_the_referee(session: AsyncClientSession) -> FLSchiedsrichterWriteResponse:
        # In-session, so the 404 for an id already erased is decided on the snapshot the delete
        # below writes, and a rival rename conflicts rather than landing between them. Projected
        # to the id: nothing here reads a value this call destroys.
        await pull_one_from_db(
            collection=schiedsrichter_collection,
            db_filter=build_referee_filter(schiedsrichter_id),
            projection={"_id": 1},
            session=session,
        )

        # Written here rather than at a deploy step, so an erasure can never repoint a fixture at a
        # row nothing holds -- which `REQ-BOOKING-001` would then read as an unknown referee and
        # `GET /spiele/action_required` would report as nothing at all.
        ghost = await schiedsrichter_collection.find_one({"_id": GHOST_SCHIEDSRICHTER_ID}, session=session)
        if ghost is None:
            ghost = build_ghost_schiedsrichter()
            await post_one_to_db(collection=schiedsrichter_collection, document=ghost, session=session)

        await patch_many_in_db(
            collection=spiele_collection,
            db_filter=build_assignment_filter(schiedsrichter_id),
            update=build_ghost_repoint(),
            session=session,
        )

        # `erase_many_from_db` and never `delete_many_from_db`: the second keeps every image, which
        # here would file the person's whole document into the log this call exists to clear
        # (`docs/backend/spec.md :: I48`).
        await erase_many_from_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": schiedsrichter_id},
            session=session,
        )

        # ONE stamp for both passes, so a row cannot say which of the two reached it.
        stamp = log_stamp(germany_now)

        await patch_many_in_db(
            collection=aktionen_collection,
            db_filter=build_redaction_filter([(Collection.SCHIEDSRICHTER, [schiedsrichter_id])]),
            update=build_redaction_update(at=stamp),
            session=session,
        )

        # The `spiele` rows, which the pass above cannot reach: every fixture stores a COPY of the
        # name, so each edit to one filed an image carrying it, under that fixture's id rather than
        # the referee's.
        await patch_many_in_db(
            collection=aktionen_collection,
            db_filter=build_booked_image_filter(schiedsrichter_id),
            update=build_redaction_update(at=stamp),
            session=session,
        )

        return FLSchiedsrichterWriteResponse(updated_document=FLSchiedsrichter(**ghost))

    # ONE transaction over all of it (`docs/backend/spec.md :: I42`): a referee deleted while a
    # fixture still names them strands that fixture, and one deleted while the log still holds their
    # details reports an erasure that did not happen.
    async with db.start_session() as session:
        # `with_transaction` over a bare one -- the callback derives every write from the path id,
        # so a retry is safe.
        return await session.with_transaction(erase_the_referee)
