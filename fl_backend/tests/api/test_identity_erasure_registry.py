from datetime import UTC, datetime
from typing import Any

import pytest

from app.api.outbox.schemas import FLAddressChangeEffectiveData, FLDeletionNoticeData
from app.api.outbox.services import DELIVERY_DEADLINE, OwedMail, row_of

IDENTIFIER = "zorbanax.quillfeather@example.org"

NOW = datetime(2126, 4, 1, 12, 30, tzinfo=UTC)


@pytest.mark.parametrize(
    "data",
    [
        pytest.param(FLDeletionNoticeData(kind="deletion_notice", saison_id=None), id="the notice an erasure spares"),
        pytest.param(FLAddressChangeEffectiveData(kind="address_change_effective", instant=NOW), id="the replaced address's"),
    ],
)
def test_a_row_no_erasure_reaches_goes_at_its_deadline(data: Any):
    """Catches the row kept a retention longer: it holds an address the person's erasure no longer finds, past the erasure."""

    row = row_of(OwedMail(key="a-key", to=IDENTIFIER, data=data), now=NOW, secret=None, valid_until=None)

    assert row["erase_at"] == NOW + DELIVERY_DEADLINE
