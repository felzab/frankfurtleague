from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.einladungen.services import EINLADUNG_UNBEKANNT
from app.api.registrierungen.public_router import post_einladung_ansicht, post_registrierung
from app.api.registrierungen.schemas import FLEinladungAnsichtPayload, FLPostRegistrierungPayload
from app.api.registrierungen.services import (
    REGISTRIERUNG_ADRESSE_GESPERRT,
    REGISTRIERUNG_FENSTER_GESCHLOSSEN,
    REGISTRIERUNG_KADER_VOLL,
    REGISTRIERUNG_STUFE_NICHT_ERLAUBT,
    REGISTRIERUNG_TEAM_NICHT_EINGETRAGEN,
)
from app.api.saisons.cache import invalidate_saison_cache
from app.api.sperrliste.services import adresse_hash, compose_gesperrt_bis_saison_id
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException
from app.shared.folding import canonical_address
from app.shared.schemas.bounds import REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE
from tests.config import build_test_config
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

# Module level: every case below reaches a real mongod, the write being one transaction.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_registrierung_submission_test")

CONFIG = build_test_config()

SAISON_ID = "2026"
# A season the league has not reached, whose link a pupil may already hold: the pair a ban is
# counted over, the reference season being the running one rather than this.
SPAETERE_SAISON_ID = "2027"
TODAY = "2026-04-01"
# The deadline the submission stores, derived from the bound rather than spelled: a raised bound
# must move this expectation with it.
FRIST = "2026-04-08"

# Fixed rather than generated, so a failure names the same row every run.
TEAM_OID = ObjectId("6890a1b2c3d4e5f607960001")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607960002")
EINLADUNG_OID = ObjectId("6890a1b2c3d4e5f607960003")
OTHER_EINLADUNG_OID = ObjectId("6890a1b2c3d4e5f607960004")
REVOKED_EINLADUNG_OID = ObjectId("6890a1b2c3d4e5f607960005")
SPAETERE_EINLADUNG_OID = ObjectId("6890a1b2c3d4e5f607960006")

# The raw link values, which exist in the seed and in a recipient's inbox and nowhere else.
TOKEN = "hwGqQ4kP6yJr3VnZbT8sXeM2dLuF9aCwR1oY5iN7pKg"
OTHER_TOKEN = "3pLm9XqW2vTc7bYhK4sD8fRn6gJz1uE5aQoI0wN3yVt"
REVOKED_TOKEN = "Zt5rYb8nK2wQ7xM4jL9cV6sD1fH3gP0aU5eI7oT2mXk"
SPAETERE_TOKEN = "Qw7eR2tY5uI8oP1aS4dF7gH0jK3lZ6xC9vB2nM5qW8e"

TEAM_NAME = "Zorbanax"
TEAM_FULL_NAME = "Zorbanax-Gesamtschule"
OTHER_TEAM_NAME = "Quillhilde"

PUPIL_EMAIL = "thessaly@beispielschule.de"
BANNED_EMAIL = "wraxlington@beispielschule.de"

OPEN_WINDOW: Mapping[str, Any] = {"offen": True, "von": "2026-03-01", "bis": "2026-04-30"}

RULES: Mapping[str, Any] = {
    "win_points": 3,
    "draw_points": 1,
    "qualifiers_per_group": 2,
    "number_of_groups": 2,
    "teams_per_group": 2,
    "tiebreak_order": "tordifferenz",
    "max_kadergroesse": 2,
    "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
    # Narrowed to two of the six, so a refusal is told from an accident.
    "erlaubte_stufen": ["Q1", "Q2"],
}

ADDRESS: Mapping[str, Any] = {
    "strasse": "Hanauer Landstraße",
    "hausnummer": "12a",
    "plz": "60314",
    "stadtteil": "Ostend",
    "stadt": "Frankfurt am Main",
}


def club_document(team_id: ObjectId, name: str) -> dict[str, Any]:
    return {
        "_id": team_id,
        "name": name,
        "shorthand": name[:2].upper(),
        "description": "",
        "full_name": f"{name}-Gesamtschule",
        "website_url": f"https://{name.lower()}.example.de",
        "schulform": "gesamtschule",
        "address": dict(ADDRESS),
        "inactive_since": None,
    }


def einladung_document(
    einladung_id: ObjectId, team_id: ObjectId, token: str, *, widerrufen_am: str | None = None, saison_id: str = SAISON_ID
) -> dict[str, Any]:
    return {
        "_id": einladung_id,
        "saison_id": saison_id,
        "team_id": team_id,
        "token_hash": hash_token(token),
        "erstellt_am": "2026-03-15",
        "erstellt_von": "admin@frankfurtleague.de",
        "widerrufen_am": widerrufen_am,
        "versand": {},
    }


def payload(**overrides: Any) -> dict[str, Any]:
    """A whole registration, valid, that each case moves one field of."""

    return {
        "token": TOKEN,
        "vorname": "Thessaly",
        "nachname": "Okonkwo-Brandt",
        "email": PUPIL_EMAIL,
        "position": "Mittelfeld",
        "nummer": "17",
        "stufe": "Q1",
        **overrides,
    }


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def saison_document(saison_id: str, status: str, registrierung: Any) -> dict[str, Any]:
    return {
        "_id": saison_id,
        "start_date": f"{saison_id}-01-01",
        "end_date": f"{saison_id}-06-30",
        "status": status,
        "rules": dict(RULES),
        "bewerbung": None,
        "registrierung": None if registrierung is None else dict(registrierung),
    }


def junction_document(saison_id: str, team_id: ObjectId, name: str) -> dict[str, Any]:
    return {
        "saison_id": saison_id,
        "team_id": team_id,
        "gruppe": "A",
        "austritt": None,
        "name": name,
        "shorthand": name[:2].upper(),
    }


def on_a_league(
    url: str,
    body: Body,
    *,
    registrierung: Any = OPEN_WINDOW,
    squad: int = 0,
    banned: str | None = None,
    banned_bis: str | None = None,
    saison_status: str = "active",
    spaetere_saison: bool = False,
    matchday_beginn: str | None = None,
    knockout_beginn: str | None = None,
) -> Any:
    """The SHIPPED validators and indexes, so a document production would refuse fails here too.

    A junction row for the FIRST club alone, and a live invite for each: the second club's link is
    what makes the junction refusal reachable.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            # The season cache is PROCESS-WIDE and outlives a clean database, so a case seeding a
            # league of one status would otherwise be judged from the season its predecessor left
            # cached.
            invalidate_saison_cache()

            await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, saison_status, registrierung))
            await database[Collection.TEAMS].insert_many([club_document(TEAM_OID, TEAM_NAME), club_document(OTHER_TEAM_OID, OTHER_TEAM_NAME)])
            await database[Collection.SAISON_TEAMS].insert_one(junction_document(SAISON_ID, TEAM_OID, TEAM_NAME))
            await database[Collection.EINLADUNGEN].insert_many(
                [
                    einladung_document(EINLADUNG_OID, TEAM_OID, TOKEN),
                    einladung_document(OTHER_EINLADUNG_OID, OTHER_TEAM_OID, OTHER_TOKEN),
                    einladung_document(REVOKED_EINLADUNG_OID, TEAM_OID, REVOKED_TOKEN, widerrufen_am="2026-03-20"),
                ]
            )

            # A later season the same team plays, with a link of its own: the reference season is
            # then the running one and the invite's is not, which is the pair a ban is counted over.
            if spaetere_saison:
                await database[Collection.SAISONS].insert_one(saison_document(SPAETERE_SAISON_ID, "future", registrierung))
                await database[Collection.SAISON_TEAMS].insert_one(junction_document(SPAETERE_SAISON_ID, TEAM_OID, TEAM_NAME))
                await database[Collection.EINLADUNGEN].insert_one(
                    einladung_document(SPAETERE_EINLADUNG_OID, TEAM_OID, SPAETERE_TOKEN, saison_id=SPAETERE_SAISON_ID)
                )

            if squad:
                await database[Collection.SAISON_SPIELER].insert_many(
                    [
                        {
                            "_id": ObjectId(),
                            "spieler_id": ObjectId(),
                            "saison_id": SAISON_ID,
                            "team_id": TEAM_OID,
                            "ist_nachnominiert": False,
                            "stufe": "Q1",
                            "position": "Abwehr",
                            "nummer": str(seat),
                            "inactive_since": None,
                        }
                        for seat in range(squad)
                    ]
                )

            if banned is not None:
                await database[Collection.SPERRLISTE].insert_one(
                    {
                        "_id": ObjectId(),
                        "adresse_hash": adresse_hash(banned, schluessel=CONFIG.sperrliste_schluessel),
                        "schluessel_version": "sperrliste-v1",
                        "grund": "Falsches Geburtsdatum bei der Anmeldung",
                        "erstellt_von": "admin@frankfurtleague.de",
                        "erstellt_am": "2026-03-15",
                        # Composed by the production helper rather than spelled: a hand-written bound
                        # that drifted from it would leave these cases passing over a lapsed row.
                        "gesperrt_bis_saison_id": banned_bis or compose_gesperrt_bis_saison_id(massgebliche_saison_id=SAISON_ID),
                    }
                )

            if matchday_beginn is not None:
                await database[Collection.SPIELTAGE].insert_one(
                    {
                        "_id": ObjectId(),
                        "beginn": matchday_beginn,
                        "ende": matchday_beginn,
                        "saison_phase": "gruppenphase",
                        "saison_id": SAISON_ID,
                        "position": 1,
                    }
                )

            # A knockout matchday ALSO at position 1, `position` restarting in every phase: seeded
            # with an earlier first day, so a read taking any position-1 row answers this one.
            if knockout_beginn is not None:
                await database[Collection.SPIELTAGE].insert_one(
                    {
                        "_id": ObjectId(),
                        "beginn": knockout_beginn,
                        "ende": knockout_beginn,
                        "saison_phase": "achtelfinale",
                        "saison_id": SAISON_ID,
                        "position": 1,
                    }
                )

            try:
                return await body(database, client)
            finally:
                # `finally`, so a case that raises still leaves the cache empty for the next one.
                invalidate_saison_cache()

    return on_the_seed_loop(_run())


async def register(database: AsyncDatabase, client: AsyncMongoClient, **overrides: Any) -> Any:
    return await post_registrierung(
        registrierung_data=FLPostRegistrierungPayload.model_validate(payload(**overrides)),
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        einladungen_collection=database[Collection.EINLADUNGEN],
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        sperrliste_collection=database[Collection.SPERRLISTE],
        db=client,
        config=CONFIG,
        today=TODAY,
    )


async def ansicht(database: AsyncDatabase, *, token: str = TOKEN) -> Any:
    return await post_einladung_ansicht(
        ansicht_data=FLEinladungAnsichtPayload(token=token),
        einladungen_collection=database[Collection.EINLADUNGEN],
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        spieltage_collection=database[Collection.SPIELTAGE],
        teams_collection=database[Collection.TEAMS],
        today=TODAY,
    )


async def rows_of(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    return [row async for row in database[Collection.REGISTRIERUNGEN].find().sort("_id", 1)]


class TestWhatASubmissionStores:
    """The document the shipped `$jsonSchema` accepts, which is the only shape a later read can rely on."""

    def test_the_stored_key_set_is_exactly_the_declared_one(self, mongo_replica_set_url: str):
        """An EQUALITY, so a late-entry marker of either spelling fails here rather than riding along unnoticed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Mapping[str, Any]:
            await register(database, client)
            stored = await database[Collection.REGISTRIERUNGEN].find_one({})

            assert stored is not None
            return stored

        stored = on_a_league(mongo_replica_set_url, body)

        assert set(stored) == {
            "_id",
            "saison_id",
            "team_id",
            "einladung_id",
            "eingereicht_am",
            "status",
            "vorname",
            "nachname",
            "email",
            "position",
            "nummer",
            "stufe",
            "geburtsdatum",
            "einwilligung",
            "bestaetigung",
            "entscheidung",
        }

    def test_the_row_names_the_invite_the_team_and_the_season_it_was_opened_with(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Mapping[str, Any]:
            await register(database, client)
            stored = await database[Collection.REGISTRIERUNGEN].find_one({})

            assert stored is not None
            return stored

        stored = on_a_league(mongo_replica_set_url, body)

        assert stored["saison_id"] == SAISON_ID
        assert stored["team_id"] == TEAM_OID
        assert stored["einladung_id"] == EINLADUNG_OID
        assert stored["status"] == "eingereicht"
        assert stored["eingereicht_am"] == TODAY
        # Present and null, never absent: the confirmation fills the first two and a decline the third.
        assert stored["geburtsdatum"] is None
        assert stored["einwilligung"] is None
        assert stored["entscheidung"] is None

    def test_the_stored_block_holds_the_hash_of_the_token_the_answer_carried(self, mongo_replica_set_url: str):
        """The link is recoverable from no read: what the database holds is the hash of what the response answered."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, Mapping[str, Any]]:
            response = await register(database, client)
            stored = await database[Collection.REGISTRIERUNGEN].find_one({})

            assert stored is not None
            return response, stored

        response, stored = on_a_league(mongo_replica_set_url, body)

        assert stored["bestaetigung"]["token_hash"] == hash_token(response.bestaetigung_token)
        assert response.bestaetigung_token not in str(stored)
        # Both off the invite, never off the body: the mail addresses the pupil by them.
        assert (response.team, response.saison_id) == (TEAM_NAME, SAISON_ID)
        assert stored["bestaetigung"]["verschickt_am"] == TODAY
        assert stored["bestaetigung"]["erinnert_am"] is None

    def test_the_deadline_is_the_bounds_own_days_after_the_mint(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await register(database, client)
            stored = await database[Collection.REGISTRIERUNGEN].find_one({})

            assert stored is not None
            return response, stored

        response, stored = on_a_league(mongo_replica_set_url, body)

        assert REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE == 7
        assert response.frist == FRIST
        assert stored["bestaetigung"]["frist"] == FRIST

    def test_neither_a_person_nor_a_squad_row_is_written(self, mongo_replica_set_url: str):
        """Nothing about a pending registration reaches the two collections an admission writes."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, int]:
            await register(database, client)

            return (
                await database[Collection.SPIELER].count_documents({}),
                await database[Collection.SAISON_SPIELER].count_documents({}),
            )

        assert on_a_league(mongo_replica_set_url, body) == (0, 0)


class TestWhatASubmissionIsRefused:
    """Each refusal, driven against the shipped validators, storing nothing."""

    def test_a_revoked_link_is_refused_and_stores_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int]:
            with pytest.raises(DocumentConflictException) as refused:
                await register(database, client, token=REVOKED_TOKEN)

            return refused.value.error_code, await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body) == (EINLADUNG_UNBEKANNT, 0)

    def test_a_link_no_row_holds_is_refused_with_the_same_code(self, mongo_replica_set_url: str):
        """ONE answer for unknown and for revoked: nothing tells a stranger's guess from a replaced link."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            with pytest.raises(DocumentConflictException) as refused:
                await register(database, client, token="notatokenanybodyeverminted1234567890abcdef")

            return refused.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == EINLADUNG_UNBEKANNT

    def test_a_shut_window_is_refused_and_stores_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int]:
            with pytest.raises(DocumentConflictException) as refused:
                await register(database, client)

            return refused.value.error_code, await database[Collection.REGISTRIERUNGEN].count_documents({})

        outcome = on_a_league(mongo_replica_set_url, body, registrierung={**OPEN_WINDOW, "offen": False})

        assert outcome == (REGISTRIERUNG_FENSTER_GESCHLOSSEN, 0)

    def test_a_link_opened_after_the_windows_last_day_is_refused(self, mongo_replica_set_url: str):
        """The invite carries no expiry of its own: the window is what it stops opening at."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            with pytest.raises(DocumentConflictException) as refused:
                await register(database, client)

            return refused.value.error_code

        outcome = on_a_league(mongo_replica_set_url, body, registrierung={**OPEN_WINDOW, "bis": "2026-03-31"})

        assert outcome == REGISTRIERUNG_FENSTER_GESCHLOSSEN

    def test_a_season_that_has_ended_is_refused_while_its_dates_still_run(self, mongo_replica_set_url: str):
        """The window's dates run and its flag is on: only the season's status closes it, as minting the link already does."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int]:
            with pytest.raises(DocumentConflictException) as refused:
                await register(database, client)

            return refused.value.error_code, await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body, saison_status="past") == (REGISTRIERUNG_FENSTER_GESCHLOSSEN, 0)

    def test_a_team_the_season_does_not_hold_is_refused(self, mongo_replica_set_url: str):
        """The second club's own live link, for a club with no junction row: the invite opens and the write refuses."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int]:
            with pytest.raises(DocumentConflictException) as refused:
                await register(database, client, token=OTHER_TOKEN)

            return refused.value.error_code, await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body) == (REGISTRIERUNG_TEAM_NICHT_EINGETRAGEN, 0)

    def test_a_stufe_the_season_does_not_offer_is_refused_and_stores_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int]:
            with pytest.raises(DocumentConflictException) as refused:
                await register(database, client, stufe="E1")

            return refused.value.error_code, await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body) == (REGISTRIERUNG_STUFE_NICHT_ERLAUBT, 0)

    def test_a_full_squad_is_refused_and_stores_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int]:
            with pytest.raises(DocumentConflictException) as refused:
                await register(database, client)

            return refused.value.error_code, await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body, squad=RULES["max_kadergroesse"]) == (REGISTRIERUNG_KADER_VOLL, 0)

    def test_a_retired_squad_row_gives_its_place_back(self, mongo_replica_set_url: str):
        """Counted as the squad editor counts: a player who left the squad is not holding a place."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await database[Collection.SAISON_SPIELER].update_one({}, {"$set": {"inactive_since": "2026-03-20"}})
            await register(database, client)

            return await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body, squad=RULES["max_kadergroesse"]) == 1

    def test_two_submissions_for_one_remaining_place_both_land(self, mongo_replica_set_url: str):
        """The declared race, pinned so a later reader does not read it as a defect.

        A registration writes into no collection the cap counts, so nothing anchors the count; the
        admission refuses the second.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await register(database, client)
            await register(database, client, email="quillhilde@beispielschule.de")

            return await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body, squad=RULES["max_kadergroesse"] - 1) == 2

    def test_a_banned_address_is_refused_and_stores_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int]:
            with pytest.raises(DocumentConflictException) as refused:
                await register(database, client, email=BANNED_EMAIL)

            return refused.value.error_code, await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body, banned=BANNED_EMAIL) == (REGISTRIERUNG_ADRESSE_GESPERRT, 0)

    def test_a_banned_address_is_refused_however_the_pupil_spells_it(self, mongo_replica_set_url: str):
        """One canonical form decides, so a ban is not lifted by typing the address in another case."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            with pytest.raises(DocumentConflictException) as refused:
                await register(database, client, email=BANNED_EMAIL.upper())

            return refused.value.error_code

        assert canonical_address(BANNED_EMAIL.upper()) == canonical_address(BANNED_EMAIL)
        assert on_a_league(mongo_replica_set_url, body, banned=BANNED_EMAIL) == REGISTRIERUNG_ADRESSE_GESPERRT

    def test_an_address_no_row_holds_registers(self, mongo_replica_set_url: str):
        """The other arm of the ban check, so a check refusing everybody would fail here rather than pass quietly."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await register(database, client)

            return await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body, banned=BANNED_EMAIL) == 1


class TestWhichSeasonABanIsCountedFrom:
    """The REFERENCE season decides, never the season the link is for.

    A pupil may hold a link for a season the league has not reached, and counting from that one
    lifts a ban early.
    """

    def test_a_ban_covering_the_running_season_refuses_a_link_for_a_later_one(self, mongo_replica_set_url: str):
        """The bound lies between the two seasons: counted from the invite's, this ban would have lapsed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            with pytest.raises(DocumentConflictException) as refused:
                await register(database, client, token=SPAETERE_TOKEN, email=BANNED_EMAIL)

            return refused.value.error_code

        outcome = on_a_league(
            mongo_replica_set_url, body, spaetere_saison=True, banned=BANNED_EMAIL, banned_bis=SAISON_ID, saison_status="active"
        )

        assert SAISON_ID < SPAETERE_SAISON_ID
        assert outcome == REGISTRIERUNG_ADRESSE_GESPERRT

    def test_a_lapsed_ban_refuses_nobody(self, mongo_replica_set_url: str):
        """The other arm, so a check ignoring the bound would pass this case as well as the one above."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await register(database, client, email=BANNED_EMAIL)

            return await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body, banned=BANNED_EMAIL, banned_bis="2025") == 1

    def test_a_league_no_season_has_run_judges_on_the_hash_alone(self, mongo_replica_set_url: str):
        """One `future` season and nothing that ever ran: the reference read answers nothing, and a ban still bars."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            with pytest.raises(DocumentConflictException) as refused:
                await register(database, client, email=BANNED_EMAIL)

            return refused.value.error_code

        outcome = on_a_league(mongo_replica_set_url, body, saison_status="future", banned=BANNED_EMAIL, banned_bis="2025")

        assert outcome == REGISTRIERUNG_ADRESSE_GESPERRT


class TestWhatTheInvitesOwnReadAnswers:
    """The read a link opens, which refuses only an invite that opens nothing."""

    def test_it_names_the_team_and_the_school_the_consent_copy_renders(self, mongo_replica_set_url: str):
        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await ansicht(database)

        answer = on_a_league(mongo_replica_set_url, run)

        assert answer.team == TEAM_NAME
        assert answer.schule == TEAM_FULL_NAME
        assert answer.saison_id == SAISON_ID

    def test_it_answers_the_set_the_form_may_offer(self, mongo_replica_set_url: str):
        """The read and the write are one field, so a form offering more than this is a drifted client."""

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await ansicht(database)

        assert on_a_league(mongo_replica_set_url, run).erlaubte_stufen == list(RULES["erlaubte_stufen"])

    def test_a_shut_window_is_a_state_rather_than_a_refusal(self, mongo_replica_set_url: str):
        """A link pasted after the deadline reads as closed rather than as invalid."""

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await ansicht(database)

        answer = on_a_league(mongo_replica_set_url, run, registrierung={**OPEN_WINDOW, "offen": False})

        assert answer.laeuft is False

    def test_a_season_that_has_ended_reads_as_a_shut_window(self, mongo_replica_set_url: str):
        """The page renders `laeuft` alone, so a `past` season answering true offers a form every submission of which is refused."""

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, bool]:
            answer = await ansicht(database)

            return answer.saison_status, answer.laeuft

        assert on_a_league(mongo_replica_set_url, run, saison_status="past") == ("past", False)

    def test_a_revoked_link_is_refused(self, mongo_replica_set_url: str):
        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            with pytest.raises(DocumentConflictException) as refused:
                await ansicht(database, token=REVOKED_TOKEN)

            return refused.value.error_code

        assert on_a_league(mongo_replica_set_url, run) == EINLADUNG_UNBEKANNT

    def test_the_squad_has_room_until_the_cap_is_reached(self, mongo_replica_set_url: str):
        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> bool:
            return (await ansicht(database)).kader_frei

        assert on_a_league(mongo_replica_set_url, run) is True
        assert on_a_league(mongo_replica_set_url, run, squad=RULES["max_kadergroesse"]) is False

    def test_the_nachnominierung_verdict_turns_on_matchday_ones_first_day(self, mongo_replica_set_url: str):
        """False before it, true on it, and false again where matchday 1 carries no date at all."""

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> bool:
            return (await ansicht(database)).nachnominierung

        assert on_a_league(mongo_replica_set_url, run, matchday_beginn="2026-04-02") is False
        assert on_a_league(mongo_replica_set_url, run, matchday_beginn=TODAY) is True
        assert on_a_league(mongo_replica_set_url, run) is False

    def test_a_knockout_matchday_at_position_one_decides_nothing(self, mongo_replica_set_url: str):
        """`position` restarts in every phase, so the read narrows to the first phase too.

        The knockout row carries an EARLIER first day: a read taking any position-1 row answers
        true, where the group phase has not begun.
        """

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> bool:
            return (await ansicht(database)).nachnominierung

        outcome = on_a_league(mongo_replica_set_url, run, matchday_beginn="2026-04-02", knockout_beginn="2026-03-20")

        assert outcome is False

    def test_a_team_the_season_does_not_hold_is_a_state_the_page_can_word(self, mongo_replica_set_url: str):
        """The second club's link opens: the read answers rather than refusing, and says the team is not entered.

        Without this the page renders a whole form whose every submission meets
        `REQ-REGISTRIERUNG-002` after the pupil has typed their name and address.
        """

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[bool, bool]:
            entered = await ansicht(database)
            not_entered = await ansicht(database, token=OTHER_TOKEN)

            return entered.team_eingetragen, not_entered.team_eingetragen

        assert on_a_league(mongo_replica_set_url, run) == (True, False)

    def test_a_future_season_is_read_and_registered_for(self, mongo_replica_set_url: str):
        """The withheld-season guard is waived on both operations, and a season taking registrations is normally `future`.

        Calling `refuse_withheld_saison` here would 404 the whole flow; the invite is the
        authorisation instead.
        """

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int]:
            answer = await ansicht(database)
            await register(database, client)

            return answer.saison_status, await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, run, saison_status="future") == ("future", 1)
