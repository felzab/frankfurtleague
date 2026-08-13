"""
API · what contains what — the date-span family, plus the clash and squad rules

All pure, all default tier. One idea runs through the span rules (decided 2026-08-08): a span
contains what sits inside it — a season its matchdays, a matchday its fixtures — and until these
existed a fixture could be dated in a month its matchday did not cover.

A postponed match prolongs the matchday, deliberately without exception: the span describes when
the fixtures are played rather than planning when they must be. Identity is asserted on the code;
a message is asserted only where it must name something.
"""

from typing import Literal

import pytest

from app.api.saisons.schemas import FLSaisonRules
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
    SQUAD_TEAM_NOT_IN_SAISON,
    find_squad_refusal,
    normalised_nummer,
)
from app.api.spielorte.services import VENUE_STILL_BOOKED, find_venue_retire_refusal
from app.api.spieltage.services import (
    SPIELTAG_OUTSIDE_SAISON,
    SPIELTAG_SPAN_BELOW_FIXTURES,
    find_spieltag_span_refusal,
)

SPAN = {"saison_start": "2026-03-01", "saison_end": "2026-09-30"}

# The live season's shape: 4 groups of 4, 2 qualifiers each, which `schedule_for` turns into 6
# matchdays. Every span in the containment class below is months long, so `REQ-DATE-005` passes.
SAISON_RULES = FLSaisonRules(
    number_of_groups=4,
    teams_per_group=4,
    qualifiers_per_group=2,
    win_points=3,
    draw_points=1,
    erlaubte_stufen=["E1"],
)
IMPLIED_MATCHDAYS = 6


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
        assert refusal[0] == FIXTURE_OUTSIDE_SPIELTAG

    def test_an_undated_fixture_passes(self):
        """
        The ordinary state of a season being scheduled, and it contradicts no span.

        Deliberately the opposite reading from the disqualification rule, where a missing date is evidence
        of nothing and is therefore refused: there, the question is whether the match was already played.
        """

        assert find_fixture_date_refusal(datum=None, spieltag_beginn="2026-03-07", spieltag_ende="2026-03-08") is None

    def test_the_refusal_names_the_span_and_not_only_the_date(self):
        """The repair is a choice between two edits, so the admin needs both numbers to make it."""

        refusal = find_fixture_date_refusal(datum="2026-03-20", spieltag_beginn="2026-03-07", spieltag_ende="2026-03-08")

        assert refusal is not None
        assert "2026-03-07" in refusal[1]
        assert "2026-03-08" in refusal[1]


class TestAMatchdaySitsInsideItsSeason:
    def test_a_span_inside_the_season_passes(self):
        assert find_spieltag_span_refusal(beginn="2026-03-07", ende="2026-03-08", fixture_dates=[], **SPAN) is None

    def test_the_seasons_own_boundaries_are_inclusive(self):
        assert find_spieltag_span_refusal(beginn="2026-03-01", ende="2026-09-30", fixture_dates=[], **SPAN) is None

    def test_a_start_before_the_season_is_refused(self):
        refusal = find_spieltag_span_refusal(beginn="2026-02-28", ende="2026-03-08", fixture_dates=[], **SPAN)

        assert refusal is not None
        assert refusal[0] == SPIELTAG_OUTSIDE_SAISON

    def test_an_end_after_the_season_is_refused(self):
        refusal = find_spieltag_span_refusal(beginn="2026-09-29", ende="2026-10-01", fixture_dates=[], **SPAN)

        assert refusal is not None
        assert refusal[0] == SPIELTAG_OUTSIDE_SAISON

    def test_it_applies_to_a_matchday_with_no_fixtures(self):
        """
        Which is every matchday at the moment it is created, and the reason this half runs first.

        It is a property of the two documents alone, so the create can be held to it before any fixture
        exists to be checked against.
        """

        refusal = find_spieltag_span_refusal(beginn="2026-01-01", ende="2026-01-02", fixture_dates=[], **SPAN)

        assert refusal is not None
        assert refusal[0] == SPIELTAG_OUTSIDE_SAISON


class TestASeasonKeepsCoveringItsMatchdays:
    """
    `REQ-DATE-004`, the fourth member of the containment family.

    The same season-contains-matchday rule as `REQ-DATE-002`, refused from the CONTAINER's side, because
    shrinking the season is the other way to break it — exactly the pair -001 and -003 already form one
    level down.
    """

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
        assert refusal[0] == SAISON_SPAN_BELOW_SPIELTAGE

    def test_a_matchday_starting_before_the_season_is_refused(self):
        """Both edges count: a matchday reaching out at the front is as stranded as one at the back."""

        refusal = find_saison_span_refusal(
            start_date="2026-03-08",
            end_date="2026-09-30",
            rules=SAISON_RULES,
            spieltag_spans=[("2026-03-07", "2026-03-09")],
        )

        assert refusal is not None
        assert refusal[0] == SAISON_SPAN_BELOW_SPIELTAGE

    def test_the_refusal_counts_them_and_names_the_first(self):
        """The count says how much work the repair is; the dates say where to start looking."""

        refusal = find_saison_span_refusal(
            start_date="2026-04-01",
            end_date="2026-09-30",
            rules=SAISON_RULES,
            spieltag_spans=[("2026-03-20", "2026-03-21"), ("2026-03-07", "2026-03-09")],
        )

        assert refusal is not None
        assert "2" in refusal[1]
        assert "2026-03-07" in refusal[1]

    def test_a_season_with_no_matchdays_passes_this_half(self):
        """
        Which is every season at the moment it is created.

        The create calls this function for `REQ-DATE-005`, whose half reads the payload alone; an empty
        `spieltag_spans` is what makes the containment half below silently pass there.
        """

        assert find_saison_span_refusal(start_date="2026-03-01", end_date="2026-03-31", rules=SAISON_RULES, spieltag_spans=[]) is None


class TestASeasonIsLongEnoughForItsSchedule:
    """
    `REQ-DATE-005`. Derived from the rules, never an arbitrary floor.

    `schedule_for` says how many matchdays the competition takes and no two can be played on one day,
    so the shortest legal season is exactly that many days long. A one-day MATCHDAY stays legal — the
    live `finale` is one — because this rule is on the season and nothing here refuses `beginn == ende`.
    """

    def test_a_season_with_room_for_every_matchday_passes(self):
        """The positive baseline: without it, every refusal below could pass on rules that refuse anything."""

        assert find_saison_span_refusal(start_date="2026-03-01", end_date="2026-09-30", rules=SAISON_RULES, spieltag_spans=[]) is None

    def test_exactly_as_many_days_as_matchdays_passes(self):
        """The boundary, and it is inclusive: 6 matchdays fit in 6 days, one each."""

        assert find_saison_span_refusal(start_date="2026-03-01", end_date="2026-03-06", rules=SAISON_RULES, spieltag_spans=[]) is None

    def test_one_day_short_is_refused(self):
        """The other side of the same boundary — the case an off-by-one in the inclusive count would miss."""

        refusal = find_saison_span_refusal(start_date="2026-03-01", end_date="2026-03-05", rules=SAISON_RULES, spieltag_spans=[])

        assert refusal is not None
        assert refusal[0] == SAISON_SPAN_BELOW_SCHEDULE

    def test_a_one_day_season_is_refused(self):
        refusal = find_saison_span_refusal(start_date="2026-03-01", end_date="2026-03-01", rules=SAISON_RULES, spieltag_spans=[])

        assert refusal is not None
        assert refusal[0] == SAISON_SPAN_BELOW_SCHEDULE

    def test_the_refusal_names_both_numbers(self):
        """The repair is a choice — widen the span or narrow the rules — so both sides have to be named."""

        refusal = find_saison_span_refusal(start_date="2026-03-01", end_date="2026-03-02", rules=SAISON_RULES, spieltag_spans=[])

        assert refusal is not None
        assert "2 day(s)" in refusal[1]
        assert f"{IMPLIED_MATCHDAYS} matchday(s)" in refusal[1]

    def test_the_floor_follows_the_rules_rather_than_a_constant(self):
        """
        The point of deriving it: a wider competition needs a longer season.

        Groups of 6 take 5 group matchdays instead of 3, so the same span that was legal above is not.
        A hardcoded floor could not tell these two seasons apart.
        """

        wider = FLSaisonRules(
            number_of_groups=4,
            teams_per_group=6,
            qualifiers_per_group=2,
            win_points=3,
            draw_points=1,
            erlaubte_stufen=["E1"],
        )

        assert find_saison_span_refusal(start_date="2026-03-01", end_date="2026-03-06", rules=SAISON_RULES, spieltag_spans=[]) is None

        refusal = find_saison_span_refusal(start_date="2026-03-01", end_date="2026-03-06", rules=wider, spieltag_spans=[])
        assert refusal is not None
        assert refusal[0] == SAISON_SPAN_BELOW_SCHEDULE

    def test_the_live_seasons_span_is_unaffected(self):
        """`DATA-audit.md` §3: the one stored season runs 2026-03-07 to 2026-09-04 under these rules."""

        assert find_saison_span_refusal(start_date="2026-03-07", end_date="2026-09-04", rules=SAISON_RULES, spieltag_spans=[]) is None


class TestAMatchdayKeepsCoveringItsFixtures:
    def test_a_span_covering_every_fixture_passes(self):
        assert find_spieltag_span_refusal(beginn="2026-03-07", ende="2026-03-09", fixture_dates=["2026-03-07", "2026-03-09"], **SPAN) is None

    def test_shrinking_below_a_fixture_is_refused(self):
        """The mirror of `REQ-DATE-001`: the same containment, broken from the container's side."""

        refusal = find_spieltag_span_refusal(beginn="2026-03-07", ende="2026-03-08", fixture_dates=["2026-03-20"], **SPAN)

        assert refusal is not None
        assert refusal[0] == SPIELTAG_SPAN_BELOW_FIXTURES

    def test_the_refusal_counts_them_and_names_the_first(self):
        """The count says how much work the repair is; the date says where to start looking."""

        refusal = find_spieltag_span_refusal(
            beginn="2026-03-07",
            ende="2026-03-08",
            fixture_dates=["2026-03-25", "2026-03-20"],
            **SPAN,
        )

        assert refusal is not None
        assert "2" in refusal[1]
        assert "2026-03-20" in refusal[1]

    def test_the_season_rule_is_reported_first(self):
        """
        Both apply; the season is the outer container and the one the admin must satisfy either way.

        Widening the span to cover a stray fixture is pointless advice if the widened span would still
        fall outside the season.
        """

        refusal = find_spieltag_span_refusal(beginn="2026-01-01", ende="2026-01-02", fixture_dates=["2026-03-20"], **SPAN)

        assert refusal is not None
        assert refusal[0] == SPIELTAG_OUTSIDE_SAISON


class TestOneVenueAndOneRefereeAtATime:
    # `resource` is annotated rather than left to inference: without the Literal, a plain `str` default
    # widens the parameter and `BookedSlot` then refuses it. The gate catches that -- its bare `pyright`
    # reads `[tool.pyright]`, which includes `tests`.
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
        """
        Four hours apart is the arrangement this rule is meant to permit.

        The league plays several matches at one ground on a matchday, so it spaces them rather than
        forbidding the pairing.
        """

        assert find_clash_refusal(datum="2026-03-07", uhrzeit="22:00:00", booked=[self.slot("18:00:00")]) is None

    @pytest.mark.parametrize("uhrzeit", ["18:00:00", "19:30:00", "21:59:00"])
    def test_inside_the_buffer_is_refused(self, uhrzeit):
        refusal = find_clash_refusal(datum="2026-03-07", uhrzeit=uhrzeit, booked=[self.slot("18:00:00")])

        assert refusal is not None
        assert refusal[0] == FIXTURE_DOUBLE_BOOKED

    def test_it_works_in_both_directions(self):
        """A booking earlier and a booking later are the same clash — the comparison is absolute."""

        assert find_clash_refusal(datum="2026-03-07", uhrzeit="16:00:00", booked=[self.slot("18:00:00")]) is not None

    def test_another_day_never_clashes(self):
        assert find_clash_refusal(datum="2026-03-08", uhrzeit="18:00:00", booked=[self.slot("18:00:00")]) is None

    @pytest.mark.parametrize(("datum", "uhrzeit"), [(None, "18:00:00"), ("2026-03-07", None)])
    def test_an_unscheduled_fixture_cannot_clash(self, datum, uhrzeit):
        """
        The one gap in this rule, and it is deliberate: what is unscheduled is not yet double-booked.

        Refusing on a missing date or time would refuse every fixture in a season still being scheduled.
        """

        assert find_clash_refusal(datum=datum, uhrzeit=uhrzeit, booked=[self.slot("18:00:00")]) is None

    def test_the_refusal_names_the_resource_and_the_other_fixture(self):
        """Which of the two collided, and which fixture to open — the referee case reads the same way."""

        refusal = find_clash_refusal(
            datum="2026-03-07",
            uhrzeit="19:00:00",
            booked=[self.slot("18:00:00", resource="Schiedsrichter", nr=11)],
        )

        assert refusal is not None
        assert "Schiedsrichter" in refusal[1]
        assert "11" in refusal[1]


class TestRetiringAVenueOrAReferee:
    def test_nothing_upcoming_permits_it(self):
        assert find_venue_retire_refusal(upcoming_spiel_nrs=[]) is None
        assert find_referee_retire_refusal(upcoming_spiel_nrs=[]) is None

    def test_an_upcoming_fixture_refuses_it(self):
        """
        The reasoning `REQ-RETIRE-001` already applies to a club, and these two had no equivalent of it.

        Retiring either removes it from every picker while matches are still scheduled against it.
        """

        venue = find_venue_retire_refusal(upcoming_spiel_nrs=[3])
        referee = find_referee_retire_refusal(upcoming_spiel_nrs=[3])

        assert venue is not None and venue[0] == VENUE_STILL_BOOKED
        assert referee is not None and referee[0] == REFEREE_STILL_ASSIGNED

    def test_the_two_codes_are_distinct(self):
        """Different advice — move the fixture, against reassign it — so different codes."""

        assert VENUE_STILL_BOOKED != REFEREE_STILL_ASSIGNED

    def test_a_long_list_is_summarised(self):
        refusal = find_venue_retire_refusal(upcoming_spiel_nrs=list(range(1, 12)))

        assert refusal is not None
        assert "and 6 more" in refusal[1]


class TestASquadEntry:
    """
    `REQ-SQUAD-001` is the only refusal here, and that is the change (decided 2026-08-13).

    A duplicate shirt number is permitted on every write path — declared in
    `fl_backend/app/core/domain.py :: UNENFORCED`. The league fields four goalkeepers in one squad all
    wearing 1, and refusing the state would make those rows uneditable and, once one was retired,
    unreactivatable. `reactivate_saison_spieler` never consulted the rule at all, so refusing on two
    paths of three was one rule answering three ways rather than a rule with a gap.
    """

    def test_a_team_in_the_season_passes(self):
        assert find_squad_refusal(team_in_saison=True) is None

    def test_a_team_not_in_the_season_is_refused(self):
        """
        The same dangling reference `REQ-ELIGIBILITY-002` refuses on the match side.

        It was open here while closed there, so a squad list could name a club not in the competition.
        """

        refusal = find_squad_refusal(team_in_saison=False)

        assert refusal is not None
        assert refusal[0] == SQUAD_TEAM_NOT_IN_SAISON

    @pytest.mark.parametrize(("raw", "expected"), [(" 7 ", "7"), ("", None), (None, None), ("07", "07")])
    def test_a_number_is_compared_trimmed_and_not_renumbered(self, raw, expected):
        """
        Whitespace is noise and an empty string is no number.

        `07` stays `07`, deliberately: it is a shirt somebody had printed, and deciding it is the same
        shirt as `7` is a judgement this rule declines.
        """

        assert normalised_nummer(raw) == expected
