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
from datetime import UTC, datetime
from typing import Any, Final
from zoneinfo import ZoneInfo

from bson import ObjectId

from app.api.bewerbungen.services import bestaetigungsfrist_from, compose_bestaetigungen, compose_einwilligung, hash_token
from app.api.registrierungen.services import compose_bestaetigung, compose_confirmation_update, compose_registrierung
from app.api.sperrliste.services import SPERRLISTE_SCHLUESSEL_VERSION, adresse_hash
from app.api.spielbestaetigungen.services import compose_ansetzung, halter_of
from app.api.teams.schemas import KONTAKT_ROLLEN, FLKontaktEingetragenVon
from app.core.recording import log_stamp
from app.shared.adresswechsel import FLAdresswechselWeg, compose_block
from app.shared.einwilligung import LAUFENDE_FASSUNGEN, Seite
from app.shared.einwilligung_nachweis import NACHWEIS, WAHLEN, compose_beleg, compose_geboren
from tests.config import build_test_config

ADDRESS: Final[Mapping[str, str]] = {
    "strasse": "Hanauer Landstraße",
    "hausnummer": "12a",
    "plz": "60314",
    "stadtteil": "Ostend",
    "stadt": "Frankfurt am Main",
}

_GERMANY: Final = ZoneInfo("Europe/Berlin")


def bestaetigt_um(tag: str) -> str:
    """The instant a seed's person confirmed on `tag`: noon in Germany, spelled as `log_stamp` spells evidence."""

    return log_stamp(datetime.fromisoformat(f"{tag}T12:00:00").replace(tzinfo=_GERMANY))


# A pupil's record as their own confirmation wrote it and their admission carried it onto the person,
# publishing the name and no media.
EINWILLIGUNG: Final[Mapping[str, Any]] = compose_geboren(
    block={
        "umfang": "kader_oeffentlich",
        "datum": "2026-01-20",
        "bestaetigt_am": "2026-01-20",
        "text_version": LAUFENDE_FASSUNGEN["bestaetigung_spieler"],
        "medien": False,
    },
    am=bestaetigt_um("2026-01-20"),
)

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
        "bewerbung": None,
        "registrierung": None,
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
        "schulform": None,
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
        "trikot_farbe": None,
        "kontakte": None,
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


def spielbestaetigung_document(spiel: Mapping[str, Any], *, partei: Mapping[str, Any], **fields: Any) -> dict[str, Any]:
    """An open, unanswered row as the pass mints it, its snapshot composed from `spiel` by the composer the mint calls.

    So its `stand` is the digest of its own values, which a hand-written one never is.
    """

    return {
        "_id": ObjectId(),
        "saison_id": spiel["saison_id"],
        "spiel_id": spiel["_id"],
        "partei": dict(partei),
        "ansetzung": compose_ansetzung(spiel),
        "frist": "2026-04-25",
        "angefragt_am": None,
        "erinnert_am": [],
        "kontakte": dict.fromkeys(KONTAKT_ROLLEN),
        "antwort": None,
        "geschlossen": None,
        **fields,
    }


def bericht_document(**fields: Any) -> dict[str, Any]:
    """A referee's first, unadopted report of a 1:0 won by `team1`: one named scorer, one caution with its reason."""

    am = datetime(2026, 3, 15, 20, tzinfo=UTC)

    return {
        "ergebnis_vorschlag": {"team1_tore": 1, "team2_tore": 0, "elfmeterschiessen": None, "sonderereignis": None},
        "torschuetzen": [{"seite": "team1", "spieler_id": ObjectId(), "minute": "23", "eigentor": False}],
        "karten": [{"seite": "team2", "spieler_id": ObjectId(), "minute": "45+2", "farbe": "gelb", "grund": "foulspiel"}],
        "bemerkungen": None,
        "eingereicht_am": am,
        "eingereicht_von": {"art": "schiedsrichter", "schiedsrichter_id": ObjectId()},
        "geaendert_am": am,
        "version": 1,
        "uebernommen_am": None,
        "uebernommen_von": None,
        "uebernommene_version": None,
        **fields,
    }


def spielbericht_document(spiel: Mapping[str, Any], **fields: Any) -> dict[str, Any]:
    return {"_id": ObjectId(), "saison_id": spiel["saison_id"], "spiel_id": spiel["_id"], "bericht": bericht_document(), **fields}


def kontakt_antwort_document(rolle: str, adresse: str, *, begruendung: str | None, am: str = "2026-04-01", **fields: Any) -> dict[str, Any]:
    """A seat's decline as its link stores it, proposing another date; its holder the digest of `adresse`, the answer's own fold."""

    return {
        "art": "abgelehnt",
        "am": am,
        "von": {"art": "kontakt", "rolle": rolle, "halter": halter_of(adresse, schluessel=build_test_config().sperrliste_schluessel)},
        "vorschlag": {"datum": "2026-04-25", "uhrzeit": "14:00:00"},
        "begruendung": begruendung,
        **fields,
    }


def spieler_document(spieler_id: Any, vorname: str, nachname: str | None, **fields: Any) -> dict[str, Any]:
    """A person as their admission writes them, the record and the date their registration carried."""

    return {
        "_id": spieler_id,
        "vorname": vorname,
        "nachname": nachname,
        "geburtsdatum": "2009-05-04",
        "einwilligung": copy.deepcopy(dict(EINWILLIGUNG)),
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
    bestaetigungsfrist: str | None = None,
    team_id: Any = None,
    schule: Mapping[str, Any] | None = None,
    link_prefix: str | None = None,
    verschickt_am: str | None = None,
    **fields: Any,
) -> dict[str, Any]:
    """A stored application, its school an existing club by `team_id` or a new one in `schule`.

    Each link is minted from `<link_prefix>-<seat>` on `verschickt_am`, by default the id and the submission day,
    the deadline counted from the mint.
    """

    prefix = str(bewerbung_id) if link_prefix is None else link_prefix
    gemintet = verschickt_am or eingereicht_am

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
        "stufengroesse": 96,
        "wunschgegner": None,
        "entscheidung": None,
        "bestaetigungsfrist": bestaetigungsfrist if bestaetigungsfrist is not None else bestaetigungsfrist_from(today=gemintet),
        "bestaetigungen": compose_bestaetigungen(hashes={seat: hash_token(f"{prefix}-{seat}") for seat in KONTAKT_ROLLEN}, today=gemintet),
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
    vorname: str,
    *,
    bestaetigt_am: str | None = None,
    einwilligung: Mapping[str, Any] | None = None,
    am: str | None = None,
    eingetragen_von: FLKontaktEingetragenVon = "bewerbung",
    **fields: Any,
) -> dict[str, Any]:
    """One contact seat as its seating stores it, or, given `bestaetigt_am`, as its own person's confirmation left it.

    `einwilligung` holds the record's keys a case sets itself, its label and choices among them, laid over the seat's own.
    """

    seated = compose_einwilligung(text_version="v3", today="2026-03-20", eingetragen_von=eingetragen_von)
    if bestaetigt_am is None:
        block = {**seated, **(einwilligung or {})}
    elif not bestaetigt_am:
        # A blank stamp, which only a hand edit stores and every reader takes for none: nobody answered.
        block = {**seated, "bestaetigt_am": bestaetigt_am, **(einwilligung or {})}
    else:
        # As `app/api/bewerbungen/services.py :: compose_confirmation_update` answers the seat: both
        # choices with their evidence, judged against the seat as seated.
        block = {**seated, "bestaetigt_am": bestaetigt_am, **(einwilligung or {})}
        if NACHWEIS not in block:
            beleg_am = am if am is not None else bestaetigt_um(bestaetigt_am)
            block[NACHWEIS] = {
                wahl: compose_beleg(gespeichert=seated, wahl=wahl, wert=block[wahl], am=beleg_am, text_version=block["text_version"])
                for wahl in WAHLEN
            }

    return {
        "vorname": vorname,
        "nachname": f"{vorname}-Mustermann",
        "email": f"{vorname.lower()}@example.com",
        "telefon": "+49 170 1234567",
        "geburtsdatum": None if bestaetigt_am is None else "1984-05-09",
        "einwilligung": block,
        **fields,
    }


def bestaetigte_kenntnisnahme(*, text_version: str = "v1", datum: str = "2026-01-15", bestaetigt_am: str = "2026-01-16") -> dict[str, Any]:
    """A seat's record as its applicant's seating and then its own person's confirmation left it, for a seat a case spells itself."""

    return dict(
        kontaktperson_document("Kenntnis", bestaetigt_am=bestaetigt_am, einwilligung={"text_version": text_version, "datum": datum})[
            "einwilligung"
        ]
    )


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


def eigene_einwilligung_document(*, text_version: str, bestaetigt_am: str, am: str | None = None, **fields: Any) -> dict[str, Any]:
    """A pupil's or a referee's consent as their own confirmation left it, publishing the name and no media.

    Each choice evidenced at `am`, noon of `bestaetigt_am` unless a case names it; `fields` laid over the block.
    """

    geboren = compose_geboren(
        block={
            "umfang": "kader_oeffentlich",
            "datum": bestaetigt_am,
            "bestaetigt_am": bestaetigt_am,
            "text_version": text_version,
            "medien": False,
        },
        am=am if am is not None else bestaetigt_um(bestaetigt_am),
    )

    return {**geboren, **fields}


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


def adresswechsel_document(*, email: str, token_hash: str, day: str, weg: FLAdresswechselWeg = "konto") -> dict[str, Any]:
    """A pending change's block as a start mints it at noon of `day` in Germany, its stop link a hash nobody holds."""

    started = datetime.fromisoformat(f"{day}T12:00:00").replace(tzinfo=ZoneInfo("Europe/Berlin"))

    return compose_block(email=email, weg=weg, token_hash=token_hash, stopp_hash=hash_token(f"stop-{token_hash}"), grund=None, now=started)
