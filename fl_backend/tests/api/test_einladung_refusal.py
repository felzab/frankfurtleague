import inspect
from typing import Any

from pydantic import BaseModel

from app.api.einladungen import schemas as einladungen_schemas
from app.api.einladungen.services import (
    EINLADUNG_SAISON_VORBEI,
    EINLADUNG_TEAM_NICHT_EINGETRAGEN,
    EINLADUNG_UNBEKANNT,
    bestaetigte_empfaenger,
    einladung_ist_versendet,
    find_saison_vorbei_refusal,
    find_team_in_saison_refusal,
    find_unknown_einladung_refusal,
    plan_einladung_versand,
    registrierungsfenster_laeuft,
)

CONFIRMED_ON = "2026-03-20"


def kontaktperson(vorname: str, email: str, *, bestaetigt_am: str | None) -> dict[str, Any]:
    """One seat as the junction stores it. `bestaetigt_am` is the whole of what a recipient has to clear."""

    return {
        "vorname": vorname,
        "nachname": f"{vorname}-Mustermann",
        "email": email,
        "telefon": "+49 69 1234567",
        "geburtsdatum": "1980-05-04",
        "einwilligung": {"umfang": "kontaktdaten", "erfasst_von": "person", "text_version": "v1", "datum": "2026-01-15"}
        | {"bestaetigt_am": bestaetigt_am},
    }


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


def _slice_models() -> list[type[BaseModel]]:
    """Every model the slice declares, off the MODULE rather than a list: one added here is covered with no edit."""

    return [member for _, member in inspect.getmembers(einladungen_schemas, inspect.isclass) if issubclass(member, BaseModel)]


class TestATeamTheSeasonDoesNotHold:
    def test_a_team_the_junction_holds_is_not_refused(self):
        assert find_team_in_saison_refusal(entered=True) is None

    def test_a_team_with_no_junction_row_is_refused(self):
        refusal = find_team_in_saison_refusal(entered=False)

        assert refusal is not None
        assert refusal.error_code == EINLADUNG_TEAM_NICHT_EINGETRAGEN


class TestASeasonThatHasEnded:
    def test_a_future_season_mints(self):
        """The link is prepared before the window opens, so `future` cannot be refused here or the press is useless."""

        assert find_saison_vorbei_refusal(saison_status="future") is None

    def test_the_running_season_mints(self):
        assert find_saison_vorbei_refusal(saison_status="active") is None

    def test_a_past_season_is_refused(self):
        refusal = find_saison_vorbei_refusal(saison_status="past")

        assert refusal is not None
        assert refusal.error_code == EINLADUNG_SAISON_VORBEI


class TestALinkThatOpensNothing:
    """`REQ-EINLADUNG-003` over the row the caller's own live-invite read found, or did not."""

    def test_a_live_row_opens(self):
        assert find_unknown_einladung_refusal(einladung_raw=einladung(versand={})) is None

    def test_a_read_that_found_nothing_is_refused(self):
        refusal = find_unknown_einladung_refusal(einladung_raw=None)

        assert refusal is not None
        assert refusal.error_code == EINLADUNG_UNBEKANNT


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

    def test_a_block_missing_an_end_is_not_running(self):
        """A stored half-window would otherwise compare against `None` and raise, or worse, order against it."""

        assert not registrierungsfenster_laeuft(registrierung={"offen": True, "von": "2026-03-01"}, today="2026-04-01")

    def test_a_null_end_closes_the_window_rather_than_opening_it_for_ever(self):
        """`str(None)` is `"None"` and every date sorts below it, so a coerced comparison leaves this credential live for ever."""

        assert not registrierungsfenster_laeuft(registrierung={"offen": True, "von": "2026-03-01", "bis": None}, today="2026-05-01")

    def test_a_null_start_closes_it_too(self):
        """The other end, for the same reason read the other way: nothing may fall open on a stored null."""

        assert not registrierungsfenster_laeuft(registrierung={"offen": True, "von": None, "bis": "2026-04-30"}, today="2026-04-01")


class TestWhoALinkIsMailedTo:
    def test_only_a_seat_its_own_person_confirmed_is_addressed(self):
        """An address nobody has proven is not one a credential goes to."""

        block = kontakte(
            trainer=kontaktperson("Bramblewick", "bramblewick@example.com", bestaetigt_am=CONFIRMED_ON),
            ansprechperson=kontaktperson("Quillhilde", "quillhilde@example.com", bestaetigt_am=None),
        )

        assert [entry.email for entry in bestaetigte_empfaenger(kontakte=block)] == ["bramblewick@example.com"]

    def test_one_person_holding_two_seats_is_one_message(self):
        """One mailbox spelled two ways: the DOMAIN is case-insensitive, so these two seats are one inbox."""

        block = kontakte(
            trainer=kontaktperson("Bramblewick", "bramblewick@Example.com", bestaetigt_am=CONFIRMED_ON),
            stellvertretung=kontaktperson("Bramblewick", "bramblewick@example.com", bestaetigt_am=CONFIRMED_ON),
        )
        empfaenger = bestaetigte_empfaenger(kontakte=block)

        assert len(empfaenger) == 1
        # The FIRST seat in seat order, so the message addresses the person as the role they lead with.
        assert empfaenger[0].rolle == "trainer"

    def test_two_seats_parted_by_the_case_of_their_local_parts_are_two_people(self):
        """A local part is case-SENSITIVE (RFC 5321), so folding the whole address drops one of these two silently."""

        block = kontakte(
            trainer=kontaktperson("Bramblewick", "T.Mueller@schule.example", bestaetigt_am=CONFIRMED_ON),
            stellvertretung=kontaktperson("Thordis", "t.mueller@schule.example", bestaetigt_am=CONFIRMED_ON),
        )

        assert [entry.email for entry in bestaetigte_empfaenger(kontakte=block)] == ["T.Mueller@schule.example", "t.mueller@schule.example"]

    def test_a_block_whose_seats_are_all_unconfirmed_addresses_nobody(self):
        block = kontakte(ansprechperson=kontaktperson("Quillhilde", "quillhilde@example.com", bestaetigt_am=None))

        assert bestaetigte_empfaenger(kontakte=block) == []

    def test_a_seat_with_no_address_is_no_recipient(self):
        block = kontakte(trainer={**kontaktperson("Bramblewick", "", bestaetigt_am=CONFIRMED_ON)})

        assert bestaetigte_empfaenger(kontakte=block) == []

    def test_an_empty_stamp_confirms_nobody(self):
        """The validator admits any string as the stamp; `fl_frontend/src/features/einladungen/empfaenger.ts` passes over this seat too."""

        block = kontakte(trainer=kontaktperson("Bramblewick", "bramblewick@example.com", bestaetigt_am=""))

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


AUSTRITT = {"type": "rueckzug", "grund": "Zu wenige Spieler", "datum": "2026-03-25"}

CONFIRMED_BLOCK = kontakte(trainer=kontaktperson("Bramblewick", "bramblewick@example.com", bestaetigt_am=CONFIRMED_ON))


def plan(*, austritt: Any = None, block: Any = None, einladung_raw: Any = None, erneut: bool = False) -> Any:
    """Every case below names only what it is about, so a default that moved fails them all rather than one."""

    return plan_einladung_versand(austritt=austritt, kontakte=block, einladung_raw=einladung_raw, erneut=erneut)


class TestWhatDecidesASkip:
    """The one function the preview and the press both read, so a row answered here is a row both agree on."""

    def test_a_team_that_has_left_the_season_is_skipped(self):
        """A withdrawn team gets no invitation: its players have nothing to register for."""

        assert plan(austritt=AUSTRITT, block=CONFIRMED_BLOCK) == ([], "austritt_eingetragen", False)

    def test_a_withdrawal_is_read_off_the_record_rather_than_its_route(self):
        """Either route out is out: `type` reaches a reader only as something reported (`docs/glossary.md :: austritt`)."""

        disqualified = {**AUSTRITT, "type": "disqualifikation"}

        assert plan(austritt=disqualified, block=CONFIRMED_BLOCK).uebersprungen == "austritt_eingetragen"

    def test_the_withdrawal_is_reported_before_the_contact_block(self):
        """A skip naming the block would send an administrator to enter contacts for a team that is out."""

        assert plan(austritt=AUSTRITT, block=None).uebersprungen == "austritt_eingetragen"

    def test_a_team_still_in_the_season_is_judged_on_its_block(self):
        """The control: a null record must not read as a withdrawal, or the press mails nobody at all."""

        assert plan(block=CONFIRMED_BLOCK).uebersprungen is None

    def test_a_team_with_no_contact_block_is_skipped(self):
        assert plan(block=None) == ([], "kein_kontaktblock", False)

    def test_a_block_with_no_confirmed_seat_is_skipped(self):
        block = kontakte(trainer=kontaktperson("Bramblewick", "bramblewick@example.com", bestaetigt_am=None))

        assert plan(block=block) == ([], "keine_bestaetigte_kontaktperson", False)

    def test_a_team_already_mailed_on_its_live_link_is_skipped(self):
        assert plan(block=CONFIRMED_BLOCK, einladung_raw=einladung(versand={"zustellung": ZUSTELLUNG})) == ([], "bereits_gesendet", False)

    def test_a_team_holding_a_link_nobody_sent_is_mailed(self):
        """The rule the plan warns about: reading "has a live invite" here leaves sixteen minted links unsent for ever."""

        decided = plan(block=CONFIRMED_BLOCK, einladung_raw=einladung(versand={}))

        assert decided.uebersprungen is None
        assert [entry.email for entry in decided.empfaenger] == ["bramblewick@example.com"]

    def test_a_re_send_reaches_the_team_already_mailed(self):
        decided = plan(block=CONFIRMED_BLOCK, einladung_raw=einladung(versand={"zustellung": ZUSTELLUNG}), erneut=True)

        assert decided.uebersprungen is None

    def test_a_re_send_still_skips_a_team_with_nobody_to_mail(self):
        """`erneut` answers one skip alone: it is not a switch that mails an unconfirmed address or reaches a team that has left."""

        assert plan(block=kontakte(), erneut=True) == ([], "keine_bestaetigte_kontaktperson", False)

    def test_a_re_send_still_skips_a_team_that_has_left(self):
        assert plan(austritt=AUSTRITT, block=CONFIRMED_BLOCK, erneut=True).uebersprungen == "austritt_eingetragen"


class TestWhichTeamsLoseTheLinkTheyHold:
    """`ersetzt_link`, the warning the preview carries: the press mints, so a link somebody holds dies."""

    def test_a_team_holding_a_live_link_loses_it(self):
        assert plan(block=CONFIRMED_BLOCK, einladung_raw=einladung(versand={})).ersetzt_link is True

    def test_a_re_send_kills_the_link_that_was_mailed(self):
        """The case a page has to warn about: the message already in somebody's inbox stops opening anything."""

        decided = plan(block=CONFIRMED_BLOCK, einladung_raw=einladung(versand={"zustellung": ZUSTELLUNG}), erneut=True)

        assert decided.ersetzt_link is True

    def test_a_team_holding_no_link_loses_nothing(self):
        assert plan(block=CONFIRMED_BLOCK).ersetzt_link is False

    def test_a_skipped_team_loses_nothing_though_it_holds_a_link(self):
        """A skip leaves the team exactly as it was, so a page warning on it would name a link that survives."""

        assert plan(block=CONFIRMED_BLOCK, einladung_raw=einladung(versand={"zustellung": ZUSTELLUNG})).ersetzt_link is False
        assert plan(austritt=AUSTRITT, block=CONFIRMED_BLOCK, einladung_raw=einladung(versand={})).ersetzt_link is False


class TestNoModelInTheSliceDeclaresAHash:
    """The projection keeps the hash off one read; this keeps a later model from putting it back on every read."""

    def test_the_sweep_sees_the_models_the_slice_declares(self):
        """A reader that found nothing would pass the clause below over no model at all."""

        assert {model.__name__ for model in _slice_models()} >= {"FLEinladung", "FLEinladungMintResponse", "FLEinladungResponse"}

    def test_no_model_declares_a_token_hash(self):
        declaring = [model.__name__ for model in _slice_models() if "token_hash" in model.model_fields]

        assert declaring == []
