"""
CORE · the read-back's exit contract (0 clean, 1 a document to correct, 2 could not judge, 3 crashed) and its records

Each exit case runs it in a process of its own, over an environment holding nothing of this machine's but the one name
Windows' sockets need. A record's rule across fields, which only the read-back judges, is held on the model alone.
"""

import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
from bson import ObjectId
from pydantic import ValidationError

from app.api.bewerbungen.schemas import FLBewerbungRecord
from app.readback import UNJUDGED
from tests.boot import BACKEND_ROOT, environment
from tests.documents import bewerbung_document, kontakte_document, kontaktperson_document, new_schule_document

# An interpreter's start and the read-back's imports take a few seconds; this is far past them, so only a read-back
# that hangs reaches it.
READ_BACK_BOUND_S = 60.0


def test_settings_that_cannot_load_are_a_refusal(tmp_path: Path):
    """Settings that cannot be built are a configuration it could not load: nothing was judged, before any database is asked."""

    ran = subprocess.run(
        [sys.executable, "-m", "app.readback"],
        cwd=BACKEND_ROOT,
        env=environment(tmp_path, {}),
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        timeout=READ_BACK_BOUND_S,
        check=False,
    )

    assert ran.returncode == UNJUDGED, ran.stdout + ran.stderr
    # One line, the settings' own refusal as the backend's boot logs it, naming the files missing from the empty directory.
    assert re.fullmatch(r"The settings could not be loaded: [^\n]*Invalid secret files: [^\n]+\n", ran.stdout), ran.stdout


APPLICATION_ID = ObjectId("6890a1b2c3d4e5f607c00001")
CLUB_ID = ObjectId("6890a1b2c3d4e5f607c00002")
SCHULE = new_schule_document("Zorbanax")


def an_application(status: str, *, team_id: ObjectId | None, schule: dict[str, Any] | None) -> dict[str, Any]:
    """An application stored for an existing club, its status and its school then laid over as a hand edit leaves them."""

    stored = bewerbung_document(
        APPLICATION_ID,
        "2026",
        "submitted",
        kontakte=kontakte_document(ansprechperson=kontaktperson_document("Wraxlington")),
        submitted_at="2026-03-20",
        team_id=CLUB_ID,
    )

    return {**stored, "status": status, "team_id": team_id, "schule": schule}


class TestASubmittedApplicationNamesOneSchool:
    """Acceptance takes whichever it finds, so a row naming both enters a new club and drops the one the applicant picked."""

    @pytest.mark.parametrize(
        ("team_id", "schule"),
        [pytest.param(CLUB_ID, SCHULE, id="both"), pytest.param(None, None, id="neither")],
    )
    def test_the_record_refuses_both_and_neither(self, team_id: ObjectId | None, schule: dict[str, Any] | None):
        with pytest.raises(ValidationError, match="names its school by `team_id` or by `schule`"):
            FLBewerbungRecord.model_validate(an_application("submitted", team_id=team_id, schule=schule))

    def test_an_accepted_application_keeps_its_school_beside_the_club_it_became(self):
        """Acceptance writes the created club's id back beside the school it was created from."""

        FLBewerbungRecord.model_validate(an_application("accepted", team_id=CLUB_ID, schule=SCHULE))
