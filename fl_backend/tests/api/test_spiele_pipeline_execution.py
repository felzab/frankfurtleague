from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.spiele.schemas import FLSpielJoined, FLSpielJoinedAdmin
from app.api.spiele.services import (
    ANSETZUNG_CONFIRMED,
    EINSATZ_CONFIRMED,
    NAME_IS_PUBLIC_KEY,
    SPIELBESTAETIGUNGEN_AS_NAME,
    build_spiele_pipeline,
)
from app.core.collections import Collection
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import (
    ADDRESS,
    SCHIEDSRICHTER_TEXT_VERSIONS,
    own_einwilligung_document,
    saison_team_document,
    schiedsrichter_document,
    spiel_document,
    spielbestaetigung_document,
)
from tests.worker import worker_database

from .conftest import PRIOR_SAISON, SAISON, TEAM_OIDS, SeededLeague

pytestmark = pytest.mark.db

# Its own database: the verdict's cases write rows and move a fixture, and `league` is shared.
VERDICT_DATABASE = worker_database("fl_spiele_verdict_test")


def spiel(league: SeededLeague, spiel_nr: int, saison_id: str = SAISON) -> dict[str, Any]:
    documents = list(league.database.spiele.aggregate(build_spiele_pipeline(db_filter={"spiel_nr": spiel_nr, "saison_id": saison_id})))

    assert len(documents) == 1, f"expected exactly one match {spiel_nr} in {saison_id}, got {len(documents)}"
    return documents[0]


class TestTheJoinedDisqualification:
    def test_the_season_is_the_spiele_own_and_not_a_resolved_one(self, league: SeededLeague) -> None:
        """Every match read runs this pipeline, so keying on `team_id` alone badges a match played before the decision.

        And names it as the club is called now, where a past season keeps the name it was played under.
        """

        match_8 = spiel(league, 8, saison_id=PRIOR_SAISON)

        assert match_8["team2"]["name"] == "Lessing 2025"
        assert match_8["team2"]["austritt"] is None


class TestWhatTheMergeMustNotBreak:
    def test_the_stored_keys_survive_the_merge(self, league: SeededLeague) -> None:
        """`$mergeObjects` adds one key; listing the stored ones instead would drop whatever it missed."""

        team2 = spiel(league, 9)["team2"]

        assert team2["team_id"] == TEAM_OIDS["Bock"]
        assert team2["name"] == "Bock"
        assert team2["tore"] is None


VERDICT_SPIEL_ID = ObjectId("6890a1b2c3d4e5f607250001")
VERDICT_HOME = ObjectId("6890a1b2c3d4e5f607250011")
VERDICT_AWAY = ObjectId("6890a1b2c3d4e5f607250012")
VERDICT_SPIELORT_ID = ObjectId("6890a1b2c3d4e5f607250021")

# As `spiele` stores them, no name among them: every read joins the names, which these cases leave unread.
HOME_SIDE = {"team_id": VERDICT_HOME, "tore": None}
AWAY_SIDE = {"team_id": VERDICT_AWAY, "tore": None}
GROUND = {"spielort_id": VERDICT_SPIELORT_ID, "mietpreis": 80}
OTHER_GROUND = {**GROUND, "spielort_id": ObjectId("6890a1b2c3d4e5f607250022")}

# One per Ansetzung value, the sides moving together since a fixture never holds one club twice.
MOVES: Mapping[str, Mapping[str, Any]] = {
    "the date": {"date": "2026-05-09"},
    "the time": {"time": "19:30:00"},
    "the ground": {"spielort": OTHER_GROUND},
    "the ground removed": {"spielort": None},
    "the sides swapped": {"team1": AWAY_SIDE, "team2": HOME_SIDE},
}

REFEREE = {"kind": "schiedsrichter", "schiedsrichter_id": ObjectId("6890a1b2c3d4e5f607250031")}


def a_spiel(*, with_ground: bool = True) -> dict[str, Any]:
    return spiel_document(
        spiel_id=VERDICT_SPIEL_ID,
        saison_id=SAISON,
        spiel_nr=1,
        spieltag_id=ObjectId("6890a1b2c3d4e5f6072500a1"),
        team1=HOME_SIDE,
        team2=AWAY_SIDE,
        date="2026-05-02",
        time="18:00:00",
        spielort=GROUND if with_ground else None,
    )


def zugesagt() -> dict[str, Any]:
    return {"kind": "zugesagt", "at": "2026-04-20", "by": {"kind": "kontakt", "rolle": "trainer"}, "vorschlag": None, "reason": None}


def a_row(spiel: Mapping[str, Any], team_id: ObjectId, **fields: Any) -> dict[str, Any]:
    return spielbestaetigung_document(spiel, party={"kind": "team", "team_id": team_id}, **fields)


def discarded(spiel: Mapping[str, Any], team_id: ObjectId) -> dict[str, Any]:
    """A club's decline proposing another date, closed by the administrator's discard."""

    declined = {**zugesagt(), "kind": "declined", "vorschlag": {"date": "2026-05-03", "time": "17:00:00"}, "reason": "Halle belegt"}

    return a_row(spiel, team_id, answer=declined, closed={"at": "2026-04-21", "reason": "discarded"})


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def venue_document(name: str = "Sportplatz Ost") -> dict[str, Any]:
    return {
        "_id": VERDICT_SPIELORT_ID,
        "name": name,
        "address": dict(ADDRESS),
        "maps_link": f"{name}, Frankfurt",
        "default_mietpreis": 80,
        "inactive_since": None,
    }


def on_a_spiel(url: str, spiel: dict[str, Any], rows: list[dict[str, Any]], body: Body) -> Any:
    """The fixture beside the rows every read joins its names from: its clubs' season rows and its ground."""

    async def _run() -> Any:
        async with a_clean_database(url, VERDICT_DATABASE, constraints=True) as (_, database):
            await database[Collection.SAISON_TEAMS].insert_many(
                [saison_team_document(SAISON, VERDICT_HOME, "Alpha", "ALX"), saison_team_document(SAISON, VERDICT_AWAY, "Beta", "BEX")]
            )
            await database[Collection.SPIELORTE].insert_one(venue_document())
            await database[Collection.SPIELE].insert_one(spiel)
            if rows:
                await database[Collection.SPIELBESTAETIGUNGEN].insert_many(rows)

            return await body(database)

    return on_the_seed_loop(_run())


async def joined(database: AsyncDatabase) -> dict[str, Any]:
    cursor = await database[Collection.SPIELE].aggregate(build_spiele_pipeline(db_filter={"_id": VERDICT_SPIEL_ID}))
    (document,) = await cursor.to_list()

    return document


async def verdict(database: AsyncDatabase) -> bool | None:
    return (await joined(database))[ANSETZUNG_CONFIRMED]


class TestASpielNamesItsVenueAsItIsCalledNow:
    def test_a_venue_renamed_after_a_past_spiel_shows_its_new_name_there(self, mongo_url: str):
        """A copy stored on the fixture would go on naming the ground as it was called before the rename."""

        spiel = {**a_spiel(), "date": "2025-09-20", "spielort": {"spielort_id": VERDICT_SPIELORT_ID, "mietpreis": 80}}

        async def body(database: AsyncDatabase) -> Mapping[str, Any]:
            await database[Collection.SPIELORTE].update_one(
                {"_id": VERDICT_SPIELORT_ID}, {"$set": {"name": "Sporthalle Ost", "maps_link": "Sporthalle Ost, Frankfurt"}}
            )
            return (await joined(database))["spielort"]

        spielort = on_a_spiel(mongo_url, spiel, [], body)

        assert spielort == {
            "spielort_id": VERDICT_SPIELORT_ID,
            "mietpreis": 80,
            "name": "Sporthalle Ost",
            "maps_link": "Sporthalle Ost, Frankfurt",
        }


class TestTheVerdictReadsTheAnsetzungAsItStandsNow:
    @pytest.mark.parametrize("with_ground", [pytest.param(True, id="with a ground"), pytest.param(False, id="without a ground")])
    def test_both_clubs_agreeing_confirms_it(self, mongo_url: str, with_ground: bool):
        """Without a ground the row stores a null the fixture's path lacks: drop an `$ifNull` from the `let` and no such fixture confirms."""

        spiel = a_spiel(with_ground=with_ground)
        rows = [a_row(spiel, VERDICT_HOME, answer=zugesagt()), a_row(spiel, VERDICT_AWAY, answer=zugesagt())]

        document = on_a_spiel(mongo_url, spiel, rows, joined)

        assert document[ANSETZUNG_CONFIRMED] is True
        assert SPIELBESTAETIGUNGEN_AS_NAME not in document

    def test_a_club_yet_to_answer_leaves_it_provisional(self, mongo_url: str):
        spiel = a_spiel()
        rows = [a_row(spiel, VERDICT_HOME, answer=zugesagt()), a_row(spiel, VERDICT_AWAY)]

        assert on_a_spiel(mongo_url, spiel, rows, verdict) is False

    def test_an_answer_whose_row_closed_stops_counting(self, mongo_url: str):
        """A call-off closes the agreement and a reinstated fixture is asked afresh; read as open, it would go on confirming it."""

        spiel = a_spiel()
        rows = [
            a_row(spiel, VERDICT_HOME, answer=zugesagt()),
            a_row(spiel, VERDICT_AWAY, answer=zugesagt(), closed={"at": "2026-04-21", "reason": "cancelled"}),
        ]

        assert on_a_spiel(mongo_url, spiel, rows, verdict) is False

    @pytest.mark.parametrize(
        "home",
        [pytest.param("zugesagt", id="beside the other club's agreement"), pytest.param("discarded", id="beside a second discard")],
    )
    def test_a_discarded_proposal_counts_as_its_clubs_agreement(self, mongo_url: str, home: str):
        """The league kept the date: a join of unclosed rows alone reads one club as never asked, or both as nobody."""

        spiel = a_spiel()
        rows = [
            a_row(spiel, VERDICT_HOME, answer=zugesagt()) if home == "zugesagt" else discarded(spiel, VERDICT_HOME),
            discarded(spiel, VERDICT_AWAY),
        ]

        assert on_a_spiel(mongo_url, spiel, rows, verdict) is True

    def test_a_discard_about_an_ansetzung_the_spiel_has_left_counts_for_nothing(self, mongo_url: str):
        """The close never reaches a closed row, so a discard joined whatever its stand would hold the moved fixture provisional for good."""

        spiel = a_spiel()

        async def body(database: AsyncDatabase) -> bool | None:
            await database[Collection.SPIELE].update_one({"_id": VERDICT_SPIEL_ID}, {"$set": MOVES["the time"]})

            return await verdict(database)

        assert on_a_spiel(mongo_url, spiel, [discarded(spiel, VERDICT_AWAY)], body) is None

    @pytest.mark.parametrize("move", list(MOVES.values()), ids=list(MOVES))
    def test_a_moved_spiel_reads_as_provisional_in_the_very_next_read(self, mongo_url: str, move: Mapping[str, Any]):
        """No sweep runs, so both agreements stay open: a comparison missing a key reads its move as settled.

        And a join reading only the current Ansetzung's rows reads every move as never asked.
        """

        spiel = a_spiel()
        rows = [a_row(spiel, VERDICT_HOME, answer=zugesagt()), a_row(spiel, VERDICT_AWAY, answer=zugesagt())]

        async def body(database: AsyncDatabase) -> tuple[bool | None, bool | None]:
            before = await verdict(database)
            await database[Collection.SPIELE].update_one({"_id": VERDICT_SPIEL_ID}, {"$set": move})

            return before, await verdict(database)

        assert on_a_spiel(mongo_url, spiel, rows, body) == (True, False)

    def test_a_referees_open_row_never_holds_the_clubs_agreement_back(self, mongo_url: str):
        spiel = a_spiel()
        rows = [
            a_row(spiel, VERDICT_HOME, answer=zugesagt()),
            a_row(spiel, VERDICT_AWAY, answer=zugesagt()),
            spielbestaetigung_document(spiel, party=REFEREE),
        ]

        assert on_a_spiel(mongo_url, spiel, rows, verdict) is True

    def test_two_agreements_of_one_club_leave_it_provisional(self, mongo_url: str):
        """Nothing in the database stops a second open row once a club has answered: counting rows would confirm without the other club."""

        spiel = a_spiel()
        rows = [a_row(spiel, VERDICT_HOME, answer=zugesagt()), a_row(spiel, VERDICT_HOME, answer=zugesagt())]

        assert on_a_spiel(mongo_url, spiel, rows, verdict) is False

    @pytest.mark.parametrize(
        "parties",
        [pytest.param([], id="no row at all"), pytest.param([REFEREE], id="a referee's row alone")],
    )
    def test_no_clubs_open_row_reads_as_never_asked(self, mongo_url: str, parties: list[Mapping[str, Any]]):
        spiel = a_spiel()
        rows = [spielbestaetigung_document(spiel, party=party) for party in parties]

        assert on_a_spiel(mongo_url, spiel, rows, verdict) is None


def test_the_confirmation_lookup_plans_an_index_scan(mongo_url: str):
    """Every fixture of the most-read endpoint runs the sub-pipeline once, a scan no test database of a few rows shows."""

    spiel = a_spiel()

    async def body(database: AsyncDatabase) -> Mapping[str, Any]:
        command = {"aggregate": str(Collection.SPIELE), "pipeline": build_spiele_pipeline(db_filter={"_id": VERDICT_SPIEL_ID}), "cursor": {}}
        explained = await database.command({"explain": command, "verbosity": "executionStats"})

        # The `$lookup` reports what its sub-pipeline used beside the stage itself.
        (stage,) = [stage for stage in explained["stages"] if stage.get("$lookup", {}).get("from") == Collection.SPIELBESTAETIGUNGEN]
        return stage

    stage = on_a_spiel(mongo_url, spiel, [a_row(spiel, VERDICT_HOME), a_row(spiel, VERDICT_AWAY)], body)

    assert (stage["indexesUsed"], stage["collectionScans"]) == (["spielbestaetigungen_saison_id_spiel_id"], 0), stage


# --- The REFEREE BLOCK: whether the booked referee agreed, then whether their name is published.

REFEREE_ID = REFEREE["schiedsrichter_id"]
# A referee booked before, whose row the next pass has not yet closed.
REPLACED_REFEREE = {"kind": "schiedsrichter", "schiedsrichter_id": ObjectId("6890a1b2c3d4e5f607250032")}
REFEREE_NAME = "Ada Kern"
PUBLIC_REFEREE_NAME = "Ada K."

# Two rows of the booked referee in the order the pass minted them, which their ids carry.
EARLIER_ROW = ObjectId("6890a1b2c3d4e5f607250041")
LATER_ROW = ObjectId("6890a1b2c3d4e5f607250042")
DECLINED = {"kind": "declined", "at": "2026-04-20", "by": {"kind": "schiedsrichter"}, "vorschlag": None, "reason": "Verhindert"}
CLOSED_BY_THE_DECLINE = {"at": "2026-04-20", "reason": "schiedsrichter_declined"}
CLOSED_BY_A_MOVE = {"at": "2026-04-21", "reason": "ansetzung_changed"}


def published() -> dict[str, Any]:
    return own_einwilligung_document(text_versions=SCHIEDSRICHTER_TEXT_VERSIONS, confirmed_at="2026-04-01")


def a_refereed_spiel(schiedsrichter_id: ObjectId = REFEREE_ID) -> dict[str, Any]:
    # The booking as stored: the name served beside it is the referee row's, joined at read.
    return {**a_spiel(), "schiedsrichter": {"schiedsrichter_id": schiedsrichter_id, "payment": 20}}


def a_referee_row(spiel: Mapping[str, Any], party: Mapping[str, Any] = REFEREE, **fields: Any) -> dict[str, Any]:
    return spielbestaetigung_document(spiel, party=party, kontakte=None, **fields)


def on_a_refereed_spiel(
    url: str, rows: list[dict[str, Any]], body: Body, *, einwilligung: Mapping[str, Any] | None = None, spiel: dict[str, Any] | None = None
) -> Any:
    """The booked referee's own record beside the fixture, consenting to publication unless `einwilligung` says otherwise."""

    async def seeded(database: AsyncDatabase) -> Any:
        await database[Collection.SCHIEDSRICHTER].insert_one(
            schiedsrichter_document(
                REFEREE_ID, email="ada@example.com", name=REFEREE_NAME, default_payment=20, einwilligung=einwilligung or published()
            )
        )
        return await body(database)

    return on_a_spiel(url, spiel or a_refereed_spiel(), rows, seeded)


async def einsatz(database: AsyncDatabase) -> bool | None:
    return (await joined(database))["schiedsrichter"][EINSATZ_CONFIRMED]


def withheld(document: Mapping[str, Any]) -> bool:
    """The verdict and the base model both: a case reading one alone passes with the other gate reverted."""

    return document["schiedsrichter"][EINSATZ_CONFIRMED] is False and FLSpielJoined.model_validate(document).schiedsrichter is None


class TestTheRefereeIsServedOnceAgreed:
    """Two-valued, so a booking the pass has not reached, or asked and not agreed, names nobody."""

    def test_a_verdict_neither_true_nor_false_publishes_nobody(self, mongo_url: str):
        """The base model's own gate, so a join answering a third value again cannot publish the referee it never judged."""

        spiel = a_refereed_spiel()
        document = on_a_refereed_spiel(mongo_url, [a_referee_row(spiel, answer=zugesagt())], joined, spiel=spiel)
        document["schiedsrichter"][EINSATZ_CONFIRMED] = None

        assert FLSpielJoined.model_validate(document).schiedsrichter is None

    def test_a_spiel_too_far_out_to_have_been_asked_withholds_them(self, mongo_url: str):
        """No row at all: read as never asked and served, every booking the pass has not reached would publish its referee."""

        spiel = {**a_refereed_spiel(), "date": "2026-12-12"}

        assert withheld(on_a_refereed_spiel(mongo_url, [], joined, spiel=spiel))

    def test_a_referee_booked_after_the_last_pass_withholds_them(self, mongo_url: str):
        """The referee replaced before them holds the only row, closed for the change; the booked one holds none yet."""

        spiel = a_refereed_spiel()
        rows = [a_referee_row(spiel, party=REPLACED_REFEREE, closed={"at": "2026-04-21", "reason": "schiedsrichter_switched"})]

        assert withheld(on_a_refereed_spiel(mongo_url, rows, joined, spiel=spiel))

    def test_a_request_closed_unanswered_withholds_them(self, mongo_url: str):
        spiel = a_refereed_spiel()
        rows = [a_referee_row(spiel, closed={"at": "2026-05-03", "reason": "spiel_past"})]

        assert withheld(on_a_refereed_spiel(mongo_url, rows, joined, spiel=spiel))

    def test_a_referee_asked_and_silent_is_withheld_whole_from_the_base_tier_alone(self, mongo_url: str):
        """The admin editor shows the assignment from the moment it is made, the validator being the base model's own."""

        spiel = a_refereed_spiel()
        document = on_a_refereed_spiel(mongo_url, [a_referee_row(spiel)], joined, spiel=spiel)

        assert document["schiedsrichter"][EINSATZ_CONFIRMED] is False
        assert FLSpielJoined.model_validate(document).schiedsrichter is None
        admin = FLSpielJoinedAdmin.model_validate(document).schiedsrichter
        assert admin is not None and admin.name == REFEREE_NAME

    def test_an_agreement_to_an_ansetzung_the_spiel_left_withholds_them(self, mongo_url: str):
        """No pass between: the agreement stays open about the old slot, which counts as asked and not agreed, as a club's does."""

        spiel = a_refereed_spiel()
        rows = [a_referee_row(spiel, answer=zugesagt())]

        async def body(database: AsyncDatabase) -> tuple[bool | None, bool | None]:
            before = await einsatz(database)
            await database[Collection.SPIELE].update_one({"_id": VERDICT_SPIEL_ID}, {"$set": {"time": "19:30:00"}})

            return before, await einsatz(database)

        assert on_a_refereed_spiel(mongo_url, rows, body, spiel=spiel) == (True, False)

    def test_a_replaced_referees_open_row_is_not_the_booked_ones(self, mongo_url: str):
        spiel = a_refereed_spiel()
        rows = [a_referee_row(spiel, party=REPLACED_REFEREE)]

        assert on_a_refereed_spiel(mongo_url, rows, einsatz, spiel=spiel) is False

    def test_a_clubs_closed_row_never_counts_for_the_referee(self, mongo_url: str):
        """The join carries a club's discard for the clubs' verdict, and the gate's party term keeps it out of the referee's."""

        spiel = a_refereed_spiel()
        rows = [a_row(spiel, VERDICT_HOME, answer=zugesagt(), closed={"at": "2026-04-21", "reason": "discarded"})]

        assert on_a_refereed_spiel(mongo_url, rows, einsatz, spiel=spiel) is False

    @pytest.mark.parametrize("moved", [False, True], ids=["about the slot as it stands", "about a slot the fixture left since"])
    def test_their_own_decline_as_their_latest_answer_withholds_them(self, mongo_url: str, moved: bool):
        """Re-booked after declining, they hold no open row until the next pass asks: read as never asked, they would show."""

        spiel = a_refereed_spiel()
        rows = [
            a_referee_row(spiel, _id=EARLIER_ROW, answer={**zugesagt(), "by": {"kind": "schiedsrichter"}}, closed=CLOSED_BY_A_MOVE),
            a_referee_row(spiel, _id=LATER_ROW, answer=DECLINED, closed=CLOSED_BY_THE_DECLINE),
        ]

        async def body(database: AsyncDatabase) -> bool | None:
            if moved:
                await database[Collection.SPIELE].update_one({"_id": VERDICT_SPIEL_ID}, {"$set": {"time": "19:30:00"}})

            return await einsatz(database)

        assert on_a_refereed_spiel(mongo_url, rows, body, spiel=spiel) is False

    def test_their_latest_answer_about_a_slot_the_spiel_left_withholds_them(self, mongo_url: str):
        """The pass closed the agreement for the move: read without its stand, it publishes a referee who never agreed to this slot."""

        spiel = a_refereed_spiel()
        rows = [
            a_referee_row(spiel, _id=EARLIER_ROW, answer=DECLINED, closed=CLOSED_BY_THE_DECLINE),
            a_referee_row(spiel, _id=LATER_ROW, answer={**zugesagt(), "by": {"kind": "schiedsrichter"}}, closed=CLOSED_BY_A_MOVE),
        ]
        # The move the closing names, so the agreement is about a slot the fixture left.
        moved = {**spiel, "time": "19:30:00"}

        assert on_a_refereed_spiel(mongo_url, rows, einsatz, spiel=moved) is False


class TestTheRefereesNameFollowsTheirConsent:
    """`READ-REFEREE-004`: served, the name is reduced where the referee published it and null otherwise."""

    def test_an_agreed_referee_publishing_internally_is_served_nameless_and_named_on_the_admin_tier(self, mongo_url: str):
        spiel = a_refereed_spiel()
        rows = [a_referee_row(spiel, answer=zugesagt())]
        internal = {**published(), "scope": "internal"}

        document = on_a_refereed_spiel(mongo_url, rows, joined, einwilligung=internal, spiel=spiel)

        served = FLSpielJoined.model_validate(document).schiedsrichter
        assert served is not None and (served.name, served.name_is_public) == (None, False)
        admin = FLSpielJoinedAdmin.model_validate(document).schiedsrichter
        assert admin is not None and (admin.schiedsrichter_id, admin.name) == (REFEREE_ID, REFEREE_NAME)

    def test_a_published_name_is_served_reduced(self, mongo_url: str):
        spiel = a_refereed_spiel()
        rows = [a_referee_row(spiel, answer=zugesagt())]

        served = FLSpielJoined.model_validate(on_a_refereed_spiel(mongo_url, rows, joined, spiel=spiel)).schiedsrichter

        assert served is not None and served.name == PUBLIC_REFEREE_NAME

    def test_a_booking_no_record_answers_is_withheld(self, mongo_url: str):
        """The ghost's case and a join that stopped matching alike: nothing found never publishes."""

        spiel = a_refereed_spiel(schiedsrichter_id=GHOST_SCHIEDSRICHTER_ID)
        # Agreed, so the consent gate is the one withholding the name.
        rows = [a_referee_row(spiel, party={"kind": "schiedsrichter", "schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID}, answer=zugesagt())]

        document = on_a_refereed_spiel(mongo_url, rows, joined, spiel=spiel)

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

    stage = on_a_refereed_spiel(mongo_url, [], body)

    assert (stage["indexesUsed"], stage["collectionScans"]) == (["_id_"], 0), stage
