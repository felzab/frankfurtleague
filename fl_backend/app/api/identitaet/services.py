"""
API · the subject read's judgements, apart from the handles they are asked of

Here rather than in `crud.py`, which opens collections: a services module is what
`fl_backend/tests/core/test_write_shapes.py :: TestEveryServiceModuleDecidesFromItsArguments` sweeps,
so a judgement left beside a handle is one nothing stops from growing a read of its own.
"""

from collections.abc import Callable, Collection, Iterable, Mapping, Sequence
from http import HTTPStatus
from typing import Any, Literal

from bson import ObjectId

from app.api.berechtigungen.services import OWNER
from app.api.bewerbungen.services import build_eigene_bewerbung_filter
from app.api.identitaet.schemas import FLSelbstErasureAnsicht, FLSubjekt, FLSubjektSitz
from app.api.kontakte.services import rows_possibly_naming, same_address
from app.api.registrierungen.services import SUBMITTED, build_eigene_registrierung_filter, build_erasure_registrierung_filter
from app.api.saisons.schemas import FLSaisonStatus
from app.api.schiedsrichter.services import ADRESSWECHSEL_FELD, build_real_referees_filter, build_selbst_referee_filter
from app.api.spieler.services import build_real_spieler_filter, build_selbst_pupil_filter
from app.api.teams.schemas import KONTAKT_ROLLEN
from app.core.exceptions import WriteRefusal
from app.shared.einwilligung import is_confirmed
from app.shared.folding import canonical_address, sign_in_identifier

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


# --- The ERASURE's selections: every status, every retired row and every unconfirmed seat, so the
# preview and the erasure name one set and the narrowing above takes nothing out of either.

# What a seat is named by in the preview, beside the address the fold judges it on.
ERASURE_SEAT_FIELDS: tuple[str, ...] = ("email", "vorname", "nachname")


def build_erasure_seat_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every season row or application whose seats may name the address, whatever its status.

    `bestaetigungen` rides along whole: the clearing nulls a seat's bookkeeping only where the block
    exists (`app/api/kontakte/services.py :: build_clearing_update`).
    """

    return [
        {"$match": rows_possibly_naming(identifier)},
        {
            "$project": {
                "saison_id": 1,
                "name": 1,
                "bestaetigungen": 1,
                **{f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_ROLLEN for field in ERASURE_SEAT_FIELDS},
            }
        },
        {"$sort": {"saison_id": 1, "_id": 1}},
    ]


def build_erasure_referee_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    return [{"$match": build_selbst_referee_filter(identifier)}, {"$project": {"name": 1, "kontakt.email": 1}}, {"$sort": {"_id": 1}}]


def build_erasure_pupil_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    return [{"$match": build_selbst_pupil_filter(identifier)}, {"$project": {"vorname": 1, "nachname": 1}}, {"$sort": {"_id": 1}}]


def build_erasure_registrierung_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    return [
        {"$match": build_erasure_registrierung_filter(identifier)},
        {"$project": {"saison_id": 1, "team_id": 1, "email": 1, "vorname": 1, "nachname": 1}},
        {"$sort": {"saison_id": 1, "_id": 1}},
    ]


def build_registrierung_team_pipeline(registrierung_rows: Iterable[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """The season rows naming each registration's team that season.

    Never asked of no registration: the server refuses an empty `$or`.
    """

    pairs = dict.fromkeys((row["saison_id"], row["team_id"]) for row in registrierung_rows)

    return [
        {"$match": {"$or": [{"saison_id": saison_id, "team_id": team_id} for saison_id, team_id in pairs]}},
        {"$project": {"saison_id": 1, "team_id": 1, "name": 1}},
    ]


def build_pending_address_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every referee row whose pending address change may name the address; no other read keys on that field."""

    return [
        {"$match": {f"{ADRESSWECHSEL_FELD}.email": same_address(identifier), **build_real_referees_filter()}},
        {"$project": {f"{ADRESSWECHSEL_FELD}.email": 1, "kontakt.email": 1}},
        {"$sort": {"_id": 1}},
    ]


def build_pending_pupil_address_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every pupil row whose pending address change, the referee block's twin, may name the address."""

    return [
        {"$match": {f"{ADRESSWECHSEL_FELD}.email": same_address(identifier), **build_real_spieler_filter()}},
        {"$project": {f"{ADRESSWECHSEL_FELD}.email": 1, "email": 1}},
        {"$sort": {"_id": 1}},
    ]


def referee_address(row: Mapping[str, Any]) -> Any:
    return (row.get("kontakt") or {}).get("email")


def pupil_address(row: Mapping[str, Any]) -> Any:
    return row.get("email")


def pending_addresses_of(
    rows: Iterable[Mapping[str, Any]], identifier: str, *, stored: Callable[[Mapping[str, Any]], Any]
) -> list[Mapping[str, Any]]:
    """The rows whose pending address IS this mailbox and whose `stored` one is not, each the old address's person's.

    A row holding the address in both is the address's own row, which the erasure takes whole.
    """

    return [
        row for row in rows if folds_to((row.get(ADRESSWECHSEL_FELD) or {}).get("email"), identifier) and not folds_to(stored(row), identifier)
    ]


def _seat_entry(row: Mapping[str, Any], slot: str) -> dict[str, Any]:
    person = (row.get("kontakte") or {}).get(slot) or {}

    return {"saison_id": row.get("saison_id"), "rolle": slot, "vorname": person.get("vorname"), "nachname": person.get("nachname")}


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

    team_names = {(row["saison_id"], row["team_id"]): row.get("name") for row in team_rows}

    return FLSelbstErasureAnsicht.model_validate(
        {
            "spieler": [{"vorname": row.get("vorname"), "nachname": row.get("nachname")} for row in pupil_rows],
            "schiedsrichter": [{"name": row.get("name")} for row in referee_rows],
            "sitze": [{**_seat_entry(row, slot), "team_name": row.get("name")} for row, slot in seats_naming(saison_team_rows, identifier)],
            "bewerbungen": [_seat_entry(row, slot) for row, slot in seats_naming(bewerbung_rows, identifier)],
            "registrierungen": [
                {
                    "saison_id": row["saison_id"],
                    "team_name": team_names.get((row["saison_id"], row["team_id"])),
                    "vorname": row.get("vorname"),
                    "nachname": row.get("nachname"),
                }
                for row in registrierung_rows
            ],
            "adresswechsel": len(adresswechsel_rows),
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


# --- The REFERENCES: wider than the own records and than the sign-in gate alike
# (`docs/backend/spec.md :: I698`). Each selection is the one its record's own reads take
# for one address, asked for a batch.

# An `$or` of those filters rather than one pattern taking every address, which costs a twelfth as
# much: the server refuses a pattern past about 32,000 characters, and a full batch of long addresses
# passes that.

# The address alone, never the confirmation: an unconfirmed seat on the running season is one the
# gate admits, to be told its confirmation is outstanding.
SEAT_ADDRESS_FIELDS: Mapping[str, int] = {f"kontakte.{slot}.email": 1 for slot in KONTAKT_ROLLEN}


def build_seat_references_pipeline(identifiers: Iterable[str]) -> list[Mapping[str, Any]]:
    """Every season row whose block may name one of these addresses, a past season's and a withdrawn team's alike."""

    return [{"$match": {"$or": [rows_possibly_naming(identifier) for identifier in identifiers]}}, {"$project": SEAT_ADDRESS_FIELDS}]


def build_bewerbung_references_pipeline(identifiers: Iterable[str]) -> list[Mapping[str, Any]]:
    return [{"$match": {"$or": [build_eigene_bewerbung_filter(identifier) for identifier in identifiers]}}, {"$project": SEAT_ADDRESS_FIELDS}]


def build_referee_references_pipeline(identifiers: Iterable[str]) -> list[Mapping[str, Any]]:
    """Retired rows too: a retired referee's account signs in to take back a consent."""

    return [
        {"$match": {"$or": [build_selbst_referee_filter(identifier) for identifier in identifiers]}},
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
        {"$match": {"$or": [build_eigene_registrierung_filter(identifier) for identifier in identifiers]}},
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
) -> frozenset[str]:
    """Every address, on the sign-in fold, that one of these records names (`docs/backend/spec.md :: I698`)."""

    stored = (
        *(seat_address(row, slot) for row in seat_rows for slot in KONTAKT_ROLLEN),
        *(seat_address(row, slot) for row in bewerbung_rows for slot in KONTAKT_ROLLEN),
        *((row.get("kontakt") or {}).get("email") for row in referee_rows),
        *(row.get("email") for row in pupil_rows),
        # The one kind narrowed to its pupil's confirmation, as the gate narrows it. The row's own fold
        # stands for the identifier, its selection having matched the row to the batch already.
        *(row.get("email") for row in registrierung_rows if ist_eigene_registrierung(row, folded(row.get("email")) or "")),
        *(row.get("adresse") for row in grant_rows),
    )

    return frozenset(address for address in map(folded, stored) if address is not None)


def can_judge(identifier: str) -> bool:
    """Whether this address may be called unreferenced at all.

    One today's address rule refuses keys no ban (`app/api/sperrliste/services.py :: stored_adresse_hash`),
    so a ban entered under an older rule may hold it unseen.
    """

    try:
        canonical_address(identifier)
    except ValueError:
        return False

    return True


def unreferenced(identifiers: Iterable[str], *, referenced: Collection[str], gesperrt: Collection[str]) -> list[str]:
    """Each once, in the spelling it was asked in: the caller deletes the account holding that spelling."""

    return list(
        dict.fromkeys(
            identifier
            for identifier in identifiers
            if can_judge(identifier) and sign_in_identifier(identifier) not in referenced and identifier not in gesperrt
        )
    )
