import asyncio
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final, Literal, get_args

from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.action_log.crud import reattribute_administrator_in_session
from app.api.address_change.crud import (
    build_erasure_address_change_pipeline,
    end_an_emptied_change_in_session,
    end_the_address_changes_in_session,
    known_to_the_new_mailbox,
    others_naming,
)
from app.api.address_change.services import build_owed_carry_filter, masked_address
from app.api.grants.crud import read_grants
from app.api.grants.erasure import erase_grants_in_session
from app.api.identity.lookup import RecordCollections
from app.api.identity.schemas import FLErasure, FLSignIn, FLSubject, FLSubjectSchiedsrichter, FLSubjectSeat, FLSubjectSpieler
from app.api.identity.services import (
    EntryKind,
    awaits_confirmation,
    build_bewerbung_pipeline,
    build_bewerbung_references_pipeline,
    build_erasure_due_page_pipeline,
    build_erasure_grant_pipeline,
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
from app.api.kontakte.crud import erase_kontaktperson_in_session
from app.api.outbox.services import ERASURE_SPARED_KINDS
from app.api.registrierungen.crud import erase_registrierungen_in_session
from app.api.registrierungen.services import build_eigene_registrierung_filter
from app.api.schiedsrichter.crud import ensure_ghost_schiedsrichter, erase_referee_in_session
from app.api.spielberichte.crud import repoint_referee_reports_in_session
from app.api.spielbestaetigungen.crud import erase_referee_confirmations_in_session
from app.api.spieler.crud import ensure_ghost_spieler, erase_person_in_session
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, anchor_in_db, delete_many_from_db, refuse
from app.core.readonly import ReadCollection
from app.core.recording import ERASED_ACTOR_MARKER
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

    # Live rows alone, here and in the flag: a retired referee and a withdrawn team grant nothing, and
    # confirming one would open nothing.
    live_seat_rows = [row for row in seat_rows if not_exited(row)]
    live_schiedsrichter = [row for row in referee_rows if is_live(row) and folds_to((row.get("kontakt") or {}).get("email"), identifier)]

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
        spieler=[FLSubjectSpieler(spieler_id=row["_id"]) for row in pupil_rows if is_own_spieler(row)],
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
            + [is_confirmed(row.get("einwilligung")) for row in [*pupil_rows, *live_schiedsrichter]]
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


def _seat_entry(collection: Collection, row: Mapping[str, Any], slot: str) -> str:
    entry = f"{collection}/{row['_id']}/{slot}"

    return f"{entry}/{row['kontakte'][slot]['einwilligung']['confirmed_at']}" if seat_is_confirmed(row, slot) else entry


@dataclass(frozen=True, kw_only=True)
class Subject:
    """Every record one folded address holds that its scope uses, read before the erasure's first step writes.

    Each step takes its rows from here: one reading after another step wrote would miss what that step removed and answer zero.
    """

    identifier: str
    # Each `None` where no step of the scope uses it, never an empty list: its property raises, so a step
    # given a scope without its read fails rather than erasing nothing and answering zero.
    _saison_teams: Rows | None
    _bewerbungen: Rows | None
    _schiedsrichter: Rows | None
    _spieler: Rows | None
    _registrierungen: Rows | None
    # The live changes naming this address, its own and another address's whose new address it is.
    _address_change: Rows | None
    _grants: Rows | None

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

    @property
    def grants(self) -> Rows:
        return _read(self._grants, "grants")

    def records(self) -> list[str]:
        """Each record this address alone holds as `collection/id`, in the full scope alone: what repeats its erasure after a restore.

        A seat's row holds up to three people and another address's change names a second one, so neither stands here.
        """

        kinds: tuple[tuple[Collection, Rows], ...] = (
            (Collection.SCHIEDSRICHTER, self.schiedsrichter),
            (Collection.SPIELER, self.spieler),
            (Collection.REGISTRIERUNGEN, self.registrierungen),
            (Collection.ADDRESS_CHANGES, [row for row in self.address_change if row["address"] == self.identifier]),
            (Collection.GRANTS, self.grants),
        )

        return [f"{collection}/{row['_id']}" for collection, rows in kinds for row in rows]

    def seats(self) -> list[str]:
        """Each slot the address sits in as `collection/id/slot`, in the full scope alone, so a restore's replay reads this person's address.

        A confirmed slot adds its `einwilligung.confirmed_at` as a fourth part: a seat passes to someone else, so a replay needs
        to tell whether the row a snapshot holds still seats this person. A day is neither an address nor a name.
        """

        kinds: tuple[tuple[Collection, Rows], ...] = ((Collection.SAISON_TEAMS, self.saison_teams), (Collection.BEWERBUNGEN, self.bewerbungen))

        return [_seat_entry(collection, row, slot) for collection, rows in kinds for row, slot in seats_naming(rows, self.identifier)]

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

    seats = _runs(erase_kontaktperson_in_session, scope)
    saison_teams = await read(saison_teams_collection, build_erasure_seat_pipeline(identifier)) if seats else None
    bewerbungen = await read(bewerbungen_collection, build_erasure_seat_pipeline(identifier)) if seats else None
    schiedsrichter = (
        await read(schiedsrichter_collection, build_erasure_referee_pipeline(identifier)) if _runs(erase_referee_in_session, scope) else None
    )
    spieler = await read(spieler_collection, build_erasure_pupil_pipeline(identifier)) if _runs(erase_person_in_session, scope) else None
    registrierungen = (
        await read(registrierungen_collection, build_erasure_registrierung_pipeline(identifier))
        if _runs(erase_registrierungen_in_session, scope)
        else None
    )
    address_change = (
        await read(address_changes_collection, build_erasure_address_change_pipeline(identifier))
        if _runs(end_the_address_changes_in_session, scope)
        else None
    )
    grants = await read(grants_collection, build_erasure_grant_pipeline(identifier)) if _runs(erase_grants_in_session, scope) else None

    return Subject(
        identifier=identifier,
        _saison_teams=saison_teams,
        _bewerbungen=bewerbungen,
        _schiedsrichter=schiedsrichter,
        _spieler=spieler,
        _registrierungen=registrierungen,
        _address_change=address_change,
        _grants=grants,
    )


def _mail_sites_naming(row: Mapping[str, Any], identifier: str) -> list[str]:
    """Where one `outbox` row names this folded address in full: its recipient, and a grant notice's address."""

    held = {"to": row["to"], "data.address": (row.get("data") or {}).get("address") if row["kind"] == "grant" else None}

    return [path for path, value in held.items() if isinstance(value, str) and sign_in_identifier(value) == identifier]


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
    """What one erasure took: the counts its route answers, and where the person stood for its lines, by id, all empty in a narrower scope."""

    counts: FLErasure
    records: list[str]
    seats: list[str]
    # Every other field that named the address as `collection/id/path`, so an address holding no record of its own still
    # replays after a restore, and a row naming two people says which one this is.
    rows: list[str]


@dataclass(frozen=True)
class ErasureStep:
    """One member of the erasure: the collections it writes, whose records they are, and the function `erase_everything` calls by name."""

    reaches: frozenset[Collection]
    # `None` for a step serving no one kind of person: the full scope alone runs it.
    person_group: PersonGroup | None
    run: Callable[..., Awaitable[Any]]


# In the order `erase_everything` runs them: every step reaching a person's references before the
# step removing the person.
ERASURE_STEPS: Final[tuple[ErasureStep, ...]] = (
    ErasureStep(
        reaches=frozenset({Collection.SAISON_TEAMS, Collection.BEWERBUNGEN, Collection.SPIELBESTAETIGUNGEN}),
        person_group="kontakt",
        run=erase_kontaktperson_in_session,
    ),
    # No kind's alone: a change belongs to the address, whatever it holds, and another address's to that one.
    ErasureStep(reaches=frozenset({Collection.ADDRESS_CHANGES, Collection.OUTBOX}), person_group=None, run=end_the_address_changes_in_session),
    ErasureStep(reaches=frozenset({Collection.SPIELBESTAETIGUNGEN}), person_group="schiedsrichter", run=erase_referee_confirmations_in_session),
    ErasureStep(reaches=frozenset({Collection.SPIELBERICHTE}), person_group="schiedsrichter", run=repoint_referee_reports_in_session),
    ErasureStep(reaches=frozenset({Collection.SCHIEDSRICHTER, Collection.SPIELE}), person_group="schiedsrichter", run=erase_referee_in_session),
    ErasureStep(reaches=frozenset({Collection.REGISTRIERUNGEN}), person_group="spieler", run=erase_registrierungen_in_session),
    ErasureStep(
        reaches=frozenset({Collection.SPIELER, Collection.SAISON_SPIELER, Collection.SPIELBERICHTE}),
        person_group="spieler",
        run=erase_person_in_session,
    ),
    # After the pupil's records went: the season's erasure leaves the address's other records, and their change, standing.
    ErasureStep(reaches=frozenset({Collection.ADDRESS_CHANGES}), person_group="spieler", run=end_an_emptied_change_in_session),
    # No kind's alone: a grant is an address's whatever else it holds, so the pupil scope must never run it.
    ErasureStep(reaches=frozenset({Collection.GRANTS, Collection.OUTBOX}), person_group=None, run=erase_grants_in_session),
    # No kind's alone: a mail to the address is owed it whatever it holds. After the grants' step, which owes this
    # erasure's notices to the administrators who remain.
    ErasureStep(reaches=frozenset({Collection.OUTBOX}), person_group=None, run=erase_the_mails_in_session),
    # For every erased address, a grantee stopped before it took effect included: a grant act's label holds that address.
    ErasureStep(reaches=frozenset({Collection.ACTION_LOG}), person_group=None, run=reattribute_administrator_in_session),
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
    outbox_collection: AsyncCollection,
    address_changes_collection: AsyncCollection,
    now: datetime,
    # REQUIRED: the caller's transaction, every step committing together or none.
    session: AsyncClientSession,
    # The person's own request, whose answer counts no change whose link has not reached this mailbox, as their preview
    # names none (`app/api/identity/person_router.py :: get_account_erasure_view`): it would tell them that somebody
    # typed their address. Every change naming it ends all the same.
    for_the_person: bool = False,
) -> Erasure:
    """Erase every record of this folded address the scope reaches, in the caller's transaction.

    The subject is read HERE, so a retry after a conflict re-reads it. A request's route notes the answer's `records`,
    `seats` and `rows` in its `Journal`, which writes the erasure's lines once it commits.
    """

    subject = await resolve_subject(
        identifier,
        saison_teams_collection=saison_teams_collection,
        bewerbungen_collection=bewerbungen_collection,
        schiedsrichter_collection=schiedsrichter_collection,
        spieler_collection=spieler_collection,
        registrierungen_collection=registrierungen_collection,
        address_changes_collection=address_changes_collection,
        grants_collection=grants_collection,
        session=session,
        scope=scope,
    )

    # Each sentinel ahead of the step erasing its kind. The referee's takes the fixtures that booked the
    # person and the reports they sent; the pupils' takes the scorer and card entries naming them.
    if _runs(erase_referee_in_session, scope) and subject.schiedsrichter:
        await ensure_ghost_schiedsrichter(schiedsrichter_collection=schiedsrichter_collection, session=session)
    if _runs(erase_person_in_session, scope) and subject.spieler:
        await ensure_ghost_spieler(spieler_collection=spieler_collection, session=session)

    kontakt_seats = 0
    if _runs(erase_kontaktperson_in_session, scope):
        kontakt_seats = await erase_kontaktperson_in_session(
            saison_teams_collection=saison_teams_collection,
            bewerbungen_collection=bewerbungen_collection,
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            identifier=identifier,
            saison_team_rows=subject.saison_teams,
            bewerbung_rows=subject.bewerbungen,
            session=session,
        )

    address_change = 0
    if _runs(end_the_address_changes_in_session, scope):
        address_change = await end_the_address_changes_in_session(
            address_changes_collection=address_changes_collection,
            grants_collection=grants_collection,
            outbox_collection=outbox_collection,
            identifier=identifier,
            rows=subject.address_change,
            now=now,
            session=session,
        )
        if for_the_person:
            others = others_naming(subject.address_change, identifier)
            address_change -= len(others) - len(known_to_the_new_mailbox(others))

    if _runs(erase_referee_confirmations_in_session, scope):
        await erase_referee_confirmations_in_session(
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            schiedsrichter_ids=[row["_id"] for row in subject.schiedsrichter],
            session=session,
        )

    # Repointed rather than removed, as the fixtures are: a report is the league's record of the match, after the ghost stands.
    if _runs(repoint_referee_reports_in_session, scope):
        await repoint_referee_reports_in_session(
            spielberichte_collection=spielberichte_collection,
            schiedsrichter_ids=[row["_id"] for row in subject.schiedsrichter],
            session=session,
        )

    spiele = 0
    if _runs(erase_referee_in_session, scope):
        for row in subject.schiedsrichter:
            spiele += await erase_referee_in_session(
                schiedsrichter_collection=schiedsrichter_collection,
                spiele_collection=spiele_collection,
                schiedsrichter_id=row["_id"],
                session=session,
            )

    registrierungen = 0
    if _runs(erase_registrierungen_in_session, scope):
        registrierungen = await erase_registrierungen_in_session(
            registrierungen_collection=registrierungen_collection,
            registrierungen=subject.registrierungen,
            session=session,
        )

    spieler, saison_spieler = 0, 0
    if _runs(erase_person_in_session, scope):
        for row in subject.spieler:
            erased = await erase_person_in_session(
                spieler_collection=spieler_collection,
                saison_spieler_collection=saison_spieler_collection,
                spielberichte_collection=spielberichte_collection,
                spieler_id=row["_id"],
                session=session,
            )
            spieler += erased.spieler
            saison_spieler += erased.saison_spieler

    if _runs(end_an_emptied_change_in_session, scope):
        address_change += await end_an_emptied_change_in_session(
            address_changes_collection=address_changes_collection,
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
            session=session,
        )

    grants = 0
    named: list[str] = []
    if _runs(erase_grants_in_session, scope):
        grants = await erase_grants_in_session(
            grants_collection=grants_collection,
            outbox_collection=outbox_collection,
            identifier=identifier,
            now=now,
            session=session,
        )
        named += subject.changes_naming_it()

    if _runs(erase_the_mails_in_session, scope):
        named += await erase_the_mails_in_session(outbox_collection=outbox_collection, identifier=identifier, session=session)

    if _runs(reattribute_administrator_in_session, scope):
        named += await log_rows_naming(action_log_collection=action_log_collection, identifier=identifier, session=session)
        await reattribute_administrator_in_session(
            action_log_collection=action_log_collection, identifier=identifier, value=ERASED_ACTOR_MARKER, session=session
        )

    return Erasure(
        counts=FLErasure(
            spieler=spieler,
            saison_spieler=saison_spieler,
            schiedsrichter=len(subject.schiedsrichter) if _runs(erase_referee_in_session, scope) else 0,
            spiele=spiele,
            kontakt_seats=kontakt_seats,
            registrierungen=registrierungen,
            address_change=address_change,
            grants=grants,
        ),
        records=subject.records() if scope == EACH_PERSON_GROUP else [],
        seats=subject.seats() if scope == EACH_PERSON_GROUP else [],
        rows=named,
    )


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
        # Every row as stored, never `app/api/grants/crud.py :: read_admin_tier_of`: a waiting grant's account stands too.
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


# --- The SEASON-AFTER RULE's two readers: one outside any transaction
# naming the population, one inside each person's re-judging it.

# A pupil's own data alone: a seat, a referee row or a grant at the same address is another purpose's.
SPIELER_ONLY: Final[frozenset[PersonGroup]] = frozenset({"spieler"})


async def saison_statuses(*, saisons_collection: AsyncCollection) -> dict[str, FLSaisonStatus]:
    """Every season's status as stored now, read outside any transaction and never from a cache."""

    return statuses_of(await aggregate_many_from_db(collection=saisons_collection, pipeline=[{"$project": {"status": 1}}]))


async def _pending_addresses(registrierungen_collection: AsyncCollection) -> frozenset[str]:
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

    pipeline = build_erasure_due_page_pipeline(
        kept=kept, pending_addresses=await _pending_addresses(registrierungen_collection), after=after, size=size
    )
    [read] = await aggregate_many_from_db(collection=spieler_collection, pipeline=pipeline)

    return read["page"], sum(row["count"] for row in read["count"])


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
    outbox_collection: AsyncCollection,
    address_changes_collection: AsyncCollection,
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
        pending_addresses=open_addresses(registrierungen),
        kept=kept,
    ):
        return None

    erasure = await erase_everything(
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
        outbox_collection=outbox_collection,
        address_changes_collection=address_changes_collection,
        now=now,
        session=session,
    )

    return erasure.counts
