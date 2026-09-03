from typing import Any, Mapping, Sequence

from app.core.exceptions import WriteRefusal
from app.shared.schemas.kontakt import FLKontakt

# A played fixture never blocks: its `schiedsrichter` is a record of who officiated.
REFEREE_STILL_ASSIGNED = "REQ-RETIRE-004"

# Dotted keys, so `kontakt` itself survives: `app/core/constraints.py :: _KONTAKT` types it required
# and non-nullable, its members string-or-null. Read off the model, so a contact field added later is
# cleared rather than silently left behind.
ANONYMISED_KONTAKT: dict[str, None] = {f"kontakt.{field}": None for field in FLKontakt.model_fields}

# An erasure beats the last writer: a detail re-entered mid-anonymisation is a person's data
# the answer would report gone, and clearing it again is one more click.
KONTAKT_RE_ENTERED_MID_ANONYMISATION = "REQ-ANONYMISE-001"


def holds_a_kontakt_value(schiedsrichter: Mapping[str, Any]) -> bool:
    """Whether any field `ANONYMISED_KONTAKT` clears still carries a value.

    Read off that mapping rather than off `FLKontakt` again, so what the erasure clears and
    what this weighs cannot become two lists.
    """

    kontakt = schiedsrichter.get("kontakt") or {}

    return any(kontakt.get(path.partition(".")[2]) is not None for path in ANONYMISED_KONTAKT)


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
            "the referee's contact details were entered again while this anonymisation ran, so it cleared nothing "
            "and left them standing; run it again to remove what is there now"
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
