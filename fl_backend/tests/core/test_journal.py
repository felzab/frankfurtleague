import json
import logging

import pytest

from app.core.journal import PART_ENTRIES_MAX, privacy_line
from app.core.logging import JSONFormatter

# `daemon/logger/copier.go :: defaultBufSize` in moby, past which a line reaches no `grep` whole.
DOCKER_LINE_BYTES = 16 * 1024

OBJECT_ID = "6890a1b2c3d4e5f607b00031"
# The longest entries a line holds, past what one line carries, as a former owner's several hundred rows are.
SEATS = [f"saison_teams/{OBJECT_ID}/stellvertretung/2126-03-21"] * (2 * PART_ENTRIES_MAX)
ROWS = [f"registrierungen/{OBJECT_ID}/decision.by"] * (3 * PART_ENTRIES_MAX + 1)


def lines_of(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [JSONFormatter().format(record) for record in caplog.records if record.getMessage() == "journal.act"]


def test_an_act_past_one_line_spans_lines_docker_leaves_whole_and_a_reader_joins(caplog: pytest.LogCaptureFixture):
    """A cut line reaches no `grep`, so a restore's replay would miss every entry past the cut and bring those people back."""

    with caplog.at_level(logging.INFO):
        privacy_line("erasure", ["grants/1"], seats=SEATS, rows=ROWS)

    lines = lines_of(caplog)
    parsed = [json.loads(line) for line in lines]

    assert max(len(line.encode()) for line in lines) < DOCKER_LINE_BYTES
    assert len({line["act_id"] for line in parsed}) == 1
    assert [(line["part"], line["parts"]) for line in parsed] == [(part, len(lines)) for part in range(1, len(lines) + 1)]
    assert [entry for line in parsed for entry in line["records"]] == ["grants/1"]
    assert [entry for line in parsed for entry in line["seats"]] == SEATS
    assert [entry for line in parsed for entry in line["rows"]] == ROWS


def test_an_act_naming_nothing_still_writes_its_line(caplog: pytest.LogCaptureFixture):
    """A line naming nothing took a sign-in account alone, and the runbook reads it as that: no line would read as no erasure."""

    with caplog.at_level(logging.INFO):
        privacy_line("erasure", [])

    [line] = [json.loads(line) for line in lines_of(caplog)]

    assert (line["part"], line["parts"], line["records"], line["rows"]) == (1, 1, [], [])
