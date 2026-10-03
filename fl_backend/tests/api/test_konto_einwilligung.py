"""
API · a referee's own consent record, read and changed by its own person on the account page

The pupil's twin is `tests/api/test_spieler_selbst.py`, which also pins that the two PATCHes take one
payload shape; this file holds what differs on a referee row: the address stored as typed, the
ghost, and a record the confirmation has not yet written.
"""

from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from httpx2 import AsyncClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.einwilligung.services import FASSUNG_UNZULAESSIG
from app.api.identitaet.services import FUNKTION_NICHT_GEHALTEN
from app.api.konto.services import KONTO_SEITE_SCHIEDSRICHTER, SELBST_MEDIEN_ALTER
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from app.shared.einwilligung_verlauf import VERLAUF
from tests.actor_tokens import SignedActor
from tests.app_client import app_client
from tests.config import ADMIN_KEY
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import saison_document, saison_team_document, spieler_document
from tests.worker import worker_database

from .conftest import config_for

DATABASE_NAME = worker_database("fl_konto_einwilligung_test")

CONFIG = config_for(DATABASE_NAME)

PATH = f"/api/v{API_VERSION}/schiedsrichter/selbst"

NOW = datetime(2026, 10, 3, 12, 0, tzinfo=ZoneInfo("Europe/Berlin"))

# The address a referee row keeps as it was typed, and the folded form a signed-in person is bound under.
IDENTIFIER = "ortrud.zwiebelmayer@schule.de"
REFEREE_STORED = "Ortrud.Zwiebelmayer@Schule.de"
YOUNG = "jonas.jungspund@schule.de"
RETIRED = "rudolf.ruhestand@schule.de"
UNCONFIRMED = "ottilie.wartezeit@schule.de"
BYSTANDER = "baldur.krautzberger@example.com"

KONTO_PATH = f"/api/v{API_VERSION}/konto/einwilligungen"

PAST_SAISON = "2025"
ACTIVE_SAISON = "2026"
TEAM_A_OID = ObjectId("6890a1b2c3d4e5f607850001")
TEAM_B_OID = ObjectId("6890a1b2c3d4e5f607850002")
ROW_NAME_A_PAST = "Helmholtz"
ROW_NAME_A_ACTIVE = "Helmholtz-Gymnasium"
ROW_NAME_B = "Lessing"
SEAT_LABEL = "2026-09-bestaetigungsseite-6"
PUPIL_OID = ObjectId("6890a1b2c3d4e5f607850021")
NOBODY = "niemand@schule.de"

REFEREE_OID = ObjectId("6890a1b2c3d4e5f607850011")
YOUNG_OID = ObjectId("6890a1b2c3d4e5f607850012")
RETIRED_OID = ObjectId("6890a1b2c3d4e5f607850013")
UNCONFIRMED_OID = ObjectId("6890a1b2c3d4e5f607850014")
BYSTANDER_OID = ObjectId("6890a1b2c3d4e5f607850019")

CONFIRMATION_LABEL = "2026-09-schiedsrichterseite-3"
ADULT_BIRTHDATE = "2000-05-09"
SEVENTEEN_BIRTHDATE = "2008-10-04"


def _einwilligung(**fields: Any) -> dict[str, Any]:
    return {
        "umfang": "kader_oeffentlich",
        "erteilt_von": "volljaehrig",
        "datum": "2026-09-02",
        "bestaetigt_am": "2026-09-02",
        "text_version": CONFIRMATION_LABEL,
        "medien": False,
        **fields,
    }


def _referee(referee_id: ObjectId, email: str, name: str, **fields: Any) -> dict[str, Any]:
    # A name per referee: `app/core/constraints.py :: uniq_schiedsrichter_name` indexes it.
    return {
        "_id": referee_id,
        "name": name,
        "schule": "Lessing-Gymnasium",
        "default_payment": 20,
        "kontakt": {"telefon": "+49 69 5550202", "email": email},
        "inactive_since": None,
        "geburtsdatum": ADULT_BIRTHDATE,
        "einwilligung": _einwilligung(),
        **fields,
    }


def _block(einwilligung: dict[str, Any]) -> dict[str, Any]:
    """The block without its entries, which the cases on the appended record assert by themselves."""

    return {key: value for key, value in einwilligung.items() if key != VERLAUF}


def _running_label() -> str:
    return LAUFENDE_FASSUNGEN[KONTO_SEITE_SCHIEDSRICHTER]


def _payload(*, umfang: str = "kader_oeffentlich", medien: bool = False, text_version: str | None = None) -> dict[str, Any]:
    return {"umfang": umfang, "medien": medien, "text_version": text_version or _running_label()}


def _person(email: str) -> SignedActor:
    return SignedActor(email, ADMIN_KEY, lane="person")


def _seat(email: str, *, bestaetigt_am: str | None = "2026-09-03", **einwilligung: Any) -> dict[str, Any]:
    """One contact seat, confirmed by its own person unless the caller says otherwise."""

    return {
        "vorname": "Ortrud",
        "nachname": "Zwiebelmayer",
        "email": email,
        "telefon": "+49 69 5550101",
        "geburtsdatum": ADULT_BIRTHDATE,
        "einwilligung": {
            "umfang": "kontaktdaten",
            "erfasst_von": "person",
            "text_version": SEAT_LABEL,
            "datum": "2026-09-01",
            "bestaetigt_am": bestaetigt_am,
            **einwilligung,
        },
    }


def _kontakte(**seats: Any) -> dict[str, Any]:
    return {"trainer": None, "ansprechperson": None, "stellvertretung": None, "trainer_ist_zugleich": None, **seats}


async def _seed(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_many([saison_document(PAST_SAISON, "past"), saison_document(ACTIVE_SAISON, "active")])
    await database[Collection.SAISON_TEAMS].insert_many(
        [
            # One person in two slots of one past row: one entry, both seats named.
            saison_team_document(
                PAST_SAISON,
                TEAM_A_OID,
                ROW_NAME_A_PAST,
                "HE",
                kontakte=_kontakte(
                    trainer=_seat(REFEREE_STORED, medien=True),
                    ansprechperson=_seat(REFEREE_STORED, medien=True),
                    trainer_ist_zugleich="ansprechperson",
                ),
            ),
            saison_team_document(
                ACTIVE_SAISON,
                TEAM_B_OID,
                ROW_NAME_B,
                "LE",
                kontakte=_kontakte(trainer=_seat(BYSTANDER, medien=True), stellvertretung=_seat(REFEREE_STORED, medien=True)),
            ),
            # Awaiting its person's confirmation: nothing on it to change yet.
            saison_team_document(
                ACTIVE_SAISON, TEAM_A_OID, ROW_NAME_A_ACTIVE, "HE", kontakte=_kontakte(trainer=_seat(REFEREE_STORED, bestaetigt_am=None))
            ),
        ]
    )
    await database[Collection.SPIELER].insert_one(
        spieler_document(PUPIL_OID, "Ortrud", "Zwiebelmayer", email=IDENTIFIER, geburtsdatum=ADULT_BIRTHDATE, einwilligung=_einwilligung())
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            _referee(REFEREE_OID, REFEREE_STORED, "Ortrud Zwiebelmayer"),
            _referee(YOUNG_OID, YOUNG, "Jonas Jungspund", geburtsdatum=SEVENTEEN_BIRTHDATE),
            _referee(RETIRED_OID, RETIRED, "Rudolf Ruhestand", inactive_since="2026-07-01", einwilligung=_einwilligung(medien=True)),
            _referee(UNCONFIRMED_OID, UNCONFIRMED, "Ottilie Wartezeit", geburtsdatum=None, einwilligung=None),
            _referee(BYSTANDER_OID, BYSTANDER, "Baldur Krautzberger"),
            # The ghost carries the asked address too, so a read reaching it would serve a row nobody stands behind.
            _referee(GHOST_SCHIEDSRICHTER_ID, IDENTIFIER, "Niemand", inactive_since="2000-01-01"),
        ]
    )


def served[T](url: str, steps: Callable[[AsyncClient, AsyncDatabase], Awaitable[T]]) -> T:
    async def _run() -> T:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_client, database):
            await _seed(database)
            async with app_client(url, config=CONFIG, now=NOW) as http:
                return await steps(http, database)

    return on_the_seed_loop(_run())


async def _records(database: AsyncDatabase) -> dict[Any, Any]:
    return {row["_id"]: row async for row in database[Collection.SCHIEDSRICHTER].find({}, {"einwilligung": 1})}


@pytest.mark.db
class TestTheOwnRecords:
    def test_the_address_is_answered_its_own_record_whatever_case_it_was_stored_in(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, _database: AsyncDatabase) -> Any:
            return await http.get(PATH, headers=_person(IDENTIFIER.upper()))

        response = served(mongo_replica_set_url, steps)

        assert response.status_code == 200, response.text
        [record] = response.json()["schiedsrichter"]
        assert (record["schiedsrichter_id"], record["name"], record["kontakt"]["email"]) == (
            str(REFEREE_OID),
            "Ortrud Zwiebelmayer",
            REFEREE_STORED,
        )
        assert (record["erteilbar"], record["medien_angeboten"]) == (True, True)
        assert "default_payment" not in record and "bestaetigung" not in record

    def test_a_retired_record_is_served_for_its_withdrawal_alone(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, _database: AsyncDatabase) -> Any:
            return await http.get(PATH, headers=_person(RETIRED))

        [record] = served(mongo_replica_set_url, steps).json()["schiedsrichter"]

        assert (record["schiedsrichter_id"], record["erteilbar"]) == (str(RETIRED_OID), False)

    def test_a_record_awaiting_its_confirmation_is_refused(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, _database: AsyncDatabase) -> Any:
            return await http.get(PATH, headers=_person(UNCONFIRMED))

        response = served(mongo_replica_set_url, steps)

        assert (response.status_code, response.json()["error_code"]) == (403, FUNKTION_NICHT_GEHALTEN)


@pytest.mark.db
class TestTheTwoChoices:
    def test_moving_the_scope_moves_this_row_alone_writes_no_fixture_and_leaves_the_media_answer(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            before = await _records(database)
            response = await http.patch(f"{PATH}/{REFEREE_OID}/einwilligung", json=_payload(umfang="intern"), headers=_person(IDENTIFIER))
            return response, before, await _records(database), await database[Collection.SPIELE].count_documents({})

        response, before, after, spiele = served(mongo_replica_set_url, steps)

        assert response.status_code == 200, response.text
        assert _block(after[REFEREE_OID]["einwilligung"]) == {**before[REFEREE_OID]["einwilligung"], "umfang": "intern"}
        assert [(entry["akt"], entry["ueber"], entry["text_version"]) for entry in after[REFEREE_OID]["einwilligung"][VERLAUF]] == [
            ("widerrufen", "PATCH /schiedsrichter/selbst/{schiedsrichter_id}/einwilligung", _running_label())
        ]
        assert {key: value for key, value in after.items() if key != REFEREE_OID} == {
            key: value for key, value in before.items() if key != REFEREE_OID
        }
        assert spiele == 0

    def test_moving_the_media_answer_leaves_the_scope(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            response = await http.patch(f"{PATH}/{REFEREE_OID}/einwilligung", json=_payload(medien=True), headers=_person(IDENTIFIER))
            return response, await _records(database)

        response, after = served(mongo_replica_set_url, steps)

        assert response.status_code == 200, response.text
        assert _block(after[REFEREE_OID]["einwilligung"]) == _einwilligung(medien=True)
        assert [entry["akt"] for entry in after[REFEREE_OID]["einwilligung"][VERLAUF]] == ["erteilt"]


@pytest.mark.db
class TestARecordNotHeld:
    @pytest.mark.parametrize(
        ("email", "schiedsrichter_id"),
        [(IDENTIFIER, BYSTANDER_OID), (IDENTIFIER, GHOST_SCHIEDSRICHTER_ID), (UNCONFIRMED, UNCONFIRMED_OID)],
        ids=["another-persons-row", "the-ghost", "unconfirmed"],
    )
    def test_a_row_that_is_not_the_addresss_own_is_refused_and_unwritten(
        self, mongo_replica_set_url: str, email: str, schiedsrichter_id: ObjectId
    ):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            before = await _records(database)
            response = await http.patch(f"{PATH}/{schiedsrichter_id}/einwilligung", json=_payload(umfang="intern"), headers=_person(email))
            return response, before, await _records(database)

        response, before, after = served(mongo_replica_set_url, steps)

        assert (response.status_code, response.json()["error_code"]) == (403, FUNKTION_NICHT_GEHALTEN)
        assert after == before

    def test_a_grant_on_a_retired_row_is_refused_where_its_withdrawal_is_taken(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            withdrawn = await http.patch(
                f"{PATH}/{RETIRED_OID}/einwilligung", json=_payload(umfang="intern", medien=False), headers=_person(RETIRED)
            )
            granted = await http.patch(
                f"{PATH}/{RETIRED_OID}/einwilligung", json=_payload(umfang="kader_oeffentlich", medien=False), headers=_person(RETIRED)
            )
            return withdrawn, granted, await _records(database)

        withdrawn, granted, after = served(mongo_replica_set_url, steps)

        assert withdrawn.status_code == 200, withdrawn.text
        assert (granted.status_code, granted.json()["error_code"]) == (403, FUNKTION_NICHT_GEHALTEN)
        assert (after[RETIRED_OID]["einwilligung"]["umfang"], after[RETIRED_OID]["einwilligung"]["medien"]) == ("intern", False)


@pytest.mark.db
class TestTheMediaAge:
    def test_a_media_consent_below_the_floor_is_refused_and_unwritten(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            before = await _records(database)
            response = await http.patch(f"{PATH}/{YOUNG_OID}/einwilligung", json=_payload(medien=True), headers=_person(YOUNG))
            return response, before, await _records(database)

        response, before, after = served(mongo_replica_set_url, steps)

        assert (response.status_code, response.json()["error_code"]) == (422, SELBST_MEDIEN_ALTER)
        assert after == before


@pytest.mark.db
class TestTheLabelTheControlStamps:
    def test_the_confirmation_pages_label_is_no_version_of_the_control(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            before = await _records(database)
            response = await http.patch(
                f"{PATH}/{REFEREE_OID}/einwilligung",
                json=_payload(umfang="intern", text_version=CONFIRMATION_LABEL),
                headers=_person(IDENTIFIER),
            )
            return response, before, await _records(database)

        response, before, after = served(mongo_replica_set_url, steps)

        assert (response.status_code, response.json()["error_code"]) == (409, FASSUNG_UNZULAESSIG)
        assert after == before


@pytest.mark.db
class TestTheAccountPagesRead:
    def test_every_confirmed_record_the_address_holds_is_answered_past_seasons_included(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, _database: AsyncDatabase) -> Any:
            return await http.get(KONTO_PATH, headers=_person(IDENTIFIER))

        response = served(mongo_replica_set_url, steps)

        assert response.status_code == 200, response.text
        body = response.json()
        assert (body["spieler"]["spieler_id"], body["spieler"]["erteilbar"]) == (str(PUPIL_OID), True)
        assert [record["schiedsrichter_id"] for record in body["schiedsrichter"]] == [str(REFEREE_OID)]
        assert [
            (sitz["team_name"], sitz["saison_id"], sorted(sitz["rollen"]), sitz["medien"], sitz["erteilbar"], sitz["bestaetigt_text_version"])
            for sitz in body["sitze"]
        ] == [
            (ROW_NAME_B, ACTIVE_SAISON, ["stellvertretung"], True, True, SEAT_LABEL),
            (ROW_NAME_A_PAST, PAST_SAISON, ["ansprechperson", "trainer"], True, False, SEAT_LABEL),
        ]
        assert all(sitz["medien_angeboten"] for sitz in body["sitze"])

    def test_an_address_holding_nothing_is_answered_empty_rather_than_refused(self, mongo_replica_set_url: str):
        """The account page renders for every signed-in person."""

        async def steps(http: AsyncClient, _database: AsyncDatabase) -> Any:
            return await http.get(KONTO_PATH, headers=_person(NOBODY))

        response = served(mongo_replica_set_url, steps)

        assert response.status_code == 200, response.text
        assert {key: response.json()[key] for key in ("spieler", "schiedsrichter", "sitze")} == {
            "spieler": None,
            "schiedsrichter": [],
            "sitze": [],
        }

    def test_a_retired_referee_is_answered_for_withdrawal_alone(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, _database: AsyncDatabase) -> Any:
            return await http.get(KONTO_PATH, headers=_person(RETIRED))

        body = served(mongo_replica_set_url, steps).json()

        assert [(record["schiedsrichter_id"], record["erteilbar"]) for record in body["schiedsrichter"]] == [(str(RETIRED_OID), False)]


SEAT_RUNNING_LABEL = "2026-10-konto-kontakt"
SEAT_WEG = "PATCH /teams/{team_id}/saisons/{saison_id}/person/einwilligung"


def _seat_path(team_id: ObjectId, saison_id: str) -> str:
    return f"/api/v{API_VERSION}/teams/{team_id}/saisons/{saison_id}/person/einwilligung"


async def _rows(database: AsyncDatabase) -> dict[Any, Any]:
    return {
        (row["team_id"], row["saison_id"]): row["kontakte"]
        async for row in database[Collection.SAISON_TEAMS].find({}, {"team_id": 1, "saison_id": 1, "kontakte": 1})
    }


def _seat_press(email: str, team_id: ObjectId, saison_id: str, medien: bool, *, label: str = SEAT_RUNNING_LABEL, before=None):
    async def steps(http: AsyncClient, database: AsyncDatabase) -> tuple[Any, dict[Any, Any], dict[Any, Any]]:
        if before is not None:
            await before(database)
        stored = await _rows(database)
        response = await http.patch(_seat_path(team_id, saison_id), json={"medien": medien, "text_version": label}, headers=_person(email))
        return response, stored, await _rows(database)

    return steps


@pytest.mark.db
class TestTheSeatsMediaChoice:
    def test_a_withdrawal_moves_the_askers_seats_on_that_row_and_no_other_seat_or_row(self, mongo_replica_set_url: str):
        """The case that goes red the day the write reaches every seat of the row rather than the asker's."""

        response, before, after = served(mongo_replica_set_url, _seat_press(IDENTIFIER, TEAM_B_OID, ACTIVE_SAISON, False))

        assert response.status_code == 200, response.text
        assert response.json()["rollen"] == ["stellvertretung"]
        row_before, row_after = before[(TEAM_B_OID, ACTIVE_SAISON)], after[(TEAM_B_OID, ACTIVE_SAISON)]
        assert _block(row_after["stellvertretung"]["einwilligung"]) == {**row_before["stellvertretung"]["einwilligung"], "medien": False}
        assert row_after["stellvertretung"]["einwilligung"][VERLAUF] == [
            {
                "am": "2026-10-03T10:00:00+00:00",
                "akt": "widerrufen",
                "ueber": SEAT_WEG,
                "umfang": "kontaktdaten",
                "medien": False,
                "text_version": SEAT_RUNNING_LABEL,
                "erfasst_von": "person",
            }
        ]
        assert row_after["trainer"] == row_before["trainer"]
        assert {key: value for key, value in after.items() if key != (TEAM_B_OID, ACTIVE_SAISON)} == {
            key: value for key, value in before.items() if key != (TEAM_B_OID, ACTIVE_SAISON)
        }

    def test_a_past_seasons_seats_take_a_withdrawal_each_and_refuse_a_grant(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            body = {"medien": False, "text_version": SEAT_RUNNING_LABEL}
            withdrawn = await http.patch(_seat_path(TEAM_A_OID, PAST_SAISON), json=body, headers=_person(IDENTIFIER))
            granted = await http.patch(_seat_path(TEAM_A_OID, PAST_SAISON), json={**body, "medien": True}, headers=_person(IDENTIFIER))
            return withdrawn, granted, await _rows(database)

        withdrawn, granted, after = served(mongo_replica_set_url, steps)

        assert withdrawn.status_code == 200, withdrawn.text
        assert sorted(withdrawn.json()["rollen"]) == ["ansprechperson", "trainer"]
        assert (granted.status_code, granted.json()["error_code"]) == (403, FUNKTION_NICHT_GEHALTEN)
        for slot in ("trainer", "ansprechperson"):
            seat = after[(TEAM_A_OID, PAST_SAISON)][slot]["einwilligung"]
            assert (seat["medien"], [entry["akt"] for entry in seat[VERLAUF]]) == (False, ["widerrufen"])

    @pytest.mark.parametrize(("email", "team_id"), [(IDENTIFIER, TEAM_A_OID), (NOBODY, TEAM_B_OID)], ids=["unconfirmed-seat", "no-seat"])
    def test_a_row_holding_no_confirmed_seat_of_the_address_is_refused_and_unwritten(
        self, mongo_replica_set_url: str, email: str, team_id: ObjectId
    ):
        response, before, after = served(mongo_replica_set_url, _seat_press(email, team_id, ACTIVE_SAISON, False))

        assert (response.status_code, response.json()["error_code"]) == (403, FUNKTION_NICHT_GEHALTEN)
        assert after == before

    def test_a_grant_below_the_media_age_is_refused_and_unwritten(self, mongo_replica_set_url: str):
        async def young_and_off(database: AsyncDatabase) -> None:
            await database[Collection.SAISON_TEAMS].update_one(
                {"team_id": TEAM_B_OID, "saison_id": ACTIVE_SAISON},
                {"$set": {"kontakte.stellvertretung.geburtsdatum": SEVENTEEN_BIRTHDATE, "kontakte.stellvertretung.einwilligung.medien": False}},
            )

        response, before, after = served(mongo_replica_set_url, _seat_press(IDENTIFIER, TEAM_B_OID, ACTIVE_SAISON, True, before=young_and_off))

        assert (response.status_code, response.json()["error_code"]) == (422, SELBST_MEDIEN_ALTER)
        assert after == before

    def test_the_seat_confirmations_label_is_no_version_of_the_control(self, mongo_replica_set_url: str):
        response, before, after = served(mongo_replica_set_url, _seat_press(IDENTIFIER, TEAM_B_OID, ACTIVE_SAISON, False, label=SEAT_LABEL))

        assert (response.status_code, response.json()["error_code"]) == (409, FASSUNG_UNZULAESSIG)
        assert after == before
