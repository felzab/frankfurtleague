from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable, Iterator, Mapping, Sequence
from typing import Any, NamedTuple, cast, get_args

import pytest
from bson import ObjectId
from bson import encode as bson_encode
from pydantic import ValidationError
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.cache import invalidate_saison_cache
from app.api.spieler.admin_router import _as_single
from app.api.spieler.router import get_spieler, get_spieler_by_id
from app.api.spieler.schemas import (
    FLSaisonSpielerResponse,
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
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.main import create_app
from tests.config import build_test_config
from tests.database import a_clean_database, on_the_seed_loop, shared_client
from tests.worker import worker_database

from .conftest import unwritten

DATABASE_NAME = worker_database("fl_spieler_public_read_test")

SAISON = "2026"
# A second season, named by no document this corpus stores: these cases assert on the pipeline's shape alone.
WITHHELD_SAISON = "2027"
TEAM_OID = ObjectId("6890a1b2c3d4e5f607390001")

# What the base tier serves, and the whole of it.
PUBLIC_FIELDS = {"id", "vorname", "nachname", "nummer", "position"}

# `stufe`, `einwilligung` and `email` are the confidentiality rules; the rest fails the allow-list,
# which asks what the surface renders rather than what looks sensitive. An unrendered field still ships.
WITHHELD_FIELDS = ["stufe", "einwilligung", "email", "team_id", "ist_nachnominiert", "rolle", "inactive_since"]

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

Body = Callable[[AsyncDatabase], Awaitable[Any]]


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
    rolle: str | None = None,
    inactive_since: str | None = None,
) -> dict[str, Any]:
    return {
        "spieler_id": SPIELER_OIDS[key],
        "saison_id": SAISON,
        "team_id": TEAM_OID,
        "nummer": nummer,
        "position": position,
        "stufe": stufe,
        "ist_nachnominiert": False,
        "rolle": rolle,
        "inactive_since": inactive_since,
    }


def _legacy_squad_row(key: str, **fields: Any) -> dict[str, Any]:
    """A row written before either field existed: the keys are ABSENT, and `$project` omits an absent key rather than nulling it."""

    row = _squad_row(key, **fields)
    del row["ist_nachnominiert"]
    del row["rolle"]

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

    @pytest.mark.parametrize("field", ["stufe", "team_id", "ist_nachnominiert", "rolle", "inactive_since"])
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
            "ist_nachnominiert": False,
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
        assert set(_project()) == {"_id", "vorname", "nachname", "nummer", "position"}

    def test_the_consent_record_is_read_and_projected_nowhere(self):
        """`READ-PUPIL-003` reads it inside the `$cond`, so the projection carrying no key of that name is the whole of the withholding."""
        assert "einwilligung" not in _project()
        assert "$einwilligung.umfang" in json.dumps(_project())

    def test_the_level_is_gone_from_the_shape_and_from_every_way_of_asking_for_it(self):
        """Serving no `stufe` while `?stufe=` still narrowed would leave the fact readable one level at a time."""
        assert "stufe" not in _project()
        assert "stufe" not in BASE_QUERY_PARAMETERS
        assert "stufe" not in get_args(FLSpielerSortOptions)

    def test_the_backdated_flag_is_gone_from_the_shape_and_from_every_way_of_asking_for_it(self):
        """The same sentence one field up: `ist_nachnominiert` is withheld too, so a request per value would partition the squad by it."""
        assert "ist_nachnominiert" not in _project()
        assert "ist_nachnominiert" not in BASE_QUERY_PARAMETERS
        assert "ist_nachnominiert" not in get_args(FLSpielerSortOptions)

    def test_the_sort_runs_after_the_mask_and_not_over_the_stored_names(self):
        """`sort_by` is a published parameter.

        An order keyed on the stored forename answers, for a withheld row, what the projection
        withholds.
        """
        stages = [next(iter(stage)) for stage in build_spieler_pipeline(_filters())]

        assert stages.index("$sort") > stages.index("$project")

    def test_nothing_a_caller_may_send_narrows_on_a_name(self):
        """The other half of the same channel: a term matching a stored name would report a withheld row's name by which requests return it."""
        assert BASE_QUERY_PARAMETERS == {"team_id", "saison_id", "limit", "sort_by", "order"}

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


class _Cursor:
    """An answer holding nobody, in both shapes the read iterates: `aggregate`'s cursor and `find(...).limit(...)`."""

    def limit(self, length: int) -> _Cursor:
        return self

    async def to_list(self, length: int | None = None) -> list[Any]:
        return []


class _Seasons:
    """A seasons collection holding at most one `active` season and withholding none."""

    def __init__(self, active: str | None) -> None:
        self.active = active

    async def find_one(self, filter: Any = None, projection: Any = None, session: Any = None) -> dict[str, Any] | None:
        return {"_id": self.active, "status": "active"} if self.active is not None and filter == {"status": "active"} else None

    def find(self, **query: Any) -> _Cursor:
        return _Cursor()


class _Players:
    """A players collection keeping the pipeline each read runs, which is where the season it resolved shows."""

    def __init__(self) -> None:
        self.pipelines: list[Sequence[Mapping[str, Any]]] = []

    async def aggregate(self, pipeline: Sequence[Mapping[str, Any]], collation: Any = None, session: Any = None) -> _Cursor:
        self.pipelines.append(pipeline)
        return _Cursor()


def _junction_terms(filters: FLSpielerFilterParams, seasons: _Seasons) -> list[Mapping[str, Any]]:
    """The `$match` terms the read narrowed the squad rows on, as the handler itself built them."""

    invalidate_saison_cache()
    players = _Players()
    asyncio.run(
        get_spieler(spieler_collection=cast(AsyncCollection, players), saisons_collection=cast(AsyncCollection, seasons), filters=filters)
    )
    lookup = next(stage["$lookup"] for stage in players.pipelines[0] if "$lookup" in stage)

    return [stage["$match"] for stage in lookup["pipeline"] if "$match" in stage]


class TestTheSeasonASquadIsReadFor:
    """`docs/backend/spec.md :: I4`: the squad page names a club and, for the running season, no season."""

    @pytest.mark.parametrize(
        ("named", "read"),
        [
            # Without the resolve a player in two of the club's seasons is two rows, and one who left last season stands in this one.
            pytest.param(None, SAISON, id="no season reads the active one"),
            # The resolve fills an ABSENT id only: a page on a past season asks for that season's squad.
            pytest.param(WITHHELD_SAISON, WITHHELD_SAISON, id="a named season is read as named"),
        ],
    )
    def test_naming_a_team_reads_its_squad_in_one_season(self, named: str | None, read: str):
        terms = _junction_terms(FLSpielerFilterParams(team_id=TEAM_OID, saison_id=named), _Seasons(SAISON))

        assert {"team_id": TEAM_OID, "saison_id": read} in terms

    def test_naming_neither_resolves_no_season(self):
        """Every season's players: nothing names a squad, so no season is resolved to scope one."""
        assert all("saison_id" not in term for term in _junction_terms(FLSpielerFilterParams(), _Seasons(SAISON)))

    def test_naming_a_team_with_no_season_active_is_refused_before_any_player_is_read(self):
        """No read method on the players collection: a handler reading squads with no season to scope them to fails on the attribute."""
        invalidate_saison_cache()

        with pytest.raises(DocumentNotFoundException) as refused:
            asyncio.run(
                get_spieler(
                    spieler_collection=cast(AsyncCollection, object()),
                    saisons_collection=cast(AsyncCollection, _Seasons(None)),
                    filters=FLSpielerFilterParams(team_id=TEAM_OID),
                )
            )

        assert refused.value.error_code == DOCUMENT_NOT_FOUND


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

    def _read(self, url: str, filters: FLSpielerFilterParams | None = None) -> dict[str, Any]:
        """The endpoint's own answer, dumped as the wire carries it -- the only shape that can show nothing leaked."""

        async def body(database: AsyncDatabase) -> Any:
            response = await get_spieler(
                spieler_collection=database.spieler,
                saisons_collection=database.saisons,
                filters=filters or _filters(),
            )

            return response.model_dump(mode="json", by_alias=True)

        return on_a_database(url, body)

    def _by_vorname(self, url: str, filters: FLSpielerFilterParams | None = None) -> dict[str, dict[str, Any]]:
        return {row["vorname"]: row for row in self._read(url, filters)["spieler"]}

    def _rows(self, url: str, filters: FLSpielerFilterParams | None = None) -> list[Mapping[str, Any]]:
        """What mongod yields for the pipeline, one step BEFORE `FLSpielerPublic`, which declares five fields and drops the rest either way."""

        async def body(database: AsyncDatabase) -> Any:
            return await aggregate_many_from_db(collection=database.spieler, pipeline=build_spieler_pipeline(filters or _filters()))

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
        assert "Nils" not in self._by_vorname(seeded_url)

    def test_a_person_whose_every_squad_row_is_retired_still_reads(self, seeded_url: str):
        """Neither id narrows, so the join is loose: Nils survives the unwind with no `saison_data`, and `$project` leaves both keys off."""
        served = self._by_vorname(seeded_url, FLSpielerFilterParams())

        assert (served["Nils"]["nummer"], served["Nils"]["position"]) == (None, None)

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

    def test_a_row_written_before_the_squad_flags_existed_still_reads(self, seeded_url: str):
        """The allow-list names neither flag, so a row missing both is not a shape the read can trip over."""
        assert self._by_vorname(seeded_url)["Timo"]["nummer"] == "5"

    def test_the_rendered_name_is_the_forename_and_an_initial(self, seeded_url: str):
        """The frontend's join and its avatar letter, spelled out: emitting the dot here is what keeps both unchanged."""
        served = self._by_vorname(seeded_url)["Maxim"]

        assert " ".join(part for part in (served["vorname"], served["nachname"]) if part) == "Maxim M."
        assert served["nachname"][0] == "M"

    def test_the_order_is_by_position_then_forename(self, seeded_url: str):
        """The default sort, unchanged by the redaction -- and MongoDB puts the null position first."""
        served = self._read(seeded_url)["spieler"]

        assert [row["position"] for row in served] == [None, "Abwehr", "Angriff", "Mittelfeld", "Tor"]

    def _read_one(self, url: str, key: str) -> dict[str, Any]:
        async def body(database: AsyncDatabase) -> Any:
            response = await get_spieler_by_id(spieler_id=SPIELER_OIDS[key], spieler_collection=database.spieler)

            return response.model_dump(mode="json", by_alias=True)

        return on_a_database(url, body)

    def test_the_one_player_read_serves_the_same_initial(self, seeded_url: str):
        """The second base-tier path, redacted by `public_initial` where the list is redacted by the pipeline."""
        assert self._read_one(seeded_url, "Mueller")["nachname"] == "M."

    def test_the_one_player_read_carries_no_leaving_date(self, seeded_url: str):
        """Against the RETIRED person, so a date really is stored and its absence from the wire is the redaction."""
        assert self._read_one(seeded_url, "Weber") == {
            "acknowledged": 1,
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

            await get_spieler(spieler_collection=database.spieler, saisons_collection=database.saisons, filters=_filters())
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
        # UNCONSTRAINED: `_legacy_squad_row` omits `ist_nachnominiert`, which the shipped validator
        # requires, so the row this corpus exists to serve is one a constrained database refuses --
        # it models a row already stored when the validator arrived.
        async with a_clean_database(mongo_url, DATABASE_NAME, constraints=False) as (_, database):
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
                    _squad_row("Mueller", nummer="7", position="Angriff", stufe="Q3", rolle="kapitaen"),
                    _squad_row("Adler", nummer="3", position="Abwehr", stufe="E1"),
                    _squad_row("Ohne", nummer=None, position=None, stufe=None),
                    _legacy_squad_row("Oeztuerk", nummer="5", position="Mittelfeld", stufe="Q1"),
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
class TestTheSquadReadNamingNoSeasonExecuted:
    """The squad page's own call, `?team_id=` and no season, against a club that played two seasons."""

    def _vornamen(self, url: str, filters: FLSpielerFilterParams) -> list[str]:
        async def body(database: AsyncDatabase) -> Any:
            invalidate_saison_cache()
            response = await get_spieler(spieler_collection=database.spieler, saisons_collection=database.saisons, filters=filters)

            return [row.vorname for row in response.spieler]

        return on_the_seed_loop(body(shared_client(url)[SQUAD_DATABASE_NAME]))

    def test_a_player_of_both_seasons_is_listed_once_and_one_of_the_past_season_alone_not_at_all(self, squad_url: str):
        assert self._vornamen(squad_url, FLSpielerFilterParams(team_id=TEAM_OID)) == ["Paula"]

    def test_the_past_season_named_still_lists_its_own_squad(self, squad_url: str):
        """The control: the corpus really holds the past season's second player and the row the default leaves out."""
        assert sorted(self._vornamen(squad_url, FLSpielerFilterParams(team_id=TEAM_OID, saison_id=PAST_SAISON))) == ["Paula", "Theo"]


@pytest.fixture(scope="module")
def squad_url(mongo_url: str) -> Iterator[str]:
    """Two seasons of one club: a player in both, and one who played the past season alone."""

    async def _seed() -> None:
        # UNCONSTRAINED: a season here carries only the `status` the read resolves on, and the
        # validator requires the whole of `rules` besides.
        async with a_clean_database(mongo_url, SQUAD_DATABASE_NAME, constraints=False) as (_, database):
            await database.saisons.insert_many([{"_id": SAISON, "status": "active"}, {"_id": PAST_SAISON, "status": "past"}])
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
    vorname: str | None
    nachname: str | None
    einwilligung: dict[str, Any]
    served_vorname: str | None
    served_nachname: str | None
    # False stores NO `vorname` key. The mask's published arm is `$vorname` itself, so such a row
    # leaves `$project` short of the key rather than carrying a null, which is a different shape.
    stores_a_vorname_key: bool = True


def _consent(umfang: str, *, bestaetigt_am: str | None = "2026-01-20", erteilt_von: str = "erziehungsberechtigt") -> dict[str, Any]:
    return {"umfang": umfang, "erteilt_von": erteilt_von, "datum": "2026-01-15", "bestaetigt_am": bestaetigt_am}


# Each served pair is written out rather than composed from `public_initial`, which would compare the
# redaction with itself. No forename holds a surname as a substring: one case greps the whole payload.
MASKED_SQUAD = {
    "Offen": MaskedRow(ObjectId("6890a1b2c3d4e5f607390031"), "Alina", "Falk", _consent("kader_oeffentlich"), "Alina", "F."),
    "Intern": MaskedRow(ObjectId("6890a1b2c3d4e5f607390032"), "Bruno", "Gerber", _consent("intern"), None, None),
    "Unbestaetigt": MaskedRow(
        ObjectId("6890a1b2c3d4e5f607390033"), "Carla", "Hoffmann", _consent("kader_oeffentlich", bestaetigt_am=None), None, None
    ),
    # The carry-over population owner step 13 counts, pinned at the state that count expects to find.
    "Uebernommen": MaskedRow(
        ObjectId("6890a1b2c3d4e5f607390034"), "Dario", "Jansen", _consent("kader_oeffentlich", erteilt_von="bestandsuebernahme"), "Dario", "J."
    ),
    # A row whose name is not stored at all, under a record that DOES publish: an absent name is not
    # a consent decision, and the mask must not invent one either way.
    "Namenlos": MaskedRow(ObjectId("6890a1b2c3d4e5f607390035"), None, None, _consent("kader_oeffentlich"), None, None),
    # The same person one write earlier: no `vorname` KEY rather than a stored null, which is what a
    # nameless row written past the validator looks like and what `$project` drops rather than nulls.
    "Schluessellos": MaskedRow(
        ObjectId("6890a1b2c3d4e5f607390036"), None, None, _consent("kader_oeffentlich"), None, None, stores_a_vorname_key=False
    ),
}

# Both names of both withheld rows: a payload grep on the surnames alone leaves the forename, which
# is the half `READ-PUPIL-001` never withheld and `READ-PUPIL-003` is the first rule to reach.
WITHHELD_NAMES = ("Bruno", "Gerber", "Carla", "Hoffmann")


@pytest.mark.db
class TestThePublicationGate:
    """`READ-PUPIL-003` over both base-tier reads, against a squad holding one row per state the predicate decides between."""

    def _read(self, url: str) -> dict[str, Any]:
        async def body(database: AsyncDatabase) -> Any:
            response = await get_spieler(
                spieler_collection=database.spieler,
                saisons_collection=database.saisons,
                filters=_filters(),
            )

            return response.model_dump(mode="json", by_alias=True)

        return _on_the_mask_database(url, body)

    def _by_id(self, url: str) -> dict[str, dict[str, Any]]:
        return {row["id"]: row for row in self._read(url)["spieler"]}

    def test_the_corpus_really_stores_the_names_and_the_records_the_cases_below_read(self, masked_url: str):
        """First: every case below would pass just as well against a corpus that stored no name to withhold."""

        async def body(database: AsyncDatabase) -> Any:
            return {person["_id"]: person for person in await database.spieler.find({}).to_list(None)}

        stored = _on_the_mask_database(masked_url, body)

        assert len(stored) == len(MASKED_SQUAD)
        for row in MASKED_SQUAD.values():
            assert (stored[row.oid].get("vorname"), stored[row.oid]["nachname"]) == (row.vorname, row.nachname)
            assert ("vorname" in stored[row.oid]) is row.stores_a_vorname_key
            assert stored[row.oid]["einwilligung"] == row.einwilligung

    def test_the_squad_serves_a_row_for_every_seeded_person(self, masked_url: str):
        """A withheld name is a nameless SLOT and never a missing row: `all` over a list a broken join emptied passes every case below."""
        assert len(self._by_id(masked_url)) == len(MASKED_SQUAD)

    @pytest.mark.parametrize("case", MASKED_SQUAD)
    def test_the_squad_serves_each_name_as_the_record_allows(self, masked_url: str, case: str):
        row = MASKED_SQUAD[case]
        served = self._by_id(masked_url)[str(row.oid)]

        assert (served["vorname"], served["nachname"]) == (row.served_vorname, row.served_nachname)

    @pytest.mark.parametrize("case", MASKED_SQUAD)
    def test_a_withheld_row_keeps_its_number_and_its_position(self, masked_url: str, case: str):
        """The mask reaches the two name fields, so the slot the person holds in the squad stands either way."""
        served = self._by_id(masked_url)[str(MASKED_SQUAD[case].oid)]

        assert (served["nummer"], served["position"]) == ("7", "Angriff")

    @pytest.mark.parametrize("name", WITHHELD_NAMES)
    def test_no_withheld_name_appears_anywhere_in_the_response(self, masked_url: str, name: str):
        """Against the SERIALISED body: what the page ships is the whole payload, not the part it renders."""
        assert name not in json.dumps(self._read(masked_url), ensure_ascii=False)

    def test_a_row_storing_no_forename_key_reaches_the_read_model_without_one(self, masked_url: str):
        """What the DEFAULT on `FLSpielerPublic.vorname` is for: a required field would 500 the whole squad over this one row."""

        async def body(database: AsyncDatabase) -> Any:
            rows = await aggregate_many_from_db(collection=database.spieler, pipeline=build_spieler_pipeline(_filters()))

            return {row["_id"]: row for row in rows}

        projected = _on_the_mask_database(masked_url, body)[MASKED_SQUAD["Schluessellos"].oid]

        assert "vorname" not in projected
        assert self._by_id(masked_url)[str(MASKED_SQUAD["Schluessellos"].oid)]["vorname"] is None

    @pytest.mark.parametrize("key", ["einwilligung", "umfang"])
    def test_no_row_carries_the_record_the_gate_read(self, masked_url: str, key: str):
        """The `$cond` reads it; a key of either name on the wire would put the consent decision itself on the page."""
        assert all(key not in served for served in self._by_id(masked_url).values())

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
            "acknowledged": 1,
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
        """A required forename on the list's shape would 500 the whole squad over one withheld row."""
        served = FLSpielerPublic.model_validate({"_id": MASKED_SQUAD["Intern"].oid, "vorname": None, "nachname": None})

        assert (served.vorname, served.nachname) == (None, None)


@pytest.fixture(scope="module")
def masked_url(mongo_url: str) -> Iterator[str]:
    """One squad in one season, holding a row for every consent state `READ-PUPIL-003` parts."""

    async def _seed() -> None:
        # UNCONSTRAINED: the `spieler` validator requires `vorname` as a string, so the nameless row
        # this corpus exists to serve is one a constrained database refuses.
        async with a_clean_database(mongo_url, MASK_DATABASE_NAME, constraints=False) as (_, database):
            await database.saisons.insert_one({"_id": SAISON, "status": "active"})
            await database.spieler.insert_many(
                [
                    {
                        "_id": row.oid,
                        **({"vorname": row.vorname} if row.stores_a_vorname_key else {}),
                        "nachname": row.nachname,
                        "inactive_since": None,
                        "einwilligung": row.einwilligung,
                    }
                    for row in MASKED_SQUAD.values()
                ]
            )
            await database.saison_spieler.insert_many(
                [{**_squad_row("Mueller", nummer="7", position="Angriff", stufe="Q3"), "spieler_id": row.oid} for row in MASKED_SQUAD.values()]
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

# Equal across the three rows, so every `sort_by` value falls through to the chain's `vorname` and
# each of the three is a way of asking the same question.
SORT_ORACLE_NUMMER = "7"
SORT_ORACLE_POSITION = "Angriff"


@pytest.mark.db
class TestTheOrderIsNoOracleForAWithheldName:
    """One squad seeded twice, differing only in the withheld row's stored forename: its place in the answer may not move with it."""

    def _served_ids(self, url: str, corpus: str, sort_by: str) -> list[str]:
        async def body(database: AsyncDatabase) -> Any:
            invalidate_saison_cache()
            response = await get_spieler(
                spieler_collection=database.spieler,
                saisons_collection=database.saisons,
                filters=FLSpielerFilterParams(team_id=TEAM_OID, saison_id=SAISON, sort_by=cast(Any, sort_by)),
            )

            return [str(row.id) for row in response.spieler]

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
        served = self._served_ids(sort_oracle_url, "first", "vorname")

        assert served.index(str(SORT_ORACLE_OIDS["Berger"])) < served.index(str(SORT_ORACLE_OIDS["Yilmaz"]))

    @pytest.mark.parametrize("sort_by", get_args(FLSpielerSortOptions))
    def test_the_withheld_row_holds_one_place_whatever_forename_it_stores(self, sort_oracle_url: str, sort_by: str):
        places = {
            corpus: self._served_ids(sort_oracle_url, corpus, sort_by).index(str(SORT_ORACLE_OIDS["Zurueckgehalten"]))
            for corpus in WITHHELD_FORENAMES
        }

        assert places["first"] == places["last"]


@pytest.fixture(scope="module")
def sort_oracle_url(mongo_url: str) -> Iterator[str]:
    """Two corpora, each one squad of three: two published rows and one the `intern` scope withholds."""

    async def _seed() -> None:
        for corpus, withheld_forename in WITHHELD_FORENAMES.items():
            # UNCONSTRAINED for `masked_url`'s reason, the corpora sharing its seeding shape.
            async with a_clean_database(mongo_url, SORT_ORACLE_DATABASE_NAMES[corpus], constraints=False) as (_, database):
                await database.saisons.insert_one({"_id": SAISON, "status": "active"})
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
        invalidate_saison_cache()

        return await body(shared_client(url)[MASK_DATABASE_NAME])

    return on_the_seed_loop(_run())


def on_a_database(url: str, body: Body) -> Any:
    async def _run() -> Any:
        # This corpus stores no season, so the read's gate finds none to withhold -- but the cache
        # behind it is process-global, and another test's entry under this id would answer here.
        invalidate_saison_cache()

        return await body(shared_client(url)[DATABASE_NAME])

    return on_the_seed_loop(_run())
