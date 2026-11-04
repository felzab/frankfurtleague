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
from app.api.einwilligung.services import medien_angeboten
from app.api.identity.schemas import FLSubjectSeat
from app.api.identity.services import eigene_sitze, holds_a_seat, ist_eigene_registrierung, saison_status_lookup
from app.api.kontakte.services import rows_seating
from app.api.registrierungen.services import build_eigene_registrierung_filter, traegt_wahlen
from app.api.schiedsrichter.services import SELF_REFEREE_ORDER, build_self_referee_pipeline
from app.api.spieler.services import SELF_PUPIL_ORDER, build_self_pupil_pipeline
from app.core.codes import Code
from app.core.collections import Collection as DbCollection
from app.core.exceptions import WriteRefusal
from app.core.journal import JournalLine
from app.shared.einwilligung_nachweis import CHOICES, FLEinwilligungChoice, TextVersions, compose_choices, is_given, nachweis_stand_of
from app.shared.schemas.bounds import MEDIEN_MIN_AGE_YEARS
from app.shared.schemas.einwilligung import PressTextVersions, stale_grants
from app.shared.schemas.literals import KONTAKT_ROLLEN


def erteilt_etwas(*, gespeichert: Mapping[str, Any], gewaehlt: Mapping[FLEinwilligungChoice, Any]) -> bool:
    """Whether a press GRANTS a choice the stored record withholds, in either vocabulary.

    A grant is admitted only where its record's grant predicate allows it, a withdrawal on every confirmed one (Art. 7(3) DSGVO).
    """

    return any(is_given(wahl, wert) and not is_given(wahl, gespeichert.get(wahl)) for wahl, wert in gewaehlt.items())


def _bewegt(gespeichert: Mapping[str, Any], wahl: FLEinwilligungChoice, wert: Any) -> bool:
    return wert != (is_given("medien", gespeichert.get("medien")) if wahl == "medien" else gespeichert.get(wahl))


def compose_person_move(
    *, gespeichert: Mapping[str, Any], gewaehlt: Mapping[FLEinwilligungChoice, Any], am: str, text_versions: TextVersions
) -> dict[str, dict[str, Any]] | None:
    """The update moving a person's own block, at `einwilligung`, by the choices that change; `None` where none does.

    Never `confirmed_at`, read by the panel and the publication mask: each press's labels are its evidence's.
    """

    bewegt: list[FLEinwilligungChoice] = [wahl for wahl in CHOICES if wahl in gewaehlt and _bewegt(gespeichert, wahl, gewaehlt[wahl])]
    if not bewegt:
        return None

    return {
        "$set": compose_choices(
            path="einwilligung",
            saved=gespeichert,
            gesetzt={wahl: gewaehlt[wahl] for wahl in bewegt},
            am=am,
            text_versions=text_versions,
        )
    }


def compose_sitz_move(
    *, sitze: Mapping[str, Mapping[str, Any]], gewaehlt: Mapping[FLEinwilligungChoice, Any], am: str, text_versions: TextVersions
) -> dict[str, dict[str, Any]] | None:
    """The update moving every held seat's block of one row or application, `sitze` keyed by slot; `None` where none moves."""

    gesetzt: dict[str, Any] = {}
    for slot, gespeichert in sitze.items():
        gesetzt.update(
            compose_choices(
                path=f"kontakte.{slot}.einwilligung",
                saved=gespeichert,
                gesetzt={wahl: gewaehlt[wahl] for wahl in CHOICES if wahl in gewaehlt and _bewegt(gespeichert, wahl, gewaehlt[wahl])},
                am=am,
                text_versions=text_versions,
            )
        )

    return {"$set": gesetzt} if gesetzt else None


def widerruf_line(
    *,
    person_hash: str,
    collection: DbCollection,
    record_id: ObjectId,
    bloecke: Sequence[Mapping[str, Any]],
    gewaehlt: Mapping[FLEinwilligungChoice, Any],
    am: str,
    text_versions: TextVersions,
) -> JournalLine | None:
    """The journal line of a press, naming each choice it moved off a grant on any of `bloecke`; `None` where it withdrew none.

    A grant is never journalled: a restore taking one back leaves the person less exposed, never more.
    """

    widerrufen: dict[FLEinwilligungChoice, Any] = {
        wahl: wert for wahl, wert in gewaehlt.items() if not is_given(wahl, wert) and any(is_given(wahl, block.get(wahl)) for block in bloecke)
    }
    if not widerrufen:
        return None

    return JournalLine(
        person_hash=person_hash,
        art="widerruf",
        collection=collection,
        record_id=record_id,
        am=am,
        text_versions={wahl: text_versions[wahl] for wahl in widerrufen},
        choices=widerrufen,
    )


def find_grant_wording_refusal(
    *, bloecke: Sequence[Mapping[str, Any]], gewaehlt: Mapping[FLEinwilligungChoice, Any], text_versions: PressTextVersions
) -> WriteRefusal | None:
    """`grant_wording_stale`: a choice this press moves onto a grant on any of `bloecke` names a replaced label.

    Only a choice that moves: the writers stamp no other, so an unchanged grant beside a withdrawal from a page loaded
    before a rewording records nothing under the old words, and refusing it would keep the withdrawal from landing.
    """

    erteilt: dict[FLEinwilligungChoice, Any] = {
        wahl: wert for wahl, wert in gewaehlt.items() if any(erteilt_etwas(gespeichert=block, gewaehlt={wahl: wert}) for block in bloecke)
    }
    stale = stale_grants(text_versions, erteilt)
    if not stale:
        return None

    return WriteRefusal(
        error_code=Code.GRANT_WORDING_STALE,
        status=HTTPStatus.CONFLICT,
        fields=tuple(("text_versions", wahl) for wahl in stale),
    )


def find_erteilung_refusal(*, zugelassen: bool) -> WriteRefusal | None:
    """`giving_not_allowed`: the record is the person's own and takes a withdrawal alone, so a grant on it is refused.

    Its own code, not `role_not_held`'s: the record was found, so naming the cause hides nothing.
    """

    if zugelassen:
        return None

    return WriteRefusal(
        error_code=Code.GIVING_NOT_ALLOWED,
        status=HTTPStatus.FORBIDDEN,
    )


def find_eigener_eintrag_refusal(*, gehalten: bool) -> WriteRefusal | None:
    """`role_not_held` on a person's own record: the address holds no record this operation may read or change.

    One answer for another person's id, an unconfirmed record and none at all, so the refusal tells
    nobody which ids exist.
    """

    if gehalten:
        return None

    return WriteRefusal(
        error_code=Code.ROLE_NOT_HELD,
        status=HTTPStatus.FORBIDDEN,
    )


def find_nachweis_stand_refusal(*, erwartet: Mapping[str, Any], bloecke: Sequence[Any]) -> WriteRefusal | None:
    """`choices_stale`: a choice's evidence moved since the page was served.

    Refused rather than merged: a stale page sends the other choice as it last saw it, and taking that
    would re-grant what the person withdrew elsewhere.
    """

    if dict(erwartet) == nachweis_stand_of(bloecke=bloecke):
        return None

    return WriteRefusal(
        error_code=Code.CHOICES_STALE,
        status=HTTPStatus.CONFLICT,
    )


# --- The records each read serves: CONFIRMED ones alone, retired rows and past seasons included, a
# withdrawal staying open on every record a consent stands on.


def kontext_teams_lookup(local_field: str) -> Mapping[str, Any]:
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


def compose_spieler_self(row: Mapping[str, Any]) -> dict[str, Any]:
    """One pupil row's stored data, as `app/api/spieler/services.py :: build_self_pupil_pipeline` reads it."""

    return {
        "spieler_id": row["_id"],
        "vorname": row["vorname"],
        "nachname": row.get("nachname"),
        "geburtsdatum": row.get("geburtsdatum"),
        "kader": row["kader"],
    }


def compose_spieler_account(row: Mapping[str, Any], *, givable: bool, today: str) -> dict[str, Any]:
    """The pupil's account entry: its stored data and its consent."""

    return {
        **compose_spieler_self(row),
        "inactive_since": row.get("inactive_since"),
        "einwilligung": row["einwilligung"],
        "nachweis_stand": nachweis_stand_of(bloecke=[row["einwilligung"]]),
        "givable": givable,
        "medien_offered": medien_angeboten(geburtsdatum=row.get("geburtsdatum"), today=today),
        "medien_minimum_age": MEDIEN_MIN_AGE_YEARS,
    }


def compose_schiedsrichter_self(row: Mapping[str, Any]) -> dict[str, Any]:
    """One referee row's stored data, as `app/api/schiedsrichter/services.py :: SELBST_FIELDS` projects it."""

    return {
        "schiedsrichter_id": row["_id"],
        "name": row["name"],
        "schule": row.get("schule"),
        "honorar": row["default_payment"],
        "kontakt": row["kontakt"],
        "geburtsdatum": row.get("geburtsdatum"),
    }


def compose_schiedsrichter_account(row: Mapping[str, Any], *, givable: bool, today: str) -> dict[str, Any]:
    """One referee row's account entry: its stored data and its consent."""

    return {
        **compose_schiedsrichter_self(row),
        "inactive_since": row.get("inactive_since"),
        "einwilligung": row["einwilligung"],
        "nachweis_stand": nachweis_stand_of(bloecke=[row["einwilligung"]]),
        "givable": givable,
        "medien_offered": medien_angeboten(geburtsdatum=row.get("geburtsdatum"), today=today),
        "medien_minimum_age": MEDIEN_MIN_AGE_YEARS,
    }


def build_self_seat_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every season row one of whose seats names the address, `app/api/identity/services.py :: eigene_sitze` judging each slot.

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


def sitz_wahlen_der_zeile(bloecke: Sequence[Mapping[str, Any]]) -> dict[FLEinwilligungChoice, Any]:
    """Each choice as the account page serves one person's seats on a row: on where any held seat's is, so a withdrawal stays offered.

    One person's seats on a row may disagree, each seat's link being answered on its own.
    """

    return {
        "umfang": "kontaktdaten_whatsapp" if any(is_given("umfang", block.get("umfang")) for block in bloecke) else "kontaktdaten",
        "medien": any(is_given("medien", block.get("medien")) for block in bloecke),
    }


def geaenderte_sitz_wahlen(
    *, bloecke: Sequence[Mapping[str, Any]], gedrueckt: Mapping[FLEinwilligungChoice, Any]
) -> dict[FLEinwilligungChoice, Any]:
    """The choices a seat press changed against the row its page served; one sent back as shown is no grant and no move.

    On seats answered apart, moving it would grant one what was never pressed.
    """

    gezeigt = sitz_wahlen_der_zeile(bloecke)

    return {wahl: wert for wahl, wert in gedrueckt.items() if wert != gezeigt[wahl]}


def _sitz_wahlen_gehalten(held: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    bloecke = [seat["einwilligung"] for seat in held]

    return {**sitz_wahlen_der_zeile(bloecke), "nachweis_stand": nachweis_stand_of(bloecke=bloecke)}


def compose_sitze_self(
    rows: Sequence[Mapping[str, Any]],
    identifier: str,
    *,
    sitze_mit_panel: Sequence[FLSubjectSeat],
    today: str,
) -> list[dict[str, Any]]:
    """One entry per season row on which this address holds a confirmed seat.

    Per ROW, the seat PATCH moving a person's slots together; each choice is on where any held slot's
    is, so a withdrawal stays offered.
    """

    sitze = []
    for row in rows:
        rollen = eigene_sitze(row, identifier)
        if not rollen:
            continue
        held = [row["kontakte"][slot] for slot in rollen]
        sitze.append(
            {
                "team_id": row["team_id"],
                "team_name": row["name"],
                "saison_id": row["saison_id"],
                "rollen": rollen,
                **_sitz_wahlen_gehalten(held),
                "medien_minimum_age": MEDIEN_MIN_AGE_YEARS,
                "medien_offered": all(medien_angeboten(geburtsdatum=seat.get("geburtsdatum"), today=today) for seat in held),
                "givable": holds_a_seat(sitze_mit_panel, team_id=row["team_id"], saison_id=row["saison_id"]),
            }
        )

    return sitze


# --- The pending applications a person confirmed a seat on: withdraw-only, a grant being the
# confirmation page's alone.


def build_self_bewerbung_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every pending application with a seat at the address, `eigene_sitze` then keeping the confirmed ones as on a season row."""

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
        kontext_teams_lookup("team_id"),
    ]


def compose_bewerbungssitze_self(
    rows: Sequence[Mapping[str, Any]], identifier: str, *, teams: Mapping[Any, Mapping[str, Any]]
) -> list[dict[str, Any]]:
    """One entry per pending application on which this address holds a confirmed seat, as `compose_sitze_self` answers a row."""

    eintraege = []
    for row in rows:
        rollen = eigene_sitze(row, identifier)
        if not rollen:
            continue
        held = [row["kontakte"][slot] for slot in rollen]
        schule = bewerbung_schule(bewerbung_raw=row, club_name=(teams.get(row.get("team_id")) or {}).get("name"))
        eintraege.append(
            {
                "bewerbung_id": row["_id"],
                "schule": schule,
                "saison_id": row["saison_id"],
                "rollen": rollen,
                **_sitz_wahlen_gehalten(held),
                "medien_minimum_age": MEDIEN_MIN_AGE_YEARS,
            }
        )

    return eintraege


# --- The pending registrations a pupil confirmed: withdraw-only until the admission, a returning pupil's read-only.


def build_self_registrierung_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every pending registration at the address, `ist_eigene_registrierung` then keeping the confirmed ones as the gate does."""

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
                    "nummer",
                    "position",
                    "stufe",
                    "einwilligung",
                )
            }
        },
        kontext_teams_lookup("team_id"),
    ]


def compose_registrierungen_self(
    rows: Sequence[Mapping[str, Any]], identifier: str, *, teams: Mapping[Any, Mapping[str, Any]]
) -> list[dict[str, Any]]:
    """One entry per pending registration of this address its pupil confirmed; a returning pupil's serves no choice and offers no control."""

    eintraege = []
    for row in rows:
        if not ist_eigene_registrierung(row, identifier):
            continue
        block = row["einwilligung"]
        team = teams.get(row["team_id"])
        eintraege.append(
            {
                "registrierung_id": row["_id"],
                "team_id": row["team_id"],
                "team_name": None if team is None else team.get("name"),
                "saison_id": row["saison_id"],
                "umfang": block.get("umfang"),
                "medien": is_given("medien", block.get("medien")) if traegt_wahlen(block) else None,
                "medien_minimum_age": MEDIEN_MIN_AGE_YEARS,
                "nachweis_stand": nachweis_stand_of(bloecke=[block]),
                **{field: row.get(field) for field in ("vorname", "nachname", "geburtsdatum", "nummer", "position", "stufe")},
            }
        )

    return eintraege


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

    The pupil's and the referee's rows by their own pages' selections, and the season rows, pending applications and
    registrations seating the address. Each arm is sorted last, after its lookups, so no stage after it moves its order.
    """

    return [
        *_arm("spieler", build_self_pupil_pipeline(identifier), order=SELF_PUPIL_ORDER),
        {
            "$unionWith": {
                "coll": DbCollection.SCHIEDSRICHTER,
                "pipeline": _arm("schiedsrichter", build_self_referee_pipeline(identifier), order=SELF_REFEREE_ORDER),
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
