import argparse
import asyncio
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import OperationFailure

from app.core.collections import Collection

# Handled rather than re-raised: creating the collection with the validator attached reaches the
# same end state.
NAMESPACE_NOT_FOUND = 26

UNAUTHORIZED = 13
AUTHENTICATION_FAILED = 18

# Atlas funnels both kinds through one generic `AtlasError`, code 8000, so the MESSAGE is the only
# discriminator working on Atlas and a self-managed mongod alike: the code alone reports a missing
# privilege as a bad password.
AUTHENTICATION_PHRASES = ("authentication failed", "bad auth")
AUTHORIZATION_PHRASES = ("not allowed to do action", "not authorized on")

INDEX_NOT_FOUND = 27

# NOT `__`-prefixed: Atlas reserves that prefix and a collMod grant over "all collections" misses
# it, so a `__` target reports DENIED to a user who holds the grant.
ABSENT_COLLECTION_NAME = "fl_constraints_probe"

# `collMod` is authorised before its arguments resolve, so asking to hide a MISSING index reaches
# the authorization check and stops -- which is why `--check` writes nothing.
ABSENT_INDEX_NAME = "fl_constraints_probe_index"

_STRING_OR_NULL = ["string", "null"]
_INT_OR_NULL = ["int", "null"]

_INACTIVE_SINCE = {"bsonType": _STRING_OR_NULL}

# Spelled out, not derived from the `Literal`s: this module would then depend on every API slice.
_SAISON_PHASEN = ["gruppenphase", "achtelfinale", "viertelfinale", "halbfinale", "finale"]
_SAISON_STATUS = ["past", "active", "future"]
_SONDEREREIGNISSE = ["ausgefallen", "nichtantreten_team1", "nichtantreten_team2", "abgebrochen", "annulliert"]
_TIEBREAK_ORDER = ["tordifferenz", "direkter_vergleich"]
_AUSTRITT_ARTEN = ["disqualifikation", "rueckzug"]
_EINWILLIGUNG_UMFANG = ["kader_oeffentlich", "intern"]
_EINWILLIGUNG_QUELLEN = ["erziehungsberechtigt", "volljaehrig", "bestandsuebernahme"]
_GRUPPEN = ["A", "B", "C", "D"]
_QUELLE_TYPES = ["gruppe", "spiel"]
_QUELLE_AUSGAENGE = ["sieger", "verlierer"]
_POSITIONEN = ["Tor", "Abwehr", "Mittelfeld", "Angriff"]
_STUFEN = ["E1", "E2", "Q1", "Q2", "Q3", "Q4"]
_SPIELER_ROLLEN = ["kapitaen", "co_kapitaen"]
_SCHULFORMEN = ["gymnasium_g8", "gymnasium_g9", "gesamtschule", "privatschule_g8", "privatschule_g9", "oberstufengymnasium"]
_TRIKOT_FARBEN = [
    "weiss",
    "schwarz",
    "rot",
    "braun",
    "orange",
    "gelb",
    "hellgruen",
    "gruen",
    "tuerkis",
    "hellblau",
    "blau",
    "dunkelblau",
    "violett",
    "magenta",
    "bordeaux",
    "grau",
]
_KONTAKT_EINWILLIGUNG_UMFANG = ["kontaktdaten"]
_KONTAKT_EINWILLIGUNG_QUELLEN = ["person", "administrativ"]
_BEWERBUNG_STATUS = ["eingereicht", "angenommen", "abgelehnt"]

# Derived, not spelled: these ARE the collection names, and the log never records itself.
_LOGGED_COLLECTIONS = [str(name) for name in Collection if name is not Collection.AKTIONEN]

# Mirrors `app/core/recording.py :: Operation` and `:: Actor.kind`, hand-copied.
# `tests/core/test_constraints.py` pins each against the recording literal too, so a member added to
# one alone fails rather than reaching a stored row.
_AKTION_OPERATIONS = ["insert", "insert_many", "patch_one", "patch_many", "delete_many", "erase_many"]
_AKTOR_KINDS = ["admin_session", "system", "public"]


def _object(*, required: Sequence[str], properties: Mapping[str, Any], nullable: bool = False) -> Mapping[str, Any]:
    """One object sub-schema.

    `nullable` widens `bsonType` rather than wrapping in an `anyOf`, which works because MongoDB
    applies `required` only to values that actually are objects.
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

_AKTOR = _object(
    required=("kind", "email"),
    properties={
        "kind": {"bsonType": "string", "enum": _AKTOR_KINDS},
        "email": {"bsonType": "string"},
    },
)

_AKTION_REQUEST = _object(
    required=("method", "path"),
    properties={"method": {"bsonType": "string"}, "path": {"bsonType": "string"}},
    nullable=True,
)

# Required TOGETHER: the four keys are always present, and a null `bestaetigt_am` is what says
# the consent is UNCONFIRMED rather than absent.
_EINWILLIGUNG = _object(
    required=("umfang", "erteilt_von", "datum", "bestaetigt_am"),
    properties={
        "umfang": {"bsonType": "string", "enum": _EINWILLIGUNG_UMFANG},
        "erteilt_von": {"bsonType": "string", "enum": _EINWILLIGUNG_QUELLEN},
        "datum": {"bsonType": _STRING_OR_NULL},
        "bestaetigt_am": {"bsonType": _STRING_OR_NULL},
    },
)

# A CONTACT person's consent, and never `_EINWILLIGUNG` above: that one records what may be
# published about a pupil, and one shared sub-schema would let either enum widen the other.
_KONTAKT_EINWILLIGUNG = _object(
    required=("umfang", "erteilt_von", "text_version", "datum"),
    properties={
        "umfang": {"bsonType": "string", "enum": _KONTAKT_EINWILLIGUNG_UMFANG},
        "erteilt_von": {"bsonType": "string", "enum": _KONTAKT_EINWILLIGUNG_QUELLEN},
        "text_version": {"bsonType": "string"},
        "datum": {"bsonType": "string"},
    },
)

# Required TOGETHER, as `_EINWILLIGUNG` is: a person the league cannot reach is not a contact, and a
# set of details carrying no consent is one nobody agreed to be held.
_KONTAKTPERSON = _object(
    required=("vorname", "nachname", "email", "telefon", "geburtsdatum", "einwilligung"),
    properties={
        "vorname": {"bsonType": "string"},
        "nachname": {"bsonType": "string"},
        "email": {"bsonType": "string"},
        "telefon": {"bsonType": "string"},
        "geburtsdatum": {"bsonType": "string"},
        "einwilligung": _KONTAKT_EINWILLIGUNG,
    },
)

# Nullable per SLOT: an erasure empties the slots naming one person and must not reach the two
# beside them.
_KONTAKTPERSON_OR_NULL = {**_KONTAKTPERSON, "bsonType": ["object", "null"]}

# Which second seat the Trainer also holds. Null is nobody, and no member says BOTH -- two flags
# would spell a state nothing can mean.
_TRAINER_ZUGLEICH = ["ansprechperson", "stellvertretung"]

_KONTAKTE_REQUIRED = ("trainer", "ansprechperson", "stellvertretung", "trainer_ist_zugleich")
_KONTAKTE_PROPERTIES = {
    "trainer": _KONTAKTPERSON_OR_NULL,
    "ansprechperson": _KONTAKTPERSON_OR_NULL,
    "stellvertretung": _KONTAKTPERSON_OR_NULL,
    # Kept through an erasure: it records what somebody ASSERTED about the seats, which stays true
    # about the form even once one of them is empty.
    "trainer_ist_zugleich": {"bsonType": _STRING_OR_NULL, "enum": [*_TRAINER_ZUGLEICH, None]},
}

# The BLOCK is nullable on the junction and required on an application: a season's row is entered
# before anybody has been recorded, while an application IS the form those people filled in.
_SAISON_TEAM_KONTAKTE = _object(nullable=True, required=_KONTAKTE_REQUIRED, properties=_KONTAKTE_PROPERTIES)

_BEWERBUNG_KONTAKTE = _object(required=_KONTAKTE_REQUIRED, properties=_KONTAKTE_PROPERTIES)

# The season's application window. Nullable and out of `required` for `saisons.spielplan`'s reason:
# every stored season predates the field.
_SAISON_BEWERBUNG = _object(
    nullable=True,
    required=("offen", "von", "bis"),
    properties={
        "offen": {"bsonType": "bool"},
        "von": {"bsonType": "string"},
        "bis": {"bsonType": "string"},
    },
)

# The club this school proposes, filled in only where the applicant picked no existing one. The
# fields are spelled as `teams` spells them and acceptance copies them across; `description` is
# not among them, and acceptance writes it empty.
_BEWERBUNG_SCHULE = _object(
    nullable=True,
    required=("team_name", "full_name", "shorthand", "schulform", "address", "website_url"),
    properties={
        # `team_name`, not `name`: it becomes the club's SHORT name, beside the school's `full_name`,
        # and `name` inside a block called `schule` would read as the school's own.
        "team_name": {"bsonType": "string"},
        "full_name": {"bsonType": "string"},
        "shorthand": {"bsonType": "string"},
        "schulform": {"bsonType": _STRING_OR_NULL, "enum": [*_SCHULFORMEN, None]},
        "address": _ADDRESS,
        "website_url": {"bsonType": _STRING_OR_NULL},
    },
)

# What the school says about its kit. Never copied onto the team: `saison_teams.trikot_farbe` is the
# colour an administrator ASSIGNED, and a wish is not an assignment.
_BEWERBUNG_TRIKOT = _object(
    required=("vorhandener_satz", "wunschfarbe"),
    properties={
        "vorhandener_satz": {"bsonType": "string"},
        "wunschfarbe": {"bsonType": _STRING_OR_NULL, "enum": [*_TRIKOT_FARBEN, None]},
    },
)

# The school's own estimate of its squad, on the application alone. Nothing checks it against a
# squad afterwards -- it is what the school expected, not what it fielded.
_BEWERBUNG_KADER = _object(
    required=("voraussichtliche_groesse", "gute_spieler"),
    properties={
        "voraussichtliche_groesse": {"bsonType": "int"},
        # NOT nullable: the form asks for a count, and none of them is zero rather than absent.
        "gute_spieler": {"bsonType": "int"},
    },
)

# Null exactly while `status` is `eingereicht`, which the triage holds and no validator of types can
# state. Required TOGETHER as `_EINWILLIGUNG` is: a decision nobody is named for cannot be chased.
# `grund` is null on an acceptance.
_BEWERBUNG_ENTSCHEIDUNG = _object(
    nullable=True,
    required=("getroffen_am", "von", "grund"),
    properties={
        "getroffen_am": {"bsonType": "string"},
        "von": {"bsonType": "string"},
        "grund": {"bsonType": _STRING_OR_NULL},
    },
)

_AUSTRITT = _object(
    nullable=True,
    required=("type", "grund", "datum"),
    properties={
        "type": {"bsonType": "string", "enum": _AUSTRITT_ARTEN},
        "grund": {"bsonType": "string"},
        "datum": {"bsonType": "string"},
    },
)

_SPIEL_QUELLE = _object(
    nullable=True,
    # `type` alone: `oneOf` could require each variant's own keys, but a ratified decision holds these
    # validators to types, required fields and enums. What stays catchable here is a `platz` stored as "2".
    required=("type",),
    properties={
        "type": {"bsonType": "string", "enum": _QUELLE_TYPES},
        "gruppe": {"bsonType": "string", "enum": _GRUPPEN},
        "platz": {"bsonType": "int"},
        "spiel_nr": {"bsonType": "int"},
        "ausgang": {"bsonType": "string", "enum": _QUELLE_AUSGAENGE},
    },
)

_SPIEL_ELFMETERSCHIESSEN = _object(
    nullable=True,
    required=("team1", "team2"),
    properties={
        "team1": {"bsonType": "int"},
        "team2": {"bsonType": "int"},
    },
)

_SPIEL_TEAM_FIELD = _object(
    nullable=True,
    required=("team_id", "name", "tore", "shorthand"),
    properties={
        "team_id": {"bsonType": "objectId"},
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
        # A hand edit stores rent as a double; every stored double is integral, so Pydantic accepts
        # them all and nothing looks wrong. "int" refuses the next one.
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


# Hand-written, never generated: `model_json_schema()` types a `CustomObjectId` as a string, so a
# generated validator would admit the ObjectId-as-string documents these refuse. Types and enums
# only (`docs/backend/spec.md :: I16`).
COLLECTION_VALIDATORS: Mapping[Collection, Mapping[str, Any]] = {
    Collection.SAISONS: {
        "$jsonSchema": _object(
            required=("_id", "start_date", "end_date", "status", "rules"),
            properties={
                "_id": {"bsonType": "string"},
                "start_date": {"bsonType": "string"},
                "end_date": {"bsonType": "string"},
                "status": {"bsonType": "string", "enum": _SAISON_STATUS},
                "rules": _object(
                    required=(
                        "win_points",
                        "draw_points",
                        "qualifiers_per_group",
                        "number_of_groups",
                        "teams_per_group",
                        "tiebreak_order",
                        "max_kadergroesse",
                        "forfeit_ergebnis",
                        "erlaubte_stufen",
                    ),
                    properties={
                        "win_points": {"bsonType": "int"},
                        "draw_points": {"bsonType": "int"},
                        "qualifiers_per_group": {"bsonType": "int"},
                        "number_of_groups": {"bsonType": "int"},
                        "teams_per_group": {"bsonType": "int"},
                        "tiebreak_order": {"bsonType": "string", "enum": _TIEBREAK_ORDER},
                        "max_kadergroesse": {"bsonType": "int"},
                        "forfeit_ergebnis": _object(
                            required=("sieger_tore", "verlierer_tore"),
                            properties={"sieger_tore": {"bsonType": "int"}, "verlierer_tore": {"bsonType": "int"}},
                        ),
                        "erlaubte_stufen": {"bsonType": "array", "items": {"bsonType": "string", "enum": _STUFEN}},
                    },
                ),
                # Deliberately out of `required`: every stored season predates the field, so making
                # the key mandatory would refuse every one of them and owe a backfill. A missing key
                # and a stored null both read as never generated.
                "spielplan": _object(
                    nullable=True,
                    required=("generiert_am", "spieltage", "spiele"),
                    properties={
                        "generiert_am": {"bsonType": "string"},
                        "spieltage": {"bsonType": "int"},
                        "spiele": {"bsonType": "int"},
                    },
                ),
                # Out of `required` as `spielplan` is, and for its reason. Both halves together: a
                # switch with no span cannot say when the window closes, and a span with no switch
                # cannot be shut early.
                "bewerbung": _SAISON_BEWERBUNG,
            },
        )
    },
    Collection.TEAMS: {
        "$jsonSchema": _object(
            required=("_id", "name", "shorthand", "description", "full_name", "website_url", "address", "inactive_since"),
            properties={
                "_id": {"bsonType": "objectId"},
                "name": {"bsonType": "string"},
                "shorthand": {"bsonType": "string"},
                "description": {"bsonType": "string"},
                "full_name": {"bsonType": "string"},
                "website_url": {"bsonType": _STRING_OR_NULL},
                "address": _ADDRESS,
                # Out of `required` on purpose: no club stored before the field carries the key, so
                # demanding it would refuse every one of them until a backfill ran. A missing key
                # and a stored null both read as a school form nobody has recorded.
                "schulform": {"bsonType": _STRING_OR_NULL, "enum": [*_SCHULFORMEN, None]},
                # A retired CLUB, not a club out of one season. `uniq_shorthand` keeps indexing it,
                # so its two letters stay reserved.
                "inactive_since": _INACTIVE_SINCE,
            },
        )
    },
    Collection.SAISON_TEAMS: {
        "$jsonSchema": _object(
            # Transcribed from the documents: this junction has no Pydantic model of the ROW. A club
            # leaves by an `austritt` or by a replacement repointing the row, never by retiring it, so
            # there is no `inactive_since` here (`docs/backend/spec.md :: I19`).
            required=("_id", "saison_id", "team_id", "gruppe", "austritt", "name", "shorthand"),
            properties={
                "_id": {"bsonType": "objectId"},
                "saison_id": {"bsonType": "string"},
                "team_id": {"bsonType": "objectId"},
                "gruppe": {"bsonType": "string", "enum": _GRUPPEN},
                "austritt": _AUSTRITT,
                # Both out of `required` for `teams.schulform`'s reason: every row entered before
                # these existed carries neither key, and a required one would refuse the lot of them
                # rather than the season's editor simply finding nothing filled in.
                "trikot_farbe": {"bsonType": _STRING_OR_NULL, "enum": [*_TRIKOT_FARBEN, None]},
                "kontakte": _SAISON_TEAM_KONTAKTE,
                # The name this club was PLAYED under, seeded at entry and rewritten by a rename only
                # while the season is not `past`. A finished season keeps what it was played under,
                # which is what makes the copy embedded in its fixtures true rather than merely old.
                "name": {"bsonType": "string"},
                "shorthand": {"bsonType": "string"},
            },
        )
    },
    Collection.SPIELER: {
        "$jsonSchema": _object(
            required=("_id", "vorname", "nachname", "einwilligung", "inactive_since"),
            properties={
                "_id": {"bsonType": "objectId"},
                "vorname": {"bsonType": "string"},
                "nachname": {"bsonType": _STRING_OR_NULL},
                "einwilligung": _EINWILLIGUNG,
                # The person has left the LEAGUE; leaving one squad retires the junction row below.
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
                "stufe",
                "position",
                "nummer",
                "inactive_since",
            ),
            properties={
                "_id": {"bsonType": "objectId"},
                "spieler_id": {"bsonType": "objectId"},
                "saison_id": {"bsonType": "string"},
                "team_id": {"bsonType": "objectId"},
                "is_nachgetragen": {"bsonType": "bool"},
                # Deliberately out of `required`, as `saisons.spielplan` is: every stored row
                # predates the field, so making the key mandatory would refuse every one of them and
                # owe a backfill. A missing key and a stored null both read as holding no role.
                "rolle": {"bsonType": _STRING_OR_NULL, "enum": [*_SPIELER_ROLLEN, None]},
                "stufe": {"bsonType": _STRING_OR_NULL, "enum": [*_STUFEN, None]},
                "position": {"bsonType": _STRING_OR_NULL, "enum": [*_POSITIONEN, None]},
                # A STRING, not an int. Squad numbers are worn, not counted.
                "nummer": {"bsonType": _STRING_OR_NULL},
                # `uniq_spieler_id_saison_id` keeps indexing a retired row, so a second create is a
                # DUPLICATE KEY answered 409 (`docs/backend/spec.md :: I20`).
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
                "sonderereignis",
                "saison_phase",
                "saison_id",
            ),
            properties={
                "_id": {"bsonType": "objectId"},
                "team1": _SPIEL_TEAM_FIELD,
                "team2": _SPIEL_TEAM_FIELD,
                # Nothing pairs this with the team field beside it: every combination is legitimate
                # (`docs/backend/spec.md :: I22`).
                "team1_quelle": _SPIEL_QUELLE,
                "team2_quelle": _SPIEL_QUELLE,
                "datum": {"bsonType": _STRING_OR_NULL},
                "uhrzeit": {"bsonType": _STRING_OR_NULL},
                "ort": _SPIEL_ORT_FIELD,
                "schiedsrichter": _SPIEL_SCHIEDSRICHTER_FIELD,
                "ergebnis": {"bsonType": _STRING_OR_NULL},
                "elfmeterschiessen": _SPIEL_ELFMETERSCHIESSEN,
                "spieltag_id": {"bsonType": "objectId"},
                "spiel_nr": {"bsonType": "int"},
                "sonderereignis": {"bsonType": _STRING_OR_NULL, "enum": [*_SONDEREREIGNISSE, None]},
                "saison_phase": {"bsonType": "string", "enum": _SAISON_PHASEN},
                "saison_id": {"bsonType": "string"},
                "notiz": {"bsonType": _STRING_OR_NULL},
            },
        )
    },
    Collection.SPIELTAGE: {
        "$jsonSchema": _object(
            required=("_id", "beginn", "ende", "saison_phase", "saison_id", "position"),
            properties={
                "_id": {"bsonType": "objectId"},
                # A generated matchday holds no dates until `PATCH /spieltage/{id}` sets them. Both
                # stay in `required`, which MongoDB satisfies with a stored null: the key is
                # mandatory and the value is not, so an absent one is still refused.
                "beginn": {"bsonType": _STRING_OR_NULL},
                "ende": {"bsonType": _STRING_OR_NULL},
                "saison_phase": {"bsonType": "string", "enum": _SAISON_PHASEN},
                "saison_id": {"bsonType": "string"},
                # Stored rather than re-derived from `beginn`: that chain ends at `_id`, which orders by
                # insertion time, and a drawn matchday carries no date at all until a PATCH sets one.
                "position": {"bsonType": "int"},
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
                "kontakt": _KONTAKT,
                "inactive_since": _INACTIVE_SINCE,
            },
        )
    },
    Collection.BEWERBUNGEN: {
        "$jsonSchema": _object(
            # Each nullable, and exactly one carries a value WHILE the application stands
            # `eingereicht` -- acceptance writes the created club's id beside the school it came
            # from. The write path holds that; types and enums cannot (`docs/backend/spec.md :: I16`).
            required=(
                "_id",
                "saison_id",
                "eingereicht_am",
                "status",
                "team_id",
                "schule",
                "kontakte",
                "trikot",
                "kader",
                "entscheidung",
            ),
            properties={
                "_id": {"bsonType": "objectId"},
                "saison_id": {"bsonType": "string"},
                "eingereicht_am": {"bsonType": "string"},
                "status": {"bsonType": "string", "enum": _BEWERBUNG_STATUS},
                # The club the applicant PICKED, null where they proposed a new school; acceptance
                # writes the created club's id back here, so a decided application always names one.
                "team_id": {"bsonType": ["objectId", "null"]},
                "schule": _BEWERBUNG_SCHULE,
                "kontakte": _BEWERBUNG_KONTAKTE,
                "trikot": _BEWERBUNG_TRIKOT,
                "kader": _BEWERBUNG_KADER,
                "entscheidung": _BEWERBUNG_ENTSCHEIDUNG,
            },
        )
    },
    Collection.AKTIONEN: {
        "$jsonSchema": _object(
            required=(
                "_id",
                "at",
                "actor",
                "correlation_id",
                "request",
                "collection",
                "operation",
                "document_id",
                "db_filter",
                "before",
                "modified_count",
                "redacted_at",
            ),
            properties={
                "_id": {"bsonType": "objectId"},
                "at": {"bsonType": "string"},
                "actor": _AKTOR,
                "correlation_id": {"bsonType": "string"},
                "request": _AKTION_REQUEST,
                "collection": {"bsonType": "string", "enum": _LOGGED_COLLECTIONS},
                "operation": {"bsonType": "string", "enum": _AKTION_OPERATIONS},
                # Whatever the recorded collection uses for its own `_id`: an objectId everywhere but
                # `saisons`, whose is the four-character season string. Null on a fan-out, which
                # matched a filter rather than one document.
                "document_id": {"bsonType": ["objectId", "string", "null"]},
                "db_filter": {"bsonType": ["object", "null"]},
                # Deliberately unconstrained: it copies a document from whichever collection was
                # written, so a schema tight enough to be worth having would refuse the next one.
                # An array is `delete_many`'s, whose images are the whole record of what it removed.
                "before": {"bsonType": ["object", "array", "null"]},
                "modified_count": {"bsonType": _INT_OR_NULL},
                "redacted_at": {"bsonType": _STRING_OR_NULL},
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


UNIQUE_INDEXES: Sequence[UniqueIndex] = (
    UniqueIndex(Collection.SAISON_TEAMS, "uniq_saison_id_team_id", ("saison_id", "team_id"), "one junction row per team per season"),
    UniqueIndex(Collection.SAISON_SPIELER, "uniq_spieler_id_saison_id", ("spieler_id", "saison_id"), "one junction row per player per season"),
    UniqueIndex(Collection.SPIELE, "uniq_saison_id_spiel_nr", ("saison_id", "spiel_nr"), "a spiel_nr identifies one match within a season"),
    UniqueIndex(Collection.TEAMS, "uniq_shorthand", ("shorthand",), "a shorthand identifies exactly one team"),
    # The phase is a key, not a filter: positions restart at 1 in each phase, so a season legitimately
    # holds several matchdays numbered 1.
    UniqueIndex(
        Collection.SPIELTAGE,
        "uniq_saison_id_saison_phase_position",
        ("saison_id", "saison_phase", "position"),
        "one matchday per position within a phase of a season",
    ),
)


@dataclass(frozen=True)
class SupportIndex:
    """One read this database would otherwise answer with a collection scan.

    Separate from `UniqueIndex` because dropping one of these costs speed, not correctness.
    """

    collection: str
    name: str
    keys: tuple[tuple[str, int], ...]
    rule: str


# The action log is the one collection that only ever grows, so it is the one whose reads cannot be
# left to a scan (`app/core/recording.py`).
SUPPORT_INDEXES: Sequence[SupportIndex] = (
    SupportIndex(Collection.AKTIONEN, "aktionen_at", (("at", DESCENDING),), "the log page reads newest first"),
    SupportIndex(
        Collection.AKTIONEN,
        "aktionen_correlation_id",
        (("correlation_id", ASCENDING),),
        "a write and its fan-out are read as one action",
    ),
    SupportIndex(
        Collection.AKTIONEN,
        "aktionen_target",
        (("collection", ASCENDING), ("document_id", ASCENDING)),
        "one document's history, and the rows a person's erasure must redact",
    ),
)


@dataclass(frozen=True)
class ConstraintSummary:
    validators: int
    indexes: int


async def _apply_validator(db: AsyncIOMotorDatabase, collection_name: str, validator: Mapping[str, Any]) -> None:
    command = {
        "collMod": collection_name,
        "validator": validator,
        # "moderate" would exempt exactly the documents worth catching -- the ones already failing.
        "validationLevel": "strict",
        # "warn" goes to a server log nobody reads and the write lands anyway.
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
    """Apply every validator and unique index to `db`, replacing whatever is there.

    Safe on every boot: `collMod` overwrites and `create_index` no-ops on a matching index. Raises on
    the FIRST failure -- all-but-one looks exactly like all.
    """
    for collection_name, validator in COLLECTION_VALIDATORS.items():
        await _apply_validator(db, collection_name, validator)

    for index in UNIQUE_INDEXES:
        try:
            await db[index.collection].create_index([(key, ASCENDING) for key in index.keys], name=index.name, unique=True)
        except OperationFailure as failure:
            raise RuntimeError(f"Could not build unique index '{index.collection}.{index.name}' ({index.rule}): {failure}") from failure

    for support in SUPPORT_INDEXES:
        try:
            await db[support.collection].create_index(list(support.keys), name=support.name)
        except OperationFailure as failure:
            raise RuntimeError(f"Could not build support index '{support.collection}.{support.name}' ({support.rule}): {failure}") from failure

    return ConstraintSummary(validators=len(COLLECTION_VALIDATORS), indexes=len(UNIQUE_INDEXES) + len(SUPPORT_INDEXES))


@dataclass(frozen=True)
class ViolationReport:
    collection: str
    total: int
    failing: int
    examples: list[Any]


@dataclass(frozen=True)
class DuplicateReport:
    index: UniqueIndex
    groups: int
    examples: list[Any]


@dataclass(frozen=True)
class RelationReport:
    rule: str
    groups: int
    examples: list[Any]


async def report_violations(db: AsyncIOMotorDatabase) -> list[ViolationReport]:
    """Count the documents each validator would reject, writing nothing.

    `$jsonSchema` is a query operator as well as a validator, so `$nor` over it is the rule read
    backwards -- an exact preview rather than an approximation.
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
    """Count the stored groups each cross-document rule is broken by, writing nothing.

    Enforced by the write path and by nothing in the database, so nothing else names one.
    """

    # Both sides unwound into one stream, so a club in `team1` of one fixture and `team2` of another
    # is one group of two -- the shape a per-field grouping would miss.
    both_sides = [{"$ifNull": ["$team1.team_id", None]}, {"$ifNull": ["$team2.team_id", None]}]
    spieltag_occupancy: list[Mapping[str, Any]] = [
        {"$project": {"spiel_nr": 1, "spieltag_id": 1, "sides": both_sides}},
        {"$unwind": "$sides"},
        {"$match": {"sides": {"$ne": None}}},
        {"$group": {"_id": {"spieltag_id": "$spieltag_id", "team_id": "$sides"}, "n": {"$sum": 1}, "spiele": {"$addToSet": "$spiel_nr"}}},
        # `n`, not the size of `spiele`: a club on BOTH sides of one fixture is the same violation
        # and collapses to one `spiel_nr`.
        {"$match": {"n": {"$gt": 1}}},
    ]

    counted = await db[Collection.SPIELE].aggregate([*spieltag_occupancy, {"$count": "groups"}]).to_list(length=1)
    examples = await db[Collection.SPIELE].aggregate([*spieltag_occupancy, {"$limit": 5}]).to_list(length=5)

    # Reported rather than swept once: nothing in the API can create a phantom or remove one, so
    # this report is the only thing that would ever surface it.

    phantom_junctions: list[Mapping[str, Any]] = [
        {"$lookup": {"from": Collection.TEAMS, "localField": "team_id", "foreignField": "_id", "as": "club"}},
        {"$match": {"club": []}},
        {"$group": {"_id": {"team_id": "$team_id"}, "saisons": {"$addToSet": "$saison_id"}}},
    ]

    orphans_counted = await db[Collection.SAISON_TEAMS].aggregate([*phantom_junctions, {"$count": "groups"}]).to_list(length=1)
    orphans = await db[Collection.SAISON_TEAMS].aggregate([*phantom_junctions, {"$limit": 5}]).to_list(length=5)

    return [
        RelationReport(
            rule="a team is fielded at most once per Spieltag (spiele)",
            groups=counted[0]["groups"] if counted else 0,
            examples=[{**doc["_id"], "spiele": sorted(doc["spiele"])} for doc in examples],
        ),
        RelationReport(
            rule="every junction row names a club that exists (saison_teams)",
            groups=orphans_counted[0]["groups"] if orphans_counted else 0,
            examples=[{**doc["_id"], "saisons": sorted(doc["saisons"])} for doc in orphans],
        ),
    ]


async def probe_collmod_privilege(db: AsyncIOMotorDatabase) -> str:
    """Answer whether this connection may run `collMod`, writing nothing.

    Aimed at a REAL collection `apply_constraints` will touch: privileges are granted per namespace,
    so an invented target reports DENIED to a correctly-configured user.
    """

    # Named rather than discovered: `listCollections` is one more privilege a privilege diagnostic
    # would then require, and the failure mode is circular.
    target = next(iter(COLLECTION_VALIDATORS), ABSENT_COLLECTION_NAME)

    try:
        await db.command({"collMod": target, "index": {"name": ABSENT_INDEX_NAME, "hidden": True}})
    except OperationFailure as failure:
        if failure.code in (INDEX_NOT_FOUND, NAMESPACE_NOT_FOUND):
            return "granted"
        if classify_failure(failure) == "authorization":
            return f"DENIED -- {failure_message(failure)}"
        # Anything else wears the same exception -- a rejected credential above all. Reporting that
        # as "denied" sends the reader to the Atlas role editor to fix a password.
        raise

    # Reached only if the index existed and has just been hidden, making the probe a mutation.
    raise RuntimeError(f"'{target}' unexpectedly has an index named '{ABSENT_INDEX_NAME}'; the collMod probe must not modify anything.")


async def report_identity(db: AsyncIOMotorDatabase) -> tuple[str, list[str]]:
    """Who the SERVER thinks this connection is, and which roles it carries.

    A correct role on the wrong user looks exactly like a broken one; nothing else separates them.
    """
    info = (await db.command("connectionStatus")).get("authInfo", {})

    users = ", ".join(user.get("user", "?") for user in info.get("authenticatedUsers", []))
    roles = [f"{role.get('role')}@{role.get('db')}" for role in info.get("authenticatedUserRoles", [])]

    return users or "(not authenticated)", roles


async def probe_read_privilege(db: AsyncIOMotorDatabase) -> str:
    try:
        await db[next(iter(COLLECTION_VALIDATORS), ABSENT_COLLECTION_NAME)].count_documents({})
    except OperationFailure as failure:
        if classify_failure(failure) == "authorization":
            return f"DENIED -- {failure_message(failure)}"
        raise

    return "granted"


async def probe_privileges(db: AsyncIOMotorDatabase) -> list[tuple[str, str]]:
    """Every privilege this module needs, each asked INDEPENDENTLY, so one report names all the gaps.

    A check aborting on the first refusal hides the next until that one is fixed.
    """
    return [("find", await probe_read_privilege(db)), ("collMod", await probe_collmod_privilege(db))]


def failure_message(failure: OperationFailure) -> str:
    """The server's own `errmsg`, which carries the detail the exception's `str` flattens away."""
    return failure.details.get("errmsg", str(failure)) if failure.details else str(failure)


def classify_failure(failure: OperationFailure) -> str:
    """`"authentication"`, `"authorization"` or `"other"`, read from the MESSAGE.

    On Atlas both refusals arrive as `AtlasError` 8000, so a code-only rule reports a missing
    `collMod` grant as a rejected password.
    """
    message = failure_message(failure).lower()

    # Checked first: an Atlas authorization message can mention "auth" in the namespace it names.
    if failure.code == UNAUTHORIZED or any(phrase in message for phrase in AUTHORIZATION_PHRASES):
        return "authorization"

    if failure.code == AUTHENTICATION_FAILED or any(phrase in message for phrase in AUTHENTICATION_PHRASES):
        return "authentication"

    return "other"


def diagnose_failure(failure: OperationFailure) -> str:
    """Turn a driver exception into the sentence an operator can act on.

    Names the FILE and the VARIABLE, never the connection string: the value is a secret, and a
    diagnostic that prints one cannot be pasted into a bug report.
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
    # exception classes.
    named = failure.details.get("codeName", failure.code) if failure.details else failure.code
    return f"  The database refused the command ({named}): {message}"


# An operator tool, never inside a request, which is why it prints where the service logs
# (`app/core/logging.py`).
async def _run(check: bool) -> int:
    # Imported here, not at module scope: `app.core.config` refuses on import without a complete
    # environment, and the tests import this module with none.
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

        identity, roles = await report_identity(database)
        print(f"  Authenticated as: {identity}")
        print(f"  Roles the server sees: {', '.join(roles) or '(none)'}\n")

        print("  Privileges — every action this module needs, asked separately")
        privileges = await probe_privileges(database)
        for action, verdict in privileges:
            print(f"    {'ok  ' if verdict == 'granted' else 'FAIL'}  {action:<10} {verdict}")

        # Everything below reads documents, so a second failure would say what the row above does.
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

        # Counted into `blocking` like the rest: an offender blocks no validator or index, but it
        # does block turning the enforcement on.
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
        # Not re-raised: the traceback buries the one line that matters, which this tool hands over.
        print(f"\n{diagnose_failure(failure)}\n")
        return 2

    finally:
        client.close()


def _main() -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.core.constraints",
        description="Report or apply the database constraints declared in this module.",
    )
    parser.add_argument("--check", action="store_true", help="report violations and the collMod privilege; writes nothing")
    parser.add_argument("--apply", action="store_true", help="apply every validator and unique index, exactly as startup does")
    arguments = parser.parse_args()

    if arguments.check == arguments.apply:
        parser.error("pass exactly one of --check or --apply")

    return asyncio.run(_run(check=arguments.check))


if __name__ == "__main__":
    raise SystemExit(_main())
