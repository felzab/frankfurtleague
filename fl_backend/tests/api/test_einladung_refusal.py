from typing import Any

from app.api.einladungen.services import (
    bestaetigte_empfaenger,
    einladung_ist_versendet,
    plan_einladung_versand,
    registrierungsfenster_laeuft,
)
from tests.documents import kontaktperson_document

CONFIRMED_ON = "2026-03-20"


def kontaktperson(vorname: str, email: str, *, bestaetigt_am: str | None) -> dict[str, Any]:
    """One seat as the junction stores it. `bestaetigt_am` is the whole of what a recipient has to clear."""

    return kontaktperson_document(vorname, bestaetigt_am=bestaetigt_am, email=email, telefon="+49 69 1234567")


def kontakte(*, trainer: Any = None, ansprechperson: Any = None, stellvertretung: Any = None) -> dict[str, Any]:
    return {
        "trainer": trainer,
        "ansprechperson": ansprechperson,
        "stellvertretung": stellvertretung,
        "trainer_ist_zugleich": None,
    }


def einladung(*, versand: Any) -> dict[str, Any]:
    return {"saison_id": "2026", "widerrufen_am": None, "versand": versand}


ZUSTELLUNG = {"nachricht_id": "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794", "stand": "angenommen", "grund": None, "am": "2026-03-29T10:00:00+00:00"}


class TestTheWindowALinkExpiresWith:
    def test_a_season_taking_registrations_today_is_running(self):
        assert registrierungsfenster_laeuft(registrierung={"offen": True, "von": "2026-03-01", "bis": "2026-04-30"}, today="2026-04-01")

    def test_both_ends_are_inside_the_span(self):
        """The day the window opens and the day it shuts, which an exclusive comparison silently drops."""

        window = {"offen": True, "von": "2026-03-01", "bis": "2026-04-30"}

        assert registrierungsfenster_laeuft(registrierung=window, today="2026-03-01")
        assert registrierungsfenster_laeuft(registrierung=window, today="2026-04-30")

    def test_a_day_before_the_span_is_not(self):
        assert not registrierungsfenster_laeuft(registrierung={"offen": True, "von": "2026-03-01", "bis": "2026-04-30"}, today="2026-02-28")

    def test_a_day_after_the_span_is_not(self):
        assert not registrierungsfenster_laeuft(registrierung={"offen": True, "von": "2026-03-01", "bis": "2026-04-30"}, today="2026-05-01")

    def test_a_closed_window_is_not_running_inside_its_own_span(self):
        assert not registrierungsfenster_laeuft(registrierung={"offen": False, "von": "2026-03-01", "bis": "2026-04-30"}, today="2026-04-01")

    def test_a_season_with_no_window_at_all_is_not_running(self):
        assert not registrierungsfenster_laeuft(registrierung=None, today="2026-04-01")


class TestWhoALinkIsMailedTo:
    def test_only_a_seat_its_own_person_confirmed_is_addressed(self):
        """An address nobody has proven is not one a credential goes to."""

        block = kontakte(
            trainer=kontaktperson("Bramblewick", "bramblewick@example.com", bestaetigt_am=CONFIRMED_ON),
            ansprechperson=kontaktperson("Quillhilde", "quillhilde@example.com", bestaetigt_am=None),
        )

        assert [entry.email for entry in bestaetigte_empfaenger(kontakte=block)] == ["bramblewick@example.com"]

    def test_one_person_holding_two_seats_is_one_message(self):
        block = kontakte(
            trainer=kontaktperson("Bramblewick", "bramblewick@example.com", bestaetigt_am=CONFIRMED_ON),
            stellvertretung=kontaktperson("Bramblewick", "bramblewick@example.com", bestaetigt_am=CONFIRMED_ON),
        )
        empfaenger = bestaetigte_empfaenger(kontakte=block)

        assert len(empfaenger) == 1
        # The FIRST seat in seat order, so the message addresses the person as the role they lead with.
        assert empfaenger[0].rolle == "trainer"

    def test_a_block_whose_seats_are_all_unconfirmed_addresses_nobody(self):
        block = kontakte(ansprechperson=kontaktperson("Quillhilde", "quillhilde@example.com", bestaetigt_am=None))

        assert bestaetigte_empfaenger(kontakte=block) == []

    def test_a_seat_with_no_address_is_no_recipient(self):
        block = kontakte(trainer={**kontaktperson("Bramblewick", "", bestaetigt_am=CONFIRMED_ON)})

        assert bestaetigte_empfaenger(kontakte=block) == []


class TestWhetherAnythingWasEverMailed:
    def test_a_row_carrying_a_delivery_record_was_mailed(self):
        assert einladung_ist_versendet(einladung_raw=einladung(versand={"zustellung": ZUSTELLUNG}))

    def test_a_minted_row_nobody_sent_was_not(self):
        """The whole of the press's skip rule: the carrier is written at the mint, so its presence says nothing."""

        assert not einladung_ist_versendet(einladung_raw=einladung(versand={}))

    def test_a_team_holding_no_row_was_not(self):
        assert not einladung_ist_versendet(einladung_raw=None)

    def test_a_send_the_provider_refused_is_not_a_send(self):
        """No message was minted, so the press has still reached nobody and the next press must go out."""

        refused = {**ZUSTELLUNG, "nachricht_id": "", "stand": "unzustellbar"}

        assert not einladung_ist_versendet(einladung_raw=einladung(versand={"zustellung": refused}))

    def test_a_message_that_bounced_was_still_a_send(self):
        """The control on the same state: a refused send and a bounce both read `unzustellbar`, and only one of them reached nobody."""

        bounced = {**ZUSTELLUNG, "stand": "unzustellbar", "grund": "NoEmail"}

        assert einladung_ist_versendet(einladung_raw=einladung(versand={"zustellung": bounced}))


class TestATeamTheBanListKeepsTheLinkFrom:
    """The mailer sends a barred address nothing and records nothing, so the plan reads the ban itself."""

    def test_a_re_send_does_not_reach_past_the_ban(self):
        """Each press would mint over the team's live link while nobody on it can be reached."""

        decided = plan_einladung_versand(
            austritt=None,
            kontakte=kontakte(trainer=kontaktperson("Bramblewick", "bramblewick@example.com", bestaetigt_am=CONFIRMED_ON)),
            einladung_raw=einladung(versand={"zustellung": ZUSTELLUNG}),
            erneut=True,
            gesperrt=frozenset({"bramblewick@example.com"}),
        )

        assert decided == ([], "kontakte_gesperrt", False)
