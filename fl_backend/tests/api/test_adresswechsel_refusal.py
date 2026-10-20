"""
API · the address change's pure judgements: the masked address, the link's view, and who may not approve a change

Apart from a database, so the default tier holds them; the routes that serve and refuse on them are
`tests/api/test_adresswechsel_execution.py`'s.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError
from pymongo import ASCENDING

from app.api.adresswechsel.schemas import (
    FLAdresswechselAnsichtBeendet,
    FLAdresswechselAnsichtBisherig,
    FLAdresswechselAnsichtNeu,
    FLAdresswechselAntwortPayload,
)
from app.api.adresswechsel.services import ist_abgelaufen, maskierte_adresse, neu_zustand, verwehrt_fuer
from app.core.collections import Collection
from app.core.constraints import SUPPORT_INDEXES, UNIQUE_INDEXES

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


NOW = datetime(2026, 4, 1, 10, 0, tzinfo=UTC)


def a_live_change(*, lapsed: bool, bestaetigt: bool = False) -> dict[str, Any]:
    return {
        "gueltig_bis": NOW - timedelta(minutes=1) if lapsed else NOW + timedelta(hours=1),
        "bestaetigt_am": NOW - timedelta(days=1) if bestaetigt else None,
        "genehmigung": None,
    }


class TestTheNewMailboxsState:
    """In the order the confirmation judges, so a refused press names what a reload of its page shows."""

    @pytest.mark.parametrize(
        ("record", "gesperrt", "nicht_bestaetigbar", "zustand"),
        [
            pytest.param(a_live_change(lapsed=True), True, False, "gesperrt", id="a ban ranks ahead of the deadline"),
            pytest.param(a_live_change(lapsed=True), False, True, "abgelaufen", id="every unconfirmable cause reads alike behind it"),
            pytest.param(a_live_change(lapsed=False), False, True, "nicht_bestaetigbar", id="an unconfirmable cause inside it"),
            pytest.param(a_live_change(lapsed=True, bestaetigt=True), True, True, "bestaetigt", id="a confirmed change waits on no link"),
        ],
    )
    def test_the_view_ranks_the_states_as_the_press_refuses(
        self, record: dict[str, Any], gesperrt: bool, nicht_bestaetigbar: bool, zustand: str
    ):
        assert neu_zustand(record, now=NOW, gesperrt=gesperrt, nicht_bestaetigbar=nicht_bestaetigbar) == zustand

    def test_the_deadline_s_own_instant_is_past(self):
        assert ist_abgelaufen({"gueltig_bis": NOW, "genehmigung": None}, now=NOW)


class TestTheLinksLookups:
    @pytest.mark.parametrize("key", ["token_hash", "stopp_hash"])
    def test_each_hash_a_stranger_drives_is_indexed_and_never_unique(self, key: str):
        """Indexed, as a stranger sends the lookup; never unique, as a kept record holds its hashes beside a live one's."""

        keyed = [index for index in SUPPORT_INDEXES if index.collection == Collection.ADRESSWECHSEL and index.keys == ((key, ASCENDING),)]
        assert len(keyed) == 1
        assert not [index for index in UNIQUE_INDEXES if index.collection == Collection.ADRESSWECHSEL and key in index.keys]


def a_change(*, gestartet_von: str | None, verwaltung: str = "administration") -> dict[str, Any]:
    genehmigung = None if gestartet_von is None else {"verwaltung": verwaltung, "gestartet_von": gestartet_von}
    return {"adresse": CHANGED, "genehmigung": genehmigung}


class TestWhoMayNotApprove:
    @pytest.mark.parametrize(
        ("record", "akteur", "inhaber", "verwehrt"),
        [
            pytest.param(a_change(gestartet_von=None), CHANGED, True, "eigene", id="the changed address, an owner or not"),
            pytest.param(a_change(gestartet_von=OWNER), OWNER, True, "gestartet", id="the administrator who started it"),
            pytest.param(a_change(gestartet_von=OWNER, verwaltung="owner"), ADMIN, False, "inhaber", id="an owner's grant, no owner's power"),
            pytest.param(a_change(gestartet_von=OWNER, verwaltung="owner"), ADMIN, True, None, id="an owner's grant, another owner"),
            pytest.param(a_change(gestartet_von=None), ADMIN, False, None, id="the person's own start, another administrator"),
        ],
    )
    def test_four_eyes_and_the_owner_s_tier(self, record: dict[str, Any], akteur: str, inhaber: bool, verwehrt: str | None):
        assert verwehrt_fuer(record, akteur=akteur, inhaber=inhaber) == verwehrt
