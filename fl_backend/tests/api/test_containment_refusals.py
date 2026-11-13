from collections.abc import Awaitable, Mapping
from typing import Any, Literal

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.saisons.services import find_saison_span_refusal
from app.api.schiedsrichter.admin_router import delete_schiedsrichter
from app.api.schiedsrichter.services import find_referee_retire_refusal
from app.api.spiele.services import (
    BookedSlot,
    find_clash_refusal,
    find_spiel_date_refusal,
)
from app.api.spieler.services import SquadRoom, find_full_squad_refusal
from app.api.spielorte.admin_router import delete_spielort
from app.api.spielorte.services import find_venue_retire_refusal
from app.api.spieltage.services import (
    find_spieltag_span_refusal,
)
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import schiedsrichter_document, spiel_document, spielort_document
from tests.worker import worker_database

SPAN = {"saison_start": "2026-03-01", "saison_end": "2026-09-30"}

# Every span in the containment class below is months long, so `saison_span_below_spielplan` passes.
SAISON_RULES = FLSaisonRules(
    number_of_gruppen=4,
    teams_per_gruppe=4,
    qualifiers_per_gruppe=2,
    win_points=3,
    draw_points=1,
    loss_points=0,
    tiebreak_order="tordifferenz",
    max_kader_size=18,
    forfeit_ergebnis=FLSaisonForfeitErgebnis(sieger_tore=3, verlierer_tore=0),
    allowed_stufen=["E1"],
)


class TestASpielSitsInsideItsMatchday:
    @pytest.mark.parametrize("date", ["2026-03-06", "2026-03-20"])
    def test_a_date_outside_is_refused(self, date):
        refusal = find_spiel_date_refusal(date=date, spieltag_start="2026-03-07", spieltag_end="2026-03-08")

        assert refusal is not None
        assert (refusal.error_code, refusal.fields) == (Code.SPIEL_OUTSIDE_SPIELTAG, (("date",),))


class TestAMatchdaySitsInsideItsSeason:
    def test_a_start_before_the_season_is_refused(self):
        refusal = find_spieltag_span_refusal(start="2026-02-28", end="2026-03-08", spiel_dates=[], **SPAN)

        assert refusal is not None
        assert refusal.error_code == Code.SPIELTAG_OUTSIDE_SAISON

    def test_an_end_after_the_season_is_refused(self):
        refusal = find_spieltag_span_refusal(start="2026-09-29", end="2026-10-01", spiel_dates=[], **SPAN)

        assert refusal is not None
        assert refusal.error_code == Code.SPIELTAG_OUTSIDE_SAISON


class TestASeasonKeepsCoveringItsMatchdays:
    """`spieltag_outside_saison` from the container's side: shrinking the season is the other way to break it."""

    def test_shrinking_below_a_matchday_is_refused(self):
        refusal = find_saison_span_refusal(
            start_date="2026-03-01",
            end_date="2026-09-01",
            rules=SAISON_RULES,
            spieltag_spans=[("2026-09-28", "2026-09-30")],
        )

        assert refusal is not None
        assert refusal.error_code == Code.SAISON_SPAN_BELOW_SPIELTAGE

    def test_a_matchday_starting_before_the_season_is_refused(self):
        """Both edges count: a matchday reaching out at the front is as stranded as one at the back."""

        refusal = find_saison_span_refusal(
            start_date="2026-03-08",
            end_date="2026-09-30",
            rules=SAISON_RULES,
            spieltag_spans=[("2026-03-07", "2026-03-09")],
        )

        assert refusal is not None
        assert refusal.error_code == Code.SAISON_SPAN_BELOW_SPIELTAGE


class TestASeasonIsLongEnoughForItsSchedule:
    """`schedule_for` says how many matchdays the competition takes and no two share a day, so the shortest legal season is that many days."""

    def test_one_day_short_is_refused_on_the_end_naming_the_earliest_that_fits(self):
        """The other side of the boundary, which an off-by-one would miss.

        Without its field and bound the editor's end box cannot say how long the season must run.
        """

        refusal = find_saison_span_refusal(start_date="2026-03-01", end_date="2026-03-05", rules=SAISON_RULES, spieltag_spans=[])

        assert refusal is not None
        assert (refusal.error_code, refusal.fields, refusal.bounds) == (
            Code.SAISON_SPAN_BELOW_SPIELPLAN,
            (("end_date",),),
            {"earliest": "2026-03-06"},
        )

    def test_the_floor_follows_the_rules_rather_than_a_constant(self):
        """The same span is legal under one rules set and refused under a wider one; a hardcoded floor could not tell them apart."""

        # `teams_per_gruppe` alone differs from `SAISON_RULES`, which is the figure the floor turns on.
        wider = FLSaisonRules(
            number_of_gruppen=4,
            teams_per_gruppe=6,
            qualifiers_per_gruppe=2,
            win_points=3,
            draw_points=1,
            loss_points=0,
            tiebreak_order="tordifferenz",
            max_kader_size=18,
            forfeit_ergebnis=FLSaisonForfeitErgebnis(sieger_tore=3, verlierer_tore=0),
            allowed_stufen=["E1"],
        )

        assert find_saison_span_refusal(start_date="2026-03-01", end_date="2026-03-06", rules=SAISON_RULES, spieltag_spans=[]) is None

        refusal = find_saison_span_refusal(start_date="2026-03-01", end_date="2026-03-06", rules=wider, spieltag_spans=[])
        assert refusal is not None
        assert refusal.error_code == Code.SAISON_SPAN_BELOW_SPIELPLAN


class TestAMatchdayKeepsCoveringItsSpiele:
    def test_shrinking_below_a_spiel_is_refused(self):
        """The mirror of `spiel_outside_spieltag`: the same containment, broken from the container's side."""

        refusal = find_spieltag_span_refusal(start="2026-03-07", end="2026-03-08", spiel_dates=["2026-03-20"], **SPAN)

        assert refusal is not None
        assert refusal.error_code == Code.SPIELTAG_SPAN_BELOW_SPIELE


OTHER_SAISON = "2025"


class TestOneVenueAndOneRefereeAtATime:
    # Annotated rather than inferred: a plain `str` default widens the parameter and `BookedSlot` refuses it.
    def slot(
        self,
        time: str,
        resource: Literal["Spielort", "Schiedsrichter"] = "Spielort",
        nr: int = 3,
        date: str = "2026-03-07",
    ) -> BookedSlot:
        return BookedSlot(spiel_id=ObjectId(), saison_id=OTHER_SAISON, spiel_nr=nr, date=date, time=time, resource=resource)

    @pytest.mark.parametrize("time", ["18:00:00", "21:59:00"])
    def test_inside_the_buffer_is_refused(self, time):
        refusal = find_clash_refusal(date="2026-03-07", time=time, booked=[self.slot("18:00:00")])

        assert refusal is not None
        assert refusal.error_code == Code.SPIEL_DOUBLE_BOOKED

    @pytest.mark.parametrize("time", ["14:00:00", "22:00:00"])
    def test_the_whole_buffer_apart_is_admitted(self, time):
        """The buffer is the gap two bookings need, so one exactly four hours from another is no clash."""

        assert find_clash_refusal(date="2026-03-07", time=time, booked=[self.slot("18:00:00")]) is None

    def test_it_works_in_both_directions(self):
        """A booking earlier and a booking later are the same clash — the comparison is absolute."""

        refusal = find_clash_refusal(date="2026-03-07", time="16:00:00", booked=[self.slot("18:00:00")])

        assert refusal is not None
        assert refusal.error_code == Code.SPIEL_DOUBLE_BOOKED


RETIRE_DATABASE = worker_database("fl_retire_booked_test")
RETIRED_SPIELORT = ObjectId("6890a1b2c3d4e5f607182931")
RETIRED_SCHIEDSRICHTER = ObjectId("6890a1b2c3d4e5f607182932")
RETIRED_ON = "2026-04-01"

PLAYED = {"team1": {"team_id": ObjectId(), "tore": 1}, "team2": {"team_id": ObjectId(), "tore": 0}, "ergebnis": "1:0"}
ABANDONED = {"sonderereignis": "abgebrochen"}
CALLED_OFF = {"sonderereignis": "ausgefallen"}


def booked_on(spiel_nr: int, **fields: Any) -> dict[str, Any]:
    """A fixture of the running season at the venue and with the referee being retired."""

    return spiel_document(
        spiel_id=ObjectId(),
        saison_id="2026",
        spiel_nr=spiel_nr,
        spieltag_id=ObjectId(),
        date="2026-05-09",
        time="18:00:00",
        spielort={"spielort_id": RETIRED_SPIELORT, "mietpreis": 80},
        schiedsrichter={"schiedsrichter_id": RETIRED_SCHIEDSRICHTER, "payment": 20},
        **fields,
    )


async def everything_written(database: AsyncDatabase) -> dict[str, list[Any]]:
    """Each collection's documents in `_id` order, so a stamp or a log row the refusal left behind shows."""

    return {name: await database[name].find({}, sort=[("_id", 1)]).to_list() for name in await database.list_collection_names()}


async def refusal_of(call: Awaitable[None]) -> tuple[str, Mapping[str, Any]]:
    """The code and the bounds a refused route answers; a retirement taken is a failure here."""

    with pytest.raises(APIError) as refused:
        await call

    return refused.value.error_code, refused.value.bounds


class TestRetiringAVenueOrAReferee:
    def test_an_upcoming_spiel_refuses_it_naming_the_spiele(self):
        """`retire_blocked`'s reasoning: retiring removes it from every picker while matches are scheduled against it.

        The refusal names the fixtures on the path's id, so the dialog says which to move: without them it names none, and
        nothing tells the administrator a number is missing.
        """

        spielort = find_venue_retire_refusal(upcoming_spiel_nrs=[3, 8])
        schiedsrichter = find_referee_retire_refusal(upcoming_spiel_nrs=[3, 8])

        assert spielort is not None and spielort.error_code == Code.SPIELORT_STILL_BOOKED
        assert schiedsrichter is not None and schiedsrichter.error_code == Code.SCHIEDSRICHTER_STILL_ASSIGNED
        for refusal, field in ((spielort, "spielort_id"), (schiedsrichter, "schiedsrichter_id")):
            assert (refusal.location, refusal.fields, refusal.bounds) == ("path", ((field,),), {"spiel_nrs": [3, 8], "count": 2})

    @pytest.mark.db
    def test_a_booking_still_to_play_refuses_the_route_naming_it_in_order_and_writes_nothing(self, mongo_replica_set_url: str):
        """Through each route's own read: retired anyway, the venue and the referee drop out of every picker while matches stand on them.

        Stored out of number order, an abandonment still owing its result among them, beside a played and a called-off
        fixture that hold neither back.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELORTE].insert_one(spielort_document(RETIRED_SPIELORT, "Sportpark Nord"))
            await database[Collection.SCHIEDSRICHTER].insert_one(
                schiedsrichter_document(
                    RETIRED_SCHIEDSRICHTER, email="pfiff@example.com", name="Pia Pfiff", default_payment=20, einwilligung=None
                )
            )
            await database[Collection.SPIELE].insert_many(
                [booked_on(spiel_nr, **fields) for spiel_nr, fields in ((8, {}), (3, ABANDONED), (5, PLAYED), (6, CALLED_OFF))]
            )
            before = await everything_written(database)
            refusals = [
                await refusal_of(
                    delete_spielort(
                        spielort_id=RETIRED_SPIELORT,
                        spielorte_collection=database[Collection.SPIELORTE],
                        spiele_collection=database[Collection.SPIELE],
                        db=client,
                        today=RETIRED_ON,
                    )
                ),
                await refusal_of(
                    delete_schiedsrichter(
                        schiedsrichter_id=RETIRED_SCHIEDSRICHTER,
                        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                        spiele_collection=database[Collection.SPIELE],
                        db=client,
                        today=RETIRED_ON,
                    )
                ),
            ]

            return refusals, before, await everything_written(database)

        async def seeded() -> Any:
            async with a_clean_database(mongo_replica_set_url, RETIRE_DATABASE) as (client, database):
                return await body(database, client)

        refusals, before, after = on_the_seed_loop(seeded())

        assert refusals == [
            (Code.SPIELORT_STILL_BOOKED, {"spiel_nrs": [3, 8], "count": 2}),
            (Code.SCHIEDSRICHTER_STILL_ASSIGNED, {"spiel_nrs": [3, 8], "count": 2}),
        ]
        assert after == before


class TestASquadCap:
    """`max_kader_size` is a season's rule, so the same club may run a larger squad in the next one."""

    def test_a_squad_over_the_cap_is_refused(self):
        """Reachable without a bug: narrowing a season's rules leaves the squads already entered under the old bound."""

        refusal = find_full_squad_refusal(room=SquadRoom(size=25, cap=18), nominee=False)

        assert refusal is not None
        assert refusal.error_code == Code.KADER_FULL
