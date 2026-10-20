"""
API · a confirmed referee's address change, judged without a database

The execution twin, `tests/api/test_schiedsrichter_adresswechsel_execution.py`, drives the routes;
this file holds the decisions each route rests on and the shapes a leaked link may learn.
"""

from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError
from pymongo import ASCENDING

from app.api.bewerbungen.services import hash_token
from app.api.schiedsrichter.schemas import (
    FLSchiedsrichterAdresswechsel,
    FLSchiedsrichterAdresswechselAnsichtBisherig,
    FLSchiedsrichterAdresswechselAnsichtNeu,
    FLSchiedsrichterAdresswechselAnsichtPayload,
    FLSchiedsrichterAdresswechselAntwortPayload,
    FLSchiedsrichterAdresswechselAntwortResponse,
    FLSchiedsrichterAdresswechselPayload,
    FLSchiedsrichterAdresswechselStoppPayload,
)
from app.api.schiedsrichter.services import (
    ADRESSWECHSEL_ANSICHT_FIELDS,
    ADRESSWECHSEL_FELD,
    EINWILLIGUNG_FELD,
    adresswechsel_zustand_of,
    build_adresswechsel_filter,
    build_pending_adresswechsel_filter,
    build_referee_filter,
    build_stopp_filter,
    compose_einwilligung,
    compose_korrektur_update,
    find_bestaetigte_adresse_refusal,
    find_schiedsrichter_adresse_unveraendert_refusal,
    find_unbestaetigter_wechsel_refusal,
    save_moves_the_link,
)
from app.core.collections import Collection
from app.core.constraints import _SCHIEDSRICHTER_ADRESSWECHSEL, SUPPORT_INDEXES, UNIQUE_INDEXES
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID

TODAY = "2026-04-01"
NOW = datetime(2026, 4, 1, 10, 30, tzinfo=UTC)
TOKEN_HASH = hash_token("raw-token-for-one-address")

STORED = "Anna.Alt@Schule.DE"
NEW = "anna.neu@example.com"


def confirmed() -> dict[str, Any]:
    return compose_einwilligung(umfang="intern", medien=False, text_version="v1", today=TODAY)


def stored_row(*, einwilligung: Any, email: str | None = STORED, inactive_since: str | None = None) -> dict[str, Any]:
    return {"kontakt": {"email": email}, EINWILLIGUNG_FELD: einwilligung, "inactive_since": inactive_since}


def payload(email: str) -> dict[str, Any]:
    return {"name": "Anna Alt", "schule": None, "default_payment": 20, "kontakt": {"telefon": "+49 69 5550101", "email": email}}


class TestTheStoredBlock:
    def test_the_model_declares_every_key_the_validator_requires_but_the_two_hashes(self):
        assert set(_SCHIEDSRICHTER_ADRESSWECHSEL["required"]) - set(FLSchiedsrichterAdresswechsel.model_fields) == {"token_hash", "stopp_hash"}


class TestWhichSaveIsRefused:
    """`REQ-SCHIEDSRICHTER-011`: the save moves a confirmed referee's address never, a retired one's included."""

    @pytest.mark.parametrize(
        ("stored", "payload_email", "refused"),
        [
            pytest.param(stored_row(einwilligung=confirmed()), NEW, True, id="confirmed-and-moved"),
            pytest.param(stored_row(einwilligung=confirmed(), inactive_since="2026-01-01"), NEW, True, id="retired-confirmed-and-moved"),
            # One mailbox: a domain has no case (RFC 5321 §2.4).
            pytest.param(stored_row(einwilligung=confirmed()), "Anna.Alt@schule.de", False, id="confirmed-and-unmoved"),
            pytest.param(stored_row(einwilligung=None), NEW, False, id="unconfirmed-and-moved"),
            pytest.param(stored_row(einwilligung={**confirmed(), "bestaetigt_am": None}), NEW, False, id="awaiting-its-answer"),
        ],
    )
    def test_only_a_confirmed_referees_moved_address(self, stored: Mapping[str, Any], payload_email: str, refused: bool):
        assert (find_bestaetigte_adresse_refusal(stored=stored, payload_email=payload_email) is not None) is refused

    def test_an_unconfirmed_referees_save_still_moves_the_address_and_re_mints_the_consent_link(self):
        """The control on the refusal: before the person answers, the address is the save's to correct."""

        stored = stored_row(einwilligung=None)
        update, minted = compose_korrektur_update(stored=stored, payload=payload(NEW), payload_email=NEW, token_hash=TOKEN_HASH, today=TODAY)

        assert save_moves_the_link(stored=stored, payload_email=NEW)
        assert (minted, update["$set"]["kontakt"]["email"], update["$set"]["bestaetigung"]["token_hash"]) == (True, NEW, TOKEN_HASH)


class TestWhichStartIsRefused:
    def test_an_unconfirmed_referee_takes_no_change(self):
        assert find_unbestaetigter_wechsel_refusal(einwilligung=None) is not None
        assert find_unbestaetigter_wechsel_refusal(einwilligung=confirmed()) is None

    @pytest.mark.parametrize(
        ("typed", "refused"),
        [("anna.alt@schule.de", True), ("ANNA.ALT@SCHULE.DE", True), (NEW, False)],
        ids=["folded", "upper", "another-mailbox"],
    )
    def test_the_address_on_file_is_judged_on_the_sign_in_s_fold(self, typed: str, refused: bool):
        assert (find_schiedsrichter_adresse_unveraendert_refusal(stored=STORED, email=typed) is not None) is refused


class TestTheAnswer:
    def test_the_press_names_its_answer(self):
        """Required: a page that omitted it would have the model decide whether a mailbox is the person's."""

        with pytest.raises(ValidationError):
            FLSchiedsrichterAdresswechselAntwortPayload.model_validate({"token": "t"})

    @pytest.mark.parametrize(
        "model",
        [
            FLSchiedsrichterAdresswechselAntwortPayload,
            FLSchiedsrichterAdresswechselAnsichtPayload,
            FLSchiedsrichterAdresswechselStoppPayload,
        ],
    )
    def test_an_unknown_key_is_refused(self, model: type[BaseModel]):
        with pytest.raises(ValidationError):
            model.model_validate({"token": "t", "antwort": "bestaetigt", "email": NEW})

    def test_the_start_states_its_reason_even_when_null(self):
        with pytest.raises(ValidationError):
            FLSchiedsrichterAdresswechselPayload.model_validate({"email": NEW})


class TestWhatALeakedLinkLearns:
    """`READ-REFEREE-003`: the holder of a leaked link learns a side, a state and its instants, never a name or either address."""

    def test_each_side_declares_exactly_what_it_may_answer(self):
        assert set(FLSchiedsrichterAdresswechselAnsichtNeu.model_fields) == {"seite", "zustand", "gueltig_bis"}
        assert set(FLSchiedsrichterAdresswechselAnsichtBisherig.model_fields) == {"seite", "zustand", "gueltig_bis", "wirksam_ab"}

    def test_the_answer_carries_whom_to_notify_for_the_frontend_s_server_alone(self):
        assert set(FLSchiedsrichterAdresswechselAntwortResponse.model_fields) - {"acknowledged"} == {"antwort", "wirksam_ab", "mitteilung"}

    def test_the_read_projects_no_name_and_of_the_contact_the_address_alone(self):
        """The two addresses are read for the ban list, the response models being what keeps them off the answer."""

        projected = set(ADRESSWECHSEL_ANSICHT_FIELDS)

        assert "name" not in projected
        assert {path for path in projected if path.startswith("kontakt")} == {"kontakt.email"}


def zustand(*, left: timedelta, gesperrt: bool = False, ersetzte_gesperrt: bool = False, vergeben: bool = False) -> str:
    return adresswechsel_zustand_of(
        wechsel={"gueltig_bis": NOW + left}, now=NOW, gesperrt=gesperrt, ersetzte_gesperrt=ersetzte_gesperrt, vergeben=vergeben
    )


class TestTheState:
    """Ranked as the press refuses a confirmation: `-009`, then `-003`, then `-010` and another pupil's address alike."""

    def test_a_ban_ranks_ahead_of_the_deadline(self):
        assert zustand(left=-timedelta(days=1), gesperrt=True, ersetzte_gesperrt=True) == "gesperrt"

    @pytest.mark.parametrize(("left", "expected"), [(timedelta(seconds=1), "gueltig"), (timedelta(0), "abgelaufen")])
    def test_the_deadline_s_instant_is_past(self, left: timedelta, expected: str):
        assert zustand(left=left) == expected

    @pytest.mark.parametrize("cause", ["ersetzte_gesperrt", "vergeben"])
    @pytest.mark.parametrize(("left", "expected"), [(timedelta(hours=1), "nicht_bestaetigbar"), (-timedelta(hours=1), "abgelaufen")])
    def test_each_unconfirmable_cause_ranks_behind_the_deadline(self, cause: str, left: timedelta, expected: str):
        assert zustand(left=left, **{cause: True}) == expected


class TestTheLookups:
    def test_both_link_filters_key_on_a_hash_and_never_on_an_address(self):
        assert build_adresswechsel_filter(token_hash=TOKEN_HASH) == {f"{ADRESSWECHSEL_FELD}.token_hash": TOKEN_HASH}
        assert build_stopp_filter(stopp_hash=TOKEN_HASH) == {f"{ADRESSWECHSEL_FELD}.stopp_hash": TOKEN_HASH}

    def test_the_pending_filter_keeps_the_ghost_out(self):
        """The controls answer the ghost the 404 every by-id route does."""

        assert build_pending_adresswechsel_filter(GHOST_SCHIEDSRICHTER_ID)["_id"] == build_referee_filter(GHOST_SCHIEDSRICHTER_ID)["_id"]

    @pytest.mark.parametrize(
        ("name", "path"), [("schiedsrichter_adresswechsel_token_hash", "token_hash"), ("schiedsrichter_adresswechsel_stopp_hash", "stopp_hash")]
    )
    def test_each_hash_lookup_is_indexed(self, name: str, path: str):
        declared = next(index for index in SUPPORT_INDEXES if index.name == name)

        assert declared.collection == Collection.SCHIEDSRICHTER
        assert dict(declared.keys) == {f"{ADRESSWECHSEL_FELD}.{path}": ASCENDING}

    def test_neither_is_a_unique_index(self):
        keyed = {key for index in UNIQUE_INDEXES if index.collection == Collection.SCHIEDSRICHTER for key in index.keys}

        assert {f"{ADRESSWECHSEL_FELD}.token_hash", f"{ADRESSWECHSEL_FELD}.stopp_hash"}.isdisjoint(keyed)
