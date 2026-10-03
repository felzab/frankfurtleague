"""
API · the account page's consent controls: what the pupil's, the referee's and a contact seat's share

One module for the three, so their PATCHes cannot answer one press differently and the account page's
read judges a grant exactly as the PATCH it offers does. Pure: `fl_backend/tests/core/test_write_shapes.py`
sweeps every services module for a read of its own.
"""

from collections.abc import Collection, Mapping, Sequence
from http import HTTPStatus
from typing import Any, Final

from app.api.einwilligung.services import find_fassung_refusal
from app.api.identitaet.services import FUNKTION_NICHT_GEHALTEN, seat_is_confirmed, seats_naming
from app.api.kontakte.services import KONTAKT_SLOTS, same_address
from app.core.exceptions import WriteRefusal
from app.shared.alter import whole_years_between
from app.shared.einwilligung import Seite
from app.shared.einwilligung_verlauf import FLEinwilligungAkt, compose_record_move
from app.shared.schemas.bounds import MEDIEN_MIN_AGE_YEARS

# What the code refuses is `fl_backend/app/core/domain.py :: RULES`. One code for all three records, so
# the account page maps one refusal however many records it edits.
SELBST_MEDIEN_ALTER = "REQ-EINWILLIGUNG-002"

# The registry pages (`app/shared/einwilligung.py :: LAUFENDE_FASSUNGEN`) whose labels each control stamps.
KONTO_SEITE_SPIELER: Final[Seite] = "konto_spieler"
KONTO_SEITE_SCHIEDSRICHTER: Final[Seite] = "konto_schiedsrichter"
KONTO_SEITE_KONTAKT: Final[Seite] = "konto_kontakt"

# The place `find_fassung_refusal` names in its message: each PATCH stamps one label.
_FASSUNG_ORT: Final = "einwilligung"


def medien_angeboten(*, geburtsdatum: Any, today: str) -> bool:
    """Whether this person may switch the media consent on: their stored birthdate reaches `MEDIEN_MIN_AGE_YEARS` today.

    Fails CLOSED on a null or unreadable date (`docs/backend/spec.md :: I338`).
    """

    if not isinstance(geburtsdatum, str):
        return False

    try:
        return whole_years_between(born=geburtsdatum, today=today) >= MEDIEN_MIN_AGE_YEARS
    except ValueError:
        return False


def erteilt_etwas(*, gespeichert: Mapping[str, Any], umfang: str | None, medien: bool) -> bool:
    """Whether a PATCH GRANTS anything the stored record withholds; `umfang` is `None` where the payload carries none.

    A grant is admitted only on a record that grants a panel, a withdrawal on every confirmed one (Art. 7(3) DSGVO).
    """

    return (umfang == "kader_oeffentlich" and gespeichert.get("umfang") != "kader_oeffentlich") or (
        medien and gespeichert.get("medien") is not True
    )


def bewegt_etwas(*, gespeichert: Mapping[str, Any], umfang: str | None, medien: bool) -> bool:
    """Whether a PATCH moves either choice. A stored record carrying no `medien` predates the field and is off."""

    return (umfang is not None and gespeichert.get("umfang") != umfang) or bool(gespeichert.get("medien", False)) != medien


def compose_selbst_einwilligung_move(
    *, bloecke: Sequence[tuple[str, Mapping[str, Any]]], umfang: str | None, medien: bool, ueber: str, am: str, text_version: str
) -> dict[str, dict[str, Any]] | None:
    """One update moving a press's choices and appending an entry per block moved; `None` where none moves.

    Never `bestaetigt_am`, read by the panel and the publication mask, nor the block's CONFIRMED
    `text_version`: the press's label is its entry's.
    """

    update: dict[str, dict[str, Any]] = {"$set": {}, "$push": {}}
    for pfad, gespeichert in bloecke:
        moved = {
            field: value
            for field, value, stored in (
                ("umfang", umfang, gespeichert.get("umfang")),
                ("medien", medien, bool(gespeichert.get("medien", False))),
            )
            if value is not None and value != stored
        }
        if not moved:
            continue
        # One entry per act: a press widening either choice is a grant, its other half visible in the
        # choices the entry records.
        akt: FLEinwilligungAkt = "erteilt" if erteilt_etwas(gespeichert=gespeichert, umfang=umfang, medien=medien) else "widerrufen"
        step = compose_record_move(pfad=pfad, stored=gespeichert, moved=moved, akt=akt, ueber=ueber, am=am, text_version=text_version)
        update["$set"].update(step["$set"])
        update["$push"].update(step["$push"])

    return update if update["$push"] else None


def gehaltene_sitze(row: Mapping[str, Any], identifier: str) -> list[str]:
    """The slots of one season row whose confirmed person is this address, in `KONTAKT_SLOTS` order."""

    return [slot for gefunden, slot in seats_naming([row], identifier) if seat_is_confirmed(gefunden, slot)]


def find_eigener_eintrag_refusal(*, gehalten: bool) -> WriteRefusal | None:
    """`REQ-FUNKTION-001` on a person's own record: the address holds no record this operation may read or change.

    One answer for another person's id, an unconfirmed record and none at all, so the refusal tells
    nobody which ids exist.
    """

    if gehalten:
        return None

    return WriteRefusal(
        error_code=FUNKTION_NICHT_GEHALTEN,
        status=HTTPStatus.FORBIDDEN,
        message="the signed-in person holds no confirmed record here that this operation may read or change",
    )


def find_konto_fassung_refusal(*, seite: Seite, text_version: str, erteilt: bool) -> WriteRefusal | None:
    """`REQ-EINWILLIGUNG-001` on an account-page control: a grant names the page's running label, a withdrawal any version of it.

    Refusing a withdrawal from a page loaded before a deploy would make taking a consent back harder
    than giving it.
    """

    # The judge's kept-label arm is what admits any version of the page: it requires the label to be one.
    return find_fassung_refusal(
        seite=seite,
        genannt={_FASSUNG_ORT: text_version},
        gespeichert={} if erteilt else {_FASSUNG_ORT: text_version},
    )


def find_selbst_medien_refusal(*, geburtsdatum: Any, medien_erteilt: bool, today: str) -> WriteRefusal | None:
    """Why a media consent moving to `true` is refused, or `None`.

    Only a move is judged: a stored `true` resent beside the other switch grants nothing, and refusing
    it would block that switch.
    """

    if not medien_erteilt or medien_angeboten(geburtsdatum=geburtsdatum, today=today):
        return None

    return WriteRefusal(
        error_code=SELBST_MEDIEN_ALTER,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        fields=(("medien",),),
        message=(
            f"a consent to publishing photographs, video and interviews is given from {MEDIEN_MIN_AGE_YEARS} years of age only, "
            "judged on the stored birthdate"
        ),
    )


# --- The records each read serves: CONFIRMED ones alone, retired rows and past seasons included, a
# withdrawal staying open on every record a consent stands on.


def compose_spieler_selbst(row: Mapping[str, Any], *, erteilbar: bool, today: str) -> dict[str, Any]:
    """One pupil row, as `app/api/spieler/services.py :: build_selbst_pupil_pipeline` reads it, in the shape both reads serve."""

    return {
        "spieler_id": row["_id"],
        "vorname": row["vorname"],
        "nachname": row.get("nachname"),
        "geburtsdatum": row.get("geburtsdatum"),
        "inactive_since": row.get("inactive_since"),
        "einwilligung": row["einwilligung"],
        "bestaetigt_text_version": row["einwilligung"].get("text_version"),
        "erteilbar": erteilbar,
        "medien_angeboten": medien_angeboten(geburtsdatum=row.get("geburtsdatum"), today=today),
        "kader": row["kader"],
    }


def compose_schiedsrichter_selbst(row: Mapping[str, Any], *, erteilbar: bool, today: str) -> dict[str, Any]:
    """One referee row, as `app/api/schiedsrichter/services.py :: SELBST_FIELDS` projects it, in the shape both reads serve."""

    return {
        "schiedsrichter_id": row["_id"],
        "name": row["name"],
        "schule": row.get("schule"),
        "kontakt": row["kontakt"],
        "geburtsdatum": row.get("geburtsdatum"),
        "inactive_since": row.get("inactive_since"),
        "einwilligung": row["einwilligung"],
        "bestaetigt_text_version": row["einwilligung"].get("text_version"),
        "erteilbar": erteilbar,
        "medien_angeboten": medien_angeboten(geburtsdatum=row.get("geburtsdatum"), today=today),
    }


def build_selbst_seat_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every season row whose seats may name the address: a pre-filter, `app/api/identitaet/services.py :: seats_naming` deciding.

    No `austritt` term, unlike the panel's lookup: a withdrawal reaches a withdrawn team's seat too.
    """

    return [
        {"$match": {"$or": [{f"kontakte.{slot}.email": same_address(identifier)} for slot in KONTAKT_SLOTS]}},
        {
            "$project": {
                "saison_id": 1,
                "team_id": 1,
                "name": 1,
                **{f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_SLOTS for field in ("email", "geburtsdatum", "einwilligung")},
            }
        },
        {"$sort": {"saison_id": -1, "name": 1, "team_id": 1}},
    ]


def compose_sitze_selbst(
    rows: Sequence[Mapping[str, Any]], identifier: str, *, erteilbar: Collection[tuple[Any, str]], today: str
) -> list[dict[str, Any]]:
    """One entry per season row on which this address holds a confirmed seat.

    Per ROW, the seat PATCH moving a person's slots together; `medien` is on where any held slot's is,
    so a withdrawal stays offered.
    """

    sitze = []
    for row in rows:
        rollen = gehaltene_sitze(row, identifier)
        if not rollen:
            continue
        held = [row["kontakte"][slot] for slot in rollen]
        sitze.append(
            {
                "team_id": row["team_id"],
                "team_name": row["name"],
                "saison_id": row["saison_id"],
                "rollen": rollen,
                "bestaetigt_text_version": held[0]["einwilligung"].get("text_version"),
                "medien": any(seat["einwilligung"].get("medien") is True for seat in held),
                "medien_angeboten": all(medien_angeboten(geburtsdatum=seat.get("geburtsdatum"), today=today) for seat in held),
                "erteilbar": (row["team_id"], row["saison_id"]) in erteilbar,
            }
        )

    return sitze
