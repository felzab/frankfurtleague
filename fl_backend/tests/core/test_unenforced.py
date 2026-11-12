from collections.abc import Callable
from typing import Any

import pytest
from bson import ObjectId
from pydantic import TypeAdapter

from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import (
    FLBracketFault,
    FLPatchSpielDataPayload,
    FLSpielJoinedAdmin,
    FLSpielJoinedInternal,
    FLSpielJoinedInternalListAdapter,
    FLSpielListAdapter,
    FLSpielSlotHolder,
)
from app.api.spiele.services import (
    BookedVenue,
    ResolvedReferences,
    find_booking_refusal,
    find_claims_made,
    find_clash_refusal,
    find_double_bookings,
    find_retired_bookings,
    find_slot_claims,
    reopens,
    resolve_bracket,
    slots_booked_against,
)
from app.api.spieler.services import mark_shared_nummern
from app.core.codes import Code
from app.core.exceptions import WriteRefusal
from app.readback import RECORD_MODELS
from tests.documents import joined_spiel_document, rules_document

PayloadFactory = Callable[..., dict[str, Any]]

# A list of fixtures as an administrator's read validates each of them.
JOINED_ADMIN_LIST = TypeAdapter(list[FLSpielJoinedAdmin])

MATCH_ID = "6890a1b2c3d4e5f60720{:04d}"
SPIELTAG_ONE = "6890a1b2c3d4e5f607210001"
SPIELTAG_TWO = "6890a1b2c3d4e5f607210002"

ADLER = "6890a1b2c3d4e5f607220001"
BIEBER = "6890a1b2c3d4e5f607220002"

# The shared fixture dates every match 2026-03-15, so this exit predates the one below it.
EXIT_BEFORE_THE_SPIEL = "2026-03-01"

# Before that exit, so one season states both halves: the club was eligible where it won its way
# through, and is disqualified where the slot it reached now stands.
FEEDER_DATE = "2026-02-20"
FEEDER_NR = 25
SLOT_NR = 29


def _side(team_id: str, name: str, **overrides: Any) -> dict[str, Any]:
    return {"team_id": team_id, "name": name, "tore": None, "shorthand": name[:3].upper(), **overrides}


def _joined_side(team_id: str, name: str, *, disqualified_from: str | None = None, **overrides: Any) -> dict[str, Any]:
    """One side as the fault walk reads it: the whole exit record, which is what a fault names its effective day from."""

    record = None if disqualified_from is None else {"type": "disqualifikation", "reason": "Nicht angetreten", "date": disqualified_from}

    return _side(team_id, name, austritt=record, austritt_type=None if record is None else record["type"], **overrides)


@pytest.fixture
def filled_bracket_slot(spiel: PayloadFactory) -> list[FLSpielJoinedInternal]:
    """A knockout slot the resolution filled from the feeder below it, held by a club the season disqualified after that feeder was played."""

    return FLSpielJoinedInternalListAdapter.validate_python(
        [
            joined_spiel_document(
                spiel(
                    _id=MATCH_ID.format(FEEDER_NR),
                    spiel_nr=FEEDER_NR,
                    spieltag_id=SPIELTAG_ONE,
                    saison_phase="viertelfinale",
                    date=FEEDER_DATE,
                    team1=_joined_side(ADLER, "Adler", disqualified_from=EXIT_BEFORE_THE_SPIEL, tore=2),
                    team2=_joined_side(BIEBER, "Bieber", tore=1),
                    ergebnis="2:1",
                )
            ),
            joined_spiel_document(
                spiel(
                    _id=MATCH_ID.format(SLOT_NR),
                    spiel_nr=SLOT_NR,
                    spieltag_id=SPIELTAG_TWO,
                    saison_phase="halbfinale",
                    team1=_joined_side(ADLER, "Adler", disqualified_from=EXIT_BEFORE_THE_SPIEL),
                    team1_quelle={"type": "spiel", "spiel_nr": FEEDER_NR, "ausgang": "sieger"},
                    # Empty rather than filled: a second occupant would put a second entry in the report
                    # and blur which slot it names.
                    team2=None,
                    ergebnis=None,
                )
            ),
        ]
    )


def _submitted(stored_field: dict[str, Any] | None, *, keeping: tuple[str, ...]) -> dict[str, Any] | None:
    """One stored sub-document narrowed to what its PAYLOAD declares.

    A stored side, venue and referee each carry a composed name the server owns, and the payload
    models refuse one -- so resubmitting a document verbatim is not the save an admin makes.
    """

    return None if stored_field is None else {key: stored_field[key] for key in keeping}


def _resubmit(saison_docs: list[dict[str, Any]], nr: int) -> FLPatchSpielDataPayload:
    """The stored fixture as its own payload: the no-op save every occupant rule turns on."""

    stored = next(doc for doc in saison_docs if doc["spiel_nr"] == nr)

    return FLPatchSpielDataPayload.model_validate(
        {
            "sonderereignis": stored["sonderereignis"],
            "team1": _submitted(stored["team1"], keeping=("team_id", "tore")),
            "team2": _submitted(stored["team2"], keeping=("team_id", "tore")),
            "team1_quelle": stored["team1_quelle"],
            "team2_quelle": stored["team2_quelle"],
            "elfmeterschiessen": stored["elfmeterschiessen"],
            "date": stored["date"],
            "time": stored["time"],
            "spielort": _submitted(stored["spielort"], keeping=("spielort_id", "mietpreis")),
            "schiedsrichter": _submitted(stored["schiedsrichter"], keeping=("schiedsrichter_id", "payment")),
            "note": stored.get("note"),
            "version": stored.get("version", 0),
        }
    )


def _rules(**overrides: Any) -> FLSaisonRules:
    return FLSaisonRules.model_validate(rules_document(**{"max_kader_size": 50, "allowed_stufen": ["E1", "E2", "Q1", "Q2"], **overrides}))


class TestASharedSquadNumber:
    """That the one read reporting a shared number compares what is stored."""

    def test_the_marker_compares_the_stored_string_between_live_rows_alone(self):
        """`07` beside `7` is two shirts; an ausgetragen row wearing `9` marks neither itself nor the live `9`."""

        live = {"team_id": "one squad", "inactive_since": None}
        rows = [
            {"nummer": "1", **live},
            {"nummer": "1", **live},
            {"nummer": "07", **live},
            {"nummer": "7", **live},
            {"nummer": "9", **live},
            {"nummer": "9", "team_id": "one squad", "inactive_since": "2026-03-01"},
            {"nummer": None, **live},
            {"nummer": None, **live},
        ]

        assert [row["nummer_double"] for row in mark_shared_nummern(rows)] == [True, True, False, False, False, False, False, False]


class TestABracketSlotHeldByADisqualifiedClub:
    """That the resolution leaves standing a slot it filled whose club was disqualified afterwards."""

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
RULES_OF_THE_SAISON = _rules()


@pytest.fixture
def a_semi_final_played_at_a_retired_ground(spiel: PayloadFactory) -> list[dict[str, Any]]:
    """Played where the ground has since retired, which `spielort_still_booked` lets it do."""

    return [
        spiel(
            _id=MATCH_ID.format(SLOT_NR),
            spiel_nr=SLOT_NR,
            spieltag_id=SPIELTAG_TWO,
            saison_phase="halbfinale",
            team1=_side(ADLER, "Adler", tore=2),
            team2=_side(BIEBER, "Bieber", tore=1),
            ergebnis="2:1",
            spielort=RETIRED_GROUND_BOOKING,
            schiedsrichter=None,
        )
    ]


class TestARetiredBookingOnAReopenedSpiel:
    """That a rewrite voiding a played result keeps a retired booking and reports it, while a save newly booking the row stays refused."""

    def test_the_reopened_spiel_is_reported_and_the_played_one_is_not(self, a_semi_final_played_at_a_retired_ground):
        (played,) = JOINED_ADMIN_LIST.validate_python([joined_spiel_document(spiel) for spiel in a_semi_final_played_at_a_retired_ground])
        # What `fl_backend/app/api/spiele/crud.py :: advance_bracket_winners` writes over a slot whose occupant changed.
        reopened = played.model_copy(update={"team1": played.team2, "team2": None, "ergebnis": None})
        retired = {ObjectId(RETIRED_GROUND): GROUND_RETIRED_ON}

        assert reopens(played, ergebnis=reopened.ergebnis, sonderereignis=reopened.sonderereignis)
        assert find_retired_bookings([played], retired_venues=retired, retired_referees={}) == []
        assert [
            (fault.spiel_nr, fault.booking, fault.inactive_since)
            for fault in find_retired_bookings([reopened], retired_venues=retired, retired_referees={})
        ] == [(SLOT_NR, "spielort", GROUND_RETIRED_ON)]

    def test_a_save_keeping_it_passes_and_a_save_newly_booking_it_is_refused(self, a_semi_final_played_at_a_retired_ground):
        """Both directions of `booking_unknown_resource`: the state stands because the reopened fixture's next save books nothing."""

        (document,) = a_semi_final_played_at_a_retired_ground
        reopened_document = {**document, "team1": document["team2"], "team2": None, "ergebnis": None}
        unbooked_document = {**reopened_document, "spielort": None}
        resolved = ResolvedReferences(
            teams={},
            spielort=BookedVenue(
                name=RETIRED_GROUND_BOOKING["name"], maps_link=RETIRED_GROUND_BOOKING["maps_link"], inactive_since=GROUND_RETIRED_ON
            ),
        )

        kept = find_booking_refusal(
            ObjectId(MATCH_ID.format(SLOT_NR)),
            _resubmit([reopened_document], SLOT_NR),
            FLSpielListAdapter.validate_python([reopened_document]),
            resolved,
            RULES_OF_THE_SAISON,
        )
        newly_booked = find_booking_refusal(
            ObjectId(MATCH_ID.format(SLOT_NR)),
            _resubmit([reopened_document], SLOT_NR),
            FLSpielListAdapter.validate_python([unbooked_document]),
            resolved,
            RULES_OF_THE_SAISON,
        )

        assert kept is None
        assert newly_booked is not None and newly_booked.error_code == Code.BOOKING_UNKNOWN_RESOURCE


LIFTED_NO_SHOW_NR, BOOKED_AN_HOUR_LATER_NR = 30, 31


@pytest.fixture
def a_lifted_no_show_beside_a_later_booking(spiel: PayloadFactory) -> list[FLSpielJoinedAdmin]:
    """Two fixtures of one day at one ground, 18:00 and 19:00: the first's no-show has just been lifted by a rewrite."""

    return JOINED_ADMIN_LIST.validate_python(
        [
            joined_spiel_document(
                spiel(
                    _id=MATCH_ID.format(nr),
                    spiel_nr=nr,
                    spieltag_id=SPIELTAG_TWO,
                    saison_phase="halbfinale",
                    team1=None,
                    team2=None,
                    ergebnis=None,
                    time=time,
                    schiedsrichter=None,
                )
            )
            for nr, time in ((LIFTED_NO_SHOW_NR, "18:00:00"), (BOOKED_AN_HOUR_LATER_NR, "19:00:00"))
        ]
    )


def _holders_of(spiele: list[FLSpielJoinedAdmin]) -> list[FLSpielSlotHolder]:
    """The fixtures as the report's read of every claim hands them back."""

    return [FLSpielSlotHolder.model_validate(spiel.model_dump(by_alias=False) | {"_id": spiel.id}) for spiel in spiele]


def _clash_refusal_of(stored: FLSpielJoinedAdmin, holders: list[FLSpielSlotHolder], **changes: Any) -> WriteRefusal | None:
    """`spiel_double_booked` on a save of `stored` changing `changes`, judged over the claims it makes as `judge` judges them."""

    payload = _resubmit([stored.model_dump()], stored.spiel_nr).model_copy(update=changes)
    claims = find_claims_made(stored, payload)

    return find_clash_refusal(
        date=payload.date,
        time=payload.time,
        booked=[slot for claim in claims for slot in slots_booked_against(claim, holders, spiel_id=stored.id)],
    )


class TestADoubleBookingALiftedNoShowLeaves:
    """That a lifted no-show's clash is reported on both fixtures, a save keeping either slot passes, and a new claim beside it is refused."""

    def test_both_claims_are_reported_and_none_while_the_no_show_stood(self, a_lifted_no_show_beside_a_later_booking):
        lifted, later = a_lifted_no_show_beside_a_later_booking
        still_a_no_show = lifted.model_copy(update={"sonderereignis": "nichtantreten_team2"})

        reported = find_double_bookings([lifted, later], _holders_of([lifted, later]))

        assert [(fault.spiel_nr, fault.booking, fault.other_spiel_nr) for fault in reported] == [
            (LIFTED_NO_SHOW_NR, "spielort", BOOKED_AN_HOUR_LATER_NR),
            (BOOKED_AN_HOUR_LATER_NR, "spielort", LIFTED_NO_SHOW_NR),
        ]
        # A no-show freed the slot, and the report's read filters it out as the refusal's does.
        assert find_double_bookings([later], _holders_of([later])) == []
        assert find_slot_claims(still_a_no_show) == []

    def test_a_save_keeping_either_slot_passes_and_a_claim_made_inside_the_buffer_is_refused(self, a_lifted_no_show_beside_a_later_booking):
        """Both directions: a note stands on a claim already made, and a new hour inside the buffer of the other is judged."""

        lifted, later = a_lifted_no_show_beside_a_later_booking
        holders = _holders_of([lifted, later])

        assert _clash_refusal_of(lifted, holders, note="Nur eine Notiz") is None
        assert _clash_refusal_of(later, holders, note="Nur eine Notiz") is None

        moved_inside = _clash_refusal_of(lifted, holders, time="17:30:00")
        assert moved_inside is not None and moved_inside.error_code == Code.SPIEL_DOUBLE_BOOKED
        assert _clash_refusal_of(lifted, holders, time="13:00:00") is None


A_SECOND_GROUND = {"spielort_id": "6890a1b2c3d4e5f607240002", "name": "Sportplatz Nord", "maps_link": "Sportplatz Nord", "mietpreis": 40}
AT_THE_FIRST_GROUND_NR, AN_HOUR_LATER_AT_THE_SECOND_NR = 32, 33


class TestARefereeDoubleBookedAtTwoGrounds:
    def test_the_referee_clash_is_reported_beside_a_free_ground(self, spiel: PayloadFactory):
        """A fixture's ground is judged before its referee, so a walk stopping at a free ground would never report the referee."""

        spiele = JOINED_ADMIN_LIST.validate_python(
            [
                joined_spiel_document(spiel(_id=MATCH_ID.format(nr), spiel_nr=nr, ergebnis=None, **booking))
                for nr, booking in (
                    (AT_THE_FIRST_GROUND_NR, {}),
                    (AN_HOUR_LATER_AT_THE_SECOND_NR, {"time": "19:00:00", "spielort": A_SECOND_GROUND}),
                )
            ]
        )

        reported = find_double_bookings(spiele, _holders_of(spiele))

        assert [(fault.spiel_nr, fault.booking, fault.other_spiel_nr) for fault in reported] == [
            (AT_THE_FIRST_GROUND_NR, "schiedsrichter", AN_HOUR_LATER_AT_THE_SECOND_NR),
            (AN_HOUR_LATER_AT_THE_SECOND_NR, "schiedsrichter", AT_THE_FIRST_GROUND_NR),
        ]


class TestNoBracketFaultIsStored:
    """That the discriminator every fault variant carries is on no collection, so no fault can have been written."""

    # Read off the union, whose `Field(discriminator=...)` holds every variant to it: a rename carries this check with it.
    DISCRIMINATOR = FLBracketFault.__value__.__metadata__[0].discriminator

    @pytest.mark.parametrize("collection", sorted(RECORD_MODELS), ids=str)
    def test_no_collection_stores_a_faults_reason(self, collection):
        assert self.DISCRIMINATOR not in RECORD_MODELS[collection].model_fields
