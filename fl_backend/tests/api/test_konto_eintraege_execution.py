"""
API · the sign-in gate and the account page answer one set of own records

The gate admits an address holding any own record, and the account page is where that person lands: a record
the gate counts and the page leaves out is a person signed in to an empty page, and one the page serves and
the gate misses is a person who cannot sign in to withdraw a consent. Both sides read through the shared
selections and predicates, so each case also holds the set to what the seed means, where a predicate wrong on
both sides alike would leave the two equal.
"""

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identitaet.crud import find_eigene_eintraege
from app.api.registrierungen.services import compose_ablehnung_update
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.shared.einwilligung import LAUFENDE_FASSUNGEN, Seite
from app.shared.folding import sign_in_identifier
from app.shared.schemas.bounds import MEDIEN_MIN_AGE_YEARS, REGISTRIERUNG_MIN_ALTER_JAHRE
from tests.actor_tokens import SignedActor
from tests.app_client import app_client
from tests.config import ADMIN_KEY
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import (
    bewerbung_document,
    eigene_einwilligung_document,
    kontakte_document,
    kontaktsitz_document,
    neue_schule_document,
    registrierung_bestaetigt,
    registrierung_document,
    saison_document,
    saison_team_document,
    schiedsrichter_document,
    spieler_document,
    team_document,
)
from tests.records import record_collections
from tests.worker import worker_database

from .conftest import AUSTRITT, config_for

DATABASE_NAME = worker_database("fl_konto_eintraege_test")

CONFIG = config_for(DATABASE_NAME)

KONTO_PATH = f"/api/v{API_VERSION}/konto/einwilligungen"

NOW = datetime(2026, 10, 3, 12, 0, tzinfo=ZoneInfo("Europe/Berlin"))

PAST, ACTIVE = "2025", "2026"

# One address holding every kind, several records of some and every state of each.
WILTRUDIS = "wiltrudis.ehrenpreis@schule.de"
# Asked with its domain in Unicode, stored in punycode.
KAETHE = "käthe@müller.de"
NIEMAND = "niemand@schule.de"

TEAMS = [ObjectId(f"6890a1b2c3d4e5f6078600{n:02d}") for n in range(1, 6)]

PUPIL = ObjectId("6890a1b2c3d4e5f607860101")
REFEREE_LIVE = ObjectId("6890a1b2c3d4e5f607860111")
REFEREE_RETIRED = ObjectId("6890a1b2c3d4e5f607860112")
REFEREE_UNCONFIRMED = ObjectId("6890a1b2c3d4e5f607860113")
REFEREE_KAETHE = ObjectId("6890a1b2c3d4e5f607860114")

BEWERBUNG_PENDING = ObjectId("6890a1b2c3d4e5f607860121")
BEWERBUNG_DECIDED = ObjectId("6890a1b2c3d4e5f607860122")
BEWERBUNG_UNANSWERED = ObjectId("6890a1b2c3d4e5f607860123")

REGISTRIERUNG_NEW = ObjectId("6890a1b2c3d4e5f607860131")
REGISTRIERUNG_UNCONFIRMED = ObjectId("6890a1b2c3d4e5f607860132")
REGISTRIERUNG_DECLINED = ObjectId("6890a1b2c3d4e5f607860133")
REGISTRIERUNG_RETURNING = ObjectId("6890a1b2c3d4e5f607860134")
REGISTRIERUNG_KAETHE = ObjectId("6890a1b2c3d4e5f607860135")
# Another mailbox by the fold, which lowercases ASCII alone, and one a case-insensitive pattern still admits.
REGISTRIERUNG_KAETHE_UPPER = ObjectId("6890a1b2c3d4e5f607860136")

EXPECTED: dict[str, set[tuple[str, str]]] = {
    WILTRUDIS: {
        ("spieler", str(PUPIL)),
        ("schiedsrichter", str(REFEREE_LIVE)),
        ("schiedsrichter", str(REFEREE_RETIRED)),
        ("sitze", f"{TEAMS[0]}/{PAST}"),
        ("sitze", f"{TEAMS[1]}/{ACTIVE}"),
        ("sitze", f"{TEAMS[2]}/{ACTIVE}"),
        ("bewerbungen", str(BEWERBUNG_PENDING)),
        ("registrierungen", str(REGISTRIERUNG_NEW)),
        ("registrierungen", str(REGISTRIERUNG_RETURNING)),
    },
    KAETHE: {("schiedsrichter", str(REFEREE_KAETHE)), ("registrierungen", str(REGISTRIERUNG_KAETHE))},
    NIEMAND: set(),
}


def _person(email: str) -> SignedActor:
    return SignedActor(email, ADMIN_KEY, lane="person")


def _einwilligung(**fields: Any) -> dict[str, Any]:
    return eigene_einwilligung_document(text_version="2026-09-schiedsrichterseite-3", bestaetigt_am="2026-09-02", **fields)


def _referee(referee_id: ObjectId, email: str, name: str, **fields: Any) -> dict[str, Any]:
    return schiedsrichter_document(
        referee_id, email=email, name=name, default_payment=20, **{"einwilligung": _einwilligung(), "geburtsdatum": "2000-05-09", **fields}
    )


def _seat(email: str, *, bestaetigt_am: str | None = "2026-09-03") -> dict[str, Any]:
    return kontaktsitz_document(
        email,
        vorname="Wiltrudis",
        text_version="2026-09-bestaetigungsseite-6",
        bestaetigt_am=bestaetigt_am,
        geburtsdatum="2000-05-09",
        medien=True,
    )


def _kontakte(**seats: Any) -> dict[str, Any]:
    return kontakte_document(**seats)


def _bewerbung(oid: ObjectId, *, status: str, kontakte: dict[str, Any]) -> dict[str, Any]:
    return bewerbung_document(
        oid,
        ACTIVE,
        status,
        kontakte=kontakte,
        eingereicht_am="2026-09-01",
        bestaetigungsfrist="2026-09-15",
        schule=neue_schule_document(f"Schule {oid}", "SW"),
    )


def _registrierung(oid: ObjectId, email: str, *, seite: Seite | None = "bestaetigung_spieler", vorname: str = "Wiltrudis") -> dict[str, Any]:
    """A registration as its composers leave it; `seite` the confirmation page its pupil answered, `None` for none yet."""

    gewaehlt: dict[str, Any] = {"umfang": "kader_oeffentlich", "medien": True} if seite == "bestaetigung_spieler" else {}
    bestaetigt = (
        None
        if seite is None
        else registrierung_bestaetigt(seite, geburtsdatum="2008-05-09", today="2026-09-21", am="2026-09-21T08:00:00+00:00", **gewaehlt)
    )

    return registrierung_document(
        oid,
        email,
        saison_id=ACTIVE,
        team_id=TEAMS[3],
        vorname=vorname,
        nachname="Ehrenpreis",
        token=str(oid),
        eingereicht_am="2026-09-20",
        frist="2026-09-27",
        position="Mittelfeld",
        nummer="17",
        stufe="Q1",
        bestaetigt=bestaetigt,
    )


async def _seed(database: AsyncDatabase) -> None:
    await database[Collection.TEAMS].insert_many([team_document(team_id, f"Schule{n}", f"S{n}") for n, team_id in enumerate(TEAMS)])
    await database[Collection.SAISONS].insert_many([saison_document(PAST, "past"), saison_document(ACTIVE, "active")])
    await database[Collection.SPIELER].insert_one(
        spieler_document(PUPIL, "Wiltrudis", "Ehrenpreis", email=WILTRUDIS, geburtsdatum="2008-05-09", einwilligung=_einwilligung())
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            _referee(REFEREE_LIVE, "Wiltrudis.Ehrenpreis@Schule.de", "Wiltrudis Ehrenpreis"),
            _referee(REFEREE_RETIRED, WILTRUDIS, "Wiltrudis E.", inactive_since="2026-07-01"),
            _referee(REFEREE_UNCONFIRMED, WILTRUDIS, "W. Ehrenpreis", einwilligung=None),
            _referee(REFEREE_KAETHE, "käthe@xn--mller-kva.de", "Käthe Müller"),
            # The ghost carries the address too, so a side reaching it would count a row nobody stands behind.
            _referee(GHOST_SCHIEDSRICHTER_ID, WILTRUDIS, "Niemand", inactive_since="2000-01-01"),
        ]
    )
    await database[Collection.SAISON_TEAMS].insert_many(
        [
            saison_team_document(PAST, TEAMS[0], "Schule0", "S0", kontakte=_kontakte(trainer=_seat("Wiltrudis.Ehrenpreis@Schule.DE"))),
            saison_team_document(
                ACTIVE,
                TEAMS[1],
                "Schule1",
                "S1",
                kontakte=_kontakte(trainer=_seat(WILTRUDIS), ansprechperson=_seat(WILTRUDIS), trainer_ist_zugleich="ansprechperson"),
            ),
            # A withdrawn team's seat: its consent stands, so it stays the person's to withdraw.
            saison_team_document(ACTIVE, TEAMS[2], "Schule2", "S2", austritt=dict(AUSTRITT), kontakte=_kontakte(trainer=_seat(WILTRUDIS))),
            saison_team_document(ACTIVE, TEAMS[4], "Schule4", "S4", kontakte=_kontakte(trainer=_seat(WILTRUDIS, bestaetigt_am=None))),
        ]
    )
    await database[Collection.BEWERBUNGEN].insert_many(
        [
            _bewerbung(BEWERBUNG_PENDING, status="eingereicht", kontakte=_kontakte(stellvertretung=_seat(WILTRUDIS))),
            _bewerbung(BEWERBUNG_DECIDED, status="angenommen", kontakte=_kontakte(trainer=_seat(WILTRUDIS))),
            _bewerbung(BEWERBUNG_UNANSWERED, status="eingereicht", kontakte=_kontakte(trainer=_seat(WILTRUDIS, bestaetigt_am=None))),
        ]
    )
    declined = _registrierung(REGISTRIERUNG_DECLINED, WILTRUDIS)
    declined.update(compose_ablehnung_update(von="verwaltung@schule.de", grund=None, today="2026-09-22")["$set"])
    await database[Collection.REGISTRIERUNGEN].insert_many(
        [
            _registrierung(REGISTRIERUNG_NEW, "Wiltrudis.Ehrenpreis@SCHULE.de"),
            _registrierung(REGISTRIERUNG_UNCONFIRMED, WILTRUDIS, seite=None),
            declined,
            # A returning pupil's: no choice on it, their own record standing.
            _registrierung(REGISTRIERUNG_RETURNING, WILTRUDIS, seite="bestaetigung_spieler_wiederkehrend"),
            _registrierung(REGISTRIERUNG_KAETHE, "Käthe@XN--MLLER-KVA.DE", vorname="Käthe"),
            _registrierung(REGISTRIERUNG_KAETHE_UPPER, "KÄTHE@xn--mller-kva.de", vorname="Käthe"),
        ]
    )


def _served(body: dict[str, Any]) -> set[tuple[str, str]]:
    """Every (kind, id) the account read serves, a season seat by its row."""

    return {
        *((("spieler", body["spieler"]["spieler_id"]),) if body["spieler"] is not None else ()),
        *(("schiedsrichter", entry["schiedsrichter_id"]) for entry in body["schiedsrichter"]),
        *(("sitze", f"{entry['team_id']}/{entry['saison_id']}") for entry in body["sitze"]),
        *(("bewerbungen", entry["bewerbung_id"]) for entry in body["bewerbungen"]),
        *(("registrierungen", entry["registrierung_id"]) for entry in body["registrierungen"]),
    }


def _gezaehlt(eintraege: frozenset[tuple[str, Any]]) -> set[tuple[str, str]]:
    """The gate's set in the read's spelling."""

    return {(art, f"{key[0]}/{key[1]}" if art == "sitze" else str(key)) for art, key in eintraege}


@pytest.mark.db
@pytest.mark.parametrize("address", list(EXPECTED), ids=["every kind and state", "a Unicode domain", "nothing held"])
def test_the_gate_counts_exactly_what_the_account_page_serves(mongo_replica_set_url: str, address: str):
    async def run() -> tuple[set[tuple[str, str]], set[tuple[str, str]]]:
        async with a_clean_database(mongo_replica_set_url, DATABASE_NAME, constraints=True) as (_client, database):
            await _seed(database)
            _subjekt, eintraege = await find_eigene_eintraege(sign_in_identifier(address), record_collections(database))
            async with app_client(mongo_replica_set_url, config=CONFIG, now=NOW) as http:
                response = await http.get(KONTO_PATH, headers=_person(address))
                assert response.status_code == 200, response.text

            return _gezaehlt(eintraege), _served(response.json())

    gezaehlt, served = on_the_seed_loop(run())

    assert served == gezaehlt
    assert served == EXPECTED[address]


@pytest.mark.db
def test_the_account_page_serves_a_registration_as_its_pupil_stored_it(mongo_replica_set_url: str):
    """The stamped promise that the account shows what is kept: the stored fields, and the words' fill read today."""

    async def run() -> Any:
        async with a_clean_database(mongo_replica_set_url, DATABASE_NAME, constraints=True) as (_client, database):
            await _seed(database)
            async with app_client(mongo_replica_set_url, config=CONFIG, now=NOW) as http:
                return await http.get(KONTO_PATH, headers=_person(WILTRUDIS))

    response = on_the_seed_loop(run())

    assert response.status_code == 200, response.text
    [entry] = [entry for entry in response.json()["registrierungen"] if entry["registrierung_id"] == str(REGISTRIERUNG_NEW)]
    assert {key: value for key, value in entry.items() if key != "nachweis_stand"} == {
        "registrierung_id": str(REGISTRIERUNG_NEW),
        "team_id": str(TEAMS[3]),
        "team_name": "Schule3",
        "saison_id": ACTIVE,
        "bestaetigt_text_version": LAUFENDE_FASSUNGEN["bestaetigung_spieler"],
        "umfang": "kader_oeffentlich",
        "medien": True,
        "mindestalter": REGISTRIERUNG_MIN_ALTER_JAHRE,
        "medien_mindestalter": MEDIEN_MIN_AGE_YEARS,
        "kontext": {"vorname": "Wiltrudis", "team": "Schule3", "schule": "Schule3-Schule", "saison": ACTIVE},
        "vorname": "Wiltrudis",
        "nachname": "Ehrenpreis",
        "geburtsdatum": "2008-05-09",
        "nummer": "17",
        "position": "Mittelfeld",
        "stufe": "Q1",
    }
    assert set(entry["nachweis_stand"]) == {"umfang", "medien"}
    assert all(isinstance(value, str) for value in entry["nachweis_stand"].values())
