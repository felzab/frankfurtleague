from typing import Any

import pytest

from app.api.registrierungen.services import compose_person, compose_person_update, link_is_over
from tests.documents import SPIELER_TEXT_VERSIONS, own_einwilligung_document

TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"


class TestTheLinksLastDay:
    @pytest.mark.parametrize(
        ("deadline", "over"), [pytest.param(TODAY, False, id="the day the mail names"), pytest.param(YESTERDAY, True, id="the day after")]
    )
    def test_the_link_answers_through_the_day_the_mail_names(self, deadline: str, over: bool):
        """A link dying at the midnight before that day locks a pupil out on the day they were told they had."""

        assert link_is_over(confirmation={"deadline": deadline}, status="submitted", departed=False, today=TODAY) is over


class TestAPersonIsNeverWrittenNameless:
    """The `spieler` record model is applied by the read-back alone, so these guards are the last ones a write meets."""

    NEW = {
        "first_name": "Quillhilde",
        "last_name": "Brackenmoor",
        "birth_date": "2009-05-09",
        "einwilligung": own_einwilligung_document(text_versions=SPIELER_TEXT_VERSIONS, confirmed_at=TODAY, scope="internal"),
    }

    # Whitespace among them: `person_name_key` folds it to the empty key a null name also folds to.
    @pytest.mark.parametrize("first_name", [None, "", "   "], ids=("null", "empty", "whitespace"))
    def test_neither_composer_writes_a_person_with_no_forename(self, first_name: Any):
        nameless = {**self.NEW, "first_name": first_name}

        with pytest.raises(ValueError, match="no forename"):
            compose_person(spieler_id="a-new-id", registrierung_raw=nameless, address="quillhilde@example.com")
        with pytest.raises(ValueError, match="no forename"):
            compose_person_update(registrierung_raw=nameless, saved=self.NEW["einwilligung"], address="quillhilde@example.com")

    def test_a_matched_person_holding_no_record_is_not_admitted_into(self):
        with pytest.raises(ValueError, match="no consent record"):
            compose_person_update(registrierung_raw=self.NEW, saved=None, address="quillhilde@example.com")
