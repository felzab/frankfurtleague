import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Final

from bson import ObjectId

from app.api.invitations.crud import owed_invitation_mails
from app.api.invitations.services import confirmed_recipients
from app.api.outbox.schemas import FLBanData, FLOutboxClub, FLSpielMailAppointment, FLSpielNoticeData
from app.api.outbox.services import (
    DELIVERY_DEADLINE,
    LEASE_DURATION,
    PAGE,
    REPETITION_AFTER,
    RETENTION,
    OwedMail,
    final_update,
    retry_update,
    row_of,
)
from app.api.spielbestaetigungen.services import austritt_notices_of, team_mails
from app.core import clock

APPOINTMENT = FLSpielMailAppointment(team1="Adler", team2="Bieber", date="2026-05-02", time="10:00:00")

# The last half minute of summer time, so each span below crosses the clock falling back.
BEFORE_THE_CLOCK_FALLS_BACK = datetime(2026, 10, 25, 2, 59, 30, tzinfo=clock.GERMANY)

MAIL = OwedMail(
    key="ban/1",
    to="nora.neu@beispielschule.de",
    data=FLBanData(kind="ban", ban_reason="Falsches Geburtsdatum", barred_until_saison_id="2027"),
    reference=None,
    link=None,
)


SAISON_ID = "2026"
OWN, OPPONENT = ObjectId("6890a1b2c3d4e5f607f40001"), ObjectId("6890a1b2c3d4e5f607f40002")
SEATED = {"trainer": {"email": "theo@beispielschule.de", "einwilligung": {"confirmed_at": "2026-03-01"}}}


def test_every_mail_to_a_club_s_seats_names_the_club_it_goes_to():
    """Unnamed, the hand-out cannot drop a mail whose seat changed hands before it went, and nothing else fails.

    The Austritt notice names the opponent it goes to, never the departed club its reference names.
    """

    request = FLSpielNoticeData(kind="spiel_cancelled", recipient="team", appointment=APPOINTMENT, sonderereignis="ausgefallen")
    row = {"_id": ObjectId(), "saison_id": SAISON_ID, "party": {"kind": "team", "team_id": OWN}}
    spiel = {"team1": {"team_id": OWN}, "team2": {"team_id": OPPONENT}, "date": "2026-05-02", "time": "10:00:00"}
    vereine = {
        OWN: {"_id": ObjectId(), "team_id": OWN, "name": "Adler", "kontakte": SEATED},
        OPPONENT: {"_id": ObjectId(), "team_id": OPPONENT, "name": "Bieber", "kontakte": SEATED},
    }

    owed = [
        *team_mails(spielbestaetigung_raw=row, kontakte=SEATED, data=request, occasion="cancelled"),
        *owed_invitation_mails(
            invitation_id=ObjectId(),
            team_id=OWN,
            team_name="Adler",
            saison_id=SAISON_ID,
            recipient=confirmed_recipients(kontakte=SEATED),
            occasion="dispatch",
        ),
    ]
    (notice,) = austritt_notices_of(saison_id=SAISON_ID, team_id=OWN, spiele=[spiel], vereine=vereine)[vereine[OPPONENT]["_id"]]

    assert [mail.club for mail in owed] == [FLOutboxClub(saison_id=SAISON_ID, team_id=OWN)] * 2
    assert notice.club == FLOutboxClub(saison_id=SAISON_ID, team_id=OPPONENT)


def run_for(instant: datetime) -> timedelta:
    """Measured in UTC: two values of one zone subtract as their wall clocks do, which would hide the very hour held here."""

    return instant.astimezone(UTC) - BEFORE_THE_CLOCK_FALLS_BACK.astimezone(UTC)


def test_each_span_runs_its_whole_length_across_a_clock_change():
    """Added to a Berlin value each would be the wall clock's, an hour out: a retried mail waiting sixty-one minutes rather than one."""

    owed = row_of(MAIL, now=BEFORE_THE_CLOCK_FALLS_BACK, secret=None, valid_until=None)
    lapsing = row_of(MAIL, now=BEFORE_THE_CLOCK_FALLS_BACK, secret=None, valid_until=BEFORE_THE_CLOCK_FALLS_BACK)

    assert {
        "deadline": run_for(owed["deadline"]),
        "erased": run_for(owed["erase_at"]),
        "erased past a stated lapse": run_for(lapsing["erase_at"]),
        "settled": run_for(final_update("sent", now=BEFORE_THE_CLOCK_FALLS_BACK)["$min"]["erase_at"]),
        "retried": run_for(retry_update(now=BEFORE_THE_CLOCK_FALLS_BACK)["$set"]["leased_until"]),
    } == {
        "deadline": DELIVERY_DEADLINE,
        "erased": DELIVERY_DEADLINE + RETENTION,
        "erased past a stated lapse": RETENTION,
        "settled": RETENTION,
        "retried": REPETITION_AFTER,
    }


def test_a_recipient_read_off_a_row_stored_unfolded_is_owed_in_the_fold():
    """A grant pasted by hand in capitals owes its holder's notices: stored as read, every lookup by address misses the row."""

    row = row_of(replace(MAIL, to=f" Nora.Neu@BeispielSchule.de{chr(0xA0)}"), now=BEFORE_THE_CLOCK_FALLS_BACK, secret=None, valid_until=None)

    assert row["to"] == "nora.neu@beispielschule.de"


# The frontend drain's two bounds: one on each call to this API, one on each send to the provider.
DRAIN_BOUNDS: Final = json.loads((Path(__file__).resolve().parents[1] / "shared" / "drain_bounds.json").read_bytes().decode("utf-8"))


def test_the_lease_outlasts_a_page_of_sends_and_reports_at_their_bounds():
    """A claim's rows go to the next drain once its lease lapses, so a page outliving it is sent twice.

    The second mail carries a fresh link, which kills the first one's.
    """

    call = timedelta(milliseconds=DRAIN_BOUNDS["fetch_timeout_ms"])
    send = timedelta(milliseconds=DRAIN_BOUNDS["mail_timeout_ms"])

    # The claim's own answer, then each send and the report after it.
    assert call + PAGE * (send + call) < LEASE_DURATION
