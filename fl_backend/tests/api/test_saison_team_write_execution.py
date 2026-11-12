from collections.abc import Awaitable, Callable, Sequence
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.teams.admin_router import put_austritt
from app.api.teams.schemas import FLAustrittPayload
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import confirmed_kenntnisnahme, rules_document, saison_document, saison_team_document, spiel_document, team_document
from tests.outbox import MAIL_NOW
from tests.team_writes import save_the_team
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_saison_team_write_test")

SAISON_ID = "2026"

# Fixed rather than generated, so a failure names the same club every run.
ADLER = ObjectId("6890a1b2c3d4e5f607250001")
BIEBER = ObjectId("6890a1b2c3d4e5f607250002")
CRONBERG = ObjectId("6890a1b2c3d4e5f607250003")

# Two groups of two, so one extra row fills a group.
NUMBER_OF_GROUPS = 2
TEAMS_PER_GROUP = 2

RULES = rules_document(number_of_gruppen=NUMBER_OF_GROUPS, teams_per_gruppe=TEAMS_PER_GROUP, allowed_stufen=["E1", "Q1"])

PLAYED_AS = {ADLER: ("Adler-Schule", "ASX"), BIEBER: ("Bieber", "BIX"), CRONBERG: ("Cronberg", "CRX")}

EXIT = {"type": "rueckzug", "reason": "Zu wenige Spieler", "date": "2026-04-01"}

# The German day every write here is judged on, past the season's start, which `saison_document` sets to 2026-01-01.
TODAY = "2026-04-15"
# The day before that start, when no exit may be recorded.
BEFORE_THE_START = "2025-12-31"

SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f6072500f1")


def junction_document(team_id: ObjectId, gruppe: str, kontakte: dict[str, Any] | None = None) -> dict[str, Any]:
    name, shorthand = PLAYED_AS[team_id]

    return saison_team_document(SAISON_ID, team_id, name, shorthand, gruppe=gruppe, kontakte=kontakte)


def team_spiel_document(team_id: ObjectId, side: str) -> dict[str, Any]:
    """What the move gate counts is one drawn side; every other field is null, so no other rule can answer for the refusal."""

    return spiel_document(
        spiel_id=ObjectId(),
        saison_id=SAISON_ID,
        spiel_nr=1,
        spieltag_id=SPIELTAG_OID,
        **{side: {"team_id": team_id, "tore": None}},
    )


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_season(
    url: str,
    body: Body,
    *,
    saison_status: str = "future",
    junctions: Sequence[dict[str, Any]] = (),
    spiele: Sequence[dict[str, Any]] = (),
    seeded_kontakte: dict[str, Any] | None = None,
) -> Any:
    """`future` by default, the one status a group move is open in.

    So a refusal a test reaches is the gate it names rather than the season's standing.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, saison_status, rules=dict(RULES)))
            await database[Collection.TEAMS].insert_one(team_document(ADLER, "Adler", "ADL"))
            await database[Collection.SAISON_TEAMS].insert_many(
                [junction_document(ADLER, "A", kontakte=seeded_kontakte), junction_document(BIEBER, "B"), *junctions]
            )
            if spiele:
                await database[Collection.SPIELE].insert_many(list(spiele))

            return await body(database)

    return on_the_seed_loop(_run())


async def call_put(database: AsyncDatabase, austritt: dict[str, Any], *, today: str = TODAY) -> None:
    await put_austritt(
        team_id=ADLER,
        saison_id=SAISON_ID,
        austritt_data=FLAustrittPayload.model_validate(austritt),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        outbox_collection=database[Collection.OUTBOX],
        db=database.client,
        today=today,
        germany_now=MAIL_NOW,
    )


async def stored_row(database: AsyncDatabase, team_id: ObjectId = ADLER) -> dict[str, Any]:
    row = await database[Collection.SAISON_TEAMS].find_one({"saison_id": SAISON_ID, "team_id": team_id})
    assert row is not None, f"the seed holds no junction row for {team_id}"

    return row


class TestRecordingAnExitFromTheSeason:
    """An austritt is the only way out of a season -- there is no delete -- and it writes the record without moving anyone."""

    def test_a_padded_reason_reaches_the_row_stripped(self, mongo_replica_set_url: str):
        """The reason is FREE TEXT and PUBLIC, and `min_length` counts CHARACTERS: spaces alone would stand on the team's page as a blank."""

        padded = f"  {EXIT['reason']}  "

        async def body(database: AsyncDatabase) -> Any:
            await call_put(database, {**EXIT, "reason": padded})

            return await stored_row(database)

        assert on_a_season(mongo_replica_set_url, body)["austritt"] == EXIT

    @pytest.mark.parametrize(
        "second",
        [
            pytest.param(EXIT, id="the same exit pressed again"),
            pytest.param({"type": "disqualifikation", "reason": "Nicht angetreten", "date": "2026-05-01"}, id="another exit"),
        ],
    )
    def test_a_write_on_a_row_whose_exit_stands_is_a_stale_page_and_changes_nothing(self, mongo_replica_set_url: str, second: dict[str, Any]):
        """Told opponents and closed confirmations stay told and closed, so no later press may rewrite the record they answered."""

        async def body(database: AsyncDatabase) -> Any:
            await call_put(database, dict(EXIT))
            before = await stored_row(database)
            with pytest.raises(APIError) as refused:
                await call_put(database, second)

            return refused.value.error_code, before, await stored_row(database)

        code, before, after = on_a_season(mongo_replica_set_url, body)

        assert code == Code.VERSION_STALE
        assert after == before, "a refused write changed the row"

    def test_a_finished_season_refuses_it_and_writes_nothing(self, mongo_replica_set_url: str):
        """`saison_past`: an exit recorded on a finished season would move its table and podium after the fact."""

        async def body(database: AsyncDatabase) -> Any:
            before = await stored_row(database)
            with pytest.raises(APIError) as refused:
                await call_put(database, dict(EXIT))

            return refused.value.error_code, before, await stored_row(database)

        code, before, after = on_a_season(mongo_replica_set_url, body, saison_status="past")

        assert code == Code.SAISON_PAST
        assert after == before, "a refused write changed the row"

    def test_an_exit_recorded_before_the_season_starts_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        """Before the start a departed club is replaced: an exit standing then would leave it on fixtures the open group swap rewrites.

        Refused whatever day the exit is dated, its start date the first day one may be recorded.
        """

        async def body(database: AsyncDatabase) -> Any:
            before = await stored_row(database)
            with pytest.raises(APIError) as refused:
                await call_put(database, dict(EXIT), today=BEFORE_THE_START)

            return refused.value, before, await stored_row(database)

        refusal, before, after = on_a_season(mongo_replica_set_url, body)

        assert (refusal.error_code, refusal.fields, refusal.bounds) == (
            Code.AUSTRITT_BEFORE_SAISON_START,
            (("date",),),
            {"earliest": "2026-01-01"},
        )
        assert after == before, "a refused write changed the row"


class TestMovingAClubBetweenGroups:
    @pytest.mark.parametrize("side", ["team1", "team2"])
    def test_a_started_season_with_a_spiel_drawn_refuses_it_and_writes_nothing(self, mongo_replica_set_url: str, side: str):
        """`entry_gruppe_locked`'s move lock through the route: the group phase is a round robin, so a move after the draw strands it."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(APIError) as conflict:
                await save_the_team(database, team_id=ADLER, saison_id=SAISON_ID, gruppe="B")

            return conflict.value.error_code, await stored_row(database)

        code, row = on_a_season(mongo_replica_set_url, body, saison_status="active", spiele=[team_spiel_document(ADLER, side)])

        assert code == Code.ENTRY_GRUPPE_LOCKED
        assert row["gruppe"] == "A"

    def test_a_full_destination_refuses_it(self, mongo_replica_set_url: str):
        """The entry gate reached through the move: a group at its cap cannot take one more however the club arrives."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(APIError) as conflict:
                await save_the_team(database, team_id=ADLER, saison_id=SAISON_ID, gruppe="B")

            return conflict.value.error_code, await stored_row(database)

        code, row = on_a_season(mongo_replica_set_url, body, junctions=[junction_document(CRONBERG, "B")])

        assert code == Code.ENTRY_GRUPPE_FULL
        assert row["gruppe"] == "A"


# One filled-in block, reused: the shape is the payload's, so a field added to it fails here rather
# than at the first real write.
KONTAKTPERSON = {
    "first_name": "Anke",
    "last_name": "Koerner",
    "email": "a.koerner@example.de",
    "phone": "+49 170 1234567",
    "birth_date": "1984-05-09",
    "einwilligung": confirmed_kenntnisnahme(),
}

KONTAKTE = {
    "trainer": dict(KONTAKTPERSON),
    "ansprechperson": dict(KONTAKTPERSON),
    "stellvertretung": dict(KONTAKTPERSON),
    "trainer_is_also": "ansprechperson",
}


class TestTheContactBlockTheseWritesDoNotOwn:
    """A seat's write stores it. No `$set` here names a `kontakte` key, so the stored block stands."""

    def test_a_stored_block_survives_a_group_move(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            await save_the_team(database, team_id=ADLER, saison_id=SAISON_ID, gruppe="B")

            return await stored_row(database)

        row = on_a_season(mongo_replica_set_url, body, seeded_kontakte=dict(KONTAKTE))

        assert row["gruppe"] == "B"
        assert row["kontakte"] == KONTAKTE

    def test_a_stored_block_survives_an_exit(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            await call_put(database, dict(EXIT))

            return await stored_row(database)

        row = on_a_season(mongo_replica_set_url, body, seeded_kontakte=dict(KONTAKTE))

        assert row["kontakte"] == KONTAKTE
