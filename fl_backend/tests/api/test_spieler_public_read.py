from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, Iterator, Mapping
from typing import Any, NamedTuple

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.public_router import get_team
from app.api.saisons.schemas import FLTeamPageResponse
from app.api.spieler.public_router import get_spieler_by_id
from app.api.spieler.schemas import (
    FLSpielerPublic,
)
from app.api.spieler.services import build_spieler_pipeline, public_initial
from app.core.crud import aggregate_many_from_db
from tests.database import a_clean_database, on_the_seed_loop, shared_client
from tests.documents import (
    SPIELER_TEXT_VERSIONS,
    own_einwilligung_document,
    saison_document,
    saison_spieler_document,
    saison_team_document,
    spieler_document,
    team_document,
)
from tests.worker import worker_database

from .conftest import unwritten

DATABASE_NAME = worker_database("fl_spieler_public_read_test")

SAISON = "2026"
TEAM_OID = ObjectId("6890a1b2c3d4e5f607390001")

# What the base tier serves, and the whole of it.
PUBLIC_FIELDS = {"first_name", "last_name", "nummer", "position", "rolle"}

# The club whose page serves the squad, in every corpus below: the page answers 404 for a club the
# season does not hold, so each corpus enters it in each season it reads.
TEAM_NAME, TEAM_SHORTHAND = "Helmholtz", "HGX"

# The one person whose squad row is retired, searched for as an absence.
RETIRED_ROW_FIRST_NAME = "Nils"

SPIELER_OIDS = {
    "Mueller": ObjectId("6890a1b2c3d4e5f607390011"),
    "Adler": ObjectId("6890a1b2c3d4e5f607390012"),
    # No surname at all: absent is not the same fact as withheld, and must not read as an initial.
    "Ohne": ObjectId("6890a1b2c3d4e5f607390013"),
    # A surname whose first letter is two bytes.
    "Oeztuerk": ObjectId("6890a1b2c3d4e5f607390014"),
    "Weber": ObjectId("6890a1b2c3d4e5f607390015"),
    # A retired squad row, the one match pinned by a row it really removes.
    "Kraus": ObjectId("6890a1b2c3d4e5f607390016"),
}

STORED_SURNAMES = ("Müller", "Adler", "Öztürk", "Weber")

Body = Callable[[AsyncDatabase], Awaitable[Any]]


def _consent(scope: str, **fields: Any) -> dict[str, Any]:
    """A record its person confirmed under `scope`, `fields` laid over it."""

    return {**own_einwilligung_document(text_versions=SPIELER_TEXT_VERSIONS, confirmed_at="2026-01-20", scope=scope), **fields}


def _spieler(key: str, first_name: str, last_name: str | None) -> dict[str, Any]:
    """A person as their admission writes them -- consent record included, which is the point of the corpus.

    A confirmed, published record passed rather than defaulted: the initials this corpus serves are the mask's published arm.
    """

    return spieler_document(SPIELER_OIDS[key], first_name, last_name, einwilligung=_consent("kader_public"))


def _squad_row(
    key: str,
    *,
    nummer: str | None,
    position: str | None,
    stufe: str | None,
    rolle: str | None = None,
    inactive_since: str | None = None,
) -> dict[str, Any]:
    return saison_spieler_document(
        SPIELER_OIDS[key], SAISON, TEAM_OID, nummer=nummer, position=position, stufe=stufe, rolle=rolle, inactive_since=inactive_since
    )


def _club(*saison_ids: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """The club's document and its junction row in each season named."""

    return team_document(TEAM_OID, TEAM_NAME, TEAM_SHORTHAND), [
        saison_team_document(saison_id, TEAM_OID, TEAM_NAME, TEAM_SHORTHAND) for saison_id in saison_ids
    ]


async def _enter_the_club(database: AsyncDatabase, *saison_ids: str) -> None:
    club, rows = _club(*saison_ids)
    await database.teams.insert_one(club)
    await database.saison_teams.insert_many(rows)


async def club_page(database: AsyncDatabase, saison_id: str = SAISON) -> FLTeamPageResponse:
    """The club's page in one season, whose squad is the one base-tier read of a squad."""

    return await get_team(
        saison_id=saison_id,
        team_id=TEAM_OID,
        saisons_collection=database.saisons,
        teams_collection=database.teams,
        spiele_collection=database.spiele,
        saison_spieler_collection=database.saison_spieler,
    )


def _pipeline() -> list[Mapping[str, Any]]:
    """One team's squad in one season -- the narrowing every case below shares."""

    return build_spieler_pipeline(team_id=TEAM_OID, saison_id=SAISON)


def _sort() -> dict[str, int]:
    return next(stage["$sort"] for stage in _pipeline() if "$sort" in stage)


class TestTheBaseTierShape:
    def test_it_serves_exactly_the_public_fields(self):
        assert set(FLSpielerPublic.model_fields) == PUBLIC_FIELDS

    def test_the_club_page_serves_the_public_shape(self):
        assert FLTeamPageResponse.model_fields["kader"].annotation == list[FLSpielerPublic]

    def test_the_read_model_accepts_the_initial_it_is_served(self):
        """The backend keeps `PERSON_NAME_PATTERN` off read models, and a trailing dot is what that pattern refuses."""
        served = FLSpielerPublic.model_validate(
            {"_id": SPIELER_OIDS["Mueller"], "first_name": "Max", "last_name": "M.", "nummer": "7", "position": "Angriff"}
        )

        assert served.last_name == "M."


class TestTheProjection:
    def test_the_public_sort_does_not_tiebreak_on_the_surname(self):
        """A tie-break is the last place an ordering could still depend on a field the response withholds."""
        assert "last_name" not in _sort()
        assert "first_name" in _sort()


class TestTheInitial:
    @pytest.mark.parametrize(
        ("stored", "served"),
        [("Müller", "M."), ("Öztürk", "Ö."), ("Adler", "A."), ("de Vries", "d."), (None, None)],
    )
    def test_the_find_path_serves_an_initial_with_its_dot(self, stored: str | None, served: str | None):
        """The dot rides with the initial so the one page rendering it joins the two names unchanged."""
        assert public_initial(stored) == served


@pytest.mark.db
class TestTheBaseTierReadExecuted:
    """The whole chain against a real mongod: what is STORED, what the pipeline yields, and what the club page serialises."""

    def _read(self, url: str) -> dict[str, Any]:
        """The page's own answer, dumped as the wire carries it -- the only shape that can show nothing leaked."""

        async def body(database: AsyncDatabase) -> Any:
            return (await club_page(database)).model_dump(mode="json", by_alias=True)

        return on_a_database(url, body)

    def _by_first_name(self, url: str) -> dict[str, dict[str, Any]]:
        return {row["first_name"]: row for row in self._read(url)["kader"]}

    def _rows(self, url: str) -> list[Mapping[str, Any]]:
        """What mongod yields for the pipeline, one step BEFORE `FLSpielerPublic`, which declares five fields and drops the rest either way."""

        async def body(database: AsyncDatabase) -> Any:
            return await aggregate_many_from_db(collection=database.saison_spieler, pipeline=_pipeline())

        return on_a_database(url, body)

    def test_a_retired_squad_row_stays_out(self, seeded_url: str):
        """`READ-SQUAD-001`: the retirement this read filters on."""
        assert RETIRED_ROW_FIRST_NAME not in self._by_first_name(seeded_url)

    def test_a_stored_surname_is_served_as_an_initial(self, seeded_url: str):
        assert self._by_first_name(seeded_url)["Maxim"]["last_name"] == "M."

    @pytest.mark.parametrize("surname", STORED_SURNAMES)
    def test_no_stored_surname_appears_anywhere_in_the_response(self, seeded_url: str, surname: str):
        """Against the SERIALISED body rather than one field: what the page ships is the whole payload, not the part it renders."""
        assert surname not in json.dumps(self._read(seeded_url), ensure_ascii=False)

    def test_a_surname_starting_with_a_multibyte_letter_is_not_halved(self, seeded_url: str):
        """`$substrBytes` would cut an `Ö` in two, and only a real mongod tells the two operators apart."""
        assert self._by_first_name(seeded_url)["Timo"]["last_name"] == "Ö."

    def test_a_player_with_no_surname_reads_back_with_none(self, seeded_url: str):
        """Absent is not withheld: an initial invented here would read as a name nobody holds."""
        assert self._by_first_name(seeded_url)["Lena"]["last_name"] is None

    def test_a_withheld_field_reaches_no_row_the_pipeline_yields(self, seeded_url: str):
        """The allow-list `$project` builds, as mongod resolves it. A key added there is a leak the response shape hides."""
        rows = self._rows(seeded_url)

        # `all` over an empty list passes, and a join that stopped matching would empty it.
        assert len(rows) == 5
        assert all(set(row) <= PUBLIC_FIELDS for row in rows)

    def _read_one(self, url: str, key: str) -> dict[str, Any]:
        async def body(database: AsyncDatabase) -> Any:
            response = await get_spieler_by_id(spieler_id=SPIELER_OIDS[key], spieler_collection=database.spieler)

            return response.model_dump(mode="json", by_alias=True)

        return on_a_database(url, body)

    def test_the_one_player_read_serves_its_allow_list_alone(self, seeded_url: str):
        assert self._read_one(seeded_url, "Weber") == {
            "spieler_id": str(SPIELER_OIDS["Weber"]),
            "first_name": "Jonas",
            "last_name": "W.",
        }


# Module-scoped: every case below reads this corpus and none writes it, which `unwritten` keeps
# from being left as a claim.
@pytest.fixture(scope="module")
def seeded_url(mongo_url: str) -> Iterator[str]:
    """Six people and their squad rows.

    A retired row, a surname whose initial is two bytes, and a person carrying no surname at all.
    """

    async def _seed() -> None:
        async with a_clean_database(mongo_url, DATABASE_NAME) as (_, database):
            await database.saisons.insert_one(saison_document(SAISON, "active"))
            await _enter_the_club(database, SAISON)
            await database.spieler.insert_many(
                [
                    # Distinct forenames, none of them holding a surname as a substring: the rows
                    # are keyed by forename below, and one case greps the whole payload for a leak.
                    _spieler("Mueller", "Maxim", "Müller"),
                    _spieler("Adler", "Marek", "Adler"),
                    _spieler("Ohne", "Lena", None),
                    _spieler("Oeztuerk", "Timo", "Öztürk"),
                    _spieler("Weber", "Jonas", "Weber"),
                    _spieler("Kraus", RETIRED_ROW_FIRST_NAME, "Kraus"),
                ]
            )
            await database.saison_spieler.insert_many(
                [
                    _squad_row("Mueller", nummer="7", position="Angriff", stufe="Q3", rolle="kapitaen"),
                    _squad_row("Adler", nummer="3", position="Abwehr", stufe="E1"),
                    _squad_row("Ohne", nummer=None, position=None, stufe=None),
                    _squad_row("Oeztuerk", nummer="5", position="Mittelfeld", stufe="Q1"),
                    _squad_row("Weber", nummer="1", position="Tor", stufe="Q2"),
                    _squad_row("Kraus", nummer="12", position="Angriff", stufe="Q4", inactive_since="2026-03-01"),
                ]
            )

    on_the_seed_loop(_seed())

    with unwritten(mongo_url, DATABASE_NAME):
        yield mongo_url


SQUAD_DATABASE_NAME = worker_database("fl_spieler_squad_season_test")
PAST_SAISON = "2025"
SQUAD_OIDS = {"Beide": ObjectId("6890a1b2c3d4e5f607390021"), "Ehemalig": ObjectId("6890a1b2c3d4e5f607390022")}


@pytest.mark.db
class TestTheClubPageReadsOneSeasonsSquad:
    """The club page in the running season, against a club that played two seasons."""

    def _first_names(self, url: str, saison_id: str) -> list[str]:
        async def body(database: AsyncDatabase) -> Any:
            return [row.first_name for row in (await club_page(database, saison_id)).kader]

        return on_the_seed_loop(body(shared_client(url)[SQUAD_DATABASE_NAME]))

    def test_a_player_of_both_seasons_is_listed_once_and_one_of_the_past_season_alone_not_at_all(self, squad_url: str):
        assert self._first_names(squad_url, SAISON) == ["Paula"]


@pytest.fixture(scope="module")
def squad_url(mongo_url: str) -> Iterator[str]:
    """Two seasons of one club: a player in both, and one who played the past season alone."""

    async def _seed() -> None:
        async with a_clean_database(mongo_url, SQUAD_DATABASE_NAME, constraints=False) as (_, database):
            await database.saisons.insert_many([saison_document(SAISON, "active"), saison_document(PAST_SAISON, "past")])
            await _enter_the_club(database, SAISON, PAST_SAISON)
            await database.spieler.insert_many(
                [
                    {**_spieler("Mueller", "Paula", "Beispiel"), "_id": SQUAD_OIDS["Beide"]},
                    {**_spieler("Mueller", "Theo", "Beispiel"), "_id": SQUAD_OIDS["Ehemalig"]},
                ]
            )
            await database.saison_spieler.insert_many(
                [
                    {**_squad_row("Mueller", nummer="7", position="Angriff", stufe="Q3"), "spieler_id": SQUAD_OIDS["Beide"]},
                    {
                        **_squad_row("Mueller", nummer="7", position="Angriff", stufe="Q2"),
                        "spieler_id": SQUAD_OIDS["Beide"],
                        "saison_id": PAST_SAISON,
                    },
                    {
                        **_squad_row("Mueller", nummer="9", position="Abwehr", stufe="Q4"),
                        "spieler_id": SQUAD_OIDS["Ehemalig"],
                        "saison_id": PAST_SAISON,
                    },
                ]
            )

    on_the_seed_loop(_seed())

    with unwritten(mongo_url, SQUAD_DATABASE_NAME):
        yield mongo_url


MASK_DATABASE_NAME = worker_database("fl_spieler_mask_read_test")


class MaskedRow(NamedTuple):
    """One seeded person, their consent record, and the two names the base tier must answer for them."""

    oid: ObjectId
    first_name: str
    last_name: str
    einwilligung: dict[str, Any]
    served_first_name: str | None
    served_last_name: str | None


# Each served pair is written out rather than composed from `public_initial`, which would compare the
# redaction with itself. No forename holds a surname as a substring: one case greps the whole payload.
MASKED_SQUAD = {
    "Offen": MaskedRow(ObjectId("6890a1b2c3d4e5f607390031"), "Alina", "Falk", _consent("kader_public"), "Alina", "F."),
    "Internal": MaskedRow(ObjectId("6890a1b2c3d4e5f607390032"), "Bruno", "Gerber", _consent("internal"), None, None),
}

# A shirt per row, which is how a case below finds its row: the read serves no record id to find one by.
MASK_NUMMERN = {case: str(place) for place, case in enumerate(MASKED_SQUAD, start=1)}

# Both rows hold a captaincy, and the read serves the one beside a published name alone.
MASK_ROLLEN = {"Offen": "kapitaen", "Internal": "co_kapitaen"}

# Both names of both withheld rows: a payload grep on the surnames alone leaves the forename, which
# is the half `READ-PUPIL-001` never withheld and `READ-PUPIL-003` is the first rule to reach.
WITHHELD_NAMES = ("Bruno", "Gerber")


@pytest.mark.db
class TestThePublicationGate:
    """`READ-PUPIL-003` over both base-tier reads, against a squad holding one row per state the predicate decides between."""

    def _read(self, url: str) -> dict[str, Any]:
        async def body(database: AsyncDatabase) -> Any:
            return (await club_page(database)).model_dump(mode="json", by_alias=True)

        return _on_the_mask_database(url, body)

    def _by_nummer(self, url: str) -> dict[str, dict[str, Any]]:
        return {row["nummer"]: row for row in self._read(url)["kader"]}

    @pytest.mark.parametrize("case", MASKED_SQUAD)
    def test_the_squad_serves_each_name_as_the_record_allows(self, masked_url: str, case: str):
        row = MASKED_SQUAD[case]
        served = self._by_nummer(masked_url)[MASK_NUMMERN[case]]

        assert (served["first_name"], served["last_name"]) == (row.served_first_name, row.served_last_name)

    def test_a_captaincy_is_served_beside_a_published_name_alone(self, masked_url: str):
        """A squad holds one of each, so the mark beside a nameless row would say who that row is."""
        served = self._by_nummer(masked_url)

        assert [served[MASK_NUMMERN[case]]["rolle"] for case in MASKED_SQUAD] == ["kapitaen", None]

    @pytest.mark.parametrize("name", WITHHELD_NAMES)
    def test_no_withheld_name_appears_anywhere_in_the_response(self, masked_url: str, name: str):
        """Against the SERIALISED body: what the page ships is the whole payload, not the part it renders."""
        assert name not in json.dumps(self._read(masked_url), ensure_ascii=False)

    @pytest.mark.parametrize("case", MASKED_SQUAD)
    def test_no_pupil_s_record_id_appears_anywhere_in_the_response(self, masked_url: str, case: str):
        """`READ-PUPIL-005`, against the SERIALISED body: an id outlives every season and team, so it would tie a withheld row to its others."""
        assert str(MASKED_SQUAD[case].oid) not in json.dumps(self._read(masked_url))

    @pytest.mark.parametrize("key", ["einwilligung", "scope"])
    def test_no_row_carries_the_record_the_gate_read(self, masked_url: str, key: str):
        """The `$cond` reads it; a key of either name on the wire would put the consent decision itself on the page."""
        assert all(key not in served for served in self._by_nummer(masked_url).values())

    def _read_one(self, url: str, case: str) -> dict[str, Any]:
        async def body(database: AsyncDatabase) -> Any:
            response = await get_spieler_by_id(spieler_id=MASKED_SQUAD[case].oid, spieler_collection=database.spieler)

            return response.model_dump(mode="json", by_alias=True)

        return _on_the_mask_database(url, body)

    @pytest.mark.parametrize("case", MASKED_SQUAD)
    def test_the_single_read_answers_the_same_two_names(self, masked_url: str, case: str):
        """The second base-tier path: one predicate, so a `find` and an aggregation cannot disagree about one person."""
        row = MASKED_SQUAD[case]

        assert self._read_one(masked_url, case) == {
            "spieler_id": str(row.oid),
            "first_name": row.served_first_name,
            "last_name": row.served_last_name,
        }


@pytest.fixture(scope="module")
def masked_url(mongo_url: str) -> Iterator[str]:
    """One squad in one season, holding a row for every consent state `READ-PUPIL-003` parts."""

    async def _seed() -> None:
        async with a_clean_database(mongo_url, MASK_DATABASE_NAME) as (_, database):
            await database.saisons.insert_one(saison_document(SAISON, "active"))
            await _enter_the_club(database, SAISON)
            await database.spieler.insert_many(
                [spieler_document(row.oid, row.first_name, row.last_name, einwilligung=row.einwilligung) for row in MASKED_SQUAD.values()]
            )
            await database.saison_spieler.insert_many(
                [
                    {
                        **_squad_row("Mueller", nummer=MASK_NUMMERN[case], position="Angriff", stufe="Q3", rolle=MASK_ROLLEN[case]),
                        "spieler_id": row.oid,
                    }
                    for case, row in MASKED_SQUAD.items()
                ]
            )

    on_the_seed_loop(_seed())

    with unwritten(mongo_url, MASK_DATABASE_NAME):
        yield mongo_url


SORT_ORACLE_DATABASE_NAMES = {
    "first": worker_database("fl_spieler_sort_oracle_first_test"),
    "last": worker_database("fl_spieler_sort_oracle_last_test"),
}

# The one value the two corpora differ in, chosen to sort either side of both published forenames:
# an order reading the stored name puts the withheld row at a different index in each.
WITHHELD_FORENAMES = {"first": "Ada", "last": "Zita"}

SORT_ORACLE_OIDS = {
    "Zurueckgehalten": ObjectId("6890a1b2c3d4e5f607390041"),
    "Berger": ObjectId("6890a1b2c3d4e5f607390042"),
    "Yilmaz": ObjectId("6890a1b2c3d4e5f607390043"),
}

# Equal across the three rows, so the club page's order, position first, falls through to the
# chain's `first_name`.
SORT_ORACLE_NUMMER = "7"
SORT_ORACLE_POSITION = "Angriff"


@pytest.mark.db
class TestTheOrderIsNoOracleForAWithheldName:
    """One squad seeded twice, differing only in the withheld row's stored forename: its place in the answer may not move with it."""

    def _served_names(self, url: str, corpus: str) -> list[str | None]:
        """Each row's served forename, in the club page's order: `None` is the withheld row, the corpus holding one."""

        async def body(database: AsyncDatabase) -> Any:
            return [row.first_name for row in (await club_page(database)).kader]

        return on_the_seed_loop(body(shared_client(url)[SORT_ORACLE_DATABASE_NAMES[corpus]]))

    def test_the_withheld_row_holds_one_place_whatever_forename_it_stores(self, sort_oracle_url: str):
        places = {corpus: self._served_names(sort_oracle_url, corpus).index(None) for corpus in WITHHELD_FORENAMES}

        assert places["first"] == places["last"]


@pytest.fixture(scope="module")
def sort_oracle_url(mongo_url: str) -> Iterator[str]:
    """Two corpora, each one squad of three: two published rows and one the `internal` scope withholds."""

    async def _seed() -> None:
        for corpus, withheld_forename in WITHHELD_FORENAMES.items():
            async with a_clean_database(mongo_url, SORT_ORACLE_DATABASE_NAMES[corpus], constraints=False) as (_, database):
                await database.saisons.insert_one(saison_document(SAISON, "active"))
                await _enter_the_club(database, SAISON)
                await database.spieler.insert_many(
                    [
                        spieler_document(SORT_ORACLE_OIDS["Zurueckgehalten"], withheld_forename, "Kessler", einwilligung=_consent("internal")),
                        spieler_document(SORT_ORACLE_OIDS["Berger"], "Bea", "Berger", einwilligung=_consent("kader_public")),
                        spieler_document(SORT_ORACLE_OIDS["Yilmaz"], "Yara", "Yilmaz", einwilligung=_consent("kader_public")),
                    ]
                )
                await database.saison_spieler.insert_many(
                    [
                        {
                            **_squad_row("Mueller", nummer=SORT_ORACLE_NUMMER, position=SORT_ORACLE_POSITION, stufe="Q3"),
                            "spieler_id": oid,
                        }
                        for oid in SORT_ORACLE_OIDS.values()
                    ]
                )

    on_the_seed_loop(_seed())

    with unwritten(mongo_url, SORT_ORACLE_DATABASE_NAMES["first"]), unwritten(mongo_url, SORT_ORACLE_DATABASE_NAMES["last"]):
        yield mongo_url


def _on_the_mask_database(url: str, body: Body) -> Any:
    async def _run() -> Any:
        return await body(shared_client(url)[MASK_DATABASE_NAME])

    return on_the_seed_loop(_run())


def on_a_database(url: str, body: Body) -> Any:
    async def _run() -> Any:
        return await body(shared_client(url)[DATABASE_NAME])

    return on_the_seed_loop(_run())
