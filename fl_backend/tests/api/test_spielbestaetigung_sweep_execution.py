import dataclasses
from collections import Counter
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, date, datetime
from typing import Any, Literal, cast
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import days_after
from app.api.spielbestaetigungen.person_router import post_schiedsrichter_answer, post_team_answer
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungAppointment,
    FLSpielbestaetigungSchiedsrichterAnswerPayload,
    FLSpielbestaetigungSweepResponse,
    FLSpielbestaetigungTeamAnswerPayload,
)
from app.api.spielbestaetigungen.services import (
    ansetzung_digest_of,
    build_holding_filter,
    compose_answer_update,
    compose_closing_update,
    compose_spielbestaetigung,
    parties_of,
    side_of,
)
from app.api.spielbestaetigungen.system_router import (
    CLOSES_PER_PASS,
    MINTS_PER_PASS,
    get_sweep_saisons,
    sweep_spielbestaetigungen,
)
from app.api.spiele.admin_router import patch_spiel
from app.api.spiele.schemas import FLPatchSpielDataPayload, FLPatchSpielDataResponse
from app.api.spiele.services import ANSETZUNG_CONFIRMED, build_spiele_pipeline
from app.api.teams.admin_router import replace_saison_team
from app.api.teams.schemas import FLReplaceSaisonTeamPayload
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from app.core.transactions import SWEEP_PAGE
from app.shared.schemas.bounds import SPIEL_CONFIRMATION_DEADLINE_DAYS
from app.shared.schemas.literals import KONTAKT_ROLLEN
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import kontaktperson_document
from tests.erasure import erased
from tests.isolation import COMMITTED, InterleavedCollection, Rival, outcome_of
from tests.outbox import MAIL_NOW, drained
from tests.payloads import spiel_patch_body
from tests.records import record_collections
from tests.team_writes import write_the_block
from tests.wire import commands_by_name
from tests.worker import worker_database

# Module level, as the other execution suites mark theirs: every test below reaches a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spielbestaetigung_sweep_test")

SAISON_ID = "2026"
PAST_SAISON_ID = "2025"
# A century ahead of the real clock, every seeded day with it: the TTL monitor deletes a row whose delete date has passed,
# under a case reading it back.
TODAY = "2126-04-01"
NOW = datetime(2126, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))


def clock_of(day: str) -> datetime:
    """A pass's instant on `day`, at `NOW`'s hour: the close judges every kick-off by it, and its mails are owed and drained at it."""

    return datetime.combine(date.fromisoformat(day), NOW.timetz())


YESTERDAY = "2126-03-31"
NEXT_WEEK = "2126-04-08"

# Fixed rather than generated, so a failure names the same row every run.
ALPHA = ObjectId("6890a1b2c3d4e5f607750001")
BETA = ObjectId("6890a1b2c3d4e5f607750002")
# A club no season row names, so a fixture fielding it is one the pass cannot answer.
GAMMA = ObjectId("6890a1b2c3d4e5f607750003")
NAMES = {ALPHA: ("Alpha", "ALX"), BETA: ("Beta", "BEX"), GAMMA: ("Gamma", "GAX")}
SPIELTAG = ObjectId("6890a1b2c3d4e5f6077500a1")
PAST_SPIELTAG = ObjectId("6890a1b2c3d4e5f6077500a2")
SPIELORT = ObjectId("6890a1b2c3d4e5f6077500b1")
SCHIEDSRICHTER = ObjectId("6890a1b2c3d4e5f6077500c1")
OTHER_SCHIEDSRICHTER = ObjectId("6890a1b2c3d4e5f6077500c2")
SPIEL = ObjectId("6890a1b2c3d4e5f6077500d1")
OTHER_SPIEL = ObjectId("6890a1b2c3d4e5f6077500d2")
PAST_SPIEL = ObjectId("6890a1b2c3d4e5f6077500d3")
TODAYS_SPIEL = ObjectId("6890a1b2c3d4e5f6077500d4")
FRESH_SPIEL = ObjectId("6890a1b2c3d4e5f6077500d5")
CALLED_OFF_SPIEL = ObjectId("6890a1b2c3d4e5f6077500d6")

REFEREE_EMAIL = "pfeife@example.com"
OTHER_REFEREE_EMAIL = "flagge@example.com"

# One person per seat, each at an address of their own.
SEATS = {
    ALPHA: {"trainer": "Tamsin", "ansprechperson": "Anwen", "stellvertretung": "Stellan"},
    BETA: {"trainer": "Bertil", "ansprechperson": "Brigid", "stellvertretung": "Bodo"},
}


# Before any pass of a case, so the pass mails each seat: an address nobody proved is mailed nothing.
CONFIRMED_ON = "2126-03-01"


def seated(first_name: str) -> dict[str, Any]:
    """One seat's person, who confirmed it."""

    return kontaktperson_document(first_name, confirmed_at=CONFIRMED_ON)


def kontakte(team_id: ObjectId, **overrides: Any) -> dict[str, Any]:
    return {**{seat: seated(first_name) for seat, first_name in SEATS[team_id].items()}, "trainer_is_also": None, **overrides}


def address(team_id: ObjectId, seat: str) -> str:
    return f"{SEATS[team_id][seat].lower()}@example.com"


# As the fixture stores them, naming nothing: every name the pass mails is joined from its own row.
def side(team_id: ObjectId, tore: int | None = None) -> dict[str, Any]:
    return {"team_id": team_id, "tore": tore}


def spielort() -> dict[str, Any]:
    return {"spielort_id": SPIELORT, "mietpreis": 80}


def booked(schiedsrichter_id: ObjectId = SCHIEDSRICHTER) -> dict[str, Any]:
    return {"schiedsrichter_id": schiedsrichter_id, "payment": 20}


def a_spiel(spiel_id: ObjectId, spiel_nr: int, date: str | None, *, saison_id: str = SAISON_ID, **fields: Any) -> dict[str, Any]:
    """A fixture every condition of the mint holds for but its date, which each case picks."""

    return documents.spiel_document(
        spiel_id=spiel_id,
        saison_id=saison_id,
        spiel_nr=spiel_nr,
        spieltag_id=SPIELTAG if saison_id == SAISON_ID else PAST_SPIELTAG,
        **{
            "team1": side(ALPHA),
            "team2": side(BETA),
            "date": date,
            "time": "18:00:00",
            "spielort": spielort(),
            "schiedsrichter": booked(),
            **fields,
        },
    )


def junction(team_id: ObjectId, *, saison_id: str = SAISON_ID, **fields: Any) -> dict[str, Any]:
    name, shorthand = NAMES[team_id]

    return documents.saison_team_document(saison_id, team_id, name, shorthand, **{"kontakte": kontakte(team_id), **fields})


def referee(schiedsrichter_id: ObjectId, email: str, name: str) -> dict[str, Any]:
    return documents.schiedsrichter_document(schiedsrichter_id, email=email, name=name, default_payment=20, einwilligung=None)


def mailed_row(*, spiel: Mapping[str, Any], party: Mapping[str, Any], asked_at: str | None, **fields: Any) -> dict[str, Any]:
    """A row an earlier pass wrote, as the mint writes it."""

    row = compose_spielbestaetigung(
        row_id=ObjectId(),
        saison_id=fields.pop("saison_id", SAISON_ID),
        spiel=spiel,
        party=party,
        today=fields.pop("today", days_after(day=TODAY, days=-10)),
        asked=asked_at is not None,
    )

    return {**row, "asked_at": asked_at, **fields}


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, spiele: list[dict[str, Any]], junctions: list[dict[str, Any]] | None = None) -> Any:
    """The SHIPPED indexes: a running season and a past one, two clubs, a ground and two referees."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_many(
                [documents.saison_document(SAISON_ID, "active"), documents.saison_document(PAST_SAISON_ID, "past")]
            )
            await database[Collection.TEAMS].insert_many([documents.team_document(team_id, *NAMES[team_id]) for team_id in NAMES])
            await database[Collection.SAISON_TEAMS].insert_many(junctions if junctions is not None else [junction(ALPHA), junction(BETA)])
            await database[Collection.SPIELTAGE].insert_many(
                [
                    {
                        "_id": SPIELTAG,
                        "start": "2126-03-01",
                        "end": "2126-06-30",
                        "position": 1,
                        "saison_id": SAISON_ID,
                        "saison_phase": "gruppenphase",
                        "version": 0,
                    },
                    {
                        "_id": PAST_SPIELTAG,
                        "start": "2125-03-01",
                        "end": "2125-06-30",
                        "position": 1,
                        "saison_id": PAST_SAISON_ID,
                        "saison_phase": "gruppenphase",
                        "version": 0,
                    },
                ]
            )
            await database[Collection.SPIELORTE].insert_one(documents.spielort_document(SPIELORT, "Sportpark"))
            await database[Collection.SCHIEDSRICHTER].insert_many(
                [referee(SCHIEDSRICHTER, REFEREE_EMAIL, "Pfiff"), referee(OTHER_SCHIEDSRICHTER, OTHER_REFEREE_EMAIL, "Flagge")]
            )
            if spiele:
                await database[Collection.SPIELE].insert_many(spiele)

            return await body(database, client)

    return on_the_seed_loop(_run())


# --- What a pass owed, read back off the Postausgang as the drain hands it out: each mail's recipient and its kind,
# grouped by the row it is about.


@dataclasses.dataclass(frozen=True)
class Recipient:
    address: str
    rollen: list[str]


@dataclasses.dataclass(frozen=True)
class Ansetzung:
    date: str
    time: str


@dataclasses.dataclass(frozen=True)
class Request:
    """A team row's request or reminder: one mail per mailbox of the club's confirmed seats, none carrying a link."""

    spielbestaetigung_id: Any
    spiel_id: Any
    side: str
    # The club the mail asks, off the mail itself: the adapter holds it to the fixture's side `side` names.
    team: str
    deadline: str
    ansetzung: Ansetzung
    recipients: list[Recipient]
    # The slot a move left, as the request telling of it names it: its two clubs, its day and its hour.
    moved_from: Mapping[str, Any] | None = None


@dataclasses.dataclass(frozen=True)
class Einteilung:
    spielbestaetigung_id: Any
    spiel_id: Any
    address: str
    moved_from: Mapping[str, Any] | None = None


@dataclasses.dataclass(frozen=True)
class TeamNotice:
    spielbestaetigung_id: Any
    spiel_id: Any
    team1_name: str
    team2_name: str
    old: FLSpielbestaetigungAppointment
    recipient: list[Recipient]
    # A move's notice alone: the slot moved to, whether the party is still the fixture's, and the promise no notice makes.
    moved_to: Mapping[str, Any] | None = None
    stays: bool | None = None
    asked_again: bool | None = None
    # A call-off's alone: the event it names.
    sonderereignis: str | None = None


@dataclasses.dataclass(frozen=True)
class RefereeNotice:
    spielbestaetigung_id: Any
    spiel_id: Any
    team1_name: str
    team2_name: str
    old: FLSpielbestaetigungAppointment
    address: str
    moved_to: Mapping[str, Any] | None = None
    stays: bool | None = None
    asked_again: bool | None = None
    sonderereignis: str | None = None


@dataclasses.dataclass(frozen=True)
class LineupReminder:
    spiel_id: str
    team: str
    address: str
    due_at: datetime


@dataclasses.dataclass
class Pass:
    """One pass's counted answer, and every mail owed since the last drain, handed out as the frontend's drain hands it."""

    answer: FLSpielbestaetigungSweepResponse
    requests: list[Request] = dataclasses.field(default_factory=list)
    reminders: list[Request] = dataclasses.field(default_factory=list)
    einteilungen: list[Einteilung] = dataclasses.field(default_factory=list)
    new_ansetzungen: list[TeamNotice] = dataclasses.field(default_factory=list)
    schiedsrichter_new_ansetzungen: list[RefereeNotice] = dataclasses.field(default_factory=list)
    schiedsrichter_switched: list[RefereeNotice] = dataclasses.field(default_factory=list)
    spiel_cancelled: list[TeamNotice] = dataclasses.field(default_factory=list)
    schiedsrichter_spiel_cancelled: list[RefereeNotice] = dataclasses.field(default_factory=list)
    vorschlag_discarded: list[TeamNotice] = dataclasses.field(default_factory=list)
    aufstellungen: list[LineupReminder] = dataclasses.field(default_factory=list)

    @property
    def closed(self) -> int:
        return self.answer.closed

    @property
    def failed(self) -> int:
        return self.answer.failed


async def handed_out(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    answer: FLSpielbestaetigungSweepResponse,
    *,
    kontakt_links: int = 0,
    now: datetime,
) -> Pass:
    """Drains the Postausgang and sorts what it handed out into the lists of `Pass`, each row's mails in the order owed.

    `kontakt_links` is how many contacts mails the case's own saves owed beside the pass, which no list of `Pass` holds:
    stated, so a pass owing one itself fails here rather than hiding among them.
    """

    mails = await drained(database, client, now=now)
    stored = {row["_id"]: row for row in await database[Collection.OUTBOX].find({"_id": {"$in": [mail.id for mail in mails]}}).to_list()}
    row_ids = [stored[mail.id]["reference"]["id"] for mail in mails]
    confirmations = {row["_id"]: row for row in await database[Collection.SPIELBESTAETIGUNGEN].find({"_id": {"$in": row_ids}}).to_list()}
    spiele = {
        row["_id"]: row
        for row in await database[Collection.SPIELE].find({"_id": {"$in": [row.get("spiel_id") for row in confirmations.values()]}}).to_list()
    }
    pass_ = Pass(answer=answer)
    grouped: dict[tuple[str, Any], Any] = {}
    set_aside = 0

    for mail, row_id in zip(mails, row_ids, strict=True):
        row = confirmations.get(row_id) or {}
        data = mail.data.model_dump()
        kind = data["kind"]
        if kind == "kontakt_confirmation":
            set_aside += 1
            continue
        # A fixture mail carries no link: the club answers on its own pages, signed in.
        assert stored[mail.id]["link"] is None and mail.token is None, kind
        seats = [stored[mail.id]["reference"]["seat"]]
        if kind in ("spiel_request", "spiel_reminder"):
            key = (kind, row_id)
            side = side_of(row)
            # The club the request names is the one on the side its seats answer for, by its season row's name.
            fielded = await database[Collection.SAISON_TEAMS].find_one(
                {"saison_id": row["saison_id"], "team_id": spiele[row["spiel_id"]][side]["team_id"]}
            )
            assert fielded is not None and data["team"] == fielded["name"], (data["team"], side)
            if key not in grouped:
                grouped[key] = Request(
                    spielbestaetigung_id=row_id,
                    spiel_id=row.get("spiel_id"),
                    side=side,
                    team=data["team"],
                    deadline=data["deadline"],
                    ansetzung=Ansetzung(date=data["ansetzung"]["date"], time=data["ansetzung"]["time"]),
                    recipients=[],
                    moved_from=data["moved_from"],
                )
                (pass_.requests if kind == "spiel_request" else pass_.reminders).append(grouped[key])
            grouped[key].recipients.append(Recipient(address=mail.to, rollen=seats))
            continue
        if kind == "aufstellung_reminder":
            pass_.aufstellungen.append(
                # The fixture off the row's key (`aufstellung_reminder_key`), the mail's data naming none.
                LineupReminder(spiel_id=stored[mail.id]["key"].split("/")[1], team=data["team"], address=mail.to, due_at=data["due_at"])
            )
            continue
        if kind == "spiel_einteilung":
            pass_.einteilungen.append(
                Einteilung(spielbestaetigung_id=row_id, spiel_id=row.get("spiel_id"), address=mail.to, moved_from=data["moved_from"])
            )
            continue

        appointment = data["appointment"]
        old = FLSpielbestaetigungAppointment(date=appointment["date"], time=appointment["time"])
        names = {"team1_name": appointment["team1"], "team2_name": appointment["team2"]}
        if kind == "spiel_moved":
            names |= {"moved_to": data["moved_to"], "stays": data["stays"], "asked_again": data["asked_again"]}
        if kind == "spiel_cancelled":
            names |= {"sonderereignis": data["sonderereignis"]}
        to_a_referee = kind == "spiel_einteilung_lifted" or data.get("recipient") == "schiedsrichter"
        if to_a_referee:
            notice = RefereeNotice(spielbestaetigung_id=row_id, spiel_id=row.get("spiel_id"), old=old, address=mail.to, **names)
            {
                "spiel_moved": pass_.schiedsrichter_new_ansetzungen,
                "spiel_cancelled": pass_.schiedsrichter_spiel_cancelled,
                "spiel_einteilung_lifted": pass_.schiedsrichter_switched,
            }[kind].append(notice)
            continue

        key = (kind, row_id)
        if key not in grouped:
            grouped[key] = TeamNotice(spielbestaetigung_id=row_id, spiel_id=row.get("spiel_id"), old=old, recipient=[], **names)
            {
                "spiel_moved": pass_.new_ansetzungen,
                "spiel_cancelled": pass_.spiel_cancelled,
                "spiel_vorschlag_discarded": pass_.vorschlag_discarded,
            }[kind].append(grouped[key])
        grouped[key].recipient.append(Recipient(address=mail.to, rollen=seats))

    assert set_aside == kontakt_links, f"{set_aside} contacts mails handed out where the case owed {kontakt_links}"

    return pass_


async def a_pass(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    *,
    saison_id: str = SAISON_ID,
    today: str = TODAY,
    now: datetime | None = None,
    **collections: Any,
) -> FLSpielbestaetigungSweepResponse:
    """One pass as the endpoint runs it, the collections named handed through a stand-in, and nothing drained.

    `now` is the pass's instant, `clock_of(today)` unless a case names one, as the endpoint reads both off one clock.
    """

    return await sweep_spielbestaetigungen(
        saison_id=saison_id,
        spielbestaetigungen_collection=collections.get("spielbestaetigungen", database[Collection.SPIELBESTAETIGUNGEN]),
        spiele_collection=collections.get("spiele", database[Collection.SPIELE]),
        saison_teams_collection=collections.get("saison_teams", database[Collection.SAISON_TEAMS]),
        saisons_collection=database[Collection.SAISONS],
        schiedsrichter_collection=collections.get("schiedsrichter", database[Collection.SCHIEDSRICHTER]),
        outbox_collection=database[Collection.OUTBOX],
        aufstellungen_collection=collections.get("aufstellungen", database[Collection.AUFSTELLUNGEN]),
        db=client,
        today=today,
        now=clock_of(today) if now is None else now,
    )


async def sweep(
    database: AsyncDatabase, client: AsyncMongoClient, *, saison_id: str = SAISON_ID, today: str = TODAY, passed_over: int = 0
) -> Pass:
    """One pass and the drain after it, asserting how many rows the pass passed over.

    A pass refusing a fixture for an unrelated reason mints nothing either, so a case asserting nothing was minted,
    closed or reminded holds only for the reason it names.
    """

    answer = await a_pass(database, client, saison_id=saison_id, today=today)
    assert answer.failed == passed_over, answer

    return await handed_out(database, client, answer, now=clock_of(today))


async def a_pass_through(database: AsyncDatabase, client: AsyncMongoClient, *, kontakt_links: int = 0, **collections: Any) -> Pass:
    """One pass, the collections named handed through a stand-in, and the drain after it; `kontakt_links` as `handed_out` takes it."""

    return await handed_out(database, client, await a_pass(database, client, **collections), kontakt_links=kontakt_links, now=NOW)


async def unstamp(database: AsyncDatabase) -> None:
    """Every row as one whose party no mail was ever owed: what a row nobody could be asked on reads as."""

    await database[Collection.SPIELBESTAETIGUNGEN].update_many({}, {"$set": {"asked_at": None}})


async def move(
    database: AsyncDatabase, client: AsyncMongoClient, spiel_id: ObjectId, *, spiele: Any = None, **overrides: Any
) -> FLPatchSpielDataResponse:
    """Through the administrator's own save, so the stand the pass compares is the one a real edit leaves; its dry run's answer.

    Confirming the later results its dry run says it deletes, as the editor's question does. `spiele` is the fixtures
    the save itself writes through, a stand-in where a case names one; the dry run reads the database's.
    """

    stored = await database[Collection.SPIELE].find_one({"_id": spiel_id})
    assert stored is not None
    payload = FLPatchSpielDataPayload.model_validate(spiel_patch_body(stored, **overrides))

    # Named one by one rather than spread from a dictionary, which no type check reads through.
    async def saved(spiel_data: FLPatchSpielDataPayload, *, dry_run: bool) -> FLPatchSpielDataResponse:
        return await patch_spiel(
            spiel_id=spiel_id,
            spiel_data=spiel_data,
            db=client,
            spiele_collection=database[Collection.SPIELE] if dry_run or spiele is None else spiele,
            teams_collection=database[Collection.TEAMS],
            saisons_collection=database[Collection.SAISONS],
            saison_teams_collection=database[Collection.SAISON_TEAMS],
            spieltage_collection=database[Collection.SPIELTAGE],
            spielorte_collection=database[Collection.SPIELORTE],
            schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
            spielberichte_collection=database[Collection.SPIELBERICHTE],
            aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
            spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
            now=NOW,
            dry_run=dry_run,
        )

    asked = await saved(payload, dry_run=True)
    await saved(payload.model_copy(update={"voided_results": asked.voided_results}), dry_run=False)

    return asked


async def press_answer(database: AsyncDatabase, client: AsyncMongoClient, row_id: Any, team_id: ObjectId) -> Any:
    """A club's Zusage to one of its rows, its Trainer signed in."""

    return await post_team_answer(
        spielbestaetigung_id=row_id,
        answer_data=FLSpielbestaetigungTeamAnswerPayload(answer="agreed", vorschlag=None, reason=None),
        identifier=address(team_id, "trainer"),
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spiele_collection=database[Collection.SPIELE],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spieltage_collection=database[Collection.SPIELTAGE],
        records=record_collections(database),
        db=client,
        now=NOW,
    )


async def refusal_of(database: AsyncDatabase, client: AsyncMongoClient, row_id: Any, team_id: ObjectId) -> str | None:
    """The code a press on this row meets now, or `None` where it is taken."""

    try:
        await press_answer(database, client, row_id, team_id)
    except APIError as refusal:
        return refusal.error_code

    return None


async def rows(database: AsyncDatabase, **db_filter: Any) -> list[Mapping[str, Any]]:
    return await database[Collection.SPIELBESTAETIGUNGEN].find(db_filter).sort("_id", 1).to_list(length=None)


def row_of(stored: list[Mapping[str, Any]], *, team_id: Any = None, schiedsrichter_id: Any = None) -> Mapping[str, Any]:
    """The one row of a party; two would be the double mint a case is about."""

    found = [
        row
        for row in stored
        if (team_id is not None and row["party"].get("team_id") == team_id)
        or (schiedsrichter_id is not None and row["party"].get("schiedsrichter_id") == schiedsrichter_id)
    ]
    assert len(found) == 1, found
    return found[0]


class TestTheSweepAsksAboutNothingItCannotHelp:
    """Both halves driven: `has_taken_place` reads a record and never a date, and the copied listing reads every season."""

    def test_a_pass_asks_about_the_coming_spiel_alone(self, mongo_replica_set_url: str):
        """Today's fixture is the floor's edge; the past season's is dated inside the window, so only the season keeps it out."""

        spiele = [
            a_spiel(SPIEL, 1, NEXT_WEEK),
            a_spiel(OTHER_SPIEL, 2, YESTERDAY),
            a_spiel(TODAYS_SPIEL, 3, TODAY),
            a_spiel(PAST_SPIEL, 1, NEXT_WEEK, saison_id=PAST_SAISON_ID),
        ]
        # The past season's clubs seated too, so nothing but its status can keep its fixture unasked.
        junctions = [junction(team_id, saison_id=saison_id) for saison_id in (SAISON_ID, PAST_SAISON_ID) for team_id in (ALPHA, BETA)]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            listing = await get_sweep_saisons(saisons_collection=database[Collection.SAISONS])
            # As the timer runs it, and the past season asked directly as a mistyped call would.
            answers = [await sweep(database, client, saison_id=saison_id) for saison_id in [*listing.saison_ids, PAST_SAISON_ID]]

            return listing.saison_ids, answers, sorted({(row["saison_id"], str(row["spiel_id"])) for row in await rows(database)})

        listed, answers, asked = on_a_league(mongo_replica_set_url, body, spiele=spiele, junctions=junctions)

        assert listed == [SAISON_ID]
        assert len(answers) == 2
        assert asked == [(SAISON_ID, str(SPIEL))]

    def test_the_same_pass_twice_owes_each_mail_once(self, mongo_replica_set_url: str):
        """The rows the first pass stamped in the transaction owing their mails are what the second finds asked."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await sweep(database, client)
            second = await a_pass(database, client)
            owed = await database[Collection.OUTBOX].find({}, {"to": 1, "kind": 1, "_id": 0}).to_list()

            return first, second, owed, await rows(database)

        first, second, owed, stored = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert (len(first.requests), len(first.einteilungen), second.mails) == (2, 1, 0)
        # One row per recipient: each seat's confirmed holder asked, and the referee told.
        assert sorted((mail["kind"], mail["to"]) for mail in owed) == sorted(
            [
                ("spiel_einteilung", REFEREE_EMAIL),
                *[("spiel_request", address(team_id, seat)) for team_id in (ALPHA, BETA) for seat in KONTAKT_ROLLEN],
            ]
        )
        assert {row["asked_at"] for row in stored} == {TODAY}


class TestTheWindow:
    """A request answers at most its answer window, so a fixture is asked once its deadline is that window away and not before."""

    def test_a_spiel_twenty_one_days_out_is_asked_and_twenty_two_is_not(self, mongo_replica_set_url: str):
        spiele = [a_spiel(SPIEL, 1, days_after(day=TODAY, days=21)), a_spiel(OTHER_SPIEL, 2, days_after(day=TODAY, days=22))]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            return await rows(database)

        stored = on_a_league(mongo_replica_set_url, body, spiele=spiele)

        assert {row["spiel_id"] for row in stored} == {SPIEL}
        assert {row["deadline"] for row in stored} == {days_after(day=TODAY, days=14)}

    def test_a_spiel_inside_the_notice_period_is_due_today(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            return await rows(database)

        stored = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, days_after(day=TODAY, days=3))])

        assert {row["deadline"] for row in stored} == {TODAY}


class TestTheMintNeverAsksWhatTheCloseShuts:
    """Each fixture would be closed by the next pass, so a mint here is a fresh request every hour with nothing failing."""

    @pytest.mark.parametrize("austritt_tag", [pytest.param(NEXT_WEEK, id="a club gone on the fixture's day")])
    def test_two_passes_mint_nothing(self, mongo_replica_set_url: str, austritt_tag: str):
        austritt = {"type": "rueckzug", "reason": "Schulwechsel", "date": austritt_tag}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first, second = await sweep(database, client), await sweep(database, client)
            return first, second, await rows(database)

        first, second, stored = on_a_league(
            mongo_replica_set_url,
            body,
            spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)],
            junctions=[junction(ALPHA, austritt=austritt), junction(BETA)],
        )

        assert (stored, first.requests, second.requests, first.closed + second.closed) == ([], [], [], 0)


class TestASpielCalledOffAndReinstatedIsAskedAgain:
    """The mint's test is an UNCLOSED row, so the closed rows of a called-off fixture never stand in for a fresh request."""

    def test_the_reinstated_spiel_at_the_same_slot_mints_afresh(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"sonderereignis": "ausgefallen"}})
            cancelled = await sweep(database, client)
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"sonderereignis": None}})
            reinstated = await sweep(database, client)

            return cancelled, reinstated, await rows(database)

        cancelled, reinstated, stored = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert (cancelled.closed, cancelled.requests) == (3, [])
        assert (len(reinstated.requests), len(reinstated.einteilungen)) == (2, 1)
        assert Counter((row["closed"] or {}).get("reason") for row in stored) == {"cancelled": 3, None: 3}


def answered(answer: Literal["agreed", "declined"]) -> dict[str, Any]:
    """A seat's answer as its press stores it, a decline proposing the day after."""

    return compose_answer_update(
        answer=answer,
        seat="trainer",
        vorschlag=FLSpielbestaetigungAppointment(date=days_after(day=NEXT_WEEK, days=1), time="18:00:00") if answer == "declined" else None,
        reason="Klassenfahrt" if answer == "declined" else None,
        today=TODAY,
    )


async def discard(database: AsyncDatabase, team_id: ObjectId) -> None:
    """The discard's write as it closes the declining club's own row, its decline standing."""

    declined = {"$set": {**answered("declined")["$set"], **compose_closing_update(reason="discarded")["$set"]}}
    await database[Collection.SPIELBESTAETIGUNGEN].update_one({"party.team_id": team_id}, declined)


async def verdict(database: AsyncDatabase) -> bool | None:
    cursor = await database[Collection.SPIELE].aggregate(build_spiele_pipeline(db_filter={"_id": SPIEL}))
    (document,) = await cursor.to_list()

    return document[ANSETZUNG_CONFIRMED]


async def alphas_discard_beside_betas_agreement(database: AsyncDatabase, client: AsyncMongoClient) -> ObjectId:
    """Every row asked and mailed, so a notice the close owed would be answered; the discarded row's id."""

    await sweep(database, client)
    await discard(database, ALPHA)
    await database[Collection.SPIELBESTAETIGUNGEN].update_one({"party.team_id": BETA}, answered("agreed"))

    return row_of(await rows(database), team_id=ALPHA)["_id"]


class TestADiscardedDeclineIsNotAskedAgain:
    """A club declines once per Ansetzung, so the decline the administrator discarded is its answer."""

    def test_the_declining_club_is_asked_nothing_until_the_spiel_moves(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await discard(database, BETA)
            discarded = await sweep(database, client)
            await move(database, client, SPIEL, time="19:00:00")
            moved = await sweep(database, client)

            return discarded, moved

        discarded, moved = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        left = {"team1": "Alpha", "team2": "Beta", "date": NEXT_WEEK, "time": "18:00:00"}
        assert (discarded.requests, discarded.einteilungen) == ([], [])
        # Beta too is asked naming the slot left: its discard told it that slot stands, and a request naming none would
        # leave that slot standing beside the new one.
        assert sorted((request.side, request.moved_from) for request in moved.requests) == [("team1", left), ("team2", left)]

    def test_a_fixture_whose_every_row_is_a_discard_is_asked_at_once_about_a_move_past_the_window(self, mongo_replica_set_url: str):
        """No referee booked, so nothing but the two discards holds a question about the fixture.

        Left to the window, both clubs would keep the slot they were told stands for months, and its kick-off would end
        both discards telling nobody.
        """

        moved_to = days_after(day=TODAY, days=60)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await discard(database, ALPHA)
            await discard(database, BETA)
            await move(database, client, SPIEL, date=moved_to)

            return await sweep(database, client)

        moved = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK, schiedsrichter=None)])

        left = {"team1": "Alpha", "team2": "Beta", "date": NEXT_WEEK, "time": "18:00:00"}
        assert sorted((request.side, request.ansetzung.date, request.moved_from) for request in moved.requests) == [
            ("team1", moved_to, left),
            ("team2", moved_to, left),
        ]
        assert moved.new_ansetzungen == []

    def test_a_move_onto_today_ends_the_discard_and_tells_its_club(self, mongo_replica_set_url: str):
        """Nobody is asked about a match on its own day, so the close step tells the discarded club of the move.

        Kept as the club's answer to the slot left, the discard would tell it nothing, and the slot it was told stands
        would end telling nobody.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await discard(database, BETA)
            await move(database, client, SPIEL, date=TODAY)

            return await sweep(database, client), row_of(await rows(database), team_id=BETA)

        told, discarded = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        today = {"team1": "Alpha", "team2": "Beta", "date": TODAY, "time": "18:00:00", "spielort": "Sportpark"}
        assert sorted((sorted(r.address for r in notice.recipient), notice.moved_to, notice.stays) for notice in told.new_ansetzungen) == [
            (sorted(address(team_id, seat) for seat in KONTAKT_ROLLEN), today, True) for team_id in (ALPHA, BETA)
        ]
        assert discarded["closed"] == {"reason": "ansetzung_changed", "discarded": True, "matched": False}

    def test_moved_away_and_back_it_is_asked_again_as_an_agreeing_club_is(self, mongo_replica_set_url: str):
        """The first move ended the discard, so back on its slot the club is asked afresh, the move named in its request.

        One rule for every answer: a move ends it, and the party is asked about the slot the fixture holds. Kept through
        the move instead, the discard would be the club's answer to the slot left beside its newer row, each owing a
        notice of the next change.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await discard(database, BETA)
            await move(database, client, SPIEL, time="19:00:00")
            await sweep(database, client)
            await move(database, client, SPIEL, time="18:00:00")

            return await sweep(database, client)

        back = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        left = {"team1": "Alpha", "team2": "Beta", "date": NEXT_WEEK, "time": "19:00:00"}
        assert back.new_ansetzungen == []
        assert sorted((request.side, request.ansetzung.time, request.moved_from) for request in back.requests) == [
            ("team1", "18:00:00", left),
            ("team2", "18:00:00", left),
        ]

    @pytest.mark.parametrize(
        "moved",
        [
            pytest.param({"date": days_after(day=NEXT_WEEK, days=-2)}, id="to an earlier day"),
            pytest.param({"time": "17:00:00"}, id="to an earlier hour of the day"),
        ],
    )
    def test_an_asked_move_is_told_once_in_its_request_and_never_again_on_the_new_day(self, mongo_replica_set_url: str, moved: dict[str, Any]):
        """The request names the slot left; a second notice on the match day would tell a move the club may have agreed to."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await discard(database, BETA)
            await move(database, client, SPIEL, **moved)
            asked = await sweep(database, client)
            spiel = await database[Collection.SPIELE].find_one({"_id": SPIEL})
            assert spiel is not None
            # The discard, the first of Beta's rows, ended by the mint asking Beta about the new slot.
            ended = (await rows(database, **{"party.team_id": BETA}))[0]["closed"]

            return asked, ended, await sweep(database, client, today=spiel["date"])

        asked, ended, on_its_day = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        left = {"team1": "Alpha", "team2": "Beta", "date": NEXT_WEEK, "time": "18:00:00"}
        assert [
            (request.side, request.moved_from, sorted(recipient.address for recipient in request.recipients)) for request in asked.requests
        ] == [
            ("team1", left, sorted(address(ALPHA, seat) for seat in KONTAKT_ROLLEN)),
            ("team2", left, sorted(address(BETA, seat) for seat in KONTAKT_ROLLEN)),
        ]
        assert (asked.new_ansetzungen, on_its_day.new_ansetzungen) == ([], [])
        assert ended == {"reason": "ansetzung_changed", "discarded": True}

    @pytest.mark.parametrize(
        "change",
        [
            pytest.param("onto today", id="moved onto today"),
            pytest.param("called off", id="called off"),
            pytest.param("taken off", id="its club taken off"),
        ],
    )
    def test_a_change_after_an_asked_move_tells_the_discarded_club_once(self, mongo_replica_set_url: str, change: str):
        """Asked about the move, the club holds one question about the fixture, so the next change tells it once.

        Kept beside the request, the discard would owe a second notice of the same change, naming a slot the club was told
        two moves ago is gone, and the save question would name the club twice.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await discard(database, BETA)
            await move(database, client, SPIEL, time="19:00:00")
            await sweep(database, client)
            named: list[str] = []
            if change == "onto today":
                named = [party.name for party in (await move(database, client, SPIEL, date=TODAY)).recipients or []]
            elif change == "called off":
                await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"sonderereignis": "ausgefallen"}})
            else:
                # The bracket's own write, which re-fields a side and touches no season row.
                await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"team2": side(GAMMA)}})

            return named, await sweep(database, client)

        named, told = on_a_league(
            mongo_replica_set_url,
            body,
            spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)],
            junctions=[junction(ALPHA), junction(BETA), documents.saison_team_document(SAISON_ID, GAMMA, *NAMES[GAMMA])],
        )

        if change == "onto today":
            assert sorted(named) == ["Alpha", "Beta", "Pfiff"]
        notices = [*told.new_ansetzungen, *told.spiel_cancelled]
        betas = [notice for notice in notices if {recipient.address for recipient in notice.recipient} & {address(BETA, "trainer")}]
        assert [(notice.old.time, sorted(recipient.address for recipient in notice.recipient)) for notice in betas] == [
            ("19:00:00", sorted(address(BETA, seat) for seat in KONTAKT_ROLLEN))
        ]


AUSTRITT_ON_THE_DAY = {"austritt": {"type": "rueckzug", "reason": "Schulwechsel", "date": NEXT_WEEK}}


class TestARefereeHoldsOneQuestionAcrossAMoveAndBack:
    def test_each_pass_leaves_the_referee_one_row_about_the_slot_held_and_tells_each_move(self, mongo_replica_set_url: str):
        """The mint tells a referee of a move only in the Einteilung asking the new slot, which rests on this.

        A row of theirs about the slot held, standing beside an open one about a slot left, would be a move the mint
        tells nobody of: it has no arm for a referee whose row about the slot already stands.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            seen: list[tuple[list[str], str, list[bool]]] = []
            for time in (None, "19:00:00", "18:00:00"):
                if time is not None:
                    await move(database, client, SPIEL, time=time)
                passed = await sweep(database, client)
                spiel = await database[Collection.SPIELE].find_one({"_id": SPIEL})
                assert spiel is not None
                held = await rows(database, spiel_id=SPIEL, **{"party.kind": "schiedsrichter"}, **build_holding_filter())
                seen.append(
                    (
                        [row["ansetzung"]["digest"] for row in held],
                        ansetzung_digest_of(spiel),
                        [einteilung.moved_from is not None for einteilung in passed.einteilungen],
                    )
                )

            return seen

        seen = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert [held for held, _, _ in seen] == [[digest] for _, digest, _ in seen]
        # Asked first, then told of each move in the Einteilung asking the slot it moved to.
        assert [told for _, _, told in seen] == [[False], [True], [True]]


class TestADiscardEndsWhereAnAgreementBesideItEnds:
    """The public verdict counts a discard as its club's agreement only while an agreement would count."""

    @pytest.mark.parametrize(
        ("saison_team", "spiel", "reason"),
        [
            pytest.param(AUSTRITT_ON_THE_DAY, {}, "austritt", id="the agreeing club gone by the day"),
            pytest.param({}, {"sonderereignis": "ausgefallen"}, "cancelled", id="called off"),
        ],
    )
    def test_the_pass_closing_the_agreement_ends_the_discard_and_tells_what_its_closing_owes(
        self, mongo_replica_set_url: str, saison_team: dict[str, Any], spiel: dict[str, Any], reason: str
    ):
        """Kept, the discard alone would read the fixture provisional where two agreements read null.

        Ended, it owes what its closing owes, as the agreement beside it does: a call-off tells the discarded club too.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            discarded = await alphas_discard_beside_betas_agreement(database, client)
            if saison_team:
                await database[Collection.SAISON_TEAMS].update_one({"team_id": BETA, "saison_id": SAISON_ID}, {"$set": saison_team})
            if spiel:
                await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": spiel})
            before = await verdict(database)
            answer = await sweep(database, client)

            return discarded, before, answer, await verdict(database), await rows(database)

        discarded, before, answer, after, stored = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert (before, after) == (True, None)
        # Both clubs' rows and the referee's, the discard among them.
        assert (len(stored), {row["closed"]["reason"] for row in stored}) == (3, {reason})
        # The referee's notice among them: a club's ended discard is neither a move nor a referee change.
        assert (answer.new_ansetzungen, answer.schiedsrichter_new_ansetzungen) == ([], [])
        # An exit lifts the booked referee's Einteilung, and owes neither club a thing here: the opponents heard at its write.
        assert [notice.address for notice in answer.schiedsrichter_switched] == ([REFEREE_EMAIL] if reason == "austritt" else [])
        told = {notice.spielbestaetigung_id for notice in [*answer.spiel_cancelled, *answer.schiedsrichter_spiel_cancelled]}
        # By row, the discarded club's named: the call-off's notices go to every party it closed a mailed row of.
        assert told == ({row["_id"] for row in stored} if reason == "cancelled" else set())
        assert (discarded in told) is (reason == "cancelled")


class TestTheCloseEndingARowStoresWhetherItAnsweredTheFixture:
    """What a closed row reads as is `state_of`'s, held in the default tier; this holds what the close stores for it to read."""

    @pytest.mark.parametrize(
        ("change", "team_id", "closed"),
        [
            pytest.param({}, ALPHA, {"reason": "spiel_past", "discarded": True, "matched": True}, id="a discard ended at its slot"),
            # A move onto a slot gone by, which nobody is asked about, ends it about the slot the fixture left.
            pytest.param(
                {"time": "19:00:00"}, ALPHA, {"reason": "ansetzung_changed", "discarded": True, "matched": False}, id="a discard the match left"
            ),
            # The result entered with the kick-off corrected, ahead of the pass: the agreement was to the match played.
            pytest.param(
                {"time": "18:30:00", "team1.tore": 2, "team2.tore": 1, "ergebnis": "2:1"},
                BETA,
                {"reason": "spiel_decided", "matched": True},
                id="an agreement retimed as it is decided",
            ),
            # And the discard beside it, judged as the agreement is: no discard outlives a move to differ from it.
            pytest.param(
                {"time": "18:30:00", "team1.tore": 2, "team2.tore": 1, "ergebnis": "2:1"},
                ALPHA,
                {"reason": "spiel_decided", "discarded": True, "matched": True},
                id="a discard retimed as it is decided",
            ),
        ],
    )
    def test_the_pass_after_the_day_stores_the_mark_and_the_judgement(
        self, mongo_replica_set_url: str, change: dict[str, Any], team_id: ObjectId, closed: dict[str, Any]
    ):
        """Its end overwriting the mark, the editor would read the club agreed until the match and declined from the next pass on.

        And judged again on each read, a kick-off corrected after the pass would turn one club's answer invalid beside the
        other's, about the one slot both answered.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await alphas_discard_beside_betas_agreement(database, client)
            if change:
                await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": change})
            await sweep(database, client, today=days_after(day=NEXT_WEEK, days=1))

            return row_of(await rows(database), team_id=team_id)

        stored = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert stored["closed"] == closed


class TestAMovedSpielAsksAgain:
    """The close reaches an ANSWERED row, so a kept agreement records why it stopped applying."""

    def test_the_answered_row_closes_with_its_answer_and_the_new_ansetzung_is_asked(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await sweep(database, client)
            asked = {request.side: request.spielbestaetigung_id for request in first.requests}
            await press_answer(database, client, asked["team1"], ALPHA)
            answered = row_of(await rows(database), team_id=ALPHA)
            await move(database, client, SPIEL, time="19:00:00")
            second = await sweep(database, client)
            refusals = [await refusal_of(database, client, asked[side], team_id) for side, team_id in (("team1", ALPHA), ("team2", BETA))]

            return answered, second, await rows(database), refusals

        answered, second, stored, refusals = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        answered_id = answered["_id"]
        closed = [row for row in stored if row["closed"] is not None]
        standing = [row for row in stored if row["closed"] is None]
        assert answered_id in {row["_id"] for row in closed}
        assert [row["closed"]["reason"] for row in closed] == ["ansetzung_changed"] * 3
        assert (answered["answer"]["kind"], answered["answer"]["by"]["rolle"]) == ("agreed", "trainer")
        assert next(row for row in closed if row["_id"] == answered_id)["answer"] == answered["answer"]
        assert [row["answer"] for row in closed if row["_id"] != answered_id] == [None, None]
        assert refusals == [Code.ANSETZUNG_ANSWERED, Code.ANSETZUNG_CLOSED]
        assert {row["ansetzung"]["time"] for row in standing} == {"19:00:00"}
        assert len(standing) == 3
        assert second.closed == 3
        # The request about the new slot is the one mail telling each party of the move: no notice beside it.
        left = {"team1": "Alpha", "team2": "Beta", "date": NEXT_WEEK, "time": "18:00:00"}
        assert (second.new_ansetzungen, second.schiedsrichter_new_ansetzungen) == ([], [])
        assert sorted((request.side, request.moved_from, request.ansetzung.time) for request in second.requests) == [
            ("team1", left, "19:00:00"),
            ("team2", left, "19:00:00"),
        ]
        assert [(einteilung.address, einteilung.moved_from) for einteilung in second.einteilungen] == [(REFEREE_EMAIL, left)]
        alpha_request = next(request for request in second.requests if request.side == "team1")
        assert sorted(recipient.address for recipient in alpha_request.recipients) == sorted(address(ALPHA, seat) for seat in KONTAKT_ROLLEN)

    def test_a_club_never_asked_about_the_slot_left_is_asked_naming_none(self, mongo_replica_set_url: str):
        """A club first mailed after the move was never told the old slot, so its first request names no slot it left."""

        unconfirmed = {**{seat: kontaktperson_document(first_name) for seat, first_name in SEATS[ALPHA].items()}, "trainer_is_also": None}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await database[Collection.SAISON_TEAMS].update_one(
                {"team_id": ALPHA, "saison_id": SAISON_ID}, {"$set": {"kontakte.ansprechperson": seated("Anwen")}}
            )
            await move(database, client, SPIEL, time="19:00:00")

            return await sweep(database, client)

        second = on_a_league(
            mongo_replica_set_url,
            body,
            spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)],
            junctions=[junction(ALPHA, kontakte=unconfirmed), junction(BETA)],
        )

        left = {"team1": "Alpha", "team2": "Beta", "date": NEXT_WEEK, "time": "18:00:00"}
        assert sorted((request.side, request.moved_from) for request in second.requests) == [("team1", None), ("team2", left)]


class TestAMoveAskedAtOnceWaitsOnNoCloseShare:
    """A move whose new slot the mint asks is the mint's to close, so a close share full of other rows holds it back nothing."""

    def test_the_moved_spiel_is_asked_and_told_on_the_pass_the_close_share_fills(self, mongo_replica_set_url: str):
        decided = [
            a_spiel(ObjectId(f"6890a1b2c3d4e5f6077{position:05d}"), 10 + position, YESTERDAY, ergebnis="1:0")
            for position in range(CLOSES_PER_PASS)
        ]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            # Older than the moved fixture's, so the close's share takes them first.
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many(
                [
                    compose_spielbestaetigung(
                        row_id=ObjectId(),
                        saison_id=SAISON_ID,
                        spiel=spiel,
                        party={"kind": "team", "team_id": ALPHA},
                        today=days_after(day=TODAY, days=-10),
                        asked=False,
                    )
                    for spiel in decided
                ]
            )
            await move(database, client, SPIEL, time="19:00:00")

            return await sweep(database, client), await sweep(database, client)

        overflowed, after = on_a_league(mongo_replica_set_url, body, spiele=[*decided, a_spiel(SPIEL, 1, NEXT_WEEK)])

        # The close's share of decided rows, and beside it the mint's three rows about the slot left.
        assert overflowed.closed == CLOSES_PER_PASS + 3
        assert overflowed.new_ansetzungen == []
        assert [request.moved_from is not None for request in overflowed.requests] == [True, True]
        assert [einteilung.moved_from is not None for einteilung in overflowed.einteilungen] == [True]
        assert (after.requests, after.einteilungen, after.new_ansetzungen) == ([], [], [])


class TestAMoveTheCloseMustTellFirstWaitsForIt:
    def test_the_fixture_is_asked_on_the_pass_after_the_close_shuts_its_row(self, mongo_replica_set_url: str):
        """A referee taken off is the close's to tell: asked first, the new slot goes out beside a row still standing about the old one."""

        decided = [
            a_spiel(ObjectId(f"6890a1b2c3d4e5f6077{position:05d}"), 10 + position, YESTERDAY, ergebnis="1:0")
            for position in range(CLOSES_PER_PASS)
        ]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many(
                [
                    compose_spielbestaetigung(
                        row_id=ObjectId(),
                        saison_id=SAISON_ID,
                        spiel=spiel,
                        party={"kind": "team", "team_id": ALPHA},
                        today=days_after(day=TODAY, days=-10),
                        asked=False,
                    )
                    for spiel in decided
                ]
            )
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"schiedsrichter": booked(OTHER_SCHIEDSRICHTER)}})
            await move(database, client, SPIEL, time="19:00:00")

            return await sweep(database, client), await sweep(database, client)

        waited, asked = on_a_league(mongo_replica_set_url, body, spiele=[*decided, a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert (waited.closed, waited.requests, waited.einteilungen) == (CLOSES_PER_PASS, [], [])
        assert [einteilung.address for einteilung in asked.einteilungen] == [OTHER_REFEREE_EMAIL]
        assert len(asked.requests) == 2


class TestTheMintsShareTakesWholeFixtures:
    def test_the_fixture_past_it_stays_due_with_every_party_unasked(self, mongo_replica_set_url: str):
        """Cut inside a fixture, one club is asked about a day its opponent hears of a pass later."""

        # Three rows for the booked fixture and two for each other, so the last meets a share one row short of holding it.
        spiele = [a_spiel(SPIEL, 1, NEXT_WEEK), *numbered_spiele((MINTS_PER_PASS - 3) // 2 + 1, NEXT_WEEK)]

        async def per_fixture(database: AsyncDatabase) -> dict[Any, int]:
            return Counter(row["spiel_id"] for row in await rows(database))

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_pass(database, client)
            first = await per_fixture(database)
            await a_pass(database, client)
            return first, await per_fixture(database)

        first, second = on_a_league(mongo_replica_set_url, body, spiele=spiele)

        assert sum(first.values()) == MINTS_PER_PASS - 1
        assert (first[SPIEL], set(first.values())) == (3, {2, 3})
        assert (len(first), len(second)) == (len(spiele) - 1, len(spiele))


class TestAMovePastTheWindowIsAskedAtOnce:
    """Left to the window, a party told only of the move hears of no later move, call-off or exit until the window reaches it."""

    MOVED_TO = days_after(day=TODAY, days=60)

    async def asked_then_moved_out(self, database: AsyncDatabase, client: AsyncMongoClient) -> Pass:
        await sweep(database, client)
        await move(database, client, SPIEL, date=self.MOVED_TO)

        return await sweep(database, client)

    def test_the_parties_asked_are_asked_about_the_new_slot_in_the_pass_after_the_move(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await self.asked_then_moved_out(database, client), await rows(database)

        moved, stored = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        left = {"team1": "Alpha", "team2": "Beta", "date": NEXT_WEEK, "time": "18:00:00"}
        assert Counter((row["closed"] or {}).get("reason") for row in stored) == {"ansetzung_changed": 3, None: 3}
        standing = [row for row in stored if row["closed"] is None]
        assert {(row["ansetzung"]["date"], row["asked_at"]) for row in standing} == {(self.MOVED_TO, TODAY)}
        assert {row["deadline"] for row in standing if row["party"]["kind"] == "team"} == {
            days_after(day=self.MOVED_TO, days=-SPIEL_CONFIRMATION_DEADLINE_DAYS)
        }
        # The request and the Einteilung are the mails telling of the move: no notice beside them.
        assert (moved.new_ansetzungen, moved.schiedsrichter_new_ansetzungen) == ([], [])
        assert sorted((request.side, request.moved_from) for request in moved.requests) == [("team1", left), ("team2", left)]
        assert [(einteilung.address, einteilung.moved_from) for einteilung in moved.einteilungen] == [(REFEREE_EMAIL, left)]

    def test_a_club_leaving_after_it_lifts_the_referees_einteilung(self, mongo_replica_set_url: str):
        """The referee keeps the new day free only while a row of theirs stands open to be told it no longer holds."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await self.asked_then_moved_out(database, client)
            await database[Collection.SAISON_TEAMS].update_one(
                {"team_id": BETA, "saison_id": SAISON_ID},
                {"$set": {"austritt": {"type": "rueckzug", "reason": "Schulwechsel", "date": TODAY}}},
            )

            return await sweep(database, client)

        left = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert [(notice.address, notice.old.date) for notice in left.schiedsrichter_switched] == [(REFEREE_EMAIL, self.MOVED_TO)]

    def test_a_move_onto_today_is_told_promising_nothing(self, mongo_replica_set_url: str):
        """Nobody is asked about a match on its own day, so the move's notice is the last mail about it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await move(database, client, SPIEL, date=TODAY)

            return await sweep(database, client)

        told = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        today = {"team1": "Alpha", "team2": "Beta", "date": TODAY, "time": "18:00:00", "spielort": "Sportpark"}
        assert (told.closed, told.requests, told.einteilungen) == (3, [], [])
        assert sorted((notice.old.date, notice.moved_to, notice.stays, notice.asked_again) for notice in told.new_ansetzungen) == [
            (NEXT_WEEK, today, True, False),
            (NEXT_WEEK, today, True, False),
        ]
        assert [(notice.moved_to, notice.stays, notice.asked_again) for notice in told.schiedsrichter_new_ansetzungen] == [(today, True, False)]

    def test_a_slot_left_with_no_hour_tells_every_party_still_on_it_of_the_move(self, mongo_replica_set_url: str):
        """Its notice names no new slot, so only `stays` tells a party still on the fixture from one the move took off it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"time": None}})

            return await sweep(database, client)

        told = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert [(notice.moved_to, notice.stays) for notice in told.new_ansetzungen] == [(None, True), (None, True)]
        assert [(notice.moved_to, notice.stays) for notice in told.schiedsrichter_new_ansetzungen] == [(None, True)]


class TestARefereeChangeClosesTheirRowAlone:
    def test_the_new_referee_is_told_and_the_old_one_is_not(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"schiedsrichter": booked(OTHER_SCHIEDSRICHTER)}})
            return await sweep(database, client), await rows(database)

        second, stored = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        old = row_of(stored, schiedsrichter_id=SCHIEDSRICHTER)
        assert old["closed"]["reason"] == "schiedsrichter_switched"
        assert [einteilung.address for einteilung in second.einteilungen] == [OTHER_REFEREE_EMAIL]
        # The referee taken off is told so at their own address, about the slot they were booked for.
        assert [(notice.spielbestaetigung_id, notice.address, notice.old.date) for notice in second.schiedsrichter_switched] == [
            (old["_id"], REFEREE_EMAIL, NEXT_WEEK)
        ]
        assert (second.schiedsrichter_new_ansetzungen, second.requests, second.closed) == ([], [], 1)


class TestAReplacedClubsRowsClose:
    """The club leaving takes its season row along, so a notice naming it off that row would hold every mailed row open for good."""

    def test_the_opponent_and_the_referee_are_told_and_every_row_closes(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            # A replacement runs only before the season's start, so it starts the day after `TODAY`.
            await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"start_date": "2126-04-02"}})
            await replace_saison_team(
                team_id=ALPHA,
                saison_id=SAISON_ID,
                replacement_data=FLReplaceSaisonTeamPayload(incoming_team_id=GAMMA),
                teams_collection=database[Collection.TEAMS],
                saison_teams_collection=database[Collection.SAISON_TEAMS],
                saisons_collection=database[Collection.SAISONS],
                spiele_collection=database[Collection.SPIELE],
                saison_spieler_collection=database[Collection.SAISON_SPIELER],
                bewerbungen_collection=database[Collection.BEWERBUNGEN],
                aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
                db=client,
                today=TODAY,
            )
            return await sweep(database, client), await rows(database)

        second, stored = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert second.closed == 3
        assert Counter(row["closed"]["reason"] for row in stored if row["closed"] is not None) == {"ansetzung_changed": 3}
        # The leaving club's people left with its row, so its own row closes telling nobody; the opponent and the referee,
        # still the fixture's, are told by the request and the Einteilung about the new Ansetzung.
        left = {"team1": "Gamma", "team2": "Beta", "date": NEXT_WEEK, "time": "18:00:00"}
        assert (second.new_ansetzungen, second.schiedsrichter_new_ansetzungen) == ([], [])
        assert [(request.team, request.moved_from) for request in second.requests if request.team == "Beta"] == [("Beta", left)]
        assert [(einteilung.address, einteilung.moved_from) for einteilung in second.einteilungen] == [(REFEREE_EMAIL, left)]


class TestASideReFieldedNamesThePairingEachPartyWasAskedAbout:
    """A knockout correction re-fields a side, the club taken off keeping its season row: no party was asked about the new pairing."""

    def test_the_club_taken_off_and_the_parties_still_on_it_are_told_of_the_slot_they_were_asked_about(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            # The bracket's own write, which re-fields a side and touches no season row.
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"team1": side(GAMMA)}})

            return await sweep(database, client)

        second = on_a_league(
            mongo_replica_set_url,
            body,
            spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)],
            junctions=[junction(ALPHA), junction(BETA), documents.saison_team_document(SAISON_ID, GAMMA, *NAMES[GAMMA])],
        )

        left = {"team1": "Alpha", "team2": "Beta", "date": NEXT_WEEK, "time": "18:00:00"}
        # Alpha, off the fixture, is told the request it was sent no longer stands, about the pairing it was sent: told it
        # stays, it would read that the match it no longer plays moved.
        assert [
            ((notice.team1_name, notice.team2_name), notice.moved_to, notice.stays, sorted(r.address for r in notice.recipient))
            for notice in second.new_ansetzungen
        ] == [(("Alpha", "Beta"), None, False, sorted(address(ALPHA, seat) for seat in KONTAKT_ROLLEN))]
        assert [(request.team, request.moved_from) for request in second.requests] == [("Beta", left)]
        assert [(einteilung.address, einteilung.moved_from) for einteilung in second.einteilungen] == [(REFEREE_EMAIL, left)]


class TestARowClosesOnceItsDayHasPassed:
    """A fixture nobody entered a result for keeps no row open past its day."""

    def test_the_day_after_closes_every_row_answered_or_not_and_the_day_itself_none(self, mongo_replica_set_url: str):
        day_after = days_after(day=NEXT_WEEK, days=1)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await sweep(database, client)
            await press_answer(
                database, client, next(request.spielbestaetigung_id for request in first.requests if request.side == "team1"), ALPHA
            )
            answered = row_of(await rows(database), team_id=ALPHA)

            return (
                answered,
                await sweep(database, client, today=NEXT_WEEK),
                await sweep(database, client, today=day_after),
                await rows(database),
            )

        answered, on_the_day, after, stored = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert on_the_day.closed == 0
        assert after.closed == 3
        assert [row["closed"] for row in stored] == [{"reason": "spiel_past", "matched": True}] * 3
        assert row_of(stored, team_id=ALPHA)["answer"] == answered["answer"]
        # A day gone by is no new Ansetzung: nobody is told it moved, nor asked again.
        assert (after.new_ansetzungen, after.schiedsrichter_new_ansetzungen, after.requests, after.einteilungen) == ([], [], [], [])


class TestAPageOfPastRowsStallsNoPass:
    """More unclosed rows of past days than the close's page reads: none closable, every pass would refuse at the page and mint nothing."""

    def test_the_close_takes_its_share_and_the_mint_still_asks(self, mongo_replica_set_url: str):
        # Two rows a fixture, the referee left off: one row past the page.
        past = numbered_spiele(SWEEP_PAGE // 2 + 1, YESTERDAY)
        open_rows = [
            compose_spielbestaetigung(
                row_id=ObjectId(),
                saison_id=SAISON_ID,
                spiel=spiel,
                party=party,
                today=days_after(day=YESTERDAY, days=-10),
                asked=False,
            )
            for spiel in past
            for party in parties_of(spiel)
        ]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many(open_rows)
            return await sweep(database, client)

        answer = on_a_league(mongo_replica_set_url, body, spiele=[*past, a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert len(open_rows) > SWEEP_PAGE
        assert answer.closed == CLOSES_PER_PASS
        assert (len(answer.requests), len(answer.einteilungen)) == (2, 1)


class _ThenTheRival:
    """A cursor running the rival once its rows have arrived; `sort` and `limit` chain as the driver's do."""

    def __init__(self, cursor: Any, rival: Callable[[], Awaitable[None]]) -> None:
        self._cursor = cursor
        self._rival = rival

    def sort(self, *args: Any, **kwargs: Any) -> _ThenTheRival:
        self._cursor = self._cursor.sort(*args, **kwargs)
        return self

    def limit(self, *args: Any, **kwargs: Any) -> _ThenTheRival:
        self._cursor = self._cursor.limit(*args, **kwargs)
        return self

    async def to_list(self, *args: Any, **kwargs: Any) -> list[Any]:
        rows = await self._cursor.to_list(*args, **kwargs)
        await self._rival()

        return rows


class ThenTheRivalAfterTheFirstSessionRead(InterleavedCollection):
    """A collection running the rival once the pass's first in-transaction read of it has answered."""

    def find(self, *args: Any, **kwargs: Any) -> Any:
        cursor = self._collection.find(*args, **kwargs)
        if kwargs.get("session") is None:
            return cursor

        return _ThenTheRival(cursor, self.run_the_rival)


def a_payload_person(first_name: str, last_name: str, phone: str) -> dict[str, Any]:
    """One person as the contacts editor sends them."""

    return {
        "first_name": first_name,
        "last_name": last_name,
        "email": f"{first_name.lower()}@example.com",
        "phone": phone,
        "einwilligung": {"scope": "kontakt_data", "date": "2126-03-01"},
    }


async def hand_alphas_trainer_to(database: AsyncDatabase, client: AsyncMongoClient, trainer: Mapping[str, Any]) -> None:
    """Through the contacts editor's own save, its other seats kept, so the void the pass meets is the one a real save writes."""

    stored = await database[Collection.SAISON_TEAMS].find_one({"saison_id": SAISON_ID, "team_id": ALPHA})
    assert stored is not None
    kept = {
        seat: a_payload_person(first_name, f"{first_name}-Mustermann", f"+491701000000{position}")
        for position, (seat, first_name) in enumerate(SEATS[ALPHA].items())
    }
    await write_the_block(
        database,
        {**kept, "trainer": trainer, "trainer_is_also": None},
        team_id=ALPHA,
        saison_id=SAISON_ID,
        version=stored["version"],
        today=TODAY,
        germany_now=MAIL_NOW,
    )


class TestASeatHandedOnBesideTheMintIsAskedAsItStandsOnceTheMintCommits:
    """The mint writes the season row it read its mailboxes off, so the handover conflicts with it and it reads again."""

    def test_the_old_trainer_is_mailed_nothing_and_the_new_one_nothing_before_confirming(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def hand_the_trainer_on() -> None:
                await hand_alphas_trainer_to(database, client, a_payload_person("Lea", "Musterfrau", "+4917010000009"))

            interleaved = ThenTheRivalAfterTheFirstSessionRead(database[Collection.SAISON_TEAMS], hand_the_trainer_on)
            answer = await a_pass_through(database, client, kontakt_links=1, saison_teams=cast(Any, interleaved))

            return interleaved, answer

        interleaved, answer = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        # Lea stands unconfirmed, as every person a save newly seats does, so the request goes to the other two seats alone.
        assert sorted(
            recipient.address for request in answer.requests if request.side == "team1" for recipient in request.recipients
        ) == sorted([address(ALPHA, "ansprechperson"), address(ALPHA, "stellvertretung")])
        # A fresh league: the close reads no row, so the mint's read is the first the pass makes.
        interleaved.assert_landed_inside(serially=1)


# Fourteen days out, so the deadline falls a week before the fixture and the reminder inside it.
FORTNIGHT = days_after(day=TODAY, days=14)
DEADLINE = days_after(day=FORTNIGHT, days=-7)
REMINDER = days_after(day=DEADLINE, days=-3)


class TestEachRowIsRemindedOnce:
    """The reminder's stamp is what holds it to one: every later pass before the deadline finds the row reminded."""

    def test_the_reminder_goes_on_its_day_alone(self, mongo_replica_set_url: str):
        """A second reminder on any later day would mail every seat again, where the league owes one reminder."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answers = [await sweep(database, client)]
            answers += [
                await sweep(database, client, today=day)
                for day in (REMINDER, days_after(day=REMINDER, days=1), days_after(day=DEADLINE, days=-1), DEADLINE)
            ]

            return answers, row_of(await rows(database), team_id=ALPHA)

        answers, alpha = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, FORTNIGHT)])

        assert [len(answer.reminders) for answer in answers] == [0, 2, 0, 0, 0]
        alpha_reminder = next(request for request in answers[1].reminders if request.side == "team1")
        assert sorted(recipient.address for recipient in alpha_reminder.recipients) == sorted(address(ALPHA, seat) for seat in KONTAKT_ROLLEN)
        assert alpha["reminded_at"] == REMINDER
        assert alpha["deadline"] == DEADLINE


class TestAClubIsMailedAtItsConfirmedSeats:
    """An address nobody proved is mailed nothing, and one person holding two seats is mailed once."""

    def test_a_person_on_two_seats_gets_one_mail_and_an_unconfirmed_seat_none(self, mongo_replica_set_url: str):
        mirrored = kontakte(
            ALPHA, ansprechperson=seated("Tamsin"), stellvertretung=kontaktperson_document("Stellan"), trainer_is_also="ansprechperson"
        )

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await sweep(database, client)

        answer = on_a_league(
            mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)], junctions=[junction(ALPHA, kontakte=mirrored), junction(BETA)]
        )

        recipients = next(request.recipients for request in answer.requests if request.side == "team1")
        assert [(recipient.address, recipient.rollen) for recipient in recipients] == [(address(ALPHA, "trainer"), ["trainer"])]

    def test_a_club_holding_no_confirmed_seat_is_asked_once_it_holds_one(self, mongo_replica_set_url: str):
        """Minted unasked, the row reads as never asked; stamped then, the club would never hear of the fixture."""

        unconfirmed = {**{seat: kontaktperson_document(first_name) for seat, first_name in SEATS[ALPHA].items()}, "trainer_is_also": None}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await sweep(database, client)
            unasked = row_of(await rows(database), team_id=ALPHA)
            await database[Collection.SAISON_TEAMS].update_one(
                {"team_id": ALPHA, "saison_id": SAISON_ID}, {"$set": {"kontakte.ansprechperson": seated("Anwen")}}
            )
            second = await sweep(database, client)
            third = await sweep(database, client)

            return first, unasked, second, third, row_of(await rows(database), team_id=ALPHA)

        first, unasked, second, third, asked = on_a_league(
            mongo_replica_set_url,
            body,
            spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)],
            junctions=[junction(ALPHA, kontakte=unconfirmed), junction(BETA)],
        )

        assert [request.side for request in first.requests] == ["team2"]
        assert unasked["asked_at"] is None
        assert [(request.spielbestaetigung_id, [recipient.address for recipient in request.recipients]) for request in second.requests] == [
            (unasked["_id"], [address(ALPHA, "ansprechperson")])
        ]
        assert (third.requests, asked["asked_at"]) == ([], TODAY)


class TestTheReminderSkipsARowTheCloseWouldShut:
    """A full close share ahead of it leaves a decided fixture's row standing for one more pass; a reminder to it would be a dead link."""

    def test_a_row_past_the_close_share_is_not_reminded(self, mongo_replica_set_url: str):
        # Due a reminder today, on a fixture already decided: the close reaches it on the pass after.
        date = days_after(day=TODAY, days=10)
        decided = [
            a_spiel(ObjectId(f"6890a1b2c3d4e5f6077{position:05d}"), 10 + position, YESTERDAY, ergebnis="1:0")
            for position in range(CLOSES_PER_PASS)
        ]
        reminded_spiel = a_spiel(SPIEL, 1, date, ergebnis="1:0", team1=side(ALPHA, 1), team2=side(BETA, 0))

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # The rows the mint wrote once these fixtures were still open, on the day each was minted and its mail owed.
            seeded = [
                mailed_row(spiel=spiel, party={"kind": "team", "team_id": ALPHA}, asked_at=days_after(day=TODAY, days=-10))
                for spiel in [*decided, reminded_spiel]
            ]
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many(seeded)
            answer = await sweep(database, client)

            return answer, row_of(await rows(database, spiel_id=SPIEL), team_id=ALPHA)

        answer, standing = on_a_league(mongo_replica_set_url, body, spiele=[*decided, reminded_spiel])

        assert standing["deadline"] == days_after(day=TODAY, days=3)
        assert (answer.closed, standing["closed"]) == (CLOSES_PER_PASS, None)
        assert (answer.reminders, answer.requests, standing["reminded_at"]) == ([], [], None)


class TestOneRowHoldsBackNoOther:
    """A fixture the pass cannot answer is passed over alone, every pass, and its neighbour is asked."""

    def test_a_spiel_fielding_a_club_without_a_season_row(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client, passed_over=1)
            await sweep(database, client, passed_over=1)
            return await rows(database)

        stored = on_a_league(
            mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK, team2=side(GAMMA)), a_spiel(OTHER_SPIEL, 2, NEXT_WEEK)]
        )

        assert {row["spiel_id"] for row in stored} == {OTHER_SPIEL}

    def test_a_referee_no_record_holds(self, mongo_replica_set_url: str):
        """Only a hand edit leaves a row or a booking naming one: the close passes the row over and the mint the fixture.

        The close meets the missing address after it took its share, so only the halving finds the row; the mint meets it
        while judging the fixture.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await database[Collection.SCHIEDSRICHTER].delete_one({"_id": SCHIEDSRICHTER})
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"sonderereignis": "ausgefallen"}})
            await database[Collection.SPIELE].insert_one(a_spiel(FRESH_SPIEL, 3, NEXT_WEEK))
            called_off = await sweep(database, client, passed_over=2)
            await sweep(database, client, passed_over=2)
            return called_off, await rows(database)

        called_off, stored = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert {row["spiel_id"] for row in stored} == {SPIEL}
        assert row_of(stored, schiedsrichter_id=SCHIEDSRICHTER)["closed"] is None
        assert [row_of(stored, team_id=team_id)["closed"]["reason"] for team_id in (ALPHA, BETA)] == ["cancelled", "cancelled"]
        # The clubs' rows closed in the same pass, each club told.
        assert {notice.spielbestaetigung_id for notice in called_off.spiel_cancelled} == {
            row_of(stored, team_id=team_id)["_id"] for team_id in (ALPHA, BETA)
        }
        assert called_off.closed == 2


def numbered_spiele(count: int, date: str, **fields: Any) -> list[dict[str, Any]]:
    """One fixture per position, the referee left off so each fixture's rows are its two sides' alone."""

    return [
        a_spiel(ObjectId(f"6890a1b2c3d4e5f6078{position:05d}"), 100 + position, date, schiedsrichter=None, **fields)
        for position in range(count)
    ]


# One command a row, the update. A fresh row costs less, one insert taking its share's rows; the bound counts it at one.
ROUND_TRIPS_A_ROW = 1

# The worst call's commands beside its rows.
SWEEP_OTHER_COMMANDS = 40


class TestTheWorstCallSendsTheCommandsItsBudgetCounts:
    """Its rows at the per-row cost and the rest as `SWEEP_OTHER_COMMANDS` names them.

    A command added to the call turns this red, so the shares are judged against the deadline again.
    """

    def test_the_sweep(self, mongo_replica_set_url: str):
        """Every step takes rows and every conditional read and write is made.

        A called-off fixture's three rows closed by the close, each owing its notices; a moved fixture's three closed by the
        mint, which asks it afresh telling of the move, and a fresh one minted; a row never asked, asked beside a reminder;
        and a reminder.
        """

        called_off = a_spiel(CALLED_OFF_SPIEL, 4, NEXT_WEEK)
        moved = a_spiel(SPIEL, 1, NEXT_WEEK)
        reminded = a_spiel(OTHER_SPIEL, 2, FORTNIGHT)
        # The day after the pass's, so its clubs, holding no line-up, are owed the line-up's reminder too.
        fresh = a_spiel(FRESH_SPIEL, 3, days_after(day=REMINDER, days=1))

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, Counter[str]]:
            await database[Collection.SPIELE].insert_many([called_off, moved, reminded])
            await sweep(database, client, today=days_after(day=REMINDER, days=-1))
            await database[Collection.SPIELE].update_one({"_id": CALLED_OFF_SPIEL}, {"$set": {"sonderereignis": "ausgefallen"}})
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"time": "19:00:00"}})
            await database[Collection.SPIELBESTAETIGUNGEN].update_one(
                {"spiel_id": OTHER_SPIEL, "party.team_id": ALPHA}, {"$set": {"asked_at": None}}
            )
            await database[Collection.SPIELE].insert_one(fresh)

            return await commands_by_name(
                mongo_replica_set_url,
                DATABASE_NAME,
                lambda database, client: a_pass(
                    database,
                    client,
                    today=REMINDER,
                    now=datetime.fromisoformat(f"{REMINDER}T12:30:00").replace(tzinfo=ZoneInfo("Europe/Berlin")),
                ),
            )

        answer, names = on_a_league(mongo_replica_set_url, body, spiele=[])

        # The close's three rows and the mint's three, the reminded row, the unasked row's stamp.
        patched = answer.closed + answer.reminded + 1
        # Seven call-off notices; twelve requests and two Einteilungen for the two fixtures asked, the moved one's telling of
        # the move; the unasked row's three requests and the reminded row's three reminders; the fresh fixture's two clubs'
        # line-up reminders, three seats each.
        assert (answer.closed, answer.asked, answer.reminded, answer.mails) == (6, 7, 1, 7 + 14 + 3 + 3 + 6)
        assert sum(names.values()) - ROUND_TRIPS_A_ROW * patched == SWEEP_OTHER_COMMANDS, names


class TestARefereeErasedBesideTheMintIsToldNothing:
    """The erasure deletes the referee's rows its snapshot holds, and the mint's is not yet one."""

    def test_the_mint_runs_again_and_writes_the_erased_referee_no_row(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def erase_the_referee() -> None:
                await erased(database, client, REFEREE_EMAIL, germany_now=NOW)

            interleaved = ThenTheRivalAfterTheFirstSessionRead(database[Collection.SCHIEDSRICHTER], erase_the_referee)
            answer = await a_pass_through(database, client, schiedsrichter=cast(Any, interleaved))

            erased_since = await database[Collection.SCHIEDSRICHTER].count_documents({"_id": SCHIEDSRICHTER}) == 0
            return interleaved, erased_since, answer, await rows(database)

        interleaved, erased_since, answer, stored = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        # The premise: the erasure committed under the mint's read, the first a fresh league's pass makes of the referees;
        # the mint run again reads none, the fixture still to come now booking nobody.
        assert (interleaved.passes, erased_since) == (1, True)
        assert answer.einteilungen == []
        assert [row["party"]["kind"] for row in stored] == ["team", "team"]


class TestAnErasedContactIsNotToldTheirSpielMoved:
    """The erasure writes the season row the close read its mailboxes off, and nothing of the confirmation it closes."""

    def _told(self, url: str, interleaving: Callable[[Any, Callable[[], Awaitable[None]]], Any], serially: int) -> set[str]:
        """The addresses the move's notice went to, the trainer erased at the pass's read `interleaving` names."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            # Onto today, so the close tells of the move: nobody is asked about a match on its own day.
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"date": TODAY}})

            async def erase_the_trainer() -> None:
                await erased(database, client, address(ALPHA, "trainer"), germany_now=NOW)

            interleaved = interleaving(database[Collection.SAISON_TEAMS], erase_the_trainer)
            answer = await a_pass_through(database, client, saison_teams=cast(Any, interleaved))

            return interleaved, answer

        interleaved, answer = on_a_league(url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        interleaved.assert_landed_inside(serially=serially)
        told = {recipient.address for notice in answer.new_ansetzungen for recipient in notice.recipient}
        # The premise: ALPHA's row was closed and its notice went to its other seats.
        assert address(ALPHA, "ansprechperson") in told
        return told

    def test_the_close_runs_again_and_leaves_the_erased_trainer_out(self, mongo_replica_set_url: str):
        """The erasure lands inside the close, after its read of the season rows: only the close's anchor conflicts with it."""

        assert address(ALPHA, "trainer") not in self._told(mongo_replica_set_url, ThenTheRivalAfterTheFirstSessionRead, serially=1)


# Eight and ten days out: each row's deadline is one of today's reminder days.
ON_REMINDER_DAYS = [a_spiel(SPIEL, 1, days_after(day=TODAY, days=8)), a_spiel(OTHER_SPIEL, 2, days_after(day=TODAY, days=10))]


class TestARowMintedOnAReminderDayIsRemindedOfNothingThatDay:
    def test_its_request_is_the_days_one_message_on_its_pass_and_after_its_stamp(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await sweep(database, client)
            later = await sweep(database, client)

            return minted, later, await rows(database, **{"party.kind": "team"})

        minted, later, stored = on_a_league(mongo_replica_set_url, body, spiele=ON_REMINDER_DAYS)

        # The premise: both fixtures' deadlines fall on today's reminders, and every side was asked.
        assert sorted({str(row["deadline"]) for row in stored}) == sorted({days_after(day=TODAY, days=1), days_after(day=TODAY, days=3)})
        assert (len(minted.requests), minted.reminders) == (4, [])
        assert (later.requests, later.reminders) == ([], [])


# --- The LINE-UP REMINDER: owed from 48 hours before kick-off up to the due mark, 24 hours before it.

# Ahead of the real clock, as every drained case's is (`tests/outbox.py :: MAIL_NOW`): the drain claims nothing the
# outbox's retention may already have erased.
LINEUP_TODAY = "2126-04-15"
LINEUP_NOW = datetime(2126, 4, 15, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
# Twenty-nine and a half hours out, inside the window; fifty-three and a half, before it; twenty-three and a half, past
# the due mark.
IN_THE_WINDOW = a_spiel(SPIEL, 1, "2126-04-16", time="18:00:00")
BEFORE_THE_WINDOW = a_spiel(OTHER_SPIEL, 2, "2126-04-17", time="18:00:00", schiedsrichter=None)
PAST_THE_DUE_MARK = a_spiel(FRESH_SPIEL, 3, "2126-04-16", time="12:00:00", schiedsrichter=None)


class TestTheLineupReminder:
    """Owed to a club holding no line-up, once: no line-up document exists to stamp, so the mail's keys are the record."""

    def test_the_club_without_a_line_up_is_reminded_once_inside_the_window_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.AUFSTELLUNGEN].insert_one(documents.aufstellung_document(IN_THE_WINDOW, ALPHA, starters=[ObjectId()]))
            first = await handed_out(database, client, await a_pass(database, client, today=LINEUP_TODAY, now=LINEUP_NOW), now=LINEUP_NOW)
            later = await handed_out(database, client, await a_pass(database, client, today=LINEUP_TODAY, now=LINEUP_NOW), now=LINEUP_NOW)

            return first, later

        first, later = on_a_league(mongo_replica_set_url, body, spiele=[IN_THE_WINDOW, BEFORE_THE_WINDOW, PAST_THE_DUE_MARK])

        # Beta's every confirmed seat, Alpha having stored its line-up; due twenty-four hours before kick-off.
        assert sorted((reminder.spiel_id, reminder.team, reminder.address) for reminder in first.aufstellungen) == sorted(
            (str(SPIEL), "Beta", address(BETA, seat)) for seat in KONTAKT_ROLLEN
        )
        assert {reminder.due_at for reminder in first.aufstellungen} == {datetime(2126, 4, 15, 16, 0, tzinfo=UTC)}
        assert later.aufstellungen == []

    def test_a_club_whose_line_up_an_erasure_emptied_is_reminded(self, mongo_replica_set_url: str):
        """Ahead of kick-off an erased pupil's entry goes, and the club picks anew: a line-up holding nobody stands as none."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.AUFSTELLUNGEN].insert_one(documents.aufstellung_document(IN_THE_WINDOW, ALPHA))
            return await handed_out(database, client, await a_pass(database, client, today=LINEUP_TODAY, now=LINEUP_NOW), now=LINEUP_NOW)

        reminded = on_a_league(mongo_replica_set_url, body, spiele=[IN_THE_WINDOW])

        assert {reminder.team for reminder in reminded.aufstellungen} == {"Alpha", "Beta"}

    def test_a_fixture_a_clubs_austritt_decided_reminds_neither_club(self, mongo_replica_set_url: str):
        """Alpha leaves before the day, so the match is not played: Beta would be asked for a line-up nobody fields against."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await handed_out(database, client, await a_pass(database, client, today=LINEUP_TODAY, now=LINEUP_NOW), now=LINEUP_NOW)

        out = junction(ALPHA, austritt={"type": "rueckzug", "reason": "Schulwechsel", "date": LINEUP_TODAY})
        reminded = on_a_league(mongo_replica_set_url, body, spiele=[IN_THE_WINDOW], junctions=[out, junction(BETA)])

        assert reminded.aufstellungen == []

    def test_a_reminder_owed_to_a_seat_handed_on_before_its_hand_out_is_dropped(self, mongo_replica_set_url: str):
        """The reminder names its club, so the hand-out judges the seat as it stands: sent, it asks a former Trainer for a line-up."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answer = await a_pass(database, client, today=LINEUP_TODAY, now=LINEUP_NOW)
            await database[Collection.SAISON_TEAMS].update_one(
                {"saison_id": SAISON_ID, "team_id": BETA}, {"$set": {"kontakte.trainer": seated("Nachfolge")}}
            )
            return await handed_out(database, client, answer, now=LINEUP_NOW)

        reminded = on_a_league(mongo_replica_set_url, body, spiele=[IN_THE_WINDOW])

        assert sorted(reminder.address for reminder in reminded.aufstellungen if reminder.team == "Beta") == sorted(
            address(BETA, seat) for seat in KONTAKT_ROLLEN if seat != "trainer"
        )

    def test_a_reminder_still_owed_at_the_due_mark_is_never_sent(self, mongo_replica_set_url: str):
        """A drain running behind would otherwise ask for the line-up by a moment already gone by."""

        past_the_due_mark = datetime(2126, 4, 15, 18, 30, tzinfo=ZoneInfo("Europe/Berlin"))

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answer = await a_pass(database, client, today=LINEUP_TODAY, now=LINEUP_NOW)
            owed = await database[Collection.OUTBOX].count_documents({"kind": "aufstellung_reminder"})
            return owed, await handed_out(database, client, answer, now=past_the_due_mark)

        owed, late = on_a_league(mongo_replica_set_url, body, spiele=[IN_THE_WINDOW])

        # The premise: both clubs' every confirmed seat was owed one.
        assert owed == 2 * len(KONTAKT_ROLLEN)
        assert late.aufstellungen == []


# --- A REFEREE TAKEN OFF a fixture after their Einteilung went out.


async def told_and_taken_off(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    """The first pass asks the referee, and the fixture is handed to another referee."""

    await sweep(database, client)
    await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"schiedsrichter": booked(OTHER_SCHIEDSRICHTER)}})


class ConfirmationsRunningARivalAheadOfTheErasuresRemoval(InterleavedCollection):
    """The confirmations a referee's erasure removes by its filter, a rival run once inside its transaction, ahead of that removal."""

    async def delete_many(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.delete_many(*args, **kwargs)


class TestATakenOffRefereesErasureAndTheCloseCross:
    """The close and the notice step each write the very row the erasure removes, so the two conflict and one runs again."""

    def test_an_erasure_landing_inside_the_notice_step_leaves_nobody_told(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await told_and_taken_off(database, client)

            async def erase_the_referee() -> None:
                await erased(database, client, REFEREE_EMAIL, germany_now=NOW)

            interleaved = ThenTheRivalAfterTheFirstSessionRead(database[Collection.SCHIEDSRICHTER], erase_the_referee)
            answer = await a_pass_through(database, client, schiedsrichter=cast(Any, interleaved))

            return interleaved, answer, await rows(database, **{"party.kind": "schiedsrichter"})

        interleaved, answer, stored = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        # The close reads no referee, so the first read is the notice step's. Serially the erased referee's row is gone
        # before it reads any address, and the mint reads the newly booked referee once.
        interleaved.assert_landed_inside(serially=1)
        assert answer.schiedsrichter_switched == []
        assert [row["party"]["schiedsrichter_id"] for row in stored] == [OTHER_SCHIEDSRICHTER]

    def test_a_close_landing_inside_the_erasure_leaves_no_row_of_theirs(self, mongo_replica_set_url: str):
        """The close commits first and its notice stands, the order being close then erasure; the row it closed goes with them."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await told_and_taken_off(database, client)
            answers: list[Any] = []

            async def a_pass() -> None:
                answers.append(await sweep(database, client))

            interleaved = ConfirmationsRunningARivalAheadOfTheErasuresRemoval(database[Collection.SPIELBESTAETIGUNGEN], a_pass)
            await erased(database, client, REFEREE_EMAIL, germany_now=NOW, spielbestaetigungen_collection=interleaved)

            return interleaved, answers, await rows(database, **{"party.schiedsrichter_id": SCHIEDSRICHTER})

        interleaved, (answer,), stored = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        # Serially the erasure removes its rows once; the second arrival is its run again, the removal having conflicted with
        # the close's write on the row.
        interleaved.assert_landed_inside(serially=1)
        assert [notice.address for notice in answer.schiedsrichter_switched] == [REFEREE_EMAIL]
        assert stored == []


async def as_the_referee(database: AsyncDatabase, client: AsyncMongoClient, answer: Any, reason: str | None = None) -> None:
    """The booked referee, their record confirmed, answering their one row on their own panel."""

    await database[Collection.SCHIEDSRICHTER].update_one(
        {"_id": SCHIEDSRICHTER},
        {
            "$set": {
                "einwilligung": documents.own_einwilligung_document(
                    text_versions=documents.SCHIEDSRICHTER_TEXT_VERSIONS, confirmed_at=YESTERDAY
                )
            }
        },
    )
    (own,) = await rows(database, **{"party.schiedsrichter_id": SCHIEDSRICHTER})
    await post_schiedsrichter_answer(
        spielbestaetigung_id=own["_id"],
        answer_data=FLSpielbestaetigungSchiedsrichterAnswerPayload(answer=answer, reason=reason),
        identifier=REFEREE_EMAIL,
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spiele_collection=database[Collection.SPIELE],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        records=record_collections(database),
        db=client,
        now=NOW,
    )


class TestARefereeWhoAcceptedIsToldTheyWereTakenOff:
    """The rule reaches an answered row: the close shuts it answered or not, and the notice follows."""

    def test_their_acceptance_is_no_reason_to_tell_them_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await as_the_referee(database, client, "agreed")
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"schiedsrichter": booked(OTHER_SCHIEDSRICHTER)}})
            return await sweep(database, client)

        second = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert [notice.address for notice in second.schiedsrichter_switched] == [REFEREE_EMAIL]


class TestAMoveIsAnnouncedWhileEitherDayIsToCome:
    """Its parties asked about `NEXT_WEEK`, the fixture moved before any pass closed their rows."""

    @pytest.mark.parametrize(
        ("today", "moved_to"),
        [pytest.param(days_after(day=NEXT_WEEK, days=1), TODAY, id="from one day gone by to another")],
    )
    def test_the_pass_closing_it(self, mongo_replica_set_url: str, today: str, moved_to: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"date": moved_to}})
            return await sweep(database, client, today=today), await rows(database, closed={"$ne": None})

        late, closed = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert {row["closed"]["reason"] for row in closed} == {"ansetzung_changed"}
        # Told by the notice, or by the request about a new slot asked at once.
        clubs = len(late.new_ansetzungen) + len([request for request in late.requests if request.moved_from is not None])
        referees = len(late.schiedsrichter_new_ansetzungen) + len([e for e in late.einteilungen if e.moved_from is not None])
        assert (clubs, referees) == (0, 0)


class TestAnAddressMovedBesideTheNoticeIsTheOneTold:
    """The notice step writes each referee whose address it read, so an address change crossing it conflicts and it reads again."""

    def test_the_notice_goes_to_the_address_the_referee_holds_once_it_commits(self, mongo_replica_set_url: str):
        moved_to = "neue-pfeife@example.com"

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await told_and_taken_off(database, client)

            async def move_the_address() -> None:
                await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER}, {"$set": {"kontakt.email": moved_to}})

            interleaved = ThenTheRivalAfterTheFirstSessionRead(database[Collection.SCHIEDSRICHTER], move_the_address)
            return interleaved, await a_pass_through(database, client, schiedsrichter=cast(Any, interleaved))

        interleaved, answer = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        # Serially the notice step and the mint each read the referees once.
        interleaved.assert_landed_inside(serially=2)
        assert [notice.address for notice in answer.schiedsrichter_switched] == [moved_to]


# --- A FIXTURE CALLED OFF after its parties were asked.


async def asked_and_called_off(
    database: AsyncDatabase, client: AsyncMongoClient, *, stamped: bool = True, sonderereignis: str = "ausgefallen"
) -> Any:
    """The first pass asks both clubs and the referee, its requests owed or, unstamped, never, and the fixture is called off."""

    first = await sweep(database, client)
    if not stamped:
        await unstamp(database)
    await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"sonderereignis": sonderereignis}})

    return first


class TestACalledOffSpielTellsEveryPartyItAsked:
    def test_both_clubs_and_the_referee_are_told_whatever_each_answered(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await sweep(database, client)
            # One club agreed before the call-off, which tells it no less.
            await press_answer(
                database, client, next(request for request in first.requests if request.side == "team1").spielbestaetigung_id, ALPHA
            )
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"sonderereignis": "ausgefallen"}})
            return await sweep(database, client)

        second = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert second.closed == 3
        assert sorted(recipient.address for notice in second.spiel_cancelled for recipient in notice.recipient) == sorted(
            address(team_id, seat) for team_id in (ALPHA, BETA) for seat in KONTAKT_ROLLEN
        )
        assert [notice.address for notice in second.schiedsrichter_spiel_cancelled] == [REFEREE_EMAIL]
        # Each names the event its mail is worded by.
        told = [*second.spiel_cancelled, *second.schiedsrichter_spiel_cancelled]
        assert {(notice.old.date, notice.old.time, notice.sonderereignis) for notice in told} == {(NEXT_WEEK, "18:00:00", "ausgefallen")}

    def test_a_no_show_entered_before_the_day_tells_every_party_once(self, mongo_replica_set_url: str):
        """Nobody is due at the ground, though the no-show decides the fixture: the closing owes every party its notice."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await asked_and_called_off(database, client, sonderereignis="nichtantreten_team1")
            return await sweep(database, client), await sweep(database, client), await rows(database)

        second, third, stored = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert {row["closed"]["reason"] for row in stored} == {"cancelled"}
        assert sorted(recipient.address for notice in second.spiel_cancelled for recipient in notice.recipient) == sorted(
            address(team_id, seat) for team_id in (ALPHA, BETA) for seat in KONTAKT_ROLLEN
        )
        assert [notice.address for notice in second.schiedsrichter_spiel_cancelled] == [REFEREE_EMAIL]
        # Named, so no mail promises a new request about a match the no-show decided.
        assert {notice.sonderereignis for notice in [*second.spiel_cancelled, *second.schiedsrichter_spiel_cancelled]} == {
            "nichtantreten_team1"
        }
        assert (third.spiel_cancelled, third.schiedsrichter_spiel_cancelled) == ([], [])

    def test_a_party_never_mailed_is_told_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await asked_and_called_off(database, client, stamped=False)
            return await sweep(database, client)

        second = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        # The premise: every row closed for the call-off all the same.
        assert (second.closed, second.spiel_cancelled, second.schiedsrichter_spiel_cancelled) == (3, [], [])


# --- A SAVE MOVING A FIXTURE beside a step of the pass. No referee is booked, whom both would write, so the fixture is the
# one document the two share.

# Inside the window, so a party asked already is asked about it at once.
LATER = days_after(day=TODAY, days=10)


class ThenTheRivalAfterTheNthJoinedRead(InterleavedCollection):
    """The fixtures, running the rival once the pass's `nth` read of them through the name join has answered.

    Every step reads them so, its first read of them; the steps ahead of the one a case is about are counted off.
    """

    def __init__(self, collection: Any, rival: Rival, *, nth: int) -> None:
        super().__init__(collection, rival, after="aggregate")
        self._nth = nth

    async def run_the_rival(self) -> None:
        self.passes += 1
        if self.passes == self._nth and self._rival is not None:
            rival, self._rival = self._rival, None
            await rival()


class TestASaveLandingInsideAStepLeavesNoMailAboutTheSlotTheFixtureLeft:
    """Each step writes the fixtures it acts on, as the save writes the fixture, so the two conflict and the step reads again."""

    def test_the_close(self, mongo_replica_set_url: str):
        """Moved onto today, the close tells of the move; moved on again under it, the mint asks about the new slot instead."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await move(database, client, SPIEL, date=TODAY)

            async def move_on() -> None:
                await move(database, client, SPIEL, date=LATER)

            # The close's read of the fixtures is the pass's first.
            interleaved = ThenTheRivalAfterTheNthJoinedRead(database[Collection.SPIELE], move_on, nth=1)
            return await a_pass_through(database, client, spiele=cast(Any, interleaved))

        passed = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK, schiedsrichter=None)])

        assert passed.new_ansetzungen == []
        assert sorted((request.ansetzung.date, (request.moved_from or {}).get("date")) for request in passed.requests) == [
            (LATER, NEXT_WEEK),
            (LATER, NEXT_WEEK),
        ]

    def test_the_mint(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def move_on() -> None:
                await move(database, client, SPIEL, date=LATER)

            # A fresh league: the close reads no row and so no fixture, and the mint's read of the window is the first.
            interleaved = ThenTheRivalAfterTheNthJoinedRead(database[Collection.SPIELE], move_on, nth=1)
            return await a_pass_through(database, client, spiele=cast(Any, interleaved)), await rows(database)

        passed, stored = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK, schiedsrichter=None)])

        assert [request.ansetzung.date for request in passed.requests] == [LATER, LATER]
        assert [row["ansetzung"]["date"] for row in stored] == [LATER, LATER]

    def test_the_reminder(self, mongo_replica_set_url: str):
        """A reminder of a slot the fixture left asks the club to confirm a match nobody plays then."""

        later = days_after(day=FORTNIGHT, days=1)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)

            async def move_on() -> None:
                await move(database, client, SPIEL, date=later)

            # The close's read of the fixtures and the mint's come first, the reminder's third.
            interleaved = ThenTheRivalAfterTheNthJoinedRead(database[Collection.SPIELE], move_on, nth=3)
            answer = await a_pass(database, client, today=REMINDER, spiele=cast(Any, interleaved))
            return await handed_out(database, client, answer, now=clock_of(REMINDER)), await rows(database), interleaved.passes

        passed, stored, reads = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, FORTNIGHT, schiedsrichter=None)])

        # The premise: the move landed in the reminder, whose read ran again after the conflict, the line-up step's last.
        # Landed in the mint, which writes nothing about a fixture asked already, nothing runs again and the pass reads four.
        assert reads == 5
        assert passed.requests == []
        assert passed.reminders == []
        assert [row["reminded_at"] for row in stored] == [None, None]

    def test_the_lineup_reminder(self, mongo_replica_set_url: str):
        """Sent, it asks for a line-up by a mark the fixture left, and its keys then hold back the one the new day owes."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def move_on() -> None:
                # Fifty-three and a half hours out, before the window.
                await move(database, client, SPIEL, date="2126-04-17")

            # The line-up step alone reads the line-ups, after its read of the fixtures.
            interleaved = ThenTheRivalAfterTheFirstSessionRead(database[Collection.AUFSTELLUNGEN], move_on)
            answer = await a_pass(database, client, today=LINEUP_TODAY, now=LINEUP_NOW, aufstellungen=cast(Any, interleaved))
            return await handed_out(database, client, answer, now=LINEUP_NOW)

        reminded = on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, "2126-04-16", schiedsrichter=None)])

        assert reminded.aufstellungen == []


class TestAPassLandingInsideASaveLeavesItsFormSaving:
    """The pass's write to the fixture moves no `version`, and the save's own write still meets it."""

    def test_the_save_runs_again_on_the_version_its_form_read_and_commits(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answers: list[FLSpielbestaetigungSweepResponse] = []

            async def a_pass_beside() -> None:
                answers.append(await a_pass(database, client))

            # The save's first read of the fixtures: its payload carries the version the form read before the pass.
            interleaved = ThenTheRivalAfterTheFirstSessionRead(database[Collection.SPIELE], a_pass_beside)
            outcome = await outcome_of(move(database, client, SPIEL, spiele=cast(Any, interleaved), date=LATER))
            stored = await database[Collection.SPIELE].find_one({"_id": SPIEL})

            return interleaved, outcome, stored, await handed_out(database, client, answers[0], now=NOW)

        interleaved, outcome, stored, passed = on_a_league(
            mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK, schiedsrichter=None)]
        )

        # The premise: the pass acted on the fixture, asking both clubs about the slot it held as the pass ran.
        assert [request.ansetzung.date for request in passed.requests] == [NEXT_WEEK, NEXT_WEEK]
        # Serially the save reads the fixtures three times in its transaction; a fourth is its run again.
        interleaved.assert_landed_inside(serially=3)
        assert outcome == COMMITTED
        # The save's own raise alone.
        assert stored is not None
        assert (stored["date"], stored["version"]) == (LATER, 1)
