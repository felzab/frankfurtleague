import re
from collections.abc import Mapping
from typing import Any, cast

import pytest

from app.core.crud import literal_pattern, pull_whole_from_db
from app.core.readonly import ReadCollection
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT

# A NUL beside every character a pattern gives a meaning to. Python's `re` takes a raw NUL, so this
# case stays green with the NUL left unescaped: only a real server refuses one, and the erasure's
# database case is what reads the escape.
LITERAL = "a\x00.*+?^$()[]{}|\\/ -#b"


class TestLiteralPattern:
    def test_the_pattern_matches_the_value_and_nothing_wider(self):
        pattern = re.compile(literal_pattern(LITERAL))

        assert pattern.fullmatch(LITERAL)
        assert not pattern.fullmatch(LITERAL.replace(".", "x"))


class _Rows:
    """`count` documents, called as `pull_many_from_db` calls the driver: `find`, then `limit`, then `to_list`."""

    def __init__(self, count: int) -> None:
        self.documents = [{"spiel_nr": nr} for nr in range(1, count + 1)]

    def find(self, **_: Any) -> _Rows:
        return self

    def limit(self, count: int) -> _Rows:
        # Truncating, as the server does: the cut a judgement reading the page that fits would never see.
        self.documents = self.documents[:count]
        return self

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return self.documents


async def pulled_whole(count: int) -> list[Mapping[str, Any]]:
    return await pull_whole_from_db(collection=cast(ReadCollection, _Rows(count)), db_filter={}, what="season 2026's fixtures")


class TestPullWholeFromDb:
    """A judgement over a whole set writes back what it derived, so a set it could not read whole is a wrong result committed."""

    async def test_a_set_past_the_cap_is_refused(self):
        with pytest.raises(ValueError, match=f"season 2026's fixtures number more than {LIST_LIMIT_DEFAULT}"):
            await pulled_whole(LIST_LIMIT_DEFAULT + 1)

    async def test_a_set_filling_the_cap_is_read_whole(self):
        assert len(await pulled_whole(LIST_LIMIT_DEFAULT)) == LIST_LIMIT_DEFAULT
