"""The subject read's judgements, deciding from their arguments alone.

A judgement left beside a collection handle is one that can grow a read of its own.
"""

from collections.abc import Collection, Iterable, Mapping, Sequence
from collections.abc import Set as AbstractSet
from http import HTTPStatus
from typing import Any, Literal

from bson import ObjectId

from app.api.bewerbungen.services import build_own_bewerbung_filter, person_of
from app.api.grants.services import OWNER, admin_tier_of, holds_an_owners_power
from app.api.identity.schemas import FLAccountErasureView, FLErasureViewResponse, FLSubject, FLSubjectSeat
from app.api.kontakte.services import rows_seating
from app.api.registrierungen.services import SUBMITTED, build_erasure_registrierung_filter, build_own_registrierung_filter
from app.api.saisons.services import SAISON_AS, SAISON_LOOKUP
from app.api.schiedsrichter.services import build_assignment_filter, build_self_referee_filter
from app.api.spieler.services import build_self_pupil_filter
from app.core.codes import Code
from app.core.collections import Collection as DbCollection
from app.core.exceptions import APIError, FieldFault, FieldPath
from app.shared.einwilligung import is_confirmed, seat_is_confirmed
from app.shared.folding import sign_in_identifier
from app.shared.schemas.literals import KONTAKT_SEATS, FLAddressChangeViewableDenied, FLKontaktSeat, FLSaisonStatus

# --- The selections, each shared with its record's own person-tier reads rather than spelled again, and the gate's
# shared with the references sweep, which asks them for a batch of addresses. Unnarrowed by retirement or withdrawal:
# `_judged` narrows the Funktionen.


def seat_saisons(rows: Iterable[Mapping[str, Any]]) -> dict[str, Mapping[str, Any]]:
    """Each row's season, by its id, as `SAISON_LOOKUP` joined it: its status and its span.

    Raised rather than dropped: a seat whose season has no row is a database this read cannot answer truthfully for, and a
    silently shorter list is a person shown no panel at all.
    """

    saisons: dict[str, Mapping[str, Any]] = {}
    for row in rows:
        [saison] = row.get(SAISON_AS) or [None]
        if saison is None:
            raise RuntimeError(f"saison_teams holds a seat in {row['saison_id']}, which saisons has no row for")
        saisons[row["saison_id"]] = saison

    return saisons


def build_seat_pipeline(*identifiers: str) -> list[Mapping[str, Any]]:
    """Every junction row whose block names one of these addresses, a past season's and a withdrawn team's included.

    Its season's status rides beside it.
    """

    return [
        {"$match": rows_seating(*identifiers)},
        # `name` and `shorthand` ride along free, this read opening the row anyway, and they are the row's own rather
        # than the club's.
        {
            "$project": {
                "saison_id": 1,
                "team_id": 1,
                "name": 1,
                "shorthand": 1,
                "austritt": 1,
                **{f"kontakte.{seat}.{field}": 1 for seat in KONTAKT_SEATS for field in ("email", "einwilligung.confirmed_at")},
            }
        },
        # Ordered in the read rather than by the reader: two clubs' seats held by one inbox are
        # otherwise answered in whatever order the collection was written in.
        {"$sort": {"saison_id": 1, "team_id": 1}},
        # The read finding a seat answers its season too.
        SAISON_LOOKUP,
    ]


def build_referee_pipeline(*identifiers: str) -> list[Mapping[str, Any]]:
    """Retired rows too, as a retired referee's account signs in to take back a consent.

    The stored address rides along so `folds_to` can judge it, and the stamp so the confirmation can; nothing else of
    the person does.
    """

    return [
        {"$match": build_self_referee_filter(*identifiers)},
        {"$project": {"kontakt.email": 1, "einwilligung.confirmed_at": 1, "inactive_since": 1}},
        {"$sort": {"_id": 1}},
    ]


# --- The erasure's selections: every status, every retired row and every unconfirmed seat, so the
# preview and the erasure name one set and the narrowing above takes nothing out of either.

# What a seat is named by in the preview, beside the address the fold judges it on.
ERASURE_SEAT_FIELDS: tuple[str, ...] = ("email", "first_name", "last_name")


def build_erasure_seat_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every season row or application one of whose seats names the address, whatever its status.

    `confirmations` rides along whole: the clearing nulls a seat's bookkeeping only where the block
    exists.
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
                # What the clearing judges a deletion notice's day by (`leaving_moves_the_deletion_day`).
                "erasure_announced_at": 1,
                **{f"kontakte.{seat}.einwilligung.confirmed_at": 1 for seat in KONTAKT_SEATS},
                **{f"kontakte.{seat}.{field}": 1 for seat in KONTAKT_SEATS for field in ERASURE_SEAT_FIELDS},
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
    return [{"$match": build_self_pupil_filter(identifier)}, {"$project": {"first_name": 1, "last_name": 1}}, {"$sort": {"_id": 1}}]


def build_erasure_registrierung_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    return [
        {"$match": build_erasure_registrierung_filter(identifier)},
        {"$project": {"saison_id": 1, "team_id": 1, "status": 1, "email": 1, "first_name": 1, "last_name": 1}},
        {"$sort": {"saison_id": 1, "_id": 1}},
    ]


def build_erasure_grant_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """A grant by its id: the one record an administrator's erasure may take alone."""

    return [{"$match": {"address": identifier}}, {"$project": {"_id": 1}}]


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


def build_booked_spiele_pipeline(schiedsrichter_ids: Iterable[Any]) -> list[Mapping[str, Any]]:
    """The day and the hour of every fixture booking one of these referees, which the erasure judges played or still to come."""

    return [{"$match": build_assignment_filter({"$in": list(schiedsrichter_ids)})}, {"$project": {"_id": 0, "date": 1, "time": 1}}]


# One entry per kind, for the person's own preview.


def _pupil_entry(row: Mapping[str, Any]) -> dict[str, Any]:
    return {"first_name": row.get("first_name"), "last_name": row.get("last_name")}


def _referee_entry(row: Mapping[str, Any]) -> dict[str, Any]:
    return {"name": row.get("name")}


def _seat_entry(row: Mapping[str, Any], seat: str) -> dict[str, Any]:
    person = (row.get("kontakte") or {}).get(seat) or {}

    return {"saison_id": row.get("saison_id"), "seat": seat, "first_name": person.get("first_name"), "last_name": person.get("last_name")}


def _registrierung_entry(row: Mapping[str, Any], team_names: Mapping[tuple[Any, Any], Any]) -> dict[str, Any]:
    return {
        "saison_id": row["saison_id"],
        "team_name": team_names.get((row["saison_id"], row["team_id"])),
        "first_name": row.get("first_name"),
        "last_name": row.get("last_name"),
    }


def _team_names(registrierung_junctions: Iterable[Mapping[str, Any]]) -> dict[tuple[Any, Any], Any]:
    return {(row["saison_id"], row["team_id"]): row.get("name") for row in registrierung_junctions}


def compose_account_erasure_view(
    identifier: str,
    *,
    saison_team_rows: Sequence[Mapping[str, Any]],
    bewerbung_rows: Sequence[Mapping[str, Any]],
    referee_rows: Sequence[Mapping[str, Any]],
    pupil_row: Mapping[str, Any] | None,
    registrierung_rows: Sequence[Mapping[str, Any]],
    address_change_rows: Sequence[Mapping[str, Any]],
    # The season rows of the registrations' teams, which name each club that season; the seats are `saison_team_rows`.
    registrierung_junctions: Sequence[Mapping[str, Any]],
) -> FLAccountErasureView:
    """The preview, from the rows the erasure's own subject read holds; no address and no birthdate reaches it."""

    team_names = _team_names(registrierung_junctions)

    return FLAccountErasureView.model_validate(
        {
            "spieler": None if pupil_row is None else _pupil_entry(pupil_row),
            "schiedsrichter": [_referee_entry(row) for row in referee_rows],
            "seats": [{**_seat_entry(row, seat), "team_name": row.get("name")} for row, seat in seats_naming(saison_team_rows, identifier)],
            "bewerbungen": [_seat_entry(row, seat) for row, seat in seats_naming(bewerbung_rows, identifier)],
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
    pupil_row: Mapping[str, Any] | None,
    registrierung_rows: Sequence[Mapping[str, Any]],
    address_change_rows: Sequence[Mapping[str, Any]],
    grant_rows: Sequence[Mapping[str, Any]],
    spiele: int,
) -> FLErasureViewResponse:
    """The administrator's counts, from the rows the erasure's own subject read holds, a contact counted per seat."""

    return FLErasureViewResponse(
        spieler=int(pupil_row is not None),
        schiedsrichter=len(referee_rows),
        kontakt_seats=len(seats_naming(saison_team_rows, identifier)),
        bewerbung_seats=len(seats_naming(bewerbung_rows, identifier)),
        registrierungen=len(registrierung_rows),
        spiele=spiele,
        address_change=len(address_change_rows),
        grants=len(grant_rows),
    )


def build_pupil_pipeline(*identifiers: str) -> list[Mapping[str, Any]]:
    """The address rides along so the references sweep can tell a batch's pupils apart, and the stamp so the confirmation can."""

    return [
        {"$match": build_self_pupil_filter(*identifiers)},
        {"$project": {"email": 1, "einwilligung.confirmed_at": 1}},
        {"$sort": {"_id": 1}},
    ]


def build_bewerbung_pipeline(*identifiers: str) -> list[Mapping[str, Any]]:
    """Every pending application one of whose seats names one of these addresses; no panel stands on one."""

    return [
        {"$match": build_own_bewerbung_filter(*identifiers)},
        {"$project": {f"kontakte.{seat}.{field}": 1 for seat in KONTAKT_SEATS for field in ("email", "einwilligung.confirmed_at")}},
    ]


def build_registrierung_pipeline(*identifiers: str) -> list[Mapping[str, Any]]:
    """Every pending registration of these addresses; no panel stands on one.

    The whole consent record rides along: whether its pupil confirmed it is part of the judgement.
    """

    return [{"$match": build_own_registrierung_filter(*identifiers)}, {"$project": {"status": 1, "email": 1, "einwilligung": 1}}]


def folded(stored: Any) -> str | None:
    """One stored address on the fold both ends of a join share, or `None` where nothing is stored: an empty seat."""

    return None if stored is None else sign_in_identifier(str(stored))


def folds_to(stored: Any, identifier: str) -> bool:
    """Whether one stored address is this mailbox."""

    return folded(stored) == identifier


def seat_address(row: Mapping[str, Any], seat: str) -> Any:
    """What one seat of a row's block stores as its address; a cleared block and an empty seat store none."""

    return (person_of(row.get("kontakte"), seat) or {}).get("email")


def seats_naming(rows: Sequence[Mapping[str, Any]], identifier: str) -> list[tuple[Mapping[str, Any], str]]:
    """One pair per seat rather than per row: one address stands in two of a block's seats wherever one person was entered twice."""

    return [(row, seat) for row in rows for seat in KONTAKT_SEATS if folds_to(seat_address(row, seat), identifier)]


# --- The own records: every record its own person confirmed, judged here alone for every reader. A
# Funktion is an own record that is live besides (`_judged`), never a second judgement.


def own_seats(row: Mapping[str, Any], identifier: str) -> list[str]:
    """The seats of one season row or application whose confirmed person is this address, in `KONTAKT_SEATS` order."""

    # Per seat: one address in two seats of one row may be confirmed in one and entered by an administrator in the other.
    return [seat for found, seat in seats_naming([row], identifier) if seat_is_confirmed(person_of(found.get("kontakte"), seat))]


def is_own_spieler(row: Mapping[str, Any]) -> bool:
    """The stamp alone: the selection is an equality on the folded address `spieler.email` stores."""

    return is_confirmed(row.get("einwilligung"))


def is_own_schiedsrichter(row: Mapping[str, Any], identifier: str) -> bool:
    return folds_to(referee_address(row), identifier) and is_confirmed(row.get("einwilligung"))


def is_own_registrierung(row: Mapping[str, Any], identifier: str) -> bool:
    """A pending registration its pupil confirmed: its stored data is served.

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

    A season row by its team and season: the seat PATCH answers per row, however many seats it holds.
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
    """A referee row not retired: only such a row grants its Funktion."""

    return row.get("inactive_since") is None


def not_exited(row: Mapping[str, Any]) -> bool:
    """A season row its team has not withdrawn from: only such a row's seats grant.

    The record's presence is the test and never its `date`: a seat grants nothing from the day its team's exit is recorded.
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


def seats_on(seats: Iterable[FLSubjectSeat], *, team_id: ObjectId, saison_id: str) -> list[FLKontaktSeat]:
    """The seats these entries name on this team in this season, in `KONTAKT_SEATS` order: the one way to ask it."""

    held = {entry.seat for entry in seats if entry.team_id == team_id and entry.saison_id == saison_id}

    return [seat for seat in KONTAKT_SEATS if seat in held]


def holds_a_seat(seats: Iterable[FLSubjectSeat], *, team_id: ObjectId, saison_id: str) -> bool:
    """Whether any of these seats, already narrowed to a season granting a panel, sits on this team in this season.

    Any seat alike: the Trainer's seat admits to everything an Ansprechperson's does.
    """

    return bool(seats_on(seats, team_id=team_id, saison_id=saison_id))


# Only a live record grants: a retired referee's takes withdrawals alone.
def may_grant_on_schiedsrichter(subject: FLSubject, schiedsrichter_id: ObjectId) -> bool:
    return any(entry.schiedsrichter_id == schiedsrichter_id for entry in subject.schiedsrichter)


def find_role_refusal(*, seats: Iterable[FLSubjectSeat], team_id: ObjectId, saison_id: str) -> APIError | None:
    """`role_not_held`: the signed-in person holds no seat on this team in this season.

    One answer for another team, another season and a `past` one, so the refusal tells a stranger
    nothing about which teams or seasons exist.
    """

    if holds_a_seat(seats, team_id=team_id, saison_id=saison_id):
        return None

    return APIError(HTTPStatus.FORBIDDEN, Code.ROLE_NOT_HELD)


def find_owner_erasure_refusal(*, identifier: str, grants: Sequence[Mapping[str, Any]]) -> APIError | None:
    """`owner_erasure`: the owner erases their address only after a handover, nobody else being able to name an owner.

    Whatever the session's age: the owner's power alone decides, as `holds_an_owners_power` judges it.
    """

    if not holds_an_owners_power(actor=identifier, grants=grants):
        return None

    return APIError(HTTPStatus.CONFLICT, Code.OWNER_ERASURE)


def is_own_address(*, identifier: str, actor: str) -> bool:
    """`own_address`'s judgement, both folded."""

    return identifier == actor


def admin_address_denied(*, identifier: str, actor: str, grants: Sequence[Mapping[str, Any]]) -> bool:
    """`admin_address`'s judgement: the address holds a grant and the actor no owner's power."""

    return admin_tier_of(identifier, grants) is not None and not holds_an_owners_power(actor=actor, grants=grants)


def find_off_limits_refusal(*, identifier: str, actor: str, grants: Sequence[Mapping[str, Any]], path: FieldPath) -> FieldFault | None:
    """An administrator's refusal of a mailbox they act on, on the box at `path`, both addresses folded; `None` where none holds.

    Their own (`own_address`), and else a holder's but for the owner (`admin_address`): one fault, since an
    administrator's own address holds a grant, and its phrase sends them to Konto, where it changes. Who asks decides
    either, so 403. A route acting on an address a stored record names, which no box holds, asks it as a gate through
    `as_judged_on_stored_state`.
    """

    if is_own_address(identifier=identifier, actor=actor):
        return FieldFault(path=path, code=Code.OWN_ADDRESS, status=HTTPStatus.FORBIDDEN)

    if admin_address_denied(identifier=identifier, actor=actor, grants=grants):
        return FieldFault(path=path, code=Code.ADMIN_ADDRESS, status=HTTPStatus.FORBIDDEN)

    return None


def find_foreign_address_change_refusal(*, addresses: Iterable[str], actor: str, grants: Sequence[Mapping[str, Any]]) -> APIError | None:
    """`foreign_address_change`: without an owner's power, an erasure ends no pending change of an address holding a grant.

    `addresses` are the changes' own addresses, never the one erased; the message names none of them.
    """

    if not any(admin_address_denied(identifier=address, actor=actor, grants=grants) for address in addresses):
        return None

    return APIError(HTTPStatus.FORBIDDEN, Code.FOREIGN_ADDRESS_CHANGE)


def address_change_viewable_denied(identifier: str, *, actor: str, grants: Sequence[Mapping[str, Any]]) -> FLAddressChangeViewableDenied | None:
    """Why the address tool refuses this administrator this address's change, in the order it refuses; `None` where it opens it.

    Their judgements, never their finders: a list leaves out each row it would refuse rather than refusing the list.
    """

    if is_own_address(identifier=identifier, actor=actor):
        return "own_address"
    if admin_address_denied(identifier=identifier, actor=actor, grants=grants):
        return "admin_address"

    return None


# --- The references: the sign-in gate's selections asked for a batch, with every grant and owed carry beside them.


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
        *(seat_address(row, seat) for row in seat_rows for seat in KONTAKT_SEATS),
        *(seat_address(row, seat) for row in bewerbung_rows for seat in KONTAKT_SEATS),
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


def find_no_owner_refusal(grant_rows: Sequence[Mapping[str, Any]]) -> APIError | None:
    """`no_owner`: no grant is an `owner`'s, as in an empty database; a foreign one holding such a row passes, nothing telling it apart."""

    if any(grant.get("admin_tier") == OWNER for grant in grant_rows):
        return None

    return APIError(HTTPStatus.CONFLICT, Code.NO_OWNER)


# --- The season-after rule, keyed on the stored statuses and never
# on a next season's id, which a skipped year leaves naming no season at all.


def statuses_of(saison_rows: Iterable[Mapping[str, Any]]) -> dict[str, FLSaisonStatus]:
    return {row["_id"]: row["status"] for row in saison_rows}


def completed_saison_id(statuses: Mapping[str, FLSaisonStatus]) -> str | None:
    """The `past` season with the greatest id, compared as strings: an id is a fixed-length year."""

    return max((saison_id for saison_id, status in statuses.items() if status == "past"), default=None)


def kept_saison_ids(statuses: Mapping[str, FLSaisonStatus]) -> frozenset[str] | None:
    """The seasons a squad row keeps its pupil in, or `None` while no season is `past`.

    By id, as a planned season below the one just ended may never run: activation refuses no lower id.
    """

    completed = completed_saison_id(statuses)
    if completed is None:
        return None

    return frozenset(saison_id for saison_id, status in statuses.items() if saison_id >= completed or status == "active")


def build_open_registrierungen_pipeline() -> list[Mapping[str, Any]]:
    """Every pending registration's address, which keeps the pupil it folds to."""

    return [{"$match": {"status": SUBMITTED}}, {"$project": {"status": 1, "email": 1}}]


def open_addresses(registrierung_rows: Iterable[Mapping[str, Any]]) -> frozenset[str]:
    """The pending registrations' addresses, each the fold a pupil's `email` holds."""

    return frozenset(row["email"] for row in registrierung_rows if row.get("status") == SUBMITTED and isinstance(row.get("email"), str))


def erasure_due(*, email: Any, kader_saison_ids: Iterable[str], pending_addresses: AbstractSet[str], kept: frozenset[str] | None) -> bool:
    """Whether one pupil is due, judged in the erasure's own transaction.

    A retired squad row keeps its pupil as a live one does: removing a player retires the row.
    """

    return kept is not None and isinstance(email, str) and email not in pending_addresses and kept.isdisjoint(kader_saison_ids)


def build_erasure_due_pipeline(*, kept: frozenset[str], pending_addresses: AbstractSet[str]) -> list[Mapping[str, Any]]:
    """Every due pupil's id and address: `erasure_due` as one read."""

    return [
        # The `$type` term keeps an addressless pupil out: the erasure goes by address.
        {"$match": {"email": {"$type": "string", "$nin": sorted(pending_addresses)}}},
        {
            "$lookup": {
                "from": DbCollection.SAISON_SPIELER,
                "localField": "_id",
                "foreignField": "spieler_id",
                # Every row, its `inactive_since` unread: removing a player retires the row, which keeps its pupil.
                "pipeline": [{"$match": {"saison_id": {"$in": sorted(kept)}}}, {"$limit": 1}, {"$project": {"_id": 1}}],
                "as": "kept",
            }
        },
        {"$match": {"kept": {"$size": 0}}},
        {"$project": {"_id": 1, "email": 1}},
    ]


def build_erasure_due_page_pipeline(*, kept: frozenset[str], pending_addresses: AbstractSet[str], size: int) -> list[Mapping[str, Any]]:
    """The first `size` due pupils in `_id` order."""

    return [*build_erasure_due_pipeline(kept=kept, pending_addresses=pending_addresses), {"$sort": {"_id": 1}}, {"$limit": size}]
