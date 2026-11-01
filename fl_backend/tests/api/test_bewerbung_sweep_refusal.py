from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, cast

import pytest

from app.api.bewerbungen.services import (
    ansprechperson_mailbox,
    decline_loeschung_is_due,
    deletion_is_due,
    group_seats_by_mailbox,
    one_month_after,
    reminder_seats,
    schule_name,
    seat_reminder_is_due,
    unerreichbare_seats,
    vorname_of,
)
from app.api.bewerbungen.system_router import BLOCKS_CLEARED_PER_PASS, REMINDERS_PER_PASS
from app.api.outbox.schemas import FLOutboxDelivery, FLOutboxDeliveryState, FLOutboxStatus
from app.core.middlewares import REQUEST_DEADLINE_S
from app.shared.schemas.bounds import BEWERBUNG_REMINDER_DAYS
from app.shared.schemas.literals import KONTAKT_ROLLEN
from app.shared.tokens import hash_token
from tests.documents import kontaktperson_document, minted_confirmations

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
        "trainer_is_also": None,
        **overrides,
    }


def bestaetigungen(*, sent_at: str = MAILED_ON_THE_MARK, **entries: Any) -> dict[str, Any]:
    """Three live entries mailed on one day, any of them replaced by a case's own."""

    return {**minted_confirmations(hashes=HASHES, today=sent_at), **entries}


APPLICATION_ID = "bewerbung"


def refusing(seat: str, *, stand: str = "undeliverable") -> set[str]:
    """The seats whose last mail did not arrive, the provider having reported `stand` for the last mail to `seat`."""

    lage = FLOutboxStatus(
        state="sent",
        delivery=FLOutboxDelivery(state=cast(FLOutboxDeliveryState, stand), grund=None, am=datetime(2026, 3, 29, tzinfo=UTC)),
    )

    return unerreichbare_seats(row=application(), lagen={(APPLICATION_ID, seat): lage})


def never_sent(seat: str) -> set[str]:
    """The same, for a mail the drain gave up on before any provider saw it."""

    return unerreichbare_seats(row=application(), lagen={(APPLICATION_ID, seat): FLOutboxStatus(state="abandoned", delivery=None)})


def application(**overrides: Any) -> dict[str, Any]:
    """One submitted application inside its deadline, every seat open and at its reminder mark, that each case moves one thing of."""

    return {
        "_id": APPLICATION_ID,
        "status": "submitted",
        "saison_id": "2026",
        "schule": {"team_name": "Zorbanax"},
        "team_id": None,
        "kontakte": kontakte(),
        "confirmation_deadline": "2026-04-12",
        "confirmations": bestaetigungen(),
        "decision": None,
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

    The bound is `fl_backend/app/shared/schemas/bounds.py :: BEWERBUNG_REMINDER_DAYS`.
    """

    @pytest.mark.parametrize(
        ("sent_at", "due"),
        [
            pytest.param(MAILED_A_DAY_SHORT, False, id="two days ago"),
            pytest.param(MAILED_ON_THE_MARK, True, id="three days ago, to the day"),
            pytest.param(MAILED_A_DAY_PAST, True, id="four days ago"),
        ],
    )
    def test_each_boundary_falls_where_the_bound_says(self, sent_at: str, due: bool):
        block = bestaetigungen(sent_at=sent_at)

        assert seat_reminder_is_due(kontakte=kontakte(), confirmations=block, seat="trainer", today=TODAY, unerreichbar=False) == due
        assert BEWERBUNG_REMINDER_DAYS == 3

    @pytest.mark.parametrize(
        ("kontakte_block", "bookkeeping", "why"),
        [
            pytest.param(
                kontakte(trainer=kontaktperson_document("Quillhilde", confirmed_at=YESTERDAY)), bestaetigungen(), "confirmed", id="confirmed"
            ),
            pytest.param(
                kontakte(), bestaetigungen(trainer={**bestaetigungen()["trainer"], "declined_at": YESTERDAY}), "declined", id="declined"
            ),
            pytest.param(
                kontakte(),
                bestaetigungen(trainer={**bestaetigungen()["trainer"], "reminded_at": YESTERDAY}),
                "reminded once",
                id="reminded once",
            ),
            pytest.param(kontakte(trainer=None), bestaetigungen(trainer=None), "erased", id="erased"),
        ],
    )
    def test_a_seat_that_has_spoken_been_reminded_or_been_emptied_is_not_reminded(self, kontakte_block: Any, bookkeeping: Any, why: str):
        """One reminder per seat: whatever the mail did after the stamp, the seat is never reminded twice."""

        assert not seat_reminder_is_due(kontakte=kontakte_block, confirmations=bookkeeping, seat="trainer", today=TODAY, unerreichbar=False), (
            why
        )

    def test_a_re_sent_seat_reaches_its_own_mark_later(self):
        """A re-send moves `sent_at`, so that seat is reminded on its own day while the others go now."""

        block = bestaetigungen(stellvertretung={**bestaetigungen()["stellvertretung"], "sent_at": TODAY})

        assert reminder_seats(bewerbung_raw=application(confirmations=block), today=TODAY, unerreichbar=()) == ["trainer", "ansprechperson"]

    @pytest.mark.parametrize(
        "stored",
        [
            pytest.param(application(confirmation_deadline=YESTERDAY), id="past the deadline"),
            pytest.param(application(status="declined"), id="declined by the triage"),
            pytest.param(application(status="accepted"), id="accepted"),
        ],
    )
    def test_a_link_that_is_over_is_reminded_of_nothing(self, stored: Mapping[str, Any]):
        assert reminder_seats(bewerbung_raw=stored, today=TODAY, unerreichbar=()) == []

    def test_every_open_seat_at_its_mark_is_listed_in_declaration_order(self):
        assert reminder_seats(bewerbung_raw=application(), today=TODAY, unerreichbar=()) == list(KONTAKT_ROLLEN)

    # Spelled out rather than read off the outbox's set, so a state the set loses fails here: a person who reported the
    # first mail as spam is never mailed again.
    @pytest.mark.parametrize("stand", ["complaint", "suppressed", "undeliverable"])
    def test_a_seat_the_provider_refuses_is_not_chased(self, stand: str):
        """The one reminder a seat gets is spent on nobody where the address is already known to reject it."""

        assert reminder_seats(bewerbung_raw=application(), today=TODAY, unerreichbar=refusing("ansprechperson", stand=stand)) == [
            "trainer",
            "stellvertretung",
        ]

    def test_a_seat_whose_mail_was_never_sent_is_not_chased(self):
        assert reminder_seats(bewerbung_raw=application(), today=TODAY, unerreichbar=never_sent("trainer")) == [
            "ansprechperson",
            "stellvertretung",
        ]

    @pytest.mark.parametrize("stand", ["delivered", "delayed"])
    def test_a_seat_a_later_message_may_still_reach_is_chased(self, stand: str):
        """A delayed message still arrives, and a delivered one arrived: neither is a reason to skip the chase."""

        assert refusing("trainer", stand=stand) == set()

    def test_a_trainer_who_is_another_seats_person_is_judged_by_that_seats_mail(self):
        """One mail went to both seats, read by the seat the Trainer mirrors."""

        paired = application(kontakte=kontakte(trainer_is_also="ansprechperson"))
        lage = FLOutboxStatus(state="abandoned", delivery=None)

        assert unerreichbare_seats(row=paired, lagen={(APPLICATION_ID, "ansprechperson"): lage}) == {"trainer", "ansprechperson"}


class TestOneMessagePerMailbox:
    """Grouped as the first mail groups: one stored address, one message.

    The keying is `fl_backend/app/api/bewerbungen/services.py :: personen_mit_adresse`.
    """

    def test_one_person_holding_two_seats_gets_one_message_with_both(self):
        block = kontakte(trainer=kontaktperson_document("Ida"), ansprechperson=kontaktperson_document("Ida"), trainer_is_also="ansprechperson")

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
        ("confirmation_deadline", "due"),
        [
            pytest.param(TOMORROW, False, id="the day before the deadline"),
            pytest.param(TODAY, False, id="the deadline's own day, when the link still answers"),
            pytest.param(YESTERDAY, True, id="the day after"),
            pytest.param(None, False, id="no deadline recorded"),
        ],
    )
    def test_each_boundary_falls_where_the_bound_says(self, confirmation_deadline: str | None, due: bool):
        assert deletion_is_due(bewerbung_raw=application(confirmation_deadline=confirmation_deadline), today=TODAY, undeliverable=False) == due

    def test_an_application_every_seat_confirmed_waits_for_the_triage_instead(self):
        stamped = kontakte(**{seat: kontaktperson_document(seat.title(), confirmed_at=YESTERDAY) for seat in KONTAKT_ROLLEN})

        assert not deletion_is_due(
            bewerbung_raw=application(confirmation_deadline=YESTERDAY, kontakte=stamped), today=TODAY, undeliverable=False
        )

    @pytest.mark.parametrize("emptied", ["trainer", "ansprechperson"])
    def test_an_geloescht_or_declined_seat_counts_as_outstanding(self, emptied: str):
        """The whole clock's reach: such an application can never complete, so this is the only way it leaves."""

        stamped = kontakte(**{seat: kontaktperson_document(seat.title(), confirmed_at=YESTERDAY) for seat in KONTAKT_ROLLEN})
        stamped[emptied] = None

        assert deletion_is_due(bewerbung_raw=application(confirmation_deadline=YESTERDAY, kontakte=stamped), today=TODAY, undeliverable=False)

    @pytest.mark.parametrize("status", ["declined", "accepted"])
    def test_a_decided_application_is_another_clocks(self, status: str):
        assert not deletion_is_due(bewerbung_raw=application(status=status, confirmation_deadline=YESTERDAY), today=TODAY, undeliverable=False)


class TestAnApplicationWhoseNoticeCannotArrive:
    """Held past the deadline instead of erased, so an administrator can correct the address.

    The wrong answer reads exactly like the right one: an application erased on a stamp saying a
    notice went out that never did.
    """

    def test_a_held_ansprechperson_holds_the_application(self):
        assert not deletion_is_due(bewerbung_raw=application(confirmation_deadline=YESTERDAY), today=TODAY, undeliverable=True)

    @pytest.mark.parametrize("stand", ["complaint", "suppressed", "undeliverable"])
    def test_each_refusal_of_the_submitters_mail_is_one_the_router_holds_on(self, stand: str):
        assert "ansprechperson" in refusing("ansprechperson", stand=stand)

    @pytest.mark.parametrize("seat", ["trainer", "stellvertretung"])
    def test_another_seat_being_refused_holds_nothing(self, seat: str):
        """The notice goes to the submitter, and it is that seat's address the clock turns on."""

        assert "ansprechperson" not in refusing(seat)


class TestTheOneMonthClock:
    @pytest.mark.parametrize(
        ("made_at", "due"),
        [
            pytest.param("2026-03-02", False, id="a day short of the month"),
            pytest.param("2026-03-01", True, id="the month, to the day"),
            pytest.param("2026-02-15", True, id="past the month"),
        ],
    )
    def test_each_boundary_falls_a_calendar_month_after_the_decision(self, made_at: str, due: bool):
        declined = application(status="declined", decision={"made_at": made_at, "von": "admin", "grund": "kein Platz"})

        assert decline_loeschung_is_due(bewerbung_raw=declined, today=TODAY) == due

    @pytest.mark.parametrize("status", ["submitted", "accepted"])
    def test_only_a_declined_application_is_on_this_clock(self, status: str):
        assert not decline_loeschung_is_due(bewerbung_raw=application(status=status, decision={"made_at": "2020-01-01"}), today=TODAY)

    def test_a_decision_with_no_day_is_never_due(self):
        assert not decline_loeschung_is_due(bewerbung_raw=application(status="declined", decision=None), today=TODAY)


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


# The per-row loops' three commands a row -- the update, its read-back and its log row -- pinned on the wire by
# `fl_backend/tests/api/test_bewerbung_sweep_execution.py :: TestEachPerRowLoopCostsTheRoundTripsItsShareIsSizedAt`.
ROUND_TRIPS_A_ROW = 3


# The worst call's commands beside its rows, counted on the wire by
# `fl_backend/tests/api/test_bewerbung_sweep_execution.py :: TestTheWorstCallSendsTheCommandsItsBudgetCounts`.
SWEEP_OTHER_COMMANDS = 88


# The per-command cost, the widest of fifteen whole passes at a full share timed locally, 2026-10-20.
def test_a_full_share_finishes_inside_the_deadline_at_the_round_trip_its_comment_names():
    """A share raised past its budget passes every case that counts its own rows, and times out a whole pass in production."""

    rows, per_command_s, round_trip_s = REMINDERS_PER_PASS + BLOCKS_CLEARED_PER_PASS, 0.00138, 0.036

    assert (rows * ROUND_TRIPS_A_ROW + SWEEP_OTHER_COMMANDS) * (round_trip_s + per_command_s) < REQUEST_DEADLINE_S
