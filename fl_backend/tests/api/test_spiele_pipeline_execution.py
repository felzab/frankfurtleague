from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.spiele.schemas import FLSpielJoined, FLSpielJoinedAdmin, FLSpielSchiedsrichterFieldPublic
from app.api.spiele.services import (
    ANSETZUNG_BESTAETIGT,
    EINSATZ_BESTAETIGT,
    NAME_IS_PUBLIC_KEY,
    SAISON_TEAMS_AS_NAME,
    SCHIEDSRICHTER_AS_NAME,
    SPIELBESTAETIGUNGEN_AS_NAME,
    build_spiele_pipeline,
)
from app.core.collections import Collection
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import own_einwilligung_document, schiedsrichter_document, spiel_document, spielbestaetigung_document
from tests.worker import worker_database

from .conftest import AUSTRITT, PRIOR_SAISON, SAISON, TEAM_OIDS, SeededLeague

pytestmark = pytest.mark.db

# Its own database: the verdict's cases write rows and move a fixture, and `league` is shared.
VERDICT_DATABASE = worker_database("fl_spiele_verdict_test")


def spiel(league: SeededLeague, spiel_nr: int, saison_id: str = SAISON) -> dict[str, Any]:
    documents = list(league.database.spiele.aggregate(build_spiele_pipeline(db_filter={"spiel_nr": spiel_nr, "saison_id": saison_id})))

    assert len(documents) == 1, f"expected exactly one match {spiel_nr} in {saison_id}, got {len(documents)}"
    return documents[0]


class TestTheJoinedDisqualification:
    def test_a_disqualified_side_carries_the_whole_record(self, league: SeededLeague) -> None:
        """The projection is the whole record; which half of it each read model declares is `test_spiele_public_read.py`'s subject."""

        assert spiel(league, 3)["team2"]["austritt"] == AUSTRITT

    def test_a_competing_side_carries_null(self, league: SeededLeague) -> None:
        """`null` is what not disqualified means, and there is no boolean anywhere."""

        assert spiel(league, 3)["team1"]["austritt"] is None

    def test_each_side_reads_its_own_row(self, league: SeededLeague) -> None:
        """One lookup serves both sides: a join matching rows by position rather than `team_id` still returns one record and one null."""

        match_3 = spiel(league, 3)

        assert match_3["team1"]["name"] == "Helmholtz"
        assert match_3["team1"]["austritt"] is None
        assert match_3["team2"]["name"] == "Lessing"
        assert match_3["team2"]["austritt"] == AUSTRITT

    def test_the_season_is_the_fixtures_own_and_not_a_resolved_one(self, league: SeededLeague) -> None:
        """Every match read runs this pipeline, so keying on `team_id` alone badges a match played before the decision."""

        match_8 = spiel(league, 8, saison_id=PRIOR_SAISON)

        assert match_8["team2"]["name"] == "Lessing"
        assert match_8["team2"]["austritt"] is None

    def test_a_side_whose_team_holds_no_row_for_the_season_carries_null(self, league: SeededLeague) -> None:
        """No junction row is no disqualification: that is `eligibility_team_not_in_saison`'s fact, and this field answers another one."""

        assert spiel(league, 8, saison_id=PRIOR_SAISON)["team1"]["austritt"] is None


class TestWhatTheMergeMustNotBreak:
    def test_an_unresolved_side_stays_null(self, league: SeededLeague) -> None:
        """An empty object would render as a resolved side with a blank name: every card reads `team?.name ?? formatQuelle(...)`."""

        assert spiel(league, 9)["team1"] is None

    def test_the_stored_keys_survive_the_merge(self, league: SeededLeague) -> None:
        """`$mergeObjects` adds one key; listing the stored ones instead would drop whatever it missed."""

        team2 = spiel(league, 9)["team2"]

        assert team2["team_id"] == TEAM_OIDS["Bock"]
        assert team2["name"] == "Bock"
        assert team2["tore"] is None

    def test_the_lookup_rows_do_not_reach_the_result(self, league: SeededLeague) -> None:
        """Pydantic ignores an undeclared key, so nothing else would report the junction travelling twice over."""

        assert SAISON_TEAMS_AS_NAME not in spiel(league, 3)


class TestTheFilterAndTheOrder:
    def test_the_filter_still_selects(self, league: SeededLeague) -> None:
        """The `$match` is the same document a `find` took, so the endpoints' parameters are unchanged."""

        db_filter = {"saison_id": SAISON, "sonderereignis": {"$ne": None}}
        eventful = list(league.database.spiele.aggregate(build_spiele_pipeline(db_filter=db_filter)))

        # Sorted rather than taken in pipeline order: with no `sort_by` the order is the storage engine's.
        assert sorted(document["spiel_nr"] for document in eventful) == [4, 10, 11, 13, 14]

    def test_the_sort_and_the_limit_run_before_the_join(self, league: SeededLeague) -> None:
        """Asserted through the result: a `$sort` after the `$limit` cuts the wrong fixtures, and both orders return three."""

        first_three = list(
            league.database.spiele.aggregate(build_spiele_pipeline(db_filter={"saison_id": SAISON}, sort_by=[("spiel_nr", 1)], limit=3))
        )

        assert [document["spiel_nr"] for document in first_three] == [1, 2, 3]

    def test_a_filter_matching_nothing_returns_nothing(self, league: SeededLeague) -> None:
        """The empty result is a list, which is why `get_spiel` raises its own 404 rather than reading a `None`."""

        assert list(league.database.spiele.aggregate(build_spiele_pipeline(db_filter={"_id": ObjectId()}))) == []


VERDICT_SPIEL_ID = ObjectId("6890a1b2c3d4e5f607250001")
VERDICT_HOME = ObjectId("6890a1b2c3d4e5f607250011")
VERDICT_AWAY = ObjectId("6890a1b2c3d4e5f607250012")
VERDICT_SPIELORT_ID = ObjectId("6890a1b2c3d4e5f607250021")

HOME_SIDE = {"team_id": VERDICT_HOME, "name": "Alpha", "shorthand": "ALX", "tore": None}
AWAY_SIDE = {"team_id": VERDICT_AWAY, "name": "Beta", "shorthand": "BEX", "tore": None}
GROUND = {"spielort_id": VERDICT_SPIELORT_ID, "name": "Sportplatz Ost", "maps_link": "Sportplatz Ost, Frankfurt", "mietpreis": 80}
OTHER_GROUND = {**GROUND, "spielort_id": ObjectId("6890a1b2c3d4e5f607250022")}

# One per Ansetzung value, the sides moving together since a fixture never holds one club twice.
MOVES: Mapping[str, Mapping[str, Any]] = {
    "the date": {"datum": "2026-05-09"},
    "the time": {"uhrzeit": "19:30:00"},
    "the ground": {"ort": OTHER_GROUND},
    "the ground removed": {"ort": None},
    "the sides swapped": {"team1": AWAY_SIDE, "team2": HOME_SIDE},
}

REFEREE = {"art": "schiedsrichter", "schiedsrichter_id": ObjectId("6890a1b2c3d4e5f607250031")}


def a_fixture(*, with_ground: bool = True) -> dict[str, Any]:
    return spiel_document(
        spiel_id=VERDICT_SPIEL_ID,
        saison_id=SAISON,
        spiel_nr=1,
        spieltag_id=ObjectId("6890a1b2c3d4e5f6072500a1"),
        team1=HOME_SIDE,
        team2=AWAY_SIDE,
        datum="2026-05-02",
        uhrzeit="18:00:00",
        ort=GROUND if with_ground else None,
    )


def zugesagt() -> dict[str, Any]:
    return {"art": "zugesagt", "am": "2026-04-20", "von": {"art": "kontakt", "rolle": "trainer"}, "vorschlag": None, "begruendung": None}


def a_row(fixture: Mapping[str, Any], team_id: ObjectId, **fields: Any) -> dict[str, Any]:
    return spielbestaetigung_document(fixture, party={"art": "team", "team_id": team_id}, **fields)


def discarded(fixture: Mapping[str, Any], team_id: ObjectId) -> dict[str, Any]:
    """A club's decline proposing another date, closed by the administrator's discard."""

    abgelehnt = {**zugesagt(), "art": "declined", "vorschlag": {"datum": "2026-05-03", "uhrzeit": "17:00:00"}, "begruendung": "Halle belegt"}

    return a_row(fixture, team_id, antwort=abgelehnt, closed={"am": "2026-04-21", "grund": "discarded"})


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_fixture(url: str, fixture: dict[str, Any], rows: list[dict[str, Any]], body: Body) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, VERDICT_DATABASE, constraints=True) as (_, database):
            await database[Collection.SPIELE].insert_one(fixture)
            if rows:
                await database[Collection.SPIELBESTAETIGUNGEN].insert_many(rows)

            return await body(database)

    return on_the_seed_loop(_run())


async def joined(database: AsyncDatabase) -> dict[str, Any]:
    cursor = await database[Collection.SPIELE].aggregate(build_spiele_pipeline(db_filter={"_id": VERDICT_SPIEL_ID}))
    (document,) = await cursor.to_list()

    return document


async def verdict(database: AsyncDatabase) -> bool | None:
    return (await joined(database))[ANSETZUNG_BESTAETIGT]


class TestTheVerdictReadsTheAnsetzungAsItStandsNow:
    @pytest.mark.parametrize("with_ground", [pytest.param(True, id="with a ground"), pytest.param(False, id="without a ground")])
    def test_both_clubs_agreeing_confirms_it(self, mongo_url: str, with_ground: bool):
        """Without a ground the row stores a null the fixture's path lacks: drop an `$ifNull` from the `let` and no such fixture confirms."""

        fixture = a_fixture(with_ground=with_ground)
        rows = [a_row(fixture, VERDICT_HOME, antwort=zugesagt()), a_row(fixture, VERDICT_AWAY, antwort=zugesagt())]

        document = on_a_fixture(mongo_url, fixture, rows, joined)

        assert document[ANSETZUNG_BESTAETIGT] is True
        assert SPIELBESTAETIGUNGEN_AS_NAME not in document

    def test_a_club_yet_to_answer_leaves_it_provisional(self, mongo_url: str):
        fixture = a_fixture()
        rows = [a_row(fixture, VERDICT_HOME, antwort=zugesagt()), a_row(fixture, VERDICT_AWAY)]

        assert on_a_fixture(mongo_url, fixture, rows, verdict) is False

    def test_an_answer_whose_row_closed_stops_counting(self, mongo_url: str):
        """A call-off closes the agreement and a reinstated fixture is asked afresh; read as open, it would go on confirming it."""

        fixture = a_fixture()
        rows = [
            a_row(fixture, VERDICT_HOME, antwort=zugesagt()),
            a_row(fixture, VERDICT_AWAY, antwort=zugesagt(), closed={"am": "2026-04-21", "grund": "abgesagt"}),
        ]

        assert on_a_fixture(mongo_url, fixture, rows, verdict) is False

    @pytest.mark.parametrize(
        "home",
        [pytest.param("zugesagt", id="beside the other club's agreement"), pytest.param("discarded", id="beside a second discard")],
    )
    def test_a_discarded_proposal_counts_as_its_clubs_agreement(self, mongo_url: str, home: str):
        """The league kept the date: a join of unclosed rows alone reads one club as never asked, or both as nobody."""

        fixture = a_fixture()
        rows = [
            a_row(fixture, VERDICT_HOME, antwort=zugesagt()) if home == "zugesagt" else discarded(fixture, VERDICT_HOME),
            discarded(fixture, VERDICT_AWAY),
        ]

        assert on_a_fixture(mongo_url, fixture, rows, verdict) is True

    def test_a_discard_about_an_ansetzung_the_fixture_has_left_counts_for_nothing(self, mongo_url: str):
        """The close never reaches a closed row, so a discard joined whatever its stand would hold the moved fixture provisional for good."""

        fixture = a_fixture()

        async def body(database: AsyncDatabase) -> bool | None:
            await database[Collection.SPIELE].update_one({"_id": VERDICT_SPIEL_ID}, {"$set": MOVES["the time"]})

            return await verdict(database)

        assert on_a_fixture(mongo_url, fixture, [discarded(fixture, VERDICT_AWAY)], body) is None

    @pytest.mark.parametrize("move", list(MOVES.values()), ids=list(MOVES))
    def test_a_moved_fixture_reads_as_provisional_in_the_very_next_read(self, mongo_url: str, move: Mapping[str, Any]):
        """No sweep runs, so both agreements stay open: a comparison missing a key reads its move as settled.

        And a join reading only the current Ansetzung's rows reads every move as never asked.
        """

        fixture = a_fixture()
        rows = [a_row(fixture, VERDICT_HOME, antwort=zugesagt()), a_row(fixture, VERDICT_AWAY, antwort=zugesagt())]

        async def body(database: AsyncDatabase) -> tuple[bool | None, bool | None]:
            before = await verdict(database)
            await database[Collection.SPIELE].update_one({"_id": VERDICT_SPIEL_ID}, {"$set": move})

            return before, await verdict(database)

        assert on_a_fixture(mongo_url, fixture, rows, body) == (True, False)

    def test_a_referees_open_row_never_holds_the_clubs_agreement_back(self, mongo_url: str):
        fixture = a_fixture()
        rows = [
            a_row(fixture, VERDICT_HOME, antwort=zugesagt()),
            a_row(fixture, VERDICT_AWAY, antwort=zugesagt()),
            spielbestaetigung_document(fixture, party=REFEREE),
        ]

        assert on_a_fixture(mongo_url, fixture, rows, verdict) is True

    def test_two_agreements_of_one_club_leave_it_provisional(self, mongo_url: str):
        """Nothing in the database stops a second open row once a club has answered: counting rows would confirm without the other club."""

        fixture = a_fixture()
        rows = [a_row(fixture, VERDICT_HOME, antwort=zugesagt()), a_row(fixture, VERDICT_HOME, antwort=zugesagt())]

        assert on_a_fixture(mongo_url, fixture, rows, verdict) is False

    @pytest.mark.parametrize(
        "parteien",
        [pytest.param([], id="no row at all"), pytest.param([REFEREE], id="a referee's row alone")],
    )
    def test_no_clubs_open_row_reads_as_never_asked(self, mongo_url: str, parteien: list[Mapping[str, Any]]):
        fixture = a_fixture()
        rows = [spielbestaetigung_document(fixture, party=partei) for partei in parteien]

        assert on_a_fixture(mongo_url, fixture, rows, verdict) is None


def test_the_confirmation_lookup_plans_an_index_scan(mongo_url: str):
    """Every fixture of the most-read endpoint runs the sub-pipeline once, a scan no test database of a few rows shows."""

    fixture = a_fixture()

    async def body(database: AsyncDatabase) -> Mapping[str, Any]:
        command = {"aggregate": str(Collection.SPIELE), "pipeline": build_spiele_pipeline(db_filter={"_id": VERDICT_SPIEL_ID}), "cursor": {}}
        explained = await database.command({"explain": command, "verbosity": "executionStats"})

        # The `$lookup` reports what its sub-pipeline used beside the stage itself.
        (stage,) = [stage for stage in explained["stages"] if stage.get("$lookup", {}).get("from") == Collection.SPIELBESTAETIGUNGEN]
        return stage

    stage = on_a_fixture(mongo_url, fixture, [a_row(fixture, VERDICT_HOME), a_row(fixture, VERDICT_AWAY)], body)

    assert (stage["indexesUsed"], stage["collectionScans"]) == (["spielbestaetigungen_saison_id_spiel_id"], 0), stage


# --- The REFEREE BLOCK: whether the booked referee agreed, then whether their name is published.

REFEREE_ID = REFEREE["schiedsrichter_id"]
# A referee booked before, whose row the next pass has not yet closed.
REPLACED_REFEREE = {"art": "schiedsrichter", "schiedsrichter_id": ObjectId("6890a1b2c3d4e5f607250032")}
REFEREE_NAME = "Ada Kern"
PUBLIC_REFEREE_NAME = "Ada K."

# Two rows of the booked referee in the order the pass minted them, which their ids carry.
EARLIER_ROW = ObjectId("6890a1b2c3d4e5f607250041")
LATER_ROW = ObjectId("6890a1b2c3d4e5f607250042")
DECLINED = {"art": "declined", "am": "2026-04-20", "von": {"art": "schiedsrichter"}, "vorschlag": None, "begruendung": "Verhindert"}
CLOSED_BY_THE_DECLINE = {"am": "2026-04-20", "grund": "schiedsrichter_declined"}
CLOSED_BY_A_MOVE = {"am": "2026-04-21", "grund": "ansetzung_changed"}


def published() -> dict[str, Any]:
    return own_einwilligung_document(text_version="v1", confirmed_at="2026-04-01")


def a_refereed_fixture(schiedsrichter_id: ObjectId = REFEREE_ID) -> dict[str, Any]:
    return {**a_fixture(), "schiedsrichter": {"schiedsrichter_id": schiedsrichter_id, "name": REFEREE_NAME, "payment": 20}}


def a_referee_row(fixture: Mapping[str, Any], party: Mapping[str, Any] = REFEREE, **fields: Any) -> dict[str, Any]:
    return spielbestaetigung_document(fixture, party=party, kontakte=None, **fields)


def on_a_refereed_fixture(
    url: str, rows: list[dict[str, Any]], body: Body, *, einwilligung: Mapping[str, Any] | None = None, fixture: dict[str, Any] | None = None
) -> Any:
    """The booked referee's own record beside the fixture, consenting to publication unless `einwilligung` says otherwise."""

    async def seeded(database: AsyncDatabase) -> Any:
        await database[Collection.SCHIEDSRICHTER].insert_one(
            schiedsrichter_document(
                REFEREE_ID, email="ada@example.com", name=REFEREE_NAME, default_payment=20, einwilligung=einwilligung or published()
            )
        )
        return await body(database)

    return on_a_fixture(url, fixture or a_refereed_fixture(), rows, seeded)


async def einsatz(database: AsyncDatabase) -> bool | None:
    return (await joined(database))["schiedsrichter"][EINSATZ_BESTAETIGT]


def withheld(document: Mapping[str, Any]) -> bool:
    """The verdict and the base model both: a case reading one alone passes with the other gate reverted."""

    return document["schiedsrichter"][EINSATZ_BESTAETIGT] is False and FLSpielJoined.model_validate(document).schiedsrichter is None


class TestTheRefereeIsServedOnceAgreed:
    """Two-valued, so a booking the pass has not reached, or asked and not agreed, names nobody."""

    @pytest.mark.parametrize("von", [{"art": "schiedsrichter"}, {"art": "admin"}], ids=["their own", "the league's"])
    def test_an_agreement_to_the_ansetzung_as_it_stands_serves_them(self, mongo_url: str, von: dict[str, Any]):
        fixture = a_refereed_fixture()
        rows = [a_referee_row(fixture, antwort={**zugesagt(), "von": von})]

        document = on_a_refereed_fixture(mongo_url, rows, joined, fixture=fixture)

        # The projection's pin: the join brings the verdict alone onto the block, never a field of the referee's record.
        assert set(document["schiedsrichter"]) == {"schiedsrichter_id", "name", "payment", NAME_IS_PUBLIC_KEY, EINSATZ_BESTAETIGT}
        assert document["schiedsrichter"][EINSATZ_BESTAETIGT] is True
        assert FLSpielJoined.model_validate(document).schiedsrichter == FLSpielSchiedsrichterFieldPublic.model_validate(
            {"schiedsrichter_id": REFEREE_ID, "name": REFEREE_NAME, "name_is_public": True}
        )
        assert SCHIEDSRICHTER_AS_NAME not in document

    def test_a_verdict_neither_true_nor_false_publishes_nobody(self, mongo_url: str):
        """The base model's own gate, so a join answering a third value again cannot publish the referee it never judged."""

        fixture = a_refereed_fixture()
        document = on_a_refereed_fixture(mongo_url, [a_referee_row(fixture, antwort=zugesagt())], joined, fixture=fixture)
        document["schiedsrichter"][EINSATZ_BESTAETIGT] = None

        assert FLSpielJoined.model_validate(document).schiedsrichter is None

    def test_a_fixture_too_far_out_to_have_been_asked_withholds_them(self, mongo_url: str):
        """No row at all: read as never asked and served, every booking the pass has not reached would publish its referee."""

        fixture = {**a_refereed_fixture(), "datum": "2026-12-12"}

        assert withheld(on_a_refereed_fixture(mongo_url, [], joined, fixture=fixture))

    def test_a_referee_booked_after_the_last_pass_withholds_them(self, mongo_url: str):
        """The referee replaced before them holds the only row, closed for the change; the booked one holds none yet."""

        fixture = a_refereed_fixture()
        rows = [a_referee_row(fixture, party=REPLACED_REFEREE, closed={"am": "2026-04-21", "grund": "schiedsrichter_switched"})]

        assert withheld(on_a_refereed_fixture(mongo_url, rows, joined, fixture=fixture))

    def test_a_request_closed_unanswered_withholds_them(self, mongo_url: str):
        fixture = a_refereed_fixture()
        rows = [a_referee_row(fixture, closed={"am": "2026-05-03", "grund": "spiel_past"})]

        assert withheld(on_a_refereed_fixture(mongo_url, rows, joined, fixture=fixture))

    def test_a_referee_asked_and_silent_is_withheld_whole_from_the_base_tier_alone(self, mongo_url: str):
        """The admin editor shows the assignment from the moment it is made, the validator being the base model's own."""

        fixture = a_refereed_fixture()
        document = on_a_refereed_fixture(mongo_url, [a_referee_row(fixture)], joined, fixture=fixture)

        assert document["schiedsrichter"][EINSATZ_BESTAETIGT] is False
        assert FLSpielJoined.model_validate(document).schiedsrichter is None
        admin = FLSpielJoinedAdmin.model_validate(document).schiedsrichter
        assert admin is not None and admin.name == REFEREE_NAME

    def test_an_agreement_to_an_ansetzung_the_fixture_left_withholds_them(self, mongo_url: str):
        """No pass between: the agreement stays open about the old slot, which counts as asked and not agreed, as a club's does."""

        fixture = a_refereed_fixture()
        rows = [a_referee_row(fixture, antwort=zugesagt())]

        async def body(database: AsyncDatabase) -> tuple[bool | None, bool | None]:
            before = await einsatz(database)
            await database[Collection.SPIELE].update_one({"_id": VERDICT_SPIEL_ID}, {"$set": {"uhrzeit": "19:30:00"}})

            return before, await einsatz(database)

        assert on_a_refereed_fixture(mongo_url, rows, body, fixture=fixture) == (True, False)

    def test_a_replaced_referees_open_row_is_not_the_booked_ones(self, mongo_url: str):
        fixture = a_refereed_fixture()
        rows = [a_referee_row(fixture, party=REPLACED_REFEREE)]

        assert on_a_refereed_fixture(mongo_url, rows, einsatz, fixture=fixture) is False

    def test_a_clubs_closed_row_never_counts_for_the_referee(self, mongo_url: str):
        """The join carries a club's discard for the clubs' verdict, and the gate's party term keeps it out of the referee's."""

        fixture = a_refereed_fixture()
        rows = [a_row(fixture, VERDICT_HOME, antwort=zugesagt(), closed={"am": "2026-04-21", "grund": "discarded"})]

        assert on_a_refereed_fixture(mongo_url, rows, einsatz, fixture=fixture) is False

    @pytest.mark.parametrize("moved", [False, True], ids=["about the slot as it stands", "about a slot the fixture left since"])
    def test_their_own_decline_as_their_latest_answer_withholds_them(self, mongo_url: str, moved: bool):
        """Re-booked after declining, they hold no open row until the next pass asks: read as never asked, they would show."""

        fixture = a_refereed_fixture()
        rows = [
            a_referee_row(fixture, _id=EARLIER_ROW, antwort={**zugesagt(), "von": {"art": "schiedsrichter"}}, closed=CLOSED_BY_A_MOVE),
            a_referee_row(fixture, _id=LATER_ROW, antwort=DECLINED, closed=CLOSED_BY_THE_DECLINE),
        ]

        async def body(database: AsyncDatabase) -> bool | None:
            if moved:
                await database[Collection.SPIELE].update_one({"_id": VERDICT_SPIEL_ID}, {"$set": {"uhrzeit": "19:30:00"}})

            return await einsatz(database)

        assert on_a_refereed_fixture(mongo_url, rows, body, fixture=fixture) is False

    @pytest.mark.parametrize(
        ("closed", "served"),
        [pytest.param(None, True, id="open"), pytest.param(CLOSED_BY_A_MOVE, False, id="closed by a move since")],
    )
    def test_an_answer_after_their_decline_is_read_as_any_other(self, mongo_url: str, closed: Any, served: bool):
        """Ordered by the pass-minted id: an answer read regardless of order would leave the old decline withholding them."""

        fixture = a_refereed_fixture()
        rows = [
            a_referee_row(fixture, _id=EARLIER_ROW, antwort=DECLINED, closed=CLOSED_BY_THE_DECLINE),
            a_referee_row(fixture, _id=LATER_ROW, antwort={**zugesagt(), "von": {"art": "schiedsrichter"}}, closed=closed),
        ]
        # The move the closing names, so the agreement is about a slot the fixture left.
        stored = fixture if closed is None else {**fixture, "uhrzeit": "19:30:00"}

        assert on_a_refereed_fixture(mongo_url, rows, einsatz, fixture=stored) is served

    def test_an_empty_slot_stays_null(self, mongo_url: str):
        """`$mergeObjects` onto a null slot builds an object: a booked referee with no id, which no reader can render."""

        fixture = {**a_fixture(), "schiedsrichter": None}

        assert on_a_refereed_fixture(mongo_url, [], joined, fixture=fixture)["schiedsrichter"] is None


class TestTheRefereesNameFollowsTheirConsent:
    """`READ-REFEREE-004`: served, the name is reduced where the referee published it and null otherwise."""

    def test_an_agreed_referee_publishing_internally_is_served_nameless_and_named_on_the_admin_tier(self, mongo_url: str):
        fixture = a_refereed_fixture()
        rows = [a_referee_row(fixture, antwort=zugesagt())]
        intern = {**published(), "umfang": "intern"}

        document = on_a_refereed_fixture(mongo_url, rows, joined, einwilligung=intern, fixture=fixture)

        served = FLSpielJoined.model_validate(document).schiedsrichter
        assert served is not None and (served.name, served.name_is_public) == (None, False)
        admin = FLSpielJoinedAdmin.model_validate(document).schiedsrichter
        assert admin is not None and (admin.schiedsrichter_id, admin.name) == (REFEREE_ID, REFEREE_NAME)

    def test_a_published_name_is_served_reduced(self, mongo_url: str):
        fixture = a_refereed_fixture()
        rows = [a_referee_row(fixture, antwort=zugesagt())]

        served = FLSpielJoined.model_validate(on_a_refereed_fixture(mongo_url, rows, joined, fixture=fixture)).schiedsrichter

        assert served is not None and served.name == PUBLIC_REFEREE_NAME

    def test_a_booking_no_record_answers_is_withheld(self, mongo_url: str):
        """The ghost's case and a join that stopped matching alike: nothing found never publishes."""

        fixture = a_refereed_fixture(schiedsrichter_id=GHOST_SCHIEDSRICHTER_ID)
        # Agreed, so the consent gate is the one withholding the name.
        rows = [a_referee_row(fixture, party={"art": "schiedsrichter", "schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID}, antwort=zugesagt())]

        document = on_a_refereed_fixture(mongo_url, rows, joined, fixture=fixture)

        assert document["schiedsrichter"][NAME_IS_PUBLIC_KEY] is False
        served = FLSpielJoined.model_validate(document).schiedsrichter
        assert served is not None and served.name is None


def test_the_referee_lookup_plans_an_index_scan(mongo_url: str):
    """Every fixture of the most-read endpoint runs the sub-pipeline once, matching one referee by `_id`."""

    async def body(database: AsyncDatabase) -> Mapping[str, Any]:
        command = {"aggregate": str(Collection.SPIELE), "pipeline": build_spiele_pipeline(db_filter={"_id": VERDICT_SPIEL_ID}), "cursor": {}}
        explained = await database.command({"explain": command, "verbosity": "executionStats"})

        (stage,) = [stage for stage in explained["stages"] if stage.get("$lookup", {}).get("from") == Collection.SCHIEDSRICHTER]
        return stage

    stage = on_a_refereed_fixture(mongo_url, [], body)

    assert (stage["indexesUsed"], stage["collectionScans"]) == (["_id_"], 0), stage
