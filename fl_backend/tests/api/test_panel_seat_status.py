"""
API · which season status lets a seat open its team's panel, read from the table both tiers hold

`fl_backend/tests/shared/grants_a_panel.json` is that table, and `fl_frontend/src/core/roles.test.ts` holds the
frontend's predicate to it: a status one tier decides otherwise than the other fails that tier's suite.
"""

import json
from pathlib import Path
from typing import Any, Final, get_args

import pytest

from app.api.identity.services import grants_a_panel
from app.shared.schemas.literals import FLSaisonStatus

VERDICTS: Final = json.loads((Path(__file__).resolve().parents[1] / "shared" / "grants_a_panel.json").read_bytes().decode("utf-8"))


def test_the_table_judges_every_status_once():
    assert sorted(row["saison_status"] for row in VERDICTS) == sorted(get_args(FLSaisonStatus.__value__))


@pytest.mark.parametrize("row", VERDICTS, ids=lambda row: row["saison_status"])
def test_a_seat_grants_a_panel_as_the_table_says(row: dict[str, Any]):
    assert grants_a_panel(row["saison_status"]) is row["grants_a_panel"]
