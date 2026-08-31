import inspect
from typing import Literal

import pytest
from bson import ObjectId

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.saisons.services import SAISON_SPAN_BELOW_SCHEDULE, SAISON_SPAN_BELOW_SPIELTAGE, find_saison_span_refusal
from app.api.schiedsrichter.services import REFEREE_STILL_ASSIGNED, find_referee_retire_refusal
from app.api.spiele.services import (
    CLASH_BUFFER_MINUTES,
    FIXTURE_DOUBLE_BOOKED,
    FIXTURE_OUTSIDE_SPIELTAG,
    BookedSlot,
    find_clash_refusal,
    find_fixture_date_refusal,
)
from app.api.spieler.services import (
    SQUAD_FULL,
    SQUAD_ROLLE_TAKEN,
    SQUAD_TEAM_NOT_IN_SAISON,
    build_live_rolle_filter,
    build_live_squad_filter,
    find_squad_capacity_refusal,
    find_squad_refusal,
    find_squad_rolle_refusal,
)
from app.api.spielorte.services import VENUE_STILL_BOOKED, find_venue_retire_refusal
from app.api.spieltage.services import (
    SPIELTAG_OUTSIDE_SAISON,
    SPIELTAG_SPAN_BELOW_FIXTURES,
    find_spieltag_span_refusal,
)

SPAN = {"saison_start": "2026-03-01", "saison_end": "2026-09-30"}

# Every span in the containment class below is months long, so `REQ-DATE-005` passes.
SAISON_RULES = FLSaisonRules(
    number_of_groups=4,
    teams_per_group=4,
    qualifiers_per_group=2,
    win_points=3,
    draw_points=1,
    tiebreak_order="tordifferenz",
    max_kadergroesse=18,
    forfeit_ergebnis=FLSaisonForfeitErgebnis(sieger_tore=3, verlierer_tore=0),
    erlaubte_stufen=["E1"],
)
IMPLIED_MATCHDAYS = 6

# Fixed rather than generated: a failing squad-filter assertion points at the same value every run.
TEAM_OID = ObjectId("6890a1b2c3d4e5f607182930")
SPIELER_OID = ObjectId("6890a1b2c3d4e5f607182935")


class TestAFixtureSitsInsideItsMatchday:
    def test_a_date_inside_the_span_passes(self):
        assert find_fixture_date_refusal(datum="2026-03-07", spieltag_beginn="2026-03-07", spieltag_ende="2026-03-08") is None

    @pytest.mark.parametrize("datum", ["2026-03-07", "2026-03-08"])
    def test_both_ends_are_inclusive(self, datum):
        """A one-day matchday is the ordinary case, so the boundary days have to be inside it."""

        assert find_fixture_date_refusal(datum=datum, spieltag_beginn="2026-03-07", spieltag_ende="2026-03-08") is None

    @pytest.mark.parametrize("datum", ["2026-03-06", "2026-03-20"])
    def test_a_date_outside_is_refused(self, datum):
        refusal = find_fixture_date_refusal(datum=datum, spieltag_beginn="2026-03-07", spieltag_ende="2026-03-08")

        assert refusal is not None
        assert refusal.error_code == FIXTURE_OUTSIDE_SPIELTAG

    def test_an_undated_fixture_passes(self):
        """An undated fixture contradicts no span — the opposite reading from the disqualification rule, which refuses by default."""

        assert find_fixture_date_refusal(datum=None, spieltag_beginn="2026-03-07", spieltag_ende="2026-03-08") is None

    def test_the_refusal_names_the_span_and_not_only_the_date(self):
        """The repair is a choice between two edits, so the admin needs both numbers to make it."""

        refusal = find_fixture_date_refusal(datum="2026-03-20", spieltag_beginn="2026-03-07", spieltag_ende="2026-03-08")

        assert refusal is not None
        assert "2026-03-07" in refusal.message
        assert "2026-03-08" in refusal.message


class TestAMatchdaySitsInsideItsSeason:
    def test_a_span_inside_the_season_passes(self):
        assert find_spieltag_span_refusal(beginn="2026-03-07", ende="2026-03-08", fixture_dates=[], **SPAN) is None

    def test_the_seasons_own_boundaries_are_inclusive(self):
        assert find_spieltag_span_refusal(beginn="2026-03-01", ende="2026-09-30", fixture_dates=[], **SPAN) is None

    def test_a_start_before_the_season_is_refused(self):
        refusal = find_spieltag_span_refusal(beginn="2026-02-28", ende="2026-03-08", fixture_dates=[], **SPAN)

        assert refusal is not None
        assert refusal.error_code == SPIELTAG_OUTSIDE_SAISON

    def test_an_end_after_the_season_is_refused(self):
        refusal = find_spieltag_span_refusal(beginn="2026-09-29", ende="2026-10-01", fixture_dates=[], **SPAN)

        assert refusal is not None
        assert refusal.error_code == SPIELTAG_OUTSIDE_SAISON

    def test_it_applies_to_a_matchday_with_no_fixtures(self):
        """A property of the two documents alone, so a create is held to it before any fixture exists."""

        refusal = find_spieltag_span_refusal(beginn="2026-01-01", ende="2026-01-02", fixture_dates=[], **SPAN)

        assert refusal is not None
        assert refusal.error_code == SPIELTAG_OUTSIDE_SAISON


class TestASeasonKeepsCoveringItsMatchdays:
    """`REQ-DATE-002` from the container's side: shrinking the season is the other way to break it."""

    def test_a_span_covering_every_matchday_passes(self):
        assert (
            find_saison_span_refusal(
                start_date="2026-03-01",
                end_date="2026-09-30",
                rules=SAISON_RULES,
                spieltag_spans=[("2026-03-07", "2026-03-09"), ("2026-09-28", "2026-09-30")],
            )
            is None
        )

    def test_shrinking_below_a_matchday_is_refused(self):
        refusal = find_saison_span_refusal(
            start_date="2026-03-01",
            end_date="2026-09-01",
            rules=SAISON_RULES,
            spieltag_spans=[("2026-09-28", "2026-09-30")],
        )

        assert refusal is not None
        assert refusal.error_code == SAISON_SPAN_BELOW_SPIELTAGE

    def test_a_matchday_starting_before_the_season_is_refused(self):
        """Both edges count: a matchday reaching out at the front is as stranded as one at the back."""

        refusal = find_saison_span_refusal(
            start_date="2026-03-08",
            end_date="2026-09-30",
            rules=SAISON_RULES,
            spieltag_spans=[("2026-03-07", "2026-03-09")],
        )

        assert refusal is not None
        assert refusal.error_code == SAISON_SPAN_BELOW_SPIELTAGE

    def test_the_refusal_counts_them_and_names_the_first(self):
        """The count says how much work the repair is; the dates say where to start looking."""

        refusal = find_saison_span_refusal(
            start_date="2026-04-01",
            end_date="2026-09-30",
            rules=SAISON_RULES,
            spieltag_spans=[("2026-03-20", "2026-03-21"), ("2026-03-07", "2026-03-09")],
        )

        assert refusal is not None
        assert "2" in refusal.message
        assert "2026-03-07" in refusal.message

    def test_a_season_with_no_matchdays_passes_this_half(self):
        """The create calls this for `REQ-DATE-005`, and an empty `spieltag_spans` is what makes the containment half pass there."""

        assert find_saison_span_refusal(start_date="2026-03-01", end_date="2026-03-31", rules=SAISON_RULES, spieltag_spans=[]) is None


class TestASeasonIsLongEnoughForItsSchedule:
    """`schedule_for` says how many matchdays the competition takes and no two share a day, so the shortest legal season is that many days."""

    def test_a_season_with_room_for_every_matchday_passes(self):
        """The positive baseline: without it every refusal below could pass on rules that refuse anything."""

        assert find_saison_span_refusal(start_date="2026-03-01", end_date="2026-09-30", rules=SAISON_RULES, spieltag_spans=[]) is None

    def test_exactly_as_many_days_as_matchdays_passes(self):
        """Inclusive: six matchdays fit in six days, one each."""

        assert find_saison_span_refusal(start_date="2026-03-01", end_date="2026-03-06", rules=SAISON_RULES, spieltag_spans=[]) is None

    def test_one_day_short_is_refused(self):
        """The other side of the boundary, which an off-by-one would miss."""

        refusal = find_saison_span_refusal(start_date="2026-03-01", end_date="2026-03-05", rules=SAISON_RULES, spieltag_spans=[])

        assert refusal is not None
        assert refusal.error_code == SAISON_SPAN_BELOW_SCHEDULE

    def test_a_one_day_season_is_refused(self):
        refusal = find_saison_span_refusal(start_date="2026-03-01", end_date="2026-03-01", rules=SAISON_RULES, spieltag_spans=[])

        assert refusal is not None
        assert refusal.error_code == SAISON_SPAN_BELOW_SCHEDULE

    def test_the_refusal_names_both_numbers(self):
        """The repair is a choice — widen the span or narrow the rules — so both sides have to be named."""

        refusal = find_saison_span_refusal(start_date="2026-03-01", end_date="2026-03-02", rules=SAISON_RULES, spieltag_spans=[])

        assert refusal is not None
        assert "2 day(s)" in refusal.message
        assert f"{IMPLIED_MATCHDAYS} matchday(s)" in refusal.message

    def test_the_floor_follows_the_rules_rather_than_a_constant(self):
        """The same span is legal under one rules set and refused under a wider one; a hardcoded floor could not tell them apart."""

        # `teams_per_group` alone differs from `SAISON_RULES`, which is the figure the floor turns on.
        wider = FLSaisonRules(
            number_of_groups=4,
            teams_per_group=6,
            qualifiers_per_group=2,
            win_points=3,
            draw_points=1,
            tiebreak_order="tordifferenz",
            max_kadergroesse=18,
            forfeit_ergebnis=FLSaisonForfeitErgebnis(sieger_tore=3, verlierer_tore=0),
            erlaubte_stufen=["E1"],
        )

        assert find_saison_span_refusal(start_date="2026-03-01", end_date="2026-03-06", rules=SAISON_RULES, spieltag_spans=[]) is None

        refusal = find_saison_span_refusal(start_date="2026-03-01", end_date="2026-03-06", rules=wider, spieltag_spans=[])
        assert refusal is not None
        assert refusal.error_code == SAISON_SPAN_BELOW_SCHEDULE

    def test_the_live_seasons_span_is_unaffected(self):
        """The span the league is actually playing, which these rules must not refuse."""

        assert find_saison_span_refusal(start_date="2026-03-07", end_date="2026-09-04", rules=SAISON_RULES, spieltag_spans=[]) is None


class TestAMatchdayKeepsCoveringItsFixtures:
    def test_a_span_covering_every_fixture_passes(self):
        assert find_spieltag_span_refusal(beginn="2026-03-07", ende="2026-03-09", fixture_dates=["2026-03-07", "2026-03-09"], **SPAN) is None

    def test_shrinking_below_a_fixture_is_refused(self):
        """The mirror of `REQ-DATE-001`: the same containment, broken from the container's side."""

        refusal = find_spieltag_span_refusal(beginn="2026-03-07", ende="2026-03-08", fixture_dates=["2026-03-20"], **SPAN)

        assert refusal is not None
        assert refusal.error_code == SPIELTAG_SPAN_BELOW_FIXTURES

    def test_the_refusal_counts_them_and_names_the_first(self):
        refusal = find_spieltag_span_refusal(
            beginn="2026-03-07",
            ende="2026-03-08",
            fixture_dates=["2026-03-25", "2026-03-20"],
            **SPAN,
        )

        assert refusal is not None
        assert "2" in refusal.message
        assert "2026-03-20" in refusal.message

    def test_the_season_rule_is_reported_first(self):
        """Widening to cover a stray fixture is pointless advice if the widened span still falls outside the season."""

        refusal = find_spieltag_span_refusal(beginn="2026-01-01", ende="2026-01-02", fixture_dates=["2026-03-20"], **SPAN)

        assert refusal is not None
        assert refusal.error_code == SPIELTAG_OUTSIDE_SAISON


class TestOneVenueAndOneRefereeAtATime:
    # Annotated rather than inferred: a plain `str` default widens the parameter and `BookedSlot` refuses it.
    def slot(
        self,
        uhrzeit: str,
        resource: Literal["Spielort", "Schiedsrichter"] = "Spielort",
        nr: int = 3,
        datum: str = "2026-03-07",
    ) -> BookedSlot:
        return BookedSlot(spiel_nr=nr, datum=datum, uhrzeit=uhrzeit, resource=resource)

    def test_the_buffer_is_four_hours(self):
        """Named in the test as well as the code, because it is a decision rather than a derivation."""

        assert CLASH_BUFFER_MINUTES == 240

    def test_nothing_booked_passes(self):
        assert find_clash_refusal(datum="2026-03-07", uhrzeit="18:00:00", booked=[]) is None

    def test_exactly_the_buffer_apart_passes(self):
        """The league plays several matches at one ground a matchday, so it spaces them rather than forbidding the pairing."""

        assert find_clash_refusal(datum="2026-03-07", uhrzeit="22:00:00", booked=[self.slot("18:00:00")]) is None

    @pytest.mark.parametrize("uhrzeit", ["18:00:00", "19:30:00", "21:59:00"])
    def test_inside_the_buffer_is_refused(self, uhrzeit):
        refusal = find_clash_refusal(datum="2026-03-07", uhrzeit=uhrzeit, booked=[self.slot("18:00:00")])

        assert refusal is not None
        assert refusal.error_code == FIXTURE_DOUBLE_BOOKED

    def test_it_works_in_both_directions(self):
        """A booking earlier and a booking later are the same clash — the comparison is absolute."""

        refusal = find_clash_refusal(datum="2026-03-07", uhrzeit="16:00:00", booked=[self.slot("18:00:00")])

        assert refusal is not None
        assert refusal.error_code == FIXTURE_DOUBLE_BOOKED

    def test_another_day_never_clashes(self):
        assert find_clash_refusal(datum="2026-03-08", uhrzeit="18:00:00", booked=[self.slot("18:00:00")]) is None

    @pytest.mark.parametrize(("datum", "uhrzeit"), [(None, "18:00:00"), ("2026-03-07", None)])
    def test_an_unscheduled_fixture_cannot_clash(self, datum, uhrzeit):
        """The gap is deliberate: refusing would refuse every fixture in a season still being scheduled."""

        assert find_clash_refusal(datum=datum, uhrzeit=uhrzeit, booked=[self.slot("18:00:00")]) is None

    def test_the_refusal_names_the_resource_and_the_other_fixture(self):
        refusal = find_clash_refusal(
            datum="2026-03-07",
            uhrzeit="19:00:00",
            booked=[self.slot("18:00:00", resource="Schiedsrichter", nr=11)],
        )

        assert refusal is not None
        assert "Schiedsrichter" in refusal.message
        assert "11" in refusal.message


class TestRetiringAVenueOrAReferee:
    def test_nothing_upcoming_permits_it(self):
        assert find_venue_retire_refusal(upcoming_spiel_nrs=[]) is None
        assert find_referee_retire_refusal(upcoming_spiel_nrs=[]) is None

    def test_an_upcoming_fixture_refuses_it(self):
        """`REQ-RETIRE-001`'s reasoning: retiring removes it from every picker while matches are scheduled against it."""

        venue = find_venue_retire_refusal(upcoming_spiel_nrs=[3])
        referee = find_referee_retire_refusal(upcoming_spiel_nrs=[3])

        assert venue is not None and venue.error_code == VENUE_STILL_BOOKED
        assert referee is not None and referee.error_code == REFEREE_STILL_ASSIGNED

    def test_the_two_codes_are_distinct(self):
        """Different advice — move the fixture, against reassign it — so different codes."""

        assert VENUE_STILL_BOOKED != REFEREE_STILL_ASSIGNED

    def test_a_long_list_is_summarised(self):
        refusal = find_venue_retire_refusal(upcoming_spiel_nrs=list(range(1, 12)))

        assert refusal is not None
        assert "and 6 more" in refusal.message


class TestASquadEntry:
    """A duplicate shirt number is permitted everywhere (`fl_backend/app/core/domain.py :: UNENFORCED`): several goalkeepers wear 1."""

    def test_a_team_in_the_season_passes(self):
        assert find_squad_refusal(team_in_saison=True) is None

    def test_a_team_not_in_the_season_is_refused(self):
        """The dangling reference `REQ-ELIGIBILITY-002` refuses on the match side."""

        refusal = find_squad_refusal(team_in_saison=False)

        assert refusal is not None
        assert refusal.error_code == SQUAD_TEAM_NOT_IN_SAISON


class TestASquadCap:
    """`max_kadergroesse` is a season's rule, so the same club may run a larger squad in the next one."""

    def test_a_squad_below_the_cap_passes(self):
        assert find_squad_capacity_refusal(squad_size=17, max_kadergroesse=18) is None

    def test_a_squad_at_the_cap_is_refused(self):
        """`>=`, not `>`: the row being written is the one that would take the place beyond it."""

        refusal = find_squad_capacity_refusal(squad_size=18, max_kadergroesse=18)

        assert refusal is not None
        assert refusal.error_code == SQUAD_FULL

    def test_a_squad_over_the_cap_is_refused(self):
        """Reachable without a bug: narrowing a season's rules leaves the squads already entered under the old bound."""

        refusal = find_squad_capacity_refusal(squad_size=25, max_kadergroesse=18)

        assert refusal is not None
        assert refusal.error_code == SQUAD_FULL

    def test_the_message_names_both_figures(self):
        """The admin's next action is either to retire a row or to raise the season's rule, and neither is choosable without both numbers."""

        refusal = find_squad_capacity_refusal(squad_size=18, max_kadergroesse=18)

        assert refusal is not None
        assert "18/18" in refusal.message

    def test_the_count_is_of_live_rows_only(self):
        """A retired row is a place given back; the unique index still spans it, which answers a repeat entry rather than capacity."""

        assert build_live_squad_filter(saison_id="2026", team_id=TEAM_OID, excluding_spieler_id=SPIELER_OID)["inactive_since"] is None

    def test_the_count_excludes_the_player_being_written(self):
        """What keeps the rule from over-reaching: an edit leaving `team_id` alone would otherwise be refused by the player's own place."""

        squad_filter = build_live_squad_filter(saison_id="2026", team_id=TEAM_OID, excluding_spieler_id=SPIELER_OID)

        assert squad_filter["spieler_id"] == {"$ne": SPIELER_OID}

    def test_the_count_is_scoped_to_one_team_in_one_season(self):
        """`max_kadergroesse` is a season's rule, so a club's squad in another season is a different squad."""

        squad_filter = build_live_squad_filter(saison_id="2026", team_id=TEAM_OID, excluding_spieler_id=SPIELER_OID)

        assert (squad_filter["saison_id"], squad_filter["team_id"]) == ("2026", TEAM_OID)

    def test_the_club_question_stays_out_of_this_one(self):
        """Two functions rather than two clauses.

        `find_squad_refusal`'s signature is pinned exactly by
        `tests/core/test_unenforced.py :: TestASharedSquadNumber`.
        """

        assert set(inspect.signature(find_squad_capacity_refusal).parameters) == {"squad_size", "max_kadergroesse"}


class TestASquadRolle:
    """`REQ-SQUAD-004`: one Kapitaen and one Co-Kapitaen per squad, and no row can hold both at once."""

    def test_a_row_holding_no_role_is_never_refused(self):
        """What makes the rule at-most-one rather than exactly-one: a squad still being filled has neither role."""

        assert find_squad_rolle_refusal(rolle=None, taken=False) is None
        assert find_squad_rolle_refusal(rolle=None, taken=True) is None

    @pytest.mark.parametrize("rolle", ["kapitaen", "co_kapitaen"])
    def test_a_free_role_passes(self, rolle):
        assert find_squad_rolle_refusal(rolle=rolle, taken=False) is None

    @pytest.mark.parametrize("rolle", ["kapitaen", "co_kapitaen"])
    def test_a_role_another_row_holds_is_refused(self, rolle):
        """One code for both, as `REQ-BOOKING-001` covers a venue and a referee: one rule read against two values."""

        refusal = find_squad_rolle_refusal(rolle=rolle, taken=True)

        assert refusal is not None
        assert refusal.error_code == SQUAD_ROLLE_TAKEN

    def test_the_message_names_the_role_that_was_refused(self):
        """The two roles are refused by one code, so the log line is the only place saying which was asked for."""

        refusal = find_squad_rolle_refusal(rolle="co_kapitaen", taken=True)

        assert refusal is not None
        assert "co_kapitaen" in refusal.message

    def test_the_two_roles_never_answer_for_each_other(self):
        """The rule is per role: a squad with a Kapitaen still has its Co-Kapitaen to give."""

        held = build_live_rolle_filter(saison_id="2026", team_id=TEAM_OID, rolle="kapitaen", excluding_spieler_id=SPIELER_OID)

        assert held["rolle"] == "kapitaen"

    def test_the_count_is_of_live_rows_only(self):
        """A player who left the squad is not leading it, which is what makes the reactivate ask again."""

        assert (
            build_live_rolle_filter(saison_id="2026", team_id=TEAM_OID, rolle="kapitaen", excluding_spieler_id=SPIELER_OID)["inactive_since"]
            is None
        )

    def test_the_count_excludes_the_player_being_written(self):
        """The over-breadth trap the cap has too: a captain editing their shirt would otherwise be refused by their own armband."""

        held = build_live_rolle_filter(saison_id="2026", team_id=TEAM_OID, rolle="kapitaen", excluding_spieler_id=SPIELER_OID)

        assert held["spieler_id"] == {"$ne": SPIELER_OID}

    def test_the_refusal_is_its_own_function(self):
        """`find_squad_refusal`'s signature is pinned exactly by `tests/core/test_unenforced.py :: TestASharedSquadNumber`."""

        assert set(inspect.signature(find_squad_rolle_refusal).parameters) == {"rolle", "taken"}
