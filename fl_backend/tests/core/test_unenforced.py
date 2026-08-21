import ast
import functools
import inspect
from pathlib import Path
from typing import Any, Callable, Iterator

import pytest
from bson import ObjectId

from app.api.aktionen.schemas import FLAktion
from app.api.saisons.admin_router import _spieltag_clashes, activate_saison
from app.api.saisons.schemas import FLPatchSaisonPayload, FLPostSaisonPayload, FLSaisonRules
from app.api.saisons.services import find_rules_refusal
from app.api.spiele.schemas import (
    FLBracketFaultGruppe,
    FLBracketFaultOccupant,
    FLBracketFaultQuelle,
    FLBracketFaultSpiel,
    FLPatchSpielDataPayload,
    FLSpielJoined,
    FLSpielJoinedListAdapter,
    FLSpielListAdapter,
)
from app.api.spiele.services import SaisonMembership, find_departed_occupants, find_eligibility_refusal, resolve_bracket
from app.api.spieler.admin_router import post_spieler
from app.api.spieler.schemas import FLPostSpielerPayload
from app.api.spieler.services import find_squad_refusal
from app.api.spieltage.services import find_spieltag_phase_refusal
from app.api.teams.services import find_gruppe_swap_refusal
from app.core.collections import Collection
from app.core.constraints import COLLECTION_VALIDATORS, UNIQUE_INDEXES

PayloadFactory = Callable[..., dict[str, Any]]

BACKEND_ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = BACKEND_ROOT / "app"

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
    """One side as a READ serves it: the whole exit record, which is what a fault names its effective day from."""

    record = None if disqualified_from is None else {"type": "disqualifikation", "grund": "Nicht angetreten", "datum": disqualified_from}

    return _side(team_id, name, austritt=record, **overrides)


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
def filled_bracket_slot(spiel: PayloadFactory) -> list[FLSpielJoined]:
    """A knockout slot the resolution filled from the feeder below it, held by a club the season disqualified after that feeder was played."""

    return FLSpielJoinedListAdapter.validate_python(
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


def _resubmit(season_docs: list[dict[str, Any]], nr: int) -> FLPatchSpielDataPayload:
    """The stored fixture as its own payload: the no-op save every occupant rule turns on."""

    stored = next(doc for doc in season_docs if doc["spiel_nr"] == nr)

    return FLPatchSpielDataPayload.model_validate(
        {
            "spiel_id": stored["_id"],
            "sonderereignis": stored["sonderereignis"],
            "team1": stored["team1"],
            "team2": stored["team2"],
            "team1_quelle": stored["team1_quelle"],
            "team2_quelle": stored["team2_quelle"],
            "elfmeterschiessen": stored["elfmeterschiessen"],
            "datum": stored["datum"],
            "uhrzeit": stored["uhrzeit"],
            "ort": stored["ort"],
            "schiedsrichter": stored["schiedsrichter"],
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

# `app/core/crud.py`'s writing half: a call to one of these is where a document changes.
WRITE_HELPERS = frozenset({"insert_live", "patch_many_in_db", "patch_one_in_db", "post_one_to_db", "set_inactive_since"})

# The arguments those helpers take their document from. A filter and a projection name a field too,
# and neither writes it.
WRITE_DOCUMENTS = frozenset({"document", "update"})

# The driver calls that change a document, and the modules `app/core/crud.py`'s own header holds them
# to -- where a write reaches the driver anywhere else, it can carry its document past the sweeps.
DRIVER_WRITES = frozenset(
    {"bulk_write", "find_one_and_replace", "find_one_and_update", "insert_many", "insert_one", "replace_one", "update_many", "update_one"}
)
WRITE_MODULES = ("app/core/crud.py", "app/core/recording.py")


@functools.cache
def _parsed(file: Path) -> ast.Module:
    """Cached across the sweeps below, several of which read the same file."""

    return ast.parse(file.read_text(encoding="utf-8"))


def _module_of(function: Callable[..., Any]) -> Path:
    """The file declaring `function`, resolved through the import so a module that moves needs no path written here."""

    return Path(inspect.getsourcefile(function) or "")


def _declared(function: Callable[..., Any]) -> ast.FunctionDef | ast.AsyncFunctionDef:
    """One imported function as its own source declares it, which is what lets a check read the code rather than the object."""

    found = [
        node
        for node in ast.walk(_parsed(_module_of(function)))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == function.__name__
    ]

    assert len(found) == 1, f"{function.__name__} is declared {len(found)} times, so a sweep over its body proves nothing"

    return found[0]


def _callee(call: ast.Call) -> str:
    """The name at a call site: the attribute where a driver method is called on a collection, the bare name for a helper."""

    if isinstance(call.func, ast.Attribute):
        return call.func.attr

    return call.func.id if isinstance(call.func, ast.Name) else ""


def _calls_in(node: ast.AST, scope: str) -> Iterator[tuple[str, ast.Call]]:
    """Every call under `node`, each paired with the innermost function around it, so a nested helper answers for its own."""

    for child in ast.iter_child_nodes(node):
        if isinstance(child, ast.Call):
            yield scope, child

        inner = child.name if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) else scope
        yield from _calls_in(child, inner)


def _app_calls() -> Iterator[tuple[str, str, ast.Call]]:
    """Every call the application makes, with the module and the function around it."""

    for path in sorted(APP_ROOT.rglob("*.py")):
        module = path.relative_to(BACKEND_ROOT).as_posix()
        yield from ((module, scope, call) for scope, call in _calls_in(_parsed(path), "<module>"))


def _driver_calls(methods: frozenset[str]) -> list[str]:
    """Where the application calls one of `methods`, each as its module and the function holding the call."""

    return sorted({f"{module} :: {scope}" for module, scope, call in _app_calls() if _callee(call) in methods})


def _literal_writes_of(field: str) -> set[tuple[str, str]]:
    """Every write naming `field` in a literal document, as the function making it and the value it sets."""

    writes: set[tuple[str, str]] = set()
    for _, scope, call in _app_calls():
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


def _opens_a_transaction(node: ast.AST) -> bool:
    """Whether one `async with` opens the transaction itself, rather than the session it is started on."""

    if not isinstance(node, ast.AsyncWith):
        return False

    opened = [call for item in node.items for call in ast.walk(item.context_expr) if isinstance(call, ast.Call)]

    return any(_callee(call) == "start_transaction" for call in opened)


def _transactional_writes(function: Callable[..., Any]) -> set[tuple[str, bool]]:
    """Every write one function makes inside a transaction block, each with whether it carries the session."""

    return {
        (_callee(call), any(keyword.arg == "session" for keyword in call.keywords))
        for block in ast.walk(_declared(function))
        if _opens_a_transaction(block)
        for call in ast.walk(block)
        if isinstance(call, ast.Call) and _callee(call) in WRITE_HELPERS
    }


def _callers_of(module: Path, callee: str) -> set[str]:
    """Every function in one module that calls `callee`, by name."""

    return {scope for scope, call in _calls_in(_parsed(module), "<module>") if _callee(call) == callee}


def _calls_of(function: Callable[..., Any]) -> set[str]:
    """The names one function itself calls; a call a nested helper makes answers under that helper."""

    name = function.__name__

    return {_callee(call) for scope, call in _calls_in(_declared(function), name) if scope == name}


class TestExactlyOneActiveSeason:
    """That no store-level constraint holds two seasons apart, and that one transaction is the whole of what does."""

    def test_no_unique_index_reaches_the_status_field(self):
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
        # hold the pair.
        assert _literal_writes_of("status") == {("post_saison", "future"), ("activate_saison", "past"), ("activate_saison", "active")}

    def test_no_season_payload_carries_the_field(self):
        """The route the sweep above cannot see: the patch writes its payload wholesale, so a `status` field would ride along unnamed."""

        assert not {"status"} & set(FLPostSaisonPayload.model_fields)
        assert not {"status"} & set(FLPatchSaisonPayload.model_fields)

    def test_the_demotion_and_the_promotion_share_one_transaction(self):
        """Both writes inside the activation's transaction block, each with whether it carries that block's session."""

        assert _transactional_writes(activate_saison) == {("patch_many_in_db", True), ("patch_one_in_db", True)}


class TestAMatchdayOffItsImpliedCount:
    """That the mismatch is refused only as a MOVE that narrows the count, never as a state the matchday sits in."""

    def test_a_matchday_over_its_phases_count_is_permitted_where_it_stands(self):
        assert find_spieltag_phase_refusal(attached_count=9, expected_count=6, expected_in_stored_phase=6) is None

    def test_a_matchday_under_its_phases_count_is_permitted_too(self):
        assert find_spieltag_phase_refusal(attached_count=2, expected_count=6, expected_in_stored_phase=6) is None

    def test_the_move_into_a_narrower_phase_is_what_refuses(self):
        assert find_spieltag_phase_refusal(attached_count=9, expected_count=1, expected_in_stored_phase=6) is not None


class TestASharedSquadNumber:
    """That nothing compares one squad row's number against another's, at either end."""

    def test_no_unique_index_reaches_a_squad_number(self):
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
    """That no module in the application removes a document, which is what leaves `inactive_since` the whole of deletion."""

    def test_nothing_under_app_removes_a_document(self):
        """The application entire, not its write helpers: several routers reach the driver for reads, so a removal would need no helper."""

        # The sweep's own floor: `insert_one` IS found, so an empty removal list means there is none
        # rather than that nothing is being read.
        assert _driver_calls(frozenset({"insert_one"}))

        assert _driver_calls(DRIVER_REMOVALS) == []


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
        """The person create against the two squad-row writes: `REQ-SQUAD-001` is asked where a row is written and nowhere else."""

        # `refuse` is how a write path raises a `WriteRefusal`, so a create reaching none is a create
        # no rule can stop -- which is the state this entry permits.
        assert "refuse" not in _calls_of(post_spieler)

        assert _callers_of(_module_of(post_spieler), find_squad_refusal.__name__) == {"post_saison_spieler", "patch_saison_spieler"}


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
        assert FLAktion.model_fields["before"].annotation == dict[str, Any] | None

    def test_the_validator_asks_no_more_of_it(self):
        """The other end of the same claim: a `$jsonSchema` tightening it would refuse the write rather than the read."""

        before = COLLECTION_VALIDATORS[Collection.AKTIONEN]["$jsonSchema"]["properties"]["before"]

        assert set(before) == {"bsonType"}
