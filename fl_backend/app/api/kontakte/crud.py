from collections.abc import Iterable, Mapping, Sequence, Set
from typing import Any, NamedTuple

from pydantic import SecretStr
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aktionen.crud import read_imaged_rows, redact_images_in_session, redact_rows_in_session
from app.api.kontakte.services import (
    PersonName,
    build_clearing_update,
    build_seat_images_filter,
    departing_names,
    departing_slots,
    seat_image_edits,
)
from app.api.spielbestaetigungen.crud import redact_seat_entries_in_images
from app.api.spielbestaetigungen.services import (
    build_contact_reason_images_filter,
    build_contact_reasons_filter,
    contact_reason_image_edits,
    halter_of,
    kontakte_ohne,
    seat_void_of,
)
from app.api.teams.crud import void_moved_seats
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, patch_many_in_db, patch_one_in_db
from app.core.recording import RedactionTarget, build_redaction_filter
from app.shared.folding import sign_in_identifier


async def clear_seats(
    collection: AsyncCollection,
    rows: Sequence[Mapping[str, Any]],
    # Folded (`app/shared/folding.py :: sign_in_identifier`): each seat's address is compared on the fold.
    identifiers: Set[str],
    session: AsyncClientSession,
    *,
    names: Set[PersonName] = frozenset(),
) -> int:
    """Null these people's slots, one patch per row holding any, and answer how many slots.

    `patch_one_in_db` per row and never `patch_many_in_db`, which records no `document_id`
    (`docs/backend/spec.md :: I40`): each row's own history keeps the write that emptied the seat.
    """

    cleared = 0
    for row in rows:
        slots = departing_slots(row, identifiers, names)
        # A row none of them sits in is not written, so its history gains no image.
        if not slots:
            continue

        update = build_clearing_update(slots, bestaetigungen=isinstance(row.get("bestaetigungen"), Mapping))
        await patch_one_in_db(
            collection=collection, db_filter={"_id": row["_id"]}, update=update, session=session, return_document=ReturnDocument.BEFORE
        )
        cleared += len(slots)

    return cleared


async def remove_their_reasons(
    *,
    spielbestaetigungen_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    adressen: Iterable[str],
    schluessel: SecretStr,
    stamp: str,
    session: AsyncClientSession,
) -> None:
    """Every reason these addresses' holders typed, from any seat, out of the confirmation rows and their log images.

    Matched on the holder the answer stored, never the seat, whose earlier or later holder's reason stays (`docs/backend/spec.md :: I759`).
    """

    await remove_the_holders_reasons(
        spielbestaetigungen_collection=spielbestaetigungen_collection,
        aktionen_collection=aktionen_collection,
        halter={halter_of(adresse, schluessel=schluessel) for adresse in adressen},
        stamp=stamp,
        session=session,
    )


async def remove_the_holders_reasons(
    *,
    spielbestaetigungen_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    # Digests `app/api/spielbestaetigungen/services.py :: halter_of` made: a restore's replay holds no address.
    halter: Iterable[str],
    stamp: str,
    session: AsyncClientSession,
) -> None:
    """`remove_their_reasons` by the digests the answers stored."""

    digests = sorted(set(halter))
    if not digests:
        return

    rows = await aggregate_many_from_db(
        collection=spielbestaetigungen_collection,
        pipeline=[{"$match": build_contact_reasons_filter(digests)}, {"$project": {"saison_id": 1}}],
        session=session,
    )
    if rows:
        await patch_many_in_db(
            collection=spielbestaetigungen_collection,
            # Ids and their seasons alone, never the digest: the log keeps a fan-out's filter as text (`docs/backend/spec.md :: I48`).
            db_filter={"saison_id": {"$in": sorted({row["saison_id"] for row in rows})}, "_id": {"$in": [row["_id"] for row in rows]}},
            update={"$set": {"antwort.begruendung": None, "antwort.von.halter": None}},
            session=session,
        )

    # Every image of such a row the log keeps, an undraw's removal among them, which no row standing now reaches.
    await redact_images_in_session(
        aktionen_collection=aktionen_collection,
        db_filter=build_contact_reason_images_filter(digests),
        judge=lambda image: contact_reason_image_edits(image, digests),
        stamp=stamp,
        session=session,
    )


class SeatsCleared(NamedTuple):
    kontakt_slots: int
    redacted_aktionen: int


async def erase_kontaktperson_in_session(
    *,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    spielbestaetigungen_collection: AsyncCollection,
    identifier: str,
    schluessel: SecretStr,
    # The rows naming the address in a seat, of every status, each carrying its seats' addresses and its
    # `bestaetigungen`, read unbounded in the caller's transaction BEFORE any clearing: a cleared row stops matching.
    saison_team_rows: Sequence[Mapping[str, Any]],
    bewerbung_rows: Sequence[Mapping[str, Any]],
    # The caller's, so several erasures in one transaction redact under one instant.
    stamp: str,
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one
    # (`docs/backend/spec.md :: I52`).
    session: AsyncClientSession,
) -> SeatsCleared:
    """Clear, then redact, the rows the caller read in-session, so a retry re-reads them."""

    # Folded again, the fold being idempotent: every match below compares the fold, so an unfolded
    # spelling would match no seat and the erasure would commit having removed nothing.
    identifier = sign_in_identifier(identifier)

    cleared_slots = await clear_seats(saison_teams_collection, saison_team_rows, {identifier}, session)
    cleared_slots += await clear_seats(bewerbungen_collection, bewerbung_rows, {identifier}, session)

    # Off the rows read in this transaction, as `clear_seats` judged them, once for the whole erasure: the void then costs it
    # the same however many rows the person sat in (`docs/backend/spec.md :: I758`).
    held = [(row, slots) for row in saison_team_rows if (slots := departing_slots(row, {identifier}))]
    if held:
        voids = [
            seat_void_of(
                saison_id=row["saison_id"],
                team_id=row["team_id"],
                stored_kontakte=row.get("kontakte"),
                kontakte=kontakte_ohne(row.get("kontakte"), slots),
            )
            for row, slots in held
        ]
        await void_moved_seats(spielbestaetigungen_collection=spielbestaetigungen_collection, voids=voids, session=session)
        # Their links' hashes and the delivery records of the mails they went in, as the season row's own clearing takes them.
        await redact_seat_entries_in_images(aktionen_collection=aktionen_collection, voids=voids, stamp=stamp, session=session)
    # Seated now or not: a seat they have left keeps the reasons they typed from it until this.
    await remove_their_reasons(
        spielbestaetigungen_collection=spielbestaetigungen_collection,
        aktionen_collection=aktionen_collection,
        adressen=[identifier],
        schluessel=schluessel,
        stamp=stamp,
        session=session,
    )

    # LAST, so both passes reach the pre-images the clearing just filed. The rows reached by document
    # first, by address and by name; then by address alone, which also finds a swap's orphan.
    reached: list[RedactionTarget] = [
        (Collection.SAISON_TEAMS, [row["_id"] for row in saison_team_rows]),
        (Collection.BEWERBUNGEN, [row["_id"] for row in bewerbung_rows]),
    ]
    redacted = await redact_seats_in_documents(
        aktionen_collection=aktionen_collection, documents=reached, identifiers={identifier}, links=True, stamp=stamp, session=session
    )
    redacted += await redact_images_in_session(
        aktionen_collection=aktionen_collection,
        db_filter=build_seat_images_filter(identifier),
        judge=lambda image: seat_image_edits(image, (identifier,), links=True),
        stamp=stamp,
        session=session,
    )

    return SeatsCleared(kontakt_slots=cleared_slots, redacted_aktionen=redacted)


async def redact_the_decliner(
    *,
    aktionen_collection: AsyncCollection,
    collection: Collection,
    row_id: Any,
    adressen: Iterable[str],
    stamp: str,
    session: AsyncClientSession,
) -> None:
    """The declining person's seats out of every log image of this one row, which is all a Widerspruch reaches.

    The link's Widerspruch and a restore's replay of its journal line both run it, after the patch emptying the seats.
    """

    await redact_seats_in_documents(
        aktionen_collection=aktionen_collection,
        documents=[(collection, [row_id])],
        identifiers={sign_in_identifier(adresse) for adresse in adressen},
        # The link stays with the seat, its decline recorded on it, as the live write leaves it.
        links=False,
        stamp=stamp,
        session=session,
    )


async def redact_seats_in_documents(
    *,
    aktionen_collection: AsyncCollection,
    documents: Sequence[RedactionTarget],
    # Folded (`app/shared/folding.py :: sign_in_identifier`): every image is judged on the fold.
    identifiers: Set[str],
    links: bool,
    stamp: str,
    session: AsyncClientSession,
    # Names the caller knows are theirs from outside these documents: the replacement's, off the row it hands over.
    names: Set[PersonName] = frozenset(),
) -> int:
    """The departing person's seats out of every log image of documents the caller reached by id, and how many rows changed."""

    # Read whole before any image is judged: a name is theirs wherever ANY image of the document
    # seats it at their address, the write's own pre-image included.
    rows = await read_imaged_rows(aktionen_collection=aktionen_collection, db_filter=build_redaction_filter(documents), session=session)
    found = departing_names(rows, identifiers)

    return await redact_rows_in_session(
        aktionen_collection=aktionen_collection,
        rows=rows,
        judge=lambda image: seat_image_edits(image, identifiers, links=links, names=found.get(image.get("_id"), frozenset()) | names),
        stamp=stamp,
        session=session,
    )
