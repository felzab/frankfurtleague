import asyncio
import json
from typing import Any, Awaitable, Callable, Mapping, Sequence, get_args

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import ValidationError

from app.api.saisons.cache import invalidate_saison_cache
from app.api.spieler.router import get_spieler, get_spieler_by_id
from app.api.spieler.schemas import (
    FLSpieler,
    FLSpielerAdminSingleResponse,
    FLSpielerFilterParams,
    FLSpielerListResponse,
    FLSpielerMembership,
    FLSpielerPublic,
    FLSpielerSingleResponse,
    FLSpielerSortOptions,
)
from app.api.spieler.services import build_spieler_memberships_pipeline, build_spieler_pipeline, public_initial
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db
from app.main import create_app
from tests.config import build_test_config
from tests.database import a_clean_database

DATABASE_NAME = "fl_spieler_public_read_test"

SAISON = "2026"
# A second season, named by no document this corpus stores: these cases assert on the pipeline's shape alone.
WITHHELD_SAISON = "2027"
TEAM_OID = ObjectId("6890a1b2c3d4e5f607390001")

# What the base tier serves, and the whole of it.
PUBLIC_FIELDS = {"id", "vorname", "nachname", "nummer", "position"}

# `stufe` and `einwilligung` are the two confidentiality rules; the rest fails the allow-list, which
# asks what the surface renders rather than what looks sensitive. An unrendered field still ships.
WITHHELD_FIELDS = ["stufe", "einwilligung", "team_id", "is_nachgetragen", "is_captain", "inactive_since"]

# What a caller may actually SEND: the filter model's fields plus anything declared beside them.
# Constructing a filter object asks for nothing -- `extra="ignore"` drops an undeclared key first.
BASE_QUERY_PARAMETERS = {
    parameter["name"] for parameter in create_app(build_test_config()).openapi()["paths"][f"/api/v{API_VERSION}/spieler"]["get"]["parameters"]
}

SPIELER_OIDS = {
    "Mueller": ObjectId("6890a1b2c3d4e5f607390011"),
    "Adler": ObjectId("6890a1b2c3d4e5f607390012"),
    # No surname at all: absent is not the same fact as withheld, and must not read as an initial.
    "Ohne": ObjectId("6890a1b2c3d4e5f607390013"),
    # A surname whose first letter is two bytes, plus a junction row predating both flags.
    "Oeztuerk": ObjectId("6890a1b2c3d4e5f607390014"),
    # The PERSON is retired and the squad row is live -- `READ-SQUAD-001`'s case.
    "Weber": ObjectId("6890a1b2c3d4e5f607390015"),
    # The other way round, so the one match that stays is pinned by a row it really removes.
    "Kraus": ObjectId("6890a1b2c3d4e5f607390016"),
}

STORED_SURNAMES = ("Müller", "Adler", "Öztürk", "Weber")

Body = Callable[[AsyncIOMotorDatabase], Awaitable[Any]]


def _spieler(key: str, vorname: str, nachname: str | None, *, inactive_since: str | None = None) -> dict[str, Any]:
    """A person as `POST /spieler` writes them -- consent record included, which is the point of the corpus."""

    return {
        "_id": SPIELER_OIDS[key],
        "vorname": vorname,
        "nachname": nachname,
        "inactive_since": inactive_since,
        "einwilligung": {
            "umfang": "kader_oeffentlich",
            "erteilt_von": "erziehungsberechtigt",
            "datum": "2026-01-15",
            "bestaetigt_am": "2026-01-20",
        },
    }


def _squad_row(
    key: str,
    *,
    nummer: str | None,
    position: str | None,
    stufe: str | None,
    is_captain: bool = False,
    inactive_since: str | None = None,
) -> dict[str, Any]:
    return {
        "spieler_id": SPIELER_OIDS[key],
        "saison_id": SAISON,
        "team_id": TEAM_OID,
        "nummer": nummer,
        "position": position,
        "stufe": stufe,
        "is_nachgetragen": False,
        "is_captain": is_captain,
        "inactive_since": inactive_since,
    }


def _legacy_squad_row(key: str, **fields: Any) -> dict[str, Any]:
    """A row written before either flag existed: the keys are ABSENT, and `$project` omits an absent key rather than nulling it."""

    row = _squad_row(key, **fields)
    del row["is_nachgetragen"]
    del row["is_captain"]

    return row


def _filters() -> FLSpielerFilterParams:
    """One team's squad in one season -- the narrowing every case below shares."""

    return FLSpielerFilterParams(team_id=TEAM_OID, saison_id=SAISON)


def _project(filters: FLSpielerFilterParams | None = None) -> dict[str, Any]:
    pipeline = build_spieler_pipeline(filters or _filters())

    return next(stage["$project"] for stage in pipeline if "$project" in stage)


def _sort(filters: FLSpielerFilterParams | None = None) -> dict[str, int]:
    pipeline = build_spieler_pipeline(filters or _filters())

    return next(stage["$sort"] for stage in pipeline if "$sort" in stage)


def _lookup_pipeline(filters: FLSpielerFilterParams | None = None, withheld: Sequence[str] = ()) -> list[Any]:
    pipeline = build_spieler_pipeline(filters or _filters(), withheld)

    return next(stage["$lookup"] for stage in pipeline if "$lookup" in stage)["pipeline"]


class TestTheBaseTierShape:
    def test_it_serves_exactly_the_public_fields(self):
        assert set(FLSpielerPublic.model_fields) == PUBLIC_FIELDS

    @pytest.mark.parametrize("field", WITHHELD_FIELDS)
    def test_a_withheld_field_is_not_on_the_shape(self, field: str):
        """Absent from the MODEL, not merely unrendered: the page is a client component, so every field it receives sits in the page source."""
        assert field not in FLSpielerPublic.model_fields

    def test_the_list_response_serves_the_public_shape(self):
        assert FLSpielerListResponse.model_fields["spieler"].annotation == list[FLSpielerPublic]

    @pytest.mark.parametrize("field", WITHHELD_FIELDS)
    def test_the_stored_shape_still_declares_what_the_tier_withholds(self, field: str):
        """Each rule is about one READ: the field stays stored, admin-visible and validator-enforced, and `FLSpieler` still declares it."""
        assert field in FLSpieler.model_fields

    @pytest.mark.parametrize("field", ["stufe", "team_id", "is_nachgetragen", "is_captain", "inactive_since"])
    def test_the_admin_membership_read_keeps_every_field(self, field: str):
        """`GET /spieler/memberships` is admin-tier: narrowing it would leave the squad editor unable to read back what it writes."""
        assert field in FLSpielerMembership.model_fields

    def test_the_squad_fields_default_where_the_join_supplies_neither(self):
        """An unnarrowed read joins loosely, and `$project` omits both keys rather than nulling them: required fields would 500 the list."""
        served = FLSpielerPublic.model_validate({"_id": SPIELER_OIDS["Kraus"], "vorname": "Nils", "nachname": "K."})

        assert (served.nummer, served.position) == (None, None)

    def test_the_read_model_accepts_the_initial_it_is_served(self):
        """`docs/backend/spec.md :: I36` keeps `PERSON_NAME_PATTERN` off read models, and a trailing dot is what that pattern refuses."""
        served = FLSpielerPublic.model_validate(
            {"_id": SPIELER_OIDS["Mueller"], "vorname": "Max", "nachname": "M.", "nummer": "7", "position": "Angriff"}
        )

        assert served.nachname == "M."


class TestTheSinglePlayerShape:
    """`GET /spieler/{spieler_id}` is base-tier as well, and the list publishes every id it takes."""

    def test_it_serves_an_allow_list_of_what_the_surface_needs(self):
        """Derived from what a caller of THIS path needs, never the stored person less whatever looked sensitive."""
        assert set(FLSpielerSingleResponse.model_fields) == {"acknowledged", "spieler_id", "vorname", "nachname"}

    def test_the_leaving_date_is_not_on_it(self):
        """Nothing public renders a pupil's leaving date, and a field no surface needs is a field no surface is given."""
        assert "inactive_since" not in FLSpielerSingleResponse.model_fields

    def test_the_admin_echo_keeps_the_leaving_date(self):
        """It IS the answer `DELETE` and `reactivate` give, so the echo would say nothing without it."""
        assert "inactive_since" in FLSpielerAdminSingleResponse.model_fields

    def test_the_admin_echo_is_the_public_shape_plus_that_one_field(self):
        """Extension rather than a second declaration: the two would otherwise drift on the three fields they share."""
        extra = set(FLSpielerAdminSingleResponse.model_fields) - set(FLSpielerSingleResponse.model_fields)

        assert extra == {"inactive_since"}


class TestTheProjection:
    def test_it_emits_only_the_public_keys(self):
        assert set(_project()) == {"_id", "vorname", "nachname", "nummer", "position"}

    def test_the_consent_record_is_not_projected(self):
        """Stored on the PERSON rather than the junction, so it rode along on a `1` nobody had to name."""
        assert "einwilligung" not in _project()

    def test_the_level_is_gone_from_the_shape_and_from_every_way_of_asking_for_it(self):
        """Serving no `stufe` while `?stufe=` still narrowed would leave the fact readable one level at a time."""
        assert "stufe" not in _project()
        assert "stufe" not in BASE_QUERY_PARAMETERS
        assert "stufe" not in get_args(FLSpielerSortOptions)

    def test_the_backdated_flag_is_gone_from_the_shape_and_from_every_way_of_asking_for_it(self):
        """The same sentence one field up: `is_nachgetragen` is withheld too, so a request per value would partition the squad by it."""
        assert "is_nachgetragen" not in _project()
        assert "is_nachgetragen" not in BASE_QUERY_PARAMETERS
        assert "is_nachgetragen" not in get_args(FLSpielerSortOptions)

    def test_the_public_sort_does_not_tiebreak_on_the_surname(self):
        """A tie-break is the last place an ordering could still depend on a field the response withholds."""
        assert "nachname" not in _sort()
        assert "vorname" in _sort()

    def test_only_the_admin_read_tiebreaks_on_the_surname(self):
        """The contrast is the assertion: the admin list orders people by full name and is entitled to."""
        assert build_spieler_memberships_pipeline()[-1]["$sort"] == {"vorname": 1, "nachname": 1}

    @pytest.mark.parametrize("key", ["nachname", "stufe"])
    def test_the_base_tier_refuses_to_order_by_a_key_it_will_not_serve(self, key: str):
        """The tie-break was never the whole of it: `sort_by` is a published query parameter, so surname order could be ASKED for outright."""
        assert key not in get_args(FLSpielerSortOptions)

        with pytest.raises(ValidationError):
            FLSpielerFilterParams.model_validate({"sort_by": key})

    def test_the_person_s_own_retirement_narrows_nothing(self):
        """`READ-SQUAD-001`: the only retirement match is the lookup's. One here would take a retired person's squad rows down with them."""
        matches = [stage["$match"] for stage in build_spieler_pipeline(_filters()) if "$match" in stage]

        assert matches == []

    def test_the_squad_row_s_retirement_narrows_unconditionally(self):
        """The other half, with no switch: this tier serves no field marking a row it would un-hide (`READ-SQUAD-002`)."""
        assert {"$match": {"inactive_since": None}} in _lookup_pipeline()
        assert "include_inactive" not in BASE_QUERY_PARAMETERS


class TestTheSeasonsThisTierMayNotRead:
    """A squad row carries the season it belongs to; the row this read SERVES does not. So the narrowing happens here."""

    def test_a_withheld_season_narrows_the_junction(self):
        assert {"$match": {"saison_id": {"$nin": [WITHHELD_SAISON]}}} in _lookup_pipeline(FLSpielerFilterParams(), [WITHHELD_SAISON])

    def test_it_narrows_the_junction_rather_than_what_the_junction_joined(self):
        """A `$match` after the join would leave the row attached, and the loose `$unwind` above serves a person with no row at all."""
        pipeline = build_spieler_pipeline(FLSpielerFilterParams(), [WITHHELD_SAISON])

        assert [stage for stage in pipeline if "$match" in stage] == []

    def test_it_narrows_ahead_of_nothing_the_row_carries(self):
        """Last of the junction's terms: the season is the one narrowing that costs a comparison per id, so the cheap equalities go first."""
        assert _lookup_pipeline(FLSpielerFilterParams(), [WITHHELD_SAISON])[-1] == {"$match": {"saison_id": {"$nin": [WITHHELD_SAISON]}}}

    def test_a_league_with_nothing_planned_runs_the_pipeline_it_always_ran(self):
        """`$nin: []` narrows nothing, so an empty set is no stage rather than a stage matching everything."""
        assert all("$nin" not in str(stage) for stage in _lookup_pipeline(FLSpielerFilterParams()))

    def test_the_default_is_the_empty_set(self):
        """A caller joining across seasons has to supply them; one that does not is a league where nothing is withheld."""
        assert build_spieler_pipeline(FLSpielerFilterParams()) == build_spieler_pipeline(FLSpielerFilterParams(), [])


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
    """The whole chain against a real mongod: what is STORED, what the pipeline yields, and what the endpoint serialises."""

    def _read(self, container: Any, filters: FLSpielerFilterParams | None = None) -> dict[str, Any]:
        """The endpoint's own answer, dumped as the wire carries it -- the only shape that can show nothing leaked."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            response = await get_spieler(
                spieler_collection=database.spieler,
                saisons_collection=database.saisons,
                filters=filters or _filters(),
            )

            return response.model_dump(mode="json", by_alias=True)

        return on_a_database(container, body)

    def _by_vorname(self, container: Any, filters: FLSpielerFilterParams | None = None) -> dict[str, dict[str, Any]]:
        return {row["vorname"]: row for row in self._read(container, filters)["spieler"]}

    def _rows(self, container: Any, filters: FLSpielerFilterParams | None = None) -> list[Mapping[str, Any]]:
        """What mongod yields for the pipeline, one step BEFORE `FLSpielerPublic`, which declares five fields and drops the rest either way."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            return await aggregate_many_from_db(collection=database.spieler, pipeline=build_spieler_pipeline(filters or _filters()))

        return on_a_database(container, body)

    def test_the_corpus_really_holds_what_the_response_must_not(self, mongo_container: Any):
        """First, because every assertion below would pass just as well against a seed that stored neither."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            person = await database.spieler.find_one({"_id": SPIELER_OIDS["Mueller"]})
            row = await database.saison_spieler.find_one({"spieler_id": SPIELER_OIDS["Mueller"]})

            return person, row

        person, row = on_a_database(mongo_container, body)

        assert person["nachname"] == "Müller"
        assert person["einwilligung"]["umfang"] == "kader_oeffentlich"
        assert (row["stufe"], row["is_captain"]) == ("Q3", True)

    def test_the_corpus_really_holds_a_retired_person_beside_a_retired_row(self, mongo_container: Any):
        """The same guard for `READ-SQUAD-001`: both cases below pass against a corpus where nobody retired at all."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            person = await database.spieler.find_one({"_id": SPIELER_OIDS["Weber"]})
            live_row = await database.saison_spieler.find_one({"spieler_id": SPIELER_OIDS["Weber"]})
            retired_row = await database.saison_spieler.find_one({"spieler_id": SPIELER_OIDS["Kraus"]})

            return person, live_row, retired_row

        person, live_row, retired_row = on_a_database(mongo_container, body)

        assert (person["inactive_since"], live_row["inactive_since"]) == ("2026-05-01", None)
        assert retired_row["inactive_since"] == "2026-03-01"

    def test_a_retired_person_keeps_the_squad_rows_they_played(self, mongo_container: Any):
        """`READ-SQUAD-001`, which the admin sidemenu already promises: Stilllegen empties the pickers and leaves the Kadereintrag standing."""
        assert "Jonas" in self._by_vorname(mongo_container)

    def test_a_retired_squad_row_stays_out(self, mongo_container: Any):
        """The retirement this read does filter on, so dropping the person's match cannot be mistaken for dropping both."""
        assert "Nils" not in self._by_vorname(mongo_container)

    def test_a_person_whose_every_squad_row_is_retired_still_reads(self, mongo_container: Any):
        """Neither id narrows, so the join is loose: Nils survives the unwind with no `saison_data`, and `$project` leaves both keys off."""
        served = self._by_vorname(mongo_container, FLSpielerFilterParams())

        assert (served["Nils"]["nummer"], served["Nils"]["position"]) == (None, None)

    def test_a_stored_surname_is_served_as_an_initial(self, mongo_container: Any):
        assert self._by_vorname(mongo_container)["Maxim"]["nachname"] == "M."

    @pytest.mark.parametrize("surname", STORED_SURNAMES)
    def test_no_stored_surname_appears_anywhere_in_the_response(self, mongo_container: Any, surname: str):
        """Against the SERIALISED body rather than one field: what the page ships is the whole payload, not the part it renders."""
        assert surname not in json.dumps(self._read(mongo_container), ensure_ascii=False)

    def test_a_surname_starting_with_a_multibyte_letter_is_not_halved(self, mongo_container: Any):
        """`$substrBytes` would cut an `Ö` in two, and only a real mongod tells the two operators apart."""
        assert self._by_vorname(mongo_container)["Timo"]["nachname"] == "Ö."

    def test_a_player_with_no_surname_reads_back_with_none(self, mongo_container: Any):
        """Absent is not withheld: an initial invented here would read as a name nobody holds."""
        assert self._by_vorname(mongo_container)["Lena"]["nachname"] is None

    @pytest.mark.parametrize("field", WITHHELD_FIELDS)
    def test_a_withheld_field_reaches_no_row_the_pipeline_yields(self, mongo_container: Any, field: str):
        """The allow-list `$project` builds, as mongod resolves it. A key added there is a leak the response shape hides."""
        rows = self._rows(mongo_container)

        # `all` over an empty list passes, and a join that stopped matching would empty it.
        assert len(rows) == 5
        assert all(field not in row for row in rows)

    def test_the_squad_facts_the_table_renders_survive(self, mongo_container: Any):
        """The allow-list is not a blanket refusal: a shirt and a position are columns on the page."""
        served = self._by_vorname(mongo_container)["Maxim"]

        assert (served["nummer"], served["position"]) == ("7", "Angriff")

    def test_a_row_written_before_the_squad_flags_existed_still_reads(self, mongo_container: Any):
        """The allow-list names neither flag, so a row missing both is not a shape the read can trip over."""
        assert self._by_vorname(mongo_container)["Timo"]["nummer"] == "5"

    def test_the_rendered_name_is_the_forename_and_an_initial(self, mongo_container: Any):
        """The frontend's join and its avatar letter, spelled out: emitting the dot here is what keeps both unchanged."""
        served = self._by_vorname(mongo_container)["Maxim"]

        assert " ".join(part for part in (served["vorname"], served["nachname"]) if part) == "Maxim M."
        assert served["nachname"][0] == "M"

    def test_the_order_is_by_position_then_forename(self, mongo_container: Any):
        """The default sort, unchanged by the redaction -- and MongoDB puts the null position first."""
        served = self._read(mongo_container)["spieler"]

        assert [row["position"] for row in served] == [None, "Abwehr", "Angriff", "Mittelfeld", "Tor"]

    def _read_one(self, container: Any, key: str) -> dict[str, Any]:
        async def body(database: AsyncIOMotorDatabase) -> Any:
            response = await get_spieler_by_id(spieler_id=SPIELER_OIDS[key], spieler_collection=database.spieler)

            return response.model_dump(mode="json", by_alias=True)

        return on_a_database(container, body)

    def test_the_one_player_read_serves_the_same_initial(self, mongo_container: Any):
        """The second base-tier path, redacted by `public_initial` where the list is redacted by the pipeline."""
        assert self._read_one(mongo_container, "Mueller")["nachname"] == "M."

    def test_the_one_player_read_carries_no_leaving_date(self, mongo_container: Any):
        """Against the RETIRED person, so a date really is stored and its absence from the wire is the redaction."""
        assert self._read_one(mongo_container, "Weber") == {
            "acknowledged": 1,
            "spieler_id": str(SPIELER_OIDS["Weber"]),
            "vorname": "Jonas",
            "nachname": "W.",
        }


def on_a_database(container: Any, body: Body) -> Any:
    """One client and event loop per call: Motor binds to the loop it first runs on."""

    async def _run() -> Any:
        async with a_clean_database(container.get_connection_url(), DATABASE_NAME) as (_, database):
            # This corpus stores no season, so the read's gate finds none to withhold -- but the cache
            # behind it is process-global, and another module's entry under this id would answer here.
            invalidate_saison_cache()

            await database.spieler.insert_many(
                [
                    # Distinct forenames, none of them holding a surname as a substring: the rows
                    # are keyed by forename below, and one case greps the whole payload for a leak.
                    _spieler("Mueller", "Maxim", "Müller"),
                    _spieler("Adler", "Marek", "Adler"),
                    _spieler("Ohne", "Lena", None),
                    _spieler("Oeztuerk", "Timo", "Öztürk"),
                    _spieler("Weber", "Jonas", "Weber", inactive_since="2026-05-01"),
                    _spieler("Kraus", "Nils", "Kraus"),
                ]
            )
            await database.saison_spieler.insert_many(
                [
                    _squad_row("Mueller", nummer="7", position="Angriff", stufe="Q3", is_captain=True),
                    _squad_row("Adler", nummer="3", position="Abwehr", stufe="E1"),
                    _squad_row("Ohne", nummer=None, position=None, stufe=None),
                    _legacy_squad_row("Oeztuerk", nummer="5", position="Mittelfeld", stufe="Q1"),
                    _squad_row("Weber", nummer="1", position="Tor", stufe="Q2"),
                    _squad_row("Kraus", nummer="12", position="Angriff", stufe="Q4", inactive_since="2026-03-01"),
                ]
            )

            return await body(database)

    return asyncio.run(_run())
