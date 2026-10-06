"""
API · a confirmed referee's address change, judged without a database

The execution twin, `tests/api/test_schiedsrichter_adresswechsel_execution.py`, drives the routes;
this file holds the decisions each route rests on and the shapes a leaked link may learn.
"""

from collections.abc import Mapping
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError
from pymongo import ASCENDING

from app.api.bewerbungen.services import hash_token
from app.api.schiedsrichter.schemas import (
    FLSchiedsrichterAdresswechsel,
    FLSchiedsrichterAdresswechselAnsichtPayload,
    FLSchiedsrichterAdresswechselAnsichtResponse,
    FLSchiedsrichterAdresswechselPayload,
    FLSchiedsrichterAdresswechselResponse,
)
from app.api.schiedsrichter.services import (
    ADRESSWECHSEL_ANSICHT_FIELDS,
    ADRESSWECHSEL_FELD,
    EINWILLIGUNG_FELD,
    adresswechsel_zustand_of,
    build_adresswechsel_filter,
    build_pending_adresswechsel_filter,
    build_referee_filter,
    compose_adresswechsel,
    compose_einwilligung,
    compose_korrektur_update,
    save_asks_an_address_change,
    save_drops_a_pending_address,
    save_moves_the_link,
)
from app.core.collections import Collection
from app.core.constraints import _SCHIEDSRICHTER_ADRESSWECHSEL, SUPPORT_INDEXES, UNIQUE_INDEXES
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID

TODAY = "2026-04-01"
TOKEN_HASH = hash_token("raw-token-for-one-address")

STORED = "Anna.Alt@Schule.DE"
NEW = "anna.neu@example.com"

BLOCK: Mapping[str, Any] = compose_adresswechsel(email=NEW, token_hash=TOKEN_HASH, today=TODAY)


def confirmed() -> dict[str, Any]:
    return compose_einwilligung(umfang="intern", medien=False, text_version="v1", today=TODAY)


def stored_row(*, einwilligung: Any, email: str | None = STORED, inactive_since: str | None = None) -> dict[str, Any]:
    return {"kontakt": {"email": email}, EINWILLIGUNG_FELD: einwilligung, "inactive_since": inactive_since}


def payload(email: str) -> dict[str, Any]:
    return {"name": "Anna Alt", "schule": None, "default_payment": 20, "kontakt": {"telefon": "+49 69 5550101", "email": email}}


class TestTheStoredBlock:
    def test_the_model_declares_every_key_the_validator_requires_but_the_hash(self):
        assert set(_SCHIEDSRICHTER_ADRESSWECHSEL["required"]) - set(FLSchiedsrichterAdresswechsel.model_fields) == {"token_hash"}


class TestWhichSaveAsksTheNewMailbox:
    @pytest.mark.parametrize(
        ("stored", "payload_email", "asks"),
        [
            pytest.param(stored_row(einwilligung=confirmed()), NEW, True, id="confirmed-and-moved"),
            pytest.param(stored_row(einwilligung=confirmed(), inactive_since="2026-01-01"), NEW, True, id="retired-confirmed-and-moved"),
            # One mailbox: a domain has no case (RFC 5321 §2.4).
            pytest.param(stored_row(einwilligung=confirmed()), "Anna.Alt@schule.de", False, id="confirmed-and-unmoved"),
            pytest.param(stored_row(einwilligung=None), NEW, False, id="unconfirmed-and-moved"),
            pytest.param(stored_row(einwilligung={**confirmed(), "bestaetigt_am": None}), NEW, False, id="awaiting-its-answer"),
        ],
    )
    def test_only_a_confirmed_referees_moved_address_waits(self, stored: Mapping[str, Any], payload_email: str, asks: bool):
        assert save_asks_an_address_change(stored=stored, payload_email=payload_email) is asks

    @pytest.mark.parametrize(
        "stored",
        [stored_row(einwilligung=confirmed()), stored_row(einwilligung=None)],
        ids=["confirmed", "unconfirmed"],
    )
    def test_no_save_both_waits_and_re_mints_the_consent_link(self, stored: Mapping[str, Any]):
        """The two links answer two different questions, and a save asking both would mail a spent consent link."""

        assert not (save_asks_an_address_change(stored=stored, payload_email=NEW) and save_moves_the_link(stored=stored, payload_email=NEW))


class TestWhichSaveDropsAPendingAddress:
    """Only a save typing another mailbox over a pending one drops an address nobody proved, which the log then loses."""

    @pytest.mark.parametrize(
        ("pending", "payload_email", "drops"),
        [
            pytest.param("anna@neu.example", NEW, True, id="another-mailbox"),
            # One mailbox: a domain has no case (RFC 5321 §2.4), so the re-mint keeps the address.
            pytest.param(NEW, "anna.neu@EXAMPLE.com", False, id="same-mailbox"),
            pytest.param("anna@neu.example", STORED, False, id="address-on-file-kept"),
            pytest.param(None, NEW, False, id="nothing-pending"),
        ],
    )
    def test_it_is_a_save_naming_another_mailbox(self, pending: str | None, payload_email: str, drops: bool):
        stored = {**stored_row(einwilligung=confirmed()), **({} if pending is None else {ADRESSWECHSEL_FELD: {"email": pending}})}

        assert save_drops_a_pending_address(stored=stored, payload_email=payload_email) is drops


class TestTheSaveOnAConfirmedReferee:
    def test_the_stored_address_stays_in_whichever_spelling_it_was_stored(self):
        update, minted = compose_korrektur_update(
            stored=stored_row(einwilligung=confirmed()), payload=payload(NEW), payload_email=NEW, token_hash=TOKEN_HASH, today=TODAY
        )

        assert minted == "adresswechsel"
        assert update["$set"]["kontakt"] == {"telefon": "+49 69 5550101", "email": STORED}

    def test_everything_else_the_save_carries_lands(self):
        update, _ = compose_korrektur_update(
            stored=stored_row(einwilligung=confirmed()), payload=payload(NEW), payload_email=NEW, token_hash=TOKEN_HASH, today=TODAY
        )

        assert {key: update["$set"][key] for key in ("name", "schule", "default_payment")} == {
            "name": "Anna Alt",
            "schule": None,
            "default_payment": 20,
        }

    def test_the_whole_block_is_written_so_an_earlier_change_dies(self):
        update, _ = compose_korrektur_update(
            stored=stored_row(einwilligung=confirmed()), payload=payload(NEW), payload_email=NEW, token_hash=TOKEN_HASH, today=TODAY
        )

        assert update["$set"][ADRESSWECHSEL_FELD] == BLOCK


class TestTheAnswer:
    def test_the_press_names_its_answer(self):
        """Required: a page that omitted it would have the model decide whether a mailbox is the person's."""

        with pytest.raises(ValidationError):
            FLSchiedsrichterAdresswechselPayload.model_validate({"token": "t"})

    @pytest.mark.parametrize("model", [FLSchiedsrichterAdresswechselPayload, FLSchiedsrichterAdresswechselAnsichtPayload])
    def test_an_unknown_key_is_refused(self, model: type[BaseModel]):
        with pytest.raises(ValidationError):
            model.model_validate({"token": "t", "antwort": "bestaetigt", "email": NEW})


class TestWhatALeakedLinkLearns:
    """`READ-REFEREE-003`: the holder of a leaked link learns a first name and a deadline, never either address."""

    def test_the_view_declares_exactly_the_three_names_it_may_answer(self):
        assert set(FLSchiedsrichterAdresswechselAnsichtResponse.model_fields) - {"acknowledged"} == {"zustand", "vorname", "frist"}

    def test_the_answer_echoes_the_press_alone(self):
        assert set(FLSchiedsrichterAdresswechselResponse.model_fields) - {"acknowledged"} == {"antwort"}

    def test_the_read_projects_no_hash_and_of_the_contact_the_address_alone(self):
        """The two addresses are read for the ban list, the response model being what keeps them off the answer."""

        projected = set(ADRESSWECHSEL_ANSICHT_FIELDS)

        assert f"{ADRESSWECHSEL_FELD}.token_hash" not in projected
        assert {path for path in projected if path.startswith("kontakt")} == {"kontakt.email"}


class TestTheState:
    """Ranked as the press refuses a confirmation: `-009`, then `-003`, then `-010`."""

    def test_a_ban_ranks_ahead_of_the_deadline(self):
        assert adresswechsel_zustand_of(wechsel={"frist": "2026-01-01"}, today=TODAY, gesperrt=True, ersetzte_gesperrt=True) == "gesperrt"

    @pytest.mark.parametrize(("frist", "zustand"), [(TODAY, "gueltig"), ("2026-03-31", "abgelaufen"), (None, "abgelaufen")])
    def test_the_last_valid_day_is_the_deadline_itself(self, frist: Any, zustand: str):
        assert adresswechsel_zustand_of(wechsel={"frist": frist}, today=TODAY, gesperrt=False, ersetzte_gesperrt=False) == zustand

    @pytest.mark.parametrize(("frist", "zustand"), [(TODAY, "nicht_bestaetigbar"), ("2026-03-31", "abgelaufen")])
    def test_a_ban_on_the_replaced_address_ranks_behind_the_deadline(self, frist: str, zustand: str):
        assert adresswechsel_zustand_of(wechsel={"frist": frist}, today=TODAY, gesperrt=False, ersetzte_gesperrt=True) == zustand


class TestTheLookups:
    def test_the_token_filter_keys_on_the_hash_and_never_on_an_address(self):
        """No read keys on the pending address: until it confirms, the new mailbox holds nothing."""

        assert build_adresswechsel_filter(token_hash=TOKEN_HASH) == {f"{ADRESSWECHSEL_FELD}.token_hash": TOKEN_HASH}

    def test_the_pending_filter_keeps_the_ghost_out(self):
        """The controls answer the ghost the 404 every by-id route does."""

        assert build_pending_adresswechsel_filter(GHOST_SCHIEDSRICHTER_ID)["_id"] == build_referee_filter(GHOST_SCHIEDSRICHTER_ID)["_id"]

    def test_the_hash_lookup_is_indexed(self):
        declared = next(index for index in SUPPORT_INDEXES if index.name == "schiedsrichter_adresswechsel_token_hash")

        assert declared.collection == Collection.SCHIEDSRICHTER
        assert dict(declared.keys) == {next(iter(build_adresswechsel_filter(token_hash=TOKEN_HASH))): ASCENDING}

    def test_it_is_a_support_index_rather_than_a_unique_one(self):
        keyed = {key for index in UNIQUE_INDEXES if index.collection == Collection.SCHIEDSRICHTER for key in index.keys}

        assert f"{ADRESSWECHSEL_FELD}.token_hash" not in keyed
