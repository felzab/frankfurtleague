"""
TESTS · the stored shapes both tiers build from: seeds, and the rules and consent that payload fixtures and rules models take

Each document as the shipped validator judges it. Plain functions rather than fixtures: the `on_a_*`
helpers and module-scoped corpora that seed them take no fixture.

Invariants:
- A value default (an address, a date, a rule, a consent) is one no test reads: a test asserting on a
  value passes it at the call, even one equal to the default.
- A null, `False` or `gruppenphase` default is the ordinary state a seed stands in (active, not
  withdrawn, not yet filled in), which tests rely on: a test wanting another state passes it.
"""

import copy
from collections.abc import Mapping
from typing import Any, Final

from bson import ObjectId

from app.api.bewerbungen.services import compose_bestaetigungen, hash_token
from app.api.registrierungen.services import compose_bestaetigung, compose_confirmation_update, compose_registrierung
from app.api.sperrliste.services import SPERRLISTE_SCHLUESSEL_VERSION, adresse_hash
from app.api.teams.schemas import KONTAKT_ROLLEN
from app.shared.einwilligung import LAUFENDE_FASSUNGEN, Seite
from tests.config import build_test_config

ADDRESS: Final[Mapping[str, str]] = {
    "strasse": "Hanauer Landstraße",
    "hausnummer": "12a",
    "plz": "60314",
    "stadtteil": "Ostend",
    "stadt": "Frankfurt am Main",
}

# A guardian's word as a person stored before the registration flow carries it.
EINWILLIGUNG: Final[Mapping[str, str]] = {
    "umfang": "kader_oeffentlich",
    "erteilt_von": "erziehungsberechtigt",
    "datum": "2026-01-15",
    "bestaetigt_am": "2026-01-20",
}

# The ordinary competition, so no rule a suite is not about refuses first. Every key spelled out, so a
# key added to `FLSaisonRules` fails a seed rather than taking a default nobody picked.
_RULES: Final[Mapping[str, Any]] = {
    "win_points": 3,
    "draw_points": 1,
    "qualifiers_per_group": 2,
    "number_of_groups": 4,
    "teams_per_group": 4,
    "tiebreak_order": "tordifferenz",
    "max_kadergroesse": 18,
    "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
    "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
}


def rules_document(**overrides: Any) -> dict[str, Any]:
    """A season's `rules` block; `deepcopy`, since two seasons in one test would otherwise share its lists."""

    return {**copy.deepcopy(dict(_RULES)), **overrides}


def saison_document(saison_id: str, status: str, **fields: Any) -> dict[str, Any]:
    """The first half of the id's year, which covers the schedule the default rules imply; no `schedule`, which is derived on read."""

    return {
        "_id": saison_id,
        "start_date": f"{saison_id}-01-01",
        "end_date": f"{saison_id}-06-30",
        "status": status,
        "rules": rules_document(),
        **fields,
    }


def team_document(team_id: Any, name: str, shorthand: str, **fields: Any) -> dict[str, Any]:
    """`inactive_since` is written null rather than omitted: a missing key matches a `None` filter, then fails response validation."""

    return {
        "_id": team_id,
        "name": name,
        "shorthand": shorthand,
        "description": "",
        "full_name": f"{name}-Schule",
        "website_url": f"https://{name.lower()}.example.de",
        "address": dict(ADDRESS),
        "inactive_since": None,
        **fields,
    }


def saison_team_document(saison_id: str, team_id: Any, name: str, shorthand: str, **fields: Any) -> dict[str, Any]:
    """A dict rather than a model: `saison_teams` has none. The name and shorthand are the season's own copies, taken at entry."""

    return {
        "saison_id": saison_id,
        "team_id": team_id,
        "gruppe": "A",
        "austritt": None,
        "name": name,
        "shorthand": shorthand,
        **fields,
    }


def spiel_document(*, spiel_id: Any, saison_id: str, spiel_nr: int, spieltag_id: Any, **fields: Any) -> dict[str, Any]:
    """Every nullable key written null rather than omitted: the validator requires each but `notiz`, which `FLSpiel` defaults.

    `spiel_nr` has no default: `uniq_saison_id_spiel_nr` refuses a second fixture reusing one.
    """

    return {
        "_id": spiel_id,
        "spiel_nr": spiel_nr,
        "saison_id": saison_id,
        "saison_phase": "gruppenphase",
        "spieltag_id": spieltag_id,
        "team1": None,
        "team2": None,
        "team1_quelle": None,
        "team2_quelle": None,
        "datum": None,
        "uhrzeit": None,
        "ort": None,
        "schiedsrichter": None,
        "ergebnis": None,
        "elfmeterschiessen": None,
        "sonderereignis": None,
        "notiz": None,
        **fields,
    }


def spieler_document(spieler_id: Any, vorname: str, nachname: str | None, **fields: Any) -> dict[str, Any]:
    return {
        "_id": spieler_id,
        "vorname": vorname,
        "nachname": nachname,
        "einwilligung": dict(EINWILLIGUNG),
        "inactive_since": None,
        **fields,
    }


def neue_schule_document(team_name: str, shorthand: str, **fields: Any) -> dict[str, Any]:
    """The school block of an application naming a school the league does not hold yet, named as `team_document` names one."""

    return {
        "team_name": team_name,
        "full_name": f"{team_name}-Schule",
        "shorthand": shorthand,
        "schulform": None,
        "address": dict(ADDRESS),
        "website_url": None,
        **fields,
    }


def bewerbung_document(
    bewerbung_id: Any,
    saison_id: str,
    status: str,
    *,
    kontakte: Mapping[str, Any],
    eingereicht_am: str,
    bestaetigungsfrist: str,
    team_id: Any = None,
    schule: Mapping[str, Any] | None = None,
    link_prefix: str | None = None,
    verschickt_am: str | None = None,
    **fields: Any,
) -> dict[str, Any]:
    """An application as the submission stores it: `team_id` for a school the league holds, `schule` for one it does not.

    Each seat's raw token is `<link_prefix>-<seat>`, minted on `verschickt_am`; by default the id and the submission's day.
    """

    prefix = str(bewerbung_id) if link_prefix is None else link_prefix

    return {
        "_id": bewerbung_id,
        "saison_id": saison_id,
        "eingereicht_am": eingereicht_am,
        "status": status,
        "team_id": team_id,
        "schule": None if schule is None else dict(schule),
        "kontakte": dict(kontakte),
        "trikot": {"vorhandener_satz": "keiner", "wunschfarbe": "rot"},
        "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
        "wunschgegner": None,
        "entscheidung": None,
        "bestaetigungsfrist": bestaetigungsfrist,
        "bestaetigungen": compose_bestaetigungen(
            hashes={seat: hash_token(f"{prefix}-{seat}") for seat in KONTAKT_ROLLEN}, today=verschickt_am or eingereicht_am
        ),
        **fields,
    }


def registrierung_document(
    registrierung_id: Any,
    email: str,
    *,
    saison_id: str,
    team_id: Any,
    vorname: str,
    nachname: str,
    token: str,
    eingereicht_am: str,
    frist: str,
    position: str | None = None,
    nummer: str | None = None,
    stufe: str | None = None,
    bestaetigt: Mapping[str, Any] | None = None,
    **fields: Any,
) -> dict[str, Any]:
    """A registration as the submission leaves it and, given `bestaetigt`, as its pupil's own confirmation then does, through their composers.

    `token` is the raw link its hash is minted from; `bestaetigt` the confirmation composer's keywords.
    """

    document = {
        "_id": registrierung_id,
        **compose_registrierung(
            saison_id=saison_id,
            team_id=team_id,
            einladung_id=ObjectId(),
            vorname=vorname,
            nachname=nachname,
            email=email,
            position=position,
            nummer=nummer,
            stufe=stufe,
            bestaetigung=compose_bestaetigung(token_hash=hash_token(token), today=eingereicht_am, frist=frist),
            today=eingereicht_am,
        ),
        "idempotenz_schluessel": str(registrierung_id),
        "idempotenz_fingerabdruck": "f" * 64,
    }
    if bestaetigt is not None:
        document.update(compose_confirmation_update(**bestaetigt)["$set"])

    return {**document, **fields}


def kontaktperson_document(
    vorname: str, *, bestaetigt_am: str | None = None, einwilligung: Mapping[str, Any] | None = None, **fields: Any
) -> dict[str, Any]:
    """One contact seat as the submission stores it, or, given `bestaetigt_am`, as its own person's confirmation left it.

    `einwilligung` holds the record's keys a case sets itself, its label and choices among them, laid over the seat's own.
    """

    return {
        "vorname": vorname,
        "nachname": f"{vorname}-Mustermann",
        "email": f"{vorname.lower()}@example.com",
        "telefon": "+49 170 1234567",
        "geburtsdatum": None if bestaetigt_am is None else "1984-05-09",
        "einwilligung": {
            "umfang": "kontaktdaten",
            "erfasst_von": "administrativ" if bestaetigt_am is None else "person",
            "text_version": "v3",
            "datum": "2026-03-20",
            "bestaetigt_am": bestaetigt_am,
            **(einwilligung or {}),
        },
        **fields,
    }


def ban_document(address: str, *, bis: str, **fields: Any) -> dict[str, Any]:
    """One ban as the shipped write stores it, keyed under the suite's own settings.

    `bis` has no default: read against the running season, it decides whether the ban stands, so each
    case names the bound it seeds.
    """

    return {
        "_id": ObjectId(),
        "adresse_hash": adresse_hash(address, schluessel=build_test_config().sperrliste_schluessel),
        "schluessel_version": SPERRLISTE_SCHLUESSEL_VERSION,
        "grund": "Falsches Geburtsdatum bei der Anmeldung",
        "erstellt_von": "admin@frankfurtleague.de",
        "erstellt_am": "2026-03-15",
        "gesperrt_bis_saison_id": bis,
        **fields,
    }


def saison_spieler_document(spieler_id: Any, saison_id: str, team_id: Any, **fields: Any) -> dict[str, Any]:
    """A live row carries an explicit null `inactive_since`, which is the shape a write leaves and what a `$match` reads."""

    return {
        "spieler_id": spieler_id,
        "saison_id": saison_id,
        "team_id": team_id,
        "ist_nachnominiert": False,
        "rolle": None,
        "stufe": "Q2",
        "position": "Angriff",
        "nummer": None,
        "inactive_since": None,
        **fields,
    }


# --- A person's OWN records, as the sign-in gate and the account page read them. The address, the stamps
# and every label a case asserts are passed at the call.


def eigene_einwilligung_document(*, text_version: str, bestaetigt_am: str, **fields: Any) -> dict[str, Any]:
    """A pupil's or a referee's consent as their own confirmation left it, publishing the name and no media."""

    return {
        "umfang": "kader_oeffentlich",
        "erteilt_von": "volljaehrig",
        "datum": bestaetigt_am,
        "bestaetigt_am": bestaetigt_am,
        "text_version": text_version,
        "medien": False,
        **fields,
    }


def schiedsrichter_document(
    schiedsrichter_id: Any, *, email: str, name: str, default_payment: int, einwilligung: Mapping[str, Any] | None, **fields: Any
) -> dict[str, Any]:
    """One referee row, `name` unique across the collection (`app/core/constraints.py :: uniq_schiedsrichter_name`)."""

    return {
        "_id": schiedsrichter_id,
        "name": name,
        "schule": None,
        "default_payment": default_payment,
        "kontakt": {"telefon": "+49 69 5550202", "email": email},
        "inactive_since": None,
        "geburtsdatum": None,
        "einwilligung": None if einwilligung is None else dict(einwilligung),
        **fields,
    }


def kontakte_document(**seats: Any) -> dict[str, Any]:
    """A block of three seats, each empty unless named, and no seat held twice unless `trainer_ist_zugleich` says so."""

    return {**dict.fromkeys(KONTAKT_ROLLEN), "trainer_ist_zugleich": None, **seats}


def registrierung_bestaetigt(
    seite: Seite, *, geburtsdatum: str, today: str, am: str, umfang: str | None = None, medien: bool | None = None
) -> dict[str, Any]:
    """`registrierung_document`'s `bestaetigt` for a pupil's confirmation on `seite`, under that page's running label."""

    return {
        "geburtsdatum": geburtsdatum,
        "umfang": umfang,
        "medien": medien,
        "text_version": LAUFENDE_FASSUNGEN[seite],
        "today": today,
        "am": am,
    }
