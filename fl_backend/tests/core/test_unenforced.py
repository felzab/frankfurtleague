import inspect
from collections.abc import Callable
from typing import Any

import pytest
from bson import ObjectId

from app.api.aktionen.schemas import FLAktion, FLAktionMitStand
from app.api.saisons.admin_router import _spieltag_clashes
from app.api.saisons.schedule import schedule_for
from app.api.saisons.schemas import FLSaison, FLSaisonRules
from app.api.saisons.services import find_rules_refusal, find_spielplan_refusal, find_undraw_refusal
from app.api.spiele.schemas import (
    SONDEREREIGNIS_KEEPING_ITS_SLOT,
    SONDEREREIGNIS_WITHOUT_A_RESULT,
    FLBracketFaultBooking,
    FLBracketFaultClash,
    FLBracketFaultGruppe,
    FLBracketFaultOccupant,
    FLBracketFaultQuelle,
    FLBracketFaultSpiel,
    FLPatchSpielDataPayload,
    FLSpiel,
    FLSpielJoinedInternal,
    FLSpielJoinedInternalListAdapter,
    FLSpielListAdapter,
    FLSpielSlotHolder,
)
from app.api.spiele.services import (
    BookedVenue,
    ResolvedReferences,
    SaisonMembership,
    find_booking_refusal,
    find_claims_made,
    find_clash_refusal,
    find_departed_occupants,
    find_double_bookings,
    find_eligibility_refusal,
    find_fixture_date_refusal,
    find_referee_stand_refusal,
    find_result_removal_refusal,
    find_retired_bookings,
    find_slot_claims,
    find_state_refusal,
    find_wiring_refusal,
    judge_spieltag_occupancy,
    reopens,
    resolve_bracket,
    slots_booked_against,
)
from app.api.spieler.services import find_squad_refusal, mark_shared_nummern
from app.api.spieltage.services import DatedNeighbour, find_spieltag_order_refusal
from app.api.teams.services import find_gruppe_swap_refusal
from app.core.codes import Code
from app.core.collections import Collection
from app.core.constraints import UNIQUE_INDEXES
from app.core.exceptions import WriteRefusal
from app.core.readback import RECORD_MODELS
from tests.core.app_source import (
    app_calls,
    callee,
    removals,
)
from tests.documents import rules_document

PayloadFactory = Callable[..., dict[str, Any]]


MATCH_ID = "6890a1b2c3d4e5f60720{:04d}"
SPIELTAG_ONE = "6890a1b2c3d4e5f607210001"
SPIELTAG_TWO = "6890a1b2c3d4e5f607210002"

ADLER = "6890a1b2c3d4e5f607220001"
BIEBER = "6890a1b2c3d4e5f607220002"

# The shared fixture dates every match 2026-03-15, so this exit predates the one below it.
EXIT_BEFORE_THE_FIXTURE = "2026-03-01"

# Before that exit, so one season states both halves: the club was eligible where it won its way
# through, and is disqualified where the slot it reached now stands.
FEEDER_DATE = "2026-02-20"
FEEDER_NR = 25
SLOT_NR = 29


def _side(team_id: str, name: str, **overrides: Any) -> dict[str, Any]:
    return {"team_id": team_id, "name": name, "tore": None, "shorthand": name[:3].upper(), **overrides}


def _joined_side(team_id: str, name: str, *, disqualified_from: str | None = None, **overrides: Any) -> dict[str, Any]:
    """One side as the fault walk reads it: the whole exit record, which is what a fault names its effective day from."""

    record = None if disqualified_from is None else {"type": "disqualifikation", "grund": "Nicht angetreten", "datum": disqualified_from}

    return _side(team_id, name, austritt=record, austritt_type=None if record is None else record["type"], **overrides)


@pytest.fixture
def one_fixture(spiel: PayloadFactory) -> list[dict[str, Any]]:
    """One undecided group fixture between two clubs, which is the smallest slice the occupant rules read."""

    return [
        spiel(
            _id=MATCH_ID.format(1),
            spiel_nr=1,
            spieltag_id=SPIELTAG_ONE,
            team1=_side(ADLER, "Adler"),
            team2=_side(BIEBER, "Bieber"),
            ergebnis=None,
        )
    ]


@pytest.fixture
def filled_bracket_slot(spiel: PayloadFactory) -> list[FLSpielJoinedInternal]:
    """A knockout slot the resolution filled from the feeder below it, held by a club the season disqualified after that feeder was played."""

    return FLSpielJoinedInternalListAdapter.validate_python(
        [
            spiel(
                _id=MATCH_ID.format(FEEDER_NR),
                spiel_nr=FEEDER_NR,
                spieltag_id=SPIELTAG_ONE,
                saison_phase="viertelfinale",
                datum=FEEDER_DATE,
                team1=_joined_side(ADLER, "Adler", disqualified_from=EXIT_BEFORE_THE_FIXTURE, tore=2),
                team2=_joined_side(BIEBER, "Bieber", tore=1),
                ergebnis="2:1",
                ansetzung_bestaetigt=None,
            ),
            spiel(
                _id=MATCH_ID.format(SLOT_NR),
                spiel_nr=SLOT_NR,
                spieltag_id=SPIELTAG_TWO,
                saison_phase="halbfinale",
                team1=_joined_side(ADLER, "Adler", disqualified_from=EXIT_BEFORE_THE_FIXTURE),
                team1_quelle={"type": "spiel", "spiel_nr": FEEDER_NR, "ausgang": "sieger"},
                # Empty rather than filled: a second occupant would put a second entry in the report
                # and blur which slot it names.
                team2=None,
                ergebnis=None,
                ansetzung_bestaetigt=None,
            ),
        ]
    )


def _submitted(stored_field: dict[str, Any] | None, *, keeping: tuple[str, ...]) -> dict[str, Any] | None:
    """One stored sub-document narrowed to what its PAYLOAD declares.

    A stored side, venue and referee each carry a composed name the server owns, and the payload
    models refuse one -- so resubmitting a document verbatim is not the save an admin makes.
    """

    return None if stored_field is None else {key: stored_field[key] for key in keeping}


def _resubmit(season_docs: list[dict[str, Any]], nr: int) -> FLPatchSpielDataPayload:
    """The stored fixture as its own payload: the no-op save every occupant rule turns on."""

    stored = next(doc for doc in season_docs if doc["spiel_nr"] == nr)

    return FLPatchSpielDataPayload.model_validate(
        {
            "sonderereignis": stored["sonderereignis"],
            "team1": _submitted(stored["team1"], keeping=("team_id", "tore")),
            "team2": _submitted(stored["team2"], keeping=("team_id", "tore")),
            "team1_quelle": stored["team1_quelle"],
            "team2_quelle": stored["team2_quelle"],
            "elfmeterschiessen": stored["elfmeterschiessen"],
            "datum": stored["datum"],
            "uhrzeit": stored["uhrzeit"],
            "ort": _submitted(stored["ort"], keeping=("spielort_id", "mietpreis")),
            "schiedsrichter": _submitted(stored["schiedsrichter"], keeping=("schiedsrichter_id", "payment")),
            "notiz": stored.get("notiz"),
            "schiedsrichter_stand": None if stored["schiedsrichter"] is None else stored["schiedsrichter"]["schiedsrichter_id"],
        }
    )


def _rules(**overrides: Any) -> FLSaisonRules:
    return FLSaisonRules.model_validate(rules_document(**{"max_kadergroesse": 50, "erlaubte_stufen": ["E1", "E2", "Q1", "Q2"], **overrides}))


def _on_create(proposed: FLSaisonRules):
    """A create, where `stored` is `None` and only the rules reading the payload alone can fire."""

    return find_rules_refusal(
        stored=None,
        proposed=proposed,
        occupancy_by_gruppe={},
        highest_wired_platz=0,
    )


def _swap(**overrides: Any):
    """A swap with every gate already open, so a case names only the count it is about."""

    return find_gruppe_swap_refusal(
        **{
            "team1_gruppe": "A",
            "team2_gruppe": "B",
            "saison_status": "active",
            "started": False,
            "clashing_spieltage": 0,
            "departed_fixtures": 0,
            **overrides,
        }
    )


# The driver calls that remove a document. `bulk_write` is among them for its delete operations,
# which is how a removal would arrive without naming one.
DRIVER_REMOVALS = frozenset({"bulk_write", "delete_many", "delete_one", "drop", "drop_collection", "find_one_and_delete"})

# The ONE `app/core/crud.py` implements helpers for -- `delete_many_from_db` and `erase_many_from_db`
# both call it -- and so the only removal any module may make. Its complement is banned everywhere,
# that module included.
RECORDED_REMOVALS = frozenset({"delete_many"})

# `app/core/recording.py` writes the log's own rows and removes nothing, so it is not among these.
REMOVAL_MODULES = ("app/core/crud.py",)

# The day a row retired, and so the field a retention sweep would select on.
RETIREMENT_FIELD = "inactive_since"


def _driver_calls(methods: frozenset[str]) -> list[str]:
    """Where the application calls one of `methods`, each as its module and the function holding the call."""

    return sorted({f"{module} :: {scope}" for module, scope, call in app_calls() if callee(call) in methods})


class TestASharedSquadNumber:
    """That no write refuses a number another row wears, and that the one read reporting it compares what is stored."""

    def test_no_unique_index_reaches_a_squad_number(self):
        # The floor: the squad junction IS uniquely indexed, so the empty result below is `nummer`
        # going unkeyed rather than a sweep over nothing.
        assert [index for index in UNIQUE_INDEXES if index.collection == Collection.SAISON_SPIELER]

        covering = [index.name for index in UNIQUE_INDEXES if "nummer" in index.keys]

        assert not covering

    def test_the_squad_refusal_is_about_the_club_and_never_the_number(self):
        assert set(inspect.signature(find_squad_refusal).parameters) == {"team_in_saison"}

    def test_the_marker_compares_the_stored_string_between_live_rows_alone(self):
        """`07` beside `7` is two shirts; an ausgetragen row wearing `9` marks neither itself nor the live `9`."""

        live = {"inactive_since": None}
        rows = [
            {"nummer": "1", **live},
            {"nummer": "1", **live},
            {"nummer": "07", **live},
            {"nummer": "7", **live},
            {"nummer": "9", **live},
            {"nummer": "9", "inactive_since": "2026-03-01"},
            {"nummer": None, **live},
            {"nummer": None, **live},
        ]

        assert [row["nummer_doppelt"] for row in mark_shared_nummern(rows)] == [True, True, False, False, False, False, False, False]


class TestABracketSlotHeldByADisqualifiedClub:
    """That a slot the resolution filled and whose club was disqualified afterwards is REPORTED, and that the resolution leaves it standing."""

    def test_the_slot_is_reported_as_a_derived_fault(self, filled_bracket_slot):
        """The feeder was played before the exit and is clean, so the report names the slot alone."""

        faults = find_departed_occupants(filled_bracket_slot)

        assert [(fault.spiel_nr, fault.side, fault.reason) for fault in faults] == [(SLOT_NR, "team1", "departed_occupant")]

    def test_the_resolution_rewrites_nothing(self, filled_bracket_slot):
        """The same fixtures through the resolution, which reads the wiring the slot was filled from and reports nothing of its own."""

        feeder, slot = filled_bracket_slot

        # The slot's own floor: the same wiring holding the club that LOST IS rewritten, so the empty
        # result below is the disqualification being ignored rather than the source never being read.
        assert resolve_bracket([feeder, slot.model_copy(update={"team1": feeder.team2})], {}).advancements

        # `advancements` is the whole of what the resolution writes back
        # (`fl_backend/app/api/spiele/crud.py :: advance_bracket_winners`).
        resolution = resolve_bracket(filled_bracket_slot, {})

        assert resolution.advancements == []
        assert resolution.bracket_faults == []


RETIRED_GROUND = "6890a1b2c3d4e5f607240001"
GROUND_RETIRED_ON = "2026-02-01"
RETIRED_GROUND_BOOKING = {
    "spielort_id": RETIRED_GROUND,
    "name": "Bezirkssportanlage West",
    "maps_link": "Bezirkssportanlage West",
    "mietpreis": 40,
}
RULES_OF_THE_SEASON = _rules()


@pytest.fixture
def a_semi_final_played_at_a_retired_ground(spiel: PayloadFactory) -> list[dict[str, Any]]:
    """Played where the ground has since retired, which `REQ-RETIRE-003` lets it do."""

    return [
        spiel(
            _id=MATCH_ID.format(SLOT_NR),
            spiel_nr=SLOT_NR,
            spieltag_id=SPIELTAG_TWO,
            saison_phase="halbfinale",
            team1=_side(ADLER, "Adler", tore=2),
            team2=_side(BIEBER, "Bieber", tore=1),
            ergebnis="2:1",
            ort=RETIRED_GROUND_BOOKING,
            schiedsrichter=None,
        )
    ]


class TestARetiredBookingOnAReopenedFixture:
    """That a rewrite voiding a played result keeps a retired booking and reports it, while a save newly booking the row stays refused."""

    def test_the_reopened_fixture_is_reported_and_the_played_one_is_not(self, a_semi_final_played_at_a_retired_ground):
        (played,) = FLSpielListAdapter.validate_python(a_semi_final_played_at_a_retired_ground)
        # What `fl_backend/app/api/spiele/crud.py :: advance_bracket_winners` writes over a slot whose occupant changed.
        reopened = played.model_copy(update={"team1": played.team2, "team2": None, "ergebnis": None})
        retired = {ObjectId(RETIRED_GROUND): GROUND_RETIRED_ON}

        assert reopens(played, ergebnis=reopened.ergebnis, sonderereignis=reopened.sonderereignis)
        assert find_retired_bookings([played], retired_venues=retired, retired_referees={}) == []
        assert [
            (fault.spiel_nr, fault.booking, fault.inactive_since)
            for fault in find_retired_bookings([reopened], retired_venues=retired, retired_referees={})
        ] == [(SLOT_NR, "ort", GROUND_RETIRED_ON)]

    def test_a_save_keeping_it_passes_and_a_save_newly_booking_it_is_refused(self, a_semi_final_played_at_a_retired_ground):
        """Both directions of `REQ-BOOKING-001`: the state stands because the reopened fixture's next save books nothing."""

        (document,) = a_semi_final_played_at_a_retired_ground
        reopened_document = {**document, "team1": document["team2"], "team2": None, "ergebnis": None}
        unbooked_document = {**reopened_document, "ort": None}
        resolved = ResolvedReferences(
            teams={},
            ort=BookedVenue(
                name=RETIRED_GROUND_BOOKING["name"], maps_link=RETIRED_GROUND_BOOKING["maps_link"], inactive_since=GROUND_RETIRED_ON
            ),
        )

        kept = find_booking_refusal(
            ObjectId(MATCH_ID.format(SLOT_NR)),
            _resubmit([reopened_document], SLOT_NR),
            FLSpielListAdapter.validate_python([reopened_document]),
            resolved,
            RULES_OF_THE_SEASON,
        )
        newly_booked = find_booking_refusal(
            ObjectId(MATCH_ID.format(SLOT_NR)),
            _resubmit([reopened_document], SLOT_NR),
            FLSpielListAdapter.validate_python([unbooked_document]),
            resolved,
            RULES_OF_THE_SEASON,
        )

        assert kept is None
        assert newly_booked is not None and newly_booked.error_code == Code.BOOKING_UNKNOWN_RESOURCE


LIFTED_NO_SHOW_NR, BOOKED_AN_HOUR_LATER_NR = 30, 31


@pytest.fixture
def a_lifted_no_show_beside_a_later_booking(spiel: PayloadFactory) -> list[FLSpiel]:
    """Two fixtures of one day at one ground, 18:00 and 19:00: the first's no-show has just been lifted by a rewrite."""

    return FLSpielListAdapter.validate_python(
        [
            spiel(
                _id=MATCH_ID.format(nr),
                spiel_nr=nr,
                spieltag_id=SPIELTAG_TWO,
                saison_phase="halbfinale",
                team1=None,
                team2=None,
                ergebnis=None,
                uhrzeit=uhrzeit,
                schiedsrichter=None,
            )
            for nr, uhrzeit in ((LIFTED_NO_SHOW_NR, "18:00:00"), (BOOKED_AN_HOUR_LATER_NR, "19:00:00"))
        ]
    )


def _holders_of(spiele: list[FLSpiel]) -> list[FLSpielSlotHolder]:
    """The fixtures as the report's read of every claim hands them back."""

    return [FLSpielSlotHolder.model_validate(spiel.model_dump(by_alias=False) | {"_id": spiel.id}) for spiel in spiele]


def _clash_refusal_of(stored: FLSpiel, holders: list[FLSpielSlotHolder], **changes: Any) -> WriteRefusal | None:
    """`REQ-CLASH-001` on a save of `stored` changing `changes`, judged over the claims it makes as `judge` judges them."""

    payload = _resubmit([stored.model_dump()], stored.spiel_nr).model_copy(update=changes)
    claims = find_claims_made(stored, payload)

    return find_clash_refusal(
        datum=payload.datum,
        uhrzeit=payload.uhrzeit,
        booked=[slot for claim in claims for slot in slots_booked_against(claim, holders, spiel_id=stored.id)],
    )


class TestADoubleBookingALiftedNoShowLeaves:
    """That a lifted no-show's clash is reported on both fixtures, a save keeping either slot passes, and a new claim beside it is refused."""

    def test_both_claims_are_reported_and_none_while_the_no_show_stood(self, a_lifted_no_show_beside_a_later_booking):
        lifted, later = a_lifted_no_show_beside_a_later_booking
        still_a_no_show = lifted.model_copy(update={"sonderereignis": "nichtantreten_team2"})

        reported = find_double_bookings([lifted, later], _holders_of([lifted, later]))

        assert [(fault.spiel_nr, fault.booking, fault.other_spiel_nr) for fault in reported] == [
            (LIFTED_NO_SHOW_NR, "ort", BOOKED_AN_HOUR_LATER_NR),
            (BOOKED_AN_HOUR_LATER_NR, "ort", LIFTED_NO_SHOW_NR),
        ]
        # A no-show freed the slot, and the report's read filters it out as the refusal's does.
        assert find_double_bookings([later], _holders_of([later])) == []
        assert find_slot_claims(still_a_no_show) == []

    def test_a_save_keeping_either_slot_passes_and_a_claim_made_inside_the_buffer_is_refused(self, a_lifted_no_show_beside_a_later_booking):
        """Both directions: a note stands on a claim already made, and a new hour inside the buffer of the other is judged."""

        lifted, later = a_lifted_no_show_beside_a_later_booking
        holders = _holders_of([lifted, later])

        assert _clash_refusal_of(lifted, holders, notiz="Nur eine Notiz") is None
        assert _clash_refusal_of(later, holders, notiz="Nur eine Notiz") is None

        moved_inside = _clash_refusal_of(lifted, holders, uhrzeit="17:30:00")
        assert moved_inside is not None and moved_inside.error_code == Code.FIXTURE_DOUBLE_BOOKED
        assert _clash_refusal_of(lifted, holders, uhrzeit="13:00:00") is None


class TestNoBracketFaultIsStored:
    """That the discriminator every fault variant carries is on no collection, so no fault can have been written."""

    @pytest.mark.parametrize("collection", sorted(RECORD_MODELS), ids=str)
    def test_no_collection_stores_a_faults_reason(self, collection):
        assert "reason" not in RECORD_MODELS[collection].model_fields

    def test_every_variant_is_discriminated_by_that_field(self):
        """Pinned so the check above keeps meaning what it says: a variant discriminated some other way would slip past it."""

        for variant in (
            FLBracketFaultGruppe,
            FLBracketFaultQuelle,
            FLBracketFaultSpiel,
            FLBracketFaultOccupant,
            FLBracketFaultBooking,
            FLBracketFaultClash,
        ):
            assert "reason" in variant.model_fields


class TestNoPurgeReachesARetiredRow:
    """That a removal reaches the driver from `app/core/crud.py` alone, and that none selects on an age.

    Deletion is that module's removal helpers and `inactive_since`, so a purge built later is
    logged by construction.
    """

    def test_a_removal_reaches_the_driver_from_one_module_alone(self):
        """The application entire, not its write helpers: several routers reach the driver for reads, so a removal would need no helper."""

        # The floor is the banned set itself: a removal IS found, so emptying `DRIVER_REMOVALS` or
        # dropping `delete_many` from it fails here, rather than leaving the two assertions below
        # green over a sweep that matches nothing.
        reaching_the_driver = _driver_calls(DRIVER_REMOVALS)

        assert reaching_the_driver

        # The five `app/core/crud.py` implements no helper for: a call to one is a removal that
        # records nothing, wherever it stands. `drop` and `drop_collection` could not be recorded at
        # all -- neither names a filter, and neither leaves an image.
        assert _driver_calls(DRIVER_REMOVALS - RECORDED_REMOVALS) == []

        assert [call for call in reaching_the_driver if not call.startswith(REMOVAL_MODULES)] == []

    def test_no_removal_selects_on_the_day_a_row_retired(self):
        """A sweep's SHAPE, never a count of its callers: the module rule above admits one written inside `app/core/crud.py`."""

        selected_on = {field for removal in removals() for field in removal.names}

        # The floor is a filter being seen at all: a sweep reading the wrong keyword would match
        # nothing and pass the assertion below over any application, retention sweep included.
        assert selected_on

        # The shape an age-based purge would select by. The erasure names a person, the replace and the
        # application clocks a season, so a new caller of either helper is free -- an AGE is what is refused.
        assert RETIREMENT_FIELD not in selected_on, f"a removal selects on {RETIREMENT_FIELD}, the age-based purge nothing here builds"


class TestAGroupPhaseEveryClubLeaves:
    """That `qualifiers_per_group` is bounded from above alone, so a seeding-only group stage is legal."""

    def test_a_group_qualifying_every_club_it_holds_is_permitted(self):
        every_club = _rules(number_of_groups=4, teams_per_group=2, qualifiers_per_group=2)

        assert _on_create(every_club) is None

    def test_qualifying_more_than_the_group_holds_is_what_refuses(self):
        too_many = _rules(number_of_groups=4, teams_per_group=2, qualifiers_per_group=4)

        assert _on_create(too_many) is not None


class TestASpieltagAlreadyHoldingAClubTwice:
    """That the swap counts the Spieltage it would BREAK, and that a Spieltag already broken is not among them."""

    def test_a_spieltag_already_doubling_a_club_is_not_counted(self):
        """ADLER stands twice on that Spieltag before the exchange, and twice after it.

        Neither introduced nor worsened, so refusing over it would block the repair.
        """

        assert (
            _spieltag_clashes(
                team_ids=[ADLER, BIEBER],
                gruppenphase_spiele=[
                    {"spieltag_id": SPIELTAG_ONE, "team1": {"team_id": ADLER}, "team2": None},
                    {"spieltag_id": SPIELTAG_ONE, "team1": {"team_id": BIEBER}, "team2": None},
                ],
                knockout_spiele=[{"spieltag_id": SPIELTAG_ONE, "team1": {"team_id": ADLER}, "team2": None}],
            )
            == 0
        )

    def test_the_spieltag_the_exchange_breaks_is_what_counts(self):
        """The same shape with ADLER's own group match elsewhere: it stood once, and BIEBER's arriving one doubles it."""

        assert (
            _spieltag_clashes(
                team_ids=[ADLER, BIEBER],
                gruppenphase_spiele=[
                    {"spieltag_id": SPIELTAG_TWO, "team1": {"team_id": ADLER}, "team2": None},
                    {"spieltag_id": SPIELTAG_ONE, "team1": {"team_id": BIEBER}, "team2": None},
                ],
                knockout_spiele=[{"spieltag_id": SPIELTAG_ONE, "team1": {"team_id": ADLER}, "team2": None}],
            )
            == 1
        )

    def test_a_fixture_naming_no_spieltag_is_left_out_of_the_count(self):
        """Non-vacuous: counted, these two rows would share the null key and read as one Spieltag the exchange breaks."""

        assert (
            _spieltag_clashes(
                team_ids=[ADLER, BIEBER],
                gruppenphase_spiele=[{"spieltag_id": None, "team1": {"team_id": BIEBER}, "team2": None}],
                knockout_spiele=[{"spieltag_id": None, "team1": {"team_id": ADLER}, "team2": None}],
            )
            == 0
        )

    def test_a_swap_breaking_nothing_new_is_permitted(self):
        assert _swap(clashing_spieltage=0) is None

    def test_the_broken_spieltag_is_what_refuses_the_swap(self):
        assert _swap(clashing_spieltage=1) is not None


# The junction as the refusal reads it: the season's own name for the club, and the day it left.
MEMBERSHIP = {
    ObjectId(ADLER): SaisonMembership(name="Adler", shorthand="ADX", departed_from=EXIT_BEFORE_THE_FIXTURE),
    ObjectId(BIEBER): SaisonMembership(name="Bieber", shorthand="BIX", departed_from=None),
}


class TestADisqualifiedClubKeepsItsFixtures:
    """That a disqualification leaves the club's drawn fixtures standing, its opponents' walkover needing them."""

    def test_the_fixtures_it_already_holds_stay_saveable(self, one_fixture):
        refusal = find_eligibility_refusal(
            ObjectId(MATCH_ID.format(1)),
            _resubmit(one_fixture, 1),
            FLSpielListAdapter.validate_python(one_fixture),
            MEMBERSHIP,
        )

        assert refusal is None

    def test_fielding_it_somewhere_new_is_one_of_two_things_that_refuse(self, one_fixture):
        moved_in = _resubmit(one_fixture, 1).model_copy(update={"team2": _resubmit(one_fixture, 1).team1})
        refusal = find_eligibility_refusal(
            ObjectId(MATCH_ID.format(1)),
            moved_in,
            FLSpielListAdapter.validate_python(one_fixture),
            MEMBERSHIP,
        )

        assert refusal is not None

    def test_re_dating_it_past_the_exit_is_the_other(self, one_fixture):
        """The half `REQ-ELIGIBILITY-001` gained: the tolerated state is a fixture STANDING, never one moved past the exit."""

        stored = FLSpielListAdapter.validate_python(one_fixture)
        re_dated = _resubmit(one_fixture, 1).model_copy(update={"datum": "2026-04-01"})

        assert re_dated.team1 is not None and stored[0].team1 is not None
        assert re_dated.team1.team_id == stored[0].team1.team_id, "both sides must be unchanged, or this proves the other half"

        refusal = find_eligibility_refusal(ObjectId(MATCH_ID.format(1)), re_dated, stored, MEMBERSHIP)

        assert refusal is not None


class TestAStoredPreImageIsNeverRevalidated:
    """That the log's copy of a document is typed as data, so a migration cannot make an old row unreadable."""

    def test_the_stored_image_is_typed_as_data(self):
        """Two arms because a removal takes a set, and neither names a field of any collection."""

        assert FLAktionMitStand.model_fields["before"].annotation == dict[str, Any] | list[dict[str, Any]] | None

    def test_the_list_model_carries_no_image_at_all(self):
        """The other half of the containment: the page-sized read cannot serve what it does not declare."""

        assert "before" not in FLAktion.model_fields


class TestAPhaseDatedAgainstTheOrderItIsPlayedIn:
    """That the order rule is handed one phase at a time, and that the phases it would have to compare hold one matchday each."""

    def test_the_refusal_is_handed_no_phase_at_all(self):
        """Its whole input: the `beginn` this request carries, the day the matchday stands on, and two neighbours of a position and a day."""

        assert set(inspect.signature(find_spieltag_order_refusal).parameters) == {
            "beginn",
            "stored_beginn",
            "previous",
            "following",
        }
        assert set(DatedNeighbour.__dataclass_fields__) == {"position", "beginn"}

    def test_a_knockout_phase_is_drawn_with_one_matchday(self):
        """One matchday makes no pair to order, which is what leaves the rule inert everywhere but the group phase."""

        counts = {entry.phase: entry.matchdays for entry in schedule_for(_rules())}
        knockout = {phase: matchdays for phase, matchdays in counts.items() if phase != "gruppenphase"}

        assert counts["gruppenphase"] > 1
        assert knockout and set(knockout.values()) == {1}


# Every refusal `PATCH /spiele/{spiel_id}` runs, which is the whole of what could gate a result on
# the season's status.
FIXTURE_PATCH_REFUSALS = (
    find_booking_refusal,
    find_clash_refusal,
    find_eligibility_refusal,
    find_fixture_date_refusal,
    find_referee_stand_refusal,
    find_result_removal_refusal,
    find_state_refusal,
    find_wiring_refusal,
    judge_spieltag_occupancy,
)


class TestAFutureSeasonHoldingRecordedResults:
    """That nothing the fixture patch refuses on can see the season's status, and that the windows reading it take the record apart from it."""

    def test_nothing_the_patch_refuses_on_is_handed_the_status(self):
        """Both routes to it: no refusal takes the status, and the fixture slice they are given carries no such field either."""

        for refusal in FIXTURE_PATCH_REFUSALS:
            assert "saison_status" not in inspect.signature(refusal).parameters, refusal.__name__

        assert "status" in FLSaison.model_fields
        assert "status" not in FLSpiel.model_fields

    def test_both_windows_take_the_record_and_the_status_as_two_figures(self):
        """`REQ-SPIELPLAN-005` and `REQ-SPIELPLAN-006` share one sentence for the same reason: neither infers the record from the status."""

        for refusal in (find_spielplan_refusal, find_undraw_refusal):
            assert {"saison_status", "recorded_fixtures"} <= set(inspect.signature(refusal).parameters), refusal.__name__


def _abandoned(*, tore: tuple[int | None, int | None]) -> FLPatchSpielDataPayload:
    """An abandonment as the editor saves it, with a decided score or with none."""

    return FLPatchSpielDataPayload.model_validate(
        {
            "sonderereignis": "abgebrochen",
            "team1": {"team_id": ADLER, "tore": tore[0]},
            "team2": {"team_id": BIEBER, "tore": tore[1]},
            "team1_quelle": None,
            "team2_quelle": None,
            "elfmeterschiessen": None,
            "datum": FEEDER_DATE,
            "uhrzeit": "18:00:00",
            "ort": None,
            "schiedsrichter": None,
            "notiz": None,
            "schiedsrichter_stand": None,
        }
    )


class TestAnAbandonedFixtureAndItsResult:
    """That an abandonment is refused neither for carrying a score nor for carrying none, while the rule that would bar it stays live."""

    @pytest.mark.parametrize("tore", [(None, None), (3, 1)], ids=["nothing recorded", "a decided score"])
    def test_the_state_rule_passes_an_abandonment_either_way(self, tore):
        assert find_state_refusal(_abandoned(tore=tore)) is None

    def test_the_same_payload_under_an_event_awarding_nothing_is_refused(self):
        """The control, because a rule that refused nothing at all would pass the two above without meaning anything."""

        cancelled = _abandoned(tore=(3, 1)).model_copy(update={"sonderereignis": "ausgefallen"})
        refusal = find_state_refusal(cancelled)

        assert refusal is not None and refusal.error_code == Code.STATE_RESULT_ON_A_NON_EVENT

    def test_it_sits_outside_the_set_that_awards_nothing(self):
        """The partition is what leaves it out: a fixture that used its slot is not one recording an absence."""

        assert "abgebrochen" in SONDEREREIGNIS_KEEPING_ITS_SLOT
        assert "abgebrochen" not in SONDEREREIGNIS_WITHOUT_A_RESULT
