from collections.abc import Awaitable, Callable, Iterator
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.public_router import get_teams as get_saison_teams
from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.crud import advance_bracket_winners
from app.api.teams.public_router import get_team
from app.api.teams.schemas import FLTeamSingleFilterParams
from app.api.teams.services import build_team_pipeline
from app.core.collections import Collection
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop, shared_client
from tests.documents import confirmed_kenntnisnahme
from tests.worker import worker_database

from .conftest import unwritten

DATABASE_NAME = worker_database("fl_teams_public_read_test")
BRACKET_DATABASE_NAME = worker_database("fl_teams_bracket_placings_test")

SAISON = "2026"
PAST_SAISON = "2025"

TEAM_OIDS = {
    "Helmholtz": ObjectId("6890a1b2c3d4e5f607420001"),
    # The club that left the LEAGUE while still holding the running season's junction row. The row is
    # what would carry it into a standing the moment the match on `inactive_since` is dropped.
    "Lessing": ObjectId("6890a1b2c3d4e5f607420002"),
    "Goethe": ObjectId("6890a1b2c3d4e5f607420003"),
}

# After the running season's end date, which a season outlives until the next one is activated: a
# match on that date rather than on `status` would list Lessing there.
RETIRED_ON = "2026-08-01"

# The three values a leak would carry: a teacher's mailbox, the number the league runs its whole
# WhatsApp channel on, and a private person's date of birth.
KONTAKT_EMAIL = "a.koerner@helmholtz.example.de"
KONTAKT_PHONE = "+49 170 1234567"
KONTAKT_BIRTH_DATE = "1984-05-09"

Body = Callable[[AsyncDatabase], Awaitable[Any]]


def saison_document(saison_id: str = SAISON, status: str = "active") -> dict[str, Any]:
    """The Tabelle derives every figure in it from these rules, and the finale is seeded from the placings they rank."""

    rules = documents.rules_document(win_points=3, draw_points=1, qualifiers_per_gruppe=2, tiebreak_order="tordifferenz")

    return documents.saison_document(saison_id, status, rules=rules)


def team_document(key: str, shorthand: str, *, inactive_since: str | None) -> dict[str, Any]:
    return documents.team_document(TEAM_OIDS[key], key, shorthand, full_name=f"{key}-Gymnasium", inactive_since=inactive_since)


def kontaktperson(last_name: str) -> dict[str, Any]:
    return {
        "first_name": "Anke",
        "last_name": last_name,
        "email": KONTAKT_EMAIL,
        "phone": KONTAKT_PHONE,
        "birth_date": KONTAKT_BIRTH_DATE,
        "einwilligung": confirmed_kenntnisnahme(),
    }


def junction_row(key: str, shorthand: str, saison_id: str = SAISON) -> dict[str, Any]:
    return documents.saison_team_document(
        saison_id,
        TEAM_OIDS[key],
        key,
        shorthand,
        gruppe="A",
        trikot_farbe="dunkelblau",
        # What the withholding cases below are about.
        kontakte={
            "trainer": kontaktperson("Trainerin"),
            "ansprechperson": kontaktperson("Ansprechpartnerin"),
            "stellvertretung": kontaktperson("Vertretung"),
            "trainer_is_also": None,
        },
    )


# Module-scoped: every case below reads this corpus and none writes it, which `unwritten` keeps
# from being left as a claim.
@pytest.fixture(scope="module")
def seeded_url(mongo_replica_set_url: str) -> Iterator[str]:
    """A running season and a live club, its junction row carrying three people's contact records."""

    async def _seed() -> None:
        async with a_clean_database(mongo_replica_set_url, DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_one(saison_document())
            await database[Collection.TEAMS].insert_one(team_document("Helmholtz", "HGX", inactive_since=None))
            await database[Collection.SAISON_TEAMS].insert_one(junction_row("Helmholtz", "HGX"))

    on_the_seed_loop(_seed())

    with unwritten(mongo_replica_set_url, DATABASE_NAME):
        yield mongo_replica_set_url


def on_a_league(url: str, body: Body) -> Any:
    async def _run() -> Any:
        return await body(shared_client(url)[DATABASE_NAME])

    return on_the_seed_loop(_run())


async def read_saison_teams(database: AsyncDatabase, saison_id: str = SAISON) -> Any:
    return await get_saison_teams(
        saison_id=saison_id, saisons_collection=database[Collection.SAISONS], teams_collection=database[Collection.TEAMS]
    )


GRUPPENPHASE_SPIELTAG = ObjectId("6890a1b2c3d4e5f607420101")
FINALE_SPIELTAG = ObjectId("6890a1b2c3d4e5f607420102")
FINALE = ObjectId("6890a1b2c3d4e5f607420103")


SHORTHANDS = {"Helmholtz": "HGX", "Lessing": "LEX", "Goethe": "GOX"}


def side(key: str, tore: int) -> dict[str, Any]:
    """A side as a fixture stores it: the club and its goals, its name joined at read."""

    return {"team_id": TEAM_OIDS[key], "tore": tore}


def spiel(spiel_id: ObjectId, nr: int, saison_id: str, **overrides: Any) -> dict[str, Any]:
    return {
        **documents.spiel_document(
            spiel_id=spiel_id,
            saison_id=saison_id,
            spiel_nr=nr,
            spieltag_id=GRUPPENPHASE_SPIELTAG,
            date=f"{saison_id}-03-15",
            time="14:00:00",
        ),
        **overrides,
    }


def played_group(saison_id: str) -> list[dict[str, Any]]:
    """Group A played out, Lessing winning both of its fixtures: its placing is first wherever it holds one.

    And a Finale drawn from the group's first two placings, which the resolution fills.
    """

    return [
        spiel(ObjectId("6890a1b2c3d4e5f607420111"), 1, saison_id, team1=side("Lessing", 5), team2=side("Helmholtz", 0), ergebnis="5:0"),
        spiel(ObjectId("6890a1b2c3d4e5f607420112"), 2, saison_id, team1=side("Lessing", 5), team2=side("Goethe", 0), ergebnis="5:0"),
        spiel(ObjectId("6890a1b2c3d4e5f607420113"), 3, saison_id, team1=side("Helmholtz", 2), team2=side("Goethe", 1), ergebnis="2:1"),
        spiel(
            FINALE,
            4,
            saison_id,
            saison_phase="finale",
            spieltag_id=FINALE_SPIELTAG,
            team1_quelle={"type": "gruppe", "gruppe": "A", "platz": 1},
            team2_quelle={"type": "gruppe", "gruppe": "A", "platz": 2},
        ),
    ]


@pytest.mark.db
class TestTheBracketPlacesTheClubsTheTableRanks:
    """Through the save's own resolution, over a season holding a club that left the league."""

    @pytest.mark.parametrize(
        ("saison_id", "status", "seeded"),
        [
            pytest.param(PAST_SAISON, "past", ("Lessing", "Helmholtz"), id="a past season seeds the retired club it placed"),
            # The club the table withholds holds no placing, so the two still in the league take first and second.
            pytest.param(SAISON, "active", ("Helmholtz", "Goethe"), id="a running season seeds the clubs below the retired one"),
        ],
    )
    def test_the_finale_is_seeded_from_the_placings_the_table_ranks(
        self, mongo_replica_set_url: str, saison_id: str, status: str, seeded: tuple[str, str]
    ):
        async def body() -> tuple[str | None, str | None]:
            async with a_clean_database(mongo_replica_set_url, BRACKET_DATABASE_NAME, constraints=True) as (client, database):
                await database[Collection.SAISONS].insert_one(saison_document(saison_id, status=status))
                await database[Collection.TEAMS].insert_many(
                    [
                        team_document(key, shorthand, inactive_since=RETIRED_ON if key == "Lessing" else None)
                        for key, shorthand in SHORTHANDS.items()
                    ]
                )
                await database[Collection.SAISON_TEAMS].insert_many(
                    [junction_row(key, shorthand, saison_id=saison_id) for key, shorthand in SHORTHANDS.items()]
                )
                await database[Collection.SPIELE].insert_many(played_group(saison_id))

                rules = FLSaisonRules.model_validate(saison_document(saison_id)["rules"])
                async with client.start_session() as session:

                    async def resolve(transaction: Any) -> Any:
                        return await advance_bracket_winners(
                            spiele_collection=database[Collection.SPIELE],
                            teams_collection=database[Collection.TEAMS],
                            saison_id=saison_id,
                            rules=rules,
                            session=transaction,
                        )

                    await session.with_transaction(resolve)

                finale = await database[Collection.SPIELE].find_one({"_id": FINALE}) or {}

                # The stored side names its club by id alone.
                keys: dict[Any, str] = {team_id: key for key, team_id in TEAM_OIDS.items()}
                return keys.get((finale.get("team1") or {}).get("team_id")), keys.get((finale.get("team2") or {}).get("team_id"))

        assert on_the_seed_loop(body()) == seeded


@pytest.mark.db
class TestTheTeamReadCountsTheLeagueAlone:
    def test_a_read_naming_no_scope_answers_the_group_phase_figures(self, mongo_replica_set_url: str):
        """The site sends no scope, so a default counting the knockout would put a cup result into the club's league figures."""

        async def body() -> dict[str, Any]:
            async with a_clean_database(mongo_replica_set_url, BRACKET_DATABASE_NAME, constraints=True) as (_, database):
                await database[Collection.SAISONS].insert_one(saison_document())
                await database[Collection.TEAMS].insert_many(
                    [team_document(key, shorthand, inactive_since=None) for key, shorthand in SHORTHANDS.items()]
                )
                await database[Collection.SAISON_TEAMS].insert_many([junction_row(key, shorthand) for key, shorthand in SHORTHANDS.items()])
                group, finale = played_group(SAISON)[:3], played_group(SAISON)[3]
                # Helmholtz wins the Finale, a result the group phase must not count.
                played_finale = {**finale, "team1": side("Helmholtz", 3), "team2": side("Goethe", 0), "ergebnis": "3:0"}
                await database[Collection.SPIELE].insert_many([*group, played_finale])

                async def figures(**scope: Any) -> Any:
                    filters = FLTeamSingleFilterParams(saison_id=SAISON, **scope)
                    answered = await get_team(
                        team_id=TEAM_OIDS["Helmholtz"],
                        teams_collection=database[Collection.TEAMS],
                        saisons_collection=database[Collection.SAISONS],
                        filters=filters,
                    )
                    return answered.team.statistik

                return {
                    "named by no caller": await figures(),
                    "gruppenphase": await figures(statistik_scope="gruppenphase"),
                    "total": await figures(statistik_scope="total"),
                }

        figures = on_the_seed_loop(body())

        # The premise: the Finale counts in the total, or the default could not be told from it.
        assert figures["total"] != figures["gruppenphase"]
        assert figures["named by no caller"] == figures["gruppenphase"]


@pytest.mark.db
class TestTheBaseTierReadsWithholdTheJunctionsContactRecords:
    """Three people's email, phone number and date of birth sit on the junction row, and both base-tier team reads join it."""

    def test_the_aggregation_carries_none_of_it_back(self, seeded_url: str):
        """The RAW documents, before any model sees them: what the driver returned is what a leak would have to travel in."""

        async def body(database: AsyncDatabase) -> Any:
            rules = FLSaisonRules.model_validate(saison_document()["rules"])
            pipeline = build_team_pipeline(saison_id=SAISON, rules=rules)
            stored = await database[Collection.SAISON_TEAMS].find_one({"team_id": TEAM_OIDS["Helmholtz"]})

            return stored, await (await database[Collection.TEAMS].aggregate(pipeline)).to_list(length=None)

        stored, rows = on_a_league(seeded_url, body)

        # Every case of this class would pass as well over a season whose rows carried no contacts at all.
        assert stored["kontakte"]["trainer"]["email"] == KONTAKT_EMAIL
        assert stored["kontakte"]["stellvertretung"]["birth_date"] == KONTAKT_BIRTH_DATE
        assert rows, "the pipeline matched nothing, so withholding is not what this proves"
        for row in rows:
            assert "kontakte" not in row
            assert KONTAKT_PHONE not in repr(row)

    def test_the_season_s_club_list_serves_none_of_it(self, seeded_url: str):
        response = on_a_league(seeded_url, read_saison_teams)

        assert response.teams
        assert KONTAKT_EMAIL not in response.model_dump_json()

    def test_the_single_team_endpoint_serves_none_of_it_either(self, seeded_url: str):
        """The other public caller of the same pipeline, and the one an anonymous visitor reaches with an id in hand."""

        async def body(database: AsyncDatabase) -> Any:
            return await get_team(
                team_id=TEAM_OIDS["Helmholtz"],
                teams_collection=database[Collection.TEAMS],
                saisons_collection=database[Collection.SAISONS],
                filters=FLTeamSingleFilterParams(saison_id=SAISON),
            )

        response = on_a_league(seeded_url, body)

        assert response.team.name == "Helmholtz"
        assert KONTAKT_EMAIL not in response.model_dump_json()
        assert KONTAKT_BIRTH_DATE not in response.model_dump_json()
