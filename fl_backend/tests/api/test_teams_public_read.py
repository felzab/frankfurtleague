from collections.abc import Awaitable, Callable, Iterator
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.public_router import get_tabelle
from app.api.saisons.public_router import get_teams as get_saison_teams
from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.crud import advance_bracket_winners
from app.api.teams.admin_router import get_teams_admin
from app.api.teams.public_router import get_team
from app.api.teams.schemas import FLGruppenTeam, FLTeam, FLTeamsFilterParams, FLTeamSingleFilterParams
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
# Holding a junction row and no season document, so nothing says it is past.
UNDATED_SAISON = "2024"

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
# Before the past season's end date: activating its successor early closed it first, and a match on
# that date would drop Goethe from a season it played.
GOETHE_RETIRED_ON = "2025-05-01"

# The three values a leak would carry: a teacher's mailbox, the number the league runs its whole
# WhatsApp channel on, and a private person's date of birth.
KONTAKT_EMAIL = "a.koerner@helmholtz.example.de"
KONTAKT_TELEFON = "+49 170 1234567"
KONTAKT_GEBURTSDATUM = "1984-05-09"

Body = Callable[[AsyncDatabase], Awaitable[Any]]


def saison_document(saison_id: str = SAISON, status: str = "active") -> dict[str, Any]:
    """The Tabelle derives every figure in it from these rules, and the finale is seeded from the placings they rank."""

    rules = documents.rules_document(win_points=3, draw_points=1, qualifiers_per_gruppe=2, tiebreak_order="tordifferenz")

    return documents.saison_document(saison_id, status, rules=rules)


def team_document(key: str, shorthand: str, *, inactive_since: str | None) -> dict[str, Any]:
    return documents.team_document(TEAM_OIDS[key], key, shorthand, full_name=f"{key}-Gymnasium", inactive_since=inactive_since)


def kontaktperson(nachname: str) -> dict[str, Any]:
    return {
        "vorname": "Anke",
        "nachname": nachname,
        "email": KONTAKT_EMAIL,
        "telefon": KONTAKT_TELEFON,
        "geburtsdatum": KONTAKT_GEBURTSDATUM,
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
        # What every case below is about. Stored on both clubs, so no read can pass by holding the
        # one team that happens to carry none.
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
def seeded_url(mongo_url: str) -> Iterator[str]:
    """A running season and a past one, a live club and two retired ones, and junction rows carrying three people's contact records."""

    async def _seed() -> None:
        async with a_clean_database(mongo_url, DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_many([saison_document(), saison_document(PAST_SAISON, status="past")])
            await database[Collection.TEAMS].insert_many(
                [
                    team_document("Helmholtz", "HGX", inactive_since=None),
                    team_document("Lessing", "LEX", inactive_since=RETIRED_ON),
                    team_document("Goethe", "GOX", inactive_since=GOETHE_RETIRED_ON),
                ]
            )
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    junction_row("Helmholtz", "HGX"),
                    junction_row("Lessing", "LEX"),
                    junction_row("Helmholtz", "HGX", saison_id=PAST_SAISON),
                    junction_row("Lessing", "LEX", saison_id=PAST_SAISON),
                    junction_row("Goethe", "GOX", saison_id=PAST_SAISON),
                    junction_row("Lessing", "LEX", saison_id=UNDATED_SAISON),
                ]
            )

    on_the_seed_loop(_seed())

    with unwritten(mongo_url, DATABASE_NAME):
        yield mongo_url


def on_a_league(url: str, body: Body) -> Any:
    async def _run() -> Any:
        return await body(shared_client(url)[DATABASE_NAME])

    return on_the_seed_loop(_run())


async def read_tabelle(database: AsyncDatabase, saison_id: str = SAISON) -> Any:
    return await get_tabelle(
        saison_id=saison_id,
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        spiele_collection=database[Collection.SPIELE],
    )


async def read_saison_teams(database: AsyncDatabase, saison_id: str = SAISON) -> Any:
    return await get_saison_teams(
        saison_id=saison_id, saisons_collection=database[Collection.SAISONS], teams_collection=database[Collection.TEAMS]
    )


async def read_teams_admin(database: AsyncDatabase, filters: FLTeamsFilterParams) -> Any:
    return await get_teams_admin(
        teams_collection=database[Collection.TEAMS],
        saisons_collection=database[Collection.SAISONS],
        filters=filters,
    )


def standing_names(response: Any) -> list[str]:
    """Every club the groups place, in the order the response ranked them."""

    return [row.name for rows in response.gruppen.root.values() for row in rows]


class TestTheBaseTierFilterSurface:
    def test_a_standings_row_carries_no_leaving_date(self):
        """Why the switch is off that surface. `austritt_type` is no substitute: it records leaving a SEASON, not leaving the league."""
        assert "inactive_since" not in FLGruppenTeam.model_fields
        assert "inactive_since" in FLTeam.model_fields


@pytest.mark.db
class TestARetiredClubStaysOutOfTheBaseTierReads:
    """The whole chain against a real mongod, over the RUNNING season."""

    def test_the_corpus_really_holds_a_retired_club_in_this_seasons_group(self, seeded_url: str):
        """First, because every case below would pass just as well against a corpus where nobody had left the league.

        Retired after the season's end date, so only its `status` can be what withholds the club.
        """

        async def body(database: AsyncDatabase) -> Any:
            club = await database[Collection.TEAMS].find_one({"_id": TEAM_OIDS["Lessing"]})
            row = await database[Collection.SAISON_TEAMS].find_one({"team_id": TEAM_OIDS["Lessing"], "saison_id": SAISON})
            saison = await database[Collection.SAISONS].find_one({"_id": SAISON})

            return club, row, saison

        club, row, saison = on_a_league(seeded_url, body)

        assert club["inactive_since"] == RETIRED_ON
        assert row["gruppe"] == "A"
        assert saison["status"] == "active"
        assert club["inactive_since"] > saison["end_date"]

    def test_the_tabelle_leaves_it_out(self, seeded_url: str):
        response = on_a_league(seeded_url, read_tabelle)

        assert standing_names(response) == ["Helmholtz"]

    def test_the_season_s_club_list_leaves_it_out_as_well(self, seeded_url: str):
        response = on_a_league(seeded_url, read_saison_teams)

        assert [team.name for team in response.teams] == ["Helmholtz"]

    def test_the_admin_read_still_un_hides_it(self, seeded_url: str):
        """Non-vacuity as well as the rule: the same corpus, one tier along, answers with the club every case above refused."""
        filters = FLTeamsFilterParams(saison_id=SAISON, include_inactive=True)
        response = on_a_league(seeded_url, lambda database: read_teams_admin(database, filters))

        assert sorted(team.name for team in response.teams) == ["Helmholtz", "Lessing"]


@pytest.mark.db
class TestAPastSeasonKeepsTheRetiredClubsThatPlayedIt:
    """A finished season's table has to add up with the fixtures it still shows."""

    def test_the_tabelle_keeps_them(self, seeded_url: str):
        response = on_a_league(seeded_url, lambda database: read_tabelle(database, PAST_SAISON))

        assert sorted(standing_names(response)) == ["Goethe", "Helmholtz", "Lessing"]

    def test_the_season_s_club_list_keeps_them_as_well(self, seeded_url: str):
        response = on_a_league(seeded_url, lambda database: read_saison_teams(database, PAST_SAISON))

        assert sorted(team.name for team in response.teams) == ["Goethe", "Helmholtz", "Lessing"]

    def test_the_corpus_really_holds_a_club_retired_before_the_closed_seasons_end_date(self, seeded_url: str):
        """The early activation: a match on the end date rather than on `status` drops Goethe from both cases above."""

        saison = on_a_league(seeded_url, lambda database: database[Collection.SAISONS].find_one({"_id": PAST_SAISON}))

        assert (saison["status"], GOETHE_RETIRED_ON < saison["end_date"]) == ("past", True)

    @pytest.mark.parametrize(
        ("include_inactive", "listed"),
        [
            pytest.param(False, [], id="the base read"),
            # Non-vacuity: the admin switch reaches the row the retirement match withheld.
            pytest.param(True, ["Lessing"], id="the admin switch"),
        ],
    )
    def test_a_season_the_read_cannot_find_keeps_every_retired_club_out(self, seeded_url: str, include_inactive: bool, listed: list[str]):
        """A season with no document is no evidence anybody finished it."""

        async def body(database: AsyncDatabase) -> list[Any]:
            filters = FLTeamsFilterParams(saison_id=UNDATED_SAISON, include_inactive=include_inactive)

            return await (await database[Collection.TEAMS].aggregate(build_team_pipeline(filters=filters, rules=None))).to_list(length=None)

        assert [row["name"] for row in on_a_league(seeded_url, body)] == listed


GRUPPENPHASE_SPIELTAG = ObjectId("6890a1b2c3d4e5f607420101")
FINALE_SPIELTAG = ObjectId("6890a1b2c3d4e5f607420102")
FINALE = ObjectId("6890a1b2c3d4e5f607420103")


SHORTHANDS = {"Helmholtz": "HGX", "Lessing": "LEX", "Goethe": "GOX"}


def side(key: str, tore: int) -> dict[str, Any]:
    """A side as a fixture stores it: the club and its goals, its name joined at read."""

    return {"team_id": TEAM_OIDS[key], "tore": tore}


def fixture(spiel_id: ObjectId, nr: int, saison_id: str, **overrides: Any) -> dict[str, Any]:
    return {
        **documents.spiel_document(
            spiel_id=spiel_id,
            saison_id=saison_id,
            spiel_nr=nr,
            spieltag_id=GRUPPENPHASE_SPIELTAG,
            datum=f"{saison_id}-03-15",
            uhrzeit="14:00:00",
        ),
        **overrides,
    }


def played_group(saison_id: str) -> list[dict[str, Any]]:
    """Group A played out, Lessing winning both of its fixtures: its placing is first wherever it holds one.

    And a Finale drawn from the group's first two placings, which the resolution fills.
    """

    return [
        fixture(ObjectId("6890a1b2c3d4e5f607420111"), 1, saison_id, team1=side("Lessing", 5), team2=side("Helmholtz", 0), ergebnis="5:0"),
        fixture(ObjectId("6890a1b2c3d4e5f607420112"), 2, saison_id, team1=side("Lessing", 5), team2=side("Goethe", 0), ergebnis="5:0"),
        fixture(ObjectId("6890a1b2c3d4e5f607420113"), 3, saison_id, team1=side("Helmholtz", 2), team2=side("Goethe", 1), ergebnis="2:1"),
        fixture(
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
class TestTheBaseTierReadsWithholdTheJunctionsContactRecords:
    """Three people's email, phone number and date of birth sit on the junction row, and both base-tier team reads join it."""

    def test_the_corpus_really_stores_them(self, seeded_url: str):
        """First, because every case below would pass just as well against a season whose rows carried no contacts at all."""

        async def body(database: AsyncDatabase) -> Any:
            return await database[Collection.SAISON_TEAMS].find_one({"team_id": TEAM_OIDS["Helmholtz"]})

        row = on_a_league(seeded_url, body)

        assert row["kontakte"]["trainer"]["email"] == KONTAKT_EMAIL
        assert row["kontakte"]["stellvertretung"]["geburtsdatum"] == KONTAKT_GEBURTSDATUM

    def test_the_aggregation_carries_none_of_it_back(self, seeded_url: str):
        """The RAW documents, before any model sees them: what the driver returned is what a leak would have to travel in."""

        async def body(database: AsyncDatabase) -> Any:
            filters = FLTeamsFilterParams(saison_id=SAISON)
            rules = FLSaisonRules.model_validate(saison_document()["rules"])
            pipeline = build_team_pipeline(filters=filters, rules=rules)

            return await (await database[Collection.TEAMS].aggregate(pipeline)).to_list(length=None)

        rows = on_a_league(seeded_url, body)

        assert rows, "the pipeline matched nothing, so withholding is not what this proves"
        for row in rows:
            assert "kontakte" not in row
            assert KONTAKT_TELEFON not in repr(row)

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
        assert KONTAKT_GEBURTSDATUM not in response.model_dump_json()
