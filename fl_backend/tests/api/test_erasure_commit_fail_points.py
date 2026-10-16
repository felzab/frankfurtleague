"""
API · an erasure's journal at a commit the server refuses or never answers, on both erasure routes

Every case configuring `failCommand` lives in this module: the fail point is one setting the server holds for all
workers, so a second module configuring it on another worker would replace this one's configuration, and either case's
`off` would clear both. The gate's `--dist loadfile` runs one module on one worker, its cases one after another.
"""

import logging
from typing import Any

import pymongo
import pytest
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import PyMongoError

from app.api.identitaet.crud import ERASURE_JOURNAL_EVENT, UNKNOWN_COMMIT_RESULT
from app.core.db import NO_OWNER
from app.core.security import loeschung_journal_hash
from tests.whole_database import where_held

from .test_erasure_auf_anfrage import CONFIG as REQUEST_CONFIG
from .test_erasure_auf_anfrage import erased_by_the_handler as erased_on_request
from .test_erasure_auf_anfrage import journal_lines
from .test_erasure_auf_anfrage import on_a_league as on_the_administrators_league
from .test_funktionen_erasure import IDENTIFIER, THEIR_GRANT_OID, a_grant
from .test_funktionen_erasure import erased_by_the_handler as erased_by_the_person
from .test_funktionen_erasure import on_a_league as on_their_league

pytestmark = pytest.mark.db

# The client a configuration hits, chosen by its name: the commits of every other client, each seed's own among them,
# run as they would.
REFUSED_COMMIT_APP = "erasure-refused-commit"
# The server's code for a write conflict, which a commit refused under the transient label carries.
WRITE_CONFLICT = 112
# The client whose every commit lands and answers a replication timeout, so its answer never arrives.
LOST_COMMIT_APP = "erasure-lost-commit"
# The deadline the case holds around the erasure, which ends the driver's retries of that commit.
LOST_COMMIT_DEADLINE_S = 0.5
# The server's code for a write concern it could not meet in time.
WRITE_CONCERN_FAILED = 64


class TestThePersonsOwnErasure:
    def test_a_commit_whose_answer_is_lost_is_journalled_all_the_same(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Catches the journal left to a commit that answered: this one landed, and its answer was lost to the deadline.

        Every commit runs and answers a replication timeout, so the driver retries it until the case's deadline ends it.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            losing = AsyncMongoClient(mongo_replica_set_url, serverMonitoringMode="poll", appname=LOST_COMMIT_APP)
            unanswered = {
                "failCommands": ["commitTransaction"],
                "appName": LOST_COMMIT_APP,
                "writeConcernError": {"code": WRITE_CONCERN_FAILED, "errmsg": "waiting for replication timed out"},
            }
            entered = (await client.admin.command("configureFailPoint", "failCommand", mode="alwaysOn", data=unanswered))["count"]
            try:
                with pytest.raises(PyMongoError) as lost:
                    with pymongo.timeout(LOST_COMMIT_DEADLINE_S):
                        await erased_by_the_person(losing[database.name], losing)
            finally:
                left = (await client.admin.command("configureFailPoint", "failCommand", mode="off"))["count"]
                await losing.close()

            return left > entered, lost.value.has_error_label(UNKNOWN_COMMIT_RESULT), await where_held(database, IDENTIFIER)

        with caplog.at_level(logging.INFO):
            answered, labelled, after = on_their_league(mongo_replica_set_url, body)

        lines = [record.getMessage() for record in caplog.records if record.getMessage().startswith(ERASURE_JOURNAL_EVENT)]

        assert len(lines) == 1
        # The premise last: a commit ran and its answer was lost, and the erasure landed.
        assert (answered, labelled, after) == (True, True, {IDENTIFIER: []})

    def test_an_attempt_rolled_back_at_its_commit_writes_no_line(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Catches the journal written inside the callback, ahead of a commit that can still fail.

        The refusal is transient, so the driver reruns the erasure and the rerun commits: one line and one warning, none of the
        first attempt's.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            refusing = AsyncMongoClient(mongo_replica_set_url, serverMonitoringMode="poll", appname=REFUSED_COMMIT_APP)
            refusal = {
                "failCommands": ["commitTransaction"],
                "appName": REFUSED_COMMIT_APP,
                "errorCode": WRITE_CONFLICT,
                "errorLabels": ["TransientTransactionError"],
            }
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
            entered = (await client.admin.command("configureFailPoint", "failCommand", mode={"times": 1}, data=refusal))["count"]
            try:
                answer = await erased_by_the_person(refusing[database.name], refusing)
            finally:
                left = (await client.admin.command("configureFailPoint", "failCommand", mode="off"))["count"]
                await refusing.close()

            return left - entered, answer.berechtigungen

        with caplog.at_level(logging.INFO):
            refused, removed = on_their_league(mongo_replica_set_url, body)

        lines = [record for record in caplog.records if record.getMessage().startswith(ERASURE_JOURNAL_EVENT)]
        warnings = [getattr(record, "error_code", None) for record in caplog.records].count(NO_OWNER.error_code)

        assert (len(lines), warnings) == (1, 1)
        # The premise last: one commit refused, so the line counted above is the second attempt's alone.
        assert (refused, removed) == (1, 1)


class TestAnErasureOnRequest:
    def test_one_line_follows_the_commit_and_none_the_attempt_rolled_back(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """The first commit is refused under the transient label, so the driver reruns the erasure: one line, the rerun's."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            refusing = AsyncMongoClient(mongo_replica_set_url, serverMonitoringMode="poll", appname=REFUSED_COMMIT_APP)
            refusal = {
                "failCommands": ["commitTransaction"],
                "appName": REFUSED_COMMIT_APP,
                "errorCode": WRITE_CONFLICT,
                "errorLabels": ["TransientTransactionError"],
            }
            entered = (await client.admin.command("configureFailPoint", "failCommand", mode={"times": 1}, data=refusal))["count"]
            try:
                answer = await erased_on_request(refusing[database.name], refusing)
            finally:
                left = (await client.admin.command("configureFailPoint", "failCommand", mode="off"))["count"]
                await refusing.close()

            return left - entered, answer.spieler

        with caplog.at_level(logging.INFO):
            refused, erased = on_the_administrators_league(mongo_replica_set_url, body)

        assert journal_lines(caplog) == [
            f"{ERASURE_JOURNAL_EVENT} {loeschung_journal_hash(IDENTIFIER, schluessel=REQUEST_CONFIG.sperrliste_schluessel)}"
        ]
        # The premise last: one commit refused, so the line above is the rerun's alone.
        assert (refused, erased) == (1, 1)

    def test_a_commit_whose_answer_is_lost_is_journalled_all_the_same(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Catches a route journalling once its commit answers: this one landed, and its answer was lost to the deadline.

        Every commit runs and answers a replication timeout, so the driver retries it until the case's deadline ends it.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            losing = AsyncMongoClient(mongo_replica_set_url, serverMonitoringMode="poll", appname=LOST_COMMIT_APP)
            unanswered = {
                "failCommands": ["commitTransaction"],
                "appName": LOST_COMMIT_APP,
                "writeConcernError": {"code": WRITE_CONCERN_FAILED, "errmsg": "waiting for replication timed out"},
            }
            entered = (await client.admin.command("configureFailPoint", "failCommand", mode="alwaysOn", data=unanswered))["count"]
            try:
                with pytest.raises(PyMongoError) as lost:
                    with pymongo.timeout(LOST_COMMIT_DEADLINE_S):
                        await erased_on_request(losing[database.name], losing)
            finally:
                left = (await client.admin.command("configureFailPoint", "failCommand", mode="off"))["count"]
                await losing.close()

            return left > entered, lost.value.has_error_label(UNKNOWN_COMMIT_RESULT), await where_held(database, IDENTIFIER)

        with caplog.at_level(logging.INFO):
            answered, labelled, after = on_the_administrators_league(mongo_replica_set_url, body)

        assert journal_lines(caplog) == [
            f"{ERASURE_JOURNAL_EVENT} {loeschung_journal_hash(IDENTIFIER, schluessel=REQUEST_CONFIG.sperrliste_schluessel)}"
        ]
        # The premise last: a commit ran and its answer was lost, and the erasure landed.
        assert (answered, labelled, after) == (True, True, {IDENTIFIER: []})
