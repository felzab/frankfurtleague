import asyncio

import pymongo
from httpx2 import Response

from app.core.codes import Code
from tests.app_client import app_client
from tests.config import UNANSWERED_DEADLINE_S, UNANSWERED_URI

IS_READY = "/api/v0/system/is_ready"


def asked_with_no_database() -> Response:
    """The response, never the client: the driver binds a client to the loop it first ran on."""

    async def _asked() -> Response:
        async with app_client(UNANSWERED_URI) as http:
            with pymongo.timeout(UNANSWERED_DEADLINE_S):
                return await http.get(IS_READY)

    return asyncio.run(_asked())


# No `db` marker: the database is the one that never answers. The 200 is the db tier's sweep of every
# read (`tests/api/test_every_read_answers.py`), which asks this route with no key in every phase.
def test_a_database_that_does_not_answer_makes_the_backend_unready():
    """A 503 a monitor reads as not ready, with nothing of the driver's error: its message names the hosts it tried."""

    response = asked_with_no_database()

    body = response.json()
    assert (response.status_code, response.headers.get("Retry-After")) == (503, "30")
    assert {key: value for key, value in body.items() if key != "trace_id"} == {"error_code": Code.DATABASE_FAILED, "fields": []}
