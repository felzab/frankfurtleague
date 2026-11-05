"""
API · the account page's consent controls: what every kind of own record's share

One module for every kind, so their PATCHes cannot answer one press differently and the account page's
read judges a grant exactly as the PATCH it offers does. Pure: the routers read, and this module decides
from what they pass.
"""

from collections.abc import Mapping, Sequence
from http import HTTPStatus
from typing import Any, Final, Literal, get_args

from bson import ObjectId

from app.api.bewerbungen.services import bewerbung_schule, build_eigene_bewerbung_filter
from app.api.einwilligung.services import media_offered
from app.api.identity.schemas import FLSubjectSeat
from app.api.identity.services import holds_a_seat, is_own_registrierung, own_seats, saison_status_lookup
from app.api.kontakte.services import rows_seating
from app.api.registrierungen.services import build_eigene_registrierung_filter, traegt_wahlen
from app.api.schiedsrichter.services import EINWILLIGUNG_FELD, SELF_REFEREE_ORDER, build_self_referee_filter
from app.api.spieler.services import SELF_PUPIL_ORDER, build_self_pupil_filter
from app.core.codes import Code
from app.core.collections import Collection as DbCollection
from app.core.exceptions import WriteRefusal
from app.core.journal import JournalLine
from app.shared.einwilligung_evidence import CHOICES, FLEinwilligungChoice, TextVersions, compose_choices, evidence_state_of, is_given
from app.shared.schemas.bounds import MEDIA_MIN_AGE_YEARS
from app.shared.schemas.einwilligung import PressTextVersions, stale_grants
from app.shared.schemas.literals import KONTAKT_ROLLEN


def gives_anything(*, saved: Mapping[str, Any], chosen: Mapping[FLEinwilligungChoice, Any]) -> bool:
    """Whether a press GRANTS a choice the stored record withholds, in either vocabulary.

    A grant is admitted only where its record's grant predicate allows it, a withdrawal on every confirmed one (Art. 7(3) DSGVO).
    """

    return any(is_given(choice, value) and not is_given(choice, saved.get(choice)) for choice, value in chosen.items())


def _moved(saved: Mapping[str, Any], choice: FLEinwilligungChoice, value: Any) -> bool:
    return value != (is_given("media", saved.get("media")) if choice == "media" else saved.get(choice))


def compose_person_move(
    *, saved: Mapping[str, Any], chosen: Mapping[FLEinwilligungChoice, Any], am: str, text_versions: TextVersions
) -> dict[str, dict[str, Any]] | None:
    """The update moving a person's own block, at `einwilligung`, by the choices that change; `None` where none does.

    Never `confirmed_at`, read by the panel and the publication mask: each press's labels are its evidence's.
    """

    moved: list[FLEinwilligungChoice] = [choice for choice in CHOICES if choice in chosen and _moved(saved, choice, chosen[choice])]
    if not moved:
        return None

    return {
        "$set": compose_choices(
            path="einwilligung",
            saved=saved,
            set_fields={choice: chosen[choice] for choice in moved},
            am=am,
            text_versions=text_versions,
        )
    }


def compose_seat_move(
    *, seats: Mapping[str, Mapping[str, Any]], chosen: Mapping[FLEinwilligungChoice, Any], am: str, text_versions: TextVersions
) -> dict[str, dict[str, Any]] | None:
    """The update moving every held seat's block of one row or application, `seats` keyed by slot; `None` where none moves."""

    set_fields: dict[str, Any] = {}
    for slot, saved in seats.items():
        set_fields.update(
            compose_choices(
                path=f"kontakte.{slot}.einwilligung",
                saved=saved,
                set_fields={choice: chosen[choice] for choice in CHOICES if choice in chosen and _moved(saved, choice, chosen[choice])},
                am=am,
                text_versions=text_versions,
            )
        )

    return {"$set": set_fields} if set_fields else None


def withdrawal_line(
    *,
    person_hash: str,
    collection: DbCollection,
    record_id: ObjectId,
    blocks: Sequence[Mapping[str, Any]],
    chosen: Mapping[FLEinwilligungChoice, Any],
    am: str,
    text_versions: TextVersions,
) -> JournalLine | None:
    """The journal line of a press, naming each choice it moved off a grant on any of `blocks`; `None` where it withdrew none.

    A grant is never journalled: a restore taking one back leaves the person less exposed, never more.
    """

    withdrawn: dict[FLEinwilligungChoice, Any] = {
        choice: value
        for choice, value in chosen.items()
        if not is_given(choice, value) and any(is_given(choice, block.get(choice)) for block in blocks)
    }
    if not withdrawn:
        return None

    return JournalLine(
        person_hash=person_hash,
        art="withdrawal",
        collection=collection,
        record_id=record_id,
        am=am,
        text_versions={choice: text_versions[choice] for choice in withdrawn},
        choices=withdrawn,
    )


def find_grant_wording_refusal(
    *, blocks: Sequence[Mapping[str, Any]], chosen: Mapping[FLEinwilligungChoice, Any], text_versions: PressTextVersions
) -> WriteRefusal | None:
    """`grant_wording_stale`: a choice this press moves onto a grant on any of `blocks` names a replaced label.

    Only a choice that moves: the writers stamp no other, so an unchanged grant beside a withdrawal from a page loaded
    before a rewording records nothing under the old words, and refusing it would keep the withdrawal from landing.
    """

    given: dict[FLEinwilligungChoice, Any] = {
        choice: value for choice, value in chosen.items() if any(gives_anything(saved=block, chosen={choice: value}) for block in blocks)
    }
    stale = stale_grants(text_versions, given)
    if not stale:
        return None

    return WriteRefusal(
        error_code=Code.GRANT_WORDING_STALE,
        status=HTTPStatus.CONFLICT,
        fields=tuple(("text_versions", choice) for choice in stale),
    )


def find_give_refusal(*, allowed: bool) -> WriteRefusal | None:
    """`giving_not_allowed`: the record is the person's own and takes a withdrawal alone, so a grant on it is refused.

    Its own code, not `role_not_held`'s: the record was found, so naming the cause hides nothing.
    """

    if allowed:
        return None

    return WriteRefusal(
        error_code=Code.GIVING_NOT_ALLOWED,
        status=HTTPStatus.FORBIDDEN,
    )


def find_own_entry_refusal(*, held: bool) -> WriteRefusal | None:
    """`role_not_held` on a person's own record: the address holds no record this operation may read or change.

    One answer for another person's id, an unconfirmed record and none at all, so the refusal tells
    nobody which ids exist.
    """

    if held:
        return None

    return WriteRefusal(
        error_code=Code.ROLE_NOT_HELD,
        status=HTTPStatus.FORBIDDEN,
    )


def find_evidence_state_refusal(*, expected: Mapping[str, Any], blocks: Sequence[Any]) -> WriteRefusal | None:
    """`choices_stale`: a choice's evidence moved since the page was served.

    Refused rather than merged: a stale page sends the other choice as it last saw it, and taking that
    would re-grant what the person withdrew elsewhere.
    """

    if dict(expected) == evidence_state_of(blocks=blocks):
        return None

    return WriteRefusal(
        error_code=Code.CHOICES_STALE,
        status=HTTPStatus.CONFLICT,
    )


# --- The records each read serves: CONFIRMED ones alone, retired rows and past seasons included, a
# withdrawal staying open on every record a consent stands on.


def context_teams_lookup(local_field: str) -> Mapping[str, Any]:
    """The clubs a record's `local_field` names, read today as `teams`: the name a registration's and an application's entry shows."""

    return {
        "$lookup": {
            "from": DbCollection.TEAMS,
            "localField": local_field,
            "foreignField": "_id",
            "pipeline": [{"$project": {"name": 1}}],
            "as": "teams",
        }
    }


def _account_einwilligung(block: Mapping[str, Any]) -> dict[str, Any]:
    return {"umfang": block["umfang"], "media": block["media"]}


def _compose_spieler_person(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "spieler_id": row["_id"],
        "vorname": row["vorname"],
        "nachname": row.get("nachname"),
        "geburtsdatum": row.get("geburtsdatum"),
    }


def compose_spieler_self(row: Mapping[str, Any]) -> dict[str, Any]:
    """One pupil row's stored data and its squad rows, as `app/api/spieler/services.py :: build_self_pupil_pipeline` reads them."""

    return {**_compose_spieler_person(row), "kader": row["kader"]}


def build_account_pupil_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """This address's pupil row as its account entry and the Funktionen the page judges a grant by read it.

    Its own rather than `app/api/spieler/services.py :: build_self_pupil_pipeline`, whose lookups join every squad row
    the pupil holds for an entry serving none.
    """

    return [
        {"$match": build_self_pupil_filter(identifier)},
        {"$project": {"vorname": 1, "nachname": 1, "geburtsdatum": 1, "inactive_since": 1, "einwilligung": 1}},
    ]


def compose_spieler_account(row: Mapping[str, Any], *, givable: bool, today: str) -> dict[str, Any]:
    """The pupil's account entry: its stored data and its consent, never its squad rows, which the page lists none of."""

    return {
        **_compose_spieler_person(row),
        "einwilligung": _account_einwilligung(row["einwilligung"]),
        "evidence_state": evidence_state_of(blocks=[row["einwilligung"]]),
        "givable": givable,
        "media_offered": media_offered(geburtsdatum=row.get("geburtsdatum"), today=today),
        "media_minimum_age": MEDIA_MIN_AGE_YEARS,
    }


def _compose_schiedsrichter_person(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "schiedsrichter_id": row["_id"],
        "name": row["name"],
        "schule": row.get("schule"),
        "kontakt": row["kontakt"],
        "geburtsdatum": row.get("geburtsdatum"),
    }


def compose_schiedsrichter_self(row: Mapping[str, Any]) -> dict[str, Any]:
    """One referee row's stored data and its fee, as `app/api/schiedsrichter/services.py :: SELBST_FIELDS` projects them."""

    return {**_compose_schiedsrichter_person(row), "honorar": row["default_payment"]}


def build_account_referee_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """This address's referee rows as their account entries and the Funktionen the page judges a grant by read them.

    Its own rather than `app/api/schiedsrichter/services.py :: build_self_referee_pipeline`, whose projection takes the fee
    for an entry serving none.
    """

    return [
        {"$match": build_self_referee_filter(identifier)},
        {"$project": {"name": 1, "schule": 1, "kontakt": 1, "geburtsdatum": 1, "inactive_since": 1, EINWILLIGUNG_FELD: 1}},
    ]


def compose_schiedsrichter_account(row: Mapping[str, Any], *, givable: bool, today: str) -> dict[str, Any]:
    """One referee row's account entry: its stored data and its consent, never its fee, which the page shows nowhere."""

    return {
        **_compose_schiedsrichter_person(row),
        "einwilligung": _account_einwilligung(row["einwilligung"]),
        "evidence_state": evidence_state_of(blocks=[row["einwilligung"]]),
        "givable": givable,
        "media_offered": media_offered(geburtsdatum=row.get("geburtsdatum"), today=today),
        "media_minimum_age": MEDIA_MIN_AGE_YEARS,
    }


def build_self_seat_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every season row one of whose seats names the address, `app/api/identity/services.py :: own_seats` judging each slot.

    No `austritt` term: a withdrawal reaches a withdrawn team's seat too. Each row carries its season's status, so the page
    reads none apart.
    """

    return [
        {"$match": rows_seating(identifier)},
        {
            "$project": {
                "saison_id": 1,
                "team_id": 1,
                "name": 1,
                # Read by the Funktionen the page judges a grant by, which come from these rows.
                "austritt": 1,
                **{f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_ROLLEN for field in ("email", "geburtsdatum", "einwilligung")},
            }
        },
        # Read by the same Funktionen.
        saison_status_lookup(),
    ]


def seat_choices_of_row(blocks: Sequence[Mapping[str, Any]]) -> dict[FLEinwilligungChoice, Any]:
    """Each choice as the account page serves one person's seats on a row: on where any held seat's is, so a withdrawal stays offered.

    One person's seats on a row may disagree, each seat's link being answered on its own.
    """

    return {
        "umfang": "kontaktdaten_whatsapp" if any(is_given("umfang", block.get("umfang")) for block in blocks) else "kontaktdaten",
        "media": any(is_given("media", block.get("media")) for block in blocks),
    }


def changed_seat_choices(
    *, blocks: Sequence[Mapping[str, Any]], pressed: Mapping[FLEinwilligungChoice, Any]
) -> dict[FLEinwilligungChoice, Any]:
    """The choices a seat press changed against the row its page served; one sent back as shown is no grant and no move.

    On seats answered apart, moving it would grant one what was never pressed.
    """

    shown = seat_choices_of_row(blocks)

    return {choice: value for choice, value in pressed.items() if value != shown[choice]}


def _seat_choices_held(held: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    blocks = [seat["einwilligung"] for seat in held]

    return {**seat_choices_of_row(blocks), "evidence_state": evidence_state_of(blocks=blocks)}


def compose_seats_self(
    rows: Sequence[Mapping[str, Any]],
    identifier: str,
    *,
    seats_with_panel: Sequence[FLSubjectSeat],
    today: str,
) -> list[dict[str, Any]]:
    """One entry per season row on which this address holds a confirmed seat.

    Per ROW, the seat PATCH moving a person's slots together; each choice is on where any held slot's
    is, so a withdrawal stays offered.
    """

    seats = []
    for row in rows:
        rollen = own_seats(row, identifier)
        if not rollen:
            continue
        held = [row["kontakte"][slot] for slot in rollen]
        seats.append(
            {
                "team_id": row["team_id"],
                "team_name": row["name"],
                "saison_id": row["saison_id"],
                "rollen": rollen,
                **_seat_choices_held(held),
                "media_minimum_age": MEDIA_MIN_AGE_YEARS,
                "media_offered": all(media_offered(geburtsdatum=seat.get("geburtsdatum"), today=today) for seat in held),
                "givable": holds_a_seat(seats_with_panel, team_id=row["team_id"], saison_id=row["saison_id"]),
            }
        )

    return seats


# --- The pending applications a person confirmed a seat on: withdraw-only, a grant being the
# confirmation page's alone.


def build_self_bewerbung_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every pending application with a seat at the address, `own_seats` then keeping the confirmed ones as on a season row."""

    return [
        {"$match": build_eigene_bewerbung_filter(identifier)},
        {
            "$project": {
                "saison_id": 1,
                "team_id": 1,
                "schule.team_name": 1,
                **{f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_ROLLEN for field in ("email", "einwilligung")},
            }
        },
        context_teams_lookup("team_id"),
    ]


def compose_bewerbung_seats_self(
    rows: Sequence[Mapping[str, Any]], identifier: str, *, teams: Mapping[Any, Mapping[str, Any]]
) -> list[dict[str, Any]]:
    """One entry per pending application on which this address holds a confirmed seat, as `compose_seats_self` answers a row."""

    entries = []
    for row in rows:
        rollen = own_seats(row, identifier)
        if not rollen:
            continue
        held = [row["kontakte"][slot] for slot in rollen]
        schule = bewerbung_schule(bewerbung_raw=row, club_name=(teams.get(row.get("team_id")) or {}).get("name"))
        entries.append(
            {
                "bewerbung_id": row["_id"],
                "schule": schule,
                "saison_id": row["saison_id"],
                "rollen": rollen,
                **_seat_choices_held(held),
            }
        )

    return entries


# --- The pending registrations a pupil confirmed: withdraw-only until the admission, a returning pupil's read-only.


def build_self_registrierung_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every pending registration at the address, `is_own_registrierung` then keeping the confirmed ones as the gate does."""

    return [
        {"$match": build_eigene_registrierung_filter(identifier)},
        {
            "$project": {
                field: 1
                for field in (
                    "saison_id",
                    "team_id",
                    "status",
                    "email",
                    "vorname",
                    "nachname",
                    "geburtsdatum",
                    "einwilligung",
                )
            }
        },
        context_teams_lookup("team_id"),
    ]


def compose_registrierungen_self(
    rows: Sequence[Mapping[str, Any]], identifier: str, *, teams: Mapping[Any, Mapping[str, Any]]
) -> list[dict[str, Any]]:
    """One entry per pending registration of this address its pupil confirmed; a returning pupil's serves no choice and offers no control."""

    entries = []
    for row in rows:
        if not is_own_registrierung(row, identifier):
            continue
        block = row["einwilligung"]
        team = teams.get(row["team_id"])
        entries.append(
            {
                "registrierung_id": row["_id"],
                "team_name": None if team is None else team.get("name"),
                "saison_id": row["saison_id"],
                "umfang": block.get("umfang"),
                "media": is_given("media", block.get("media")) if traegt_wahlen(block) else None,
                "evidence_state": evidence_state_of(blocks=[block]),
                **{field: row.get(field) for field in ("vorname", "nachname", "geburtsdatum")},
            }
        )

    return entries


# --- The page's ONE read: every kind of own record, each arm keyed by the person's own rows and joined to what it names,
# unioned into one aggregation so the page costs one round trip.

AccountArm = Literal["spieler", "schiedsrichter", "seats", "bewerbungen", "registrierungen"]


# Each arm's own order, the last key unique so no two rows tie: a past season's row after a running one's.
SEAT_ORDER: Final[Mapping[str, int]] = {"saison_id": -1, "name": 1, "team_id": 1}
BEWERBUNG_ORDER: Final[Mapping[str, int]] = {"saison_id": -1, "_id": 1}
REGISTRIERUNG_ORDER: Final[Mapping[str, int]] = {"saison_id": -1, "_id": 1}


def _arm(arm: AccountArm, pipeline: Sequence[Mapping[str, Any]], *, order: Mapping[str, int]) -> list[Mapping[str, Any]]:
    """`pipeline`'s rows, each tagged with its arm and its place in `order` as `_rank`.

    A union's order is unspecified, its arms' with it, so the place is stored: a `$push` after a `$sort` collects the
    rows in that order (the manual's `$push` page guarantees it), and the unwind numbers them. Never
    `$setWindowFields`'s `$documentNumber`, which the server refuses any `sortBy` of more than one key, and an arm's own
    order needs a unique last key.
    """

    return [
        *pipeline,
        {"$sort": dict(order)},
        {"$group": {"_id": None, "rows": {"$push": "$$ROOT"}}},
        {"$unwind": {"path": "$rows", "includeArrayIndex": "_rank"}},
        {"$replaceWith": {"$mergeObjects": ["$rows", {"_rank": "$_rank", "_arm": arm}]}},
    ]


def build_account_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """The account page's read, run on `spieler`, each arm tagged and ranked.

    The pupil's and the referee's rows by the selections their account entries read, and the season rows, pending applications and
    registrations seating the address. Each arm is sorted last, after its lookups, so no stage after it moves its order.
    """

    return [
        *_arm("spieler", build_account_pupil_pipeline(identifier), order=SELF_PUPIL_ORDER),
        {
            "$unionWith": {
                "coll": DbCollection.SCHIEDSRICHTER,
                "pipeline": _arm("schiedsrichter", build_account_referee_pipeline(identifier), order=SELF_REFEREE_ORDER),
            }
        },
        {"$unionWith": {"coll": DbCollection.SAISON_TEAMS, "pipeline": _arm("seats", build_self_seat_pipeline(identifier), order=SEAT_ORDER)}},
        {
            "$unionWith": {
                "coll": DbCollection.BEWERBUNGEN,
                "pipeline": _arm("bewerbungen", build_self_bewerbung_pipeline(identifier), order=BEWERBUNG_ORDER),
            }
        },
        {
            "$unionWith": {
                "coll": DbCollection.REGISTRIERUNGEN,
                "pipeline": _arm("registrierungen", build_self_registrierung_pipeline(identifier), order=REGISTRIERUNG_ORDER),
            }
        },
    ]


def account_arms(rows: Sequence[Mapping[str, Any]]) -> dict[AccountArm, list[Mapping[str, Any]]]:
    """The read's rows by the arm that found them, each in its arm's own order."""

    arms: dict[AccountArm, list[Mapping[str, Any]]] = {arm: [] for arm in get_args(AccountArm)}
    for row in sorted(rows, key=lambda row: row["_rank"]):
        arms[row["_arm"]].append(row)

    return arms
