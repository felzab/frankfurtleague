"""
API · the address change's pure judgements: the masked address, the link's view, the wait, and the system's read

Apart from a database, so the default tier holds them; the routes that serve and refuse on them are
`tests/api/test_address_change_execution.py`'s.
"""

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel
from pymongo import ASCENDING

from app.api.address_change.schemas import (
    FLAddressChangeViewEnded,
    FLAddressChangeViewNew,
    FLAddressChangeViewPrevious,
)
from app.api.address_change.services import masked_address
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.constraints import SUPPORT_INDEXES
from tests.config import BASE_AUTH
from tests.core.app_source import application


class TestTheMask:
    @pytest.mark.parametrize(
        ("email", "masked"),
        [
            pytest.param("Max.Mustermann@Gmail.de", "m•••@g•••.de", id="folded before it is cut"),
            pytest.param("a@b.de", "a•••@b•••.de", id="a one-letter part shows the letter and its three bullets"),
            pytest.param("x@mail.schule.example.co.uk", "x•••@m•••.uk", id="a subdomain and a two-label suffix show the leftmost and the last"),
            pytest.param("y@xn--mller-kva.de", "y•••@m•••.de", id="an internationalised domain shows its own first letter"),
        ],
    )
    def test_it_shows_the_first_letters_and_the_last_label_and_never_the_length(self, email: str, masked: str):
        assert masked_address(email) == masked


class TestWhatALeakedLinkLearns:
    """`READ-ADRESSWECHSEL-001`: a link is a stranger's to forward, so its page learns little.

    Its side, its state, its way and its days, and the new address only where it asks its question.
    """

    @pytest.mark.parametrize(
        ("model", "fields"),
        [
            pytest.param(FLAddressChangeViewNew, {"side", "state", "valid_until", "effective_from", "way", "email"}, id="new"),
            pytest.param(
                FLAddressChangeViewPrevious, {"side", "state", "valid_until", "effective_from", "way", "email", "released_on"}, id="on file"
            ),
            pytest.param(FLAddressChangeViewEnded, {"side", "state", "kind", "ended_on", "way", "released_on"}, id="ended"),
        ],
    )
    def test_each_view_declares_exactly_its_side_its_state_and_its_instants(self, model: type[BaseModel], fields: set[str]):
        assert set(model.model_fields) == fields


class TestTheSystemsReadOfTheNewAddress:
    """`READ-ADRESSWECHSEL-002`: the address a change would move to, for the frontend's server alone."""

    def test_the_base_key_is_refused_as_the_wrong_credential(self):
        """The links' own key: a browser-facing route holding it would hand any link holder the new mailbox."""

        response = TestClient(application(), raise_server_exceptions=False).post(
            f"/api/v{API_VERSION}/address_change/address", headers=BASE_AUTH, json={"token": "t" * 43}
        )

        assert (response.status_code, response.json()["error_code"]) == (401, Code.ACCESS_KEY_REFUSED)


class TestTheLinksLookups:
    @pytest.mark.parametrize("key", ["token_hashes", "stop.token_hashes"])
    def test_each_hash_a_stranger_drives_is_indexed(self, key: str):
        """Indexed, as a stranger sends the lookup: without one, every link opened scans the collection."""

        keyed = [index for index in SUPPORT_INDEXES if index.collection == Collection.ADDRESS_CHANGES and index.keys == ((key, ASCENDING),)]
        assert len(keyed) == 1
