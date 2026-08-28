from enum import StrEnum


class Collection(StrEnum):
    """
    One declaration of what this database holds.

    A `StrEnum` rather than a `Literal`: a collection name never crosses the wire, and iteration
    lets a test catch one added to some of the places that read it and not the others.
    """

    #: Seasons. The `_id` is the season string every `saison_id` elsewhere references.
    SAISONS = "saisons"
    #: The season-to-team junction, which is what belongs to a season -- the club itself does not.
    SAISON_TEAMS = "saison_teams"
    #: The season-to-player junction, carrying everything a squad list shows.
    SAISON_SPIELER = "saison_spieler"
    #: Fixtures, one per match; the consistency boundary is the season
    #: (`fl_backend/app/core/domain.py :: AGGREGATES`).
    SPIELE = "spiele"
    #: Matchdays: named blocks of a season's fixtures, though the name itself is derived.
    SPIELTAGE = "spieltage"
    #: Clubs, season-independent.
    TEAMS = "teams"
    #: People, season-independent.
    SPIELER = "spieler"
    SPIELORTE = "spielorte"
    SCHIEDSRICHTER = "schiedsrichter"
    #: A school's application to play a season. Stored as it arrived and never rewritten -- only the
    #: triage moves `status`, `entscheidung` and `team_id`.
    BEWERBUNGEN = "bewerbungen"
    #: What every admin write did, and what it replaced. The one collection nothing here references
    #: and nothing references back (`fl_backend/app/core/recording.py`).
    AKTIONEN = "aktionen"
