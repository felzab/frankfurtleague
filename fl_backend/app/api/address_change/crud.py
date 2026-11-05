"""
API · an address change's reads and writes: what the address holds, the start, the effect and every ending

Every route, the hourly pass, the erasure and the restore's replay start, judge, move and end a change through these
functions, so no two of them part on what a change moves or what its end leaves behind.

Invariants:
- The effect moves everything the address holds in its caller's transaction, a grant included, and nothing else.
- Every end takes the record's addresses and reason out of it; its log images lose what no record holds after it: the
  new address and the reason on every end but the effect, the replaced address on the effect.
"""

from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final, Literal

from bson import ObjectId
from pydantic import SecretStr
from pymongo import DESCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.address_change.services import (
    LIVE_TERMS,
    asks_the_address_on_file,
    build_address_filter,
    build_owed_carry_filter,
    compose_approval_withdrawn_update,
    compose_end_update,
    covers,
    find_confirmation_barred_refusal,
    find_expired_refusal,
    find_new_granted_refusal,
    find_not_covered_refusal,
    find_occupied_refusal,
    find_replaced_barred_refusal,
    find_taken_refusal,
)
from app.api.aktionen.crud import (
    carry_the_replaced_address_in_images,
    reattribute_administrator_in_session,
    redact_images_in_session,
)
from app.api.berechtigungen.antraege import approval_request_line, build_open_filter, end_the_approval_requests_about_in_session
from app.api.berechtigungen.crud import grant_in_session, read_berechtigungen, read_the_announced, revoke_in_session
from app.api.berechtigungen.loeschung import carry_authorship_in_session
from app.api.berechtigungen.services import approval_stands, compose_carried
from app.api.identity.lookup import RecordCollections
from app.api.identity.services import address_change_viewable_denied, is_own_schiedsrichter, own_seats
from app.api.kontakte.services import find_matching_slots, rows_seating, same_address
from app.api.outbox.schemas import (
    FLAddressChangeDiscardedData,
    FLAddressChangeEffectiveData,
    FLAddressChangeLinkData,
    FLAddressChangeNoticeData,
    FLOutboxLink,
    FLOutboxReference,
    FLOutboxStatus,
)
from app.api.outbox.services import SIGN_IN_KINDS, OwedMail, enqueue_mails
from app.api.registrierungen.services import build_loeschung_registrierung_filter, registrierung_ist_bestaetigt
from app.api.schiedsrichter.services import build_self_referee_filter, vorname_of
from app.api.sperrliste.lookup import BanList, Saison, barred_addresses
from app.api.spielbestaetigungen.services import (
    build_contact_reason_images_filter,
    build_contact_reasons_filter,
    contact_reason_image_edits,
    halter_of,
    seat_void_of,
)
from app.api.spieler.crud import another_pupil_holds
from app.api.spieler.services import build_self_pupil_filter
from app.api.teams.crud import void_moved_seats
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, erase_many_from_db, patch_many_in_db, patch_one_in_db, post_one_to_db
from app.core.exceptions import WriteRefusal
from app.core.journal import Journal, JournalLine
from app.core.readonly import ReadCollection
from app.core.recording import ERASED_ACTOR_MARKER, build_redaction_filter, log_stamp
from app.core.security import actor_pseudonym, erasure_journal_hash
from app.shared.folding import sign_in_identifier
from app.shared.schemas.literals import FLAddressChangeEndKind, FLAddressChangeViewableDenied, FLAddressChangeWay

_SPIELER_FIELDS: Final[Mapping[str, int]] = {"vorname": 1, "nachname": 1, "email": 1}
# The whole consent record: `is_own_schiedsrichter` judges its stamp.
_SCHIEDSRICHTER_FIELDS: Final[Mapping[str, int]] = {"name": 1, "kontakt.email": 1, "einwilligung": 1}
_SEAT_FIELDS: Final[Mapping[str, int]] = {"saison_id": 1, "team_id": 1, "kontakte": 1, "confirmations": 1}
_REGISTRIERUNG_FIELDS: Final[Mapping[str, int]] = {"email": 1, "vorname": 1, "nachname": 1, "einwilligung": 1, "confirmation": 1}


@dataclass(frozen=True, kw_only=True)
class Holdings:
    """Everything an address holds as its person's own: what a change moves."""

    identifier: str
    spieler: Mapping[str, Any] | None
    schiedsrichter: Sequence[Mapping[str, Any]]
    seats: Sequence[tuple[Mapping[str, Any], tuple[str, ...]]]
    bewerbung_seats: Sequence[tuple[Mapping[str, Any], tuple[str, ...]]]
    # Every registration, its pupil's confirmation or not: an open one left here, an admission would make a second person,
    # and a declined one an erasure of the new address would miss until its month is out.
    registrierungen: Sequence[Mapping[str, Any]]
    # The live grant, which moves with the rest once another administrator approved it.
    grant: Mapping[str, Any] | None

    @property
    def empty(self) -> bool:
        return not (self.spieler or self.schiedsrichter or self.seats or self.bewerbung_seats or self.registrierungen or self.grant)

    @property
    def vorname(self) -> str:
        """Whom the notices greet: the first name the first record holding one stores, or none."""

        candidates = [
            *([] if self.spieler is None else [self.spieler.get("vorname")]),
            *(vorname_of(row.get("name")) for row in self.schiedsrichter),
            *((row.get("kontakte") or {}).get(slot, {}).get("vorname") for row, slots in self.seats for slot in slots),
            *((row.get("kontakte") or {}).get(slot, {}).get("vorname") for row, slots in self.bewerbung_seats for slot in slots),
            *(row.get("vorname") for row in self.registrierungen),
        ]

        return next((str(name) for name in candidates if isinstance(name, str) and name), "")


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
            {"$match": build_loeschung_registrierung_filter(identifier)},
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
    """What `address_taken` reads beyond the records: the grants, their open requests and the changes owing a carry."""

    grants_collection: ReadCollection
    grant_approval_requests_collection: ReadCollection
    address_changes_collection: ReadCollection
    now: datetime


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
        (records.registrierungen_collection, build_loeschung_registrierung_filter(folded)),
        # As stored, as the account sweep reads it: a row the comparison has not seen yet still keeps an account.
        (occupancy.grants_collection, {"address": folded}),
        (occupancy.grant_approval_requests_collection, {"address": folded, **build_open_filter(occupancy.now)}),
        # The account still standing there until its own carry moves it off.
        (occupancy.address_changes_collection, build_owed_carry_filter([folded])),
    ]
    # One read at a time, as a session runs them: `$unionWith` would send one command, and no transaction takes it.
    for collection, db_filter in reads:
        if await collection.find_one(db_filter, {"_id": 1}, session=session) is not None:
            return True

    return False


def _redacting(fields: tuple[str, ...]) -> Callable[[Mapping[str, Any]], dict[str, None]]:
    def redacted(image: Mapping[str, Any]) -> dict[str, None]:
        return {field: None for field in fields if image.get(field) is not None}

    return redacted


async def end_the_change_in_session(
    *,
    address_changes_collection: AsyncCollection,
    action_log_collection: AsyncCollection,
    # The judgement: a change it matches not is a miss, `DocumentNotFoundError`, before any write.
    db_filter: Mapping[str, Any],
    kind: FLAddressChangeEndKind,
    now: datetime,
    stamp: str,
    session: AsyncClientSession,
    # The address on file too, where its records are gone and no erasure's address pass follows.
    without_address: bool = False,
) -> Mapping[str, Any]:
    """End one live change, answering it as it stood: the one body every ending runs.

    Its images lose the unproved address and the reason; an effect's keep both, the log's account of the move.
    """

    stored = await patch_one_in_db(
        collection=address_changes_collection,
        db_filter={**db_filter, **LIVE_TERMS},
        update=compose_end_update(kind=kind, now=now),
        session=session,
        return_document=ReturnDocument.BEFORE,
    )

    # After the patch, so it reaches the image the patch filed. An effect keeps the new address, which the person's records
    # hold and their erasure finds, and drops the replaced one, which no record holds for an erasure to find.
    redacted = ("address",) if kind == "effective" else ("email", "grund", *(("address",) if without_address else ()))
    await redact_images_in_session(
        action_log_collection=action_log_collection,
        db_filter=build_redaction_filter([(Collection.ADDRESS_CHANGES, [stored["_id"]])]),
        judge=_redacting(redacted),
        stamp=stamp,
        session=session,
    )

    return stored


EndingKind = Literal["address_change_declined", "address_change_stopped", "address_change_discarded", "address_change_discarded_notified"]


def ending_line(*, kind: EndingKind, new_address: str, record_id: ObjectId, at: str, key: SecretStr) -> JournalLine:
    """A decline's, a stop's or a discard's line, so a restore does not bring the change back to act."""

    return JournalLine(
        person_hash=erasure_journal_hash(new_address, key=key),
        kind=kind,
        collection=Collection.ADDRESS_CHANGES,
        record_id=record_id,
        at=at,
    )


def effective_line(*, record: Mapping[str, Any], now: datetime, key: SecretStr) -> JournalLine:
    """The effect's line, so a restore from a snapshot taken while the change stood is listed rather than silently undone.

    The replaced address's hash too, where a later erasure finds the records a snapshot from before the start holds.
    """

    return JournalLine(
        person_hash=erasure_journal_hash(str(record["email"]), key=key),
        kind="address_change_effective",
        collection=Collection.ADDRESS_CHANGES,
        record_id=record["_id"],
        at=log_stamp(now),
        before=erasure_journal_hash(str(record["address"]), key=key),
    )


async def start_the_change_in_session(
    *,
    record: Mapping[str, Any],
    address_changes_collection: AsyncCollection,
    action_log_collection: AsyncCollection,
    key: SecretStr,
    now: datetime,
    journal: Journal,
    session: AsyncClientSession,
) -> ObjectId:
    """End the address's live change as replaced, then insert the new one, answering its id.

    The replaced change is journalled as discarded: restored, a confirmed one would take effect unpressed.
    """

    stamp = log_stamp(now)
    replaced = await address_changes_collection.find_one(build_address_filter(str(record["address"])), {"email": 1}, session=session)
    if replaced is not None:
        await end_the_change_in_session(
            address_changes_collection=address_changes_collection,
            action_log_collection=action_log_collection,
            db_filter={"_id": replaced["_id"]},
            kind="replaced",
            now=now,
            stamp=stamp,
            session=session,
        )
        journal.note(
            ending_line(kind="address_change_discarded", new_address=str(replaced["email"]), record_id=replaced["_id"], at=stamp, key=key)
        )

    # Two starts on one address meet at `uniq_address_change_address` as a write conflict, which the transaction retries.
    created = await post_one_to_db(collection=address_changes_collection, document=record, session=session)

    return created.inserted_id


# Why the effect is refused, in the order the link's view ranks its states.
FLAddressChangeCause = Literal["new_barred", "expired", "replaced_barred", "taken", "not_covered", "new_granted", "occupied"]


@dataclass(frozen=True, kw_only=True)
class Verdict:
    """What the effect's judgement found: a cause refusing it, nothing to move, or an approval still owed.

    A cause rather than its refusal, so the link's view and the pass read it without a check they never raise.
    """

    cause: FLAddressChangeCause | None
    empty: bool
    waits: bool
    # The approval given does not stand: its approver lost the grant, the tier or their standing since, so the change
    # waits on another (`app/api/berechtigungen/services.py :: approval_stands`).
    withdrawn: bool = False


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
    outbox_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Owe the new mailbox its link, minted at the hand-out in place of any before it, in the caller's transaction.

    `email` as the record stores it: the hand-out mints only while the record still names it, so a change ended or
    replaced since mails nothing. Keyed by the write's instant, a re-send owing a mail of its own.
    """

    await enqueue_mails(
        outbox_collection=outbox_collection,
        session=session,
        mails=[
            OwedMail(
                key=f"address_changes/{address_change_id}/link/{now.isoformat()}",
                an=email,
                data=FLAddressChangeLinkData(kind="address_change_link", way=way, valid_until=valid_until),
                reference=_reference(address_change_id),
                link=FLOutboxLink(paths=["token_hashes"], addresses=["email"], replaced=True),
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
    vorname: str | None,
    outbox_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Owe the address on file its notice of the change, with the stop link, minted beside any earlier hand-out's."""

    await enqueue_mails(
        outbox_collection=outbox_collection,
        session=session,
        mails=[
            OwedMail(
                key=f"address_changes/{address_change_id}/notice",
                an=address,
                data=FLAddressChangeNoticeData(kind="address_change_notice", way=way, valid_until=valid_until, vorname=vorname),
                reference=_reference(address_change_id),
                link=FLOutboxLink(paths=["stop.token_hashes"], addresses=["address"], replaced=False),
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
                an=str(record["email"]),
                data=FLAddressChangeDiscardedData(kind="address_change_discarded"),
            )
        ],
        now=now,
    )


async def judge_the_effect_in_session(
    *,
    record: Mapping[str, Any],
    holdings: Holdings,
    records: RecordCollections,
    spieler_collection: ReadCollection,
    grants_collection: ReadCollection,
    grants_announced_collection: ReadCollection,
    sperrliste: BanList,
    governing_saison_id: Saison,
    occupancy: Occupancy,
    # The link's own deadline, judged second: a press on a lapsed link to a barred address names the ban.
    expired: bool,
    session: AsyncClientSession | None,
) -> Verdict:
    """Every judgement the effect makes, in the order the link's view ranks its states, read in `session`.

    The confirmation, the approval, the hourly pass and the link's view all ask it, so none of them parts on what refuses.
    """

    new_address, old = str(record["email"]), str(record["address"])
    barred = await barred_addresses(sperrliste, [new_address, old], governing_saison_id=governing_saison_id, session=session)
    first: list[tuple[FLAddressChangeCause, bool]] = [
        ("new_barred", new_address in barred),
        ("expired", expired),
        ("replaced_barred", old in barred),
    ]
    for cause, applies in first:
        if applies:
            return Verdict(cause=cause, empty=False, waits=False)

    if holdings.empty:
        return Verdict(cause=None, empty=True, waits=False)

    if holdings.spieler is not None and await another_pupil_holds(
        spieler_collection=spieler_collection, identifier=sign_in_identifier(new_address), spieler_id=holdings.spieler["_id"], session=session
    ):
        return Verdict(cause="taken", empty=False, waits=False)

    grant = holdings.grant
    approval = record.get("approval")
    if grant is not None:
        if not covers(approval, grant.get("admin_tier")):
            return Verdict(cause="not_covered", empty=False, waits=False)
        if await live_grant_of(sign_in_identifier(new_address), grants_collection=grants_collection, session=session) is not None:
            return Verdict(cause="new_granted", empty=False, waits=False)

    # After the causes naming one kind of entry, so a press names the specific one; judged in the effect's own read, so
    # nothing reaches the new address between this judgement and the move.
    if await address_taken(new_address, records=records, occupancy=occupancy, session=session):
        return Verdict(cause="occupied", empty=False, waits=False)

    if grant is None:
        return Verdict(cause=None, empty=False, waits=False)

    assert isinstance(approval, Mapping)
    if approval.get("approved_at") is None:
        return Verdict(cause=None, empty=False, waits=True)

    # Judged again here rather than kept from the press: a revoke, a demotion, a ban or an erasure of the approver since
    # leaves no approval standing.
    by = approval.get("approved_by")
    stands = approval_stands(
        target=old,
        approval=approval,
        grants=await read_berechtigungen(grants_collection=grants_collection, session=session),
        announced=await read_the_announced(grants_announced_collection=grants_announced_collection, session=session),
        barred=await barred_addresses(sperrliste, [by], session=session) if isinstance(by, str) else set(),
    )

    return Verdict(cause=None, empty=False, waits=not stands, withdrawn=not stands)


def refusal_of(cause: FLAddressChangeCause | None) -> WriteRefusal | None:
    """The refusal a press answers for the judgement's cause, where the link's view shows a state and the pass ends the change."""

    match cause:
        case None:
            return None
        case "new_barred":
            return find_confirmation_barred_refusal(barred=True)
        case "expired":
            return find_expired_refusal(expired=True)
        case "replaced_barred":
            return find_replaced_barred_refusal(barred=True)
        case "taken":
            return find_taken_refusal(taken=True)
        case "not_covered":
            return find_not_covered_refusal(covered=False)
        case "new_granted":
            return find_new_granted_refusal(granted=True)
        case "occupied":
            return find_occupied_refusal(occupied=True)


async def take_effect_in_session(
    *,
    record: Mapping[str, Any],
    records: RecordCollections,
    sperrliste: BanList,
    governing_saison_id: Saison,
    address_changes_collection: AsyncCollection,
    spieler_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    spielbestaetigungen_collection: AsyncCollection,
    grants_collection: AsyncCollection,
    grants_announced_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    grant_approval_requests_collection: AsyncCollection,
    invitations_collection: AsyncCollection,
    ban_list_collection: AsyncCollection,
    action_log_collection: AsyncCollection,
    key: SecretStr,
    now: datetime,
    journal: Journal,
    session: AsyncClientSession,
    # Whether a change finding nothing to move tells its new mailbox so: a confirmed one was told it waits on the effect,
    # the press's own page shows it instead.
    notify: bool,
    expired: bool = False,
    # False for a confirmation that starts a waiting time: judged as the effect will be, and moving nothing yet.
    immediately: bool = True,
) -> tuple[Verdict, bool]:
    """Judge the change and move it where nothing refuses it or is owed, answering whether it took effect.

    A change finding nothing to move ends discarded; a refusal, an owed approval and a waiting time write nothing
    (`Verdict.waits`).
    """

    holdings = await read_the_holdings(str(record["address"]), records=records, grants_collection=grants_collection, session=session)
    verdict = await judge_the_effect_in_session(
        record=record,
        holdings=holdings,
        records=records,
        spieler_collection=spieler_collection,
        grants_collection=grants_collection,
        grants_announced_collection=grants_announced_collection,
        sperrliste=sperrliste,
        governing_saison_id=governing_saison_id,
        occupancy=Occupancy(
            grants_collection=grants_collection,
            grant_approval_requests_collection=grant_approval_requests_collection,
            address_changes_collection=address_changes_collection,
            now=now,
        ),
        expired=expired,
        session=session,
    )
    if verdict.withdrawn:
        # Taken off the record, so the administrators page offers the approval again and the pass finds it due nowhere.
        await patch_one_in_db(
            collection=address_changes_collection,
            db_filter={"_id": record["_id"], **LIVE_TERMS},
            update=compose_approval_withdrawn_update(),
            session=session,
            return_document=ReturnDocument.BEFORE,
        )
    if verdict.cause is not None or verdict.waits:
        return verdict, False
    if not immediately and not verdict.empty:
        return Verdict(cause=None, empty=False, waits=True), False

    stamp = log_stamp(now)
    if verdict.empty:
        await end_the_change_in_session(
            address_changes_collection=address_changes_collection,
            action_log_collection=action_log_collection,
            db_filter={"_id": record["_id"]},
            kind="discarded",
            now=now,
            stamp=stamp,
            session=session,
        )
        if notify:
            await owe_the_refusal_notice_in_session(record, outbox_collection=outbox_collection, now=now, session=session)
        # Journalled: what the address held may have gone after a snapshot a restore brings the change back from.
        journal.note(
            ending_line(
                kind="address_change_discarded_notified" if notify else "address_change_discarded",
                new_address=str(record["email"]),
                record_id=record["_id"],
                at=stamp,
                key=key,
            )
        )
        return verdict, False

    ended = await move_the_address_in_session(
        record=record,
        holdings=holdings,
        sperrliste=sperrliste,
        address_changes_collection=address_changes_collection,
        spieler_collection=spieler_collection,
        schiedsrichter_collection=schiedsrichter_collection,
        saison_teams_collection=saison_teams_collection,
        bewerbungen_collection=bewerbungen_collection,
        registrierungen_collection=registrierungen_collection,
        spielbestaetigungen_collection=spielbestaetigungen_collection,
        grants_collection=grants_collection,
        grants_announced_collection=grants_announced_collection,
        outbox_collection=outbox_collection,
        grant_approval_requests_collection=grant_approval_requests_collection,
        invitations_collection=invitations_collection,
        ban_list_collection=ban_list_collection,
        action_log_collection=action_log_collection,
        key=key,
        now=now,
        session=session,
    )
    # A line for each request the effect ended, so a restore from before it does not bring one back.
    for approval_request in ended:
        journal.note(approval_request_line(approval_request=approval_request, kind="approval_request_ended", at=stamp, key=key))
    journal.note(effective_line(record=record, now=now, key=key))

    return verdict, True


async def move_the_address_in_session(
    *,
    record: Mapping[str, Any],
    holdings: Holdings,
    sperrliste: BanList,
    address_changes_collection: AsyncCollection,
    spieler_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    spielbestaetigungen_collection: AsyncCollection,
    grants_collection: AsyncCollection,
    grants_announced_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    grant_approval_requests_collection: AsyncCollection,
    invitations_collection: AsyncCollection,
    ban_list_collection: AsyncCollection,
    action_log_collection: AsyncCollection,
    key: SecretStr,
    now: datetime,
    session: AsyncClientSession,
) -> list[Mapping[str, Any]]:
    """Move everything `holdings` holds to the change's address in the caller's transaction, then end it as taken effect.

    One patch per row, never a fan-out, so each row's own history keeps the write that moved it.
    """

    new_address, stamp = str(record["email"]), log_stamp(now)

    if holdings.spieler is not None:
        # Folded as every start stores it, and again here: the sign-in seam joins on this field by equality.
        await patch_one_in_db(
            collection=spieler_collection,
            db_filter={"_id": holdings.spieler["_id"]},
            update={"$set": {"email": sign_in_identifier(new_address)}},
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

    for row in holdings.schiedsrichter:
        await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": row["_id"]},
            update={"$set": {"kontakt.email": new_address}},
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

    voids = []
    for row, slots in holdings.seats:
        await patch_one_in_db(
            collection=saison_teams_collection,
            db_filter={"_id": row["_id"]},
            update=_seat_move(row, slots, new_address),
            session=session,
            return_document=ReturnDocument.BEFORE,
        )
        kontakte = row.get("kontakte") or {}
        moved = {**kontakte, **{slot: {**kontakte[slot], "email": new_address} for slot in slots}}
        voids.append(seat_void_of(saison_id=row["saison_id"], team_id=row["team_id"], stored_kontakte=kontakte, kontakte=moved))
    # The match confirmations' links went to the replaced mailbox, so they die here and the hourly pass mints the
    # moved seats fresh ones.
    await void_moved_seats(spielbestaetigungen_collection=spielbestaetigungen_collection, voids=voids, session=session)

    for row, slots in holdings.bewerbung_seats:
        await patch_one_in_db(
            collection=bewerbungen_collection,
            db_filter={"_id": row["_id"]},
            update=_seat_move(row, slots, new_address),
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

    for row in holdings.registrierungen:
        await patch_one_in_db(
            collection=registrierungen_collection,
            db_filter={"_id": row["_id"]},
            update=_registrierung_move(row, new_address),
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

    if holdings.grant is not None:
        by = (record.get("approval") or {}).get("approved_by")
        # The judgement refuses a grant its approval does not cover; this guards the replay, which judges differently.
        if not isinstance(by, str):
            raise RuntimeError("a grant moves only on an approval naming its approver")
        await _move_the_grant(
            holdings.grant,
            new_address=sign_in_identifier(new_address),
            by=by,
            sperrliste=sperrliste,
            grants_collection=grants_collection,
            grants_announced_collection=grants_announced_collection,
            outbox_collection=outbox_collection,
            now=now,
            session=session,
        )

    await _rekey_the_person(
        holdings.identifier,
        new_address,
        spielbestaetigungen_collection=spielbestaetigungen_collection,
        action_log_collection=action_log_collection,
        key=key,
        stamp=stamp,
        session=session,
    )
    await end_the_change_in_session(
        address_changes_collection=address_changes_collection,
        action_log_collection=action_log_collection,
        db_filter={"_id": record["_id"]},
        kind="effective",
        now=now,
        stamp=stamp,
        session=session,
    )

    # Before the images' carry below, which takes the replaced address out of the image an ended request keeps.
    ended = await end_the_approval_requests_about_in_session(
        grant_approval_requests_collection=grant_approval_requests_collection,
        outbox_collection=outbox_collection,
        address=holdings.identifier,
        now=now,
        session=session,
    )

    # After every write above, so it reaches the images they filed: a record the effect leaves naming the replaced address
    # by address alone would outlive the person's erasure at the new one.
    old, new = holdings.identifier, sign_in_identifier(new_address)
    # Who made a record is the person, whatever their address or grant, a revoked grant's records and a seat holder's
    # decisions included: the starter of a change stays excluded from approving it.
    await carry_authorship_in_session(
        grants_collection=grants_collection,
        grant_approval_requests_collection=grant_approval_requests_collection,
        bewerbungen_collection=bewerbungen_collection,
        registrierungen_collection=registrierungen_collection,
        invitations_collection=invitations_collection,
        ban_list_collection=ban_list_collection,
        old=old,
        new_address=new,
        session=session,
    )
    await _reattribute_the_changes(address_changes_collection, old, new, session=session)
    await reattribute_administrator_in_session(action_log_collection=action_log_collection, identifier=old, value=new, session=session)
    # A seat or referee row left before the change is in no document an erasure at the new address reads, so its images
    # follow the person; one standing at the replaced address as nobody's proven own keeps it.
    await carry_the_replaced_address_in_images(
        action_log_collection=action_log_collection,
        old=old,
        new_address=new,
        staying=await _seats_staying_at(old, collections=(saison_teams_collection, bewerbungen_collection), session=session),
        referees_held={
            row["_id"]
            for row in await aggregate_many_from_db(
                collection=schiedsrichter_collection,
                pipeline=[{"$match": build_self_referee_filter(old, new)}, {"$project": {"_id": 1}}],
                session=session,
            )
        },
        stamp=stamp,
        session=session,
    )
    # An earlier effect's carry still owed takes its account to where the person is now, and an erasure there finds it.
    # Read, then written by id: the log keeps a fan-out's filter as text, address and all.
    owed = await aggregate_many_from_db(
        collection=address_changes_collection, pipeline=[{"$match": {"move.new": old}}, {"$project": {"_id": 1}}], session=session
    )
    if owed:
        await patch_many_in_db(
            collection=address_changes_collection,
            db_filter={"_id": {"$in": [row["_id"] for row in owed]}},
            update={"$set": {"move.new": new}},
            session=session,
        )
    await _carry_the_mail(outbox_collection, old, new, session=session)
    # The journal's pair on the tombstone, so an erasure at the new address finds the mail the replaced one still holds.
    # A change that waited carries no account: whatever its old mailbox's holder enrolled meanwhile would follow. The carry
    # is owed on the ended record itself, in this transaction, so a commit whose answer was lost still owes it.
    await patch_many_in_db(
        collection=address_changes_collection,
        db_filter={"_id": record["_id"]},
        update={
            "$set": {
                "moved": {
                    "person_hash": erasure_journal_hash(new, key=key),
                    "before": erasure_journal_hash(old, key=key),
                },
                **({} if record["way"] == "waiting_period" else {"move": {"old": old, "new": new}}),
            }
        },
        session=session,
    )
    # The person's own change taking effect at the new mailbox's press owes the replaced mailbox nothing more: it confirmed
    # the change through its own link, and the new mailbox confirmed it last, so both already know. One that waited on a
    # grant's approval takes effect later, at that approval or the hourly pass, and tells the replaced mailbox then.
    if record["way"] != "account" or record.get("confirmed_at") is not None:
        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=[
                OwedMail(
                    key=f"address_changes/{record['_id']}/effective",
                    an=old,
                    # Greeting nobody on the lost-mailbox way: that mailbox may have passed to a stranger.
                    data=FLAddressChangeEffectiveData(
                        kind="address_change_effective", instant=now, vorname=None if record["way"] == "waiting_period" else holdings.vorname
                    ),
                )
            ],
            now=now,
        )

    # The requests for a grant it ended, each journalled by the caller as a refusal.
    return ended


async def _carry_the_mail(outbox_collection: AsyncCollection, old: str, new: str, *, session: AsyncClientSession) -> None:
    """The person's mail follows them: what is owed the replaced address goes to the new one, and what was sent there goes.

    A sent mail's delivery state describes the replaced mailbox, which on the lost-mailbox way may be a stranger's. The
    sign-in library's mails stay where they were owed, each tied to the sign-in it was asked from. Matched on the
    sign-in fold, a recipient being stored as its mail was owed; then written by id.
    """

    rows = await aggregate_many_from_db(
        collection=outbox_collection,
        pipeline=[{"$match": {"kind": {"$nin": sorted(SIGN_IN_KINDS)}, "an": same_address(old)}}, {"$project": {"an": 1, "state": 1}}],
        session=session,
    )
    held = [row for row in rows if sign_in_identifier(str(row["an"])) == old]
    if open := [row["_id"] for row in held if row["state"] == "open"]:
        await patch_many_in_db(collection=outbox_collection, db_filter={"_id": {"$in": open}}, update={"$set": {"an": new}}, session=session)
    if sent := [row["_id"] for row in held if row["state"] != "open"]:
        await erase_many_from_db(collection=outbox_collection, db_filter={"_id": {"$in": sent}}, session=session)


async def _seats_staying_at(identifier: str, *, collections: Sequence[AsyncCollection], session: AsyncClientSession) -> set[tuple[Any, str]]:
    """Each document and slot seating this folded address, read after the effect moved the person's own seats."""

    staying: set[tuple[Any, str]] = set()
    for collection in collections:
        rows = await aggregate_many_from_db(
            collection=collection, pipeline=[{"$match": rows_seating(identifier)}, {"$project": {"kontakte": 1}}], session=session
        )
        staying |= {(row["_id"], slot) for row in rows for slot in find_matching_slots(row, identifier)}

    return staying


async def _move_the_grant(
    grant: Mapping[str, Any],
    *,
    new_address: str,
    by: str,
    sperrliste: BanList,
    grants_collection: AsyncCollection,
    grants_announced_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Revoked at the replaced address and granted at the new by the approver, as the administrators page does both.

    Granted now, never the old row repointed: a session signed in before it holds none of it.
    """

    announced = await aggregate_many_from_db(
        collection=grants_announced_collection, pipeline=[{"$match": {"_id": grant["_id"]}}], session=session
    )
    barred = await barred_addresses(sperrliste, [by], session=session)
    await revoke_in_session(
        grant=grant,
        announced=announced,
        revoked_by=by,
        barred=barred,
        grants_collection=grants_collection,
        grants_announced_collection=grants_announced_collection,
        outbox_collection=outbox_collection,
        now=now,
        session=session,
    )
    await grant_in_session(
        address=new_address,
        admin_tier=str(grant["admin_tier"]),
        granted_by=by,
        barred=barred,
        grants_collection=grants_collection,
        grants_announced_collection=grants_announced_collection,
        outbox_collection=outbox_collection,
        now=now,
        session=session,
        # The four-eyes rule dates the person, not the mailbox.
        carried=compose_carried(grant, announced[0] if announced else None),
    )


async def _rekey_the_person(
    old: str,
    new_address: str,
    *,
    spielbestaetigungen_collection: AsyncCollection,
    action_log_collection: AsyncCollection,
    key: SecretStr,
    stamp: str,
    session: AsyncClientSession,
) -> None:
    """The digests naming the person by the replaced address, re-keyed rather than recorded, so an erasure of the new one reaches them.

    Kept on a record instead, every erasure step would have to read them.
    """

    await patch_many_in_db(
        collection=action_log_collection,
        db_filter={"actor.pseudonym": actor_pseudonym(old, key=key)},
        update={"$set": {"actor.pseudonym": actor_pseudonym(new_address, key=key)}},
        session=session,
    )

    before, after = halter_of(old, key=key), halter_of(new_address, key=key)
    answered = await aggregate_many_from_db(
        collection=spielbestaetigungen_collection,
        pipeline=[{"$match": build_contact_reasons_filter([before])}, {"$project": {"saison_id": 1}}],
        session=session,
    )
    if answered:
        await patch_many_in_db(
            collection=spielbestaetigungen_collection,
            # Ids and their seasons alone, never the digest: the log keeps a fan-out's filter as text.
            db_filter={"saison_id": {"$in": sorted({row["saison_id"] for row in answered})}, "_id": {"$in": [row["_id"] for row in answered]}},
            update={"$set": {"antwort.von.halter": after}},
            session=session,
        )
    await redact_images_in_session(
        action_log_collection=action_log_collection,
        db_filter=build_contact_reason_images_filter([before]),
        judge=lambda image: {"antwort.von.halter": after} if contact_reason_image_edits(image, [before]) else {},
        stamp=stamp,
        session=session,
    )


def _seat_move(row: Mapping[str, Any], slots: Sequence[str], new_address: str) -> dict[str, Any]:
    """The seats' address."""

    return {"$set": {f"kontakte.{slot}.email": new_address for slot in slots}}


def _registrierung_move(row: Mapping[str, Any], new_address: str) -> dict[str, Any]:
    """The registration's address; an unanswered one's live links die, so only a link reaching the new mailbox confirms it."""

    update: dict[str, Any] = {"$set": {"email": new_address}}
    if not isinstance(row.get("confirmation"), Mapping):
        return update

    if not registrierung_ist_bestaetigt(einwilligung=row.get("einwilligung")):
        # Every link dies and the reminder is owed again: it alone mints the next link, to the moved address.
        update["$set"] |= {"confirmation.token_hashes": [], "confirmation.reminded_at": None}

    return update


# --- The ERASURE's reach: a change naming the erased address ends, and an administrator it names takes the marker.


def build_erasure_address_change_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every live change whose address on file, or whose new address, is this one, each stored folded."""

    folded = sign_in_identifier(identifier)

    # Each clause its index's, the live terms inside each: beside the `$or` they leave the planner no indexed plan, and it
    # scans every tombstone. The key's type stated for `build_address_filter`'s reason.
    return [
        {"$match": {"$or": [build_address_filter(folded), {"email": folded, **LIVE_TERMS}]}},
        {"$project": {"address": 1, "email": 1, "way": 1, "released_at": 1}},
        {"$sort": {"_id": 1}},
    ]


async def denied_addresses(
    addresses: Iterable[str],
    *,
    actor: str,
    auth_time: int,
    grants_collection: AsyncCollection,
    grants_announced_collection: AsyncCollection,
    session: AsyncClientSession | None,
) -> dict[str, FLAddressChangeViewableDenied]:
    """Which of these folded addresses' changes the address tool refuses this administrator, and why; one absent opens.

    Judged by `app/api/identity/services.py :: address_change_viewable_denied`; the grants are read only where an
    address is asked, most reads serving no change.
    """

    asked = set(addresses)
    if not asked:
        return {}
    grants = await read_berechtigungen(grants_collection=grants_collection, session=session)
    announced = await read_the_announced(grants_announced_collection=grants_announced_collection, session=session)

    return {
        address: grund
        for address in asked
        if (grund := address_change_viewable_denied(address, actor=actor, auth_time=auth_time, grants=grants, announced=announced)) is not None
    }


def others_naming(rows: Sequence[Mapping[str, Any]], identifier: str) -> list[Mapping[str, Any]]:
    """The changes of other addresses naming this one as their new address: the previews' rows, the address's own being its own."""

    return [row for row in rows if row.get("address") != identifier]


def known_to_the_new_mailbox(rows: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """The ones whose link was owed the new mailbox: one still awaiting the address on file has none."""

    return [row for row in rows if not asks_the_address_on_file(row)]


_APPROVAL_ACTORS: Final = ("approval.started_by", "approval.approved_by")


async def end_the_address_changes_in_session(
    *,
    address_changes_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    action_log_collection: AsyncCollection,
    identifier: str,
    # The subject's rows, read before the erasure's first write.
    rows: Sequence[Mapping[str, Any]],
    now: datetime,
    stamp: str,
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one.
    session: AsyncClientSession,
) -> int:
    """End every change naming the erased address, unjournalled, and give the marker where it started or approved one.

    Each change's mails go with it, owed or sent: its link went to the person's other mailbox, or to theirs from another's
    change. An erasure's line is the erasure's own: replayed, the erasure ends them again.
    """

    if rows:
        await erase_many_from_db(
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
            action_log_collection=action_log_collection,
            db_filter={"_id": row["_id"]},
            kind="discarded",
            now=now,
            stamp=stamp,
            session=session,
        )

    # Read after the endings, which took the approval off every change they ended.
    await _reattribute_the_changes(address_changes_collection, identifier, ERASED_ACTOR_MARKER, session=session)

    # A carry still owed off or onto the erased address goes: the erasure takes the account it would move, or the address
    # it would move one to. By id, as every write here.
    owed = await aggregate_many_from_db(
        collection=address_changes_collection,
        pipeline=[{"$match": {"$or": [{"move.old": identifier}, {"move.new": identifier}]}}, {"$project": {"_id": 1}}],
        session=session,
    )
    if owed:
        await patch_many_in_db(
            collection=address_changes_collection,
            db_filter={"_id": {"$in": [row["_id"] for row in owed]}},
            update={"$unset": {"move": ""}},
            session=session,
        )

    return len(rows)


async def _reattribute_the_changes(
    address_changes_collection: AsyncCollection, identifier: str, value: str, *, session: AsyncClientSession
) -> None:
    """Put `value` where this folded administrator started or approved a live change: the erasure's marker, or their new address.

    Read, then written by id: the log keeps a fan-out's filter as text, address and all.
    """

    for path in _APPROVAL_ACTORS:
        # Folded, as `app/core/security.py :: bind_actor` stores every administrator's address.
        named = await aggregate_many_from_db(
            collection=address_changes_collection,
            pipeline=[{"$match": {**LIVE_TERMS, path: sign_in_identifier(identifier)}}, {"$project": {"_id": 1}}],
            session=session,
        )
        if named:
            await patch_many_in_db(
                collection=address_changes_collection,
                db_filter={"_id": {"$in": [row["_id"] for row in named]}},
                update={"$set": {path: value}},
                session=session,
            )


async def end_an_emptied_change_in_session(
    *,
    address_changes_collection: AsyncCollection,
    action_log_collection: AsyncCollection,
    grants_collection: AsyncCollection,
    records: RecordCollections,
    identifier: str,
    now: datetime,
    stamp: str,
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
        action_log_collection=action_log_collection,
        db_filter={"_id": live["_id"]},
        kind="discarded",
        now=now,
        stamp=stamp,
        session=session,
        without_address=True,
    )

    return 1
