"""BACKEND · the clubs an applying school picks from, and the tier the whole public router is served at

`tests/api/test_bewerbung_public_read.py` holds the other half of the form's read -- the application
window and the colours taken, which the rule puts inside its carve-out. A file of its
own because the db tier hands a module whole to one worker, so the two halves are timed beside
each other rather than one behind the other.

One corpus, seeded here through that module's `seed_the_public_corpus`: one league, so a club this
half offers cannot be a club the other half never seeded.
"""

from collections.abc import Iterator

import pytest

from app.core.codes import Code

from .test_bewerbung_public_read import (
    ADDRESS,
    CLUBS,
    DESCRIPTION,
    OPEN_SAISON,
    PREFIX,
    RETIRED_CLUB,
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
    """`READ-BEWERBUNG-001`: an anonymous visitor picks from this, so every field is serialised into a public page."""

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

    def test_a_retired_club_is_not_offered(self, seeded_url: str):
        """The picker offers what a school may apply AS, and `find_picked_club_refusal` refuses the same set at the write."""

        assert RETIRED_CLUB[0] not in answered(seeded_url, FORM).text


class TestTheTierTheseReadsAreServedAt:
    """Base-tier at a prefix whose other two routers are admin, which is exactly the mix `test_admin_guard.py` exists to catch."""

    def test_no_key_reaches_nothing(self, seeded_url: str):
        """Public here means no SESSION, never no key: the edge reaches this application through the frontend, which holds one."""

        response = answered(seeded_url, FORM, headers={})

        assert response.status_code == 401
        assert response.json()["error_code"] == Code.ACCESS_KEY_REFUSED

    def test_the_admin_list_at_this_prefix_still_refuses_the_base_key(self, seeded_url: str):
        """The control: a base-tier router joining an admin prefix must not have widened the two routers already there."""

        assert answered(seeded_url, f"{PREFIX}/list/admin?saison_id=2027").status_code == 401
