from enum import StrEnum
from typing import Final


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
    #: (`docs/domain.md`'s what is held true together).
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
    #: triage moves `status`, `decision` and `team_id`.
    BEWERBUNGEN = "bewerbungen"
    #: One row per recorded act, naming who acted and what they did. The one collection nothing here
    #: references and nothing references back (`fl_backend/app/core/recording.py`).
    ACTION_LOG = "action_log"
    #: One barred address per row, kept past the erasure of the person it bars, whom it goes on barring.
    BAN_LIST = "ban_list"
    #: One minted registration link per row, naming a team and a season.
    INVITATIONS = "invitations"
    #: One pupil's pending registration for a team's season. Erased by its own clocks, by the
    #: admission, which writes the person and the squad row in the transaction that deletes it, and by
    #: the erasure of its address.
    REGISTRIERUNGEN = "registrierungen"
    #: Who may enter the Verwaltung: one row per folded address. The one stored role, the other
    #: Funktionen being derived from league records (`docs/glossary.md`, `Berechtigung`).
    GRANTS = "grants"
    #: One party's answer about one Ansetzung of a fixture, held true against nothing: no fixture write
    #: reaches it, and a move is reconciled by the next sweep pass closing the row.
    SPIELBESTAETIGUNGEN = "spielbestaetigungen"
    #: One fixture's report: the referee's proposed result, scorers, cards and remarks, which the fixture's
    #: result never reads. Created by its first writer, one per fixture.
    SPIELBERICHTE = "spielberichte"
    #: One club's line-up for one fixture: the pupils it fields and who starts. Created by the club's first save, one
    #: per club per fixture, and removed with the season's draw.
    AUFSTELLUNGEN = "aufstellungen"
    #: One address's pending change of the address it signs in on, keyed by that address, one live change per address;
    #: ended, it keeps no address but a sign-in account's carry still owed, its links answering how it ended until its
    #: TTL index removes it.
    ADDRESS_CHANGES = "address_changes"
    #: Every mail the league owes, one row per recipient, each written in the transaction of the write owing it and settled
    #: by the drain that sends it; a settled row says what became of its message until its TTL index removes it.
    OUTBOX = "outbox"
    #: One mailbox a public form named, under its SHA-256 and never its address: a press writes it in its transaction, so
    #: that mailbox's presses run one after another, and its TTL index removes it once they stop.
    MAILBOX_ANCHORS = "mailbox_anchors"


# The collections a person edits through a form, one member per line: every update of what a form of one shows and
# saves raises its `version`, and a save carrying the version its form was read at matches only while no such write
# has raised it (`app/core/crud.py :: patch_one_in_db`). A write to a field no form saves leaves the count standing
# (`:: patch_past_the_version_in_db`).
EDITED_COLLECTIONS: Final[frozenset[Collection]] = frozenset(
    {
        Collection.SPIELE,
        Collection.SPIELBERICHTE,
        Collection.AUFSTELLUNGEN,
        Collection.SAISONS,
        Collection.SAISON_TEAMS,
        Collection.SPIELTAGE,
        Collection.TEAMS,
        Collection.SCHIEDSRICHTER,
        Collection.SPIELER,
        Collection.SAISON_SPIELER,
        Collection.SPIELORTE,
        Collection.BEWERBUNGEN,
    }
)
