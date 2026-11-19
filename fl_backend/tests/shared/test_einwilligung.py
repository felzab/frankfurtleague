from collections.abc import Callable, Mapping
from typing import Any, Final

import pytest
from bson import ObjectId
from pydantic import BaseModel, TypeAdapter, ValidationError

from app.api.bewerbungen.schemas import FLBewerbungEinwilligungAnswerPayload
from app.api.registrierungen.schemas import FLRegistrierungConfirmationPayload, FLRegistrierungEinwilligung
from app.api.schiedsrichter.schemas import FLSchiedsrichterConfirmationPayload, FLSchiedsrichterRecord
from app.api.spieler.schemas import FLSpielerRecord
from app.api.teams.schemas import FLKontaktKenntnisnahme
from app.shared.einwilligung import is_confirmed
from app.shared.einwilligung_evidence import CHOICES, EVIDENCE, FLEinwilligungChoice, compose_mail_withdrawal, compose_renewed
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
    confirmed_instant,
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
    @pytest.mark.parametrize("choice", CHOICES)
    @pytest.mark.parametrize("cited_by", ["the act", "the grant it ended", "the grant a withdrawal by mail ended"])
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
                receipt["given_before"] = {"at": receipt["at"], "text_version": other}
            elif cited_by == "the grant a withdrawal by mail ended":
                block(stored)[EVIDENCE][choice] = _by_mail(receipt, given_before={"at": receipt["at"], "text_version": other})
            else:
                receipt["text_version"] = other
            with pytest.raises(ValidationError) as refused:
                model.model_validate(stored)
            assert [error["type"] for error in refused.value.errors()] == ["text_version_of_another_wording"], other

    @pytest.mark.parametrize(("model", "labels", "document", "block"), RECORDS)
    @pytest.mark.parametrize("choice", CHOICES)
    def test_a_withdrawal_by_mail_cites_no_wording_and_reads(
        self,
        model: type[BaseModel],
        labels: Mapping[FLEinwilligungChoice, str],
        document: Callable[[], dict[str, Any]],
        block: Callable[[dict[str, Any]], dict[str, Any]],
        choice: FLEinwilligungChoice,
    ):
        """The person withdrew in their own words, so the evidence marks the mail where a press names its label."""

        stored = document()
        receipt = block(stored)[EVIDENCE][choice]
        block(stored)[EVIDENCE][choice] = _by_mail(receipt, given_before={"at": receipt["at"], "text_version": labels[choice]})

        model.model_validate(stored)


def _by_mail(receipt: Mapping[str, Any], *, given_before: Mapping[str, Any]) -> dict[str, Any]:
    """`receipt`'s act entered from the person's mail instead, ending `given_before`."""

    return {"at": receipt["at"], "via": "mail", "given_before": dict(given_before)}


class TestAnAdmissionCarriesAWithdrawalByMail:
    """`compose_renewed` on a registration an administrator withdrew from by mail, admitted onto the pupil's own record."""

    def test_the_pupils_record_takes_the_mark_and_names_the_grant_it_ended_there(self):
        saved = own_einwilligung_document(text_versions=SPIELER_TEXT_VERSIONS, confirmed_at="2026-01-20")
        registered = own_einwilligung_document(text_versions=SPIELER_TEXT_VERSIONS, confirmed_at="2026-02-01")
        withdrawn_at = confirmed_instant("2026-03-01")
        moved = compose_mail_withdrawal(blocks={"einwilligung": registered}, withheld={"scope": "internal"}, at=withdrawn_at)
        renewed = {**registered, "scope": "internal", EVIDENCE: {**registered[EVIDENCE], "scope": moved["einwilligung.evidence.scope"]}}

        update = compose_renewed(path="einwilligung", saved=saved, renewed=renewed)

        assert (update["einwilligung.scope"], update["einwilligung.evidence.scope"]) == (
            "internal",
            {"at": withdrawn_at, "via": "mail", "given_before": saved[EVIDENCE]["scope"]},
        )


# Constructed past validation: every kind's records cite its current labels alone until a rewording adds one, so no
# request can carry another yet.
STALE: Final = "2026-10-replaced-1"


def _replaced(kind: type[FLSeatTextVersions] | type[FLSpielerTextVersions] | type[FLSchiedsrichterTextVersions], choice: str) -> Any:
    """`kind`'s labels with `choice`'s replaced, an instance a payload's field takes as it is: Pydantic revalidates none."""

    labels = {**kind.current, choice: STALE}
    return kind.model_construct(scope=labels["scope"], media=labels["media"])


def _seat_answer(*, scope: str, media: bool, text_versions: Any) -> Any:
    return TypeAdapter(FLBewerbungEinwilligungAnswerPayload).validate_python(
        {
            "answer": "given",
            "token": "raw-trainer",
            "birth_date": "1984-05-09",
            "whatsapp": scope == "kontakt_data_whatsapp",
            "media": media,
            "text_versions": text_versions,
        }
    )


def _confirmation(model: type[BaseModel]) -> Callable[..., Any]:
    def validate(*, scope: str, media: bool, text_versions: Any) -> Any:
        return model.model_validate(
            {"token": "raw-link", "birth_date": "1984-05-09", "scope": scope, "media": media, "text_versions": text_versions}
        )

    return validate


# Each payload carrying `text_versions`, beside its kind and the value granting each choice in its vocabulary.
CONFIRMATIONS: Final[list[Any]] = [
    pytest.param(_seat_answer, FLSeatTextVersions, "kontakt_data_whatsapp", id="a seat's answer"),
    pytest.param(_confirmation(FLRegistrierungConfirmationPayload), FLSpielerTextVersions, "kader_public", id="a registration"),
    pytest.param(_confirmation(FLSchiedsrichterConfirmationPayload), FLSchiedsrichterTextVersions, "kader_public", id="a referee"),
]


@pytest.mark.parametrize(("validate", "kind", "giving"), CONFIRMATIONS)
class TestAConfirmationGrantsUnderItsCurrentWording:
    """Each confirmation is a first answer, so every choice it grants moves and names the current label in its payload."""

    @pytest.mark.parametrize("choice", CHOICES)
    def test_a_grant_under_a_replaced_label_is_refused(self, validate: Callable[..., Any], kind: Any, giving: str, choice: str):
        with pytest.raises(ValidationError) as refused:
            validate(scope=giving, media=True, text_versions=_replaced(kind, choice))

        assert [error["type"] for error in refused.value.errors()] == ["grant_wording_stale"]
