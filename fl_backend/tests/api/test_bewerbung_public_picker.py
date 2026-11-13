"""BACKEND · the clubs an applying school picks from

`tests/api/test_bewerbung_public_read.py` holds the other half of the form's read -- the application
window and the colours taken, which the rule puts inside its carve-out. A file of its
own because the db tier hands a module whole to one worker, so the two halves are timed beside
each other rather than one behind the other.

One corpus, seeded here through that module's `seed_the_public_corpus`: one league, so a club this
half offers cannot be a club the other half never seeded.
"""

from collections.abc import Iterator

import pytest

from .test_bewerbung_public_read import (
    ADDRESS,
    CLUBS,
    DESCRIPTION,
    OPEN_SAISON,
    PREFIX,
    SCHULFORM,
    answered,
    seed_the_public_corpus,
    website_host,
)


# Module-scoped for the read module's `seeded_url`'s reason.
@pytest.fixture(scope="module")
def seeded_url(mongo_replica_set_url: str) -> Iterator[str]:
    yield from seed_the_public_corpus(mongo_replica_set_url)


pytestmark = pytest.mark.db

FORM = f"{PREFIX}/form/{OPEN_SAISON}"


class TestTheClubList:
    """An anonymous visitor picks from this, so every field is serialised into a public page."""

    def test_only_a_club_id_and_a_name_are_served(self, seeded_url: str):
        response = answered(seeded_url, FORM)

        assert response.status_code == 200
        # Non-vacuous: every live club IS in the body, so what is asserted below is what they carry.
        assert len(response.json()["schulen"]) == len(CLUBS)
        assert all(set(row) == {"id", "name"} for row in response.json()["schulen"])

    def test_no_withheld_value_reaches_the_body_under_any_key(self, seeded_url: str):
        """Searched as VALUES over the undecoded body: a key RENAMED on the way out satisfies the check above and publishes both."""

        rendered = answered(seeded_url, FORM).text

        for withheld in (ADDRESS["street"], ADDRESS["postcode"], website_host(CLUBS[0][0]), SCHULFORM, DESCRIPTION):
            assert withheld not in rendered
