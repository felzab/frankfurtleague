"""
API · the administration's reads of the referees: where each entry stands, and nothing of the person past what a page shows

The chip and the confirmation line of the list and the editor read the served state alone, so a wrong state sends an
administrator after the wrong referee, and nothing on a page would show it.
"""

from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.schiedsrichter.admin_router import get_schiedsrichter, get_schiedsrichter_by_id
from app.api.schiedsrichter.services import entry_state_of
from app.core.collections import Collection
from tests.database import a_clean_database
from tests.documents import confirmed_referee_document, schiedsrichter_document
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_schiedsrichter_admin_read_test")

TODAY = "2026-11-19"
YESTERDAY = "2026-11-18"

ANSWERED = {"confirmed_at": "2026-11-03"}


def link(deadline: str) -> dict[str, Any]:
    """A link block as the hand-out stores it, its deadline what the state is judged by."""

    return {"token_hashes": [], "sent_at": "2026-11-01", "deadline": deadline}


@pytest.mark.parametrize(
    ("einwilligung", "confirmation", "state"),
    [
        pytest.param(ANSWERED, link(YESTERDAY), "confirmed", id="an answer over a lapsed link"),
        pytest.param(ANSWERED, None, "confirmed", id="an answer whose link was retired"),
        pytest.param(None, link(TODAY), "valid", id="a link on its last day"),
        pytest.param(None, link(YESTERDAY), "expired", id="a link past its last day"),
        pytest.param(None, None, "unasked", id="no link and no answer"),
    ],
)
def test_where_an_entry_stands(einwilligung: Mapping[str, Any] | None, confirmation: Mapping[str, Any] | None, state: str):
    assert entry_state_of(einwilligung=einwilligung, confirmation=confirmation, today=TODAY) == state


ANNA_OID = ObjectId("6890a1b2c3d4e5f608510001")
BEN_OID = ObjectId("6890a1b2c3d4e5f608510002")
CARL_OID = ObjectId("6890a1b2c3d4e5f608510003")
DORA_OID = ObjectId("6890a1b2c3d4e5f608510004")

Body = Callable[[AsyncDatabase], Awaitable[Any]]


async def on_a_league(url: str, body: Body) -> Any:
    """Four referees, one in each state: Anna confirmed, Ben asked, Carl's link lapsed, Dora retired and never asked."""

    async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
        await database[Collection.SCHIEDSRICHTER].insert_many(
            [
                confirmed_referee_document(
                    ANNA_OID, "anna@example.org", "Anna Arndt", confirmed_at="2026-11-03", confirmation=link(YESTERDAY), birth_date="2008-05-17"
                ),
                schiedsrichter_document(
                    BEN_OID, email="ben@example.org", name="Ben Berg", default_payment=20, einwilligung=None, confirmation=link(TODAY)
                ),
                schiedsrichter_document(
                    CARL_OID, email="carl@example.org", name="Carl Cramer", default_payment=20, einwilligung=None, confirmation=link(YESTERDAY)
                ),
                schiedsrichter_document(
                    DORA_OID, email="dora@example.org", name="Dora Dorn", default_payment=20, einwilligung=None, inactive_since="2026-10-01"
                ),
            ]
        )

        return await body(database)


def keys_anywhere(served: Any) -> set[str]:
    """Every key the served answer holds, however deep."""

    if isinstance(served, Mapping):
        return {*served.keys(), *(key for value in served.values() for key in keys_anywhere(value))}
    if isinstance(served, list):
        return {key for value in served for key in keys_anywhere(value)}
    return set()


@pytest.mark.db
class TestTheAdministrationsReads:
    async def test_the_list_serves_each_referee_where_their_entry_stands(self, mongo_replica_set_url: str):
        """Its read is projected, so a state judged on a field the projection drops reads every referee as never asked."""

        async def body(database: AsyncDatabase) -> Any:
            return await get_schiedsrichter(schiedsrichter_collection=database[Collection.SCHIEDSRICHTER], today=TODAY)

        listed = await on_a_league(mongo_replica_set_url, body)

        assert [(row.name, row.state) for row in listed.schiedsrichter] == [
            ("Anna Arndt", "confirmed"),
            ("Ben Berg", "valid"),
            ("Carl Cramer", "expired"),
            ("Dora Dorn", "unasked"),
        ]

    async def test_neither_read_serves_a_birthdate_or_the_consents_evidence(self, mongo_replica_set_url: str):
        """Both are stored for the age check and the proof, and no page of the administration shows either."""

        async def body(database: AsyncDatabase) -> tuple[Any, Any]:
            listed = await get_schiedsrichter(schiedsrichter_collection=database[Collection.SCHIEDSRICHTER], today=TODAY)
            editor = await get_schiedsrichter_by_id(
                schiedsrichter_id=ANNA_OID,
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                outbox_collection=database[Collection.OUTBOX],
                today=TODAY,
            )
            return listed.model_dump(mode="json", by_alias=True), editor.model_dump(mode="json", by_alias=True)

        listed, editor = await on_a_league(mongo_replica_set_url, body)

        assert keys_anywhere(listed) & {"birth_date", "evidence", "einwilligung"} == set()
        assert keys_anywhere(editor) & {"birth_date", "evidence"} == set()
        assert (editor["schiedsrichter"]["state"], editor["schiedsrichter"]["einwilligung"]["confirmed_at"]) == ("confirmed", "2026-11-03")
