from collections.abc import Callable, Mapping
from typing import Any, Final

import pytest
from bson import ObjectId
from pydantic import BaseModel, TypeAdapter, ValidationError

from app.api.bewerbungen.schemas import FLBewerbungEinwilligungAntwortPayload
from app.api.registrierungen.schemas import FLRegistrierungConfirmationPayload, FLRegistrierungEinwilligung
from app.api.schiedsrichter.schemas import FLSchiedsrichterConfirmationPayload, FLSchiedsrichterRecord
from app.api.spieler.schemas import FLSpielerRecord
from app.api.teams.schemas import FLKontaktKenntnisnahme
from app.shared.einwilligung import is_confirmed
from app.shared.einwilligung_evidence import CHOICES, EVIDENCE, FLEinwilligungChoice
from app.shared.schemas.einwilligung import (
    FLEinwilligungTextVersion,
    FLSchiedsrichterTextVersions,
    FLSeatTextVersions,
    FLSpielerTextVersions,
    labels_of,
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
            receipt = block(stored)[EVIDENCE][choice]
            if cited_by == "the grant it ended":
                receipt["given_before"] = {"am": receipt["am"], "text_version": other}
            else:
                receipt["text_version"] = other
            with pytest.raises(ValidationError) as refused:
                model.model_validate(stored)
            assert [error["type"] for error in refused.value.errors()] == ["text_version_of_another_wording"], other


# Constructed past validation: every kind's records cite its current labels alone until a rewording adds one, so no
# request can carry another yet.
STALE: Final = "2026-10-ersetzt-1"


def _replaced(kind: type[FLSeatTextVersions] | type[FLSpielerTextVersions] | type[FLSchiedsrichterTextVersions], choice: str) -> Any:
    """`kind`'s labels with `choice`'s replaced, an instance a payload's field takes as it is: Pydantic revalidates none."""

    labels = {**kind.current, choice: STALE}
    return kind.model_construct(umfang=labels["umfang"], media=labels["media"])


def _seat_answer(*, umfang: str, media: bool, text_versions: Any) -> Any:
    return TypeAdapter(FLBewerbungEinwilligungAntwortPayload).validate_python(
        {
            "antwort": "given",
            "token": "raw-trainer",
            "geburtsdatum": "1984-05-09",
            "whatsapp": umfang == "kontaktdaten_whatsapp",
            "media": media,
            "text_versions": text_versions,
        }
    )


def _confirmation(model: type[BaseModel]) -> Callable[..., Any]:
    def validate(*, umfang: str, media: bool, text_versions: Any) -> Any:
        return model.model_validate(
            {"token": "raw-link", "geburtsdatum": "1984-05-09", "umfang": umfang, "media": media, "text_versions": text_versions}
        )

    return validate


# Each payload carrying `text_versions`, beside its kind and the value granting each choice in its vocabulary.
CONFIRMATIONS: Final[list[Any]] = [
    pytest.param(_seat_answer, FLSeatTextVersions, "kontaktdaten_whatsapp", id="a seat's answer"),
    pytest.param(_confirmation(FLRegistrierungConfirmationPayload), FLSpielerTextVersions, "kader_oeffentlich", id="a registration"),
    pytest.param(_confirmation(FLSchiedsrichterConfirmationPayload), FLSchiedsrichterTextVersions, "kader_oeffentlich", id="a referee"),
]


@pytest.mark.parametrize(("validate", "kind", "giving"), CONFIRMATIONS)
class TestAConfirmationGrantsUnderItsCurrentWording:
    """Each confirmation is a first answer, so every choice it grants moves and names the current label in its payload."""

    @pytest.mark.parametrize("choice", CHOICES)
    def test_a_grant_under_a_replaced_label_is_refused(self, validate: Callable[..., Any], kind: Any, giving: str, choice: str):
        with pytest.raises(ValidationError) as refused:
            validate(umfang=giving, media=True, text_versions=_replaced(kind, choice))

        assert [error["type"] for error in refused.value.errors()] == ["grant_wording_stale"]
