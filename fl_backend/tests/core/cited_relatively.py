"""
CORE · a cited test class asserting on a relatively imported name, for the rule reading's own case

Parsed by `fl_backend/tests/core/test_domain.py :: test_a_cited_class_asserting_on_a_relatively_imported_name_is_read`
and never run: pytest collects no file of this name, and nothing imports it.
"""

# Relative on purpose, the spelling the suites under `tests/api/` import their siblings in: an absolute
# import passes the case whatever the reading does with a level.
from .app_source import SESSION_TYPE_MODULE


class TestAssertsOnARelativelyImportedName:
    def test_names_it(self):
        assert SESSION_TYPE_MODULE
