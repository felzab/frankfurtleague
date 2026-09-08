from typing import Any, Mapping, Sequence

from app.core.exceptions import WriteRefusal
from app.shared.schemas.kontakt import FLKontakt

# A played fixture never blocks: its `schiedsrichter` is a record of who officiated.
REFEREE_STILL_ASSIGNED = "REQ-RETIRE-004"

# Not a boolean: a person asking later when their erasure ran is answered by the row, their own
# request having redacted the log that would otherwise say (`docs/glossary.md :: inactive_since`).
ANONYMISIERT_AM = "anonymisiert_am"

# Dotted keys, so `kontakt` itself survives: `app/core/constraints.py :: _KONTAKT` types it required
# and non-nullable, its members string-or-null. Read off the model, so a contact field added later is
# cleared rather than silently left behind.
ANONYMISED_KONTAKT: dict[str, None] = {f"kontakt.{field}": None for field in FLKontakt.model_fields}

# One mapping, so nothing can clear the details while leaving the person named. Null and never a
# label: one word standing for every erased person is a second row `uniq_schiedsrichter_name`
# refuses (`docs/backend/spec.md :: 1.1`).
ANONYMISED_SCHIEDSRICHTER: dict[str, Any] = {**ANONYMISED_KONTAKT, "name": None}

# An erasure beats the last writer: a detail re-entered mid-anonymisation is a person's data
# the answer would report gone, and clearing it again is one more click.
KONTAKT_RE_ENTERED_MID_ANONYMISATION = "REQ-ANONYMISE-001"

# An anonymisation an ordinary edit can undo is not an anonymisation: the name goes back onto the row
# and onto every fixture they officiated, closed seasons' included, and the person is never told.
ANONYMISATION_UNDONE_BY_AN_EDIT = "REQ-ANONYMISE-002"


def _stored_at(schiedsrichter: Mapping[str, Any], path: str) -> Any:
    """The value a dotted key of `ANONYMISED_SCHIEDSRICHTER` addresses, or `None` where a segment is missing."""

    found: Any = schiedsrichter

    for segment in path.split("."):
        if not isinstance(found, Mapping):
            return None
        found = found.get(segment)

    return found


def holds_an_anonymisable_value(schiedsrichter: Mapping[str, Any]) -> bool:
    """Whether anything `ANONYMISED_SCHIEDSRICHTER` writes still stands as something else.

    Read off that mapping rather than off the models again, so what the erasure writes and what
    this weighs cannot become two lists.
    """

    return any(_stored_at(schiedsrichter, path) != value for path, value in ANONYMISED_SCHIEDSRICHTER.items())


def anonymisation_stamp(*, stored: Mapping[str, Any], today: str) -> str:
    """The day the row already carries where it carries one: a run repeated against a re-entry would otherwise move the date the person was given."""

    stamped = stored.get(ANONYMISIERT_AM)

    return today if stamped is None else str(stamped)


def find_anonymisation_refusal(*, re_entered: bool) -> WriteRefusal | None:
    """Why this anonymisation must be refused, or `None`.

    `re_entered` is read OUTSIDE the transaction: a row already cleared is `$set` to what it holds,
    so nothing is written and nothing conflicts (`docs/backend/spec.md :: I117` and `:: I53`).
    """

    if not re_entered:
        return None

    return WriteRefusal(
        error_code=KONTAKT_RE_ENTERED_MID_ANONYMISATION,
        message=(
            "the referee's name or contact details were entered again while this anonymisation ran, so it cleared "
            "nothing and left them standing; run it again to remove what is there now"
        ),
    )


def find_anonymisation_undo_refusal(*, stored: Mapping[str, Any], patched: Mapping[str, Any]) -> WriteRefusal | None:
    """Why this edit must be refused, or `None`.

    The stored side reads the erasure's own stamp rather than weighing values: a row holding no name
    because nobody has typed one is not a row somebody asked to be erased from, and nothing but the
    stamp tells the two apart.
    """

    if stored.get(ANONYMISIERT_AM) is None or not holds_an_anonymisable_value(patched):
        return None

    return WriteRefusal(
        error_code=ANONYMISATION_UNDONE_BY_AN_EDIT,
        message=(
            "this referee's name and contact details were deleted on request, and this save would put them back on the row and "
            "on every fixture they officiated; a deletion made by mistake is recovered from a backup rather than typed in again"
        ),
    )


def find_referee_retire_refusal(*, upcoming_spiel_nrs: Sequence[int]) -> WriteRefusal | None:
    """Why retiring this referee must be refused, or `None`.

    `upcoming_spiel_nrs` is `unplayed_spiel_nrs`'s definition of "still to come".
    """

    if not upcoming_spiel_nrs:
        return None

    named = ", ".join(str(nr) for nr in upcoming_spiel_nrs[:5])
    rest = f" and {len(upcoming_spiel_nrs) - 5} more" if len(upcoming_spiel_nrs) > 5 else ""

    return WriteRefusal(
        error_code=REFEREE_STILL_ASSIGNED,
        message=(
            f"{len(upcoming_spiel_nrs)} unplayed fixture(s) are assigned to them (spiel_nr {named}{rest}); "
            "reassign or cancel those fixtures first"
        ),
    )
