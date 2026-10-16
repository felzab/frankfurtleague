from collections.abc import Mapping, Sequence, Set
from typing import Any, Final, NamedTuple

from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aktionen.crud import read_imaged_rows, redact_images_in_session, redact_rows_in_session
from app.api.bewerbungen.services import compose_decline_update, compose_saison_decline_update, seat_adressen
from app.api.kontakte.services import (
    PersonName,
    build_clearing_update,
    build_seat_images_filter,
    departing_names,
    departing_slots,
    seat_image_edits,
)
from app.core.collections import Collection
from app.core.crud import patch_one_in_db
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


class SeatsCleared(NamedTuple):
    kontakt_slots: int
    redacted_aktionen: int


async def erase_kontaktperson_in_session(
    *,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    identifier: str,
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


# The two homes a seat's link sits on, each emptying its slots by its own update.
WIDERSPRUCH_UPDATES: Final = {Collection.BEWERBUNGEN: compose_decline_update, Collection.SAISON_TEAMS: compose_saison_decline_update}


async def take_widerspruch_in_session(
    *,
    collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    row: Mapping[str, Any],
    seats: Sequence[str],
    # The German day the person declined on, and the instant the log's redaction is stamped with.
    today: str,
    stamp: str,
    session: AsyncClientSession,
) -> Mapping[str, Any]:
    """The link's Widerspruch and a restore's replay of its journal line both run this body, so a replay writes what the press wrote.

    `row` is read in the caller's transaction, its seats' addresses being the ones the log loses.
    """

    home = Collection(collection.name)
    updated = await patch_one_in_db(
        collection=collection,
        db_filter={"_id": row["_id"]},
        update=WIDERSPRUCH_UPDATES[home](seats=seats, today=today),
        session=session,
        return_document=ReturnDocument.AFTER,
    )

    # LAST, so it reaches the pre-image the clearing patch just filed, which still holds the person who refused to be
    # held; the link stays with the seat, its decline recorded on it.
    await redact_seats_in_documents(
        aktionen_collection=aktionen_collection,
        documents=[(home, [row["_id"]])],
        identifiers={sign_in_identifier(adresse) for adresse in seat_adressen(kontakte=row.get("kontakte"), seats=seats)},
        links=False,
        stamp=stamp,
        session=session,
    )

    return updated


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
