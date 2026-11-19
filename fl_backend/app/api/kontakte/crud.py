from collections.abc import Mapping, Sequence, Set
from typing import Any

from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.bewerbungen.services import deletion_was_announced, leaving_moves_the_deletion_day
from app.api.kontakte.services import (
    build_clearing_update,
    departing_seats,
)
from app.api.spielbestaetigungen.services import (
    HeldSeats,
    build_seat_reasons_filter,
)
from app.core.crud import patch_many_in_db, patch_one_in_db
from app.shared.folding import sign_in_identifier


async def clear_seats(
    collection: AsyncCollection,
    rows: Sequence[Mapping[str, Any]],
    # Folded: each seat's address is compared on the fold.
    identifiers: Set[str],
    session: AsyncClientSession,
) -> None:
    """Null these people's seats, one patch per row holding any and never one over many: which seats a row gives up is that row's own."""

    for row in rows:
        seats = departing_seats(row, identifiers)
        if not seats:
            continue

        update = build_clearing_update(
            seats,
            confirmations=isinstance(row.get("confirmations"), Mapping),
            # The seat a notice named may be the one going: the application then falls on a later day nobody was told.
            takes_the_notice_back=deletion_was_announced(bewerbung_raw=row)
            and leaving_moves_the_deletion_day(kontakte=row.get("kontakte"), confirmations=row.get("confirmations"), seats=seats),
        )
        await patch_one_in_db(
            collection=collection,
            db_filter={"_id": row["_id"]},
            update=update,
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )


async def remove_the_seats_reasons(
    *,
    spielbestaetigungen_collection: AsyncCollection,
    # The seats whose holder an erasure or a Widerspruch takes, each with its team and season.
    held: Sequence[HeldSeats],
    session: AsyncClientSession,
) -> None:
    """Every reason typed from these seats out of the confirmation rows, matched by team, season and seat.

    An answer records the seat and never its holder, so this is the one way a seat holder's erasure reaches a reason.
    """

    held = [seats for seats in held if seats.seats]
    if not held:
        return

    await patch_many_in_db(
        collection=spielbestaetigungen_collection,
        db_filter=build_seat_reasons_filter(held),
        update={"$set": {"answer.reason": None}},
        session=session,
    )


async def erase_kontaktperson_in_session(
    *,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    spielbestaetigungen_collection: AsyncCollection,
    identifier: str,
    # The rows naming the address in a seat, of every status, each carrying its seats' addresses and its
    # `confirmations`, read unbounded in the caller's transaction before any clearing: a cleared row stops matching.
    saison_team_rows: Sequence[Mapping[str, Any]],
    bewerbung_rows: Sequence[Mapping[str, Any]],
    # Required, so a caller forgetting it is a TypeError rather than writes committing one by one.
    session: AsyncClientSession,
) -> None:
    """Clear this person's seats off the rows the caller read, and every reason typed from a seat they leave."""

    # Folded again, the fold being idempotent: every match below compares the fold, so an unfolded
    # spelling would match no seat and the erasure would commit having removed nothing.
    identifier = sign_in_identifier(identifier)

    await clear_seats(saison_teams_collection, saison_team_rows, {identifier}, session)
    await clear_seats(bewerbungen_collection, bewerbung_rows, {identifier}, session)

    # Off the rows read in this transaction, as `clear_seats` judged them, once for the whole erasure.
    held = [(row, seats) for row in saison_team_rows if (seats := departing_seats(row, {identifier}))]
    # The seats they hold now: a reason typed from a seat they have left goes with its season's end.
    await remove_the_seats_reasons(
        spielbestaetigungen_collection=spielbestaetigungen_collection,
        held=[HeldSeats(saison_id=row["saison_id"], team_id=row["team_id"], seats=seats) for row, seats in held],
        session=session,
    )
