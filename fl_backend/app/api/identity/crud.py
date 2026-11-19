from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.action_log.crud import reattribute_administrator_in_session
from app.api.address_change.crud import (
    build_erasure_address_change_pipeline,
    end_an_emptied_change_in_session,
    end_the_address_changes_in_session,
    others_naming,
)
from app.api.address_change.services import build_owed_carry_filter, masked_address
from app.api.bewerbungen.services import person_of
from app.api.grants.crud import read_grants
from app.api.grants.erasure import erase_grants_in_session
from app.api.identity.lookup import ErasureCollections, RecordCollections
from app.api.identity.schemas import FLErasure, FLSignIn, FLSubject, FLSubjectSchiedsrichter, FLSubjectSeat, FLSubjectSpieler
from app.api.identity.services import (
    EntryKind,
    awaits_confirmation,
    build_bewerbung_pipeline,
    build_erasure_due_page_pipeline,
    build_erasure_grant_pipeline,
    build_erasure_pupil_pipeline,
    build_erasure_referee_pipeline,
    build_erasure_registrierung_pipeline,
    build_erasure_seat_pipeline,
    build_open_registrierungen_pipeline,
    build_pupil_pipeline,
    build_referee_pipeline,
    build_registrierung_pipeline,
    build_seat_pipeline,
    erasure_due,
    find_no_owner_refusal,
    find_role_refusal,
    folds_to,
    grants_a_panel,
    is_live,
    is_own_schiedsrichter,
    is_own_spieler,
    kept_saison_ids,
    not_exited,
    open_addresses,
    own_entries,
    own_seats,
    referee_address,
    referenced_addresses,
    seat_saisons,
    seats_naming,
    statuses_of,
    unreferenced,
)
from app.api.kontakte.crud import erase_kontaktperson_in_session
from app.api.outbox.services import ERASURE_SPARED_KINDS
from app.api.registrierungen.crud import erase_registrierungen_in_session
from app.api.registrierungen.services import build_own_registrierung_filter
from app.api.schiedsrichter.crud import erase_referee_in_session
from app.api.spieler.crud import erase_person_in_session
from app.core.collections import Collection
from app.core.concurrency import concurrently
from app.core.crud import aggregate_many_from_db, delete_many_from_db, refuse
from app.core.readonly import ReadCollection
from app.core.recording import ERASED_ACTOR_MARKER
from app.shared.einwilligung import is_confirmed, seat_is_confirmed
from app.shared.folding import sign_in_identifier
from app.shared.schemas.literals import FLSaisonStatus

Rows = list[Mapping[str, Any]]


def _reads(identifier: str, records: RecordCollections) -> tuple[tuple[ReadCollection, Rows], ...]:
    """The three record reads a Funktion stands on, in the order every lookup unpacks them.

    Unbounded, as `resolve_subject`'s are: a capped list reads as a person holding fewer records
    rather than as a truncated answer.
    """

    return (
        (records.saison_teams_collection, build_seat_pipeline(identifier)),
        (records.schiedsrichter_collection, build_referee_pipeline(identifier)),
        (records.spieler_collection, build_pupil_pipeline(identifier)),
    )


def _judged(identifier: str, seat_rows: Rows, referee_rows: Rows, pupil_rows: Rows) -> FLSubject:
    """The answer every lookup gives from the same three reads: one judgement, so no two can narrow differently.

    Each list is the live part of the address's own records, so the gate never refuses a Funktion
    holder.
    """

    # Live rows alone, here and in the flag: a retired referee and a withdrawn team grant nothing, and
    # confirming one would open nothing.
    live_seat_rows = [row for row in seat_rows if not_exited(row)]
    live_schiedsrichter = [row for row in referee_rows if is_live(row) and folds_to(referee_address(row), identifier)]

    # Every live seat naming the address and not only its confirmed ones: the flag below reads an
    # unconfirmed seat's season too, so a seat whose season has no row stays loud whichever list counts it.
    saisons = seat_saisons(row for row, _ in seats_naming(live_seat_rows, identifier))

    # The confirmation narrows here, through the predicates every reader shares, and never at a caller:
    # a caller-side check leaves the sign-in gate mailing, and a panel drawn for, a person nobody confirmed.
    return FLSubject(
        seats=[
            # `model_validate` rather than the constructor: the seat is a plain string here, and the
            # wire's closed set is what refuses one no endpoint publishes.
            FLSubjectSeat.model_validate(
                {
                    "saison_id": row["saison_id"],
                    "team_id": row["team_id"],
                    "seat": seat,
                    "team_name": row["name"],
                    "team_shorthand": row["shorthand"],
                    "saison_status": saisons[row["saison_id"]]["status"],
                    "saison_start_date": saisons[row["saison_id"]]["start_date"],
                    "saison_end_date": saisons[row["saison_id"]]["end_date"],
                }
            )
            for row in live_seat_rows
            for seat in own_seats(row, identifier)
        ],
        # One row at most, `uniq_spieler_email` holding one pupil per address, which the selection matches by equality.
        spieler=next((FLSubjectSpieler(spieler_id=row["_id"]) for row in pupil_rows if is_own_spieler(row)), None),
        schiedsrichter=[
            FLSubjectSchiedsrichter(schiedsrichter_id=row["_id"]) for row in live_schiedsrichter if is_own_schiedsrichter(row, identifier)
        ],
        # Over the records that could grant a panel alone: confirming a
        # seat on a `past` season opens nothing, so it neither raises the flag nor holds it down.
        unconfirmed=awaits_confirmation(
            [
                seat_is_confirmed(person_of(row.get("kontakte"), seat))
                for row, seat in seats_naming(live_seat_rows, identifier)
                if grants_a_panel(saisons[row["saison_id"]]["status"])
            ]
            + [is_confirmed(row.get("einwilligung")) for row in [*pupil_rows, *live_schiedsrichter]]
        ),
    )


async def find_subject(identifier: str, records: RecordCollections) -> FLSubject:
    """Every confirmed, live record this folded identifier matches, and whether its granting records are all unconfirmed.

    Its reads gathered and outside any transaction; a caller inside one reads through `find_subject_in_session`.
    """

    seat_rows, referee_rows, pupil_rows = await concurrently(
        *(aggregate_many_from_db(collection=collection, pipeline=pipeline) for collection, pipeline in _reads(identifier, records))
    )

    return _judged(identifier, seat_rows, referee_rows, pupil_rows)


async def find_own_entries(identifier: str, records: RecordCollections) -> tuple[FLSubject, frozenset[tuple[EntryKind, Any]]]:
    """The gate's five reads, judged twice: the subject's answer, and every own record of the address.

    The two only the gate pays for, a pending application's and a registration's, grant no panel and
    so are read on no page render.
    """

    seat_rows, referee_rows, pupil_rows, bewerbung_rows, registrierung_rows = await concurrently(
        *(aggregate_many_from_db(collection=collection, pipeline=pipeline) for collection, pipeline in _reads(identifier, records)),
        aggregate_many_from_db(collection=records.bewerbungen_collection, pipeline=build_bewerbung_pipeline(identifier)),
        aggregate_many_from_db(collection=records.registrierungen_collection, pipeline=build_registrierung_pipeline(identifier)),
    )

    subject = _judged(identifier, seat_rows, referee_rows, pupil_rows)

    return subject, own_entries(
        identifier,
        seat_rows=seat_rows,
        referee_rows=referee_rows,
        pupil_rows=pupil_rows,
        bewerbung_rows=bewerbung_rows,
        registrierung_rows=registrierung_rows,
    )


async def find_sign_in(identifier: str, records: RecordCollections) -> FLSignIn:
    """What the sign-in gate asks of the records: the subject's flag, and whether the address holds any record of its own."""

    subject, entries = await find_own_entries(identifier, records)

    return FLSignIn(unconfirmed=subject.unconfirmed, account=bool(entries))


async def find_subject_in_session(
    identifier: str,
    records: RecordCollections,
    *,
    # This is the lookup a transaction reaches, so no read of it can leave the session.
    session: AsyncClientSession,
) -> FLSubject:
    """`find_subject`'s answer read inside a caller's session, one read at a time.

    A session runs one operation at a time, which PyMongo's `AsyncClientSession` documents and never
    refuses, so the gathered reads would race unseen here.
    """

    seat_rows, referee_rows, pupil_rows = [
        await aggregate_many_from_db(collection=collection, pipeline=pipeline, session=session)
        for collection, pipeline in _reads(identifier, records)
    ]

    return _judged(identifier, seat_rows, referee_rows, pupil_rows)


async def roles_of(
    identifier: str,
    records: RecordCollections,
    *,
    # A person endpoint judges this inside the session it reads or writes in, so a caller
    # forgetting it is a TypeError rather than a read outside its own write.
    session: AsyncClientSession,
) -> FLSubject:
    """What a person endpoint may authorise against: `find_subject`'s answer, its seats narrowed to the seasons granting a panel.

    Narrowed here and not in the lookup, each caller narrowing for itself.
    """

    # Folded whatever arrived: a header spelled otherwise than the store would otherwise authorise
    # nothing, every read matching the stored fold by equality.
    folded = sign_in_identifier(identifier)

    # Raised rather than answered: a person's binder refuses a malformed actor before any handler
    # runs, so an empty one here is a caller's bug, and it would match a hand-edited empty stored
    # address.
    if folded == "":
        raise ValueError("roles_of was asked about an empty identifier")

    return _only_with_panel(await find_subject_in_session(folded, records, session=session))


def _only_with_panel(subject: FLSubject) -> FLSubject:
    return subject.model_copy(update={"seats": [seat for seat in subject.seats if grants_a_panel(seat.saison_status)]})


def roles_from(identifier: str, *, seat_rows: Rows, referee_rows: Rows, pupil_rows: Rows) -> FLSubject:
    """`roles_of`'s answer over rows a caller already read through the subject's own selections, so none is read twice.

    The rows must carry what `_judged` reads: each seat row's `austritt`, `name`, `shorthand`, seats and `SAISON_LOOKUP`'s `saison`, and
    each person's stamp and retirement.
    """

    return _only_with_panel(_judged(identifier, seat_rows, referee_rows, pupil_rows))


async def refuse_without_a_seat(
    identifier: str, records: RecordCollections, *, team_id: ObjectId, saison_id: str, session: AsyncClientSession
) -> None:
    """`role_not_held` unless the person holds a seat on this team in this season, judged in the caller's session.

    In-session because a seat may end between the page's check and this one.
    """

    subject = await roles_of(identifier, records, session=session)

    refuse(find_role_refusal(seats=subject.seats, team_id=team_id, saison_id=saison_id))


# --- The erasure: every step that reaches a person's data, run in one transaction.


def _seat_entry(collection: Collection, row: Mapping[str, Any], seat: str) -> str:
    entry = f"{collection}/{row['_id']}/{seat}"
    person = person_of(row.get("kontakte"), seat)

    return f"{entry}/{person['einwilligung']['confirmed_at']}" if seat_is_confirmed(person) else entry


@dataclass(frozen=True, kw_only=True)
class Subject:
    """Every record one folded address holds, read before the erasure's first step writes.

    Each step takes its rows from here: one reading after another step wrote would miss what that step removed and answer zero.
    """

    identifier: str
    saison_teams: Rows
    bewerbungen: Rows
    schiedsrichter: Rows
    # One row at most, `uniq_spieler_email` holding one pupil per address, which the selection matches by equality.
    spieler: Mapping[str, Any] | None
    registrierungen: Rows
    # The live changes naming this address, its own and another address's whose new address it is.
    address_change: Rows
    grants: Rows

    def records(self) -> list[str]:
        """Each record this address alone holds as `collection/id`: what repeats its erasure after a restore.

        A seat's row holds up to three people and another address's change names a second one, so neither stands here.
        """

        pupil = self.spieler
        kinds: tuple[tuple[Collection, Rows], ...] = (
            (Collection.SCHIEDSRICHTER, self.schiedsrichter),
            (Collection.SPIELER, [] if pupil is None else [pupil]),
            (Collection.REGISTRIERUNGEN, self.registrierungen),
            (Collection.ADDRESS_CHANGES, [row for row in self.address_change if row["address"] == self.identifier]),
            (Collection.GRANTS, self.grants),
        )

        return [f"{collection}/{row['_id']}" for collection, rows in kinds for row in rows]

    def seats(self) -> list[str]:
        """Each seat the address sits in as `collection/id/seat`, so a restore's replay reads this person's address.

        A confirmed seat adds its `einwilligung.confirmed_at` as a fourth part: a seat passes to someone else, so a replay needs
        to tell whether the row a snapshot holds still seats this person. A day is neither an address nor a name.
        """

        kinds: tuple[tuple[Collection, Rows], ...] = ((Collection.SAISON_TEAMS, self.saison_teams), (Collection.BEWERBUNGEN, self.bewerbungen))

        return [_seat_entry(collection, row, seat) for collection, rows in kinds for row, seat in seats_naming(rows, self.identifier)]

    def changes_naming_it(self) -> list[str]:
        """Each other address's change whose new address this is, as `collection/id/path`."""

        return [f"{Collection.ADDRESS_CHANGES}/{row['_id']}/email" for row in others_naming(self.address_change, self.identifier)]


async def resolve_subject(
    identifier: str,
    *,
    saison_teams_collection: ReadCollection,
    bewerbungen_collection: ReadCollection,
    schiedsrichter_collection: ReadCollection,
    spieler_collection: ReadCollection,
    registrierungen_collection: ReadCollection,
    address_changes_collection: ReadCollection,
    grants_collection: ReadCollection,
    # The erasure's transaction, or the preview's snapshot, so the preview names the records of one moment.
    session: AsyncClientSession,
) -> Subject:
    """What `identifier` holds, through the unnarrowed selections: an unconfirmed seat, a retired row and a declined registration included.

    One read at a time: a session runs one operation at a time, and gathered reads would race unseen.
    """

    async def read(collection: ReadCollection, pipeline: Sequence[Mapping[str, Any]]) -> Rows:
        return await aggregate_many_from_db(collection=collection, pipeline=pipeline, session=session)

    return Subject(
        identifier=identifier,
        saison_teams=await read(saison_teams_collection, build_erasure_seat_pipeline(identifier)),
        bewerbungen=await read(bewerbungen_collection, build_erasure_seat_pipeline(identifier)),
        schiedsrichter=await read(schiedsrichter_collection, build_erasure_referee_pipeline(identifier)),
        spieler=next(iter(await read(spieler_collection, build_erasure_pupil_pipeline(identifier))), None),
        registrierungen=await read(registrierungen_collection, build_erasure_registrierung_pipeline(identifier)),
        address_change=await read(address_changes_collection, build_erasure_address_change_pipeline(identifier)),
        grants=await read(grants_collection, build_erasure_grant_pipeline(identifier)),
    )


def _mail_sites_naming(row: Mapping[str, Any], identifier: str) -> list[str]:
    """Where one `outbox` row names this folded address in full: its recipient, and a grant notice's address.

    Compared as stored: every write stores a recipient folded, and a grant notice copies its address from a folded row.
    """

    held = {"to": row["to"], "data.address": (row.get("data") or {}).get("address") if row["kind"] == "grant" else None}

    return [path for path, value in held.items() if value == identifier]


async def erase_the_mails_in_session(*, outbox_collection: AsyncCollection, identifier: str, session: AsyncClientSession) -> list[str]:
    """Every mail to this folded address removed, owed or settled, and every grant notice about it still owed.

    Every kind but those `ERASURE_SPARED_KINDS` names. A settled row's retention bounds a row nobody erases; no reader serves
    an erased person's delivery history. No index serves the read, the collection holding a month of mail. Matched on the
    sign-in fold, a recipient being stored as its mail was owed. A notice stores a change's new address masked, so it is
    matched as masked: a completed change's old address was this person's own, which the fold cannot find, and another
    person's mask reading alike costs that notice. Answers each field naming the address in full as `collection/id/path`. A
    row matched by a mask alone stands on no line: a mask fits many people, so that row names nobody a replay could read
    off it.
    """

    mask = masked_address(identifier)
    rows = await aggregate_many_from_db(
        collection=outbox_collection,
        pipeline=[
            {"$match": {"kind": {"$nin": sorted(ERASURE_SPARED_KINDS)}}},
            {"$project": {"to": 1, "kind": 1, "data.address": 1, "data.new_address": 1}},
        ],
        session=session,
    )
    masked = {row["_id"] for row in rows if row["kind"] == "grant" and (row.get("data") or {}).get("new_address") == mask}
    named = {row["_id"]: sites for row in rows if (sites := _mail_sites_naming(row, identifier))}
    ids = [*named, *(masked - named.keys())]
    if ids:
        await delete_many_from_db(collection=outbox_collection, db_filter={"_id": {"$in": ids}}, session=session)

    return [f"{outbox_collection.name}/{row_id}/{path}" for row_id, sites in named.items() for path in sites]


async def log_rows_naming(*, action_log_collection: ReadCollection, identifier: str, session: AsyncClientSession) -> list[str]:
    """The log fields `reattribute_administrator_in_session` takes this folded address off, as `collection/id/path`, read ahead of it."""

    rows = await aggregate_many_from_db(
        collection=action_log_collection,
        pipeline=[{"$match": {"$or": [{"by": identifier}, {"label": identifier}]}}, {"$project": {"by": 1, "label": 1}}],
        session=session,
    )

    return [f"{Collection.ACTION_LOG}/{row['_id']}/{field}" for row in rows for field in ("by", "label") if row[field] == identifier]


@dataclass(frozen=True)
class Erasure:
    """Where the person stood, by id, for the erasure's lines."""

    records: list[str]
    seats: list[str]
    # Every other field that named the address as `collection/id/path`, so an address holding no record of its own still
    # replays after a restore, and a row naming two people says which one this is.
    rows: list[str]


async def erase_the_pupil_in_session(
    identifier: str,
    *,
    # The address's pupil row as the erasure's selection read it, or none.
    pupil: Mapping[str, Any] | None,
    # Every registration of the address, a declined one included.
    registrierungen: Rows,
    collections: ErasureCollections,
    now: datetime,
    session: AsyncClientSession,
) -> FLErasure:
    """Erase what this folded address holds as a pupil, in the caller's transaction, answering the counts the sweep totals.

    The season-after rule's whole erasure, and one share of `erase_everything`'s. A seat, a referee row, a grant, a mail
    or a log line at the same address is another purpose's, so nothing here reaches one.
    """

    erased_registrierungen = await erase_registrierungen_in_session(
        registrierungen_collection=collections.registrierungen_collection, registrierungen=registrierungen, session=session
    )

    spieler, saison_spieler = 0, 0
    if pupil is not None:
        erased = await erase_person_in_session(
            spieler_collection=collections.spieler_collection,
            saison_spieler_collection=collections.saison_spieler_collection,
            spielberichte_collection=collections.spielberichte_collection,
            aufstellungen_collection=collections.aufstellungen_collection,
            spieler_id=pupil["_id"],
            now=now,
            session=session,
        )
        spieler, saison_spieler = erased.spieler, erased.saison_spieler

    # After the pupil's records went: the season's erasure leaves the address's other records, and their change, standing.
    await end_an_emptied_change_in_session(
        address_changes_collection=collections.address_changes_collection,
        grants_collection=collections.grants_collection,
        records=collections.records,
        identifier=identifier,
        now=now,
        session=session,
    )

    return FLErasure(spieler=spieler, saison_spieler=saison_spieler, registrierungen=erased_registrierungen)


async def erase_everything(
    identifier: str,
    *,
    collections: ErasureCollections,
    now: datetime,
    # The caller's transaction, every step committing together or none.
    session: AsyncClientSession,
) -> Erasure:
    """Erase every record of this folded address, in the caller's transaction.

    Every step reaching a person's references runs before the step removing the person. A request's route notes the
    answer's `records`, `seats` and `rows` in its `Journal`, which writes the erasure's lines once it commits.
    """

    subject = await resolve_subject(
        identifier,
        saison_teams_collection=collections.saison_teams_collection,
        bewerbungen_collection=collections.bewerbungen_collection,
        schiedsrichter_collection=collections.schiedsrichter_collection,
        spieler_collection=collections.spieler_collection,
        registrierungen_collection=collections.registrierungen_collection,
        address_changes_collection=collections.address_changes_collection,
        grants_collection=collections.grants_collection,
        session=session,
    )

    await erase_kontaktperson_in_session(
        saison_teams_collection=collections.saison_teams_collection,
        bewerbungen_collection=collections.bewerbungen_collection,
        spielbestaetigungen_collection=collections.spielbestaetigungen_collection,
        identifier=identifier,
        saison_team_rows=subject.saison_teams,
        bewerbung_rows=subject.bewerbungen,
        session=session,
    )

    # A change belongs to the address, whatever it holds, and another address's to that one.
    await end_the_address_changes_in_session(
        address_changes_collection=collections.address_changes_collection,
        grants_collection=collections.grants_collection,
        outbox_collection=collections.outbox_collection,
        identifier=identifier,
        rows=subject.address_change,
        now=now,
        session=session,
    )

    for row in subject.schiedsrichter:
        await erase_referee_in_session(
            schiedsrichter_collection=collections.schiedsrichter_collection,
            spiele_collection=collections.spiele_collection,
            spielbestaetigungen_collection=collections.spielbestaetigungen_collection,
            schiedsrichter_id=row["_id"],
            now=now,
            session=session,
        )

    await erase_the_pupil_in_session(
        identifier, pupil=subject.spieler, registrierungen=subject.registrierungen, collections=collections, now=now, session=session
    )

    # A grant is an address's whatever else it holds, which is why the pupil's share above never reaches it.
    await erase_grants_in_session(
        grants_collection=collections.grants_collection,
        outbox_collection=collections.outbox_collection,
        identifier=identifier,
        now=now,
        session=session,
    )
    named = subject.changes_naming_it()

    # After the grants' step, which owes this erasure's notices to the administrators who remain: a mail to the address
    # is owed it whatever it holds.
    named += await erase_the_mails_in_session(outbox_collection=collections.outbox_collection, identifier=identifier, session=session)

    # Last, for every erased address, a grantee stopped before it took effect included: a grant act's label holds that address.
    named += await log_rows_naming(action_log_collection=collections.action_log_collection, identifier=identifier, session=session)
    await reattribute_administrator_in_session(
        action_log_collection=collections.action_log_collection, identifier=identifier, value=ERASED_ACTOR_MARKER, session=session
    )

    return Erasure(records=subject.records(), seats=subject.seats(), rows=named)


async def unreferenced_of(
    identifiers: Sequence[str],
    records: RecordCollections,
    *,
    grants_collection: ReadCollection,
    address_changes_collection: ReadCollection,
) -> list[str]:
    """Which of these addresses no record references.

    Each collection is read once for the whole batch rather than once per address, the shape
    `REFERENCES_ADDRESSES_MAX` bounds.
    """

    folded = sorted({sign_in_identifier(identifier) for identifier in identifiers})

    # No address, no read.
    if not folded:
        return []

    # No ban read beside these: a ban keeps no account, a barred address's going once no record holds it.
    (seat_rows, bewerbung_rows, referee_rows, pupil_rows, registrierung_rows, grant_rows, carry_rows) = await concurrently(
        # The sign-in gate's selections, asked for the batch: an address the gate admits is one the sweep keeps.
        aggregate_many_from_db(collection=records.saison_teams_collection, pipeline=build_seat_pipeline(*folded)),
        aggregate_many_from_db(collection=records.bewerbungen_collection, pipeline=build_bewerbung_pipeline(*folded)),
        aggregate_many_from_db(collection=records.schiedsrichter_collection, pipeline=build_referee_pipeline(*folded)),
        aggregate_many_from_db(collection=records.spieler_collection, pipeline=build_pupil_pipeline(*folded)),
        aggregate_many_from_db(collection=records.registrierungen_collection, pipeline=build_registrierung_pipeline(*folded)),
        # Every row as stored, never `read_admin_tier_of`: a waiting grant's account stands too.
        read_grants(grants_collection=grants_collection),
        aggregate_many_from_db(
            collection=address_changes_collection,
            pipeline=[{"$match": build_owed_carry_filter(folded)}, {"$project": {"move.old": 1}}],
        ),
    )

    # Before any address is judged: the whole batch answers nothing rather than all of it unreferenced, which the account
    # sweep would act on by deleting every account.
    refuse(find_no_owner_refusal(grant_rows))

    referenced = referenced_addresses(
        seat_rows=seat_rows,
        bewerbung_rows=bewerbung_rows,
        referee_rows=referee_rows,
        pupil_rows=pupil_rows,
        registrierung_rows=registrierung_rows,
        grant_rows=grant_rows,
        carry_rows=carry_rows,
    )

    return unreferenced(identifiers, referenced=referenced)


# --- The season-after rule's two readers: one outside any transaction
# naming the population, one inside each person's re-judging it.


async def saison_statuses(*, saisons_collection: AsyncCollection) -> dict[str, FLSaisonStatus]:
    """Every season's status as stored now, read outside any transaction and never from a cache."""

    return statuses_of(await aggregate_many_from_db(collection=saisons_collection, pipeline=[{"$project": {"status": 1}}]))


async def _pending_addresses(registrierungen_collection: AsyncCollection) -> frozenset[str]:
    return open_addresses(await aggregate_many_from_db(collection=registrierungen_collection, pipeline=build_open_registrierungen_pipeline()))


async def erasure_due_page(
    statuses: Mapping[str, FLSaisonStatus],
    *,
    size: int,
    spieler_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
) -> list[Mapping[str, Any]]:
    """The first `size` due pupils with their id and address.

    Read outside any transaction; each erasure judges its pupil again in its own.
    """

    kept = kept_saison_ids(statuses)
    if kept is None:
        return []

    pipeline = build_erasure_due_page_pipeline(kept=kept, pending_addresses=await _pending_addresses(registrierungen_collection), size=size)

    return await aggregate_many_from_db(collection=spieler_collection, pipeline=pipeline)


async def erase_if_still_due(
    spieler_id: Any,
    *,
    saisons_collection: AsyncCollection,
    collections: ErasureCollections,
    now: datetime,
    # The judgement and the erasure commit together, so a squad row or a registration
    # landing between the population read and this transaction keeps the person.
    session: AsyncClientSession,
) -> FLErasure | None:
    """Erase one pupil's own data where the rule holds in this transaction, or answer `None` where it does not.

    The address is read off the row here and never handed in: an address change moves it between two reads. A squad
    entry or a registration meeting this transaction's writes waits for it to end: the entry then finds nobody, and the
    registration is stored for a pupil already gone.
    """

    statuses = statuses_of(await aggregate_many_from_db(collection=saisons_collection, pipeline=[{"$project": {"status": 1}}], session=session))
    kept = kept_saison_ids(statuses)
    if kept is None:
        return None

    pupils = await aggregate_many_from_db(
        collection=collections.spieler_collection, pipeline=[{"$match": {"_id": spieler_id}}, {"$project": {"email": 1}}], session=session
    )
    email = pupils[0].get("email") if pupils else None
    if not isinstance(email, str):
        return None

    kader = await aggregate_many_from_db(
        collection=collections.saison_spieler_collection,
        pipeline=[{"$match": {"spieler_id": spieler_id}}, {"$project": {"saison_id": 1}}],
        session=session,
    )
    registrierungen = await aggregate_many_from_db(
        collection=collections.registrierungen_collection,
        pipeline=[{"$match": build_own_registrierung_filter(email)}, {"$project": {"status": 1, "email": 1}}],
        session=session,
    )
    if not erasure_due(
        email=email,
        kader_saison_ids=[row["saison_id"] for row in kader],
        pending_addresses=open_addresses(registrierungen),
        kept=kept,
    ):
        return None

    # Of every status, where the judgement read the pending ones alone: a declined registration holds the pupil too.
    every_registrierung = await aggregate_many_from_db(
        collection=collections.registrierungen_collection, pipeline=build_erasure_registrierung_pipeline(email), session=session
    )

    return await erase_the_pupil_in_session(
        email, pupil=pupils[0], registrierungen=every_registrierung, collections=collections, now=now, session=session
    )
