"""
API · a pupil's address change, judged without a database

The execution twin, `tests/api/test_spieler_adresswechsel_execution.py`, drives the routes; this file
holds the decisions each route rests on and the shapes a leaked link may learn.
"""

from typing import Any

import pytest
from pydantic import BaseModel, ValidationError
from pymongo import ASCENDING

from app.api.bewerbungen.services import hash_token
from app.api.spieler.schemas import (
    FLSpielerAdresswechsel,
    FLSpielerAdresswechselAnsichtPayload,
    FLSpielerAdresswechselAnsichtResponse,
    FLSpielerAdresswechselAntwortPayload,
    FLSpielerAdresswechselAntwortResponse,
)
from app.api.spieler.services import (
    SPIELER_ADRESSWECHSEL_ANSICHT_FIELDS,
    SPIELER_ADRESSWECHSEL_FELD,
    build_pending_spieler_adresswechsel_filter,
    build_spieler_adresswechsel_filter,
    build_spieler_filter,
    compose_spieler_adresswechsel_antwort,
    find_adresse_unveraendert_refusal,
    find_keine_adresse_refusal,
    replaces_a_pending_address,
    spieler_adresswechsel_zustand_of,
)
from app.core.collections import Collection
from app.core.constraints import _SPIELER_ADRESSWECHSEL, SUPPORT_INDEXES, UNIQUE_INDEXES
from app.core.sentinels import GHOST_SPIELER_ID

TODAY = "2026-04-01"
TOKEN_HASH = hash_token("raw-token-for-one-pupil-address")

STORED = "lenore.quastenbach@schule.example"
NEW = "Lenore.Q@neupost.example.org"


class TestTheStoredBlock:
    def test_the_model_declares_every_key_the_validator_requires_but_the_hash(self):
        assert set(_SPIELER_ADRESSWECHSEL["required"]) - set(FLSpielerAdresswechsel.model_fields) == {"token_hash"}


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


class TestWhichRequestDropsAPendingAddress:
    """Only a request naming another mailbox drops an address nobody proved, which the log then loses."""

    @pytest.mark.parametrize(
        ("pending", "email", "drops"),
        [
            pytest.param("lena@neu.example", NEW, True, id="another-mailbox"),
            pytest.param(NEW, NEW.lower(), False, id="the-same-sign-in"),
            pytest.param(None, NEW, False, id="nothing-pending"),
        ],
    )
    def test_it_is_a_request_naming_another_mailbox(self, pending: str | None, email: str, drops: bool):
        stored = {"email": STORED, **({} if pending is None else {SPIELER_ADRESSWECHSEL_FELD: {"email": pending}})}

        assert replaces_a_pending_address(stored=stored, email=email) is drops


class TestTheAnswer:
    def test_a_confirmation_stores_the_fold_and_a_decline_the_block_alone(self):
        assert compose_spieler_adresswechsel_antwort(antwort="bestaetigt", email=NEW) == {
            "$set": {"email": "lenore.q@neupost.example.org"},
            "$unset": {SPIELER_ADRESSWECHSEL_FELD: ""},
        }
        assert compose_spieler_adresswechsel_antwort(antwort="abgelehnt", email=NEW) == {"$unset": {SPIELER_ADRESSWECHSEL_FELD: ""}}

    def test_the_press_names_its_answer(self):
        """Required: a page that omitted it would have the model decide whether a mailbox is the person's."""

        with pytest.raises(ValidationError):
            FLSpielerAdresswechselAntwortPayload.model_validate({"token": "t"})

    @pytest.mark.parametrize("model", [FLSpielerAdresswechselAntwortPayload, FLSpielerAdresswechselAnsichtPayload])
    def test_an_unknown_key_is_refused(self, model: type[BaseModel]):
        with pytest.raises(ValidationError):
            model.model_validate({"token": "t", "antwort": "bestaetigt", "email": NEW})


class TestWhatALeakedLinkLearns:
    """`READ-PUPIL-005`: the holder of a leaked link learns a first name, a state and a deadline, never either address."""

    def test_the_view_declares_exactly_the_three_names_it_may_answer(self):
        assert set(FLSpielerAdresswechselAnsichtResponse.model_fields) - {"acknowledged"} == {"zustand", "vorname", "frist"}

    def test_the_answer_echoes_the_press_alone(self):
        assert set(FLSpielerAdresswechselAntwortResponse.model_fields) - {"acknowledged"} == {"antwort"}

    def test_the_read_projects_no_hash_and_no_surname(self):
        """The two addresses are read for the ban list and the holder check, the response model being what keeps them off the answer."""

        assert set(SPIELER_ADRESSWECHSEL_ANSICHT_FIELDS) == {
            "vorname",
            "email",
            f"{SPIELER_ADRESSWECHSEL_FELD}.email",
            f"{SPIELER_ADRESSWECHSEL_FELD}.frist",
        }


UNCONFIRMABLE: tuple[str, ...] = ("ersetzte_gesperrt", "keine_adresse", "vergeben")


def zustand(*, frist: Any, gesperrt: bool = False, causes: tuple[str, ...] = ()) -> str:
    return spieler_adresswechsel_zustand_of(
        wechsel={"frist": frist}, today=TODAY, gesperrt=gesperrt, **{cause: cause in causes for cause in UNCONFIRMABLE}
    )


class TestTheState:
    """Ranked as the referee's link ranks: a ban on the link's own address, then the deadline, then the three unconfirmable causes alike."""

    def test_a_ban_on_the_link_s_own_address_ranks_ahead_of_the_deadline(self):
        assert zustand(frist="2026-01-01", gesperrt=True, causes=UNCONFIRMABLE) == "gesperrt"

    @pytest.mark.parametrize(("frist", "expected"), [(TODAY, "gueltig"), ("2026-03-31", "abgelaufen"), (None, "abgelaufen")])
    def test_the_last_valid_day_is_the_deadline_itself(self, frist: Any, expected: str):
        assert zustand(frist=frist) == expected

    @pytest.mark.parametrize("cause", UNCONFIRMABLE)
    @pytest.mark.parametrize(("frist", "expected"), [(TODAY, "nicht_bestaetigbar"), ("2026-03-31", "abgelaufen")])
    def test_each_unconfirmable_cause_reads_alike_behind_the_deadline(self, cause: str, frist: str, expected: str):
        assert zustand(frist=frist, causes=(cause,)) == expected


class TestTheLookups:
    def test_the_token_filter_keys_on_the_hash_and_never_on_an_address(self):
        """No read keys on the pending address: until it confirms, the new mailbox holds nothing."""

        assert build_spieler_adresswechsel_filter(token_hash=TOKEN_HASH) == {f"{SPIELER_ADRESSWECHSEL_FELD}.token_hash": TOKEN_HASH}

    def test_the_pending_filter_keeps_the_sentinel_out(self):
        """The controls answer the sentinel the 404 every by-id route does."""

        assert build_pending_spieler_adresswechsel_filter(GHOST_SPIELER_ID)["_id"] == build_spieler_filter(GHOST_SPIELER_ID)["_id"]

    def test_the_hash_lookup_is_indexed(self):
        declared = next(index for index in SUPPORT_INDEXES if index.name == "spieler_adresswechsel_token_hash")

        assert declared.collection == Collection.SPIELER
        assert dict(declared.keys) == {next(iter(build_spieler_adresswechsel_filter(token_hash=TOKEN_HASH))): ASCENDING}

    def test_it_is_a_support_index_rather_than_a_unique_one(self):
        keyed = {key for index in UNIQUE_INDEXES if index.collection == Collection.SPIELER for key in index.keys}

        assert f"{SPIELER_ADRESSWECHSEL_FELD}.token_hash" not in keyed
