"""
API · the address change's pure judgements: the masked address, the link's view, the wait, and the links' lookups

Apart from a database, so the default tier holds them; the routes that serve and refuse on them are
`tests/api/test_address_change_execution.py`'s.
"""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from pydantic import BaseModel
from pymongo import ASCENDING

from app.api.address_change.schemas import (
    FLAddressChangeViewEnded,
    FLAddressChangeViewNew,
    FLAddressChangeViewPrevious,
)
from app.api.address_change.services import compose_confirmation_update, masked_address
from app.core.collections import Collection
from app.core.constraints import SUPPORT_INDEXES
from app.shared.schemas.bounds import OWNER_WAIT_DAYS


class TestTheMask:
    @pytest.mark.parametrize(
        ("email", "masked"),
        [
            pytest.param("Max.Mustermann@Gmail.de", "m•••@g•••.de", id="folded before it is cut"),
            pytest.param("a@b.de", "a•••@b•••.de", id="a one-letter part shows the letter and its three bullets"),
            pytest.param("x@mail.schule.example.co.uk", "x•••@m•••.uk", id="a subdomain and a two-label suffix show the leftmost and the last"),
        ],
    )
    def test_it_shows_the_first_letters_and_the_last_label_and_never_the_length(self, email: str, masked: str):
        assert masked_address(email) == masked


class TestAWaitCountsHours:
    def test_it_runs_its_whole_length_across_a_clock_change(self):
        """Added to a Berlin value the days would be the wall clock's, and this wait would run an hour long."""

        before_the_clock_falls_back = datetime(2026, 10, 24, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
        wait = timedelta(days=OWNER_WAIT_DAYS)

        update = compose_confirmation_update(wait=wait, now=before_the_clock_falls_back)

        assert update["$set"]["effective_from"] == before_the_clock_falls_back.astimezone(UTC) + wait


class TestWhatALeakedLinkLearns:
    """A link is a stranger's to forward, so its page learns little.

    Its side, its state, its way and its days, and the new address, masked where an administrator started the change.
    """

    @pytest.mark.parametrize(
        ("model", "fields"),
        [
            pytest.param(FLAddressChangeViewNew, {"side", "state", "effective_from", "way", "email", "confirmed_on"}, id="new"),
            pytest.param(FLAddressChangeViewPrevious, {"side", "state", "effective_from", "way", "email", "released_on"}, id="on file"),
            pytest.param(FLAddressChangeViewEnded, {"side", "state", "kind", "ended_on", "way", "released_on", "confirmed_on"}, id="ended"),
        ],
    )
    def test_each_view_declares_exactly_its_side_its_state_and_its_instants(self, model: type[BaseModel], fields: set[str]):
        assert set(model.model_fields) == fields


class TestTheLinksLookups:
    @pytest.mark.parametrize("key", ["token_hashes", "stop.token_hashes"])
    def test_each_hash_a_stranger_drives_is_indexed(self, key: str):
        """Indexed, as a stranger sends the lookup: without one, every link opened scans the collection."""

        keyed = [index for index in SUPPORT_INDEXES if index.collection == Collection.ADDRESS_CHANGES and index.keys == ((key, ASCENDING),)]
        assert len(keyed) == 1
