"""SPIELER · the consent table every spelling of `READ-PUPIL-003` and `READ-REFEREE-004` is joined against

Hand-written rather than derived from either spelling: a table taken from one would compare that
spelling with itself. One sheet rather than a table and two homes, so a spelling with no case
beneath it reads as a case that is missing.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from typing import Any, Final, NamedTuple

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.spiele.services import build_spiele_pipeline
from app.api.spieler.schemas import FLSpielerFilterParams
from app.api.spieler.services import build_spieler_pipeline, name_is_public
from app.core.crud import aggregate_many_from_db
from tests.database import a_clean_database, on_the_seed_loop, shared_client
from tests.documents import saison_spieler_document, schiedsrichter_document, spiel_document, spieler_document
from tests.worker import worker_database

from .conftest import unwritten

DATABASE_NAME = worker_database("fl_name_is_public_mirror_test")

SAISON = "2026"
TEAM_OID = ObjectId("6890a1b2c3d4e5f607410001")

CONFIRMED = "2026-01-20"

# One pair of names for every row: what a case here decides is whether the pair is served at all,
# and distinct names would only make two failures look different.
VORNAME = "Maxim"
NACHNAME = "Müller"
INITIAL = "M."

# Outside `FLEinwilligung`'s Literal, and stored anyway: the predicate is read against documents, so
# a scope no enum holds is a state it has to answer rather than one it may assume away.
UNKNOWN_UMFANG = "kader"

# A key the document does not carry, which is what `$type` answering "missing" is: the two keys were
# added to `_EINWILLIGUNG` out of `required`, so a stored record really can be short of either.
ABSENT: Final = "<no such key>"


class ConsentCase(NamedTuple):
    """One stored state a public read meets, and whether the person's name is published there."""

    case: str
    einwilligung: Mapping[str, Any] | None
    published: bool


def _record(umfang: Any, bestaetigt_am: Any) -> dict[str, Any]:
    record = {"umfang": umfang, "datum": "2026-01-15", "bestaetigt_am": bestaetigt_am}

    return {key: value for key, value in record.items() if value is not ABSENT}


# The three inputs `READ-PUPIL-003` names, closed over: the record's presence, its `umfang`, and
# whether `bestaetigt_am` is stamped -- each key's own absence among its states.
NAME_IS_PUBLIC: Final[tuple[ConsentCase, ...]] = (
    ConsentCase("no record at all", None, False),
    ConsentCase("public, confirmed", _record("kader_oeffentlich", CONFIRMED), True),
    ConsentCase("public, unconfirmed", _record("kader_oeffentlich", None), False),
    ConsentCase("public, no stamp key", _record("kader_oeffentlich", ABSENT), False),
    ConsentCase("internal, confirmed", _record("intern", CONFIRMED), False),
    ConsentCase("internal, unconfirmed", _record("intern", None), False),
    ConsentCase("internal, no stamp key", _record("intern", ABSENT), False),
    ConsentCase("an unknown scope, confirmed", _record(UNKNOWN_UMFANG, CONFIRMED), False),
    ConsentCase("an unknown scope, unconfirmed", _record(UNKNOWN_UMFANG, None), False),
    ConsentCase("an unknown scope, no stamp key", _record(UNKNOWN_UMFANG, ABSENT), False),
    ConsentCase("no scope key, confirmed", _record(ABSENT, CONFIRMED), False),
    ConsentCase("no scope key, unconfirmed", _record(ABSENT, None), False),
    ConsentCase("no scope key, no stamp key", _record(ABSENT, ABSENT), False),
)

CASE_IDS = [case.case for case in NAME_IS_PUBLIC]


def _inputs(case: ConsentCase) -> tuple[Any, Any]:
    """The two keys the rule reads, in the state this row stores them, and a pair of `None` where there is no record."""

    if case.einwilligung is None:
        return None, None

    return case.einwilligung.get("umfang", ABSENT), case.einwilligung.get("bestaetigt_am", ABSENT)


def test_the_table_closes_over_every_input_and_both_verdicts():
    """The floor: every case below joins this table, so a table of one row would pass all of them."""

    spanned = {_inputs(case) for case in NAME_IS_PUBLIC}

    assert spanned == {(None, None)} | {
        (umfang, stamp) for umfang in ("kader_oeffentlich", "intern", UNKNOWN_UMFANG, ABSENT) for stamp in (CONFIRMED, None, ABSENT)
    }
    assert {case.published for case in NAME_IS_PUBLIC} == {True, False}


@pytest.mark.parametrize("case", NAME_IS_PUBLIC, ids=CASE_IDS)
def test_the_python_predicate_answers_the_table(case: ConsentCase):
    assert name_is_public(case.einwilligung) is case.published


def _oid(position: int) -> ObjectId:
    return ObjectId(f"6890a1b2c3d4e5f6074100{position:02d}")


def _oid_for(case: ConsentCase) -> ObjectId:
    return _oid(NAME_IS_PUBLIC.index(case) + 10)


def _nummer_for(case: ConsentCase) -> str:
    """The row's shirt, which is how the squad read's answer is told apart: it carries no record id (`READ-PUPIL-005`)."""

    return str(NAME_IS_PUBLIC.index(case) + 1)


@pytest.mark.db
class TestTheSquadPipelineAnswersTheSameTable:
    """`build_spieler_pipeline`'s `$cond`, against a real mongod: a `$cond` is only a `$cond` where Mongo evaluates it."""

    def _served(self, url: str) -> dict[str, Mapping[str, Any]]:
        async def body(database: AsyncDatabase) -> Any:
            rows = await aggregate_many_from_db(
                collection=database.spieler,
                pipeline=build_spieler_pipeline(FLSpielerFilterParams(team_id=TEAM_OID, saison_id=SAISON)),
            )

            return {row["nummer"]: row for row in rows}

        return on_the_seed_loop(body(shared_client(url)[DATABASE_NAME]))

    def test_the_corpus_stores_a_name_and_the_case_s_own_record_for_every_row(self, seeded_url: str):
        """First: every assertion below would pass just as well against a corpus storing no name to withhold."""

        async def body(database: AsyncDatabase) -> Any:
            return {person["_id"]: person for person in await database.spieler.find({}).to_list(None)}

        stored = on_the_seed_loop(body(shared_client(seeded_url)[DATABASE_NAME]))

        assert len(stored) == len(NAME_IS_PUBLIC)
        for case in NAME_IS_PUBLIC:
            person = stored[_oid_for(case)]
            assert (person["vorname"], person["nachname"]) == (VORNAME, NACHNAME)
            assert person["einwilligung"] == case.einwilligung

    @pytest.mark.parametrize("case", NAME_IS_PUBLIC, ids=CASE_IDS)
    def test_the_projection_answers_the_table(self, seeded_url: str, case: ConsentCase):
        served = self._served(seeded_url)[_nummer_for(case)]

        assert (served["vorname"], served["nachname"]) == ((VORNAME, INITIAL) if case.published else (None, None))

    @pytest.mark.parametrize("case", NAME_IS_PUBLIC, ids=CASE_IDS)
    def test_a_withheld_row_keeps_its_number_and_its_position(self, seeded_url: str, case: ConsentCase):
        """The mask reaches the two name fields, so the slot itself stands whichever way the table answers.

        The row is found by its shirt, so a number the mask took would leave this case finding none.
        """

        served = self._served(seeded_url)[_nummer_for(case)]

        assert served["position"] == "Angriff"


@pytest.mark.db
class TestTheRefereeJoinAnswersTheSameTable:
    """`build_spiele_pipeline`'s referee join imports the expression, and Mongo evaluates it over a referee's record."""

    def _verdicts(self, url: str) -> dict[ObjectId, Any]:
        async def body(database: AsyncDatabase) -> Any:
            fixtures = await aggregate_many_from_db(collection=database.spiele, pipeline=build_spiele_pipeline(db_filter={"saison_id": SAISON}))

            return {fixture["schiedsrichter"]["schiedsrichter_id"]: fixture["schiedsrichter"]["name_is_public"] for fixture in fixtures}

        return on_the_seed_loop(body(shared_client(url)[DATABASE_NAME]))

    def test_every_row_of_the_table_is_booked_on_a_fixture(self, seeded_url: str):
        """First: a join reaching no referee answers withheld everywhere, which every unpublished row below would pass."""

        assert set(self._verdicts(seeded_url)) == {_referee_oid_for(case) for case in NAME_IS_PUBLIC}

    @pytest.mark.parametrize("case", NAME_IS_PUBLIC, ids=CASE_IDS)
    def test_the_join_answers_the_table(self, seeded_url: str, case: ConsentCase):
        assert self._verdicts(seeded_url)[_referee_oid_for(case)] is case.published


def _referee_oid_for(case: ConsentCase) -> ObjectId:
    return _oid(NAME_IS_PUBLIC.index(case) + 40)


def _fixture_oid_for(case: ConsentCase) -> ObjectId:
    return _oid(NAME_IS_PUBLIC.index(case) + 70)


@pytest.fixture(scope="module")
def seeded_url(mongo_url: str) -> Iterator[str]:
    """One person per row of the table, each holding a name and a live squad row in one team's season; one referee per row, booked."""

    async def _seed() -> None:
        # UNCONSTRAINED: the `spieler` validator holds `umfang` to its enum, requires it, and
        # refuses a null record, so the states the predicate exists to answer are ones it refuses.
        async with a_clean_database(mongo_url, DATABASE_NAME, constraints=False) as (_, database):
            await database.spieler.insert_many(
                [spieler_document(_oid_for(case), VORNAME, NACHNAME, einwilligung=case.einwilligung) for case in NAME_IS_PUBLIC]
            )
            await database.saison_spieler.insert_many(
                [
                    saison_spieler_document(_oid_for(case), SAISON, TEAM_OID, nummer=_nummer_for(case), position="Angriff", stufe="Q3")
                    for case in NAME_IS_PUBLIC
                ]
            )
            await database.schiedsrichter.insert_many(
                [
                    schiedsrichter_document(
                        _referee_oid_for(case), email="pfiff@example.com", name="Ada Kern", default_payment=20, einwilligung=case.einwilligung
                    )
                    for case in NAME_IS_PUBLIC
                ]
            )
            # No confirmation row on any fixture, so the acceptance gate serves every block and the consent verdict alone is read.
            await database.spiele.insert_many(
                [
                    spiel_document(
                        spiel_id=_fixture_oid_for(case),
                        saison_id=SAISON,
                        spiel_nr=NAME_IS_PUBLIC.index(case) + 1,
                        spieltag_id=_oid(99),
                        schiedsrichter={"schiedsrichter_id": _referee_oid_for(case), "name": "Ada Kern", "payment": 20},
                    )
                    for case in NAME_IS_PUBLIC
                ]
            )

    on_the_seed_loop(_seed())

    with unwritten(mongo_url, DATABASE_NAME):
        yield mongo_url
