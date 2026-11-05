from collections.abc import Mapping
from typing import Any, Final

import pytest

from app.api.bewerbungen.services import compose_einwilligung
from app.api.registrierungen.services import compose_person_update
from app.shared.einwilligung_evidence import (
    TextVersions,
    compose_born,
    compose_choices,
    compose_receipt,
    compose_renewed,
    evidence_state_of,
    is_given,
)

# Three instants, in order, as `app/core/recording.py :: log_stamp` spells one.
GIVEN_AT: Final = "2026-04-01T10:30:00+00:00"
WITHDRAWN_AT: Final = "2026-05-02T07:00:00+00:00"
LATER: Final = "2026-07-04T12:00:00+00:00"

# The label a person confirmed a choice under, and a later wording's label a press is given under.
CONFIRMED_LABEL: Final = "2026-10-schiedsrichterseite-4"
ACCOUNT_LABEL: Final = "2026-10-schiedsrichterkonto"
# One wording per choice, as a press names them.
CONFIRMED_LABELS: Final[TextVersions] = {"scope": "2026-10-name", "media": CONFIRMED_LABEL}

# A referee's record as their confirmation left it: both choices granted, each with its evidence.
CONFIRMED: Final[Mapping[str, Any]] = {
    "scope": "kader_oeffentlich",
    "date": "2026-04-01",
    "confirmed_at": "2026-04-01",
    "media": True,
    "evidence": {
        "scope": {"at": GIVEN_AT, "text_version": CONFIRMED_LABELS["scope"]},
        "media": {"at": GIVEN_AT, "text_version": CONFIRMED_LABEL},
    },
}

# The same record once a press withdrew the media consent.
MEDIA_WITHDRAWN: Final[Mapping[str, Any]] = {
    **CONFIRMED,
    "media": False,
    "evidence": {
        "scope": {"at": GIVEN_AT, "text_version": CONFIRMED_LABELS["scope"]},
        "media": {"at": WITHDRAWN_AT, "text_version": ACCOUNT_LABEL, "given_before": {"at": GIVEN_AT, "text_version": CONFIRMED_LABEL}},
    },
}

# The same record as the referee's press composes it, before `compose_born` evidences it.
AS_PRESSED: Final[Mapping[str, Any]] = {key: value for key, value in CONFIRMED.items() if key != "evidence"}

# A contact seat's record as the application seated its person, nobody having answered.
SEATED: Final[Mapping[str, Any]] = compose_einwilligung(today="2026-03-20", entered_by="bewerbung")


class TestWhichValueGrants:
    @pytest.mark.parametrize(
        ("choice", "value", "given"),
        [
            ("scope", "kader_oeffentlich", True),
            ("scope", "intern", False),
            # A seat's acknowledgement is no consent; WhatsApp is the one on top of it.
            ("scope", "kontaktdaten", False),
            ("scope", "kontaktdaten_whatsapp", True),
            ("media", True, True),
            ("media", False, False),
            # Absent reads as off on both read models, so an absent value never grants.
            ("media", None, False),
            # `1 == True` in Python: a stored integer is no media consent.
            ("media", 1, False),
        ],
    )
    def test_a_value_grants_only_where_it_is_a_consent(self, choice: Any, value: Any, given: bool):
        assert is_given(choice, value) is given


class TestTheEvidenceOfOneChoice:
    def test_a_grant_keeps_when_and_under_which_label_and_nothing_else(self):
        """No speaker: only the person's own write stamps evidence, so a field naming one would say nothing."""

        assert compose_receipt(saved=MEDIA_WITHDRAWN, choice="media", value=True, at=LATER, text_version=ACCOUNT_LABEL) == {
            "at": LATER,
            "text_version": ACCOUNT_LABEL,
        }

    def test_a_withdrawal_keeps_the_grant_it_ended(self):
        assert compose_receipt(saved=CONFIRMED, choice="media", value=False, at=WITHDRAWN_AT, text_version=ACCOUNT_LABEL) == {
            "at": WITHDRAWN_AT,
            "text_version": ACCOUNT_LABEL,
            "given_before": {"at": GIVEN_AT, "text_version": CONFIRMED_LABEL},
        }

    def test_a_withdrawal_restated_keeps_the_grant_the_first_one_ended(self):
        """Not the first withdrawal itself: what a withdrawal proves is the grant it ended."""

        assert compose_receipt(saved=MEDIA_WITHDRAWN, choice="media", value=False, at=LATER, text_version=ACCOUNT_LABEL) == {
            "at": LATER,
            "text_version": ACCOUNT_LABEL,
            "given_before": {"at": GIVEN_AT, "text_version": CONFIRMED_LABEL},
        }

    def test_a_seat_answered_without_whatsapp_keeps_no_earlier_grant(self):
        """`kontaktdaten` withholds, so a seat's first answer declining WhatsApp is a withdrawal of nothing."""

        assert compose_receipt(saved=SEATED, choice="scope", value="kontaktdaten", at=LATER, text_version="v6") == {
            "at": LATER,
            "text_version": "v6",
        }


class TestTheTwoShapesOfAWrite:
    def test_a_press_sets_the_moved_choice_and_its_evidence_dotted(self):
        """Dotted, so `confirmed_at` and the other choice's evidence stay as stored."""

        assert compose_choices(
            path="einwilligung",
            saved=CONFIRMED,
            set_fields={"media": False},
            at=WITHDRAWN_AT,
            text_versions={"scope": "unread", "media": ACCOUNT_LABEL},
        ) == {
            "einwilligung.media": False,
            "einwilligung.evidence.media": {
                "at": WITHDRAWN_AT,
                "text_version": ACCOUNT_LABEL,
                "given_before": {"at": GIVEN_AT, "text_version": CONFIRMED_LABEL},
            },
        }

    def test_a_record_born_whole_carries_each_choice_it_holds_evidenced_under_its_own_label(self):
        born = compose_born(block=AS_PRESSED, at=GIVEN_AT, text_versions=CONFIRMED_LABELS)

        assert born == CONFIRMED

    def test_a_block_already_holding_evidence_is_never_born_again(self):
        """Born over stored evidence, a withdrawal's earlier grant would go in one `$set`."""

        with pytest.raises(ValueError):
            compose_born(block=MEDIA_WITHDRAWN, at=LATER, text_versions=CONFIRMED_LABELS)


# A registration confirmed between the record's confirmation and its withdrawal: scope narrowed, media granted.
REGISTERED_AT: Final = "2026-04-15T09:00:00+00:00"
REGISTERED: Final[Mapping[str, Any]] = {
    "scope": "intern",
    "date": "2026-04-15",
    "confirmed_at": "2026-04-15",
    "media": True,
    "evidence": {
        "scope": {"at": REGISTERED_AT, "text_version": "2026-10-spielerseite-5"},
        "media": {"at": REGISTERED_AT, "text_version": "2026-10-spielerseite-5"},
    },
}


def renew(saved: Mapping[str, Any], renewed: Mapping[str, Any]) -> dict[str, Any]:
    return compose_renewed(path="einwilligung", saved=saved, renewed=renewed)


class TestARenewalFromTheSamePersonsLaterAnswers:
    """`compose_renewed`, the admission's renewal: each choice goes to whichever answer is the newer."""

    def test_a_newer_answer_renews_its_choice_and_an_older_one_leaves_the_stored(self):
        """`MEDIA_WITHDRAWN`'s media withdrawal postdates the registration; its scope's grant does not."""

        update = renew(MEDIA_WITHDRAWN, REGISTERED)

        assert "einwilligung.media" not in update and "einwilligung.evidence.media" not in update
        assert (update["einwilligung.scope"], update["einwilligung.evidence.scope"]) == (
            "intern",
            {
                "at": REGISTERED_AT,
                "text_version": "2026-10-spielerseite-5",
                "given_before": {"at": GIVEN_AT, "text_version": CONFIRMED_LABELS["scope"]},
            },
        )

    def test_an_older_answer_on_the_first_choice_leaves_a_newer_one_on_the_second_to_renew(self):
        """The mirror, the stored scope set after the registration: its media withdrawal still lands, naming the grant it ended."""

        scope_moved_later = {**CONFIRMED, "evidence": {**CONFIRMED["evidence"], "scope": {"at": LATER, "text_version": ACCOUNT_LABEL}}}

        update = renew(scope_moved_later, {**REGISTERED, "media": False})

        assert "einwilligung.scope" not in update and "einwilligung.evidence.scope" not in update
        assert (update["einwilligung.media"], update["einwilligung.evidence.media"]) == (
            False,
            {
                "at": REGISTERED_AT,
                "text_version": "2026-10-spielerseite-5",
                "given_before": {"at": GIVEN_AT, "text_version": CONFIRMED_LABEL},
            },
        )

    def test_every_field_but_the_choices_is_renewed(self):
        """The day and the stamp follow the newer confirmation whole."""

        update = renew(MEDIA_WITHDRAWN, REGISTERED)

        assert {key: update[f"einwilligung.{key}"] for key in ("date", "confirmed_at")} == {
            "date": "2026-04-15",
            "confirmed_at": "2026-04-15",
        }

    @pytest.mark.parametrize(
        ("registered_on", "carried"),
        [
            pytest.param("2026-03-15", False, id="confirmed before the stored record"),
            pytest.param("2026-04-01", True, id="confirmed the same day"),
            pytest.param("2026-04-15", True, id="confirmed after it"),
        ],
    )
    def test_an_older_registration_moves_neither_the_records_day_nor_its_stamp(self, registered_on: str, carried: bool):
        """Admitted after a newer one, it keeps the newer choices and must not date the record by its older confirmation."""

        update = renew(CONFIRMED, {**REGISTERED, "date": registered_on, "confirmed_at": registered_on})

        for field in ("date", "confirmed_at"):
            assert (f"einwilligung.{field}" in update) is carried, f"{field} moved against the stored confirmation's day"

    def test_a_returning_pupil_takes_the_answers_they_gave(self):
        """The narrowed scope and the declined media land, each naming the grant it ended.

        Left as stored, the name stays published while the record claims the pupil confirmed it on the day they declined.
        """

        saved = compose_born(
            block={
                "scope": "kader_oeffentlich",
                "date": "2025-09-01",
                "confirmed_at": "2025-09-01",
                "media": True,
            },
            at="2025-09-01T08:00:00+00:00",
            text_versions={"scope": "2025-09", "media": "2025-09"},
        )
        registrierung = {
            "vorname": "Ida",
            "nachname": "Muster",
            "geburtsdatum": "2009-05-04",
            "einwilligung": compose_born(
                block={
                    "scope": "intern",
                    "date": "2026-10-01",
                    "confirmed_at": "2026-10-01",
                    "media": False,
                },
                at="2026-10-01T08:00:00+00:00",
                text_versions={"scope": "2026-10-spielerseite-5", "media": "2026-10-spielerseite-5"},
            ),
        }

        update = compose_person_update(registrierung_raw=registrierung, saved=saved, address="ida@example.com")
        set_fields = update["$set"]

        assert set(update) == {"$set"}

        stamp = {
            "at": "2026-10-01T08:00:00+00:00",
            "text_version": "2026-10-spielerseite-5",
            "given_before": {"at": "2025-09-01T08:00:00+00:00", "text_version": "2025-09"},
        }
        assert {key: value for key, value in set_fields.items() if key.startswith("einwilligung.")} == {
            "einwilligung.scope": "intern",
            "einwilligung.media": False,
            "einwilligung.date": "2026-10-01",
            "einwilligung.confirmed_at": "2026-10-01",
            "einwilligung.evidence.scope": stamp,
            "einwilligung.evidence.media": stamp,
        }

    def test_instants_are_compared_as_instants(self):
        """Two spellings of one instant are a tie, which a comparison of the strings would order."""

        # `CONFIRMED`'s scope was set at `GIVEN_AT`, spelled here in German summer time.
        offset = {**REGISTERED, "evidence": {**REGISTERED["evidence"], "scope": {"at": "2026-04-01T12:30:00+02:00", "text_version": "x"}}}

        assert "einwilligung.scope" not in renew(CONFIRMED, offset)


class TestTheStandAPressEchoes:
    """`evidence_state_of`, the one derivation the account read serves and a consent PATCH compares with."""

    def test_a_grant_and_its_withdrawal_in_one_second_answer_two_stands(self):
        """The evidence is stamped to the second, so an instant leaves a page served between the two acts its stand, and it re-grants."""

        receipt = {"at": WITHDRAWN_AT, "text_version": ACCOUNT_LABEL}
        granted = {**CONFIRMED, "media": True, "evidence": {**CONFIRMED["evidence"], "media": receipt}}
        withdrawn = {**CONFIRMED, "media": False, "evidence": {**CONFIRMED["evidence"], "media": receipt}}

        assert evidence_state_of(blocks=[granted])["media"] != evidence_state_of(blocks=[withdrawn])["media"]

    def test_a_whatsapp_grant_its_withdrawal_and_its_renewal_answer_three_scope_states(self):
        """A contact seat's `scope`, digested from its own value and its own evidence, as `media` is.

        The withdrawal in the grant's second differs by the value alone, the renewal later by the evidence alone, so a
        page served before either is refused. The media choice, alike in all three, keeps one stand: the press judges
        each choice by its own.
        """

        receipt = {"at": WITHDRAWN_AT, "text_version": ACCOUNT_LABEL}
        media = {"at": GIVEN_AT, "text_version": CONFIRMED_LABEL}
        granted = {**SEATED, "scope": "kontaktdaten_whatsapp", "evidence": {"scope": receipt, "media": media}}
        withdrawn = {**granted, "scope": "kontaktdaten"}
        renewed = {**granted, "evidence": {"scope": {"at": LATER, "text_version": ACCOUNT_LABEL}, "media": media}}

        stands = [evidence_state_of(blocks=[block]) for block in (granted, withdrawn, renewed)]

        assert len({stand["scope"] for stand in stands}) == 3
        assert len({stand["media"] for stand in stands}) == 1

    def test_an_act_on_any_one_of_several_blocks_moves_the_stand(self):
        """One press moves every held seat, so a stale page holding one seat's old stand is refused on all of them."""

        moved = {
            **MEDIA_WITHDRAWN,
            "media": True,
            "evidence": {**MEDIA_WITHDRAWN["evidence"], "media": {"at": LATER, "text_version": ACCOUNT_LABEL}},
        }

        assert evidence_state_of(blocks=[CONFIRMED, MEDIA_WITHDRAWN])["media"] != evidence_state_of(blocks=[CONFIRMED, moved])["media"]
