"""
API · the subject read's judgements, apart from the handles they are asked of

Here rather than in `crud.py`, which opens collections: a services module is what
`fl_backend/tests/core/test_write_shapes.py :: TestEveryServiceModuleDecidesFromItsArguments` sweeps,
so a judgement left beside a handle is one nothing stops from growing a read of its own.
"""

import re
import unicodedata
from collections.abc import Collection, Iterable, Mapping, Sequence
from collections.abc import Set as AbstractSet
from http import HTTPStatus
from typing import Any, Final, Literal, get_args

from bson import ObjectId

from app.api.berechtigungen.schemas import FLAdresswechselEinsehbarVerwehrt, FLVerwaltung
from app.api.berechtigungen.services import OWNER, holds_an_owners_power, lebendige, verwaltung_des
from app.api.bewerbungen.services import build_eigene_bewerbung_filter
from app.api.identitaet.schemas import FLErasureAnsicht, FLSelbstErasureAnsicht, FLSubjekt, FLSubjektSitz
from app.api.kontakte.services import rows_seating
from app.api.registrierungen.services import SUBMITTED, build_eigene_registrierung_filter, build_erasure_registrierung_filter
from app.api.saisons.schemas import FLSaisonStatus
from app.api.schiedsrichter.services import (
    build_selbst_referee_filter,
    build_unplayed_assignment_filter,
)
from app.api.spieler.services import build_real_spieler_filter, build_selbst_pupil_filter
from app.api.teams.schemas import KONTAKT_ROLLEN
from app.core.collections import Collection as DbCollection
from app.core.exceptions import WriteRefusal
from app.shared.einwilligung import is_confirmed
from app.shared.folding import composed_name, is_stored_identifier, sign_in_identifier

# --- The SELECTIONS, each shared with its record's own person-tier reads rather than spelled again.
# Unnarrowed by retirement or withdrawal: `_judged` narrows the Funktionen (`docs/backend/spec.md :: I376`).


def build_seat_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every junction row whose block names the address, a withdrawn team's included."""

    return [
        {"$match": rows_seating(identifier)},
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


# --- The ERASURE's selections: every status, every retired row and every unconfirmed seat, so the
# preview and the erasure name one set and the narrowing above takes nothing out of either.

# What a seat is named by in the preview, beside the address the fold judges it on.
ERASURE_SEAT_FIELDS: tuple[str, ...] = ("email", "vorname", "nachname")


def build_erasure_seat_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every season row or application one of whose seats names the address, whatever its status.

    `bestaetigungen` rides along whole: the clearing nulls a seat's bookkeeping only where the block
    exists (`app/api/kontakte/services.py :: build_clearing_update`).
    """

    return [
        {"$match": rows_seating(identifier)},
        {
            "$project": {
                "saison_id": 1,
                # A season row's team, which the administrator's reveal links each seat to.
                "team_id": 1,
                "name": 1,
                "bestaetigungen": 1,
                **{f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_ROLLEN for field in ERASURE_SEAT_FIELDS},
            }
        },
        {"$sort": {"saison_id": 1, "_id": 1}},
    ]


def build_erasure_referee_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    return [
        {"$match": build_selbst_referee_filter(identifier)},
        {"$project": {"name": 1, "kontakt.email": 1, "inactive_since": 1}},
        {"$sort": {"_id": 1}},
    ]


def build_erasure_pupil_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    return [{"$match": build_selbst_pupil_filter(identifier)}, {"$project": {"vorname": 1, "nachname": 1}}, {"$sort": {"_id": 1}}]


def build_erasure_registrierung_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    return [
        {"$match": build_erasure_registrierung_filter(identifier)},
        {"$project": {"saison_id": 1, "team_id": 1, "status": 1, "email": 1, "vorname": 1, "nachname": 1}},
        {"$sort": {"saison_id": 1, "_id": 1}},
    ]


def build_season_team_pipeline(rows: Iterable[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """The season rows naming each of these registrations' or squad rows' team that season.

    Never asked of no row: the server refuses an empty `$or`.
    """

    pairs = dict.fromkeys((row["saison_id"], row["team_id"]) for row in rows)

    return [
        {"$match": {"$or": [{"saison_id": saison_id, "team_id": team_id} for saison_id, team_id in pairs]}},
        {"$project": {"saison_id": 1, "team_id": 1, "name": 1}},
    ]


def referee_address(row: Mapping[str, Any]) -> Any:
    return (row.get("kontakt") or {}).get("email")


def pupil_address(row: Mapping[str, Any]) -> Any:
    return row.get("email")


def build_unplayed_saison_pipeline(schiedsrichter_ids: Iterable[Any]) -> list[Mapping[str, Any]]:
    """Each season holding a fixture still to be played that one of these referees is booked on, by `REQ-RETIRE-004`'s own filter."""

    return [
        {"$match": build_unplayed_assignment_filter({"$in": list(schiedsrichter_ids)})},
        {"$group": {"_id": {"schiedsrichter_id": "$schiedsrichter.schiedsrichter_id", "saison_id": "$saison_id"}}},
        {"$replaceWith": "$_id"},
        {"$sort": {"saison_id": 1}},
    ]


def build_erasure_kader_pipeline(spieler_ids: Iterable[Any]) -> list[Mapping[str, Any]]:
    """Every squad row of these pupils, a retired one included, as the pupil's step selects what it removes."""

    return [
        {"$match": {"spieler_id": {"$in": list(spieler_ids)}}},
        {"$project": {"spieler_id": 1, "saison_id": 1, "team_id": 1, "inactive_since": 1}},
        {"$sort": {"saison_id": 1, "team_id": 1, "_id": 1}},
    ]


# One entry per kind, named alike in both previews: the person's own and the administrator's, which
# adds the ids its links need, can then never name one record two ways.


def _pupil_entry(row: Mapping[str, Any]) -> dict[str, Any]:
    return {"vorname": row.get("vorname"), "nachname": row.get("nachname")}


def _referee_entry(row: Mapping[str, Any]) -> dict[str, Any]:
    return {"name": row.get("name")}


def _seat_entry(row: Mapping[str, Any], slot: str) -> dict[str, Any]:
    person = (row.get("kontakte") or {}).get(slot) or {}

    return {"saison_id": row.get("saison_id"), "rolle": slot, "vorname": person.get("vorname"), "nachname": person.get("nachname")}


def _registrierung_entry(row: Mapping[str, Any], team_names: Mapping[tuple[Any, Any], Any]) -> dict[str, Any]:
    return {
        "saison_id": row["saison_id"],
        "team_name": team_names.get((row["saison_id"], row["team_id"])),
        "vorname": row.get("vorname"),
        "nachname": row.get("nachname"),
    }


def _team_names(team_rows: Iterable[Mapping[str, Any]]) -> dict[tuple[Any, Any], Any]:
    return {(row["saison_id"], row["team_id"]): row.get("name") for row in team_rows}


def _kader_entry(row: Mapping[str, Any], team_names: Mapping[tuple[Any, Any], Any]) -> dict[str, Any]:
    return {
        "saison_id": row["saison_id"],
        "team_id": row["team_id"],
        "team_name": team_names.get((row["saison_id"], row["team_id"])),
        "inactive_since": row.get("inactive_since"),
    }


def compose_erasure_ansicht(
    identifier: str,
    *,
    saison_team_rows: Sequence[Mapping[str, Any]],
    bewerbung_rows: Sequence[Mapping[str, Any]],
    referee_rows: Sequence[Mapping[str, Any]],
    pupil_rows: Sequence[Mapping[str, Any]],
    registrierung_rows: Sequence[Mapping[str, Any]],
    adresswechsel_rows: Sequence[Mapping[str, Any]],
    team_rows: Sequence[Mapping[str, Any]],
) -> FLSelbstErasureAnsicht:
    """The preview, from the rows the erasure's own subject read holds; no address and no birthdate reaches it."""

    team_names = _team_names(team_rows)

    return FLSelbstErasureAnsicht.model_validate(
        {
            "spieler": [_pupil_entry(row) for row in pupil_rows],
            "schiedsrichter": [_referee_entry(row) for row in referee_rows],
            "sitze": [{**_seat_entry(row, slot), "team_name": row.get("name")} for row, slot in seats_naming(saison_team_rows, identifier)],
            "bewerbungen": [_seat_entry(row, slot) for row, slot in seats_naming(bewerbung_rows, identifier)],
            "registrierungen": [_registrierung_entry(row, team_names) for row in registrierung_rows],
            "adresswechsel": len(adresswechsel_rows),
        }
    )


def compose_erasure_ansicht_auf_anfrage(
    identifier: str,
    *,
    saison_team_rows: Sequence[Mapping[str, Any]],
    bewerbung_rows: Sequence[Mapping[str, Any]],
    referee_rows: Sequence[Mapping[str, Any]],
    pupil_rows: Sequence[Mapping[str, Any]],
    registrierung_rows: Sequence[Mapping[str, Any]],
    adresswechsel_rows: Sequence[Mapping[str, Any]],
    # Each address the tool refuses this reader, and why; one absent opens.
    verwehrt: Mapping[str, FLAdresswechselEinsehbarVerwehrt],
    eigener_adresswechsel: Mapping[str, Any] | None,
    antrag_rows: Sequence[Mapping[str, Any]],
    kader_rows: Sequence[Mapping[str, Any]],
    team_rows: Sequence[Mapping[str, Any]],
    unplayed_rows: Sequence[Mapping[str, Any]],
) -> FLErasureAnsicht:
    """The administrator's reveal, from the rows the erasure's own subject read holds, by the ids the page links each record by.

    The pending changes are named, never counted: the page links each row to the tool acting on it.
    """

    team_names = _team_names(team_rows)

    return FLErasureAnsicht.model_validate(
        {
            "spieler": [
                {
                    **_pupil_entry(row),
                    "spieler_id": row["_id"],
                    "kader": [_kader_entry(kader, team_names) for kader in kader_rows if kader["spieler_id"] == row["_id"]],
                }
                for row in pupil_rows
            ],
            "schiedsrichter": [
                {
                    **_referee_entry(row),
                    "schiedsrichter_id": row["_id"],
                    "inactive_since": row.get("inactive_since"),
                    "spiele_ohne_ergebnis_saison_ids": [
                        unplayed["saison_id"] for unplayed in unplayed_rows if unplayed["schiedsrichter_id"] == row["_id"]
                    ],
                }
                for row in referee_rows
            ],
            "sitze": [
                {**_seat_entry(row, slot), "team_name": row.get("name"), "team_id": row["team_id"]}
                for row, slot in seats_naming(saison_team_rows, identifier)
            ],
            "bewerbungen": [{**_seat_entry(row, slot), "bewerbung_id": row["_id"]} for row, slot in seats_naming(bewerbung_rows, identifier)],
            "registrierungen": [
                {**_registrierung_entry(row, team_names), "registrierung_id": row["_id"], "team_id": row["team_id"], "status": row["status"]}
                for row in registrierung_rows
            ],
            "adresswechsel": [
                {"adresswechsel_id": row["_id"], "einsehbar_verwehrt": verwehrt.get(str(row.get("adresse")))} for row in adresswechsel_rows
            ],
            "eigener_adresswechsel": None if eigener_adresswechsel is None else {"adresswechsel_id": eigener_adresswechsel["_id"]},
            "antraege": [
                {
                    "antrag_id": row["_id"],
                    "verwaltung": row["genehmigung"]["verwaltung"],
                    "rolle": "betroffen" if row["adresse"] == identifier else "gestellt",
                }
                for row in antrag_rows
            ],
        }
    )


def build_pupil_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Equality and no pattern: `spieler.email` stores the folded form."""

    return [
        {"$match": build_selbst_pupil_filter(identifier)},
        {"$project": {"einwilligung.bestaetigt_am": 1, "inactive_since": 1}},
        {"$sort": {"_id": 1}},
    ]


def build_bewerbung_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every pending application one of whose seats names the address; read for the sign-in alone, no panel standing on one."""

    return [
        {"$match": build_eigene_bewerbung_filter(identifier)},
        {"$project": {f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_ROLLEN for field in ("email", "einwilligung.bestaetigt_am")}},
    ]


def build_registrierung_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every pending registration of the address; read for the sign-in alone, no panel standing on one.

    The whole consent record rides along: whether its pupil confirmed it is part of the judgement.
    """

    return [{"$match": build_eigene_registrierung_filter(identifier)}, {"$project": {"status": 1, "email": 1, "einwilligung": 1}}]


def folded(stored: Any) -> str | None:
    """One stored address on the fold both ends of a join share, or `None` where nothing is stored.

    The null arm carries an empty seat slot and a referee whose `kontakt.email` is null, each
    declared so in `app/core/constraints.py`.
    """

    return None if stored is None else sign_in_identifier(str(stored))


def folds_to(stored: Any, identifier: str) -> bool:
    """Whether one stored address is this mailbox."""

    return folded(stored) == identifier


def seat_address(row: Mapping[str, Any], slot: str) -> Any:
    """What one slot of a row's block stores as its address; a cleared block and an empty slot store none."""

    return ((row.get("kontakte") or {}).get(slot) or {}).get("email")


def seats_naming(rows: Sequence[Mapping[str, Any]], identifier: str) -> list[tuple[Mapping[str, Any], str]]:
    """One pair per SLOT rather than per row: one address stands in two of a block's person slots wherever one person was entered twice."""

    return [(row, slot) for row in rows for slot in KONTAKT_ROLLEN if folds_to(seat_address(row, slot), identifier)]


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
# read's `erteilbar` is that same predicate (`docs/backend/spec.md :: I597`).


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


# Refused rather than warned of: with no owner left nobody may make one or change a tier again, and only
# a database paste could hand the administration on (`docs/backend/spec.md :: I436`).
LETZTER_INHABER_ERASURE = "REQ-PURGE-004"


def holds_an_owner_grant(identifier: str, grants: Iterable[Mapping[str, Any]]) -> bool:
    """Whether this folded address holds one of these live grants as an `owner`."""

    return any(grant["adresse"] == identifier and grant["verwaltung"] == OWNER for grant in grants)


def find_letzter_inhaber_erasure_refusal(*, identifier: str, grants: Iterable[Mapping[str, Any]], barred: Iterable[str]) -> WriteRefusal | None:
    """`REQ-PURGE-004`: the address holding the last live, unbarred `owner` grant erases itself only once another holds one.

    `grants` are the live ones. A barred `owner` admits nobody, so it is no owner here, as for a demotion.
    """

    owners = {str(grant["adresse"]) for grant in grants if grant["verwaltung"] == OWNER} - set(barred)
    if owners != {identifier}:
        return None

    return WriteRefusal(
        error_code=LETZTER_INHABER_ERASURE,
        status=HTTPStatus.CONFLICT,
        message="the administration keeps at least one owner; make another administrator an owner before erasing yourself",
    )


# 403 and not 409, `REQ-BERECHTIGUNG-005`'s precedent: the refusal is about who asks. An administrator's
# own records go through their account page, or through an owner (`REQ-PURGE-005`).
EIGENE_ADRESSE = "REQ-PURGE-003"


def ist_eigene_adresse(*, identifier: str, akteur: str) -> bool:
    """`REQ-PURGE-003`'s judgement, both folded: the refusal raises on it, and a read serving whether the tool opens an address asks it."""

    return identifier == akteur


def find_eigene_adresse_refusal(*, identifier: str, akteur: str) -> WriteRefusal | None:
    """`REQ-PURGE-003`: an administrator's route on a mailbox refuses the mailbox they act as, both folded."""

    if not ist_eigene_adresse(identifier=identifier, akteur=akteur):
        return None

    return WriteRefusal(
        error_code=EIGENE_ADRESSE,
        status=HTTPStatus.FORBIDDEN,
        message="an administrator does not act on their own address here; their own account page does, or an owner",
    )


# 403 for who asks, as `REQ-PURGE-003`: without it an administrator ends another's grant, which a revoke
# reserves to an owner (`REQ-BERECHTIGUNG-005`).
VERWALTUNG_ADRESSE = "REQ-PURGE-005"

# The erasure's and its reveal's: the one ends the grant, the other opens the holder's records.
JEDE_VERWALTUNG: Final[frozenset[str]] = frozenset(get_args(FLVerwaltung))
# The sign-out's: an ended session is repaired by signing in again, so only an owner's is held back.
NUR_INHABER: Final[frozenset[str]] = frozenset({OWNER})

# 403 for who asks, as `REQ-PURGE-005`: an erasure ends every change naming its address, and ending a grant holder's
# change is a discard, which only an owner may make of it.
FREMDER_ADRESSWECHSEL = "REQ-PURGE-007"

# The tiers whose holder's pending change an erasure ends only for an actor holding an owner's power: every one, the set
# the erasure's preview withholds from anyone else, as only an owner discards an administrator's change.
ADRESSWECHSEL_GESCHUETZT: Final[frozenset[str]] = JEDE_VERWALTUNG


def verwaltung_adresse_verwehrt(
    *,
    identifier: str,
    akteur: str,
    auth_time: int,
    grants: Sequence[Mapping[str, Any]],
    announced: Sequence[Mapping[str, Any]],
    geschuetzt: frozenset[str],
) -> bool:
    """`REQ-PURGE-005`'s judgement: the address holds a live grant of a `geschuetzt` tier and the actor no owner's power."""

    return verwaltung_des(identifier, grants) in geschuetzt and not holds_an_owners_power(
        akteur=akteur, auth_time=auth_time, grants=grants, announced=announced
    )


def find_verwaltung_adresse_refusal(
    *,
    identifier: str,
    akteur: str,
    auth_time: int,
    grants: Sequence[Mapping[str, Any]],
    announced: Sequence[Mapping[str, Any]],
    geschuetzt: frozenset[str],
) -> WriteRefusal | None:
    """`REQ-PURGE-005`: an address holding a live grant of a `geschuetzt` tier is acted on only by an actor holding an owner's power.

    `grants` and `announced` as stored, read where the caller judges, so a retry judges them afresh.
    """

    if not verwaltung_adresse_verwehrt(
        identifier=identifier, akteur=akteur, auth_time=auth_time, grants=grants, announced=announced, geschuetzt=geschuetzt
    ):
        return None

    return WriteRefusal(
        error_code=VERWALTUNG_ADRESSE,
        status=HTTPStatus.FORBIDDEN,
        message="this address holds access to the administration; only an owner, signed in since becoming one, acts on it here",
    )


def find_fremder_adresswechsel_refusal(
    *,
    adressen: Iterable[str],
    akteur: str,
    auth_time: int,
    grants: Sequence[Mapping[str, Any]],
    announced: Sequence[Mapping[str, Any]],
) -> WriteRefusal | None:
    """`REQ-PURGE-007`: an erasure ends no pending change of an address holding an `ADRESSWECHSEL_GESCHUETZT` grant without an owner's power.

    `adressen` are the changes' own addresses, never the one erased; the message names none of them.
    """

    if not any(
        verwaltung_adresse_verwehrt(
            identifier=adresse, akteur=akteur, auth_time=auth_time, grants=grants, announced=announced, geschuetzt=ADRESSWECHSEL_GESCHUETZT
        )
        for adresse in adressen
    ):
        return None

    return WriteRefusal(
        error_code=FREMDER_ADRESSWECHSEL,
        status=HTTPStatus.FORBIDDEN,
        message="erasing this address would end an administrator's pending address change, which only an owner ends",
    )


def adresswechsel_einsehbar_verwehrt(
    identifier: str, *, akteur: str, auth_time: int, grants: Sequence[Mapping[str, Any]], announced: Sequence[Mapping[str, Any]]
) -> FLAdresswechselEinsehbarVerwehrt | None:
    """Why the address tool refuses this administrator this address's change, in the order it refuses; `None` where it opens it.

    Their judgements, never their finders: a read reaching a finder publishes that code (`tests/core/test_rule_publication.py`).
    """

    if ist_eigene_adresse(identifier=identifier, akteur=akteur):
        return "eigene"
    if verwaltung_adresse_verwehrt(
        identifier=identifier, akteur=akteur, auth_time=auth_time, grants=grants, announced=announced, geschuetzt=JEDE_VERWALTUNG
    ):
        return "verwaltung"

    return None


# 422 on the box, as the address the payload's own validator refuses there: the value typed is what is
# refused, and the administrator rephrases it (`docs/backend/spec.md :: I721`).
NAME_IM_ANLASS = "REQ-PURGE-006"

# The ban's reason, by the same matcher and on its own box (`docs/backend/spec.md :: I726`). Here rather than beside the
# ban's other codes: `app/api/sperrliste/services.py` is imported by a module this one imports.
NAME_IM_GRUND = "REQ-SPERRLISTE-004"

# Exempt only before a later word of their field that is not one: alone, „der“ or „von“ would refuse most German
# sentences, and a surname such as a referee's „Le“ ends its field.
NAME_PARTICLES: frozenset[str] = frozenset(
    {"von", "vom", "van", "der", "den", "de", "zu", "zur", "zum", "di", "da", "du", "la", "le", "ten", "ter", "dos"}
)

# Letters alone, never `\w`, which takes a digit and `_` into a word: no stored name holds either, so each ends one, and
# „Müller2“ and „Löschung_Müller“ name „Müller“.
_LETTERS = re.compile(r"[^\W\d_]+")
_NO_LETTER_BEFORE, _NO_LETTER_AFTER = r"(?<![^\W\d_])", r"(?![^\W\d_])"

# German writes a name's genitive, and a family's plural, with a bare s, „Annas“ and „Müllers“; a name ending in one
# of these takes an apostrophe, which already ends the word.
_ENDS_GENITIVE_FREE = ("s", "x", "z", "ß")
# Shorter, „da“ and „de“ would refuse „das“ and „des“.
_GENITIVE_FLOOR = 3


def _named_words(whole: str) -> list[str]:
    """`whole`'s words, a particle followed by a later word of its own that is not a particle excepted.

    „Anna von der Heide“ names neither „von“ nor „der“ alone; „Thi Mai Le“ names „Le“.
    """

    words = _LETTERS.findall(whole)

    return [
        word
        for index, word in enumerate(words)
        if word.lower() not in NAME_PARTICLES or all(later.lower() in NAME_PARTICLES for later in words[index + 1 :])
    ]


def eigene_namen(
    identifier: str,
    *,
    saison_team_rows: Sequence[Mapping[str, Any]],
    bewerbung_rows: Sequence[Mapping[str, Any]],
    referee_rows: Iterable[Mapping[str, Any]],
    pupil_rows: Iterable[Mapping[str, Any]],
    registrierung_rows: Iterable[Mapping[str, Any]],
) -> frozenset[str]:
    """Every name the person's own records hold, as the reveal names each: each field whole and each of its words (`_named_words`).

    Capitals kept: a lowered „ẞ“ yields „SS“ in upper case, never its own „ẞ“, which `holds_a_name` compares.
    """

    fields = [
        *(_pupil_entry(row)[part] for row in pupil_rows for part in ("vorname", "nachname")),
        *(
            _seat_entry(row, slot)[part]
            for row, slot in seats_naming([*saison_team_rows, *bewerbung_rows], identifier)
            for part in ("vorname", "nachname")
        ),
        *(row.get(part) for row in registrierung_rows for part in ("vorname", "nachname")),
        *(_referee_entry(row)["name"] for row in referee_rows),
    ]

    return namen_aus(fields)


def namen_aus(fields: Iterable[Any]) -> frozenset[str]:
    """Every name these stored name fields hold: each field whole and each of its words (`_named_words`), for `holds_a_name`.

    The one rule for every record whose free text refuses its people's names, whichever records it gathers the fields from.
    """

    wholes = {composed_name(field) for field in fields}
    names = wholes | {word for whole in wholes for word in _named_words(whole)}

    # Without the empty name of an absent field, which would stand as a whole word everywhere, and without one letter, an
    # initial or the O' of an elision, which identifies nobody and would refuse „i. A.“.
    return frozenset(name for name in names if len(name) > 1)


def holds_a_name(text: str, names: Iterable[str]) -> bool:
    """Whether a name of `names` stands in `text` as a whole word or words, or before a genitive s.

    Equal in plain lower or plain upper case and no other spelling: „Weiss“ names „Weiß“, „Mueller“ nobody.
    """

    # Unicode's format characters (category Cf) go here alone, never from what is stored: a soft hyphen or a zero-width
    # space pasted from a mail's subject splits a name, and `composed_name` keeps both.
    composed = composed_name("".join(char for char in text if unicodedata.category(char) != "Cf"))

    def stands_in(name: str) -> bool:
        genitive = len(name) >= _GENITIVE_FLOOR and not name.lower().endswith(_ENDS_GENITIVE_FREE)

        # Never `re.IGNORECASE`, which matches one character to one and so never „WEISS“ to „Weiß“: each case form is
        # searched in the text cased the same way.
        for cased in (str.lower, str.upper):
            suffix = f"{cased('s')}?" if genitive else ""
            if re.search(f"{_NO_LETTER_BEFORE}{re.escape(cased(name))}{suffix}{_NO_LETTER_AFTER}", cased(composed)):
                return True

        return False

    return any(stands_in(name) for name in names)


def find_name_im_anlass_refusal(*, anlass: str, names: Iterable[str]) -> WriteRefusal | None:
    """`REQ-PURGE-006`: no name of the person's own records stands in the request the erasure answers (`holds_a_name`).

    A common word equal to a name is refused with it, and the administrator rephrases.
    """

    if not holds_a_name(anlass, names):
        return None

    # Naming none of them: the message reaches the refusal's log line.
    return WriteRefusal(
        error_code=NAME_IM_ANLASS,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        message="the request this erasure answers names the person, and every log row the erasure files would keep that name for a year",
        fields=(("anlass",),),
    )


def find_name_im_grund_refusal(*, grund: str, names: Iterable[str]) -> WriteRefusal | None:
    """`REQ-SPERRLISTE-004`: no name of the records the address holds stands in the ban's reason (`holds_a_name`).

    The reason is served, mailed to the address and kept past the person's erasure. A common word equal to a name is
    refused with it.
    """

    if not holds_a_name(grund, names):
        return None

    # Naming none of them, as the erasure's own: the message reaches the refusal's log line.
    return WriteRefusal(
        error_code=NAME_IM_GRUND,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        message="the reason for this ban names a person the address's records hold, and the ban keeps it past that person's erasure",
        fields=(("grund",),),
    )


# --- The REFERENCES: wider than the own records and than the sign-in gate alike
# (`docs/backend/spec.md :: I698`). Each selection is the one its record's own reads take
# for one address, asked for a batch.

# The address alone, never the confirmation: an unconfirmed seat on the running season is one the
# gate admits, to be told its confirmation is outstanding.
SEAT_ADDRESS_FIELDS: Mapping[str, int] = {f"kontakte.{slot}.email": 1 for slot in KONTAKT_ROLLEN}


def build_seat_references_pipeline(identifiers: Iterable[str]) -> list[Mapping[str, Any]]:
    """Every season row whose block names one of these addresses, a past season's and a withdrawn team's alike."""

    return [{"$match": rows_seating(*identifiers)}, {"$project": SEAT_ADDRESS_FIELDS}]


def build_bewerbung_references_pipeline(identifiers: Iterable[str]) -> list[Mapping[str, Any]]:
    return [{"$match": build_eigene_bewerbung_filter(*identifiers)}, {"$project": SEAT_ADDRESS_FIELDS}]


def build_referee_references_pipeline(identifiers: Iterable[str]) -> list[Mapping[str, Any]]:
    """Retired rows too: a retired referee's account signs in to take back a consent."""

    return [
        {"$match": build_selbst_referee_filter(*identifiers)},
        {"$project": {"kontakt.email": 1}},
    ]


def build_pupil_references_pipeline(identifiers: Iterable[str]) -> list[Mapping[str, Any]]:
    """`build_selbst_pupil_filter`'s equality over a batch, its `$type` term the unique index's partial filter, which `$in` does not imply."""

    return [
        {"$match": {"email": {"$in": sorted(set(identifiers)), "$type": "string"}, **build_real_spieler_filter()}},
        {"$project": {"email": 1}},
    ]


def build_registrierung_references_pipeline(identifiers: Iterable[str]) -> list[Mapping[str, Any]]:
    return [
        {"$match": build_eigene_registrierung_filter(*identifiers)},
        {"$project": {"status": 1, "email": 1, "einwilligung": 1}},
    ]


def referenced_addresses(
    *,
    seat_rows: Iterable[Mapping[str, Any]],
    bewerbung_rows: Iterable[Mapping[str, Any]],
    referee_rows: Iterable[Mapping[str, Any]],
    pupil_rows: Iterable[Mapping[str, Any]],
    registrierung_rows: Iterable[Mapping[str, Any]],
    grant_rows: Iterable[Mapping[str, Any]],
    carry_rows: Iterable[Mapping[str, Any]],
) -> frozenset[str]:
    """Every address, on the sign-in fold, that one of these records names (`docs/backend/spec.md :: I698`)."""

    stored = (
        *(seat_address(row, slot) for row in seat_rows for slot in KONTAKT_ROLLEN),
        *(seat_address(row, slot) for row in bewerbung_rows for slot in KONTAKT_ROLLEN),
        # The row's own address and never a pending change's: that admits no sign-in until confirmed, and
        # the address it replaces stays here till then (`docs/backend/spec.md :: I560`).
        *map(referee_address, referee_rows),
        *map(pupil_address, pupil_rows),
        # The one kind narrowed to its pupil's confirmation, as the gate narrows it, each row judged on its
        # own fold: the set holds every address a record names, so a row read for another mailbox adds its own.
        *(row.get("email") for row in registrierung_rows if ist_eigene_registrierung(row, folded(row.get("email")) or "")),
        *(row.get("adresse") for row in grant_rows),
        # An effect's notice owing its account's carry: swept before its drain, the account and its passkeys are gone.
        *(row.get("bisherige_email") for row in carry_rows),
    )

    return frozenset(address for address in map(folded, stored) if address is not None)


def unreferenced(identifiers: Iterable[str], *, referenced: Collection[str]) -> list[str]:
    """Each once, in the spelling it was asked in: the caller deletes the account holding that spelling."""

    return list(dict.fromkeys(identifier for identifier in identifiers if sign_in_identifier(identifier) not in referenced))


# Refused rather than answered: a league always holds a live `owner` (`docs/backend/spec.md :: I479`),
# so grants holding none were read from an empty or foreign database, which would answer every address
# unreferenced (`docs/backend/spec.md :: I712`).
KEIN_INHABER = "REQ-REFERENZEN-001"


def find_kein_inhaber_refusal(grant_rows: Sequence[Mapping[str, Any]]) -> WriteRefusal | None:
    """`REQ-REFERENZEN-001`: no live grant is an `owner`'s, live as every reader of a grant reads one."""

    if any(grant.get("verwaltung") == OWNER for grant in lebendige(grant_rows)):
        return None

    return WriteRefusal(
        error_code=KEIN_INHABER,
        status=HTTPStatus.CONFLICT,
        message="the grants hold no live owner, so the database read is not the league's and no address is judged unreferenced",
    )


# --- The SEASON-AFTER RULE (`docs/backend/spec.md :: I690`), keyed on the stored statuses and never
# on a next season's id, which a skipped year leaves naming no season at all.


def statuses_of(saison_rows: Iterable[Mapping[str, Any]]) -> dict[str, FLSaisonStatus]:
    return {row["_id"]: row["status"] for row in saison_rows}


def abgeschlossene_saison_id(statuses: Mapping[str, FLSaisonStatus]) -> str | None:
    """The `past` season with the greatest id, compared as strings: an id is a fixed-length year (`docs/glossary.md :: Saison`)."""

    return max((saison_id for saison_id, status in statuses.items() if status == "past"), default=None)


def behaltene_saison_ids(statuses: Mapping[str, FLSaisonStatus]) -> frozenset[str] | None:
    """The seasons a squad row keeps its pupil in (`docs/backend/spec.md :: I715`), or `None` while no season is `past`.

    By id, as a planned season below the one just ended may never run: activation refuses no lower id.
    """

    abgeschlossen = abgeschlossene_saison_id(statuses)
    if abgeschlossen is None:
        return None

    return frozenset(saison_id for saison_id, status in statuses.items() if saison_id >= abgeschlossen or status == "active")


def statuses_after_activating(statuses: Mapping[str, FLSaisonStatus], saison_id: str) -> dict[str, FLSaisonStatus]:
    """The statuses `POST /saisons/{saison_id}/activate` leaves, its refusals unjudged: the incumbent `past`, the target `active`."""

    return {other: "active" if other == saison_id else "past" if status == "active" else status for other, status in statuses.items()}


def geschlossen_durch(statuses: Mapping[str, FLSaisonStatus], saison_id: str) -> str | None:
    """The season activating `saison_id` turns `past`: the `active` one, unless it is the target itself."""

    return next((other for other, status in statuses.items() if status == "active" and other != saison_id), None)


def build_offene_registrierungen_pipeline() -> list[Mapping[str, Any]]:
    """Every pending registration's address, which keeps the pupil it folds to."""

    return [{"$match": {"status": SUBMITTED}}, {"$project": {"status": 1, "email": 1}}]


def offene_adressen(registrierung_rows: Iterable[Mapping[str, Any]]) -> frozenset[str]:
    """The pending registrations' addresses, each the fold a pupil's `email` holds (`docs/backend/spec.md :: I332`)."""

    return frozenset(row["email"] for row in registrierung_rows if row.get("status") == SUBMITTED and isinstance(row.get("email"), str))


def loeschung_faellig(*, email: Any, kader_saison_ids: Iterable[str], offene: AbstractSet[str], behalten: frozenset[str] | None) -> bool:
    """Whether one pupil is due, judged in the erasure's own transaction.

    A retired squad row keeps its pupil as a live one does: removing a player retires the row.
    """

    # Folding a hand-typed address instead would erase by a spelling the stored row does not hold, and remove nobody.
    return behalten is not None and is_stored_identifier(email) and email not in offene and behalten.isdisjoint(kader_saison_ids)


def build_loeschung_pipeline(*, behalten: frozenset[str], offene: AbstractSet[str]) -> list[Mapping[str, Any]]:
    """Every due pupil's id and address: `loeschung_faellig` as one read, its stored-address test excepted, which no stage spells.

    An addressless pupil is never read: the registry erases by address.
    """

    return [
        # The sentinel twice, by id and by holding no address: either term alone keeps it out.
        {"$match": build_real_spieler_filter({"email": {"$type": "string", "$nin": sorted(offene)}})},
        {
            "$lookup": {
                "from": DbCollection.SAISON_SPIELER,
                "localField": "_id",
                "foreignField": "spieler_id",
                # Every row, its `inactive_since` unread, for `loeschung_faellig`'s reason.
                "pipeline": [{"$match": {"saison_id": {"$in": sorted(behalten)}}}, {"$limit": 1}, {"$project": {"_id": 1}}],
                "as": "behalten",
            }
        },
        {"$match": {"behalten": {"$size": 0}}},
        {"$project": {"_id": 1, "email": 1}},
    ]


def build_loeschung_seite_pipeline(
    *, behalten: frozenset[str], offene: AbstractSet[str], nach: ObjectId | None, groesse: int
) -> list[Mapping[str, Any]]:
    """The due pupils after `nach` in `_id` order, at most `groesse`, beside how many are due in all, as ONE document."""

    seite: list[Mapping[str, Any]] = [{"$sort": {"_id": 1}}, {"$limit": groesse}]

    return [
        *build_loeschung_pipeline(behalten=behalten, offene=offene),
        {"$facet": {"seite": seite if nach is None else [{"$match": {"_id": {"$gt": nach}}}, *seite], "anzahl": [{"$count": "anzahl"}]}},
    ]


def build_loeschung_anzahl_pipeline(*, behalten: frozenset[str], offene: AbstractSet[str]) -> list[Mapping[str, Any]]:
    return [*build_loeschung_pipeline(behalten=behalten, offene=offene), {"$count": "anzahl"}]


def ohne_passende_adresse(rows: Iterable[Mapping[str, Any]]) -> list[Any]:
    """The ids among `rows` whose stored address no request matches (`app/shared/folding.py :: is_stored_identifier`)."""

    return [row["_id"] for row in rows if not is_stored_identifier(row.get("email"))]
