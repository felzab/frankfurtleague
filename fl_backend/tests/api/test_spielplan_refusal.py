from dataclasses import dataclass
from typing import Any, Mapping, get_args

import pytest

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules, FLSpielplanShape
from app.api.saisons.services import (
    DRAWN_HOLDING_ITS_SIDES,
    RECORDED_FACT_FIELDS,
    SAISON_SPAN_BELOW_SCHEDULE,
    SPIELPLAN_ALREADY_DRAWN,
    SPIELPLAN_GRUPPEN_OFF_RULES,
    SPIELPLAN_MATCHDAYS_HELD,
    SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW,
    SPIELPLAN_SAISON_FINISHED,
    find_saison_span_refusal,
    find_spielplan_refusal,
    holds_a_recorded_fact,
)
from app.api.spiele.schemas import PHASE_ORDER, SONDEREREIGNIS_WITHOUT_A_RESULT, FLSaisonPhase, FLSonderereignis
from app.api.teams.schemas import FLGruppenNames
from app.core.exceptions import WriteRefusal

RULES = FLSaisonRules(
    win_points=3,
    draw_points=1,
    qualifiers_per_group=2,
    number_of_groups=4,
    teams_per_group=6,
    tiebreak_order="tordifferenz",
    max_kadergroesse=20,
    forfeit_ergebnis=FLSaisonForfeitErgebnis(sieger_tore=3, verlierer_tore=0),
    erlaubte_stufen=["Q1"],
)

FULL: Mapping[FLGruppenNames, int] = {"A": 6, "B": 6, "C": 6, "D": 6}


def refusal_for(
    *,
    saison_status: str = "future",
    fixtures_drawn: int = 0,
    spieltage_held: int = 0,
    watermark: Mapping[str, Any] | None = None,
    occupancy: Mapping[FLGruppenNames, int] = FULL,
    rules: FLSaisonRules = RULES,
    replace: bool = False,
    recorded: int = 0,
) -> WriteRefusal | None:
    return find_spielplan_refusal(
        saison_status=saison_status,
        fixtures_drawn=fixtures_drawn,
        spieltage_held=spieltage_held,
        watermark=watermark,
        rules=rules,
        occupancy_by_gruppe=occupancy,
        replace=replace,
        recorded_fixtures=recorded,
    )


class TestASeasonReadyToBeDrawn:
    """The one shape that passes, so every refusal below is shown to need its own reason."""

    def test_a_future_season_with_full_groups_and_nothing_drawn_is_permitted(self):
        assert refusal_for() is None

    def test_a_group_the_season_does_not_offer_may_stand_in_the_map_holding_nobody(self):
        """The map is counted from stored rows, so an emptied group survives as a key; nobody is stranded by it."""

        two_groups = RULES.model_copy(update={"number_of_groups": 2})

        assert refusal_for(occupancy={"A": 6, "B": 6, "C": 0, "D": 0}, rules=two_groups) is None


class TestASeasonAlreadyDrawn:
    """`REQ-SPIELPLAN-001`: the draw is one-way, and the fixtures are what say it has happened."""

    def test_a_stored_fixture_refuses_the_draw(self):
        refusal = refusal_for(fixtures_drawn=1)

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_ALREADY_DRAWN

    def test_the_watermark_names_what_already_exists(self):
        """An admin arriving by a stale tab reads what is there rather than an error code."""

        refusal = refusal_for(fixtures_drawn=67, spieltage_held=8, watermark={"generiert_am": "2026-08-21", "spieltage": 8, "spiele": 67})

        assert refusal is not None
        assert "2026-08-21" in refusal.message
        assert "67" in refusal.message

    def test_a_draw_this_endpoint_did_not_write_is_still_refused(self):
        """The live database holds seasons drawn outside the API: a watermark-only guard would offer to draw over them."""

        refusal = refusal_for(fixtures_drawn=31, spieltage_held=6, watermark=None)

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_ALREADY_DRAWN
        assert "31" in refusal.message

    def test_the_fixtures_are_read_before_the_matchdays(self):
        """Both hold, and naming the draw is more use than naming the rows it hangs on."""

        refusal = refusal_for(fixtures_drawn=67, spieltage_held=8)

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_ALREADY_DRAWN

    def test_a_season_inside_the_replace_window_is_offered_the_replace(self):
        """The remedy exists here, and naming it is what turns a 409 into a next step."""

        refusal = refusal_for(fixtures_drawn=67, spieltage_held=8)

        assert refusal is not None
        assert "a replace is confirmed" in refusal.message

    @pytest.mark.parametrize(
        ("saison_status", "recorded", "why"),
        [
            ("active", 0, "a running season, which `REQ-SPIELPLAN-005` refuses on its status"),
            ("past", 0, "a finished season, refused on its status too"),
            ("future", 1, "a planned season one fixture has already been entered against"),
        ],
    )
    def test_a_season_outside_the_replace_window_is_not_offered_one(self, saison_status: str, recorded: int, why: str):
        """State the remedy unconditionally and this fails: an admin who confirms the replace meets a second 409."""

        refusal = refusal_for(fixtures_drawn=67, spieltage_held=8, saison_status=saison_status, recorded=recorded)

        assert refusal is not None, why
        assert refusal.error_code == SPIELPLAN_ALREADY_DRAWN
        assert "a replace is confirmed" not in refusal.message
        assert "no replace can remove it" in refusal.message


class TestASeasonHoldingMatchdays:
    """`REQ-SPIELPLAN-002`: the draw writes the whole matchday list, so it cannot join one already there."""

    def test_a_matchday_without_fixtures_refuses_the_draw(self):
        refusal = refusal_for(spieltage_held=1)

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_MATCHDAYS_HELD


class TestAFinishedSeason:
    """`REQ-SPIELPLAN-003`: a finished season's table is the record of what happened, and a draw would reopen it."""

    def test_a_past_season_refuses_the_draw(self):
        refusal = refusal_for(saison_status="past")

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_SAISON_FINISHED
        assert "past" in refusal.message

    def test_a_running_season_is_permitted(self):
        """The pair to `REQ-ACTIVATE-003`, and the whole reason this refuses `past` alone.

        Activation writes `status` one way, so refusing a running season here would leave one
        activated before its draw unschedulable for good rather than merely out of order.
        """

        assert refusal_for(saison_status="active") is None


class TestWhetherEveryOfferedGroupHoldsItsSize:
    """`REQ-SPIELPLAN-004`, and all three answers it gives.

    A group short of `teams_per_group`, a group past it, and a club standing in a group the season
    does not offer -- one class, because `Rule.tested_by` cites one.
    """

    def test_a_short_group_refuses_the_draw(self):
        refusal = refusal_for(occupancy={**FULL, "B": 4})

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_GRUPPEN_OFF_RULES

    def test_a_group_holding_more_than_the_rules_ask_refuses_the_draw(self):
        """The other direction: a group past `teams_per_group` draws more fixtures than its matchdays account for."""

        refusal = refusal_for(occupancy={**FULL, "A": 7})

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_GRUPPEN_OFF_RULES

    def test_a_group_beyond_the_offered_ones_refuses_the_draw(self):
        """A club in a group the season does not run draws into no round robin at all.

        `REQ-ENTER-002` and `REQ-RULES-002` close the write path to this, so what reaches it is a
        hand-edited row.
        """

        two_groups = RULES.model_copy(update={"number_of_groups": 2})
        refusal = refusal_for(occupancy={"A": 6, "B": 6, "C": 1}, rules=two_groups)

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_GRUPPEN_OFF_RULES

    def test_an_offered_group_nobody_is_entered_into_is_named_as_holding_none(self):
        """A group nobody is entered into is absent from the map rather than present at 0.

        The ordinary state of a season about to be drawn, so reading the map by subscript would turn
        its most frequent refusal into a 500.
        """

        refusal = refusal_for(occupancy={"A": 6, "B": 6})

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_GRUPPEN_OFF_RULES
        assert "gruppe C holds 0 of 6" in refusal.message
        assert "gruppe D holds 0 of 6" in refusal.message

    def test_every_short_group_is_named_at_once(self):
        """One press, one list: an admin filling them one at a time would meet this refusal per group."""

        refusal = refusal_for(occupancy={"A": 6, "B": 4, "C": 6, "D": 2})

        assert refusal is not None
        assert refusal.message.split(";")[0] == "gruppe B holds 4 of 6, gruppe D holds 2 of 6"

    def test_the_message_names_the_group_and_what_it_holds(self):
        """The same sentence the short direction gets, because an admin repairing either reads the same page."""

        refusal = refusal_for(occupancy={"A": 7, "B": 6, "C": 6, "D": 9})

        assert refusal is not None
        assert "gruppe A holds 7 of 6" in refusal.message
        assert "gruppe D holds 9 of 6" in refusal.message

    def test_both_directions_are_reported_by_one_press(self):
        """Repairing a season one refusal at a time is what naming every offending group at once avoids."""

        refusal = refusal_for(occupancy={"A": 7, "B": 4, "C": 6, "D": 6})

        assert refusal is not None
        assert "gruppe A holds 7 of 6" in refusal.message
        assert "gruppe B holds 4 of 6" in refusal.message

    def test_the_message_names_the_group_what_it_holds_and_what_the_season_offers(self):
        """A 500 out of `_squads` names the club and reaches no admin; this is the same fact as an answer to the press."""

        two_groups = RULES.model_copy(update={"number_of_groups": 2})
        refusal = refusal_for(occupancy={"A": 6, "B": 6, "C": 1, "D": 3}, rules=two_groups)

        assert refusal is not None
        assert "gruppe C holds 1 and a season of 2 group(s) does not offer it" in refusal.message
        assert "gruppe D holds 3 and a season of 2 group(s) does not offer it" in refusal.message

    def test_a_stranded_club_is_reported_beside_a_group_off_its_size(self):
        """One question, so one answer: every group the season cannot draw truthfully, in one message."""

        two_groups = RULES.model_copy(update={"number_of_groups": 2})
        refusal = refusal_for(occupancy={"A": 5, "B": 6, "C": 1}, rules=two_groups)

        assert refusal is not None
        assert "gruppe A holds 5 of 6" in refusal.message
        assert "gruppe C holds 1 and a season of 2 group(s) does not offer it" in refusal.message

    def test_the_message_names_every_group_in_one_fixed_order(self):
        """The refusal is the admin's answer and the log line alike, and an order that moves between runs is neither.

        Offered groups in the season's own order, then the stranded ones by name, whatever order the
        occupancy map arrived in.
        """

        two_groups = RULES.model_copy(update={"number_of_groups": 2})
        # Out of name order on purpose: `generate_spielplan` counts rows off a cursor no index sorts.
        refusal = refusal_for(occupancy={"D": 3, "C": 4, "B": 4, "A": 5}, rules=two_groups)

        assert refusal is not None
        assert refusal.message.split(";")[0] == (
            "gruppe A holds 5 of 6, gruppe B holds 4 of 6, "
            "gruppe C holds 4 and a season of 2 group(s) does not offer it, "
            "gruppe D holds 3 and a season of 2 group(s) does not offer it"
        )

    def test_a_group_the_season_does_not_offer_is_not_counted(self):
        """`offered_gruppen` bounds it: a two-group season is not short because C and D are absent from the map."""

        two_groups = RULES.model_copy(update={"number_of_groups": 2})
        refusal = find_spielplan_refusal(
            saison_status="future",
            fixtures_drawn=0,
            spieltage_held=0,
            watermark=None,
            rules=two_groups,
            occupancy_by_gruppe={"A": 6, "B": 6},
            replace=False,
            recorded_fixtures=0,
        )

        assert refusal is None


class TestAConfirmedReplaceStepsPastWhatItDeletes:
    """`REQ-SPIELPLAN-001` and `REQ-SPIELPLAN-002` name what a replace is about to remove, so neither may turn one away."""

    def test_a_season_already_holding_a_whole_spielplan_is_replaced(self):
        """Drop `and not replace` from the fixture guard and this fails, the replace refused over the rows it deletes."""

        assert refusal_for(replace=True, fixtures_drawn=67, spieltage_held=8) is None

    def test_a_season_holding_matchdays_and_no_fixture_is_replaced(self):
        """The matchday guard's own step-aside, and the shape a draw stopped between its two writes would leave."""

        assert refusal_for(replace=True, spieltage_held=8) is None

    def test_a_group_off_its_size_still_refuses_a_confirmed_replace(self):
        """Gate `REQ-SPIELPLAN-004` on `replace` too and this fails: a replace draws the same fixtures, so it needs the same groups."""

        refusal = refusal_for(replace=True, fixtures_drawn=67, spieltage_held=8, occupancy={**FULL, "B": 4})

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_GRUPPEN_OFF_RULES


class TestAReplaceRunsOnlyInsideItsWindow:
    """`REQ-SPIELPLAN-005`, both halves under one code: `future`, and nothing played.

    Asymmetric with `REQ-SPIELPLAN-003`: that one refuses `past` alone, so a running season may be
    drawn a FIRST time on a status the replace is refused on.
    """

    def test_a_confirmed_replace_of_an_undrawn_future_season_is_permitted(self):
        """The control: a rule refusing every confirmed replace would pass every case below."""

        assert refusal_for(replace=True) is None

    def test_a_running_season_is_refused_the_replace_it_would_be_permitted_a_first_draw(self):
        """Widen the window to `!= "past"` and this fails, which is the whole asymmetry with `REQ-SPIELPLAN-003`."""

        refusal = refusal_for(replace=True, saison_status="active", fixtures_drawn=67, spieltage_held=8)

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW

    def test_a_past_season_reads_the_replace_window_rather_than_the_draw_freeze(self):
        """Judge this after `REQ-SPIELPLAN-003` and it fails: an admin who asked to replace reads the whole window, not half of it."""

        refusal = refusal_for(replace=True, saison_status="past", fixtures_drawn=67, spieltage_held=8)

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW

    def test_one_fixture_that_already_happened_refuses_the_replace(self):
        """Drop the `recorded_fixtures` half and this fails: the replace would delete the record of a match that was played."""

        refusal = refusal_for(replace=True, fixtures_drawn=67, spieltage_held=8, recorded=1)

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW

    def test_a_replace_of_a_season_holding_nothing_is_bounded_by_the_window_too(self):
        """Gate the window on there being something to delete and this fails: the flag would then mean a replace here and a first draw there."""

        refusal = refusal_for(replace=True, saison_status="active")

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW

    def test_the_message_names_the_status_and_how_many_fixtures_happened(self):
        """A bare code sends an admin to the database; both halves are what say which one closed the window."""

        refusal = refusal_for(replace=True, saison_status="active", fixtures_drawn=67, spieltage_held=8, recorded=3)

        assert refusal is not None
        assert "active" in refusal.message
        assert "3 fixture(s)" in refusal.message

    def test_the_message_enumerates_every_category_that_closes_the_window(self):
        """The sentence is what an admin repairs from, so it goes stale the moment `holds_a_recorded_fact` weighs one more field."""

        refusal = refusal_for(replace=True, saison_status="active", recorded=1)

        assert refusal is not None
        assert "a result, a cancellation, a booking, a note or a side moved off the draw" in refusal.message

    def test_an_unconfirmed_draw_is_judged_by_the_draw_rules_alone(self):
        """Read the window off the season rather than off the flag and this fails: a running season's first draw is permitted."""

        refusal = refusal_for(saison_status="active", fixtures_drawn=67, spieltage_held=8)

        assert refusal is not None
        assert refusal.error_code == SPIELPLAN_ALREADY_DRAWN


ADLER = "68f0a1b2c3d4e5f607600011"
BIEBER = "68f0a1b2c3d4e5f607600012"
SPIELORT = "68f0a1b2c3d4e5f607600001"
SCHIEDSRICHTER = "68f0a1b2c3d4e5f607600002"

# Off the enum rather than spelled: every phase but the one the draw seats its sides on is judged
# the same way, so whichever comes first stands for all of them.
BRACKET_PHASE: FLSaisonPhase = next(phase for phase in PHASE_ORDER if phase != DRAWN_HOLDING_ITS_SIDES)

# A GROUP fixture exactly as the draw wrote it: both sides seated, no wiring, every field a record
# could land in empty. No `notiz` key at all, which is the shape
# `app/api/saisons/spielplan.py :: _spiel` leaves.
UNTOUCHED_FIXTURE: Mapping[str, Any] = {
    "saison_phase": DRAWN_HOLDING_ITS_SIDES,
    "ergebnis": None,
    "elfmeterschiessen": None,
    "sonderereignis": None,
    "team1": {"team_id": ADLER, "tore": None},
    "team2": {"team_id": BIEBER, "tore": None},
    "team1_quelle": None,
    "team2_quelle": None,
    "ort": {"spielort_id": None},
    "schiedsrichter": {"schiedsrichter_id": None},
}

# The OTHER shape the same draw writes, and the one an admin seeds by hand: a knockout slot wired to
# a placing and holding nobody.
UNTOUCHED_BRACKET: Mapping[str, Any] = {
    **UNTOUCHED_FIXTURE,
    "saison_phase": BRACKET_PHASE,
    "team1": None,
    "team2": None,
    "team1_quelle": {"type": "gruppe", "gruppe": "A", "platz": 1},
    "team2_quelle": {"type": "gruppe", "gruppe": "B", "platz": 2},
}


def value_at(spiel: Mapping[str, Any], projected: str) -> Any:
    """What one projected path resolves to, read the way the predicate itself reads it.

    `or {}` rather than a `None` test: the projection delivers a null head where the stored field is
    null, and a leaf under one is then absent rather than false.
    """

    head, _, leaf = projected.partition(".")
    value = spiel.get(head)

    return (value or {}).get(leaf) if leaf else value


@dataclass(frozen=True)
class RecordedEdit:
    """One projected field, and what somebody entering something in THAT field looks like."""

    # Carried into the assertion, so a narrowed predicate names the fact it stopped seeing.
    why: str
    gruppe: Mapping[str, Any]
    # Declared for the fields the draw leaves inverted between the two shapes, and only those;
    # `INVERTED_BY_THE_DRAW` below holds the two sets to each other.
    ko: Mapping[str, Any] | None = None


# One entry per `app/api/saisons/services.py :: RECORDED_FACT_FIELDS` path. Keyed by the whole path
# and never its head: a leaf added under `team1` then owes an entry of its own rather than folding
# into one already here and passing unweighed.
RECORDED_EDITS: Mapping[str, RecordedEdit] = {
    # NO record of its own -- it is the DISCRIMINATOR, so its edit is the flip under a pair of sides
    # nobody touched. Read the wrong one and every drawn season is misjudged in one direction.
    "saison_phase": RecordedEdit(
        why="the phase, which records nothing itself and decides which shape the sides are read against",
        gruppe={"saison_phase": BRACKET_PHASE},
        ko={"saison_phase": DRAWN_HOLDING_ITS_SIDES},
    ),
    "team1.team_id": RecordedEdit(
        why="the side a Spieltag release empties, and the bracket slot a resolution seeded",
        gruppe={"team1": None},
        ko={"team1": {"team_id": ADLER, "tore": None}},
    ),
    "team2.team_id": RecordedEdit(
        why="the same on the other side, which a loop over one slot would miss",
        gruppe={"team2": None},
        ko={"team2": {"team_id": BIEBER, "tore": None}},
    ),
    # Its side left SEATED and unwired, so nothing but the goal count can be what answers.
    "team1.tore": RecordedEdit(why="a goal count standing without a result", gruppe={"team1": {"team_id": ADLER, "tore": 0}}),
    "team2.tore": RecordedEdit(why="the same count on the other side", gruppe={"team2": {"team_id": BIEBER, "tore": 0}}),
    "team1_quelle": RecordedEdit(
        why="wiring `REQ-WIRING-001` refuses on a group fixture, and a bracket slot whose wiring an admin cleared",
        gruppe={"team1_quelle": {"type": "gruppe", "gruppe": "A", "platz": 1}},
        ko={"team1_quelle": None},
    ),
    "team2_quelle": RecordedEdit(
        why="the same on the other side",
        gruppe={"team2_quelle": {"type": "gruppe", "gruppe": "B", "platz": 2}},
        ko={"team2_quelle": None},
    ),
    "ergebnis": RecordedEdit(why="a result", gruppe={"ergebnis": "2:1"}),
    # Beside a result rather than behind it: `apply_payload_to_spiel` keeps a shoot-out only where it
    # stores a result too, so one standing alone came by the hand edit route the goals above did.
    "elfmeterschiessen": RecordedEdit(why="a shoot-out standing without a result", gruppe={"elfmeterschiessen": {"team1": 4, "team2": 3}}),
    # The value awarding NOTHING on purpose: `has_taken_place` reads it as untouched, so reaching for
    # that narrower question instead of this window is the mistake this entry is here to fail.
    "sonderereignis": RecordedEdit(why="a cancellation, which awards nothing and is still a record", gruppe={"sonderereignis": "ausgefallen"}),
    "ort.spielort_id": RecordedEdit(why="a booked venue", gruppe={"ort": {"spielort_id": SPIELORT}}),
    "schiedsrichter.schiedsrichter_id": RecordedEdit(why="a booked referee", gruppe={"schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER}}),
    "notiz": RecordedEdit(why="an admin's note, which only `PATCH /spiele/{spiel_id}` writes", gruppe={"notiz": "Platz gesperrt"}),
}

# The projected paths the two drawn shapes disagree about -- the sides half, which
# `app/api/saisons/services.py :: _a_side_is_off_the_draw` reads. Derived, so a field that becomes
# inverted is asked for both directions with nobody listing it.
INVERTED_BY_THE_DRAW: frozenset[str] = frozenset(
    path for path in RECORDED_FACT_FIELDS if value_at(UNTOUCHED_FIXTURE, path) != value_at(UNTOUCHED_BRACKET, path)
)


class TestWhatCountsAsRecordedAgainstAFixture:
    """`holds_a_recorded_fact`, which is what the endpoint counts for `REQ-SPIELPLAN-005`.

    The refusal reads a COUNT, so no test of it reaches this: the window closes on a cancellation
    and on a booking as well as on a result.
    """

    def test_the_projection_the_map_and_the_two_drawn_shapes_are_read_before_anything_below(self):
        """The floor: a derivation that quietly finds nothing makes every case under it vacuous.

        The tuple is IMPORTED rather than parsed, so what stands in for "did the parse work" is
        every derivation here being non-empty and the two fixtures genuine inverses.
        """

        assert RECORDED_FACT_FIELDS
        assert RECORDED_EDITS
        assert INVERTED_BY_THE_DRAW
        assert BRACKET_PHASE != DRAWN_HOLDING_ITS_SIDES

        # A PROPER subset, so the breadth below is asked of values `has_taken_place` answers for
        # and of the ones it does not; equality would make the two questions one.
        assert set(SONDEREREIGNIS_WITHOUT_A_RESULT) < set(get_args(FLSonderereignis))

        for slot in ("team1", "team2"):
            assert UNTOUCHED_FIXTURE[slot] is not None and UNTOUCHED_FIXTURE[f"{slot}_quelle"] is None, "the group fixture is not as drawn"
            assert UNTOUCHED_BRACKET[slot] is None and UNTOUCHED_BRACKET[f"{slot}_quelle"] is not None, "the bracket fixture is not as drawn"

    def test_a_fixture_the_draw_left_alone_does_not(self):
        """The floor: a predicate answering True for everything would pass every case below."""

        assert holds_a_recorded_fact(UNTOUCHED_FIXTURE) is False

    def test_a_bracket_slot_the_draw_left_alone_does_not_either(self):
        """The second floor, and the one that matters: read a WIRED empty slot as touched and no drawn season is ever replaceable."""

        assert holds_a_recorded_fact(UNTOUCHED_BRACKET) is False

    def test_every_projected_field_is_answered_by_an_edit_and_nothing_else_is(self):
        """THE COUPLING: add a field to `RECORDED_FACT_FIELDS` and this fails naming it.

        Projected and never read is the defect it is against -- the field reaches the predicate,
        changes no answer, and every other test stays green.
        """

        unanswered = sorted(set(RECORDED_FACT_FIELDS) - set(RECORDED_EDITS))
        stale = sorted(set(RECORDED_EDITS) - set(RECORDED_FACT_FIELDS))

        assert (unanswered, stale) == ([], [])

    def test_the_bracket_direction_is_declared_for_every_field_the_draw_inverts(self):
        """Declare a group edit alone for one of these and the rule is pinned in one direction only.

        A group fixture is drawn occupied and unwired and a bracket fixture wired and empty, so each
        of these records by moving the OPPOSITE way on the two shapes.
        """

        assert {path for path, edit in RECORDED_EDITS.items() if edit.ko is not None} == INVERTED_BY_THE_DRAW

    @pytest.mark.parametrize(("projected", "edit"), RECORDED_EDITS.items(), ids=list(RECORDED_EDITS))
    def test_an_edit_departs_from_the_draw_in_its_own_field_and_no_other(self, projected: str, edit: RecordedEdit):
        """An entry closing the window through a NEIGHBOUR proves nothing about the field it is filed under.

        `team1.tore` without its side's id is the case: the fixture then reads as recorded for an
        emptied side, so dropping the goal counts leaves it green.
        """

        for drawn, change in ((UNTOUCHED_FIXTURE, edit.gruppe), (UNTOUCHED_BRACKET, edit.ko)):
            if change is None:
                continue

            edited = {**drawn, **change}
            assert set(change) == {projected.partition(".")[0]}, f"{projected}'s edit does not write its own field"
            assert value_at(edited, projected) != value_at(drawn, projected), f"{projected}'s edit leaves what the draw wrote there"

            moved = [other for other in RECORDED_FACT_FIELDS if other != projected and value_at(edited, other) != value_at(drawn, other)]
            assert moved == [], f"{projected}'s edit also moves {moved}"

    @pytest.mark.parametrize(("projected", "edit"), RECORDED_EDITS.items(), ids=list(RECORDED_EDITS))
    def test_a_fixture_carrying_that_edit_closes_the_window(self, projected: str, edit: RecordedEdit):
        """Stop reading any one of these and a replace deletes the work it records, the endpoint answering 200."""

        assert holds_a_recorded_fact({**UNTOUCHED_FIXTURE, **edit.gruppe}) is True, f"{projected} left the group window open: {edit.why}"

        if edit.ko is not None:
            assert holds_a_recorded_fact({**UNTOUCHED_BRACKET, **edit.ko}) is True, f"{projected} left the bracket window open: {edit.why}"

    @pytest.mark.parametrize("sonderereignis", get_args(FLSonderereignis))
    def test_every_sonderereignis_closes_the_window_whatever_it_awards(self, sonderereignis: str):
        """Reach for `has_taken_place`'s narrower set and the two awarding nothing stop closing it.

        The map above weighs the field once; this asks it of every value the enum offers, so one
        added later is judged rather than assumed.
        """

        assert holds_a_recorded_fact({**UNTOUCHED_FIXTURE, "sonderereignis": sonderereignis}) is True

    @pytest.mark.parametrize(
        ("empty", "why"),
        [
            ({"notiz": None}, "how CLEARING a note is stored: the patch `$set`s the whole model"),
            ({"notiz": ""}, "unreachable through the API, and `spiele`'s validator takes it from a hand edit"),
            ({"notiz": "   "}, "whitespace, which `empty_strings_to_none` catches on the API route alone"),
        ],
    )
    def test_a_note_that_says_nothing_leaves_the_window_open(self, empty: Mapping[str, Any], why: str):
        """Compare `notiz` to None rather than stripping it and the last two close a window nothing was entered in."""

        assert holds_a_recorded_fact({**UNTOUCHED_FIXTURE, **empty}) is False, why

    def test_a_date_and_a_kickoff_time_leave_the_window_open(self):
        """Rescheduling is what a replace is FOR, so a dated fixture stays replaceable and the log keeps the dates."""

        assert holds_a_recorded_fact({**UNTOUCHED_FIXTURE, "datum": "2026-05-01", "uhrzeit": "18:00:00"}) is False


class TestASideMovedOffTheDrawClosesTheWindow:
    """What the map above cannot state: a pair moved together, and a move no stored field records.

    Bracket seeding is what a `future` season accumulates, and `future` is the only status either
    window opens on.
    """

    def test_a_slot_whose_wiring_was_cleared_and_then_filled_is_recorded(self):
        """The manual pick `find_wiring_refusal` invites -- clear the quelle, then name the team.

        Each half has an entry of its own above; neither of those is this shape, which is the one an
        admin actually reaches through the editor.
        """

        picked = {**UNTOUCHED_BRACKET, "team1_quelle": None, "team1": {"team_id": ADLER, "tore": None}}

        assert holds_a_recorded_fact(picked) is True

    def test_swapping_one_group_occupant_for_another_is_NOT_seen(self):
        """The rule's limit, stated so it is not mistaken for a gap nobody noticed.

        The draw seats both sides of every group fixture, so "holds a side" is true of all of them
        and no stored field tells the draw's occupant from a replacement.
        """

        swapped = {**UNTOUCHED_FIXTURE, "team1": {"team_id": "68f0a1b2c3d4e5f607600013", "tore": None}}

        assert holds_a_recorded_fact(swapped) is False

    def test_a_fixture_reaching_the_predicate_without_a_phase_is_recorded(self):
        """Drop `saison_phase` from the projection and every window shuts rather than opening on a season somebody drew by hand."""

        no_phase = {key: value for key, value in UNTOUCHED_FIXTURE.items() if key != "saison_phase"}

        assert holds_a_recorded_fact(no_phase) is True


# A season created exactly as long as its own rules ask for: three group matchdays and one final in
# four days. The draw is the one write that can then widen the count without touching the span.
TIGHT_SPAN = ("2026-05-01", "2026-05-04")
TIGHT_RULES = RULES.model_copy(update={"number_of_groups": 2, "teams_per_group": 4, "qualifiers_per_group": 1})

# `qualifiers_per_group` is the free lever: `REQ-SPIELPLAN-004` pins the other two to the clubs
# standing in the groups, and each doubling of the product adds a knockout round.
WIDENED_SHAPE = FLSpielplanShape(number_of_groups=2, teams_per_group=4, qualifiers_per_group=4)


def span_refusal_for(rules: FLSaisonRules) -> WriteRefusal | None:
    """`REQ-DATE-005` as the draw asks it: the season's own span, and no dated matchday to contain."""

    return find_saison_span_refusal(start_date=TIGHT_SPAN[0], end_date=TIGHT_SPAN[1], rules=rules, spieltag_spans=[])


class TestTheShapeADrawRunsFromIsMeasuredAgainstTheSeasonsSpan:
    """`REQ-DATE-005` over the draw's own three, which decide how many matchdays a season takes.

    The draw writes all three, so it can move that count on a season whose span was measured
    against the numbers it replaces.
    """

    def test_the_season_as_it_was_created_is_long_enough_for_its_own_rules(self):
        """The control, and what `POST /saisons` already measured: the state below is one the draw alone reaches."""

        assert span_refusal_for(TIGHT_RULES) is None

    def test_the_shape_the_draw_would_run_from_is_refused(self):
        """Measure the STORED rules and this fails: the four matchdays the season was created for still fit its four days."""

        refusal = span_refusal_for(TIGHT_RULES.model_copy(update=WIDENED_SHAPE.model_dump()))

        assert refusal is not None
        assert refusal.error_code == SAISON_SPAN_BELOW_SCHEDULE
        assert "6 matchday(s)" in refusal.message

    def test_the_draws_own_refusal_lets_that_shape_through(self):
        """Why the endpoint owes a call of its own: this rule reads the groups and who stands in them, and no date at all."""

        assert refusal_for(rules=TIGHT_RULES.model_copy(update=WIDENED_SHAPE.model_dump()), occupancy={"A": 4, "B": 4}) is None
