import inspect
from typing import Any, Callable, get_args

import pytest
from bson import ObjectId

from app.api.aktionen.schemas import FLAktion
from app.api.saisons.admin_router import _spieltag_clashes
from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import find_rules_refusal
from app.api.spiele.schemas import (
    FLBracketFaultGruppe,
    FLBracketFaultOccupant,
    FLBracketFaultQuelle,
    FLBracketFaultSpiel,
    FLPatchSpielDataPayload,
    FLSpielListAdapter,
)
from app.api.spiele.services import find_eligibility_refusal
from app.api.spieler.schemas import FLPostSpielerPayload
from app.api.spieler.services import find_squad_refusal
from app.api.spieltage.services import find_spieltag_phase_refusal, find_spieltag_retire_refusal
from app.api.teams.services import find_gruppe_swap_refusal
from app.core import crud
from app.core.collections import Collection
from app.core.constraints import COLLECTION_VALIDATORS, UNIQUE_INDEXES
from app.core.domain import FIELD_POLICIES, Editability

PayloadFactory = Callable[..., dict[str, Any]]

MATCH_ID = "6890a1b2c3d4e5f60720{:04d}"
SPIELTAG_ONE = "6890a1b2c3d4e5f607210001"
SPIELTAG_TWO = "6890a1b2c3d4e5f607210002"

ADLER = "6890a1b2c3d4e5f607220001"
BIEBER = "6890a1b2c3d4e5f607220002"

# The shared fixture dates every match 2026-03-15, so this exit predates the one below it.
EXIT_BEFORE_THE_FIXTURE = "2026-03-01"


def _side(team_id: str, name: str) -> dict[str, Any]:
    return {"team_id": team_id, "name": name, "tore": None, "shorthand": name[:2].upper()}


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


def _resubmit(season_docs: list[dict[str, Any]], nr: int) -> FLPatchSpielDataPayload:
    """The stored fixture as its own payload: the no-op save every occupant rule turns on."""

    stored = next(doc for doc in season_docs if doc["spiel_nr"] == nr)

    return FLPatchSpielDataPayload.model_validate(
        {
            "spiel_id": stored["_id"],
            "is_canceled": stored["is_canceled"],
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
            "disqualified_fixtures": 0,
            **overrides,
        }
    )


class TestExactlyOneActiveSeason:
    """That no store-level constraint holds two seasons apart, and that the field is written from one place."""

    def test_no_unique_index_reaches_the_status_field(self):
        covering = [index.name for index in UNIQUE_INDEXES if "status" in index.keys]

        assert not covering, f"{covering} would make this a database guarantee, and the entry claims it is not"

    def test_the_validator_types_the_field_and_says_nothing_about_the_collection(self):
        """A `$jsonSchema` sees one document, so the closest it comes is the enum -- which permits every season being active."""

        status = COLLECTION_VALIDATORS[Collection.SAISONS]["$jsonSchema"]["properties"]["status"]

        assert set(status) == {"bsonType", "enum"}

    def test_the_declaration_names_the_transaction_that_holds_it(self):
        policy = next(entry for entry in FIELD_POLICIES if entry.collection is Collection.SAISONS and entry.field == "status")

        assert policy.editability is Editability.CONTROL_ONLY
        assert policy.enforced_by == "app.api.saisons.admin_router.activate_saison"


class TestARetiredMatchdayKeepsItsUnplayedFixtures:
    """That retirement is judged on played fixtures and on the phase's floor, and on nothing else the matchday holds."""

    def test_retiring_a_matchday_holding_no_played_fixture_is_permitted(self):
        assert find_spieltag_retire_refusal(played_count=0, live_in_phase=3, implied_in_phase=1) is None

    def test_the_refusal_takes_no_count_of_the_unplayed_ones(self):
        """The absence IS the permission here: a parameter for them is what a future refusal would need."""

        assert set(inspect.signature(find_spieltag_retire_refusal).parameters) == {"played_count", "live_in_phase", "implied_in_phase"}

    def test_a_played_fixture_is_what_refuses_it(self):
        assert find_spieltag_retire_refusal(played_count=1, live_in_phase=3, implied_in_phase=1) is not None


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
    """That a slot already holding a since-disqualified club is REPORTED rather than refused or rewritten."""

    def test_resaving_the_fixture_is_permitted(self, one_fixture):
        """`REQ-ELIGIBILITY-001` turns on a side the payload CHANGES, so an occupant already standing there passes."""

        refusal = find_eligibility_refusal(
            ObjectId(MATCH_ID.format(1)),
            _resubmit(one_fixture, 1),
            FLSpielListAdapter.validate_python(one_fixture),
            {ObjectId(ADLER): EXIT_BEFORE_THE_FIXTURE, ObjectId(BIEBER): None},
        )

        assert refusal is None

    def test_the_state_has_a_fault_variant_of_its_own(self):
        assert get_args(FLBracketFaultOccupant.model_fields["reason"].annotation) == ("disqualified_occupant",)


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
    """That the write helpers offer no way to remove a document, which is what leaves `inactive_since` the whole of deletion."""

    def test_no_write_helper_removes_a_document(self):
        removing = sorted(name for name in vars(crud) if not name.startswith("_") and ("delete" in name or "drop" in name))

        assert not removing


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
        """`REQ-SQUAD-001` reads one fact about a row being written, so it has nothing to say where none is."""

        assert find_squad_refusal(team_in_saison=True) is None


class TestADisqualifiedClubKeepsItsFixtures:
    """That a disqualification leaves the club's drawn fixtures standing, its opponents' walkover needing them."""

    def test_the_fixtures_it_already_holds_stay_saveable(self, one_fixture):
        refusal = find_eligibility_refusal(
            ObjectId(MATCH_ID.format(1)),
            _resubmit(one_fixture, 1),
            FLSpielListAdapter.validate_python(one_fixture),
            {ObjectId(ADLER): EXIT_BEFORE_THE_FIXTURE, ObjectId(BIEBER): None},
        )

        assert refusal is None

    def test_fielding_it_somewhere_NEW_is_what_refuses(self, one_fixture):
        moved_in = _resubmit(one_fixture, 1).model_copy(update={"team2": _resubmit(one_fixture, 1).team1})
        refusal = find_eligibility_refusal(
            ObjectId(MATCH_ID.format(1)),
            moved_in,
            FLSpielListAdapter.validate_python(one_fixture),
            {ObjectId(ADLER): EXIT_BEFORE_THE_FIXTURE, ObjectId(BIEBER): None},
        )

        assert refusal is not None


class TestAStoredPreImageIsNeverRevalidated:
    """That the log's copy of a document is typed as data, so a migration cannot make an old row unreadable."""

    def test_the_stored_image_is_typed_as_data(self):
        assert FLAktion.model_fields["before"].annotation == dict[str, Any] | None

    def test_the_validator_asks_no_more_of_it(self):
        """The other end of the same claim: a `$jsonSchema` tightening it would refuse the write rather than the read."""

        before = COLLECTION_VALIDATORS[Collection.AKTIONEN]["$jsonSchema"]["properties"]["before"]

        assert set(before) == {"bsonType"}
