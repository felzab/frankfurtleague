from app.api.spieler.services import mark_shared_nummern


class TestASharedSquadNumber:
    """That the one read reporting a shared number compares what is stored."""

    def test_the_marker_compares_the_stored_string_between_live_rows_alone(self):
        """`07` beside `7` is two shirts; an ausgetragen row is never marked, even beside a shared `1`, and its `9` shares no live `9`."""

        live = {"team_id": "one squad", "inactive_since": None}
        rows = [
            {"nummer": "1", **live},
            {"nummer": "1", **live},
            {"nummer": "1", "team_id": "one squad", "inactive_since": "2026-03-01"},
            {"nummer": "07", **live},
            {"nummer": "7", **live},
            {"nummer": "9", **live},
            {"nummer": "9", "team_id": "one squad", "inactive_since": "2026-03-01"},
            {"nummer": None, **live},
            {"nummer": None, **live},
        ]

        assert [row["nummer_double"] for row in mark_shared_nummern(rows)] == [True, True, False, False, False, False, False, False, False]
