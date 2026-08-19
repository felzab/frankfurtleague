"""
CORE · the collection names

One declaration of what this database holds, so a name is written once for every place that needs
it: the accessors in `db.py`, the validators in `constraints.py`, and the tables in `domain.py`. A
`StrEnum` rather than a `Literal` because a collection name never crosses the wire, and iteration
is what lets `test_every_collection_is_declared_once` catch a collection added to one of those
places and not the others.

Invariants:
- There is deliberately no equivalent declaration of field names.
"""

from enum import StrEnum


class Collection(StrEnum):
    #: Seasons. The `_id` is the season string every `saison_id` elsewhere references.
    SAISONS = "saisons"
    #: The season-to-team junction, which is what belongs to a season -- the club itself does not.
    SAISON_TEAMS = "saison_teams"
    #: The season-to-player junction, carrying everything a squad list shows.
    SAISON_SPIELER = "saison_spieler"
    #: Fixtures, one document per match; the consistency boundary is the season (`fl_backend/app/core/domain.py :: AGGREGATES`).
    SPIELE = "spiele"
    #: Matchdays: named blocks of a season's fixtures, though the name itself is derived.
    SPIELTAGE = "spieltage"
    #: Clubs, season-independent.
    TEAMS = "teams"
    #: People, season-independent.
    SPIELER = "spieler"
    SPIELORTE = "spielorte"
    SCHIEDSRICHTER = "schiedsrichter"
