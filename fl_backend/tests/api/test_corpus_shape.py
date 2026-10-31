from collections import defaultdict

from bson import ObjectId

from .conftest import SPIELE


def test_no_club_is_fielded_twice_among_the_fixtures_sharing_a_spieltag():
    """A refusal no single document can hold: it spans documents rather than living in one.

    A corpus carrying the state `spieltag_occupied` refuses is one production could not have stored,
    so a pipeline proved against it is proved against nothing.
    """

    fielded: dict[ObjectId, list[str]] = defaultdict(list)

    for spiel in SPIELE:
        for side in (spiel["team1"], spiel["team2"]):
            if side is not None:
                fielded[spiel["spieltag_id"]].append(side["name"])

    twice = {spieltag: sorted(names) for spieltag, names in fielded.items() if len(set(names)) != len(names)}

    assert not twice, f"clubs fielded more than once on one Spieltag: {twice}"
