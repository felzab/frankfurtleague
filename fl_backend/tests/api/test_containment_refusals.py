"""
API · what contains what — the date-span family, plus the clash and squad rules

All pure, all default tier. One idea runs through the span rules (decided 2026-08-08): a span
contains what sits inside it — a season its matchdays, a matchday its fixtures — and until these
existed a fixture could be dated in a month its matchday did not cover.

A postponed match prolongs the matchday, deliberately without exception: the span describes when
the fixtures are played rather than planning when they must be. Asserted on the code, never the
message.
"""

from typing import Literal

import pytest

from app.api.saisons.services import SAISON_SPAN_BELOW_SPIELTAGE, find_saison_span_refusal
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
    SQUAD_NUMMER_TAKEN,
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
                spieltag_spans=[("2026-03-07", "2026-03-09"), ("2026-09-28", "2026-09-30")],
            )
            is None
        )

    def test_shrinking_below_a_matchday_is_refused(self):
        refusal = find_saison_span_refusal(
            start_date="2026-03-01",
            end_date="2026-09-01",
            spieltag_spans=[("2026-09-28", "2026-09-30")],
        )

        assert refusal is not None
        assert refusal[0] == SAISON_SPAN_BELOW_SPIELTAGE

    def test_a_matchday_starting_before_the_season_is_refused(self):
        """Both edges count: a matchday reaching out at the front is as stranded as one at the back."""

        refusal = find_saison_span_refusal(
            start_date="2026-03-08",
            end_date="2026-09-30",
            spieltag_spans=[("2026-03-07", "2026-03-09")],
        )

        assert refusal is not None
        assert refusal[0] == SAISON_SPAN_BELOW_SPIELTAGE

    def test_the_refusal_counts_them_and_names_the_first(self):
        """The count says how much work the repair is; the dates say where to start looking."""

        refusal = find_saison_span_refusal(
            start_date="2026-04-01",
            end_date="2026-09-30",
            spieltag_spans=[("2026-03-20", "2026-03-21"), ("2026-03-07", "2026-03-09")],
        )

        assert refusal is not None
        assert "2" in refusal[1]
        assert "2026-03-07" in refusal[1]

    def test_a_season_with_no_matchdays_passes_any_span(self):
        """Which is every season at the moment it is created — and the reason the create needs no call."""

        assert find_saison_span_refusal(start_date="2026-03-01", end_date="2026-03-02", spieltag_spans=[]) is None


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
    def test_a_team_in_the_season_with_a_free_number_passes(self):
        assert find_squad_refusal(team_in_saison=True, proposed_nummer="7", stored_nummer=None, taken_nummern=["9"]) is None

    def test_a_team_not_in_the_season_is_refused(self):
        """
        The same dangling reference `REQ-ELIGIBILITY-002` refuses on the match side.

        It was open here while closed there, so a squad list could name a club not in the competition.
        """

        refusal = find_squad_refusal(team_in_saison=False, proposed_nummer="7", stored_nummer=None, taken_nummern=[])

        assert refusal is not None
        assert refusal[0] == SQUAD_TEAM_NOT_IN_SAISON

    def test_the_team_rule_is_reported_before_the_number(self):
        """Not being in the competition is the stronger answer, so a free number does not soften it."""

        refusal = find_squad_refusal(team_in_saison=False, proposed_nummer="7", stored_nummer=None, taken_nummern=["7"])

        assert refusal is not None
        assert refusal[0] == SQUAD_TEAM_NOT_IN_SAISON

    def test_a_newly_taken_number_is_refused(self):
        refusal = find_squad_refusal(team_in_saison=True, proposed_nummer="7", stored_nummer=None, taken_nummern=["7"])

        assert refusal is not None
        assert refusal[0] == SQUAD_NUMMER_TAKEN

    def test_resubmitting_the_stored_number_always_passes(self):
        """
        The clause that makes an existing duplicate editable, including by the edit that would resolve it.

        It is also what let this rule ship without inspecting the live database: whatever duplicates exist
        are grandfathered by the same logic that refuses new ones (decided 2026-08-08).
        """

        assert find_squad_refusal(team_in_saison=True, proposed_nummer="7", stored_nummer="7", taken_nummern=["7"]) is None

    def test_no_number_is_never_a_collision(self):
        """Several players may have no shirt assigned yet, which is an ordinary half-filled squad."""

        assert find_squad_refusal(team_in_saison=True, proposed_nummer=None, stored_nummer=None, taken_nummern=[None, None]) is None

    @pytest.mark.parametrize(("raw", "expected"), [(" 7 ", "7"), ("", None), (None, None), ("07", "07")])
    def test_a_number_is_compared_trimmed_and_not_renumbered(self, raw, expected):
        """
        Whitespace is noise and an empty string is no number.

        `07` stays `07`, deliberately: it is a shirt somebody had printed, and deciding it is the same
        shirt as `7` is a judgement this rule declines.
        """

        assert normalised_nummer(raw) == expected
