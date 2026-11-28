from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, Final, Literal

from bson import ObjectId
from fastapi import APIRouter
from pymongo import ASCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aufstellungen.services import (
    aufstellung_marks,
    aufstellung_reminder_key,
    aufstellung_reminder_owed,
    aufstellung_stands,
    build_aufstellung_reminder_filter,
)
from app.api.invitations.services import confirmed_recipients
from app.api.outbox.schemas import (
    FLAufstellungReminderData,
    FLOutboxData,
    FLOutboxReference,
    FLOutboxTeam,
    FLSpielEinteilungData,
    FLSpielMailAppointment,
    FLSpielRequestData,
)
from app.api.outbox.services import OwedMail, enqueue_mails
from app.api.spielbestaetigungen.crud import (
    JUDGED_SPIEL_FIELDS,
    anchor_the_mailboxes_told,
    anchor_the_referees_told,
    anchor_the_spiele_acted_on,
    pull_named_spiele,
)
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungClosedReason,
    FLSpielbestaetigungSweepResponse,
)
from app.api.spielbestaetigungen.services import (
    CLOSE_FIELDS,
    AnsetzungState,
    ansetzung_values_of,
    answers_at_its_end,
    asked_with_its_move,
    austritte_of,
    build_answerable_filter,
    build_held_filter,
    build_holding_filter,
    build_reminder_filter,
    build_request_filter,
    build_unasked_filter,
    cancelled_notice_of,
    compose_ansetzung,
    compose_asked_update,
    compose_closing_update,
    compose_reminder_update,
    compose_spielbestaetigung,
    decision_of,
    junction_names_of,
    moved_notice_of,
    notice_data_of,
    notice_owed,
    parties_of,
    party_key,
    reason_to_close,
    reference_of,
    request_is_due,
    side_of,
    spiel_mail_ansetzung_from_spiel,
    spiel_mail_ansetzung_of,
    spiel_mail_appointment_of,
    still_a_party,
    team_mails,
    view_ansetzung_of,
    was_discarded,
)
from app.api.spiele.schemas import team_id_of
from app.core.collections import Collection
from app.core.crud import patch_one_in_db, post_many_to_db, pull_many_from_db, pull_one_from_db, pull_whole_from_db
from app.core.dependencies import (
    AufstellungenReadCollection,
    DBClient,
    GermanDay,
    GermanyNow,
    OutboxCollection,
    SaisonsCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
)
from app.core.middlewares import PASS
from app.core.security import SYSTEM_TIER
from app.core.transactions import Saved, save_each
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.literals import KONTAKT_SEATS

# System tier: the timer holds no session.
router = APIRouter(
    prefix="/spielbestaetigungen",
    dependencies=SYSTEM_TIER,
)

WHAT: Final = "Confirmation"


def _due_or_refused[T](items: Iterable[T], due: Callable[[T], object]) -> list[T]:
    """The items `due` answers for, and each one it raises on: its own transaction meets the refusal again, and logs it."""

    kept: list[T] = []
    for item in items:
        # Any class, as `save_each` passes any over; not `BaseException`, so a cancellation still ends the call.
        try:
            if due(item):
                kept.append(item)
        except Exception:
            kept.append(item)

    return kept


def _by(rows: Iterable[Mapping[str, Any]], key: str) -> dict[Any, Mapping[str, Any]]:
    return {row[key]: row for row in rows}


async def _spiele(
    *, spiele_collection: AsyncCollection, saison_id: str, ids: Iterable[Any], session: AsyncClientSession | None
) -> dict[Any, Mapping[str, Any]]:
    wanted = list(set(ids))
    if not wanted:
        return {}

    return _by(
        await pull_named_spiele(
            spiele_collection=spiele_collection,
            db_filter={"saison_id": saison_id, "_id": {"$in": wanted}},
            projection=JUDGED_SPIEL_FIELDS,
            limit=LIST_LIMIT_DEFAULT,
            session=session,
        ),
        "_id",
    )


async def _junctions(
    *,
    saison_teams_collection: AsyncCollection,
    saison_id: str,
    spiele: Iterable[Mapping[str, Any]],
    rows: Iterable[Mapping[str, Any]],
    session: AsyncClientSession | None,
) -> dict[Any, Mapping[str, Any]]:
    """The season rows of the clubs `spiele` field now and `rows` asked about: their seats as they stand now, their exit, and their name.

    Both sets where a step asks `asked_with_its_move`, which judges a row's own clubs and its fixture's current sides.
    """

    team_ids = [
        *(team_id_of(spiel, side) for spiel in spiele for side in ("team1", "team2")),
        *(row["ansetzung"][key] for row in rows for key in ("team1_id", "team2_id")),
    ]
    wanted = list({team_id for team_id in team_ids if team_id is not None})
    if not wanted:
        return {}

    return _by(
        await pull_many_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "team_id": {"$in": wanted}},
            projection=["team_id", "name", "kontakte", "austritt"],
            limit=LIST_LIMIT_DEFAULT,
            session=session,
        ),
        "team_id",
    )


async def _referee_addresses(
    *, schiedsrichter_collection: AsyncCollection, ids: Iterable[Any], session: AsyncClientSession | None
) -> dict[Any, str]:
    """The referees' addresses, by id: every record holds one, and an erasure takes a referee's rows with the record."""

    wanted = list(set(ids))
    if not wanted:
        return {}

    referees = await pull_many_from_db(
        collection=schiedsrichter_collection,
        db_filter={"_id": {"$in": wanted}},
        projection=["kontakt.email"],
        limit=LIST_LIMIT_DEFAULT,
        session=session,
    )

    return {referee["_id"]: referee["kontakt"]["email"] for referee in referees}


def _request(
    *,
    row: Mapping[str, Any],
    spiel: Mapping[str, Any],
    kontakte: Any,
    kind: Literal["spiel_request", "spiel_reminder"],
    moved_from: FLSpielMailAppointment | None = None,
) -> list[OwedMail]:
    """A team row's request or reminder, one mail per mailbox of its club's confirmed seats: the club answers signed in.

    Keyed by the row and the seat alone: the row's stamp, `asked_at` or `reminded_at`, is what keeps a later pass from
    owing it again.
    """

    view = view_ansetzung_of(spiel)
    team = view.team1_name if side_of(row) == "team1" else view.team2_name
    data = FLSpielRequestData(
        kind=kind,
        team=team,
        team_id=row["party"]["team_id"],
        saison_id=row["saison_id"],
        ansetzung=spiel_mail_ansetzung_of(view),
        deadline=row["deadline"],
        moved_from=moved_from,
    )

    return team_mails(spielbestaetigung_raw=row, kontakte=kontakte, data=data, occasion="request" if kind == "spiel_request" else "reminder")


@dataclass
class _Closed:
    closed: int
    mails: int


@dataclass
class _MintPlan:
    """One fixture's writes and mails; written whole or not at all, so a club is never asked while its opponent waits."""

    inserts: list[dict[str, Any]] = field(default_factory=list)
    # Each row's filter beside its update: a seat minted afresh on an open row, or a row about a slot the fixture left closed.
    updates: list[tuple[Mapping[str, Any], Mapping[str, Any]]] = field(default_factory=list)
    mails: list[OwedMail] = field(default_factory=list)
    asked: int = 0
    # Rows about a slot the fixture left, closed beside the request asking about the new one.
    closed: int = 0
    # The season rows of the clubs a mail was owed to, their seats as the mint read them.
    seated: set[Any] = field(default_factory=set)
    # The referees a row was written for, off the bookings the mint read.
    refereed: set[Any] = field(default_factory=set)

    @property
    def written(self) -> int:
        return len(self.inserts) + len(self.updates)


@dataclass
class _Minted:
    """What one mint transaction committed."""

    written: int
    asked: int
    closed: int
    mails: int


@router.post(
    "/saisons/{saison_id}/sweep",
    summary="Run one season's fixture confirmation pass",
    openapi_extra=PASS,
)
async def sweep_spielbestaetigungen(
    saison_id: str,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spiele_collection: SpieleCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    outbox_collection: OutboxCollection,
    aufstellungen_collection: AufstellungenReadCollection,
    db: DBClient,
    today: GermanDay,
    germany_now: GermanyNow,
) -> FLSpielbestaetigungSweepResponse:
    """Close, mint and remind one season's fixture confirmations as of today, owing each mail with its row, and answer what it did, counted.

    Each step saves one row or fixture at a time, one that fails passed over and counted in `failed`, and those the call's
    deadline leaves stay due for the next pass. A season that is not `active` is passed by whole.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"])
    # Every step's gate as well as the listing's, answered rather than refused: a mistyped call, or a season ended
    # between the listing and this call, mails nobody and writes nothing.
    if saison_raw.get("status") != "active":
        return FLSpielbestaetigungSweepResponse(closed=0, asked=0, reminded=0, mails=0, failed=0)

    cut = False

    async def step[T](run: Callable[[], Awaitable[Saved[T]]]) -> Saved[T]:
        """One step, unless the deadline cut one before it, which every later step would meet too."""

        nonlocal cut
        if cut:
            return Saved()

        saved = await run()
        cut = saved.cut
        return saved

    async def close_reads(
        rows: list[Mapping[str, Any]], session: AsyncClientSession | None
    ) -> tuple[dict[Any, Mapping[str, Any]], dict[Any, Mapping[str, Any]], Mapping[Any, str]]:
        """The fixtures the rows ask about, and the season rows of the clubs the fixtures field now and the rows asked about."""

        spiele = await _spiele(spiele_collection=spiele_collection, saison_id=saison_id, ids=[row["spiel_id"] for row in rows], session=session)
        # The fixtures' current sides too, as the mint reads them: whether a move is the mint's to close turns on their exits.
        junctions = await _junctions(
            saison_teams_collection=saison_teams_collection, saison_id=saison_id, spiele=spiele.values(), rows=rows, session=session
        )

        return spiele, junctions, austritte_of(junctions.values())

    def reason_of(row: Mapping[str, Any], spiel: Mapping[str, Any], austritte: Mapping[Any, str]) -> FLSpielbestaetigungClosedReason | None:
        """Why the close shuts this row now, `None` where it stands."""

        reason = reason_to_close(row=row, spiel=spiel, austritte=austritte, now=germany_now)
        # A move whose new slot the mint asks today is the mint's to close, its request the one mail telling of it.
        if reason == "ansetzung_changed" and asked_with_its_move(row=row, spiel=spiel, austritte=austritte, now=germany_now):
            return None

        return reason

    async def close_one(session: AsyncClientSession, row: Mapping[str, Any]) -> _Closed:
        """Judge one row holding its question against its fixture as it stands, and close it, owing its notice."""

        stored = await spielbestaetigungen_collection.find_one(
            {"_id": row["_id"], "saison_id": saison_id, **build_holding_filter()}, CLOSE_FIELDS, session=session
        )
        if stored is None:
            return _Closed(closed=0, mails=0)

        spiele, junctions, austritte = await close_reads([stored], session)
        spiel = spiele[stored["spiel_id"]]
        reason = reason_of(stored, spiel, austritte)
        if reason is None:
            return _Closed(closed=0, mails=0)

        # Ahead of the writes: the fixture the row was judged against, so a save moving it since this read conflicts with
        # it rather than leaving a notice about the slot the save left.
        await anchor_the_spiele_acted_on(spiele_collection=spiele_collection, spiel_ids=[stored["spiel_id"]], session=session)

        mails: list[OwedMail] = []
        party = stored["party"]
        if notice_owed(row=stored, reason=reason, spiel=spiel, now=germany_now):
            # The clubs the row asked about, off the season rows read by its own clubs.
            names = junction_names_of(
                spielbestaetigung_raw=stored, ansetzung_state=AnsetzungState(spiel=spiel, junctions=list(junctions.values()))
            )
            appointment = spiel_mail_appointment_of(spielbestaetigung_raw=stored, names=names)
            data: FLOutboxData
            if reason == "ansetzung_changed":
                # Its new slot not asked today: told at once, as it stands, a slot to come being asked by the mint.
                stays = still_a_party(row=stored, spiel=spiel)
                data = moved_notice_of(
                    party_kind=party["kind"],
                    appointment=appointment,
                    moved_to=spiel_mail_ansetzung_from_spiel(spiel) if stays else None,
                    stays=stays,
                )
            elif reason == "cancelled":
                data = cancelled_notice_of(party_kind=party["kind"], appointment=appointment, sonderereignis=spiel["sonderereignis"])
            else:
                data = notice_data_of(reason=reason, party_kind=party["kind"], appointment=appointment)

            if party["kind"] == "schiedsrichter":
                addresses = await _referee_addresses(
                    schiedsrichter_collection=schiedsrichter_collection, ids=[party["schiedsrichter_id"]], session=session
                )
                mails.append(
                    OwedMail(
                        key=f"spielbestaetigung/{stored['_id']}/{reason}",
                        to=addresses[party["schiedsrichter_id"]],
                        data=data,
                        reference=reference_of(spielbestaetigung_id=stored["_id"], seat=None),
                    )
                )
                # Ahead of the writes: the referee whose address was read, so an address moved or an erasure beside this
                # step conflicts with it rather than leaving the replaced address told.
                await anchor_the_referees_told(
                    schiedsrichter_collection=schiedsrichter_collection, schiedsrichter_ids=[party["schiedsrichter_id"]], session=session
                )
            # Read off the season row's seats as they stand now, a mailbox per message with no name in it. A replaced
            # club's people left with its row, so nobody is told.
            elif (junction := junctions.get(party["team_id"])) is not None:
                mails = team_mails(spielbestaetigung_raw=stored, kontakte=junction.get("kontakte"), data=data, occasion=reason)
                if mails:
                    # As the referee's: a seat emptied or an address moved beside this step conflicts with it.
                    await anchor_the_mailboxes_told(
                        saison_teams_collection=saison_teams_collection, saison_team_ids=[junction["_id"]], session=session
                    )

        await patch_one_in_db(
            collection=spielbestaetigungen_collection,
            db_filter={"_id": stored["_id"], **build_holding_filter()},
            # A held row is closed again only as a discard: its end keeps the mark of what it answered, and whether it
            # answered the fixture as the fixture stands at this read.
            update=compose_closing_update(
                reason=reason,
                discarded=was_discarded(stored),
                matched=answers_at_its_end(spielbestaetigung_raw=stored, spiel=spiel, reason=reason),
            ),
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )
        await enqueue_mails(outbox_collection=outbox_collection, session=session, mails=mails, now=germany_now)

        return _Closed(closed=1, mails=len(mails))

    async def close() -> Saved[_Closed]:
        """Every row holding its question that its fixture as it stands closes, one at a time."""

        rows = await pull_many_from_db(
            collection=spielbestaetigungen_collection,
            db_filter={"saison_id": saison_id, **build_holding_filter()},
            # Oldest Ansetzung first, the likeliest to have been decided; `_id` keeps the read one read.
            sort_by=[("ansetzung.date", ASCENDING), ("_id", ASCENDING)],
            # The season's every row holding its question: what the close judges, and not each seat's hashes.
            projection=CLOSE_FIELDS,
            limit=LIST_LIMIT_DEFAULT,
        )
        spiele, _, austritte = await close_reads(rows, None)

        return await save_each(
            db=db,
            rows=_due_or_refused(rows, lambda row: reason_of(row, spiele[row["spiel_id"]], austritte)),
            save=close_one,
            what=WHAT,
            clock="close",
        )

    async def mint_window(db_filter: Mapping[str, Any], session: AsyncClientSession | None) -> list[Mapping[str, Any]]:
        return await pull_named_spiele(
            spiele_collection=spiele_collection,
            db_filter=db_filter,
            projection=JUDGED_SPIEL_FIELDS,
            # Soonest first, so the fixture whose deadline comes first is asked first.
            sort_by=[("date", ASCENDING), ("time", ASCENDING), ("_id", ASCENDING)],
            limit=LIST_LIMIT_DEFAULT,
            session=session,
        )

    async def planner(
        spiele: list[Mapping[str, Any]], read: list[Mapping[str, Any]], session: AsyncClientSession | None
    ) -> Callable[[Mapping[str, Any]], _MintPlan]:
        """What the mint writes for each of these fixtures, `read` their rows holding their party's question."""

        held = {(row["spiel_id"], party_key(row["party"]), ansetzung_values_of(row["ansetzung"])): row for row in read}
        current = {spiel["_id"]: ansetzung_values_of(compose_ansetzung(spiel)) for spiel in spiele}
        by_id = {spiel["_id"]: spiel for spiel in spiele}

        # The clubs each row asked about too: a move's notice names the slot left by them, and its rows are judged
        # against their exits.
        junctions = await _junctions(
            saison_teams_collection=saison_teams_collection, saison_id=saison_id, spiele=spiele, rows=read, session=session
        )
        austritte = austritte_of(junctions.values())
        junction_rows = list(junctions.values())

        # Each row holding its party's question about an Ansetzung its fixture left, a discard as an agreement, the mint's
        # to close where its party is asked about the new one now, oldest first, so the newest is the slot a request
        # names as left. Any other waits for the close step, which shuts it and tells of it first.
        moved: dict[tuple[Any, tuple[str, Any]], list[Mapping[str, Any]]] = {}
        waiting: set[Any] = set()
        for row in sorted(read, key=lambda row: row["_id"]):
            spiel = by_id[row["spiel_id"]]
            if ansetzung_values_of(row["ansetzung"]) == current[spiel["_id"]]:
                continue
            if asked_with_its_move(row=row, spiel=spiel, austritte=austritte, now=germany_now):
                moved.setdefault((spiel["_id"], party_key(row["party"])), []).append(row)
            else:
                waiting.add(spiel["_id"])

        referees = await _referee_addresses(
            schiedsrichter_collection=schiedsrichter_collection,
            ids=[party["schiedsrichter_id"] for spiel in spiele for party in parties_of(spiel) if party["kind"] == "schiedsrichter"],
            session=session,
        )

        def plan_of(spiel: Mapping[str, Any]) -> _MintPlan:
            plan = _MintPlan()
            asked_before = any(spiel_id == spiel["_id"] for spiel_id, _ in moved)
            if spiel["_id"] in waiting or not request_is_due(spiel=spiel, austritte=austritte, now=germany_now, asked_before=asked_before):
                return plan

            for party in parties_of(spiel):
                existing = held.get((spiel["_id"], party_key(party), current[spiel["_id"]]))
                left = moved.get((spiel["_id"], party_key(party)), [])
                plan.closed += len(left)
                for row in left:
                    plan.updates.append(
                        (
                            {"_id": row["_id"], **build_holding_filter()},
                            # A discard's end keeps the mark of what it answered, as the close step's does.
                            compose_closing_update(reason="ansetzung_changed", discarded=was_discarded(row)),
                        )
                    )
                # The slot the move left, the newest asked about, where the party was asked about it and either day is
                # still to come.
                told = left[-1] if left and notice_owed(row=left[-1], reason="ansetzung_changed", spiel=spiel, now=germany_now) else None
                moved_from = (
                    None
                    if told is None
                    else spiel_mail_appointment_of(
                        spielbestaetigung_raw=told,
                        names=junction_names_of(
                            spielbestaetigung_raw=told, ansetzung_state=AnsetzungState(spiel=spiel, junctions=junction_rows)
                        ),
                    )
                )

                # The request or Einteilung is the one mail telling of a move: a row about the slot the fixture holds
                # never stands beside one about a slot it left, the plan inserting it closing every row it supersedes.
                if party["kind"] == "schiedsrichter":
                    if existing is None:
                        row = compose_spielbestaetigung(
                            row_id=ObjectId(), saison_id=saison_id, spiel=spiel, party=party, today=today, asked=True
                        )
                        plan.inserts.append(row)
                        plan.refereed.add(party["schiedsrichter_id"])
                        plan.asked += 1
                        plan.mails.append(
                            OwedMail(
                                key=f"spielbestaetigung/{row['_id']}/einteilung",
                                to=referees[party["schiedsrichter_id"]],
                                data=FLSpielEinteilungData(
                                    kind="spiel_einteilung", ansetzung=spiel_mail_ansetzung_of(view_ansetzung_of(spiel)), moved_from=moved_from
                                ),
                                reference=reference_of(spielbestaetigung_id=row["_id"], seat=None),
                            )
                        )
                    continue

                junction = junctions[party["team_id"]]
                kontakte = junction.get("kontakte")
                own_row: dict[str, Any]
                requests: list[OwedMail] = []
                if existing is None:
                    own_row = compose_spielbestaetigung(
                        row_id=ObjectId(), saison_id=saison_id, spiel=spiel, party=party, today=today, asked=False
                    )
                    requests = _request(row=own_row, spiel=spiel, kontakte=kontakte, kind="spiel_request", moved_from=moved_from)
                    # Stamped where a mail is owed now; a club holding no confirmed seat is asked once it holds one.
                    if requests:
                        own_row["asked_at"] = today
                    plan.inserts.append(own_row)
                else:
                    own_row = dict(existing)
                    # Open, in time and never asked: minted while the club held no confirmed seat. An answered or closed
                    # row, or one past its deadline, takes no press, so no request.
                    if (
                        own_row.get("answer") is None
                        and own_row.get("closed") is None
                        and own_row.get("asked_at") is None
                        and today <= own_row["deadline"]
                    ):
                        requests = _request(row=own_row, spiel=spiel, kontakte=kontakte, kind="spiel_request", moved_from=moved_from)
                        if requests:
                            plan.updates.append(({"_id": own_row["_id"], **build_unasked_filter()}, compose_asked_update(today=today)))

                if requests:
                    plan.seated.add(junction["_id"])
                    plan.asked += 1
                    plan.mails += requests

            return plan

        return plan_of

    async def mint_one(session: AsyncClientSession, fixture: Mapping[str, Any]) -> _Minted:
        """Write one fixture's rows whole, owing their mails: a club is never asked while its opponent waits."""

        spiele = await mint_window(
            {"_id": fixture["_id"], **build_request_filter(saison_id=saison_id, today=today, asked_ids=[fixture["_id"]])}, session
        )
        if not spiele:
            return _Minted(written=0, asked=0, closed=0, mails=0)

        # Whole: a cut read would mint a second row for a party that already answered.
        read = await pull_whole_from_db(
            collection=spielbestaetigungen_collection,
            db_filter=build_held_filter(saison_id=saison_id, spiel_ids=[fixture["_id"]]),
            session=session,
        )
        plan = (await planner(spiele, read, session))(spiele[0])
        if not plan.written:
            return _Minted(written=0, asked=0, closed=0, mails=0)

        # Ahead of the writes, so the fixture moved, or a seat emptied or re-addressed, since this attempt read is a
        # conflict before any work rather than a mail about the slot or to the mailbox it left.
        await anchor_the_spiele_acted_on(spiele_collection=spiele_collection, spiel_ids=[fixture["_id"]], session=session)
        if plan.seated:
            await anchor_the_mailboxes_told(
                saison_teams_collection=saison_teams_collection, saison_team_ids=sorted(plan.seated, key=str), session=session
            )
        if plan.refereed:
            await anchor_the_referees_told(
                schiedsrichter_collection=schiedsrichter_collection, schiedsrichter_ids=sorted(plan.refereed, key=str), session=session
            )

        if plan.inserts:
            await post_many_to_db(collection=spielbestaetigungen_collection, documents=plan.inserts, session=session)
        for db_filter, update in plan.updates:
            await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter=db_filter,
                update=update,
                session=session,
                expected_version=None,
                return_document=ReturnDocument.BEFORE,
            )
        await enqueue_mails(outbox_collection=outbox_collection, session=session, mails=plan.mails, now=germany_now)

        return _Minted(written=plan.written, asked=plan.asked, closed=plan.closed, mails=len(plan.mails))

    async def mint() -> Saved[_Minted]:
        """Every fixture in the window whose parties are owed a row, soonest first, one fixture at a time."""

        # The fixtures a row holds its party's question for, a discard's among them: a party asked already is asked about
        # a move at once, however far out it went.
        asked_ids = await spielbestaetigungen_collection.distinct("spiel_id", {"saison_id": saison_id, **build_holding_filter()})
        spiele = await mint_window(build_request_filter(saison_id=saison_id, today=today, asked_ids=asked_ids), None)
        # One read rather than one a fixture, cut at its limit: each fixture's own transaction reads its rows whole, so a
        # row this read leaves out costs that fixture a transaction that writes nothing.
        read = (
            await pull_many_from_db(
                collection=spielbestaetigungen_collection,
                db_filter=build_held_filter(saison_id=saison_id, spiel_ids=[spiel["_id"] for spiel in spiele]),
                limit=LIST_LIMIT_DEFAULT,
            )
            if spiele
            else []
        )
        plan_of = await planner(spiele, read, None)

        return await save_each(
            db=db, rows=_due_or_refused(spiele, lambda spiel: plan_of(spiel).written), save=mint_one, what=WHAT, clock="mint"
        )

    async def remind_reads(
        rows: list[Mapping[str, Any]], session: AsyncClientSession | None
    ) -> tuple[Callable[[Mapping[str, Any]], list[OwedMail]], dict[Any, Mapping[str, Any]]]:
        """Each row's reminder mails, off its fixture and its club's seats as they stand, and those season rows by club."""

        spiele = await _spiele(spiele_collection=spiele_collection, saison_id=saison_id, ids=[row["spiel_id"] for row in rows], session=session)
        # The rows' own clubs alone: a reminder asks `reason_to_close`, which judges no other.
        junctions = await _junctions(
            saison_teams_collection=saison_teams_collection, saison_id=saison_id, spiele=[], rows=rows, session=session
        )
        austritte = austritte_of(junctions.values())

        def reminder_of(row: Mapping[str, Any]) -> list[OwedMail]:
            spiel = spiele[row["spiel_id"]]
            # A row the close would shut answers no press, so a reminder of it would ask for nothing: one whose fixture
            # moved since the close read it, or whose close failed.
            if reason_to_close(row=row, spiel=spiel, austritte=austritte, now=germany_now) is not None:
                return []

            return _request(row=row, spiel=spiel, kontakte=junctions[row["party"]["team_id"]].get("kontakte"), kind="spiel_reminder")

        return reminder_of, junctions

    async def remind_one(session: AsyncClientSession, row: Mapping[str, Any]) -> int:
        """Owe one row's reminder and stamp it, answering its mails, counted."""

        stored = await spielbestaetigungen_collection.find_one(
            {"_id": row["_id"], **build_reminder_filter(saison_id=saison_id, today=today)}, session=session
        )
        if stored is None:
            return 0

        reminder_of, junctions = await remind_reads([stored], session)
        mails = reminder_of(stored)
        # A row whose club holds no confirmed seat today owes nothing and stays unmarked.
        if not mails:
            return 0

        # Ahead of the writes, as the mint anchors them: the fixture the reminder states, and the seats its mailboxes were
        # read off.
        await anchor_the_spiele_acted_on(spiele_collection=spiele_collection, spiel_ids=[stored["spiel_id"]], session=session)
        await anchor_the_mailboxes_told(
            saison_teams_collection=saison_teams_collection, saison_team_ids=[junctions[stored["party"]["team_id"]]["_id"]], session=session
        )
        await patch_one_in_db(
            collection=spielbestaetigungen_collection,
            db_filter={"_id": stored["_id"], **build_answerable_filter()},
            update=compose_reminder_update(today=today),
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )
        await enqueue_mails(outbox_collection=outbox_collection, session=session, mails=mails, now=germany_now)

        return len(mails)

    async def remind() -> Saved[int]:
        """Owe each of the day's reminders and stamp it, one row at a time."""

        rows = await pull_many_from_db(
            collection=spielbestaetigungen_collection,
            db_filter=build_reminder_filter(saison_id=saison_id, today=today),
            sort_by=[("deadline", ASCENDING), ("_id", ASCENDING)],
            limit=LIST_LIMIT_DEFAULT,
        )
        reminder_of, _ = await remind_reads(rows, None)

        return await save_each(db=db, rows=_due_or_refused(rows, reminder_of), save=remind_one, what=WHAT, clock="reminder")

    async def remind_one_fixture(session: AsyncClientSession, fixture: Mapping[str, Any]) -> int:
        """Owe each club of one fixture its one line-up reminder, answering the mails owed."""

        spiele = await pull_named_spiele(
            spiele_collection=spiele_collection,
            db_filter={"_id": fixture["_id"], **build_aufstellung_reminder_filter(saison_id=saison_id, today=today)},
            projection=JUDGED_SPIEL_FIELDS,
            session=session,
        )
        if not spiele or not aufstellung_reminder_owed(date=spiele[0].get("date"), time=spiele[0].get("time"), now=germany_now):
            return 0
        spiel = spiele[0]

        stored = {
            row["team_id"]
            for row in await pull_many_from_db(
                collection=aufstellungen_collection,
                db_filter={"spiel_id": spiel["_id"]},
                projection=["spiel_id", "team_id", "spieler"],
                limit=LIST_LIMIT_DEFAULT,
                session=session,
            )
            if aufstellung_stands(row)
        }
        junctions = await _junctions(
            saison_teams_collection=saison_teams_collection, saison_id=saison_id, spiele=[spiel], rows=[], session=session
        )
        austritte = austritte_of(junctions.values())

        # The fixture's clubs holding no line-up for it that stands (`aufstellung_stands`), the fixture still theirs to play
        # on its day.
        team_ids = [spiel[side]["team_id"] for side in ("team1", "team2")]
        if (
            decision_of(spiel=spiel, austritte=[austritte[team_id] for team_id in team_ids if team_id in austritte], tag=spiel["date"])
            is not None
        ):
            return 0
        # Every club a fixture fields holds its season row: no write removes one, and a replacement moves the fixtures.
        owed = [team_id for team_id in team_ids if team_id not in stored]

        reminded = {
            row["key"]
            for row in await pull_whole_from_db(
                collection=outbox_collection,
                db_filter={
                    "key": {
                        "$in": [
                            aufstellung_reminder_key(spiel_id=spiel["_id"], team_id=team_id, seat=seat)
                            for team_id in owed
                            for seat in KONTAKT_SEATS
                        ]
                    }
                },
                projection={"key": 1, "_id": 0},
                session=session,
            )
        }

        mails: list[OwedMail] = []
        told: set[Any] = set()
        for team_id in owed:
            # Any seat's key stored is the club reminded, whoever holds its seats now.
            if any(aufstellung_reminder_key(spiel_id=spiel["_id"], team_id=team_id, seat=seat) in reminded for seat in KONTAKT_SEATS):
                continue
            marks = aufstellung_marks(date=spiel["date"], time=spiel["time"], stored=False, now=germany_now)
            assert marks is not None
            junction = junctions[team_id]
            data = FLAufstellungReminderData(
                kind="aufstellung_reminder",
                team=junction["name"],
                team_id=team_id,
                saison_id=saison_id,
                # As the fixture's request states it, its ground among the rest.
                ansetzung=spiel_mail_ansetzung_of(view_ansetzung_of(spiel)),
                due_at=marks.due_at,
            )
            owed_here = [
                OwedMail(
                    key=aufstellung_reminder_key(spiel_id=spiel["_id"], team_id=team_id, seat=recipient.seat),
                    to=recipient.email,
                    data=data,
                    reference=FLOutboxReference(collection=Collection.SAISON_TEAMS, id=junction["_id"], seat=None),
                    # Given up at the due mark: sent later, it would ask for the line-up by a moment gone by.
                    valid_until=marks.due_at,
                    team=FLOutboxTeam(saison_id=saison_id, team_id=team_id),
                )
                for recipient in confirmed_recipients(kontakte=junction.get("kontakte"))
            ]
            if owed_here:
                told.add(junction["_id"])
                mails += owed_here

        if mails:
            # Ahead of the writes, as the mint anchors them: the fixture the reminders state and time, and the seats their
            # mailboxes were read off.
            await anchor_the_spiele_acted_on(spiele_collection=spiele_collection, spiel_ids=[spiel["_id"]], session=session)
            await anchor_the_mailboxes_told(
                saison_teams_collection=saison_teams_collection, saison_team_ids=sorted(told, key=str), session=session
            )
        await enqueue_mails(outbox_collection=outbox_collection, session=session, mails=mails, now=germany_now)

        return len(mails)

    async def remind_aufstellungen() -> Saved[int]:
        """Every fixture inside the line-up reminder's window, one at a time."""

        spiele = await pull_named_spiele(
            spiele_collection=spiele_collection,
            db_filter=build_aufstellung_reminder_filter(saison_id=saison_id, today=today),
            projection=JUDGED_SPIEL_FIELDS,
            sort_by=[("date", ASCENDING), ("time", ASCENDING), ("_id", ASCENDING)],
            limit=LIST_LIMIT_DEFAULT,
        )
        due = [spiel for spiel in spiele if aufstellung_reminder_owed(date=spiel.get("date"), time=spiel.get("time"), now=germany_now)]

        return await save_each(db=db, rows=due, save=remind_one_fixture, what=WHAT, clock="aufstellung")

    closes = await step(close)
    mints = await step(mint)
    reminders = await step(remind)
    lineups = await step(remind_aufstellungen)

    return FLSpielbestaetigungSweepResponse(
        closed=sum(answered.closed for answered in closes.answers) + sum(answered.closed for answered in mints.answers),
        asked=sum(answered.asked for answered in mints.answers),
        reminded=sum(1 for owing in reminders.answers if owing),
        mails=sum(answered.mails for answered in closes.answers)
        + sum(answered.mails for answered in mints.answers)
        + sum(reminders.answers)
        + sum(lineups.answers),
        failed=closes.failed + mints.failed + reminders.failed + lineups.failed,
    )
