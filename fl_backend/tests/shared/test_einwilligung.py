from collections.abc import Callable, Mapping
from typing import Any, Final

import pytest
from bson import ObjectId
from pydantic import BaseModel, ValidationError
from pydantic_core import PydanticCustomError

from app.api.registrierungen.schemas import FLRegistrierungEinwilligung
from app.api.schiedsrichter.schemas import FLSchiedsrichterRecord
from app.api.spieler.schemas import FLSpielerRecord
from app.api.teams.schemas import FLKontaktKenntnisnahme
from app.shared.einwilligung import is_confirmed
from app.shared.einwilligung_nachweis import CHOICES, NACHWEIS, FLEinwilligungChoice
from app.shared.schemas.einwilligung import (
    FLEinwilligungTextVersion,
    FLSchiedsrichterTextVersions,
    FLSeatTextVersions,
    FLSpielerTextVersions,
    labels_of,
    refuse_a_stale_grant,
)
from tests.documents import (
    SCHIEDSRICHTER_TEXT_VERSIONS,
    SEAT_TEXT_VERSIONS,
    SPIELER_TEXT_VERSIONS,
    kontaktperson_document,
    own_einwilligung_document,
    schiedsrichter_document,
    spieler_document,
)

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


def _own(labels: Mapping[FLEinwilligungChoice, str]) -> dict[str, Any]:
    return own_einwilligung_document(text_versions=labels, confirmed_at=STAMP)


# Each record model a read-back judges, beside its kind's labels, a document of it, and the way to its consent block.
RECORDS: Final[list[Any]] = [
    pytest.param(
        FLSpielerRecord,
        SPIELER_TEXT_VERSIONS,
        lambda: spieler_document(ObjectId(), "Anna", "Muster", einwilligung=_own(SPIELER_TEXT_VERSIONS)),
        lambda document: document["einwilligung"],
        id="a pupil",
    ),
    pytest.param(
        FLSchiedsrichterRecord,
        SCHIEDSRICHTER_TEXT_VERSIONS,
        lambda: schiedsrichter_document(
            ObjectId(), email="rita@example.com", name="Rita", default_payment=20, einwilligung=_own(SCHIEDSRICHTER_TEXT_VERSIONS)
        ),
        lambda document: document["einwilligung"],
        id="a referee",
    ),
    pytest.param(
        FLRegistrierungEinwilligung, SPIELER_TEXT_VERSIONS, lambda: _own(SPIELER_TEXT_VERSIONS), lambda block: block, id="a registration"
    ),
    pytest.param(
        FLKontaktKenntnisnahme,
        SEAT_TEXT_VERSIONS,
        lambda: kontaktperson_document("Kim", confirmed_at=STAMP)["einwilligung"],
        lambda block: block,
        id="a contact seat",
    ),
]


class TestARecordCitesItsKindsWordings:
    """What `python -m app.readback` holds a stored record to: a re-point mapping one choice's label onto another reads as refused."""

    @pytest.mark.parametrize(("model", "labels", "document", "block"), RECORDS)
    def test_its_kinds_own_labels_read(self, model: type[BaseModel], labels: Any, document: Callable[[], dict[str, Any]], block: Any):
        """The floor: without it the refusals below would pass on a model refusing everything."""

        model.model_validate(document())

    @pytest.mark.parametrize(("model", "labels", "document", "block"), RECORDS)
    @pytest.mark.parametrize("choice", CHOICES)
    @pytest.mark.parametrize("cited_by", ["the act", "the grant it ended"])
    def test_another_wordings_label_on_a_choice_is_refused(
        self,
        model: type[BaseModel],
        labels: Mapping[FLEinwilligungChoice, str],
        document: Callable[[], dict[str, Any]],
        block: Callable[[dict[str, Any]], dict[str, Any]],
        choice: FLEinwilligungChoice,
        cited_by: str,
    ):
        others = labels_of(FLEinwilligungTextVersion) - {labels[choice]}
        assert others, "every kind's choice shares its words with no other choice"
        for other in others:
            stored = document()
            beleg = block(stored)[NACHWEIS][choice]
            if cited_by == "the grant it ended":
                beleg["given_before"] = {"am": beleg["am"], "text_version": other}
            else:
                beleg["text_version"] = other
            with pytest.raises(ValidationError) as refused:
                model.model_validate(stored)
            assert [error["type"] for error in refused.value.errors()] == ["text_version_of_another_wording"], other


@pytest.mark.parametrize("kind", [FLSeatTextVersions, FLSpielerTextVersions, FLSchiedsrichterTextVersions])
class TestAGrantNamesItsChoicesCurrentWording:
    """A page loaded before a rewording names the label it replaced, which every record of its kind still cites.

    Constructed past validation: every kind's records cite its current labels alone until a rewording adds one, so no
    payload can carry another yet.
    """

    STALE: Final = "2026-10-ersetzt-1"

    @pytest.mark.parametrize(("choice", "giving"), [("umfang", "kader_oeffentlich"), ("umfang", "kontaktdaten_whatsapp"), ("medien", True)])
    def test_a_grant_under_a_replaced_label_is_refused(self, kind: type[FLSeatTextVersions], choice: FLEinwilligungChoice, giving: Any):
        labels = {**kind.current, choice: self.STALE}
        stale = kind.model_construct(umfang=labels["umfang"], medien=labels["medien"])
        with pytest.raises(PydanticCustomError) as refused:
            refuse_a_stale_grant(stale, {choice: giving})
        assert refused.value.type == "grant_wording_stale"

    def test_a_withdrawal_under_a_replaced_label_is_taken(self, kind: type[FLSeatTextVersions]):
        """Taking a consent back is never harder than giving it."""

        stale = kind.model_construct(umfang=self.STALE, medien=self.STALE)
        refuse_a_stale_grant(stale, {"umfang": "intern", "medien": False})
        refuse_a_stale_grant(stale, {"umfang": "kontaktdaten", "medien": False})

    def test_a_grant_under_the_current_label_is_taken(self, kind: type[FLSeatTextVersions]):
        """The floor for the refusal above."""

        refuse_a_stale_grant(kind.model_validate(dict(kind.current)), {"umfang": "kader_oeffentlich", "medien": True})
