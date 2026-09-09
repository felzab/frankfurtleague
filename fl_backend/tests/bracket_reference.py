"""
SAISONS · the hand-written bracket rows `app/api/saisons/spielplan.py :: bracket_seeding` is held to

Hand-written rather than generated: rows taken from the construction would compare it with itself,
and every property asserted over them would then hold of any construction at all. A shape absent
here is constructed all the same, so widening the season rules' bounds owes this table no row.
"""

from collections.abc import Mapping

from app.api.teams.schemas import FLGruppenNames

BRACKET_SEEDING: Mapping[tuple[int, int], tuple[tuple[FLGruppenNames, int], ...]] = {
    (1, 2): (("A", 1), ("A", 2)),
    (1, 4): (("A", 1), ("A", 4), ("A", 2), ("A", 3)),
    (1, 8): (("A", 1), ("A", 8), ("A", 4), ("A", 5), ("A", 2), ("A", 7), ("A", 3), ("A", 6)),
    (1, 16): (
        ("A", 1),
        ("A", 16),
        ("A", 8),
        ("A", 9),
        ("A", 4),
        ("A", 13),
        ("A", 5),
        ("A", 12),
        ("A", 2),
        ("A", 15),
        ("A", 7),
        ("A", 10),
        ("A", 3),
        ("A", 14),
        ("A", 6),
        ("A", 11),
    ),
    (2, 1): (("A", 1), ("B", 1)),
    (2, 2): (("A", 1), ("B", 2), ("B", 1), ("A", 2)),
    (2, 4): (("A", 1), ("B", 4), ("A", 2), ("B", 3), ("B", 1), ("A", 4), ("B", 2), ("A", 3)),
    (2, 8): (
        ("A", 1),
        ("B", 8),
        ("A", 4),
        ("B", 5),
        ("A", 2),
        ("B", 7),
        ("A", 3),
        ("B", 6),
        ("B", 1),
        ("A", 8),
        ("B", 4),
        ("A", 5),
        ("B", 2),
        ("A", 7),
        ("B", 3),
        ("A", 6),
    ),
    (4, 1): (("A", 1), ("B", 1), ("C", 1), ("D", 1)),
    (4, 2): (("A", 1), ("B", 2), ("C", 1), ("D", 2), ("B", 1), ("A", 2), ("D", 1), ("C", 2)),
    (4, 4): (
        ("A", 1),
        ("B", 4),
        ("C", 2),
        ("D", 3),
        ("B", 1),
        ("A", 4),
        ("D", 2),
        ("C", 3),
        ("C", 1),
        ("D", 4),
        ("A", 2),
        ("B", 3),
        ("D", 1),
        ("C", 4),
        ("B", 2),
        ("A", 3),
    ),
}
