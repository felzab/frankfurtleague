from collections.abc import Mapping
from typing import Any, Final, get_args

import bson
import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import BEWERBUNG_WEG, NEUBESETZUNG_WEG
from app.api.schiedsrichter.services import BESTAETIGUNG_WEG
from app.api.spieler.schemas import FLEinwilligung, FLEinwilligungWeg
from app.api.teams.schemas import FLKontaktKenntnisnahme, FLKontaktKenntnisnahmeWeg
from app.core.config import API_VERSION
from app.shared.einwilligung_verlauf import VERLAUF, compose_born_record, compose_eintrag, compose_record_move
from tests.core.app_source import api_routes, application
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

PREFIX: Final = f"/api/v{API_VERSION}"

# Three instants, in order, as `app/core/recording.py :: log_stamp` spells one.
GIVEN_AT: Final = "2026-04-01T10:30:00+00:00"
WITHDRAWN_AT: Final = "2026-05-02T07:00:00+00:00"
REGIVEN_AT: Final = "2026-06-03T16:45:00+00:00"
LATER: Final = "2026-07-04T12:00:00+00:00"

# Free strings: what these cases drive is how an update lands on a stored list, which no write's
# own operation decides. The validator's closed set is held by the writers' own suites.
A_CONFIRMATION: Final = "POST /a/confirmation"
A_SWITCH: Final = "PATCH /a/switch"

# The label a person confirmed under, which the block keeps, and the label of an account control a
# later press is given under, which that press's entry alone records.
CONFIRMED_LABEL: Final = "2026-09-schiedsrichterseite-3"
ACCOUNT_LABEL: Final = "2026-10-schiedsrichterkonto"

# A referee's record as their confirmation left it, with the two entries that stand before every
# case below: the confirmation, then a press withdrawing the media consent.
STORED_WITH_TWO_ENTRIES: Final[Mapping[str, Any]] = {
    "umfang": "kader_oeffentlich",
    "erteilt_von": "volljaehrig",
    "datum": "2026-04-01",
    "bestaetigt_am": "2026-04-01",
    "text_version": CONFIRMED_LABEL,
    "medien": False,
    "verlauf": [
        {
            "am": GIVEN_AT,
            "akt": "bestaetigt",
            "ueber": A_CONFIRMATION,
            "umfang": "kader_oeffentlich",
            "medien": True,
            "text_version": CONFIRMED_LABEL,
            "erteilt_von": "volljaehrig",
        },
        {
            "am": WITHDRAWN_AT,
            "akt": "widerrufen",
            "ueber": A_SWITCH,
            "umfang": "kader_oeffentlich",
            "medien": False,
            "text_version": ACCOUNT_LABEL,
            "erteilt_von": "volljaehrig",
        },
    ],
}

# A contact seat's record as the application wrote it, before the field `medien` existed.
SEAT_BEFORE_MEDIEN: Final[Mapping[str, Any]] = {
    "umfang": "kontaktdaten",
    "erfasst_von": "administrativ",
    "text_version": "2026-09-bestaetigung-5",
    "datum": "2026-03-20",
    "bestaetigt_am": None,
}


def without_entries(block: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in block.items() if key != VERLAUF}


class TestAnEntryIsCutFromTheBlockItLeaves:
    def test_a_persons_record_yields_its_choices_and_who_spoke_under_the_acts_own_label(self):
        block = {**STORED_WITH_TWO_ENTRIES, "umfang": "intern"}

        assert compose_eintrag(block=block, akt="widerrufen", ueber=A_SWITCH, am=LATER, text_version=ACCOUNT_LABEL) == {
            "am": LATER,
            "akt": "widerrufen",
            "ueber": A_SWITCH,
            "umfang": "intern",
            "medien": False,
            "text_version": ACCOUNT_LABEL,
            "erteilt_von": "volljaehrig",
        }

    def test_a_seat_stored_before_media_records_media_as_off(self):
        """What both read models answer for the absent key, so the entry and every read of the block agree."""

        eintrag = compose_eintrag(block=SEAT_BEFORE_MEDIEN, akt="erteilt", ueber=BEWERBUNG_WEG, am=GIVEN_AT, text_version="v5")

        assert eintrag == {
            "am": GIVEN_AT,
            "akt": "erteilt",
            "ueber": "POST /bewerbungen",
            "umfang": "kontaktdaten",
            "medien": False,
            "text_version": "v5",
            "erfasst_von": "administrativ",
        }

    @pytest.mark.parametrize(
        ("block", "text_version"),
        [
            (SEAT_BEFORE_MEDIEN, ""),
            ({key: value for key, value in SEAT_BEFORE_MEDIEN.items() if key != "erfasst_von"}, "v5"),
            ({**SEAT_BEFORE_MEDIEN, "erteilt_von": "volljaehrig"}, "v5"),
        ],
        ids=["no label", "nobody spoke", "both vocabularies at once"],
    )
    def test_an_entry_naming_no_label_or_no_single_speaker_is_refused(self, block: Mapping[str, Any], text_version: str):
        with pytest.raises(ValueError):
            compose_eintrag(block=block, akt="erteilt", ueber=BEWERBUNG_WEG, am=GIVEN_AT, text_version=text_version)

    def test_a_record_carried_over_with_no_label_is_still_moved_under_the_presss_label(self):
        """A pupil record from before labels holds a null one, which a block may keep and an entry may not."""

        stored = {**without_entries(STORED_WITH_TWO_ENTRIES), "text_version": None}

        assert compose_eintrag(block=stored, akt="widerrufen", ueber=A_SWITCH, am=LATER, text_version=ACCOUNT_LABEL)["text_version"] == (
            ACCOUNT_LABEL
        )


class TestTheTwoShapesOfAWrite:
    def test_a_born_record_carries_its_first_entry_under_its_own_label(self):
        born = compose_born_record(block=SEAT_BEFORE_MEDIEN, akt="erteilt", ueber=NEUBESETZUNG_WEG, am=GIVEN_AT)

        assert born == {
            **SEAT_BEFORE_MEDIEN,
            "verlauf": [
                {
                    "am": GIVEN_AT,
                    "akt": "erteilt",
                    "ueber": "POST /bewerbungen/{bewerbung_id}/kontakte/{seat}",
                    "umfang": "kontaktdaten",
                    "medien": False,
                    "text_version": "2026-09-bestaetigung-5",
                    "erfasst_von": "administrativ",
                }
            ],
        }

    def test_a_block_born_with_no_label_is_refused(self):
        with pytest.raises(ValueError):
            compose_born_record(block={**SEAT_BEFORE_MEDIEN, "text_version": None}, akt="erteilt", ueber=BEWERBUNG_WEG, am=GIVEN_AT)

    def test_a_block_already_holding_entries_is_never_born_again(self):
        """Born over a stored list, the record would lose every earlier act in one `$set`."""

        with pytest.raises(ValueError):
            compose_born_record(block=STORED_WITH_TWO_ENTRIES, akt="bestaetigt", ueber=A_CONFIRMATION, am=LATER)

    def test_a_press_sets_the_moved_choice_alone_and_pushes_one_entry(self):
        """Dotted, so `bestaetigt_am` -- which the panel and the publication mask read -- and the confirmed label stay as stored."""

        assert withdrawal(STORED_WITH_TWO_ENTRIES) == {
            "$set": {"einwilligung.umfang": "intern"},
            "$push": {
                "einwilligung.verlauf": {
                    "am": LATER,
                    "akt": "widerrufen",
                    "ueber": A_SWITCH,
                    "umfang": "intern",
                    "medien": False,
                    "text_version": ACCOUNT_LABEL,
                    "erteilt_von": "volljaehrig",
                }
            },
        }

    def test_a_confirmation_moves_the_blocks_label_with_its_entrys(self):
        """The one act that sets both: what a person confirmed is the label the block then keeps."""

        update = compose_record_move(
            pfad="kontakte.trainer.einwilligung",
            stored=SEAT_BEFORE_MEDIEN,
            moved={"bestaetigt_am": "2026-03-25", "erfasst_von": "person", "text_version": "v6"},
            akt="bestaetigt",
            ueber=A_CONFIRMATION,
            am=GIVEN_AT,
            text_version="v6",
        )

        assert update["$set"]["kontakte.trainer.einwilligung.text_version"] == "v6"
        assert update["$push"]["kontakte.trainer.einwilligung.verlauf"]["text_version"] == "v6"
        assert update["$push"]["kontakte.trainer.einwilligung.verlauf"]["erfasst_von"] == "person"

    def test_no_move_sets_the_entries(self):
        with pytest.raises(ValueError):
            compose_record_move(
                pfad="einwilligung",
                stored=STORED_WITH_TWO_ENTRIES,
                moved={VERLAUF: []},
                akt="widerrufen",
                ueber=A_SWITCH,
                am=LATER,
                text_version=ACCOUNT_LABEL,
            )


class TestARecordStoredBeforeItsEntries:
    """No migration: every record stored before the list reads as its block alone."""

    def test_a_persons_record_reads_no_entries(self):
        assert FLEinwilligung.model_validate(without_entries(STORED_WITH_TWO_ENTRIES)).verlauf == []

    def test_a_seat_reads_no_entries_and_no_media_consent(self):
        read = FLKontaktKenntnisnahme.model_validate(SEAT_BEFORE_MEDIEN)

        assert (read.verlauf, read.medien) == ([], False)


def served_operations() -> set[str]:
    """Every operation the application serves, spelled as `app/core/domain.py :: RULES` spells one."""

    return {f"{method} {route.path_format.removeprefix(PREFIX)}" for route in api_routes(application()) for method in route.methods or ()}


@pytest.mark.parametrize("operation", [*get_args(FLEinwilligungWeg), *get_args(FLKontaktKenntnisnahmeWeg)])
def test_every_write_an_entry_can_name_is_a_served_operation(operation: str):
    """A member is never removed, so a misspelt one would be a value the validator admits for good and no write produces."""

    assert operation in served_operations()


def test_the_reader_of_the_served_operations_tells_a_route_from_a_misspelling():
    """The control: a reader answering every string would pass the case above for any member at all."""

    assert BESTAETIGUNG_WEG in served_operations()
    assert "POST /schiedsrichter/bestaetigungen" not in served_operations()


DATABASE_NAME = worker_database("fl_einwilligung_verlauf_test")
REFEREE_OID = ObjectId("6890a1b2c3d4e5f607a10001")


def on_a_stored_record(url: str, einwilligung: Mapping[str, Any], *updates: Mapping[str, Any]) -> Mapping[str, Any]:
    """The record stored, each update applied in order, and the block read back.

    Unconstrained: the subject is what MongoDB does with a move, and a free operation string stands
    in for writes the validator does not admit yet.
    """

    async def body(database: AsyncDatabase) -> Mapping[str, Any]:
        collection = database["einwilligung_verlauf"]
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


def withdrawal(stored: Mapping[str, Any]) -> Mapping[str, Any]:
    """A press on the account page narrowing the publication scope, under the control's own label."""

    return compose_record_move(
        pfad="einwilligung", stored=stored, moved={"umfang": "intern"}, akt="widerrufen", ueber=A_SWITCH, am=LATER, text_version=ACCOUNT_LABEL
    )


@pytest.mark.db
class TestAMoveAppendsAndOverwritesNothing:
    def test_a_withdrawal_leaves_every_earlier_entry_byte_for_byte(self, mongo_url: str):
        """Two entries before it, so an update rewriting the list -- or the first entry alone -- is told from one appending."""

        read = on_a_stored_record(mongo_url, STORED_WITH_TWO_ENTRIES, withdrawal(STORED_WITH_TWO_ENTRIES))

        earlier = [bson.encode(entry) for entry in STORED_WITH_TWO_ENTRIES[VERLAUF]]
        assert [bson.encode(entry) for entry in read[VERLAUF][:2]] == earlier
        assert len(read[VERLAUF]) == 3

    def test_after_a_withdrawal_the_block_and_the_new_entry_hold_what_the_press_gave(self, mongo_url: str):
        """Literal values, never the composer's own fold: a fold computing both sides agrees with itself whatever it does."""

        read = on_a_stored_record(mongo_url, STORED_WITH_TWO_ENTRIES, withdrawal(STORED_WITH_TWO_ENTRIES))

        assert without_entries(read) == {
            "umfang": "intern",
            "erteilt_von": "volljaehrig",
            "datum": "2026-04-01",
            "bestaetigt_am": "2026-04-01",
            "text_version": CONFIRMED_LABEL,
            "medien": False,
        }
        assert read[VERLAUF][2] == {
            "am": LATER,
            "akt": "widerrufen",
            "ueber": A_SWITCH,
            "umfang": "intern",
            "medien": False,
            "text_version": ACCOUNT_LABEL,
            "erteilt_von": "volljaehrig",
        }

    def test_a_grant_after_a_withdrawal_appends_a_second_grant_rather_than_reviving_the_first(self, mongo_url: str):
        withdrawn = {**STORED_WITH_TWO_ENTRIES, "umfang": "intern"}
        regrant = compose_record_move(
            pfad="einwilligung",
            stored=withdrawn,
            moved={"medien": True},
            akt="erteilt",
            ueber=A_SWITCH,
            am=REGIVEN_AT,
            text_version=ACCOUNT_LABEL,
        )

        read = on_a_stored_record(mongo_url, STORED_WITH_TWO_ENTRIES, withdrawal(STORED_WITH_TWO_ENTRIES), regrant)

        assert [entry["akt"] for entry in read[VERLAUF]] == ["bestaetigt", "widerrufen", "widerrufen", "erteilt"]
        # The first grant still names the instant, the media answer and the label it was given under.
        assert read[VERLAUF][0] == STORED_WITH_TWO_ENTRIES[VERLAUF][0]
        assert read[VERLAUF][3] == {
            "am": REGIVEN_AT,
            "akt": "erteilt",
            "ueber": A_SWITCH,
            "umfang": "intern",
            "medien": True,
            "text_version": ACCOUNT_LABEL,
            "erteilt_von": "volljaehrig",
        }
        assert without_entries(read) == {
            "umfang": "intern",
            "erteilt_von": "volljaehrig",
            "datum": "2026-04-01",
            "bestaetigt_am": "2026-04-01",
            "text_version": CONFIRMED_LABEL,
            "medien": True,
        }

    def test_a_record_stored_before_its_entries_gains_its_first_one(self, mongo_url: str):
        """`$push` onto a missing key makes the list: a record predating them needs no backfill to be moved."""

        stored = without_entries(STORED_WITH_TWO_ENTRIES)

        read = on_a_stored_record(mongo_url, stored, withdrawal(stored))

        assert read[VERLAUF] == [
            {
                "am": LATER,
                "akt": "widerrufen",
                "ueber": A_SWITCH,
                "umfang": "intern",
                "medien": False,
                "text_version": ACCOUNT_LABEL,
                "erteilt_von": "volljaehrig",
            }
        ]
