import contextlib
import secrets
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any, Final

import pytest
from bson import ObjectId
from pymongo import ASCENDING, AsyncMongoClient, monitoring
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.adresswechsel.services import compose_postausgang
from app.api.aktionen.admin_router import FACET_TALLY
from app.api.aktionen.services import build_aktionen_sort
from app.api.berechtigungen.antraege import compose_antrag
from app.api.bewerbungen.services import build_bewerbungen_sort, build_schluessel_filter, compose_bestaetigungen, hash_token
from app.api.identitaet.crud import erase_pupil_actor_in_session, unattribute_in_session
from app.api.spielberichte.crud import pull_bericht_lage
from app.api.spieler.person_router import _read_the_squad
from app.core.collections import Collection
from app.core.constraints import (
    SUPPORT_INDEXES,
    TTL_INDEXES,
    UNIQUE_INDEXES,
    apply_constraints,
)
from app.core.exceptions import APIError
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import (
    adresswechsel_document,
    bericht_document,
    kontaktperson_document,
    spiel_document,
    spielbericht_document,
    spielbestaetigung_document,
    spieler_document,
)
from tests.worker import worker_database

pytestmark = pytest.mark.db


# The throwaway: every body under it breaks the schema it applies, so `on_a_database` rebuilds it per
# call.
DATABASE_NAME = worker_database("fl_constraints_test")
# A second database, so the throwaway above stays the one this suite is free to break.
SHIPPED_DATABASE_NAME = worker_database("fl_constraints_shipped_test")

SAISON_ID = "2026"
TEAM_OID = ObjectId("6890a1b2c3d4e5f607200001")
SPIELER_OID = ObjectId("6890a1b2c3d4e5f607200002")
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f607200003")
SPIELORT_OID = ObjectId("6890a1b2c3d4e5f607200004")
SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607200005")
AKTION_OID = ObjectId("6890a1b2c3d4e5f607200006")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607200007")
BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607200009")
SPERRLISTE_OID = ObjectId("6890a1b2c3d4e5f60720000a")
EINLADUNG_OID = ObjectId("6890a1b2c3d4e5f60720000b")
REGISTRIERUNG_OID = ObjectId("6890a1b2c3d4e5f60720000c")
BERECHTIGUNG_OID = ObjectId("6890a1b2c3d4e5f60720000d")
SPIELBESTAETIGUNG_OID = ObjectId("6890a1b2c3d4e5f60720000e")
SPIEL_OID = ObjectId("6890a1b2c3d4e5f60720000f")
ADRESSWECHSEL_OID = ObjectId("6890a1b2c3d4e5f6072000a1")
ANTRAG_OID = ObjectId("6890a1b2c3d4e5f6072000a2")
# Far off, so the TTL index on `genehmigung.bis` leaves a request standing through every case that inserts one.
ANTRAG_GESTELLT = datetime(2126, 1, 1, tzinfo=UTC)
# A submission key as a public form mints it (`app/api/bewerbungen/public_router.py :: post_bewerbung`).
IDEMPOTENZ_SCHLUESSEL = "1b4e28ba-2fa1-4d2b-883f-0016d3cca427"

# One declared support index, planted under different keys so its build is the one that fails.
CONFLICTING_SUPPORT_INDEX = "aktionen_trace_id"
# The same planting for the TTL kind, over `at`: the name is claimed and the keys disagree, which is
# also the shape of the mistake this index exists against.
CONFLICTING_TTL_INDEX = "aktionen_retention"
# A name no collection holds, the case only `tests/database.py :: _foreign` catches: a view over a
# dropped collection's name is already in `_moved`'s `gone` set, and one over a live name is a
# namespace MongoDB refuses.
LEFTOVER_VIEW = "leftover_view"

ADDRESS = {"strasse": "Hanauer Landstraße", "hausnummer": "12a", "plz": "60314", "stadtteil": "Ostend", "stadt": "Frankfurt am Main"}


# The seat as its applicant named the person under the form's label, and as that person then confirmed it.
SEATED: Final = {"text_version": "v1", "datum": "2026-01-15"}


def kontaktperson(vorname: str) -> dict[str, Any]:
    """A function rather than a constant: the nested consent has to be fresh per slot too, which a `dict()` of a shared one is not."""
    return kontaktperson_document(vorname, bestaetigt_am="2026-01-16", einwilligung=SEATED, telefon="+49 69 1234567", geburtsdatum="1980-05-04")


def valid_documents() -> dict[str, dict[str, Any]]:
    """Rebuilt on every call, so no test can mutate another's document."""
    return {
        "saisons": {
            "_id": SAISON_ID,
            "start_date": "2026-01-01",
            "end_date": "2026-06-30",
            "status": "active",
            "rules": {
                "win_points": 3,
                "draw_points": 1,
                "qualifiers_per_group": 2,
                "number_of_groups": 4,
                "teams_per_group": 4,
                "tiebreak_order": "tordifferenz",
                "max_kadergroesse": 18,
                "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
                # Which levels this season offers — a subset of the league's set.
                "erlaubte_stufen": ["E1", "E2", "Q1", "Q2", "Q3", "Q4"],
            },
            "bewerbung": None,
            "registrierung": None,
        },
        "teams": {
            "_id": TEAM_OID,
            "name": "Lessing",
            "shorthand": "LEX",
            "description": "",
            "full_name": "Lessing-Gymnasium",
            "website_url": "https://lessing-gymnasium.example.de",
            "address": dict(ADDRESS),
            "schulform": None,
            "inactive_since": None,
        },
        # `name` and `shorthand` are the season's own copy of the club's identity, required since the
        # junction became their home; a row without them is unreadable rather than merely stale.
        "saison_teams": {
            "saison_id": SAISON_ID,
            "team_id": TEAM_OID,
            "gruppe": "A",
            "austritt": None,
            "trikot_farbe": None,
            "kontakte": None,
            "name": "Lessing",
            "shorthand": "LEX",
        },
        "spieler": spieler_document(SPIELER_OID, "Max", "Mustermann"),
        "saison_spieler": {
            "spieler_id": SPIELER_OID,
            "saison_id": SAISON_ID,
            "team_id": TEAM_OID,
            "ist_nachnominiert": False,
            "rolle": None,
            "stufe": "Q2",
            "position": "Angriff",
            "nummer": "10",
            "inactive_since": None,
        },
        "spiele": {
            "team1": {"team_id": TEAM_OID, "name": "Lessing", "tore": 2, "shorthand": "LEX"},
            "team2": {"team_id": SPIELER_OID, "name": "Helmholtz", "tore": 1, "shorthand": "HEX"},
            "team1_quelle": None,
            "team2_quelle": None,
            "datum": "2026-03-15",
            "uhrzeit": "18:00:00",
            "ort": {"spielort_id": SPIELORT_OID, "name": "Sportplatz Ost", "maps_link": "Sportplatz Ost, Frankfurt", "mietpreis": 80},
            "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER_OID, "name": "A. Referee", "payment": 20},
            "ergebnis": "2:1",
            "elfmeterschiessen": None,
            "spieltag_id": SPIELTAG_OID,
            "spiel_nr": 1,
            "sonderereignis": None,
            "saison_phase": "gruppenphase",
            "saison_id": SAISON_ID,
        },
        "spieltage": {
            "_id": SPIELTAG_OID,
            # No `name` and no `anzahl_spiele`: one is composed by the reader, the other derived, and neither stored.
            "beginn": "2026-03-15",
            "ende": "2026-03-15",
            "position": 1,
            "saison_phase": "gruppenphase",
            "saison_id": SAISON_ID,
        },
        "spielorte": {
            "_id": SPIELORT_OID,
            "name": "Sportplatz Ost",
            "address": dict(ADDRESS),
            "maps_link": "Sportplatz Ost, Frankfurt",
            "default_mietpreis": 80,
            "inactive_since": None,
        },
        "schiedsrichter": {
            "_id": SCHIEDSRICHTER_OID,
            "name": "A. Referee",
            "schule": None,
            "default_payment": 20,
            "kontakt": {"telefon": None, "email": None},
            "inactive_since": None,
        },
        # Undecided, proposing a school rather than picking a club: both are nullable and exactly
        # one carries a value, a write-path rule.
        "bewerbungen": {
            "_id": BEWERBUNG_OID,
            "saison_id": SAISON_ID,
            "eingereicht_am": "2026-02-01",
            "status": "eingereicht",
            "team_id": None,
            "schule": {
                "team_name": "Lessing",
                "full_name": "Lessing-Gymnasium",
                "shorthand": "LEX",
                "schulform": "gymnasium_g9",
                "address": dict(ADDRESS),
                "website_url": "https://lessing-gymnasium.example.de",
            },
            # Distinct per slot, so a block copied across with two slots swapped fails rather than compares equal.
            "kontakte": {
                "trainer": kontaktperson("Wraxlington"),
                "ansprechperson": kontaktperson("Quillhilde"),
                "stellvertretung": kontaktperson("Bramblewick"),
                "trainer_ist_zugleich": None,
            },
            "trikot": {"vorhandener_satz": "16 rote Trikots, Größe M", "wunschfarbe": "rot"},
            "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
            "stufengroesse": 96,
            "wunschgegner": None,
            "entscheidung": None,
            "bestaetigungsfrist": "2026-02-15",
            "bestaetigungen": compose_bestaetigungen(
                hashes={seat: hash_token(seat) for seat in ("trainer", "ansprechperson", "stellvertretung")}, today="2026-02-01"
            ),
        },
        "aktionen": {
            "_id": AKTION_OID,
            "at": "2026-03-15T09:30:00+00:00",
            "at_date": datetime(2026, 3, 15, 9, 30, 0, tzinfo=UTC),
            "actor": {"kind": "admin_session", "email": "admin@example.invalid"},
            "trace_id": secrets.token_hex(16),
            "request": {"method": "PATCH", "path": "/api/v0/teams/{team_id}"},
            # Any collection but its own: the log records every other one and never itself.
            "collection": "teams",
            "operation": "patch_one",
            "document_id": TEAM_OID,
            "db_filter": None,
            "before": {"name": "Lessing"},
            "modified_count": None,
            "redacted_at": None,
            "anlass": None,
        },
        # A hash rather than anything recognisable: the collection's whole point is that a row
        # carries no address, and a fixture holding one would be a corpus nobody could sweep for it.
        "sperrliste": {
            "_id": SPERRLISTE_OID,
            "adresse_hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
            "schluessel_version": "sperrliste-v1",
            "grund": "Falsches Geburtsdatum bei der Anmeldung",
            "erstellt_von": "admin@example.invalid",
            "erstellt_am": "2026-03-15",
            "gesperrt_bis_saison_id": "2031",
        },
        # `widerrufen_am` is null rather than absent because `uniq_einladung_live` reaches the rows
        # holding null, and `versand` is the empty carrier the mint writes.
        "einladungen": {
            "_id": EINLADUNG_OID,
            "saison_id": SAISON_ID,
            "team_id": TEAM_OID,
            "token_hash": "b3c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70819200",
            "erstellt_am": "2026-03-15",
            "erstellt_von": "admin@example.invalid",
            "widerrufen_am": None,
            "versand": {},
        },
        # Every key the submission writes, `geburtsdatum`, `einwilligung` and `entscheidung`
        # included: each is a stored null rather than an absent key, which is what `required` means.
        "registrierungen": {
            "_id": REGISTRIERUNG_OID,
            "saison_id": SAISON_ID,
            "team_id": TEAM_OID,
            "einladung_id": EINLADUNG_OID,
            "eingereicht_am": "2026-03-16",
            "status": "eingereicht",
            "vorname": "Thessaly",
            "nachname": "Okonkwo-Brandt",
            "email": "thessaly@example.invalid",
            "position": "Mittelfeld",
            "nummer": "17",
            "stufe": "Q1",
            "geburtsdatum": None,
            "einwilligung": None,
            "bestaetigung": {
                "token_hash": "c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f80919200",
                "verschickt_am": "2026-03-16",
                "erinnert_am": None,
                "frist": "2026-03-23",
            },
            "entscheidung": None,
        },
        # As the Playground paste writes one: a BSON date, and the sentinel where no administrator granted it.
        "berechtigungen": {
            "_id": BERECHTIGUNG_OID,
            "adresse": "inhaberin@example.invalid",
            "verwaltung": "owner",
            "erteilt_von": "PLAYGROUND",
            "erteilt_am": datetime(2026, 1, 1, tzinfo=UTC),
        },
        "berechtigungen_angekuendigt": {
            "_id": BERECHTIGUNG_OID,
            "adresse": "inhaberin@example.invalid",
            "verwaltung": "owner",
            "angekuendigt_am": datetime(2026, 1, 1, 0, 5, tzinfo=UTC),
        },
        # A removal a pass holds claimed: the one shape carrying every nullable key both ways.
        "berechtigungen_postausgang": {
            "_id": BERECHTIGUNG_OID,
            "berechtigung_id": TEAM_OID,
            "art": "entzogen",
            "urheber": "anwendung",
            "jetzt": None,
            "vorher": {"adresse": None, "verwaltung": "administration"},
            "geaendert_von": "inhaberin@example.invalid",
            "geaendert_am": datetime(2026, 1, 1, tzinfo=UTC),
            "vorenthalten": "gesperrt",
            "erfasst_am": datetime(2026, 1, 1, tzinfo=UTC),
            "beansprucht_bis": datetime(2026, 1, 1, 0, 10, tzinfo=UTC),
            "beanspruchung": "a-claim",
            "versuche": 1,
        },
        # An open team row as the pass mints it: one seat holding the link the request went out with,
        # one sharing it as a mirrored pair does, one empty.
        "spielbestaetigungen": spielbestaetigung_document(
            spiel_document(
                spiel_id=SPIEL_OID,
                saison_id=SAISON_ID,
                spiel_nr=1,
                spieltag_id=SPIELTAG_OID,
                team1={"team_id": TEAM_OID, "name": "Lessing", "shorthand": "LEX", "tore": None},
                team2={"team_id": OTHER_TEAM_OID, "name": "Helmholtz", "shorthand": "HEX", "tore": None},
                datum="2026-03-15",
                uhrzeit="18:00:00",
                ort={"spielort_id": SPIELORT_OID, "name": "Sportplatz Ost", "maps_link": "Sportplatz Ost, Frankfurt", "mietpreis": 80},
            ),
            partei={"art": "team", "team_id": TEAM_OID},
            _id=SPIELBESTAETIGUNG_OID,
            frist="2026-03-08",
            kontakte={
                "trainer": {"token_hashes": ["e" * 64]},
                "ansprechperson": {"token_hashes": ["e" * 64], "zustellung": None},
                "stellvertretung": None,
            },
        ),
        "spielberichte": spielbericht_document({"_id": SPIEL_OID, "saison_id": SAISON_ID}),
        # A live change as the start stores it: its instants are dates, which every read takes.
        "adresswechsel": {
            "_id": ADRESSWECHSEL_OID,
            **adresswechsel_document(adresse="alt@example.invalid", email="neu@example.invalid", token_hash="a" * 64, day="2026-03-16"),
        },
        # An effect's notice a pass holds claimed on the lost-mailbox way, greeting nobody: every nullable key both ways.
        "adresswechsel_postausgang": {
            "_id": ADRESSWECHSEL_OID,
            **compose_postausgang(
                art="wirksam",
                email="neu@example.invalid",
                now=datetime(2026, 3, 16, tzinfo=UTC),
                bisherige_email="alt@example.invalid",
                vorname=None,
                weg="wartezeit",
            ),
            "beansprucht_bis": datetime(2026, 3, 16, 0, 10, tzinfo=UTC),
            "beanspruchung": "a-claim",
            "versuche": 1,
        },
        # A promotion asked, so `berechtigung_id` is an id rather than the null a grant's request holds.
        "berechtigungen_antraege": {
            "_id": ANTRAG_OID,
            **compose_antrag(
                adresse="vorstand@example.invalid",
                verwaltung="owner",
                berechtigung_id=TEAM_OID,
                gestartet_von="inhaberin@example.invalid",
                now=ANTRAG_GESTELLT,
            ),
        },
    }


def valid_document(collection: str, **overrides: Any) -> dict[str, Any]:
    document = valid_documents()[collection]
    document.update(overrides)
    return document


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_database(url: str, body: Body) -> Any:
    """A database dropped for this call, for a body that seeds what makes `apply_constraints` fail and then calls it.

    `mutates_schema=True` records nothing of what a refusal leaves, so every call rebuilds.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=False, mutates_schema=True) as (_, database):
            return await body(database)

    return on_the_seed_loop(_run())


def on_the_shipped_schema(url: str, body: Body) -> Any:
    """A database the shipped constraints were built on ONCE, emptied for this test.

    For a body that only inserts and reads; one that breaks an index takes
    `on_a_database`'s throwaway.
    """

    async def _run() -> Any:
        async with a_clean_database(url, SHIPPED_DATABASE_NAME, constraints=True) as (_, database):
            return await body(database)

    return on_the_seed_loop(_run())


# Keyed by the index's name, so the pair proves the rule it is filed under rather than the rule that
# happens to be declared in its position; the collection comes off the declaration for the same reason.
DUPLICATE_PAIRS: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {
    "uniq_saison_id_team_id": (valid_documents()["saison_teams"], valid_document("saison_teams", gruppe="B")),
    "uniq_spieler_id_saison_id": (valid_documents()["saison_spieler"], valid_document("saison_spieler", nummer="11")),
    "uniq_saison_id_spiel_nr": (valid_documents()["spiele"], valid_document("spiele", ergebnis="0:0")),
    "uniq_shorthand": (valid_documents()["teams"], valid_document("teams", _id=SPIELER_OID, name="Lessing II")),
    # The second row differs in its price and its fee: what the index refuses on is the name alone,
    # and a pair differing in nothing else would pass while keyed on anything.
    "uniq_spielort_name": (valid_documents()["spielorte"], valid_document("spielorte", _id=TEAM_OID, default_mietpreis=90)),
    "uniq_schiedsrichter_name": (valid_documents()["schiedsrichter"], valid_document("schiedsrichter", _id=TEAM_OID, default_payment=25)),
    "uniq_saison_id_saison_phase_position": (
        valid_documents()["spieltage"],
        valid_document("spieltage", _id=SPIELORT_OID, ende="2026-03-22"),
    ),
    # The second row differs in its reason and its author: the index refuses on the hash alone, and
    # a pair agreeing in everything would pass while keyed on anything at all.
    "uniq_sperrliste_adresse_hash": (
        valid_documents()["sperrliste"],
        valid_document("sperrliste", _id=TEAM_OID, grund="Zweiter Eintrag", erstellt_von="zweite@example.invalid"),
    ),
    # Both rows live, which is the reach the `partialFilterExpression` narrows the rule to: a pair
    # whose second row carried a revocation date would pass while the filter matched anything.
    "uniq_einladung_live": (
        valid_documents()["einladungen"],
        valid_document("einladungen", _id=TEAM_OID, token_hash="c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f80910000"),
    ),
    # Both rows keyed alike and differing in their digest: the index refuses on the key alone, and a
    # pair carrying no key at all would pass while the partial filter matched nothing.
    "uniq_bewerbung_idempotenz_schluessel": (
        valid_document("bewerbungen", idempotenz_schluessel=IDEMPOTENZ_SCHLUESSEL, idempotenz_fingerabdruck="a" * 64),
        valid_document("bewerbungen", _id=TEAM_OID, idempotenz_schluessel=IDEMPOTENZ_SCHLUESSEL, idempotenz_fingerabdruck="b" * 64),
    ),
    "uniq_registrierung_idempotenz_schluessel": (
        valid_document("registrierungen", idempotenz_schluessel=IDEMPOTENZ_SCHLUESSEL, idempotenz_fingerabdruck="a" * 64),
        valid_document("registrierungen", _id=TEAM_OID, idempotenz_schluessel=IDEMPOTENZ_SCHLUESSEL, idempotenz_fingerabdruck="b" * 64),
    ),
    # Two persons' rows in one season, keyed alike: the index refuses on the key alone, where the
    # junction's own index would refuse a pair sharing the person.
    "uniq_saison_spieler_idempotenz_schluessel": (
        valid_document("saison_spieler", idempotenz_schluessel=IDEMPOTENZ_SCHLUESSEL, idempotenz_fingerabdruck="a" * 64),
        valid_document(
            "saison_spieler", _id=TEAM_OID, spieler_id=TEAM_OID, idempotenz_schluessel=IDEMPOTENZ_SCHLUESSEL, idempotenz_fingerabdruck="b" * 64
        ),
    ),
    # Two persons differing in their name and sharing an address: the index refuses on the address alone.
    "uniq_spieler_email": (
        valid_document("spieler", email="pupil@example.invalid"),
        valid_document("spieler", _id=TEAM_OID, vorname="Zweite", email="pupil@example.invalid"),
    ),
    # The second row differs in its tier and its author: the index refuses on the address alone, which
    # is what refuses a paste granting an address a route already granted.
    "uniq_berechtigung_adresse": (
        valid_documents()["berechtigungen"],
        valid_document("berechtigungen", _id=TEAM_OID, verwaltung="administration", erteilt_von="zweite@example.invalid"),
    ),
    # Both rows open, one party, one stand, differing in their seats: the index refuses on its five keys
    # alone, and a pair the partial filter reached on neither side would pass.
    "uniq_spielbestaetigung_offen": (
        valid_documents()["spielbestaetigungen"],
        valid_document("spielbestaetigungen", _id=TEAM_OID, kontakte={"trainer": None, "ansprechperson": None, "stellvertretung": None}),
    ),
    # Two reports of one fixture differing in their whole block: the index refuses on the fixture alone.
    "uniq_spielbericht_spiel_id": (
        valid_documents()["spielberichte"],
        valid_document("spielberichte", _id=TEAM_OID, bericht=bericht_document(bemerkungen="Zweiter Bericht")),
    ),
    # Two live changes of one address, to two mailboxes: the index refuses on the address alone, both rows in its filter.
    "uniq_adresswechsel_adresse": (
        valid_documents()["adresswechsel"],
        valid_document("adresswechsel", _id=TEAM_OID, email="zweite@example.invalid", token_hash="b" * 64, stopp_hash="c" * 64),
    ),
    # Two requests about one address from two requesters: the index refuses on the address alone.
    "uniq_berechtigung_antrag_adresse": (
        valid_documents()["berechtigungen_antraege"],
        valid_document(
            "berechtigungen_antraege",
            _id=TEAM_OID,
            **compose_antrag(
                adresse="vorstand@example.invalid",
                verwaltung="owner",
                berechtigung_id=TEAM_OID,
                gestartet_von="zweite@example.invalid",
                now=ANTRAG_GESTELLT,
            ),
        ),
    ),
    "uniq_postausgang_schluessel": ({"_id": ObjectId(), "schluessel": "sperre/1"}, {"_id": ObjectId(), "schluessel": "sperre/1"}),
    # Two seasons, each `active`: a second row in any other status would pass while the filter matched nothing.
    "uniq_saison_active": (valid_documents()["saisons"], valid_document("saisons", _id="2027", start_date="2027-01-01", end_date="2027-06-30")),
}

# At import, and set equality rather than the `KeyError` the walk below would raise: that names a
# declared index with no pair and nothing else, leaving a pair no declared index answers to as a
# case nothing runs.
assert DUPLICATE_PAIRS.keys() == {index.name for index in UNIQUE_INDEXES}


@pytest.mark.parametrize(
    ("collection", "first", "second"),
    [pytest.param(index.collection, *DUPLICATE_PAIRS[index.name], id=index.name) for index in UNIQUE_INDEXES],
)
def test_each_unique_index_refuses_the_second_document(mongo_url: str, collection: str, first: dict[str, Any], second: dict[str, Any]):
    async def body(database: AsyncDatabase) -> str:
        await database[collection].insert_one(first)
        try:
            await database[collection].insert_one(second)
        except OperationFailure as failure:
            return f"rejected:{failure.code}"
        return "accepted"

    # 11000 is DuplicateKey: the index is what refuses the write.
    assert on_the_shipped_schema(mongo_url, body) == "rejected:11000"


def test_two_ended_changes_of_one_address_are_both_kept(mongo_url: str):
    """An ending nulls the address, so a filter on `beendet` alone would hold every tombstone under one null key."""

    ended = {"adresse": None, "email": None, "beendet": {"art": "abgelehnt", "am": datetime(2026, 3, 17, tzinfo=UTC)}}

    async def body(database: AsyncDatabase) -> int:
        await database.adresswechsel.insert_one(valid_document("adresswechsel", **ended))
        await database.adresswechsel.insert_one(valid_document("adresswechsel", _id=TEAM_OID, stopp_hash="c" * 64, **ended))
        return await database.adresswechsel.count_documents({})

    assert on_the_shipped_schema(mongo_url, body) == 2


def test_a_second_nameless_referee_is_refused(mongo_url: str):
    """The rule reaches every row, so the one nameless row it can ever meet is the ghost.

    A second would split the fixtures of everybody erased across two sentinels nobody can tell apart
    (`app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`).
    """

    async def body(database: AsyncDatabase) -> str:
        nameless = {**valid_documents()["schiedsrichter"], "name": None}
        await database.schiedsrichter.insert_one(nameless)
        try:
            await database.schiedsrichter.insert_one({**nameless, "_id": TEAM_OID})
        except OperationFailure as failure:
            return f"rejected:{failure.code}"
        return "accepted"

    assert on_the_shipped_schema(mongo_url, body) == "rejected:11000"


def test_the_same_spiel_nr_in_another_season_is_fine(mongo_url: str):
    """The index is compound for a reason: match 1 exists in every season."""

    async def body(database: AsyncDatabase) -> int:
        await database.spiele.insert_one(valid_documents()["spiele"])
        await database.spiele.insert_one(valid_document("spiele", saison_id="2025"))
        return await database.spiele.count_documents({})

    assert on_the_shipped_schema(mongo_url, body) == 2


def test_the_same_position_in_another_phase_is_fine(mongo_url: str):
    """`saison_phase` is a key for this reason: the positions restart per phase, so every phase of a season has a 1."""

    async def body(database: AsyncDatabase) -> int:
        await database.spieltage.insert_one(valid_documents()["spieltage"])
        await database.spieltage.insert_one(valid_document("spieltage", _id=SPIELORT_OID, saison_phase="finale"))
        return await database.spieltage.count_documents({})

    assert on_the_shipped_schema(mongo_url, body) == 2


def test_every_season_but_the_active_one_is_outside_the_rule(mongo_url: str):
    """The league keeps every season it ever played, so `past` rows pile up beside the running one and a `future` one waits."""

    async def body(database: AsyncDatabase) -> int:
        await database.saisons.insert_one(valid_documents()["saisons"])
        for saison_id, status in (("2024", "past"), ("2025", "past"), ("2027", "future"), ("2028", "future")):
            await database.saisons.insert_one(valid_document("saisons", _id=saison_id, status=status))
        return await database.saisons.count_documents({})

    assert on_the_shipped_schema(mongo_url, body) == 5


def test_only_an_open_confirmation_meets_the_rule(mongo_url: str):
    """An answered row, a closed one and the other club's open one stand beside a party's open row on one stand.

    A dropped filter or a lost team key refuses one, and with it a reinstated fixture's fresh request.
    """

    antwort = {"art": "zugesagt", "am": "2026-03-01", "von": {"art": "kontakt", "rolle": "trainer"}, "vorschlag": None, "begruendung": None}

    async def body(database: AsyncDatabase) -> int:
        await database.spielbestaetigungen.insert_one(valid_documents()["spielbestaetigungen"])
        await database.spielbestaetigungen.insert_one(valid_document("spielbestaetigungen", _id=TEAM_OID, antwort=antwort))
        await database.spielbestaetigungen.insert_one(
            valid_document("spielbestaetigungen", _id=SPIELER_OID, geschlossen={"am": "2026-03-02", "grund": "abgesagt"})
        )
        await database.spielbestaetigungen.insert_one(
            valid_document("spielbestaetigungen", _id=SPIELTAG_OID, partei={"art": "team", "team_id": OTHER_TEAM_OID})
        )
        return await database.spielbestaetigungen.count_documents({})

    assert on_the_shipped_schema(mongo_url, body) == 4


def _raised(failure: RuntimeError, named: str) -> str:
    """The refusal names what it was building and carries the driver's, which `app/core/constraints.py :: _run` diagnoses."""

    if named not in str(failure):
        return f"raised the wrong thing: {failure}"
    return "raised" if isinstance(failure.__cause__, OperationFailure) else f"raised without its cause: {failure}"


def test_the_startup_apply_fails_rather_than_skipping_a_broken_index(mongo_url: str):
    """The tempting fix — catch it, log it, carry on — leaves a database that looks constrained and is not."""

    async def body(database: AsyncDatabase) -> str:
        await database.teams.insert_many([valid_documents()["teams"], valid_document("teams", _id=SPIELER_OID, name="Lessing II")])
        try:
            await apply_constraints(database)
        except RuntimeError as failure:
            return _raised(failure, "uniq_shorthand")
        return "carried on"

    assert on_a_database(mongo_url, body) == "raised"


def test_a_view_left_behind_is_reported_as_enforcement_the_session_did_not_build(mongo_url: str):
    """The complement of the body above, on a database built ONCE.

    Nothing asks a view-creating body for `mutates_schema=True`, so the guard is what has to name
    the namespace.
    """

    async def body(database: AsyncDatabase) -> None:
        # Any real collection: what the view selects is nothing this asserts on.
        await database.command("create", LEFTOVER_VIEW, viewOn=str(Collection.SAISONS), pipeline=[])

    with pytest.raises(AssertionError, match=LEFTOVER_VIEW):
        on_the_shipped_schema(mongo_url, body)


def test_the_startup_apply_fails_rather_than_skipping_a_broken_support_index(mongo_url: str):
    """A support index costs speed rather than correctness, which is exactly why a boot might be tempted to shrug one off."""

    async def body(database: AsyncDatabase) -> str:
        # The same name over different keys: `create_index` refuses rather than replacing, which is
        # the one way a declared support index fails on a database holding no documents.
        await database.aktionen.create_index([("at", ASCENDING)], name=CONFLICTING_SUPPORT_INDEX)
        try:
            await apply_constraints(database)
        except RuntimeError as failure:
            return _raised(failure, CONFLICTING_SUPPORT_INDEX)
        return "carried on"

    assert on_a_database(mongo_url, body) == "raised"


def test_the_startup_apply_fails_rather_than_skipping_a_broken_ttl_index(mongo_url: str):
    """The third kind, and the one whose absence shows in nothing: a log that keeps every row reads exactly like a log being expired."""

    async def body(database: AsyncDatabase) -> str:
        await database.aktionen.create_index([("at", ASCENDING)], name=CONFLICTING_TTL_INDEX)
        try:
            await apply_constraints(database)
        except RuntimeError as failure:
            return _raised(failure, CONFLICTING_TTL_INDEX)
        return "carried on"

    assert on_a_database(mongo_url, body) == "raised"


@pytest.mark.parametrize("collection", ["bewerbungen", "registrierungen"])
def test_the_submission_key_lookup_walks_its_partial_unique_index(mongo_url: str, collection: str):
    """The planner takes a partial index only for a query implying its `$type` filter, which an equality alone does not."""

    async def body(database: AsyncDatabase) -> list[str]:
        await database[collection].insert_one(
            valid_document(collection, idempotenz_schluessel=IDEMPOTENZ_SCHLUESSEL, idempotenz_fingerabdruck="a" * 64)
        )
        explained = await database[collection].find(build_schluessel_filter(schluessel=IDEMPOTENZ_SCHLUESSEL)).explain()

        return winning_stages(explained)

    stages = on_the_shipped_schema(mongo_url, body)

    assert "IXSCAN" in stages and "COLLSCAN" not in stages, stages


# Section 6, the support indexes. Dropping one costs speed rather than correctness, which is why
# nothing asserted on them -- and why a read they no longer serve fails no test while it scans.

# Enough rows that the planner prefers an index: on a handful of documents a collection scan wins on
# merit, and a test asserting IXSCAN there would pass for the wrong reason.
ROWS_ENOUGH_TO_PREFER_AN_INDEX = 2000

# A triage tab's read, the one `bewerbungen_saison_id_status_queue` serves: one season, its status term
# an `$in` as `build_bewerbungen_status_term` composes it.
BEWERBUNGEN_QUEUE_FILTERS: list[dict[str, Any]] = [
    {"saison_id": SAISON_ID, "status": {"$in": ["eingereicht"]}},
]

# What `get_bewerbungen` counts on every read of one season: one status at a time.
BEWERBUNGEN_COUNT_FILTERS: list[dict[str, Any]] = [
    {"saison_id": SAISON_ID, "status": "eingereicht"},
]
AKTIONEN_QUEUE_FILTERS: list[dict[str, Any]] = [
    {},
    {"collection": "teams"},
    {"operation": "patch_one"},
    {"collection": "teams", "operation": "patch_one"},
    # A row's history action sends this one alone, and `aktionen_target` leads on `collection`, so
    # nothing here is a prefix of it: what this pins is that the sort index still carries the read.
    {"document_id": TEAM_OID},
]

# One trace the seeded rows share, so the narrowed tally below counts more than a single row.
TALLY_TRACE_ID = "0123456789abcdef0123456789abcdef"

# Every shape the tally's own `$match` can hold, the facet terms reaching the read alone
# (`app/api/aktionen/admin_router.py :: get_aktionen`). All four, because the planner is asked afresh
# for each.
AKTIONEN_TALLY_FILTERS: list[dict[str, Any]] = [
    {},
    {"trace_id": TALLY_TRACE_ID},
    {"document_id": TEAM_OID},
    {"trace_id": TALLY_TRACE_ID, "document_id": TEAM_OID},
]


def read_id(db_filter: dict[str, Any]) -> str:
    """Names how many values an `$in` holds, or two reads narrowing on one key would share an id."""

    named = [f"{field}-in-{len(term['$in'])}" if isinstance(term, dict) else field for field, term in db_filter.items()]
    return "+".join(named) or "none"


def index_reads(filters: list[dict[str, Any]]) -> list[tuple[dict[str, Any], str]]:
    return [
        # Every filter, because the planner is asked afresh for each. Some share an index with the
        # unfiltered read; what the case pins is that the added predicate does not push the plan off it.
        *((db_filter, "desc") for db_filter in filters),
        # The whole `asc` pin: both sort builders derive a single `direction`, so a tie-break pinned
        # against `order` breaks every `asc` read alike and one read catches it.
        (filters[0], "asc"),
    ]


def misplanned(planned: list[tuple[str, list[str]]], *, banned: tuple[str, ...] = ("SORT", "COLLSCAN")) -> list[tuple[str, list[str]]]:
    """Each read whose plan reaches no index or holds a banned stage, so one case names every read that regressed.

    One corpus serves them all: each filter and order is a query shape of its own, planned afresh.
    """

    return [(read, stages) for read, stages in planned if "IXSCAN" not in stages or any(stage in stages for stage in banned)]


def walk_stages(node: Any) -> list[str]:
    """Outermost first, down the several inputs a `SORT_MERGE` carries as well as the one every other stage has.

    A walk following `inputStage` alone stops at the merge, so an exploded `$in` reads as a plan
    reaching no index at all.
    """

    if node is None:
        return []

    stages = [node["stage"], *walk_stages(node.get("inputStage"))]
    for branch in node.get("inputStages", []):
        stages.extend(walk_stages(branch))

    return stages


def winning_stages(explained: Mapping[str, Any]) -> list[str]:
    """The winning plan's stages. A blocking sort shows up here as `SORT`."""

    return walk_stages(explained["queryPlanner"]["winningPlan"])


def counted_stages(explained: Mapping[str, Any]) -> list[str]:
    """The same, for a pipeline explained through the command, which answers in two shapes."""

    # A pipeline pushed whole into the query layer answers a top-level `queryPlanner`; one left as
    # aggregation stages answers it under the cursor stage. Reading one alone reports the other as
    # no plan at all.
    planner: Any = explained.get("queryPlanner") or explained["stages"][0]["$cursor"]["queryPlanner"]
    winning: Any = planner["winningPlan"]

    # `queryPlan` is where the slot-based engine puts the tree; the classic one puts it in the plan.
    return walk_stages(winning.get("queryPlan", winning))


#: What the declared support set may not fall below. The equality beside it compares the registry's own
#: length on both sides, so it holds no floor.
SUPPORT_INDEX_FLOOR: Final = 9


def test_every_declared_support_index_is_built(mongo_url: str):
    """`apply_constraints` creates each one, and the declared set does not quietly shrink."""

    async def body(database: AsyncDatabase) -> int:
        for index in SUPPORT_INDEXES:
            built = {existing["name"]: existing async for existing in await database[index.collection].list_indexes()}
            assert index.name in built, f"{index.name} missing from {index.collection}: {sorted(built)}"
            # Read back too: one built under another collation serves none of the reads it is declared for.
            locale = (built[index.name].get("collation") or {}).get("locale")
            assert locale == (index.collation or {}).get("locale"), f"{index.name} is built under {locale}, declared {index.collation}"
        return len(SUPPORT_INDEXES)

    built = on_the_shipped_schema(mongo_url, body)
    assert built == len(SUPPORT_INDEXES)
    assert built >= SUPPORT_INDEX_FLOOR, f"only {built} support index(es) are declared -- lower the floor only for one deliberately removed"


def test_every_declared_ttl_index_is_built_over_its_key_with_its_bound(mongo_url: str):
    """`expireAfterSeconds` is what makes it a TTL index at all, and one built without it serves reads and expires nothing."""

    async def body(database: AsyncDatabase) -> list[tuple[str, Any, Any]]:
        read_back = []
        for ttl in TTL_INDEXES:
            built = {index["name"]: index async for index in await database[ttl.collection].list_indexes()}
            assert ttl.name in built, f"{ttl.name} missing from {ttl.collection}: {sorted(built)}"
            read_back.append((ttl.name, built[ttl.name].get("expireAfterSeconds"), dict(built[ttl.name]["key"])))
        return read_back

    # Read back rather than assumed: an index is only ever ADDED
    # (`app/core/constraints.py :: apply_constraints`), so a changed bound reaches the declaration
    # and never a database that already holds the name.
    assert on_the_shipped_schema(mongo_url, body) == [(ttl.name, ttl.seconds, {ttl.key: 1}) for ttl in TTL_INDEXES]


def test_the_triage_queue_walks_an_index_whichever_way_it_is_read(mongo_url: str):
    """The property, not the key list: naming keys passes for an index this endpoint's own sort cannot use.

    The sort comes from `build_bewerbungen_sort`, so a change there is judged rather than mirrored.
    """

    async def body(database: AsyncDatabase) -> list[tuple[str, list[str]]]:
        await database["bewerbungen"].insert_many(
            [
                valid_document(
                    "bewerbungen",
                    _id=ObjectId(),
                    eingereicht_am=f"2026-02-{(row % 28) + 1:02d}",
                    saison_id=SAISON_ID if row % 2 else "2025",
                    status="eingereicht" if row % 3 else "angenommen",
                )
                for row in range(ROWS_ENOUGH_TO_PREFER_AN_INDEX)
            ]
        )
        planned = []
        for db_filter, order in index_reads(BEWERBUNGEN_QUEUE_FILTERS):
            explained = (
                await database["bewerbungen"]
                .find(db_filter)
                .sort(build_bewerbungen_sort(sort_by="eingereicht_am", order=order))
                .limit(50)
                .explain()
            )
            planned.append((f"{read_id(db_filter)}-{order}", winning_stages(explained)))
        return planned

    assert misplanned(on_the_shipped_schema(mongo_url, body)) == []


def test_the_per_status_count_walks_index_keys_rather_than_the_archive(mongo_url: str):
    """Every read of the triage list counts all three statuses, so a count that scans is a scan per page load.

    `COUNT_SCAN` and not merely an index: it answers off the keys and fetches no document at all.
    """

    async def body(database: AsyncDatabase) -> list[tuple[str, list[str]]]:
        await database["bewerbungen"].insert_many(
            [
                valid_document(
                    "bewerbungen",
                    _id=ObjectId(),
                    eingereicht_am=f"2026-02-{(row % 28) + 1:02d}",
                    saison_id=SAISON_ID if row % 2 else "2025",
                    status=("eingereicht", "angenommen", "abgelehnt")[row % 3],
                )
                for row in range(ROWS_ENOUGH_TO_PREFER_AN_INDEX)
            ]
        )
        planned = []
        for db_filter in BEWERBUNGEN_COUNT_FILTERS:
            # The pipeline `count_documents` itself issues, explained through the command: a `find` the
            # endpoint never makes would plan something no page load pays for.
            explained = await database.command(
                {
                    "explain": {
                        "aggregate": "bewerbungen",
                        "pipeline": [{"$match": db_filter}, {"$group": {"_id": 1, "n": {"$sum": 1}}}],
                        "cursor": {},
                    },
                    "verbosity": "queryPlanner",
                }
            )
            planned.append((read_id(db_filter), counted_stages(explained)))
        return planned

    planned = on_the_shipped_schema(mongo_url, body)

    assert [(read, stages) for read, stages in planned if "COUNT_SCAN" not in stages or "COLLSCAN" in stages] == []


def test_the_action_log_walks_an_index_whichever_way_it_is_read(mongo_url: str):
    """The log holds twelve months of recorded writes, so a read that cannot walk an index scans them all.

    `trace_id` is left out: it selects one write's fan-out, which the planner sorts in memory
    over a handful of rows.
    """

    async def body(database: AsyncDatabase) -> list[tuple[str, list[str]]]:
        await database["aktionen"].insert_many(
            [
                valid_documents()["aktionen"]
                | {
                    "_id": ObjectId(),
                    "at": f"2026-03-{(row % 28) + 1:02d}T09:30:00+00:00",
                    "trace_id": secrets.token_hex(16),
                    "collection": "teams" if row % 2 else "spiele",
                    "operation": "patch_one" if row % 3 else "insert",
                }
                for row in range(ROWS_ENOUGH_TO_PREFER_AN_INDEX)
            ]
        )
        planned = []
        for db_filter, order in index_reads(AKTIONEN_QUEUE_FILTERS):
            explained = await database["aktionen"].find(db_filter).sort(build_aktionen_sort(order=order)).limit(50).explain()
            planned.append((f"{read_id(db_filter)}-{order}", winning_stages(explained)))
        return planned

    assert misplanned(on_the_shipped_schema(mongo_url, body)) == []


def test_the_facet_tally_walks_index_keys_rather_than_the_whole_log(mongo_url: str):
    """`FACET_TALLY` itself, never a copy: a copy would pin a pipeline nothing issues once a group key moves."""

    async def body(database: AsyncDatabase) -> list[tuple[str, list[str]]]:
        await database[Collection.AKTIONEN].insert_many(
            [
                valid_documents()["aktionen"]
                | {
                    "_id": ObjectId(),
                    "trace_id": TALLY_TRACE_ID if row else secrets.token_hex(16),
                    "collection": "teams" if row % 2 else "spiele",
                    "operation": "patch_one" if row % 3 else "insert",
                }
                for row in range(ROWS_ENOUGH_TO_PREFER_AN_INDEX)
            ]
        )
        planned = []
        for db_filter in AKTIONEN_TALLY_FILTERS:
            explained = await database.command(
                {
                    "explain": {"aggregate": str(Collection.AKTIONEN), "pipeline": [{"$match": db_filter}, *FACET_TALLY], "cursor": {}},
                    "verbosity": "queryPlanner",
                }
            )
            planned.append((read_id(db_filter), counted_stages(explained)))
        return planned

    # `SORT` among the banned: the `$sort` is what makes the planner reach for an index at all, and it is free only while
    # one provides the order; without `aktionen_facets` the same stage sorts the log in memory instead.
    assert misplanned(on_the_shipped_schema(mongo_url, body)) == []


GERMAN_SQUAD_INDEX = "saison_spieler_saison_id_team_id_de"

# The clubs and seasons the squad rows below spread over, so one club of one season is a small slice of them.
SQUAD_TEAMS = 10
SQUAD_SEASONS = ("2024", "2025", SAISON_ID)

Issued = tuple[list[Mapping[str, Any]], Mapping[str, Any] | None]


def count_pipeline(db_filter: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """The pipeline `count_documents` sends for `db_filter`."""

    return [{"$match": db_filter}, {"$group": {"_id": 1, "n": {"$sum": 1}}}]


class _SentSquadReads:
    """A squad collection keeping each aggregate and count a call site sends, with its collation, so the read is explained as sent."""

    def __init__(self, collection: Any) -> None:
        self._collection = collection
        self.sent: list[Issued] = []

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def aggregate(self, pipeline: list[Mapping[str, Any]], *, collation: Mapping[str, Any] | None = None, **kwargs: Any) -> Any:
        self.sent.append((pipeline, collation))
        return await self._collection.aggregate(pipeline, collation=collation, **kwargs)

    async def count_documents(self, db_filter: Mapping[str, Any], **kwargs: Any) -> int:
        self.sent.append((count_pipeline(db_filter), kwargs.get("collation")))
        return await self._collection.count_documents(db_filter, **kwargs)


async def sent_by(database: AsyncDatabase, read: Callable[[Any, AsyncClientSession], Awaitable[Any]]) -> Issued:
    """The one squad read `read` sends; a refusal it answers after the read is beside the point here."""

    squad = _SentSquadReads(database[Collection.SAISON_SPIELER])
    async with database.client.start_session() as session:
        with contextlib.suppress(APIError):
            await read(squad, session)
    [issued] = squad.sent
    return issued


async def the_report_squads(database: AsyncDatabase) -> Issued:
    await database[Collection.SPIELE].insert_one(
        valid_document("spiele", _id=SPIEL_OID, team2={"team_id": OTHER_TEAM_OID, "name": "Helmholtz", "tore": 1, "shorthand": "HEX"})
    )

    return await sent_by(
        database,
        lambda squad, session: pull_bericht_lage(
            spiele_collection=database[Collection.SPIELE],
            saisons_collection=database[Collection.SAISONS],
            saison_spieler_collection=squad,
            spiel_id=SPIEL_OID,
            session=session,
        ),
    )


async def the_squad_page(database: AsyncDatabase) -> Issued:
    return await sent_by(
        database,
        lambda squad, session: _read_the_squad(saison_spieler_collection=squad, team_id=TEAM_OID, saison_id=SAISON_ID, session=session),
    )


def index_names(node: Any) -> list[str]:
    """Every index a plan walks, at any depth: a `$lookup` or an exploded `$in` nests its scans past `inputStage`."""

    if isinstance(node, Mapping):
        return [*([node["indexName"]] if "indexName" in node else []), *(name for value in node.values() for name in index_names(value))]
    if isinstance(node, list):
        return [name for value in node for name in index_names(value)]
    return []


@pytest.mark.parametrize(
    ("issue", "index"),
    [
        pytest.param(the_report_squads, GERMAN_SQUAD_INDEX, id="the-report-s-squads"),
        pytest.param(the_squad_page, GERMAN_SQUAD_INDEX, id="the-squad-page"),
    ],
)
def test_a_clubs_squad_rows_are_read_through_the_index_of_the_reads_collation(
    mongo_url: str, issue: Callable[[AsyncDatabase], Awaitable[Issued]], index: str
):
    """An index serves only a read of its own collation: the two name-sorted reads take the German one."""

    async def body(database: AsyncDatabase) -> tuple[list[str], list[str], Mapping[str, Any] | None]:
        await database[Collection.SAISON_SPIELER].insert_many(
            [
                valid_document("saison_spieler", _id=ObjectId(), spieler_id=ObjectId(), saison_id=saison, team_id=team)
                for saison in SQUAD_SEASONS
                for team in (TEAM_OID, OTHER_TEAM_OID, *(ObjectId() for _ in range(SQUAD_TEAMS - 2)))
                for _ in range(ROWS_ENOUGH_TO_PREFER_AN_INDEX // (SQUAD_TEAMS * len(SQUAD_SEASONS)))
            ]
        )
        pipeline, collation = await issue(database)
        command: dict[str, Any] = {"aggregate": str(Collection.SAISON_SPIELER), "pipeline": pipeline, "cursor": {}}
        if collation is not None:
            command["collation"] = collation
        explained = await database.command({"explain": command, "verbosity": "queryPlanner"})
        planner: Any = explained.get("queryPlanner") or explained["stages"][0]["$cursor"]["queryPlanner"]

        return counted_stages(explained), index_names(planner["winningPlan"]), collation

    stages, indexes, collation = on_the_shipped_schema(mongo_url, body)

    assert "COLLSCAN" not in stages, f"read under {collation} scans the squads: {stages}"
    assert indexes == [index], f"read under {collation} walked {indexes}, not {index}"


class _SentUpdates(monitoring.CommandListener):
    """Every update statement this client sends, with its collection, as the server receives it."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, dict[str, Any]]] = []

    def started(self, event: monitoring.CommandStartedEvent) -> None:
        if event.command_name == "update":
            self.sent.extend((str(event.command["update"]), dict(statement)) for statement in event.command["updates"])

    def succeeded(self, event: monitoring.CommandSucceededEvent) -> None:
        """Required by the listener interface; an update is judged as it is sent."""

    def failed(self, event: monitoring.CommandFailedEvent) -> None:
        """Required by the listener interface; a failed update was still sent with its filter."""


ERASED_PSEUDONYM: Final = "e" * 64


def test_the_erasure_marks_a_persons_log_rows_through_an_index(mongo_url: str):
    """The updates the two steps send, never a copy of their filters, explained over a log large enough that the planner prefers an index."""

    async def body(database: AsyncDatabase) -> list[tuple[dict[str, Any], list[str]]]:
        await database[Collection.AKTIONEN].insert_many(
            [
                valid_documents()["aktionen"]
                | {
                    "_id": ObjectId(),
                    "actor": {
                        "kind": "person_session",
                        "pseudonym": ERASED_PSEUDONYM if row % 500 == 0 else f"{row:064x}",
                        "funktion": ("spieler", "kontakt", "schiedsrichter")[row % 3],
                    },
                }
                for row in range(ROWS_ENOUGH_TO_PREFER_AN_INDEX)
            ]
        )

        listener = _SentUpdates()
        watched = AsyncMongoClient(mongo_url, event_listeners=[listener])
        try:
            log = watched[database.name][Collection.AKTIONEN]
            async with watched.start_session() as session:
                await unattribute_in_session(
                    aktionen_collection=log, identifier="ida@example.invalid", pseudonym=ERASED_PSEUDONYM, session=session
                )
                await erase_pupil_actor_in_session(aktionen_collection=log, pseudonym=ERASED_PSEUDONYM, session=session)
        finally:
            await watched.close()

        explained = [
            (statement["q"], await database.command({"explain": {"update": collection, "updates": [statement]}, "verbosity": "queryPlanner"}))
            for collection, statement in listener.sent
            if collection == Collection.AKTIONEN
        ]
        return [(db_filter, winning_stages(plan)) for db_filter, plan in explained]

    planned = on_the_shipped_schema(mongo_url, body)

    # The control: a listener hearing nothing would pass the loop below over no update at all.
    assert sum("actor.pseudonym" in db_filter for db_filter, _ in planned) == 2, planned
    for db_filter, stages in planned:
        assert "COLLSCAN" not in stages, f"marking {db_filter} scans the whole log: {stages}"


OTHER_SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607200010")


class TestTwoRefereesOpenRowsOnOneStand:
    def test_each_referee_holds_an_open_row_of_their_own(self, mongo_url: str):
        """The mint inserts a new referee's row while the close's share still leaves the old one's open.

        Without the referee key that insert collides, passing the fixture over every pass until the close shuts the old row.
        """

        async def body(database: AsyncDatabase) -> int:
            for row_id, schiedsrichter_id in ((SPIELBESTAETIGUNG_OID, SCHIEDSRICHTER_OID), (SPIELER_OID, OTHER_SCHIEDSRICHTER_OID)):
                await database.spielbestaetigungen.insert_one(
                    valid_document(
                        "spielbestaetigungen",
                        _id=row_id,
                        partei={"art": "schiedsrichter", "schiedsrichter_id": schiedsrichter_id},
                        kontakte=None,
                    )
                )
            return await database.spielbestaetigungen.count_documents({"antwort": None, "geschlossen": None})

        assert on_the_shipped_schema(mongo_url, body) == 2
