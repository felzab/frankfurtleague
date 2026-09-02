"""BACKEND · the two reads an applying school picks a club from, and the tier the whole public router is served at

`tests/api/test_bewerbung_public_read.py` holds the other half of that router -- the application
window, and the colour read `docs/backend/spec.md :: I47` puts inside its carve-out -- and declares
the corpus, the request helper and the season vocabulary both halves read. The db tier hands a
module whole to one worker and the two halves together were that tier's longest module by three
times, so they are timed beside each other rather than one behind the other only while each is a
file of its own.

The corpus stays in that module, seeded here through `seed_the_public_corpus`: one league, so a
club this half offers cannot be a club the other half never seeded.
"""

from collections.abc import Iterator

import pytest

from app.api.saisons.cache import invalidate_saison_cache

from .test_bewerbung_public_read import CLUBS, OPEN_SAISON, PREFIX, answered, seed_the_public_corpus

# What `READ-BEWERBUNG-001` keeps off the club list, spelled as a DOCUMENT spells them: the
# assertions below search decoded bodies by key, where a model's field name would not match.
WITHHELD_KEYS = frozenset({"shorthand", "address", "website_url", "full_name", "schulform", "description", "inactive_since", "statistik"})

# The code a request carrying no bearer token at all answers (`app/core/security.py :: get_token`).
MISSING_BEARER_TOKEN = "REQ-AUTH-001"


@pytest.fixture(autouse=True)
def _uncached_saisons() -> None:
    """Process-global and keyed by season id alone, so an entry another test -- or another database -- left would answer here."""

    invalidate_saison_cache()


# Module-scoped: every case below reads this corpus and none writes it, which `unwritten` keeps
# from being left as a claim.
@pytest.fixture(scope="module")
def seeded_url(mongo_url: str) -> Iterator[str]:
    yield from seed_the_public_corpus(mongo_url)


pytestmark = pytest.mark.db


class TestTheClubList:
    """`READ-BEWERBUNG-001`: an anonymous visitor picks from this, so every field is serialised into a public page."""

    def test_only_a_club_id_and_a_name_are_served(self, seeded_url: str):
        response = answered(seeded_url, f"{PREFIX}/schulen")

        assert response.status_code == 200
        # Non-vacuous: every live club IS in the body, so what is asserted below is what they carry.
        assert len(response.json()["schulen"]) == len(CLUBS)
        assert all(set(row) == {"id", "name"} for row in response.json()["schulen"])

    @pytest.mark.parametrize("key", sorted(WITHHELD_KEYS))
    def test_no_withheld_key_reaches_the_body(self, seeded_url: str, key: str):
        assert key not in answered(seeded_url, f"{PREFIX}/schulen").json()["schulen"][0]

    def test_no_withheld_value_reaches_the_body_under_any_key(self, seeded_url: str):
        """Searched as VALUES over the undecoded body: a key RENAMED on the way out satisfies the check above and publishes both."""

        rendered = answered(seeded_url, f"{PREFIX}/schulen").text

        for withheld in ("Hanauer", "60314", "zetteltal.example.de", "gymnasium_g9", "lange Tradition"):
            assert withheld not in rendered

    def test_a_retired_club_is_not_offered(self, seeded_url: str):
        """The picker offers what a school may apply AS, and `find_picked_club_refusal` refuses the same set at the write."""

        assert "Verlassen" not in answered(seeded_url, f"{PREFIX}/schulen").text

    def test_the_list_is_sorted_by_name(self, seeded_url: str):
        """Seeded out of order, so this proves the sort rather than the insertion order."""

        names = [row["name"] for row in answered(seeded_url, f"{PREFIX}/schulen").json()["schulen"]]

        assert names == sorted(names)


class TestTheKuerzelCheck:
    """ONE neutral answer: it names no club, and does not tell an active one from a retired one."""

    @pytest.mark.parametrize(
        ("shorthand", "vergeben"),
        [
            pytest.param("ZE", True, id="a live club's"),
            pytest.param("VE", True, id="a RETIRED club's, which `uniq_shorthand` still holds"),
            pytest.param("QQ", False, id="one nobody holds"),
        ],
    )
    def test_a_taken_kuerzel_answers_taken(self, seeded_url: str, shorthand: str, vergeben: bool):
        response = answered(seeded_url, f"{PREFIX}/kuerzel/{shorthand}")

        assert response.status_code == 200
        assert response.json()["vergeben"] is vergeben

    def test_the_answer_names_no_club(self, seeded_url: str):
        """A shape distinguishing a retired holder from a live one would publish which schools have left."""

        body = answered(seeded_url, f"{PREFIX}/kuerzel/VE").json()

        assert set(body) == {"acknowledged", "shorthand", "vergeben"}
        assert "Verlassen" not in answered(seeded_url, f"{PREFIX}/kuerzel/VE").text


class TestTheTierTheseReadsAreServedAt:
    """Base-tier at a prefix whose other two routers are admin, which is exactly the mix `test_admin_guard.py` exists to catch.

    It walks the window paths too, being one router's tier rather than one endpoint's.
    """

    @pytest.mark.parametrize(
        "path",
        [
            f"{PREFIX}/fenster",
            f"{PREFIX}/fenster/{OPEN_SAISON}",
            f"{PREFIX}/schulen",
            f"{PREFIX}/kuerzel/ZE",
            f"{PREFIX}/trikotfarben/{OPEN_SAISON}",
        ],
    )
    def test_the_base_key_reaches_every_one(self, seeded_url: str, path: str):
        assert answered(seeded_url, path).status_code == 200

    @pytest.mark.parametrize(
        "path",
        [
            f"{PREFIX}/fenster",
            f"{PREFIX}/fenster/{OPEN_SAISON}",
            f"{PREFIX}/schulen",
            f"{PREFIX}/kuerzel/ZE",
            f"{PREFIX}/trikotfarben/{OPEN_SAISON}",
        ],
    )
    def test_no_key_reaches_none_of_them(self, seeded_url: str, path: str):
        """Public here means no SESSION, never no key: the edge reaches this application through the frontend, which holds one."""

        response = answered(seeded_url, path, headers={})

        assert response.status_code == 401
        assert response.json()["error_code"] == MISSING_BEARER_TOKEN

    def test_the_admin_list_at_this_prefix_still_refuses_the_base_key(self, seeded_url: str):
        """The control: a base-tier router joining an admin prefix must not have widened the two routers already there."""

        assert answered(seeded_url, PREFIX).status_code == 401
