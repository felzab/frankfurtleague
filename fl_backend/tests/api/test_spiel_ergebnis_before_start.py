"""
API · a season not yet started takes no result: `ergebnis_before_saison_start`

Goals, a shoot-out, a no-show and an abandonment are each a record of a match, which fixes the bracket or the start
date and would ride along on a swap or a replacement. Judged as the save would store the fixture against the fixture
stored, so a stored result stands while it is resubmitted unchanged, a figure the save drops is no record, and a
call-off or a strike-out, which records nothing, still saves.
"""

from datetime import UTC, datetime
from http import HTTPStatus
from typing import Any

import pytest
from bson import ObjectId

from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import FLPatchSpielDataPayload, FLSpiel
from app.api.spiele.services import apply_payload_to_spiel, find_ergebnis_before_start_refusal
from app.core.codes import Code
from tests import documents
from tests.payloads import spiel_patch_body

HOME, AWAY = ObjectId("6890a1b2c3d4e5f607470001"), ObjectId("6890a1b2c3d4e5f607470002")
NOW = datetime(2026, 12, 1, 12, tzinfo=UTC)


def side(team_id: ObjectId, tore: int | None) -> dict[str, Any]:
    return {"team_id": team_id, "tore": tore}


def stored(**fields: Any) -> dict[str, Any]:
    """A group fixture of both clubs, nothing entered unless `fields` says so."""

    return documents.spiel_document(
        spiel_id=ObjectId("6890a1b2c3d4e5f607470011"),
        saison_id="2027",
        spiel_nr=1,
        spieltag_id=ObjectId("6890a1b2c3d4e5f607470021"),
        **{"team1": side(HOME, None), "team2": side(AWAY, None), **fields},
    )


def judged(document: dict[str, Any], *, started: bool, **overrides: Any) -> Any:
    """The rule asked of the fixture as the save composes it from the editor's body, `overrides` moved."""

    spiel = FLSpiel.model_validate(document)
    payload = FLPatchSpielDataPayload.model_validate(spiel_patch_body(document, **overrides))
    patched = apply_payload_to_spiel(spiel, payload, FLSaisonRules.model_validate(documents.rules_document()), now=NOW)

    return find_ergebnis_before_start_refusal(spiel, patched, started=started)


class TestAResultBeforeTheStartIsRefused:
    @pytest.mark.parametrize(
        "overrides",
        [
            pytest.param({"team1": side(HOME, 2), "team2": side(AWAY, 1)}, id="goals"),
            # One side's goals alone are a record too: `has_taken_place` counts a half-entered score.
            pytest.param({"team1": side(HOME, 2)}, id="one side's goals"),
            pytest.param({"sonderereignis": "nichtantreten_team1"}, id="nichtantreten_team1"),
            pytest.param({"sonderereignis": "nichtantreten_team2"}, id="nichtantreten_team2"),
            pytest.param({"sonderereignis": "abgebrochen"}, id="abgebrochen"),
        ],
    )
    def test_each_kind_of_record_is_refused(self, overrides: dict[str, Any]):
        refusal = judged(stored(), started=False, **overrides)

        assert refusal is not None
        assert (refusal.error_code, refusal.status) == (Code.ERGEBNIS_BEFORE_SAISON_START, HTTPStatus.CONFLICT)

    def test_a_stored_result_changed_is_refused(self):
        """A result from before the rule is no licence to type another over it."""

        document = stored(team1=side(HOME, 2), team2=side(AWAY, 1), ergebnis="2:1")

        assert judged(document, started=False, team1=side(HOME, 3)) is not None

    def test_a_shoot_out_on_a_stored_level_result_is_refused(self):
        """The goals unchanged, the shoot-out alone decides the tie, and the bracket would advance its winner."""

        document = stored(saison_phase="achtelfinale", team1=side(HOME, 2), team2=side(AWAY, 2), ergebnis="2:2")

        assert judged(document, started=False, elfmeterschiessen={"team1": 4, "team2": 3}) is not None

    def test_a_stored_shoot_out_changed_is_refused(self):
        """Its counts swapped, the shoot-out advances the other club."""

        document = stored(
            saison_phase="achtelfinale", team1=side(HOME, 2), team2=side(AWAY, 2), ergebnis="2:2", elfmeterschiessen={"team1": 4, "team2": 3}
        )

        assert judged(document, started=False, elfmeterschiessen={"team1": 3, "team2": 4}) is not None


class TestWhatTheRulePasses:
    @pytest.mark.parametrize(
        "overrides",
        [
            pytest.param({"sonderereignis": "ausgefallen"}, id="ausgefallen"),
            pytest.param({"sonderereignis": "annulliert"}, id="annulliert"),
            pytest.param({"date": "2027-03-01", "time": "16:00:00"}, id="a dating"),
        ],
    )
    def test_what_records_no_match_saves_before_the_start(self, overrides: dict[str, Any]):
        assert judged(stored(), started=False, **overrides) is None

    def test_a_result_stored_before_the_rule_resubmitted_unchanged_passes(self):
        """The editor locks the result's fields until the start and sends them back as stored with every other change."""

        document = stored(team1=side(HOME, 2), team2=side(AWAY, 1), ergebnis="2:1", sonderereignis="abgebrochen")

        assert judged(document, started=False, date="2027-03-01") is None

    def test_a_stored_shoot_out_resubmitted_unchanged_passes(self):
        """The payload's shoot-out model is not the stored one's, and the two never compare equal as models."""

        document = stored(
            saison_phase="achtelfinale", team1=side(HOME, 2), team2=side(AWAY, 2), ergebnis="2:2", elfmeterschiessen={"team1": 4, "team2": 3}
        )

        assert judged(document, started=False, date="2027-03-01") is None

    @pytest.mark.parametrize(
        "fields",
        [
            pytest.param({"team1": side(HOME, 2), "team2": side(AWAY, 2), "ergebnis": "2:2"}, id="a group fixture"),
            pytest.param(
                {"saison_phase": "achtelfinale", "team1": side(HOME, 2), "team2": side(AWAY, 1), "ergebnis": "2:1"}, id="a won knockout"
            ),
        ],
    )
    def test_a_shoot_out_the_save_drops_passes(self, fields: dict[str, Any]):
        """Only a level knockout result keeps a shoot-out, so on any other the save stores none."""

        assert judged(stored(**fields), started=False, elfmeterschiessen={"team1": 4, "team2": 3}) is None

    def test_a_result_stored_before_the_rule_cleared_passes(self):
        document = stored(team1=side(HOME, 2), team2=side(AWAY, 1), ergebnis="2:1")

        assert judged(document, started=False, team1=side(HOME, None), team2=side(AWAY, None)) is None

    def test_from_the_start_every_result_saves(self):
        assert judged(stored(), started=True, team1=side(HOME, 2), team2=side(AWAY, 1)) is None
