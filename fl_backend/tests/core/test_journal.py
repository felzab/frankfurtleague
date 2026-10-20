"""
CORE · the erasure journal's line, as the backend writes it and a restore reads it back

A line the replay cannot read back is an act a restore silently undoes, and a line carrying an address keeps one in
the host's day files for thirty days; both are pinned here without a database. The routes writing each line and the
replay reading it are `tests/api/test_journal_replay.py`'s.
"""

import asyncio
import logging
from typing import cast

import pytest
from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.errors import OperationFailure, PyMongoError

from app.core.collections import Collection
from app.core.journal import JOURNAL_TOKEN, Journal, JournalLine, lost_its_answer, parse_line
from app.core.logging import FL_LOGGER_NAME, JOURNAL_LOGGER_SUFFIX
from app.core.transactions import UNKNOWN_COMMIT_RESULT

PERSON = "a" * 64
PSEUDONYM = "c" * 64
HALTER = "d" * 64
ZUVOR = "e" * 64
RECORD = ObjectId("6890a1b2c3d4e5f607860001")
AM = "2026-10-15T10:00:00+00:00"
JOURNAL_LOGGER = f"{FL_LOGGER_NAME}.{JOURNAL_LOGGER_SUFFIX}"

LINES = {
    "an erasure": JournalLine(person_hash=PERSON, art="loeschung", pseudonym=PSEUDONYM, halter=HALTER),
    # As every erasure was journalled before the line named its holder digest.
    "an erasure naming no holder": JournalLine(person_hash=PERSON, art="loeschung", pseudonym=PSEUDONYM),
    # As every erasure was journalled before the line named its pseudonym.
    "an older erasure": JournalLine(person_hash=PERSON, art="loeschung"),
    "a withdrawal": JournalLine(
        person_hash=PERSON,
        art="widerruf",
        collection=Collection.SPIELER,
        record_id=RECORD,
        am=AM,
        text_version="2026-10-konto-spieler",
        wahlen={"umfang": "intern", "medien": False},
    ),
    "a Widerspruch": JournalLine(
        person_hash=PERSON, art="widerspruch", collection=Collection.BEWERBUNGEN, record_id=RECORD, am=AM, sitze=("trainer", "ansprechperson")
    ),
    "a declined address change": JournalLine(
        person_hash=PERSON, art="adresswechsel_abgelehnt", collection=Collection.ADRESSWECHSEL, record_id=RECORD, am=AM
    ),
    "a discarded address change": JournalLine(
        person_hash=PERSON, art="adresswechsel_verworfen", collection=Collection.ADRESSWECHSEL, record_id=RECORD, am=AM
    ),
    "an address change taking effect": JournalLine(
        person_hash=PERSON, art="adresswechsel_wirksam", collection=Collection.ADRESSWECHSEL, record_id=RECORD, am=AM, zuvor=ZUVOR
    ),
}


def test_an_erasure_is_spelled_as_the_export_and_the_restore_read_it():
    """Written out rather than composed: a change to the line's spelling is a change to every day file's."""
    assert LINES["an erasure"].text() == f"{JOURNAL_TOKEN} {PERSON} loeschung pseudonym={PSEUDONYM} halter={HALTER}"
    assert LINES["an erasure naming no holder"].text() == f"{JOURNAL_TOKEN} {PERSON} loeschung pseudonym={PSEUDONYM}"
    assert LINES["an older erasure"].text() == f"{JOURNAL_TOKEN} {PERSON} loeschung"
    assert LINES["a withdrawal"].text() == (
        f"{JOURNAL_TOKEN} {PERSON} widerruf spieler/{RECORD} am={AM} text_version=2026-10-konto-spieler umfang=intern medien=false"
    )
    assert (
        LINES["an address change taking effect"].text()
        == f"{JOURNAL_TOKEN} {PERSON} adresswechsel_wirksam adresswechsel/{RECORD} am={AM} zuvor={ZUVOR}"
    )


@pytest.mark.parametrize("line", LINES.values(), ids=LINES.keys())
def test_every_act_reads_back_as_it_was_written(line: JournalLine):
    assert parse_line(line.text()) == line


@pytest.mark.parametrize("line", LINES.values(), ids=LINES.keys())
def test_the_replay_names_a_line_by_its_act_alone(line: JournalLine):
    """The log outlives the day files by eleven months, so a replay's row names no keyed hash; nor the token, which reads as an erasure."""
    assert line.act().startswith(line.art)
    assert all(keyed not in line.act() for keyed in (PERSON, PSEUDONYM, HALTER, ZUVOR, JOURNAL_TOKEN))


def test_a_message_of_another_kind_is_no_line():
    assert parse_line("The grants went unchecked after an erasure: OperationFailure") is None


@pytest.mark.parametrize(
    "message",
    [
        pytest.param(f"{JOURNAL_TOKEN} {PERSON}", id="no act"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} vergessen", id="an act nothing replays"),
        pytest.param(f"{JOURNAL_TOKEN} anna@example.com loeschung", id="an address for the hash"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} loeschung spieler/{RECORD}", id="an erasure naming a record"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} widerruf spieler/{RECORD} am={AM} medien=false", id="a withdrawal without its label"),
        pytest.param(
            f"{JOURNAL_TOKEN} {PERSON} widerruf spieler/{RECORD} am={AM} text_version=2026-10-konto-spieler medien=true", id="a grant"
        ),
        pytest.param(
            f"{JOURNAL_TOKEN} {PERSON} widerruf spieler/{RECORD} am={AM} text_version=2026-10-konto-spieler umfang=x@y.de",
            id="an address as a value",
        ),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} widerruf spieler/{RECORD} am=2026-10-15T10:00:00 text_version=v umfang=intern", id="no offset"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} widerspruch spieler/{RECORD} am={AM} sitze=trainer", id="a Widerspruch on a pupil"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} widerspruch bewerbungen/{RECORD} am={AM}", id="a Widerspruch naming no seat"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} adresswechsel_abgelehnt adresswechsel/{RECORD} am={AM} am={AM}", id="a value twice"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} adresswechsel_abgelehnt nirgends/{RECORD} am={AM}", id="no collection the database holds"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} adresswechsel_abgelehnt spieler/{RECORD} am={AM}", id="an address change on a pupil row"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} adresswechsel_abgelehnt adresswechsel/{'z' * 24} am={AM}", id="an id of no hex"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} adresswechsel_abgelehnt adresswechsel/abcdefghijkl am={AM}", id="an id twelve letters long"),
        pytest.param(
            f"{JOURNAL_TOKEN} {PERSON} adresswechsel_abgelehnt adresswechsel/{RECORD} am={AM} pseudonym={PSEUDONYM}",
            id="a choice naming a pseudonym",
        ),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} loeschung pseudonym=anna@example.com", id="an address for the pseudonym"),
        pytest.param(
            f"{JOURNAL_TOKEN} {PERSON} adresswechsel_abgelehnt adresswechsel/{RECORD} am={AM} halter={HALTER}",
            id="a choice naming a holder digest",
        ),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} loeschung halter=anna@example.com", id="an address for the holder digest"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} adresswechsel_abgelehnt adresswechsel/{RECORD} am={AM} wer=ich", id="a value no act carries"),
        pytest.param(
            f"{JOURNAL_TOKEN} {PERSON} adresswechsel_wirksam adresswechsel/{RECORD} am={AM}", id="an effect naming no replaced address"
        ),
        pytest.param(
            f"{JOURNAL_TOKEN} {PERSON} adresswechsel_verworfen adresswechsel/{RECORD} am={AM} zuvor={ZUVOR}",
            id="a discard naming a replaced address",
        ),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} loeschung zuvor={ZUVOR}", id="an erasure naming a replaced address"),
        pytest.param(
            f"{JOURNAL_TOKEN} {PERSON} adresswechsel_wirksam adresswechsel/{RECORD} am={AM} zuvor=anna@example.com",
            id="an address for the replaced one",
        ),
    ],
)
def test_a_line_nothing_could_replay_is_refused_rather_than_read(message: str):
    with pytest.raises(ValueError):
        parse_line(message)


def _committed(journal: Journal, caplog: pytest.LogCaptureFixture, *, failure: BaseException | None, attempts: int = 1) -> list[str]:
    """The lines a write's block leaves behind, its callback noting one line per attempt and the block ending on `failure`."""

    async def write(_session: AsyncClientSession, attempt: int) -> None:
        journal.note(JournalLine(person_hash=f"{attempt:064x}", art="loeschung"))

    async def block() -> None:
        async with journal:
            for attempt in range(attempts):
                # No database: the journal reads nothing off the session it hands on.
                await journal.attempted(write)(cast(AsyncClientSession, None), attempt)
            if failure is not None:
                raise failure

    with caplog.at_level(logging.INFO, logger=JOURNAL_LOGGER):
        if failure is None:
            asyncio.run(block())
        else:
            with pytest.raises(type(failure)):
                asyncio.run(block())

    return [record.getMessage() for record in caplog.records if record.name == JOURNAL_LOGGER]


# What a commit whose answer never came raises.
LOST = PyMongoError("commit unanswered", error_labels=[UNKNOWN_COMMIT_RESULT])


class TestTheJournalAroundAWrite:
    def test_a_committed_write_journals_what_its_last_attempt_noted(self, caplog: pytest.LogCaptureFixture):
        """Three attempts, so a line noted by an attempt the driver ran again is not written beside the last one's."""
        assert _committed(Journal(), caplog, failure=None, attempts=3) == [f"{JOURNAL_TOKEN} {2:064x} loeschung"]

    def test_a_commit_whose_answer_was_lost_journals_all_the_same(self, caplog: pytest.LogCaptureFixture):
        assert lost_its_answer(LOST)
        assert _committed(Journal(), caplog, failure=LOST) == [f"{JOURNAL_TOKEN} {0:064x} loeschung"]

    @pytest.mark.parametrize("failure", [OperationFailure("refused"), ValueError("a refusal")], ids=("a driver's", "a refusal"))
    def test_a_failed_write_journals_nothing(self, caplog: pytest.LogCaptureFixture, failure: BaseException):
        assert not lost_its_answer(failure)
        assert _committed(Journal(), caplog, failure=failure) == []
