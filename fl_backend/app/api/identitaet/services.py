"""
API · the subject read's judgements, apart from the handles they are asked of

Here rather than in `crud.py`, which opens collections: a services module is what
`fl_backend/tests/core/test_write_shapes.py :: TestEveryServiceModuleDecidesFromItsArguments` sweeps,
so a judgement left beside a handle is one nothing stops from growing a read of its own.
"""

from collections.abc import Iterable, Mapping, Sequence
from http import HTTPStatus
from typing import Any, Literal

from bson import ObjectId

from app.api.bewerbungen.services import build_eigene_bewerbung_filter
from app.api.identitaet.schemas import FLSubjekt, FLSubjektSitz
from app.api.kontakte.services import rows_possibly_naming
from app.api.registrierungen.services import SUBMITTED, build_eigene_registrierung_filter
from app.api.saisons.schemas import FLSaisonStatus
from app.api.schiedsrichter.services import build_selbst_referee_filter
from app.api.spieler.services import build_selbst_pupil_filter
from app.api.teams.schemas import KONTAKT_ROLLEN
from app.core.exceptions import WriteRefusal
from app.shared.einwilligung import is_confirmed
from app.shared.folding import sign_in_identifier

# --- The SELECTIONS, each shared with its record's own person-tier reads rather than spelled again.
# Unnarrowed by retirement or withdrawal: `_judged` narrows the Funktionen (`docs/backend/spec.md :: I376`).


def build_seat_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every junction row whose block may name the address, a withdrawn team's included."""

    return [
        {"$match": rows_possibly_naming(identifier)},
        # `name` rides along free, this read opening the row anyway, and it is the row's own rather
        # than the club's (`docs/backend/spec.md :: I13`).
        {
            "$project": {
                "saison_id": 1,
                "team_id": 1,
                "name": 1,
                "austritt": 1,
                **{f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_ROLLEN for field in ("email", "einwilligung.bestaetigt_am")},
            }
        },
        # Ordered in the read rather than by the reader: two clubs' seats held by one inbox are
        # otherwise answered in whatever order the collection was written in.
        {"$sort": {"saison_id": 1, "team_id": 1}},
    ]


def build_referee_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """The stored address rides along so `folds_to` can judge it, and the stamp so the confirmation can; nothing else of the person does."""

    return [
        {"$match": build_selbst_referee_filter(identifier)},
        {"$project": {"kontakt.email": 1, "einwilligung.bestaetigt_am": 1, "inactive_since": 1}},
        {"$sort": {"_id": 1}},
    ]


def build_pupil_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Equality and no pattern: `spieler.email` stores the folded form."""

    return [
        {"$match": build_selbst_pupil_filter(identifier)},
        {"$project": {"einwilligung.bestaetigt_am": 1, "inactive_since": 1}},
        {"$sort": {"_id": 1}},
    ]


def build_bewerbung_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every pending application whose seats may name the address; read for the sign-in alone, no panel standing on one."""

    return [
        {"$match": build_eigene_bewerbung_filter(identifier)},
        {"$project": {f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_ROLLEN for field in ("email", "einwilligung.bestaetigt_am")}},
    ]


def build_registrierung_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every pending registration that may be the address's; read for the sign-in alone, no panel standing on one.

    The whole consent record rides along: whether its pupil confirmed it is part of the judgement.
    """

    return [{"$match": build_eigene_registrierung_filter(identifier)}, {"$project": {"status": 1, "email": 1, "einwilligung": 1}}]


def folds_to(stored: Any, identifier: str) -> bool:
    """Whether one stored address is this mailbox, on the fold both ends of the join share.

    The null arm carries an empty seat slot and a referee whose `kontakt.email` is null, each
    declared so in `app/core/constraints.py`.
    """

    return stored is not None and sign_in_identifier(str(stored)) == identifier


def seats_naming(rows: Sequence[Mapping[str, Any]], identifier: str) -> list[tuple[Mapping[str, Any], str]]:
    """One pair per SLOT rather than per row: one address stands in two of a block's person slots wherever one person was entered twice."""

    return [
        (row, slot)
        for row in rows
        for slot in KONTAKT_ROLLEN
        if folds_to(((row.get("kontakte") or {}).get(slot) or {}).get("email"), identifier)
    ]


def seat_is_confirmed(row: Mapping[str, Any], slot: str) -> bool:
    """Per SLOT: one address in two slots of one row may be confirmed in one and entered by an administrator in the other."""

    return is_confirmed((((row.get("kontakte") or {}).get(slot)) or {}).get("einwilligung"))


# --- The OWN RECORDS: every record its own person confirmed, judged here alone for every reader. A
# Funktion is an own record that is live besides (`_judged`), never a second judgement.


def eigene_sitze(row: Mapping[str, Any], identifier: str) -> list[str]:
    """The slots of one season row or application whose confirmed person is this address, in `KONTAKT_ROLLEN` order."""

    return [slot for gefunden, slot in seats_naming([row], identifier) if seat_is_confirmed(gefunden, slot)]


def ist_eigener_spieler(row: Mapping[str, Any]) -> bool:
    """The stamp alone: the selection is an equality on the folded address `spieler.email` stores."""

    return is_confirmed(row.get("einwilligung"))


def ist_eigener_schiedsrichter(row: Mapping[str, Any], identifier: str) -> bool:
    return folds_to((row.get("kontakt") or {}).get("email"), identifier) and is_confirmed(row.get("einwilligung"))


def ist_eigene_registrierung(row: Mapping[str, Any], identifier: str) -> bool:
    """A pending registration its pupil confirmed, a returning pupil's carrying no choice among them: its stored data is served.

    The status is judged here as well as selected on, for the caller reaching a row by its id.
    """

    return row.get("status") == SUBMITTED and folds_to(row.get("email"), identifier) and is_confirmed(row.get("einwilligung"))


EintragArt = Literal["spieler", "schiedsrichter", "sitze", "bewerbungen", "registrierungen"]


def eigene_eintraege(
    identifier: str,
    *,
    seat_rows: Iterable[Mapping[str, Any]],
    referee_rows: Iterable[Mapping[str, Any]],
    pupil_rows: Iterable[Mapping[str, Any]],
    bewerbung_rows: Iterable[Mapping[str, Any]],
    registrierung_rows: Iterable[Mapping[str, Any]],
) -> frozenset[tuple[EintragArt, Any]]:
    """Every own record of this address, by its kind and the id an account-page entry names it by.

    A season row by its team and season: the seat PATCH answers per row, however many slots it holds.
    """

    return frozenset(
        {
            *(("spieler", row["_id"]) for row in pupil_rows if ist_eigener_spieler(row)),
            *(("schiedsrichter", row["_id"]) for row in referee_rows if ist_eigener_schiedsrichter(row, identifier)),
            *(("sitze", (row["team_id"], row["saison_id"])) for row in seat_rows if eigene_sitze(row, identifier)),
            *(("bewerbungen", row["_id"]) for row in bewerbung_rows if eigene_sitze(row, identifier)),
            *(("registrierungen", row["_id"]) for row in registrierung_rows if ist_eigene_registrierung(row, identifier)),
        }
    )


def lebt(row: Mapping[str, Any]) -> bool:
    """A pupil or referee row not retired: only such a row grants its Funktion (`docs/backend/spec.md :: I376`)."""

    return row.get("inactive_since") is None


def nicht_ausgetreten(row: Mapping[str, Any]) -> bool:
    """A season row its team has not withdrawn from: only such a row's seats grant (`docs/backend/spec.md :: I376`).

    The record's presence is the test, as every rule keyed on a club having left reads it.
    """

    return row.get("austritt") is None


def awaits_confirmation(confirmations: Iterable[bool]) -> bool:
    """Whether a mailbox holds records that could grant a panel and has confirmed none of them (`docs/backend/spec.md :: I374`)."""

    judged = list(confirmations)

    return bool(judged) and not any(judged)


def grants_a_panel(saison_status: FLSaisonStatus) -> bool:
    """Whether a seat on a season of this status admits its holder to the team's panel (`docs/backend/spec.md :: I375`).

    A `future` season's seat grants too: a team's people act for it before its season starts.
    """

    return saison_status in ("active", "future")


# The first refusal every person endpoint on a team's panel raises: who the caller is, so a 403
# rather than a 409, whatever the team's own state.
FUNKTION_NICHT_GEHALTEN = "REQ-FUNKTION-001"


def holds_a_seat(sitze: Iterable[FLSubjektSitz], *, team_id: ObjectId, saison_id: str) -> bool:
    """Whether any of these seats, already narrowed to a season granting a panel, sits on this team in this season.

    Any slot alike: the Trainer's seat admits to everything an Ansprechperson's does, so no slot is read here.
    """

    return any(sitz.team_id == team_id and sitz.saison_id == saison_id for sitz in sitze)


# The grant predicates, one per kind of own record: each consent PATCH grants by its record's, and each
# read's `erteilbar` is that same predicate (`docs/backend/spec.md :: I973`).


def may_grant_on_spieler(subjekt: FLSubjekt, spieler_id: ObjectId) -> bool:
    return any(eintrag.spieler_id == spieler_id for eintrag in subjekt.spieler)


def may_grant_on_schiedsrichter(subjekt: FLSubjekt, schiedsrichter_id: ObjectId) -> bool:
    return any(eintrag.schiedsrichter_id == schiedsrichter_id for eintrag in subjekt.schiedsrichter)


def find_funktion_refusal(*, sitze: Iterable[FLSubjektSitz], team_id: ObjectId, saison_id: str) -> WriteRefusal | None:
    """`REQ-FUNKTION-001`: the signed-in person holds no seat on this team in this season.

    One answer for another team, another season and a `past` one, so the refusal tells a stranger
    nothing about which teams or seasons exist.
    """

    if holds_a_seat(sitze, team_id=team_id, saison_id=saison_id):
        return None

    return WriteRefusal(
        error_code=FUNKTION_NICHT_GEHALTEN,
        status=HTTPStatus.FORBIDDEN,
        message="the signed-in person holds no seat on this team in this season, so its panel is not theirs to read or change",
    )
