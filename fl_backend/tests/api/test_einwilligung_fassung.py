import asyncio
import json
from copy import deepcopy

import pytest

from app.api.einwilligung.router import get_fassung, get_seiten
from app.api.einwilligung.services import FASSUNG_UNZULAESSIG, find_fassung_refusal
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.shared.einwilligung import FASSUNGEN, LAUFENDE_FASSUNGEN
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

    def test_a_place_keeps_the_superseded_label_it_already_holds(self):
        """An administrator's save over a seat its person confirmed under an earlier wording keeps that record's own label."""

        assert find_fassung_refusal(seite="bewerbung", genannt={"trainer": FRUEHERE}, gespeichert={"trainer": FRUEHERE}) is None

    def test_a_stored_label_is_kept_only_where_it_is_stored(self):
        """Admitted per place: one seat's stored label is no licence for another seat to stamp it."""

        refusal = find_fassung_refusal(seite="bewerbung", genannt={"ansprechperson": FRUEHERE}, gespeichert={"trainer": FRUEHERE})

        assert refusal is not None
        assert refusal.error_code == FASSUNG_UNZULAESSIG

    @pytest.mark.parametrize("stored", [ANDERE_SEITE, "2026-07"], ids=["another page's label", "a label the registry never held"])
    def test_a_stored_label_naming_no_version_of_the_page_is_not_kept(self, stored: str):
        """A hand-edited record is not carried forward: the label must still name a wording this page showed."""

        refusal = find_fassung_refusal(seite="bewerbung", genannt={"trainer": stored}, gespeichert={"trainer": stored})

        assert refusal is not None
        assert refusal.error_code == FASSUNG_UNZULAESSIG


class TestTheWordsRead:
    def test_every_label_answers_its_own_words(self):
        for label, fassung in FASSUNGEN.items():
            served = asyncio.run(get_fassung(label)).fassung

            assert (served.text_version, served.seite, served.absaetze, served.schalter) == (
                label,
                fassung.seite,
                list(fassung.absaetze),
                fassung.schalter,
            )

    @pytest.mark.parametrize("label", ["2026-07", "", "2026-09"], ids=["an earlier month", "empty", "a prefix of real labels"])
    def test_a_label_the_registry_does_not_hold_answers_nothing(self, label: str):
        """Never the nearest label's words: a record would then claim words its person never read."""

        with pytest.raises(DocumentNotFoundException) as missed:
            asyncio.run(get_fassung(label))

        assert missed.value.error_code == DOCUMENT_NOT_FOUND

    def test_the_slots_are_every_name_the_words_leave_open(self):
        served = asyncio.run(get_fassung("2026-09-bestaetigungsseite-6")).fassung

        assert served.platzhalter == ["ablehnen", "datenschutz", "kontakt", "minAlter", "rolle", "saison", "schule", "vorname"]

    def test_the_pages_read_answers_every_running_label(self):
        assert asyncio.run(get_seiten()).laufende_fassungen == dict(LAUFENDE_FASSUNGEN)


class TestTheCommittedDocument:
    def test_the_committed_document_is_the_one_the_registry_builds(self):
        """The frontend's tests read the words from it: a stale document passes them while the two sides say different things."""

        assert DOCUMENT_PATH.exists(), f"{DOCUMENT_PATH.name} is missing. Create it with:  {REGENERATE}"

        committed = read_document()
        built = build_document()

        assert committed == built, f"{DOCUMENT_PATH.name} has drifted.\n{describe_drift(committed, built)}\n{DRIFT_REPAIR}"

    def test_every_label_is_recorded_as_the_words_read_serves_it(self):
        """The document is what the read answers, so a frontend test parsing one parses the other."""

        recorded = read_document()["fassungen"]

        assert list(recorded) == list(FASSUNGEN)
        for label in FASSUNGEN:
            assert recorded[label] == json.loads(asyncio.run(get_fassung(label)).fassung.model_dump_json()), label

    def test_a_word_changed_in_the_document_alone_is_named_as_drift(self):
        built = build_document()
        edited = deepcopy(built)
        edited["fassungen"]["2026-09-spielerseite-3"]["schalter"] += "!"

        assert edited != built
        assert "fassungen['2026-09-spielerseite-3'].schalter" in describe_drift(edited, built)
