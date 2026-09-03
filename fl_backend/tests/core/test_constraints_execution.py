import secrets
from typing import Any, Awaitable, Callable, Mapping

import pytest
from bson import ObjectId
from pymongo import ASCENDING
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.aktionen.services import build_aktionen_sort
from app.api.bewerbungen.services import build_bewerbungen_sort
from app.core.constraints import (
    ABSENT_COLLECTION_NAME,
    COLLECTION_VALIDATORS,
    SUPPORT_INDEXES,
    UNIQUE_INDEXES,
    apply_constraints,
    probe_collmod_privilege,
    report_duplicates,
    report_relations,
    report_violations,
)
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

# Asserted on rather than caught broadly, so an unrelated failure cannot pass as a rejection.
DOCUMENT_VALIDATION_FAILED = 121

# The throwaway: every body under it breaks the schema it applies, so `on_a_database` rebuilds it per
# call.
DATABASE_NAME = worker_database("fl_constraints_test")
# A second database, so the throwaway above stays the one this suite is free to break.
SHIPPED_DATABASE_NAME = worker_database("fl_constraints_shipped_test")
# Its own name: `a_clean_database` records one schema per name, and alternating constrained and
# unconstrained callers on one would rebuild at every switch.
UNCONSTRAINED_DATABASE_NAME = worker_database("fl_constraints_unconstrained_test")

SAISON_ID = "2026"
TEAM_OID = ObjectId("6890a1b2c3d4e5f607200001")
SPIELER_OID = ObjectId("6890a1b2c3d4e5f607200002")
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f607200003")
SPIELORT_OID = ObjectId("6890a1b2c3d4e5f607200004")
SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607200005")
AKTION_OID = ObjectId("6890a1b2c3d4e5f607200006")
# A third club and a club-shaped id `teams` never held: the two the cross-document rules need and
# no validator has an opinion about.
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607200007")
ORPHAN_TEAM_OID = ObjectId("6890a1b2c3d4e5f607200008")
BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607200009")

# The labels an operator reads off `--check`. Asserted rather than inlined per test, so renaming one
# fails here instead of quietly changing what the report is understood to mean.
SPIELTAG_OCCUPANCY_RULE = "a team is fielded at most once per Spieltag (spiele)"
JUNCTION_CLUB_RULE = "every junction row names a club that exists (saison_teams)"

# One declared support index, planted under different keys so its build is the one that fails.
CONFLICTING_SUPPORT_INDEX = "saisons_status"

# Enough junction rows that the unique build over them outlasts the two-document build beside it.
SLOW_BUILD_DOCUMENTS = 4000

# The pair the ordering rule has to separate: the earlier-declared one is the SLOWER build, so a
# report picked by arrival names the other.
EARLIER_DECLARED_INDEX = "uniq_saison_id_team_id"
LATER_DECLARED_INDEX = "uniq_shorthand"

ADDRESS = {"strasse": "Hanauer Landstraße", "hausnummer": "12a", "plz": "60314", "stadtteil": "Ostend", "stadt": "Frankfurt am Main"}


def kontaktperson(vorname: str) -> dict[str, Any]:
    """A function rather than a constant: the nested consent has to be fresh per slot too, which a `dict()` of a shared one is not."""
    return {
        "vorname": vorname,
        "nachname": f"{vorname}-Mustermann",
        "email": f"{vorname.lower()}@example.com",
        "telefon": "+49 69 1234567",
        "geburtsdatum": "1980-05-04",
        "einwilligung": {"umfang": "kontaktdaten", "erteilt_von": "person", "text_version": "v1", "datum": "2026-01-15"},
    }


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
        },
        "teams": {
            "_id": TEAM_OID,
            "name": "Lessing",
            "shorthand": "LE",
            "description": "",
            "full_name": "Lessing-Gymnasium",
            "website_url": "https://lessing-gymnasium.example.de",
            "address": dict(ADDRESS),
            "inactive_since": None,
        },
        # `name` and `shorthand` are the season's own copy of the club's identity, required since the
        # junction became their home; a row without them is unreadable rather than merely stale.
        "saison_teams": {"saison_id": SAISON_ID, "team_id": TEAM_OID, "gruppe": "A", "austritt": None, "name": "Lessing", "shorthand": "LE"},
        "spieler": {
            "_id": SPIELER_OID,
            "vorname": "Max",
            "nachname": "Mustermann",
            "inactive_since": None,
            "einwilligung": {
                "umfang": "kader_oeffentlich",
                "erteilt_von": "erziehungsberechtigt",
                "datum": "2026-01-15",
                "bestaetigt_am": "2026-01-20",
            },
        },
        "saison_spieler": {
            "spieler_id": SPIELER_OID,
            "saison_id": SAISON_ID,
            "team_id": TEAM_OID,
            "is_nachgetragen": False,
            "rolle": None,
            "stufe": "Q2",
            "position": "Angriff",
            "nummer": "10",
            "inactive_since": None,
        },
        "spiele": {
            "team1": {"team_id": TEAM_OID, "name": "Lessing", "tore": 2, "shorthand": "LE"},
            "team2": {"team_id": SPIELER_OID, "name": "Helmholtz", "tore": 1, "shorthand": "HE"},
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
        # one carries a value, a write-path rule no validator of types and enums can state
        # (`docs/backend/spec.md :: I16`).
        "bewerbungen": {
            "_id": BEWERBUNG_OID,
            "saison_id": SAISON_ID,
            "eingereicht_am": "2026-02-01",
            "status": "eingereicht",
            "team_id": None,
            "schule": {
                "team_name": "Lessing",
                "full_name": "Lessing-Gymnasium",
                "shorthand": "LE",
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
            "entscheidung": None,
        },
        "aktionen": {
            "_id": AKTION_OID,
            "at": "2026-03-15T09:30:00+00:00",
            "actor": {"kind": "admin_session", "email": "admin@example.invalid"},
            "correlation_id": secrets.token_hex(16),
            "request": {"method": "PATCH", "path": "/api/v0/teams/{team_id}"},
            # Any collection but its own: the log records every other one and never itself.
            "collection": "teams",
            "operation": "patch_one",
            "document_id": TEAM_OID,
            "db_filter": None,
            "before": {"name": "Lessing"},
            "modified_count": None,
            "redacted_at": None,
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


def on_an_unconstrained_database(url: str, body: Body) -> Any:
    """A database with no validator and no index, emptied for this test: for a body inserting what the shipped schema would refuse."""

    async def _run() -> Any:
        async with a_clean_database(url, UNCONSTRAINED_DATABASE_NAME, constraints=False) as (_, database):
            return await body(database)

    return on_the_seed_loop(_run())


def on_the_shipped_schema(url: str, body: Body) -> Any:
    """A database the shipped constraints were built on ONCE, emptied for this test.

    For a body that only inserts and reads; one that breaks a validator or an index takes
    `on_a_database`'s throwaway.
    """

    async def _run() -> Any:
        async with a_clean_database(url, SHIPPED_DATABASE_NAME, constraints=True) as (_, database):
            return await body(database)

    return on_the_seed_loop(_run())


def insert_outcome(url: str, collection: str, document: dict[str, Any]) -> str:
    async def body(database: AsyncDatabase) -> str:
        try:
            await database[collection].insert_one(document)
        except OperationFailure as failure:
            assert failure.code == DOCUMENT_VALIDATION_FAILED, f"expected a validation failure, got {failure.code}: {failure}"
            return "rejected"
        return "accepted"

    return on_the_shipped_schema(url, body)


@pytest.mark.parametrize("collection", sorted(COLLECTION_VALIDATORS))
def test_a_conforming_document_is_accepted(mongo_url: str, collection: str):
    """A validator that rejects everything enforces its rule perfectly and makes the collection unwritable."""
    assert insert_outcome(mongo_url, collection, valid_documents()[collection]) == "accepted"


@pytest.mark.parametrize(
    ("collection", "document", "why"),
    [
        # A team's `full_name` where a reference belongs: unique, well-formed and wrong.
        ("saison_spieler", valid_document("saison_spieler", team_id="Lessing-Gymnasium"), "a team name where a reference belongs"),
        # An integral double Pydantic accepts, so nothing looks wrong until something rounds.
        (
            "spiele",
            valid_document("spiele", ort={**valid_documents()["spiele"]["ort"], "mietpreis": 80.0}),
            "a rent stored as a double",
        ),
        ("saison_teams", valid_document("saison_teams", gruppe="E"), "a fifth group"),
        ("saisons", valid_document("saisons", status="current"), "a status outside the Literal"),
        # "playoffs" is a query-only alias for "not gruppenphase" and is never a stored value.
        ("spiele", valid_document("spiele", saison_phase="playoffs"), "a query alias stored as a phase"),
        (
            "spiele",
            valid_document("spiele", team1={"team_id": TEAM_OID, "name": "Lessing", "tore": "2", "shorthand": "LE"}),
            "goals as a string",
        ),
        # The shoot-out has no variants, so the validator covers all of it: both counts required, both typed.
        (
            "spiele",
            valid_document("spiele", ergebnis="2:2", elfmeterschiessen={"team1": "4", "team2": 3}),
            "a shoot-out count stored as a string",
        ),
        (
            "spiele",
            valid_document("spiele", ergebnis="2:2", elfmeterschiessen={"team1": 4}),
            "a shoot-out with only one side",
        ),
        # `beginn` rather than a count: a matchday's count is on no document, so nothing rejects it.
        ("spieltage", valid_document("spieltage", beginn=20260315), "a date stored as a number"),
        # The pair below is what keeps `beginn` nullable from collapsing into optional: the VALUE may
        # be null, the KEY may not be absent.
        ("spieltage", {k: v for k, v in valid_documents()["spieltage"].items() if k != "beginn"}, "a matchday with no `beginn` key"),
        ("spieltage", {k: v for k, v in valid_documents()["spieltage"].items() if k != "ende"}, "a matchday with no `ende` key"),
        (
            "saisons",
            valid_document("saisons", spielplan={"generiert_am": "2026-08-21", "spieltage": "12", "spiele": 60}),
            "a generated count stored as a string",
        ),
        (
            "saisons",
            valid_document("saisons", spielplan={"generiert_am": "2026-08-21", "spieltage": 12}),
            "a watermark missing its fixture count",
        ),
        # Declaring `spielplan` at all is what buys this: `_object` emits no `additionalProperties`,
        # so an undeclared key of any type would have been accepted.
        ("saisons", valid_document("saisons", spielplan="2026-08-21"), "a watermark stored as a bare string"),
        ("spieler", valid_document("spieler", vorname=None), "a player with no first name"),
        ("teams", {k: v for k, v in valid_documents()["teams"].items() if k != "full_name"}, "a missing required field"),
        # `saison_teams` is the one collection the mirror apparatus skips, so its `required` tuple is
        # hand-maintained and these two cases are the only thing standing under it.
        ("saison_teams", {k: v for k, v in valid_documents()["saison_teams"].items() if k != "name"}, "a junction row with no name"),
        (
            "saison_teams",
            {k: v for k, v in valid_documents()["saison_teams"].items() if k != "shorthand"},
            "a junction row with no shorthand",
        ),
        ("schiedsrichter", valid_document("schiedsrichter", kontakt={"telefon": "030 123"}), "a kontakt missing half its shape"),
        # The block is nullable on the junction and NOT here: an application IS the form those three
        # people filled in, so a null one is the asymmetry this case stands under.
        ("bewerbungen", valid_document("bewerbungen", kontakte=None), "an application naming nobody"),
        # Nested inside a NULLABLE object, where `required` lapses entirely when the value is null:
        # this is what says the enum still binds once the object is really there.
        (
            "bewerbungen",
            valid_document("bewerbungen", schule={**valid_documents()["bewerbungen"]["schule"], "schulform": "realschule"}),
            "a schulform outside the enum",
        ),
    ],
    ids=lambda value: value if isinstance(value, str) else "",
)
def test_a_malformed_document_is_rejected(mongo_url: str, collection: str, document: dict[str, Any], why: str):
    assert insert_outcome(mongo_url, collection, document) == "rejected", f"the validator let through {why}"


def test_an_absent_embedded_object_is_still_accepted(mongo_url: str):
    """MongoDB applies `required` only when the value really is an object, so a nullable `ort` and its required keys do not fight."""
    assert insert_outcome(mongo_url, "spiele", valid_document("spiele", ort=None, schiedsrichter=None)) == "accepted"


def test_a_generated_matchday_carries_no_dates_yet(mongo_url: str):
    """The generator writes the list before anyone has picked dates; `PATCH /spieltage/{id}` fills them in later."""
    assert insert_outcome(mongo_url, "spieltage", valid_document("spieltage", beginn=None, ende=None)) == "accepted"


@pytest.mark.parametrize(
    ("spielplan", "why"),
    [
        ({"generiert_am": "2026-08-21", "spieltage": 12, "spiele": 60}, "a season the generator has written"),
        # Both mean never generated, and the base document above covers the third case: no key at all.
        (None, "a season explicitly marked as never generated"),
    ],
    ids=lambda value: value if isinstance(value, str) else "",
)
def test_every_shape_the_generator_watermark_takes_is_accepted(mongo_url: str, spielplan: Any, why: str):
    """`spielplan` is out of `required`, so a row predating the field stays writable and needs no backfill."""
    assert insert_outcome(mongo_url, "saisons", valid_document("saisons", spielplan=spielplan)) == "accepted", f"refused {why}"


@pytest.mark.parametrize(
    ("collection", "first", "second"),
    [
        ("saison_teams", valid_documents()["saison_teams"], valid_document("saison_teams", gruppe="B")),
        ("saison_spieler", valid_documents()["saison_spieler"], valid_document("saison_spieler", nummer="11")),
        ("spiele", valid_documents()["spiele"], valid_document("spiele", ergebnis="0:0")),
        ("teams", valid_documents()["teams"], valid_document("teams", _id=SPIELER_OID, name="Lessing II")),
        ("spieltage", valid_documents()["spieltage"], valid_document("spieltage", _id=SPIELORT_OID, ende="2026-03-22")),
    ],
    ids=[index.name for index in UNIQUE_INDEXES],
)
def test_each_unique_index_refuses_the_second_document(mongo_url: str, collection: str, first: dict[str, Any], second: dict[str, Any]):
    async def body(database: AsyncDatabase) -> str:
        await database[collection].insert_one(first)
        try:
            await database[collection].insert_one(second)
        except OperationFailure as failure:
            return f"rejected:{failure.code}"
        return "accepted"

    # 11000 is DuplicateKey, not 121 — an index refuses the write before any validator sees it.
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


def test_every_validator_is_attached_strictly(mongo_url: str):
    """Not `moderate`, which exempts the documents worth catching, and not `warn`, which lets the write land."""

    async def body(database: AsyncDatabase) -> dict[str, tuple[bool, str, str]]:
        found = {}
        async for collection in await database.list_collections():
            options = collection.get("options", {})
            found[collection["name"]] = (
                "validator" in options,
                options.get("validationLevel", ""),
                options.get("validationAction", ""),
            )
        return found

    attached = on_the_shipped_schema(mongo_url, body)
    assert set(attached) == set(COLLECTION_VALIDATORS)
    assert all(value == (True, "strict", "error") for value in attached.values()), attached


def test_applying_twice_changes_nothing(mongo_url: str):
    """A second `create_index` with the same name and options is a no-op; different options is an error, so the declared ones must match."""

    async def body(database: AsyncDatabase) -> tuple[int, int]:
        second = await apply_constraints(database)
        built = 0
        for index in UNIQUE_INDEXES:
            names = [existing["name"] async for existing in await database[index.collection].list_indexes()]
            assert index.name in names, f"{index.name} missing from {index.collection}: {names}"
            built += 1
        return second.validators, built

    # The shipped schema, so its drift guard also holds the second apply to leaving every
    # collection as the first did.
    assert on_the_shipped_schema(mongo_url, body) == (len(COLLECTION_VALIDATORS), len(UNIQUE_INDEXES))


def test_the_startup_apply_fails_rather_than_skipping_a_broken_index(mongo_url: str):
    """The tempting fix — catch it, log it, carry on — leaves a database that looks constrained and is not."""

    async def body(database: AsyncDatabase) -> str:
        await database.teams.insert_many([valid_documents()["teams"], valid_document("teams", _id=SPIELER_OID, name="Lessing II")])
        try:
            await apply_constraints(database)
        except RuntimeError as failure:
            return "raised" if "uniq_shorthand" in str(failure) else f"raised the wrong thing: {failure}"
        return "carried on"

    assert on_a_database(mongo_url, body) == "raised"


def test_the_startup_apply_fails_rather_than_skipping_a_broken_validator(mongo_url: str):
    """The other half of the same refusal: an unattached validator leaves a collection every write path believes is guarded."""

    async def body(database: AsyncDatabase) -> str:
        # A view takes no validator, so `collMod` refuses with something other than
        # `NamespaceNotFound` and the fall-through that would create the collection cannot fire.
        await database.command("create", "teams", viewOn="spielorte", pipeline=[])
        try:
            await apply_constraints(database)
        except RuntimeError as failure:
            return "raised" if "the validator for 'teams'" in str(failure) else f"raised the wrong thing: {failure}"
        return "carried on"

    assert on_a_database(mongo_url, body) == "raised"


def test_the_startup_apply_fails_rather_than_skipping_a_broken_support_index(mongo_url: str):
    """A support index costs speed rather than correctness, which is exactly why a boot might be tempted to shrug one off."""

    async def body(database: AsyncDatabase) -> str:
        # The same name over different keys: `create_index` refuses rather than replacing, which is
        # the one way a declared support index fails on a database holding no documents.
        await database.saisons.create_index([("start_date", ASCENDING)], name=CONFLICTING_SUPPORT_INDEX)
        try:
            await apply_constraints(database)
        except RuntimeError as failure:
            return "raised" if CONFLICTING_SUPPORT_INDEX in str(failure) else f"raised the wrong thing: {failure}"
        return "carried on"

    assert on_a_database(mongo_url, body) == "raised"


def test_the_apply_reports_the_index_declared_first_when_two_of_them_fail(mongo_url: str):
    """The same rule on the shipped path, where arrival must not pick the failure.

    The later-declared build breaks over two documents and the earlier over thousands, so arrival
    would name the wrong one. Both failing is asserted: one failure orders nothing.
    """

    async def body(database: AsyncDatabase) -> str:
        await database.teams.insert_many([valid_documents()["teams"], valid_document("teams", _id=SPIELER_OID, name="Lessing II")])
        # Distinct pairs but for the last two, so the build has to scan the lot before it can fail.
        rows = [valid_document("saison_teams", team_id=ObjectId()) for _ in range(SLOW_BUILD_DOCUMENTS)]
        await database.saison_teams.insert_many([*rows, valid_document("saison_teams", team_id=rows[-1]["team_id"])])
        try:
            await apply_constraints(database)
        except RuntimeError as failure:
            reported = str(failure)
        else:
            return "carried on"

        # Re-attempted alone: a refused build left nothing behind, so a SECOND refusal is what says
        # the seeding really did break this one too.
        later = next(index for index in UNIQUE_INDEXES if index.name == LATER_DECLARED_INDEX)
        try:
            await database[later.collection].create_index([(key, ASCENDING) for key in later.keys], name=later.name, unique=True)
        except OperationFailure:
            pass
        else:
            return f"only one build failed -- '{LATER_DECLARED_INDEX}' was buildable, so nothing was ordered"

        return EARLIER_DECLARED_INDEX if EARLIER_DECLARED_INDEX in reported else f"reported instead: {reported}"

    assert on_a_database(mongo_url, body) == EARLIER_DECLARED_INDEX


@pytest.mark.parametrize("constrained", [False, True], ids=["target absent", "target present"])
def test_the_privilege_probe_answers_granted_and_writes_nothing(mongo_url: str, constrained: bool):
    """Both replies: an empty database answers `NamespaceNotFound`, a constrained one `IndexNotFound`, and the probe must leave no trace."""

    async def body(database: AsyncDatabase) -> tuple[str, list[str], list[str]]:
        answer = await probe_collmod_privilege(database)
        target = next(iter(COLLECTION_VALIDATORS))
        hidden = [index["name"] async for index in await database[target].list_indexes() if index.get("hidden")]
        return answer, await database.list_collection_names(), hidden

    # Either cached database: both guard the "writes nothing" half after the body, so a trace the
    # assertions below do not look for fails here too.
    run = on_the_shipped_schema if constrained else on_an_unconstrained_database
    answer, collections, hidden = run(mongo_url, body)
    assert answer == "granted"
    assert ABSENT_COLLECTION_NAME not in collections
    assert hidden == []


def test_the_check_mode_finds_what_the_validators_would_reject(mongo_url: str):
    """The validator document is read back as a query — `$jsonSchema` is both — so no second implementation can disagree."""

    async def body(database: AsyncDatabase) -> tuple[int, list[Any], int]:
        await database.saison_spieler.insert_many(
            [
                valid_documents()["saison_spieler"],
                valid_document("saison_spieler", spieler_id=SPIELTAG_OID, team_id="Lessing-Gymnasium"),
            ]
        )
        # Two junction rows for one team in one season, which is the rule the index enforces.
        await database.saison_teams.insert_many([valid_documents()["saison_teams"], valid_document("saison_teams", gruppe="B")])

        violations = {report.collection: report for report in await report_violations(database)}
        duplicates = {report.index.name: report for report in await report_duplicates(database)}

        return (
            violations["saison_spieler"].failing,
            violations["saison_spieler"].examples,
            duplicates["uniq_saison_id_team_id"].groups,
        )

    failing, examples, duplicate_groups = on_an_unconstrained_database(mongo_url, body)
    assert failing == 1
    assert len(examples) == 1
    assert duplicate_groups == 1


def test_the_cross_document_rules_report_a_clean_database_as_clean(mongo_url: str):
    """Asserted FIRST and separately: a rule that fires on everything enforces nothing and reads exactly like one that works."""

    async def body(database: AsyncDatabase) -> dict[str, int]:
        await database.teams.insert_one(valid_documents()["teams"])
        await database.saison_teams.insert_one(valid_documents()["saison_teams"])
        await database.spiele.insert_one(valid_documents()["spiele"])

        return {report.rule: report.groups for report in await report_relations(database)}

    groups = on_an_unconstrained_database(mongo_url, body)
    assert groups == {SPIELTAG_OCCUPANCY_RULE: 0, JUNCTION_CLUB_RULE: 0}


def test_the_cross_document_rules_find_what_no_validator_and_no_index_can(mongo_url: str):
    """Both rules span two documents, so neither is expressible as a `$jsonSchema` or a unique index.

    Unconstrained on purpose: every offender below is a document the validators ACCEPT, which is the
    whole gap this report exists to close.
    """

    async def body(database: AsyncDatabase) -> tuple[dict[str, int], dict[str, list[Any]]]:
        await database.teams.insert_one(valid_documents()["teams"])

        # One club on two fixtures of ONE Spieltag. The second names a different opponent, so the
        # rule has exactly one group to find rather than three.
        await database.spiele.insert_many(
            [
                valid_documents()["spiele"],
                valid_document(
                    "spiele",
                    spiel_nr=2,
                    ergebnis=None,
                    team1={"team_id": TEAM_OID, "name": "Lessing", "tore": None, "shorthand": "LE"},
                    team2={"team_id": OTHER_TEAM_OID, "name": "Goethe", "tore": None, "shorthand": "GO"},
                ),
            ]
        )

        # One junction row naming a club `teams` does not hold, beside one that resolves.
        await database.saison_teams.insert_many(
            [
                valid_documents()["saison_teams"],
                valid_document("saison_teams", gruppe="B", team_id=ORPHAN_TEAM_OID, name="Nowhere", shorthand="NW"),
            ]
        )

        reports = {report.rule: report for report in await report_relations(database)}

        return (
            {rule: report.groups for rule, report in reports.items()},
            {rule: report.examples for rule, report in reports.items()},
        )

    groups, examples = on_an_unconstrained_database(mongo_url, body)

    assert groups == {SPIELTAG_OCCUPANCY_RULE: 1, JUNCTION_CLUB_RULE: 1}

    occupancy = examples[SPIELTAG_OCCUPANCY_RULE][0]
    assert occupancy["team_id"] == TEAM_OID
    assert occupancy["spieltag_id"] == SPIELTAG_OID
    # Both fixture numbers, sorted: the example is what an operator repairs from, so it names them.
    assert occupancy["spiele"] == [1, 2]

    orphan = examples[JUNCTION_CLUB_RULE][0]
    assert orphan["team_id"] == ORPHAN_TEAM_OID
    assert orphan["saisons"] == [SAISON_ID]


def test_a_club_on_both_sides_of_one_fixture_is_one_group_not_two(mongo_url: str):
    """`n`, not the size of `spiele`: the two sides collapse to one `spiel_nr`, and counting those would miss it."""

    async def body(database: AsyncDatabase) -> tuple[int, list[Any]]:
        side = {"team_id": TEAM_OID, "name": "Lessing", "tore": None, "shorthand": "LE"}
        await database.spiele.insert_one(valid_document("spiele", ergebnis=None, team1=dict(side), team2=dict(side)))

        report = next(report for report in await report_relations(database) if report.rule == SPIELTAG_OCCUPANCY_RULE)

        return report.groups, report.examples

    groups, examples = on_an_unconstrained_database(mongo_url, body)
    assert groups == 1
    assert examples[0]["spiele"] == [1]


# Section 6, the support indexes. Dropping one costs speed rather than correctness, which is why
# nothing asserted on them -- and why a read they no longer serve fails no test while it scans.

# Enough rows that the planner prefers an index: on a handful of documents a collection scan wins on
# merit, and a test asserting IXSCAN there would pass for the wrong reason.
ROWS_ENOUGH_TO_PREFER_AN_INDEX = 2000

BEWERBUNGEN_QUEUE_FILTERS: list[dict[str, Any]] = [
    {},
    {"saison_id": SAISON_ID},
    {"status": "eingereicht"},
    {"saison_id": SAISON_ID, "status": "eingereicht"},
]
AKTIONEN_QUEUE_FILTERS: list[dict[str, Any]] = [
    {},
    {"collection": "teams"},
    {"operation": "patch_one"},
    {"collection": "teams", "operation": "patch_one"},
]


def index_reads(filters: list[dict[str, Any]]) -> list[Any]:
    return [
        # Every filter, because the planner is asked afresh for each. Some share an index with the
        # unfiltered read; what the case pins is that the added predicate does not push the plan off it.
        *(pytest.param(db_filter, "desc", id=f"{'+'.join(db_filter) or 'none'}-desc") for db_filter in filters),
        # The whole `asc` pin: both sort builders derive a single `direction`, so a tie-break pinned
        # against `order` breaks every `asc` read alike and one case catches it.
        pytest.param({}, "asc", id="none-asc"),
    ]


def winning_stages(explained: Mapping[str, Any]) -> list[str]:
    """The winning plan's stages, outermost first. A blocking sort shows up here as `SORT`."""

    node: Any = explained["queryPlanner"]["winningPlan"]
    stages: list[str] = []
    while node:
        stages.append(node["stage"])
        node = node.get("inputStage")

    return stages


def test_every_declared_support_index_is_built(mongo_url: str):
    """`apply_constraints` creates each one. Only the unique indexes were checked before, so a typo here built nothing."""

    async def body(database: AsyncDatabase) -> int:
        for index in SUPPORT_INDEXES:
            names = [existing["name"] async for existing in await database[index.collection].list_indexes()]
            assert index.name in names, f"{index.name} missing from {index.collection}: {names}"
        return len(SUPPORT_INDEXES)

    assert on_the_shipped_schema(mongo_url, body) == len(SUPPORT_INDEXES)


@pytest.mark.parametrize(("db_filter", "order"), index_reads(BEWERBUNGEN_QUEUE_FILTERS))
def test_the_triage_queue_walks_an_index_whichever_way_it_is_read(mongo_url: str, db_filter: dict[str, Any], order: str):
    """The property, not the key list: naming keys passes for an index this endpoint's own sort cannot use.

    The sort comes from `build_bewerbungen_sort`, so a change there is judged rather than mirrored.
    """

    async def body(database: AsyncDatabase) -> list[str]:
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
        explained = (
            await database["bewerbungen"]
            .find(db_filter)
            .sort(build_bewerbungen_sort(sort_by="eingereicht_am", order=order))
            .limit(50)
            .explain()
        )
        return winning_stages(explained)

    stages = on_the_shipped_schema(mongo_url, body)

    assert "IXSCAN" in stages, f"{order} on {db_filter or 'no filter'} reached no index: {stages}"
    assert "SORT" not in stages, f"{order} on {db_filter or 'no filter'} blocks on an in-memory sort: {stages}"
    assert "COLLSCAN" not in stages, f"{order} on {db_filter or 'no filter'} scans the archive: {stages}"


@pytest.mark.parametrize(("db_filter", "order"), index_reads(AKTIONEN_QUEUE_FILTERS))
def test_the_action_log_walks_an_index_whichever_way_it_is_read(mongo_url: str, db_filter: dict[str, Any], order: str):
    """The log is the one collection that only ever grows, so a scan here worsens for as long as the site runs.

    `correlation_id` is left out: it selects one write's fan-out, which the planner sorts in memory
    over a handful of rows.
    """

    async def body(database: AsyncDatabase) -> list[str]:
        await database["aktionen"].insert_many(
            [
                valid_documents()["aktionen"]
                | {
                    "_id": ObjectId(),
                    "at": f"2026-03-{(row % 28) + 1:02d}T09:30:00+00:00",
                    "correlation_id": secrets.token_hex(16),
                    "collection": "teams" if row % 2 else "spiele",
                    "operation": "patch_one" if row % 3 else "insert",
                }
                for row in range(ROWS_ENOUGH_TO_PREFER_AN_INDEX)
            ]
        )
        explained = await database["aktionen"].find(db_filter).sort(build_aktionen_sort(order=order)).limit(50).explain()
        return winning_stages(explained)

    stages = on_the_shipped_schema(mongo_url, body)

    assert "IXSCAN" in stages, f"{order} on {db_filter or 'no filter'} reached no index: {stages}"
    assert "SORT" not in stages, f"{order} on {db_filter or 'no filter'} blocks on an in-memory sort: {stages}"
    assert "COLLSCAN" not in stages, f"{order} on {db_filter or 'no filter'} scans the whole log: {stages}"
