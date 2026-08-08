"""
CORE · database constraints

The nine `$jsonSchema` validators and the four unique indexes the database enforces on itself, plus the
routine that applies them on every boot (ADR-0027). Declared here rather than clicked into the Atlas
console, so they are versioned, reviewable in a diff, and restored with the cluster.

`--check` additionally reports the CROSS-DOCUMENT rules the write path enforces and the database
cannot (`report_relations`). They are reported and never applied: the two mechanisms above each see
one document, and the rules there are relations between several.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • The validators assert BSON TYPES, REQUIRED FIELDS and the enumerations that are already `Literal`s
    in the Pydantic models -- and nothing else. No ranges, no patterns, no lengths, no cross-field
    rules: those stay Pydantic's. The line is drawn there because those three are the constraints whose
    violation is SILENT; a bad range or a bad length fails Pydantic loudly on the very next read.
    `test_no_validator_constrains_a_range_or_a_format` enforces the boundary, so widening it fails the
    default test tier rather than passing review as an improvement.
  • They are HAND-WRITTEN and must not be generated from the models (ADR-0031). A model changed without
    its validator is caught by `test_every_mirrored_model_matches_its_validator`, not by memory.
  • `additionalProperties` is never `false`. Forbidding unknown keys would turn every future field
    addition into a deploy-ordering problem between this file and the writer of that field, and
    Pydantic ignores extra keys on read for the same reason.
  • Applying is IDEMPOTENT. `collMod` overwrites the validator with the one declared here, so this file
    is the source of truth rather than whatever the cluster happens to hold.
  • Nothing is ever REMOVED. An index this module stops declaring stays until it is dropped by hand,
    because dropping one automatically would let a bad merge silently switch off a uniqueness rule.
  • Startup FAILS LOUDLY if any of it cannot be applied. A skipped validator is a database that
    quietly stopped enforcing what this repository claims it enforces, which is worse than no
    validator at all.
  • A `unique` index cannot be built over data that already violates it. `--check` reports both kinds
    of violation without writing anything, and is what to run BEFORE deploying a change to this file.

 THE DATABASE USER NEEDS `collMod` ────────────────────────────────────────────────────────────────────────

  A `dbAdmin` action that `readWrite` does not carry, though both carry `createIndex` -- so the wrong
  user builds every index here and attaches no validator, and the application then refuses to start.
  `--check` reports it. Which users hold what: docs/ops/overview.md.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/_decisions/0027-the-database-enforces-its-own-invariants.md -- the decision and what it rejected
  docs/_decisions/0031-the-third-copy-of-the-schema-is-checked-not-generated.md -- why this is by hand
  docs/backend/spec.md -- invariants I15-I17
  docs/workflows/README.md -- when to run --check, and how a data change is ordered against a deploy
"""

import argparse
import asyncio
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING
from pymongo.errors import OperationFailure

from app.core.collections import Collection

# `collMod` against a collection that does not exist. Handled rather than re-raised in two places, for
# two different reasons: a fresh database has no collections and creating them with the validator
# already attached reaches the same end state, and the privilege probe below uses this code as its
# "yes".
NAMESPACE_NOT_FOUND = 26

# "You are authenticated and may not do this", and "we do not know who you are", as mongod spells them.
UNAUTHORIZED = 13
AUTHENTICATION_FAILED = 18

# Atlas does NOT use those codes. It funnels refusals of both kinds through one generic `AtlasError`,
# code 8000 -- measured on 2026-08-02, where a rejected password and a missing `collMod` grant came back
# with the identical code and completely different messages. So the message is the only discriminator
# that works on both a self-managed mongod and Atlas, and matching on the code alone reports a missing
# privilege as a bad password and sends the reader to fix the wrong thing.
AUTHENTICATION_PHRASES = ("authentication failed", "bad auth")
AUTHORIZATION_PHRASES = ("not allowed to do action", "not authorized on")

# "This index is not there", which is how the privilege probe below learns it got past authorization.
INDEX_NOT_FOUND = 27

# The probe's fallback namespace, for a database with none of the nine collections yet. Deliberately
# NOT `__`-prefixed: Atlas reserves that prefix, and a custom role granting collMod over "all
# collections" does not reach a reserved name -- so a `__` target reports DENIED to a user who holds
# the grant, which is the one answer this probe must never give.
ABSENT_COLLECTION_NAME = "fl_constraints_probe"

# An index name chosen to be absent. `collMod` is authorised before its arguments are resolved, so
# asking to hide an index that does not exist reaches the authorization check and then stops -- the
# probe's whole trick, and the reason `--check` writes nothing.
ABSENT_INDEX_NAME = "fl_constraints_probe_index"

_STRING_OR_NULL = ["string", "null"]
_INT_OR_NULL = ["int", "null"]

# Soft deletion, on the six collections that have one. A `YYYY-MM-DD` string naming the day the row was
# retired, or null while it is live -- one field rather than a boolean beside a date, because the pair
# can contradict itself and no validator here could catch that (ADR-0032). The DATE is what makes a
# scheduled purge possible; the boolean alone could only say "eventually" (open item BE-12).
_INACTIVE_SINCE = {"bsonType": _STRING_OR_NULL}

# The enumerations that are already closed sets in Python. Spelled out rather than derived from the
# `Literal`s: importing the models here would make this module depend on every API slice, and the
# values are stored strings whose spelling is the contract.
#
# What keeps each copy in step is `test_every_validator_enum_matches_its_literal`, which imports both
# sides and compares them member by member -- the field-name drift check two doors down does NOT reach
# enum values, so a renamed member would otherwise be caught by nothing until a live write was refused.
_SAISON_PHASEN = ["gruppenphase", "achtelfinale", "viertelfinale", "halbfinale", "finale"]
_SAISON_STATUS = ["past", "active", "future"]
_GRUPPEN = ["A", "B", "C", "D"]
# The two ways a bracket slot is fed, and the two outcomes a match-fed one can name.
_QUELLE_TYPES = ["gruppe", "spiel"]
_QUELLE_AUSGAENGE = ["sieger", "verlierer"]
# A squad row's position and school level (ADR-0061). Both are NULLABLE -- a squad is filled in over
# time and an unanswered field is null rather than a placeholder string -- so `None` is a member of
# each list, which is what lets the `enum` keyword stand beside a nullable `bsonType`.
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
    # Null for every team still competing, which is all sixteen of them. The absence of the record is
    # what "not disqualified" means -- there is no boolean beside it, here or on the model, because the
    # two could disagree and nothing available could refuse that (ADR-0059, and ADR-0032 before it).
    nullable=True,
    # Both keys, because a record missing either is not half a disqualification -- it is one that cannot
    # be rendered. `grund` carries `min_length=1` in `FLDisqualifikation` and no length is repeated
    # here: an empty reason is a wrong value rather than a structurally broken document, which is the
    # line ADR-0027 draws and `test_no_validator_constrains_a_range_or_a_format` enforces.
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
    # it -- which is the only manual-override mechanism there is (ADR-0042).
    nullable=True,
    # `type` alone, because the other four keys belong to one variant each and `$jsonSchema` cannot make
    # a field required only when a sibling holds a particular value. That conditional rule is Pydantic's
    # discriminated union, and this validator deliberately stops at the boundary ADR-0027 draws: BSON
    # types, presence and enums. What it still catches is the failure that would be silent -- a `platz`
    # stored as the string "2", or a `type` nobody in the code has heard of.
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
    # Null on every fixture that did not finish level, which is almost all of them (ADR-0044).
    nullable=True,
    # Both counts required, and both typed -- unlike `_SPIEL_QUELLE` above, which can only require its
    # discriminator. There are no variants here, so this validator covers the whole object: a shoot-out
    # stored as the string "4" is refused by the database rather than surfacing as a failed read.
    #
    # What it deliberately does NOT say is that the two must differ. That is a cross-field rule, which
    # `$jsonSchema` cannot express and ADR-0027 keeps out of these validators; it lives on
    # `FLSpielElfmeterschiessen` instead, where a level shoot-out fails loudly on the next read.
    required=("team1", "team2"),
    properties={
        "team1": {"bsonType": "int"},
        "team2": {"bsonType": "int"},
    },
)

_SPIEL_TEAM_FIELD = _object(
    # Nullable: a playoff slot the group phase has not filled yet has no occupant, and the fixture says
    # so rather than pointing at a stand-in team (ADR-0042). Where that occupant will come from is
    # `teamN_quelle` on the match, which is a sibling of this field and never a key inside it.
    nullable=True,
    required=("team_id", "name", "tore", "shorthand"),
    properties={
        "team_id": {"bsonType": "objectId"},
        # A display copy of `teams.name`, which `PATCH /teams/{team_id}` fans out into (ADR-0028, rule 3).
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
        # The one line here that catches a defect already in the data rather than a hypothetical one.
        # The same rent is stored as an int by the admin form and as a double when typed in by hand;
        # every double value is integral, so Pydantic accepts them all and nothing has ever looked
        # wrong. "int" refuses the next one.
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
                # FLSaison.id is exactly four characters, and this deliberately does not say so.
                # ADR-0027 scopes these validators to types, presence and enums -- and a five-character
                # id fails FLSaison on the next read of the current season, which is loud and immediate.
                # The defects a validator is here for are the ones nothing announces.
                "_id": {"bsonType": "string"},
                "start_date": {"bsonType": "string"},
                "end_date": {"bsonType": "string"},
                "status": {"bsonType": "string", "enum": _SAISON_STATUS},
                # Exactly one season is `active`, and no validator can express that. `PATCH
                # /admin/activate_saison` is the only path to the value and enforces it in one
                # transaction (ADR-0033); nothing else may write `status` at all.
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
                        # How many teams per group reach the knockout round (ADR-0043). Required
                        # here as well as in `FLSaisonRules`, because a season missing it seeds no
                        # bracket and marks no qualifying place -- and `--check` is what reports
                        # which documents still lack it before the value can be relied on.
                        "qualifiers_per_group": {"bsonType": "int"},
                        # The season's capacity, read by the junction write's refusals
                        # (REQ-ENTER-001..003). Required for the same reason as the line above, and
                        # `--check` again reports the documents still lacking the keys.
                        "number_of_groups": {"bsonType": "int"},
                        "teams_per_group": {"bsonType": "int"},
                        # Which school levels this season's squads may hold -- a subset of the
                        # league's own set, which `saison_spieler.stufe` is held to (ADR-0061). The
                        # ITEMS are enumerated, so a season cannot offer a level the league lacks;
                        # `minItems` is `FLSaisonRules`'s, because a length is a range and ADR-0027
                        # leaves ranges to Pydantic.
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
            # derived from `spiele` on every read and stored nowhere (ADR-0026).
            required=("_id", "name", "shorthand", "description", "full_name", "website_url", "address", "inactive_since"),
            properties={
                "_id": {"bsonType": "objectId"},
                "name": {"bsonType": "string"},
                "shorthand": {"bsonType": "string"},
                "description": {"bsonType": "string"},
                "full_name": {"bsonType": "string"},
                "website_url": {"bsonType": "string"},
                "address": _ADDRESS,
                # A retired club, not a club out of one season -- that is `saison_teams`, and it has no
                # equivalent because a team never leaves a season except by disqualification (ADR-0033).
                # `uniq_shorthand` keeps indexing a retired club, so its two letters stay reserved.
                "inactive_since": _INACTIVE_SINCE,
            },
        )
    },
    Collection.SAISON_TEAMS: {
        "$jsonSchema": _object(
            # Transcribed from the documents, not from a model: this junction is the one collection
            # with no Pydantic model of the ROW. The four fields are what the team pipeline reads, and
            # no row here carries `statistik`: the seven figures are derived from the matches on every
            # read and stored nowhere (ADR-0026). One sub-document is an exception and is transcribed
            # from a model like every other collection here -- `_DISQUALIFIKATION` mirrors
            # `FLDisqualifikation`, and the drift check covers it through `FLTeam`, which embeds it.
            #
            # There is no `inactive_since` either, and that is the deliberate part. Once a season's
            # squads are settled a team never leaves it; the only way out is disqualification, which is
            # the field below (ADR-0033). So no row here is ever retired, `uniq_saison_id_team_id` is
            # never held by a dead one, and a create here can never collide with a row an admin cannot
            # see -- which is the case `saison_spieler` has to offer a reactivate endpoint for.
            required=("_id", "saison_id", "team_id", "gruppe", "disqualifikation"),
            properties={
                "_id": {"bsonType": "objectId"},
                "saison_id": {"bsonType": "string"},
                "team_id": {"bsonType": "objectId"},
                "gruppe": {"bsonType": "string", "enum": _GRUPPEN},
                # The reason a team is out of this season and the day it took effect, or null while it
                # competes (ADR-0059). Required, so a row that has never carried the key is rejected --
                # which is why the runbook in that ADR seeds it BEFORE the deploy that attaches this.
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
                # The field that motivated ADR-0027. Two rows hold the team's `full_name` as a string
                # instead of this reference: unique, well-formed, and wrong.
                "team_id": {"bsonType": "objectId"},
                "is_nachgetragen": {"bsonType": "bool"},
                # The squad's captain for this season. On the JUNCTION rather than the person: it is a
                # role within one team for one season. Not unique by any rule the database can express
                # -- a co-captaincy is a real arrangement, and no validator sees two documents (I16).
                "is_captain": {"bsonType": "bool"},
                # Closed sets, both nullable while a squad entry is still being filled in (ADR-0061).
                # This validator is what makes the sets true of the DATA rather than only of the write
                # path: squads are also hand-edited in MongoDB, where no Pydantic model runs.
                "stufe": {"bsonType": _STRING_OR_NULL, "enum": [*_STUFEN, None]},
                "position": {"bsonType": _STRING_OR_NULL, "enum": [*_POSITIONEN, None]},
                # A STRING, not an int. Squad numbers are worn, not counted.
                "nummer": {"bsonType": _STRING_OR_NULL},
                # This row is retired, and `uniq_spieler_id_saison_id` keeps indexing it -- so a second
                # create for the same player and season is a DUPLICATE KEY, answered 409. Creating
                # never revives (ADR-0032): `POST .../saisons/{saison_id}/reactivate` is the way back,
                # and it preserves the number, position and stufe the retired row still carries.
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
                # Where each side comes from, or null for a fixture whose sides were never drawn from
                # anywhere -- every group-phase match, and every slot an admin has taken manual charge
                # of. Nothing here pairs it with the team field beside it: all four combinations are
                # legitimate (ADR-0042), and a cross-field rule is outside what these validators may
                # assert anyway (ADR-0027).
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
                # than a third number inside `ergebnis` (ADR-0044). Required as a KEY on every match,
                # like the two `quelle` fields: null is the answer for all of them but a handful.
                "elfmeterschiessen": _SPIEL_ELFMETERSCHIESSEN,
                "spieltag_id": {"bsonType": "objectId"},
                "spiel_nr": {"bsonType": "int"},
                "is_canceled": {"bsonType": "bool"},
                "saison_phase": {"bsonType": "string", "enum": _SAISON_PHASEN},
                "saison_id": {"bsonType": "string"},
                # An optional free-text note. A property but NOT a required key, unlike
                # `elfmeterschiessen`: a missing key and a stored null both mean "no note", nothing
                # consumes the difference, and requiring the key would put a backfill of every live
                # document behind a field that is decoration. `FLSpiel.notiz` defaults for the same
                # reason.
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
                # NEITHER a position NOR a match count is stored here, and both absences are decisions.
                # The position is `saison_phase` in bracket order, then `beginn`, then `_id` (ADR-0064);
                # the match count follows from the season's `rules` and this matchday's phase, because a
                # single round robin per group determines it exactly (ADR-0065). `FLSpieltag` serves
                # `anzahl_spiele` as a derived field, which is why `MIRRORED_MODELS` lists it as
                # not-stored -- the same shape `statistik` has on a team.
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
# maintenance cost (ADR-0027).
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
    there is no partial-success path, because a database enforcing eight of nine validators looks
    exactly like one enforcing all nine.
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

    **These rules are enforced by the write path and by nothing in the database** (ADR-0052), which is
    why they are reported here rather than declared above. Neither mechanism this module applies can
    express one: a `$jsonSchema` validator sees exactly one document, and a unique index reads one key
    per document, while the team a fixture fields sits in EITHER of two embedded fields -- so a club in
    `team1` of one match and in `team2` of another is a collision no index can be built to refuse.

    Reported all the same, because the question they answer is the one `--check` exists for: whether
    the stored data already satisfies a rule that is about to start being enforced. A rule enforced at
    the write path leaves whatever predates it in place, and nothing else would ever name it.
    """

    # A team plays at most one match per Spieltag. Both sides are unwound into one stream first, so a
    # club fielded in `team1` of Spiel 12 and in `team2` of Spiel 13 of the same Spieltag is one group
    # of two -- the shape the collision actually takes, and the one a per-field grouping would miss.
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


# The CLI below writes to stdout, which the service itself never does (see core/logging.py). The
# one-document-per-line contract is a property of the RUNNING SERVICE's log stream; this is an operator
# tool that produces a report for a person and never runs inside a request.
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

        # Printed before the privileges, because a correct role attached to the wrong user produces
        # exactly the same refusals as a role that does not work -- and only this line separates them.
        # The username is not a secret; the password it pairs with is never read, printed or logged.
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

        # Counted into `blocking` exactly as the two above are: the rule is enforced by the write path
        # rather than by the database (ADR-0052), so an offender does not stop a validator or an index
        # from being applied -- but it does stop the enforcement from being turned on, which is the
        # decision this command is run to inform.
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
        description="Report or apply the database constraints declared in this module (ADR-0027).",
    )
    parser.add_argument("--check", action="store_true", help="report violations and the collMod privilege; writes nothing")
    parser.add_argument("--apply", action="store_true", help="apply every validator and unique index, exactly as startup does")
    arguments = parser.parse_args()

    if arguments.check == arguments.apply:
        parser.error("pass exactly one of --check or --apply")

    return asyncio.run(_run(check=arguments.check))


if __name__ == "__main__":
    raise SystemExit(_main())
