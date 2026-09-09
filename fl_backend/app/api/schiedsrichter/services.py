from typing import Any, Mapping, Sequence

from app.api.spiele.schemas import SONDEREREIGNIS_WITHOUT_A_RESULT
from app.core.collections import Collection
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
ANONYMISED_SCHIEDSRICHTER: dict[str, Any] = {
    **ANONYMISED_KONTAKT,
    "name": None,
    # The PERSON's own attribute: beside a fixture list that never expires it narrows them to the few
    # referees one school sent. `default_payment` stays, being the LEAGUE's rate for the job rather
    # than anything about them.
    "schule": None,
}

# An erasure beats the last writer: a detail re-entered mid-anonymisation is a person's data
# the answer would report gone, and clearing it again is one more click.
KONTAKT_RE_ENTERED_MID_ANONYMISATION = "REQ-ANONYMISE-001"

# An anonymisation an ordinary edit can undo is not an anonymisation: the name goes back onto the row
# and onto every fixture they officiated, closed seasons' included, and the person is never told.
ANONYMISATION_UNDONE_BY_AN_EDIT = "REQ-ANONYMISE-002"

# A reactivation would put the erased row back into a picker, and a booking is fresh personal data
# about somebody who asked to be left out. What `REQ-BOOKING-001` reads is the retirement the erasure
# writes.
ANONYMISED_REFEREE_REACTIVATED = "REQ-ANONYMISE-003"


def build_unplayed_assignment_filter(schiedsrichter_id: Any) -> Mapping[str, Any]:
    """Every fixture this referee holds that is still to be played, as `app/api/saisons/services.py :: unplayed_spiel_nrs` decides it.

    One filter for the retirement's own refusal and for the erasure's unassign, so the two cannot
    disagree about what is still to come.
    """

    return {
        "schiedsrichter.schiedsrichter_id": schiedsrichter_id,
        "ergebnis": None,
        "sonderereignis": {"$nin": list(SONDEREREIGNIS_WITHOUT_A_RESULT)},
    }


def build_booked_image_filter(schiedsrichter_id: Any) -> Mapping[str, Any]:
    """Every `spiele` log row whose pre-image names this referee.

    Selected inside the image rather than by the fixtures they hold today: a reassigned fixture, and a
    removed one, each leave an image naming them that no id can reach.
    """

    # `collection` first, the one half an index serves — nothing indexes inside `before`, as the
    # contact erasure's orphan sweep also finds
    # (`app/api/kontakte/services.py :: build_orphaned_image_filter`). A `delete_many` row's image is
    # an ARRAY, matched on its members.
    return {"collection": str(Collection.SPIELE), "before.schiedsrichter.schiedsrichter_id": schiedsrichter_id}


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


def first_stamped(*, stored: Mapping[str, Any], field: str, today: str) -> str:
    """The day already stamped, or today.

    One helper for both dates the erasure writes: a repeat moving `anonymisiert_am` moves the date a
    person was given, and one moving `inactive_since` says a referee retired today who retired last
    season.
    """

    stamped = stored.get(field)

    return today if stamped is None else str(stamped)


def find_anonymisation_refusal(*, re_entered: bool) -> WriteRefusal | None:
    """Why this anonymisation must be refused, or `None` (`docs/backend/spec.md :: I217`).

    `re_entered` is read OUTSIDE the transaction: a row already cleared is `$set` to what it holds,
    so nothing is written and nothing conflicts (`docs/backend/spec.md :: I117` and `:: I53`).
    """

    if not re_entered:
        return None

    return WriteRefusal(
        error_code=KONTAKT_RE_ENTERED_MID_ANONYMISATION,
        message=(
            "the referee's name, school or contact details were entered again while this anonymisation ran, so it "
            "cleared nothing and left them standing; run it again to remove what is there now"
        ),
    )


def find_anonymisation_undo_refusal(*, stored: Mapping[str, Any], patched: Mapping[str, Any]) -> WriteRefusal | None:
    """Why this edit must be refused, or `None`.

    Keyed on `ANONYMISIERT_AM` and never on the stored values (`docs/backend/spec.md :: I214`).
    """

    if stored.get(ANONYMISIERT_AM) is None or not holds_an_anonymisable_value(patched):
        return None

    return WriteRefusal(
        error_code=ANONYMISATION_UNDONE_BY_AN_EDIT,
        message=(
            "this referee's name, school and contact details were deleted on request, and this save would put them back on the row "
            "and on every fixture they officiated; a deletion made by mistake is recovered from a backup rather than typed in again"
        ),
    )


def find_reactivation_refusal(*, anonymisiert_am: Any) -> WriteRefusal | None:
    """Why this reactivation must be refused, or `None`.

    Read off the erasure's stamp and never off the nulled name (`docs/backend/spec.md :: I214`).
    """

    if anonymisiert_am is None:
        return None

    return WriteRefusal(
        error_code=ANONYMISED_REFEREE_REACTIVATED,
        message=(
            "this referee's data were deleted on request, so they take no further fixtures and cannot be brought back; "
            "a person officiating again is entered as a new referee"
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
