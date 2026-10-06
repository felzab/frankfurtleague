"""
API · a referee's own consent record, read and changed by its own person on the account page

The pupil's twin is `tests/api/test_spieler_selbst.py`, which also pins that the two PATCHes take one
payload shape; this file holds what differs on a referee row: the address stored as typed, the
ghost, and a record the confirmation has not yet written.
"""

from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from httpx2 import AsyncClient
from pydantic import BaseModel, ValidationError
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import compose_bestaetigungen, hash_token, mindestalter_for
from app.api.einwilligung.services import FASSUNG_UNZULAESSIG, SELBST_MEDIEN_ALTER
from app.api.identitaet.services import FUNKTION_NICHT_GEHALTEN
from app.api.konto.schemas import FLKontoBewerbungSitzEinwilligung, FLKontoSitzEinwilligung
from app.api.konto.services import EINWILLIGUNG_STAND_VERALTET, KONTO_SEITE_SCHIEDSRICHTER
from app.api.registrierungen.schemas import FLRegistrierungEinwilligung
from app.api.registrierungen.services import compose_ablehnung_update
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.shared.einwilligung import LAUFENDE_FASSUNGEN, Seite
from app.shared.einwilligung_nachweis import NACHWEIS, WAHLEN, nachweis_stand_of
from tests.actor_tokens import SignedActor
from tests.app_client import app_client
from tests.config import ADMIN_KEY, BASE_AUTH
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import (
    ADDRESS,
    registrierung_document,
    saison_document,
    saison_team_document,
    spiel_document,
    spieler_document,
    team_document,
)
from tests.worker import worker_database

from .conftest import AUSTRITT, config_for

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

# A fixture the referee leads, embedding their name: the copy a withdrawal would be fanned out onto.
SPIEL = spiel_document(
    spiel_id=ObjectId("6890a1b2c3d4e5f607850041"),
    saison_id="2026",
    spiel_nr=1,
    spieltag_id=ObjectId("6890a1b2c3d4e5f607850042"),
    schiedsrichter={"schiedsrichter_id": REFEREE_OID, "name": "Ortrud Zwiebelmayer", "payment": 20},
)
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
    """The block without its evidence, which the cases on a press assert by themselves."""

    return {key: value for key, value in einwilligung.items() if key != NACHWEIS}


# `NOW` in UTC, as evidence spells its instant.
AM = "2026-10-03T10:00:00+00:00"


def _running_label() -> str:
    return LAUFENDE_FASSUNGEN[KONTO_SEITE_SCHIEDSRICHTER]


def _payload(
    *, umfang: str = "kader_oeffentlich", medien: bool = False, text_version: str | None = None, stand: Mapping[str, Any] | None = None
) -> dict[str, Any]:
    """A press from a page served the record as the suite seeds it, holding no evidence, unless `stand` says otherwise."""

    return {
        "umfang": umfang,
        "medien": medien,
        "text_version": text_version or _running_label(),
        "nachweis_stand": dict(stand) if stand is not None else {"umfang": None, "medien": None},
    }


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
    # The clubs as they are called today, apart from each season row's copy, so the `{schule}` fill is seen to be the club's.
    await database[Collection.TEAMS].insert_many(
        [team_document(TEAM_A_OID, "Helmholtz-Gymnasium Frankfurt", "HE"), team_document(TEAM_B_OID, "Lessing-Gymnasium", "LE")]
    )
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
    await database[Collection.SPIELE].insert_one(dict(SPIEL))
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


@pytest.mark.parametrize("model", [FLKontoSitzEinwilligung, FLKontoBewerbungSitzEinwilligung])
def test_a_seat_entry_names_at_least_one_role_and_publishes_the_floor(model: type[BaseModel]):
    """The page parses `rollen` as non-empty, and a contract compared past its bounds would not see the backend serve `[]`."""

    assert model.model_json_schema()["properties"]["rollen"]["minItems"] == 1
    with pytest.raises(ValidationError) as refused:
        model.model_validate({**{field: None for field in model.model_fields}, "rollen": []})

    # Among the other fields' refusals, the one this case is about.
    assert ("too_short", ("rollen",)) in [(error["type"], error["loc"]) for error in refused.value.errors()]


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
        # The fee is the referee's own, served under the screen's word; the link's bookkeeping never is.
        assert (record["honorar"], "default_payment" in record, "bestaetigung" in record) == (20, False, False)

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
            return response, before, await _records(database), await database[Collection.SPIELE].find({}).to_list()

        response, before, after, spiele = served(mongo_replica_set_url, steps)

        assert response.status_code == 200, response.text
        assert _block(after[REFEREE_OID]["einwilligung"]) == {**before[REFEREE_OID]["einwilligung"], "umfang": "intern"}
        # The moved choice alone, under the account control's label; the stored grant predates evidence,
        # so the withdrawal names it by its record's confirmation day.
        assert after[REFEREE_OID]["einwilligung"][NACHWEIS] == {
            "umfang": {
                "am": AM,
                "text_version": _running_label(),
                "erteilt_zuvor": {"am": "2026-09-01T22:00:00+00:00", "text_version": CONFIRMATION_LABEL},
            }
        }
        assert {key: value for key, value in after.items() if key != REFEREE_OID} == {
            key: value for key, value in before.items() if key != REFEREE_OID
        }
        # No copy of the verdict on the fixture naming the referee, held byte for byte.
        assert spiele == [SPIEL]

    def test_a_press_from_a_page_served_older_evidence_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            await database[Collection.SCHIEDSRICHTER].update_one(
                {"_id": REFEREE_OID}, {"$set": {"einwilligung.nachweis.medien": {"am": AM, "text_version": _running_label()}}}
            )
            before = await _records(database)
            response = await http.patch(f"{PATH}/{REFEREE_OID}/einwilligung", json=_payload(umfang="intern"), headers=_person(IDENTIFIER))
            return response, before, await _records(database)

        response, before, after = served(mongo_replica_set_url, steps)

        assert (response.status_code, response.json()["error_code"]) == (409, EINWILLIGUNG_STAND_VERALTET)
        assert after == before

    def test_a_press_moving_neither_choice_writes_nothing(self, mongo_replica_set_url: str):
        """The stored answer pressed again: no evidence restamped, and no log row a restore could replay."""

        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            before = await _records(database), await database[Collection.AKTIONEN].count_documents({})
            response = await http.patch(f"{PATH}/{REFEREE_OID}/einwilligung", json=_payload(), headers=_person(IDENTIFIER))
            return response, before, (await _records(database), await database[Collection.AKTIONEN].count_documents({}))

        response, before, after = served(mongo_replica_set_url, steps)

        assert response.status_code == 200, response.text
        assert after == before

    def test_moving_the_media_answer_leaves_the_scope(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            response = await http.patch(f"{PATH}/{REFEREE_OID}/einwilligung", json=_payload(medien=True), headers=_person(IDENTIFIER))
            return response, await _records(database)

        response, after = served(mongo_replica_set_url, steps)

        assert response.status_code == 200, response.text
        assert _block(after[REFEREE_OID]["einwilligung"]) == _einwilligung(medien=True)
        assert after[REFEREE_OID]["einwilligung"][NACHWEIS] == {"medien": {"am": AM, "text_version": _running_label()}}


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
                f"{PATH}/{RETIRED_OID}/einwilligung",
                json=_payload(umfang="kader_oeffentlich", medien=False, stand=withdrawn.json()["nachweis_stand"]),
                headers=_person(RETIRED),
            )
            return withdrawn, granted, await _records(database)

        withdrawn, granted, after = served(mongo_replica_set_url, steps)

        assert withdrawn.status_code == 200, withdrawn.text
        assert (granted.status_code, granted.json()["error_code"]) == (403, FUNKTION_NICHT_GEHALTEN)
        assert (after[RETIRED_OID]["einwilligung"]["umfang"], after[RETIRED_OID]["einwilligung"]["medien"]) == ("intern", False)


@pytest.mark.db
class TestThePressesOrder:
    """One sequence for every kind of record: the stale page is judged before whether the record takes a grant."""

    def test_a_stale_grant_on_a_retired_record_is_refused_as_stale(self, mongo_replica_set_url: str):
        """The withdrawal moves the stand, so the page still showing the grant is stale before it is anything else."""

        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            withdrawn = await http.patch(f"{PATH}/{RETIRED_OID}/einwilligung", json=_payload(medien=False), headers=_person(RETIRED))
            before = await _records(database)
            stale = await http.patch(f"{PATH}/{RETIRED_OID}/einwilligung", json=_payload(medien=True), headers=_person(RETIRED))
            return withdrawn, stale, before, await _records(database)

        withdrawn, stale, before, after = served(mongo_replica_set_url, steps)

        assert withdrawn.status_code == 200, withdrawn.text
        assert (stale.status_code, stale.json()["error_code"]) == (409, EINWILLIGUNG_STAND_VERALTET)
        assert after == before


SPIELER_PATCH_PATH = f"/api/v{API_VERSION}/spieler/selbst/einwilligung"


async def _withdrawn_then_granted(http: AsyncClient, path: str, payload: Callable[[bool, Any], dict[str, Any]], email: str) -> Any:
    """A media withdrawal, then a grant from the page its answer leaves: the grant's status alone is the record's to answer."""

    withdrawn = await http.patch(path, json=payload(False, None), headers=_person(email))
    assert withdrawn.status_code == 200, withdrawn.text

    return await http.patch(path, json=payload(True, withdrawn.json()["nachweis_stand"]), headers=_person(email))


@pytest.mark.db
class TestErteilbarIsTheGrantThePressTakes:
    """`docs/backend/spec.md :: I973`: every entry the account read serves is offered a grant exactly where its PATCH takes one."""

    @staticmethod
    async def _a_withdrawn_teams_confirmed_seat(database: AsyncDatabase) -> None:
        # Beside the asker's live seat of the same season, so an `erteilbar` judged by the season alone offers it a grant.
        await database[Collection.SAISON_TEAMS].update_one(
            {"team_id": TEAM_A_OID, "saison_id": ACTIVE_SAISON},
            {"$set": {"kontakte.trainer.einwilligung.bestaetigt_am": "2026-09-03", "austritt": dict(AUSTRITT)}},
        )

    @pytest.mark.parametrize("email", [IDENTIFIER, RETIRED], ids=["a live person", "a retired referee"])
    def test_a_grant_is_taken_on_each_served_entry_exactly_where_the_read_offered_one(self, mongo_replica_set_url: str, email: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> list[tuple[str, bool, int]]:
            await self._a_withdrawn_teams_confirmed_seat(database)
            body = (await http.get(KONTO_PATH, headers=_person(email))).json()
            outcomes: list[tuple[str, bool, int]] = []

            if body["spieler"] is not None:
                spieler_label = LAUFENDE_FASSUNGEN["konto_spieler"]
                granted = await _withdrawn_then_granted(
                    http,
                    SPIELER_PATCH_PATH,
                    lambda medien, stand: {
                        "umfang": body["spieler"]["einwilligung"]["umfang"],
                        "medien": medien,
                        "text_version": spieler_label,
                        "nachweis_stand": body["spieler"]["nachweis_stand"] if stand is None else stand,
                    },
                    email,
                )
                outcomes.append(("spieler", body["spieler"]["erteilbar"], granted.status_code))

            for eintrag in body["schiedsrichter"]:
                granted = await _withdrawn_then_granted(
                    http,
                    f"{PATH}/{eintrag['schiedsrichter_id']}/einwilligung",
                    lambda medien, stand, eintrag=eintrag: _payload(
                        umfang=eintrag["einwilligung"]["umfang"], medien=medien, stand=eintrag["nachweis_stand"] if stand is None else stand
                    ),
                    email,
                )
                outcomes.append((eintrag["schiedsrichter_id"], eintrag["erteilbar"], granted.status_code))

            for sitz in body["sitze"]:
                granted = await _withdrawn_then_granted(
                    http,
                    f"/api/v{API_VERSION}/teams/{sitz['team_id']}/saisons/{sitz['saison_id']}/person/einwilligung",
                    lambda medien, stand, sitz=sitz: {
                        "umfang": sitz["umfang"],
                        "medien": medien,
                        "text_version": SEAT_RUNNING_LABEL,
                        "nachweis_stand": sitz["nachweis_stand"] if stand is None else stand,
                    },
                    email,
                )
                outcomes.append((f"{sitz['team_id']}/{sitz['saison_id']}", sitz["erteilbar"], granted.status_code))

            return outcomes

        outcomes = served(mongo_replica_set_url, steps)

        assert outcomes, "the read served nothing, so nothing was compared"
        assert [(entry, erteilbar, status == 200) for entry, erteilbar, status in outcomes] == [
            (entry, erteilbar, erteilbar) for entry, erteilbar, _ in outcomes
        ]
        assert {erteilbar for _, erteilbar, _ in outcomes} == ({True, False} if email == IDENTIFIER else {False})


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
        assert [(record["schiedsrichter_id"], record["honorar"]) for record in body["schiedsrichter"]] == [(str(REFEREE_OID), 20)]
        assert [
            (sitz["team_name"], sitz["saison_id"], sorted(sitz["rollen"]), sitz["medien"], sitz["erteilbar"], sitz["bestaetigt_text_version"])
            for sitz in body["sitze"]
        ] == [
            (ROW_NAME_B, ACTIVE_SAISON, ["stellvertretung"], True, True, SEAT_LABEL),
            (ROW_NAME_A_PAST, PAST_SAISON, ["ansprechperson", "trainer"], True, False, SEAT_LABEL),
        ]
        assert all(sitz["medien_angeboten"] for sitz in body["sitze"])
        assert [sitz["kontext"] for sitz in body["sitze"]] == [
            {
                "vorname": "Ortrud",
                "team": ROW_NAME_B,
                "schule": None,
                "saison": ACTIVE_SAISON,
            },
            {
                "vorname": "Ortrud",
                "team": ROW_NAME_A_PAST,
                "schule": None,
                "saison": PAST_SAISON,
            },
        ]
        # A pupil with no squad row names nothing but themselves; the referee's one name is cut to its first part.
        assert body["spieler"]["kontext"] == {"vorname": "Ortrud", "team": None, "schule": None, "saison": None}
        assert body["schiedsrichter"][0]["kontext"] == {"vorname": "Ortrud"}

    def test_an_address_holding_nothing_is_answered_empty_rather_than_refused(self, mongo_replica_set_url: str):
        """The account page renders for every signed-in person."""

        async def steps(http: AsyncClient, _database: AsyncDatabase) -> Any:
            return await http.get(KONTO_PATH, headers=_person(NOBODY))

        response = served(mongo_replica_set_url, steps)

        assert response.status_code == 200, response.text
        assert {key: response.json()[key] for key in ("spieler", "schiedsrichter", "sitze", "bewerbungen", "registrierungen")} == {
            "spieler": None,
            "schiedsrichter": [],
            "sitze": [],
            "bewerbungen": [],
            "registrierungen": [],
        }

    def test_a_retired_referee_is_answered_for_withdrawal_alone(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, _database: AsyncDatabase) -> Any:
            return await http.get(KONTO_PATH, headers=_person(RETIRED))

        body = served(mongo_replica_set_url, steps).json()

        assert [(record["schiedsrichter_id"], record["erteilbar"]) for record in body["schiedsrichter"]] == [(str(RETIRED_OID), False)]


SEAT_RUNNING_LABEL = "2026-10-konto-kontakt"
# A seated grant's withdrawal: the seeded grants predate evidence, so each names its grant by the seat's
# own confirmation day (`_seat`'s) under the seat's label.
SEAT_WITHDRAWAL = {
    "am": AM,
    "text_version": SEAT_RUNNING_LABEL,
    "erteilt_zuvor": {"am": "2026-09-02T22:00:00+00:00", "text_version": SEAT_LABEL},
}


def _seat_path(team_id: ObjectId, saison_id: str) -> str:
    return f"/api/v{API_VERSION}/teams/{team_id}/saisons/{saison_id}/person/einwilligung"


async def _rows(database: AsyncDatabase) -> dict[Any, Any]:
    return {
        (row["team_id"], row["saison_id"]): row["kontakte"]
        async for row in database[Collection.SAISON_TEAMS].find({}, {"team_id": 1, "saison_id": 1, "kontakte": 1})
    }


def _seat_body(*, medien: bool, umfang: str = "kontaktdaten", label: str = SEAT_RUNNING_LABEL, stand: Any = None) -> dict[str, Any]:
    """A seat press from a page served the seeded seats, holding no evidence, unless `stand` says otherwise."""

    return {
        "umfang": umfang,
        "medien": medien,
        "text_version": label,
        "nachweis_stand": {"umfang": None, "medien": None} if stand is None else stand,
    }


def _seat_press(email: str, team_id: ObjectId, saison_id: str, medien: bool, *, label: str = SEAT_RUNNING_LABEL, before=None):
    async def steps(http: AsyncClient, database: AsyncDatabase) -> tuple[Any, dict[Any, Any], dict[Any, Any]]:
        if before is not None:
            await before(database)
        stored = await _rows(database)
        body = _seat_body(medien=medien, label=label)
        response = await http.patch(_seat_path(team_id, saison_id), json=body, headers=_person(email))
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
        assert row_after["stellvertretung"]["einwilligung"][NACHWEIS] == {"medien": SEAT_WITHDRAWAL}
        assert row_after["trainer"] == row_before["trainer"]
        assert {key: value for key, value in after.items() if key != (TEAM_B_OID, ACTIVE_SAISON)} == {
            key: value for key, value in before.items() if key != (TEAM_B_OID, ACTIVE_SAISON)
        }

    def test_a_past_seasons_seats_take_a_withdrawal_each_and_refuse_a_grant(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            body = _seat_body(medien=False)
            withdrawn = await http.patch(_seat_path(TEAM_A_OID, PAST_SAISON), json=body, headers=_person(IDENTIFIER))
            granted = await http.patch(
                _seat_path(TEAM_A_OID, PAST_SAISON),
                json={**body, "medien": True, "nachweis_stand": withdrawn.json()["nachweis_stand"]},
                headers=_person(IDENTIFIER),
            )
            return withdrawn, granted, await _rows(database)

        withdrawn, granted, after = served(mongo_replica_set_url, steps)

        assert withdrawn.status_code == 200, withdrawn.text
        assert sorted(withdrawn.json()["rollen"]) == ["ansprechperson", "trainer"]
        assert (granted.status_code, granted.json()["error_code"]) == (403, FUNKTION_NICHT_GEHALTEN)
        for slot in ("trainer", "ansprechperson"):
            seat = after[(TEAM_A_OID, PAST_SAISON)][slot]["einwilligung"]
            assert (seat["medien"], seat[NACHWEIS]) == (False, {"medien": SEAT_WITHDRAWAL})

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

    def test_a_press_from_a_page_served_older_evidence_is_refused_and_unwritten(self, mongo_replica_set_url: str):
        """Over every held seat: the read serves the latest of their instants, which a press elsewhere has moved."""

        async def withdrawn_elsewhere(database: AsyncDatabase) -> None:
            await database[Collection.SAISON_TEAMS].update_one(
                {"team_id": TEAM_B_OID, "saison_id": ACTIVE_SAISON},
                {"$set": {"kontakte.stellvertretung.einwilligung.nachweis.medien": {"am": AM, "text_version": SEAT_RUNNING_LABEL}}},
            )

        response, before, after = served(
            mongo_replica_set_url, _seat_press(IDENTIFIER, TEAM_B_OID, ACTIVE_SAISON, True, before=withdrawn_elsewhere)
        )

        assert (response.status_code, response.json()["error_code"]) == (409, EINWILLIGUNG_STAND_VERALTET)
        assert after == before

    def test_a_press_moving_no_seat_writes_nothing(self, mongo_replica_set_url: str):
        """The row's held seat already grants media, so pressing it on again restamps nothing and logs nothing."""

        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            before = await _rows(database), await database[Collection.AKTIONEN].count_documents({})
            response, _, _ = await _seat_press(IDENTIFIER, TEAM_B_OID, ACTIVE_SAISON, True)(http, database)
            return response, before, (await _rows(database), await database[Collection.AKTIONEN].count_documents({}))

        response, before, after = served(mongo_replica_set_url, steps)

        assert response.status_code == 200, response.text
        assert after == before

    def test_the_seat_confirmations_label_is_no_version_of_the_control(self, mongo_replica_set_url: str):
        response, before, after = served(mongo_replica_set_url, _seat_press(IDENTIFIER, TEAM_B_OID, ACTIVE_SAISON, False, label=SEAT_LABEL))

        assert (response.status_code, response.json()["error_code"]) == (409, FASSUNG_UNZULAESSIG)
        assert after == before


async def _whatsapp_on_every_held_seat(database: AsyncDatabase) -> None:
    """The asker's seats as their confirmations left them with WhatsApp granted: both past slots and the active one."""

    for (team_id, saison_id), slots in {
        (TEAM_A_OID, PAST_SAISON): ("trainer", "ansprechperson"),
        (TEAM_B_OID, ACTIVE_SAISON): ("stellvertretung",),
    }.items():
        await database[Collection.SAISON_TEAMS].update_one(
            {"team_id": team_id, "saison_id": saison_id},
            {"$set": {f"kontakte.{slot}.einwilligung.umfang": "kontaktdaten_whatsapp" for slot in slots}},
        )


@pytest.mark.db
class TestTheSeatsWhatsAppChoice:
    """The seat control moves the WhatsApp scope beside the media consent, each with its own evidence."""

    def test_a_past_seasons_withdrawal_lands_on_every_held_slot_naming_the_grant_it_ended(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            await _whatsapp_on_every_held_seat(database)
            response = await http.patch(_seat_path(TEAM_A_OID, PAST_SAISON), json=_seat_body(medien=True), headers=_person(IDENTIFIER))
            return response, await _rows(database)

        response, after = served(mongo_replica_set_url, steps)

        assert response.status_code == 200, response.text
        assert (response.json()["umfang"], response.json()["medien"]) == ("kontaktdaten", True)
        for slot in ("trainer", "ansprechperson"):
            seat = after[(TEAM_A_OID, PAST_SAISON)][slot]["einwilligung"]
            assert (seat["umfang"], seat["medien"], seat[NACHWEIS]) == ("kontaktdaten", True, {"umfang": SEAT_WITHDRAWAL})

    def test_a_past_seasons_re_grant_is_refused_and_unwritten(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            await _whatsapp_on_every_held_seat(database)
            withdrawn = await http.patch(_seat_path(TEAM_A_OID, PAST_SAISON), json=_seat_body(medien=True), headers=_person(IDENTIFIER))
            before = await _rows(database)
            granted = await http.patch(
                _seat_path(TEAM_A_OID, PAST_SAISON),
                json=_seat_body(medien=True, umfang="kontaktdaten_whatsapp", stand=withdrawn.json()["nachweis_stand"]),
                headers=_person(IDENTIFIER),
            )
            return withdrawn, granted, before, await _rows(database)

        withdrawn, granted, before, after = served(mongo_replica_set_url, steps)

        assert withdrawn.status_code == 200, withdrawn.text
        assert (granted.status_code, granted.json()["error_code"]) == (403, FUNKTION_NICHT_GEHALTEN)
        assert after == before

    def test_a_live_re_grant_is_taken_and_counted_as_the_contact_persons(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            await _whatsapp_on_every_held_seat(database)
            path = _seat_path(TEAM_B_OID, ACTIVE_SAISON)
            withdrawn = await http.patch(path, json=_seat_body(medien=True), headers=_person(IDENTIFIER))
            counted_after_withdrawal = [row async for row in database[Collection.DROSSELUNG].find({})]
            granted = await http.patch(
                path,
                json=_seat_body(medien=True, umfang="kontaktdaten_whatsapp", stand=withdrawn.json()["nachweis_stand"]),
                headers=_person(IDENTIFIER),
            )
            return granted, counted_after_withdrawal, [row async for row in database[Collection.DROSSELUNG].find({})], await _rows(database)

        granted, counted_after_withdrawal, counted, after = served(mongo_replica_set_url, steps)

        assert granted.status_code == 200, granted.text
        assert after[(TEAM_B_OID, ACTIVE_SAISON)]["stellvertretung"]["einwilligung"]["umfang"] == "kontaktdaten_whatsapp"
        assert counted_after_withdrawal == []
        assert [(row["_id"].split(":")[0], row["n"]) for row in counted] == [("kontakt", 1)]

    def test_moving_the_scope_leaves_the_media_consent_and_its_evidence_standing(self, mongo_replica_set_url: str):
        """The media evidence seeded first, so a write setting the block's evidence whole is seen to drop it."""

        medien_beleg = {"am": "2026-09-20T08:00:00+00:00", "text_version": SEAT_RUNNING_LABEL}

        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            await _whatsapp_on_every_held_seat(database)
            await database[Collection.SAISON_TEAMS].update_one(
                {"team_id": TEAM_B_OID, "saison_id": ACTIVE_SAISON},
                {"$set": {"kontakte.stellvertretung.einwilligung.nachweis": {"medien": medien_beleg}}},
            )
            served_stand = next(
                sitz["nachweis_stand"]
                for sitz in (await http.get(KONTO_PATH, headers=_person(IDENTIFIER))).json()["sitze"]
                if sitz["team_id"] == str(TEAM_B_OID)
            )
            response = await http.patch(
                _seat_path(TEAM_B_OID, ACTIVE_SAISON), json=_seat_body(medien=True, stand=served_stand), headers=_person(IDENTIFIER)
            )
            return response, await _rows(database)

        response, after = served(mongo_replica_set_url, steps)

        assert response.status_code == 200, response.text
        seat = after[(TEAM_B_OID, ACTIVE_SAISON)]["stellvertretung"]["einwilligung"]
        assert (seat["umfang"], seat["medien"], seat[NACHWEIS]["medien"]) == ("kontaktdaten", True, medien_beleg)
        assert seat[NACHWEIS]["umfang"] == SEAT_WITHDRAWAL

    def test_a_press_from_a_page_served_before_the_scope_moved_is_refused_and_unwritten(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            await _whatsapp_on_every_held_seat(database)
            path = _seat_path(TEAM_B_OID, ACTIVE_SAISON)
            first = await http.patch(path, json=_seat_body(medien=True), headers=_person(IDENTIFIER))
            before = await _rows(database)
            stale = await http.patch(path, json=_seat_body(medien=False), headers=_person(IDENTIFIER))
            return first, stale, before, await _rows(database)

        first, stale, before, after = served(mongo_replica_set_url, steps)

        assert first.status_code == 200, first.text
        assert (stale.status_code, stale.json()["error_code"]) == (409, EINWILLIGUNG_STAND_VERALTET)
        assert after == before


ANSICHT_PATH = f"/api/v{API_VERSION}/bewerbungen/einwilligung/ansicht"
BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607850031")
# The school as the application named it, apart from the club's and the season row's names, so a fill
# taken from any of those two is seen to be wrong.
BEWERBUNG_SCHULE = "Helmholtz, wie beworben"
BEWERBUNG_TOKENS = {seat: f"bewerbungslink-{seat}" for seat in ("trainer", "ansprechperson", "stellvertretung")}
SAISON_TOKEN = "saisonlink-stellvertretung"


async def _both_homes(database: AsyncDatabase) -> None:
    """The past row's seats confirmed through the admitted application, the active row's through a link the row minted."""

    await database[Collection.BEWERBUNGEN].insert_one(
        {
            "_id": BEWERBUNG_OID,
            "saison_id": PAST_SAISON,
            "eingereicht_am": "2025-01-10",
            "status": "angenommen",
            "team_id": TEAM_A_OID,
            "schule": {
                "team_name": BEWERBUNG_SCHULE,
                "full_name": f"{BEWERBUNG_SCHULE}-Schule",
                "shorthand": "HW",
                "schulform": None,
                "address": dict(ADDRESS),
                "website_url": None,
            },
            "kontakte": _kontakte(
                trainer=_seat(REFEREE_STORED),
                ansprechperson=_seat(REFEREE_STORED),
                stellvertretung=_seat(BYSTANDER),
                trainer_ist_zugleich="ansprechperson",
            ),
            "trikot": {"vorhandener_satz": "keiner", "wunschfarbe": "rot"},
            "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
            "wunschgegner": None,
            "entscheidung": None,
            "bestaetigungsfrist": "2025-01-24",
            "bestaetigungen": compose_bestaetigungen(
                hashes={seat: hash_token(token) for seat, token in BEWERBUNG_TOKENS.items()}, today="2025-01-10"
            ),
        }
    )
    link = {"token_hash": hash_token(SAISON_TOKEN), "verschickt_am": "2026-09-01", "frist": "2026-09-15", "abgelehnt_am": None}
    await database[Collection.SAISON_TEAMS].update_one(
        {"team_id": TEAM_B_OID, "saison_id": ACTIVE_SAISON},
        {"$set": {"bestaetigungen": {"trainer": None, "ansprechperson": None, "stellvertretung": link}}},
    )


@pytest.mark.db
class TestTheWordsAreFilledAsTheirPageFilledThem:
    """A seat's fills are the ones the confirmation page of the home its person confirmed it through serves, read the same way."""

    def test_each_seats_fills_equal_what_its_own_confirmation_page_serves(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            await _both_homes(database)
            konto = await http.get(KONTO_PATH, headers=_person(IDENTIFIER))
            bewerbung = await http.post(ANSICHT_PATH, json={"token": BEWERBUNG_TOKENS["trainer"]}, headers=BASE_AUTH)
            saison = await http.post(ANSICHT_PATH, json={"token": SAISON_TOKEN}, headers=BASE_AUTH)
            return konto, bewerbung, saison

        konto, bewerbung, saison = served(mongo_replica_set_url, steps)

        assert (konto.status_code, bewerbung.status_code, saison.status_code) == (200, 200, 200), (bewerbung.text, saison.text)
        eintraege = {(entry["team_id"], entry["saison_id"]): entry for entry in konto.json()["sitze"]}
        kontexte = {key: entry["kontext"] for key, entry in eintraege.items()}

        for (team_id, saison_id), page in (((TEAM_A_OID, PAST_SAISON), bewerbung.json()), ((TEAM_B_OID, ACTIVE_SAISON), saison.json())):
            kontext = kontexte[(str(team_id), saison_id)]
            assert (kontext["vorname"], kontext["schule"], kontext["saison"]) == (page["vorname"], page["schule"], page["saison_id"])
            # The role the page named is one the entry's `rollen` serves, which the account page fills `{rolle}` from.
            assert page["rolle"] in eintraege[(str(team_id), saison_id)]["rollen"]
        assert kontexte[(str(TEAM_A_OID), PAST_SAISON)]["schule"] == BEWERBUNG_SCHULE
        assert kontexte[(str(TEAM_B_OID), ACTIVE_SAISON)]["schule"] == ROW_NAME_B


PENDING_OID = ObjectId("6890a1b2c3d4e5f607850051")
DECIDED_OID = ObjectId("6890a1b2c3d4e5f607850052")
UNANSWERED_OID = ObjectId("6890a1b2c3d4e5f607850053")
PENDING_SCHULE = "Goethe, wie beworben"


def _bewerbung(oid: ObjectId, *, status: str, kontakte: dict[str, Any]) -> dict[str, Any]:
    """An application naming its school, as the submission stores one; `kontakte` its seats as the case needs them."""

    return {
        "_id": oid,
        "saison_id": ACTIVE_SAISON,
        "eingereicht_am": "2026-09-01",
        "status": status,
        "team_id": None,
        "schule": {
            "team_name": PENDING_SCHULE,
            "full_name": f"{PENDING_SCHULE}-Schule",
            "shorthand": "GW",
            "schulform": None,
            "address": dict(ADDRESS),
            "website_url": None,
        },
        "kontakte": kontakte,
        "trikot": {"vorhandener_satz": "keiner", "wunschfarbe": "rot"},
        "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
        "wunschgegner": None,
        "entscheidung": None,
        "bestaetigungsfrist": "2026-09-15",
        "bestaetigungen": compose_bestaetigungen(
            hashes={seat: hash_token(f"{oid}-{seat}") for seat in ("trainer", "ansprechperson", "stellvertretung")}, today="2026-09-01"
        ),
    }


async def _applications(database: AsyncDatabase) -> None:
    """A pending application this person confirmed two seats on, granting media; a decided one; and one they have not answered."""

    await database[Collection.BEWERBUNGEN].insert_many(
        [
            _bewerbung(
                PENDING_OID,
                status="eingereicht",
                kontakte=_kontakte(
                    trainer=_seat(REFEREE_STORED, medien=True),
                    ansprechperson=_seat(REFEREE_STORED, medien=True),
                    stellvertretung=_seat(BYSTANDER, medien=True),
                    trainer_ist_zugleich="ansprechperson",
                ),
            ),
            _bewerbung(DECIDED_OID, status="angenommen", kontakte=_kontakte(trainer=_seat(REFEREE_STORED, medien=True))),
            _bewerbung(UNANSWERED_OID, status="eingereicht", kontakte=_kontakte(trainer=_seat(REFEREE_STORED, bestaetigt_am=None))),
        ]
    )


def _application_path(bewerbung_id: ObjectId) -> str:
    return f"/api/v{API_VERSION}/bewerbungen/{bewerbung_id}/person/einwilligung"


def _withdrawal(*, stand: Any = None, label: str = SEAT_RUNNING_LABEL, medien: bool = False) -> dict[str, Any]:
    return _seat_body(medien=medien, label=label, stand=stand)


async def _application_docs(database: AsyncDatabase) -> dict[Any, Any]:
    return {row["_id"]: row["kontakte"] async for row in database[Collection.BEWERBUNGEN].find({}, {"kontakte": 1})}


@pytest.mark.db
class TestAPendingApplicationsSeats:
    """A media consent given on an application's link is withdrawn on the account page before the application is decided."""

    def test_the_read_lists_a_pending_application_the_address_confirmed_and_no_other(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            await _applications(database)
            return await http.get(KONTO_PATH, headers=_person(IDENTIFIER))

        response = served(mongo_replica_set_url, steps)

        assert response.status_code == 200, response.text
        assert response.json()["bewerbungen"] == [
            {
                "bewerbung_id": str(PENDING_OID),
                "schule": PENDING_SCHULE,
                "saison_id": ACTIVE_SAISON,
                "rollen": ["trainer", "ansprechperson"],
                "bestaetigt_text_version": SEAT_LABEL,
                "umfang": "kontaktdaten",
                "medien": True,
                "nachweis_stand": {"umfang": None, "medien": None},
                "mindestalter": mindestalter_for(["trainer", "ansprechperson"]),
                "kontext": {"vorname": "Ortrud", "team": PENDING_SCHULE, "schule": PENDING_SCHULE, "saison": ACTIVE_SAISON},
            }
        ]

    def test_a_withdrawal_reaches_every_seat_the_person_holds_there_and_no_other(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            await _applications(database)
            before = await _application_docs(database)
            response = await http.patch(_application_path(PENDING_OID), json=_withdrawal(), headers=_person(IDENTIFIER))
            return response, before, await _application_docs(database)

        response, before, after = served(mongo_replica_set_url, steps)

        assert response.status_code == 200, response.text
        assert response.json() == {
            "acknowledged": 1,
            "bewerbung_id": str(PENDING_OID),
            "rollen": ["trainer", "ansprechperson"],
            "umfang": "kontaktdaten",
            "medien": False,
            "nachweis_stand": nachweis_stand_of(
                bloecke=[after[PENDING_OID][slot]["einwilligung"] for slot in ("trainer", "ansprechperson")], wahlen=WAHLEN
            ),
        }
        for slot in ("trainer", "ansprechperson"):
            einwilligung = after[PENDING_OID][slot]["einwilligung"]
            assert (einwilligung["medien"], einwilligung[NACHWEIS]) == (False, {"medien": SEAT_WITHDRAWAL})
        assert after[PENDING_OID]["stellvertretung"] == before[PENDING_OID]["stellvertretung"]
        assert {key: value for key, value in after.items() if key != PENDING_OID} == {
            key: value for key, value in before.items() if key != PENDING_OID
        }

    def test_a_withdrawal_finding_every_seat_off_writes_nothing(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            await _applications(database)
            await database[Collection.BEWERBUNGEN].update_one(
                {"_id": PENDING_OID}, {"$set": {f"kontakte.{slot}.einwilligung.medien": False for slot in ("trainer", "ansprechperson")}}
            )
            before = await _application_docs(database), await database[Collection.AKTIONEN].count_documents({})
            response = await http.patch(_application_path(PENDING_OID), json=_withdrawal(), headers=_person(IDENTIFIER))
            return response, before, (await _application_docs(database), await database[Collection.AKTIONEN].count_documents({}))

        response, before, after = served(mongo_replica_set_url, steps)

        assert response.status_code == 200, response.text
        assert after == before

    @pytest.mark.parametrize(("email", "bewerbung_id"), [(IDENTIFIER, DECIDED_OID), (IDENTIFIER, UNANSWERED_OID), (NOBODY, PENDING_OID)])
    def test_a_decided_application_or_one_holding_no_confirmed_seat_of_the_address_is_refused(
        self, mongo_replica_set_url: str, email: str, bewerbung_id: ObjectId
    ):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            await _applications(database)
            before = await _application_docs(database)
            response = await http.patch(_application_path(bewerbung_id), json=_withdrawal(), headers=_person(email))
            return response, before, await _application_docs(database)

        response, before, after = served(mongo_replica_set_url, steps)

        assert (response.status_code, response.json()["error_code"]) == (403, FUNKTION_NICHT_GEHALTEN)
        assert after == before

    @pytest.mark.parametrize(
        ("umfang", "medien"), [("kontaktdaten_whatsapp", False), ("kontaktdaten", True)], ids=["the WhatsApp scope", "the media consent"]
    )
    def test_a_grant_of_either_choice_is_refused_uncounted_and_unwritten(self, mongo_replica_set_url: str, umfang: str, medien: bool):
        """Withdraw-only by kind: the season seat's payload carries a grant, and the press refuses it before any rule a grant meets."""

        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            await _applications(database)
            await database[Collection.BEWERBUNGEN].update_one(
                {"_id": PENDING_OID}, {"$set": {f"kontakte.{slot}.einwilligung.medien": False for slot in ("trainer", "ansprechperson")}}
            )
            before = await _application_docs(database)
            body = {**_withdrawal(), "umfang": umfang, "medien": medien}
            response = await http.patch(_application_path(PENDING_OID), json=body, headers=_person(IDENTIFIER))
            return response, before, await _application_docs(database), await database[Collection.DROSSELUNG].count_documents({})

        response, before, after, counted = served(mongo_replica_set_url, steps)

        assert (response.status_code, response.json()["error_code"]) == (403, FUNKTION_NICHT_GEHALTEN)
        assert (after, counted) == (before, 0)

    def test_a_whatsapp_withdrawal_reaches_every_seat_the_person_holds_there(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            await _applications(database)
            await database[Collection.BEWERBUNGEN].update_one(
                {"_id": PENDING_OID},
                {"$set": {f"kontakte.{slot}.einwilligung.umfang": "kontaktdaten_whatsapp" for slot in ("trainer", "ansprechperson")}},
            )
            response = await http.patch(_application_path(PENDING_OID), json=_withdrawal(medien=True), headers=_person(IDENTIFIER))
            return response, await _application_docs(database), await database[Collection.DROSSELUNG].count_documents({})

        response, after, counted = served(mongo_replica_set_url, steps)

        assert response.status_code == 200, response.text
        for slot in ("trainer", "ansprechperson"):
            einwilligung = after[PENDING_OID][slot]["einwilligung"]
            assert (einwilligung["umfang"], einwilligung["medien"], einwilligung[NACHWEIS]) == (
                "kontaktdaten",
                True,
                {"umfang": SEAT_WITHDRAWAL},
            )
        assert counted == 0

    def test_a_press_from_a_page_served_older_evidence_is_refused_and_unwritten(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            await _applications(database)
            first = await http.patch(_application_path(PENDING_OID), json=_withdrawal(), headers=_person(IDENTIFIER))
            before = await _application_docs(database)
            again = await http.patch(_application_path(PENDING_OID), json=_withdrawal(), headers=_person(IDENTIFIER))
            return first, again, before, await _application_docs(database)

        first, again, before, after = served(mongo_replica_set_url, steps)

        assert first.status_code == 200, first.text
        assert (again.status_code, again.json()["error_code"]) == (409, EINWILLIGUNG_STAND_VERALTET)
        assert after == before


REGISTRIERUNG_OWN = ObjectId("6890a1b2c3d4e5f607850061")
REGISTRIERUNG_UNCONFIRMED = ObjectId("6890a1b2c3d4e5f607850062")
REGISTRIERUNG_DECLINED = ObjectId("6890a1b2c3d4e5f607850063")
REGISTRIERUNG_RETURNING = ObjectId("6890a1b2c3d4e5f607850064")
REGISTRIERUNG_BYSTANDER = ObjectId("6890a1b2c3d4e5f607850065")
# The new pupil's grant, evidenced by the confirmation that gave it.
REGISTRIERUNG_GRANT = {"am": "2026-09-21T08:00:00+00:00", "text_version": LAUFENDE_FASSUNGEN["bestaetigung_spieler"]}


def _registrierung(oid: ObjectId, email: str, *, seite: Seite | None = "bestaetigung_spieler", **choices: Any) -> dict[str, Any]:
    """A registration as its composers leave it; `seite` the confirmation page its pupil answered, `None` for none yet."""

    gewaehlt = (
        {"umfang": "kader_oeffentlich", "medien": True, **choices} if seite == "bestaetigung_spieler" else {"umfang": None, "medien": None}
    )

    return registrierung_document(
        oid,
        email,
        saison_id=ACTIVE_SAISON,
        team_id=TEAM_A_OID,
        vorname="Ortrud",
        nachname="Zwiebelmayer",
        token=str(oid),
        eingereicht_am="2026-09-20",
        frist="2026-09-27",
        position="Mittelfeld",
        nummer="17",
        stufe="Q1",
        bestaetigt=None
        if seite is None
        else {
            "geburtsdatum": SEVENTEEN_BIRTHDATE,
            "text_version": LAUFENDE_FASSUNGEN[seite],
            "today": "2026-09-21",
            "am": REGISTRIERUNG_GRANT["am"],
            **gewaehlt,
        },
    )


async def _registrierungen(database: AsyncDatabase, **choices: Any) -> None:
    """The person's own registration, stored as typed; one of theirs in each state that leaves nothing to change; a stranger's."""

    declined = _registrierung(REGISTRIERUNG_DECLINED, REFEREE_STORED)
    declined.update(compose_ablehnung_update(von="verwaltung@schule.de", grund=None, today="2026-09-22")["$set"])
    await database[Collection.REGISTRIERUNGEN].insert_many(
        [
            _registrierung(REGISTRIERUNG_OWN, REFEREE_STORED, **choices),
            _registrierung(REGISTRIERUNG_UNCONFIRMED, IDENTIFIER, seite=None),
            declined,
            _registrierung(REGISTRIERUNG_RETURNING, IDENTIFIER, seite="bestaetigung_spieler_wiederkehrend"),
            _registrierung(REGISTRIERUNG_BYSTANDER, BYSTANDER),
        ]
    )


def _registrierung_path(registrierung_id: ObjectId) -> str:
    return f"/api/v{API_VERSION}/registrierungen/selbst/{registrierung_id}/einwilligung"


async def _registrierung_docs(database: AsyncDatabase) -> dict[Any, Any]:
    return {row["_id"]: row async for row in database[Collection.REGISTRIERUNGEN].find({})}


def _registrierung_body(database_row: Mapping[str, Any], **gewaehlt: Any) -> dict[str, Any]:
    """A press from a page served the registration as stored, keeping each choice the case does not move."""

    block = database_row["einwilligung"]

    return {
        "umfang": block["umfang"],
        "medien": block["medien"],
        "text_version": LAUFENDE_FASSUNGEN["konto_spieler"],
        "nachweis_stand": nachweis_stand_of(bloecke=[block], wahlen=WAHLEN),
        **gewaehlt,
    }


@pytest.mark.db
class TestAPendingRegistration:
    """A consent a new pupil gave on their registration's link, withdrawn on the account page before their team decides."""

    def test_a_withdrawal_lands_with_its_evidence_and_moves_nothing_else(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            await _registrierungen(database)
            before = await _registrierung_docs(database)
            body = _registrierung_body(before[REGISTRIERUNG_OWN], umfang="intern")
            response = await http.patch(_registrierung_path(REGISTRIERUNG_OWN), json=body, headers=_person(IDENTIFIER))
            return response, before, await _registrierung_docs(database), await database[Collection.DROSSELUNG].count_documents({})

        response, before, after, counted = served(mongo_replica_set_url, steps)

        assert response.status_code == 200, response.text
        einwilligung = after[REGISTRIERUNG_OWN]["einwilligung"]
        assert response.json() == {
            "acknowledged": 1,
            "registrierung_id": str(REGISTRIERUNG_OWN),
            # As the read model serves the stored block, every declared field spelled.
            "einwilligung": FLRegistrierungEinwilligung.model_validate(einwilligung).model_dump(mode="json"),
            "nachweis_stand": nachweis_stand_of(bloecke=[einwilligung], wahlen=WAHLEN),
        }
        assert (einwilligung["umfang"], einwilligung[NACHWEIS]["umfang"]) == (
            "intern",
            {"am": AM, "text_version": LAUFENDE_FASSUNGEN["konto_spieler"], "erteilt_zuvor": REGISTRIERUNG_GRANT},
        )
        stood = before[REGISTRIERUNG_OWN]["einwilligung"]
        # The other choice, its evidence, the days and the label the pupil confirmed all stand.
        assert {key: value for key, value in einwilligung.items() if key not in ("umfang", NACHWEIS)} == {
            key: value for key, value in stood.items() if key not in ("umfang", NACHWEIS)
        }
        assert einwilligung[NACHWEIS]["medien"] == stood[NACHWEIS]["medien"]
        assert {key: value for key, value in after.items() if key != REGISTRIERUNG_OWN} == {
            key: value for key, value in before.items() if key != REGISTRIERUNG_OWN
        }
        assert counted == 0

    @pytest.mark.parametrize(
        ("umfang", "medien"), [("kader_oeffentlich", False), ("intern", True)], ids=["the publication scope", "the media consent"]
    )
    def test_a_grant_of_either_choice_is_refused_uncounted_and_unwritten(self, mongo_replica_set_url: str, umfang: str, medien: bool):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            await _registrierungen(database, umfang="intern", medien=False)
            before = await _registrierung_docs(database)
            body = _registrierung_body(before[REGISTRIERUNG_OWN], umfang=umfang, medien=medien)
            response = await http.patch(_registrierung_path(REGISTRIERUNG_OWN), json=body, headers=_person(IDENTIFIER))
            return response, before, await _registrierung_docs(database), await database[Collection.DROSSELUNG].count_documents({})

        response, before, after, counted = served(mongo_replica_set_url, steps)

        assert (response.status_code, response.json()["error_code"]) == (403, FUNKTION_NICHT_GEHALTEN)
        assert (after, counted) == (before, 0)

    @pytest.mark.parametrize(
        "registrierung_id",
        [REGISTRIERUNG_UNCONFIRMED, REGISTRIERUNG_DECLINED, REGISTRIERUNG_RETURNING, REGISTRIERUNG_BYSTANDER],
        ids=["unconfirmed", "declined", "a returning pupil's, carrying no choice", "another address's"],
    )
    def test_a_registration_leaving_this_person_nothing_to_withdraw_is_refused(self, mongo_replica_set_url: str, registrierung_id: ObjectId):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            await _registrierungen(database)
            before = await _registrierung_docs(database)
            # The own registration's stand and choices, so only the record the path names can refuse.
            body = _registrierung_body(before[REGISTRIERUNG_OWN], umfang="intern")
            response = await http.patch(_registrierung_path(registrierung_id), json=body, headers=_person(IDENTIFIER))
            return response, before, await _registrierung_docs(database)

        response, before, after = served(mongo_replica_set_url, steps)

        assert (response.status_code, response.json()["error_code"]) == (403, FUNKTION_NICHT_GEHALTEN)
        assert after == before

    def test_a_press_from_a_page_served_older_evidence_is_refused_and_unwritten(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            await _registrierungen(database)
            served_page = _registrierung_body((await _registrierung_docs(database))[REGISTRIERUNG_OWN], medien=False)
            first = await http.patch(_registrierung_path(REGISTRIERUNG_OWN), json=served_page, headers=_person(IDENTIFIER))
            before = await _registrierung_docs(database)
            again = await http.patch(
                _registrierung_path(REGISTRIERUNG_OWN), json={**served_page, "umfang": "intern"}, headers=_person(IDENTIFIER)
            )
            return first, again, before, await _registrierung_docs(database)

        first, again, before, after = served(mongo_replica_set_url, steps)

        assert first.status_code == 200, first.text
        assert (again.status_code, again.json()["error_code"]) == (409, EINWILLIGUNG_STAND_VERALTET)
        assert after == before

    def test_a_label_naming_no_version_of_the_pupils_control_is_refused(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            await _registrierungen(database)
            before = await _registrierung_docs(database)
            body = {**_registrierung_body(before[REGISTRIERUNG_OWN], umfang="intern"), "text_version": LAUFENDE_FASSUNGEN["konto_kontakt"]}
            response = await http.patch(_registrierung_path(REGISTRIERUNG_OWN), json=body, headers=_person(IDENTIFIER))
            return response, before, await _registrierung_docs(database)

        response, before, after = served(mongo_replica_set_url, steps)

        assert (response.status_code, response.json()["error_code"]) == (409, FASSUNG_UNZULAESSIG)
        assert after == before

    def test_the_read_lists_the_own_registration_alone(self, mongo_replica_set_url: str):
        async def steps(http: AsyncClient, database: AsyncDatabase) -> Any:
            await _registrierungen(database)
            return await http.get(KONTO_PATH, headers=_person(IDENTIFIER))

        response = served(mongo_replica_set_url, steps)

        assert response.status_code == 200, response.text
        assert [entry["registrierung_id"] for entry in response.json()["registrierungen"]] == [str(REGISTRIERUNG_OWN)]
