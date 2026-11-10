"""
API · what a registration is read and judged by, and the erasure's removal of an address's registrations

Here rather than in `services.py`, which decides from its arguments and names no handle.
"""

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any, Final, NamedTuple

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.bewerbungen.services import OPEN_LINKS_PER_MAILBOX, mailbox_anchor_ids
from app.api.registrierungen.services import (
    PERSON_IDENTITY_FIELDS,
    WITHOUT_TOKEN_HASHES,
    build_addresses_filter,
    build_open_filter,
    build_open_link_filter,
    build_registrierungen_sort,
    find_unknown_registrierung_refusal,
)
from app.core.crud import aggregate_many_from_db, anchor_mailboxes_in_db, delete_many_from_db, refuse
from app.core.readonly import ReadCollection
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT

# What the admission reads of a person: who they are, for the question, and what it overwrites.
PERSON_FIELDS: tuple[str, ...] = (*PERSON_IDENTITY_FIELDS, "birth_date", "email")


async def pull_registrierung(
    *, registrierungen_collection: AsyncCollection, registrierung_id: Any, session: AsyncClientSession
) -> Mapping[str, Any]:
    """The registration this id names, of any status, or `role_not_held` where no row holds it.

    Never a 404, which would answer before the caller judges the seat: an unknown id and another team's row answer alike,
    so nobody learns which ids exist. An admitted row is gone, so its id is one no row holds.
    """

    row = await registrierungen_collection.find_one({"_id": registrierung_id}, projection=dict(WITHOUT_TOKEN_HASHES), session=session)
    refuse(find_unknown_registrierung_refusal(found=row is not None))
    assert row is not None

    return row


async def judge_the_mailbox_in_session(
    *,
    registrierungen_collection: AsyncCollection,
    mailbox_anchors_collection: AsyncCollection,
    saison_id: str,
    address: str,
    # The row being mailed where it stands already, which takes no place from itself.
    excluding_id: Any,
    at: datetime,
    session: AsyncClientSession,
) -> bool:
    """Whether the season may mail this address's mailbox another confirmation link, anchoring the mailbox where it may.

    Below `OPEN_LINKS_PER_MAILBOX` unanswered mailed links, as the application's press judges it
    (`app/api/bewerbungen/public_router.py :: post_bewerbung`): the anchor puts two writes mailing one mailbox in one
    write set, so neither passes on a count the other is about to raise.
    """

    waiting = await registrierungen_collection.count_documents(
        {**build_open_link_filter(saison_id=saison_id, address=address), **({} if excluding_id is None else {"_id": {"$ne": excluding_id}})},
        limit=OPEN_LINKS_PER_MAILBOX,
        session=session,
    )
    if waiting >= OPEN_LINKS_PER_MAILBOX:
        return False

    await anchor_mailboxes_in_db(collection=mailbox_anchors_collection, ids=mailbox_anchor_ids(addresses=[address]), at=at, session=session)

    return True


# The most pending rows one read serves a team: the collection is written by anybody holding a team's link, so the read
# is bounded whatever the form stored.
OPEN_REGISTRIERUNGEN_CAP: Final = LIST_LIMIT_DEFAULT


class OpenRegistrierungen(NamedTuple):
    rows: list[Mapping[str, Any]]
    # Whether every pending row of the team's season is among `rows`, the cap having cut none.
    complete: bool


async def pull_open_registrierungen(
    *, registrierungen_collection: ReadCollection, saison_id: str, team_id: Any, session: AsyncClientSession
) -> OpenRegistrierungen:
    """One team's pending rows, newest first, `OPEN_REGISTRIERUNGEN_CAP` at most, the confirmed ones taken first.

    Anybody holding the team's link writes an unconfirmed row with every press, so a cap taking the newest alone lets one
    flood of them bury every row a pupil confirmed. A confirmed row costs more: its own bot-checked submission and a
    mailed link opened and answered, a mailbox holding `app/api/bewerbungen/services.py :: OPEN_LINKS_PER_MAILBOX`
    unanswered at a time. Rows past the cap stay unread, as on the administration's list, and `complete` says so. Two
    reads, each newest first, the second only for the room the first left.
    """

    rows: list[Mapping[str, Any]] = []
    for confirmed in (True, False):
        room = OPEN_REGISTRIERUNGEN_CAP - len(rows)
        # One row past the room, so a cut is known rather than guessed from a full page.
        read = await aggregate_many_from_db(
            collection=registrierungen_collection,
            pipeline=[
                {
                    "$match": {
                        **build_open_filter(saison_id=saison_id, team_id=team_id),
                        "einwilligung.confirmed_at": {"$ne": None} if confirmed else None,
                    }
                },
                {"$sort": dict(build_registrierungen_sort())},
                {"$limit": room + 1},
                # An inclusion: nothing beyond the form's own fields, the consent stamp and the address
                # the join runs on reaches this handler, let alone the wire.
                {
                    "$project": {
                        **{field: 1 for field in ("submitted_at", *PERSON_IDENTITY_FIELDS, "nummer", "position", "stufe")},
                        **{field: 1 for field in ("email", "birth_date", "einwilligung.confirmed_at")},
                    }
                },
            ],
            session=session,
        )
        rows += read[:room]
        if len(read) > room:
            return OpenRegistrierungen(rows=_newest_first(rows), complete=False)

    return OpenRegistrierungen(rows=_newest_first(rows), complete=True)


def _newest_first(rows: list[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """The served rows in `build_registrierungen_sort`'s order, whichever read took each."""

    return sorted(rows, key=lambda row: (row["submitted_at"], row["_id"]), reverse=True)


async def persons_at(
    *, spieler_collection: ReadCollection, addresses: Sequence[str], session: AsyncClientSession | None
) -> list[Mapping[str, Any]]:
    """The stored persons these folded addresses resolve to, one per address under `uniq_spieler_email`."""

    if not addresses:
        return []

    return await aggregate_many_from_db(
        collection=spieler_collection,
        pipeline=[{"$match": build_addresses_filter(addresses)}, {"$project": {field: 1 for field in PERSON_FIELDS}}],
        session=session,
    )


async def nummern_rows(
    *, saison_spieler_collection: ReadCollection, saison_id: str, team_id: Any, session: AsyncClientSession | None
) -> list[Mapping[str, Any]]:
    """The live squad's shirt numbers, a nominee's among them: the cap's filter leaves those out, and a nominee wears one too."""

    return await aggregate_many_from_db(
        collection=saison_spieler_collection,
        pipeline=[{"$match": {"saison_id": saison_id, "team_id": team_id, "inactive_since": None}}, {"$project": {"nummer": 1}}],
        session=session,
    )


async def kader_rows_of(
    *, saison_spieler_collection: ReadCollection, saison_id: str, spieler_ids: Sequence[Any], session: AsyncClientSession | None
) -> list[Mapping[str, Any]]:
    """These persons' rows of one season, whichever team holds each: one per person under `uniq_spieler_id_saison_id`."""

    if not spieler_ids:
        return []

    return await aggregate_many_from_db(
        collection=saison_spieler_collection,
        pipeline=[
            {"$match": {"saison_id": saison_id, "spieler_id": {"$in": list(spieler_ids)}}},
            {"$project": {"spieler_id": 1, "is_nachnominiert": 1}},
        ],
        session=session,
    )


async def erase_registrierungen_in_session(
    *,
    registrierungen_collection: AsyncCollection,
    # Each carrying its `_id`, as the erasure's subject read them.
    registrierungen: Sequence[Mapping[str, Any]],
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one.
    session: AsyncClientSession,
) -> int:
    """Remove these registrations whole, answering how many went: the document is the person's own."""

    # No command for none.
    if not registrierungen:
        return 0

    erased = await delete_many_from_db(
        collection=registrierungen_collection, db_filter={"_id": {"$in": [row["_id"] for row in registrierungen]}}, session=session
    )

    return erased.deleted_count
