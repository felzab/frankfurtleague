"""
API · a pupil's address change, judged without a database

The execution twin, `tests/api/test_spieler_adresswechsel_execution.py`, drives the routes; this file
holds the decisions each route rests on and the shapes a leaked link may learn.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError
from pymongo import ASCENDING

from app.api.bewerbungen.services import hash_token
from app.api.spieler.schemas import (
    FLSpielerAdresswechsel,
    FLSpielerAdresswechselAnsichtBisherig,
    FLSpielerAdresswechselAnsichtNeu,
    FLSpielerAdresswechselAnsichtPayload,
    FLSpielerAdresswechselAntwortPayload,
    FLSpielerAdresswechselAntwortResponse,
    FLSpielerAdresswechselPayload,
    FLSpielerAdresswechselStoppPayload,
)
from app.api.spieler.services import (
    SPIELER_ADRESSWECHSEL_ANSICHT_FIELDS,
    SPIELER_ADRESSWECHSEL_FELD,
    build_pending_spieler_adresswechsel_filter,
    build_spieler_adresswechsel_filter,
    build_spieler_filter,
    build_spieler_stopp_filter,
    find_adresse_unveraendert_refusal,
    find_keine_adresse_refusal,
    spieler_adresswechsel_zustand_of,
)
from app.core.collections import Collection
from app.core.constraints import _SPIELER_ADRESSWECHSEL, SUPPORT_INDEXES, UNIQUE_INDEXES
from app.core.sentinels import GHOST_SPIELER_ID

NOW = datetime(2026, 4, 1, 10, 30, tzinfo=UTC)
TOKEN_HASH = hash_token("raw-token-for-one-pupil-address")

STORED = "lenore.quastenbach@schule.example"
NEW = "Lenore.Q@neupost.example.org"


class TestTheStoredBlock:
    def test_the_model_declares_every_key_the_validator_requires_but_the_two_hashes(self):
        """Each hash is a whole credential, so the editor's read model leaves both out."""

        assert set(_SPIELER_ADRESSWECHSEL["required"]) - set(FLSpielerAdresswechsel.model_fields) == {"token_hash", "stopp_hash"}


class TestWhichAddressAPupilMayBeAskedFor:
    @pytest.mark.parametrize("email", [None, ""], ids=["absent", "blank"])
    def test_a_pupil_holding_none_takes_no_change(self, email: Any):
        assert find_keine_adresse_refusal(email=email) is not None

    @pytest.mark.parametrize(
        ("typed", "refused"),
        [
            pytest.param(STORED, True, id="as-stored"),
            # The sign-in folds the whole address, so a change to these asks a mailbox the pupil already signs in on.
            pytest.param("Lenore.Quastenbach@Schule.Example", True, id="another-case"),
            pytest.param(" lenore.quastenbach@schule.example ", True, id="padded"),
            pytest.param(NEW, False, id="another-mailbox"),
        ],
    )
    def test_the_stored_address_is_judged_on_the_fold(self, typed: str, refused: bool):
        assert (find_adresse_unveraendert_refusal(stored=STORED, email=typed) is not None) is refused


class TestTheStartsPayload:
    def test_the_reason_is_a_key_the_form_states_even_when_null(self):
        """Defaulted, a form forgetting the box would start the change that waits on no answer from the address on file."""

        with pytest.raises(ValidationError):
            FLSpielerAdresswechselPayload.model_validate({"email": NEW})

        assert FLSpielerAdresswechselPayload.model_validate({"email": NEW, "grund": None}).grund is None

    @pytest.mark.parametrize(
        "grund",
        ["", "zwei\nZeilen", "Mail von lenore@schule.example", "x" * 201],
        ids=["empty", "two-lines", "an-address", "past-the-ceiling"],
    )
    def test_a_reason_the_log_should_not_keep_is_refused(self, grund: str):
        with pytest.raises(ValidationError):
            FLSpielerAdresswechselPayload.model_validate({"email": NEW, "grund": grund})


class TestTheAnswer:
    def test_the_press_names_its_answer(self):
        """Required: a page that omitted it would have the model decide whether a mailbox is the person's."""

        with pytest.raises(ValidationError):
            FLSpielerAdresswechselAntwortPayload.model_validate({"token": "t"})

    @pytest.mark.parametrize(
        "model",
        [
            FLSpielerAdresswechselAntwortPayload,
            FLSpielerAdresswechselAnsichtPayload,
            FLSpielerAdresswechselStoppPayload,
        ],
    )
    def test_an_unknown_key_is_refused(self, model: type[BaseModel]):
        with pytest.raises(ValidationError):
            model.model_validate({"token": "t", "antwort": "bestaetigt", "email": NEW})


class TestWhatALeakedLinkLearns:
    """`READ-PUPIL-005`: the holder of a leaked link learns a side, a state and its instants, never a name or either address."""

    def test_the_new_mailbox_s_side_declares_exactly_its_state_and_deadline(self):
        assert set(FLSpielerAdresswechselAnsichtNeu.model_fields) == {"seite", "zustand", "gueltig_bis"}

    def test_the_stop_side_declares_exactly_its_step_and_instants(self):
        assert set(FLSpielerAdresswechselAnsichtBisherig.model_fields) == {"seite", "zustand", "gueltig_bis", "wirksam_ab"}

    def test_the_answer_carries_whom_to_notify_for_the_frontend_s_server_alone(self):
        """`mitteilung` names the replaced address: the route handler mails it and strips it before the browser."""

        assert set(FLSpielerAdresswechselAntwortResponse.model_fields) - {"acknowledged"} == {"antwort", "wirksam_ab", "mitteilung"}

    def test_the_read_projects_no_name(self):
        """Both addresses are read for the ban list and the holder check, the response models being what keeps them off the answer."""

        assert set(SPIELER_ADRESSWECHSEL_ANSICHT_FIELDS) == {"email", SPIELER_ADRESSWECHSEL_FELD}


UNCONFIRMABLE: tuple[str, ...] = ("ersetzte_gesperrt", "keine_adresse", "vergeben")


def zustand(*, gueltig_bis: Any, gesperrt: bool = False, causes: tuple[str, ...] = ()) -> str:
    return spieler_adresswechsel_zustand_of(
        wechsel={"gueltig_bis": gueltig_bis}, now=NOW, gesperrt=gesperrt, **{cause: cause in causes for cause in UNCONFIRMABLE}
    )


class TestTheState:
    """Ranked as the referee's link ranks: a ban on the link's own address, then the deadline, then the three unconfirmable causes alike."""

    def test_a_ban_on_the_link_s_own_address_ranks_ahead_of_the_deadline(self):
        assert zustand(gueltig_bis=NOW - timedelta(days=1), gesperrt=True, causes=UNCONFIRMABLE) == "gesperrt"

    @pytest.mark.parametrize(
        ("gueltig_bis", "expected"),
        [(NOW + timedelta(seconds=1), "gueltig"), (NOW, "abgelaufen"), (NOW.replace(tzinfo=None), "abgelaufen")],
        ids=["a-second-left", "the-instant-itself", "as-the-driver-reads-it-back"],
    )
    def test_the_deadline_s_instant_is_past(self, gueltig_bis: datetime, expected: str):
        assert zustand(gueltig_bis=gueltig_bis) == expected

    @pytest.mark.parametrize("cause", UNCONFIRMABLE)
    @pytest.mark.parametrize(("left", "expected"), [(timedelta(hours=1), "nicht_bestaetigbar"), (-timedelta(hours=1), "abgelaufen")])
    def test_each_unconfirmable_cause_reads_alike_behind_the_deadline(self, cause: str, left: timedelta, expected: str):
        assert zustand(gueltig_bis=NOW + left, causes=(cause,)) == expected


class TestTheLookups:
    def test_both_link_filters_key_on_a_hash_and_never_on_an_address(self):
        """No read keys on the pending address: until it takes effect, the new mailbox holds nothing."""

        assert build_spieler_adresswechsel_filter(token_hash=TOKEN_HASH) == {f"{SPIELER_ADRESSWECHSEL_FELD}.token_hash": TOKEN_HASH}
        assert build_spieler_stopp_filter(stopp_hash=TOKEN_HASH) == {f"{SPIELER_ADRESSWECHSEL_FELD}.stopp_hash": TOKEN_HASH}

    def test_the_pending_filter_keeps_the_sentinel_out(self):
        """The controls answer the sentinel the 404 every by-id route does."""

        assert build_pending_spieler_adresswechsel_filter(GHOST_SPIELER_ID)["_id"] == build_spieler_filter(GHOST_SPIELER_ID)["_id"]

    @pytest.mark.parametrize(
        ("name", "path"),
        [
            ("spieler_adresswechsel_token_hash", "token_hash"),
            ("spieler_adresswechsel_stopp_hash", "stopp_hash"),
        ],
    )
    def test_each_hash_lookup_is_indexed(self, name: str, path: str):
        declared = next(index for index in SUPPORT_INDEXES if index.name == name)

        assert declared.collection == Collection.SPIELER
        assert dict(declared.keys) == {f"{SPIELER_ADRESSWECHSEL_FELD}.{path}": ASCENDING}

    def test_neither_is_a_unique_index(self):
        """A null hash awaiting approval is one key every such change shares."""

        keyed = {key for index in UNIQUE_INDEXES if index.collection == Collection.SPIELER for key in index.keys}

        assert {f"{SPIELER_ADRESSWECHSEL_FELD}.token_hash", f"{SPIELER_ADRESSWECHSEL_FELD}.stopp_hash"}.isdisjoint(keyed)
