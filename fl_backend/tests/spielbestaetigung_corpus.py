"""
TESTS · a league whose fixtures the confirmation pass asks about, and the pass run by its route's own function

A running season and a past one, two clubs, a ground and two referees. Each suite seeds it on a database of its own.
"""

import dataclasses
from collections.abc import Mapping
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungAppointment,
    FLSpielbestaetigungSweepResponse,
)
from app.api.spielbestaetigungen.services import (
    side_of,
)
from app.api.spielbestaetigungen.system_router import (
    sweep_spielbestaetigungen,
)
from app.core.collections import Collection
from tests import documents
from tests.documents import kontaktperson_document
from tests.outbox import drained

SAISON_ID = "2026"
PAST_SAISON_ID = "2025"
# A century ahead of the real clock, every seeded day with it: the TTL monitor deletes a row whose delete date has passed,
# under a case reading it back.
TODAY = "2126-04-01"
NOW = datetime(2126, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))


def clock_of(day: str) -> datetime:
    """A pass's instant on `day`, at `NOW`'s hour: the close judges every kick-off by it, and its mails are owed and drained at it."""

    return datetime.combine(date.fromisoformat(day), NOW.timetz())


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


async def the_league(database: AsyncDatabase, *, spiele: list[dict[str, Any]], junctions: list[dict[str, Any]] | None = None) -> None:
    """A running season and a past one, two clubs, a ground and two referees, and `spiele` on them."""

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


async def rows(database: AsyncDatabase, **db_filter: Any) -> list[Mapping[str, Any]]:
    return await database[Collection.SPIELBESTAETIGUNGEN].find(db_filter).sort("_id", 1).to_list(length=None)
