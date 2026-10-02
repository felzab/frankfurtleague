import asyncio
from datetime import UTC, datetime

import pytest
from pymongo.errors import InvalidURI

from app.core.dependencies import get_germany_now
from app.main import create_app
from tests.app_client import app_client
from tests.config import build_test_config

# Refused by the driver's constructor before anything is sent, which puts the raise after the
# overrides are applied and before any request.
REFUSED_URI = "nosuchscheme://nowhere"

NOW = datetime(2026, 4, 1, 12, tzinfo=UTC)


def test_an_app_whose_client_fails_to_build_leaves_with_the_overrides_it_came_with() -> None:
    """The overrides the case asked for are applied before the client: left on, they would answer the next case's actor check."""

    app = create_app(build_test_config())

    def held_before() -> datetime:
        return NOW

    app.dependency_overrides[get_germany_now] = held_before

    async def _serve() -> None:
        async with app_client(REFUSED_URI, app=app, now=NOW, admitting=["zorbanax@beispielschule.de"]):
            pytest.fail("the client was built from a URI its driver refuses")

    with pytest.raises(InvalidURI):
        asyncio.run(_serve())

    assert app.dependency_overrides == {get_germany_now: held_before}
    assert not hasattr(app.state, "db_client")
