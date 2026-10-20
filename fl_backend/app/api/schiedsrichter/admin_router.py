from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.services import mint_token
from app.api.identitaet.crud import find_anmeldung
from app.api.identitaet.lookup import SubjektLookup
from app.api.identitaet.services import holds_a_name
from app.api.konto.adresswechsel import read_the_bestand, start_the_change_in_session
from app.api.schiedsrichter.crud import discard_adresswechsel_in_session
from app.api.schiedsrichter.schemas import (
    FLPatchSchiedsrichterPayload,
    FLPatchSchiedsrichterResponse,
    FLPostSchiedsrichterPayload,
    FLPostSchiedsrichterResponse,
    FLSchiedsrichter,
    FLSchiedsrichterAdresswechselMint,
    FLSchiedsrichterAdresswechselMintResponse,
    FLSchiedsrichterAdresswechselPayload,
    FLSchiedsrichterMint,
    FLSchiedsrichterMintResponse,
    FLSchiedsrichterReactivateResponse,
    FLSchiedsrichterWriteResponse,
)
from app.api.schiedsrichter.services import (
    ADRESSWECHSEL_FELD,
    BESTAETIGUNG_FELD,
    EINLADEN_FIELDS,
    EINWILLIGUNG_FELD,
    bestaetigung_frist_from,
    build_assignment_filter,
    build_pending_adresswechsel_filter,
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
    find_schiedsrichter_adresse_unveraendert_refusal,
    find_schiedsrichter_name_im_grund_refusal,
    find_unbestaetigter_wechsel_refusal,
    first_stamped,
    owes_reactivation_mint,
    save_moves_the_link,
    vorname_of,
)
from app.api.sperrliste.lookup import SperrlisteLookup, hash_gesperrt, sperrliste_saison
from app.api.spieler.crud import another_pupil_holds
from app.api.spieler.services import build_selbst_pupil_filter, find_adresse_vergeben_refusal
from app.core.adressanker import anchor_the_addresses
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import (
    insert_live,
    patch_many_in_db,
    patch_one_in_db,
    pull_many_from_db,
    pull_one_from_db,
    refuse,
    set_inactive_since,
)
from app.core.dependencies import (
    AdressankerCollection,
    AktionenCollection,
    DBClient,
    SchiedsrichterCollection,
    SpieleCollection,
    SpielerCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, DUPLICATE_KEY_RESPONSE
from app.core.recording import log_stamp
from app.core.routing import by_id
from app.core.security import (
    StepUpCheck,
    bind_actor,
    get_step_up_check,
    verify_access_admin,
    verify_actor_is_admin,
    verify_step_up,
)
from app.core.transactions import transaction_session
from app.shared.adresswechsel import FLAdresswechselWeg, als_utc, build_resendable_terms, compose_block, compose_link_update
from app.shared.folding import sign_in_identifier
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
    responses={409: DUPLICATE_KEY_RESPONSE},
    dependencies=[Depends(verify_step_up)],
)
async def post_schiedsrichter(
    schiedsrichter_data: Annotated[FLPostSchiedsrichterPayload, Body()],
    schiedsrichter_collection: SchiedsrichterCollection,
    sperrliste: SperrlisteLookup,
    adressanker_collection: AdressankerCollection,
    db: DBClient,
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
    gehasht = sperrliste.hash_of(email)
    massgebliche_saison_id = await sperrliste_saison(sperrliste)

    async def judge_and_create(session: AsyncClientSession) -> Any:
        """Ask the ban list, then write. The check is handed the transaction's session, so a retry re-asks it."""

        # The season stays `None` while no season is running, and the ban list is asked on the
        # hash alone, as the correction and the re-send ask it (`REQ-SCHIEDSRICHTER-007`).
        gesperrt = await hash_gesperrt(sperrliste, gehasht, massgebliche_saison_id=massgebliche_saison_id, session=session)
        refuse(find_gesperrt_refusal(gesperrt=gesperrt))

        # The address entering here, which an erasure of it running now never read (`docs/backend/spec.md :: I719`).
        await anchor_the_addresses([email], adressanker_collection=adressanker_collection, schluessel=sperrliste.schluessel, session=session)

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
    async with transaction_session(db) as session:
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
    sperrliste: SperrlisteLookup,
    adressanker_collection: AdressankerCollection,
    db: DBClient,
    refuse_unconfirmed: Annotated[StepUpCheck, Depends(get_step_up_check)],
    today: str = Depends(get_german_date_str),
) -> FLPatchSchiedsrichterResponse:
    """
    Update a referee, then update the embedded name on every Spiel that uses them.

    Only the name. `payment` is NOT propagated: the fee on a match is what was agreed for it.

    **A corrected address on an UNCONFIRMED referee retires their link and answers a fresh one** in
    `bestaetigung`, for the caller to mail to the new address: the old link was posted to a mailbox
    nobody reads, and leaving it live is a credential in the wrong inbox.

    **A CONFIRMED referee's address is refused here** (`REQ-SCHIEDSRICHTER-011`), retired or not: it is who signs in as the
    person, and moves only through `POST /schiedsrichter/{schiedsrichter_id}/adresswechsel` or the person's own account page.
    A save keeping it lands, a pending change standing.

    **A RETIRED unconfirmed referee's corrected address is stored and mails nothing**: no consent is
    collected for a role nobody gives them. Their old link is retired all the same, and the
    reactivation mints the fresh one. Where a link is minted, a banned new address is refused
    `REQ-SCHIEDSRICHTER-007`. A save retiring or minting a link is refused `REQ-AUTH-009` from a
    sign-in or confirmation older than `STEP_UP_WINDOW_HOURS`.

    The ghost answers 404 here as it does to every read: a name written onto it would appear on the
    fixtures of every referee already erased.
    """

    payload = schiedsrichter_data.model_dump(mode="json")
    email = schiedsrichter_data.kontakt.email
    # Minted before the judgement and discarded where none is owed: the raw half must never sit in
    # the same structure as the document, and random bytes cost nothing unused.
    raw_token, token_hash = mint_token()
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
            refuse_unconfirmed()
        update, minted = compose_korrektur_update(stored=stored, payload=payload, payload_email=email, token_hash=token_hash, today=today)

        # The season is NOT a condition here: it is `None` while no season is running, and the
        # ban list is asked on the hash alone then (`REQ-SCHIEDSRICHTER-007`).
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
        # The address entering here, which an erasure of it running now never read (`docs/backend/spec.md :: I719`).
        await anchor_the_addresses([email], adressanker_collection=adressanker_collection, schluessel=sperrliste.schluessel, session=session)

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
        # The CORRECTED address this transaction wrote, never the stored one it replaced: mailing
        # the link to the address the save moved away from is the defect the re-mint exists to end.
        answer.bestaetigung = FLSchiedsrichterMint(token=raw_token, frist=bestaetigung_frist_from(today=today), email=email)

    return answer


@router.delete(
    by_id("schiedsrichter_id"),
    response_model=FLSchiedsrichterWriteResponse,
    summary="Deactivate a Schiedsrichter (soft delete)",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
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
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
async def reactivate_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    refuse_unconfirmed: Annotated[StepUpCheck, Depends(get_step_up_check)],
    today: str = Depends(get_german_date_str),
) -> FLSchiedsrichterReactivateResponse:
    """Clear `inactive_since`, putting the referee back into the picker and every default read.

    **A retired referee who has not answered is minted a fresh link**, answered once for the caller
    to mail: a retired referee's save stores a new address and mails nothing, so coming back is what
    asks them. A row holding no address a link can go to comes back unasked, and so does one whose
    person has answered. Where a link is minted, an address on the ban list is refused
    `REQ-SCHIEDSRICHTER-007` and the row stays retired, and one from a sign-in or confirmation older than
    `STEP_UP_WINDOW_HOURS` is refused `REQ-AUTH-009`.

    The ghost answers 404 here too: cleared on it, the picker would offer a bookable row with no
    person behind it.
    """

    raw_token, token_hash = mint_token()
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
            refuse_unconfirmed()
            gesperrt = await hash_gesperrt(
                sperrliste, sperrliste.hash_of(email), massgebliche_saison_id=massgebliche_saison_id, session=session
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
    async with transaction_session(db) as session:
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
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
    dependencies=[Depends(verify_step_up)],
)
async def einladen_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
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
    massgebliche_saison_id = await sperrliste_saison(sperrliste)

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
        gehasht = sperrliste.hash_of(str(email))
        gesperrt = await hash_gesperrt(sperrliste, gehasht, massgebliche_saison_id=massgebliche_saison_id, session=session)
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
    async with transaction_session(db) as session:
        gemintet_fuer = await session.with_transaction(judge_and_mint)

    return FLSchiedsrichterMintResponse(
        bestaetigung=FLSchiedsrichterMint(token=raw_token, frist=bestaetigung_frist_from(today=today), email=gemintet_fuer)
    )


@router.post(
    f"{by_id('schiedsrichter_id')}/adresswechsel",
    response_model=FLSchiedsrichterAdresswechselMintResponse,
    summary="Start a Schiedsrichter's address change for a person who cannot sign in",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
    dependencies=[Depends(verify_step_up)],
)
async def post_adresswechsel(
    schiedsrichter_id: CustomRouteObjectId,
    adresswechsel_data: Annotated[FLSchiedsrichterAdresswechselPayload, Body()],
    records: SubjektLookup,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    sperrliste: SperrlisteLookup,
    adressanker_collection: AdressankerCollection,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterAdresswechselMintResponse:
    """
    Start a change of the address a CONFIRMED referee signs in on, for a person who cannot sign in, answering its raw links once.

    The pupil's twin (`POST /spieler/{spieler_id}/adresswechsel`), its `grund`, its two ways and its answer alike: nothing
    moves here, and a change already pending on any record of this address is ended.

    Refused where the typed address is the stored one already (`REQ-SCHIEDSRICHTER-012`), where the ban list holds it
    (`REQ-SCHIEDSRICHTER-007`), where the change would move this address's pupil row onto an address another pupil signs in on
    (`REQ-SPIELER-006`), and where the reason names a person of the records the change would move (`REQ-SCHIEDSRICHTER-013`).
    Refused where the referee has not confirmed (`REQ-SCHIEDSRICHTER-014`), whose address the editor's save corrects, and
    where the row holds no usable address (`REQ-SCHIEDSRICHTER-006`). 404 for an id no referee holds, the ghost's included.
    """

    email, grund = adresswechsel_data.email, adresswechsel_data.grund
    weg: FLAdresswechselWeg = "freigabe" if grund is None else "wartezeit"
    raw_token, token_hash = mint_token()
    raw_stopp, stopp_hash = mint_token()
    gehasht = sperrliste.hash_of(email)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await sperrliste_saison(sperrliste)

    async def judge_and_start_the_change(session: AsyncClientSession) -> tuple[str, str, datetime]:
        """Judge, then write the block, answering the address in force and the first name as this transaction reads them."""

        db_filter = build_referee_filter(schiedsrichter_id)
        stored = await pull_one_from_db(
            collection=schiedsrichter_collection,
            db_filter=db_filter,
            projection={"kontakt.email": 1, EINWILLIGUNG_FELD: 1},
            session=session,
        )
        refuse(find_unbestaetigter_wechsel_refusal(einwilligung=stored.get(EINWILLIGUNG_FELD)))
        bisherige_email = (stored.get("kontakt") or {}).get("email")
        refuse(find_missing_address_refusal(email=bisherige_email))
        assert isinstance(bisherige_email, str)
        refuse(find_schiedsrichter_adresse_unveraendert_refusal(stored=bisherige_email, email=email))

        gesperrt = await hash_gesperrt(sperrliste, gehasht, massgebliche_saison_id=massgebliche_saison_id, session=session)
        refuse(find_gesperrt_refusal(gesperrt=gesperrt))

        bestand = await read_the_bestand(bisherige_email, records=records, session=session)
        vergeben = bestand.spieler is not None and await another_pupil_holds(
            spieler_collection=spieler_collection,
            identifier=sign_in_identifier(email),
            spieler_id=bestand.spieler["_id"],
            session=session,
        )
        refuse(find_adresse_vergeben_refusal(vergeben=vergeben))
        refuse(find_schiedsrichter_name_im_grund_refusal(nennt_namen=grund is not None and holds_a_name(grund, bestand.namen())))
        traeger = bestand.zeile(Collection.SCHIEDSRICHTER, schiedsrichter_id)
        assert traeger is not None

        block = compose_block(
            email=email, weg=weg, token_hash=None if weg == "freigabe" else token_hash, stopp_hash=stopp_hash, grund=grund, now=germany_now
        )
        await start_the_change_in_session(
            bestand=bestand,
            traeger=traeger,
            block=block,
            spieler_collection=spieler_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            aktionen_collection=aktionen_collection,
            adressanker_collection=adressanker_collection,
            schluessel=sperrliste.schluessel,
            stamp=log_stamp(germany_now),
            session=session,
        )

        return traeger.adresse, traeger.vorname, block["gueltig_bis"]

    # ONE transaction over the judgement and the write, for the pupil's twin's reason.
    async with transaction_session(db) as session:
        bisherige_email, vorname, gueltig_bis = await session.with_transaction(judge_and_start_the_change)

    return FLSchiedsrichterAdresswechselMintResponse(
        adresswechsel=FLSchiedsrichterAdresswechselMint(
            weg=weg,
            token=None if weg == "freigabe" else raw_token,
            stopp_token=raw_stopp,
            gueltig_bis=gueltig_bis,
            email=email,
            bisherige_email=bisherige_email,
            vorname=vorname,
            # Read after the commit and outside it: a warning for the administrator, judging nothing.
            adresse_belegt=(await find_anmeldung(sign_in_identifier(email), records)).konto,
        )
    )


@router.post(
    f"{by_id('schiedsrichter_id')}/adresswechsel/einladen",
    response_model=FLSchiedsrichterAdresswechselMintResponse,
    summary="Send a Schiedsrichter's pending address a fresh link",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
    dependencies=[Depends(verify_step_up)],
)
async def einladen_adresswechsel(
    schiedsrichter_id: CustomRouteObjectId,
    records: SubjektLookup,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterAdresswechselMintResponse:
    """
    Mint the new mailbox a fresh link for this referee's pending change, as `POST /spieler/{spieler_id}/adresswechsel/einladen` does.

    The previous link stops working at once, its message's delivery state with it, and the deadline restarts now; the stop
    link stays, so the address on file is mailed nothing again.

    Refused where the ban list holds the pending address (`REQ-SCHIEDSRICHTER-007`), and where the change would move this
    address's pupil row onto an address another pupil has come to sign in on (`REQ-SPIELER-006`). 404 unless the change waits
    on the new mailbox, and for an id no referee holds, the ghost's included.
    """

    raw_token, token_hash = mint_token()
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await sperrliste_saison(sperrliste)
    db_filter = build_pending_adresswechsel_filter(schiedsrichter_id, build_resendable_terms())

    async def judge_and_remint_the_change(session: AsyncClientSession) -> Mapping[str, Any]:
        """Judge, then replace the link, answering the row as this transaction reads it."""

        stored = await pull_one_from_db(
            collection=schiedsrichter_collection,
            db_filter=db_filter,
            projection={"kontakt.email": 1, ADRESSWECHSEL_FELD: 1},
            session=session,
        )
        email = str(stored[ADRESSWECHSEL_FELD]["email"])

        gesperrt = await hash_gesperrt(sperrliste, sperrliste.hash_of(email), massgebliche_saison_id=massgebliche_saison_id, session=session)
        refuse(find_gesperrt_refusal(gesperrt=gesperrt))
        bisherige_email = str((stored.get("kontakt") or {}).get("email") or "")
        pupil = await spieler_collection.find_one(
            build_selbst_pupil_filter(sign_in_identifier(bisherige_email)), projection={"_id": 1}, session=session
        )
        vergeben = pupil is not None and await another_pupil_holds(
            spieler_collection=spieler_collection, identifier=sign_in_identifier(email), spieler_id=pupil["_id"], session=session
        )
        refuse(find_adresse_vergeben_refusal(vergeben=vergeben))

        return await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter=db_filter,
            update=compose_link_update(token_hash=token_hash, now=germany_now, freigabe=False),
            session=session,
            return_document=ReturnDocument.AFTER,
        )

    async with transaction_session(db) as session:
        updated = await session.with_transaction(judge_and_remint_the_change)

    wechsel = updated[ADRESSWECHSEL_FELD]
    gueltig_bis = als_utc(wechsel["gueltig_bis"])
    assert gueltig_bis is not None

    return FLSchiedsrichterAdresswechselMintResponse(
        adresswechsel=FLSchiedsrichterAdresswechselMint(
            weg=wechsel["weg"],
            token=raw_token,
            stopp_token=None,
            gueltig_bis=gueltig_bis,
            email=wechsel["email"],
            bisherige_email=str((updated.get("kontakt") or {}).get("email") or ""),
            vorname=vorname_of(updated.get("name")) or "",
            adresse_belegt=(await find_anmeldung(sign_in_identifier(wechsel["email"]), records)).konto,
        )
    )


@router.delete(
    f"{by_id('schiedsrichter_id')}/adresswechsel",
    response_model=FLSchiedsrichterWriteResponse,
    summary="Discard a Schiedsrichter's pending address change",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
    dependencies=[Depends(verify_step_up)],
)
async def delete_adresswechsel(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterWriteResponse:
    """
    Discard this referee's pending address change: the block goes, its link opens nothing, and the stored address stays.

    **The address goes from the action log too** (`docs/backend/spec.md :: I562`): it is taken out of every image the log
    holds of this referee, since every write on the row while the change stood, a re-send or this discard included, filed one
    carrying an address nobody proved; the rest of each image stays. Nothing is mailed. 404 where the referee holds no pending
    change, and for an id no referee holds, the ghost's included.
    """

    async def discard_the_change(session: AsyncClientSession) -> Mapping[str, Any]:
        # The filter is the judgement: a referee holding no change is the 404 here.
        return await discard_adresswechsel_in_session(
            schiedsrichter_collection=schiedsrichter_collection,
            aktionen_collection=aktionen_collection,
            db_filter=build_pending_adresswechsel_filter(schiedsrichter_id),
            stamp=log_stamp(germany_now),
            return_document=ReturnDocument.AFTER,
            session=session,
        )

    # One transaction, so the write, the log row recording it and the redaction land together.
    async with transaction_session(db) as session:
        updated_document_raw = await session.with_transaction(discard_the_change)

    return FLSchiedsrichterWriteResponse(updated_document=FLSchiedsrichter(**updated_document_raw))
