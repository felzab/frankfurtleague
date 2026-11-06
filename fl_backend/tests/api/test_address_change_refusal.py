"""
API · the address change's pure judgements: the masked address, the link's view, who may not approve a change, and the system's read

Apart from a database, so the default tier holds them; the routes that serve and refuse on them are
`tests/api/test_address_change_execution.py`'s.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient
from pydantic import BaseModel
from pymongo import ASCENDING

from app.api.address_change.schemas import (
    FLAddressChangeViewEnded,
    FLAddressChangeViewNew,
    FLAddressChangeViewPrevious,
)
from app.api.address_change.services import masked_address
from app.api.berechtigungen.services import approval_denied, approval_stands
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.constraints import SUPPORT_INDEXES
from app.core.recording import ERASED_ACTOR_MARKER
from tests.config import BASE_AUTH
from tests.core.app_source import application

ADMIN = "verwaltung@frankfurtleague.de"
OWNER = "inhaberin@frankfurtleague.de"
CHANGED = "person@beispielschule.de"


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
            pytest.param(FLAddressChangeViewNew, {"side", "state", "valid_until", "effective_from", "way", "approval_open", "email"}, id="new"),
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


NOW = datetime(2026, 4, 1, 10, 0, tzinfo=UTC)


class TestTheLinksLookups:
    @pytest.mark.parametrize("key", ["token_hashes", "stop.token_hashes"])
    def test_each_hash_a_stranger_drives_is_indexed(self, key: str):
        """Indexed, as a stranger sends the lookup: without one, every link opened scans the collection."""

        keyed = [index for index in SUPPORT_INDEXES if index.collection == Collection.ADDRESS_CHANGES and index.keys == ((key, ASCENDING),)]
        assert len(keyed) == 1


# Each grant in effect since a day before the request, but `LATE`'s, granted after it, and `PROMOTED`'s owner tier, made after it.
SECOND_OWNER = "zweite.inhaberin@frankfurtleague.de"
LATE = "spaet@frankfurtleague.de"
PROMOTED = "befoerdert@frankfurtleague.de"
# Moved by their own address change after the request, each row granted afresh then; the second owner demoted since, the
# third demoted and promoted again since.
MOVED = "verwaltung.neu@frankfurtleague.de"
MOVED_OWNER = "inhaberin.neu@frankfurtleague.de"
MOVED_DEMOTED = "zurueckgestuft@frankfurtleague.de"
MOVED_REPROMOTED = "wieder.befoerdert@frankfurtleague.de"
BEFORE, AFTER = NOW - timedelta(days=1), NOW + timedelta(hours=1)
CARRIED_ADMINISTRATION = {"granted_since": BEFORE, "owner_since": None}
CARRIED_OWNER = {"granted_since": BEFORE, "owner_since": BEFORE}


def a_grant(
    address: str,
    admin_tier: str,
    *,
    at: datetime = BEFORE,
    appointed_at: datetime | None = None,
    carried: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """A grant pasted at `at`, which no reconciliation has seen: its date is its own and its id's."""

    return {
        "_id": ObjectId.from_datetime(at),
        "address": address,
        "admin_tier": admin_tier,
        "granted_by": OWNER,
        "granted_at": at,
        **({} if appointed_at is None else {"appointed_at": appointed_at}),
        **({} if carried is None else {"carried": carried}),
    }


GRANTS = [
    a_grant(ADMIN, "administration"),
    a_grant(OWNER, "owner"),
    a_grant(SECOND_OWNER, "owner"),
    a_grant(LATE, "administration", at=AFTER),
    a_grant(PROMOTED, "owner", appointed_at=AFTER),
    a_grant(MOVED, "administration", at=AFTER, carried=CARRIED_ADMINISTRATION),
    a_grant(MOVED_OWNER, "owner", at=AFTER, carried=CARRIED_OWNER),
    a_grant(MOVED_DEMOTED, "administration", at=AFTER, carried=CARRIED_OWNER),
    a_grant(MOVED_REPROMOTED, "owner", at=AFTER, appointed_at=AFTER, carried=CARRIED_OWNER),
]


def a_change(*, started_by: str, admin_tier: str = "administration", approved_by: str | None = None) -> dict[str, Any]:
    return {
        "admin_tier": admin_tier,
        "asked_at": NOW,
        "until": NOW + timedelta(days=7),
        "started_by": started_by,
        "approved_at": None if approved_by is None else NOW,
        "approved_by": approved_by,
    }


class TestWhoMayNotApprove:
    @pytest.mark.parametrize(
        ("approval", "actor", "owner", "denied"),
        [
            pytest.param(a_change(started_by=CHANGED), CHANGED, True, "own", id="the changed address, an owner or not"),
            pytest.param(a_change(started_by=OWNER), OWNER, True, "started", id="the administrator who started it"),
            pytest.param(a_change(started_by=OWNER, admin_tier="owner"), ADMIN, False, "owner", id="an owner's grant, no owner's power"),
            pytest.param(a_change(started_by=OWNER, admin_tier="owner"), SECOND_OWNER, True, None, id="an owner's grant, another owner"),
            pytest.param(a_change(started_by=CHANGED), ADMIN, False, None, id="the person's own start, another administrator"),
            pytest.param(a_change(started_by=CHANGED), LATE, False, "younger", id="an administrator granted after the request"),
            pytest.param(a_change(started_by=OWNER, admin_tier="owner"), PROMOTED, True, "younger", id="an owner promoted after the request"),
            pytest.param(a_change(started_by=CHANGED), MOVED, False, None, id="an administrator whose own address changed since"),
            pytest.param(
                a_change(started_by=OWNER, admin_tier="owner"), MOVED_OWNER, True, None, id="an owner whose own address changed since"
            ),
            pytest.param(
                a_change(started_by=OWNER, admin_tier="owner"),
                MOVED_REPROMOTED,
                True,
                "younger",
                id="an owner moved, then demoted and promoted again since",
            ),
        ],
    )
    def test_four_eyes_the_owner_s_tier_and_a_grant_older_than_the_request(
        self, approval: dict[str, Any], actor: str, owner: bool, denied: str | None
    ):
        assert approval_denied(target=CHANGED, approval=approval, actor=actor, owner=owner, grants=GRANTS, announced=[]) == denied


class TestWhetherAnApprovalStillStands:
    """Judged where the change takes effect, so an approval never outlives the grant, the tier or the standing that gave it."""

    @pytest.mark.parametrize(
        ("approval", "grants", "barred", "stands"),
        [
            pytest.param(a_change(started_by=CHANGED, approved_by=ADMIN), GRANTS, set(), True, id="its approver as they were"),
            pytest.param(a_change(started_by=CHANGED, approved_by=ADMIN), GRANTS[1:], set(), False, id="its approver's grant revoked since"),
            pytest.param(a_change(started_by=CHANGED, approved_by=ADMIN), GRANTS, {ADMIN}, False, id="its approver barred since"),
            pytest.param(
                a_change(started_by=OWNER, admin_tier="owner", approved_by=SECOND_OWNER),
                [*GRANTS[:2], {**GRANTS[2], "admin_tier": "administration"}, *GRANTS[3:]],
                set(),
                False,
                id="an owner's change, its approver demoted since",
            ),
            pytest.param(a_change(started_by=CHANGED, approved_by=ERASED_ACTOR_MARKER), GRANTS, set(), False, id="its approver erased since"),
            # The effect of their own change carried `approved_by` to the row it granted afresh.
            pytest.param(a_change(started_by=CHANGED, approved_by=MOVED), GRANTS, set(), True, id="its approver's own address changed since"),
            pytest.param(
                a_change(started_by=OWNER, admin_tier="owner", approved_by=MOVED_OWNER),
                GRANTS,
                set(),
                True,
                id="an owner's change, its approver's own address changed since",
            ),
            pytest.param(
                a_change(started_by=OWNER, admin_tier="owner", approved_by=MOVED_DEMOTED),
                GRANTS,
                set(),
                False,
                id="an owner's change, its approver moved and demoted since",
            ),
        ],
    )
    def test_it_stands_only_while_its_approver_may_approve_it(
        self, approval: dict[str, Any], grants: list[dict[str, Any]], barred: set[str], stands: bool
    ):
        assert approval_stands(target=CHANGED, approval=approval, grants=grants, announced=[], barred=barred) is stands
