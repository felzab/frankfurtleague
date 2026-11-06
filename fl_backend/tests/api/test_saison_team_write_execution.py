from collections.abc import Awaitable, Callable, Sequence
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.teams.admin_router import patch_saison_team
from app.api.teams.schemas import FLPatchSaisonTeamPayload
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import confirmed_kenntnisnahme, rules_document, saison_document, saison_team_document, spiel_document
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

EXIT = {"type": "rueckzug", "exit_reason": "Zu wenige Spieler", "date": "2026-04-01"}

# The German day every write here is judged on, past the season's start, which `saison_document` sets to 2026-01-01.
TODAY = "2026-04-15"
# The day before that start, when no exit may be recorded.
BEFORE_THE_START = "2025-12-31"

SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f6072500f1")


def junction_document(team_id: ObjectId, gruppe: str, kontakte: dict[str, Any] | None = None) -> dict[str, Any]:
    name, shorthand = PLAYED_AS[team_id]

    return saison_team_document(SAISON_ID, team_id, name, shorthand, gruppe=gruppe, kontakte=kontakte)


def fixture_document(team_id: ObjectId) -> dict[str, Any]:
    """What the move gate counts is one drawn side; every other field is null, so no other rule can answer for the refusal."""

    return spiel_document(
        spiel_id=ObjectId(),
        saison_id=SAISON_ID,
        spiel_nr=1,
        spieltag_id=SPIELTAG_OID,
        team1={"team_id": team_id, "tore": None},
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
            await database[Collection.SAISON_TEAMS].insert_many(
                [junction_document(ADLER, "A", kontakte=seeded_kontakte), junction_document(BIEBER, "B"), *junctions]
            )
            if spiele:
                await database[Collection.SPIELE].insert_many(list(spiele))

            return await body(database)

    return on_the_seed_loop(_run())


async def call_patch(
    database: AsyncDatabase,
    team_id: ObjectId = ADLER,
    *,
    gruppe: str = "A",
    austritt: dict[str, Any] | None = None,
    trikot_farbe: str | None = None,
    saison_id: str = SAISON_ID,
    today: str = TODAY,
) -> Any:
    """`gruppe` defaults to `ADLER`'s own group, so the default call moves nobody.

    Every key the payload takes is sent on every call: it replaces them wholesale and defaults none.
    No `kontakte` is among them.
    """

    return await patch_saison_team(
        team_id=team_id,
        saison_id=saison_id,
        saison_team_data=FLPatchSaisonTeamPayload.model_validate({"gruppe": gruppe, "austritt": austritt, "trikot_farbe": trikot_farbe}),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        db=database.client,
        today=today,
    )


async def stored_row(database: AsyncDatabase, team_id: ObjectId = ADLER) -> dict[str, Any]:
    row = await database[Collection.SAISON_TEAMS].find_one({"saison_id": SAISON_ID, "team_id": team_id})
    assert row is not None, f"the seed holds no junction row for {team_id}"

    return row


class TestRecordingAnExitFromTheSeason:
    """An austritt is the only way out of a season -- there is no delete -- and it writes the record without moving anyone."""

    def test_a_padded_reason_reaches_the_row_stripped(self, mongo_replica_set_url: str):
        """The reason is FREE TEXT and PUBLIC, and `min_length` counts CHARACTERS: spaces alone would stand on the team's page as a blank."""

        padded = f"  {EXIT['exit_reason']}  "

        response, row = on_a_season(mongo_replica_set_url, lambda database: _both(database, austritt={**EXIT, "exit_reason": padded}))

        assert row["austritt"] == EXIT
        assert response.austritt is not None
        assert response.austritt.exit_reason == EXIT["exit_reason"]

    def test_a_finished_season_refuses_it_and_writes_nothing(self, mongo_replica_set_url: str):
        """`saison_past`: an exit recorded on a finished season would move its table and podium after the fact."""

        async def body(database: AsyncDatabase) -> Any:
            before = await stored_row(database)
            with pytest.raises(APIError) as refused:
                await call_patch(database, austritt=dict(EXIT))

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
                await call_patch(database, austritt=dict(EXIT), today=BEFORE_THE_START)

            return refused.value, before, await stored_row(database)

        refusal, before, after = on_a_season(mongo_replica_set_url, body)

        assert (refusal.error_code, refusal.fields, refusal.bounds) == (
            Code.AUSTRITT_BEFORE_SAISON_START,
            (("austritt",),),
            {"earliest": "2026-01-01"},
        )
        assert after == before, "a refused write changed the row"


class TestMovingAClubBetweenGroups:
    def test_a_started_season_with_a_fixture_drawn_refuses_it_and_writes_nothing(self, mongo_replica_set_url: str):
        """`entry_gruppe_locked`'s move lock through the route: the group phase is a round robin, so a move after the draw strands it."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(APIError) as conflict:
                await call_patch(database, gruppe="B")

            return conflict.value.error_code, await stored_row(database)

        code, row = on_a_season(mongo_replica_set_url, body, saison_status="active", spiele=[fixture_document(ADLER)])

        assert code == Code.ENTRY_GRUPPE_LOCKED
        assert row["gruppe"] == "A"

    def test_a_full_destination_refuses_it(self, mongo_replica_set_url: str):
        """The entry gate reached through the move: a group at its cap cannot take one more however the club arrives."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(APIError) as conflict:
                await call_patch(database, gruppe="B")

            return conflict.value.error_code, await stored_row(database)

        code, row = on_a_season(mongo_replica_set_url, body, junctions=[junction_document(CRONBERG, "B")])

        assert code == Code.ENTRY_GRUPPE_FULL
        assert row["gruppe"] == "A"


async def _both(database: AsyncDatabase, **overrides: Any) -> Any:
    """The response and the row it wrote: an echo agreeing with a document nobody updated proves nothing."""

    response = await call_patch(database, **overrides)

    return response, await stored_row(database)


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


class TestTheContactBlockThisPatchDoesNotOwn:
    """`PATCH .../kontakte` writes it. The `$set` here names no `kontakte` key, so the stored block stands."""

    @pytest.mark.parametrize(
        ("change", "gruppe"),
        [pytest.param({"gruppe": "B"}, "B", id="a group move"), pytest.param({"austritt": EXIT}, "A", id="an austritt")],
    )
    def test_a_stored_block_survives_either_operation(self, mongo_replica_set_url: str, change: dict[str, Any], gruppe: str):
        """Both, because the group change takes a branch the austritt skips, and the row lands on the group the payload sent."""

        _, row = on_a_season(mongo_replica_set_url, lambda database: _both(database, **change), seeded_kontakte=dict(KONTAKTE))

        assert row["gruppe"] == gruppe
        assert row["kontakte"] == KONTAKTE
