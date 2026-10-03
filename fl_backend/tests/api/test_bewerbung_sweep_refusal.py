import ast
import inspect
import textwrap
from collections.abc import Mapping
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from app.api.bewerbungen import sweep_router
from app.api.bewerbungen.schemas import DELETIONS_LISTED_PER_PASS, FLBewerbungSweepAngekuendigtPayload, FLBewerbungSweepLoeschenPayload
from app.api.bewerbungen.services import (
    KONTAKT_SEATS,
    TOKEN_HASH_FIELDS,
    ZUSTELLUNG_ABGEWIESEN,
    acceptance_erasure_is_due,
    announcement_is_undeliverable,
    ansprechperson_mailbox,
    build_token_filter,
    compose_bestaetigungen,
    compose_erinnerung_update,
    decline_erasure_is_due,
    deletion_is_due,
    group_seats_by_mailbox,
    hash_token,
    next_saison_id,
    one_month_after,
    reminder_seats,
    schule_name,
    season_after_has_ended,
    seat_holding,
    seat_reminder_is_due,
    vorname_of,
)
from app.api.bewerbungen.sweep_router import BLOCKS_CLEARED_PER_PASS, REMINDERS_PER_PASS
from app.core.middlewares import REQUEST_DEADLINE_S
from app.core.transactions import refuse_a_stalled_page
from app.shared.schemas.bounds import BEWERBUNG_ERINNERUNG_TAGE
from tests.documents import kontaktperson_document

TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
TOMORROW = "2026-04-02"

# Three days before `TODAY` to the day: the reminder's own mark, pinned so both sides of it are cases.
MAILED_ON_THE_MARK = "2026-03-29"
MAILED_A_DAY_SHORT = "2026-03-30"
MAILED_A_DAY_PAST = "2026-03-28"

HASHES: Mapping[str, str] = {seat: hash_token(f"first-{seat}") for seat in KONTAKT_SEATS}


def kontakte(**overrides: Any) -> dict[str, Any]:
    return {
        "trainer": kontaktperson_document("Quillhilde"),
        "ansprechperson": kontaktperson_document("Ansgar"),
        "stellvertretung": kontaktperson_document("Stellan"),
        "trainer_ist_zugleich": None,
        **overrides,
    }


def bestaetigungen(*, verschickt_am: str = MAILED_ON_THE_MARK, **entries: Any) -> dict[str, Any]:
    """Three live entries mailed on one day, any of them replaced by a case's own."""

    return {**compose_bestaetigungen(hashes=HASHES, today=verschickt_am), **entries}


def zustellung(stand: str) -> dict[str, Any]:
    return {"nachricht_id": "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794", "stand": stand, "grund": None, "am": "2026-03-29T10:00:00.000000+00:00"}


def refusing(seat: str, *, stand: str = "unzustellbar") -> dict[str, Any]:
    """The three entries with the provider refusing the last message to one of them."""

    block = bestaetigungen()

    return {**block, seat: {**block[seat], "zustellung": zustellung(stand)}}


def application(**overrides: Any) -> dict[str, Any]:
    """One submitted application inside its deadline, every seat open and at its reminder mark, that each case moves one thing of."""

    return {
        "status": "eingereicht",
        "saison_id": "2026",
        "schule": {"team_name": "Zorbanax"},
        "team_id": None,
        "kontakte": kontakte(),
        "bestaetigungsfrist": "2026-04-12",
        "bestaetigungen": bestaetigungen(),
        "entscheidung": None,
        **overrides,
    }


class TestTheSeasonAfter:
    @pytest.mark.parametrize(("saison_id", "expected"), [("2026", "2027"), ("2099", "2100")])
    def test_ids_are_years_and_a_year_has_a_successor(self, saison_id: str, expected: str):
        assert next_saison_id(saison_id) == expected

    @pytest.mark.parametrize("saison_id", ["abcd", "26", "", "20261"])
    def test_an_id_that_is_no_year_stops_the_pass_rather_than_answering_nothing(self, saison_id: str):
        """Answering `None` here left the accepted clock and the contact block silently stopped for ever; the raise is what a log can see."""

        with pytest.raises(ValueError):
            next_saison_id(saison_id)

    @pytest.mark.parametrize(("status", "ended"), [("past", True), ("active", False), ("future", False), (None, False)])
    def test_only_a_past_successor_ends_the_clock(self, status: str | None, ended: bool):
        """`None` is a season not yet created, which is not one that has ended."""

        assert season_after_has_ended(next_saison_status=status) == ended


class TestOneMonth:
    @pytest.mark.parametrize(
        ("day", "expected"),
        [
            pytest.param("2026-03-15", "2026-04-15", id="a plain day"),
            pytest.param("2026-01-31", "2026-02-28", id="clamped to February"),
            pytest.param("2024-01-31", "2024-02-29", id="clamped to a leap February"),
            pytest.param("2026-12-05", "2027-01-05", id="across the year"),
            pytest.param("2026-03-31", "2026-04-30", id="clamped to a thirty-day month"),
        ],
    )
    def test_the_same_day_next_month_clamped(self, day: str, expected: str):
        """A calendar month, not thirty days; the clamp is what keeps the 31st from skipping a month."""

        assert one_month_after(day=day) == expected


class TestTheReminderMark:
    """The three-day mark, on the seat: the day before, the day, the day after.

    The bound is `fl_backend/app/shared/schemas/bounds.py :: BEWERBUNG_ERINNERUNG_TAGE`.
    """

    @pytest.mark.parametrize(
        ("verschickt_am", "due"),
        [
            pytest.param(MAILED_A_DAY_SHORT, False, id="two days ago"),
            pytest.param(MAILED_ON_THE_MARK, True, id="three days ago, to the day"),
            pytest.param(MAILED_A_DAY_PAST, True, id="four days ago"),
        ],
    )
    def test_each_boundary_falls_where_the_bound_says(self, verschickt_am: str, due: bool):
        block = bestaetigungen(verschickt_am=verschickt_am)

        assert seat_reminder_is_due(kontakte=kontakte(), bestaetigungen=block, seat="trainer", today=TODAY) == due
        assert BEWERBUNG_ERINNERUNG_TAGE == 3

    @pytest.mark.parametrize(
        ("kontakte_block", "bookkeeping", "why"),
        [
            pytest.param(
                kontakte(trainer=kontaktperson_document("Quillhilde", bestaetigt_am=YESTERDAY)), bestaetigungen(), "confirmed", id="confirmed"
            ),
            pytest.param(
                kontakte(), bestaetigungen(trainer={**bestaetigungen()["trainer"], "abgelehnt_am": YESTERDAY}), "declined", id="declined"
            ),
            pytest.param(
                kontakte(),
                bestaetigungen(trainer={**bestaetigungen()["trainer"], "erinnert_am": YESTERDAY}),
                "reminded once",
                id="reminded once",
            ),
            pytest.param(kontakte(trainer=None), bestaetigungen(trainer=None), "erased", id="erased"),
            pytest.param(kontakte(), None, "no bookkeeping", id="an application stored before the flow"),
        ],
    )
    def test_a_seat_that_has_spoken_been_reminded_or_been_emptied_is_not_reminded(self, kontakte_block: Any, bookkeeping: Any, why: str):
        """One reminder per seat: whatever the mail did after the stamp, the seat is never reminded twice (`docs/backend/spec.md :: I152`)."""

        assert not seat_reminder_is_due(kontakte=kontakte_block, bestaetigungen=bookkeeping, seat="trainer", today=TODAY), why

    def test_a_seat_stamped_empty_is_still_reminded(self):
        """`is_confirmed` reads `""` as no confirmation (`docs/backend/spec.md :: I387`), so the seat is still owed its one chase."""

        empty = kontakte(trainer=kontaktperson_document("Quillhilde", bestaetigt_am=""))

        assert seat_reminder_is_due(kontakte=empty, bestaetigungen=bestaetigungen(), seat="trainer", today=TODAY)

    def test_a_re_sent_seat_reaches_its_own_mark_later(self):
        """A re-send moves `verschickt_am`, so that seat is reminded on its own day while the others go now."""

        block = bestaetigungen(stellvertretung={**bestaetigungen()["stellvertretung"], "verschickt_am": TODAY})

        assert reminder_seats(bewerbung_raw=application(bestaetigungen=block), today=TODAY) == ["trainer", "ansprechperson"]

    @pytest.mark.parametrize(
        "stored",
        [
            pytest.param(application(bestaetigungsfrist=YESTERDAY), id="past the deadline"),
            pytest.param(application(status="abgelehnt"), id="declined by the triage"),
            pytest.param(application(status="angenommen"), id="accepted"),
        ],
    )
    def test_a_link_that_is_over_is_reminded_of_nothing(self, stored: Mapping[str, Any]):
        assert reminder_seats(bewerbung_raw=stored, today=TODAY) == []

    def test_every_open_seat_at_its_mark_is_listed_in_declaration_order(self):
        assert reminder_seats(bewerbung_raw=application(), today=TODAY) == list(KONTAKT_SEATS)

    @pytest.mark.parametrize("stand", sorted(ZUSTELLUNG_ABGEWIESEN))
    def test_a_seat_the_provider_refuses_is_not_chased(self, stand: str):
        """The one reminder a seat gets is spent on nobody where the address is already known to reject it."""

        assert reminder_seats(bewerbung_raw=application(bestaetigungen=refusing("ansprechperson", stand=stand)), today=TODAY) == [
            "trainer",
            "stellvertretung",
        ]

    @pytest.mark.parametrize("stand", ["angenommen", "zugestellt", "verzoegert"])
    def test_a_seat_a_later_message_may_still_reach_is_chased(self, stand: str):
        """A delayed message still arrives, and a delivered one arrived: neither is a reason to skip the chase."""

        assert seat_reminder_is_due(kontakte=kontakte(), bestaetigungen=refusing("trainer", stand=stand), seat="trainer", today=TODAY)


class TestOneMessagePerMailbox:
    """Grouped as the first mail groups: the local part byte for byte, the domain without case.

    The keying is `fl_frontend/src/features/bewerbungen/notifications.ts :: collectSeats`.
    """

    def test_one_person_holding_two_seats_gets_one_message_with_both(self):
        block = kontakte(
            trainer=kontaktperson_document("Ida"), ansprechperson=kontaktperson_document("Ida"), trainer_ist_zugleich="ansprechperson"
        )

        assert group_seats_by_mailbox(kontakte=block, seats=KONTAKT_SEATS) == [
            ("ida@example.com", ["trainer", "ansprechperson"]),
            ("stellan@example.com", ["stellvertretung"]),
        ]

    def test_a_domain_spelled_in_another_case_is_the_same_inbox(self):
        block = kontakte(
            ansprechperson=kontaktperson_document("Ansgar", email="Ansgar@EXAMPLE.com"),
            stellvertretung=kontaktperson_document("Stellan", email="Ansgar@example.com"),
        )

        grouped = group_seats_by_mailbox(kontakte=block, seats=("ansprechperson", "stellvertretung"))

        assert grouped == [("Ansgar@EXAMPLE.com", ["ansprechperson", "stellvertretung"])]

    def test_a_local_part_spelled_in_another_case_is_another_inbox(self):
        """Stricter than the erasure on purpose: over-matching here would put somebody else's link in a message."""

        block = kontakte(
            ansprechperson=kontaktperson_document("Ansgar", email="ansgar@example.com"),
            stellvertretung=kontaktperson_document("Stellan", email="ANSGAR@example.com"),
        )

        assert len(group_seats_by_mailbox(kontakte=block, seats=("ansprechperson", "stellvertretung"))) == 2

    def test_a_seat_without_an_address_is_left_out(self):
        assert group_seats_by_mailbox(kontakte=kontakte(trainer=None), seats=KONTAKT_SEATS) == [
            ("ansgar@example.com", ["ansprechperson"]),
            ("stellan@example.com", ["stellvertretung"]),
        ]


class TestWhatAReminderWrites:
    """The stamp and a fresh hash, the first hash kept beside it.

    The deadline and `verschickt_am` are untouched (`docs/backend/spec.md :: I152`).
    """

    def test_the_stamp_the_fresh_hash_and_the_kept_hash_and_nothing_else(self):
        update = compose_erinnerung_update(hashes={"trainer": "fresh"}, bestaetigungen=bestaetigungen(), today=TODAY)

        assert update == {
            "$set": {
                "bestaetigungen.trainer.token_hash": "fresh",
                "bestaetigungen.trainer.token_hash_zuvor": HASHES["trainer"],
                "bestaetigungen.trainer.erinnert_am": TODAY,
            }
        }

    def test_two_seats_take_two_fresh_hashes(self):
        update = compose_erinnerung_update(hashes={"trainer": "a", "stellvertretung": "b"}, bestaetigungen=bestaetigungen(), today=TODAY)

        assert {key.split(".")[1] for key in update["$set"]} == {"trainer", "stellvertretung"}
        assert len(update["$set"]) == 6

    def test_the_lookup_and_the_seat_match_either_hash(self):
        """A reader still looking at the first email is not punished by the chase: both hashes open the seat."""

        assert len(build_token_filter(token_hash="x")["$or"]) == len(KONTAKT_SEATS) * len(TOKEN_HASH_FIELDS)

        reminded = application(
            bestaetigungen=bestaetigungen(trainer={**bestaetigungen()["trainer"], "token_hash": "fresh", "token_hash_zuvor": HASHES["trainer"]})
        )

        assert seat_holding(bewerbung_raw=reminded, token_hash="fresh") == "trainer"
        assert seat_holding(bewerbung_raw=reminded, token_hash=HASHES["trainer"]) == "trainer"


class TestTheFourteenDayClock:
    @pytest.mark.parametrize(
        ("bestaetigungsfrist", "due"),
        [
            pytest.param(TOMORROW, False, id="the day before the deadline"),
            pytest.param(TODAY, False, id="the deadline's own day, when the link still answers"),
            pytest.param(YESTERDAY, True, id="the day after"),
            pytest.param(None, False, id="no deadline recorded"),
        ],
    )
    def test_each_boundary_falls_where_the_bound_says(self, bestaetigungsfrist: str | None, due: bool):
        assert deletion_is_due(bewerbung_raw=application(bestaetigungsfrist=bestaetigungsfrist), today=TODAY) == due

    def test_an_application_every_seat_confirmed_waits_for_the_triage_instead(self):
        stamped = kontakte(**{seat: kontaktperson_document(seat.title(), bestaetigt_am=YESTERDAY) for seat in KONTAKT_SEATS})

        assert not deletion_is_due(bewerbung_raw=application(bestaetigungsfrist=YESTERDAY, kontakte=stamped), today=TODAY)

    @pytest.mark.parametrize("emptied", ["trainer", "ansprechperson"])
    def test_an_erased_or_declined_seat_counts_as_outstanding(self, emptied: str):
        """The whole clock's reach: such an application can never complete, so this is the only way it leaves."""

        stamped = kontakte(**{seat: kontaktperson_document(seat.title(), bestaetigt_am=YESTERDAY) for seat in KONTAKT_SEATS})
        stamped[emptied] = None

        assert deletion_is_due(bewerbung_raw=application(bestaetigungsfrist=YESTERDAY, kontakte=stamped), today=TODAY)

    def test_a_seat_stamped_empty_counts_as_outstanding(self):
        """Otherwise an application nobody can accept outlives its deadline for the length of the season."""

        stamped = kontakte(**{seat: kontaktperson_document(seat.title(), bestaetigt_am=YESTERDAY) for seat in KONTAKT_SEATS})
        stamped["trainer"] = kontaktperson_document("Trainer", bestaetigt_am="")

        assert deletion_is_due(bewerbung_raw=application(bestaetigungsfrist=YESTERDAY, kontakte=stamped), today=TODAY)

    @pytest.mark.parametrize("status", ["abgelehnt", "angenommen"])
    def test_a_decided_application_is_another_clocks(self, status: str):
        assert not deletion_is_due(bewerbung_raw=application(status=status, bestaetigungsfrist=YESTERDAY), today=TODAY)


class TestAnApplicationWhoseNoticeCannotArrive:
    """Held past the deadline instead of erased, so an administrator can correct the address.

    The wrong answer reads exactly like the right one: an application erased on a stamp saying a
    notice went out that never did.
    """

    @pytest.mark.parametrize("stand", sorted(ZUSTELLUNG_ABGEWIESEN))
    def test_a_refused_ansprechperson_holds_the_application(self, stand: str):
        overdue = application(bestaetigungsfrist=YESTERDAY, bestaetigungen=refusing("ansprechperson", stand=stand))

        assert announcement_is_undeliverable(bewerbung_raw=overdue)
        assert not deletion_is_due(bewerbung_raw=overdue, today=TODAY)

    @pytest.mark.parametrize("stand", ["angenommen", "zugestellt", "verzoegert"])
    def test_a_state_a_later_message_may_still_repair_does_not_hold_it(self, stand: str):
        overdue = application(bestaetigungsfrist=YESTERDAY, bestaetigungen=refusing("ansprechperson", stand=stand))

        assert deletion_is_due(bewerbung_raw=overdue, today=TODAY)

    @pytest.mark.parametrize("seat", ["trainer", "stellvertretung"])
    def test_another_seat_being_refused_holds_nothing(self, seat: str):
        """The notice goes to the submitter, and it is that seat's address the clock turns on."""

        overdue = application(bestaetigungsfrist=YESTERDAY, bestaetigungen=refusing(seat))

        assert deletion_is_due(bewerbung_raw=overdue, today=TODAY)

    def test_an_ansprechperson_who_erased_their_own_entry_is_still_erased_with_no_notice(self):
        """The exception this must not swallow: an emptied seat leaves no mailbox to tell, which is not the same as a refused address."""

        erased = application(
            bestaetigungsfrist=YESTERDAY, kontakte=kontakte(ansprechperson=None), bestaetigungen=bestaetigungen(ansprechperson=None)
        )

        assert not announcement_is_undeliverable(bewerbung_raw=erased)
        assert deletion_is_due(bewerbung_raw=erased, today=TODAY)


class TestTheOneMonthClock:
    @pytest.mark.parametrize(
        ("getroffen_am", "due"),
        [
            pytest.param("2026-03-02", False, id="a day short of the month"),
            pytest.param("2026-03-01", True, id="the month, to the day"),
            pytest.param("2026-02-15", True, id="past the month"),
        ],
    )
    def test_each_boundary_falls_a_calendar_month_after_the_decision(self, getroffen_am: str, due: bool):
        declined = application(status="abgelehnt", entscheidung={"getroffen_am": getroffen_am, "von": "admin", "grund": "kein Platz"})

        assert decline_erasure_is_due(bewerbung_raw=declined, today=TODAY) == due

    @pytest.mark.parametrize("status", ["eingereicht", "angenommen"])
    def test_only_a_declined_application_is_on_this_clock(self, status: str):
        assert not decline_erasure_is_due(bewerbung_raw=application(status=status, entscheidung={"getroffen_am": "2020-01-01"}), today=TODAY)

    def test_a_decision_with_no_day_is_never_due(self):
        assert not decline_erasure_is_due(bewerbung_raw=application(status="abgelehnt", entscheidung=None), today=TODAY)


class TestTheSeasonAndOneClock:
    @pytest.mark.parametrize(
        ("status", "next_status", "due"), [("angenommen", "past", True), ("angenommen", "active", False), ("eingereicht", "past", False)]
    )
    def test_an_accepted_application_goes_when_the_next_season_has_ended(self, status: str, next_status: str, due: bool):
        assert acceptance_erasure_is_due(bewerbung_raw=application(status=status), next_saison_status=next_status) == due


class TestWhatTheNoticesNeed:
    def test_the_school_is_the_submitted_name_or_the_picked_clubs(self):
        assert schule_name(bewerbung_raw=application(), club_names={}) == "Zorbanax"
        assert schule_name(bewerbung_raw=application(schule=None, team_id="club-1"), club_names={"club-1": "Adler"}) == "Adler"
        assert schule_name(bewerbung_raw=application(schule=None, team_id="club-9"), club_names={}) == ""

    def test_the_submitter_is_the_ansprechperson_and_the_notice_names_every_seat_that_mailbox_holds(self):
        """The double-seated case is the one the single-seat spelling gets wrong: it names one seat to a reader holding two."""

        assert ansprechperson_mailbox(kontakte=kontakte()) == ("ansgar@example.com", ["ansprechperson"])
        assert ansprechperson_mailbox(kontakte=kontakte(trainer=kontaktperson_document("Ansgar"))) == (
            "ansgar@example.com",
            ["trainer", "ansprechperson"],
        )
        assert ansprechperson_mailbox(kontakte=kontakte(ansprechperson=None)) == (None, [])

    def test_a_first_name_reads_off_the_slot_and_an_emptied_slot_has_none(self):
        assert vorname_of(kontakte=kontakte(), seat="stellvertretung") == "Stellan"
        assert vorname_of(kontakte=kontakte(stellvertretung=None), seat="stellvertretung") is None


class TestTheErasePayload:
    def test_ids_parse_and_an_undeclared_key_is_refused(self):
        assert len(FLBewerbungSweepLoeschenPayload.model_validate({"bewerbung_ids": ["6890a1b2c3d4e5f607960001"]}).bewerbung_ids) == 1

        with pytest.raises(ValidationError) as failure:
            FLBewerbungSweepLoeschenPayload.model_validate({"bewerbung_ids": [], "saison_id": "2026"})

        assert [entry["type"] for entry in failure.value.errors()] == ["extra_forbidden"]


def ids(count: int) -> list[str]:
    return [f"6890a1b2c3d4e5f6079{number:05x}" for number in range(count)]


@pytest.mark.parametrize("payload", [FLBewerbungSweepAngekuendigtPayload, FLBewerbungSweepLoeschenPayload])
class TestTheIdPayloadsTakeOnePassList:
    """Both lists come from one pass's deletion list, so a longer one is no caller of this sweep and would outrun the request's budget."""

    def test_a_whole_list_is_taken(self, payload: type[BaseModel]):
        payload.model_validate({"bewerbung_ids": ids(DELETIONS_LISTED_PER_PASS)})

    def test_one_id_past_it_is_refused(self, payload: type[BaseModel]):
        with pytest.raises(ValidationError) as failure:
            payload.model_validate({"bewerbung_ids": ids(DELETIONS_LISTED_PER_PASS + 1)})

        assert [entry["type"] for entry in failure.value.errors()] == ["too_long"]

    def test_the_published_schema_states_the_bound(self, payload: type[BaseModel]):
        """Published, so `openapi.json` tells the sweep job the bound the route refuses past; enforced alone, it states nothing."""

        assert payload.model_json_schema()["properties"]["bewerbung_ids"]["maxItems"] == DELETIONS_LISTED_PER_PASS


# The per-row loops' two commands a row, pinned on the wire by
# `fl_backend/tests/api/test_bewerbung_sweep_execution.py :: TestEachPerRowLoopCostsTheRoundTripsItsShareIsSizedAt`.
ROUND_TRIPS_A_ROW = 2


@pytest.mark.parametrize(
    ("rows", "other_commands", "per_command_s", "round_trip_s"),
    [
        # Other commands and the per-command cost from whole passes timed locally, 2026-09-23.
        pytest.param(REMINDERS_PER_PASS + BLOCKS_CLEARED_PER_PASS, 18, 0.00135, 0.036, id="the sweep"),
        pytest.param(DELETIONS_LISTED_PER_PASS, 4, 0.00101, 0.038, id="/angekuendigt"),
    ],
)
def test_a_full_share_finishes_inside_the_deadline_at_the_round_trip_its_comment_names(
    rows: int, other_commands: int, per_command_s: float, round_trip_s: float
):
    """A share raised past its budget passes every case that counts its own rows, and times out a whole pass in production."""

    assert (rows * ROUND_TRIPS_A_ROW + other_commands) * (round_trip_s + per_command_s) < REQUEST_DEADLINE_S


# Named, not derived: the clocks whose read can hold rows their predicate refuses, `sweep_saison` being
# the handler's own deletion list. The season's-end, acceptance and contact-block clocks read only rows
# they take, so a full page there always moves something.
PAGED_CLOCKS = ("remind", "erase_declined", "sweep_saison")

SWEEP_HANDLER = ast.parse(textwrap.dedent(inspect.getsource(sweep_router.sweep_saison))).body[0]


def _clock_body(clock: str) -> list[ast.AST]:
    """The callback's nodes, or the handler's own statements with its nested callbacks left out."""

    if clock == sweep_router.sweep_saison.__name__:
        pending, nodes = list(ast.iter_child_nodes(SWEEP_HANDLER)), []
        while pending:
            node = pending.pop()
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                nodes.append(node)
                pending.extend(ast.iter_child_nodes(node))
        return nodes

    callbacks = {node.name: node for node in ast.walk(SWEEP_HANDLER) if isinstance(node, ast.AsyncFunctionDef)}

    return list(ast.walk(callbacks[clock]))


@pytest.mark.parametrize("clock", PAGED_CLOCKS)
def test_each_paged_clock_asks_whether_its_page_moved_anything(clock: str):
    """A source sweep: a stall shows on the wire only as a season whose page never empties."""

    called = {node.func.id for node in _clock_body(clock) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)}

    assert refuse_a_stalled_page.__name__ in called, f"{clock} weighs a page it read without asking whether the pass can make progress"
