import re

from app.core.crud import literal_pattern

# A NUL beside every character a pattern gives a meaning to. Python's `re` takes a raw NUL, so this
# case stays green with the NUL left unescaped: only a real server refuses one, and the erasure's
# database case is what reads the escape.
LITERAL = "a\x00.*+?^$()[]{}|\\/ -#b"


class TestLiteralPattern:
    def test_the_pattern_matches_the_value_and_nothing_wider(self):
        pattern = re.compile(literal_pattern(LITERAL))

        assert pattern.fullmatch(LITERAL)
        assert not pattern.fullmatch(LITERAL.replace(".", "x"))
