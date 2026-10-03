from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any, get_args
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from httpx2 import AsyncClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.einwilligung.services import FASSUNG_UNZULAESSIG
from app.api.identitaet.services import FUNKTION_NICHT_GEHALTEN
from app.api.konto.services import KONTO_SEITE_SPIELER, SELBST_MEDIEN_ALTER
from app.api.schiedsrichter.schemas import FLSchiedsrichterSelbstEinwilligungPayload
from app.api.spieler.schemas import FLEinwilligung, FLSpielerSelbstEinwilligungPayload
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from app.shared.einwilligung_verlauf import VERLAUF
from tests.actor_tokens import SignedActor
from tests.app_client import app_client
from tests.config import ADMIN_KEY
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import (
    saison_document,
    saison_spieler_document,
    saison_team_document,
    spiel_document,
    spieler_document,
    team_document,
)
from tests.worker import worker_database

from .conftest import config_for

DATABASE_NAME = worker_database("fl_spieler_selbst_test")

CONFIG = config_for(DATABASE_NAME)

PATH = f"/api/v{API_VERSION}/spieler/selbst"
PATCH_PATH = f"{PATH}/einwilligung"

NOW = datetime(2026, 10, 3, 12, 0, tzinfo=ZoneInfo("Europe/Berlin"))

PAST_SAISON = "2025"
ACTIVE_SAISON = "2026"

# Stored folded, as every pupil row stores its address; asked in another spelling where a case says so.
IDENTIFIER = "ortrud.zwiebelmayer@schule.de"
IDENTIFIER_SPELLED_OTHERWISE = "Ortrud.Zwiebelmayer@SCHULE.de"
YOUNG = "jonas.jungspund@schule.de"
UNDATED = "uta.ungeboren@schule.de"
RETIRED = "rudolf.ruhestand@schule.de"
UNCONFIRMED = "ottilie.wartezeit@schule.de"
BYSTANDER = "baldur.krautzberger@example.com"
NOBODY = "niemand@schule.de"

# Fixed, so a failure names the same row every run.
TEAM_A_OID = ObjectId("6890a1b2c3d4e5f607840001")
TEAM_B_OID = ObjectId("6890a1b2c3d4e5f607840002")
PUPIL_OID = ObjectId("6890a1b2c3d4e5f607840011")
YOUNG_OID = ObjectId("6890a1b2c3d4e5f607840013")
UNDATED_OID = ObjectId("6890a1b2c3d4e5f607840014")
RETIRED_OID = ObjectId("6890a1b2c3d4e5f607840015")
UNCONFIRMED_OID = ObjectId("6890a1b2c3d4e5f607840016")
BYSTANDER_OID = ObjectId("6890a1b2c3d4e5f607840019")

# The name each season row was entered under, apart from the club's current one, so serving the
# club's own would be observable (`docs/backend/spec.md :: I13`).
ROW_NAME_A_PAST = "Helmholtz"
ROW_NAME_A_ACTIVE = "Helmholtz-Gymnasium"
CLUB_NAME_A_NOW = "Helmholtzschule Frankfurt"
ROW_NAME_B = "Lessing"

# The confirmation page's label the stored records cite: a version of ANOTHER page than the account
# page's pupil control.
CONFIRMATION_LABEL = "2026-09-spielerseite-3"

ADULT_BIRTHDATE = "2000-05-09"

# A fixture the pupil's team plays this season: the document a consent verdict would be denormalised onto.
SPIEL = spiel_document(
    spiel_id=ObjectId("6890a1b2c3d4e5f607840041"),
    saison_id=ACTIVE_SAISON,
    spiel_nr=1,
    spieltag_id=ObjectId("6890a1b2c3d4e5f607840042"),
    team1={"team_id": TEAM_A_OID, "name": ROW_NAME_A_ACTIVE, "tore": None, "shorthand": "HE"},
    team2={"team_id": TEAM_B_OID, "name": ROW_NAME_B, "tore": None, "shorthand": "LE"},
)

# `NOW` in UTC, as an entry spells its instant.
NOW_UTC = "2026-10-03T10:00:00+00:00"

# Two acts the record already carries, so an append is seen to leave them as they stood.
EARLIER_ENTRIES = [
    {
        "am": "2026-09-02T08:00:00+00:00",
        "akt": "bestaetigt",
        "ueber": "POST /schiedsrichter/bestaetigung",
        "umfang": "kader_oeffentlich",
        "medien": False,
        "text_version": "2026-09-spielerseite-3",
        "erteilt_von": "volljaehrig",
    },
    {
        "am": "2026-09-20T17:30:00+00:00",
        "akt": "erteilt",
        "ueber": "PATCH /spieler/selbst/einwilligung",
        "umfang": "kader_oeffentlich",
        "medien": False,
        "text_version": "2026-10-konto-spieler",
        "erteilt_von": "volljaehrig",
    },
]
# Seventeen on `NOW`, eighteen a day later: the floor is judged on the day, not the year.
SEVENTEEN_BIRTHDATE = "2008-10-04"


def _einwilligung(**fields: Any) -> dict[str, Any]:
    return {
        "umfang": "kader_oeffentlich",
        "erteilt_von": "volljaehrig",
        "datum": "2026-09-01",
        "bestaetigt_am": "2026-09-02",
        "text_version": CONFIRMATION_LABEL,
        "medien": False,
        **fields,
    }


def _block(einwilligung: dict[str, Any]) -> dict[str, Any]:
    """The block without its entries, which the cases on the appended record assert by themselves."""

    return {key: value for key, value in einwilligung.items() if key != VERLAUF}


def _running_label() -> str:
    return LAUFENDE_FASSUNGEN[KONTO_SEITE_SPIELER]


def _payload(*, umfang: str = "kader_oeffentlich", medien: bool = False, text_version: str | None = None) -> dict[str, Any]:
    return {"umfang": umfang, "medien": medien, "text_version": text_version or _running_label()}


def _person(email: str) -> SignedActor:
    return SignedActor(email, ADMIN_KEY, lane="person")


async def _seed(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_many([saison_document(PAST_SAISON, "past"), saison_document(ACTIVE_SAISON, "active")])
    await database[Collection.TEAMS].insert_many(
        [team_document(TEAM_A_OID, CLUB_NAME_A_NOW, "HE"), team_document(TEAM_B_OID, ROW_NAME_B, "LE")]
    )
    await database[Collection.SAISON_TEAMS].insert_many(
        [
            saison_team_document(PAST_SAISON, TEAM_A_OID, ROW_NAME_A_PAST, "HE"),
            saison_team_document(ACTIVE_SAISON, TEAM_A_OID, ROW_NAME_A_ACTIVE, "HE"),
            saison_team_document(ACTIVE_SAISON, TEAM_B_OID, ROW_NAME_B, "LE"),
        ]
    )

    def pupil(oid: ObjectId, vorname: str, nachname: str, email: str, **fields: Any) -> dict[str, Any]:
        return spieler_document(
            oid, vorname, nachname, email=email, **{"geburtsdatum": ADULT_BIRTHDATE, "einwilligung": _einwilligung(), **fields}
        )

    await database[Collection.SPIELER].insert_many(
        [
            pupil(PUPIL_OID, "Ortrud", "Zwiebelmayer", IDENTIFIER),
            pupil(YOUNG_OID, "Jonas", "Jungspund", YOUNG, geburtsdatum=SEVENTEEN_BIRTHDATE),
            pupil(UNDATED_OID, "Uta", "Ungeboren", UNDATED, geburtsdatum=None),
            pupil(RETIRED_OID, "Rudolf", "Ruhestand", RETIRED, inactive_since="2026-07-01", einwilligung=_einwilligung(medien=True)),
            pupil(UNCONFIRMED_OID, "Ottilie", "Wartezeit", UNCONFIRMED, einwilligung=_einwilligung(bestaetigt_am=None)),
            pupil(BYSTANDER_OID, "Baldur", "Krautzberger", BYSTANDER),
        ]
    )
    await database[Collection.SPIELE].insert_one(dict(SPIEL))
    await database[Collection.SAISON_SPIELER].insert_many(
        [
            saison_spieler_document(PUPIL_OID, PAST_SAISON, TEAM_A_OID, nummer="7", inactive_since="2025-06-30"),
            saison_spieler_document(PUPIL_OID, ACTIVE_SAISON, TEAM_A_OID, nummer="07", rolle="kapitaen", ist_nachnominiert=True),
            saison_spieler_document(BYSTANDER_OID, ACTIVE_SAISON, TEAM_B_OID, nummer="9"),
        ]
    )


def served[T](url: str, steps: Callable[[AsyncClient, AsyncDatabase], Awaitable[T]]) -> T:
    """`steps` against a freshly seeded database, served on the clock `NOW` reads."""

    async def _run() -> T:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_client, database):
            await _seed(database)
            async with app_client(url, config=CONFIG, now=NOW) as http:
                return await steps(http, database)

    return on_the_seed_loop(_run())


async def _records(database: AsyncDatabase) -> dict[Any, Any]:
    return {row["_id"]: row async for row in database[Collection.SPIELER].find({}, {"einwilligung": 1})}


def _read(email: str) -> Callable[[AsyncClient, AsyncDatabase], Awaitable[Any]]:
    async def steps(http: AsyncClient, _database: AsyncDatabase) -> Any:
        return await http.get(PATH, headers=_person(email))

    return steps


def _press(email: str, payload: dict[str, Any], *, before: Callable[[AsyncDatabase], Awaitable[None]] | None = None):
    """One PATCH, with the records as they stood before it and after it, and every fixture as it stands after it."""

    async def steps(http: AsyncClient, database: AsyncDatabase) -> tuple[Any, dict[Any, Any], dict[Any, Any], list[Any]]:
        if before is not None:
            await before(database)
        stored = await _records(database)
        response = await http.patch(PATCH_PATH, json=payload, headers=_person(email))
        return response, stored, await _records(database), await database[Collection.SPIELE].find({}).to_list()

    return steps


def test_the_payload_offers_the_scopes_the_record_stores():
    """Two spellings of one set: a scope the payload offered and the record refused would 500 at the write."""

    payload_scopes = get_args(FLSpielerSelbstEinwilligungPayload.model_fields["umfang"].annotation)
    record_scopes = get_args(FLEinwilligung.model_fields["umfang"].annotation)

    assert payload_scopes == record_scopes


def test_the_pupil_and_the_referee_send_one_shape():
    """What keeps the two endpoints from drifting: the account page's one control posts both."""

    pupil = FLSpielerSelbstEinwilligungPayload.model_json_schema()
    referee = FLSchiedsrichterSelbstEinwilligungPayload.model_json_schema()

    assert (pupil["properties"], pupil["required"]) == (referee["properties"], referee["required"])


@pytest.mark.db
class TestTheOwnRecord:
    def test_the_address_is_answered_its_own_record_and_no_other(self, mongo_replica_set_url: str):
        response = served(mongo_replica_set_url, _read(IDENTIFIER))

        assert response.status_code == 200, response.text
        record = response.json()["spieler"]
        assert (record["spieler_id"], record["vorname"], record["nachname"], record["geburtsdatum"]) == (
            str(PUPIL_OID),
            "Ortrud",
            "Zwiebelmayer",
            ADULT_BIRTHDATE,
        )
        assert (record["einwilligung"]["text_version"], record["bestaetigt_text_version"]) == (CONFIRMATION_LABEL, CONFIRMATION_LABEL)
        assert (record["erteilbar"], record["medien_angeboten"]) == (True, True)
        assert "email" not in record

    def test_each_squad_row_carries_the_name_its_season_was_played_under(self, mongo_replica_set_url: str):
        kader = served(mongo_replica_set_url, _read(IDENTIFIER)).json()["spieler"]["kader"]

        assert [(row["saison_id"], row["team_name"], row["nummer"]) for row in kader] == [
            (ACTIVE_SAISON, ROW_NAME_A_ACTIVE, "07"),
            (PAST_SAISON, ROW_NAME_A_PAST, "7"),
        ]
        assert (kader[0]["rolle"], kader[0]["ist_nachnominiert"], kader[0]["inactive_since"]) == ("kapitaen", True, None)
        assert kader[1]["inactive_since"] == "2025-06-30"

    def test_an_address_spelled_otherwise_reads_the_same_record(self, mongo_replica_set_url: str):
        """One identifier and one person: the binder folds the token's address before anything matches it."""

        assert served(mongo_replica_set_url, _read(IDENTIFIER_SPELLED_OTHERWISE)).json()["spieler"]["spieler_id"] == str(PUPIL_OID)

    def test_a_retired_record_is_served_for_its_withdrawal_alone(self, mongo_replica_set_url: str):
        record = served(mongo_replica_set_url, _read(RETIRED)).json()["spieler"]

        assert (record["spieler_id"], record["inactive_since"], record["erteilbar"]) == (str(RETIRED_OID), "2026-07-01", False)

    @pytest.mark.parametrize(
        ("email", "angeboten"), [(YOUNG, False), (UNDATED, False), (IDENTIFIER, True)], ids=["seventeen", "no-birthdate", "adult"]
    )
    def test_the_media_switch_is_offered_from_the_media_age_alone(self, mongo_replica_set_url: str, email: str, angeboten: bool):
        assert served(mongo_replica_set_url, _read(email)).json()["spieler"]["medien_angeboten"] is angeboten

    @pytest.mark.parametrize("email", [NOBODY, UNCONFIRMED], ids=["no-record", "unconfirmed"])
    def test_an_address_holding_no_confirmed_record_is_refused(self, mongo_replica_set_url: str, email: str):
        response = served(mongo_replica_set_url, _read(email))

        assert (response.status_code, response.json()["error_code"]) == (403, FUNKTION_NICHT_GEHALTEN)


@pytest.mark.db
class TestTheTwoChoices:
    def test_moving_the_scope_moves_this_record_alone_and_leaves_the_media_answer(self, mongo_replica_set_url: str):
        """With the next case, the pair that goes red the day the handler writes the payload wholesale."""

        response, before, after, spiele = served(mongo_replica_set_url, _press(IDENTIFIER, _payload(umfang="intern")))

        assert response.status_code == 200, response.text
        assert _block(after[PUPIL_OID]["einwilligung"]) == {**before[PUPIL_OID]["einwilligung"], "umfang": "intern"}
        assert {key: value for key, value in after.items() if key != PUPIL_OID} == {
            key: value for key, value in before.items() if key != PUPIL_OID
        }
        # No copy of the verdict on any fixture, the seeded one held byte for byte.
        assert spiele == [SPIEL]
        assert response.json()["einwilligung"]["umfang"] == "intern"

    def test_moving_the_media_answer_leaves_the_scope_and_the_confirmation(self, mongo_replica_set_url: str):
        """The confirmation day is what the panel and the publication mask read."""

        response, before, after, _ = served(mongo_replica_set_url, _press(IDENTIFIER, _payload(medien=True)))

        assert response.status_code == 200, response.text
        assert _block(after[PUPIL_OID]["einwilligung"]) == {**before[PUPIL_OID]["einwilligung"], "medien": True}

    def test_an_address_spelled_otherwise_moves_the_same_record(self, mongo_replica_set_url: str):
        response, _, after, _ = served(mongo_replica_set_url, _press(IDENTIFIER_SPELLED_OTHERWISE, _payload(umfang="intern")))

        assert response.status_code == 200, response.text
        assert after[PUPIL_OID]["einwilligung"]["umfang"] == "intern"

    def test_a_press_moving_neither_choice_writes_nothing(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            response = await http.patch(PATCH_PATH, json=_payload(), headers=_person(IDENTIFIER))
            return response, await _records(database), await database[Collection.AKTIONEN].count_documents({})

        response, after, logged = served(mongo_replica_set_url, steps)

        assert response.status_code == 200, response.text
        assert (after[PUPIL_OID]["einwilligung"], logged) == (_einwilligung(), 0)


@pytest.mark.db
class TestARecordNotHeld:
    @pytest.mark.parametrize("email", [NOBODY, UNCONFIRMED], ids=["no-record", "unconfirmed"])
    def test_an_address_holding_no_confirmed_record_is_refused_and_writes_nothing(self, mongo_replica_set_url: str, email: str):
        response, before, after, _ = served(mongo_replica_set_url, _press(email, _payload(umfang="intern")))

        assert (response.status_code, response.json()["error_code"]) == (403, FUNKTION_NICHT_GEHALTEN)
        assert after == before


@pytest.mark.db
class TestARetiredRecord:
    """A withdrawal reaches every confirmed record the address holds (Art. 7(3) DSGVO); a grant only a live one."""

    def test_a_withdrawal_is_taken(self, mongo_replica_set_url: str):
        response, _, after, _ = served(mongo_replica_set_url, _press(RETIRED, _payload(umfang="intern", medien=False)))

        assert response.status_code == 200, response.text
        assert (after[RETIRED_OID]["einwilligung"]["umfang"], after[RETIRED_OID]["einwilligung"]["medien"]) == ("intern", False)

    def test_a_grant_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        async def withdrawn_earlier(database: AsyncDatabase) -> None:
            await database[Collection.SPIELER].update_one({"_id": RETIRED_OID}, {"$set": {"einwilligung.medien": False}})

        response, before, after, _ = served(mongo_replica_set_url, _press(RETIRED, _payload(medien=True), before=withdrawn_earlier))

        assert (response.status_code, response.json()["error_code"]) == (403, FUNKTION_NICHT_GEHALTEN)
        assert after == before


@pytest.mark.db
class TestTheMediaAge:
    @pytest.mark.parametrize("email", [YOUNG, UNDATED], ids=["seventeen", "no-birthdate"])
    def test_a_media_consent_below_the_floor_is_refused_and_writes_nothing(self, mongo_replica_set_url: str, email: str):
        response, before, after, _ = served(mongo_replica_set_url, _press(email, _payload(medien=True)))

        assert (response.status_code, response.json()["error_code"]) == (422, SELBST_MEDIEN_ALTER)
        assert after == before

    def test_a_stored_media_consent_resent_unchanged_lets_the_scope_move(self, mongo_replica_set_url: str):
        """A record stamped while the switch was offered from sixteen: judging the unchanged answer would lock the other switch."""

        async def granted_under_an_earlier_label(database: AsyncDatabase) -> None:
            await database[Collection.SPIELER].update_one({"_id": YOUNG_OID}, {"$set": {"einwilligung.medien": True}})

        response, _, after, _ = served(
            mongo_replica_set_url, _press(YOUNG, _payload(umfang="intern", medien=True), before=granted_under_an_earlier_label)
        )

        assert response.status_code == 200, response.text
        assert (after[YOUNG_OID]["einwilligung"]["umfang"], after[YOUNG_OID]["einwilligung"]["medien"]) == ("intern", True)


@pytest.mark.db
class TestTheLabelTheControlStamps:
    @pytest.mark.parametrize(
        "payload",
        [
            _payload(umfang="intern", text_version=CONFIRMATION_LABEL),
            _payload(medien=True, text_version=CONFIRMATION_LABEL),
            _payload(umfang="intern", text_version="2099-01-erfunden"),
        ],
        ids=["withdrawal-another-pages-label", "grant-another-pages-label", "withdrawal-unknown-label"],
    )
    def test_a_label_naming_no_version_of_the_control_is_refused_and_writes_nothing(self, mongo_replica_set_url: str, payload: dict[str, Any]):
        response, before, after, _ = served(mongo_replica_set_url, _press(IDENTIFIER, payload))

        assert (response.status_code, response.json()["error_code"]) == (409, FASSUNG_UNZULAESSIG)
        assert after == before


@pytest.mark.db
class TestTheAppendedRecord:
    """Each press appends one entry and rewrites none (Art. 7(1) DSGVO); the block keeps the label its person confirmed."""

    @staticmethod
    async def _earlier_entries(database: AsyncDatabase) -> None:
        await database[Collection.SPIELER].update_one({"_id": PUPIL_OID}, {"$set": {"einwilligung.verlauf": EARLIER_ENTRIES}})

    def test_a_withdrawal_appends_one_entry_and_leaves_every_earlier_one_as_it_stood(self, mongo_replica_set_url: str):
        """The case that goes red the day a write sets the block, or its entries, in place of appending."""

        response, _, after, _ = served(mongo_replica_set_url, _press(IDENTIFIER, _payload(umfang="intern"), before=self._earlier_entries))

        assert response.status_code == 200, response.text
        assert after[PUPIL_OID]["einwilligung"][VERLAUF] == [
            *EARLIER_ENTRIES,
            {
                "am": NOW_UTC,
                "akt": "widerrufen",
                "ueber": "PATCH /spieler/selbst/einwilligung",
                "umfang": "intern",
                "medien": False,
                "text_version": _running_label(),
                "erteilt_von": "volljaehrig",
            },
        ]
        assert after[PUPIL_OID]["einwilligung"]["text_version"] == CONFIRMATION_LABEL

    def test_a_grant_after_a_withdrawal_appends_a_second_entry_rather_than_reviving_the_first(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            withdrawn = await http.patch(PATCH_PATH, json=_payload(umfang="intern"), headers=_person(IDENTIFIER))
            granted = await http.patch(PATCH_PATH, json=_payload(umfang="kader_oeffentlich"), headers=_person(IDENTIFIER))
            return withdrawn, granted, await _records(database)

        withdrawn, granted, after = served(mongo_replica_set_url, steps)

        assert (withdrawn.status_code, granted.status_code) == (200, 200), granted.text
        assert [(entry["akt"], entry["umfang"]) for entry in after[PUPIL_OID]["einwilligung"][VERLAUF]] == [
            ("widerrufen", "intern"),
            ("erteilt", "kader_oeffentlich"),
        ]
        assert _block(after[PUPIL_OID]["einwilligung"]) == _einwilligung()

    def test_a_press_moving_nothing_appends_nothing(self, mongo_replica_set_url: str):
        response, _, after, _ = served(mongo_replica_set_url, _press(IDENTIFIER, _payload(), before=self._earlier_entries))

        assert response.status_code == 200, response.text
        assert after[PUPIL_OID]["einwilligung"][VERLAUF] == EARLIER_ENTRIES


@pytest.mark.db
class TestTheWordsContext:
    """The agreed words render with what the record names today: the club as it is called now, never the season row's copy."""

    def test_the_newest_seasons_squad_row_names_the_team_school_and_season(self, mongo_replica_set_url: str):
        kontext = served(mongo_replica_set_url, _read(IDENTIFIER)).json()["spieler"]["kontext"]

        assert kontext == {"vorname": "Ortrud", "team": CLUB_NAME_A_NOW, "schule": f"{CLUB_NAME_A_NOW}-Schule", "saison": ACTIVE_SAISON}

    def test_a_record_with_no_squad_row_names_its_person_alone(self, mongo_replica_set_url: str):
        kontext = served(mongo_replica_set_url, _read(YOUNG)).json()["spieler"]["kontext"]

        assert kontext == {"vorname": "Jonas", "team": None, "schule": None, "saison": None}
