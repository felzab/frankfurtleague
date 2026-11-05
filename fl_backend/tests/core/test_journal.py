"""
CORE · the erasure journal's line, as the backend writes it and a restore reads it back

A line the replay cannot read back is an act a restore silently undoes, and a line carrying an address keeps one in
the host's day files for thirty days; both are pinned here without a database. The routes writing each line and the
replay reading it are `tests/api/test_journal_replay.py`'s.
"""

import asyncio
import logging
from collections.abc import Mapping
from typing import cast

import pytest
from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.errors import OperationFailure, PyMongoError

from app.core.collections import Collection
from app.core.journal import JOURNAL_TOKEN, Journal, JournalLine, lost_its_answer, parse_line
from app.core.logging import FL_LOGGER_NAME, JOURNAL_LOGGER_SUFFIX
from app.core.transactions import UNKNOWN_COMMIT_RESULT
from app.shared.einwilligung_evidence import FLEinwilligungChoice

PERSON = "a" * 64
PSEUDONYM = "c" * 64
HALTER = "d" * 64
BEFORE = "e" * 64
RECORD = ObjectId("6890a1b2c3d4e5f607860001")
AT = "2026-10-15T10:00:00+00:00"
JOURNAL_LOGGER = f"{FL_LOGGER_NAME}.{JOURNAL_LOGGER_SUFFIX}"

LINES = {
    "an erasure": JournalLine(person_hash=PERSON, art="erasure", pseudonym=PSEUDONYM, halter=HALTER),
    # As every erasure was journalled before the line named its holder digest.
    "an erasure naming no holder": JournalLine(person_hash=PERSON, art="erasure", pseudonym=PSEUDONYM),
    # As every erasure was journalled before the line named its pseudonym.
    "an older erasure": JournalLine(person_hash=PERSON, art="erasure"),
    "a withdrawal": JournalLine(
        person_hash=PERSON,
        art="withdrawal",
        collection=Collection.SPIELER,
        record_id=RECORD,
        at=AT,
        text_versions={"scope": "2026-11-name-kader-1", "media": "2026-11-medien-1"},
        choices={"scope": "intern", "media": False},
    ),
    "a Widerspruch": JournalLine(
        person_hash=PERSON, art="objection", collection=Collection.BEWERBUNGEN, record_id=RECORD, at=AT, seats=("trainer", "ansprechperson")
    ),
    "a declined address change": JournalLine(
        person_hash=PERSON, art="address_change_declined", collection=Collection.ADDRESS_CHANGES, record_id=RECORD, at=AT
    ),
    "a discarded address change": JournalLine(
        person_hash=PERSON, art="address_change_discarded", collection=Collection.ADDRESS_CHANGES, record_id=RECORD, at=AT
    ),
    "a discarded address change whose new mailbox was told": JournalLine(
        person_hash=PERSON, art="address_change_discarded_notified", collection=Collection.ADDRESS_CHANGES, record_id=RECORD, at=AT
    ),
    "a refused request": JournalLine(
        person_hash=PERSON, art="approval_request_declined", collection=Collection.GRANT_APPROVAL_REQUESTS, record_id=RECORD, at=AT
    ),
    "a withdrawn request": JournalLine(
        person_hash=PERSON, art="approval_request_withdrawn", collection=Collection.GRANT_APPROVAL_REQUESTS, record_id=RECORD, at=AT
    ),
    "a request an address change ended": JournalLine(
        person_hash=PERSON, art="approval_request_ended", collection=Collection.GRANT_APPROVAL_REQUESTS, record_id=RECORD, at=AT
    ),
    "an address change taking effect": JournalLine(
        person_hash=PERSON, art="address_change_effective", collection=Collection.ADDRESS_CHANGES, record_id=RECORD, at=AT, before=BEFORE
    ),
}


def test_an_erasure_is_spelled_as_the_export_and_the_restore_read_it():
    """Written out rather than composed: a change to the line's spelling is a change to every day file's."""
    assert LINES["an erasure"].text() == f"{JOURNAL_TOKEN} {PERSON} erasure pseudonym={PSEUDONYM} halter={HALTER}"
    assert LINES["an erasure naming no holder"].text() == f"{JOURNAL_TOKEN} {PERSON} erasure pseudonym={PSEUDONYM}"
    assert LINES["an older erasure"].text() == f"{JOURNAL_TOKEN} {PERSON} erasure"
    assert LINES["a withdrawal"].text() == (
        f"{JOURNAL_TOKEN} {PERSON} withdrawal spieler/{RECORD} at={AT} text_version.scope=2026-11-name-kader-1 "
        "text_version.media=2026-11-medien-1 scope=intern media=false"
    )
    assert (
        LINES["an address change taking effect"].text()
        == f"{JOURNAL_TOKEN} {PERSON} address_change_effective address_changes/{RECORD} at={AT} before={BEFORE}"
    )


@pytest.mark.parametrize("line", LINES.values(), ids=LINES.keys())
def test_every_act_reads_back_as_it_was_written(line: JournalLine):
    assert parse_line(line.text()) == line


@pytest.mark.parametrize("line", LINES.values(), ids=LINES.keys())
def test_the_replay_names_a_line_by_its_act_alone(line: JournalLine):
    """The log outlives the day files by eleven months, so a replay's row names no keyed hash; nor the token, which reads as an erasure."""
    assert line.act().startswith(line.art)
    assert all(keyed not in line.act() for keyed in (PERSON, PSEUDONYM, HALTER, BEFORE, JOURNAL_TOKEN))


@pytest.mark.parametrize(
    "message",
    [
        pytest.param(f"{JOURNAL_TOKEN} {PERSON}", id="no act"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} vergessen", id="an act nothing replays"),
        pytest.param(f"{JOURNAL_TOKEN} anna@example.com erasure", id="an address for the hash"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} erasure spieler/{RECORD}", id="an erasure naming a record"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} withdrawal spieler/{RECORD} at={AT} media=false", id="a withdrawal without its label"),
        pytest.param(
            f"{JOURNAL_TOKEN} {PERSON} withdrawal spieler/{RECORD} at={AT} text_version.media=2026-11-medien-1 media=true", id="a grant"
        ),
        pytest.param(
            f"{JOURNAL_TOKEN} {PERSON} withdrawal spieler/{RECORD} at={AT} text_version.scope=2026-11-name-kader-1 scope=x@y.de",
            id="an address as a value",
        ),
        pytest.param(
            f"{JOURNAL_TOKEN} {PERSON} withdrawal spieler/{RECORD} at=2026-10-15T10:00:00 text_version.scope=v scope=intern", id="no offset"
        ),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} objection spieler/{RECORD} at={AT} seats=trainer", id="a Widerspruch on a pupil"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} objection bewerbungen/{RECORD} at={AT}", id="a Widerspruch naming no seat"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} address_change_declined address_changes/{RECORD} at={AT} at={AT}", id="a value twice"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} address_change_declined nirgends/{RECORD} at={AT}", id="no collection the database holds"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} address_change_declined spieler/{RECORD} at={AT}", id="an address change on a pupil row"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} address_change_declined address_changes/{'z' * 24} at={AT}", id="an id of no hex"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} address_change_declined address_changes/abcdefghijkl at={AT}", id="an id twelve letters long"),
        pytest.param(
            f"{JOURNAL_TOKEN} {PERSON} address_change_declined address_changes/{RECORD} at={AT} pseudonym={PSEUDONYM}",
            id="a choice naming a pseudonym",
        ),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} erasure pseudonym=anna@example.com", id="an address for the pseudonym"),
        pytest.param(
            f"{JOURNAL_TOKEN} {PERSON} address_change_declined address_changes/{RECORD} at={AT} halter={HALTER}",
            id="a choice naming a holder digest",
        ),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} erasure halter=anna@example.com", id="an address for the holder digest"),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} address_change_declined address_changes/{RECORD} at={AT} wer=ich", id="a value no act carries"),
        pytest.param(
            f"{JOURNAL_TOKEN} {PERSON} address_change_effective address_changes/{RECORD} at={AT}", id="an effect naming no replaced address"
        ),
        pytest.param(
            f"{JOURNAL_TOKEN} {PERSON} address_change_discarded address_changes/{RECORD} at={AT} before={BEFORE}",
            id="a discard naming a replaced address",
        ),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} erasure before={BEFORE}", id="an erasure naming a replaced address"),
        pytest.param(
            f"{JOURNAL_TOKEN} {PERSON} address_change_effective address_changes/{RECORD} at={AT} before=anna@example.com",
            id="an address for the replaced one",
        ),
        pytest.param(
            f"{JOURNAL_TOKEN} {PERSON} withdrawal spieler/{RECORD} at={AT} text_version=2026-10-konto-spieler "
            "text_version.media=2026-11-medien-1 media=false",
            id="a press's label beside a choice's",
        ),
        pytest.param(
            f"{JOURNAL_TOKEN} {PERSON} withdrawal spieler/{RECORD} at={AT} text_version=a text_version=b media=false", id="two press labels"
        ),
        pytest.param(
            f"{JOURNAL_TOKEN} {PERSON} withdrawal spiele/{RECORD} at={AT} text_version=2026-10-konto media=false",
            id="a press's label on a collection holding no consent",
        ),
        pytest.param(f"{JOURNAL_TOKEN} {PERSON} withdrawal at={AT} text_version=2026-10-konto media=false", id="a press's label on no record"),
    ],
)
def test_a_line_nothing_could_replay_is_refused_rather_than_read(message: str):
    with pytest.raises(ValueError):
        parse_line(message)


@pytest.mark.parametrize(
    ("collection", "labels"),
    [
        pytest.param(Collection.SPIELER, {"scope": "2026-11-name-kader-1", "media": "2026-11-medien-1"}, id="a pupil"),
        pytest.param(Collection.REGISTRIERUNGEN, {"scope": "2026-11-name-kader-1", "media": "2026-11-medien-1"}, id="a registration"),
        pytest.param(Collection.SCHIEDSRICHTER, {"scope": "2026-11-name-spielplan-1", "media": "2026-11-medien-1"}, id="a referee"),
        pytest.param(Collection.SAISON_TEAMS, {"scope": "2026-11-whatsapp-1", "media": "2026-11-medien-1"}, id="a contact seat"),
        pytest.param(Collection.BEWERBUNGEN, {"scope": "2026-11-whatsapp-1", "media": "2026-11-medien-1"}, id="an application's seat"),
    ],
)
def test_a_withdrawal_naming_one_label_for_its_press_replays_under_its_kinds_labels(
    collection: Collection, labels: Mapping[FLEinwilligungChoice, str]
):
    """An older day file's spelling: refused, the restore would leave every such withdrawal's consent restored."""

    scope = "intern" if collection in (Collection.SPIELER, Collection.REGISTRIERUNGEN, Collection.SCHIEDSRICHTER) else "kontaktdaten"
    line = parse_line(f"{JOURNAL_TOKEN} {PERSON} withdrawal {collection}/{RECORD} at={AT} text_version=2026-10-konto scope={scope} media=false")

    assert line == JournalLine(
        person_hash=PERSON,
        art="withdrawal",
        collection=collection,
        record_id=RECORD,
        at=AT,
        text_versions=labels,
        choices={"scope": scope, "media": False},
    )


def _committed(journal: Journal, caplog: pytest.LogCaptureFixture, *, failure: BaseException | None, attempts: int = 1) -> list[str]:
    """The lines a write's block leaves behind, its callback noting one line per attempt and the block ending on `failure`."""

    async def write(_session: AsyncClientSession, attempt: int) -> None:
        journal.note(JournalLine(person_hash=f"{attempt:064x}", art="erasure"))

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
        assert _committed(Journal(), caplog, failure=None, attempts=3) == [f"{JOURNAL_TOKEN} {2:064x} erasure"]

    def test_a_commit_whose_answer_was_lost_journals_all_the_same(self, caplog: pytest.LogCaptureFixture):
        assert lost_its_answer(LOST)
        assert _committed(Journal(), caplog, failure=LOST) == [f"{JOURNAL_TOKEN} {0:064x} erasure"]

    @pytest.mark.parametrize("failure", [OperationFailure("refused"), ValueError("a refusal")], ids=("a driver's", "a refusal"))
    def test_a_failed_write_journals_nothing(self, caplog: pytest.LogCaptureFixture, failure: BaseException):
        assert not lost_its_answer(failure)
        assert _committed(Journal(), caplog, failure=failure) == []
