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
    #: A row survives the erasure of the person it bars (`docs/backend/spec.md :: I268`): keyed, it is
    #: neither their document to delete nor a shell of nulls. Its author's erasure leaves the marker
    #: (`:: I660`).
    SPERRLISTE = "sperrliste"
    #: One minted registration link per row. It names a team, a season and the administrator who
    #: minted it, whose erasure leaves the row standing with the marker in their place
    #: (`docs/backend/spec.md :: I660`).
    EINLADUNGEN = "einladungen"
    #: One pupil's pending registration for a team's season. Erased by its own clocks, by the
    #: admission, which writes the person and the squad row in the transaction that deletes it, and by
    #: the erasure of its address.
    REGISTRIERUNGEN = "registrierungen"
    #: Who may enter the Verwaltung: one row per folded address. The one stored role, the other
    #: Funktionen being derived from league records (`docs/glossary.md`, `Berechtigung`).
    BERECHTIGUNGEN = "berechtigungen"
    #: The grants every administrator has been told of, or will be by a notice queued in
    #: `BERECHTIGUNGEN_POSTAUSGANG`. Its own collection because a grant removed outside the
    #: application leaves no trace in `berechtigungen` to compare against.
    BERECHTIGUNGEN_ANGEKUENDIGT = "berechtigungen_angekuendigt"
    #: The grant changes still to be mailed, each written in the transaction of the change it
    #: announces, and removed only by the stamp of the pass that claimed it.
    BERECHTIGUNGEN_POSTAUSGANG = "berechtigungen_postausgang"
    #: One signed-in person's counted writes in one Funktion on one German day. Operational state the
    #: action log never records (`fl_backend/app/core/drosselung.py`), expired by the day it names or
    #: removed by the person's erasure.
    DROSSELUNG = "drosselung"
    #: One folded address's conflict point under a keyed hash of it, written by every transaction
    #: storing that address and by its erasure, read by nothing, removed by its TTL index
    #: (`docs/backend/spec.md :: I719`).
    ADRESSANKER = "adressanker"
    #: One party's answer about one Ansetzung of a fixture, held true against nothing: no fixture write
    #: reaches it, and a move is reconciled by the next sweep pass closing the row.
    SPIELBESTAETIGUNGEN = "spielbestaetigungen"
    #: One fixture's report: the referee's proposed result, scorers, cards and remarks, which the fixture's
    #: result never reads. Created by its first writer, one per fixture.
    SPIELBERICHTE = "spielberichte"
    #: One address's pending change of the address it signs in on, keyed by that address, one live change per address;
    #: ended, it keeps no address, its links answering how it ended until its TTL index removes it.
    ADRESSWECHSEL = "adresswechsel"
