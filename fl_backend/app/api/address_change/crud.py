"""
API · an address change's reads and writes: what the address holds, the start, the effect and every ending

Every route, the hourly pass and the erasure start, judge, move and end a change through these functions, so no two of
them part on what a change moves or what its end leaves behind.

Invariants:
- The effect moves everything the address holds in its caller's transaction, a grant included, and nothing else.
- Every end takes the record's addresses and reason out of it.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final, Literal

from bson import ObjectId
from pymongo import DESCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.action_log.crud import reattribute_administrator_in_session
from app.api.address_change.services import (
    LIVE_TERMS,
    asks_the_address_on_file,
    build_address_filter,
    build_owed_carry_filter,
    compose_end_update,
    find_expired_refusal,
    find_new_granted_refusal,
    find_occupied_refusal,
    find_taken_refusal,
    masked_address,
    wait_tier,
)
from app.api.bewerbungen.services import days_after
from app.api.grants.crud import move_the_grant_in_session, owe_in_session, pull_the_list_to_judge
from app.api.grants.schemas import FLGrantNoticeStage
from app.api.grants.services import compose_notice
from app.api.identity.lookup import RecordCollections
from app.api.identity.services import is_own_schiedsrichter, is_own_spieler, own_seats
from app.api.kontakte.services import rows_seating, same_address
from app.api.outbox.schemas import (
    FLAddressChangeDiscardedData,
    FLAddressChangeEffectiveData,
    FLAddressChangeLinkData,
    FLAddressChangeNoticeData,
    FLOutboxLink,
    FLOutboxReference,
    FLOutboxStatus,
)
from app.api.outbox.services import SIGN_IN_KINDS, TOMBSTONE_UPDATE, OwedMail, enqueue_mails, final_update
from app.api.registrierungen.crud import judge_the_mailbox_in_session
from app.api.registrierungen.services import (
    SUBMITTED,
    build_erasure_registrierung_filter,
    compose_confirmation,
    confirmation_mail,
    registrierung_is_confirmed,
)
from app.api.schiedsrichter.services import build_self_referee_filter
from app.api.spieler.crud import another_pupil_holds
from app.api.spieler.services import build_self_pupil_filter
from app.core.clock import german_day
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, delete_many_from_db, patch_many_in_db, patch_one_in_db, post_one_to_db
from app.core.exceptions import WriteRefusal, as_judged_on_stored_state
from app.core.readonly import ReadCollection
from app.core.recording import ACT_BY_SYSTEM, record_act
from app.shared.folding import sign_in_identifier
from app.shared.schemas.bounds import REGISTRIERUNG_CONFIRMATION_DEADLINE_DAYS
from app.shared.schemas.literals import FLAddressChangeEndKind, FLAddressChangeWay, FLAdminTier

_SPIELER_FIELDS: Final[Mapping[str, int]] = {"email": 1, "einwilligung": 1}
# The whole consent record: `is_own_schiedsrichter` judges its stamp.
_SCHIEDSRICHTER_FIELDS: Final[Mapping[str, int]] = {"kontakt.email": 1, "einwilligung": 1}
_SEAT_FIELDS: Final[Mapping[str, int]] = {"saison_id": 1, "team_id": 1, "kontakte": 1, "confirmations": 1}
_REGISTRIERUNG_FIELDS: Final[Mapping[str, int]] = {"email": 1, "einwilligung": 1, "confirmation": 1, "saison_id": 1, "team_id": 1, "status": 1}


@dataclass(frozen=True, kw_only=True)
class Holdings:
    """Everything an address holds as its person's own: what a change moves."""

    identifier: str
    spieler: Mapping[str, Any] | None
    schiedsrichter: Sequence[Mapping[str, Any]]
    seats: Sequence[tuple[Mapping[str, Any], tuple[str, ...]]]
    bewerbung_seats: Sequence[tuple[Mapping[str, Any], tuple[str, ...]]]
    # Every registration, its pupil's confirmation or not: an open one left here, an admission would make a second person,
    # and a declined one an erasure of the new address would miss until its days are out.
    registrierungen: Sequence[Mapping[str, Any]]
    # The grant row, a waiting one too: it moves with the rest, and its tier sets how long the change waits.
    grant: Mapping[str, Any] | None

    @property
    def waits_as(self) -> FLAdminTier | None:
        return wait_tier(self.grant)

    @property
    def empty(self) -> bool:
        return not (self.spieler or self.schiedsrichter or self.seats or self.bewerbung_seats or self.registrierungen or self.grant)


async def live_grant_of(identifier: str, *, grants_collection: ReadCollection, session: AsyncClientSession | None) -> Mapping[str, Any] | None:
    """The grant this folded address holds, by `uniq_grant_address`'s equality."""

    return await grants_collection.find_one({"address": identifier}, session=session)


async def read_the_holdings(
    identifier: str,
    *,
    records: RecordCollections,
    grants_collection: ReadCollection,
    session: AsyncClientSession | None,
) -> Holdings:
    """Everything `identifier` holds as its person's own, read unbounded: a capped read would leave a record at the replaced address.

    `session` is the writing transaction's, so the effect moves what it judged; `None` for a read alone.
    """

    identifier = sign_in_identifier(identifier)
    spieler = await records.spieler_collection.find_one(build_self_pupil_filter(identifier), projection=dict(_SPIELER_FIELDS), session=session)
    referees = await aggregate_many_from_db(
        collection=records.schiedsrichter_collection,
        pipeline=[
            {"$match": build_self_referee_filter(identifier)},
            {"$project": dict(_SCHIEDSRICHTER_FIELDS)},
            {"$sort": {"_id": 1}},
        ],
        session=session,
    )
    seat_rows = await aggregate_many_from_db(
        collection=records.saison_teams_collection,
        pipeline=[{"$match": rows_seating(identifier)}, {"$project": dict(_SEAT_FIELDS)}, {"$sort": {"_id": 1}}],
        session=session,
    )
    # Every status: an accepted application keeps its seats, and the erasure of the new address reaches them only there.
    bewerbung_rows = await aggregate_many_from_db(
        collection=records.bewerbungen_collection,
        pipeline=[{"$match": rows_seating(identifier)}, {"$project": {"kontakte": 1, "confirmations": 1}}, {"$sort": {"_id": 1}}],
        session=session,
    )
    registrierungen = await aggregate_many_from_db(
        collection=records.registrierungen_collection,
        pipeline=[
            {"$match": build_erasure_registrierung_filter(identifier)},
            {"$project": dict(_REGISTRIERUNG_FIELDS)},
            {"$sort": {"_id": 1}},
        ],
        session=session,
    )

    return Holdings(
        identifier=identifier,
        spieler=spieler,
        schiedsrichter=[row for row in referees if is_own_schiedsrichter(row, identifier)],
        seats=[(row, tuple(slots)) for row in seat_rows if (slots := own_seats(row, identifier))],
        bewerbung_seats=[(row, tuple(slots)) for row in bewerbung_rows if (slots := own_seats(row, identifier))],
        registrierungen=registrierungen,
        grant=await live_grant_of(identifier, grants_collection=grants_collection, session=session),
    )


@dataclass(frozen=True, kw_only=True)
class Occupancy:
    """What `address_taken` reads beyond the records: the grants and the changes owing a carry."""

    grants_collection: ReadCollection
    address_changes_collection: ReadCollection


async def address_taken(email: str, *, records: RecordCollections, occupancy: Occupancy, session: AsyncClientSession | None) -> bool:
    """Whether an entry names the new address, which refuses the change.

    Confirmed or not, never only what a change would move: each admits a sign-in there, now or once confirmed or granted.
    """

    folded = sign_in_identifier(email)
    reads: list[tuple[ReadCollection, Mapping[str, Any]]] = [
        (records.spieler_collection, build_self_pupil_filter(folded)),
        (records.schiedsrichter_collection, build_self_referee_filter(folded)),
        (records.saison_teams_collection, rows_seating(folded)),
        (records.bewerbungen_collection, rows_seating(folded)),
        (records.registrierungen_collection, build_erasure_registrierung_filter(folded)),
        # As stored, as the account sweep reads it: a row the comparison has not seen yet still keeps an account.
        (occupancy.grants_collection, {"address": folded}),
        # The account still standing there until its own carry moves it off.
        (occupancy.address_changes_collection, build_owed_carry_filter([folded])),
    ]
    # One read at a time, as a session runs them: `$unionWith` would send one command, and no transaction takes it.
    for collection, db_filter in reads:
        if await collection.find_one(db_filter, {"_id": 1}, session=session) is not None:
            return True

    return False


async def a_confirmed_person_stands_at(
    email: str, *, records: RecordCollections, occupancy: Occupancy, session: AsyncClientSession | None
) -> bool:
    """Whether an entry a person confirmed names this address, or an account still standing there is owed its carry off.

    What the hourly pass holds against a holder's change. Anyone can enter an address in a public form, or an administrator
    in a seat, so an entry nobody confirmed joins no two people, and honouring one would let it stop a change only the owner
    stops.
    """

    held = await read_the_holdings(email, records=records, grants_collection=occupancy.grants_collection, session=session)
    if (
        (held.spieler is not None and is_own_spieler(held.spieler))
        or held.schiedsrichter
        or held.seats
        or held.bewerbung_seats
        or any(registrierung_is_confirmed(einwilligung=row.get("einwilligung")) for row in held.registrierungen)
    ):
        return True

    owed = await occupancy.address_changes_collection.find_one(build_owed_carry_filter([held.identifier]), {"_id": 1}, session=session)

    return owed is not None


async def end_the_change_in_session(
    *,
    address_changes_collection: AsyncCollection,
    # The judgement: a change it matches not is a miss, `DocumentNotFoundError`, before any write.
    db_filter: Mapping[str, Any],
    kind: FLAddressChangeEndKind,
    now: datetime,
    session: AsyncClientSession,
) -> Mapping[str, Any]:
    """End one live change, answering it as it stood: the one body every ending runs."""

    return await patch_one_in_db(
        collection=address_changes_collection,
        db_filter={**db_filter, **LIVE_TERMS},
        update=compose_end_update(kind=kind, now=now),
        session=session,
        expected_version=None,
        return_document=ReturnDocument.BEFORE,
    )


async def start_the_change_in_session(
    *,
    record: Mapping[str, Any],
    address_changes_collection: AsyncCollection,
    grants_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> ObjectId:
    """End the address's live change as replaced, then insert the new one, answering its id.

    Anchored on the grants: an addition reads no live change this insert has not committed, and this start reads no grant that
    addition has not, so without a row in common both land and a change stands at a grant nobody could start it on.
    """

    await pull_the_list_to_judge(grants_collection=grants_collection, session=session)

    replaced = await address_changes_collection.find_one(build_address_filter(str(record["address"])), {"_id": 1}, session=session)
    ended = None
    if replaced is not None:
        ended = await end_the_change_in_session(
            address_changes_collection=address_changes_collection,
            db_filter={"_id": replaced["_id"]},
            kind="replaced",
            now=now,
            session=session,
        )

    # Two starts on one address meet at `uniq_address_change_address` as a write conflict, which the transaction retries.
    created = await post_one_to_db(collection=address_changes_collection, document=record, session=session)

    if ended is not None:
        await tell_the_holders_of_the_end_in_session(
            ended,
            grants_collection=grants_collection,
            outbox_collection=outbox_collection,
            now=now,
            session=session,
        )

    return created.inserted_id


# Why the effect is refused, in the order the link's view ranks its states.
FLAddressChangeCause = Literal["expired", "taken", "new_granted", "occupied"]


@dataclass(frozen=True, kw_only=True)
class Verdict:
    """What the effect's judgement found: a cause refusing it, or nothing to move.

    A cause rather than its refusal, so the link's view and the pass read it without a check they never raise.
    """

    cause: FLAddressChangeCause | None
    empty: bool


def _reference(address_change_id: ObjectId) -> FLOutboxReference:
    return FLOutboxReference(collection=Collection.ADDRESS_CHANGES, id=address_change_id, seat=None)


async def state_of_the_link(
    *, outbox_collection: ReadCollection, address_change_id: ObjectId, session: AsyncClientSession | None = None
) -> FLOutboxStatus | None:
    """What became of the new mailbox's last link mail, never the address on file's notice owed about the same change."""

    newest = await outbox_collection.find_one(
        {**_reference_filter(address_change_id), "kind": "address_change_link"},
        {"state": 1, "delivery": 1},
        sort=[("recorded_at", DESCENDING), ("_id", DESCENDING)],
        session=session,
    )

    return None if newest is None else FLOutboxStatus.model_validate(newest)


def _reference_filter(address_change_id: ObjectId) -> dict[str, Any]:
    # Equality on the three keys of `outbox_reference` and its sort after them (`app/core/constraints.py :: SUPPORT_INDEXES`).
    return {"reference.collection": str(Collection.ADDRESS_CHANGES), "reference.id": address_change_id, "reference.seat": None}


async def owe_the_link_in_session(
    *,
    address_change_id: ObjectId,
    email: str,
    way: FLAddressChangeWay,
    valid_until: datetime,
    holder: FLAdminTier | None,
    outbox_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Owe the new mailbox its link, minted at the hand-out in place of any before it, in the caller's transaction.

    `email` as the record stores it: the hand-out mints only while the record still names it, so a change ended or
    replaced since mails nothing. Keyed by the write's instant, a re-send owing a mail of its own. The row ends with the
    link: the mail promises its hours, and a late one would carry a dead link.
    """

    await enqueue_mails(
        outbox_collection=outbox_collection,
        session=session,
        mails=[
            OwedMail(
                key=f"address_changes/{address_change_id}/link/{now.isoformat()}",
                to=email,
                data=FLAddressChangeLinkData(kind="address_change_link", way=way, holder=holder),
                reference=_reference(address_change_id),
                link=FLOutboxLink(paths=["token_hashes"], addresses=["email"], replaced=True),
                valid_until=valid_until,
            )
        ],
        now=now,
    )


async def owe_the_notice_in_session(
    *,
    address_change_id: ObjectId,
    address: str,
    way: FLAddressChangeWay,
    valid_until: datetime,
    holder: FLAdminTier | None,
    outbox_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Owe the address on file its notice of the change, with the stop link, minted beside any earlier hand-out's.

    The person's own change asks it a question, whose row ends with its deadline; a lost-mailbox notice's stop answers past
    every deadline, so it keeps the mail's own.
    """

    await enqueue_mails(
        outbox_collection=outbox_collection,
        session=session,
        mails=[
            OwedMail(
                key=f"address_changes/{address_change_id}/notice",
                to=address,
                data=FLAddressChangeNoticeData(kind="address_change_notice", way=way, holder=holder),
                reference=_reference(address_change_id),
                link=FLOutboxLink(paths=["stop.token_hashes"], addresses=["address"], replaced=False),
                valid_until=valid_until if way == "account" else None,
            )
        ],
        now=now,
    )


async def owe_the_refusal_notice_in_session(
    record: Mapping[str, Any], *, outbox_collection: AsyncCollection, now: datetime, session: AsyncClientSession
) -> None:
    """A confirmed change's notice that it did not take effect, owed in its end's transaction.

    Off the record as it stood before the end: never why, nor the address on file.
    """

    await enqueue_mails(
        outbox_collection=outbox_collection,
        session=session,
        mails=[
            OwedMail(
                key=f"address_changes/{record['_id']}/discarded",
                to=str(record["email"]),
                data=FLAddressChangeDiscardedData(kind="address_change_discarded"),
            )
        ],
        now=now,
    )


async def tell_the_holders_in_session(
    record: Mapping[str, Any],
    *,
    stage: FLGrantNoticeStage,
    effective_from: datetime | None,
    grants_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
    # Off where the new address is the erased one: a mask of it is no fact left to tell.
    names_the_new_address: bool = True,
) -> None:
    """Tell every holder in effect of a holder's change, in the caller's transaction, `record` as it stood.

    The new address masked: it is the holder's private mailbox, and the readers need to recognise it, never to write to it.
    """

    notice = compose_notice(
        grant_id=record["_id"],
        change="address",
        stage=stage,
        address=str(record["address"]),
        new_address=masked_address(str(record["email"])) if names_the_new_address else None,
        effective_from=effective_from,
    )
    await owe_in_session(
        [notice],
        outbox_collection=outbox_collection,
        grants_collection=grants_collection,
        now=now,
        session=session,
    )


async def tell_the_holders_of_the_end_in_session(
    record: Mapping[str, Any],
    *,
    grants_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
    names_the_new_address: bool = True,
) -> None:
    """The withdrawal's notice of a holder's change ended in its wait, `record` as it stood: one not yet started told nobody."""

    if record.get("confirmed_at") is None:
        return
    if await live_grant_of(str(record["address"]), grants_collection=grants_collection, session=session) is None:
        return

    await tell_the_holders_in_session(
        record,
        stage="withdrawn",
        effective_from=None,
        grants_collection=grants_collection,
        outbox_collection=outbox_collection,
        now=now,
        session=session,
        names_the_new_address=names_the_new_address,
    )


async def judge_the_effect_in_session(
    *,
    record: Mapping[str, Any],
    holdings: Holdings,
    records: RecordCollections,
    spieler_collection: ReadCollection,
    grants_collection: ReadCollection,
    occupancy: Occupancy,
    # The link's own deadline, judged first.
    expired: bool,
    session: AsyncClientSession | None,
    # Set by the hourly pass alone, asking of a change whose wait ended.
    at_the_pass: bool = False,
) -> Verdict:
    """Every judgement the effect makes, in the order the link's view ranks its states, read in `session`.

    The confirmation, the hourly pass and the link's view all ask it, so none of them parts on what refuses, but for one
    case: at the pass a holder's change meets only `taken`, `new_granted` and an entry a person confirmed
    (`a_confirmed_person_stands_at`).
    """

    new_address = str(record["email"])
    if expired:
        return Verdict(cause="expired", empty=False)

    if holdings.empty:
        return Verdict(cause=None, empty=True)

    if holdings.spieler is not None and await another_pupil_holds(
        spieler_collection=spieler_collection, identifier=sign_in_identifier(new_address), spieler_id=holdings.spieler["_id"], session=session
    ):
        return Verdict(cause="taken", empty=False)

    if holdings.grant is not None and (
        await live_grant_of(sign_in_identifier(new_address), grants_collection=grants_collection, session=session) is not None
    ):
        return Verdict(cause="new_granted", empty=False)

    # After the causes naming one kind of entry, so a press names the specific one; judged in the effect's own read, so
    # nothing reaches the new address between this judgement and the move.
    judged = a_confirmed_person_stands_at if at_the_pass and holdings.grant is not None else address_taken
    if await judged(new_address, records=records, occupancy=occupancy, session=session):
        return Verdict(cause="occupied", empty=False)

    return Verdict(cause=None, empty=False)


def refusal_of(cause: FLAddressChangeCause | None) -> WriteRefusal | None:
    """The refusal a press answers for the judgement's cause, where the link's view shows a state and the pass ends the change.

    On no field: the press's body holds its token and its answer, and the box these two name is the address tool's.
    """

    match cause:
        case None:
            return None
        case "expired":
            return find_expired_refusal(expired=True)
        case "taken":
            return as_judged_on_stored_state(find_taken_refusal(taken=True), twins={})
        case "new_granted":
            return find_new_granted_refusal(granted=True)
        case "occupied":
            return as_judged_on_stored_state(find_occupied_refusal(occupied=True), twins={})


async def move_the_address_in_session(
    *,
    record: Mapping[str, Any],
    holdings: Holdings,
    address_changes_collection: AsyncCollection,
    spieler_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    grants_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    action_log_collection: AsyncCollection,
    mailbox_anchors_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Move everything `holdings` holds to the change's address in the caller's transaction, then end it as taken effect."""

    new_address = str(record["email"])

    if holdings.spieler is not None:
        # Folded as every start stores it, and again here: the sign-in seam joins on this field by equality.
        await patch_one_in_db(
            collection=spieler_collection,
            db_filter={"_id": holdings.spieler["_id"]},
            update={"$set": {"email": sign_in_identifier(new_address)}},
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )

    for row in holdings.schiedsrichter:
        await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": row["_id"]},
            update={"$set": {"kontakt.email": new_address}},
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )

    for row, slots in holdings.seats:
        await patch_one_in_db(
            collection=saison_teams_collection,
            db_filter={"_id": row["_id"]},
            update=_seat_move(slots, new_address),
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )

    for row, slots in holdings.bewerbung_seats:
        await patch_one_in_db(
            collection=bewerbungen_collection,
            db_filter={"_id": row["_id"]},
            update=_seat_move(slots, new_address),
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )

    for row in holdings.registrierungen:
        await _move_the_registrierung_in_session(
            row,
            new_address=new_address,
            registrierungen_collection=registrierungen_collection,
            saison_teams_collection=saison_teams_collection,
            mailbox_anchors_collection=mailbox_anchors_collection,
            outbox_collection=outbox_collection,
            now=now,
            session=session,
        )

    if holdings.grant is not None:
        await move_the_grant_in_session(
            holdings.grant, new_address=sign_in_identifier(new_address), grants_collection=grants_collection, now=now, session=session
        )

    await end_the_change_in_session(
        address_changes_collection=address_changes_collection,
        db_filter={"_id": record["_id"]},
        kind="effective",
        now=now,
        session=session,
    )

    # A record the effect leaves naming the replaced address by address alone would outlive the person's erasure at the new one.
    old, new = holdings.identifier, sign_in_identifier(new_address)
    await reattribute_administrator_in_session(action_log_collection=action_log_collection, identifier=old, value=new, session=session)
    if holdings.grant is not None:
        await record_act(
            collection=address_changes_collection,
            action="grant.address_switched",
            by=ACT_BY_SYSTEM,
            record_id=record["_id"],
            label=new,
            session=session,
        )
    # An earlier effect's carry still owed takes its account to where the person is now, and an erasure there finds it.
    await patch_many_in_db(
        collection=address_changes_collection, db_filter={"move.new": old}, update={"$set": {"move.new": new}}, session=session
    )
    await _carry_the_mail(outbox_collection, old, new, session=session)
    # The lost-mailbox way carries no account: whatever its old mailbox's holder enrolled meanwhile would follow. The carry is
    # owed on the ended record itself, in this transaction, so a commit whose answer was lost still owes it.
    if record["way"] != "waiting_period":
        await patch_many_in_db(
            collection=address_changes_collection,
            db_filter={"_id": record["_id"]},
            update={"$set": {"move": {"old": old, "new": new}}},
            session=session,
        )
    # The person's own change taking effect at the new mailbox's press owes the replaced mailbox nothing more: it confirmed
    # the change through its own link, and the new mailbox confirmed it last, so both already know. A holder's takes effect
    # later, at the hourly pass, and tells the replaced mailbox then.
    if record["way"] != "account" or record.get("confirmed_at") is not None:
        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=[
                OwedMail(
                    key=f"address_changes/{record['_id']}/effective",
                    to=old,
                    data=FLAddressChangeEffectiveData(kind="address_change_effective", instant=now),
                )
            ],
            now=now,
        )
    if holdings.grant is not None:
        await tell_the_holders_in_session(
            record,
            stage="completed",
            effective_from=None,
            grants_collection=grants_collection,
            outbox_collection=outbox_collection,
            now=now,
            session=session,
        )


async def _carry_the_mail(outbox_collection: AsyncCollection, old: str, new: str, *, session: AsyncClientSession) -> None:
    """The person's mail follows them: what is owed the replaced address goes to the new one, and what was sent there keeps its key alone.

    A sent mail's recipient and delivery state describe the replaced mailbox, which on the lost-mailbox way may be a
    stranger's, so they go, and with them the record and seat it is about, so no editor reads that mailbox's delivery as
    the seat's. The row stands as a tombstone of its key: a pass deciding by its key whether a mail was owed (the line-up
    reminder's) or a replayed write would otherwise owe it a second time, to the new address. The tombstone goes a
    retention after its final state, as the row would have. The sign-in library's mails stay where they were owed, each
    tied to the sign-in it was asked from. Matched on the sign-in fold, a recipient being stored as its mail was owed;
    then written by id.
    """

    rows = await aggregate_many_from_db(
        collection=outbox_collection,
        pipeline=[{"$match": {"kind": {"$nin": sorted(SIGN_IN_KINDS)}, "to": same_address(old)}}, {"$project": {"to": 1, "state": 1}}],
        session=session,
    )
    held = [row for row in rows if sign_in_identifier(str(row["to"])) == old]
    if open := [row["_id"] for row in held if row["state"] == "open"]:
        await patch_many_in_db(collection=outbox_collection, db_filter={"_id": {"$in": open}}, update={"$set": {"to": new}}, session=session)
    if sent := [row["_id"] for row in held if row["state"] != "open"]:
        await patch_many_in_db(collection=outbox_collection, db_filter={"_id": {"$in": sent}}, update=TOMBSTONE_UPDATE, session=session)


def _seat_move(slots: Sequence[str], new_address: str) -> dict[str, Any]:
    """The seats' address."""

    return {"$set": {f"kontakte.{slot}.email": new_address for slot in slots}}


async def _move_the_registrierung_in_session(
    row: Mapping[str, Any],
    *,
    new_address: str,
    registrierungen_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    mailbox_anchors_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """The registration's address; an unanswered one's live links die, and a pending one is owed a fresh link at the new mailbox.

    Every link was minted for the address the row has left, so none confirms it now. A pending row is judged at the new
    mailbox as a submission is, its confirmation mail owed there under a key of this move, with a deadline the mail's
    stated days from today, and its own unsent mail to the old address dropped: one mail, telling the truth about its
    days. A mailbox already holding `OPEN_LINKS_PER_MAILBOX` unanswered links, or a club that left the season, is owed
    none: the row lapses unmailed, holding no place at the new mailbox.
    """

    update: dict[str, Any] = {"$set": {"email": new_address}}
    if not isinstance(row.get("confirmation"), Mapping) or registrierung_is_confirmed(einwilligung=row.get("einwilligung")):
        await _patch_the_registrierung(registrierungen_collection, row, update, session=session)
        return

    if row.get("status") != SUBMITTED:
        # A decided row takes no answer, so its links only die.
        update["$set"] |= {"confirmation.token_hashes": []}
        await _patch_the_registrierung(registrierungen_collection, row, update, session=session)
        return

    saison_id = str(row["saison_id"])
    junction = await saison_teams_collection.find_one(
        {"saison_id": saison_id, "team_id": row["team_id"]}, {"name": 1, "austritt": 1}, session=session
    )
    stands = junction is not None and junction.get("austritt") is None
    mailed = stands and await judge_the_mailbox_in_session(
        registrierungen_collection=registrierungen_collection,
        mailbox_anchors_collection=mailbox_anchors_collection,
        saison_id=saison_id,
        address=new_address,
        excluding_id=row["_id"],
        at=now,
        session=session,
    )
    today = german_day(now)
    update["$set"] |= {
        "confirmation": compose_confirmation(
            today=today, deadline=days_after(day=today, days=REGISTRIERUNG_CONFIRMATION_DEADLINE_DAYS), mailed=mailed
        )
    }
    await _patch_the_registrierung(registrierungen_collection, row, update, session=session)

    # Before the carry below, which re-addresses what is still owed: the mail owed the old address would state its own days.
    await patch_many_in_db(
        collection=outbox_collection,
        db_filter={**_registrierung_reference_filter(row["_id"]), "kind": "registrierung_confirmation", "state": "open"},
        update=final_update("dropped", now=now),
        session=session,
    )
    if mailed:
        assert junction is not None
        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=[
                confirmation_mail(
                    registrierung_id=row["_id"],
                    key=f"{Collection.REGISTRIERUNGEN}/{row['_id']}/confirmation/{now.isoformat()}",
                    address=new_address,
                    team=str(junction["name"]),
                    saison_id=saison_id,
                )
            ],
            now=now,
        )


def _registrierung_reference_filter(registrierung_id: Any) -> dict[str, Any]:
    # Equality on the three keys of `outbox_reference` (`app/core/constraints.py :: SUPPORT_INDEXES`).
    return {"reference.collection": str(Collection.REGISTRIERUNGEN), "reference.id": registrierung_id, "reference.seat": None}


async def _patch_the_registrierung(
    registrierungen_collection: AsyncCollection, row: Mapping[str, Any], update: Mapping[str, Any], *, session: AsyncClientSession
) -> None:
    await patch_one_in_db(
        collection=registrierungen_collection,
        db_filter={"_id": row["_id"]},
        update=update,
        session=session,
        expected_version=None,
        return_document=ReturnDocument.BEFORE,
    )


# --- The ERASURE's reach: a change naming the erased address ends, and an administrator it names takes the marker.


def build_erasure_address_change_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every live change whose address on file, or whose new address, is this one, each stored folded."""

    folded = sign_in_identifier(identifier)

    # Each clause its index's, the live terms inside each: beside the `$or` they leave the planner no indexed plan, and it
    # scans every tombstone. The key's type stated for `build_address_filter`'s reason.
    return [
        {"$match": {"$or": [build_address_filter(folded), {"email": folded, **LIVE_TERMS}]}},
        {"$project": {"address": 1, "email": 1, "way": 1, "released_at": 1, "confirmed_at": 1}},
        {"$sort": {"_id": 1}},
    ]


def others_naming(rows: Sequence[Mapping[str, Any]], identifier: str) -> list[Mapping[str, Any]]:
    """The changes of other addresses naming this one as their new address: the previews' rows, the address's own being its own."""

    return [row for row in rows if row.get("address") != identifier]


def known_to_the_new_mailbox(rows: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """The ones whose link was owed the new mailbox: one still awaiting the address on file has none."""

    return [row for row in rows if not asks_the_address_on_file(row)]


async def end_the_address_changes_in_session(
    *,
    address_changes_collection: AsyncCollection,
    grants_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    identifier: str,
    # The subject's rows, read before the erasure's first write.
    rows: Sequence[Mapping[str, Any]],
    now: datetime,
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one.
    session: AsyncClientSession,
) -> int:
    """End every change naming the erased address.

    Each change's mails go with it, owed or sent: its link went to the person's other mailbox, or to theirs from another's
    change. Another holder's change in its wait tells the holders, who hold a date it will not reach, naming no new address:
    that is the erased one. The erased holder's own tells nothing, their grant's end telling the holders that.
    """

    if rows:
        await delete_many_from_db(
            collection=outbox_collection,
            db_filter={
                "reference.collection": str(Collection.ADDRESS_CHANGES),
                "reference.id": {"$in": [row["_id"] for row in rows]},
                "reference.seat": None,
            },
            session=session,
        )

    for row in rows:
        await end_the_change_in_session(
            address_changes_collection=address_changes_collection,
            db_filter={"_id": row["_id"]},
            kind="discarded",
            now=now,
            session=session,
        )

    for row in others_naming(rows, identifier):
        await tell_the_holders_of_the_end_in_session(
            row,
            grants_collection=grants_collection,
            outbox_collection=outbox_collection,
            now=now,
            session=session,
            names_the_new_address=False,
        )

    # A carry still owed off or onto the erased address goes: the erasure takes the account it would move, or the address
    # it would move one to.
    await patch_many_in_db(
        collection=address_changes_collection,
        db_filter={"$or": [{"move.old": identifier}, {"move.new": identifier}]},
        update={"$unset": {"move": ""}},
        session=session,
    )

    return len(rows)


async def end_an_emptied_change_in_session(
    *,
    address_changes_collection: AsyncCollection,
    grants_collection: AsyncCollection,
    records: RecordCollections,
    identifier: str,
    now: datetime,
    session: AsyncClientSession,
) -> int:
    """End the address's live change where the pupil's erasure left the address holding nothing for it to move.

    The season's erasure takes the pupil alone, so a change standing for the address's other records stays.
    """

    live = await address_changes_collection.find_one(build_address_filter(identifier), {"_id": 1}, session=session)
    if live is None:
        return 0

    holdings = await read_the_holdings(identifier, records=records, grants_collection=grants_collection, session=session)
    if not holdings.empty:
        return 0

    await end_the_change_in_session(
        address_changes_collection=address_changes_collection,
        db_filter={"_id": live["_id"]},
        kind="discarded",
        now=now,
        session=session,
    )

    return 1
