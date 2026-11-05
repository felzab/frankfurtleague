import asyncio
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from types import TracebackType
from typing import Any, Final, Literal, get_args

from bson import ObjectId
from pydantic import SecretStr
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.api.address_change.crud import (
    build_erasure_address_change_pipeline,
    end_an_emptied_change_in_session,
    end_the_address_changes_in_session,
    known_to_the_new_mailbox,
    others_naming,
)
from app.api.address_change.services import build_owed_carry_filter
from app.api.aktionen.crud import reattribute_administrator_in_session, redact_address_in_images
from app.api.berechtigungen.antraege import loeschen_antraege_in_session
from app.api.berechtigungen.crud import read_berechtigungen
from app.api.berechtigungen.loeschung import loeschen_grants_and_authorship_in_session
from app.api.identity.lookup import RecordCollections
from app.api.identity.schemas import FLErasure, FLSignIn, FLSubject, FLSubjectSchiedsrichter, FLSubjectSeat, FLSubjectSpieler
from app.api.identity.services import (
    EntryKind,
    awaits_confirmation,
    build_bewerbung_pipeline,
    build_bewerbung_references_pipeline,
    build_erasure_due_count_pipeline,
    build_erasure_due_page_pipeline,
    build_erasure_pupil_pipeline,
    build_erasure_referee_pipeline,
    build_erasure_registrierung_pipeline,
    build_erasure_seat_pipeline,
    build_open_registrierungen_pipeline,
    build_pupil_pipeline,
    build_pupil_references_pipeline,
    build_referee_pipeline,
    build_referee_references_pipeline,
    build_registrierung_pipeline,
    build_registrierung_references_pipeline,
    build_seat_pipeline,
    build_seat_references_pipeline,
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
    referenced_addresses,
    seat_is_confirmed,
    seat_saison_statuses,
    seats_naming,
    statuses_of,
    unreferenced,
)
from app.api.kontakte.crud import loeschen_kontaktperson_in_session
from app.api.registrierungen.crud import loeschen_registrierungen_in_session
from app.api.registrierungen.services import build_eigene_registrierung_filter
from app.api.schiedsrichter.crud import ensure_ghost_schiedsrichter, loeschen_referee_in_session
from app.api.sperrliste.lookup import BanList
from app.api.spielberichte.crud import repoint_referee_reports_in_session
from app.api.spielbestaetigungen.crud import loeschen_referee_confirmations_in_session
from app.api.spielbestaetigungen.services import halter_of
from app.api.spieler.crud import ensure_ghost_spieler, loeschen_person_in_session
from app.core.codes import Code
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, anchor_in_db, erase_many_from_db, patch_many_in_db, refuse
from app.core.db import warn_about_the_grants
from app.core.journal import JournalLine, lost_its_answer
from app.core.logging import fl_logger, journal_logger
from app.core.readonly import ReadCollection
from app.core.recording import ERASED_ACTOR_MARKER, SYSTEM_ACTOR_EMAIL
from app.core.security import actor_pseudonym, erasure_journal_hash
from app.shared.einwilligung import is_confirmed
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

    # Live rows alone, here and in the flag: a retired person and a withdrawn team grant nothing, and
    # confirming one would open nothing.
    live_seat_rows = [row for row in seat_rows if not_exited(row)]
    live_schiedsrichter = [row for row in referee_rows if is_live(row) and folds_to((row.get("kontakt") or {}).get("email"), identifier)]
    live_spieler = [row for row in pupil_rows if is_live(row)]

    # Every live seat naming the address and not only its confirmed ones: the flag below reads an
    # unconfirmed seat's season too, so a seat whose season has no row stays loud whichever list counts it.
    statuses = seat_saison_statuses(row for row, _ in seats_naming(live_seat_rows, identifier))

    # The confirmation narrows HERE, through the predicates every reader shares, and never at a caller:
    # a caller-side check leaves the sign-in gate mailing, and a panel drawn for, a person nobody confirmed.
    return FLSubject(
        seats=[
            # `model_validate` rather than the constructor: the slot is a plain string here, and the
            # wire's closed set is what refuses one no endpoint publishes.
            FLSubjectSeat.model_validate(
                {
                    "saison_id": row["saison_id"],
                    "team_id": row["team_id"],
                    "rolle": slot,
                    "team_name": row["name"],
                    "saison_status": statuses[row["saison_id"]],
                }
            )
            for row in live_seat_rows
            for slot in own_seats(row, identifier)
        ],
        spieler=[FLSubjectSpieler(spieler_id=row["_id"]) for row in live_spieler if is_own_spieler(row)],
        schiedsrichter=[
            FLSubjectSchiedsrichter(schiedsrichter_id=row["_id"]) for row in live_schiedsrichter if is_own_schiedsrichter(row, identifier)
        ],
        # Over the records that could grant a panel alone: confirming a
        # seat on a `past` season opens nothing, so it neither raises the flag nor holds it down.
        unconfirmed=awaits_confirmation(
            [
                seat_is_confirmed(row, slot)
                for row, slot in seats_naming(live_seat_rows, identifier)
                if grants_a_panel(statuses[row["saison_id"]])
            ]
            + [is_confirmed(row.get("einwilligung")) for row in [*live_spieler, *live_schiedsrichter]]
        ),
    )


async def find_subject(identifier: str, records: RecordCollections) -> FLSubject:
    """Every confirmed, live record this folded identifier matches, and whether its granting records are all unconfirmed.

    Its reads gathered and outside any transaction, for `POST /identity/subject`; a caller inside one
    reads through `find_subject_in_session`.
    """

    seat_rows, referee_rows, pupil_rows = await asyncio.gather(
        *(aggregate_many_from_db(collection=collection, pipeline=pipeline) for collection, pipeline in _reads(identifier, records))
    )

    return _judged(identifier, seat_rows, referee_rows, pupil_rows)


async def find_own_entries(identifier: str, records: RecordCollections) -> tuple[FLSubject, frozenset[tuple[EntryKind, Any]]]:
    """The gate's five reads, judged twice: the subject's answer, and every own record of the address.

    The two only the gate pays for, a pending application's and a registration's, grant no panel and
    so are read on no page render.
    """

    seat_rows, referee_rows, pupil_rows, bewerbung_rows, registrierung_rows = await asyncio.gather(
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
    # REQUIRED: this is the lookup a transaction reaches, so no read of it can leave the session.
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
    # REQUIRED: a person endpoint judges this inside the session it reads or writes in, so a caller
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

    The rows must carry what `_judged` reads: each seat row's `austritt`, `name`, seats and `saison_status_lookup`'s `saison`, and
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


# --- The ERASURE: one registry of every step that reaches a person's data, run in one transaction.

# The kinds of person a step's records belong to, „Personengruppe“ in the published notice: never a
# `rolle` or a `Funktion`, each of which names something else here (`docs/glossary.md :: Funktion`).
PersonGroup = Literal["kontakt", "spieler", "schiedsrichter"]

# The scope of a person's own request and an administrator's: everything the address holds.
EACH_PERSON_GROUP: Final[frozenset[PersonGroup]] = frozenset(get_args(PersonGroup))


def _read(rows: Rows | None, kind: str) -> Rows:
    if rows is None:
        raise RuntimeError(f"an erasure step reads `{kind}`, which the subject of its scope never read")

    return rows


@dataclass(frozen=True, kw_only=True)
class Subject:
    """Every record one folded address holds that its scope uses, read before the erasure's first step writes.

    Each step takes its rows from here: one reading after another step wrote would miss what that step removed and answer zero.
    """

    identifier: str
    # The log's key for this person (`app/core/security.py :: actor_pseudonym`).
    pseudonym: str
    # Each `None` where no step of the scope uses it, never an empty list: its property raises, so a step
    # given a scope without its read fails rather than erasing nothing and answering zero.
    _saison_teams: Rows | None
    _bewerbungen: Rows | None
    _schiedsrichter: Rows | None
    _spieler: Rows | None
    _registrierungen: Rows | None
    # The live changes naming this address, its own and another address's whose new address it is.
    _address_change: Rows | None

    @property
    def saison_teams(self) -> Rows:
        return _read(self._saison_teams, "saison_teams")

    @property
    def bewerbungen(self) -> Rows:
        return _read(self._bewerbungen, "bewerbungen")

    @property
    def schiedsrichter(self) -> Rows:
        return _read(self._schiedsrichter, "schiedsrichter")

    @property
    def spieler(self) -> Rows:
        return _read(self._spieler, "spieler")

    @property
    def registrierungen(self) -> Rows:
        return _read(self._registrierungen, "registrierungen")

    @property
    def address_change(self) -> Rows:
        return _read(self._address_change, "address_changes")


async def resolve_subject(
    identifier: str,
    *,
    saison_teams_collection: ReadCollection,
    bewerbungen_collection: ReadCollection,
    schiedsrichter_collection: ReadCollection,
    spieler_collection: ReadCollection,
    registrierungen_collection: ReadCollection,
    address_changes_collection: ReadCollection,
    key: SecretStr,
    # REQUIRED: the erasure reads it inside its transaction, so a retry re-reads it, and the preview in
    # a snapshot, so it names the records of one moment.
    session: AsyncClientSession,
    # The previews' default: they name every record the full erasure takes.
    scope: frozenset[PersonGroup] = EACH_PERSON_GROUP,
) -> Subject:
    """What `identifier` holds, through the unnarrowed selections: an unconfirmed seat, a retired row and a declined registration included.

    One read at a time: a session runs one operation at a time, and gathered reads would race unseen.
    """

    async def read(collection: ReadCollection, pipeline: Sequence[Mapping[str, Any]]) -> Rows:
        return await aggregate_many_from_db(collection=collection, pipeline=pipeline, session=session)

    seats = _runs(loeschen_kontaktperson_in_session, scope)
    saison_teams = await read(saison_teams_collection, build_erasure_seat_pipeline(identifier)) if seats else None
    bewerbungen = await read(bewerbungen_collection, build_erasure_seat_pipeline(identifier)) if seats else None
    schiedsrichter = (
        await read(schiedsrichter_collection, build_erasure_referee_pipeline(identifier)) if _runs(loeschen_referee_in_session, scope) else None
    )
    spieler = await read(spieler_collection, build_erasure_pupil_pipeline(identifier)) if _runs(loeschen_person_in_session, scope) else None
    registrierungen = (
        await read(registrierungen_collection, build_erasure_registrierung_pipeline(identifier))
        if _runs(loeschen_registrierungen_in_session, scope)
        else None
    )
    address_change = (
        await read(address_changes_collection, build_erasure_address_change_pipeline(identifier))
        if _runs(end_the_address_changes_in_session, scope)
        else None
    )

    return Subject(
        identifier=identifier,
        pseudonym=actor_pseudonym(identifier, key=key),
        _saison_teams=saison_teams,
        _bewerbungen=bewerbungen,
        _schiedsrichter=schiedsrichter,
        _spieler=spieler,
        _registrierungen=registrierungen,
        _address_change=address_change,
    )


async def unattribute_in_session(
    *,
    action_log_collection: AsyncCollection,
    identifier: str,
    pseudonym: str,
    # REQUIRED: it reaches the rows this transaction's own steps filed under the person, a
    # self-erasure being recorded under the person it erases.
    session: AsyncClientSession,
) -> int:
    """Put the marker where the person stood as author of every log row they wrote, as a person or an administrator.

    The row keeps its kind, route, instant and image, saying an action happened and not by whom.
    """

    as_person = await unattribute_pseudonym_in_session(action_log_collection=action_log_collection, pseudonym=pseudonym, session=session)
    as_administrator = await reattribute_administrator_in_session(
        action_log_collection=action_log_collection, identifier=identifier, value=ERASED_ACTOR_MARKER, session=session
    )

    return as_person + as_administrator


async def unattribute_pseudonym_in_session(*, action_log_collection: AsyncCollection, pseudonym: str, session: AsyncClientSession) -> int:
    """The marker on every log row the person wrote signed in, by their pseudonym alone: what a restore's replay reaches without the address."""

    marked = await patch_many_in_db(
        collection=action_log_collection,
        db_filter={"actor.pseudonym": pseudonym},
        update={"$set": {"actor.pseudonym": ERASED_ACTOR_MARKER}},
        session=session,
    )

    return marked.modified_count


async def erase_pupil_actor_in_session(
    *,
    action_log_collection: AsyncCollection,
    pseudonym: str,
    # REQUIRED: outside the erasure's transaction, a pupil it rolls back would still lose their authorship.
    session: AsyncClientSession,
) -> None:
    """Put the marker where the person stood as a pupil in the log."""

    await patch_many_in_db(
        collection=action_log_collection,
        db_filter={"actor.pseudonym": pseudonym, "actor.funktion": "spieler"},
        update={"$set": {"actor.pseudonym": ERASED_ACTOR_MARKER}},
        session=session,
    )


async def _replaced_addresses(
    identifier: str, *, address_changes_collection: AsyncCollection, key: SecretStr, session: AsyncClientSession
) -> tuple[set[str], list[Any]]:
    """The hashes of every address this one replaced, through the chain of effects that moved the person here, and those effects.

    The journal's own keyed hash (`app/core/security.py :: erasure_journal_hash`), so no address is kept to find them by.
    """

    replaced: set[str] = set()
    effects: list[Any] = []
    sought = {erasure_journal_hash(identifier, key=key)}
    while sought:
        found = await aggregate_many_from_db(
            collection=address_changes_collection,
            pipeline=[{"$match": {"moved.person_hash": {"$in": sorted(sought)}}}, {"$project": {"moved": 1}}],
            session=session,
        )
        effects += [row["_id"] for row in found]
        sought = {str(row["moved"]["before"]) for row in found} - replaced
        replaced |= sought

    return replaced, effects


async def erase_the_mails_in_session(
    *,
    outbox_collection: AsyncCollection,
    address_changes_collection: AsyncCollection,
    identifier: str,
    key: SecretStr,
    session: AsyncClientSession,
) -> int:
    """Every mail to this folded address or one it replaced removed, and a replaced address withheld in every grant notice owed.

    Owed or settled, every kind but the sign-in library's deletion link, which asks the erasure. A settled row's
    retention bounds a row nobody erases; no reader serves an erased person's delivery history. No index serves the
    read, the collection holding a month of mail. Matched on the sign-in fold, a recipient being stored as its mail was
    owed.
    """

    replaced, effects = await _replaced_addresses(identifier, address_changes_collection=address_changes_collection, key=key, session=session)

    def theirs(value: Any) -> bool:
        if not isinstance(value, str):
            return False
        folded = sign_in_identifier(value)
        return folded == identifier or erasure_journal_hash(folded, key=key) in replaced

    rows = await aggregate_many_from_db(
        collection=outbox_collection,
        pipeline=[
            {"$match": {"art": {"$ne": "account_erasure"}}},
            {"$project": {"an": 1, "art": 1, "state": 1, "data.now": 1, "data.before": 1, "data.changed_by": 1}},
        ],
        session=session,
    )
    ids = [row["_id"] for row in rows if theirs(row["an"])]
    if ids:
        await erase_many_from_db(collection=outbox_collection, db_filter={"_id": {"$in": ids}}, session=session)

    # The person's own address the grants' step withholds; a replaced one only this chain finds.
    for row in rows:
        if row["_id"] in ids or row["art"] != "grant" or row["state"] != "open" or not replaced:
            continue
        data = row.get("data") or {}
        withheld: dict[str, Any] = {}
        for site in ("now", "before"):
            if theirs((data.get(site) or {}).get("address")):
                withheld |= {f"data.{site}.address": None, "data.withheld": "erased"}
        if theirs(data.get("changed_by")):
            withheld["data.changed_by"] = ERASED_ACTOR_MARKER
        if withheld:
            await patch_many_in_db(collection=outbox_collection, db_filter={"_id": row["_id"]}, update={"$set": withheld}, session=session)

    # The chain served its one reader: nothing links the erased person's addresses past this erasure.
    if effects:
        await patch_many_in_db(
            collection=address_changes_collection, db_filter={"_id": {"$in": effects}}, update={"$unset": {"moved": ""}}, session=session
        )

    return len(ids)


@dataclass(frozen=True)
class ErasureStep:
    """One member of the erasure: the collections it writes, whose records they are, and the function `erase_everything` calls by name."""

    reaches: frozenset[Collection]
    # `None` for a step serving no one kind of person: the full scope alone runs it. Every step leaving
    # the address in another record's images is one, so no scope runs it without the address pass.
    person_group: PersonGroup | None
    run: Callable[..., Awaitable[Any]]


# In the order `erase_everything` runs them: every step reaching a person's references before the
# step removing the person, the log's actor after every write the steps filed under them, and the
# address pass after every image they filed.
ERASURE_STEPS: Final[tuple[ErasureStep, ...]] = (
    ErasureStep(
        reaches=frozenset({Collection.SAISON_TEAMS, Collection.BEWERBUNGEN, Collection.SPIELBESTAETIGUNGEN, Collection.ACTION_LOG}),
        person_group="kontakt",
        run=loeschen_kontaktperson_in_session,
    ),
    # No kind's alone: a change belongs to the address, whatever it holds, and another address's to that one.
    ErasureStep(
        reaches=frozenset({Collection.ADDRESS_CHANGES, Collection.OUTBOX, Collection.ACTION_LOG}),
        person_group=None,
        run=end_the_address_changes_in_session,
    ),
    ErasureStep(
        reaches=frozenset({Collection.SPIELBESTAETIGUNGEN, Collection.ACTION_LOG}),
        person_group="schiedsrichter",
        run=loeschen_referee_confirmations_in_session,
    ),
    ErasureStep(
        reaches=frozenset({Collection.SPIELBERICHTE, Collection.ACTION_LOG}),
        person_group="schiedsrichter",
        run=repoint_referee_reports_in_session,
    ),
    ErasureStep(
        reaches=frozenset({Collection.SCHIEDSRICHTER, Collection.SPIELE, Collection.ACTION_LOG}),
        person_group="schiedsrichter",
        run=loeschen_referee_in_session,
    ),
    ErasureStep(
        reaches=frozenset({Collection.REGISTRIERUNGEN, Collection.ACTION_LOG}),
        person_group="spieler",
        run=loeschen_registrierungen_in_session,
    ),
    ErasureStep(
        reaches=frozenset({Collection.SPIELER, Collection.SAISON_SPIELER, Collection.SPIELBERICHTE, Collection.ACTION_LOG}),
        person_group="spieler",
        run=loeschen_person_in_session,
    ),
    # After the pupil's records went: the season's erasure leaves the address's other records, and their change, standing.
    ErasureStep(
        reaches=frozenset({Collection.ADDRESS_CHANGES, Collection.ACTION_LOG}), person_group="spieler", run=end_an_emptied_change_in_session
    ),
    # No kind's alone: a request is about an address, whatever it holds, or made by an administrator.
    ErasureStep(
        reaches=frozenset({Collection.GRANT_APPROVAL_REQUESTS, Collection.OUTBOX}), person_group=None, run=loeschen_antraege_in_session
    ),
    # No kind's alone: it changes records the person made as an administrator and as a seat holder, so
    # the pupil scope must never run it.
    ErasureStep(
        reaches=frozenset(
            {
                Collection.GRANTS,
                Collection.GRANTS_ANNOUNCED,
                Collection.OUTBOX,
                Collection.BEWERBUNGEN,
                Collection.REGISTRIERUNGEN,
                Collection.BAN_LIST,
                Collection.INVITATIONS,
            }
        ),
        person_group=None,
        run=loeschen_grants_and_authorship_in_session,
    ),
    # No kind's alone: a mail to the address is owed it whatever it holds. After the grants' step, which owes this
    # erasure's notices to the administrators who remain.
    ErasureStep(reaches=frozenset({Collection.OUTBOX, Collection.ADDRESS_CHANGES}), person_group=None, run=erase_the_mails_in_session),
    ErasureStep(reaches=frozenset({Collection.ACTION_LOG}), person_group=None, run=unattribute_in_session),
    # The pupil's share of the one above, finding nothing after it in the full scope: in the pupil scope a seat's or a
    # referee row's rows are that standing record's, and stay.
    ErasureStep(reaches=frozenset({Collection.ACTION_LOG}), person_group="spieler", run=erase_pupil_actor_in_session),
    # LAST: images filed before the erasure hold the address, and the seat clearing files more. No kind's
    # alone: in the pupil scope it would take a standing referee's or administrator's address out of their own images.
    ErasureStep(reaches=frozenset({Collection.ACTION_LOG}), person_group=None, run=redact_address_in_images),
)


def _runs(run: Callable[..., Awaitable[Any]], scope: frozenset[PersonGroup]) -> bool:
    """Whether the step running `run` belongs to this scope, read off its one declaration in `ERASURE_STEPS`."""

    (step,) = [step for step in ERASURE_STEPS if step.run is run]

    return scope == EACH_PERSON_GROUP if step.person_group is None else step.person_group in scope


async def erase_everything(
    identifier: str,
    *,
    scope: frozenset[PersonGroup],
    # Each by its own name, as every route hands a collection on: the static traces resolve a
    # collection by its parameter's spelling, never through an attribute of a bundle.
    spieler_collection: AsyncCollection,
    saison_spieler_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    spiele_collection: AsyncCollection,
    spielbestaetigungen_collection: AsyncCollection,
    spielberichte_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    action_log_collection: AsyncCollection,
    grants_collection: AsyncCollection,
    grants_announced_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    invitations_collection: AsyncCollection,
    ban_list_collection: AsyncCollection,
    address_changes_collection: AsyncCollection,
    grant_approval_requests_collection: AsyncCollection,
    sperrliste: BanList,
    # Whom the grant notice names as ending the person's grant: the person on their own request, the
    # administrator on theirs.
    changed_by: str,
    key: SecretStr,
    # The caller's, so every redaction of one erasure carries one instant.
    stamp: str,
    now: datetime,
    # REQUIRED: the caller's transaction, every step committing together or none.
    session: AsyncClientSession,
    # The person's own request, whose answer counts no change whose link has not reached this mailbox, as their preview
    # names none (`app/api/identity/person_router.py :: get_account_erasure_view`): it would tell them that somebody
    # typed their address. Every change naming it ends all the same.
    for_the_person: bool = False,
) -> FLErasure:
    """Erase every record of this folded address the scope reaches, in the caller's transaction.

    The subject is read HERE, so a retry after a conflict re-reads it. The caller runs its transaction inside an
    `ErasureJournal`, which journals once it commits.
    """

    subject = await resolve_subject(
        identifier,
        saison_teams_collection=saison_teams_collection,
        bewerbungen_collection=bewerbungen_collection,
        schiedsrichter_collection=schiedsrichter_collection,
        spieler_collection=spieler_collection,
        registrierungen_collection=registrierungen_collection,
        address_changes_collection=address_changes_collection,
        key=key,
        session=session,
        scope=scope,
    )

    # Each sentinel ahead of the step erasing its kind. The referee's takes the fixtures that booked the
    # person and the reports they sent; the pupils' takes the scorer and card entries naming them.
    if _runs(loeschen_referee_in_session, scope) and subject.schiedsrichter:
        await ensure_ghost_schiedsrichter(schiedsrichter_collection=schiedsrichter_collection, session=session)
    if _runs(loeschen_person_in_session, scope) and subject.spieler:
        await ensure_ghost_spieler(spieler_collection=spieler_collection, session=session)

    kontakt_seats = 0
    if _runs(loeschen_kontaktperson_in_session, scope):
        kontakt_seats = (
            await loeschen_kontaktperson_in_session(
                saison_teams_collection=saison_teams_collection,
                bewerbungen_collection=bewerbungen_collection,
                spielbestaetigungen_collection=spielbestaetigungen_collection,
                action_log_collection=action_log_collection,
                identifier=identifier,
                key=key,
                saison_team_rows=subject.saison_teams,
                bewerbung_rows=subject.bewerbungen,
                stamp=stamp,
                session=session,
            )
        ).kontakt_slots

    address_change = 0
    if _runs(end_the_address_changes_in_session, scope):
        address_change = await end_the_address_changes_in_session(
            address_changes_collection=address_changes_collection,
            outbox_collection=outbox_collection,
            action_log_collection=action_log_collection,
            identifier=identifier,
            rows=subject.address_change,
            now=now,
            stamp=stamp,
            session=session,
        )
        if for_the_person:
            others = others_naming(subject.address_change, identifier)
            address_change -= len(others) - len(known_to_the_new_mailbox(others))

    if _runs(loeschen_referee_confirmations_in_session, scope):
        await loeschen_referee_confirmations_in_session(
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            action_log_collection=action_log_collection,
            schiedsrichter_ids=[row["_id"] for row in subject.schiedsrichter],
            stamp=stamp,
            session=session,
        )

    # Repointed rather than removed, as the fixtures are: a report is the league's record of the match, after the ghost stands.
    if _runs(repoint_referee_reports_in_session, scope):
        await repoint_referee_reports_in_session(
            spielberichte_collection=spielberichte_collection,
            action_log_collection=action_log_collection,
            schiedsrichter_ids=[row["_id"] for row in subject.schiedsrichter],
            stamp=stamp,
            session=session,
        )

    spiele = 0
    if _runs(loeschen_referee_in_session, scope):
        for row in subject.schiedsrichter:
            spiele += await loeschen_referee_in_session(
                schiedsrichter_collection=schiedsrichter_collection,
                spiele_collection=spiele_collection,
                action_log_collection=action_log_collection,
                schiedsrichter_id=row["_id"],
                stamp=stamp,
                session=session,
            )

    registrierungen = 0
    if _runs(loeschen_registrierungen_in_session, scope):
        registrierungen = await loeschen_registrierungen_in_session(
            registrierungen_collection=registrierungen_collection,
            action_log_collection=action_log_collection,
            registrierungen=subject.registrierungen,
            stamp=stamp,
            session=session,
        )

    spieler, saison_spieler = 0, 0
    if _runs(loeschen_person_in_session, scope):
        for row in subject.spieler:
            erased = await loeschen_person_in_session(
                spieler_collection=spieler_collection,
                saison_spieler_collection=saison_spieler_collection,
                spielberichte_collection=spielberichte_collection,
                action_log_collection=action_log_collection,
                spieler_id=row["_id"],
                stamp=stamp,
                session=session,
            )
            spieler += erased.spieler
            saison_spieler += erased.saison_spieler

    if _runs(end_an_emptied_change_in_session, scope):
        address_change += await end_an_emptied_change_in_session(
            address_changes_collection=address_changes_collection,
            action_log_collection=action_log_collection,
            grants_collection=grants_collection,
            records=RecordCollections(
                saison_teams_collection=saison_teams_collection,
                spieler_collection=spieler_collection,
                schiedsrichter_collection=schiedsrichter_collection,
                bewerbungen_collection=bewerbungen_collection,
                registrierungen_collection=registrierungen_collection,
            ),
            identifier=identifier,
            now=now,
            stamp=stamp,
            session=session,
        )

    grant_approval_requests = 0
    if _runs(loeschen_antraege_in_session, scope):
        grant_approval_requests = await loeschen_antraege_in_session(
            grant_approval_requests_collection=grant_approval_requests_collection,
            outbox_collection=outbox_collection,
            identifier=identifier,
            now=now,
            session=session,
        )

    grants = 0
    if _runs(loeschen_grants_and_authorship_in_session, scope):
        grants = (
            await loeschen_grants_and_authorship_in_session(
                grants_collection=grants_collection,
                grants_announced_collection=grants_announced_collection,
                outbox_collection=outbox_collection,
                bewerbungen_collection=bewerbungen_collection,
                registrierungen_collection=registrierungen_collection,
                invitations_collection=invitations_collection,
                ban_list_collection=ban_list_collection,
                sperrliste=sperrliste,
                identifier=identifier,
                changed_by=changed_by,
                now=now,
                session=session,
            )
        ).removed_berechtigungen

    if _runs(erase_the_mails_in_session, scope):
        await erase_the_mails_in_session(
            outbox_collection=outbox_collection,
            address_changes_collection=address_changes_collection,
            identifier=identifier,
            key=key,
            session=session,
        )

    if _runs(unattribute_in_session, scope):
        await unattribute_in_session(
            action_log_collection=action_log_collection, identifier=identifier, pseudonym=subject.pseudonym, session=session
        )

    if _runs(erase_pupil_actor_in_session, scope):
        await erase_pupil_actor_in_session(action_log_collection=action_log_collection, pseudonym=subject.pseudonym, session=session)

    if _runs(redact_address_in_images, scope):
        await redact_address_in_images(action_log_collection=action_log_collection, identifier=identifier, stamp=stamp, session=session)

    return FLErasure(
        spieler=spieler,
        saison_spieler=saison_spieler,
        schiedsrichter=len(subject.schiedsrichter) if _runs(loeschen_referee_in_session, scope) else 0,
        spiele=spiele,
        kontakt_seats=kontakt_seats,
        registrierungen=registrierungen,
        address_change=address_change,
        grants=grants,
        grant_approval_requests=grant_approval_requests,
    )


class ErasureJournal[Geloescht: FLErasure]:
    """Entered around every erasure route's transaction block: the journal and the warnings follow its commit.

    Outside the block, whose abort a failure meets first; never in the callback, where a
    rolled-back attempt would be journalled.
    """

    def __init__(self, identifier: str, *, key: SecretStr, grants_collection: AsyncCollection) -> None:
        self._identifier = identifier
        self._key = key
        self._grants_collection = grants_collection
        self._erased: Geloescht | None = None

    async def __aenter__(self) -> ErasureJournal[Geloescht]:
        return self

    def took(self, erased: Geloescht) -> Geloescht:
        """The transaction's answer, handed on as it arrives."""

        self._erased = erased

        return erased

    async def __aexit__(self, kind: type[BaseException] | None, failure: BaseException | None, traceback: TracebackType | None) -> None:
        if failure is None:
            if self._erased is None:
                raise RuntimeError("an erasure route left its journal without handing it the transaction's answer")
            self._journal()
            # It fires on a list left holding no live grant, no owner or a dead row, never on one merely a
            # grant short: the ended grant's queued notice is what tells the other administrators.
            if self._erased.grants:
                await self._warn_about_the_grants()
        # A lost answer, never a refusal (which raises before any commit): it may have landed, and replaying an
        # erasure the person asked for wrongs nobody. Unwarned: the warning's read would meet the deadline that
        # lost the answer.
        elif lost_its_answer(failure):
            self._journal()

    def _journal(self) -> None:
        line = JournalLine(
            person_hash=erasure_journal_hash(self._identifier, key=self._key),
            art="erasure",
            pseudonym=actor_pseudonym(self._identifier, key=self._key),
            halter=halter_of(self._identifier, key=self._key),
        )
        journal_logger.info(line.text())

    async def _warn_about_the_grants(self) -> None:
        # Logged, never raised: the erasure committed, and an error answered here, a read meeting the deadline
        # say, keeps the person's sign-in account until they ask again.
        try:
            await warn_about_the_grants(self._grants_collection)
        except PyMongoError as failure:
            fl_logger.error("identity.grants_unchecked", extra={"error_code": Code.DATABASE_FAILED, "exception": type(failure).__name__})


async def unreferenced_of(
    identifiers: Sequence[str],
    records: RecordCollections,
    *,
    grants_collection: ReadCollection,
    address_changes_collection: ReadCollection,
) -> list[str]:
    """Which of these addresses no record references.

    Each collection is read once for the whole batch rather than once per address, which is what
    `app/shared/schemas/bounds.py :: REFERENCES_ADDRESSES_MAX` is measured against.
    """

    folded = sorted({sign_in_identifier(identifier) for identifier in identifiers})

    # No address, no read.
    if not folded:
        return []

    # No ban read beside these: a ban keeps no account, a barred address's going once no record holds it
    # (`docs/datenschutz.md :: 6`).
    (seat_rows, bewerbung_rows, referee_rows, pupil_rows, registrierung_rows, grant_rows, carry_rows) = await asyncio.gather(
        aggregate_many_from_db(collection=records.saison_teams_collection, pipeline=build_seat_references_pipeline(folded)),
        aggregate_many_from_db(collection=records.bewerbungen_collection, pipeline=build_bewerbung_references_pipeline(folded)),
        aggregate_many_from_db(collection=records.schiedsrichter_collection, pipeline=build_referee_references_pipeline(folded)),
        aggregate_many_from_db(collection=records.spieler_collection, pipeline=build_pupil_references_pipeline(folded)),
        aggregate_many_from_db(collection=records.registrierungen_collection, pipeline=build_registrierung_references_pipeline(folded)),
        # Every row as stored, never `app/api/berechtigungen/crud.py :: verwaltung_of`: a grant edited in
        # the database is in effect for nobody until the comparison sees it, and its account outlasts that.
        read_berechtigungen(grants_collection=grants_collection),
        aggregate_many_from_db(
            collection=address_changes_collection,
            pipeline=[{"$match": build_owed_carry_filter(folded)}, {"$project": {"move.old": 1}}],
        ),
    )

    # Before any address is judged: the whole batch answers nothing rather than all of it unreferenced.
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


# --- The SEASON-AFTER RULE's two readers: one outside any transaction
# naming the population, one inside each person's re-judging it.

# A pupil's own data alone: a seat, a referee row or a grant at the same address is another purpose's.
SPIELER_ONLY: Final[frozenset[PersonGroup]] = frozenset({"spieler"})


async def saison_statuses(*, saisons_collection: AsyncCollection) -> dict[str, FLSaisonStatus]:
    """Every season's status as stored now, read outside any transaction and never from a cache."""

    return statuses_of(await aggregate_many_from_db(collection=saisons_collection, pipeline=[{"$project": {"status": 1}}]))


async def _open(registrierungen_collection: AsyncCollection) -> frozenset[str]:
    return open_addresses(await aggregate_many_from_db(collection=registrierungen_collection, pipeline=build_open_registrierungen_pipeline()))


async def erasure_due_page(
    statuses: Mapping[str, FLSaisonStatus],
    *,
    after: ObjectId | None,
    size: int,
    spieler_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
) -> tuple[list[Mapping[str, Any]], int]:
    """The due pupils after `after`, at most `size` with their id and address, and how many are due in all.

    Read outside any transaction; each erasure judges its pupil again in its own.
    """

    kept = kept_saison_ids(statuses)
    if kept is None:
        return [], 0

    pipeline = build_erasure_due_page_pipeline(kept=kept, open=await _open(registrierungen_collection), after=after, size=size)
    [read] = await aggregate_many_from_db(collection=spieler_collection, pipeline=pipeline)

    return read["seite"], sum(row["count"] for row in read["count"])


async def due_count(
    statuses: Mapping[str, FLSaisonStatus], *, spieler_collection: AsyncCollection, registrierungen_collection: AsyncCollection
) -> int:
    """How many pupils the rule makes due under `statuses`, read outside any transaction."""

    kept = kept_saison_ids(statuses)
    if kept is None:
        return 0

    pipeline = build_erasure_due_count_pipeline(kept=kept, open=await _open(registrierungen_collection))

    return sum(row["count"] for row in await aggregate_many_from_db(collection=spieler_collection, pipeline=pipeline))


async def erase_if_still_due(
    spieler_id: Any,
    *,
    saisons_collection: AsyncCollection,
    spieler_collection: AsyncCollection,
    saison_spieler_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    spiele_collection: AsyncCollection,
    spielbestaetigungen_collection: AsyncCollection,
    spielberichte_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    action_log_collection: AsyncCollection,
    grants_collection: AsyncCollection,
    grants_announced_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    invitations_collection: AsyncCollection,
    ban_list_collection: AsyncCollection,
    address_changes_collection: AsyncCollection,
    grant_approval_requests_collection: AsyncCollection,
    sperrliste: BanList,
    key: SecretStr,
    stamp: str,
    now: datetime,
    # REQUIRED: the judgement and the erasure commit together, so a squad row or a registration
    # landing between the population read and this transaction keeps the person.
    session: AsyncClientSession,
) -> FLErasure | None:
    """Erase one pupil's own data where the rule holds in this transaction, or answer `None` where it does not.

    The address is read off the row here and never handed in: an address change moves it between two reads.
    """

    statuses = statuses_of(await aggregate_many_from_db(collection=saisons_collection, pipeline=[{"$project": {"status": 1}}], session=session))
    kept = kept_saison_ids(statuses)
    if kept is None:
        return None

    # A planned season `kept` leaves out joins it once activated, which no lower id refuses: anchored, an activation
    # committing after these statuses were read sends this pupil round. Normally none.
    if skipped := sorted(saison_id for saison_id, status in statuses.items() if status == "future" and saison_id not in kept):
        await anchor_in_db(collection=saisons_collection, db_filter={"_id": {"$in": skipped}}, session=session)

    pupils = await aggregate_many_from_db(
        collection=spieler_collection, pipeline=[{"$match": {"_id": spieler_id}}, {"$project": {"email": 1}}], session=session
    )
    email = pupils[0].get("email") if pupils else None
    if not isinstance(email, str):
        return None

    kader = await aggregate_many_from_db(
        collection=saison_spieler_collection, pipeline=[{"$match": {"spieler_id": spieler_id}}, {"$project": {"saison_id": 1}}], session=session
    )
    registrierungen = await aggregate_many_from_db(
        collection=registrierungen_collection,
        pipeline=[{"$match": build_eigene_registrierung_filter(email)}, {"$project": {"status": 1, "email": 1}}],
        session=session,
    )
    if not erasure_due(
        email=email,
        kader_saison_ids=[row["saison_id"] for row in kader],
        open=open_addresses(registrierungen),
        kept=kept,
    ):
        return None

    return await erase_everything(
        email,
        scope=SPIELER_ONLY,
        spieler_collection=spieler_collection,
        saison_spieler_collection=saison_spieler_collection,
        saison_teams_collection=saison_teams_collection,
        bewerbungen_collection=bewerbungen_collection,
        schiedsrichter_collection=schiedsrichter_collection,
        spiele_collection=spiele_collection,
        spielbestaetigungen_collection=spielbestaetigungen_collection,
        spielberichte_collection=spielberichte_collection,
        registrierungen_collection=registrierungen_collection,
        action_log_collection=action_log_collection,
        grants_collection=grants_collection,
        grants_announced_collection=grants_announced_collection,
        outbox_collection=outbox_collection,
        invitations_collection=invitations_collection,
        ban_list_collection=ban_list_collection,
        address_changes_collection=address_changes_collection,
        grant_approval_requests_collection=grant_approval_requests_collection,
        sperrliste=sperrliste,
        # Read by the grants step alone, which this scope never runs.
        changed_by=SYSTEM_ACTOR_EMAIL,
        key=key,
        stamp=stamp,
        now=now,
        session=session,
    )
