"""
TESTS · the stored shapes both tiers build from: seeds, and the rules and consent that payload fixtures and rules models take

Each document as the shipped indexes judge it. Plain functions rather than fixtures: the `on_a_*`
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

from app.api.adresswechsel.services import compose_record
from app.api.bewerbungen.services import bestaetigungsfrist_from, compose_bestaetigungen, compose_einwilligung
from app.api.registrierungen.services import compose_bestaetigung, compose_confirmation_update, compose_registrierung
from app.api.sperrliste.services import SPERRLISTE_SCHLUESSEL_VERSION, adresse_hash
from app.api.spielbestaetigungen.services import compose_ansetzung, halter_of
from app.core.recording import log_stamp
from app.shared.einwilligung import LAUFENDE_FASSUNGEN, Seite
from app.shared.einwilligung_nachweis import CHOICES, NACHWEIS, compose_beleg, compose_geboren
from app.shared.schemas.literals import KONTAKT_ROLLEN, FLAddressChangeWay, FLKontaktEnteredBy
from app.shared.tokens import hash_token
from tests.config import build_test_config

ADDRESS: Final[Mapping[str, str]] = {
    "strasse": "Hanauer Landstraße",
    "hausnummer": "12a",
    "plz": "60314",
    "stadtteil": "Ostend",
    "stadt": "Frankfurt am Main",
}

_GERMANY: Final = ZoneInfo("Europe/Berlin")


def confirmed_instant(tag: str) -> str:
    """The instant a seed's person confirmed on `tag`: noon in Germany, spelled as `log_stamp` spells evidence."""

    return log_stamp(datetime.fromisoformat(f"{tag}T12:00:00").replace(tzinfo=_GERMANY))


# A pupil's record as their own confirmation wrote it and their admission carried it onto the person,
# publishing the name and no media.
EINWILLIGUNG: Final[Mapping[str, Any]] = compose_geboren(
    block={
        "umfang": "kader_oeffentlich",
        "datum": "2026-01-20",
        "confirmed_at": "2026-01-20",
        "text_version": LAUFENDE_FASSUNGEN["bestaetigung_spieler"],
        "medien": False,
    },
    am=confirmed_instant("2026-01-20"),
)

# The ordinary competition, so no rule a suite is not about refuses first. Every key spelled out, so a
# key added to `FLSaisonRules` fails a seed rather than taking a default nobody picked.
_RULES: Final[Mapping[str, Any]] = {
    "win_points": 3,
    "draw_points": 1,
    "qualifiers_per_gruppe": 2,
    "number_of_gruppen": 4,
    "teams_per_gruppe": 4,
    "tiebreak_order": "tordifferenz",
    "max_kadergroesse": 18,
    "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
    "allowed_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
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
    """Every nullable key written null rather than omitted, as a save writes them, `notiz` among them, which `FLSpiel` defaults.

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
        "version": 0,
        **fields,
    }


def spielbestaetigung_document(spiel: Mapping[str, Any], *, party: Mapping[str, Any], **fields: Any) -> dict[str, Any]:
    """An open, unanswered row as the pass mints it, its snapshot composed from `spiel` by the composer the mint calls.

    So its `stand` is the digest of its own values, which a hand-written one never is.
    """

    return {
        "_id": ObjectId(),
        "saison_id": spiel["saison_id"],
        "spiel_id": spiel["_id"],
        "party": dict(party),
        "ansetzung": compose_ansetzung(spiel),
        "frist": "2026-04-25",
        "asked_at": None,
        "reminded_at": [],
        "kontakte": dict.fromkeys(KONTAKT_ROLLEN),
        "antwort": None,
        "closed": None,
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
        "seiten": {"team1": None, "team2": None},
        "submitted_at": am,
        "submitted_by": {"art": "schiedsrichter", "schiedsrichter_id": ObjectId()},
        "changed_at": am,
        "version": 1,
        "adopted_at": None,
        "adopted_by": None,
        "adopted_version": None,
        **fields,
    }


def spielbericht_seiten(spiel: Mapping[str, Any]) -> dict[str, Any]:
    """The clubs `spiel` fields, as a report written on it stamps them."""

    return {seite: (spiel.get(seite) or {}).get("team_id") for seite in ("team1", "team2")}


def spielbericht_document(spiel: Mapping[str, Any], **fields: Any) -> dict[str, Any]:
    return {
        "_id": ObjectId(),
        "saison_id": spiel["saison_id"],
        "spiel_id": spiel["_id"],
        "bericht": bericht_document(seiten=spielbericht_seiten(spiel)),
        "version": 0,
        **fields,
    }


def kontakt_antwort_document(rolle: str, adresse: str, *, begruendung: str | None, am: str = "2026-04-01", **fields: Any) -> dict[str, Any]:
    """A seat's decline as its link stores it, proposing another date; its holder the digest of `adresse`, the answer's own fold."""

    return {
        "art": "declined",
        "am": am,
        "von": {"art": "kontakt", "rolle": rolle, "halter": halter_of(adresse, key=build_test_config().sperrliste_key)},
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
        # One per id, folded as the admission stores it, so two seeded persons never meet on `uniq_spieler_email`.
        "email": f"{spieler_id}@schule.example".lower(),
        "geburtsdatum": "2009-05-04",
        "einwilligung": copy.deepcopy(dict(EINWILLIGUNG)),
        "inactive_since": None,
        **fields,
    }


def new_schule_document(team_name: str, shorthand: str, **fields: Any) -> dict[str, Any]:
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


def minted_confirmations(*, hashes: Mapping[str, str], today: str) -> dict[str, Any]:
    """An application's three seats as the hand-out of each seat's mail left them: one live link each, mailed `today`."""

    return {seat: {**entry, "token_hashes": [hashes[seat]]} for seat, entry in compose_bestaetigungen(today=today).items()}


def bewerbung_document(
    bewerbung_id: Any,
    saison_id: str,
    status: str,
    *,
    kontakte: Mapping[str, Any],
    submitted_at: str,
    confirmation_deadline: str | None = None,
    team_id: Any = None,
    schule: Mapping[str, Any] | None = None,
    link_prefix: str | None = None,
    sent_at: str | None = None,
    **fields: Any,
) -> dict[str, Any]:
    """A stored application, its school an existing club by `team_id` or a new one in `schule`.

    Each link is minted from `<link_prefix>-<seat>` on `sent_at`, by default the id and the submission day,
    the deadline counted from the mint.
    """

    prefix = str(bewerbung_id) if link_prefix is None else link_prefix
    minted = sent_at or submitted_at

    return {
        "_id": bewerbung_id,
        "saison_id": saison_id,
        "submitted_at": submitted_at,
        "status": status,
        "team_id": team_id,
        "schule": None if schule is None else dict(schule),
        "kontakte": dict(kontakte),
        "trikot": {"existing_satz": "keiner", "wunschfarbe": "rot"},
        "kader": {"expected_size": 14, "good_spieler": 3},
        "stufengroesse": 96,
        "wunschgegner": None,
        "decision": None,
        "confirmation_deadline": confirmation_deadline if confirmation_deadline is not None else bestaetigungsfrist_from(today=minted),
        "confirmations": minted_confirmations(hashes={seat: hash_token(f"{prefix}-{seat}") for seat in KONTAKT_ROLLEN}, today=minted),
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
    submitted_at: str,
    frist: str,
    position: str | None = None,
    nummer: str | None = None,
    stufe: str | None = None,
    confirmed: Mapping[str, Any] | None = None,
    **fields: Any,
) -> dict[str, Any]:
    """A registration as the submission leaves it and, given `confirmed`, as its pupil's own confirmation then does, through their composers.

    `token` is the raw link its hash is minted from; `confirmed` the confirmation composer's keywords.
    """

    document = {
        "_id": registrierung_id,
        **compose_registrierung(
            saison_id=saison_id,
            team_id=team_id,
            invitation_id=ObjectId(),
            vorname=vorname,
            nachname=nachname,
            email=email,
            position=position,
            nummer=nummer,
            stufe=stufe,
            confirmation={**compose_bestaetigung(today=submitted_at, frist=frist), "token_hashes": [hash_token(token)]},
            today=submitted_at,
        ),
        "idempotency_key": str(registrierung_id),
        "idempotency_fingerprint": "f" * 64,
    }
    if confirmed is not None:
        document.update(compose_confirmation_update(**confirmed)["$set"])

    return {**document, **fields}


def kontaktperson_document(
    vorname: str,
    *,
    confirmed_at: str | None = None,
    einwilligung: Mapping[str, Any] | None = None,
    am: str | None = None,
    entered_by: FLKontaktEnteredBy = "bewerbung",
    **fields: Any,
) -> dict[str, Any]:
    """One contact seat as its seating stores it, or, given `confirmed_at`, as its own person's confirmation left it.

    `einwilligung` holds the record's keys a case sets itself, its label and choices among them, laid over the seat's own.
    """

    seated = compose_einwilligung(text_version="v3", today="2026-03-20", entered_by=entered_by)
    if confirmed_at is None:
        block = {**seated, **(einwilligung or {})}
    elif not confirmed_at:
        # A blank stamp, which only a hand edit stores and every reader takes for none: nobody answered.
        block = {**seated, "confirmed_at": confirmed_at, **(einwilligung or {})}
    else:
        # As `app/api/bewerbungen/services.py :: compose_confirmation_update` answers the seat: both
        # choices with their evidence, judged against the seat as seated.
        block = {**seated, "confirmed_at": confirmed_at, **(einwilligung or {})}
        if NACHWEIS not in block:
            beleg_am = am if am is not None else confirmed_instant(confirmed_at)
            block[NACHWEIS] = {
                choice: compose_beleg(saved=seated, choice=choice, value=block[choice], am=beleg_am, text_version=block["text_version"])
                for choice in CHOICES
            }

    return {
        "vorname": vorname,
        "nachname": f"{vorname}-Mustermann",
        "email": f"{vorname.lower()}@example.com",
        "telefon": "+49 170 1234567",
        "geburtsdatum": None if confirmed_at is None else "1984-05-09",
        "einwilligung": block,
        **fields,
    }


def confirmed_kenntnisnahme(*, text_version: str = "v1", datum: str = "2026-01-15", confirmed_at: str = "2026-01-16") -> dict[str, Any]:
    """A seat's record as its applicant's seating and then its own person's confirmation left it, for a seat a case spells itself."""

    return dict(
        kontaktperson_document("Kenntnis", confirmed_at=confirmed_at, einwilligung={"text_version": text_version, "datum": datum})[
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
        "adresse_hash": adresse_hash(address, key=build_test_config().sperrliste_key),
        "key_version": SPERRLISTE_SCHLUESSEL_VERSION,
        "grund": "Falsches Geburtsdatum bei der Anmeldung",
        "created_by": "admin@frankfurtleague.de",
        "created_at": "2026-03-15",
        "barred_until_saison_id": bis,
        **fields,
    }


def saison_spieler_document(spieler_id: Any, saison_id: str, team_id: Any, **fields: Any) -> dict[str, Any]:
    """A live row carries an explicit null `inactive_since`, which is the shape a write leaves and what a `$match` reads."""

    return {
        "spieler_id": spieler_id,
        "saison_id": saison_id,
        "team_id": team_id,
        "is_nachnominiert": False,
        "rolle": None,
        "stufe": "Q2",
        "position": "Angriff",
        "nummer": None,
        "inactive_since": None,
        **fields,
    }


# --- A person's OWN records, as the sign-in gate and the account page read them. The address, the stamps
# and every label a case asserts are passed at the call.


def own_einwilligung_document(*, text_version: str, confirmed_at: str, am: str | None = None, **fields: Any) -> dict[str, Any]:
    """A pupil's or a referee's consent as their own confirmation left it, publishing the name and no media.

    Each choice evidenced at `am`, noon of `confirmed_at` unless a case names it; `fields` laid over the block.
    """

    geboren = compose_geboren(
        block={
            "umfang": "kader_oeffentlich",
            "datum": confirmed_at,
            "confirmed_at": confirmed_at,
            "text_version": text_version,
            "medien": False,
        },
        am=am if am is not None else confirmed_instant(confirmed_at),
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
    """A block of three seats, each empty unless named, and no seat held twice unless `trainer_is_also` says so."""

    return {**dict.fromkeys(KONTAKT_ROLLEN), "trainer_is_also": None, **seats}


def registrierung_confirmed(
    seite: Seite, *, geburtsdatum: str, today: str, am: str, umfang: str | None = None, medien: bool | None = None
) -> dict[str, Any]:
    """`registrierung_document`'s `confirmed` for a pupil's confirmation on `seite`, under that page's running label."""

    return {
        "geburtsdatum": geburtsdatum,
        "umfang": umfang,
        "medien": medien,
        "text_version": LAUFENDE_FASSUNGEN[seite],
        "today": today,
        "am": am,
    }


def address_change_document(
    *,
    adresse: str,
    email: str,
    token_hash: str | None,
    day: str,
    way: FLAddressChangeWay = "account",
    approval: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """A live change's record as a start inserts it at noon of `day` in Germany, its links as their hand-outs minted them.

    `token_hash` the new mailbox's, none where its link is not yet owed; the stop link a hash nobody holds.
    """

    started = datetime.fromisoformat(f"{day}T12:00:00").replace(tzinfo=ZoneInfo("Europe/Berlin"))

    return {
        **compose_record(adresse=adresse, email=email, way=way, grund=None, approval=approval, now=started),
        "token_hashes": [] if token_hash is None else [token_hash],
        "stop": {"token_hashes": [hash_token(f"stop-{token_hash}")]},
    }
