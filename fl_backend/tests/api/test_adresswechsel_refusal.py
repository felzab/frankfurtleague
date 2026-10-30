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
    FLAdresswechselAdressePayload,
    FLAdresswechselAdresseResponse,
    FLAdresswechselAnsichtBeendet,
    FLAdresswechselAnsichtBisherig,
    FLAdresswechselAnsichtNeu,
    FLAdresswechselAntwortPayload,
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
            pytest.param(FLAdresswechselAnsichtNeu, {"seite", "zustand", "gueltig_bis", "wirksam_ab", "weg", "genehmigung_offen"}, id="new"),
            pytest.param(FLAdresswechselAnsichtBisherig, {"seite", "zustand", "gueltig_bis", "wirksam_ab", "weg"}, id="on file"),
            pytest.param(FLAdresswechselAnsichtBeendet, {"seite", "zustand", "art"}, id="ended"),
        ],
    )
    def test_each_view_declares_exactly_its_side_its_state_and_its_instants(self, model: type[BaseModel], fields: set[str]):
        assert set(model.model_fields) == fields

    def test_the_press_names_its_answer_and_nothing_else(self):
        """Defaulted, the model would answer for the person whether a mailbox is theirs."""

        with pytest.raises(ValidationError):
            FLAdresswechselAntwortPayload.model_validate({"token": "t" * 43})
        with pytest.raises(ValidationError):
            FLAdresswechselAntwortPayload.model_validate({"token": "t" * 43, "antwort": "bestaetigt", "email": "x@example.org"})


class TestTheSystemsReadOfTheNewAddress:
    """`READ-ADRESSWECHSEL-002`: the address a change would move to, for the frontend's server alone."""

    def test_it_answers_the_address_and_nothing_else(self):
        assert set(FLAdresswechselAdresseResponse.model_fields) - set(BaseAPIResponse.model_fields) == {"email"}

    @pytest.mark.parametrize(
        "key",
        [pytest.param({}, id="neither"), pytest.param({"token": "t" * 43, "adresswechsel_id": "6890a1b2c3d4e5f607850001"}, id="both")],
    )
    def test_it_names_exactly_one_key(self, key: dict[str, str]):
        with pytest.raises(ValidationError):
            FLAdresswechselAdressePayload.model_validate(key)

    def test_the_base_key_is_refused_as_the_wrong_credential(self):
        """The links' own key: a browser-facing route holding it would hand any link holder the new mailbox."""

        response = TestClient(application(), raise_server_exceptions=False).post(
            f"/api/v{API_VERSION}/adresswechsel/sweep/adresse", headers=BASE_AUTH, json={"token": "t" * 43}
        )

        assert (response.status_code, response.json()["error_code"]) == (401, Code.WRONG_SYSTEM_KEY)


NOW = datetime(2026, 4, 1, 10, 0, tzinfo=UTC)


def a_live_change(*, lapsed: bool, bestaetigt: bool = False) -> dict[str, Any]:
    """`lapsed`: its link's deadline passed, or, once confirmed, which drops that deadline, its grant's approval week."""

    if bestaetigt:
        bis = NOW - timedelta(minutes=1) if lapsed else NOW + timedelta(days=1)
        return {"gueltig_bis": None, "bestaetigt_am": NOW - timedelta(days=1), "genehmigung": {"bis": bis, "genehmigt_am": None}}

    return {"gueltig_bis": NOW - timedelta(minutes=1) if lapsed else NOW + timedelta(hours=1), "bestaetigt_am": None, "genehmigung": None}


class TestTheNewMailboxsState:
    """In the order the confirmation judges, so a refused press names what a reload of its page shows."""

    @pytest.mark.parametrize(
        ("record", "gesperrt", "nicht_bestaetigbar", "zustand"),
        [
            pytest.param(a_live_change(lapsed=True), True, False, "gesperrt", id="a ban ranks ahead of the deadline"),
            pytest.param(a_live_change(lapsed=True), False, True, "abgelaufen", id="every unconfirmable cause reads alike behind it"),
            pytest.param(a_live_change(lapsed=False), False, True, "nicht_bestaetigbar", id="an unconfirmable cause inside it"),
            pytest.param(a_live_change(lapsed=False, bestaetigt=True), True, True, "bestaetigt", id="a confirmed change waits on no link"),
            pytest.param(
                a_live_change(lapsed=True, bestaetigt=True),
                True,
                True,
                "genehmigung_abgelaufen",
                id="a confirmed change's lapsed approval week ranks first, apart from a lapsed link",
            ),
        ],
    )
    def test_the_view_ranks_the_states_as_the_press_refuses(
        self, record: dict[str, Any], gesperrt: bool, nicht_bestaetigbar: bool, zustand: str
    ):
        assert neu_zustand(record, now=NOW, gesperrt=gesperrt, nicht_bestaetigbar=nicht_bestaetigbar) == zustand

    def test_the_deadline_s_own_instant_is_past(self):
        assert ist_abgelaufen({"gueltig_bis": NOW, "genehmigung": None}, now=NOW)


class TestTheLinksLookups:
    @pytest.mark.parametrize("key", ["token_hashes", "stopp.token_hashes"])
    def test_each_hash_a_stranger_drives_is_indexed_and_never_unique(self, key: str):
        """Indexed, as a stranger sends the lookup; never unique, as a kept record holds its hashes beside a live one's."""

        keyed = [index for index in SUPPORT_INDEXES if index.collection == Collection.ADRESSWECHSEL and index.keys == ((key, ASCENDING),)]
        assert len(keyed) == 1
        assert not [index for index in UNIQUE_INDEXES if index.collection == Collection.ADRESSWECHSEL and key in index.keys]


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
    ernannt_am: datetime | None = None,
    fortgefuehrt: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """A grant pasted at `at`, which no reconciliation has seen: its date is its own and its id's."""

    return {
        "_id": ObjectId.from_datetime(at),
        "adresse": adresse,
        "verwaltung": verwaltung,
        "erteilt_von": OWNER,
        "erteilt_am": at,
        **({} if ernannt_am is None else {"ernannt_am": ernannt_am}),
        **({} if fortgefuehrt is None else {"fortgefuehrt": fortgefuehrt}),
    }


GRANTS = [
    a_grant(ADMIN, "administration"),
    a_grant(OWNER, "owner"),
    a_grant(SECOND_OWNER, "owner"),
    a_grant(LATE, "administration", at=AFTER),
    a_grant(PROMOTED, "owner", ernannt_am=AFTER),
    a_grant(MOVED, "administration", at=AFTER, fortgefuehrt=CARRIED_ADMINISTRATION),
    a_grant(MOVED_OWNER, "owner", at=AFTER, fortgefuehrt=CARRIED_OWNER),
    a_grant(MOVED_DEMOTED, "administration", at=AFTER, fortgefuehrt=CARRIED_OWNER),
    a_grant(MOVED_REPROMOTED, "owner", at=AFTER, ernannt_am=AFTER, fortgefuehrt=CARRIED_OWNER),
]


def a_change(*, gestartet_von: str, verwaltung: str = "administration", genehmigt_von: str | None = None) -> dict[str, Any]:
    return {
        "verwaltung": verwaltung,
        "angefragt_am": NOW,
        "bis": NOW + timedelta(days=7),
        "gestartet_von": gestartet_von,
        "genehmigt_am": None if genehmigt_von is None else NOW,
        "genehmigt_von": genehmigt_von,
    }


class TestWhoMayNotApprove:
    @pytest.mark.parametrize(
        ("genehmigung", "akteur", "inhaber", "verwehrt"),
        [
            pytest.param(a_change(gestartet_von=CHANGED), CHANGED, True, "eigene", id="the changed address, an owner or not"),
            pytest.param(a_change(gestartet_von=OWNER), OWNER, True, "gestartet", id="the administrator who started it"),
            pytest.param(a_change(gestartet_von=OWNER, verwaltung="owner"), ADMIN, False, "inhaber", id="an owner's grant, no owner's power"),
            pytest.param(a_change(gestartet_von=OWNER, verwaltung="owner"), SECOND_OWNER, True, None, id="an owner's grant, another owner"),
            pytest.param(a_change(gestartet_von=CHANGED), ADMIN, False, None, id="the person's own start, another administrator"),
            pytest.param(a_change(gestartet_von=CHANGED), LATE, False, "juenger", id="an administrator granted after the request"),
            pytest.param(
                a_change(gestartet_von=OWNER, verwaltung="owner"), PROMOTED, True, "juenger", id="an owner promoted after the request"
            ),
            pytest.param(a_change(gestartet_von=CHANGED), MOVED, False, None, id="an administrator whose own address changed since"),
            pytest.param(
                a_change(gestartet_von=OWNER, verwaltung="owner"), MOVED_OWNER, True, None, id="an owner whose own address changed since"
            ),
            pytest.param(
                a_change(gestartet_von=OWNER, verwaltung="owner"),
                MOVED_REPROMOTED,
                True,
                "juenger",
                id="an owner moved, then demoted and promoted again since",
            ),
        ],
    )
    def test_four_eyes_the_owner_s_tier_and_a_grant_older_than_the_request(
        self, genehmigung: dict[str, Any], akteur: str, inhaber: bool, verwehrt: str | None
    ):
        assert (
            genehmigung_verwehrt(betroffen=CHANGED, genehmigung=genehmigung, akteur=akteur, inhaber=inhaber, grants=GRANTS, announced=[])
            == verwehrt
        )


class TestWhetherAnApprovalStillStands:
    """Judged where the change takes effect, so an approval never outlives the grant, the tier or the standing that gave it."""

    @pytest.mark.parametrize(
        ("genehmigung", "grants", "gesperrt", "steht"),
        [
            pytest.param(a_change(gestartet_von=CHANGED, genehmigt_von=ADMIN), GRANTS, set(), True, id="its approver as they were"),
            pytest.param(
                a_change(gestartet_von=CHANGED, genehmigt_von=ADMIN), GRANTS[1:], set(), False, id="its approver's grant revoked since"
            ),
            pytest.param(a_change(gestartet_von=CHANGED, genehmigt_von=ADMIN), GRANTS, {ADMIN}, False, id="its approver barred since"),
            pytest.param(
                a_change(gestartet_von=OWNER, verwaltung="owner", genehmigt_von=SECOND_OWNER),
                [*GRANTS[:2], {**GRANTS[2], "verwaltung": "administration"}, *GRANTS[3:]],
                set(),
                False,
                id="an owner's change, its approver demoted since",
            ),
            pytest.param(
                a_change(gestartet_von=CHANGED, genehmigt_von=ERASED_ACTOR_MARKER), GRANTS, set(), False, id="its approver erased since"
            ),
            # The effect of their own change carried `genehmigt_von` to the row it granted afresh.
            pytest.param(
                a_change(gestartet_von=CHANGED, genehmigt_von=MOVED), GRANTS, set(), True, id="its approver's own address changed since"
            ),
            pytest.param(
                a_change(gestartet_von=OWNER, verwaltung="owner", genehmigt_von=MOVED_OWNER),
                GRANTS,
                set(),
                True,
                id="an owner's change, its approver's own address changed since",
            ),
            pytest.param(
                a_change(gestartet_von=OWNER, verwaltung="owner", genehmigt_von=MOVED_DEMOTED),
                GRANTS,
                set(),
                False,
                id="an owner's change, its approver moved and demoted since",
            ),
        ],
    )
    def test_it_stands_only_while_its_approver_may_approve_it(
        self, genehmigung: dict[str, Any], grants: list[dict[str, Any]], gesperrt: set[str], steht: bool
    ):
        assert genehmigung_steht(betroffen=CHANGED, genehmigung=genehmigung, grants=grants, announced=[], gesperrt=gesperrt) is steht
