"""
CORE · the nine collection names

One declaration of what this database holds, so a name is written once for the three places that
need it: the accessors in `db.py`, the validators in `constraints.py`, and the tables in
`domain.py`. A `StrEnum` rather than a `Literal` because a collection name never crosses the
wire, and iteration is what lets `test_every_collection_is_declared_once` catch a tenth
collection added to one place and not the others (ADR-0068).

Invariants:
- There is deliberately no equivalent declaration of field names (ADR-0068, ADR-0031).
"""

from enum import StrEnum


class Collection(StrEnum):
    """Every collection this database has. The value is the name Mongo knows it by."""

    #: Seasons. The `_id` is the four-character season string every `saison_id` elsewhere references.
    SAISONS = "saisons"
    #: The season-to-team junction, which is what belongs to a season -- the club itself does not.
    SAISON_TEAMS = "saison_teams"
    #: The season-to-player junction, carrying everything a squad list shows.
    SAISON_SPIELER = "saison_spieler"
    #: Fixtures. One aggregate per SEASON rather than per match, because a result resolves the bracket.
    SPIELE = "spiele"
    #: Matchdays: named blocks of a season's fixtures, though the name itself is derived (ADR-0064).
    SPIELTAGE = "spieltage"
    #: Clubs, season-independent.
    TEAMS = "teams"
    #: People, season-independent.
    SPIELER = "spieler"
    #: Venues.
    SPIELORTE = "spielorte"
    #: Referees.
    SCHIEDSRICHTER = "schiedsrichter"
