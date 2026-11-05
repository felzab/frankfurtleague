"""
API · the subject read's judgements, apart from the handles they are asked of

Here rather than in `crud.py`, which opens collections: a services module decides from its
arguments, so a judgement left beside a handle is one that can grow a read of its own.
"""

from collections.abc import Collection, Iterable, Mapping, Sequence
from collections.abc import Set as AbstractSet
from http import HTTPStatus
from typing import Any, Final, Literal, get_args

from bson import ObjectId

from app.api.berechtigungen.services import OWNER, admin_tier_of, holds_an_owners_power
from app.api.bewerbungen.services import build_eigene_bewerbung_filter
from app.api.identity.schemas import FLAccountErasureView, FLErasureView, FLSubject, FLSubjectSeat
from app.api.kontakte.services import rows_seating
from app.api.registrierungen.services import SUBMITTED, build_eigene_registrierung_filter, build_loeschung_registrierung_filter
from app.api.schiedsrichter.services import (
    build_self_referee_filter,
    build_unplayed_assignment_filter,
)
from app.api.spieler.services import build_self_pupil_filter
from app.core.codes import Code
from app.core.collections import Collection as DbCollection
from app.core.exceptions import WriteRefusal
from app.shared.einwilligung import is_confirmed
from app.shared.folding import sign_in_identifier
from app.shared.schemas.literals import KONTAKT_ROLLEN, FLAddressChangeViewableDenied, FLAdminTier, FLSaisonStatus

# --- The SELECTIONS, each shared with its record's own person-tier reads rather than spelled again.
# Unnarrowed by retirement or withdrawal: `_judged` narrows the Funktionen.


def saison_status_lookup() -> Mapping[str, Any]:
    """Each season row's own `saisons` row beside it as `saison`, its status alone: the read that finds a seat answers its season too."""

    return {
        "$lookup": {
            "from": DbCollection.SAISONS,
            "localField": "saison_id",
            "foreignField": "_id",
            "pipeline": [{"$project": {"status": 1}}],
            "as": "saison",
        }
    }


def seat_saison_statuses(rows: Iterable[Mapping[str, Any]]) -> dict[str, FLSaisonStatus]:
    """The status of each row's season, off the `saison` that `saison_status_lookup` joined.

    Raised rather than dropped: a seat whose season has no row is a database this read cannot answer truthfully for, and a
    silently shorter list is a person shown no panel at all.
    """

    statuses: dict[str, FLSaisonStatus] = {}
    for row in rows:
        [saison] = row.get("saison") or [None]
        if saison is None:
            raise RuntimeError(f"saison_teams holds a seat in {row['saison_id']}, which saisons has no row for")
        statuses[row["saison_id"]] = saison["status"]

    return statuses


def build_seat_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every junction row whose block names the address, a withdrawn team's included, its season's status beside it."""

    return [
        {"$match": rows_seating(identifier)},
        # `name` rides along free, this read opening the row anyway, and it is the row's own rather
        # than the club's.
        {
            "$project": {
                "saison_id": 1,
                "team_id": 1,
                "name": 1,
                "austritt": 1,
                **{f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_ROLLEN for field in ("email", "einwilligung.confirmed_at")},
            }
        },
        # Ordered in the read rather than by the reader: two clubs' seats held by one inbox are
        # otherwise answered in whatever order the collection was written in.
        {"$sort": {"saison_id": 1, "team_id": 1}},
        saison_status_lookup(),
    ]


def build_referee_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """The stored address rides along so `folds_to` can judge it, and the stamp so the confirmation can; nothing else of the person does."""

    return [
        {"$match": build_self_referee_filter(identifier)},
        {"$project": {"kontakt.email": 1, "einwilligung.confirmed_at": 1, "inactive_since": 1}},
        {"$sort": {"_id": 1}},
    ]


# --- The ERASURE's selections: every status, every retired row and every unconfirmed seat, so the
# preview and the erasure name one set and the narrowing above takes nothing out of either.

# What a seat is named by in the preview, beside the address the fold judges it on.
ERASURE_SEAT_FIELDS: tuple[str, ...] = ("email", "vorname", "nachname")


def build_erasure_seat_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every season row or application one of whose seats names the address, whatever its status.

    `confirmations` rides along whole: the clearing nulls a seat's bookkeeping only where the block
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
                "confirmations": 1,
                **{f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_ROLLEN for field in ERASURE_SEAT_FIELDS},
            }
        },
        {"$sort": {"saison_id": 1, "_id": 1}},
    ]


def build_erasure_referee_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    return [
        {"$match": build_self_referee_filter(identifier)},
        {"$project": {"name": 1, "kontakt.email": 1, "inactive_since": 1}},
        {"$sort": {"_id": 1}},
    ]


def build_erasure_pupil_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    return [{"$match": build_self_pupil_filter(identifier)}, {"$project": {"vorname": 1, "nachname": 1}}, {"$sort": {"_id": 1}}]


def build_erasure_registrierung_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    return [
        {"$match": build_loeschung_registrierung_filter(identifier)},
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
    """Each season with a fixture still to be played that one of these referees is booked on, by `schiedsrichter_still_assigned`'s filter."""

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


def compose_account_erasure_view(
    identifier: str,
    *,
    saison_team_rows: Sequence[Mapping[str, Any]],
    bewerbung_rows: Sequence[Mapping[str, Any]],
    referee_rows: Sequence[Mapping[str, Any]],
    pupil_rows: Sequence[Mapping[str, Any]],
    registrierung_rows: Sequence[Mapping[str, Any]],
    address_change_rows: Sequence[Mapping[str, Any]],
    team_rows: Sequence[Mapping[str, Any]],
) -> FLAccountErasureView:
    """The preview, from the rows the erasure's own subject read holds; no address and no birthdate reaches it."""

    team_names = _team_names(team_rows)

    return FLAccountErasureView.model_validate(
        {
            "spieler": [_pupil_entry(row) for row in pupil_rows],
            "schiedsrichter": [_referee_entry(row) for row in referee_rows],
            "seats": [{**_seat_entry(row, slot), "team_name": row.get("name")} for row, slot in seats_naming(saison_team_rows, identifier)],
            "bewerbungen": [_seat_entry(row, slot) for row, slot in seats_naming(bewerbung_rows, identifier)],
            "registrierungen": [_registrierung_entry(row, team_names) for row in registrierung_rows],
            "address_change": len(address_change_rows),
        }
    )


def compose_erasure_view(
    identifier: str,
    *,
    saison_team_rows: Sequence[Mapping[str, Any]],
    bewerbung_rows: Sequence[Mapping[str, Any]],
    referee_rows: Sequence[Mapping[str, Any]],
    pupil_rows: Sequence[Mapping[str, Any]],
    registrierung_rows: Sequence[Mapping[str, Any]],
    address_change_rows: Sequence[Mapping[str, Any]],
    # Each address the tool refuses this reader, and why; one absent opens.
    denied: Mapping[str, FLAddressChangeViewableDenied],
    own_address_change: Mapping[str, Any] | None,
    approval_request_rows: Sequence[Mapping[str, Any]],
    kader_rows: Sequence[Mapping[str, Any]],
    team_rows: Sequence[Mapping[str, Any]],
    unplayed_rows: Sequence[Mapping[str, Any]],
) -> FLErasureView:
    """The administrator's reveal, from the rows the erasure's own subject read holds, by the ids the page links each record by.

    The pending changes are named, never counted: the page links each row to the tool acting on it.
    """

    team_names = _team_names(team_rows)

    return FLErasureView.model_validate(
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
                    "spiele_without_ergebnis_saison_ids": [
                        unplayed["saison_id"] for unplayed in unplayed_rows if unplayed["schiedsrichter_id"] == row["_id"]
                    ],
                }
                for row in referee_rows
            ],
            "seats": [
                {**_seat_entry(row, slot), "team_name": row.get("name"), "team_id": row["team_id"]}
                for row, slot in seats_naming(saison_team_rows, identifier)
            ],
            "bewerbungen": [{**_seat_entry(row, slot), "bewerbung_id": row["_id"]} for row, slot in seats_naming(bewerbung_rows, identifier)],
            "registrierungen": [
                {**_registrierung_entry(row, team_names), "registrierung_id": row["_id"], "team_id": row["team_id"], "status": row["status"]}
                for row in registrierung_rows
            ],
            "address_change": [
                {"address_change_id": row["_id"], "viewable_denied": denied.get(str(row.get("address")))} for row in address_change_rows
            ],
            "own_address_change": None if own_address_change is None else {"address_change_id": own_address_change["_id"]},
            "approval_requests": [
                {
                    "approval_request_id": row["_id"],
                    "admin_tier": row["approval"]["admin_tier"],
                    "party": "target" if row["address"] == identifier else "requester",
                }
                for row in approval_request_rows
            ],
        }
    )


def build_pupil_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Equality and no pattern: `spieler.email` stores the folded form."""

    return [
        {"$match": build_self_pupil_filter(identifier)},
        {"$project": {"einwilligung.confirmed_at": 1, "inactive_since": 1}},
        {"$sort": {"_id": 1}},
    ]


def build_bewerbung_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every pending application one of whose seats names the address; read for the sign-in alone, no panel standing on one."""

    return [
        {"$match": build_eigene_bewerbung_filter(identifier)},
        {"$project": {f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_ROLLEN for field in ("email", "einwilligung.confirmed_at")}},
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


def own_seats(row: Mapping[str, Any], identifier: str) -> list[str]:
    """The slots of one season row or application whose confirmed person is this address, in `KONTAKT_ROLLEN` order."""

    return [slot for found, slot in seats_naming([row], identifier) if seat_is_confirmed(found, slot)]


def is_own_spieler(row: Mapping[str, Any]) -> bool:
    """The stamp alone: the selection is an equality on the folded address `spieler.email` stores."""

    return is_confirmed(row.get("einwilligung"))


def is_own_schiedsrichter(row: Mapping[str, Any], identifier: str) -> bool:
    return folds_to((row.get("kontakt") or {}).get("email"), identifier) and is_confirmed(row.get("einwilligung"))


def is_own_registrierung(row: Mapping[str, Any], identifier: str) -> bool:
    """A pending registration its pupil confirmed, a returning pupil's carrying no choice among them: its stored data is served.

    The status is judged here as well as selected on, for the caller reaching a row by its id.
    """

    return row.get("status") == SUBMITTED and folds_to(row.get("email"), identifier) and is_confirmed(row.get("einwilligung"))


EntryKind = Literal["spieler", "schiedsrichter", "seats", "bewerbungen", "registrierungen"]


def own_entries(
    identifier: str,
    *,
    seat_rows: Iterable[Mapping[str, Any]],
    referee_rows: Iterable[Mapping[str, Any]],
    pupil_rows: Iterable[Mapping[str, Any]],
    bewerbung_rows: Iterable[Mapping[str, Any]],
    registrierung_rows: Iterable[Mapping[str, Any]],
) -> frozenset[tuple[EntryKind, Any]]:
    """Every own record of this address, by its kind and the id an account-page entry names it by.

    A season row by its team and season: the seat PATCH answers per row, however many slots it holds.
    """

    return frozenset(
        {
            *(("spieler", row["_id"]) for row in pupil_rows if is_own_spieler(row)),
            *(("schiedsrichter", row["_id"]) for row in referee_rows if is_own_schiedsrichter(row, identifier)),
            *(("seats", (row["team_id"], row["saison_id"])) for row in seat_rows if own_seats(row, identifier)),
            *(("bewerbungen", row["_id"]) for row in bewerbung_rows if own_seats(row, identifier)),
            *(("registrierungen", row["_id"]) for row in registrierung_rows if is_own_registrierung(row, identifier)),
        }
    )


def is_live(row: Mapping[str, Any]) -> bool:
    """A pupil or referee row not retired: only such a row grants its Funktion."""

    return row.get("inactive_since") is None


def not_exited(row: Mapping[str, Any]) -> bool:
    """A season row its team has not withdrawn from: only such a row's seats grant.

    The record's presence is the test and never its `datum`: a seat grants nothing from the day its team's exit is recorded.
    """

    return row.get("austritt") is None


def awaits_confirmation(confirmations: Iterable[bool]) -> bool:
    """Whether a mailbox holds records that could grant a panel and has confirmed none of them."""

    judged = list(confirmations)

    return bool(judged) and not any(judged)


def grants_a_panel(saison_status: FLSaisonStatus) -> bool:
    """Whether a seat on a season of this status admits its holder to the team's panel.

    A `future` season's seat grants too: a team's people act for it before its season starts.
    """

    return saison_status in ("active", "future")


def holds_a_seat(seats: Iterable[FLSubjectSeat], *, team_id: ObjectId, saison_id: str) -> bool:
    """Whether any of these seats, already narrowed to a season granting a panel, sits on this team in this season.

    Any slot alike: the Trainer's seat admits to everything an Ansprechperson's does, so no slot is read here.
    """

    return any(seat.team_id == team_id and seat.saison_id == saison_id for seat in seats)


# The grant predicates, one per kind of own record: each consent PATCH grants by its record's, and each
# read's `givable` is that same predicate.


def may_grant_on_spieler(subject: FLSubject, spieler_id: ObjectId) -> bool:
    return any(entry.spieler_id == spieler_id for entry in subject.spieler)


def may_grant_on_schiedsrichter(subject: FLSubject, schiedsrichter_id: ObjectId) -> bool:
    return any(entry.schiedsrichter_id == schiedsrichter_id for entry in subject.schiedsrichter)


def find_role_refusal(*, seats: Iterable[FLSubjectSeat], team_id: ObjectId, saison_id: str) -> WriteRefusal | None:
    """`role_not_held`: the signed-in person holds no seat on this team in this season.

    One answer for another team, another season and a `past` one, so the refusal tells a stranger
    nothing about which teams or seasons exist.
    """

    if holds_a_seat(seats, team_id=team_id, saison_id=saison_id):
        return None

    return WriteRefusal(
        error_code=Code.ROLE_NOT_HELD,
        status=HTTPStatus.FORBIDDEN,
    )


def holds_an_owner_grant(identifier: str, grants: Iterable[Mapping[str, Any]]) -> bool:
    """Whether this folded address holds one of these live grants as an `owner`."""

    return any(grant["address"] == identifier and grant["admin_tier"] == OWNER for grant in grants)


def find_last_owner_erasure_refusal(*, identifier: str, grants: Iterable[Mapping[str, Any]], barred: Iterable[str]) -> WriteRefusal | None:
    """`last_owner_erasure`: the address holding the last live, unbarred `owner` grant erases itself only once another holds one.

    `grants` are the live ones. A barred `owner` admits nobody, so it is no owner here, as for a demotion.
    """

    owners = {str(grant["address"]) for grant in grants if grant["admin_tier"] == OWNER} - set(barred)
    if owners != {identifier}:
        return None

    return WriteRefusal(
        error_code=Code.LAST_OWNER_ERASURE,
        status=HTTPStatus.CONFLICT,
    )


def is_own_address(*, identifier: str, actor: str) -> bool:
    """`own_address`'s judgement, both folded: the refusal raises on it, and a read serving whether the tool opens an address asks it."""

    return identifier == actor


def find_own_address_refusal(*, identifier: str, actor: str) -> WriteRefusal | None:
    """`own_address`: an administrator's route on a mailbox refuses the mailbox they act as, both folded."""

    if not is_own_address(identifier=identifier, actor=actor):
        return None

    return WriteRefusal(
        error_code=Code.OWN_ADDRESS,
        status=HTTPStatus.FORBIDDEN,
    )


# The erasure's and its reveal's: the one ends the grant, the other opens the holder's records.
EACH_ADMIN: Final[frozenset[str]] = frozenset(get_args(FLAdminTier.__value__))
# The sign-out's: an ended session is repaired by signing in again, so only an owner's is held back.
OWNER_ONLY: Final[frozenset[str]] = frozenset({OWNER})


# The tiers whose holder's pending change an erasure ends only for an actor holding an owner's power: every one, the set
# the erasure's preview withholds from anyone else, as only an owner discards an administrator's change.
ADDRESS_CHANGE_PROTECTED: Final[frozenset[str]] = EACH_ADMIN


def admin_address_denied(
    *,
    identifier: str,
    actor: str,
    auth_time: int,
    grants: Sequence[Mapping[str, Any]],
    announced: Sequence[Mapping[str, Any]],
    protected: frozenset[str],
) -> bool:
    """`admin_address`'s judgement: the address holds a live grant of a `protected` tier and the actor no owner's power."""

    return admin_tier_of(identifier, grants) in protected and not holds_an_owners_power(
        actor=actor, auth_time=auth_time, grants=grants, announced=announced
    )


def find_admin_address_refusal(
    *,
    identifier: str,
    actor: str,
    auth_time: int,
    grants: Sequence[Mapping[str, Any]],
    announced: Sequence[Mapping[str, Any]],
    protected: frozenset[str],
) -> WriteRefusal | None:
    """`admin_address`: an address holding a live grant of a `protected` tier is acted on only by an actor holding an owner's power.

    `grants` and `announced` as stored, read where the caller judges, so a retry judges them afresh.
    """

    if not admin_address_denied(
        identifier=identifier, actor=actor, auth_time=auth_time, grants=grants, announced=announced, protected=protected
    ):
        return None

    return WriteRefusal(
        error_code=Code.ADMIN_ADDRESS,
        status=HTTPStatus.FORBIDDEN,
    )


def find_foreign_address_change_refusal(
    *,
    addresses: Iterable[str],
    actor: str,
    auth_time: int,
    grants: Sequence[Mapping[str, Any]],
    announced: Sequence[Mapping[str, Any]],
) -> WriteRefusal | None:
    """`foreign_address_change`: without an owner's power, an erasure ends no pending change of an address holding a protected grant.

    A protected grant is one `ADDRESS_CHANGE_PROTECTED` names. `addresses` are the changes' own addresses, never the one erased; the
    message names none of them.
    """

    if not any(
        admin_address_denied(
            identifier=address, actor=actor, auth_time=auth_time, grants=grants, announced=announced, protected=ADDRESS_CHANGE_PROTECTED
        )
        for address in addresses
    ):
        return None

    return WriteRefusal(
        error_code=Code.FOREIGN_ADDRESS_CHANGE,
        status=HTTPStatus.FORBIDDEN,
    )


def address_change_viewable_denied(
    identifier: str, *, actor: str, auth_time: int, grants: Sequence[Mapping[str, Any]], announced: Sequence[Mapping[str, Any]]
) -> FLAddressChangeViewableDenied | None:
    """Why the address tool refuses this administrator this address's change, in the order it refuses; `None` where it opens it.

    Their judgements, never their finders: a finder's code is published only on the operations `RULES` names.
    """

    if is_own_address(identifier=identifier, actor=actor):
        return "own_address"
    if admin_address_denied(identifier=identifier, actor=actor, auth_time=auth_time, grants=grants, announced=announced, protected=EACH_ADMIN):
        return "admin_address"

    return None


# --- The REFERENCES: wider than the own records and than the sign-in gate alike.
# Each selection is the one its record's own reads take
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
        {"$match": build_self_referee_filter(*identifiers)},
        {"$project": {"kontakt.email": 1}},
    ]


def build_pupil_references_pipeline(identifiers: Iterable[str]) -> list[Mapping[str, Any]]:
    """`build_self_pupil_filter`'s equality over a batch, its `$type` term the unique index's partial filter, which `$in` does not imply."""

    return [
        {"$match": {"email": {"$in": sorted(set(identifiers)), "$type": "string"}}},
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
    """Every address, on the sign-in fold, that one of these records names."""

    stored = (
        *(seat_address(row, slot) for row in seat_rows for slot in KONTAKT_ROLLEN),
        *(seat_address(row, slot) for row in bewerbung_rows for slot in KONTAKT_ROLLEN),
        # The row's own address and never a pending change's: that admits no sign-in until confirmed, and
        # the address it replaces stays here till then.
        *map(referee_address, referee_rows),
        *map(pupil_address, pupil_rows),
        # The one kind narrowed to its pupil's confirmation, as the gate narrows it, each row judged on its
        # own fold: the set holds every address a record names, so a row read for another mailbox adds its own.
        *(row.get("email") for row in registrierung_rows if is_own_registrierung(row, folded(row.get("email")) or "")),
        *(row.get("address") for row in grant_rows),
        # An effect owing its account's carry: swept before it is carried, the account and its passkeys are gone.
        *(row["move"]["old"] for row in carry_rows),
    )

    return frozenset(address for address in map(folded, stored) if address is not None)


def unreferenced(identifiers: Iterable[str], *, referenced: Collection[str]) -> list[str]:
    """Each once, in the spelling it was asked in: the caller deletes the account holding that spelling."""

    return list(dict.fromkeys(identifier for identifier in identifiers if sign_in_identifier(identifier) not in referenced))


def find_no_owner_refusal(grant_rows: Sequence[Mapping[str, Any]]) -> WriteRefusal | None:
    """`no_owner`: no live grant is an `owner`'s, live as every reader of a grant reads one."""

    if any(grant.get("admin_tier") == OWNER for grant in grant_rows):
        return None

    return WriteRefusal(
        error_code=Code.NO_OWNER,
        status=HTTPStatus.CONFLICT,
    )


# --- The SEASON-AFTER RULE, keyed on the stored statuses and never
# on a next season's id, which a skipped year leaves naming no season at all.


def statuses_of(saison_rows: Iterable[Mapping[str, Any]]) -> dict[str, FLSaisonStatus]:
    return {row["_id"]: row["status"] for row in saison_rows}


def completed_saison_id(statuses: Mapping[str, FLSaisonStatus]) -> str | None:
    """The `past` season with the greatest id, compared as strings: an id is a fixed-length year (`docs/glossary.md :: Saison`)."""

    return max((saison_id for saison_id, status in statuses.items() if status == "past"), default=None)


def kept_saison_ids(statuses: Mapping[str, FLSaisonStatus]) -> frozenset[str] | None:
    """The seasons a squad row keeps its pupil in, or `None` while no season is `past`.

    By id, as a planned season below the one just ended may never run: activation refuses no lower id.
    """

    completed = completed_saison_id(statuses)
    if completed is None:
        return None

    return frozenset(saison_id for saison_id, status in statuses.items() if saison_id >= completed or status == "active")


def statuses_after_activating(statuses: Mapping[str, FLSaisonStatus], saison_id: str) -> dict[str, FLSaisonStatus]:
    """The statuses `POST /saisons/{saison_id}/activate` leaves, its refusals unjudged: the incumbent `past`, the target `active`."""

    return {other: "active" if other == saison_id else "past" if status == "active" else status for other, status in statuses.items()}


def closed_by(statuses: Mapping[str, FLSaisonStatus], saison_id: str) -> str | None:
    """The season activating `saison_id` turns `past`: the `active` one, unless it is the target itself."""

    return next((other for other, status in statuses.items() if status == "active" and other != saison_id), None)


def build_open_registrierungen_pipeline() -> list[Mapping[str, Any]]:
    """Every pending registration's address, which keeps the pupil it folds to."""

    return [{"$match": {"status": SUBMITTED}}, {"$project": {"status": 1, "email": 1}}]


def open_addresses(registrierung_rows: Iterable[Mapping[str, Any]]) -> frozenset[str]:
    """The pending registrations' addresses, each the fold a pupil's `email` holds."""

    return frozenset(row["email"] for row in registrierung_rows if row.get("status") == SUBMITTED and isinstance(row.get("email"), str))


def erasure_due(*, email: Any, kader_saison_ids: Iterable[str], open: AbstractSet[str], kept: frozenset[str] | None) -> bool:
    """Whether one pupil is due, judged in the erasure's own transaction.

    A retired squad row keeps its pupil as a live one does: removing a player retires the row.
    """

    return kept is not None and isinstance(email, str) and email not in open and kept.isdisjoint(kader_saison_ids)


def build_erasure_due_pipeline(*, kept: frozenset[str], open: AbstractSet[str]) -> list[Mapping[str, Any]]:
    """Every due pupil's id and address: `erasure_due` as one read.

    An addressless pupil is never read: the registry erases by address.
    """

    return [
        # The sentinel holds no address, so the `$type` term keeps it out.
        {"$match": {"email": {"$type": "string", "$nin": sorted(open)}}},
        {
            "$lookup": {
                "from": DbCollection.SAISON_SPIELER,
                "localField": "_id",
                "foreignField": "spieler_id",
                # Every row, its `inactive_since` unread, for `erasure_due`'s reason.
                "pipeline": [{"$match": {"saison_id": {"$in": sorted(kept)}}}, {"$limit": 1}, {"$project": {"_id": 1}}],
                "as": "kept",
            }
        },
        {"$match": {"kept": {"$size": 0}}},
        {"$project": {"_id": 1, "email": 1}},
    ]


def build_erasure_due_page_pipeline(
    *, kept: frozenset[str], open: AbstractSet[str], after: ObjectId | None, size: int
) -> list[Mapping[str, Any]]:
    """The due pupils after `after` in `_id` order, at most `size`, beside how many are due in all, as ONE document."""

    seite: list[Mapping[str, Any]] = [{"$sort": {"_id": 1}}, {"$limit": size}]

    return [
        *build_erasure_due_pipeline(kept=kept, open=open),
        {"$facet": {"seite": seite if after is None else [{"$match": {"_id": {"$gt": after}}}, *seite], "count": [{"$count": "count"}]}},
    ]


def build_erasure_due_count_pipeline(*, kept: frozenset[str], open: AbstractSet[str]) -> list[Mapping[str, Any]]:
    return [*build_erasure_due_pipeline(kept=kept, open=open), {"$count": "count"}]
