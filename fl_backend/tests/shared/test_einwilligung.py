from collections.abc import Mapping
from typing import Any, Final

import pytest
from pydantic import BaseModel, ValidationError

from app.shared.einwilligung import is_confirmed
from app.shared.einwilligung_nachweis import CHOICES, FLEinwilligungChoice
from app.shared.schemas.einwilligung import FLSchiedsrichterTextVersions, FLSeatTextVersions, FLSpielerTextVersions
from tests.documents import SCHIEDSRICHTER_TEXT_VERSIONS, SEAT_TEXT_VERSIONS, SPIELER_TEXT_VERSIONS

STAMP = "2026-02-01"


@pytest.mark.parametrize(
    "einwilligung",
    [None, "2026-02-01", {}, {"confirmed_at": None}],
    ids=["null record", "no mapping", "no stamp key", "null stamp"],
)
def test_every_shape_short_of_a_stamp_is_unconfirmed(einwilligung: Any):
    """The seat's, the pupil's and the referee's shapes together."""

    assert is_confirmed(einwilligung) is False


def test_a_stamp_confirms():
    """The control: without it every case above passes on a predicate answering no to everything."""

    assert is_confirmed({"umfang": "kontaktdaten", "confirmed_at": STAMP}) is True


# Each kind's press model beside the labels its pages name, and one label a former build named.
KINDS: Final = [
    pytest.param(FLSeatTextVersions, SEAT_TEXT_VERSIONS, id="a contact seat"),
    pytest.param(FLSpielerTextVersions, SPIELER_TEXT_VERSIONS, id="a pupil"),
    pytest.param(FLSchiedsrichterTextVersions, SCHIEDSRICHTER_TEXT_VERSIONS, id="a referee"),
]
FORMER_LABEL: Final = "2026-10-spielerseite-5"
EVERY_LABEL: Final = {*SEAT_TEXT_VERSIONS.values(), *SPIELER_TEXT_VERSIONS.values(), *SCHIEDSRICHTER_TEXT_VERSIONS.values(), FORMER_LABEL}


class TestTheLabelsAPressNames:
    """A record cites the words its person was shown, so a press naming any label but its own wording's is refused."""

    @pytest.mark.parametrize(("model", "labels"), KINDS)
    def test_the_kinds_own_labels_pass(self, model: type[BaseModel], labels: Mapping[FLEinwilligungChoice, str]):
        """The floor: without it the refusals below would pass on a model refusing everything."""

        model.model_validate(dict(labels))

    @pytest.mark.parametrize(("model", "labels"), KINDS)
    @pytest.mark.parametrize("choice", CHOICES)
    def test_any_other_label_on_a_choice_is_refused(
        self, model: type[BaseModel], labels: Mapping[FLEinwilligungChoice, str], choice: FLEinwilligungChoice
    ):
        """Another wording's label and a former build's alike: a page loaded before a deploy shows words the record would then cite."""

        for other in EVERY_LABEL - {labels[choice]}:
            with pytest.raises(ValidationError) as refused:
                model.model_validate({**labels, choice: other})
            assert [error["type"] for error in refused.value.errors()] == ["literal_error"], other
