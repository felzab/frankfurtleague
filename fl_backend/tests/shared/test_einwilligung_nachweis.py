from collections.abc import Mapping
from typing import Any, Final

import pytest

from app.api.bewerbungen.services import compose_einwilligung
from app.api.registrierungen.services import compose_person_update
from app.shared.einwilligung_nachweis import (
    compose_beleg,
    compose_choices,
    compose_erneuert,
    compose_geboren,
    is_given,
    nachweis_stand_of,
)

# Three instants, in order, as `app/core/recording.py :: log_stamp` spells one.
GIVEN_AT: Final = "2026-04-01T10:30:00+00:00"
WITHDRAWN_AT: Final = "2026-05-02T07:00:00+00:00"
LATER: Final = "2026-07-04T12:00:00+00:00"

# The label a person confirmed under, and the label of an account control a later press is given under.
CONFIRMED_LABEL: Final = "2026-10-schiedsrichterseite-4"
ACCOUNT_LABEL: Final = "2026-10-schiedsrichterkonto"

# A referee's record as their confirmation left it: both choices granted, each with its evidence.
CONFIRMED: Final[Mapping[str, Any]] = {
    "umfang": "kader_oeffentlich",
    "datum": "2026-04-01",
    "confirmed_at": "2026-04-01",
    "text_version": CONFIRMED_LABEL,
    "medien": True,
    "nachweis": {
        "umfang": {"am": GIVEN_AT, "text_version": CONFIRMED_LABEL},
        "medien": {"am": GIVEN_AT, "text_version": CONFIRMED_LABEL},
    },
}

# The same record once a press withdrew the media consent.
MEDIA_WITHDRAWN: Final[Mapping[str, Any]] = {
    **CONFIRMED,
    "medien": False,
    "nachweis": {
        "umfang": {"am": GIVEN_AT, "text_version": CONFIRMED_LABEL},
        "medien": {"am": WITHDRAWN_AT, "text_version": ACCOUNT_LABEL, "given_before": {"am": GIVEN_AT, "text_version": CONFIRMED_LABEL}},
    },
}

# The same record as the referee's press composes it, before `compose_geboren` evidences it.
AS_PRESSED: Final[Mapping[str, Any]] = {key: value for key, value in CONFIRMED.items() if key != "nachweis"}

# A contact seat's record as the application seated its person, nobody having answered.
SEATED: Final[Mapping[str, Any]] = compose_einwilligung(text_version="2026-09-bestaetigung-5", today="2026-03-20", entered_by="bewerbung")


class TestWhichValueGrants:
    @pytest.mark.parametrize(
        ("wahl", "wert", "erteilt"),
        [
            ("umfang", "kader_oeffentlich", True),
            ("umfang", "intern", False),
            # A seat's acknowledgement is no consent; WhatsApp is the one on top of it.
            ("umfang", "kontaktdaten", False),
            ("umfang", "kontaktdaten_whatsapp", True),
            ("medien", True, True),
            ("medien", False, False),
            # Absent reads as off on both read models, so an absent value never grants.
            ("medien", None, False),
            # `1 == True` in Python: a stored integer is no media consent.
            ("medien", 1, False),
        ],
    )
    def test_a_value_grants_only_where_it_is_a_consent(self, wahl: Any, wert: Any, erteilt: bool):
        assert is_given(wahl, wert) is erteilt


class TestTheEvidenceOfOneChoice:
    def test_a_grant_keeps_when_and_under_which_label_and_nothing_else(self):
        """No speaker: only the person's own write stamps evidence, so a field naming one would say nothing."""

        assert compose_beleg(saved=MEDIA_WITHDRAWN, choice="medien", value=True, am=LATER, text_version=ACCOUNT_LABEL) == {
            "am": LATER,
            "text_version": ACCOUNT_LABEL,
        }

    def test_a_withdrawal_keeps_the_grant_it_ended(self):
        assert compose_beleg(saved=CONFIRMED, choice="medien", value=False, am=WITHDRAWN_AT, text_version=ACCOUNT_LABEL) == {
            "am": WITHDRAWN_AT,
            "text_version": ACCOUNT_LABEL,
            "given_before": {"am": GIVEN_AT, "text_version": CONFIRMED_LABEL},
        }

    def test_a_withdrawal_restated_keeps_the_grant_the_first_one_ended(self):
        """Not the first withdrawal itself: what a withdrawal proves is the grant it ended."""

        assert compose_beleg(saved=MEDIA_WITHDRAWN, choice="medien", value=False, am=LATER, text_version=ACCOUNT_LABEL) == {
            "am": LATER,
            "text_version": ACCOUNT_LABEL,
            "given_before": {"am": GIVEN_AT, "text_version": CONFIRMED_LABEL},
        }

    def test_a_grant_after_a_withdrawal_drops_the_earlier_grant(self):
        """Bounded at one act per choice: the grant standing is its own evidence."""

        beleg = compose_beleg(saved=MEDIA_WITHDRAWN, choice="medien", value=True, am=LATER, text_version=ACCOUNT_LABEL)

        assert "given_before" not in beleg

    def test_a_seat_answered_without_whatsapp_keeps_no_earlier_grant(self):
        """`kontaktdaten` withholds, so a seat's first answer declining WhatsApp is a withdrawal of nothing."""

        assert compose_beleg(saved=SEATED, choice="umfang", value="kontaktdaten", am=LATER, text_version="v6") == {
            "am": LATER,
            "text_version": "v6",
        }


class TestTheTwoShapesOfAWrite:
    def test_a_press_sets_the_moved_choice_and_its_evidence_dotted(self):
        """Dotted, so `confirmed_at`, the confirmed label and the other choice's evidence stay as stored."""

        assert compose_choices(
            path="einwilligung", saved=CONFIRMED, gesetzt={"medien": False}, am=WITHDRAWN_AT, text_version=ACCOUNT_LABEL
        ) == {
            "einwilligung.medien": False,
            "einwilligung.nachweis.medien": {
                "am": WITHDRAWN_AT,
                "text_version": ACCOUNT_LABEL,
                "given_before": {"am": GIVEN_AT, "text_version": CONFIRMED_LABEL},
            },
        }

    def test_a_record_born_whole_carries_each_choice_it_holds_evidenced_under_its_own_label(self):
        born = compose_geboren(block=AS_PRESSED, am=GIVEN_AT)

        assert born == CONFIRMED

    def test_a_block_born_with_no_label_is_refused(self):
        with pytest.raises(ValueError):
            compose_geboren(block={**AS_PRESSED, "text_version": None}, am=GIVEN_AT)

    def test_a_block_already_holding_evidence_is_never_born_again(self):
        """Born over stored evidence, a withdrawal's earlier grant would go in one `$set`."""

        with pytest.raises(ValueError):
            compose_geboren(block=MEDIA_WITHDRAWN, am=LATER)


# A registration confirmed between the record's confirmation and its withdrawal: scope narrowed, media granted.
REGISTERED_AT: Final = "2026-04-15T09:00:00+00:00"
REGISTERED: Final[Mapping[str, Any]] = {
    "umfang": "intern",
    "datum": "2026-04-15",
    "confirmed_at": "2026-04-15",
    "text_version": "2026-10-spielerseite-5",
    "medien": True,
    "nachweis": {
        "umfang": {"am": REGISTERED_AT, "text_version": "2026-10-spielerseite-5"},
        "medien": {"am": REGISTERED_AT, "text_version": "2026-10-spielerseite-5"},
    },
}


def renew(gespeichert: Mapping[str, Any], erneuert: Mapping[str, Any]) -> dict[str, Any]:
    return compose_erneuert(path="einwilligung", saved=gespeichert, erneuert=erneuert)


class TestARenewalFromTheSamePersonsLaterAnswers:
    """`compose_erneuert`, the admission's renewal: each choice goes to whichever answer is the newer."""

    def test_a_newer_answer_renews_its_choice_and_an_older_one_leaves_the_stored(self):
        """`MEDIA_WITHDRAWN`'s media withdrawal postdates the registration; its scope's grant does not."""

        update = renew(MEDIA_WITHDRAWN, REGISTERED)

        assert "einwilligung.medien" not in update and "einwilligung.nachweis.medien" not in update
        assert (update["einwilligung.umfang"], update["einwilligung.nachweis.umfang"]) == (
            "intern",
            {"am": REGISTERED_AT, "text_version": "2026-10-spielerseite-5", "given_before": {"am": GIVEN_AT, "text_version": CONFIRMED_LABEL}},
        )

    def test_every_field_but_the_choices_is_renewed(self):
        """The day, the stamp and the label follow the newer confirmation whole."""

        update = renew(MEDIA_WITHDRAWN, REGISTERED)

        assert {key: update[f"einwilligung.{key}"] for key in ("datum", "confirmed_at", "text_version")} == {
            "datum": "2026-04-15",
            "confirmed_at": "2026-04-15",
            "text_version": "2026-10-spielerseite-5",
        }

    def test_a_tie_keeps_what_is_stored(self):
        tied = {
            **REGISTERED,
            "nachweis": {"umfang": {"am": GIVEN_AT, "text_version": "x"}, "medien": {"am": WITHDRAWN_AT, "text_version": "x"}},
        }

        update = renew(MEDIA_WITHDRAWN, tied)

        assert not {"einwilligung.umfang", "einwilligung.medien"} & set(update)

    @pytest.mark.parametrize(
        ("registered_on", "carried"),
        [
            pytest.param("2026-03-15", False, id="confirmed before the stored record"),
            pytest.param("2026-04-01", True, id="confirmed the same day"),
            pytest.param("2026-04-15", True, id="confirmed after it"),
        ],
    )
    def test_an_older_registration_moves_neither_the_records_day_nor_its_label(self, registered_on: str, carried: bool):
        """Admitted after a newer one, it keeps the newer choices and must not date and name the record by its older confirmation."""

        update = renew(CONFIRMED, {**REGISTERED, "datum": registered_on, "confirmed_at": registered_on})

        for field in ("datum", "confirmed_at", "text_version"):
            assert (f"einwilligung.{field}" in update) is carried, f"{field} moved against the stored confirmation's day"

    def test_a_returning_pupil_takes_the_answers_they_gave(self):
        """The narrowed scope and the declined media land, each naming the grant it ended.

        Left as stored, the name stays published while the record claims the pupil confirmed it on the day they declined.
        """

        gespeichert = compose_geboren(
            block={
                "umfang": "kader_oeffentlich",
                "datum": "2025-09-01",
                "confirmed_at": "2025-09-01",
                "text_version": "2025-09",
                "medien": True,
            },
            am="2025-09-01T08:00:00+00:00",
        )
        registrierung = {
            "vorname": "Ida",
            "nachname": "Muster",
            "geburtsdatum": "2009-05-04",
            "einwilligung": compose_geboren(
                block={
                    "umfang": "intern",
                    "datum": "2026-10-01",
                    "confirmed_at": "2026-10-01",
                    "text_version": "2026-10-spielerseite-5",
                    "medien": False,
                },
                am="2026-10-01T08:00:00+00:00",
            ),
        }

        update = compose_person_update(registrierung_raw=registrierung, gespeichert=gespeichert, adresse="ida@example.com")
        gesetzt = update["$set"]

        assert set(update) == {"$set"}

        stamp = {
            "am": "2026-10-01T08:00:00+00:00",
            "text_version": "2026-10-spielerseite-5",
            "given_before": {"am": "2025-09-01T08:00:00+00:00", "text_version": "2025-09"},
        }
        assert {key: value for key, value in gesetzt.items() if key.startswith("einwilligung.")} == {
            "einwilligung.umfang": "intern",
            "einwilligung.medien": False,
            "einwilligung.datum": "2026-10-01",
            "einwilligung.confirmed_at": "2026-10-01",
            "einwilligung.text_version": "2026-10-spielerseite-5",
            "einwilligung.nachweis.umfang": stamp,
            "einwilligung.nachweis.medien": stamp,
        }

    def test_instants_are_compared_as_instants(self):
        """Two spellings of one instant are a tie, which a comparison of the strings would order."""

        # `CONFIRMED`'s scope was set at `GIVEN_AT`, spelled here in German summer time.
        offset = {**REGISTERED, "nachweis": {**REGISTERED["nachweis"], "umfang": {"am": "2026-04-01T12:30:00+02:00", "text_version": "x"}}}

        assert "einwilligung.umfang" not in renew(CONFIRMED, offset)


class TestTheStandAPressEchoes:
    """`nachweis_stand_of`, the one derivation the account read serves and a consent PATCH compares with."""

    def test_a_record_holding_no_evidence_answers_none_for_each_choice(self):
        """A seat as its seating writes it: nobody has answered it yet."""

        seat = compose_einwilligung(text_version="v6", today="2026-03-20", entered_by="liga")

        assert nachweis_stand_of(bloecke=[seat]) == {"umfang": None, "medien": None}

    def test_a_record_answers_the_same_stand_for_the_same_content(self):
        """The control under the cases below: a stand drawn fresh per call would refuse every press."""

        assert nachweis_stand_of(bloecke=[MEDIA_WITHDRAWN]) == nachweis_stand_of(bloecke=[dict(MEDIA_WITHDRAWN)])

    def test_a_grant_and_its_withdrawal_in_one_second_answer_two_stands(self):
        """The evidence is stamped to the second, so an instant leaves a page served between the two acts its stand, and it re-grants."""

        beleg = {"am": WITHDRAWN_AT, "text_version": ACCOUNT_LABEL}
        granted = {**CONFIRMED, "medien": True, "nachweis": {**CONFIRMED["nachweis"], "medien": beleg}}
        withdrawn = {**CONFIRMED, "medien": False, "nachweis": {**CONFIRMED["nachweis"], "medien": beleg}}

        assert nachweis_stand_of(bloecke=[granted])["medien"] != nachweis_stand_of(bloecke=[withdrawn])["medien"]

    def test_an_act_on_any_one_of_several_blocks_moves_the_stand(self):
        """One press moves every held seat, so a stale page holding one seat's old stand is refused on all of them."""

        moved = {
            **MEDIA_WITHDRAWN,
            "medien": True,
            "nachweis": {**MEDIA_WITHDRAWN["nachweis"], "medien": {"am": LATER, "text_version": ACCOUNT_LABEL}},
        }

        assert nachweis_stand_of(bloecke=[CONFIRMED, MEDIA_WITHDRAWN])["medien"] != nachweis_stand_of(bloecke=[CONFIRMED, moved])["medien"]
