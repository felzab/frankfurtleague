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
