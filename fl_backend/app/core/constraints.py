import argparse
import asyncio
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from functools import partial
from typing import Annotated, Any, TypedDict

from pydantic import Field, StringConstraints, TypeAdapter, ValidationError
from pymongo import ASCENDING, DESCENDING, AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.saisons.schemas import NumberOfGroups, QualifiersPerGroup, TeamsPerGroup
from app.api.spielberichte.schemas import CustomSpielberichtMinute
from app.api.spiele.schemas import FLSpielElfmeterschiessen
from app.api.spieler.schemas import FLSpielerStufe
from app.core.collections import Collection
from app.core.config import MONGODB_URI_FILE, get_config  # noqa: TID251
from app.core.sentinels import GHOST_SPIELER_ID
from app.shared.schemas.addresses import HAUSNUMMER_PATTERN
from app.shared.schemas.bounds import (
    ADRESSWECHSEL_NACHLAUF_TAGE,
    AKTION_RETENTION_SECONDS,
    SAISON_ID_LENGTH,
    TEAM_DESCRIPTION_MAX_LENGTH,
    TEAM_SHORTHAND_LENGTH,
)
from app.shared.schemas.custom import (
    CustomDateString,
    CustomErgebnisString,
    CustomNonEmptyString,
    CustomOptionalDateString,
    CustomOptionalExternalUrl,
    CustomSpielNr,
    CustomTimeString,
)

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
_GRUPPEN = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"]
_QUELLE_TYPES = ["gruppe", "spiel"]
_QUELLE_AUSGAENGE = ["sieger", "verlierer"]
_POSITIONEN = ["Tor", "Abwehr", "Mittelfeld", "Angriff"]
_STUFEN = ["E1", "E2", "Q1", "Q2", "Q3", "Q4"]
_SPIELER_ROLLEN = ["kapitaen", "co_kapitaen"]
_SCHULFORMEN = ["gymnasium_g8", "gymnasium_g9", "gesamtschule", "privatschule_g8", "privatschule_g9", "oberstufengymnasium"]
_TRIKOT_FARBEN = [
    "schwarz",
    "weiss",
    "grau",
    "braun",
    "bordeaux",
    "rot",
    "koralle",
    "orange",
    "gold",
    "gelb",
    "limette",
    "hellgruen",
    "gruen",
    "smaragd",
    "tuerkis",
    "cyan",
    "hellblau",
    "meerblau",
    "blau",
    "dunkelblau",
    "flieder",
    "violett",
    "magenta",
    "rosa",
]
# The second member is the person's own tick on their confirmation page: no payload offers it.
_KONTAKT_KENNTNISNAHME_UMFANG = ["kontaktdaten", "kontaktdaten_whatsapp"]
# Mirrors `app/api/teams/schemas.py :: FLKontaktEingetragenVon`.
_KONTAKT_EINGETRAGEN_VON = ["bewerbung", "liga"]
_BEWERBUNG_STATUS = ["eingereicht", "angenommen", "abgelehnt"]
# Mirror `app/api/spielbestaetigungen/schemas.py`'s Literals and discriminators, and `FLKontaktRolle`.
_SPIELBESTAETIGUNG_PARTEIEN = ["team", "schiedsrichter"]
_SPIELBESTAETIGUNG_ANTWORTEN = ["zugesagt", "abgelehnt"]
_SPIELBESTAETIGUNG_VON = ["kontakt", "admin", "schiedsrichter"]
_SPIELBESTAETIGUNG_GRUENDE = [
    "ansetzung_geaendert",
    "austritt",
    "spiel_entschieden",
    "abgesagt",
    "schiedsrichter_gewechselt",
    "schiedsrichter_abgelehnt",
    "verworfen",
    "spiel_vergangen",
]
_KONTAKT_ROLLEN = ["trainer", "ansprechperson", "stellvertretung"]
# Mirror `app/api/spielberichte/schemas.py`'s Literals and discriminators.
_SPIELBERICHT_SEITEN = ["team1", "team2"]
_SPIELBERICHT_SONDEREREIGNISSE = ["abgebrochen", "nichtantreten_team1", "nichtantreten_team2"]
_KARTEN_FARBEN = ["gelb", "gelb_rot", "rot"]
_KARTEN_GRUENDE = [
    "foulspiel",
    "unsportlichkeit",
    "handspiel",
    "meckern",
    "spielverzoegerung",
    "wiederholtes_foulspiel",
    "grobes_foulspiel",
    "taetlichkeit",
    "beleidigung",
    "notbremse",
]
_SPIELBERICHT_VON = ["schiedsrichter", "admin"]
_SPIELBERICHT_UEBERNOMMEN_VON = ["admin"]

# Derived, not spelled: these ARE the collection names. The log never records itself, nor the day's
# write counts, which bypass `app/core/crud.py` (`app/core/drosselung.py`), nor an address's anchor,
# which changes nothing a reader sees.
_LOGGED_COLLECTIONS = [str(name) for name in Collection if name not in {Collection.AKTIONEN, Collection.DROSSELUNG, Collection.ADRESSANKER}]

# Mirrors `app/core/recording.py :: LoggedAct`, hand-copied as the literals below are: a row's
# `collection` for an act that writes none of the application's own.
_LOGGED_ACTS = ["anmeldungen", "pseudonyme"]

# Mirrors `app/core/recording.py :: Operation`, `:: Actor.kind`, `:: PersonActor.kind` and
# `:: AktorFunktion`, hand-copied. `tests/core/test_constraints.py` pins each against the recording
# literal too, so a member added to one alone fails rather than reaching a stored row.
_AKTION_OPERATIONS = ["insert", "insert_many", "patch_one", "patch_many", "delete_many", "erase_many"]
_AKTOR_KINDS_MIT_ADRESSE = ["admin_session", "system", "public"]
_AKTOR_KINDS_PERSON = ["person_session"]
_AKTOR_KINDS = [*_AKTOR_KINDS_MIT_ADRESSE, *_AKTOR_KINDS_PERSON]
_AKTOR_FUNKTIONEN = ["kontakt", "spieler", "schiedsrichter"]


def _object(*, required: Sequence[str], properties: Mapping[str, Any], nullable: bool = False) -> Mapping[str, Any]:
    """One object sub-schema.

    `nullable` widens `bsonType` rather than wrapping in an `anyOf`, which works because MongoDB
    applies `required` only to values that actually are objects.
    """
    return {
        "bsonType": ["object", "null"] if nullable else "object",
        # Left off where nothing is required: MongoDB refuses an empty `required`.
        **({"required": list(required)} if required else {}),
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

_AKTOR = {
    **_object(
        required=("kind",),
        properties={
            "kind": {"bsonType": "string", "enum": _AKTOR_KINDS},
            "email": {"bsonType": "string"},
            "pseudonym": {"bsonType": "string"},
            "funktion": {"bsonType": "string", "enum": _AKTOR_FUNKTIONEN},
        },
    ),
    # Required keys by `kind`, where `_SPIEL_QUELLE` requires its discriminator alone: an actor is
    # stored from `app/core/recording.py :: PersonActor` with no model between, and an address on a
    # person's row would outlive their erasure, so the database refuses it.
    "oneOf": [
        {"properties": {"kind": {"enum": _AKTOR_KINDS_MIT_ADRESSE}}, "required": ["email"]},
        {"properties": {"kind": {"enum": _AKTOR_KINDS_PERSON}}, "required": ["pseudonym", "funktion"], "not": {"required": ["email"]}},
    ],
}

_AKTION_REQUEST = _object(
    nullable=True,
    required=("method", "path"),
    properties={"method": {"bsonType": "string"}, "path": {"bsonType": "string"}},
)


# When a person set one choice and under which wording (`app/shared/schemas/einwilligung.py ::
# FLEinwilligungBeleg`); every key required, a half-stamped act proving nothing.
_BELEG = _object(required=("am", "text_version"), properties={"am": {"bsonType": "string"}, "text_version": {"bsonType": "string"}})

# One choice's evidence, null until its person sets the choice; `erteilt_zuvor` only on a withdrawal.
_NACHWEIS_WAHL = _object(
    nullable=True,
    required=("am", "text_version"),
    properties={
        "am": {"bsonType": "string"},
        "text_version": {"bsonType": "string"},
        "erteilt_zuvor": {**_BELEG, "bsonType": ["object", "null"]},
    },
)

# Out of every block's `required` for `saisons.spielplan`'s reason: a record no person has answered
# carries none. Never null, a dotted `$set` beneath one failing. Shared by both vocabularies, whose
# choices carry the same two names.
_NACHWEIS = _object(required=(), properties={"umfang": _NACHWEIS_WAHL, "medien": _NACHWEIS_WAHL})


# Required TOGETHER: a record is born whole of its person's own confirmation, so a key missing is a
# record nobody gave. Spread into the registration's own below, so widening `umfang` here widens it
# on all three collections.
_EINWILLIGUNG = _object(
    required=("umfang", "datum", "bestaetigt_am", "text_version", "medien", "nachweis"),
    properties={
        "umfang": {"bsonType": "string", "enum": _EINWILLIGUNG_UMFANG},
        "datum": {"bsonType": "string"},
        # Null for the read model's reason: no writer stores one.
        "bestaetigt_am": {"bsonType": _STRING_OR_NULL},
        "text_version": {"bsonType": "string"},
        # A media consent is a scope of its own and never an `_EINWILLIGUNG_UMFANG` member, so a
        # record can be withdrawn from one and stand in the other.
        "medien": {"bsonType": "bool"},
        "nachweis": _NACHWEIS,
    },
)

# A pending registration's: its stamp and label alone required and both choices nullable, a
# returning pupil's page asking none. Never a widened `_EINWILLIGUNG`, which a person's record would
# then pass without a scope.
_REGISTRIERUNG_EINWILLIGUNG = _object(
    nullable=True,
    required=("bestaetigt_am", "text_version"),
    properties={
        **_EINWILLIGUNG["properties"],
        "umfang": {"bsonType": _STRING_OR_NULL, "enum": [*_EINWILLIGUNG_UMFANG, None]},
        "datum": {"bsonType": _STRING_OR_NULL},
        "medien": {"bsonType": ["bool", "null"]},
    },
)

# A CONTACT person's record, and never `_EINWILLIGUNG` above: that one records what may be
# published about a pupil, and one shared sub-schema would let either enum widen the other.
_KONTAKT_KENNTNISNAHME = _object(
    required=("umfang", "text_version", "datum", "bestaetigt_am", "medien", "eingetragen_von"),
    properties={
        "umfang": {"bsonType": "string", "enum": _KONTAKT_KENNTNISNAHME_UMFANG},
        "text_version": {"bsonType": "string"},
        "datum": {"bsonType": "string"},
        "bestaetigt_am": {"bsonType": _STRING_OR_NULL},
        "medien": {"bsonType": "bool"},
        "eingetragen_von": {"bsonType": "string", "enum": _KONTAKT_EINGETRAGEN_VON},
        "nachweis": _NACHWEIS,
    },
)

# Required TOGETHER, as `_EINWILLIGUNG` is: a person the league cannot reach is not a contact, and a
# set of details carrying no record is one nobody was told the league holds.
_KONTAKTPERSON = _object(
    required=("vorname", "nachname", "email", "telefon", "geburtsdatum", "einwilligung"),
    properties={
        "vorname": {"bsonType": "string"},
        "nachname": {"bsonType": "string"},
        "email": {"bsonType": "string"},
        "telefon": {"bsonType": "string"},
        # Nullable: the date arrives with the confirmation, and "non-null once confirmed" is no type or
        # enum (`docs/backend/spec.md :: I141`), so nothing here says it.
        "geburtsdatum": {"bsonType": _STRING_OR_NULL},
        "einwilligung": _KONTAKT_KENNTNISNAHME,
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

# The six a delivery state may read. `angenommen` is the provider ACCEPTING the request, which is
# all a send ever learns; the other five are what a delivery event reports.
_ZUSTELLSTAENDE = ["angenommen", "zugestellt", "verzoegert", "unzustellbar", "unterdrueckt", "beschwerde"]

# One shape at every home `app/api/zustellung/services.py :: ZIEL_PFADE` names, not the
# application's alone. Required TOGETHER as `_EINWILLIGUNG` is: the write condition is an ordering,
# and a state carrying no stamp orders against nothing.
_ZUSTELLUNG = _object(
    nullable=True,
    required=("nachricht_id", "stand", "grund", "am"),
    properties={
        "nachricht_id": {"bsonType": "string"},
        "stand": {"bsonType": "string", "enum": _ZUSTELLSTAENDE},
        "grund": {"bsonType": _STRING_OR_NULL},
        # An INSTANT where every other stamp here is a date: two events about one message share a
        # day, and only sub-day ordering makes a redelivery a no-op.
        "am": {"bsonType": "string"},
    },
)

# One seat's confirmation bookkeeping. `token_hash` is here and on NO model: a raw document key the
# confirm query alone reads. Nullable per seat, as the slot beside it is: an erasure empties the one
# naming the person.
_BEWERBUNG_BESTAETIGUNG = _object(
    nullable=True,
    required=("token_hash", "verschickt_am", "erinnert_am", "abgelehnt_am"),
    properties={
        "token_hash": {"bsonType": "string"},
        # The reminder's second hash: it mints a fresh link and keeps the one already in somebody's
        # inbox valid. Out of `required` because the first mint writes only `token_hash`.
        "token_hash_zuvor": {"bsonType": _STRING_OR_NULL},
        "verschickt_am": {"bsonType": "string"},
        "erinnert_am": {"bsonType": _STRING_OR_NULL},
        "abgelehnt_am": {"bsonType": _STRING_OR_NULL},
        # Out of `required` for `token_hash_zuvor`'s reason: the first mint knows nothing yet about
        # the message its link goes out in, and a re-send writes a fresh entry carrying none.
        "zustellung": _ZUSTELLUNG,
    },
)

# The block mirrors `kontakte`'s three slots and stays OUTSIDE it: acceptance copies `kontakte`
# whole into `saison_teams`, and a hash inside a slot would live there for a season.
_BEWERBUNG_BESTAETIGUNGEN = _object(
    required=("trainer", "ansprechperson", "stellvertretung"),
    properties={
        "trainer": _BEWERBUNG_BESTAETIGUNG,
        "ansprechperson": _BEWERBUNG_BESTAETIGUNG,
        "stellvertretung": _BEWERBUNG_BESTAETIGUNG,
    },
)

# Never `_BEWERBUNG_BESTAETIGUNG`: that one declares the decline a contact seat may give, which a
# referee's page does not offer, so sharing it would put a key on this row nothing can write.
_SCHIEDSRICHTER_BESTAETIGUNG = _object(
    nullable=True,
    required=("token_hash", "verschickt_am", "erinnert_am", "frist"),
    properties={
        "token_hash": {"bsonType": "string"},
        "verschickt_am": {"bsonType": "string"},
        # Null on every referee row: nothing chases this link, and the editor renders the day a
        # later reminder would stamp.
        "erinnert_am": {"bsonType": _STRING_OR_NULL},
        # STORED rather than derived from `verschickt_am` and the bound: raising the bound would
        # otherwise move the deadline of every link already in somebody's inbox.
        "frist": {"bsonType": "string"},
        # Out of `required` for `_BEWERBUNG_BESTAETIGUNG`'s reason: a mint knows nothing yet about
        # the message its link goes out in.
        "zustellung": _ZUSTELLUNG,
    },
)

# How a change takes effect and how it ended, mirrored by `app/api/adresswechsel/services.py :: FLAdresswechselWeg` and
# `:: FLAdresswechselEndeArt`.
_ADRESSWECHSEL_WEGE = ["konto", "freigabe", "wartezeit"]
_ADRESSWECHSEL_ENDE_ARTEN = ["wirksam", "abgelehnt", "gestoppt", "abgelaufen", "ersetzt", "verworfen"]

# The approval a change moving a grant waits on. Its two addresses are administrators', as `erteilt_von` is.
_ADRESSWECHSEL_GENEHMIGUNG = _object(
    nullable=True,
    required=("verwaltung", "bis", "gestartet_von", "genehmigt_am", "genehmigt_von"),
    properties={
        "verwaltung": {"bsonType": "string", "enum": ["owner", "administration"]},
        "bis": {"bsonType": "date"},
        "gestartet_von": {"bsonType": "string"},
        "genehmigt_am": {"bsonType": ["date", "null"]},
        "genehmigt_von": {"bsonType": _STRING_OR_NULL},
    },
)

# Null while the change stands: `uniq_adresswechsel_adresse` reaches those rows alone, and the TTL index dates the rest.
_ADRESSWECHSEL_BEENDET = _object(
    nullable=True,
    required=("art", "am"),
    properties={"art": {"bsonType": "string", "enum": _ADRESSWECHSEL_ENDE_ARTEN}, "am": {"bsonType": "date"}},
)

# A seat's link on a team's season row. Never `_BEWERBUNG_BESTAETIGUNG`: no reminder chases these
# links, so a second hash and a reminder stamp are keys nothing writes, and each link carries its own
# deadline.
_SAISON_TEAM_BESTAETIGUNG = _object(
    nullable=True,
    required=("token_hash", "verschickt_am", "frist", "abgelehnt_am"),
    properties={
        "token_hash": {"bsonType": "string"},
        "verschickt_am": {"bsonType": "string"},
        # STORED for `_SCHIEDSRICHTER_BESTAETIGUNG`'s reason: raising the bound moves no link already sent.
        "frist": {"bsonType": "string"},
        "abgelehnt_am": {"bsonType": _STRING_OR_NULL},
        # Out of `required` for `_BEWERBUNG_BESTAETIGUNG`'s reason.
        "zustellung": _ZUSTELLUNG,
    },
)

# Outside `kontakte`, as an application's block is: a Widerspruch empties the slot, and the record of
# it has to outlive the emptying.
_SAISON_TEAM_BESTAETIGUNGEN = _object(
    nullable=True,
    required=("trainer", "ansprechperson", "stellvertretung"),
    properties={
        "trainer": _SAISON_TEAM_BESTAETIGUNG,
        "ansprechperson": _SAISON_TEAM_BESTAETIGUNG,
        "stellvertretung": _SAISON_TEAM_BESTAETIGUNG,
    },
)

_SAISON_BEWERBUNG = _object(
    nullable=True,
    required=("offen", "von", "bis"),
    properties={
        "offen": {"bsonType": "bool"},
        "von": {"bsonType": "string"},
        "bis": {"bsonType": "string"},
    },
)

# Spelled out rather than assigned `_SAISON_BEWERBUNG`: one name over both blocks would let a
# widening of either window widen the other silently.
_SAISON_REGISTRIERUNG = _object(
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

# A pupil's registration states one of two, and an admitted one states neither: the transaction that
# admits it deletes the row.
_REGISTRIERUNG_STATUS = ["eingereicht", "abgelehnt"]

# Closed here as well as on the model: a grant is typed in by hand in the Playground, and the
# validator is the one check that paste meets.
_VERWALTUNG = ["owner", "administration"]
_BERECHTIGUNG_AENDERUNGEN = ["erteilt", "entzogen", "geaendert"]
_BERECHTIGUNG_URHEBER = ["anwendung", "datenbank"]
_BERECHTIGUNG_VORENTHALTEN = ["gesperrt", "geloescht"]

# One grant's state in an outbox row; the address null where it was barred or its holder erased.
_BERECHTIGUNG_STAND = _object(
    nullable=True,
    required=("adresse", "verwaltung"),
    properties={"adresse": {"bsonType": _STRING_OR_NULL}, "verwaltung": {"bsonType": "string", "enum": _VERWALTUNG}},
)

# The key a public submission is replayed by, and the digest of the payload it first carried
# (`docs/backend/spec.md :: I346`), kept on the squad row an admission writes. Out of `required`
# everywhere: every row stored before the key carries none.
_IDEMPOTENZ_PROPERTIES: Mapping[str, Any] = {
    "idempotenz_schluessel": {"bsonType": "string"},
    "idempotenz_fingerabdruck": {"bsonType": "string"},
}

# The registration's own confirmation bookkeeping, and never `_BEWERBUNG_BESTAETIGUNG`: that one
# declares the decline a contact seat may give, which a pupil's page does not offer, and carries no
# deadline of its own, the application's sitting on the application.
_REGISTRIERUNG_BESTAETIGUNG = _object(
    nullable=True,
    required=("token_hash", "verschickt_am", "erinnert_am", "frist"),
    properties={
        "token_hash": {"bsonType": "string"},
        # The reminder's second hash: it mints a fresh link and keeps the one already in somebody's
        # inbox valid. Out of `required` because the first mint writes only `token_hash`.
        "token_hash_zuvor": {"bsonType": _STRING_OR_NULL},
        "verschickt_am": {"bsonType": "string"},
        "erinnert_am": {"bsonType": _STRING_OR_NULL},
        # STORED rather than derived from `verschickt_am` and the bound: raising the bound would
        # otherwise move the deadline of every link already in somebody's inbox.
        "frist": {"bsonType": "string"},
        # Out of `required` for `token_hash_zuvor`'s reason: a mint knows nothing yet about the
        # message its link goes out in.
        "zustellung": _ZUSTELLUNG,
    },
)

# Spelled out rather than assigned `_BEWERBUNG_ENTSCHEIDUNG`: one name over both would let a key
# either flow adds reach the other, and a pupil's decision is taken on a different surface from a
# school's.
_REGISTRIERUNG_ENTSCHEIDUNG = _object(
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
    # `type` alone: `oneOf` could require each variant's own keys, and these validators hold to types,
    # required fields and enums (`docs/backend/spec.md :: I16`). What stays catchable here is a
    # `platz` stored as "2".
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
        # Null where the fixture was repointed at the ghost, the block itself surviving: the booking
        # and the fee are the fixture's own record and outlive the name it copied.
        "name": {"bsonType": _STRING_OR_NULL},
        "payment": {"bsonType": "int"},
    },
)


# Keyed on `art` as `_SPIEL_QUELLE` is on `type`, requiring the discriminator alone for its reason.
_SPIELBESTAETIGUNG_PARTEI = _object(
    required=("art",),
    properties={
        "art": {"bsonType": "string", "enum": _SPIELBESTAETIGUNG_PARTEIEN},
        "team_id": {"bsonType": "objectId"},
        "schiedsrichter_id": {"bsonType": "objectId"},
    },
)

_SPIELBESTAETIGUNG_ANSETZUNG = _object(
    required=("datum", "uhrzeit", "spielort_id", "team1_id", "team2_id", "stand"),
    properties={
        "datum": {"bsonType": "string"},
        "uhrzeit": {"bsonType": "string"},
        "spielort_id": {"bsonType": ["objectId", "null"]},
        "team1_id": {"bsonType": "objectId"},
        "team2_id": {"bsonType": "objectId"},
        "stand": {"bsonType": "string"},
    },
)

# One seat's links on a confirmation row. The hashes are typed alone, a seat keeping every link it was
# mailed (`docs/backend/spec.md :: I752`) and a count being no type (`:: I16`).
_SPIELBESTAETIGUNG_SITZ = _object(
    nullable=True,
    required=("token_hashes",),
    properties={
        "token_hashes": {"bsonType": "array", "items": {"bsonType": "string"}},
        # Out of `required` for `_BEWERBUNG_BESTAETIGUNG`'s reason.
        "zustellung": _ZUSTELLUNG,
    },
)

_SPIELBESTAETIGUNG_KONTAKTE = _object(
    nullable=True,
    required=("trainer", "ansprechperson", "stellvertretung"),
    properties={"trainer": _SPIELBESTAETIGUNG_SITZ, "ansprechperson": _SPIELBESTAETIGUNG_SITZ, "stellvertretung": _SPIELBESTAETIGUNG_SITZ},
)

_SPIELBESTAETIGUNG_TERMIN = _object(
    nullable=True,
    required=("datum", "uhrzeit"),
    properties={"datum": {"bsonType": "string"}, "uhrzeit": {"bsonType": "string"}},
)

_SPIELBESTAETIGUNG_ANTWORT = _object(
    nullable=True,
    required=("art", "am", "von", "vorschlag", "begruendung"),
    properties={
        "art": {"bsonType": "string", "enum": _SPIELBESTAETIGUNG_ANTWORTEN},
        "am": {"bsonType": "string"},
        # `rolle` and `halter` out of `required` for `_SPIELBESTAETIGUNG_PARTEI`'s reason: only a seat's answer names one.
        "von": _object(
            required=("art",),
            properties={
                "art": {"bsonType": "string", "enum": _SPIELBESTAETIGUNG_VON},
                "rolle": {"bsonType": "string", "enum": _KONTAKT_ROLLEN},
                "halter": {"bsonType": _STRING_OR_NULL},
            },
        ),
        "vorschlag": _SPIELBESTAETIGUNG_TERMIN,
        "begruendung": {"bsonType": _STRING_OR_NULL},
    },
)

_SPIELBESTAETIGUNG_GESCHLOSSEN = _object(
    nullable=True,
    required=("am", "grund"),
    properties={"am": {"bsonType": "string"}, "grund": {"bsonType": "string", "enum": _SPIELBESTAETIGUNG_GRUENDE}},
)


_SPIELBERICHT_VORSCHLAG = _object(
    required=("team1_tore", "team2_tore", "elfmeterschiessen", "sonderereignis"),
    properties={
        "team1_tore": {"bsonType": _INT_OR_NULL},
        "team2_tore": {"bsonType": _INT_OR_NULL},
        "elfmeterschiessen": _SPIEL_ELFMETERSCHIESSEN,
        "sonderereignis": {"bsonType": _STRING_OR_NULL, "enum": [*_SPIELBERICHT_SONDEREREIGNISSE, None]},
    },
)

_SPIELBERICHT_TORSCHUETZE = _object(
    required=("seite", "spieler_id", "minute", "eigentor"),
    properties={
        "seite": {"bsonType": "string", "enum": _SPIELBERICHT_SEITEN},
        # Null is a scorer nobody named and nothing else: an erasure never nulls an entry, which would read as one.
        "spieler_id": {"bsonType": ["objectId", "null"]},
        "minute": {"bsonType": "string"},
        "eigentor": {"bsonType": "bool"},
    },
)

_SPIELBERICHT_KARTE = _object(
    required=("seite", "spieler_id", "minute", "farbe", "grund"),
    properties={
        "seite": {"bsonType": "string", "enum": _SPIELBERICHT_SEITEN},
        "spieler_id": {"bsonType": "objectId"},
        "minute": {"bsonType": "string"},
        "farbe": {"bsonType": "string", "enum": _KARTEN_FARBEN},
        "grund": {"bsonType": _STRING_OR_NULL, "enum": [*_KARTEN_GRUENDE, None]},
    },
)

_SPIELBERICHT_BERICHT = _object(
    nullable=True,
    required=(
        "ergebnis_vorschlag",
        "torschuetzen",
        "karten",
        "bemerkungen",
        "seiten",
        "eingereicht_am",
        "eingereicht_von",
        "geaendert_am",
        "version",
        "uebernommen_am",
        "uebernommen_von",
        "uebernommene_version",
    ),
    properties={
        "ergebnis_vorschlag": _SPIELBERICHT_VORSCHLAG,
        "torschuetzen": {"bsonType": "array", "items": _SPIELBERICHT_TORSCHUETZE},
        "karten": {"bsonType": "array", "items": _SPIELBERICHT_KARTE},
        "bemerkungen": {"bsonType": _STRING_OR_NULL},
        # Null on a slot still open when the block was written.
        "seiten": _object(
            required=_SPIELBERICHT_SEITEN,
            properties={seite: {"bsonType": ["objectId", "null"]} for seite in _SPIELBERICHT_SEITEN},
        ),
        # Instants rather than German days: a correction and an adoption on one day are two moments a reader orders.
        "eingereicht_am": {"bsonType": "date"},
        # Keyed on `art` as `_SPIELBESTAETIGUNG_PARTEI` is, requiring the discriminator alone for its reason.
        "eingereicht_von": _object(
            required=("art",),
            properties={"art": {"bsonType": "string", "enum": _SPIELBERICHT_VON}, "schiedsrichter_id": {"bsonType": "objectId"}},
        ),
        "geaendert_am": {"bsonType": "date"},
        "version": {"bsonType": "int"},
        "uebernommen_am": {"bsonType": ["date", "null"]},
        "uebernommen_von": _object(
            nullable=True, required=("art",), properties={"art": {"bsonType": "string", "enum": _SPIELBERICHT_UEBERNOMMEN_VON}}
        ),
        "uebernommene_version": {"bsonType": _INT_OR_NULL},
    },
)


# Hand-written, never generated: `model_json_schema()` types a `CustomObjectId` as a string, so a
# generated validator would admit the ObjectId-as-string documents these refuse. Types and enums
# only (`docs/backend/spec.md :: I16`).
COLLECTION_VALIDATORS: Mapping[Collection, Mapping[str, Any]] = {
    Collection.SAISONS: {
        "$jsonSchema": _object(
            required=("_id", "start_date", "end_date", "status", "rules", "bewerbung", "registrierung"),
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
                # Deliberately out of `required`: the season's creation writes none, the generator
                # being what writes it. A missing key and a stored null both read as never generated.
                "spielplan": _object(
                    nullable=True,
                    required=("generiert_am", "spieltage", "spiele"),
                    properties={
                        "generiert_am": {"bsonType": "string"},
                        "spieltage": {"bsonType": "int"},
                        "spiele": {"bsonType": "int"},
                    },
                ),
                # Nullable, a season taking no applications holding none. Both halves together: a
                # switch with no span cannot say when the window closes, and a span with no switch
                # cannot be shut early.
                "bewerbung": _SAISON_BEWERBUNG,
                # On the same terms as the window above it.
                "registrierung": _SAISON_REGISTRIERUNG,
                # Out of `required` for `saisons.spielplan`'s reason. A missing key and a stored
                # null both read as a database no retention pass has ever run against.
                "sweep_gelaufen_am": {"bsonType": _STRING_OR_NULL},
                # Its own key beside the application sweep's, out of `required` on the same terms: a
                # reader chasing a stale date learns WHICH pass stopped, and one key over both would
                # answer that the other one ran.
                "registrierung_sweep_gelaufen_am": {"bsonType": _STRING_OR_NULL},
                # The fixture-confirmation pass's own key, on the same terms as the two above.
                "spiel_sweep_gelaufen_am": {"bsonType": _STRING_OR_NULL},
            },
        )
    },
    Collection.TEAMS: {
        "$jsonSchema": _object(
            required=("_id", "name", "shorthand", "description", "full_name", "website_url", "address", "schulform", "inactive_since"),
            properties={
                "_id": {"bsonType": "objectId"},
                "name": {"bsonType": "string"},
                "shorthand": {"bsonType": "string"},
                "description": {"bsonType": "string"},
                "full_name": {"bsonType": "string"},
                "website_url": {"bsonType": _STRING_OR_NULL},
                "address": _ADDRESS,
                # A stored null reads as a school form nobody has recorded.
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
            required=("_id", "saison_id", "team_id", "gruppe", "austritt", "trikot_farbe", "kontakte", "name", "shorthand"),
            properties={
                "_id": {"bsonType": "objectId"},
                "saison_id": {"bsonType": "string"},
                "team_id": {"bsonType": "objectId"},
                "gruppe": {"bsonType": "string", "enum": _GRUPPEN},
                "austritt": _AUSTRITT,
                # Both written by the entry, null until a club is given its kit or its people.
                "trikot_farbe": {"bsonType": _STRING_OR_NULL, "enum": [*_TRIKOT_FARBEN, None]},
                "kontakte": _SAISON_TEAM_KONTAKTE,
                # Out of `required`: the entry writes none, the first save minting a link writes it.
                "bestaetigungen": _SAISON_TEAM_BESTAETIGUNGEN,
                # The name this club was PLAYED under, seeded at entry and rewritten by a rename only
                # while the season is not `past` (`docs/backend/spec.md :: I13`). What makes the copy
                # embedded in its fixtures true rather than merely old.
                "name": {"bsonType": "string"},
                "shorthand": {"bsonType": "string"},
            },
        )
    },
    Collection.SPIELER: {
        "$jsonSchema": _object(
            required=("_id", "vorname", "nachname", "einwilligung", "geburtsdatum", "inactive_since"),
            properties={
                "_id": {"bsonType": "objectId"},
                # This, `einwilligung` and `geburtsdatum` nullable for the erased pupils' sentinel
                # (`app/core/sentinels.py :: GHOST_SPIELER_ID`), never an `anyOf` on its id, which is no
                # type or enum; a person is held to both where written
                # (`app/api/registrierungen/services.py :: compose_person`).
                "vorname": {"bsonType": _STRING_OR_NULL},
                "nachname": {"bsonType": _STRING_OR_NULL},
                "geburtsdatum": {"bsonType": _STRING_OR_NULL},
                "einwilligung": {**_EINWILLIGUNG, "bsonType": ["object", "null"]},
                # Out of `required`: the sentinel carries none. Stored as
                # `app/shared/folding.py :: sign_in_identifier` folds it, which is the form the
                # sign-in seam's equality compares against.
                "email": {"bsonType": _STRING_OR_NULL},
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
                "stufe",
                "position",
                "nummer",
                "inactive_since",
                "ist_nachnominiert",
                "rolle",
            ),
            properties={
                "_id": {"bsonType": "objectId"},
                "spieler_id": {"bsonType": "objectId"},
                "saison_id": {"bsonType": "string"},
                "team_id": {"bsonType": "objectId"},
                "ist_nachnominiert": {"bsonType": "bool"},
                # A null holds no role.
                "rolle": {"bsonType": _STRING_OR_NULL, "enum": [*_SPIELER_ROLLEN, None]},
                "stufe": {"bsonType": _STRING_OR_NULL, "enum": [*_STUFEN, None]},
                "position": {"bsonType": _STRING_OR_NULL, "enum": [*_POSITIONEN, None]},
                # A STRING, not an int. Squad numbers are worn, not counted.
                "nummer": {"bsonType": _STRING_OR_NULL},
                # `uniq_spieler_id_saison_id` keeps indexing a retired row, so a second create is a
                # DUPLICATE KEY answered 409 (`docs/backend/spec.md :: I20`).
                "inactive_since": _INACTIVE_SINCE,
                **_IDEMPOTENZ_PROPERTIES,
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
                # Out of `required` for `saisons.spielplan`'s reason. A missing key and a stored
                # null both read as a fixture nobody has annotated.
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
                # Null on the ghost alone, which stands behind nobody
                # (`app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`). Required all the same, so
                # `uniq_schiedsrichter_name` indexes one value per row rather than a missing key.
                "name": {"bsonType": _STRING_OR_NULL},
                "schule": {"bsonType": _STRING_OR_NULL},
                "default_payment": {"bsonType": "int"},
                "kontakt": _KONTAKT,
                "inactive_since": _INACTIVE_SINCE,
                # The confirmation bookkeeping a message to this referee is recorded against
                # (`app/api/zustellung/services.py :: ZIEL_PFADE`). Out of `required`: the ghost and
                # a row never minted a link carry none, and correcting an unconfirmed retired referee's address
                # removes it (`app/api/schiedsrichter/services.py :: compose_korrektur_update`).
                "bestaetigung": _SCHIEDSRICHTER_BESTAETIGUNG,
                # Out of `required` for the first two of `bestaetigung`'s reasons, and nullable
                # besides: only the person's own confirmation writes it, so a live row awaiting one
                # carries null.
                "einwilligung": {**_EINWILLIGUNG, "bsonType": ["object", "null"]},
                # Out of `required` for `saisons.spielplan`'s reason. The person's own to enter, as
                # a contact seat's is: no admin payload carries it.
                "geburtsdatum": {"bsonType": _STRING_OR_NULL},
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
                "stufengroesse",
                "wunschgegner",
                "entscheidung",
                "bestaetigungsfrist",
                "bestaetigungen",
            ),
            properties={
                "_id": {"bsonType": "objectId"},
                "saison_id": {"bsonType": "string"},
                "eingereicht_am": {"bsonType": "string"},
                "status": {"bsonType": "string", "enum": _BEWERBUNG_STATUS},
                # The club the applicant PICKED, null where they proposed a new school.
                "team_id": {"bsonType": ["objectId", "null"]},
                "schule": _BEWERBUNG_SCHULE,
                "kontakte": _BEWERBUNG_KONTAKTE,
                "trikot": _BEWERBUNG_TRIKOT,
                "kader": _BEWERBUNG_KADER,
                # How many pupils the school's whole Abi-Jahrgang holds.
                "stufengroesse": {"bsonType": "int"},
                # Free text, a school being free to name an opponent that has not applied, and null
                # where it names none.
                "wunschgegner": {"bsonType": _STRING_OR_NULL},
                "entscheidung": _BEWERBUNG_ENTSCHEIDUNG,
                # Both written by the submission, which mints every seat's link.
                "bestaetigungsfrist": {"bsonType": "string"},
                "bestaetigungen": _BEWERBUNG_BESTAETIGUNGEN,
                # The day the deletion notice was settled -- delivered, or the seat that would read
                # it emptied. The erasure's second condition: without it a failed erasure mails
                # again every hour. Out of `required`: only the sweep writes it.
                "loeschung_angekuendigt_am": {"bsonType": _STRING_OR_NULL},
                **_IDEMPOTENZ_PROPERTIES,
            },
        )
    },
    Collection.AKTIONEN: {
        "$jsonSchema": _object(
            required=(
                "_id",
                "at",
                "actor",
                "trace_id",
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
                # Out of `required`: the rows the log already holds carry none, and strict
                # validation refuses an erasure's `$set` over an invalid row. `record_write` stamps
                # every row it builds, so those are the only ones outside the retention.
                "at_date": {"bsonType": "date"},
                "actor": _AKTOR,
                # Required where `at_date` above is not: the rows the log already holds carry this
                # value under an older name, so a hand-run rename supplies it rather than the field
                # staying optional (`docs/ops/runbooks.md` §2 has that order and what it costs).
                "trace_id": {"bsonType": "string"},
                "request": _AKTION_REQUEST,
                "collection": {"bsonType": "string", "enum": [*_LOGGED_COLLECTIONS, *_LOGGED_ACTS]},
                "operation": {"bsonType": "string", "enum": _AKTION_OPERATIONS},
                # Whatever the recorded collection uses for its `_id`: an objectId everywhere but
                # `saisons`, whose is the season string. An array is `delete_many`'s removed ids,
                # which a redaction's `$in` selects on; null is a fan-out's.
                "document_id": {"bsonType": ["objectId", "string", "array", "null"]},
                "db_filter": {"bsonType": ["object", "null"]},
                # Deliberately unconstrained: it copies a document from whichever collection was
                # written, so a schema tight enough to be worth having would refuse the next one.
                # An array is `delete_many`'s, whose images are the whole record of what it removed.
                "before": {"bsonType": ["object", "array", "null"]},
                "modified_count": {"bsonType": _INT_OR_NULL},
                "redacted_at": {"bsonType": _STRING_OR_NULL},
                # Out of `required` for `at_date`'s reason: the rows the log already holds carry none,
                # and a backfill would be a one-off migration.
                "anlass": {"bsonType": _STRING_OR_NULL},
            },
        )
    },
    Collection.SPERRLISTE: {
        "$jsonSchema": _object(
            # Every key required and none nullable: a ban nobody is named for cannot be lifted by
            # the person who would know why.
            required=("_id", "adresse_hash", "schluessel_version", "grund", "erstellt_von", "erstellt_am", "gesperrt_bis_saison_id"),
            properties={
                "_id": {"bsonType": "objectId"},
                # Required above rather than optional: MongoDB indexes a missing key as null, so one
                # row without a hash would reserve that null against every later ban.
                "adresse_hash": {"bsonType": "string"},
                # No `enum`: a label this validator closed would refuse the rows keyed under the
                # previous one, which is exactly the population it exists to keep readable.
                "schluessel_version": {"bsonType": "string"},
                "grund": {"bsonType": "string"},
                "erstellt_von": {"bsonType": "string"},
                "erstellt_am": {"bsonType": "string"},
                # Required rather than optional-with-a-fallback: the lapse check compares this with
                # `$gte`, which passes over a row that lacks it -- a ban stopping in silence.
                "gesperrt_bis_saison_id": {"bsonType": "string"},
            },
        )
    },
    Collection.EINLADUNGEN: {
        "$jsonSchema": _object(
            required=("_id", "saison_id", "team_id", "token_hash", "erstellt_am", "erstellt_von", "widerrufen_am"),
            properties={
                "_id": {"bsonType": "objectId"},
                "saison_id": {"bsonType": "string"},
                "team_id": {"bsonType": "objectId"},
                # The whole credential, on no model and in no read: a link is recoverable from
                # nothing once this row holds it (`app/api/bewerbungen/services.py :: hash_token`).
                "token_hash": {"bsonType": "string"},
                "erstellt_am": {"bsonType": "string"},
                "erstellt_von": {"bsonType": "string"},
                # Required above rather than optional, for `sperrliste.adresse_hash`'s reason:
                # `uniq_einladung_live` reaches the rows holding null, and a row missing the key
                # would fall outside a rule that is the whole of one-live-invite-per-team.
                "widerrufen_am": {"bsonType": _STRING_OR_NULL},
                # The delivery carrier (`app/api/zustellung/services.py :: ZIEL_PFADE`), written
                # empty by the mint (`docs/backend/spec.md :: I276`). Out of `required`, so a
                # row seeded without one still stores; hand-written because `_object` would spell
                # the empty `required` mongod refuses.
                "versand": {"bsonType": ["object", "null"], "properties": {"zustellung": _ZUSTELLUNG}},
            },
        )
    },
    Collection.REGISTRIERUNGEN: {
        "$jsonSchema": _object(
            required=(
                "_id",
                "saison_id",
                "team_id",
                "einladung_id",
                "eingereicht_am",
                "status",
                "vorname",
                "nachname",
                "email",
                "position",
                "nummer",
                "stufe",
                "geburtsdatum",
                "einwilligung",
                "entscheidung",
            ),
            properties={
                "_id": {"bsonType": "objectId"},
                "saison_id": {"bsonType": "string"},
                "team_id": {"bsonType": "objectId"},
                "einladung_id": {"bsonType": "objectId"},
                "eingereicht_am": {"bsonType": "string"},
                "status": {"bsonType": "string", "enum": _REGISTRIERUNG_STATUS},
                "vorname": {"bsonType": "string"},
                "nachname": {"bsonType": "string"},
                # Unfolded, as the address rule stores it (`docs/backend/spec.md :: I332`). This is the
                # address the confirmation link was mailed to, and `spieler.email` holds the folded
                # form the sign-in seam joins on.
                "email": {"bsonType": "string"},
                "position": {"bsonType": _STRING_OR_NULL, "enum": [*_POSITIONEN, None]},
                # A STRING, not an int, as a squad row's is. Squad numbers are worn, not counted.
                "nummer": {"bsonType": _STRING_OR_NULL},
                "stufe": {"bsonType": _STRING_OR_NULL, "enum": [*_STUFEN, None]},
                # Required as KEYS and null until the pupil's own confirmation writes both in one
                # `$set` (`docs/backend/spec.md :: I285`).
                "geburtsdatum": {"bsonType": _STRING_OR_NULL},
                "einwilligung": _REGISTRIERUNG_EINWILLIGUNG,
                # Out of `required` as the other two carriers are (`app/api/zustellung/services.py
                # :: ZIEL_PFADE`): the accepted send skips a row holding no carrier at all, and a
                # row seeded without one still stores. Every submission composes it.
                "bestaetigung": _REGISTRIERUNG_BESTAETIGUNG,
                "entscheidung": _REGISTRIERUNG_ENTSCHEIDUNG,
                **_IDEMPOTENZ_PROPERTIES,
            },
        )
    },
    Collection.BERECHTIGUNGEN: {
        "$jsonSchema": _object(
            required=("_id", "adresse", "verwaltung", "erteilt_von", "erteilt_am"),
            properties={
                "_id": {"bsonType": "objectId"},
                # The folded sign-in identifier, which nothing here can check without a pattern
                # (`docs/backend/spec.md :: I16`): a row typed unfolded matches no request, and the
                # boot names it (`app/core/db.py :: warn_about_the_grants`).
                "adresse": {"bsonType": "string"},
                "verwaltung": {"bsonType": "string", "enum": _VERWALTUNG},
                "erteilt_von": {"bsonType": "string"},
                # A date and not the German day string the ban list stores: the Playground writes
                # `new Date()`, which is one spelling nobody can mistype.
                "erteilt_am": {"bsonType": "date"},
                # Out of `required`: a paste writes no such key, and the comparison stamps it on the
                # row it finds (`docs/backend/spec.md :: I525`).
                "gefunden_am": {"bsonType": ["date", "null"]},
                # Out of `required` for `gefunden_am`'s reason: a paste writes no such key.
                "gesehen_am": {"bsonType": ["date", "null"]},
                # Out of `required` too: a pasted `owner` row holds the tier from its grant's own date.
                "ernannt_am": {"bsonType": ["date", "null"]},
            },
        )
    },
    Collection.BERECHTIGUNGEN_ANGEKUENDIGT: {
        "$jsonSchema": _object(
            required=("_id", "adresse", "verwaltung", "angekuendigt_am"),
            properties={
                # The grant's own `_id`, so a revoke and a re-grant of one address are two changes
                # rather than none.
                "_id": {"bsonType": "objectId"},
                "adresse": {"bsonType": "string"},
                "verwaltung": {"bsonType": "string", "enum": _VERWALTUNG},
                "angekuendigt_am": {"bsonType": "date"},
            },
        )
    },
    Collection.BERECHTIGUNGEN_POSTAUSGANG: {
        "$jsonSchema": _object(
            required=(
                "_id",
                "berechtigung_id",
                "art",
                "urheber",
                "jetzt",
                "vorher",
                "geaendert_von",
                "geaendert_am",
                "vorenthalten",
                "erfasst_am",
                "beansprucht_bis",
                "beanspruchung",
                "versuche",
            ),
            properties={
                "_id": {"bsonType": "objectId"},
                "berechtigung_id": {"bsonType": "objectId"},
                "art": {"bsonType": "string", "enum": _BERECHTIGUNG_AENDERUNGEN},
                "urheber": {"bsonType": "string", "enum": _BERECHTIGUNG_URHEBER},
                "jetzt": _BERECHTIGUNG_STAND,
                "vorher": _BERECHTIGUNG_STAND,
                "geaendert_von": {"bsonType": _STRING_OR_NULL},
                "geaendert_am": {"bsonType": ["date", "null"]},
                # Why the grant's address is withheld, which its null never says by itself; a null actor
                # does, as a ban (`docs/backend/spec.md :: I661`).
                "vorenthalten": {"bsonType": _STRING_OR_NULL, "enum": [*_BERECHTIGUNG_VORENTHALTEN, None]},
                "erfasst_am": {"bsonType": "date"},
                # Required as keys and null until a pass claims the row: the claim asks for a null
                # lease, which a missing key would satisfy too and a mistyped one would hide.
                "beansprucht_bis": {"bsonType": ["date", "null"]},
                "beanspruchung": {"bsonType": _STRING_OR_NULL},
                "versuche": {"bsonType": "int"},
            },
        )
    },
    Collection.DROSSELUNG: {
        "$jsonSchema": _object(
            # `ablauf` too: the collection held no row before its TTL index, and a row without it is never expired.
            required=("_id", "n", "ablauf"),
            properties={
                # `<Funktion>:<pseudonym>:<YYYY-MM-DD>`, so a new German day is a new row and no reset is written.
                "_id": {"bsonType": "string"},
                "n": {"bsonType": "int"},
                "ablauf": {"bsonType": "date"},
            },
        )
    },
    Collection.ADRESSANKER: {
        "$jsonSchema": _object(
            # `geschrieben_am` too, for the day count's reason: a row without it is never expired. The anchor field is
            # left undeclared, as on every collection an anchor advances.
            required=("_id", "geschrieben_am"),
            properties={
                # The keyed hash of a folded address (`app/core/adressanker.py :: adressanker_id`), never the address.
                "_id": {"bsonType": "string"},
                "geschrieben_am": {"bsonType": "date"},
            },
        )
    },
    Collection.SPIELBESTAETIGUNGEN: {
        "$jsonSchema": _object(
            # No key arrived late: every row is written by the pass that mints it.
            required=(
                "_id",
                "saison_id",
                "spiel_id",
                "partei",
                "ansetzung",
                "frist",
                "angefragt_am",
                "erinnert_am",
                "kontakte",
                "antwort",
                "geschlossen",
            ),
            properties={
                "_id": {"bsonType": "objectId"},
                "saison_id": {"bsonType": "string"},
                "spiel_id": {"bsonType": "objectId"},
                "partei": _SPIELBESTAETIGUNG_PARTEI,
                "ansetzung": _SPIELBESTAETIGUNG_ANSETZUNG,
                # STORED for `_SCHIEDSRICHTER_BESTAETIGUNG`'s reason.
                "frist": {"bsonType": "string"},
                "angefragt_am": {"bsonType": _STRING_OR_NULL},
                "erinnert_am": {"bsonType": "array", "items": {"bsonType": "string"}},
                "kontakte": _SPIELBESTAETIGUNG_KONTAKTE,
                "antwort": _SPIELBESTAETIGUNG_ANTWORT,
                "geschlossen": _SPIELBESTAETIGUNG_GESCHLOSSEN,
            },
        )
    },
    Collection.SPIELBERICHTE: {
        "$jsonSchema": _object(
            required=("_id", "saison_id", "spiel_id", "bericht"),
            properties={
                "_id": {"bsonType": "objectId"},
                "saison_id": {"bsonType": "string"},
                "spiel_id": {"bsonType": "objectId"},
                "bericht": _SPIELBERICHT_BERICHT,
            },
        )
    },
    Collection.ADRESSWECHSEL: {
        "$jsonSchema": _object(
            required=(
                "_id",
                "adresse",
                "email",
                "weg",
                "token_hash",
                "stopp_hash",
                "verschickt_am",
                "gueltig_bis",
                "freigegeben_am",
                "grund",
                "bestaetigt_am",
                "wirksam_ab",
                "versand",
                "genehmigung",
                "beendet",
            ),
            properties={
                "_id": {"bsonType": "objectId"},
                # The key, folded; null once ended, as `email` and `grund` are: a tombstone holds no address.
                "adresse": {"bsonType": _STRING_OR_NULL},
                "email": {"bsonType": _STRING_OR_NULL},
                "weg": {"bsonType": "string", "enum": _ADRESSWECHSEL_WEGE},
                # Here and on no model, as `einladungen.token_hash` is. Null while the address on file's approval is asked.
                "token_hash": {"bsonType": _STRING_OR_NULL},
                "stopp_hash": {"bsonType": "string"},
                "verschickt_am": {"bsonType": "string"},
                # STORED for `_SCHIEDSRICHTER_BESTAETIGUNG`'s reason, an instant where that one is a day.
                "gueltig_bis": {"bsonType": ["date", "null"]},
                "freigegeben_am": {"bsonType": ["date", "null"]},
                "grund": {"bsonType": _STRING_OR_NULL},
                "bestaetigt_am": {"bsonType": ["date", "null"]},
                "wirksam_ab": {"bsonType": ["date", "null"]},
                # The delivery carrier (`app/api/zustellung/services.py :: ZIEL_PFADE`), hand-written for `einladungen.versand`'s reason.
                "versand": {"bsonType": ["object", "null"], "properties": {"zustellung": _ZUSTELLUNG}},
                "genehmigung": _ADRESSWECHSEL_GENEHMIGUNG,
                "beendet": _ADRESSWECHSEL_BEENDET,
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
    # Which rows the rule reaches. `report_duplicates` matches on it too, or `--check` would name a
    # duplicate group the index never indexed and stop a boot the index would have allowed.
    partial_filter: Mapping[str, Any] | None = None


UNIQUE_INDEXES: Sequence[UniqueIndex] = (
    UniqueIndex(Collection.SAISON_TEAMS, "uniq_saison_id_team_id", ("saison_id", "team_id"), "one junction row per team per season"),
    UniqueIndex(Collection.SAISON_SPIELER, "uniq_spieler_id_saison_id", ("spieler_id", "saison_id"), "one junction row per player per season"),
    UniqueIndex(Collection.SPIELE, "uniq_saison_id_spiel_nr", ("saison_id", "spiel_nr"), "a spiel_nr identifies one match within a season"),
    UniqueIndex(Collection.TEAMS, "uniq_shorthand", ("shorthand",), "a shorthand identifies exactly one team"),
    # Retired rows included, as `uniq_shorthand` includes them, and refused at the CREATE because
    # nothing merges two of these: a second row under one name would be a state only a person could
    # undo, by renaming one.
    UniqueIndex(Collection.SPIELORTE, "uniq_spielort_name", ("name",), "a name identifies exactly one venue"),
    # Every row, as the venue index above takes every row: an erasure deletes the referee rather
    # than nulling them, so the one null name this can meet is the ghost's and there is only ever
    # one ghost (`app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`).
    UniqueIndex(Collection.SCHIEDSRICHTER, "uniq_schiedsrichter_name", ("name",), "a name identifies exactly one referee"),
    # The phase is a key, not a filter: positions restart at 1 in each phase, so a season legitimately
    # holds several matchdays numbered 1.
    UniqueIndex(
        Collection.SPIELTAGE,
        "uniq_saison_id_saison_phase_position",
        ("saison_id", "saison_phase", "position"),
        "one matchday per position within a phase of a season",
    ),
    # It is also the READ path: the sign-up check is one indexed equality against this key, so
    # dropping the index costs a collection scan per submission as well as the rule.
    UniqueIndex(Collection.SPERRLISTE, "uniq_sperrliste_adresse_hash", ("adresse_hash",), "one entry per banned address"),
    # `$type` rather than the equality `{"widerrufen_am": None}`, which also matches a row missing
    # the key: MongoDB's manual names `$type` among the operators a `partialFilterExpression`
    # supports and names no null form at all
    # (https://www.mongodb.com/docs/manual/core/index-partial/, which moves without us; read
    # 2026-09-21).
    UniqueIndex(
        Collection.EINLADUNGEN,
        "uniq_einladung_live",
        ("saison_id", "team_id"),
        "one live invite per team per season",
        partial_filter={"widerrufen_am": {"$type": "null"}},
    ),
    # `$type` for the reason above: a missing key indexes as null, so without the filter the second
    # row stored before the key would collide with the first.
    UniqueIndex(
        Collection.BEWERBUNGEN,
        "uniq_bewerbung_idempotenz_schluessel",
        ("idempotenz_schluessel",),
        "one application per submission key",
        partial_filter={"idempotenz_schluessel": {"$type": "string"}},
    ),
    UniqueIndex(
        Collection.REGISTRIERUNGEN,
        "uniq_registrierung_idempotenz_schluessel",
        ("idempotenz_schluessel",),
        "one registration per submission key",
        partial_filter={"idempotenz_schluessel": {"$type": "string"}},
    ),
    # The same key after its registration was admitted, so a replay finds it here once the row above
    # is gone. Filtered for the reason above: a squad row an administrator wrote carries none.
    UniqueIndex(
        Collection.SAISON_SPIELER,
        "uniq_saison_spieler_idempotenz_schluessel",
        ("idempotenz_schluessel",),
        "one admitted registration per submission key",
        partial_filter={"idempotenz_schluessel": {"$type": "string"}},
    ),
    # One stored person per address, firing where two admissions for one new address race. Filtered
    # on `$type`, so persons holding no address are not one null key; an equality reader carries the
    # term or scans.
    UniqueIndex(
        Collection.SPIELER,
        "uniq_spieler_email",
        ("email",),
        "one person per address",
        partial_filter={"email": {"$type": "string"}},
    ),
    # Partial, because the league keeps every season it ever played: unfiltered, the second `past`
    # row would be refused. Checked at each write rather than at the commit, so a rollover demotes
    # before it promotes (`app/api/saisons/admin_router.py :: activate_saison`).
    UniqueIndex(Collection.SAISONS, "uniq_saison_active", ("status",), "at most one season is active", partial_filter={"status": "active"}),
    # Also the READ path of every admin-tier request (`app/core/security.py :: verify_actor_is_admin`),
    # and what refuses a second grant a Playground paste adds for an address already holding one.
    UniqueIndex(Collection.BERECHTIGUNGEN, "uniq_berechtigung_adresse", ("adresse",), "one grant per address"),
    # What makes a pass run twice mint once, and a second decline need a new stand rather than a
    # refusal. Both party ids are keys, the one a row lacks indexing as null. `$type` for
    # `uniq_einladung_live`'s reason.
    UniqueIndex(
        Collection.SPIELBESTAETIGUNGEN,
        "uniq_spielbestaetigung_offen",
        ("spiel_id", "partei.art", "partei.team_id", "partei.schiedsrichter_id", "ansetzung.stand"),
        "one open confirmation per party per Ansetzung",
        partial_filter={"antwort": {"$type": "null"}, "geschlossen": {"$type": "null"}},
    ),
    # What makes two first writes of one fixture's report one document: the second insert meets this.
    UniqueIndex(Collection.SPIELBERICHTE, "uniq_spielbericht_spiel_id", ("spiel_id",), "one report per fixture"),
    # Two starts on one address meet here as a write conflict their transactions retry. The key's `$type` term keeps an
    # ending's null address out; a keyed read carries it too (`app/api/adresswechsel/services.py :: build_address_filter`),
    # or the planner scans.
    UniqueIndex(
        Collection.ADRESSWECHSEL,
        "uniq_adresswechsel_adresse",
        ("adresse",),
        "one live change per address",
        partial_filter={"beendet": {"$type": "null"}, "adresse": {"$type": "string"}},
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


SUPPORT_INDEXES: Sequence[SupportIndex] = (
    # `_id` is in the key because the read SORTS by it: with `at` alone MongoDB cannot walk this
    # index and scans the whole log instead -- measured, and the log holds twelve months of writes
    # (`app/api/aktionen/admin_router.py :: get_aktionen`).
    SupportIndex(
        Collection.AKTIONEN,
        "aktionen_queue",
        (("at", DESCENDING), ("_id", DESCENDING)),
        "the log page reads newest first",
    ),
    SupportIndex(
        Collection.AKTIONEN,
        "aktionen_trace_id",
        (("trace_id", ASCENDING),),
        "a write and its fan-out are read as one action",
    ),
    SupportIndex(
        Collection.AKTIONEN,
        "aktionen_target",
        (("collection", ASCENDING), ("document_id", ASCENDING)),
        "one document's history, and the rows a person's erasure must redact",
    ),
    # Every key `FACET_TALLY` groups on, in its `$sort`'s order: a group key missing here leaves that
    # sort blocking in memory, and where no other index serves the match, scanning the whole log,
    # images and all (`app/api/aktionen/admin_router.py :: FACET_TALLY`).
    SupportIndex(
        Collection.AKTIONEN,
        "aktionen_facets",
        (("collection", ASCENDING), ("operation", ASCENDING), ("actor.kind", ASCENDING)),
        "the counts the log page's three facets are told, over every recorded row",
    ),
    # `actor.pseudonym` leads: an erasure for a person's request matches on it alone, and the pupils' pass,
    # running for a whole season at once, on both (`app/api/identitaet/crud.py :: unattribute_in_session`,
    # `:: erase_pupil_actor_in_session`).
    SupportIndex(
        Collection.AKTIONEN,
        "aktionen_actor_pseudonym",
        (("actor.pseudonym", ASCENDING), ("actor.funktion", ASCENDING)),
        "the rows a person wrote, which their erasure marks inside its transaction",
    ),
    # Each ends in the read's own sort order, `eingereicht_am` then `_id`. Measured: with the sort
    # key unindexed every request scans the collection and sorts it in memory, which is work
    # proportional to an archive an anonymous form can grow.
    SupportIndex(
        Collection.BEWERBUNGEN,
        "bewerbungen_queue",
        (("eingereicht_am", DESCENDING), ("_id", DESCENDING)),
        "the triage queue unfiltered, newest first",
    ),
    SupportIndex(
        Collection.BEWERBUNGEN,
        "bewerbungen_saison_id_queue",
        (("saison_id", ASCENDING), ("eingereicht_am", DESCENDING), ("_id", DESCENDING)),
        "one season's queue, which is the operator's recovery path under a flood",
    ),
    # Its own index rather than a prefix of the one above: with `status` between them, a read
    # narrowed to a season alone could not walk the sort key and would block on a sort again.
    SupportIndex(
        Collection.BEWERBUNGEN,
        "bewerbungen_saison_id_status_queue",
        (("saison_id", ASCENDING), ("status", ASCENDING), ("eingereicht_am", DESCENDING), ("_id", DESCENDING)),
        "one season's queue narrowed to one status, which is what a triage tab reads",
    ),
    # `eingereicht_am` and `_id` past the count's own key: measured, a bare `("status",)` serves the
    # count and leaves the narrowed list read on another index, and three keys answer both.
    SupportIndex(
        Collection.BEWERBUNGEN,
        "bewerbungen_status_queue",
        (("status", ASCENDING), ("eingereicht_am", DESCENDING), ("_id", DESCENDING)),
        "every season's queue at one status, and the count each status is told",
    ),
    # An index, not a season-cache set: that cache is keyed by season id, and a missing set would
    # read as an empty one, which narrows on nothing
    # (`app/api/saisons/visibility.py :: withheld_saison_ids`).
    SupportIndex(
        Collection.SAISONS,
        "saisons_status",
        (("status", ASCENDING),),
        "the withheld-season set every unnarrowed base-tier read must exclude",
    ),
    # PLAIN rather than sparse or partial, though most referees carry no block: `SupportIndex`
    # spells no partial form, and the lookup is an equality on a hex digest, which the single null
    # key a block-less row adds cannot match.
    SupportIndex(
        Collection.SCHIEDSRICHTER,
        "schiedsrichter_bestaetigung_token_hash",
        (("bestaetigung.token_hash", ASCENDING),),
        "the referee confirmation page's lookup, driven by strangers",
    ),
    # PLAIN for the index above's reason: a tombstone keeps its hashes, so each link answers how its change ended.
    SupportIndex(
        Collection.ADRESSWECHSEL,
        "adresswechsel_token_hash",
        (("token_hash", ASCENDING),),
        "the address page's lookup, driven by strangers",
    ),
    SupportIndex(
        Collection.ADRESSWECHSEL,
        "adresswechsel_stopp_hash",
        (("stopp_hash", ASCENDING),),
        "the address page's stop lookup, driven by strangers",
    ),
    # Not a unique one, though a hash collides with nothing: a revoked row keeps its hash, so the
    # key holds as many rows as the team has been reissued links.
    SupportIndex(
        Collection.EINLADUNGEN,
        "einladungen_token_hash",
        (("token_hash", ASCENDING),),
        "the invite page's lookup, driven by strangers",
    ),
    # Two indexes for one `$or`: "all the clauses in the $or expression must be supported by
    # indexes. Otherwise, MongoDB performs a collection scan." Mirrored from
    # https://www.mongodb.com/docs/manual/reference/operator/query/or/, which moves without us;
    # read 2026-09-21.
    SupportIndex(
        Collection.REGISTRIERUNGEN,
        "registrierungen_bestaetigung_token_hash",
        (("bestaetigung.token_hash", ASCENDING),),
        "the confirmation page's lookup, driven by strangers",
    ),
    SupportIndex(
        Collection.REGISTRIERUNGEN,
        "registrierungen_bestaetigung_token_hash_zuvor",
        (("bestaetigung.token_hash_zuvor", ASCENDING),),
        "the same lookup through the link a reminder replaced, which stays live beside the fresh one",
    ),
    # One per clause of each `$or`, for the registration's pair's reason: a contact seat's link is
    # looked up on whichever seat holds it, an application's on either of its two hashes.
    *(
        SupportIndex(
            Collection.SAISON_TEAMS,
            f"saison_teams_bestaetigungen_{seat}_token_hash",
            ((f"bestaetigungen.{seat}.token_hash", ASCENDING),),
            "a contact seat's confirmation page, through the season row's lookup, driven by strangers",
        )
        for seat in _KONTAKTE_REQUIRED[:3]
    ),
    *(
        SupportIndex(
            Collection.BEWERBUNGEN,
            f"bewerbungen_bestaetigungen_{seat}_{field}",
            ((f"bestaetigungen.{seat}.{field}", ASCENDING),),
            "a contact seat's confirmation page, through the application's lookup, driven by strangers",
        )
        for seat in _KONTAKTE_REQUIRED[:3]
        for field in ("token_hash", "token_hash_zuvor")
    ),
    # `status` sits after the sort keys, the read being free to omit it: an index serves a sort
    # "only when the query includes equality conditions on all prefix keys that precede the sort
    # keys." Mirrored from
    # https://www.mongodb.com/docs/manual/tutorial/equality-sort-range-guideline/; read 2026-09-21.
    SupportIndex(
        Collection.REGISTRIERUNGEN,
        "registrierungen_saison_id_team_id_queue",
        (("saison_id", ASCENDING), ("team_id", ASCENDING), ("eingereicht_am", DESCENDING), ("_id", DESCENDING), ("status", ASCENDING)),
        "one team's pending registrations for one season, newest first, narrowed by status or not",
    ),
    SupportIndex(
        Collection.SPIELBESTAETIGUNGEN,
        "spielbestaetigungen_saison_id_spiel_id",
        (("saison_id", ASCENDING), ("spiel_id", ASCENDING)),
        "a season's or one fixture's confirmations, which the pass, the admin read and the verdict filter on",
    ),
    # One per clause of the token filter's `$or`, for the registration's pair's reason; each multikey,
    # a seat keeping every link it was mailed.
    *(
        SupportIndex(
            Collection.SPIELBESTAETIGUNGEN,
            f"spielbestaetigungen_kontakte_{seat}_token_hashes",
            ((f"kontakte.{seat}.token_hashes", ASCENDING),),
            "a fixture confirmation link's lookup, driven by strangers",
        )
        for seat in _KONTAKTE_REQUIRED[:3]
    ),
    # A collection with no retention bound, read inside every contact erasure's and Widerspruch's transaction.
    SupportIndex(
        Collection.SPIELBESTAETIGUNGEN,
        "spielbestaetigungen_antwort_von_halter",
        (("antwort.von.halter", ASCENDING),),
        "the reasons a leaving contact typed, from whichever seat",
    ),
    SupportIndex(
        Collection.SPIELBERICHTE,
        "spielberichte_saison_id",
        (("saison_id", ASCENDING),),
        "a season's reports, which the triage's read and a replace's or an undraw's removal filter on",
    ),
    # For `spielbestaetigungen_antwort_von_halter`'s reason: the reports are kept with no retention bound.
    SupportIndex(
        Collection.SPIELBERICHTE,
        "spielberichte_eingereicht_von_schiedsrichter_id",
        (("bericht.eingereicht_von.schiedsrichter_id", ASCENDING),),
        "the reports a leaving referee sent, read inside their erasure's transaction",
    ),
    # The report reads it on every form and panel read and twice on every write, as do a team's
    # registrations and squad pages; the only index led by `saison_id` is led by the pupil instead.
    SupportIndex(
        Collection.SAISON_SPIELER,
        "saison_spieler_saison_id_team_id",
        (("saison_id", ASCENDING), ("team_id", ASCENDING)),
        "one season's squad rows of one or two clubs",
    ),
)


@dataclass(frozen=True)
class TTLIndex:
    """One collection's retention, applied by the database rather than by a sweep in this codebase.

    Separate from `SupportIndex` because dropping one of these costs retention, not speed and not
    correctness: every row stays, and nothing anywhere reports that it did.
    """

    collection: str
    name: str
    # ONE field, and a date one: MongoDB's manual documents a compound index as ignoring
    # `expireAfterSeconds` outright and a non-date value as never expiring, each in silence. Mirrored
    # from https://www.mongodb.com/docs/manual/core/index-ttl/, which moves without us; read 2026-09-04.
    key: str
    seconds: int
    rule: str


TTL_INDEXES: Sequence[TTLIndex] = (
    # Not `at`, though it names the same instant: it is a string, which this index would accept and
    # then expire nothing under, for as long as anyone left it there.
    TTLIndex(
        Collection.AKTIONEN,
        "aktionen_retention",
        "at_date",
        AKTION_RETENTION_SECONDS,
        "a log row is kept for twelve months after the write it recorded",
    ),
    # Zero: `ablauf` is already the German midnight ending the day the row counts.
    TTLIndex(Collection.DROSSELUNG, "drosselung_ablauf", "ablauf", 0, "a day's write count is removed once its German day has ended"),
    # Zero: an anchor serves only the transactions open while it is written, and its removal is itself a
    # write that one of them meets as a conflict, so no later removal is ever safer (`docs/backend/spec.md :: I719`).
    TTLIndex(
        Collection.ADRESSANKER,
        "adressanker_geschrieben_am",
        "geschrieben_am",
        0,
        "an address's anchor is removed once the TTL monitor next passes after its last write",
    ),
    # A live change never expires, holding no date at `beendet.am`: the hourly pass ends it, taking its address out of the
    # log images, which a TTL deletion never would.
    TTLIndex(
        Collection.ADRESSWECHSEL,
        "adresswechsel_beendet_am",
        "beendet.am",
        ADRESSWECHSEL_NACHLAUF_TAGE * 86400,
        "an ended address change is removed once its tombstone's retention has passed",
    ),
)


@dataclass(frozen=True)
class ConstraintSummary:
    validators: int
    # Counted apart because they are applied differently: a validator is replaced, an index is only
    # ever added. One number for both is what let a deploy report six indexes as "unique".
    unique_indexes: int
    support_indexes: int
    ttl_indexes: int


async def _apply_validator(db: AsyncDatabase, collection_name: str, validator: Mapping[str, Any]) -> None:
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


class _PartialFilterOption(TypedDict, total=False):
    """Typed rather than a plain `dict`, which pyright unpacks against `create_index`'s `session` parameter and refuses."""

    partialFilterExpression: Mapping[str, Any]


async def _apply_unique_index(db: AsyncDatabase, index: UniqueIndex) -> None:
    # Omitted rather than passed as `None` where a rule reaches every row: an omitted key and
    # `partialFilterExpression=None` are different options under one name, and `create_index` refuses
    # a name already held at different ones (`docs/ops/runbooks.md` §2).
    partial_option: _PartialFilterOption = {"partialFilterExpression": index.partial_filter} if index.partial_filter is not None else {}

    try:
        await db[index.collection].create_index([(key, ASCENDING) for key in index.keys], name=index.name, unique=True, **partial_option)
    except OperationFailure as failure:
        raise RuntimeError(f"Could not build unique index '{index.collection}.{index.name}' ({index.rule}): {failure}") from failure


async def _apply_support_index(db: AsyncDatabase, support: SupportIndex) -> None:
    try:
        await db[support.collection].create_index(list(support.keys), name=support.name)
    except OperationFailure as failure:
        raise RuntimeError(f"Could not build support index '{support.collection}.{support.name}' ({support.rule}): {failure}") from failure


async def _apply_ttl_index(db: AsyncDatabase, ttl: TTLIndex) -> None:
    try:
        await db[ttl.collection].create_index([(ttl.key, ASCENDING)], name=ttl.name, expireAfterSeconds=ttl.seconds)
    except OperationFailure as failure:
        raise RuntimeError(f"Could not build TTL index '{ttl.collection}.{ttl.name}' ({ttl.rule}): {failure}") from failure


# One declared operation, not yet started: a coroutine built for a lane that stops early would be
# left un-awaited, which is a warning rather than an error and so goes unseen.
_Runner = Callable[[], Awaitable[None]]


async def _run_lane(lane: Sequence[tuple[int, _Runner]]) -> tuple[int, Exception] | None:
    """Run one namespace's operations in order, stopping at the first that fails.

    The failure is RETURNED, not raised: raising it would hand the caller whichever lane lost the
    race, and the caller owes a promise about which failure that is.
    """
    for position, run in lane:
        try:
            await run()
        # `Exception` and not `BaseException`: a cancellation escapes the lane, short-circuits `gather` and
        # reaches the caller whatever its declared position. Ranking it would make a stopped boot wait for
        # every slower lane first.
        except Exception as failure:
            return position, failure

    return None


async def _apply_concurrently(declared: Sequence[tuple[str, _Runner]]) -> None:
    """Apply `declared` concurrently and raise the `Exception` DECLARED first, not the one that arrived.

    One lane per namespace: MongoDB documents `create` as locking the collection it names, and
    documents nothing about two index builds racing on one.
    """
    lanes: dict[str, list[tuple[int, _Runner]]] = {}
    # Numbered BEFORE the split, so a rank is the DECLARED position and not the position within a lane:
    # `aktionen_trace_id` does not open its lane and `bewerbungen_queue` does, so per-lane
    # numbering would report the later-declared one.
    for position, (namespace, run) in enumerate(declared):
        lanes.setdefault(namespace, []).append((position, run))

    # Nothing short-circuits: `_run_lane` returns its failure rather than raising, so every other
    # lane runs on to completion and a failed apply leaves MORE applied than a sequential one
    # would. Safe because each operation here is idempotent.
    outcomes = await asyncio.gather(*(_run_lane(lane) for lane in lanes.values()))
    failures = [outcome for outcome in outcomes if outcome is not None]

    if failures:
        raise min(failures, key=lambda failure: failure[0])[1]


async def apply_constraints(db: AsyncDatabase) -> ConstraintSummary:
    """Apply every validator, then every index, to `db`.

    A validator is REPLACED, an index only ever ADDED: narrowing a rule to a `partial_filter` means
    dropping the live index by hand first (`docs/ops/runbooks.md` §2). Raises the `Exception` declared
    first.
    """
    # Two phases rather than one: building an index CREATES its collection implicitly and without a
    # validator, so an overlap would leave a collection nothing ever validates.
    await _apply_concurrently(
        [
            (collection_name, partial(_apply_validator, db, collection_name, validator))
            for collection_name, validator in COLLECTION_VALIDATORS.items()
        ]
    )

    await _apply_concurrently(
        [
            *((index.collection, partial(_apply_unique_index, db, index)) for index in UNIQUE_INDEXES),
            *((support.collection, partial(_apply_support_index, db, support)) for support in SUPPORT_INDEXES),
            *((ttl.collection, partial(_apply_ttl_index, db, ttl)) for ttl in TTL_INDEXES),
        ]
    )

    return ConstraintSummary(
        validators=len(COLLECTION_VALIDATORS),
        unique_indexes=len(UNIQUE_INDEXES),
        support_indexes=len(SUPPORT_INDEXES),
        ttl_indexes=len(TTL_INDEXES),
    )


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


async def report_violations(db: AsyncDatabase) -> list[ViolationReport]:
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


async def report_duplicates(db: AsyncDatabase) -> list[DuplicateReport]:
    reports: list[DuplicateReport] = []

    for index in UNIQUE_INDEXES:
        offenders: list[Mapping[str, Any]] = [
            # The index's own reach, ahead of the grouping: rows outside it would group as a
            # duplicate the boot never refuses, sending an operator to repair data the index ignores.
            *([{"$match": dict(index.partial_filter)}] if index.partial_filter is not None else []),
            # A group key may hold no `.`, so a key inside a sub-document is named with `_`; its value,
            # a missing key's null included, is what the index compares.
            {"$group": {"_id": {key.replace(".", "_"): f"${key}" for key in index.keys}, "n": {"$sum": 1}}},
            {"$match": {"n": {"$gt": 1}}},
        ]
        counted = await (await db[index.collection].aggregate([*offenders, {"$count": "groups"}])).to_list(length=1)
        examples = await (await db[index.collection].aggregate([*offenders, {"$limit": 5}])).to_list(length=5)

        reports.append(
            DuplicateReport(
                index=index,
                groups=counted[0]["groups"] if counted else 0,
                examples=[doc["_id"] for doc in examples],
            )
        )

    return reports


async def report_relations(db: AsyncDatabase) -> list[RelationReport]:
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

    counted = await (await db[Collection.SPIELE].aggregate([*spieltag_occupancy, {"$count": "groups"}])).to_list(length=1)
    examples = await (await db[Collection.SPIELE].aggregate([*spieltag_occupancy, {"$limit": 5}])).to_list(length=5)

    # Reported rather than swept once: nothing in the API can create a phantom or remove one, so
    # this report is the only thing that would ever surface it.

    phantom_junctions: list[Mapping[str, Any]] = [
        {"$lookup": {"from": Collection.TEAMS, "localField": "team_id", "foreignField": "_id", "as": "club"}},
        {"$match": {"club": []}},
        {"$group": {"_id": {"team_id": "$team_id"}, "saisons": {"$addToSet": "$saison_id"}}},
    ]

    orphans_counted = await (await db[Collection.SAISON_TEAMS].aggregate([*phantom_junctions, {"$count": "groups"}])).to_list(length=1)
    orphans = await (await db[Collection.SAISON_TEAMS].aggregate([*phantom_junctions, {"$limit": 5}])).to_list(length=5)

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


# The rule the `spieler` validator cannot state, its two nullable keys being the sentinel's alone.
NAMELESS_PERSON_RULE = "a person is named, dated and holds a consent record (spieler)"


async def report_nameless_persons(db: AsyncDatabase) -> RelationReport:
    """Count the persons with a null forename, birthdate or consent record, writing nothing.

    A null forename or birthdate 500s the admin's membership list, the forename the team's squad too;
    the admission refuses to admit into a null record.
    """

    # By its id, as every read excludes the sentinel, and by `$type` rather than null, so a missing key
    # stays the validator report's alone.
    nameless = {
        "_id": {"$ne": GHOST_SPIELER_ID},
        "$or": [{"vorname": {"$type": "null"}}, {"geburtsdatum": {"$type": "null"}}, {"einwilligung": {"$type": "null"}}],
    }
    collection = db[Collection.SPIELER]

    return RelationReport(
        rule=NAMELESS_PERSON_RULE,
        groups=await collection.count_documents(nameless),
        examples=[doc["_id"] for doc in await collection.find(nameless, {"_id": 1}).limit(5).to_list(length=5)],
    )


# One adapter per type a read model gives a stored value, each that model's own, so the report refuses
# exactly what a read does (`fl_backend/tests/core/test_constraints.py` holds each path's two equal).
_NON_EMPTY = TypeAdapter(CustomNonEmptyString)
_NON_EMPTY_OR_NULL = TypeAdapter(CustomNonEmptyString | None)
_DAY = TypeAdapter(CustomDateString)
_DAY_OR_NULL = TypeAdapter(CustomDateString | None)
_OPTIONAL_DAY = TypeAdapter(CustomOptionalDateString)
_TIME_OR_NULL = TypeAdapter(CustomTimeString | None)
_TIME = TypeAdapter(CustomTimeString)
_DAYS = TypeAdapter(list[CustomDateString])
_ERGEBNIS_OR_NULL = TypeAdapter(CustomErgebnisString | None)
_OPTIONAL_URL = TypeAdapter(CustomOptionalExternalUrl)
_SAISON_ID = TypeAdapter(Annotated[str, StringConstraints(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)])
_SHORTHAND = TypeAdapter(Annotated[str, StringConstraints(min_length=TEAM_SHORTHAND_LENGTH, max_length=TEAM_SHORTHAND_LENGTH)])
_HAUSNUMMER = TypeAdapter(Annotated[str, StringConstraints(pattern=HAUSNUMMER_PATTERN)])
# Restated: `app/shared/schemas/addresses.py :: FLAddress` spells its pattern inline.
_PLZ = TypeAdapter(Annotated[str, StringConstraints(pattern=r"^[0-9]{5}$")])
_DESCRIPTION = TypeAdapter(Annotated[str, StringConstraints(max_length=TEAM_DESCRIPTION_MAX_LENGTH)])
# Restated where a model spells its bound inline, as `_PLZ` is.
_Count = Annotated[int, Field(ge=0)]
_COUNT = TypeAdapter(_Count)
_POSITION = TypeAdapter(Annotated[int, Field(ge=1)])
_TORE_OR_NULL = TypeAdapter(_Count | None)
_ABOVE_ZERO = TypeAdapter(CustomSpielNr)
_QUALIFIERS = TypeAdapter(QualifiersPerGroup)
_GROUPS = TypeAdapter(NumberOfGroups)
_TEAMS_PER_GROUP = TypeAdapter(TeamsPerGroup)
_STUFEN = TypeAdapter(Annotated[list[FLSpielerStufe], Field(min_length=1)])
# The model whole: its validator refuses a level shoot-out, which no bound on either count states.
_SHOOTOUT_OR_NULL = TypeAdapter(FLSpielElfmeterschiessen | None)
_MINUTE = TypeAdapter(CustomSpielberichtMinute)

# A validator holds types and enums alone (`.claude/rules/backend.md` db), so a hand edit can store an
# empty name or a day no calendar holds, and a list serving that row answers 500 for every row
# (`SRV-VAL-001`).
SERVED_VALUES: Mapping[Collection, Mapping[str, TypeAdapter[Any]]] = {
    Collection.BERECHTIGUNGEN: {
        "adresse": _NON_EMPTY,
    },
    Collection.BERECHTIGUNGEN_ANGEKUENDIGT: {
        "adresse": _NON_EMPTY,
    },
    Collection.BERECHTIGUNGEN_POSTAUSGANG: {
        "versuche": _COUNT,
    },
    Collection.BEWERBUNGEN: {
        "eingereicht_am": _DAY,
        "bestaetigungsfrist": _DAY,
        "schule.team_name": _NON_EMPTY,
        "schule.full_name": _NON_EMPTY,
        "schule.shorthand": _SHORTHAND,
        "schule.address.strasse": _NON_EMPTY,
        "schule.address.hausnummer": _HAUSNUMMER,
        "schule.address.plz": _PLZ,
        "schule.address.stadt": _NON_EMPTY,
        "entscheidung.getroffen_am": _DAY,
        "kontakte.trainer.vorname": _NON_EMPTY,
        "kontakte.trainer.nachname": _NON_EMPTY,
        "kontakte.trainer.geburtsdatum": _OPTIONAL_DAY,
        "kontakte.ansprechperson.vorname": _NON_EMPTY,
        "kontakte.ansprechperson.nachname": _NON_EMPTY,
        "kontakte.ansprechperson.geburtsdatum": _OPTIONAL_DAY,
        "kontakte.stellvertretung.vorname": _NON_EMPTY,
        "kontakte.stellvertretung.nachname": _NON_EMPTY,
        "kontakte.stellvertretung.geburtsdatum": _OPTIONAL_DAY,
        "kontakte.trainer.einwilligung.datum": _DAY,
        "kontakte.trainer.einwilligung.bestaetigt_am": _OPTIONAL_DAY,
        "kontakte.ansprechperson.einwilligung.datum": _DAY,
        "kontakte.ansprechperson.einwilligung.bestaetigt_am": _OPTIONAL_DAY,
        "kontakte.stellvertretung.einwilligung.datum": _DAY,
        "kontakte.stellvertretung.einwilligung.bestaetigt_am": _OPTIONAL_DAY,
        "bestaetigungen.trainer.verschickt_am": _DAY,
        "bestaetigungen.trainer.erinnert_am": _OPTIONAL_DAY,
        "bestaetigungen.trainer.abgelehnt_am": _OPTIONAL_DAY,
        "bestaetigungen.ansprechperson.verschickt_am": _DAY,
        "bestaetigungen.ansprechperson.erinnert_am": _OPTIONAL_DAY,
        "bestaetigungen.ansprechperson.abgelehnt_am": _OPTIONAL_DAY,
        "bestaetigungen.stellvertretung.verschickt_am": _DAY,
        "bestaetigungen.stellvertretung.erinnert_am": _OPTIONAL_DAY,
        "bestaetigungen.stellvertretung.abgelehnt_am": _OPTIONAL_DAY,
    },
    Collection.EINLADUNGEN: {
        "saison_id": _NON_EMPTY,
        "erstellt_am": _DAY,
        "erstellt_von": _NON_EMPTY,
        "widerrufen_am": _OPTIONAL_DAY,
    },
    Collection.REGISTRIERUNGEN: {
        "eingereicht_am": _DAY,
        "vorname": _NON_EMPTY,
        "nachname": _NON_EMPTY,
        "email": _NON_EMPTY,
        "geburtsdatum": _OPTIONAL_DAY,
        "einwilligung.datum": _OPTIONAL_DAY,
        "einwilligung.bestaetigt_am": _OPTIONAL_DAY,
        "bestaetigung.verschickt_am": _DAY,
        "bestaetigung.erinnert_am": _OPTIONAL_DAY,
        "bestaetigung.frist": _DAY,
        "entscheidung.getroffen_am": _DAY,
        "entscheidung.von": _NON_EMPTY,
    },
    Collection.SAISON_SPIELER: {
        "inactive_since": _OPTIONAL_DAY,
    },
    Collection.SAISON_TEAMS: {
        "austritt.grund": _NON_EMPTY,
        "austritt.datum": _DAY,
        "kontakte.trainer.vorname": _NON_EMPTY,
        "kontakte.trainer.nachname": _NON_EMPTY,
        "kontakte.trainer.geburtsdatum": _OPTIONAL_DAY,
        "kontakte.ansprechperson.vorname": _NON_EMPTY,
        "kontakte.ansprechperson.nachname": _NON_EMPTY,
        "kontakte.ansprechperson.geburtsdatum": _OPTIONAL_DAY,
        "kontakte.stellvertretung.vorname": _NON_EMPTY,
        "kontakte.stellvertretung.nachname": _NON_EMPTY,
        "kontakte.stellvertretung.geburtsdatum": _OPTIONAL_DAY,
        "kontakte.trainer.einwilligung.datum": _DAY,
        "kontakte.trainer.einwilligung.bestaetigt_am": _OPTIONAL_DAY,
        "kontakte.ansprechperson.einwilligung.datum": _DAY,
        "kontakte.ansprechperson.einwilligung.bestaetigt_am": _OPTIONAL_DAY,
        "kontakte.stellvertretung.einwilligung.datum": _DAY,
        "kontakte.stellvertretung.einwilligung.bestaetigt_am": _OPTIONAL_DAY,
        "bestaetigungen.trainer.verschickt_am": _DAY,
        "bestaetigungen.trainer.frist": _DAY,
        "bestaetigungen.trainer.abgelehnt_am": _OPTIONAL_DAY,
        "bestaetigungen.ansprechperson.verschickt_am": _DAY,
        "bestaetigungen.ansprechperson.frist": _DAY,
        "bestaetigungen.ansprechperson.abgelehnt_am": _OPTIONAL_DAY,
        "bestaetigungen.stellvertretung.verschickt_am": _DAY,
        "bestaetigungen.stellvertretung.frist": _DAY,
        "bestaetigungen.stellvertretung.abgelehnt_am": _OPTIONAL_DAY,
    },
    Collection.SAISONS: {
        "start_date": _DAY,
        "end_date": _DAY,
        "_id": _SAISON_ID,
        "spielplan.generiert_am": _DAY,
        "bewerbung.von": _DAY,
        "bewerbung.bis": _DAY,
        "registrierung.von": _DAY,
        "registrierung.bis": _DAY,
        "rules.win_points": _ABOVE_ZERO,
        "rules.draw_points": _COUNT,
        "rules.qualifiers_per_group": _QUALIFIERS,
        "rules.number_of_groups": _GROUPS,
        "rules.teams_per_group": _TEAMS_PER_GROUP,
        "rules.max_kadergroesse": _ABOVE_ZERO,
        "rules.forfeit_ergebnis.sieger_tore": _COUNT,
        "rules.forfeit_ergebnis.verlierer_tore": _COUNT,
        "rules.erlaubte_stufen": _STUFEN,
        "spielplan.spieltage": _COUNT,
        "spielplan.spiele": _COUNT,
    },
    Collection.SCHIEDSRICHTER: {
        "name": _NON_EMPTY_OR_NULL,
        "default_payment": _COUNT,
        "inactive_since": _OPTIONAL_DAY,
        "geburtsdatum": _OPTIONAL_DAY,
        "bestaetigung.verschickt_am": _DAY,
        "bestaetigung.erinnert_am": _OPTIONAL_DAY,
        "bestaetigung.frist": _DAY,
        "einwilligung.datum": _DAY,
        "einwilligung.bestaetigt_am": _OPTIONAL_DAY,
    },
    Collection.SPERRLISTE: {
        "grund": _NON_EMPTY,
        "erstellt_von": _NON_EMPTY,
        "erstellt_am": _DAY,
        "gesperrt_bis_saison_id": _SAISON_ID,
    },
    Collection.SPIELBESTAETIGUNGEN: {
        "frist": _DAY,
        "angefragt_am": _OPTIONAL_DAY,
        "erinnert_am": _DAYS,
        "ansetzung.datum": _DAY,
        "ansetzung.uhrzeit": _TIME,
        "antwort.am": _DAY,
        "antwort.begruendung": _NON_EMPTY_OR_NULL,
        "antwort.vorschlag.datum": _DAY,
        "antwort.vorschlag.uhrzeit": _TIME,
        "geschlossen.am": _DAY,
    },
    Collection.SPIELE: {
        "datum": _DAY_OR_NULL,
        "uhrzeit": _TIME_OR_NULL,
        "ergebnis": _ERGEBNIS_OR_NULL,
        "saison_id": _SAISON_ID,
        "team1.name": _NON_EMPTY,
        "team1.shorthand": _SHORTHAND,
        "team2.name": _NON_EMPTY,
        "team2.shorthand": _SHORTHAND,
        "ort.name": _NON_EMPTY,
        "ort.maps_link": _NON_EMPTY,
        "ort.mietpreis": _COUNT,
        "schiedsrichter.name": _NON_EMPTY_OR_NULL,
        "schiedsrichter.payment": _COUNT,
        "spiel_nr": _ABOVE_ZERO,
        "team1.tore": _TORE_OR_NULL,
        "team2.tore": _TORE_OR_NULL,
        "team1_quelle.platz": _ABOVE_ZERO,
        "team1_quelle.spiel_nr": _ABOVE_ZERO,
        "team2_quelle.platz": _ABOVE_ZERO,
        "team2_quelle.spiel_nr": _ABOVE_ZERO,
        "elfmeterschiessen": _SHOOTOUT_OR_NULL,
        "elfmeterschiessen.team1": _COUNT,
        "elfmeterschiessen.team2": _COUNT,
    },
    Collection.SPIELBERICHTE: {
        "bericht.ergebnis_vorschlag.team1_tore": _TORE_OR_NULL,
        "bericht.ergebnis_vorschlag.team2_tore": _TORE_OR_NULL,
        "bericht.ergebnis_vorschlag.elfmeterschiessen": _SHOOTOUT_OR_NULL,
        "bericht.ergebnis_vorschlag.elfmeterschiessen.team1": _COUNT,
        "bericht.ergebnis_vorschlag.elfmeterschiessen.team2": _COUNT,
        "bericht.torschuetzen.minute": _MINUTE,
        "bericht.karten.minute": _MINUTE,
        "bericht.bemerkungen": _NON_EMPTY_OR_NULL,
    },
    Collection.ADRESSWECHSEL: {
        "verschickt_am": _DAY,
    },
    Collection.SPIELER: {
        "einwilligung.datum": _DAY,
        "einwilligung.bestaetigt_am": _OPTIONAL_DAY,
        # Null is the sentinel's, and `NAMELESS_PERSON_RULE`'s anywhere else.
        "vorname": _NON_EMPTY_OR_NULL,
        "inactive_since": _OPTIONAL_DAY,
        "geburtsdatum": _OPTIONAL_DAY,
    },
    Collection.SPIELORTE: {
        "name": _NON_EMPTY,
        "maps_link": _NON_EMPTY,
        "default_mietpreis": _COUNT,
        "inactive_since": _OPTIONAL_DAY,
        "address.strasse": _NON_EMPTY,
        "address.hausnummer": _HAUSNUMMER,
        "address.plz": _PLZ,
        "address.stadt": _NON_EMPTY,
    },
    Collection.SPIELTAGE: {
        "beginn": _DAY_OR_NULL,
        "ende": _DAY_OR_NULL,
        "saison_id": _SAISON_ID,
        "position": _POSITION,
    },
    Collection.TEAMS: {
        "name": _NON_EMPTY,
        "shorthand": _SHORTHAND,
        "full_name": _NON_EMPTY,
        "description": _DESCRIPTION,
        "website_url": _OPTIONAL_URL,
        "inactive_since": _OPTIONAL_DAY,
        "address.strasse": _NON_EMPTY,
        "address.hausnummer": _HAUSNUMMER,
        "address.plz": _PLZ,
        "address.stadt": _NON_EMPTY,
    },
}

UNSERVABLE_VALUE_RULE = "every value its row models bound is one they admit ({})"


def _refuses(adapter: TypeAdapter[Any], document: Mapping[str, Any], path: str) -> bool:
    return _refused_at(adapter, document, path.split("."))


def _refused_at(adapter: TypeAdapter[Any], value: Any, steps: list[str]) -> bool:
    # An array met before the path ends: the rest names a field of every member, as a query's dotted path does.
    if steps and isinstance(value, list):
        return any(_refused_at(adapter, member, steps) for member in value)

    if steps:
        # A parent stored null, or a key stored nowhere: the validator's own report names a missing key.
        if not isinstance(value, Mapping) or steps[0] not in value:
            return False
        return _refused_at(adapter, value[steps[0]], steps[1:])

    try:
        adapter.validate_python(value)
    except ValidationError:
        return True

    return False


async def report_unservable_values(db: AsyncDatabase) -> dict[Collection, RelationReport]:
    """Count, per collection, the documents holding a value a read model refuses, writing nothing; each example names its fields."""

    reports: dict[Collection, RelationReport] = {}

    for collection, types in SERVED_VALUES.items():
        offenders: list[Mapping[str, Any]] = []
        # A path under another listed path is projected through it: the server refuses the pair as a path collision.
        projection = {path: 1 for path in types if not any(path.startswith(f"{outer}.") for outer in types)}

        async for document in db[collection].find({}, projection):
            if refused := [path for path, adapter in types.items() if _refuses(adapter, document, path)]:
                offenders.append({"_id": document["_id"], "fields": refused})

        reports[collection] = RelationReport(rule=UNSERVABLE_VALUE_RULE.format(collection), groups=len(offenders), examples=offenders[:5])

    return reports


async def probe_collmod_privilege(db: AsyncDatabase) -> str:
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


async def report_identity(db: AsyncDatabase) -> tuple[str, list[str]]:
    """Who the SERVER thinks this connection is, and which roles it carries.

    A correct role on the wrong user looks exactly like a broken one; nothing else separates them.
    """
    info = (await db.command("connectionStatus")).get("authInfo", {})

    users = ", ".join(user.get("user", "?") for user in info.get("authenticatedUsers", []))
    roles = [f"{role.get('role')}@{role.get('db')}" for role in info.get("authenticatedUserRoles", [])]

    return users or "(not authenticated)", roles


async def probe_read_privilege(db: AsyncDatabase) -> str:
    try:
        await db[next(iter(COLLECTION_VALIDATORS), ABSENT_COLLECTION_NAME)].count_documents({})
    except OperationFailure as failure:
        if classify_failure(failure) == "authorization":
            return f"DENIED -- {failure_message(failure)}"
        raise

    return "granted"


async def probe_list_collections_privilege(db: AsyncDatabase) -> str:
    """Asked for the replay after a restore, which reads every stored validator through `listCollections`.

    The call `app/api/identitaet/wiederherstellung.py :: stale_validators` makes, so the verdict is the replay's own.
    """

    try:
        await (await db.list_collections(filter={"name": next(iter(COLLECTION_VALIDATORS), ABSENT_COLLECTION_NAME)})).to_list()
    except OperationFailure as failure:
        if classify_failure(failure) == "authorization":
            return f"DENIED -- {failure_message(failure)}"
        raise

    return "granted"


async def probe_privileges(db: AsyncDatabase) -> list[tuple[str, str]]:
    """Three of the privileges this module and the replay need, each asked INDEPENDENTLY, so one report names every gap.

    A check aborting on the first refusal hides the next until that one is fixed.
    """
    # Two go unprobed: only a FRESH database reaches `create`, and `apply_constraints` issues
    # `createIndex` on every boot. Asking for either is exercising it, and this may not write.
    return [
        ("find", await probe_read_privilege(db)),
        ("collMod", await probe_collmod_privilege(db)),
        ("listCollections", await probe_list_collections_privilege(db)),
    ]


def failure_message(failure: OperationFailure) -> str:
    """The server's own `errmsg`, which carries the detail the exception's `str` flattens away."""
    return failure.details.get("errmsg", str(failure)) if failure.details else str(failure)


def classify_failure(failure: OperationFailure) -> str:
    """`"authentication"`, `"authorization"` or `"other"`, read from the MESSAGE."""
    message = failure_message(failure).lower()

    # Checked first: an Atlas authorization message can mention "auth" in the namespace it names.
    if failure.code == UNAUTHORIZED or any(phrase in message for phrase in AUTHORIZATION_PHRASES):
        return "authorization"

    if failure.code == AUTHENTICATION_FAILED or any(phrase in message for phrase in AUTHENTICATION_PHRASES):
        return "authentication"

    return "other"


def diagnose_failure(failure: OperationFailure) -> str:
    """Turn a driver exception into the sentence an operator can act on.

    Names the FILE, never the connection string: the value is a secret, and a diagnostic that prints
    one cannot be pasted into a bug report.
    """
    message = failure_message(failure)
    kind = classify_failure(failure)

    if kind == "authentication":
        return (
            "  The database REJECTED THE CREDENTIALS. This is not a permissions problem, and no role\n"
            "  change will fix it.\n\n"
            f"  The secret file {MONGODB_URI_FILE} carries a username and password the cluster does not\n"
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
    client = AsyncMongoClient(
        host=get_config().mongodb_uri.get_secret_value(),
        serverSelectionTimeoutMS=get_config().db_server_selection_timeout,
    )
    database = client[get_config().db_base_name]

    try:
        if not check:
            summary = await apply_constraints(database)
            print(
                f"Applied {summary.validators} validators, {summary.unique_indexes} unique, "
                f"{summary.support_indexes} support and {summary.ttl_indexes} TTL indexes "
                f"to '{get_config().db_base_name}'."
            )
            return 0

        print(f"Database '{get_config().db_base_name}', checked against {len(COLLECTION_VALIDATORS)} validators. Nothing is written.\n")

        identity, roles = await report_identity(database)
        print(f"  Authenticated as: {identity}")
        print(f"  Roles the server sees: {', '.join(roles) or '(none)'}\n")

        print("  Privileges — three of the actions this module and the replay need, asked separately")
        privileges = await probe_privileges(database)
        for action, verdict in privileges:
            print(f"    {'ok  ' if verdict == 'granted' else 'FAIL'}  {action:<15} {verdict}")

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

        # Counted for the cross-document rules' reason: the validator admits such a row, and every read
        # serving it refuses it.
        print("\n  Rows the validator admits for the erased pupils' sentinel alone")
        nameless = await report_nameless_persons(database)
        marker = "ok " if nameless.groups == 0 else "FAIL"
        print(f"    {marker}  {nameless.rule:<46} {nameless.groups:>4}")
        if nameless.groups:
            blocking += nameless.groups
            print(f"          first offenders: {nameless.examples}")

        # Counted for the same reason: one such value answers every row of the list serving it 500.
        print("\n  Values the validators admit and a whole-list read refuses")
        for unservable in (await report_unservable_values(database)).values():
            marker = "ok " if unservable.groups == 0 else "FAIL"
            print(f"    {marker}  {unservable.rule:<46} {unservable.groups:>4}")
            if unservable.groups:
                blocking += unservable.groups
                print(f"          first offenders: {unservable.examples}")

        # Judged after the data, so one run names every gap; a refused grant outranks the data, which the
        # same run can count, and answers what a refused `find` answers above.
        if any(verdict != "granted" for _, verdict in privileges):
            print(
                "\n  NOT clean. Grant the privileges marked FAIL above"
                + (", and correct the data," if blocking else "")
                + " before applying.\n"
            )
            return 2

        print("\n  Clean — safe to apply.\n" if blocking == 0 else "\n  NOT clean. Correct the data above before applying.\n")
        return 0 if blocking == 0 else 1

    except OperationFailure as failure:
        # Not re-raised: the traceback buries the one line that matters, which this tool hands over.
        print(f"\n{diagnose_failure(failure)}\n")
        return 2

    except RuntimeError as failure:
        # The apply wraps a refused build to name the validator or index; anything else is a defect.
        if not isinstance(failure.__cause__, OperationFailure):
            raise
        print(f"\n  {str(failure).removesuffix(f': {failure.__cause__}')}.\n{diagnose_failure(failure.__cause__)}\n")
        return 2

    finally:
        await client.close()


def _main() -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.core.constraints",
        description="Report or apply the database constraints declared in this module.",
    )
    parser.add_argument("--check", action="store_true", help="report violations and the privileges; writes nothing")
    parser.add_argument("--apply", action="store_true", help="apply every validator and every index, exactly as startup does")
    arguments = parser.parse_args()

    if arguments.check == arguments.apply:
        parser.error("pass exactly one of --check or --apply")

    return asyncio.run(_run(check=arguments.check))


if __name__ == "__main__":
    raise SystemExit(_main())
