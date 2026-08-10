"""
CORE · database constraints

The `$jsonSchema` validators and the unique indexes the database enforces on itself, applied on
every boot (ADR-0020); `--check` reports violations and the cross-document rules without writing
anything. Declared here rather than clicked into Atlas, so they are versioned and restored with
the cluster. The database user needs `collMod`, which `readWrite` does not carry — the wrong user
fails the first one and startup refuses before anything is applied.

Invariants:
- Validators assert types, required fields and enums — never ranges, patterns or lengths (ADR-0020).
- They are hand-written, never generated from the models (ADR-0024).
- `additionalProperties` is never `false`, or every field addition is a deploy-ordering problem.
- Applying is idempotent, nothing is ever removed automatically, and a startup failure is fatal.
- Run `--check` before deploying a change here — a unique index cannot build over violating data.

See:
- docs/backend/spec.md — invariants I15–I17
- docs/_git/spec.md — how a data change is ordered against a deploy
"""

import argparse
import asyncio
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING
from pymongo.errors import OperationFailure

from app.core.collections import Collection

# `collMod` against a collection that does not exist. Handled rather than re-raised: creating a fresh
# collection with the validator already attached reaches the same end state, and the privilege probe
# below reads this code as its "yes".
NAMESPACE_NOT_FOUND = 26

# "You are authenticated and may not do this", and "we do not know who you are", as mongod spells them.
UNAUTHORIZED = 13
AUTHENTICATION_FAILED = 18

# Atlas funnels both kinds through one generic `AtlasError`, code 8000 (measured 2026-08-02), so the
# MESSAGE is the only discriminator working on both a self-managed mongod and Atlas. The code alone
# reports a missing privilege as a bad password.
AUTHENTICATION_PHRASES = ("authentication failed", "bad auth")
AUTHORIZATION_PHRASES = ("not allowed to do action", "not authorized on")

# "This index is not there", which is how the privilege probe below learns it got past authorization.
INDEX_NOT_FOUND = 27

# The probe's fallback namespace, for a database holding none of the collections yet. NOT
# `__`-prefixed: Atlas reserves that prefix and a collMod grant over "all collections" misses it, so
# a `__` target reports DENIED to a user who holds the grant.
ABSENT_COLLECTION_NAME = "fl_constraints_probe"

# An index name chosen to be absent. `collMod` is authorised before its arguments are resolved, so
# asking to hide a missing index reaches the authorization check and stops -- the probe's whole
# trick, and why `--check` writes nothing.
ABSENT_INDEX_NAME = "fl_constraints_probe_index"

_STRING_OR_NULL = ["string", "null"]
_INT_OR_NULL = ["int", "null"]

# Soft deletion, wherever a collection has it: the day the row was retired, or null while it is live.
# One field rather than a boolean beside a date, because the pair can contradict itself and no
# validator here could catch that (ADR-0025).
_INACTIVE_SINCE = {"bsonType": _STRING_OR_NULL}

# Spelled out rather than derived from the `Literal`s, which would make this module depend on every
# API slice. `test_every_validator_enum_matches_its_literal` keeps the copies in step; the field-name
# drift check beside it does not reach enum values.
_SAISON_PHASEN = ["gruppenphase", "achtelfinale", "viertelfinale", "halbfinale", "finale"]
_SAISON_STATUS = ["past", "active", "future"]
_GRUPPEN = ["A", "B", "C", "D"]
_QUELLE_TYPES = ["gruppe", "spiel"]
_QUELLE_AUSGAENGE = ["sieger", "verlierer"]
# A squad row's position and school level (ADR-0048). Both NULLABLE -- an unanswered field is null,
# not a placeholder -- so `None` is a member of each list, which is what lets `enum` stand beside a
# nullable `bsonType`.
_POSITIONEN = ["Tor", "Abwehr", "Mittelfeld", "Angriff"]
_STUFEN = ["E1", "E2", "Q1", "Q2", "Q3", "Q4"]


def _object(*, required: Sequence[str], properties: Mapping[str, Any], nullable: bool = False) -> Mapping[str, Any]:
    """
    One object sub-schema.

    `nullable` widens the `bsonType` rather than wrapping the whole thing in an `anyOf`, which works
    because MongoDB applies `required` and `properties` only when the value actually is an object. So a
    match with no venue satisfies a schema that names four required keys inside `ort`.
    """
    return {
        "bsonType": ["object", "null"] if nullable else "object",
        "required": list(required),
        "properties": dict(properties),
    }


_ADDRESS = _object(
    required=("strasse", "hausnummer", "plz", "stadtteil", "stadt"),
    properties={
        "strasse": {"bsonType": "string"},
        # Both of these carry a pattern in FLAddress -- `hausnummer` may be empty, `plz` is five
        # digits -- and neither is repeated here. A malformed postcode is a wrong value, not a
        # structurally broken document, and Pydantic already refuses it at the boundary.
        "hausnummer": {"bsonType": "string"},
        "plz": {"bsonType": "string"},
        "stadtteil": {"bsonType": "string"},
        "stadt": {"bsonType": "string"},
    },
)

_KONTAKT = _object(
    required=("telefon", "email"),
    properties={"telefon": {"bsonType": _STRING_OR_NULL}, "email": {"bsonType": _STRING_OR_NULL}},
)

_DISQUALIFIKATION = _object(
    # Null for every team still competing: the absence of the record is what "not disqualified" means.
    # No boolean sits beside it, here or on the model, because the two could disagree and nothing
    # available could refuse that (ADR-0047).
    nullable=True,
    # Both keys, because a record missing either is not half a disqualification but one that cannot be
    # rendered. `grund`'s `min_length=1` is not repeated: an empty reason is a wrong value rather than a
    # broken document, which is the line ADR-0020 draws.
    required=("grund", "datum"),
    properties={
        "grund": {"bsonType": "string"},
        # The German YYYY-MM-DD string every other date here is. Its FORMAT is Pydantic's, for the
        # reason `_INACTIVE_SINCE` states.
        "datum": {"bsonType": "string"},
    },
)

_SPIEL_QUELLE = _object(
    # Null on every group-phase fixture, and on any slot an admin has taken manual charge of by clearing
    # it -- which is the only manual-override mechanism there is (ADR-0034).
    nullable=True,
    # `type` alone: the remaining keys belong to one variant each, and `$jsonSchema` cannot require a
    # field only when a sibling holds a value. That rule is Pydantic's; what stays here is the silent
    # failure -- a `platz` stored as "2".
    required=("type",),
    properties={
        "type": {"bsonType": "string", "enum": _QUELLE_TYPES},
        # The `gruppe` variant: the team finishing `platz` in `gruppe` once the group phase is complete.
        "gruppe": {"bsonType": "string", "enum": _GRUPPEN},
        "platz": {"bsonType": "int"},
        # The `spiel` variant: the side that came out of match `spiel_nr` as `ausgang`.
        "spiel_nr": {"bsonType": "int"},
        "ausgang": {"bsonType": "string", "enum": _QUELLE_AUSGAENGE},
    },
)

_SPIEL_ELFMETERSCHIESSEN = _object(
    # Null on every fixture that did not finish level, which is almost all of them (ADR-0036).
    nullable=True,
    # Both counts required and typed -- no variants here, so a shoot-out stored as "4" is refused by the
    # database. That the two must DIFFER is a cross-field rule `$jsonSchema` cannot express, so it lives
    # on `FLSpielElfmeterschiessen` (ADR-0020).
    required=("team1", "team2"),
    properties={
        "team1": {"bsonType": "int"},
        "team2": {"bsonType": "int"},
    },
)

_SPIEL_TEAM_FIELD = _object(
    # Nullable: an unfilled playoff slot has no occupant and the fixture says so rather than pointing at
    # a stand-in (ADR-0034). Where the occupant comes from is `teamN_quelle`, a sibling of this field
    # and never a key inside it.
    nullable=True,
    required=("team_id", "name", "tore", "shorthand"),
    properties={
        "team_id": {"bsonType": "objectId"},
        # A display copy of `teams.name`, which `PATCH /teams/{team_id}` fans out into (ADR-0021, rule 3).
        "name": {"bsonType": "string"},
        "tore": {"bsonType": _INT_OR_NULL},
        "shorthand": {"bsonType": "string"},
    },
)

_SPIEL_ORT_FIELD = _object(
    nullable=True,
    required=("spielort_id", "name", "maps_link", "mietpreis"),
    properties={
        "spielort_id": {"bsonType": "objectId"},
        "name": {"bsonType": "string"},
        "maps_link": {"bsonType": "string"},
        # The one line catching a defect already in the data. The admin form stores this rent as an int
        # and a hand edit as a double; every stored double is integral, so Pydantic accepts them all and
        # nothing looks wrong. "int" refuses the next one.
        "mietpreis": {"bsonType": "int"},
    },
)

_SPIEL_SCHIEDSRICHTER_FIELD = _object(
    nullable=True,
    required=("schiedsrichter_id", "name", "payment"),
    properties={
        "schiedsrichter_id": {"bsonType": "objectId"},
        "name": {"bsonType": "string"},
        "payment": {"bsonType": "int"},
    },
)


COLLECTION_VALIDATORS: Mapping[Collection, Mapping[str, Any]] = {
    Collection.SAISONS: {
        "$jsonSchema": _object(
            required=("_id", "start_date", "end_date", "status", "rules"),
            properties={
                # `FLSaison.id`'s length is deliberately not repeated (ADR-0020): a wrong-length id
                # fails `FLSaison` on the next read of the current season, loudly. What a validator is
                # here for is the defect nothing announces.
                "_id": {"bsonType": "string"},
                "start_date": {"bsonType": "string"},
                "end_date": {"bsonType": "string"},
                "status": {"bsonType": "string", "enum": _SAISON_STATUS},
                # Exactly one season is `active`, and no validator can express that. `PATCH
                # /admin/activate_saison` is the only path to the value and enforces it in one
                # transaction (ADR-0026); nothing else may write `status` at all.
                "rules": _object(
                    required=(
                        "win_points",
                        "draw_points",
                        "qualifiers_per_group",
                        "number_of_groups",
                        "teams_per_group",
                        "erlaubte_stufen",
                    ),
                    properties={
                        "win_points": {"bsonType": "int"},
                        "draw_points": {"bsonType": "int"},
                        # How many teams per group reach the knockout round (ADR-0035). Required
                        # here too, because a season missing it seeds no bracket; `--check` reports
                        # a document still lacking it.
                        "qualifiers_per_group": {"bsonType": "int"},
                        # The season's capacity, read by the junction write's refusals
                        # (REQ-ENTER-001..003). Required for the same reason as the line above, and
                        # `--check` again reports the documents still lacking the keys.
                        "number_of_groups": {"bsonType": "int"},
                        "teams_per_group": {"bsonType": "int"},
                        # A subset of the league's own set, which `saison_spieler.stufe` is held to
                        # (ADR-0048). The ITEMS are enumerated, so a season cannot offer a level the
                        # league lacks; `minItems` is a range and stays Pydantic's.
                        "erlaubte_stufen": {"bsonType": "array", "items": {"bsonType": "string", "enum": _STUFEN}},
                    },
                ),
            },
        )
    },
    Collection.TEAMS: {
        "$jsonSchema": _object(
            # `gruppe`, `disqualifikation` and `statistik` are absent because a team document does not
            # carry them: the first two are season-scoped and live on `saison_teams`, and the third is
            # derived from `spiele` on every read and stored nowhere (ADR-0019).
            required=("_id", "name", "shorthand", "description", "full_name", "website_url", "address", "inactive_since"),
            properties={
                "_id": {"bsonType": "objectId"},
                "name": {"bsonType": "string"},
                "shorthand": {"bsonType": "string"},
                "description": {"bsonType": "string"},
                "full_name": {"bsonType": "string"},
                "website_url": {"bsonType": "string"},
                "address": _ADDRESS,
                # A retired club, not a club out of one season -- `saison_teams` has no equivalent
                # because a team never leaves a season except by disqualification (ADR-0026).
                # `uniq_shorthand` keeps indexing it, so its two letters stay reserved.
                "inactive_since": _INACTIVE_SINCE,
            },
        )
    },
    Collection.SAISON_TEAMS: {
        "$jsonSchema": _object(
            # Transcribed from the documents, not a model: this junction has no Pydantic model of the
            # ROW, carries no `statistik` (ADR-0019), and carries no `inactive_since` -- a team never
            # leaves a season, so no row here is ever retired (ADR-0026).
            required=("_id", "saison_id", "team_id", "gruppe", "disqualifikation"),
            properties={
                "_id": {"bsonType": "objectId"},
                "saison_id": {"bsonType": "string"},
                "team_id": {"bsonType": "objectId"},
                "gruppe": {"bsonType": "string", "enum": _GRUPPEN},
                # The reason a team is out of this season and the day it took effect, or null while it
                # competes (ADR-0047). Required, so a row missing the key is rejected -- which is why
                # that ADR's runbook seeds it BEFORE this deploy.
                "disqualifikation": _DISQUALIFIKATION,
            },
        )
    },
    Collection.SPIELER: {
        "$jsonSchema": _object(
            # Two fields and a name. Everything else a squad list shows -- team, number, stufe,
            # position -- is season-scoped and lives on `saison_spieler`.
            required=("_id", "vorname", "nachname", "inactive_since"),
            properties={
                "_id": {"bsonType": "objectId"},
                "vorname": {"bsonType": "string"},
                "nachname": {"bsonType": _STRING_OR_NULL},
                # The person has left the league entirely. A player who merely left ONE squad is
                # retired on the junction row below instead, and the two are independent.
                "inactive_since": _INACTIVE_SINCE,
            },
        )
    },
    Collection.SAISON_SPIELER: {
        "$jsonSchema": _object(
            required=(
                "_id",
                "spieler_id",
                "saison_id",
                "team_id",
                "is_nachgetragen",
                "is_captain",
                "stufe",
                "position",
                "nummer",
                "inactive_since",
            ),
            properties={
                "_id": {"bsonType": "objectId"},
                "spieler_id": {"bsonType": "objectId"},
                "saison_id": {"bsonType": "string"},
                # The field that motivated ADR-0020. Two rows hold the team's `full_name` as a string
                # instead of this reference: unique, well-formed, and wrong.
                "team_id": {"bsonType": "objectId"},
                "is_nachgetragen": {"bsonType": "bool"},
                # On the JUNCTION rather than the person: a role within one team for one season. Not
                # unique by any rule the database can express -- a co-captaincy is real, and no
                # validator sees two documents (`docs/backend/spec.md :: I16`).
                "is_captain": {"bsonType": "bool"},
                # Closed sets, both nullable while a squad entry is still being filled in (ADR-0048).
                # This validator is what makes the sets true of the DATA rather than only of the write
                # path: squads are also hand-edited in MongoDB, where no Pydantic model runs.
                "stufe": {"bsonType": _STRING_OR_NULL, "enum": [*_STUFEN, None]},
                "position": {"bsonType": _STRING_OR_NULL, "enum": [*_POSITIONEN, None]},
                # A STRING, not an int. Squad numbers are worn, not counted.
                "nummer": {"bsonType": _STRING_OR_NULL},
                # `uniq_spieler_id_saison_id` keeps indexing a retired row, so a second create for the
                # same player and season is a DUPLICATE KEY answered 409. Creating never revives
                # (ADR-0025); the reactivate endpoint is the way back.
                "inactive_since": _INACTIVE_SINCE,
            },
        )
    },
    Collection.SPIELE: {
        "$jsonSchema": _object(
            required=(
                "_id",
                "team1",
                "team2",
                "team1_quelle",
                "team2_quelle",
                "datum",
                "uhrzeit",
                "ort",
                "schiedsrichter",
                "ergebnis",
                "elfmeterschiessen",
                "spieltag_id",
                "spiel_nr",
                "is_canceled",
                "saison_phase",
                "saison_id",
            ),
            properties={
                "_id": {"bsonType": "objectId"},
                "team1": _SPIEL_TEAM_FIELD,
                "team2": _SPIEL_TEAM_FIELD,
                # Where each side comes from, or null for a fixture drawn from nowhere -- every
                # group-phase match, and every slot taken into manual charge. Nothing pairs it with the
                # team field beside it: every combination is legitimate (ADR-0034).
                "team1_quelle": _SPIEL_QUELLE,
                "team2_quelle": _SPIEL_QUELLE,
                "datum": {"bsonType": _STRING_OR_NULL},
                "uhrzeit": {"bsonType": _STRING_OR_NULL},
                "ort": _SPIEL_ORT_FIELD,
                "schiedsrichter": _SPIEL_SCHIEDSRICHTER_FIELD,
                # "Tore:Tore" or null, and the pattern that says so is FLSpiel's. A malformed
                # `ergebnis` is caught on read; a `42` where a string belongs is not.
                "ergebnis": {"bsonType": _STRING_OR_NULL},
                # How a knockout that finished level was settled, and a scoreline of its own rather
                # than a third number inside `ergebnis` (ADR-0036). Required as a KEY on every match,
                # like the two `quelle` fields: null is the answer for all of them but a handful.
                "elfmeterschiessen": _SPIEL_ELFMETERSCHIESSEN,
                "spieltag_id": {"bsonType": "objectId"},
                "spiel_nr": {"bsonType": "int"},
                "is_canceled": {"bsonType": "bool"},
                "saison_phase": {"bsonType": "string", "enum": _SAISON_PHASEN},
                "saison_id": {"bsonType": "string"},
                # A property but NOT a required key, unlike `elfmeterschiessen`: a missing key and a
                # stored null both mean "no note", so requiring it would put a backfill of every live
                # document behind decoration. `FLSpiel.notiz` defaults for the same reason.
                "notiz": {"bsonType": _STRING_OR_NULL},
            },
        )
    },
    Collection.SPIELTAGE: {
        "$jsonSchema": _object(
            required=("_id", "beginn", "ende", "saison_phase", "saison_id", "inactive_since"),
            properties={
                "_id": {"bsonType": "objectId"},
                "beginn": {"bsonType": "string"},
                "ende": {"bsonType": "string"},
                # NEITHER a position NOR a match count is stored, and both absences are decisions: the
                # position is derived (ADR-0051) and the count follows from the season's `rules`
                # (ADR-0052), which is why `MIRRORED_MODELS` lists `anzahl_spiele` as not-stored.
                "saison_phase": {"bsonType": "string", "enum": _SAISON_PHASEN},
                "saison_id": {"bsonType": "string"},
                # Retiring a matchday does not touch the matches pointing at it: `spiele.spieltag_id`
                # keeps resolving, which is the whole reason this is soft rather than a delete.
                "inactive_since": _INACTIVE_SINCE,
            },
        )
    },
    Collection.SPIELORTE: {
        "$jsonSchema": _object(
            required=("_id", "name", "address", "maps_link", "default_mietpreis", "inactive_since"),
            properties={
                "_id": {"bsonType": "objectId"},
                "name": {"bsonType": "string"},
                "address": _ADDRESS,
                # Free text searched on Google Maps, not a URL, so there is no scheme to check here or
                # in FLSpielort.
                "maps_link": {"bsonType": "string"},
                "default_mietpreis": {"bsonType": "int"},
                "inactive_since": _INACTIVE_SINCE,
            },
        )
    },
    Collection.SCHIEDSRICHTER: {
        "$jsonSchema": _object(
            required=("_id", "name", "schule", "default_payment", "kontakt", "inactive_since"),
            properties={
                "_id": {"bsonType": "objectId"},
                "name": {"bsonType": "string"},
                "schule": {"bsonType": _STRING_OR_NULL},
                "default_payment": {"bsonType": "int"},
                # Both halves are null on every referee today. That is personal data, so unused is the
                # safe state -- the shape is required to be present, never to be filled in.
                "kontakt": _KONTAKT,
                "inactive_since": _INACTIVE_SINCE,
            },
        )
    },
}


@dataclass(frozen=True)
class UniqueIndex:
    """One uniqueness rule. `rule` exists so a failed build says which rule broke, not which keys."""

    collection: str
    name: str
    keys: tuple[str, ...]
    rule: str


# The four rules that are true in the data and were enforced by nobody. Indexes for query performance
# are deliberately absent: the whole database is about 130 KB, so one would be theatre with a
# maintenance cost (ADR-0020).
UNIQUE_INDEXES: Sequence[UniqueIndex] = (
    UniqueIndex(Collection.SAISON_TEAMS, "uniq_saison_id_team_id", ("saison_id", "team_id"), "one junction row per team per season"),
    UniqueIndex(Collection.SAISON_SPIELER, "uniq_spieler_id_saison_id", ("spieler_id", "saison_id"), "one junction row per player per season"),
    UniqueIndex(Collection.SPIELE, "uniq_saison_id_spiel_nr", ("saison_id", "spiel_nr"), "a spiel_nr identifies one match within a season"),
    UniqueIndex(Collection.TEAMS, "uniq_shorthand", ("shorthand",), "a shorthand identifies exactly one team"),
)


@dataclass(frozen=True)
class ConstraintSummary:
    """What `apply_constraints` got through, for the one startup log line that reports it."""

    validators: int
    indexes: int


async def _apply_validator(db: AsyncIOMotorDatabase, collection_name: str, validator: Mapping[str, Any]) -> None:
    command = {
        "collMod": collection_name,
        "validator": validator,
        # strict, so the rules also apply to an UPDATE of an already-stored document. "moderate"
        # exempts documents that do not currently validate, which is precisely the set worth catching.
        "validationLevel": "strict",
        # error, not warn. A warning goes to a server log nobody reads and the write lands anyway.
        "validationAction": "error",
    }
    try:
        await db.command(command)
    except OperationFailure as failure:
        if failure.code == NAMESPACE_NOT_FOUND:
            await db.create_collection(collection_name, validator=validator, validationLevel="strict", validationAction="error")
            return
        raise RuntimeError(f"Could not apply the validator for '{collection_name}': {failure}") from failure


async def apply_constraints(db: AsyncIOMotorDatabase) -> ConstraintSummary:
    """
    Apply every validator and unique index to `db`, replacing whatever is there.

    Safe on every boot: `collMod` overwrites the validator with the declared one, and `create_index` is
    a no-op for an index that already matches. Raises on the FIRST failure with the collection named --
    there is no partial-success path, because a database enforcing all but one validator looks exactly
    like one enforcing every validator.
    """
    for collection_name, validator in COLLECTION_VALIDATORS.items():
        await _apply_validator(db, collection_name, validator)

    for index in UNIQUE_INDEXES:
        try:
            await db[index.collection].create_index([(key, ASCENDING) for key in index.keys], name=index.name, unique=True)
        except OperationFailure as failure:
            raise RuntimeError(f"Could not build unique index '{index.collection}.{index.name}' ({index.rule}): {failure}") from failure

    return ConstraintSummary(validators=len(COLLECTION_VALIDATORS), indexes=len(UNIQUE_INDEXES))


@dataclass(frozen=True)
class ViolationReport:
    """One collection's answer to "how many documents would the validator refuse?"."""

    collection: str
    total: int
    failing: int
    examples: list[Any]


@dataclass(frozen=True)
class DuplicateReport:
    """One index's answer to "how many key groups would stop this from building?"."""

    index: UniqueIndex
    groups: int
    examples: list[Any]


@dataclass(frozen=True)
class RelationReport:
    """One cross-document rule's answer to "how many stored groups of documents break it?"."""

    rule: str
    groups: int
    examples: list[Any]


async def report_violations(db: AsyncIOMotorDatabase) -> list[ViolationReport]:
    """
    Count the documents each validator would reject, writing nothing.

    `$jsonSchema` is a query operator as well as a validator, so `$nor` over the very same document is
    the rule read backwards. That makes this an exact preview rather than an approximation of one.
    """
    reports: list[ViolationReport] = []

    for collection_name, validator in COLLECTION_VALIDATORS.items():
        collection = db[collection_name]
        failing_filter = {"$nor": [validator]}

        reports.append(
            ViolationReport(
                collection=collection_name,
                total=await collection.count_documents({}),
                failing=await collection.count_documents(failing_filter),
                examples=[doc["_id"] for doc in await collection.find(failing_filter, {"_id": 1}).limit(5).to_list(length=5)],
            )
        )

    return reports


async def report_duplicates(db: AsyncIOMotorDatabase) -> list[DuplicateReport]:
    """Count the key groups that would make each unique index fail to build, writing nothing."""
    reports: list[DuplicateReport] = []

    for index in UNIQUE_INDEXES:
        offenders: list[Mapping[str, Any]] = [
            {"$group": {"_id": {key: f"${key}" for key in index.keys}, "n": {"$sum": 1}}},
            {"$match": {"n": {"$gt": 1}}},
        ]
        counted = await db[index.collection].aggregate([*offenders, {"$count": "groups"}]).to_list(length=1)
        examples = await db[index.collection].aggregate([*offenders, {"$limit": 5}]).to_list(length=5)

        reports.append(
            DuplicateReport(
                index=index,
                groups=counted[0]["groups"] if counted else 0,
                examples=[doc["_id"] for doc in examples],
            )
        )

    return reports


async def report_relations(db: AsyncIOMotorDatabase) -> list[RelationReport]:
    """
    Count the stored groups of documents each cross-document rule is broken by, writing nothing.

    **These rules are enforced by the write path and by nothing in the database** (ADR-0042), which is
    why they are reported here rather than declared above. Neither mechanism this module applies can
    express one: a `$jsonSchema` validator sees exactly one document, and a unique index reads one key
    per document, while the team a fixture fields sits in EITHER of two embedded fields -- so a club in
    `team1` of one match and in `team2` of another is a collision no index can be built to refuse.

    Reported all the same, because the question they answer is the one `--check` exists for: whether
    the stored data already satisfies a rule that is about to start being enforced. A rule enforced at
    the write path leaves whatever predates it in place, and nothing else would ever name it.
    """

    # A team plays at most one match per Spieltag. Both sides are unwound into one stream first, so a
    # club fielded in `team1` of one fixture and `team2` of another is one group of two -- the shape a
    # per-field grouping would miss.
    both_sides = [{"$ifNull": ["$team1.team_id", None]}, {"$ifNull": ["$team2.team_id", None]}]
    spieltag_occupancy: list[Mapping[str, Any]] = [
        {"$project": {"spiel_nr": 1, "spieltag_id": 1, "sides": both_sides}},
        {"$unwind": "$sides"},
        {"$match": {"sides": {"$ne": None}}},
        {"$group": {"_id": {"spieltag_id": "$spieltag_id", "team_id": "$sides"}, "n": {"$sum": 1}, "spiele": {"$addToSet": "$spiel_nr"}}},
        # `n`, not the size of `spiele`: a club fielded on BOTH sides of one fixture is the same
        # violation of the same rule, and it collapses to a single `spiel_nr`.
        {"$match": {"n": {"$gt": 1}}},
    ]

    counted = await db["spiele"].aggregate([*spieltag_occupancy, {"$count": "groups"}]).to_list(length=1)
    examples = await db["spiele"].aggregate([*spieltag_occupancy, {"$limit": 5}]).to_list(length=5)

    return [
        RelationReport(
            rule="a team is fielded at most once per Spieltag (spiele)",
            groups=counted[0]["groups"] if counted else 0,
            examples=[{**doc["_id"], "spiele": sorted(doc["spiele"])} for doc in examples],
        )
    ]


async def probe_collmod_privilege(db: AsyncIOMotorDatabase) -> str:
    """
    Answer whether this connection may run `collMod`, without writing anything at all.

    It asks `collMod` to hide an index that does not exist, against a collection that does. MongoDB
    authorises a command before resolving its arguments, so the reply separates the two answers
    cleanly: an authorization message means the user lacks the action, and `IndexNotFound` means it
    holds the action and got as far as looking. Neither outcome changes a byte, which is what makes
    `--check` safe to point at production without a second thought.

    **It aims at a REAL collection on purpose.** An earlier version used a made-up namespace, which is
    tidier and answers a different question: privileges are granted per namespace, so a grant that
    covers `fl_main.spiele` need not cover an invented name -- and on Atlas a `__`-prefixed one is
    reserved and reaches no custom role at all. The probe has to ask about the namespaces
    `apply_constraints` will actually touch, or a correctly-configured user is told they are denied.

    **It does not ask which collections exist**, though that would let it pick a target it knows is
    there. `listCollections` is one more privilege a diagnostic would then require in order to report
    on privileges, and the failure mode is circular: the tool cannot say what is wrong because it is
    not allowed to look. Both replies are handled instead, so an absent target answers as well as a
    present one.

    Indirect answers exist -- `connectionStatus` lists the authenticated roles -- and they require
    knowing which built-in role carries which action, which is precisely the thing that is easy to get
    wrong. Running the command is not an inference.
    """
    # The first collection this module manages, named rather than discovered. Every one of them gets a
    # validator, so any of them is a namespace `apply_constraints` will collMod.
    target = next(iter(COLLECTION_VALIDATORS), ABSENT_COLLECTION_NAME)

    try:
        await db.command({"collMod": target, "index": {"name": ABSENT_INDEX_NAME, "hidden": True}})
    except OperationFailure as failure:
        if failure.code in (INDEX_NOT_FOUND, NAMESPACE_NOT_FOUND):
            return "granted"
        if classify_failure(failure) == "authorization":
            return f"DENIED -- {failure_message(failure)}"
        # Anything else is a different problem wearing the same exception -- a rejected credential
        # above all. Reporting that as "denied" would send the reader to the Atlas role editor to fix
        # a password.
        raise

    # Reached only if an index by that name existed and has just been hidden, which would make the
    # probe a mutation. Loud rather than silent, because the fix is to rename the constant.
    raise RuntimeError(f"'{target}' unexpectedly has an index named '{ABSENT_INDEX_NAME}'; the collMod probe must not modify anything.")


async def report_identity(db: AsyncIOMotorDatabase) -> tuple[str, list[str]]:
    """
    Who the SERVER thinks this connection is, and which roles it actually carries.

    Deliberately not how the privilege probes work: asking `connectionStatus` which roles you hold and
    inferring what you may do requires knowing which role carries which action, which is the inference
    those probes exist to avoid. This answers a different question -- whether the role you attached in
    a dashboard reached the credential your application authenticates with -- and for that it is the
    only direct instrument there is. A correct role on the wrong user looks identical to a broken role
    from every other angle.

    Requires no privileges of its own, which is what makes it usable exactly when nothing else is.
    """
    info = (await db.command("connectionStatus")).get("authInfo", {})

    users = ", ".join(user.get("user", "?") for user in info.get("authenticatedUsers", []))
    roles = [f"{role.get('role')}@{role.get('db')}" for role in info.get("authenticatedUserRoles", [])]

    return users or "(not authenticated)", roles


async def probe_read_privilege(db: AsyncIOMotorDatabase) -> str:
    """Whether this connection may `find`, asked with a count over a collection this module manages."""
    try:
        await db[next(iter(COLLECTION_VALIDATORS), ABSENT_COLLECTION_NAME)].count_documents({})
    except OperationFailure as failure:
        if classify_failure(failure) == "authorization":
            return f"DENIED -- {failure_message(failure)}"
        raise

    return "granted"


async def probe_privileges(db: AsyncIOMotorDatabase) -> list[tuple[str, str]]:
    """
    Every privilege this module needs, each asked INDEPENDENTLY, so one report names all the gaps.

    Written after three separate round trips each revealed one missing action, because the check
    aborted on the first refusal and the next one only became visible once that was fixed. A report
    that stops at the first problem turns an afternoon of Atlas configuration into a conversation.
    """
    return [("find", await probe_read_privilege(db)), ("collMod", await probe_collmod_privilege(db))]


def failure_message(failure: OperationFailure) -> str:
    """The server's own `errmsg`, which carries the detail the exception's `str` flattens away."""
    return failure.details.get("errmsg", str(failure)) if failure.details else str(failure)


def classify_failure(failure: OperationFailure) -> str:
    """
    `"authentication"`, `"authorization"` or `"other"` -- read from the MESSAGE, not the code.

    On a self-managed mongod the codes are enough (18 and 13). On Atlas they are not: both refusals
    arrive as `AtlasError` 8000, so a code-only rule reports a missing `collMod` grant as a rejected
    password. That is not hypothetical -- it happened on 2026-08-02, and the message was the only
    thing in the reply that distinguished them.
    """
    message = failure_message(failure).lower()

    # Checked before authentication, because "not authorized" contains neither phrase below but an
    # Atlas authorization message can mention the word "auth" in the namespace it names.
    if failure.code == UNAUTHORIZED or any(phrase in message for phrase in AUTHORIZATION_PHRASES):
        return "authorization"

    if failure.code == AUTHENTICATION_FAILED or any(phrase in message for phrase in AUTHENTICATION_PHRASES):
        return "authentication"

    return "other"


def diagnose_failure(failure: OperationFailure) -> str:
    """
    Turn a driver exception into the sentence an operator can act on.

    A tool whose whole job is reporting what is wrong with database access must not answer with a
    stack trace, and the two failures below look identical in one until the last line: a rejected
    credential and a missing privilege are different problems with different fixes, and the traceback
    puts sixty lines between the reader and the distinction.

    Never quotes the connection string. It names the FILE and the VARIABLE, because the value is a
    secret and a diagnostic that prints one is a diagnostic nobody can paste into a bug report.
    """
    message = failure_message(failure)
    kind = classify_failure(failure)

    if kind == "authentication":
        return (
            "  The database REJECTED THE CREDENTIALS. This is not a permissions problem, and no role\n"
            "  change will fix it.\n\n"
            "  MONGODB_URI in fl_backend/.env carries a username and password the cluster does not\n"
            "  accept. Deleting and recreating a database user changes its password even when the name\n"
            "  is unchanged, so a URI that worked yesterday can stop working with no visible edit.\n\n"
            "  The server's own copy of that file is SEPARATE and was not touched by anything you did\n"
            "  here -- fix both, or the next deploy fails the same way with the site down.\n\n"
            f"  Server said: {message}"
        )

    if kind == "authorization":
        return (
            "  The credentials are ACCEPTED and this user is NOT ALLOWED to do this. Nothing about\n"
            "  the connection string is wrong.\n\n"
            "  Check the roles on the database user in Atlas. `collMod` is a dbAdmin action that\n"
            "  readWrite does not carry, and it must be granted across the WHOLE database rather than\n"
            "  one named collection -- every collection here gets a validator, including ones that do\n"
            "  not exist yet. Everything else needs readWrite on this database.\n\n"
            f"  Server said: {message}"
        )

    # `codeName` off the server's own reply, not a driver attribute: pymongo exposes one only on some
    # exception classes, and the numeric code is always there as the fallback.
    named = failure.details.get("codeName", failure.code) if failure.details else failure.code
    return f"  The database refused the command ({named}): {message}"


# The CLI below writes to stdout, which the service itself never does (`app/core/logging.py`):
# one-document-per-line is a property of the RUNNING SERVICE's stream, and this is an operator tool
# that never runs inside a request.
async def _run(check: bool) -> int:
    # Imported here, not at module scope: app.core.config builds the settings object on import and
    # refuses without a complete environment, while the tests import this module with no .env at all.
    from app.core.config import get_config

    client = AsyncIOMotorClient(
        host=get_config().mongodb_uri.get_secret_value(),
        serverSelectionTimeoutMS=get_config().db_server_selection_timeout,
    )
    database = client[get_config().db_base_name]

    try:
        if not check:
            summary = await apply_constraints(database)
            print(f"Applied {summary.validators} validators and {summary.indexes} unique indexes to '{get_config().db_base_name}'.")
            return 0

        print(f"Database '{get_config().db_base_name}', checked against {len(COLLECTION_VALIDATORS)} validators. Nothing is written.\n")

        # Printed before the privileges: a correct role attached to the wrong user produces exactly the
        # refusals a broken role does, and only this line separates them. The username is not a secret,
        # and its password is never read or printed.
        identity, roles = await report_identity(database)
        print(f"  Authenticated as: {identity}")
        print(f"  Roles the server sees: {', '.join(roles) or '(none)'}\n")

        print("  Privileges — every action this module needs, asked separately")
        privileges = await probe_privileges(database)
        for action, verdict in privileges:
            print(f"    {'ok  ' if verdict == 'granted' else 'FAIL'}  {action:<10} {verdict}")

        # Everything below reads documents, so there is nothing to report and no point producing a
        # second failure that says the same thing as the row above.
        if any(verdict != "granted" for action, verdict in privileges if action == "find"):
            print("\n  Cannot read the collections, so no validator or index check was run.")
            print("  Fix the privilege above and run this again.\n")
            return 2

        blocking = 0

        print("  Validators — documents the rule would reject")
        for report in await report_violations(database):
            marker = "ok " if report.failing == 0 else "FAIL"
            print(f"    {marker}  {report.collection:<16} {report.failing:>4} of {report.total:>4}")
            if report.failing:
                blocking += report.failing
                print(f"          first offenders: {report.examples}")

        print("\n  Unique indexes — key groups that would stop the build")
        for duplicate in await report_duplicates(database):
            marker = "ok " if duplicate.groups == 0 else "FAIL"
            print(f"    {marker}  {duplicate.index.collection}.{duplicate.index.name:<28} {duplicate.groups:>4}  ({duplicate.index.rule})")
            if duplicate.groups:
                blocking += duplicate.groups
                print(f"          first offenders: {duplicate.examples}")

        # Counted into `blocking` like the rest: the write path enforces this rule rather than the
        # database (ADR-0042), so an offender blocks no validator or index -- but it does block turning
        # the enforcement on, which is what this command informs.
        print("\n  Cross-document rules — relations no validator and no index can express")
        for relation in await report_relations(database):
            marker = "ok " if relation.groups == 0 else "FAIL"
            print(f"    {marker}  {relation.rule:<46} {relation.groups:>4}")
            if relation.groups:
                blocking += relation.groups
                print(f"          first offenders: {relation.examples}")

        print("\n  Clean — safe to apply.\n" if blocking == 0 else "\n  NOT clean. Correct the data above before applying.\n")
        return 0 if blocking == 0 else 1

    except OperationFailure as failure:
        # Deliberately not re-raised. The traceback would be sixty frames of driver internals ending in
        # the one line that matters, and this tool exists to hand an operator that line.
        print(f"\n{diagnose_failure(failure)}\n")
        return 2

    finally:
        client.close()


def _main() -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.core.constraints",
        description="Report or apply the database constraints declared in this module (ADR-0020).",
    )
    parser.add_argument("--check", action="store_true", help="report violations and the collMod privilege; writes nothing")
    parser.add_argument("--apply", action="store_true", help="apply every validator and unique index, exactly as startup does")
    arguments = parser.parse_args()

    if arguments.check == arguments.apply:
        parser.error("pass exactly one of --check or --apply")

    return asyncio.run(_run(check=arguments.check))


if __name__ == "__main__":
    raise SystemExit(_main())
