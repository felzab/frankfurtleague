import asyncio
import re
from copy import deepcopy
from http import HTTPStatus
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.einwilligung.router import get_fassung
from app.api.einwilligung.services import FASSUNG_UNZULAESSIG, find_fassung_refusal
from app.core.config import API_VERSION
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.shared.einwilligung import FASSUNGEN, LAUFENDE_FASSUNGEN
from tests.config import BASE_AUTH
from tests.core.app_source import application
from tests.einwilligung_document import DOCUMENT_PATH, DRIFT_REPAIR, REGENERATE, build_document, read_document
from tests.openapi_document import describe_drift

# A label of the application form the running one superseded, and one of another page altogether.
FRUEHERE = "2026-09-bestaetigung-4"
ANDERE_SEITE = "2026-09-bestaetigungsseite-6"


class TestTheLabelAWriteStamps:
    """`REQ-EINWILLIGUNG-001`: a record cites the words its person was shown, so the label it stamps must name them."""

    def test_the_running_label_passes(self):
        """The floor: without it every refusal below would pass on a check refusing everything."""

        assert find_fassung_refusal(seite="bewerbung", genannt={"trainer": LAUFENDE_FASSUNGEN["bewerbung"]}) is None

    @pytest.mark.parametrize(
        "label",
        [
            pytest.param(FRUEHERE, id="a superseded label of the same page"),
            pytest.param(ANDERE_SEITE, id="another page's running label"),
            pytest.param("2026-07", id="a label the registry never held"),
        ],
    )
    def test_a_new_acceptance_naming_any_other_label_is_refused(self, label: str):
        refusal = find_fassung_refusal(seite="bewerbung", genannt={"trainer": LAUFENDE_FASSUNGEN["bewerbung"], "ansprechperson": label})

        assert refusal is not None
        assert refusal.error_code == FASSUNG_UNZULAESSIG
        assert "ansprechperson" in refusal.message
        assert "trainer" not in refusal.message, "a place naming the running label is named as refused"

    @pytest.mark.parametrize(
        "held",
        [
            pytest.param(FRUEHERE, id="a superseded label of the same page"),
            pytest.param(ANDERE_SEITE, id="the confirmation page's label a confirmed seat holds"),
        ],
    )
    def test_an_unchanged_person_keeps_the_label_they_hold(self, held: str):
        """Whichever page it is a version of: a confirmed seat holds its confirmation page's label, and the save carries that record."""

        assert find_fassung_refusal(seite="bewerbung", genannt={"trainer": held}, gehalten={"trainer": held}) is None

    def test_a_held_label_is_kept_only_where_it_is_held(self):
        """Admitted per place: one seat's held label is no licence for another seat, or for a person handed that seat."""

        refusal = find_fassung_refusal(seite="bewerbung", genannt={"ansprechperson": FRUEHERE}, gehalten={"trainer": FRUEHERE})

        assert refusal is not None
        assert refusal.error_code == FASSUNG_UNZULAESSIG

    def test_a_withdrawal_may_name_any_version_of_its_page_and_nothing_else(self):
        """A page loaded before a deploy may still take a consent back; it may not name another page's words."""

        assert find_fassung_refusal(seite="bewerbung", genannt={"trainer": FRUEHERE}, jede_fassung=True) is None
        for label in (ANDERE_SEITE, "2026-07"):
            refusal = find_fassung_refusal(seite="bewerbung", genannt={"trainer": label}, jede_fassung=True)
            assert refusal is not None and refusal.error_code == FASSUNG_UNZULAESSIG, label


def as_registered(label: str) -> dict[str, Any]:
    """One label as the registry holds it, spelled here rather than by `served_fassung`.

    The read and the document share that builder, so a field it dropped would agree with itself in both.
    """

    fassung = FASSUNGEN[label]
    texts = (*fassung.absaetze, fassung.schalter, *fassung.bedienelemente.values())

    return {
        "text_version": label,
        "seite": fassung.seite,
        "gilt_ab": fassung.gilt_ab.isoformat(),
        "absaetze": list(fassung.absaetze),
        "schalter": fassung.schalter,
        "bedienelemente": dict(fassung.bedienelemente),
        "absaetze_nach_schluessel": None if fassung.absaetze_nach_schluessel is None else dict(fassung.absaetze_nach_schluessel),
        "platzhalter": sorted({slot for text in texts for slot in re.findall(r"\{(\w+)\}", text)}),
    }


class TestTheWordsRead:
    @pytest.mark.parametrize("label", ["2026-07", "", "2026-09"], ids=["an earlier month", "empty", "a prefix of real labels"])
    def test_a_label_the_registry_does_not_hold_answers_nothing(self, label: str):
        """Never the nearest label's words: a record would then claim words its person never read."""

        with pytest.raises(DocumentNotFoundException) as missed:
            asyncio.run(get_fassung(label))

        assert missed.value.error_code == DOCUMENT_NOT_FOUND

    def test_the_slots_are_every_name_the_words_leave_open(self):
        served = asyncio.run(get_fassung("2026-09-bestaetigungsseite-6")).fassung

        assert served.platzhalter == ["ablehnen", "datenschutz", "kontakt", "minAlter", "rolle", "saison", "schule", "vorname"]


# Over HTTP, as a caller meets them: the handler cases above skip the response model's
# serialisation and the failure body.
CLIENT = TestClient(application(), raise_server_exceptions=False)
PREFIX = f"/api/v{API_VERSION}/einwilligung"


class TestTheReadsOverHttp:
    """A missing or wrong key is `tests/api/test_dependency_refusals.py`'s, which probes every operation."""

    def test_every_label_is_answered_as_the_registry_holds_it(self):
        for label in FASSUNGEN:
            response = CLIENT.get(f"{PREFIX}/fassungen/{label}", headers=BASE_AUTH)

            assert response.status_code == HTTPStatus.OK, label
            assert response.json() == {"acknowledged": 1, "fassung": as_registered(label)}, label

    def test_a_label_the_registry_does_not_hold_is_the_not_found_body(self):
        response = CLIENT.get(f"{PREFIX}/fassungen/2026-07", headers=BASE_AUTH)

        assert response.status_code == HTTPStatus.NOT_FOUND
        assert response.json()["error_code"] == DOCUMENT_NOT_FOUND
        assert set(response.json()) == {"error_code", "trace_id"}

    def test_the_pages_are_answered_with_their_running_labels(self):
        response = CLIENT.get(f"{PREFIX}/seiten", headers=BASE_AUTH)

        assert response.status_code == HTTPStatus.OK
        assert response.json() == {"acknowledged": 1, "laufende_fassungen": dict(LAUFENDE_FASSUNGEN)}


class TestTheCommittedDocument:
    def test_the_committed_document_is_the_one_the_registry_builds(self):
        """The frontend's tests read the words from it: a stale document passes them while the two sides say different things."""

        assert DOCUMENT_PATH.exists(), f"{DOCUMENT_PATH.name} is missing. Create it with:  {REGENERATE}"

        committed = read_document()
        built = build_document()

        assert committed == built, f"{DOCUMENT_PATH.name} has drifted.\n{describe_drift(committed, built)}\n{DRIFT_REPAIR}"

    def test_a_word_changed_in_the_document_alone_is_named_as_drift(self):
        built = build_document()
        edited = deepcopy(built)
        edited["fassungen"]["2026-09-spielerseite-3"]["schalter"] += "!"

        assert edited != built
        assert "fassungen['2026-09-spielerseite-3'].schalter" in describe_drift(edited, built)
