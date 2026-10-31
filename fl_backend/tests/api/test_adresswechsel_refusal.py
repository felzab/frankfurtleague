"""
API · the address change's pure judgements: the masked address, the link's view, who may not approve a change, and the system's read

Apart from a database, so the default tier holds them; the routes that serve and refuse on them are
`tests/api/test_adresswechsel_execution.py`'s.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient
from pydantic import BaseModel, ValidationError
from pymongo import ASCENDING

from app.api.adresswechsel.schemas import (
    FLAddressChangeAdressePayload,
    FLAddressChangeAdresseResponse,
    FLAddressChangeAntwortPayload,
    FLAddressChangeViewEnded,
    FLAddressChangeViewNew,
    FLAddressChangeViewPrevious,
)
from app.api.adresswechsel.services import ist_abgelaufen, maskierte_adresse, neu_zustand
from app.api.berechtigungen.services import genehmigung_steht, genehmigung_verwehrt
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.constraints import SUPPORT_INDEXES, UNIQUE_INDEXES
from app.core.recording import ERASED_ACTOR_MARKER
from app.shared.folding import canonical_address
from app.shared.schemas.responses import BaseAPIResponse
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
        assert maskierte_adresse(email) == masked

    @pytest.mark.parametrize(
        ("email", "masked"),
        [
            pytest.param("x@Mailbox.invalid", "x•••@m•••.invalid", id="a special-use domain"),
            pytest.param("x@localhost", "x•••@l•••", id="a dotless domain"),
            pytest.param("x@xn--zz-garbage.de", "x•••@x•••.de", id="a label no punycode decodes, shown as stored"),
        ],
    )
    def test_a_stored_address_the_rule_came_to_refuse_still_masks(self, email: str, masked: str):
        """The account page masks what is stored, and a stored value the rule refuses would answer it a 500."""

        with pytest.raises(ValueError):
            canonical_address(email)
        assert maskierte_adresse(email) == masked

    def test_two_addresses_differing_past_their_first_letters_mask_alike(self):
        """The mask hands nothing over: a reader cannot tell which of two such mailboxes the change goes to."""

        assert maskierte_adresse("anna.lang@gmx.de") == maskierte_adresse("ab@gx.de")


class TestWhatALeakedLinkLearns:
    """`READ-ADRESSWECHSEL-001`: a link is a stranger's to forward, so its page learns its side, its state and its instants."""

    @pytest.mark.parametrize(
        ("model", "fields"),
        [
            pytest.param(FLAddressChangeViewNew, {"seite", "state", "valid_until", "effective_from", "way", "approval_open"}, id="new"),
            pytest.param(FLAddressChangeViewPrevious, {"seite", "state", "valid_until", "effective_from", "way"}, id="on file"),
            pytest.param(FLAddressChangeViewEnded, {"seite", "state", "art"}, id="ended"),
        ],
    )
    def test_each_view_declares_exactly_its_side_its_state_and_its_instants(self, model: type[BaseModel], fields: set[str]):
        assert set(model.model_fields) == fields

    def test_the_press_names_its_answer_and_nothing_else(self):
        """Defaulted, the model would answer for the person whether a mailbox is theirs."""

        with pytest.raises(ValidationError):
            FLAddressChangeAntwortPayload.model_validate({"token": "t" * 43})
        with pytest.raises(ValidationError):
            FLAddressChangeAntwortPayload.model_validate({"token": "t" * 43, "antwort": "confirmed", "email": "x@example.org"})


class TestTheSystemsReadOfTheNewAddress:
    """`READ-ADRESSWECHSEL-002`: the address a change would move to, for the frontend's server alone."""

    def test_it_answers_the_address_and_nothing_else(self):
        assert set(FLAddressChangeAdresseResponse.model_fields) - set(BaseAPIResponse.model_fields) == {"email"}

    @pytest.mark.parametrize(
        "key",
        [pytest.param({}, id="neither"), pytest.param({"token": "t" * 43, "address_change_id": "6890a1b2c3d4e5f607850001"}, id="both")],
    )
    def test_it_names_exactly_one_key(self, key: dict[str, str]):
        with pytest.raises(ValidationError):
            FLAddressChangeAdressePayload.model_validate(key)

    def test_the_base_key_is_refused_as_the_wrong_credential(self):
        """The links' own key: a browser-facing route holding it would hand any link holder the new mailbox."""

        response = TestClient(application(), raise_server_exceptions=False).post(
            f"/api/v{API_VERSION}/address_change/adresse", headers=BASE_AUTH, json={"token": "t" * 43}
        )

        assert (response.status_code, response.json()["error_code"]) == (401, Code.ACCESS_KEY_REFUSED)


NOW = datetime(2026, 4, 1, 10, 0, tzinfo=UTC)


def a_live_change(*, lapsed: bool, confirmed: bool = False) -> dict[str, Any]:
    """`lapsed`: its link's deadline passed, or, once confirmed, which drops that deadline, its grant's approval week."""

    if confirmed:
        bis = NOW - timedelta(minutes=1) if lapsed else NOW + timedelta(days=1)
        return {"valid_until": None, "confirmed_at": NOW - timedelta(days=1), "approval": {"bis": bis, "approved_at": None}}

    return {"valid_until": NOW - timedelta(minutes=1) if lapsed else NOW + timedelta(hours=1), "confirmed_at": None, "approval": None}


class TestTheNewMailboxsState:
    """In the order the confirmation judges, so a refused press names what a reload of its page shows."""

    @pytest.mark.parametrize(
        ("record", "barred", "nicht_bestaetigbar", "state"),
        [
            pytest.param(a_live_change(lapsed=True), True, False, "barred", id="a ban ranks ahead of the deadline"),
            pytest.param(a_live_change(lapsed=True), False, True, "expired", id="every unconfirmable cause reads alike behind it"),
            pytest.param(a_live_change(lapsed=False), False, True, "not_confirmable", id="an unconfirmable cause inside it"),
            pytest.param(a_live_change(lapsed=False, confirmed=True), True, True, "confirmed", id="a confirmed change waits on no link"),
            pytest.param(
                a_live_change(lapsed=True, confirmed=True),
                True,
                True,
                "approval_expired",
                id="a confirmed change's lapsed approval week ranks first, apart from a lapsed link",
            ),
        ],
    )
    def test_the_view_ranks_the_states_as_the_press_refuses(self, record: dict[str, Any], barred: bool, nicht_bestaetigbar: bool, state: str):
        assert neu_zustand(record, now=NOW, barred=barred, nicht_bestaetigbar=nicht_bestaetigbar) == state

    def test_the_deadline_s_own_instant_is_past(self):
        assert ist_abgelaufen({"valid_until": NOW, "approval": None}, now=NOW)


class TestTheLinksLookups:
    @pytest.mark.parametrize("key", ["token_hashes", "stop.token_hashes"])
    def test_each_hash_a_stranger_drives_is_indexed_and_never_unique(self, key: str):
        """Indexed, as a stranger sends the lookup; never unique, as a kept record holds its hashes beside a live one's."""

        keyed = [index for index in SUPPORT_INDEXES if index.collection == Collection.ADDRESS_CHANGES and index.keys == ((key, ASCENDING),)]
        assert len(keyed) == 1
        assert not [index for index in UNIQUE_INDEXES if index.collection == Collection.ADDRESS_CHANGES and key in index.keys]


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
CARRIED_ADMINISTRATION = {"berechtigt_seit": BEFORE, "inhaber_seit": None}
CARRIED_OWNER = {"berechtigt_seit": BEFORE, "inhaber_seit": BEFORE}


def a_grant(
    adresse: str,
    verwaltung: str,
    *,
    at: datetime = BEFORE,
    appointed_at: datetime | None = None,
    fortgefuehrt: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """A grant pasted at `at`, which no reconciliation has seen: its date is its own and its id's."""

    return {
        "_id": ObjectId.from_datetime(at),
        "adresse": adresse,
        "verwaltung": verwaltung,
        "granted_by": OWNER,
        "granted_at": at,
        **({} if appointed_at is None else {"appointed_at": appointed_at}),
        **({} if fortgefuehrt is None else {"fortgefuehrt": fortgefuehrt}),
    }


GRANTS = [
    a_grant(ADMIN, "administration"),
    a_grant(OWNER, "owner"),
    a_grant(SECOND_OWNER, "owner"),
    a_grant(LATE, "administration", at=AFTER),
    a_grant(PROMOTED, "owner", appointed_at=AFTER),
    a_grant(MOVED, "administration", at=AFTER, fortgefuehrt=CARRIED_ADMINISTRATION),
    a_grant(MOVED_OWNER, "owner", at=AFTER, fortgefuehrt=CARRIED_OWNER),
    a_grant(MOVED_DEMOTED, "administration", at=AFTER, fortgefuehrt=CARRIED_OWNER),
    a_grant(MOVED_REPROMOTED, "owner", at=AFTER, appointed_at=AFTER, fortgefuehrt=CARRIED_OWNER),
]


def a_change(*, started_by: str, verwaltung: str = "administration", approved_by: str | None = None) -> dict[str, Any]:
    return {
        "verwaltung": verwaltung,
        "asked_at": NOW,
        "bis": NOW + timedelta(days=7),
        "started_by": started_by,
        "approved_at": None if approved_by is None else NOW,
        "approved_by": approved_by,
    }


class TestWhoMayNotApprove:
    @pytest.mark.parametrize(
        ("approval", "akteur", "inhaber", "denied"),
        [
            pytest.param(a_change(started_by=CHANGED), CHANGED, True, "own", id="the changed address, an owner or not"),
            pytest.param(a_change(started_by=OWNER), OWNER, True, "started", id="the administrator who started it"),
            pytest.param(a_change(started_by=OWNER, verwaltung="owner"), ADMIN, False, "owner", id="an owner's grant, no owner's power"),
            pytest.param(a_change(started_by=OWNER, verwaltung="owner"), SECOND_OWNER, True, None, id="an owner's grant, another owner"),
            pytest.param(a_change(started_by=CHANGED), ADMIN, False, None, id="the person's own start, another administrator"),
            pytest.param(a_change(started_by=CHANGED), LATE, False, "younger", id="an administrator granted after the request"),
            pytest.param(a_change(started_by=OWNER, verwaltung="owner"), PROMOTED, True, "younger", id="an owner promoted after the request"),
            pytest.param(a_change(started_by=CHANGED), MOVED, False, None, id="an administrator whose own address changed since"),
            pytest.param(
                a_change(started_by=OWNER, verwaltung="owner"), MOVED_OWNER, True, None, id="an owner whose own address changed since"
            ),
            pytest.param(
                a_change(started_by=OWNER, verwaltung="owner"),
                MOVED_REPROMOTED,
                True,
                "younger",
                id="an owner moved, then demoted and promoted again since",
            ),
        ],
    )
    def test_four_eyes_the_owner_s_tier_and_a_grant_older_than_the_request(
        self, approval: dict[str, Any], akteur: str, inhaber: bool, denied: str | None
    ):
        assert genehmigung_verwehrt(betroffen=CHANGED, approval=approval, akteur=akteur, inhaber=inhaber, grants=GRANTS, announced=[]) == denied


class TestWhetherAnApprovalStillStands:
    """Judged where the change takes effect, so an approval never outlives the grant, the tier or the standing that gave it."""

    @pytest.mark.parametrize(
        ("approval", "grants", "barred", "stands"),
        [
            pytest.param(a_change(started_by=CHANGED, approved_by=ADMIN), GRANTS, set(), True, id="its approver as they were"),
            pytest.param(a_change(started_by=CHANGED, approved_by=ADMIN), GRANTS[1:], set(), False, id="its approver's grant revoked since"),
            pytest.param(a_change(started_by=CHANGED, approved_by=ADMIN), GRANTS, {ADMIN}, False, id="its approver barred since"),
            pytest.param(
                a_change(started_by=OWNER, verwaltung="owner", approved_by=SECOND_OWNER),
                [*GRANTS[:2], {**GRANTS[2], "verwaltung": "administration"}, *GRANTS[3:]],
                set(),
                False,
                id="an owner's change, its approver demoted since",
            ),
            pytest.param(a_change(started_by=CHANGED, approved_by=ERASED_ACTOR_MARKER), GRANTS, set(), False, id="its approver erased since"),
            # The effect of their own change carried `approved_by` to the row it granted afresh.
            pytest.param(a_change(started_by=CHANGED, approved_by=MOVED), GRANTS, set(), True, id="its approver's own address changed since"),
            pytest.param(
                a_change(started_by=OWNER, verwaltung="owner", approved_by=MOVED_OWNER),
                GRANTS,
                set(),
                True,
                id="an owner's change, its approver's own address changed since",
            ),
            pytest.param(
                a_change(started_by=OWNER, verwaltung="owner", approved_by=MOVED_DEMOTED),
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
        assert genehmigung_steht(betroffen=CHANGED, approval=approval, grants=grants, announced=[], barred=barred) is stands
