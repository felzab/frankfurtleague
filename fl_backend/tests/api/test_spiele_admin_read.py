import asyncio
import functools
from collections.abc import Iterator, Mapping
from typing import Any

import pymongo
import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import Response
from pymongo import MongoClient

from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.main import create_app
from tests import documents
from tests.app_client import app_client
from tests.config import ADMIN_AUTH, BASE_AUTH, UNANSWERED_DEADLINE_S, UNANSWERED_URI, build_test_config, grants_for_the_suite
from tests.database import a_clean_database_sync

from .conftest import unwritten

# Which guard refused, and so which route answered: `verify_access_base` guards the public router
# and `verify_access_admin` the admin one, and no key satisfies both.
BASE_GUARD_REFUSED = Code.ACCESS_KEY_REFUSED
ADMIN_GUARD_REFUSED = Code.ACCESS_KEY_REFUSED

SAISON_ID = "2026"

# Fixed rather than generated, so a failure names the same fixture every run.
SPIEL_ID = ObjectId("6890a1b2c3d4e5f607230001")
SPIELTAG_ID = ObjectId("6890a1b2c3d4e5f6072300a1")
HOME = ObjectId("6890a1b2c3d4e5f607230011")
AWAY = ObjectId("6890a1b2c3d4e5f607230012")
SPIELORT_ID = ObjectId("6890a1b2c3d4e5f607230021")
SCHIEDSRICHTER_ID = ObjectId("6890a1b2c3d4e5f607230022")
# The editor's offers: a live venue and a venue retired and booked nowhere, a live referee who has not confirmed.
LIVE_SPIELORT_ID = ObjectId("6890a1b2c3d4e5f607230023")
RETIRED_SPIELORT_ID = ObjectId("6890a1b2c3d4e5f607230024")
UNCONFIRMED_SCHIEDSRICHTER_ID = ObjectId("6890a1b2c3d4e5f607230025")
DECLINED_SCHIEDSRICHTER_ID = ObjectId("6890a1b2c3d4e5f607230026")

MIETPREIS = 80
PAYMENT = 30

# A second fixture, holding a report and a confirmation row; a third, whose report and row are stored ahead of the
# second's; a fourth, booked on the ghost a referee's erasure repoints their fixtures to; and a later season stored
# ahead of the fixtures' own.
BERICHT_SPIEL_ID = ObjectId("6890a1b2c3d4e5f607230002")
OTHER_SPIEL_ID = ObjectId("6890a1b2c3d4e5f607230003")
GHOST_SPIEL_ID = ObjectId("6890a1b2c3d4e5f607230004")
LATER_SAISON_ID = "2027"
# A scorer on the home squad, a scorer on neither side's squad, and a pupil a card alone names.
LINA = ObjectId("6890a1b2c3d4e5f607230031")
OLE = ObjectId("6890a1b2c3d4e5f607230032")
MIA = ObjectId("6890a1b2c3d4e5f607230033")
BERICHT_CONFIRMATION_ID = ObjectId("6890a1b2c3d4e5f607230041")
# Raised past the create's 0 by later writes: the one an adoption names.
BERICHT_VERSION = 3

PUBLIC_PATH = f"/api/v{API_VERSION}/spiele/{SPIEL_ID}"
ADMIN_PATH = f"{PUBLIC_PATH}/admin"

# Joined onto `team2`, which is how a response proves it came through `build_spiele_pipeline` rather
# than through a plain `find`.
AUSTRITT = {"type": "disqualifikation", "reason": "Nicht angetreten zum Spieltag", "date": "2026-03-14"}


def spiel_document() -> dict[str, Any]:
    """Every field `FLSpielJoined` requires, so a response that validates proves the whole shape rather than the fields asserted on."""

    return documents.spiel_document(
        spiel_id=SPIEL_ID,
        saison_id=SAISON_ID,
        spiel_nr=1,
        spieltag_id=SPIELTAG_ID,
        team1={"team_id": HOME, "tore": 2},
        team2={"team_id": AWAY, "tore": 1},
        date="2026-03-15",
        time="14:00:00",
        spielort={"spielort_id": SPIELORT_ID, "mietpreis": MIETPREIS},
        schiedsrichter={"schiedsrichter_id": SCHIEDSRICHTER_ID, "payment": PAYMENT},
        ergebnis="2:1",
    )


def junction_rows() -> list[dict[str, Any]]:
    return [
        documents.saison_team_document(SAISON_ID, HOME, "Alpha", "ALX"),
        documents.saison_team_document(SAISON_ID, AWAY, "Beta", "BEX", austritt=dict(AUSTRITT)),
    ]


def spielort_row(spielort_id: ObjectId, name: str, *, inactive_since: str | None) -> dict[str, Any]:
    return {
        "_id": spielort_id,
        "name": name,
        "address": dict(documents.ADDRESS),
        "maps_link": f"{name}, Frankfurt",
        "default_mietpreis": 70,
        "inactive_since": inactive_since,
    }


def schiedsrichter_rows() -> list[dict[str, Any]]:
    """The booked referee, retired since and confirmed; a live one who never answered; one who objected; and the ghost, offered never."""

    confirmed = documents.own_einwilligung_document(text_versions=documents.SCHIEDSRICHTER_TEXT_VERSIONS, confirmed_at="2026-01-10")
    return [
        documents.schiedsrichter_document(
            SCHIEDSRICHTER_ID,
            email="ada@example.com",
            name="Ada Kern",
            default_payment=PAYMENT,
            einwilligung=confirmed,
            inactive_since="2026-04-01",
        ),
        documents.schiedsrichter_document(
            UNCONFIRMED_SCHIEDSRICHTER_ID, email="bo@example.com", name="Bo Lenz", default_payment=25, einwilligung=None
        ),
        documents.schiedsrichter_document(
            DECLINED_SCHIEDSRICHTER_ID,
            email="cleo@example.com",
            name="Cleo Rau",
            default_payment=25,
            einwilligung=None,
            confirmation={
                "token_hashes": [],
                "sent_at": "2026-03-01",
                "deadline": "2026-03-15",
                "declined_at": "2026-03-02",
            },
        ),
        {
            **documents.schiedsrichter_document(
                GHOST_SCHIEDSRICHTER_ID, email="ghost@example.com", name="Ghost", default_payment=0, einwilligung=None
            ),
            "name": None,
            "inactive_since": "2000-01-01",
        },
    ]


def other_spiele() -> list[dict[str, Any]]:
    """The report's fixture, played 2:1; the fixture whose rows are stored first; the fixture booked on the ghost."""

    def spiel(spiel_id: ObjectId, spiel_nr: int, **fields: Any) -> dict[str, Any]:
        return documents.spiel_document(
            spiel_id=spiel_id,
            saison_id=SAISON_ID,
            spiel_nr=spiel_nr,
            spieltag_id=SPIELTAG_ID,
            # Dated, as a fixture a confirmation row asks about is.
            date="2026-03-22",
            time="14:00:00",
            **{"team1": {"team_id": HOME, "tore": None}, "team2": {"team_id": AWAY, "tore": None}, **fields},
        )

    return [
        spiel(BERICHT_SPIEL_ID, 2, team1={"team_id": HOME, "tore": 2}, team2={"team_id": AWAY, "tore": 1}, ergebnis="2:1"),
        spiel(OTHER_SPIEL_ID, 3),
        spiel(GHOST_SPIEL_ID, 4, schiedsrichter={"schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID, "payment": 0}),
    ]


def spielberichte_rows(spiele: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The other fixture's report first, then the report's fixture's: adopted, its 2:1 two named scorers and one nobody named."""

    bericht_spiel, other_spiel, _ = spiele
    bericht = documents.bericht_document(
        ergebnis_vorschlag={"team1_tore": 2, "team2_tore": 1, "elfmeterschiessen": None, "sonderereignis": None},
        scorers=[
            {"side": "team1", "spieler_id": LINA, "minute": "12", "eigentor": False},
            {"side": "team1", "spieler_id": OLE, "minute": "30", "eigentor": False},
            {"side": "team2", "spieler_id": None, "minute": "77", "eigentor": False},
        ],
        cards=[{"side": "team2", "spieler_id": MIA, "minute": "40", "colour": "gelb"}],
        sides=documents.spielbericht_sides(bericht_spiel),
        adopted=True,
    )
    return [
        documents.spielbericht_document(other_spiel),
        documents.spielbericht_document(bericht_spiel, bericht=bericht, version=BERICHT_VERSION),
    ]


def spielbestaetigungen_rows(spiele: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row of the other fixture of the season, stored first, and one of the report's fixture."""

    bericht_spiel, other_spiel, _ = spiele
    return [
        documents.spielbestaetigung_document(other_spiel, party={"kind": "team", "team_id": HOME}),
        documents.spielbestaetigung_document(bericht_spiel, party={"kind": "team", "team_id": AWAY}, _id=BERICHT_CONFIRMATION_ID),
    ]


def kader_rows() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The three pupils' records, and the squad rows of the two the report's sides field."""

    return (
        [
            documents.spieler_document(LINA, "Lina", "Krause"),
            documents.spieler_document(OLE, "Ole", "Brettschneider"),
            documents.spieler_document(MIA, "Mia", "Westphal"),
        ],
        [
            documents.saison_spieler_document(LINA, SAISON_ID, HOME, nummer="7"),
            documents.saison_spieler_document(MIA, SAISON_ID, AWAY, nummer="9"),
        ],
    )


@functools.cache
def _served() -> FastAPI:
    """One app for every case serving through it: building one costs more than the request a case sends through it.

    Built on first use rather than at import, which every xdist worker pays at collection.
    """

    return create_app(build_test_config())


def answered(uri: str, path: str, headers: Mapping[str, str]) -> Response:
    async def _answered() -> Response:
        async with app_client(uri, app=_served()) as http:
            with pymongo.timeout(UNANSWERED_DEADLINE_S if uri == UNANSWERED_URI else None):
                return await http.get(path, headers=dict(headers))

    return asyncio.run(_answered())


# Module-scoped: every case below reads this corpus and none writes it, which `unwritten` keeps
# from being left as a claim.
@pytest.fixture(scope="module")
def seeded_url(mongo_replica_set_url: str) -> Iterator[str]:
    """The fixture and its junction row, in the database `build_test_config` names -- the one the app resolves its collections from."""

    database_name = build_test_config().db_base_name

    client = MongoClient(mongo_replica_set_url)
    try:
        database = a_clean_database_sync(client, mongo_replica_set_url, database_name)
        database[Collection.GRANTS].insert_many(grants_for_the_suite())
        # Finished, the one status that closes the editor, so the served status is this row's and no default's; a later
        # season stored ahead of it, so a status read off whichever season comes first shows.
        database[Collection.SAISONS].insert_many(
            [documents.saison_document(LATER_SAISON_ID, "future"), documents.saison_document(SAISON_ID, "past")]
        )
        database[Collection.SPIELE].insert_one(spiel_document())
        spiele = other_spiele()
        database[Collection.SPIELE].insert_many(spiele)
        database[Collection.SPIELBERICHTE].insert_many(spielberichte_rows(spiele))
        database[Collection.SPIELBESTAETIGUNGEN].insert_many(spielbestaetigungen_rows(spiele))
        spieler, kader = kader_rows()
        database[Collection.SPIELER].insert_many(spieler)
        database[Collection.SAISON_SPIELER].insert_many(kader)
        database[Collection.SAISON_TEAMS].insert_many(junction_rows())
        database[Collection.SPIELORTE].insert_many(
            [
                spielort_row(SPIELORT_ID, "Sportplatz Ost", inactive_since="2026-04-01"),
                spielort_row(LIVE_SPIELORT_ID, "Halle Nord", inactive_since=None),
                spielort_row(RETIRED_SPIELORT_ID, "Platz West", inactive_since="2026-02-01"),
            ]
        )
        database[Collection.SCHIEDSRICHTER].insert_many(schiedsrichter_rows())

        with unwritten(mongo_replica_set_url, database_name):
            yield mongo_replica_set_url
    finally:
        client.close()


# The shadowing proof. Both routers mount at the same prefix, so the question is which one answers
# each path -- and the guard that refuses a wrong key names it, no database needed.
GUARD_CASES = [
    pytest.param(ADMIN_PATH, BASE_AUTH, ADMIN_GUARD_REFUSED, id="the admin path is the admin router's"),
    pytest.param(PUBLIC_PATH, ADMIN_AUTH, BASE_GUARD_REFUSED, id="the public path is still the public router's"),
]


@pytest.mark.parametrize(("path", "headers", "error_code"), GUARD_CASES)
def test_the_wrong_key_is_refused_by_the_guard_of_the_route_that_matched(path: str, headers: Mapping[str, str], error_code: str):
    """A base credential reaching the admin read is the failure that matters: it carries the rent and the referee's Honorar."""

    response = answered(UNANSWERED_URI, path, headers)

    assert response.status_code == 401
    assert response.json()["error_code"] == error_code


@pytest.mark.parametrize("spiel_id", ["not-an-id", "z" * 24, str(SPIEL_ID)[:-1], f"{SPIEL_ID}0"])
def test_a_malformed_id_is_a_404_on_the_admin_path_too(spiel_id: str):
    """`by_id`, not a bare `{spiel_id}`: the convertor is what keeps a malformed path id off the 422 a query id gets."""

    path = f"/api/v{API_VERSION}/spiele/{spiel_id}/admin"

    assert answered(UNANSWERED_URI, path, ADMIN_AUTH).status_code == 404


@pytest.mark.db
def test_the_admin_key_gets_the_spiel_with_the_rent_and_the_payment(seeded_url: str):
    """The endpoint's whole point: the two figures the editor round-trips arrive, joined as the public read's shape joins them."""

    response = answered(seeded_url, ADMIN_PATH, ADMIN_AUTH)

    assert response.status_code == 200
    spiel = response.json()["spiel"]
    assert spiel["id"] == str(SPIEL_ID)
    assert spiel["spielort"]["mietpreis"] == MIETPREIS
    assert spiel["schiedsrichter"]["payment"] == PAYMENT
    # The joined field, which only `build_spiele_pipeline` produces. The route out and not the
    # record: the reason is free text about a school, and only a club's own page renders it.
    assert spiel["team2"]["austritt_type"] == AUSTRITT["type"]
    assert spiel["team1"]["austritt_type"] is None
    # The season's status, read off the fixture's own season, which closes the editor once past.
    assert response.json()["saison_status"] == "past"


@pytest.mark.db
def test_the_editor_offers_the_live_rows_and_the_ones_the_spiel_books(seeded_url: str):
    """Offering a retired row the fixture does not book, or the ghost, puts a booking on the editor the save then refuses.

    The fixture's own retired venue and referee stay offered, so the booking keeps its name; the unconfirmed referee is
    offered marked, the save refusing them, and an objection told from no answer yet: nobody asks a person who objected
    again, so the administrator waiting on their answer waits for good.
    """

    answer = answered(seeded_url, ADMIN_PATH, ADMIN_AUTH).json()

    assert [(row["name"], row["inactive_since"]) for row in answer["spielorte"]] == [("Halle Nord", None), ("Sportplatz Ost", "2026-04-01")]
    assert [(row["name"], row["confirmed"], row["declined"], row["inactive_since"]) for row in answer["schiedsrichter"]] == [
        ("Ada Kern", True, False, "2026-04-01"),
        ("Bo Lenz", False, False, None),
        ("Cleo Rau", False, True, None),
    ]
    assert (answer["spielbericht"], answer["spielbestaetigungen"]) == (None, [])


def _editor_path(spiel_id: ObjectId) -> str:
    return f"/api/v{API_VERSION}/spiele/{spiel_id}/admin"


@pytest.mark.db
def test_the_report_panel_shows_this_fixtures_report_by_its_stored_version_and_its_named_scorers(seeded_url: str):
    """The version is the one an adoption names: served stale, every adoption would be refused.

    The state is the adoption's against the saved 2:1, and only the scorers are named: the pupil on the home squad by
    their squad row, the one on neither squad by their record, never the pupil a card alone names.
    """

    response = answered(seeded_url, _editor_path(BERICHT_SPIEL_ID), ADMIN_AUTH)

    assert response.status_code == 200, response.text
    assert response.json()["spielbericht"] == {
        "state": "adopted",
        "version": BERICHT_VERSION,
        "ergebnis_vorschlag": {"team1_tore": 2, "team2_tore": 1, "elfmeterschiessen": None, "sonderereignis": None},
        "sides": {"team1": str(HOME), "team2": str(AWAY)},
        "scorers": [
            {"side": "team1", "spieler_id": str(LINA), "minute": "12", "eigentor": False},
            {"side": "team1", "spieler_id": str(OLE), "minute": "30", "eigentor": False},
            {"side": "team2", "spieler_id": None, "minute": "77", "eigentor": False},
        ],
        "named": [
            {"spieler_id": str(LINA), "first_name": "Lina", "last_name": "Krause", "nummer": "7"},
            {"spieler_id": str(OLE), "first_name": "Ole", "last_name": "Brettschneider", "nummer": None},
        ],
    }


@pytest.mark.db
def test_the_editor_lists_this_fixtures_confirmation_rows_alone(seeded_url: str):
    """Another fixture of the season holds a row too, stored first."""

    answer = answered(seeded_url, _editor_path(BERICHT_SPIEL_ID), ADMIN_AUTH).json()

    assert [row["id"] for row in answer["spielbestaetigungen"]] == [str(BERICHT_CONFIRMATION_ID)]


@pytest.mark.db
def test_a_fixture_booked_on_the_ghost_opens_and_never_offers_the_ghost(seeded_url: str):
    """The ghost has no name to offer: offered, the editor of every fixture an erased referee was booked on fails to answer."""

    response = answered(seeded_url, _editor_path(GHOST_SPIEL_ID), ADMIN_AUTH)

    assert response.status_code == 200, response.text
    assert str(GHOST_SCHIEDSRICHTER_ID) not in [row["id"] for row in response.json()["schiedsrichter"]]
