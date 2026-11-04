"""
API · the account read's rows, back in each arm's own order whatever order the union streamed them in

A union's arms come back in no stated order, so a page listing a person's seasons out of order would fail nothing in
the database tier, whose single server streams each arm whole.
"""

import random
from typing import Any

from app.api.account.services import account_arms


def test_each_arm_reads_back_in_its_own_rank_whatever_order_the_union_streamed():
    rows: list[dict[str, Any]] = [{"_arm": arm, "_rank": rank, "id": f"{arm}-{rank}"} for arm in ("seats", "bewerbungen") for rank in (1, 2, 3)]
    streamed = rows[:]
    random.Random(4).shuffle(streamed)
    # The control: a shuffle leaving an arm in order would pass a read that keeps the stream's order.
    assert [row["id"] for row in streamed if row["_arm"] == "seats"] != ["seats-1", "seats-2", "seats-3"]

    arms = account_arms(streamed)

    assert [row["id"] for row in arms["seats"]] == ["seats-1", "seats-2", "seats-3"]
    assert [row["id"] for row in arms["bewerbungen"]] == ["bewerbungen-1", "bewerbungen-2", "bewerbungen-3"]
    assert arms["spieler"] == arms["schiedsrichter"] == arms["registrierungen"] == []
