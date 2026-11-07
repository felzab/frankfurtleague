from collections.abc import Awaitable, Callable, Sequence
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.teams.admin_router import delete_team, get_team_saison_admin, get_teams_admin, patch_team_saison, post_team_entry
from app.api.teams.schemas import FLPatchTeamSaisonPayload, FLPostTeamEntryPayload, FLTeamListState, FLTeamsAdminFilterParams
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from tests.bans import ban_list
from tests.config import grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import (
    ADDRESS,
    kontaktperson_document,
    rules_document,
    saison_document,
    saison_team_document,
    spiel_document,
    team_document,
)
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_team_saison_admin_test")

SAISON_ID = "2026"
TODAY = "2026-04-15"
OPERATOR = str(grants_for_the_suite()[0]["address"])

ADLER = ObjectId("6890a1b2c3d4e5f607280001")
BIEBER = ObjectId("6890a1b2c3d4e5f607280002")
# In the league, in no season.
CRONBERG = ObjectId("6890a1b2c3d4e5f607280003")
# Retired, in no season.
DORNBUSCH = ObjectId("6890a1b2c3d4e5f607280004")
EULE = ObjectId("6890a1b2c3d4e5f607280005")
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f6072800f1")

# Two groups of two, so the two rows in B fill it and a move into it is refused.
RULES = rules_document(number_of_gruppen=2, teams_per_gruppe=2, allowed_stufen=["E1", "Q1"])

EXIT = {"type": "rueckzug", "reason": "Zu wenige Spieler", "date": "2026-04-01"}

Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_league(
    url: str,
    body: Body,
    *,
    saison_status: str = "future",
    rows: Sequence[dict[str, Any]] = (),
    spiele: Sequence[dict[str, Any]] = (),
) -> Any:
    """A season holding `ADLER` in A and `BIEBER` and `EULE` in B, one club outside it and one retired."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, saison_status, rules=dict(RULES)))
            await database[Collection.TEAMS].insert_many(
                [
                    team_document(ADLER, "Adler", "ADL", version=0),
                    team_document(BIEBER, "Bieber", "BIE", version=0),
                    team_document(CRONBERG, "Cronberg", "CRO", version=0),
                    team_document(DORNBUSCH, "Dornbusch", "DOR", version=0, inactive_since="2025-07-01"),
                    team_document(EULE, "Eule", "EUL", version=0),
                ]
            )
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    saison_team_document(SAISON_ID, ADLER, "Adler", "ADL", gruppe="A"),
                    saison_team_document(SAISON_ID, BIEBER, "Bieber", "BIE", gruppe="B"),
                    saison_team_document(SAISON_ID, EULE, "Eule", "EUL", gruppe="B"),
                    *rows,
                ]
            )
            if spiele:
                await database[Collection.SPIELE].insert_many(list(spiele))
            await database[Collection.GRANTS].insert_many(grants_for_the_suite())

            return await body(database)

    return on_the_seed_loop(_run())


def club_fields(**changed: Any) -> dict[str, Any]:
    return {
        "name": "Adler",
        "shorthand": "ADL",
        "description": "",
        "full_name": "Adler-Schule",
        "website_url": None,
        "address": dict(ADDRESS),
        "schulform": None,
        **changed,
    }


async def save(database: AsyncDatabase, *, version: int = 0, gruppe: str = "A", trikot_farbe: str | None = None, **club: Any) -> Any:
    return await patch_team_saison(
        team_id=ADLER,
        saison_id=SAISON_ID,
        team_data=FLPatchTeamSaisonPayload.model_validate(
            {**club_fields(**club), "gruppe": gruppe, "trikot_farbe": trikot_farbe, "version": version}
        ),
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        db=database.client,
    )


async def editor(database: AsyncDatabase, team_id: ObjectId = ADLER) -> Any:
    return await get_team_saison_admin(
        team_id=team_id,
        saison_id=SAISON_ID,
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        invitations_collection=database[Collection.INVITATIONS],
        address_changes_collection=database[Collection.ADDRESS_CHANGES],
        grants_collection=database[Collection.GRANTS],
        outbox_collection=database[Collection.OUTBOX],
        ban_list=ban_list(database),
        today=TODAY,
        operator=OPERATOR,
        auth_time=0,
    )


async def listing(database: AsyncDatabase, *, state: FLTeamListState | None = None, gruppe: str | None = None) -> Any:
    return await get_teams_admin(
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        filters=FLTeamsAdminFilterParams.model_validate({"saison_id": SAISON_ID, "state": state, "gruppe": gruppe}),
    )


async def enter(database: AsyncDatabase, club: dict[str, Any], *, gruppe: str = "A", trikot_farbe: str | None = "rot") -> Any:
    return await post_team_entry(
        saison_id=SAISON_ID,
        entry_data=FLPostTeamEntryPayload.model_validate({"club": club, "gruppe": gruppe, "trikot_farbe": trikot_farbe}),
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        db=database.client,
    )


async def club_now(database: AsyncDatabase) -> dict[str, Any]:
    found = await database[Collection.TEAMS].find_one({"_id": ADLER})
    assert found is not None

    return found


async def row_now(database: AsyncDatabase, saison_id: str = SAISON_ID) -> dict[str, Any]:
    found = await database[Collection.SAISON_TEAMS].find_one({"team_id": ADLER, "saison_id": saison_id})
    assert found is not None

    return found


class TestTheOneSave:
    """The editor's save spans two collections, so its harm is a half: a field shown as saved that is not, or the reverse."""

    def test_a_refused_row_part_saves_none_of_the_club(self, mongo_replica_set_url: str):
        """Judged ahead of every write: a group move the row refuses leaves the rename unsaved, so the save is whole or nothing."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(APIError) as refused:
                await save(database, gruppe="B", name="Adler neu")

            return refused.value.error_code, await club_now(database), await row_now(database)

        code, club, row = on_a_league(mongo_replica_set_url, body)

        assert code == Code.ENTRY_GRUPPE_FULL
        assert (club["name"], club["version"]) == ("Adler", 0)
        assert (row["name"], row["version"]) == ("Adler", 0)

    def test_a_colour_moved_onto_another_row_s_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            await database[Collection.SAISON_TEAMS].update_one({"team_id": BIEBER}, {"$set": {"trikot_farbe": "rot"}})
            with pytest.raises(APIError) as refused:
                await save(database, trikot_farbe="rot")

            return refused.value, await row_now(database)

        refusal, row = on_a_league(mongo_replica_set_url, body)

        assert (refusal.error_code, refusal.fields) == (Code.TRIKOT_FARBE_TAKEN, (("trikot_farbe",),))
        assert row["trikot_farbe"] is None

    def test_a_stored_pair_of_colours_locks_neither_club_s_other_fields(self, mongo_replica_set_url: str):
        """A pair the ruling found standing: refused on every save, the rename would need the other club's colour moved first."""

        async def body(database: AsyncDatabase) -> Any:
            await database[Collection.SAISON_TEAMS].update_many({"team_id": {"$in": [ADLER, BIEBER]}}, {"$set": {"trikot_farbe": "rot"}})
            await save(database, trikot_farbe="rot", name="Adler neu")

            return await club_now(database)

        assert on_a_league(mongo_replica_set_url, body)["name"] == "Adler neu"

    @pytest.mark.parametrize("moved", [Collection.TEAMS, Collection.SAISON_TEAMS])
    def test_a_write_to_either_document_stales_the_save(self, mongo_replica_set_url: str, moved: Collection):
        """One count over two documents: judged on the club alone, a seat confirmed under the editor would go unseen."""

        async def body(database: AsyncDatabase) -> Any:
            served = (await editor(database)).version
            await database[moved].update_one(
                {"team_id": ADLER} if moved == Collection.SAISON_TEAMS else {"_id": ADLER}, {"$inc": {"version": 1}}
            )
            with pytest.raises(APIError) as refused:
                await save(database, version=served, name="Adler neu")

            return refused.value.error_code, (await club_now(database))["name"]

        assert on_a_league(mongo_replica_set_url, body) == (Code.VERSION_STALE, "Adler")

    def test_the_answer_is_the_version_the_next_read_serves(self, mongo_replica_set_url: str):
        """A rename's fan-out raises the row a second time, so an answer counting one write stales the editor's own next save."""

        async def body(database: AsyncDatabase) -> Any:
            answer = await save(database, name="Adler neu", trikot_farbe="rot")
            served = (await editor(database)).version
            second = await save(database, version=answer.version, name="Adler neu", trikot_farbe="blau")

            return answer.version, served, second.version, (await row_now(database))["trikot_farbe"]

        first, served, second, colour = on_a_league(mongo_replica_set_url, body)

        assert first == served
        assert second > first
        assert colour == "blau"

    def test_a_finished_season_takes_the_club_and_keeps_its_row(self, mongo_replica_set_url: str):
        """A past season's row is the name it was played under, so the rename stops at the club."""

        async def body(database: AsyncDatabase) -> Any:
            answer = await save(database, name="Adler neu")

            return answer.version, await club_now(database), await row_now(database)

        version, club, row = on_a_league(mongo_replica_set_url, body, saison_status="past")

        assert club["name"] == "Adler neu"
        assert (row["name"], row["version"]) == ("Adler", 0)
        assert version == club["version"]

    @pytest.mark.parametrize("changed", [{"gruppe": "B"}, {"trikot_farbe": "rot"}], ids=["the group", "the colour"])
    def test_a_finished_season_refuses_its_row_moving_and_saves_nothing(self, mongo_replica_set_url: str, changed: dict[str, Any]):
        """Its table and podium are read off these rows, whatever else the save carries."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(APIError) as refused:
                await save(database, name="Adler neu", **changed)

            return refused.value.error_code, (await club_now(database))["name"]

        assert on_a_league(mongo_replica_set_url, body, saison_status="past") == (Code.SAISON_PAST, "Adler")


class TestTheRetirement:
    def test_a_club_in_a_running_season_stays_in_the_league(self, mongo_replica_set_url: str):
        """Only a stale page reaches this, the button being locked: retired, the club drops out of the reads and placings shift."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(APIError) as refused:
                await delete_team(
                    team_id=ADLER,
                    teams_collection=database[Collection.TEAMS],
                    saison_teams_collection=database[Collection.SAISON_TEAMS],
                    saisons_collection=database[Collection.SAISONS],
                    db=database.client,
                    today=TODAY,
                )

            return refused.value.error_code, (await club_now(database))["inactive_since"]

        assert on_a_league(mongo_replica_set_url, body, saison_status="active") == (Code.RETIRE_BLOCKED, None)


class TestTheEntry:
    def test_a_refused_entry_founds_no_club(self, mongo_replica_set_url: str):
        """The club is written first, so outside one transaction a full group leaves it in the league for nobody's asking."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(APIError) as refused:
                await enter(database, {"kind": "new", "team": club_fields(name="Eschborn", shorthand="ESC")}, gruppe="B")

            return refused.value.error_code, await database[Collection.TEAMS].count_documents({"name": "Eschborn"})

        assert on_a_league(mongo_replica_set_url, body) == (Code.ENTRY_GRUPPE_FULL, 0)

    def test_a_new_club_is_founded_and_entered_with_its_colour(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            answer = await enter(database, {"kind": "new", "team": club_fields(name="Eschborn", shorthand="ESC")})

            return await database[Collection.SAISON_TEAMS].find_one({"team_id": ObjectId(answer.team_id)})

        row = on_a_league(mongo_replica_set_url, body)

        assert row is not None
        assert (row["name"], row["shorthand"], row["gruppe"], row["trikot_farbe"], row["version"]) == ("Eschborn", "ESC", "A", "rot", 0)

    def test_a_taken_shorthand_is_refused_on_its_box(self, mongo_replica_set_url: str):
        """A retired club's among them, which the unique index would answer with no field."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(APIError) as refused:
                await enter(database, {"kind": "new", "team": club_fields(name="Eschborn", shorthand="DOR")})

            return refused.value.error_code, refused.value.fields

        assert on_a_league(mongo_replica_set_url, body) == (Code.DUPLICATE_KEY, (("shorthand",),))

    def test_a_club_the_season_holds_is_refused_by_its_code(self, mongo_replica_set_url: str):
        """A dialog left open over an acceptance: named by its code, so the screen words it where the unique index would not."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(APIError) as refused:
                await enter(database, {"kind": "known", "team_id": str(ADLER)})

            return refused.value.error_code, await database[Collection.SAISON_TEAMS].count_documents({"team_id": ADLER, "saison_id": SAISON_ID})

        code, rows = on_a_league(mongo_replica_set_url, body)

        assert (code, rows) == (Code.BEWERBUNG_PICKED_TEAM_ALREADY_ENTERED, 1)

    def test_a_colour_another_row_holds_is_refused_on_its_box_and_writes_no_row(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            await database[Collection.SAISON_TEAMS].update_one({"team_id": BIEBER}, {"$set": {"trikot_farbe": "rot"}})
            with pytest.raises(APIError) as refused:
                await enter(database, {"kind": "known", "team_id": str(CRONBERG)}, trikot_farbe="rot")

            return refused.value, await database[Collection.SAISON_TEAMS].count_documents({"team_id": CRONBERG})

        refusal, rows = on_a_league(mongo_replica_set_url, body)

        assert (refusal.error_code, refusal.fields, rows) == (Code.TRIKOT_FARBE_TAKEN, (("trikot_farbe",),), 0)


class TestTheList:
    def test_only_the_retired_filter_reads_past_the_seasons_rows(self, mongo_replica_set_url: str):
        """A retired club holds no row of the season, so nothing else leads to the page that brings it back."""

        async def body(database: AsyncDatabase) -> Any:
            return [[row.name for row in (await listing(database, state=state)).teams] for state in (None, "retired")]

        everyone, retired = on_a_league(mongo_replica_set_url, body)

        assert everyone == ["Adler", "Bieber", "Eule"]
        assert retired == ["Dornbusch"]

    def test_a_departed_club_stands_under_its_own_state(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            await database[Collection.SAISON_TEAMS].update_one({"team_id": BIEBER}, {"$set": {"austritt": EXIT}})

            return [[row.name for row in (await listing(database, state=state)).teams] for state in ("active", "departed")]

        assert on_a_league(mongo_replica_set_url, body) == [["Adler", "Eule"], ["Bieber"]]

    def test_a_row_counts_its_seats_and_names_nobody(self, mongo_replica_set_url: str):
        """The count of confirmed seats is the list's one fact about them, on a read that carries no person."""

        async def body(database: AsyncDatabase) -> Any:
            await database[Collection.SAISON_TEAMS].update_one(
                {"team_id": ADLER},
                {
                    "$set": {
                        "kontakte": {
                            "trainer": kontaktperson_document("Ida", confirmed_at="2026-03-20"),
                            "ansprechperson": kontaktperson_document("Jonas", confirmed_at=None),
                            "stellvertretung": None,
                            "trainer_is_also": None,
                        }
                    }
                },
            )

            return (await listing(database, gruppe="A")).teams

        rows = on_a_league(mongo_replica_set_url, body)

        assert [(row.seats_filled, row.seats_confirmed) for row in rows] == [(2, 1)]

    def test_the_entry_offers_the_clubs_it_would_take(self, mongo_replica_set_url: str):
        """Neither a club already entered, which the unique index refuses, nor a retired one, which `team_retired` does."""

        async def body(database: AsyncDatabase) -> Any:
            return (await listing(database)).entry

        offer = on_a_league(mongo_replica_set_url, body)

        assert [club.name for club in offer.clubs] == ["Cronberg"]
        assert [(group.gruppe, group.full) for group in offer.gruppen] == [("A", False), ("B", True)]
        assert offer.closed is False

    @pytest.mark.parametrize("saison_status", ["active", "past"])
    def test_only_a_planned_season_offers_the_entry(self, mongo_replica_set_url: str, saison_status: str):
        async def body(database: AsyncDatabase) -> Any:
            return (await listing(database)).entry.closed

        assert on_a_league(mongo_replica_set_url, body, saison_status=saison_status) is True


class TestTheEditorRead:
    def test_a_club_outside_the_season_answers_with_no_row(self, mongo_replica_set_url: str):
        """A retired club's page is its way back, so the read answers rather than 404s."""

        async def body(database: AsyncDatabase) -> Any:
            return await editor(database, DORNBUSCH)

        view = on_a_league(mongo_replica_set_url, body)

        assert view.membership is None
        assert view.link is None
        assert view.team.inactive_since == "2025-07-01"

    def test_a_club_s_own_colour_stays_open_to_it_where_the_entry_counts_it_taken(self, mongo_replica_set_url: str):
        """An editor closing its own colour would read as refusing the save that keeps it; a row with no colour holds none."""

        async def body(database: AsyncDatabase) -> Any:
            rows = database[Collection.SAISON_TEAMS]
            await rows.update_one({"team_id": ADLER}, {"$set": {"trikot_farbe": "rot"}})
            await rows.update_one({"team_id": BIEBER}, {"$set": {"trikot_farbe": "bordeaux"}})

            return (await listing(database)).entry.taken, (await editor(database)).taken_trikot_farben

        offered, edited = on_a_league(mongo_replica_set_url, body)

        assert sorted(offered) == ["bordeaux", "rot"]
        assert edited == ["bordeaux"]

    def test_each_lock_reads_as_its_write_judges(self, mongo_replica_set_url: str):
        """A control opening where the write refuses is a press answered by a stale page."""

        spiel = spiel_document(
            spiel_id=ObjectId(), saison_id=SAISON_ID, spiel_nr=1, spieltag_id=SPIELTAG_OID, team1={"team_id": ADLER, "tore": None}
        )

        async def body(database: AsyncDatabase) -> Any:
            return await editor(database)

        view = on_a_league(mongo_replica_set_url, body, spiele=[spiel])

        assert view.gruppe_locked is True
        assert view.retire_blocked_by == SAISON_ID
        assert view.saison.begun is True

    def test_a_club_of_past_seasons_alone_blocks_no_retirement(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"status": "past"}})

            return (await editor(database)).retire_blocked_by

        assert on_a_league(mongo_replica_set_url, body) is None

    def test_the_link_box_says_what_the_press_would_do(self, mongo_replica_set_url: str):
        """The press's own plan: a box saying otherwise offers a send that mails nobody."""

        async def body(database: AsyncDatabase) -> Any:
            return (await editor(database)).link

        link = on_a_league(mongo_replica_set_url, body)

        assert link.invitation is None
        assert link.skipped == "no_kontakt_block"
        assert link.paused is False
