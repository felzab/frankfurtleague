import ast
import inspect
from pathlib import Path
from typing import Any, Callable, Mapping

import pytest
from bson import ObjectId

from app.api.aktionen.schemas import FLAktion, FLAktionMitStand
from app.api.saisons.admin_router import _spieltag_clashes
from app.api.saisons.schedule import schedule_for
from app.api.saisons.schemas import FLPatchSaisonPayload, FLPostSaisonPayload, FLSaisonRules
from app.api.saisons.services import SPIELPLAN_GRUPPEN_OFF_RULES, find_rules_refusal, find_spielplan_refusal, find_undraw_refusal
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
from app.api.spieler.admin_router import _refuse_a_full_squad, delete_saison_spieler, delete_spieler, post_spieler, reactivate_saison_spieler
from app.api.spieler.schemas import FLPostSpielerPayload
from app.api.spieler.services import SQUAD_FULL, find_squad_capacity_refusal, find_squad_refusal
from app.api.spieltage.admin_router import patch_spieltag
from app.api.spieltage.services import SPIELTAG_BEGINN_OUT_OF_ORDER, DatedNeighbour, find_spieltag_order_refusal, with_expected_matches
from app.api.teams.admin_router import patch_saison_team, post_saison_team
from app.api.teams.schemas import FLGruppenNames
from app.api.teams.services import ENTRY_GRUPPE_FULL, find_entry_refusal, find_gruppe_swap_refusal, offered_gruppen
from app.core.collections import Collection
from app.core.constraints import COLLECTION_VALIDATORS, UNIQUE_INDEXES
from tests.core.app_source import (
    APP_ROOT,
    COLLECTION_ARGUMENT_SUFFIX,
    WRITE_HELPERS,
    app_calls,
    callee,
    calls_in,
    carries_session,
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


def _literal_writes_of(field: str, *, on: str) -> set[tuple[str, str]]:
    """Every write naming `field` in a literal document on `on`, the function making it and the value set.

    Scoped to ONE collection's handle: a field name is not unique across the database, and an
    application carries a `status` too.
    """

    writes: set[tuple[str, str]] = set()
    for _, scope, call in app_calls():
        if not any(k.arg == "collection" and isinstance(k.value, ast.Name) and k.value.id == on for k in call.keywords):
            continue

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


def _module_reads(tree: ast.Module, name: str) -> bool:
    """Every form that reaches the value, not `ImportFrom` alone: `from x import bounds` then `bounds.NAME` holds it and names it in no import.

    The AST rather than the text, a name a comment merely mentions reading nothing.
    """

    return any(
        (isinstance(node, ast.ImportFrom) and any(alias.name == name for alias in node.names))
        or (isinstance(node, ast.Name) and node.id == name)
        or (isinstance(node, ast.Attribute) and node.attr == name)
        for node in ast.walk(tree)
    )


def _packages_reading(name: str) -> set[str]:
    """Every folder between `app/` and the module, not the one holding it: a rule filed a level down answers under that subpackage alone."""

    return {
        folder
        for path in sorted(APP_ROOT.rglob("*.py"))
        if _module_reads(parsed(path), name)
        for folder in path.relative_to(APP_ROOT).parts[:-1]
    }


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
        assert _literal_writes_of("status", on="saisons_collection") == {
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


class TestAPupilStoredWithNoBirthdate:
    """That the person create takes a null date, that a stored person needs no key, and that the league's age reaches no squad module."""

    def test_the_person_create_takes_a_null_date(self):
        assert FLPostSpielerPayload(vorname="Max", nachname="Mustermann", geburtsdatum=None).geburtsdatum is None

    def test_a_stored_person_carrying_no_key_still_validates(self):
        schema = COLLECTION_VALIDATORS[Collection.SPIELER]["$jsonSchema"]

        # The floor: this collection DOES require keys, so the absence below is the field going
        # unrequired rather than a validator that asks nothing of anybody.
        assert schema["required"]

        assert "geburtsdatum" in schema["properties"]
        assert "geburtsdatum" not in schema["required"]

    def test_the_leagues_age_reaches_no_squad_module(self):
        """The threshold is one constant, so where a module can read it is where an age can be judged."""

        # The reader's own floor, against a sample: every module in the tree names the value in its
        # import, so no count over the tree separates a correct reader from one matching that alone.
        through_its_module = ast.parse("from app.shared.schemas import bounds\n\nFLOOR = bounds.BEWERBUNG_KONTAKT_MIN_AGE_YEARS\n")
        assert _module_reads(through_its_module, "BEWERBUNG_KONTAKT_MIN_AGE_YEARS")

        reading = _packages_reading("BEWERBUNG_KONTAKT_MIN_AGE_YEARS")

        # The floor: the application DOES judge a contact person's age against it, so the absence
        # below is the squad package asking nothing rather than a sweep that found no reader.
        assert "bewerbungen" in reading

        assert "spieler" not in reading


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

        assert FLAktionMitStand.model_fields["before"].annotation == dict[str, Any] | list[dict[str, Any]] | None

    def test_the_list_model_carries_no_image_at_all(self):
        """The other half of the containment: the page-sized read cannot serve what it does not declare."""

        assert "before" not in FLAktion.model_fields

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


def _app_callers_of(called: str) -> set[str]:
    """Every function under `app/` calling `called`.

    Whole-tree rather than `_callers_of`'s one file: two of the three refusals below are reached
    from more than one package, and one file's sweep would pass over the other in silence.
    """

    return {f"{module} :: {scope}" for module, scope, call in app_calls() if callee(call) == called}


def _session_flags(function: Callable[..., Any], called: str) -> list[bool]:
    """Whether each call to `called` inside `function` hands a session along, in source order."""

    name = function.__name__

    return [carries_session(call) for scope, call in calls_in(declared(function), name) if scope == name and callee(call) == called]


# Every site reaching `find_entry_refusal`. Pinned rather than counted, because what reopens this
# race is a site added without the write that would close it, and a count names none of them.
ENTRY_SITES = frozenset(
    {
        "app/api/teams/admin_router.py :: post_saison_team",
        "app/api/teams/admin_router.py :: patch_saison_team",
        "app/api/bewerbungen/admin_router.py :: accept_and_enter_the_school",
    }
)

# The one entry site already inside a transaction, which is what parts "no session" from "a session
# would not help".
ACCEPTANCE_CALLBACK = "app/api/bewerbungen/admin_router.py :: accept_and_enter_the_school"

SQUAD_SITES = frozenset(
    {
        "app/api/spieler/admin_router.py :: post_saison_spieler",
        "app/api/spieler/admin_router.py :: patch_saison_spieler",
        "app/api/spieler/admin_router.py :: reactivate_saison_spieler",
    }
)

DATE_SITES = frozenset({"app/api/spieltage/admin_router.py :: patch_spieltag"})


def _draw(rules: FLSaisonRules, occupancy_by_gruppe: Mapping[FLGruppenNames, int]):
    """A first draw of a season with everything but its group sizes in order, so a case names the occupancy alone."""

    return find_spielplan_refusal(
        saison_status="future",
        fixtures_drawn=0,
        spieltage_held=0,
        watermark=None,
        rules=rules,
        occupancy_by_gruppe=occupancy_by_gruppe,
        replace=False,
        recorded_fixtures=0,
    )


class TestAGroupOverItsCapacity:
    """That two entries into one group each pass the capacity rule, and that the season they leave is one the draw refuses."""

    def test_two_writers_holding_one_count_both_enter_a_group_with_one_place_left(self):
        """The figure is the CALLER's, so two callers hold the same one and the rule answers each on its own."""

        rules = _rules()
        before = rules.teams_per_group - 1

        for _ in range(2):
            assert find_entry_refusal(saison_status="future", gruppe="A", rules=rules, occupied=before) is None

        refusal = find_entry_refusal(saison_status="future", gruppe="A", rules=rules, occupied=before + 2)

        assert refusal is not None and refusal.error_code == ENTRY_GRUPPE_FULL

    def test_the_draw_refuses_the_season_the_pair_leaves(self):
        """Why the over-count is not silent: it is read as a refusal naming the group before a fixture exists."""

        rules = _rules()
        at_size: dict[FLGruppenNames, int] = {gruppe: rules.teams_per_group for gruppe in offered_gruppen(rules.number_of_groups)}
        oversold: dict[FLGruppenNames, int] = {**at_size, "A": rules.teams_per_group + 1}

        assert _draw(rules, at_size) is None

        refusal = _draw(rules, oversold)

        assert refusal is not None and refusal.error_code == SPIELPLAN_GRUPPEN_OFF_RULES

    def test_the_count_is_read_outside_any_session_where_no_transaction_stands(self):
        assert _session_flags(post_saison_team, "pull_many_from_db") == [False]
        assert _session_flags(patch_saison_team, "pull_many_from_db") == [False]

    def test_the_site_that_counts_inside_a_transaction_holds_the_cap_no_better(self):
        """A session is not what is missing: the acceptance counts and inserts in one, and a count is a read a snapshot re-validates nowhere."""

        acceptance = [entry for entry in transactional_callbacks(WRITE_HELPERS) if entry.where == ACCEPTANCE_CALLBACK]

        assert len(acceptance) == 1, f"{ACCEPTANCE_CALLBACK} is run by {len(acceptance)} transactions"
        assert ("pull_many_from_db", True) in acceptance[0].reads
        assert ("post_one_to_db", True) in acceptance[0].writes

    def test_every_site_reaching_the_rule_is_one_this_entry_answers_for(self):
        """The fix's own failure mode as a check: an anchor write closes the race only where every site takes it."""

        assert _app_callers_of("find_entry_refusal") == ENTRY_SITES

    def test_no_index_reaches_the_group(self):
        """A cap of N is beyond a unique index, which delivers at-most-one row per key."""

        # The floor: `saison_teams` DOES carry a unique index, so the listing this reads answers
        # something. Without it an emptied `UNIQUE_INDEXES` would pass the claim below over nothing.
        assert "uniq_saison_id_team_id" in {index.name for index in UNIQUE_INDEXES}

        covering = [index.name for index in UNIQUE_INDEXES if "gruppe" in index.keys]

        assert not covering, f"{covering} would make the capacity a database guarantee, and this entry claims it is not"


class TestASquadOverItsCap:
    """That two writes into one squad each pass the cap, and that the seat a unique index would need cannot survive a return."""

    def test_two_writers_holding_one_count_both_land_in_a_squad_with_one_place_left(self):
        cap = _rules().max_kadergroesse
        before = cap - 1

        for _ in range(2):
            assert find_squad_capacity_refusal(squad_size=before, max_kadergroesse=cap) is None

        refusal = find_squad_capacity_refusal(squad_size=before + 2, max_kadergroesse=cap)

        assert refusal is not None and refusal.error_code == SQUAD_FULL

    def test_one_count_answers_three_verbs(self):
        """The cap belongs to the DESTINATION squad, so the create, the transfer and the return all judge the figure this helper takes."""

        assert _app_callers_of("_refuse_a_full_squad") == SQUAD_SITES
        assert _session_flags(_refuse_a_full_squad, "count_documents") == [False]

    def test_the_places_counted_are_the_live_ones(self):
        """What makes the RE-CLAIM the race: a retired row gives its place back, so two returns compete for one freed place."""

        assert "build_live_squad_filter" in _calls_of(_refuse_a_full_squad)

    def test_the_return_writes_no_row_at_all(self):
        """Why a stored seat under a partial index is unsound: a revived row re-enters that index holding the seat it retired with."""

        revives = _calls_of(reactivate_saison_spieler)

        assert "set_inactive_since" in revives
        assert not {"insert_live", "post_one_to_db"} & revives

    def test_no_index_reaches_the_squad(self):
        # The floor, as above: the collection carries a unique index, so this listing answers something.
        assert "uniq_spieler_id_saison_id" in {index.name for index in UNIQUE_INDEXES}

        covering = [index.name for index in UNIQUE_INDEXES if index.collection == Collection.SAISON_SPIELER and "team_id" in index.keys]

        assert not covering, f"{covering} would make the cap a database guarantee, and this entry claims it is not"


# One phase, two dated positions, and the two days each writer replaces. Named so a case states the
# move it is about rather than four dates.
STANDING_FIRST = DatedNeighbour(position=1, beginn="2026-03-01")
STANDING_SECOND = DatedNeighbour(position=2, beginn="2026-03-20")
POSTPONED_FIRST = "2026-03-15"
ADVANCED_SECOND = "2026-03-10"
PHASE_END = "2026-03-31"


def _order(*, beginn: str, stored_beginn: str | None, previous: DatedNeighbour | None, following: DatedNeighbour | None):
    """One matchday's re-dating as the endpoint judges it, `ende` running to the end of the phase so no span rule fires."""

    return find_spieltag_order_refusal(beginn=beginn, ende=PHASE_END, stored_beginn=stored_beginn, previous=previous, following=following)


class TestTwoMatchdaysDatedAtOnce:
    """That each writer's step passes against the day the other is replacing, and that the pair they leave is one the rule refuses."""

    def test_each_step_passes_against_the_day_the_other_is_replacing(self):
        """Two positions are two documents, so neither writer's judgement sees the other's."""

        assert _order(beginn=POSTPONED_FIRST, stored_beginn=STANDING_FIRST.beginn, previous=None, following=STANDING_SECOND) is None
        assert _order(beginn=ADVANCED_SECOND, stored_beginn=STANDING_SECOND.beginn, previous=STANDING_FIRST, following=None) is None

    def test_either_step_judged_against_what_the_other_left_is_refused(self):
        """The state, executed: the pair the two writers commit is one this rule would have refused either of them for."""

        second_in = _order(
            beginn=ADVANCED_SECOND,
            stored_beginn=STANDING_SECOND.beginn,
            previous=DatedNeighbour(position=STANDING_FIRST.position, beginn=POSTPONED_FIRST),
            following=None,
        )
        first_in = _order(
            beginn=POSTPONED_FIRST,
            stored_beginn=STANDING_FIRST.beginn,
            previous=None,
            following=DatedNeighbour(position=STANDING_SECOND.position, beginn=ADVANCED_SECOND),
        )

        for refusal in (second_in, first_in):
            assert refusal is not None and refusal.error_code == SPIELTAG_BEGINN_OUT_OF_ORDER

    def test_two_matchdays_of_one_phase_may_lawfully_begin_on_one_day(self):
        """Which is what makes a unique index over the ordering day unsound: it would refuse a pair this rule permits."""

        shared = STANDING_SECOND.beginn
        neighbour = DatedNeighbour(position=STANDING_FIRST.position, beginn=shared)

        assert _order(beginn=shared, stored_beginn=None, previous=neighbour, following=None) is None

    def test_the_neighbour_reads_are_the_whole_of_what_the_two_writers_share(self):
        assert _app_callers_of("find_spieltag_order_refusal") == DATE_SITES
        assert _session_flags(patch_spieltag, "find_one") == [False, False]

    def test_no_index_orders_a_phase_by_its_dates(self):
        """The key the collection is indexed by carries the position, and a position states nothing about a day."""

        keys = next(index.keys for index in UNIQUE_INDEXES if index.name == "uniq_saison_id_saison_phase_position")

        assert "position" in keys
        assert not [index.name for index in UNIQUE_INDEXES if "beginn" in index.keys]
