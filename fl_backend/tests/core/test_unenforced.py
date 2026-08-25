import ast
import inspect
from pathlib import Path
from typing import Any, Callable

import pytest
from bson import ObjectId

from app.api.aktionen.schemas import FLAktion
from app.api.saisons.admin_router import _spieltag_clashes
from app.api.saisons.schedule import schedule_for
from app.api.saisons.schemas import FLPatchSaisonPayload, FLPostSaisonPayload, FLSaisonRules
from app.api.saisons.services import find_rules_refusal, find_spielplan_refusal, find_undraw_refusal
from app.api.spiele.admin_router import patch_spiel_data
from app.api.spiele.schemas import (
    SONDEREREIGNIS_KEEPING_ITS_SLOT,
    SONDEREREIGNIS_WITHOUT_A_RESULT,
    FLBracketFaultGruppe,
    FLBracketFaultOccupant,
    FLBracketFaultQuelle,
    FLBracketFaultSpiel,
    FLPatchSpielDataPayload,
    FLSpiel,
    FLSpielJoinedInternal,
    FLSpielJoinedInternalListAdapter,
    FLSpielListAdapter,
)
from app.api.spiele.services import (
    STATE_RESULT_ON_A_NON_EVENT,
    SaisonMembership,
    find_booking_refusal,
    find_clash_refusal,
    find_departed_occupants,
    find_eligibility_refusal,
    find_fixture_date_refusal,
    find_result_removal_refusal,
    find_state_refusal,
    find_wiring_refusal,
    judge_spieltag_occupancy,
    resolve_bracket,
)
from app.api.spieler.admin_router import delete_saison_spieler, delete_spieler, post_spieler
from app.api.spieler.schemas import FLPostSpielerPayload
from app.api.spieler.services import find_squad_refusal
from app.api.spieltage.admin_router import patch_spieltag
from app.api.spieltage.services import DatedNeighbour, find_spieltag_order_refusal, with_expected_matches
from app.api.teams.services import find_gruppe_swap_refusal
from app.core.collections import Collection
from app.core.constraints import COLLECTION_VALIDATORS, UNIQUE_INDEXES
from tests.core.app_source import (
    COLLECTION_ARGUMENT_SUFFIX,
    WRITE_HELPERS,
    app_calls,
    callee,
    calls_in,
    declared,
    module_of,
    parsed,
    removals,
    transactional_callbacks,
)

PayloadFactory = Callable[..., dict[str, Any]]

# The callback `activate_saison` runs as one transaction, which is where both `status` writes
# stand. Named because two rules below read it and neither should re-derive it.
ACTIVATION_CALLBACK = "judge_and_roll_the_league_over"

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
    return {"team_id": team_id, "name": name, "tore": None, "shorthand": name[:2].upper(), **overrides}


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
        }
    )


def _rules(**overrides: Any) -> FLSaisonRules:
    return FLSaisonRules.model_validate(
        {
            "win_points": 3,
            "draw_points": 1,
            "qualifiers_per_group": 2,
            "number_of_groups": 4,
            "teams_per_group": 4,
            "tiebreak_order": "tordifferenz",
            "max_kadergroesse": 50,
            "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
            "erlaubte_stufen": ["E1", "E2", "Q1", "Q2"],
            **overrides,
        }
    )


def _on_create(proposed: FLSaisonRules):
    """A create, where `stored` is `None` and only the rules reading the payload alone can fire."""

    return find_rules_refusal(
        saison_status="future",
        stored=None,
        proposed=proposed,
        occupancy_by_gruppe={},
        highest_wired_platz=0,
    )


def _swap(**overrides: Any):
    """A swap with every gate already open, so a case names only the count it is about."""

    return find_gruppe_swap_refusal(
        **{
            "is_same_team": False,
            "team1_gruppe": "A",
            "team2_gruppe": "B",
            "saison_status": "active",
            "played_knockout_fixtures": 0,
            "played_gruppenphase_fixtures": 0,
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

# The arguments those helpers take their document from. A filter and a projection name a field too,
# and neither writes it.
WRITE_DOCUMENTS = frozenset({"document", "update"})

# The driver calls that change a document, and the modules `app/core/crud.py`'s own header holds them
# to -- where a write reaches the driver anywhere else, it can carry its document past the sweeps.
DRIVER_WRITES = frozenset(
    {"bulk_write", "find_one_and_replace", "find_one_and_update", "insert_many", "insert_one", "replace_one", "update_many", "update_one"}
)
WRITE_MODULES = ("app/core/crud.py", "app/core/recording.py")


def _driver_calls(methods: frozenset[str]) -> list[str]:
    """Where the application calls one of `methods`, each as its module and the function holding the call."""

    return sorted({f"{module} :: {scope}" for module, scope, call in app_calls() if callee(call) in methods})


def _literal_writes_of(field: str) -> set[tuple[str, str]]:
    """Every write naming `field` in a literal document, as the function making it and the value it sets."""

    writes: set[tuple[str, str]] = set()
    for _, scope, call in app_calls():
        for keyword in call.keywords:
            if keyword.arg not in WRITE_DOCUMENTS:
                continue

            for node in ast.walk(keyword.value):
                if not isinstance(node, ast.Dict):
                    continue

                for key, value in zip(node.keys, node.values, strict=True):
                    if isinstance(key, ast.Constant) and key.value == field:
                        writes.add((scope, str(value.value) if isinstance(value, ast.Constant) else "<composed>"))

    return writes


def _callers_of(module: Path, called: str) -> set[str]:
    """Every function in one module that calls `called`, by name."""

    return {scope for scope, call in calls_in(parsed(module), "<module>") if callee(call) == called}


def _calls_of(function: Callable[..., Any]) -> set[str]:
    """The names one function itself calls; a call a nested helper makes answers under that helper."""

    name = function.__name__

    return {callee(call) for scope, call in calls_in(declared(function), name) if scope == name}


class TestExactlyOneActiveSeason:
    """That no store-level constraint holds two seasons apart, and that one transaction is the whole of what the app does."""

    def test_no_unique_index_reaches_the_status_field(self):
        # The floor: `saisons` carries no unique index at all, so what proves the sweep read
        # something is a key it DOES find. Without it an emptied `UNIQUE_INDEXES` leaves the claim
        # below passing over nothing.
        assert "saison_id" in {key for index in UNIQUE_INDEXES for key in index.keys}

        covering = [index.name for index in UNIQUE_INDEXES if "status" in index.keys]

        assert not covering, f"{covering} would make this a database guarantee, and the entry claims it is not"

    def test_the_validator_types_the_field_and_says_nothing_about_the_collection(self):
        """A `$jsonSchema` sees one document, so the closest it comes is the enum -- which permits every season being active."""

        status = COLLECTION_VALIDATORS[Collection.SAISONS]["$jsonSchema"]["properties"]["status"]

        assert set(status) == {"bsonType", "enum"}

    def test_only_the_activation_writes_a_status_a_second_season_could_hold(self):
        """Every literal write under `app/` naming the field, as the function making it and the value it sets."""

        # The sweep reads the document a write helper is GIVEN, so it is complete only while every
        # write goes through one: a driver call takes its document positionally.
        assert [call for call in _driver_calls(DRIVER_WRITES) if not call.startswith(WRITE_MODULES)] == []

        # `post_saison` writes the constant `future` at create, which no second season contradicts;
        # `active` and the demotion to `past` are one function's, which is what lets one transaction
        # hold the pair. That function is the callback the activation runs, not the endpoint.
        assert _literal_writes_of("status") == {
            ("post_saison", "future"),
            (ACTIVATION_CALLBACK, "past"),
            (ACTIVATION_CALLBACK, "active"),
        }

    def test_no_season_payload_carries_the_field(self):
        """The route the sweep above cannot see: the patch writes its payload wholesale, so a `status` field would ride along unnamed."""

        assert not {"status"} & set(FLPostSaisonPayload.model_fields)
        assert not {"status"} & set(FLPatchSaisonPayload.model_fields)

    def test_the_demotion_and_the_promotion_share_one_transaction(self):
        """Both writes inside the callback the activation runs as one transaction, each carrying its session.

        Split them across two callbacks and this fails: a demotion that committed without the
        promotion would leave the league with no active season at all.
        """

        activation = [entry for entry in transactional_callbacks(WRITE_HELPERS) if entry.where.endswith(ACTIVATION_CALLBACK)]

        assert len(activation) == 1, f"{ACTIVATION_CALLBACK} is run by {len(activation)} transactions"
        assert set(activation[0].writes) == {("patch_many_in_db", True), ("patch_one_in_db", True)}


class TestAMatchdayOffItsImpliedCount:
    """That the count a phase implies reaches the matchday's own write nowhere, so no state of the two can be refused there."""

    def test_the_matchday_write_refuses_on_its_dates_alone(self):
        """Matched on the suffix rather than the `find_` prefix, which the driver's own reads share: what is pinned is the refusals."""

        assert {call for call in _calls_of(patch_spieltag) if call.endswith("_refusal")} == {
            "find_spieltag_span_refusal",
            "find_spieltag_order_refusal",
        }

    def test_the_implied_count_is_read_for_the_echo_and_nothing_else(self):
        """`expected_matches` is the figure a mismatch would be measured against, so where it is called is where a refusal could form."""

        module = module_of(with_expected_matches)

        assert _callers_of(module, "expected_matches") == {"with_expected_matches"}
        assert _callers_of(module_of(patch_spieltag), "expected_matches") == set()


class TestASharedSquadNumber:
    """That nothing compares one squad row's number against another's, at either end."""

    def test_no_unique_index_reaches_a_squad_number(self):
        # The floor: the squad junction IS uniquely indexed, so the empty result below is `nummer`
        # going unkeyed rather than a sweep over nothing.
        assert [index for index in UNIQUE_INDEXES if index.collection == Collection.SAISON_SPIELER]

        covering = [index.name for index in UNIQUE_INDEXES if "nummer" in index.keys]

        assert not covering

    def test_the_squad_refusal_is_about_the_club_and_never_the_number(self):
        assert set(inspect.signature(find_squad_refusal).parameters) == {"team_in_saison"}


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


class TestNoBracketFaultIsStored:
    """That the discriminator every fault variant carries is on no collection, so no fault can have been written."""

    @pytest.mark.parametrize("collection", sorted(COLLECTION_VALIDATORS), ids=str)
    def test_no_collection_stores_a_faults_reason(self, collection):
        assert "reason" not in COLLECTION_VALIDATORS[collection]["$jsonSchema"]["properties"]

    def test_every_variant_is_discriminated_by_that_field(self):
        """Pinned so the check above keeps meaning what it says: a variant discriminated some other way would slip past it."""

        for variant in (FLBracketFaultGruppe, FLBracketFaultQuelle, FLBracketFaultSpiel, FLBracketFaultOccupant):
            assert "reason" in variant.model_fields


class TestNoPurgeReachesARetiredRow:
    """That a removal reaches the driver from `app/core/crud.py` alone, and that none selects on an age.

    Deletion is that module's removal helpers and `inactive_since`, so a purge built later is
    logged by construction, and no retention sweep stands here.
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

        # The shape a retention sweep would select by. The erasure names a person and the replace a
        # season, so a new caller of either helper is free -- selecting on an AGE is what is refused.
        assert RETIREMENT_FIELD not in selected_on, f"a removal selects on {RETIREMENT_FIELD}, which is the retention sweep nothing here builds"


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

    def test_a_swap_breaking_nothing_new_is_permitted(self):
        assert _swap(clashing_spieltage=0) is None

    def test_the_broken_spieltag_is_what_refuses_the_swap(self):
        assert _swap(clashing_spieltage=1) is not None


class TestAPersonWithNoSquadRow:
    """That a person is created without a squad row and that no rule asks for one afterwards."""

    def test_creating_a_person_asks_for_no_season_and_no_club(self):
        assert not {"saison_id", "team_id"} & set(FLPostSpielerPayload.model_fields)

    def test_the_squad_rule_governs_the_row_rather_than_its_absence(self):
        """The person create against the three squad-row writes: `REQ-SQUAD-001` is asked where a row is written and nowhere else."""

        # `refuse` is how a write path raises a `WriteRefusal`, so a create reaching none is a create
        # no rule can stop -- which is the state this entry permits.
        assert "refuse" not in _calls_of(post_spieler)

        # The REACTIVATE for the same reason as the other two: a club replacement retires the
        # outgoing club's rows without moving their `team_id`, so reviving one restores a live row
        # for a club the season no longer holds -- the state `REQ-SQUAD-001` refuses.
        assert _callers_of(module_of(post_spieler), find_squad_refusal.__name__) == {
            "post_saison_spieler",
            "patch_saison_spieler",
            "reactivate_saison_spieler",
        }


# The junction as the refusal reads it: the season's own name for the club, and the day it left.
MEMBERSHIP = {
    ObjectId(ADLER): SaisonMembership(name="Adler", shorthand="AD", departed_from=EXIT_BEFORE_THE_FIXTURE),
    ObjectId(BIEBER): SaisonMembership(name="Bieber", shorthand="BI", departed_from=None),
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

        assert FLAktion.model_fields["before"].annotation == dict[str, Any] | list[dict[str, Any]] | None

    def test_the_validator_asks_no_more_of_it(self):
        """The other end of the same claim: a `$jsonSchema` tightening it would refuse the write rather than the read."""

        before = COLLECTION_VALIDATORS[Collection.AKTIONEN]["$jsonSchema"]["properties"]["before"]

        assert set(before) == {"bsonType"}


class TestAPhaseDatedAgainstTheOrderItIsPlayedIn:
    """That the order rule is handed one phase at a time, and that the phases it would have to compare hold one matchday each."""

    def test_the_refusal_is_handed_no_phase_at_all(self):
        """Its whole input: the span this request carries, the day the matchday stands on, and two neighbours of a position and a day."""

        assert set(inspect.signature(find_spieltag_order_refusal).parameters) == {
            "beginn",
            "ende",
            "stored_beginn",
            "previous",
            "following",
        }
        assert set(DatedNeighbour.__dataclass_fields__) == {"position", "beginn"}

    def test_the_neighbours_are_read_inside_one_phase(self):
        """The filter the endpoint builds, read out of its own source: the subject's OWN phase is what keeps two phases apart."""

        keyed_on = {
            key.value: ast.unparse(value)
            for node in ast.walk(declared(patch_spieltag))
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Dict)
            for key, value in zip(node.value.keys, node.value.values, strict=True)
            if isinstance(key, ast.Constant)
        }

        # `ast.unparse` normalises to single quotes, whatever the source spells them as.
        assert keyed_on["saison_id"] == "stored_raw['saison_id']"
        assert keyed_on["saison_phase"] == "stored_raw['saison_phase']"

    def test_a_knockout_phase_is_drawn_with_one_matchday(self):
        """One matchday makes no pair to order, which is what leaves the rule inert everywhere but the group phase."""

        counts = {entry.phase: entry.matchdays for entry in schedule_for(_rules())}
        knockout = {phase: matchdays for phase, matchdays in counts.items() if phase != "gruppenphase"}

        assert counts["gruppenphase"] > 1
        assert knockout and set(knockout.values()) == {1}


def _stamped_by(endpoint: Callable[..., Any]) -> set[str]:
    """The collections one endpoint hands `set_inactive_since`, read off its own call site."""

    return {
        keyword.value.id
        for scope, call in calls_in(declared(endpoint), endpoint.__name__)
        if scope == endpoint.__name__ and callee(call) == "set_inactive_since"
        for keyword in call.keywords
        if keyword.arg == "collection" and isinstance(keyword.value, ast.Name)
    }


class TestARetiredPersonKeepsALiveSquadRow:
    """That retiring a person stamps `spieler` alone, and that a squad row is left by an endpoint of its own."""

    def test_the_person_retire_is_handed_no_squad_collection(self):
        """A collection an endpoint never receives is one it cannot cascade into, whatever its body turns out to say."""

        taken = {argument.arg for argument in declared(delete_spieler).args.args}

        assert {name for name in taken if name.endswith(COLLECTION_ARGUMENT_SUFFIX)} == {"spieler_collection"}

    def test_the_two_retirements_are_stamped_by_two_endpoints(self):
        """One helper, two subjects: the person's day and the row's are written by separate routes, and neither consults the other."""

        assert _stamped_by(delete_spieler) == {"spieler_collection"}
        assert _stamped_by(delete_saison_spieler) == {"saison_spieler_collection"}


# Every refusal `PATCH /spiele/{spiel_id}` runs, which is the whole of what could gate a result on
# the season's status.
FIXTURE_PATCH_REFUSALS = (
    find_booking_refusal,
    find_clash_refusal,
    find_eligibility_refusal,
    find_fixture_date_refusal,
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

        assert "status" not in FLSpiel.model_fields

    def test_the_set_above_is_every_refusal_the_endpoint_runs(self):
        """A hand-kept list is a sweep that quietly sees less, so a refusal added to the patch fails here rather than going unweighed."""

        named = {refusal.__name__ for refusal in FIXTURE_PATCH_REFUSALS}
        # Nested scopes included: the endpoint runs most of these inside its transaction callback,
        # and a sweep stopping at the outer body would find none of them and pass on emptiness.
        run = {
            callee(call)
            for _, call in calls_in(declared(patch_spiel_data), patch_spiel_data.__name__)
            if callee(call).endswith("_refusal") or callee(call).startswith("judge_")
        }

        assert run == named, f"unweighed: {sorted(run - named)}; weighed but no longer run: {sorted(named - run)}"

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

        assert refusal is not None and refusal.error_code == STATE_RESULT_ON_A_NON_EVENT

    def test_it_sits_outside_the_set_that_awards_nothing(self):
        """The partition is what leaves it out: a fixture that used its slot is not one recording an absence."""

        assert "abgebrochen" in SONDEREREIGNIS_KEEPING_ITS_SLOT
        assert "abgebrochen" not in SONDEREREIGNIS_WITHOUT_A_RESULT
