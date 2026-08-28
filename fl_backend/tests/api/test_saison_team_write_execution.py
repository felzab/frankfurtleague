import asyncio
from typing import Any, Awaitable, Callable, Sequence

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.teams.admin_router import patch_saison_team
from app.api.teams.schemas import FLPatchSaisonTeamPayload
from app.api.teams.services import ENTRY_GRUPPE_FULL, ENTRY_GRUPPE_LOCKED, ENTRY_GRUPPE_NOT_OFFERED
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
from tests.database import a_clean_database

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_saison_team_write_test"

SAISON_ID = "2026"

# Fixed rather than generated, so a failure names the same club every run.
ADLER = ObjectId("6890a1b2c3d4e5f607250001")
BIEBER = ObjectId("6890a1b2c3d4e5f607250002")
CRONBERG = ObjectId("6890a1b2c3d4e5f607250003")
ABSENT = ObjectId("6890a1b2c3d4e5f607250009")

CLUB_NAMES = {ADLER: ("Adler", "AD"), BIEBER: ("Bieber", "BI"), CRONBERG: ("Cronberg", "CR")}

# Two groups of two: "C" is a group the season does not run, and one extra row fills a group.
NUMBER_OF_GROUPS = 2
TEAMS_PER_GROUP = 2
UNOFFERED_GRUPPE = "C"

RULES = {
    "win_points": 3,
    "draw_points": 1,
    "qualifiers_per_group": 2,
    "number_of_groups": NUMBER_OF_GROUPS,
    "teams_per_group": TEAMS_PER_GROUP,
    "tiebreak_order": "tordifferenz",
    "max_kadergroesse": 18,
    "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
    "erlaubte_stufen": ["E1", "Q1"],
}

# The season's copy of the identity is deliberately NOT the club's current one: the echo reads the
# junction row, so a value taken from `teams` instead would show up as the club's name here.
PLAYED_AS = {ADLER: ("Adler-Schule", "AS"), BIEBER: ("Bieber", "BI"), CRONBERG: ("Cronberg", "CR")}

EXIT = {"type": "rueckzug", "grund": "Zu wenige Spieler", "datum": "2026-04-01"}

SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f6072500f1")


def junction_document(team_id: ObjectId, gruppe: str, kontakte: dict[str, Any] | None = None) -> dict[str, Any]:
    """A dict rather than a model: `saison_teams` is the one collection with no model of the row."""

    name, shorthand = PLAYED_AS[team_id]

    return {
        "saison_id": SAISON_ID,
        "team_id": team_id,
        "gruppe": gruppe,
        "austritt": None,
        "kontakte": kontakte,
        "name": name,
        "shorthand": shorthand,
    }


def club_document(team_id: ObjectId) -> dict[str, Any]:
    """Under the club's CURRENT name, which differs from what the season was played under."""

    name, shorthand = CLUB_NAMES[team_id]

    return {"_id": team_id, "name": name, "shorthand": shorthand}


def fixture_document(team_id: ObjectId) -> dict[str, Any]:
    """Only what the move gate counts: it asks how many fixtures this club is drawn into, nothing else."""

    return {
        "saison_id": SAISON_ID,
        "saison_phase": "gruppenphase",
        "spiel_nr": 1,
        "spieltag_id": SPIELTAG_OID,
        "team1": {"team_id": team_id, "name": "Adler-Schule", "shorthand": "AS", "tore": None},
        "team2": None,
    }


Body = Callable[[AsyncIOMotorDatabase], Awaitable[Any]]


def on_a_season(
    container: Any,
    body: Body,
    *,
    saison_status: str = "future",
    junctions: Sequence[dict[str, Any]] = (),
    spiele: Sequence[dict[str, Any]] = (),
    seeded_kontakte: dict[str, Any] | None = None,
) -> Any:
    """One client and event loop per call: Motor binds to the loop it first ran on.

    `future` by default, the one status a group move is open in -- so a refusal a test reaches is the
    gate it names rather than the season's standing.
    """

    async def _run() -> Any:
        # `spiele` by hand: the group move reads it, and nothing here seeds it in every case.
        async with a_clean_database(container.get_connection_url(), DATABASE_NAME, collections=(Collection.SPIELE,)) as (_, database):
            await database[Collection.SAISONS].insert_one({"_id": SAISON_ID, "status": saison_status, "rules": dict(RULES)})
            await database[Collection.TEAMS].insert_many([club_document(team_id) for team_id in CLUB_NAMES])
            await database[Collection.SAISON_TEAMS].insert_many(
                [junction_document(ADLER, "A", kontakte=seeded_kontakte), junction_document(BIEBER, "B"), *junctions]
            )
            if spiele:
                await database[Collection.SPIELE].insert_many(list(spiele))

            return await body(database)

    return asyncio.run(_run())


async def call_patch(
    database: AsyncIOMotorDatabase,
    team_id: ObjectId = ADLER,
    *,
    gruppe: str = "A",
    austritt: dict[str, Any] | None = None,
    trikot_farbe: str | None = None,
    saison_id: str = SAISON_ID,
) -> Any:
    """`gruppe` defaults to `ADLER`'s own group, so the default call moves nobody.

    Every key the payload takes is sent on every call: it replaces them wholesale and defaults none
    (`docs/backend/spec.md :: I31`). No `kontakte` is among them.
    """

    return await patch_saison_team(
        team_id=team_id,
        saison_id=saison_id,
        saison_team_data=FLPatchSaisonTeamPayload.model_validate({"gruppe": gruppe, "austritt": austritt, "trikot_farbe": trikot_farbe}),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
    )


async def stored_row(database: AsyncIOMotorDatabase, team_id: ObjectId = ADLER) -> dict[str, Any]:
    row = await database[Collection.SAISON_TEAMS].find_one({"saison_id": SAISON_ID, "team_id": team_id})
    assert row is not None, f"the seed holds no junction row for {team_id}"

    return row


class TestRecordingAnExitFromTheSeason:
    """An austritt is the only way out of a season -- there is no delete -- and it writes the record without moving anyone."""

    def test_the_record_is_stored_and_echoed(self, mongo_container: Any):
        def go(database: AsyncIOMotorDatabase) -> Awaitable[Any]:
            return _both(database, austritt=dict(EXIT))

        response, row = on_a_season(mongo_container, go)

        assert row["austritt"] == EXIT
        assert response.austritt is not None
        assert (response.austritt.type, response.austritt.datum) == ("rueckzug", "2026-04-01")

    def test_the_group_is_left_where_it_was(self, mongo_container: Any):
        """The two writable fields travel together in one `$set`, so recording an exit must not reshuffle the groups."""

        _, row = on_a_season(mongo_container, lambda database: _both(database, austritt=dict(EXIT)))

        assert row["gruppe"] == "A"

    def test_a_started_season_with_fixtures_drawn_still_takes_one(self, mongo_container: Any):
        """The asymmetry the endpoint turns on: only a CHANGE of group is gated, and a club withdraws mid-season by definition."""

        _, row = on_a_season(
            mongo_container,
            lambda database: _both(database, austritt=dict(EXIT)),
            saison_status="active",
            spiele=[fixture_document(ADLER)],
        )

        assert row["austritt"] == EXIT

    def test_a_padded_reason_reaches_the_row_stripped(self, mongo_container: Any):
        """The reason is FREE TEXT and PUBLIC, and `min_length` counts CHARACTERS: spaces alone would stand on the team's page as a blank."""

        padded = f"  {EXIT['grund']}  "

        response, row = on_a_season(mongo_container, lambda database: _both(database, austritt={**EXIT, "grund": padded}))

        assert row["austritt"]["grund"] == EXIT["grund"]
        assert response.austritt is not None
        assert response.austritt.grund == EXIT["grund"]

    def test_clearing_it_reinstates_the_club(self, mongo_container: Any):
        """`austritt` has no default, so a payload omitting it is a 422; sending null is how the record is deliberately withdrawn."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await call_patch(database, austritt=dict(EXIT))
            await call_patch(database, austritt=None)

            return await stored_row(database)

        assert on_a_season(mongo_container, body)["austritt"] is None


class TestMovingAClubBetweenGroups:
    def test_the_move_lands_on_the_row(self, mongo_container: Any):
        _, row = on_a_season(mongo_container, lambda database: _both(database, gruppe="B"))

        assert row["gruppe"] == "B"

    def test_a_started_season_with_a_fixture_drawn_refuses_it_and_writes_nothing(self, mongo_container: Any):
        """`REQ-ENTER`'s move lock through the route: the group phase is a round robin, so a move after the draw strands every fixture."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            with pytest.raises(DocumentConflictException) as conflict:
                await call_patch(database, gruppe="B")

            return conflict.value.error_code, await stored_row(database)

        code, row = on_a_season(mongo_container, body, saison_status="active", spiele=[fixture_document(ADLER)])

        assert code == ENTRY_GRUPPE_LOCKED
        assert row["gruppe"] == "A"

    def test_a_full_destination_refuses_it(self, mongo_container: Any):
        """The entry gate reached through the move: a group at its cap cannot take one more however the club arrives."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            with pytest.raises(DocumentConflictException) as conflict:
                await call_patch(database, gruppe="B")

            return conflict.value.error_code, await stored_row(database)

        code, row = on_a_season(mongo_container, body, junctions=[junction_document(CRONBERG, "B")])

        assert code == ENTRY_GRUPPE_FULL
        assert row["gruppe"] == "A"

    def test_a_group_the_season_does_not_run_refuses_it(self, mongo_container: Any):
        async def body(database: AsyncIOMotorDatabase) -> Any:
            with pytest.raises(DocumentConflictException) as conflict:
                await call_patch(database, gruppe=UNOFFERED_GRUPPE)

            return conflict.value.error_code

        assert on_a_season(mongo_container, body) == ENTRY_GRUPPE_NOT_OFFERED

    def test_a_row_no_document_names_is_a_404(self, mongo_container: Any):
        """Read before anything is judged, so an unknown club is a missing row rather than a refusal about a group."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await call_patch(database, ABSENT, gruppe="B")

            return await database[Collection.SAISON_TEAMS].count_documents({})

        assert on_a_season(mongo_container, body) == 2


class TestTheEchoCarriesTheSeasonsOwnIdentity:
    """The season's copy of the club's name, which is on no payload -- so it can only come from the stored row."""

    @pytest.mark.parametrize(
        ("gruppe", "austritt"),
        [pytest.param("B", None, id="a group move"), pytest.param("A", EXIT, id="an austritt")],
    )
    def test_both_operations_answer_with_the_stored_name(self, mongo_container: Any, gruppe: str, austritt: dict[str, Any] | None):
        """Both, because the group change takes a branch the austritt skips and either could answer from the wrong place."""

        response, _ = on_a_season(
            mongo_container, lambda database: _both(database, gruppe=gruppe, austritt=None if austritt is None else dict(austritt))
        )

        assert (response.name, response.shorthand) == PLAYED_AS[ADLER]

    def test_the_answer_is_not_the_clubs_current_name(self, mongo_container: Any):
        """The floor under the case above: `teams` holds a different name, so an echo reading the club would show it here."""

        response, _ = on_a_season(mongo_container, lambda database: _both(database, gruppe="B"))

        assert (response.name, response.shorthand) != CLUB_NAMES[ADLER]


async def _both(database: AsyncIOMotorDatabase, **overrides: Any) -> Any:
    """The response and the row it wrote: an echo agreeing with a document nobody updated proves nothing."""

    response = await call_patch(database, **overrides)

    return response, await stored_row(database)


# One filled-in block, reused: the shape is the payload's, so a field added to it fails here rather
# than at the first real write.
KONTAKTPERSON = {
    "vorname": "Anke",
    "nachname": "Koerner",
    "email": "a.koerner@example.de",
    "telefon": "+49 170 1234567",
    "geburtsdatum": "1984-05-09",
    "einwilligung": {"umfang": "kontaktdaten", "erteilt_von": "person", "text_version": "v1", "datum": "2026-01-15"},
}

KONTAKTE = {
    "trainer": dict(KONTAKTPERSON),
    "ansprechperson": dict(KONTAKTPERSON),
    "stellvertretung": dict(KONTAKTPERSON),
    "trainer_ist_ansprechperson": True,
}


class TestTheSeasonsKit:
    """Written by this PATCH alone, and stored on the junction rather than on the club."""

    def test_it_lands_on_the_row_and_comes_back_on_the_echo(self, mongo_container: Any):
        response, row = on_a_season(mongo_container, lambda database: _both(database, trikot_farbe="bordeaux"))

        assert row["trikot_farbe"] == "bordeaux"
        assert response.trikot_farbe == "bordeaux"

    def test_a_second_write_sending_null_clears_it(self, mongo_container: Any):
        """The wholesale replace, from the direction that removes data: unassigning a colour is one PATCH."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await call_patch(database, trikot_farbe="bordeaux")
            await call_patch(database)

            return await stored_row(database)

        assert on_a_season(mongo_container, body)["trikot_farbe"] is None


class TestTheContactBlockThisPatchDoesNotOwn:
    """`PATCH .../kontakte` writes it. The `$set` here names no `kontakte` key, so the stored block stands."""

    def test_a_stored_block_survives_a_group_move(self, mongo_container: Any):
        _, row = on_a_season(mongo_container, lambda database: _both(database, gruppe="B"), seeded_kontakte=dict(KONTAKTE))

        assert row["gruppe"] == "B"
        assert row["kontakte"] == KONTAKTE

    def test_a_stored_block_survives_an_austritt(self, mongo_container: Any):
        _, row = on_a_season(mongo_container, lambda database: _both(database, austritt=dict(EXIT)), seeded_kontakte=dict(KONTAKTE))

        assert row["kontakte"] == KONTAKTE

    def test_the_echo_reports_the_stored_block_rather_than_a_null(self, mongo_container: Any):
        """The AFTER image, so a client is told what the row holds instead of reading silence as an empty block."""

        response, _ = on_a_season(mongo_container, lambda database: _both(database, gruppe="B"), seeded_kontakte=dict(KONTAKTE))

        assert response.kontakte is not None
        assert response.kontakte.trainer is not None and response.kontakte.trainer.email == KONTAKTPERSON["email"]

    def test_a_row_stored_with_no_block_at_all_still_echoes(self, mongo_container: Any):
        """A row entered before the key existed: the validator does not require it, so `.get` is what keeps the echo alive."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await database[Collection.SAISON_TEAMS].update_one({"saison_id": SAISON_ID, "team_id": ADLER}, {"$unset": {"kontakte": ""}})

            return await call_patch(database, gruppe="B"), await stored_row(database)

        response, row = on_a_season(mongo_container, body)

        assert "kontakte" not in row
        assert response.kontakte is None

    def test_a_contact_value_the_write_side_refuses_does_not_block_the_row(self, mongo_container: Any):
        """Why no `kontakte` here: a contact is shapeless on read, bounded on write (`docs/backend/spec.md :: I36`).

        A round-tripped block would 422 every save this page can make, on `kontakte.*` paths it
        renders no field for.
        """

        unwritable = {**KONTAKTE, "trainer": {**KONTAKTPERSON, "telefon": "nicht bekannt"}}

        _, row = on_a_season(mongo_container, lambda database: _both(database, gruppe="B"), seeded_kontakte=unwritable)

        assert row["gruppe"] == "B"
        assert row["kontakte"]["trainer"]["telefon"] == "nicht bekannt"
