from collections.abc import Mapping
from typing import Any

import pytest
from pydantic import ValidationError

from app.api.bewerbungen.schemas import DELETIONS_LISTED_PER_PASS, FLBewerbungSweepAuswahlPayload
from app.api.bewerbungen.services import (
    ZUSTELLUNG_ABGEWIESEN,
    announcement_is_undeliverable,
    ansprechperson_mailbox,
    compose_bestaetigungen,
    decline_erasure_is_due,
    deletion_is_due,
    group_seats_by_mailbox,
    hash_token,
    one_month_after,
    reminder_seats,
    schule_name,
    seat_reminder_is_due,
    vorname_of,
)
from app.api.bewerbungen.sweep_router import BLOCKS_CLEARED_PER_PASS, REMINDERS_PER_PASS
from app.api.teams.schemas import KONTAKT_ROLLEN
from app.core.middlewares import REQUEST_DEADLINE_S
from app.shared.schemas.bounds import BEWERBUNG_ERINNERUNG_TAGE
from tests.documents import kontaktperson_document

TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
TOMORROW = "2026-04-02"

# Three days before `TODAY` to the day: the reminder's own mark, pinned so both sides of it are cases.
MAILED_ON_THE_MARK = "2026-03-29"
MAILED_A_DAY_SHORT = "2026-03-30"
MAILED_A_DAY_PAST = "2026-03-28"

HASHES: Mapping[str, str] = {seat: hash_token(f"first-{seat}") for seat in KONTAKT_ROLLEN}


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
        ],
    )
    def test_a_seat_that_has_spoken_been_reminded_or_been_emptied_is_not_reminded(self, kontakte_block: Any, bookkeeping: Any, why: str):
        """One reminder per seat: whatever the mail did after the stamp, the seat is never reminded twice."""

        assert not seat_reminder_is_due(kontakte=kontakte_block, bestaetigungen=bookkeeping, seat="trainer", today=TODAY), why

    def test_a_seat_stamped_empty_is_still_reminded(self):
        """`is_confirmed` reads `""` as no confirmation, so the seat is still owed its one chase."""

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
        assert reminder_seats(bewerbung_raw=application(), today=TODAY) == list(KONTAKT_ROLLEN)

    # Spelled out rather than read off `ZUSTELLUNG_ABGEWIESEN`, so a state the set loses fails here: a person who
    # reported the first mail as spam is never mailed again.
    @pytest.mark.parametrize("stand", ["beschwerde", "unterdrueckt", "unzustellbar"])
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
    """Grouped as the first mail groups: one stored address, one message.

    The keying is `fl_frontend/src/features/bewerbungen/notifications.ts :: collectSeats`.
    """

    def test_one_person_holding_two_seats_gets_one_message_with_both(self):
        block = kontakte(
            trainer=kontaktperson_document("Ida"), ansprechperson=kontaktperson_document("Ida"), trainer_ist_zugleich="ansprechperson"
        )

        assert group_seats_by_mailbox(kontakte=block, seats=KONTAKT_ROLLEN) == [
            ("ida@example.com", ["trainer", "ansprechperson"]),
            ("stellan@example.com", ["stellvertretung"]),
        ]

    def test_a_seat_without_an_address_is_left_out(self):
        assert group_seats_by_mailbox(kontakte=kontakte(trainer=None), seats=KONTAKT_ROLLEN) == [
            ("ansgar@example.com", ["ansprechperson"]),
            ("stellan@example.com", ["stellvertretung"]),
        ]


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
        stamped = kontakte(**{seat: kontaktperson_document(seat.title(), bestaetigt_am=YESTERDAY) for seat in KONTAKT_ROLLEN})

        assert not deletion_is_due(bewerbung_raw=application(bestaetigungsfrist=YESTERDAY, kontakte=stamped), today=TODAY)

    @pytest.mark.parametrize("emptied", ["trainer", "ansprechperson"])
    def test_an_erased_or_declined_seat_counts_as_outstanding(self, emptied: str):
        """The whole clock's reach: such an application can never complete, so this is the only way it leaves."""

        stamped = kontakte(**{seat: kontaktperson_document(seat.title(), bestaetigt_am=YESTERDAY) for seat in KONTAKT_ROLLEN})
        stamped[emptied] = None

        assert deletion_is_due(bewerbung_raw=application(bestaetigungsfrist=YESTERDAY, kontakte=stamped), today=TODAY)

    def test_a_seat_stamped_empty_counts_as_outstanding(self):
        """Otherwise an application nobody can accept outlives its deadline for the length of the season."""

        stamped = kontakte(**{seat: kontaktperson_document(seat.title(), bestaetigt_am=YESTERDAY) for seat in KONTAKT_ROLLEN})
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


def ids(count: int) -> list[str]:
    return [f"6890a1b2c3d4e5f6079{number:05x}" for number in range(count)]


class TestTheIdPayloadTakesOnePassList:
    """The list comes from one pass's deletion list, so a longer one is no caller of this sweep and would outrun the request's budget."""

    def test_a_whole_list_is_taken(self):
        FLBewerbungSweepAuswahlPayload.model_validate({"bewerbung_ids": ids(DELETIONS_LISTED_PER_PASS)})

    def test_one_id_past_it_is_refused(self):
        with pytest.raises(ValidationError) as failure:
            FLBewerbungSweepAuswahlPayload.model_validate({"bewerbung_ids": ids(DELETIONS_LISTED_PER_PASS + 1)})

        assert [entry["type"] for entry in failure.value.errors()] == ["too_long"]

    def test_the_published_schema_states_the_bound(self):
        """Published, so `openapi.json` tells the sweep job the bound the route refuses past; enforced alone, it states nothing."""

        assert FLBewerbungSweepAuswahlPayload.model_json_schema()["properties"]["bewerbung_ids"]["maxItems"] == DELETIONS_LISTED_PER_PASS


# The per-row loops' three commands a row -- the update, its read-back and its log row -- pinned on the wire by
# `fl_backend/tests/api/test_bewerbung_sweep_execution.py :: TestEachPerRowLoopCostsTheRoundTripsItsShareIsSizedAt`.
ROUND_TRIPS_A_ROW = 3


# Each worst call's commands beside its rows, counted on the wire by
# `fl_backend/tests/api/test_bewerbung_sweep_execution.py :: TestTheWorstCallSendsTheCommandsItsBudgetCounts`.
SWEEP_OTHER_COMMANDS = 81
ANGEKUENDIGT_OTHER_COMMANDS = 3


# Each call's per-command cost, the widest of fifteen whole passes at a full share timed locally, 2026-10-20.
@pytest.mark.parametrize(
    ("rows", "other_commands", "per_command_s", "round_trip_s"),
    [
        pytest.param(REMINDERS_PER_PASS + BLOCKS_CLEARED_PER_PASS, SWEEP_OTHER_COMMANDS, 0.00138, 0.036, id="the sweep"),
        pytest.param(DELETIONS_LISTED_PER_PASS, ANGEKUENDIGT_OTHER_COMMANDS, 0.00131, 0.038, id="/angekuendigt"),
    ],
)
def test_a_full_share_finishes_inside_the_deadline_at_the_round_trip_its_comment_names(
    rows: int, other_commands: int, per_command_s: float, round_trip_s: float
):
    """A share raised past its budget passes every case that counts its own rows, and times out a whole pass in production."""

    assert (rows * ROUND_TRIPS_A_ROW + other_commands) * (round_trip_s + per_command_s) < REQUEST_DEADLINE_S
