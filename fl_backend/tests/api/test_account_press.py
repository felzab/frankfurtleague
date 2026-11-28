"""
API · which choices an account press's journal line says it withdrew

A restore replays this line: a kept choice named on it takes a consent back from a person who gave it.
"""

from app.api.account.services import withdrawal_line


class TestTheJournalNamesWhatThePressWithdrew:
    def test_it_names_the_choice_moved_off_a_grant_and_never_the_grant_kept_beside_it(self):
        assert withdrawal_line(blocks=[{"scope": "kader_public", "media": True}], chosen={"scope": "kader_public", "media": False}) == (
            "media",
        )
