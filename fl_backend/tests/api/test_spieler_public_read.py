from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, Iterator, Mapping
from typing import Any, NamedTuple

import pytest
from bson import ObjectId
from bson import encode as bson_encode
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.public_router import get_team
from app.api.saisons.schemas import FLTeamPageResponse
from app.api.spieler.admin_router import _as_single
from app.api.spieler.public_router import get_spieler_by_id
from app.api.spieler.schemas import (
    FLSaisonSpielerResponse,
    FLSpieler,
    FLSpielerAdminSingleResponse,
    FLSpielerMembership,
    FLSpielerPublic,
    FLSpielerSingleResponse,
)
from app.api.spieler.services import build_spieler_pipeline, build_spieler_saisons_pipeline, public_initial
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
PUBLIC_FIELDS = {"vorname", "nachname", "nummer", "position"}

# `stufe`, `einwilligung`, `email` and `id` are the confidentiality rules; the rest fails the allow-list,
# which asks what the surface renders rather than what looks sensitive. An unrendered field still ships.
WITHHELD_FIELDS = ["stufe", "einwilligung", "email", "id", "team_id", "is_nachnominiert", "rolle", "inactive_since"]

# The club whose page serves the squad, in every corpus below: the page answers 404 for a club the
# season does not hold, so each corpus enters it in each season it reads.
TEAM_NAME, TEAM_SHORTHAND = "Helmholtz", "HGX"

# The one person whose squad row is retired, searched for as an absence.
RETIRED_ROW_VORNAME = "Nils"

SPIELER_OIDS = {
    "Mueller": ObjectId("6890a1b2c3d4e5f607390011"),
    "Adler": ObjectId("6890a1b2c3d4e5f607390012"),
    # No surname at all: absent is not the same fact as withheld, and must not read as an initial.
    "Without": ObjectId("6890a1b2c3d4e5f607390013"),
    # A surname whose first letter is two bytes.
    "Oeztuerk": ObjectId("6890a1b2c3d4e5f607390014"),
    # The PERSON is retired and the squad row is live -- `READ-SQUAD-001`'s case.
    "Weber": ObjectId("6890a1b2c3d4e5f607390015"),
    # The other way round, so the one match that stays is pinned by a row it really removes.
    "Kraus": ObjectId("6890a1b2c3d4e5f607390016"),
}

STORED_SURNAMES = ("Müller", "Adler", "Öztürk", "Weber")

Body = Callable[[AsyncDatabase], Awaitable[Any]]


def _consent(umfang: str, **fields: Any) -> dict[str, Any]:
    """A record its person confirmed under `umfang`, `fields` laid over it."""

    return {**own_einwilligung_document(text_versions=SPIELER_TEXT_VERSIONS, confirmed_at="2026-01-20", umfang=umfang), **fields}


def _spieler(key: str, vorname: str, nachname: str | None, *, inactive_since: str | None = None) -> dict[str, Any]:
    """A person as `POST /spieler` writes them -- consent record included, which is the point of the corpus.

    A confirmed, published record passed rather than defaulted: the initials this corpus serves are the mask's published arm.
    """

    return spieler_document(SPIELER_OIDS[key], vorname, nachname, einwilligung=_consent("kader_oeffentlich"), inactive_since=inactive_since)


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


def _project() -> dict[str, Any]:
    return next(stage["$project"] for stage in _pipeline() if "$project" in stage)


def _sort() -> dict[str, int]:
    return next(stage["$sort"] for stage in _pipeline() if "$sort" in stage)


def _lookup_pipeline() -> list[Any]:
    return next(stage["$lookup"] for stage in _pipeline() if "$lookup" in stage)["pipeline"]


def _squad_match() -> dict[str, Any]:
    """The first stage, which narrows the squad rows before anything joins them."""

    return _pipeline()[0]["$match"]


class TestTheBaseTierShape:
    def test_it_serves_exactly_the_public_fields(self):
        assert set(FLSpielerPublic.model_fields) == PUBLIC_FIELDS

    @pytest.mark.parametrize("field", WITHHELD_FIELDS)
    def test_a_withheld_field_is_not_on_the_shape(self, field: str):
        """Absent from the MODEL, not merely unrendered: the page is a client component, so every field it receives sits in the page source."""
        assert field not in FLSpielerPublic.model_fields

    def test_the_club_page_serves_the_public_shape(self):
        assert FLTeamPageResponse.model_fields["kader"].annotation == list[FLSpielerPublic]

    @pytest.mark.parametrize("field", WITHHELD_FIELDS)
    def test_the_stored_shape_still_declares_what_the_tier_withholds(self, field: str):
        """Each rule is about one READ: the field stays stored and admin-visible, and `FLSpieler` still declares it."""
        assert field in FLSpieler.model_fields

    @pytest.mark.parametrize("field", ["stufe", "team_id", "is_nachnominiert", "rolle", "inactive_since"])
    def test_the_admin_membership_read_keeps_every_field(self, field: str):
        """`GET /spieler/saisons` is admin-tier: narrowing it would leave the squad editor unable to read back what it writes."""
        assert field in FLSpielerMembership.model_fields

    def test_the_squad_fields_default_where_the_join_supplies_neither(self):
        """An unnarrowed read joins loosely, and `$project` omits both keys rather than nulling them: required fields would 500 the list."""
        served = FLSpielerPublic.model_validate({"_id": SPIELER_OIDS["Kraus"], "vorname": "Nils", "nachname": "K."})

        assert (served.nummer, served.position) == (None, None)

    def test_the_read_model_accepts_the_initial_it_is_served(self):
        """The backend keeps `PERSON_NAME_PATTERN` off read models, and a trailing dot is what that pattern refuses."""
        served = FLSpielerPublic.model_validate(
            {"_id": SPIELER_OIDS["Mueller"], "vorname": "Max", "nachname": "M.", "nummer": "7", "position": "Angriff"}
        )

        assert served.nachname == "M."


class TestTheSinglePlayerShape:
    """`GET /spieler/{spieler_id}` is base-tier as well, and answers whatever id it is handed."""

    def test_it_serves_an_allow_list_of_what_the_surface_needs(self):
        """Derived from what a caller of THIS path needs, never the stored person less whatever looked sensitive."""
        assert set(FLSpielerSingleResponse.model_fields) == {"spieler_id", "vorname", "nachname"}

    def test_the_leaving_date_is_not_on_it(self):
        """Nothing public renders a pupil's leaving date, and a field no surface needs is a field no surface is given."""
        assert "inactive_since" not in FLSpielerSingleResponse.model_fields

    def test_the_admin_echo_keeps_the_leaving_date(self):
        """It IS the answer `DELETE` and `reactivate` give, so the echo would say nothing without it."""
        assert "inactive_since" in FLSpielerAdminSingleResponse.model_fields

    def test_the_admin_echo_is_the_public_shape_plus_the_editors_two_fields(self):
        """Extension rather than a second declaration: the two would otherwise drift on the three fields they share."""
        extra = set(FLSpielerAdminSingleResponse.model_fields) - set(FLSpielerSingleResponse.model_fields)

        assert extra == {"inactive_since", "version"}


# A body per echo rather than one shared: the two answer different writes and share no field but this one.
RETIREMENT_ECHOES = {
    "the person": (FLSpielerAdminSingleResponse, {"spieler_id": SPIELER_OIDS["Mueller"], "vorname": "Max", "nachname": "Mueller"}),
    "the squad row": (
        FLSaisonSpielerResponse,
        {
            "spieler_id": SPIELER_OIDS["Mueller"],
            "saison_id": SAISON,
            "team_id": TEAM_OID,
            "nummer": "7",
            "position": "Angriff",
            "stufe": "Q2",
            "is_nachnominiert": False,
            "rolle": None,
        },
    ),
}


class TestTheRetirementDateTheAdminEchoesCarry:
    """`fl_frontend/src/features/spieler/schemas.ts` refuses a day that does not exist, on seven mutations.

    An echo declaring no rule reports a retirement that landed as failed;
    `app/api/spieler/schemas.py` carries why stating the rule refuses nothing the API can serve.
    """

    @pytest.mark.parametrize("echo", RETIREMENT_ECHOES)
    @pytest.mark.parametrize("stamped", ["2026-03-01", None], ids=["retired", "live"])
    def test_it_takes_what_retire_and_reactivate_stamp(self, echo: str, stamped: str | None):
        model, body = RETIREMENT_ECHOES[echo]

        assert model.model_validate({**body, "inactive_since": stamped}).inactive_since == stamped

    @pytest.mark.parametrize("echo", RETIREMENT_ECHOES)
    @pytest.mark.parametrize("value", ["2026-02-31", "2026-3-1", "gestern"], ids=["no such day", "unpadded", "not a date"])
    def test_it_refuses_a_value_no_stamp_composes(self, echo: str, value: str, assert_rejects):
        model, body = RETIREMENT_ECHOES[echo]

        assert_rejects(model, {**body, "inactive_since": value}, "inactive_since")


class TestTheProjection:
    def test_it_emits_only_the_public_keys(self):
        """`_id` is named only to be dropped: `$project` keeps it unless told otherwise (`READ-PUPIL-005`)."""
        projected = _project()

        assert {key for key, value in projected.items() if value != 0} == {"vorname", "nachname", "nummer", "position"}
        assert projected["_id"] == 0

    def test_the_consent_record_is_read_and_projected_nowhere(self):
        """`READ-PUPIL-003` reads it inside the `$cond`, so the projection carrying no key of that name is the whole of the withholding."""
        assert "einwilligung" not in _project()
        assert "$einwilligung.umfang" in json.dumps(_lookup_pipeline())

    def test_the_level_is_gone_from_the_shape(self):
        """`READ-PUPIL-002`: the level stays stored and admin-visible, and this tier never projects it."""
        assert "stufe" not in _project()

    def test_the_backdated_flag_is_gone_from_the_shape(self):
        """The same sentence one field up: `is_nachnominiert` is withheld too."""
        assert "is_nachnominiert" not in _project()

    def test_the_sort_runs_after_the_mask_and_not_over_the_stored_names(self):
        """An order keyed on the stored forename answers, for a withheld row, what the projection withholds."""
        stages = [next(iter(stage)) for stage in _pipeline()]

        assert stages.index("$sort") > stages.index("$project")

    def test_the_public_sort_does_not_tiebreak_on_the_surname(self):
        """A tie-break is the last place an ordering could still depend on a field the response withholds."""
        assert "nachname" not in _sort()
        assert "vorname" in _sort()

    def test_only_the_admin_read_tiebreaks_on_the_surname(self):
        """The contrast is the assertion: the admin list orders people by full name and is entitled to."""
        assert build_spieler_saisons_pipeline()[-1]["$sort"] == {"vorname": 1, "nachname": 1}

    def test_the_squad_row_s_retirement_narrows_unconditionally(self):
        """With no switch: this tier serves no field marking a row it would un-hide (`READ-SQUAD-002`)."""
        assert _squad_match()["inactive_since"] is None


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

    def _by_vorname(self, url: str) -> dict[str, dict[str, Any]]:
        return {row["vorname"]: row for row in self._read(url)["kader"]}

    def _rows(self, url: str) -> list[Mapping[str, Any]]:
        """What mongod yields for the pipeline, one step BEFORE `FLSpielerPublic`, which declares five fields and drops the rest either way."""

        async def body(database: AsyncDatabase) -> Any:
            return await aggregate_many_from_db(collection=database.saison_spieler, pipeline=_pipeline())

        return on_a_database(url, body)

    def test_the_corpus_really_holds_what_the_response_must_not(self, seeded_url: str):
        """First, because every assertion below would pass just as well against a seed that stored neither."""

        async def body(database: AsyncDatabase) -> Any:
            person = await database.spieler.find_one({"_id": SPIELER_OIDS["Mueller"]})
            row = await database.saison_spieler.find_one({"spieler_id": SPIELER_OIDS["Mueller"]})

            return person, row

        person, row = on_a_database(seeded_url, body)

        assert person["nachname"] == "Müller"
        assert person["einwilligung"]["umfang"] == "kader_oeffentlich"
        assert (row["stufe"], row["rolle"]) == ("Q3", "kapitaen")

    def test_the_corpus_really_holds_a_retired_person_beside_a_retired_row(self, seeded_url: str):
        """The same guard for `READ-SQUAD-001`: both cases below pass against a corpus where nobody retired at all."""

        async def body(database: AsyncDatabase) -> Any:
            person = await database.spieler.find_one({"_id": SPIELER_OIDS["Weber"]})
            live_row = await database.saison_spieler.find_one({"spieler_id": SPIELER_OIDS["Weber"]})
            retired_row = await database.saison_spieler.find_one({"spieler_id": SPIELER_OIDS["Kraus"]})

            return person, live_row, retired_row

        person, live_row, retired_row = on_a_database(seeded_url, body)

        assert (person["inactive_since"], live_row["inactive_since"]) == ("2026-05-01", None)
        assert retired_row["inactive_since"] == "2026-03-01"

    def test_a_retired_person_keeps_the_squad_rows_they_played(self, seeded_url: str):
        """`READ-SQUAD-001`, which the admin sidemenu already promises: Stilllegen empties the pickers and leaves the Kadereintrag standing."""
        assert "Jonas" in self._by_vorname(seeded_url)

    def test_a_retired_squad_row_stays_out(self, seeded_url: str):
        """The retirement this read does filter on, so dropping the person's match cannot be mistaken for dropping both."""
        assert RETIRED_ROW_VORNAME not in self._by_vorname(seeded_url)

    def test_a_stored_surname_is_served_as_an_initial(self, seeded_url: str):
        assert self._by_vorname(seeded_url)["Maxim"]["nachname"] == "M."

    @pytest.mark.parametrize("surname", STORED_SURNAMES)
    def test_no_stored_surname_appears_anywhere_in_the_response(self, seeded_url: str, surname: str):
        """Against the SERIALISED body rather than one field: what the page ships is the whole payload, not the part it renders."""
        assert surname not in json.dumps(self._read(seeded_url), ensure_ascii=False)

    def test_a_surname_starting_with_a_multibyte_letter_is_not_halved(self, seeded_url: str):
        """`$substrBytes` would cut an `Ö` in two, and only a real mongod tells the two operators apart."""
        assert self._by_vorname(seeded_url)["Timo"]["nachname"] == "Ö."

    def test_a_player_with_no_surname_reads_back_with_none(self, seeded_url: str):
        """Absent is not withheld: an initial invented here would read as a name nobody holds."""
        assert self._by_vorname(seeded_url)["Lena"]["nachname"] is None

    @pytest.mark.parametrize("field", WITHHELD_FIELDS)
    def test_a_withheld_field_reaches_no_row_the_pipeline_yields(self, seeded_url: str, field: str):
        """The allow-list `$project` builds, as mongod resolves it. A key added there is a leak the response shape hides."""
        rows = self._rows(seeded_url)

        # `all` over an empty list passes, and a join that stopped matching would empty it.
        assert len(rows) == 5
        assert all(field not in row for row in rows)

    def test_the_squad_facts_the_table_renders_survive(self, seeded_url: str):
        """The allow-list is not a blanket refusal: a shirt and a position are columns on the page."""
        served = self._by_vorname(seeded_url)["Maxim"]

        assert (served["nummer"], served["position"]) == ("7", "Angriff")

    def test_the_rendered_name_is_the_forename_and_an_initial(self, seeded_url: str):
        """The frontend's join and its avatar letter, spelled out: emitting the dot here is what keeps both unchanged."""
        served = self._by_vorname(seeded_url)["Maxim"]

        assert " ".join(part for part in (served["vorname"], served["nachname"]) if part) == "Maxim M."
        assert served["nachname"][0] == "M"

    def test_the_order_is_by_position_then_forename(self, seeded_url: str):
        """The default sort, unchanged by the redaction -- and MongoDB puts the null position first."""
        served = self._read(seeded_url)["kader"]

        assert [row["position"] for row in served] == [None, "Abwehr", "Angriff", "Mittelfeld", "Tor"]

    def _read_one(self, url: str, key: str) -> dict[str, Any]:
        async def body(database: AsyncDatabase) -> Any:
            response = await get_spieler_by_id(spieler_id=SPIELER_OIDS[key], spieler_collection=database.spieler)

            return response.model_dump(mode="json", by_alias=True)

        return on_a_database(url, body)

    def test_the_one_player_read_serves_the_same_initial(self, seeded_url: str):
        """The second base-tier path, redacted by `public_initial` where the squad is redacted by the pipeline."""
        assert self._read_one(seeded_url, "Mueller")["nachname"] == "M."

    def test_the_one_player_read_carries_no_leaving_date(self, seeded_url: str):
        """Against the RETIRED person, so a date really is stored and its absence from the wire is the redaction."""
        assert self._read_one(seeded_url, "Weber") == {
            "spieler_id": str(SPIELER_OIDS["Weber"]),
            "vorname": "Jonas",
            "nachname": "W.",
        }

    def test_the_stored_row_is_byte_identical_after_both_base_tier_reads(self, seeded_url: str):
        """The mask is a projection and never a write, so nothing on this path may stamp the row it redacts.

        Encoded rather than compared directly: a key order or a BSON type that moved leaves two
        dicts equal.
        """

        # Marek, whom no case above reads by id: this module shares one corpus, so against a person
        # an earlier case already fetched, a second stamp would write the value it wrote the first time.
        subject = SPIELER_OIDS["Adler"]

        async def body(database: AsyncDatabase) -> Any:
            before = await database.spieler.find_one({"_id": subject})

            await club_page(database)
            await get_spieler_by_id(spieler_id=subject, spieler_collection=database.spieler)

            return before, await database.spieler.find_one({"_id": subject})

        before, after = on_a_database(seeded_url, body)

        # The floor: `find_one` answers `None` for a row it did not reach, and two of those agree.
        assert before is not None and after is not None
        assert bson_encode(before) == bson_encode(after)


# Module-scoped: every case below reads this corpus and none writes it, which `unwritten` keeps
# from being left as a claim.
@pytest.fixture(scope="module")
def seeded_url(mongo_url: str) -> Iterator[str]:
    """Six people and their squad rows.

    A retired person beside a live row, a retired row, a surname whose initial is two bytes, and a
    person carrying no surname at all.
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
                    _spieler("Without", "Lena", None),
                    _spieler("Oeztuerk", "Timo", "Öztürk"),
                    _spieler("Weber", "Jonas", "Weber", inactive_since="2026-05-01"),
                    _spieler("Kraus", RETIRED_ROW_VORNAME, "Kraus"),
                ]
            )
            await database.saison_spieler.insert_many(
                [
                    _squad_row("Mueller", nummer="7", position="Angriff", stufe="Q3", rolle="kapitaen"),
                    _squad_row("Adler", nummer="3", position="Abwehr", stufe="E1"),
                    _squad_row("Without", nummer=None, position=None, stufe=None),
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

    def _vornamen(self, url: str, saison_id: str) -> list[str]:
        async def body(database: AsyncDatabase) -> Any:
            return [row.vorname for row in (await club_page(database, saison_id)).kader]

        return on_the_seed_loop(body(shared_client(url)[SQUAD_DATABASE_NAME]))

    def test_a_player_of_both_seasons_is_listed_once_and_one_of_the_past_season_alone_not_at_all(self, squad_url: str):
        assert self._vornamen(squad_url, SAISON) == ["Paula"]

    def test_the_past_season_s_page_still_lists_its_own_squad(self, squad_url: str):
        """The control: the corpus really holds the past season's second player and the row the running season leaves out."""
        assert sorted(self._vornamen(squad_url, PAST_SAISON)) == ["Paula", "Theo"]


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
    vorname: str
    nachname: str
    einwilligung: dict[str, Any]
    served_vorname: str | None
    served_nachname: str | None


# Each served pair is written out rather than composed from `public_initial`, which would compare the
# redaction with itself. No forename holds a surname as a substring: one case greps the whole payload.
MASKED_SQUAD = {
    "Offen": MaskedRow(ObjectId("6890a1b2c3d4e5f607390031"), "Alina", "Falk", _consent("kader_oeffentlich"), "Alina", "F."),
    "Intern": MaskedRow(ObjectId("6890a1b2c3d4e5f607390032"), "Bruno", "Gerber", _consent("intern"), None, None),
}

# A shirt per row, which is how a case below finds its row: the read serves no record id to find one by.
MASK_NUMMERN = {case: str(place) for place, case in enumerate(MASKED_SQUAD, start=1)}

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

    def test_the_corpus_really_stores_the_names_and_the_records_the_cases_below_read(self, masked_url: str):
        """First: every case below would pass just as well against a corpus that stored no name to withhold."""

        async def body(database: AsyncDatabase) -> Any:
            return {person["_id"]: person for person in await database.spieler.find({}).to_list(None)}

        stored = _on_the_mask_database(masked_url, body)

        assert len(stored) == len(MASKED_SQUAD)
        for row in MASKED_SQUAD.values():
            assert (stored[row.oid]["vorname"], stored[row.oid]["nachname"]) == (row.vorname, row.nachname)
            assert stored[row.oid]["einwilligung"] == row.einwilligung

    def test_the_squad_serves_a_row_for_every_seeded_person(self, masked_url: str):
        """A withheld name is a nameless SLOT and never a missing row: `all` over a list a broken join emptied passes every case below."""
        assert len(self._by_nummer(masked_url)) == len(MASKED_SQUAD)

    @pytest.mark.parametrize("case", MASKED_SQUAD)
    def test_the_squad_serves_each_name_as_the_record_allows(self, masked_url: str, case: str):
        row = MASKED_SQUAD[case]
        served = self._by_nummer(masked_url)[MASK_NUMMERN[case]]

        assert (served["vorname"], served["nachname"]) == (row.served_vorname, row.served_nachname)

    @pytest.mark.parametrize("case", MASKED_SQUAD)
    def test_a_withheld_row_keeps_its_number_and_its_position(self, masked_url: str, case: str):
        """The mask reaches the two name fields, so the slot the person holds in the squad stands either way.

        The row is found by its shirt, so a number the mask took would leave this case finding none.
        """
        served = self._by_nummer(masked_url)[MASK_NUMMERN[case]]

        assert served["position"] == "Angriff"

    @pytest.mark.parametrize("name", WITHHELD_NAMES)
    def test_no_withheld_name_appears_anywhere_in_the_response(self, masked_url: str, name: str):
        """Against the SERIALISED body: what the page ships is the whole payload, not the part it renders."""
        assert name not in json.dumps(self._read(masked_url), ensure_ascii=False)

    @pytest.mark.parametrize("case", MASKED_SQUAD)
    def test_no_pupil_s_record_id_appears_anywhere_in_the_response(self, masked_url: str, case: str):
        """`READ-PUPIL-005`, against the SERIALISED body: an id outlives every season and team, so it would tie a withheld row to its others."""
        assert str(MASKED_SQUAD[case].oid) not in json.dumps(self._read(masked_url))

    @pytest.mark.parametrize("key", ["einwilligung", "umfang"])
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
            "vorname": row.served_vorname,
            "nachname": row.served_nachname,
        }


class TestTheAdminEchoIsServedNoMask:
    """`FLSpielerAdminSingleResponse` extends the narrowed read, so the split holds the echo's forename required."""

    def test_the_echo_carries_a_withheld_person_s_whole_name(self):
        """Composed by the handler from the stored document, over the row whose public reads serve neither name."""
        row = MASKED_SQUAD["Intern"]
        echoed = _as_single({"_id": row.oid, "vorname": row.vorname, "nachname": row.nachname, "inactive_since": None})

        assert (echoed.vorname, echoed.nachname) == (row.vorname, row.nachname)

    def test_the_echo_refuses_a_withheld_forename(self, assert_rejects):
        """A `null` forename here is the mask having reached the admin editor, and this declaration is what fails first."""
        body = {"spieler_id": MASKED_SQUAD["Intern"].oid, "nachname": "Gerber", "inactive_since": None}

        assert_rejects(FLSpielerAdminSingleResponse, {**body, "vorname": None}, "vorname")

    def test_the_public_single_read_takes_the_forename_the_echo_refuses(self):
        """The contrast is the assertion: the two shapes differ on exactly this field, and the echo extends the public one."""
        assert FLSpielerSingleResponse(spieler_id=MASKED_SQUAD["Intern"].oid, vorname=None, nachname=None).vorname is None

    def test_the_squad_row_takes_it_too(self):
        """A required forename on the squad's shape would 500 the whole club page over one withheld row."""
        served = FLSpielerPublic.model_validate({"_id": MASKED_SQUAD["Intern"].oid, "vorname": None, "nachname": None})

        assert (served.vorname, served.nachname) == (None, None)


@pytest.fixture(scope="module")
def masked_url(mongo_url: str) -> Iterator[str]:
    """One squad in one season, holding a row for every consent state `READ-PUPIL-003` parts."""

    async def _seed() -> None:
        async with a_clean_database(mongo_url, MASK_DATABASE_NAME) as (_, database):
            await database.saisons.insert_one(saison_document(SAISON, "active"))
            await _enter_the_club(database, SAISON)
            await database.spieler.insert_many(
                [
                    {
                        "_id": row.oid,
                        "vorname": row.vorname,
                        "nachname": row.nachname,
                        "inactive_since": None,
                        "einwilligung": row.einwilligung,
                    }
                    for row in MASKED_SQUAD.values()
                ]
            )
            await database.saison_spieler.insert_many(
                [
                    {**_squad_row("Mueller", nummer=MASK_NUMMERN[case], position="Angriff", stufe="Q3"), "spieler_id": row.oid}
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
# chain's `vorname`.
SORT_ORACLE_NUMMER = "7"
SORT_ORACLE_POSITION = "Angriff"


@pytest.mark.db
class TestTheOrderIsNoOracleForAWithheldName:
    """One squad seeded twice, differing only in the withheld row's stored forename: its place in the answer may not move with it."""

    def _served_names(self, url: str, corpus: str) -> list[str | None]:
        """Each row's served forename, in the club page's order: `None` is the withheld row, the corpus holding one."""

        async def body(database: AsyncDatabase) -> Any:
            return [row.vorname for row in (await club_page(database)).kader]

        return on_the_seed_loop(body(shared_client(url)[SORT_ORACLE_DATABASE_NAMES[corpus]]))

    def test_the_two_corpora_really_store_the_two_forenames_and_nothing_else_apart(self, sort_oracle_url: str):
        """First: every case below passes against two corpora seeded identically, which is exactly what would prove nothing."""

        async def body(database: AsyncDatabase) -> Any:
            return sorted(repr(person) for person in await database.spieler.find({}).to_list(None))

        stored = {corpus: _on_a_sort_oracle_database(sort_oracle_url, corpus, body) for corpus in WITHHELD_FORENAMES}

        assert stored["first"] != stored["last"]
        for corpus, forename in WITHHELD_FORENAMES.items():
            assert sum(forename in person for person in stored[corpus]) == 1

    def test_the_published_rows_really_are_ordered_by_the_name_the_read_serves(self, sort_oracle_url: str):
        """The second floor: an answer in seeding order would hold the withheld row still for a reason nothing here is testing."""
        served = self._served_names(sort_oracle_url, "first")

        assert served.index("Bea") < served.index("Yara")

    def test_the_withheld_row_holds_one_place_whatever_forename_it_stores(self, sort_oracle_url: str):
        places = {corpus: self._served_names(sort_oracle_url, corpus).index(None) for corpus in WITHHELD_FORENAMES}

        assert places["first"] == places["last"]


@pytest.fixture(scope="module")
def sort_oracle_url(mongo_url: str) -> Iterator[str]:
    """Two corpora, each one squad of three: two published rows and one the `intern` scope withholds."""

    async def _seed() -> None:
        for corpus, withheld_forename in WITHHELD_FORENAMES.items():
            async with a_clean_database(mongo_url, SORT_ORACLE_DATABASE_NAMES[corpus], constraints=False) as (_, database):
                await database.saisons.insert_one(saison_document(SAISON, "active"))
                await _enter_the_club(database, SAISON)
                await database.spieler.insert_many(
                    [
                        {
                            "_id": SORT_ORACLE_OIDS["Zurueckgehalten"],
                            "vorname": withheld_forename,
                            "nachname": "Kessler",
                            "inactive_since": None,
                            "einwilligung": _consent("intern"),
                        },
                        {
                            "_id": SORT_ORACLE_OIDS["Berger"],
                            "vorname": "Bea",
                            "nachname": "Berger",
                            "inactive_since": None,
                            "einwilligung": _consent("kader_oeffentlich"),
                        },
                        {
                            "_id": SORT_ORACLE_OIDS["Yilmaz"],
                            "vorname": "Yara",
                            "nachname": "Yilmaz",
                            "inactive_since": None,
                            "einwilligung": _consent("kader_oeffentlich"),
                        },
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


def _on_a_sort_oracle_database(url: str, corpus: str, body: Body) -> Any:
    async def _run() -> Any:
        return await body(shared_client(url)[SORT_ORACLE_DATABASE_NAMES[corpus]])

    return on_the_seed_loop(_run())


def _on_the_mask_database(url: str, body: Body) -> Any:
    async def _run() -> Any:
        return await body(shared_client(url)[MASK_DATABASE_NAME])

    return on_the_seed_loop(_run())


def on_a_database(url: str, body: Body) -> Any:
    async def _run() -> Any:
        return await body(shared_client(url)[DATABASE_NAME])

    return on_the_seed_loop(_run())
