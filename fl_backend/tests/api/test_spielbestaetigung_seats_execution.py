"""
API · every write moving a season seat's holder voids that seat's links on its team's match confirmations, at the write

Each writer of an existing season row's seats is driven against the shipped validators, and straight after it commits,
with no sweep run, each link is opened through the link's own view (`app/api/spielbestaetigungen/public_router.py ::
get_spielbestaetigung_ansicht`): a link it refuses with `link_ungueltig` is voided. A contact's erasure and their
Widerspruch also take every reason they typed, matched on the holder each answer stored.
"""

from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.public_router import post_einwilligung
from app.api.bewerbungen.schemas import FLBewerbungEinwilligungDeclined
from app.api.bewerbungen.system_router import sweep_saison
from app.api.identitaet.services import build_loeschung_seat_pipeline
from app.api.identitaet.wiederherstellung import Read, Window, replay_line
from app.api.kontakte.crud import loeschen_kontaktperson_in_session
from app.api.spielbestaetigungen.public_router import get_spielbestaetigung_view
from app.api.teams.admin_router import patch_saison_team_kontakte, replace_saison_team
from app.api.teams.schemas import FLPatchSaisonTeamKontaktePayload, FLReplaceSaisonTeamPayload, kontakte_stand_of
from app.api.teams.services import compose_kontakt_bestaetigung
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, delete_many_from_db, patch_one_in_db
from app.core.exceptions import APIError
from app.core.journal import JournalLine
from app.core.security import loeschung_journal_hash
from app.core.transactions import transaction_session
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from app.shared.schemas.bestaetigung import FLTokenPayload
from app.shared.schemas.literals import KONTAKT_ROLLEN
from app.shared.tokens import hash_token
from tests import documents
from tests.actor_tokens import fresh_admin_actor
from tests.bans import ban_list
from tests.config import build_test_config, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.postausgang import MAIL_NOW
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spielbestaetigung_seats_test")
CONFIG = build_test_config()

SAISON_ID = "2026"
LATER_SAISON_ID = "2027"
TODAY = "2026-04-01"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
AM = "2026-04-01T10:30:00+00:00"

TEAM_OID = ObjectId("6890a1b2c3d4e5f607b60001")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607b60002")
INCOMING_TEAM_OID = ObjectId("6890a1b2c3d4e5f607b60003")
ROW_OID = ObjectId("6890a1b2c3d4e5f607b60011")
OTHER_ROW_OID = ObjectId("6890a1b2c3d4e5f607b60012")
SPIEL_OID = ObjectId("6890a1b2c3d4e5f607b60021")
ANSWERED_SPIEL_OID = ObjectId("6890a1b2c3d4e5f607b60022")
REASON_SPIEL_OIDS = [ObjectId(f"6890a1b2c3d4e5f607b6003{position}") for position in range(5)]
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f607b60041")

FORM_LABEL = LAUFENDE_FASSUNGEN["bewerbung"]
SEAT_PAGE = LAUFENDE_FASSUNGEN["bestaetigung_kontakt_saison"]

TELEFON = {"Ida": "+4917010000001", "Jonas": "+4917010000002", "Klara": "+4917010000003", "Lea": "+4917010000004"}


def person(vorname: str, *, email: str | None = None) -> dict[str, Any]:
    """One person as the contacts editor sends them."""

    return {
        "vorname": vorname,
        "nachname": "Musterfrau",
        "email": email or f"{vorname.lower()}@example.com",
        "telefon": TELEFON[vorname],
        "einwilligung": {"umfang": "kontaktdaten", "text_version": FORM_LABEL, "datum": "2026-03-01"},
    }


def stored(vorname: str) -> dict[str, Any]:
    """The same person as the row holds them, entered by the league and unconfirmed."""

    sent = person(vorname)

    return documents.kontaktperson_document(
        vorname,
        einwilligung={"text_version": sent["einwilligung"]["text_version"], "datum": sent["einwilligung"]["datum"]},
        entered_by="liga",
        nachname=sent["nachname"],
        email=sent["email"],
        telefon=sent["telefon"],
    )


SEATED = {"trainer": "Ida", "ansprechperson": "Jonas", "stellvertretung": "Klara"}
STORED = {**{seat: stored(name) for seat, name in SEATED.items()}, "trainer_is_also": None}
SENT = {**{seat: person(name) for seat, name in SEATED.items()}, "trainer_is_also": None}


def row_link(seat: str) -> str:
    """The raw token of the season row's own link for this seat, which a Widerspruch presses."""

    return f"season-row-{seat}"


def link(row: str, seat: str) -> str:
    """The raw token a seat was mailed for one confirmation row."""

    return f"{row}-{seat}"


def fixture(spiel_id: ObjectId, *, saison_id: str = SAISON_ID, spiel_nr: int = 1) -> dict[str, Any]:
    """This team at home to the other, as the league's schedule holds it."""

    sides = {
        f"team{position}": {"team_id": team_id, "name": name, "shorthand": shorthand, "tore": None}
        for position, (team_id, name, shorthand) in enumerate(((TEAM_OID, "Adler", "ADX"), (OTHER_TEAM_OID, "Falken", "FAX")), start=1)
    }

    return documents.spiel_document(
        spiel_id=spiel_id, saison_id=saison_id, spiel_nr=spiel_nr, spieltag_id=SPIELTAG_OID, datum="2026-04-18", uhrzeit="14:00:00", **sides
    )


FIXTURES = [
    fixture(spiel_id, spiel_nr=position) for position, spiel_id in enumerate([SPIEL_OID, ANSWERED_SPIEL_OID, *REASON_SPIEL_OIDS], start=1)
]


def confirmation_row(row: str, team_id: ObjectId, spiel: Mapping[str, Any], **fields: Any) -> dict[str, Any]:
    """One team's mailed row about `spiel`, each seat holding the link it was mailed."""

    return documents.spielbestaetigung_document(
        spiel,
        party={"art": "team", "team_id": team_id},
        frist="2026-04-11",
        asked_at=TODAY,
        kontakte={seat: {"token_hashes": [hash_token(link(row, seat))], "delivery": None} for seat in KONTAKT_ROLLEN},
        **fields,
    )


# The team's open row, its answered row, and the other team's open row about the same fixture.
ROWS = {
    "open": confirmation_row("open", TEAM_OID, FIXTURES[0]),
    "answered": confirmation_row(
        "answered",
        TEAM_OID,
        FIXTURES[1],
        antwort={"art": "zugesagt", "am": TODAY, "von": {"art": "kontakt", "rolle": "trainer"}, "vorschlag": None, "begruendung": None},
    ),
    "other": confirmation_row("other", OTHER_TEAM_OID, FIXTURES[0]),
}

Write = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Write, *, saison_status: str = "active") -> Any:
    """The season, three clubs, this team's row holding `STORED` and its own links, and `ROWS`."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, saison_status))
            # The season after, ended, which is what lets the sweep clear this one's blocks.
            await database[Collection.SAISONS].insert_one(documents.saison_document(LATER_SAISON_ID, "past"))
            for team_id, name, shorthand in (
                (TEAM_OID, "Adler", "ADX"),
                (OTHER_TEAM_OID, "Falken", "FAX"),
                (INCOMING_TEAM_OID, "Eulen", "EUX"),
            ):
                await database[Collection.TEAMS].insert_one(
                    documents.team_document(team_id, name, shorthand, website_url=None, schulform="gymnasium_g9")
                )
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    {
                        "_id": ROW_OID,
                        **documents.saison_team_document(
                            SAISON_ID,
                            TEAM_OID,
                            "Adler",
                            "ADX",
                            kontakte=STORED,
                            confirmations={
                                seat: {**compose_kontakt_bestaetigung(today=TODAY), "token_hashes": [hash_token(row_link(seat))]}
                                for seat in KONTAKT_ROLLEN
                            },
                        ),
                    },
                    {"_id": OTHER_ROW_OID, **documents.saison_team_document(SAISON_ID, OTHER_TEAM_OID, "Falken", "FAX", kontakte=None)},
                ]
            )
            await database[Collection.SPIELE].insert_many([dict(spiel) for spiel in FIXTURES])
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many([dict(row) for row in ROWS.values()])

            await body(database, client)

            logged = await database[Collection.AKTIONEN].count_documents({"collection": str(Collection.SPIELBESTAETIGUNGEN)})

            return await links_answering(database), await answers(database), logged

    return on_the_seed_loop(_run())


async def links_answering(database: AsyncDatabase) -> dict[str, set[str]]:
    """Per row, the seats whose mailed link the link's view still opens; a seat absent here is refused `link_invalid`."""

    answering: dict[str, set[str]] = {}
    for row in ROWS:
        answering[row] = set()
        for seat in KONTAKT_ROLLEN:
            try:
                await get_spielbestaetigung_view(
                    ansicht_data=FLTokenPayload(token=link(row, seat)),
                    spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
                    spiele_collection=database[Collection.SPIELE],
                    saison_teams_collection=database[Collection.SAISON_TEAMS],
                    spielorte_collection=database[Collection.SPIELORTE],
                    teams_collection=database[Collection.TEAMS],
                    sperrliste=ban_list(database),
                    today=TODAY,
                )
            except APIError as refused:
                assert refused.error_code == "link_invalid"
                continue
            answering[row].add(seat)

    return answering


async def answers(database: AsyncDatabase) -> list[Any]:
    return [row.get("antwort") async for row in database[Collection.SPIELBESTAETIGUNGEN].find({}, sort=[("_id", 1)])]


async def save(database: AsyncDatabase, client: AsyncMongoClient, kontakte: Mapping[str, Any]) -> Any:
    return await patch_saison_team_kontakte(
        team_id=TEAM_OID,
        saison_id=SAISON_ID,
        kontakte_data=FLPatchSaisonTeamKontaktePayload.model_validate(
            {"kontakte": dict(kontakte), "kontakte_stand": kontakte_stand_of(STORED)}
        ),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        postausgang_collection=database[Collection.POSTAUSGANG],
        sperrliste=ban_list(database),
        db=client,
        actor=fresh_admin_actor(),
        today=TODAY,
        germany_now=MAIL_NOW,
    )


async def hand_the_trainer_on(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    return await save(database, client, {**SENT, "trainer": person("Lea")})


async def empty_the_trainer(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    return await save(database, client, {**SENT, "trainer": None})


async def replace_the_club(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    return await replace_saison_team(
        team_id=TEAM_OID,
        saison_id=SAISON_ID,
        replacement_data=FLReplaceSaisonTeamPayload(incoming_team_id=INCOMING_TEAM_OID),
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        aktionen_collection=database[Collection.AKTIONEN],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        db=client,
        today=TODAY,
        germany_now=NOW,
    )


async def loeschen_the_trainer(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    """The erasure registry's seat member, given the rows the person erasure reads for it."""

    identifier = "ida@example.com"

    async def in_session(session: Any) -> Any:
        rows = await aggregate_many_from_db(
            collection=database[Collection.SAISON_TEAMS], pipeline=build_loeschung_seat_pipeline(identifier), session=session
        )
        return await loeschen_kontaktperson_in_session(
            saison_teams_collection=database[Collection.SAISON_TEAMS],
            bewerbungen_collection=database[Collection.BEWERBUNGEN],
            aktionen_collection=database[Collection.AKTIONEN],
            spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
            identifier=identifier,
            key=CONFIG.sperrliste_schluessel,
            saison_team_rows=rows,
            bewerbung_rows=[],
            stamp=AM,
            session=session,
        )

    async with transaction_session(client) as session:
        return await session.with_transaction(in_session)


async def clear_the_blocks(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    """The application sweep's contact-block clock, over a season whose following one has ended."""

    return await sweep_saison(
        saison_id=SAISON_ID,
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        aktionen_collection=database[Collection.AKTIONEN],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
        postausgang_collection=database[Collection.POSTAUSGANG],
        db=client,
        today=TODAY,
        germany_now=NOW,
    )


async def contradict(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    """The Trainer's Widerspruch through the season row's own link."""

    return await post_einwilligung(
        antwort_data=FLBewerbungEinwilligungDeclined(token=row_link("trainer"), antwort="declined"),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        aktionen_collection=database[Collection.AKTIONEN],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        postausgang_collection=database[Collection.POSTAUSGANG],
        sperrliste=ban_list(database),
        db=client,
        config=CONFIG,
        today=TODAY,
        germany_now=NOW,
    )


async def replay_the_widerspruch(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    """The Trainer's Widerspruch replayed onto a restore from a snapshot older than the press."""

    line = JournalLine(
        person_hash=loeschung_journal_hash("ida@example.com", key=CONFIG.sperrliste_schluessel),
        art="widerspruch",
        collection=Collection.SAISON_TEAMS,
        record_id=ROW_OID,
        am=AM,
        sitze=("trainer",),
    )
    # The snapshot taken the morning the links went, so the row's links are the snapshot's own.
    window = Window(since=datetime(2026, 4, 1, 7, 0, tzinfo=UTC), until=datetime(2026, 4, 2, 6, 0, tzinfo=UTC))
    planned = await replay_line(
        Read(timestamp=datetime(2026, 4, 1, 10, 30, 1, tzinfo=UTC), line=line),
        client,
        database,
        key=CONFIG.sperrliste_schluessel,
        now=datetime(2026, 4, 2, 9, 0, tzinfo=UTC),
        window=window,
    )
    assert planned.stand == "replayed", planned


ALL = set(KONTAKT_ROLLEN)
KEPT = {"open": ALL, "answered": ALL, "other": ALL}


class TestEverySeatWriteVoidsItsLinks:
    """Every route and step writing an existing season row's seats, each voiding what it moves and nothing else."""

    @pytest.mark.parametrize(
        ("write", "voided", "saison_status", "other"),
        [
            pytest.param(hand_the_trainer_on, {"trainer"}, "active", ALL, id="the contacts save handing a seat on"),
            pytest.param(empty_the_trainer, {"trainer"}, "active", ALL, id="the contacts save emptying a seat"),
            pytest.param(replace_the_club, ALL, "active", ALL, id="the club's replacement"),
            pytest.param(loeschen_the_trainer, {"trainer"}, "active", ALL, id="the person erasure's seat member"),
            # The season's end strips every team row of the season, a club whose block was empty already included.
            pytest.param(clear_the_blocks, ALL, "past", set(), id="the sweep clearing a past season's blocks"),
            pytest.param(contradict, {"trainer"}, "active", ALL, id="the Widerspruch on the season row"),
            pytest.param(replay_the_widerspruch, {"trainer"}, "active", ALL, id="the replay of that Widerspruch"),
        ],
    )
    def test_the_moved_seat_s_link_stops_answering_and_nothing_else_does(
        self, mongo_replica_set_url: str, write: Write, voided: set[str], saison_status: str, other: set[str]
    ):
        """The other team's row is the control; this team's answered row loses the seat's links too and keeps its answer."""

        links, stored_answers, _ = on_a_league(mongo_replica_set_url, write, saison_status=saison_status)

        assert links == {"open": ALL - voided, "answered": ALL - voided, "other": other}
        assert stored_answers == [row["antwort"] for row in ROWS.values()]

    def test_a_retyped_case_moves_nobody_and_voids_nothing(self, mongo_replica_set_url: str):
        """The save's own identity rule folds the address as a sign-in does, so `Ida@` is the person `ida@` already was."""

        async def retype(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await save(database, client, {**SENT, "trainer": person("Ida", email="Ida@Example.com")})

        links, _, logged = on_a_league(mongo_replica_set_url, retype)

        assert (links, logged) == (KEPT, 0)

    def test_a_new_person_at_the_same_mailbox_voids_the_seat(self, mongo_replica_set_url: str):
        """Two people sharing one inbox are two holders: the link went to the one who left the seat."""

        async def hand_on_in_place(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await save(database, client, {**SENT, "trainer": person("Lea", email="ida@example.com")})

        links, _, _ = on_a_league(mongo_replica_set_url, hand_on_in_place)

        assert links == {**KEPT, "open": ALL - {"trainer"}, "answered": ALL - {"trainer"}}

    def test_a_seat_holding_no_entry_on_any_row_is_written_nowhere(self, mongo_replica_set_url: str):
        """A void that changes nothing files no log row naming a write that changed nothing; the open row's Trainer entry is null."""

        async def hand_on_an_unasked_seat(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBESTAETIGUNGEN].update_many({"party.team_id": TEAM_OID}, {"$set": {"kontakte.trainer": None}})
            return await hand_the_trainer_on(database, client)

        _, _, logged = on_a_league(mongo_replica_set_url, hand_on_an_unasked_seat)
        _, _, logged_with_an_entry = on_a_league(mongo_replica_set_url, hand_the_trainer_on)

        assert (logged, logged_with_an_entry) == (0, 1)


IDA = "ida@example.com"
UNDRAWN_SPIEL_OIDS = [ObjectId(f"6890a1b2c3d4e5f607b6005{position}") for position in range(2)]


def declined(row: str, team_id: ObjectId, spiel: Mapping[str, Any], rolle: str, adresse: str, begruendung: str) -> dict[str, Any]:
    """A row the team declined from `rolle`'s link, pressed by `adresse`, giving a reason; closed since, as a move closes an answered row."""

    return confirmation_row(
        row,
        team_id,
        spiel,
        antwort=documents.kontakt_antwort_document(rolle, adresse, begruendung=begruendung),
        closed={"am": TODAY, "grund": "ansetzung_changed"},
    )


# Ida holds this team's Trainer seat now. Hers go with her whichever seat and team she typed them from, an
# address she typed in another case among them; her predecessor's, from the seat she holds now, stays.
REASONS = {
    "hers, from her seat": declined("hers", TEAM_OID, FIXTURES[2], "trainer", IDA, "Ida ist an dem Tag verreist"),
    "hers, from a seat she left": declined("left", OTHER_TEAM_OID, FIXTURES[3], "ansprechperson", "IDA@Example.com", "Die Fahrt ist zu weit"),
    "her predecessor's, from her seat": declined("before", TEAM_OID, FIXTURES[4], "trainer", "lea@example.com", "Lea hat Spätdienst"),
    "another seat's": declined("seat", TEAM_OID, FIXTURES[5], "ansprechperson", "jonas@example.com", "Die Halle ist belegt"),
    "another team's": declined("team", OTHER_TEAM_OID, FIXTURES[6], "trainer", "klara@example.com", "Unser Trainer ist krank"),
}
# Removed by an undraw, so one array image holds both, hers second: a judge taking every element, or the first, fails.
UNDRAWN = {
    "another seat's, undrawn": declined(
        "undrawn-seat", TEAM_OID, fixture(UNDRAWN_SPIEL_OIDS[0], saison_id=LATER_SAISON_ID), "ansprechperson", "jonas@example.com", "Halle zu"
    ),
    "hers, undrawn": declined(
        "undrawn-hers", TEAM_OID, fixture(UNDRAWN_SPIEL_OIDS[1], saison_id=LATER_SAISON_ID), "trainer", IDA, "Ida ist krank"
    ),
}
HERS = {"hers, from her seat", "hers, from a seat she left", "hers, undrawn"}
NAMED = {row["spiel_id"]: name for name, row in {**REASONS, **UNDRAWN}.items()}


def left_behind(name: str, antwort: Mapping[str, Any]) -> tuple[str, Any, Any]:
    return name, antwort["begruendung"], antwort["von"].get("halter")


def expected(name: str) -> tuple[str, Any, Any]:
    if name in HERS:
        return name, None, None

    return left_behind(name, {**REASONS, **UNDRAWN}[name]["antwort"])


class TestALeavingContactsReasonsGo:
    """Every reason the person typed goes from its row and every log image, with the holder it was matched on; the answer stays."""

    @pytest.mark.parametrize(
        "write",
        [
            pytest.param(loeschen_the_trainer, id="their erasure"),
            pytest.param(contradict, id="their Widerspruch on the season row"),
            pytest.param(replay_the_widerspruch, id="the replay of that Widerspruch"),
        ],
    )
    def test_theirs_go_from_the_rows_and_the_images_and_nobody_elses_do(self, mongo_replica_set_url: str, write: Write):
        """The predecessor's reason from the same seat is what a judge keyed on the seat rather than the holder takes."""

        found: dict[str, Any] = {}

        async def after_the_answers(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            collection = database[Collection.SPIELBESTAETIGUNGEN]
            await collection.insert_many([dict(row) for row in (*REASONS.values(), *UNDRAWN.values())])
            # A write after each answer files the answered row's image, reason, holder and all.
            for row in REASONS.values():
                await patch_one_in_db(
                    collection=collection,
                    db_filter={"_id": row["_id"]},
                    update={"$set": {"reminded_at": [TODAY]}},
                    return_document=ReturnDocument.BEFORE,
                )
            async with client.start_session() as session:
                await delete_many_from_db(collection=collection, db_filter={"saison_id": LATER_SAISON_ID}, session=session)

            await write(database, client)

            found["rows"] = sorted(
                [left_behind(NAMED[row["spiel_id"]], row["antwort"]) async for row in collection.find({"spiel_id": {"$in": list(NAMED)}})]
            )
            logged = database[Collection.AKTIONEN].find({"collection": str(Collection.SPIELBESTAETIGUNGEN), "before": {"$ne": None}})
            found["images"] = sorted(
                [
                    left_behind(NAMED[image["spiel_id"]], image["antwort"])
                    async for row in logged
                    for image in (row["before"] if isinstance(row["before"], list) else [row["before"]])
                    if image.get("spiel_id") in NAMED
                ]
            )

        on_a_league(mongo_replica_set_url, after_the_answers)

        assert found["rows"] == sorted(expected(name) for name in REASONS)
        assert found["images"] == sorted(expected(name) for name in NAMED.values())


class TestAnAnsweredRowsLinkOutlivesNoHolder:
    def test_the_old_trainers_link_tells_nobody_that_the_new_trainer_is_barred(self, mongo_replica_set_url: str):
        """The page would read the successor's address against the ban list and tell whoever holds the old mail that it is barred."""

        async def hand_on_then_bar(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await hand_the_trainer_on(database, client)
            await database[Collection.SPERRLISTE].insert_one(documents.ban_document("lea@example.com", bis=SAISON_ID))

        links, stored_answers, _ = on_a_league(mongo_replica_set_url, hand_on_then_bar)

        # Refused `link_invalid` (`links_answering` admits no other refusal), never served as `barred`.
        assert links["answered"] == ALL - {"trainer"}
        assert stored_answers == [row["antwort"] for row in ROWS.values()]


class TestALeavingPersonsLinksLeaveTheLog:
    """The answered row's image, filed by a later write, holds every seat's link hashes and delivery record."""

    @pytest.mark.parametrize(
        ("write", "gone"),
        [
            pytest.param(loeschen_the_trainer, {"trainer"}, id="their erasure"),
            pytest.param(contradict, {"trainer"}, id="their Widerspruch"),
            pytest.param(replay_the_widerspruch, {"trainer"}, id="the replay of their Widerspruch"),
            # A seat handed on is no leaving of a person: the season row's own images keep the predecessor too.
            pytest.param(hand_the_trainer_on, set(), id="a seat handed on"),
        ],
    )
    def test_their_seats_entries_go_from_the_images_and_every_other_seat_s_stay(self, mongo_replica_set_url: str, write: Write, gone: set[str]):
        found: dict[str, Any] = {}

        async def after_an_image(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            delivered = {"message_id": "msg-1", "stand": "delivered", "grund": None, "am": "2026-04-01T09:00:00+00:00"}
            await database[Collection.SPIELBESTAETIGUNGEN].update_one(
                {"_id": ROWS["answered"]["_id"]}, {"$set": {"kontakte.trainer.delivery": delivered}}
            )
            await patch_one_in_db(
                collection=database[Collection.SPIELBESTAETIGUNGEN],
                db_filter={"_id": ROWS["answered"]["_id"]},
                update={"$set": {"reminded_at": [TODAY]}},
                return_document=ReturnDocument.BEFORE,
            )
            await write(database, client)
            image = await database[Collection.AKTIONEN].find_one({"document_id": ROWS["answered"]["_id"], "before": {"$ne": None}})
            found["held"] = {seat for seat in KONTAKT_ROLLEN if (image or {}).get("before", {}).get("kontakte", {}).get(seat) is not None}

        on_a_league(mongo_replica_set_url, after_an_image)

        assert found["held"] == ALL - gone
