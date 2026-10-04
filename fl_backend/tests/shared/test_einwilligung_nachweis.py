from collections.abc import Mapping
from typing import Any, Final

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.registrierungen.services import compose_person_update
from app.api.spieler.schemas import FLEinwilligung
from app.api.teams.schemas import FLKontaktKenntnisnahme
from app.core.recording import log_stamp
from app.shared.einwilligung_nachweis import (
    WAHLEN,
    FLEinwilligungWahl,
    compose_beleg,
    compose_erneuert,
    compose_geboren,
    compose_wahlen,
    ist_erteilt,
    nachweis_stand_of,
)
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

# Three instants, in order, as `app/core/recording.py :: log_stamp` spells one.
GIVEN_AT: Final = "2026-04-01T10:30:00+00:00"
WITHDRAWN_AT: Final = "2026-05-02T07:00:00+00:00"
LATER: Final = "2026-07-04T12:00:00+00:00"

# The label a person confirmed under, and the label of an account control a later press is given under.
CONFIRMED_LABEL: Final = "2026-09-schiedsrichterseite-3"
ACCOUNT_LABEL: Final = "2026-10-schiedsrichterkonto"

# A referee's record as their confirmation left it: both choices granted, each with its evidence.
CONFIRMED: Final[Mapping[str, Any]] = {
    "umfang": "kader_oeffentlich",
    "erteilt_von": "volljaehrig",
    "datum": "2026-04-01",
    "bestaetigt_am": "2026-04-01",
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
        "medien": {"am": WITHDRAWN_AT, "text_version": ACCOUNT_LABEL, "erteilt_zuvor": {"am": GIVEN_AT, "text_version": CONFIRMED_LABEL}},
    },
}

# A record stored before evidence was kept: a grant nothing proves.
WITHOUT_EVIDENCE: Final[Mapping[str, Any]] = {key: value for key, value in CONFIRMED.items() if key != "nachweis"}

# A contact seat's record as the application wrote it, before the field `medien` existed.
SEAT_BEFORE_MEDIEN: Final[Mapping[str, Any]] = {
    "umfang": "kontaktdaten",
    "erfasst_von": "administrativ",
    "text_version": "2026-09-bestaetigung-5",
    "datum": "2026-03-20",
    "bestaetigt_am": None,
}


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
        assert ist_erteilt(wahl, wert) is erteilt


class TestTheEvidenceOfOneChoice:
    def test_a_grant_keeps_when_and_under_which_label_and_nothing_else(self):
        """No speaker: only the person's own write stamps evidence, so a field naming one would say nothing."""

        assert compose_beleg(gespeichert=MEDIA_WITHDRAWN, wahl="medien", wert=True, am=LATER, text_version=ACCOUNT_LABEL) == {
            "am": LATER,
            "text_version": ACCOUNT_LABEL,
        }

    def test_a_withdrawal_keeps_the_grant_it_ended(self):
        assert compose_beleg(gespeichert=CONFIRMED, wahl="medien", wert=False, am=WITHDRAWN_AT, text_version=ACCOUNT_LABEL) == {
            "am": WITHDRAWN_AT,
            "text_version": ACCOUNT_LABEL,
            "erteilt_zuvor": {"am": GIVEN_AT, "text_version": CONFIRMED_LABEL},
        }

    def test_a_withdrawal_restated_keeps_the_grant_the_first_one_ended(self):
        """Not the first withdrawal itself: what a withdrawal proves is the grant it ended."""

        assert compose_beleg(gespeichert=MEDIA_WITHDRAWN, wahl="medien", wert=False, am=LATER, text_version=ACCOUNT_LABEL) == {
            "am": LATER,
            "text_version": ACCOUNT_LABEL,
            "erteilt_zuvor": {"am": GIVEN_AT, "text_version": CONFIRMED_LABEL},
        }

    def test_a_withdrawal_of_a_grant_stored_before_evidence_names_no_earlier_grant(self):
        assert compose_beleg(gespeichert=WITHOUT_EVIDENCE, wahl="umfang", wert="intern", am=LATER, text_version=ACCOUNT_LABEL) == {
            "am": LATER,
            "text_version": ACCOUNT_LABEL,
        }

    def test_a_grant_after_a_withdrawal_drops_the_earlier_grant(self):
        """Bounded at one act per choice: the grant standing is its own evidence."""

        beleg = compose_beleg(gespeichert=MEDIA_WITHDRAWN, wahl="medien", wert=True, am=LATER, text_version=ACCOUNT_LABEL)

        assert "erteilt_zuvor" not in beleg

    def test_a_seat_answered_without_whatsapp_keeps_no_earlier_grant(self):
        """`kontaktdaten` withholds, so a seat's first answer declining WhatsApp is a withdrawal of nothing."""

        assert compose_beleg(gespeichert=SEAT_BEFORE_MEDIEN, wahl="umfang", wert="kontaktdaten", am=LATER, text_version="v6") == {
            "am": LATER,
            "text_version": "v6",
        }


class TestTheTwoShapesOfAWrite:
    def test_a_press_sets_the_moved_choice_and_its_evidence_dotted(self):
        """Dotted, so `bestaetigt_am`, the confirmed label and the other choice's evidence stay as stored."""

        assert compose_wahlen(
            pfad="einwilligung", gespeichert=CONFIRMED, gesetzt={"medien": False}, am=WITHDRAWN_AT, text_version=ACCOUNT_LABEL
        ) == {
            "einwilligung.medien": False,
            "einwilligung.nachweis.medien": {
                "am": WITHDRAWN_AT,
                "text_version": ACCOUNT_LABEL,
                "erteilt_zuvor": {"am": GIVEN_AT, "text_version": CONFIRMED_LABEL},
            },
        }

    def test_a_record_born_whole_carries_each_choice_it_holds_evidenced_under_its_own_label(self):
        born = compose_geboren(block=WITHOUT_EVIDENCE, am=GIVEN_AT)

        assert born == CONFIRMED

    def test_a_block_born_with_no_label_is_refused(self):
        with pytest.raises(ValueError):
            compose_geboren(block={**WITHOUT_EVIDENCE, "text_version": None}, am=GIVEN_AT)

    def test_a_block_already_holding_evidence_is_never_born_again(self):
        """Born over stored evidence, a withdrawal's earlier grant would go in one `$set`."""

        with pytest.raises(ValueError):
            compose_geboren(block=MEDIA_WITHDRAWN, am=LATER)


# A registration confirmed between the record's confirmation and its withdrawal: scope narrowed, media granted.
REGISTERED_AT: Final = "2026-04-15T09:00:00+00:00"
REGISTERED: Final[Mapping[str, Any]] = {
    "umfang": "intern",
    "erteilt_von": "volljaehrig",
    "datum": "2026-04-15",
    "bestaetigt_am": "2026-04-15",
    "text_version": "2026-09-spielerseite-3",
    "medien": True,
    "nachweis": {
        "umfang": {"am": REGISTERED_AT, "text_version": "2026-09-spielerseite-3"},
        "medien": {"am": REGISTERED_AT, "text_version": "2026-09-spielerseite-3"},
    },
}


def renew(gespeichert: Mapping[str, Any], erneuert: Mapping[str, Any]) -> dict[str, Any]:
    return compose_erneuert(pfad="einwilligung", gespeichert=gespeichert, erneuert=erneuert, stamp=log_stamp)


def unevidenced(block: Mapping[str, Any], **fields: Any) -> dict[str, Any]:
    """A block confirmed before evidence was kept, its day and label being all that dates its choices."""

    return {**{key: value for key, value in block.items() if key != "nachweis"}, **fields}


# The first instant of a German day, as `log_stamp` spells it: what a choice set before evidence is dated.
START_OF_2026_04_15: Final = "2026-04-14T22:00:00+00:00"


class TestARenewalFromTheSamePersonsLaterAnswers:
    """`compose_erneuert`, the admission's renewal: each choice goes to whichever answer is the newer."""

    def test_a_newer_answer_renews_its_choice_and_an_older_one_leaves_the_stored(self):
        """`MEDIA_WITHDRAWN`'s media withdrawal postdates the registration; its scope's grant does not."""

        update = renew(MEDIA_WITHDRAWN, REGISTERED)

        assert "einwilligung.medien" not in update and "einwilligung.nachweis.medien" not in update
        assert (update["einwilligung.umfang"], update["einwilligung.nachweis.umfang"]) == (
            "intern",
            {"am": REGISTERED_AT, "text_version": "2026-09-spielerseite-3", "erteilt_zuvor": {"am": GIVEN_AT, "text_version": CONFIRMED_LABEL}},
        )

    def test_every_field_but_the_choices_is_renewed(self):
        update = renew(MEDIA_WITHDRAWN, REGISTERED)

        assert {key: update[f"einwilligung.{key}"] for key in ("erteilt_von", "datum", "bestaetigt_am", "text_version")} == {
            "erteilt_von": "volljaehrig",
            "datum": "2026-04-15",
            "bestaetigt_am": "2026-04-15",
            "text_version": "2026-09-spielerseite-3",
        }

    def test_a_tie_keeps_what_is_stored(self):
        tied = {
            **REGISTERED,
            "nachweis": {"umfang": {"am": GIVEN_AT, "text_version": "x"}, "medien": {"am": WITHDRAWN_AT, "text_version": "x"}},
        }

        update = renew(MEDIA_WITHDRAWN, tied)

        assert not {"einwilligung.umfang", "einwilligung.medien"} & set(update)

    @pytest.mark.parametrize(
        ("registered_on", "renewed"),
        [
            pytest.param("2026-04-15", True, id="confirmed after the stored record"),
            pytest.param("2026-03-15", False, id="confirmed before it"),
            pytest.param("2026-04-01", False, id="confirmed the same day: a tie keeps what is stored"),
        ],
    )
    def test_with_neither_side_evidenced_the_later_confirmation_day_decides(self, registered_on: str, renewed: bool):
        """Both stored before evidence was kept: each choice is dated by its own block's `bestaetigt_am`."""

        update = renew(WITHOUT_EVIDENCE, unevidenced(REGISTERED, bestaetigt_am=registered_on, datum=registered_on))

        assert ({"einwilligung.umfang", "einwilligung.medien"} <= set(update)) is renewed
        assert ("einwilligung.nachweis.umfang" in update) is renewed

    def test_a_renewal_dated_by_its_day_is_evidenced_by_that_day_and_its_own_label(self):
        """The registration's act is its confirmation: the first instant of that German day, under the label it was shown."""

        update = renew(WITHOUT_EVIDENCE, unevidenced(REGISTERED))

        assert (update["einwilligung.umfang"], update["einwilligung.nachweis.umfang"]) == (
            "intern",
            {"am": START_OF_2026_04_15, "text_version": "2026-09-spielerseite-3"},
        )

    def test_stored_evidence_meets_an_unevidenced_answer_by_its_day(self):
        """Evidence dated before that day loses to it; evidence after it, or on it, stands."""

        update = renew(MEDIA_WITHDRAWN, unevidenced(REGISTERED))

        # The scope's grant (1 April) predates the registration's day; the media withdrawal (2 May) does not.
        assert "einwilligung.medien" not in update
        assert (update["einwilligung.umfang"], update["einwilligung.nachweis.umfang"]) == (
            "intern",
            {
                "am": START_OF_2026_04_15,
                "text_version": "2026-09-spielerseite-3",
                "erteilt_zuvor": {"am": GIVEN_AT, "text_version": CONFIRMED_LABEL},
            },
        )

        same_day = {
            **MEDIA_WITHDRAWN,
            "nachweis": {**MEDIA_WITHDRAWN["nachweis"], "umfang": {"am": "2026-04-15T06:00:00+00:00", "text_version": "x"}},
        }
        assert "einwilligung.umfang" not in renew(same_day, unevidenced(REGISTERED))

    def test_a_block_with_neither_evidence_nor_a_confirmation_day_is_older_than_anything(self):
        carried_over = unevidenced(CONFIRMED, bestaetigt_am=None, erteilt_von="bestandsuebernahme")

        assert {"einwilligung.umfang", "einwilligung.medien"} <= set(renew(carried_over, unevidenced(REGISTERED)))
        assert not {"einwilligung.umfang", "einwilligung.medien"} & set(renew(WITHOUT_EVIDENCE, unevidenced(REGISTERED, bestaetigt_am=None)))

    def test_a_returning_pupil_registered_before_evidence_takes_the_answers_they_gave(self):
        """The case a cold drive found: both sides predate evidence, and the narrowed scope and the declined media must land.

        Left as stored, the name stays published while the record claims the pupil confirmed it on the day they declined.
        """

        gespeichert = {
            "umfang": "kader_oeffentlich",
            "erteilt_von": "bestandsuebernahme",
            "datum": "2025-09-01",
            "bestaetigt_am": "2025-09-01",
            "text_version": "2025-09",
            "medien": True,
        }
        registrierung = {
            "vorname": "Ida",
            "nachname": "Muster",
            "geburtsdatum": "2009-05-04",
            "einwilligung": {
                "umfang": "intern",
                "erteilt_von": "volljaehrig",
                "datum": "2026-10-01",
                "bestaetigt_am": "2026-10-01",
                "text_version": "2026-09-spielerseite-3",
                "medien": False,
            },
        }

        gesetzt = compose_person_update(registrierung_raw=registrierung, gespeichert=gespeichert, adresse="ida@example.com")["$set"]

        stamp = {"am": "2026-09-30T22:00:00+00:00", "text_version": "2026-09-spielerseite-3"}
        assert {key: value for key, value in gesetzt.items() if key.startswith("einwilligung.")} == {
            "einwilligung.umfang": "intern",
            "einwilligung.medien": False,
            "einwilligung.erteilt_von": "volljaehrig",
            "einwilligung.datum": "2026-10-01",
            "einwilligung.bestaetigt_am": "2026-10-01",
            "einwilligung.text_version": "2026-09-spielerseite-3",
            # The stored grants carried no evidence, so neither withdrawal names the grant it ended.
            "einwilligung.nachweis.umfang": stamp,
            "einwilligung.nachweis.medien": stamp,
        }

    def test_a_record_stored_without_evidence_takes_every_evidenced_answer(self):
        update = renew(WITHOUT_EVIDENCE, REGISTERED)

        assert (update["einwilligung.umfang"], update["einwilligung.medien"]) == ("intern", True)
        # The stored grant carried no evidence, so the withdrawal names none.
        assert update["einwilligung.nachweis.umfang"] == {"am": REGISTERED_AT, "text_version": "2026-09-spielerseite-3"}

    def test_instants_are_compared_as_instants(self):
        """Two spellings of one instant are a tie, which a comparison of the strings would order."""

        offset = {**REGISTERED, "nachweis": {"umfang": {"am": "2026-04-01T12:30:00+02:00", "text_version": "x"}}}
        stored = {**WITHOUT_EVIDENCE, "nachweis": {"umfang": {"am": "2026-04-01T10:30:00+00:00", "text_version": "y"}}}

        assert "einwilligung.umfang" not in renew(stored, offset)


class TestTheStandAPressEchoes:
    """`nachweis_stand_of`, the one derivation the account read serves and a consent PATCH compares with."""

    def test_a_record_answers_each_choices_instant_and_none_where_it_holds_no_evidence(self):
        assert nachweis_stand_of(bloecke=[MEDIA_WITHDRAWN], wahlen=WAHLEN) == {"umfang": GIVEN_AT, "medien": WITHDRAWN_AT}
        assert nachweis_stand_of(bloecke=[WITHOUT_EVIDENCE], wahlen=WAHLEN) == {"umfang": None, "medien": None}

    def test_several_blocks_answer_the_latest_instant_as_it_was_stored(self):
        """One press moves every held seat; the latest is compared as an instant and served in its own spelling."""

        spelt_otherwise = {**WITHOUT_EVIDENCE, "nachweis": {"medien": {"am": "2026-05-02T08:30:00+02:00", "text_version": "x"}}}

        assert nachweis_stand_of(bloecke=[CONFIRMED, spelt_otherwise], wahlen=("medien",)) == {"medien": "2026-05-02T08:30:00+02:00"}
        assert nachweis_stand_of(bloecke=[MEDIA_WITHDRAWN, spelt_otherwise], wahlen=("medien",)) == {"medien": WITHDRAWN_AT}


class TestARecordStoredBeforeItsEvidence:
    """No migration: every record stored before the field reads as one no person has answered."""

    def test_a_persons_record_reads_empty_evidence(self):
        nachweis = FLEinwilligung.model_validate(WITHOUT_EVIDENCE).nachweis

        assert (nachweis.umfang, nachweis.medien) == (None, None)

    def test_a_seat_reads_empty_evidence_and_no_media_consent(self):
        read = FLKontaktKenntnisnahme.model_validate(SEAT_BEFORE_MEDIEN)

        assert (read.nachweis.umfang, read.nachweis.medien, read.medien) == (None, None, False)


DATABASE_NAME = worker_database("fl_einwilligung_nachweis_test")
REFEREE_OID = ObjectId("6890a1b2c3d4e5f607a10001")


def on_a_stored_record(url: str, einwilligung: Mapping[str, Any], *updates: Mapping[str, Any]) -> Mapping[str, Any]:
    """The record stored, each update applied in order, and the block read back.

    Unconstrained: the subject is what MongoDB does with a dotted path, which the validator does not decide.
    """

    async def body(database: AsyncDatabase) -> Mapping[str, Any]:
        collection = database["einwilligung_nachweis"]
        await collection.insert_one({"_id": REFEREE_OID, "einwilligung": dict(einwilligung)})
        for update in updates:
            await collection.update_one({"_id": REFEREE_OID}, update)

        found = await collection.find_one({"_id": REFEREE_OID})
        assert found is not None, "the record this case stored is gone"

        return found["einwilligung"]

    async def run() -> Mapping[str, Any]:
        async with a_clean_database(url, DATABASE_NAME, constraints=False) as (_, database):
            return await body(database)

    return on_the_seed_loop(run())


def press(stored: Mapping[str, Any], gesetzt: Mapping[FLEinwilligungWahl, Any]) -> Mapping[str, Any]:
    return {"$set": compose_wahlen(pfad="einwilligung", gespeichert=stored, gesetzt=gesetzt, am=LATER, text_version=ACCOUNT_LABEL)}


@pytest.mark.db
class TestAPressLandsOnTheStoredRecord:
    def test_a_withdrawal_leaves_the_other_choice_and_its_evidence_as_stored(self, mongo_url: str):
        """Literal values, never the composer's own fold: a fold computing both sides agrees with itself whatever it does."""

        read = on_a_stored_record(mongo_url, CONFIRMED, press(CONFIRMED, {"umfang": "intern"}))

        assert read == {
            **CONFIRMED,
            "umfang": "intern",
            "nachweis": {
                "umfang": {"am": LATER, "text_version": ACCOUNT_LABEL, "erteilt_zuvor": {"am": GIVEN_AT, "text_version": CONFIRMED_LABEL}},
                "medien": {"am": GIVEN_AT, "text_version": CONFIRMED_LABEL},
            },
        }

    def test_a_record_stored_before_its_evidence_gains_it_without_a_backfill(self, mongo_url: str):
        """A dotted `$set` onto a missing key makes the path, so a record predating the field needs no migration."""

        read = on_a_stored_record(mongo_url, WITHOUT_EVIDENCE, press(WITHOUT_EVIDENCE, {"medien": False}))

        assert read == {**WITHOUT_EVIDENCE, "medien": False, "nachweis": {"medien": {"am": LATER, "text_version": ACCOUNT_LABEL}}}
