import pymongo
from httpx2 import Response

from app.core.codes import Code
from tests.app_client import app_client
from tests.config import UNANSWERED_DEADLINE_S, UNANSWERED_URI

IS_READY = "/api/system/is_ready"


async def asked_with_no_database() -> Response:
    """The response rather than the client, which `app_client` closes as its block ends."""

    async with app_client(UNANSWERED_URI) as http:
        with pymongo.timeout(UNANSWERED_DEADLINE_S):
            return await http.get(IS_READY)


# No `db` marker: the database is the one that never answers. The 200 is the db tier's sweep of every
# read (`tests/api/test_every_read_answers.py`), which asks this route with no key in every phase.
async def test_a_database_that_does_not_answer_makes_the_backend_unready():
    """A 503 a monitor reads as not ready, with nothing of the driver's error: its message names the hosts it tried."""

    response = await asked_with_no_database()

    body = response.json()
    assert response.status_code == 503
    assert {key: value for key, value in body.items() if key != "trace_id"} == {"error_code": Code.DATABASE_FAILED, "fields": []}
