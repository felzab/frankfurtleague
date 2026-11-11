from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Final, Literal

from bson import ObjectId
from fastapi import APIRouter, Depends
from pymongo import ASCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aufstellungen.services import aufstellung_marks, aufstellung_reminder_owed, aufstellung_stands
from app.api.bewerbungen.services import SWEEP_PAGE
from app.api.invitations.services import confirmed_recipients
from app.api.outbox.schemas import (
    FLAufstellungReminderData,
    FLOutboxClub,
    FLOutboxData,
    FLOutboxReference,
    FLSpielEinteilungData,
    FLSpielMailAppointment,
    FLSpielRequestData,
)
from app.api.outbox.services import OwedMail, enqueue_mails
from app.api.spielbestaetigungen.crud import (
    JUDGED_SPIEL_FIELDS,
    anchor_the_mailboxes_told,
    anchor_the_referees_told,
    pull_named_spiele,
)
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungClosedReason,
    FLSpielbestaetigungSweepResponse,
)
from app.api.spielbestaetigungen.services import (
    CLOSE_FIELDS,
    AnsetzungState,
    ansetzung_digest_of,
    asked_with_its_move,
    aufstellung_reminder_key,
    build_answerable_filter,
    build_aufstellung_reminder_filter,
    build_closable_filter,
    build_held_filter,
    build_holding_filter,
    build_reminder_filter,
    build_request_filter,
    build_unasked_filter,
    compose_asked_update,
    compose_closing_update,
    compose_reminder_update,
    compose_spielbestaetigung,
    decision_of,
    moved_notice_of,
    notice_data_of,
    notice_owed,
    parties_of,
    party_key,
    reason_to_close,
    reason_to_end,
    reference_of,
    request_is_due,
    side_of,
    spiel_mail_ansetzung_of,
    spiel_mail_appointment_of,
    spiel_mail_slot_of,
    still_a_party,
    team_mails,
    vereinsnamen_of,
    view_ansetzung_of,
)
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, post_many_to_db, pull_many_from_db, pull_one_from_db, pull_whole_from_db
from app.core.dependencies import (
    AufstellungenReadCollection,
    DBClient,
    OutboxCollection,
    SaisonsCollection,
    SaisonsReadCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.security import verify_access_system
from app.core.transactions import Batch, refuse_a_stalled_page, run_isolated
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.literals import KONTAKT_ROLLEN
from app.shared.schemas.responses import FLSweepSaisonsResponse

# System tier, for `app/api/bewerbungen/system_router.py`'s reason: the timer holds no session.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielbestaetigungen/sweep",
    dependencies=[Depends(verify_access_system)],
)

# Each close costs one command; the three shares below fit `app/core/middlewares.py :: REQUEST_DEADLINE_S`
# together, each step's mails owed in two commands of its own.
CLOSES_PER_PASS: Final = 19

# Counted in rows written, a fixture taken whole.
MINTS_PER_PASS: Final = 26

REMINDERS_PER_PASS: Final = 24

WHAT: Final = "Confirmation"


def _by(rows: Iterable[Mapping[str, Any]], key: str) -> dict[Any, Mapping[str, Any]]:
    return {row[key]: row for row in rows}


async def _spiele(
    *, spiele_collection: AsyncCollection, saison_id: str, ids: Iterable[Any], session: AsyncClientSession
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
    *, saison_teams_collection: AsyncCollection, saison_id: str, team_ids: Iterable[Any], session: AsyncClientSession
) -> dict[Any, Mapping[str, Any]]:
    """The clubs' season rows: their seats as they stand now, their exit, and the name they play under."""

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


def _austritte(junctions: Mapping[Any, Mapping[str, Any]]) -> dict[Any, str]:
    return {
        team_id: str(junction["austritt"]["date"]) for team_id, junction in junctions.items() if isinstance(junction.get("austritt"), Mapping)
    }


async def _referee_addresses(*, schiedsrichter_collection: AsyncCollection, ids: Iterable[Any], session: AsyncClientSession) -> dict[Any, str]:
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
    # The clubs a mail was owed to, off their season rows' seats as the mint read them.
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


@router.get("", response_model=FLSweepSaisonsResponse, summary="Every season the confirmation pass visits")
async def get_sweep_saisons(saisons_collection: SaisonsReadCollection) -> FLSweepSaisonsResponse:
    """
    Answer every `active` season's id, oldest first.

    `active` alone: a confirmation serves no purpose once its season is over, and a season that ended with a fixture nobody
    entered a result for would otherwise be asked about a day long gone. System tier because this is the timer's own
    bookkeeping, asked by the process running the pass and by no page. Reading it writes nothing.
    """

    seasons = await pull_many_from_db(
        collection=saisons_collection,
        db_filter={"status": "active"},
        projection=["_id"],
        sort_by=[("_id", ASCENDING)],
        limit=LIST_LIMIT_DEFAULT,
    )

    return FLSweepSaisonsResponse(saison_ids=[str(season["_id"]) for season in seasons])


@router.post(
    "/{saison_id}",
    response_model=FLSpielbestaetigungSweepResponse,
    summary="Run one season's fixture confirmation pass",
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
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> FLSpielbestaetigungSweepResponse:
    """
    Close, mint and remind one season's fixture confirmations, as of today in Europe/Berlin, and answer what it did, counted.

    Each mail is owed through the Postausgang in the transaction that writes its row.

    The close shuts every row not yet closed, answered or not, whose fixture moved, was decided, was called off, lost a club
    to an `austritt` dated on or before its day, or -- a referee's row -- names another referee or none; failing all of
    those, a row whose fixture has kicked off, or reached its day where it holds no time, closes `spiel_past`, so
    nobody answers about a match already started. A club's decline closed `discarded` is closed again for each of
    those but a move and a referee change, in the pass that closes an agreement beside it, and once the slot it was
    about has kicked off: the public fixture then stops counting it as that club's agreement.

    A closing owes its party a notice in its own transaction where the party's first request or Einteilung was owed,
    about a slot not yet kicked off: for a move, „Spiel verlegt“, naming the slot it left and the one the fixture holds now
    where the party is still one of its sides or its referee and that slot has a day, an hour and both sides; for a
    referee taken off the fixture -- ahead of a move it shares a close with, and never for the referee's own decline, which closed its row
    as it was given -- and for a call-off, the slot the row was about; for an `austritt`, the slot too, to a referee alone,
    each opponent having been told at the exit's own write (`app/api/spielbestaetigungen/crud.py ::
    owe_the_austritt_notices_in_session`). A club is told at every address of its confirmed seats as they stand now, a
    referee at the address their record holds; a party nobody is left to tell is told nothing.

    The mint asks about every fixture dated strictly after today and at most the answer window ahead that has its time and
    ground, both sides, no result and no `sonderereignis`, and that the close would not shut: one row per side and one for
    its booked referee, unless a row about that party and that Ansetzung is still unclosed, or was closed `discarded`: a
    decline the administrator discarded is the party's one answer to that Ansetzung. The deadline falls the notice period
    (`app/shared/schemas/bounds.py :: SPIEL_CONFIRMATION_DEADLINE_DAYS`) before the fixture, or today where that has passed.
    A club's row is owed its request at every address of the club's confirmed seats, one mail per mailbox carrying no
    link, since the club answers on its own pages signed in, and the row is stamped as asked; a club holding no confirmed
    seat is asked once it holds one, while its row is open and in time. A referee row is owed its Einteilung. A
    party still asked by a fixture that moved to a slot the mint asks today is the mint's, never the close's: in the
    transaction asking about the new slot, the mint closes the party's row about the slot left `ansetzung_changed`, and
    the request or Einteilung it owes names the slot left, the one mail telling of the move; a party it owes no request,
    its answer about the new slot standing or no confirmed seat of its reachable, is owed the move's notice instead. A fixture
    holding any other unclosed row about an Ansetzung it has left is asked once the close has shut it, the close owing
    its notice first.

    The one reminder goes to every address of the club's confirmed seats as they stand now, on each open team row never
    reminded whose deadline lies the reminder's days away (`app/shared/schemas/bounds.py :: SPIEL_REMINDER_DAYS`) and
    whose request was owed on an earlier day, and stamps the day; a row whose club holds no confirmed seat that day is
    reminded of nothing.

    The line-up reminder goes to every address of a club's confirmed seats as they stand now, for each fixture whose
    kick-off lies between `app/shared/schemas/bounds.py :: AUFSTELLUNG_REMINDER_DAYS` and `:: AUFSTELLUNG_DUE_DAYS`
    ahead, each counted back at the kick-off's clock time, and for which the club stores no line-up, neither the
    fixture decided or called off nor the club out by its
    day; once per club and fixture, the mail's own keys being its one record (`app/api/spielbestaetigungen/services.py
    :: aufstellung_reminder_key`), so a fixture first read past the window's start, or moved, is reminded only if no
    reminder of it went. Each states the moment the line-up is due and is given up at it.

    Each step takes a bounded share and leaves the rest due. A row whose write fails is passed over alone, logged by id
    and counted in `failed`; any other failure is raised, every step committed before it standing with its mails.

    A season that is not `active` is passed by whole -- nothing closed, minted or reminded -- so a mistyped call, or one for
    a season ended since the listing, mails nobody. 404 where no season has the id.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"])
    # Every step's gate as well as the listing's, answered rather than refused: a mistyped call, or a season ended
    # between the listing and this call, mails nobody and writes nothing.
    if saison_raw.get("status") != "active":
        return FLSpielbestaetigungSweepResponse(saison_id=saison_id, closed=0, asked=0, reminded=0, mails=0, failed=0)

    async def close(session: AsyncClientSession, batch: Batch) -> _Closed:
        """Judge every row holding its question against its fixture as it stands, then close a share, owing each notice.

        Read in-session, so a retry re-judges.
        """

        rows = await batch.saw(
            pull_many_from_db(
                collection=spielbestaetigungen_collection,
                db_filter=batch.within({"saison_id": saison_id, **build_holding_filter()}),
                # Oldest Ansetzung first, the likeliest to have been decided; `_id` keeps the page one page.
                sort_by=[("ansetzung.date", ASCENDING), ("_id", ASCENDING)],
                # The season's every row holding its question: what the close judges, and not each seat's hashes.
                projection=CLOSE_FIELDS,
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        spiele = await _spiele(spiele_collection=spiele_collection, saison_id=saison_id, ids=[row["spiel_id"] for row in rows], session=session)
        junctions = await _junctions(
            saison_teams_collection=saison_teams_collection,
            saison_id=saison_id,
            team_ids=[row["ansetzung"][side] for row in rows for side in ("team1_id", "team2_id")],
            session=session,
        )
        austritte = _austritte(junctions)

        def spiel_of(row: Mapping[str, Any]) -> Mapping[str, Any]:
            return spiele[row["spiel_id"]]

        def reason_of(row: Mapping[str, Any]) -> FLSpielbestaetigungClosedReason | None:
            return reason_to_end(row=row, spiel=spiel_of(row), austritte=austritte, now=now)

        reasons: dict[Any, FLSpielbestaetigungClosedReason] = {
            row["_id"]: reason
            for row, reason in batch.judged(rows, reason_of)
            # A move whose new slot the mint asks today is the mint's to close, its request the one mail telling of it.
            if reason is not None
            and not (reason == "ansetzung_changed" and asked_with_its_move(row=row, spiel=spiel_of(row), austritte=austritte, now=now))
        }
        taken = batch.took([row for row in rows if row["_id"] in reasons][: batch.share])
        refuse_a_stalled_page(read=len(rows), moved=len(taken) + len(batch.refused), page=SWEEP_PAGE, clock="close", saison_id=saison_id)

        owing = [row for row in taken if notice_owed(row=row, reason=reasons[row["_id"]], spiel=spiele[row["spiel_id"]], now=now)]
        addresses = await _referee_addresses(
            schiedsrichter_collection=schiedsrichter_collection,
            ids=[row["party"]["schiedsrichter_id"] for row in owing if row["party"]["kind"] == "schiedsrichter"],
            session=session,
        )

        mails: list[OwedMail] = []
        told_clubs: set[Any] = set()
        told_referees: set[Any] = set()
        for row in owing:
            reason, party = reasons[row["_id"]], row["party"]
            # Named as the requests are, off the fixture as it stands: a club replaced since holds no season row to name it by.
            names = vereinsnamen_of(
                spielbestaetigung_raw=row, ansetzung_state=AnsetzungState(spiel=spiele[row["spiel_id"]], vereine=list(junctions.values()))
            )
            appointment = spiel_mail_appointment_of(spielbestaetigung_raw=row, names=names)
            data: FLOutboxData
            if reason == "ansetzung_changed":
                # Its new slot not asked today: told at once, the request following once it can be asked.
                stays = still_a_party(row=row, spiel=spiel_of(row))
                data = moved_notice_of(
                    party_kind=party["kind"],
                    appointment=appointment,
                    moved_to=spiel_mail_slot_of(spiel_of(row)) if stays else None,
                    asked_again=stays,
                )
            else:
                data = notice_data_of(reason=reason, party_kind=party["kind"], appointment=appointment)
            if party["kind"] == "schiedsrichter":
                told_referees.add(party["schiedsrichter_id"])
                mails.append(
                    OwedMail(
                        key=f"spielbestaetigung/{row['_id']}/{reason}",
                        to=addresses[party["schiedsrichter_id"]],
                        data=data,
                        reference=reference_of(spielbestaetigung_id=row["_id"], seat=None),
                    )
                )
                continue

            # Read off the season row's seats as they stand now, a mailbox per message with no name in it. A replaced
            # club's people left with its row, so nobody is told.
            junction = junctions.get(party["team_id"])
            if junction is None:
                continue
            told = team_mails(spielbestaetigung_raw=row, kontakte=junction.get("kontakte"), data=data, occasion=reason)
            if told:
                told_clubs.add(junction["_id"])
                mails += told

        # Ahead of the writes: what each mail's mailbox was read off, so a seat emptied or an address moved beside this
        # step conflicts with it rather than leaving the replaced mailbox told.
        if told_clubs:
            await anchor_the_mailboxes_told(
                saison_teams_collection=saison_teams_collection, saison_team_ids=sorted(told_clubs, key=str), session=session
            )
        if told_referees:
            await anchor_the_referees_told(
                schiedsrichter_collection=schiedsrichter_collection, schiedsrichter_ids=sorted(told_referees, key=str), session=session
            )

        for row in taken:
            await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": row["_id"], **build_holding_filter()},
                update=compose_closing_update(reason=reasons[row["_id"]]),
                session=session,
                expected_version=None,
                return_document=ReturnDocument.BEFORE,
            )
        await enqueue_mails(outbox_collection=outbox_collection, session=session, mails=mails, now=now)

        return _Closed(closed=len(taken), mails=len(mails))

    async def mint(session: AsyncClientSession, batch: Batch) -> _Minted:
        """Plan the window's fixtures, then write a share of rows, whole fixtures, soonest first, owing their mails.

        Read in-session, so a retry re-judges.
        """

        spiele = await batch.saw(
            pull_named_spiele(
                spiele_collection=spiele_collection,
                db_filter=batch.within(build_request_filter(saison_id=saison_id, today=today)),
                projection=JUDGED_SPIEL_FIELDS,
                # Soonest first, so the fixture whose deadline comes first is asked first.
                sort_by=[("date", ASCENDING), ("time", ASCENDING), ("_id", ASCENDING)],
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        if not spiele:
            return _Minted(written=0, asked=0, closed=0, mails=0)

        # Whole: a cut read would mint a second row for a party that already answered. Its refusal halves the page
        # (`app/core/transactions.py :: isolate`) until each half's rows fit one read.
        read = await pull_whole_from_db(
            collection=spielbestaetigungen_collection,
            db_filter=build_held_filter(saison_id=saison_id, spiel_ids=[spiel["_id"] for spiel in spiele]),
            what=f"season {saison_id}'s window's held confirmations",
            session=session,
        )
        held = {(row["spiel_id"], party_key(row["party"]), row["ansetzung"]["digest"]): row for row in read}
        digests = {spiel["_id"]: ansetzung_digest_of(spiel) for spiel in spiele}
        by_id = {spiel["_id"]: spiel for spiel in spiele}

        junctions = await _junctions(
            saison_teams_collection=saison_teams_collection,
            saison_id=saison_id,
            team_ids=[spiel[side]["team_id"] for spiel in spiele for side in ("team1", "team2")],
            session=session,
        )
        austritte = _austritte(junctions)
        vereine = list(junctions.values())

        # Each unclosed row about an Ansetzung its fixture left: the mint's to close where its party is asked about the new
        # one now, oldest first, so the newest is the slot its request names as left. Any other waits for the close step,
        # which shuts it and tells of it first.
        moved: dict[tuple[Any, tuple[str, Any]], list[Mapping[str, Any]]] = {}
        waiting: set[Any] = set()
        for row in sorted(read, key=lambda row: row["_id"]):
            spiel = by_id[row["spiel_id"]]
            if row.get("closed") is not None or row["ansetzung"]["digest"] == digests[spiel["_id"]]:
                continue
            if asked_with_its_move(row=row, spiel=spiel, austritte=austritte, now=now):
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
            if spiel["_id"] in waiting or not request_is_due(spiel=spiel, austritte=austritte, now=now):
                return plan

            digest = digests[spiel["_id"]]
            for party in parties_of(spiel):
                existing = held.get((spiel["_id"], party_key(party), digest))
                left = moved.get((spiel["_id"], party_key(party)), [])
                plan.closed += len(left)
                for row in left:
                    plan.updates.append(({"_id": row["_id"], **build_closable_filter()}, compose_closing_update(reason="ansetzung_changed")))
                # The slot the move left, where the party was asked about it and either day is still to come.
                told = left[-1] if left and notice_owed(row=left[-1], reason="ansetzung_changed", spiel=spiel, now=now) else None
                moved_from = (
                    None
                    if told is None
                    else spiel_mail_appointment_of(
                        spielbestaetigung_raw=told,
                        names=vereinsnamen_of(spielbestaetigung_raw=told, ansetzung_state=AnsetzungState(spiel=spiel, vereine=vereine)),
                    )
                )

                moved_to = spiel_mail_slot_of(spiel)

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
                                    kind="spiel_einteilung",
                                    ansetzung=spiel_mail_ansetzung_of(view_ansetzung_of(spiel)),
                                    moved_from=moved_from,
                                ),
                                reference=reference_of(spielbestaetigung_id=row["_id"], seat=None),
                            )
                        )
                    # A referee's row about the slot the fixture holds never stands beside an open one about a slot it
                    # left, so no move is told here: this transaction closes every row its insert supersedes, and the one
                    # close a held row outlives, `discarded`, is a club's alone.
                    continue

                kontakte = junctions[party["team_id"]].get("kontakte")
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
                    plan.seated.add(party["team_id"])
                    plan.asked += 1
                    plan.mails += requests
                # No request goes now, so the move is told on its own, keyed as the close step keys it: a question about
                # the new slot still open is asked once a seat can be.
                elif told is not None and moved_from is not None:
                    notices = team_mails(
                        spielbestaetigung_raw=told,
                        kontakte=kontakte,
                        data=moved_notice_of(
                            party_kind=party["kind"],
                            appointment=moved_from,
                            moved_to=moved_to,
                            asked_again=own_row.get("answer") is None and own_row.get("closed") is None,
                        ),
                        occasion="ansetzung_changed",
                    )
                    if notices:
                        plan.seated.add(party["team_id"])
                        plan.mails += notices

            return plan

        planned = batch.judged(spiele, plan_of)
        # Plans built before any write and the share cut from them, a fixture whole: a refused one writes
        # nothing, and the fixtures past the share stay due.
        room = MINTS_PER_PASS if batch.share is None else batch.share
        taken: list[tuple[Mapping[str, Any], _MintPlan]] = []
        for spiel, plan in planned:
            if not plan.written:
                continue
            if plan.written > room:
                break
            taken.append((spiel, plan))
            room -= plan.written
        batch.took([spiel for spiel, _ in taken])
        refuse_a_stalled_page(read=len(spiele), moved=len(taken) + len(batch.refused), page=SWEEP_PAGE, clock="mint", saison_id=saison_id)

        # Ahead of the writes, so a seat emptied or re-addressed since this attempt read is a conflict before any work
        # rather than a mail to the mailbox it left.
        seated = sorted({junctions[team_id]["_id"] for _, plan in taken for team_id in plan.seated}, key=str)
        if seated:
            await anchor_the_mailboxes_told(saison_teams_collection=saison_teams_collection, saison_team_ids=seated, session=session)
        refereed = sorted({referee for _, plan in taken for referee in plan.refereed}, key=str)
        if refereed:
            await anchor_the_referees_told(schiedsrichter_collection=schiedsrichter_collection, schiedsrichter_ids=refereed, session=session)

        inserts = [document for _, plan in taken for document in plan.inserts]
        if inserts:
            await post_many_to_db(collection=spielbestaetigungen_collection, documents=inserts, session=session)
        for _, plan in taken:
            for db_filter, update in plan.updates:
                await patch_one_in_db(
                    collection=spielbestaetigungen_collection,
                    db_filter=db_filter,
                    update=update,
                    session=session,
                    expected_version=None,
                    return_document=ReturnDocument.BEFORE,
                )
        mails = [mail for _, plan in taken for mail in plan.mails]
        await enqueue_mails(outbox_collection=outbox_collection, session=session, mails=mails, now=now)

        return _Minted(
            written=sum(plan.written for _, plan in taken),
            asked=sum(plan.asked for _, plan in taken),
            closed=sum(plan.closed for _, plan in taken),
            mails=len(mails),
        )

    async def remind(session: AsyncClientSession, batch: Batch) -> list[int]:
        """Owe a share of the day's reminders and stamp them, answering each row's mails, counted.

        The pass's last transaction. Read in-session, so a retry re-judges.
        """

        rows = await batch.saw(
            pull_many_from_db(
                collection=spielbestaetigungen_collection,
                db_filter=batch.within(build_reminder_filter(saison_id=saison_id, today=today)),
                sort_by=[("deadline", ASCENDING), ("_id", ASCENDING)],
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        spiele = await _spiele(spiele_collection=spiele_collection, saison_id=saison_id, ids=[row["spiel_id"] for row in rows], session=session)
        junctions = await _junctions(
            saison_teams_collection=saison_teams_collection,
            saison_id=saison_id,
            team_ids=[row["ansetzung"][side] for row in rows for side in ("team1_id", "team2_id")],
            session=session,
        )
        austritte = _austritte(junctions)

        def reminder_of(row: Mapping[str, Any]) -> list[OwedMail]:
            spiel = spiele[row["spiel_id"]]
            # A row the close would shut answers no press, so a reminder of it would ask for nothing.
            if reason_to_close(row=row, spiel=spiel, austritte=austritte, now=now) is not None:
                return []

            return _request(row=row, spiel=spiel, kontakte=junctions[row["party"]["team_id"]].get("kontakte"), kind="spiel_reminder")

        # A row whose club holds no confirmed seat today owes nothing and stays unmarked.
        taken = [(row, mails) for row, mails in batch.judged(rows, reminder_of) if mails][: batch.share]
        batch.took([row for row, _ in taken])
        refuse_a_stalled_page(read=len(rows), moved=len(taken) + len(batch.refused), page=SWEEP_PAGE, clock="reminder", saison_id=saison_id)

        if taken:
            # Ahead of the writes, as the mint anchors them: the seats the reminders' mailboxes were read off.
            await anchor_the_mailboxes_told(
                saison_teams_collection=saison_teams_collection,
                saison_team_ids=sorted({junctions[row["party"]["team_id"]]["_id"] for row, _ in taken}, key=str),
                session=session,
            )
        for row, _ in taken:
            await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": row["_id"], **build_answerable_filter()},
                update=compose_reminder_update(today=today),
                session=session,
                expected_version=None,
                return_document=ReturnDocument.BEFORE,
            )
        await enqueue_mails(outbox_collection=outbox_collection, session=session, mails=[mail for _, mails in taken for mail in mails], now=now)

        return [len(mails) for _, mails in taken]

    async def remind_aufstellungen(session: AsyncClientSession, batch: Batch) -> int:
        """Owe each club its one line-up reminder for a fixture inside the window, answering the mails owed.

        Read in-session, so a retry re-judges.
        """

        spiele = await batch.saw(
            pull_named_spiele(
                spiele_collection=spiele_collection,
                db_filter=batch.within(build_aufstellung_reminder_filter(saison_id=saison_id, today=today)),
                projection=JUDGED_SPIEL_FIELDS,
                sort_by=[("date", ASCENDING), ("time", ASCENDING), ("_id", ASCENDING)],
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        due = [spiel for spiel in spiele if aufstellung_reminder_owed(date=spiel.get("date"), time=spiel.get("time"), now=now)]
        if not due:
            return 0

        by_id = {spiel["_id"]: spiel for spiel in due}
        stored = {
            (row["spiel_id"], row["team_id"])
            for row in await pull_many_from_db(
                collection=aufstellungen_collection,
                db_filter={"spiel_id": {"$in": list(by_id)}},
                projection=["spiel_id", "team_id", "spieler"],
                limit=LIST_LIMIT_DEFAULT,
                session=session,
            )
            if aufstellung_stands(row)
        }
        junctions = await _junctions(
            saison_teams_collection=saison_teams_collection,
            saison_id=saison_id,
            team_ids=[spiel[side]["team_id"] for spiel in due for side in ("team1", "team2")],
            session=session,
        )
        austritte = _austritte(junctions)

        def clubs_owed(spiel: Mapping[str, Any]) -> list[Any]:
            """The fixture's clubs holding no line-up for it that stands (`aufstellung_stands`), the fixture still theirs to play on its day."""

            clubs = [spiel[side]["team_id"] for side in ("team1", "team2")]
            if decision_of(spiel=spiel, austritte=[austritte[club] for club in clubs if club in austritte], tag=spiel["date"]) is not None:
                return []

            # Every club a fixture fields holds its season row: no write removes one, and a replacement moves the fixtures.
            return [club for club in clubs if (spiel["_id"], club) not in stored]

        owed = [(spiel, club) for spiel, clubs in batch.judged(due, clubs_owed) for club in clubs]
        reminded = {
            row["key"]
            for row in await outbox_collection.find(
                {
                    "key": {
                        "$in": [
                            aufstellung_reminder_key(spiel_id=spiel["_id"], team_id=club, seat=seat)
                            for spiel, club in owed
                            for seat in KONTAKT_ROLLEN
                        ]
                    }
                },
                {"key": 1, "_id": 0},
                session=session,
            ).to_list(length=None)
        }

        mails: list[OwedMail] = []
        told: dict[Any, set[Any]] = {}
        for spiel, club in owed:
            # Any seat's key stored is the club reminded, whoever holds its seats now.
            if any(aufstellung_reminder_key(spiel_id=spiel["_id"], team_id=club, seat=seat) in reminded for seat in KONTAKT_ROLLEN):
                continue
            marks = aufstellung_marks(date=spiel["date"], time=spiel["time"], stored=False, now=now)
            assert marks is not None
            junction = junctions[club]
            data = FLAufstellungReminderData(
                kind="aufstellung_reminder",
                team=junction["name"],
                team_id=club,
                saison_id=saison_id,
                # As the fixture's request states it, its ground among the rest.
                appointment=spiel_mail_ansetzung_of(view_ansetzung_of(spiel)),
                due_at=marks.due_at,
            )
            owed_here = [
                OwedMail(
                    key=aufstellung_reminder_key(spiel_id=spiel["_id"], team_id=club, seat=recipient.rolle),
                    to=recipient.email,
                    data=data,
                    reference=FLOutboxReference(collection=Collection.SAISON_TEAMS, id=junction["_id"], seat=None),
                    # Given up at the due mark: sent later, it would ask for the line-up by a moment gone by.
                    valid_until=marks.due_at,
                    club=FLOutboxClub(saison_id=saison_id, team_id=club),
                )
                for recipient in confirmed_recipients(kontakte=junction.get("kontakte"))
            ]
            if owed_here:
                told.setdefault(spiel["_id"], set()).add(junction["_id"])
                mails += owed_here

        batch.took([spiel for spiel in due if spiel["_id"] in told])
        refuse_a_stalled_page(read=len(spiele), moved=len(told) + len(batch.refused), page=SWEEP_PAGE, clock="aufstellung", saison_id=saison_id)

        if mails:
            # Ahead of the writes, as the mint anchors them: the seats the reminders' mailboxes were read off.
            await anchor_the_mailboxes_told(
                saison_teams_collection=saison_teams_collection,
                saison_team_ids=sorted({row_id for row_ids in told.values() for row_id in row_ids}, key=str),
                session=session,
            )
        await enqueue_mails(outbox_collection=outbox_collection, session=session, mails=mails, now=now)

        return len(mails)

    failed = 0

    closed, passed = await run_isolated(
        db=db,
        batch=Batch(share=CLOSES_PER_PASS),
        attempt=close,
        moved=lambda answered: answered.closed,
        owes=False,
        what=WHAT,
        clock="close",
    )
    failed += len(passed)

    minted, passed = await run_isolated(
        db=db, batch=Batch(share=MINTS_PER_PASS), attempt=mint, moved=lambda answered: answered.written, owes=False, what=WHAT, clock="mint"
    )
    failed += len(passed)

    reminded, passed = await run_isolated(
        db=db, batch=Batch(share=REMINDERS_PER_PASS), attempt=remind, moved=len, owes=False, what=WHAT, clock="reminder"
    )
    failed += len(passed)
    owing = [count for answered in reminded for count in answered]

    # The page whole rather than a share: the step writes no row of its own, its mails owed in one insert however many.
    lineups, passed = await run_isolated(
        db=db, batch=Batch(), attempt=remind_aufstellungen, moved=lambda count: count, owes=False, what=WHAT, clock="aufstellung"
    )
    failed += len(passed)

    return FLSpielbestaetigungSweepResponse(
        saison_id=saison_id,
        closed=sum(answered.closed for answered in closed) + sum(answered.closed for answered in minted),
        asked=sum(answered.asked for answered in minted),
        reminded=len(owing),
        mails=sum(answered.mails for answered in closed) + sum(answered.mails for answered in minted) + sum(owing) + sum(lineups),
        failed=failed,
    )
