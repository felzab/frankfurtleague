"""
API · the account page's consent controls: what every kind of own record's share

One module for every kind, so their PATCHes cannot answer one press differently and the account page's
read judges a grant exactly as the PATCH it offers does. Pure: `fl_backend/tests/core/test_write_shapes.py`
sweeps every services module for a read of its own.
"""

from collections.abc import Collection, Mapping, Sequence
from http import HTTPStatus
from typing import Any, Final

from app.api.bewerbungen.services import bewerbung_schule, build_eigene_bewerbung_filter, mindestalter_for, saison_schule
from app.api.einwilligung.services import find_fassung_refusal, medien_angeboten
from app.api.identitaet.schemas import FLSubjektSitz
from app.api.identitaet.services import FUNKTION_NICHT_GEHALTEN, eigene_sitze, holds_a_seat, ist_eigene_registrierung
from app.api.kontakte.services import rows_possibly_naming
from app.api.registrierungen.services import build_eigene_registrierung_filter, traegt_wahlen
from app.api.schiedsrichter.services import vorname_of
from app.api.teams.schemas import KONTAKT_ROLLEN
from app.core.exceptions import WriteRefusal
from app.core.recording import log_stamp
from app.shared.einwilligung import Seite
from app.shared.einwilligung_nachweis import NACHWEIS, WAHLEN, FLEinwilligungWahl, compose_beleg, ist_erteilt, nachweis_stand_of

# The registry pages (`app/shared/einwilligung.py :: LAUFENDE_FASSUNGEN`) whose labels each control stamps.
KONTO_SEITE_SPIELER: Final[Seite] = "konto_spieler"
KONTO_SEITE_SCHIEDSRICHTER: Final[Seite] = "konto_schiedsrichter"
KONTO_SEITE_KONTAKT: Final[Seite] = "konto_kontakt"

# The place `find_fassung_refusal` names in its message: each PATCH stamps one label.
_FASSUNG_ORT: Final = "einwilligung"

EINWILLIGUNG_STAND_VERALTET: Final = "REQ-EINWILLIGUNG-003"
ERTEILUNG_NICHT_ZUGELASSEN: Final = "REQ-EINWILLIGUNG-004"


def erteilt_etwas(*, gespeichert: Mapping[str, Any], gewaehlt: Mapping[FLEinwilligungWahl, Any]) -> bool:
    """Whether a press GRANTS a choice the stored record withholds, in either vocabulary.

    A grant is admitted only where its record's grant predicate allows it, a withdrawal on every confirmed one (Art. 7(3) DSGVO).
    """

    return any(ist_erteilt(wahl, wert) and not ist_erteilt(wahl, gespeichert.get(wahl)) for wahl, wert in gewaehlt.items())


def _bewegt(gespeichert: Mapping[str, Any], wahl: FLEinwilligungWahl, wert: Any) -> bool:
    return wert != (ist_erteilt("medien", gespeichert.get("medien")) if wahl == "medien" else gespeichert.get(wahl))


def compose_person_move(
    *, gespeichert: Mapping[str, Any], gewaehlt: Mapping[FLEinwilligungWahl, Any], am: str, text_version: str
) -> dict[str, dict[str, Any]] | None:
    """The update moving a person's own block, at `einwilligung`, by the choices that change; `None` where none does.

    Never `bestaetigt_am`, read by the panel and the publication mask, nor the block's CONFIRMED
    `text_version`: the press's label is its evidence's.
    """

    bewegt: list[FLEinwilligungWahl] = [wahl for wahl in WAHLEN if wahl in gewaehlt and _bewegt(gespeichert, wahl, gewaehlt[wahl])]
    if not bewegt:
        return None

    return {
        "$set": {
            **{f"einwilligung.{wahl}": gewaehlt[wahl] for wahl in bewegt},
            **{
                f"einwilligung.{NACHWEIS}.{wahl}": compose_beleg(
                    gespeichert=gespeichert, wahl=wahl, wert=gewaehlt[wahl], am=am, text_version=text_version, stamp=log_stamp
                )
                for wahl in bewegt
            },
        }
    }


def compose_sitz_move(
    *, sitze: Mapping[str, Mapping[str, Any]], gewaehlt: Mapping[FLEinwilligungWahl, Any], am: str, text_version: str
) -> dict[str, dict[str, Any]] | None:
    """The update moving every held seat's block of one row or application, `sitze` keyed by slot; `None` where none moves."""

    bewegt: list[tuple[str, FLEinwilligungWahl]] = [
        (slot, wahl)
        for slot, gespeichert in sitze.items()
        for wahl in WAHLEN
        if wahl in gewaehlt and _bewegt(gespeichert, wahl, gewaehlt[wahl])
    ]
    if not bewegt:
        return None

    return {
        "$set": {
            **{f"kontakte.{slot}.einwilligung.{wahl}": gewaehlt[wahl] for slot, wahl in bewegt},
            **{
                f"kontakte.{slot}.einwilligung.{NACHWEIS}.{wahl}": compose_beleg(
                    gespeichert=sitze[slot], wahl=wahl, wert=gewaehlt[wahl], am=am, text_version=text_version, stamp=log_stamp
                )
                for slot, wahl in bewegt
            },
        }
    }


def find_erteilung_refusal(*, zugelassen: bool) -> WriteRefusal | None:
    """`REQ-EINWILLIGUNG-004`: the record is the person's own and takes a withdrawal alone, so a grant on it is refused.

    Its own code, not `REQ-FUNKTION-001`'s: the record was found, so naming the cause hides nothing.
    """

    if zugelassen:
        return None

    return WriteRefusal(
        error_code=ERTEILUNG_NICHT_ZUGELASSEN,
        status=HTTPStatus.FORBIDDEN,
        message="this record takes a withdrawal alone: no grant is admitted on it here",
    )


def find_eigener_eintrag_refusal(*, gehalten: bool) -> WriteRefusal | None:
    """`REQ-FUNKTION-001` on a person's own record: the address holds no record this operation may read or change.

    One answer for another person's id, an unconfirmed record and none at all, so the refusal tells
    nobody which ids exist.
    """

    if gehalten:
        return None

    return WriteRefusal(
        error_code=FUNKTION_NICHT_GEHALTEN,
        status=HTTPStatus.FORBIDDEN,
        message="the signed-in person holds no confirmed record here that this operation may read or change",
    )


def find_nachweis_stand_refusal(*, erwartet: Mapping[str, Any], bloecke: Sequence[Any]) -> WriteRefusal | None:
    """`REQ-EINWILLIGUNG-003`: a choice's evidence moved since the page was served.

    Refused rather than merged: a stale page sends the other choice as it last saw it, and taking that
    would re-grant what the person withdrew elsewhere.
    """

    if dict(erwartet) == nachweis_stand_of(bloecke=bloecke):
        return None

    return WriteRefusal(
        error_code=EINWILLIGUNG_STAND_VERALTET,
        status=HTTPStatus.CONFLICT,
        message="this consent has moved since the page was served; reload it and press again",
    )


def find_konto_fassung_refusal(*, seite: Seite, text_version: str, erteilt: bool) -> WriteRefusal | None:
    """`REQ-EINWILLIGUNG-001` on an account-page control: a grant names the page's running label, a withdrawal any version of it.

    Refusing a withdrawal from a page loaded before a deploy would make taking a consent back harder
    than giving it.
    """

    return find_fassung_refusal(seite=seite, genannt={_FASSUNG_ORT: text_version}, jede_fassung=not erteilt)


# --- The records each read serves: CONFIRMED ones alone, retired rows and past seasons included, a
# withdrawal staying open on every record a consent stands on.


def kontext_zeile(row: Mapping[str, Any]) -> Mapping[str, Any] | None:
    """The squad row naming a pupil record's team and season: the newest season's, live or ausgetragen.

    Nothing stores the season a record was confirmed for; each admission rewrites the record, so only an
    administrator's later entry is misread.
    """

    kader = row.get("kader") or []

    return kader[0] if kader else None


def build_kontext_teams_pipeline(team_ids: Collection[Any]) -> list[Mapping[str, Any]]:
    """The clubs the records' slots name, read today: the two names a confirmation page fills `{team}` and `{schule}` from."""

    return [{"$match": {"_id": {"$in": sorted(set(team_ids))}}}, {"$project": {"name": 1, "full_name": 1}}]


def compose_spieler_selbst(row: Mapping[str, Any], *, erteilbar: bool, today: str, team: Mapping[str, Any] | None) -> dict[str, Any]:
    """One pupil row, as `app/api/spieler/services.py :: build_selbst_pupil_pipeline` reads it, in the shape both reads serve.

    `team` is the club document of `kontext_zeile`'s row, as it stands today.
    """

    zeile = kontext_zeile(row)

    return {
        "spieler_id": row["_id"],
        "vorname": row["vorname"],
        "nachname": row.get("nachname"),
        "geburtsdatum": row.get("geburtsdatum"),
        "inactive_since": row.get("inactive_since"),
        "einwilligung": row["einwilligung"],
        "bestaetigt_text_version": row["einwilligung"].get("text_version"),
        "nachweis_stand": nachweis_stand_of(bloecke=[row["einwilligung"]]),
        "erteilbar": erteilbar,
        "medien_angeboten": medien_angeboten(geburtsdatum=row.get("geburtsdatum"), today=today),
        "kader": row["kader"],
        "kontext": {
            "vorname": row["vorname"],
            "team": None if team is None else team.get("name"),
            "schule": None if team is None else team.get("full_name"),
            "saison": None if zeile is None else zeile["saison_id"],
        },
    }


def compose_schiedsrichter_selbst(row: Mapping[str, Any], *, erteilbar: bool, today: str) -> dict[str, Any]:
    """One referee row, as `app/api/schiedsrichter/services.py :: SELBST_FIELDS` projects it, in the shape both reads serve."""

    return {
        "schiedsrichter_id": row["_id"],
        "name": row["name"],
        "schule": row.get("schule"),
        "honorar": row["default_payment"],
        "kontakt": row["kontakt"],
        "geburtsdatum": row.get("geburtsdatum"),
        "inactive_since": row.get("inactive_since"),
        "einwilligung": row["einwilligung"],
        "bestaetigt_text_version": row["einwilligung"].get("text_version"),
        "nachweis_stand": nachweis_stand_of(bloecke=[row["einwilligung"]]),
        "erteilbar": erteilbar,
        "medien_angeboten": medien_angeboten(geburtsdatum=row.get("geburtsdatum"), today=today),
        # The one stored name, cut as the referee's confirmation page cut it.
        "kontext": {"vorname": vorname_of(row.get("name"))},
    }


def build_selbst_seat_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every season row whose seats may name the address: a pre-filter, `app/api/identitaet/services.py :: eigene_sitze` deciding.

    No `austritt` term: a withdrawal reaches a withdrawn team's seat too.
    """

    return [
        {"$match": rows_possibly_naming(identifier)},
        {
            "$project": {
                "saison_id": 1,
                "team_id": 1,
                "name": 1,
                **{f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_ROLLEN for field in ("vorname", "email", "geburtsdatum", "einwilligung")},
                **{f"bestaetigungen.{slot}.verschickt_am": 1 for slot in KONTAKT_ROLLEN},
            }
        },
        {"$sort": {"saison_id": -1, "name": 1, "team_id": 1}},
    ]


def auf_der_saison_bestaetigt(row: Mapping[str, Any], slot: str) -> bool:
    """Whether this seat's person answered a link the season row minted, rather than the application's.

    An admitted application's seats come over with no link: the row mints one only for a person a save newly writes.
    """

    entry = (row.get("bestaetigungen") or {}).get(slot)

    return isinstance(entry, Mapping) and isinstance(entry.get("verschickt_am"), str)


def build_angenommene_bewerbungen_pipeline(team_ids: Collection[Any]) -> list[Mapping[str, Any]]:
    """The admitted applications that seated these clubs, whose pages an admitted seat was confirmed on."""

    return [
        {"$match": {"team_id": {"$in": sorted(set(team_ids))}, "status": "angenommen"}},
        {"$project": {"team_id": 1, "saison_id": 1, "schule": 1}},
    ]


def _sitz_schule(
    row: Mapping[str, Any], slot: str, *, teams: Mapping[Any, Mapping[str, Any]], bewerbungen: Mapping[tuple[Any, str], Mapping[str, Any]]
) -> str | None:
    """`{schule}` as the page this seat was confirmed on filled it; `None` where no stored application seated the club."""

    if auf_der_saison_bestaetigt(row, slot):
        return saison_schule(row)

    bewerbung = bewerbungen.get((row["team_id"], row["saison_id"]))
    if bewerbung is None:
        return None

    return bewerbung_schule(bewerbung_raw=bewerbung, club_name=(teams.get(row["team_id"]) or {}).get("name"))


def sitz_wahlen_der_zeile(bloecke: Sequence[Mapping[str, Any]]) -> dict[FLEinwilligungWahl, Any]:
    """Each choice as the account page serves one person's seats on a row: on where any held seat's is, so a withdrawal stays offered.

    One person's seats on a row may disagree, each seat's link being answered on its own.
    """

    return {
        "umfang": "kontaktdaten_whatsapp" if any(ist_erteilt("umfang", block.get("umfang")) for block in bloecke) else "kontaktdaten",
        "medien": any(ist_erteilt("medien", block.get("medien")) for block in bloecke),
    }


def geaenderte_sitz_wahlen(
    *, bloecke: Sequence[Mapping[str, Any]], gedrueckt: Mapping[FLEinwilligungWahl, Any]
) -> dict[FLEinwilligungWahl, Any]:
    """The choices a seat press changed against the row its page served; one sent back as shown is no grant and no move.

    On seats answered apart, moving it would grant one what was never pressed.
    """

    gezeigt = sitz_wahlen_der_zeile(bloecke)

    return {wahl: wert for wahl, wert in gedrueckt.items() if wert != gezeigt[wahl]}


def _sitz_wahlen_gehalten(held: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    bloecke = [seat["einwilligung"] for seat in held]

    return {**sitz_wahlen_der_zeile(bloecke), "nachweis_stand": nachweis_stand_of(bloecke=bloecke)}


def bestaetigungsgruppen(kontakte: Mapping[str, Any], rollen: Sequence[str]) -> list[list[str]]:
    """The held slots grouped by the confirmation each answered, one group per label and day, in `rollen` order.

    A seat's link is answered on its own, so one person's two seats may stand on two pages and two floors.
    """

    gruppen: dict[tuple[Any, Any], list[str]] = {}
    for slot in rollen:
        block = kontakte[slot]["einwilligung"]
        gruppen.setdefault((block.get("text_version"), block.get("bestaetigt_am")), []).append(slot)

    return list(gruppen.values())


def _bestaetigt(kontakte: Mapping[str, Any], gruppe: Sequence[str], *, team: str, schule: str | None, saison: str) -> dict[str, Any]:
    """One confirmation a person gave on a row: its roles, its words, the floor its page named and what filled them."""

    block = kontakte[gruppe[0]]["einwilligung"]

    return {
        "rollen": list(gruppe),
        "text_version": block.get("text_version"),
        "bestaetigt_am": block.get("bestaetigt_am"),
        "mindestalter": mindestalter_for(gruppe),
        "kontext": {"vorname": kontakte[gruppe[0]].get("vorname"), "team": team, "schule": schule, "saison": saison},
    }


def compose_sitze_selbst(
    rows: Sequence[Mapping[str, Any]],
    identifier: str,
    *,
    sitze_mit_panel: Sequence[FLSubjektSitz],
    today: str,
    teams: Mapping[Any, Mapping[str, Any]],
    bewerbungen: Mapping[tuple[Any, str], Mapping[str, Any]],
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
                "medien_angeboten": all(medien_angeboten(geburtsdatum=seat.get("geburtsdatum"), today=today) for seat in held),
                "erteilbar": holds_a_seat(sitze_mit_panel, team_id=row["team_id"], saison_id=row["saison_id"]),
                "bestaetigt": [
                    _bestaetigt(
                        row["kontakte"],
                        gruppe,
                        team=row["name"],
                        schule=_sitz_schule(row, gruppe[0], teams=teams, bewerbungen=bewerbungen),
                        saison=row["saison_id"],
                    )
                    for gruppe in bestaetigungsgruppen(row["kontakte"], rollen)
                ],
            }
        )

    return sitze


# --- The pending applications a person confirmed a seat on: withdraw-only, a grant being the
# confirmation page's alone.


def build_selbst_bewerbung_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every pending application whose seats may name the address, `eigene_sitze` deciding as on a season row."""

    return [
        {"$match": build_eigene_bewerbung_filter(identifier)},
        {
            "$project": {
                "saison_id": 1,
                "team_id": 1,
                "schule.team_name": 1,
                **{f"kontakte.{slot}.{field}": 1 for slot in KONTAKT_ROLLEN for field in ("vorname", "email", "einwilligung")},
            }
        },
        {"$sort": {"saison_id": -1, "_id": 1}},
    ]


def compose_bewerbungssitze_selbst(
    rows: Sequence[Mapping[str, Any]], identifier: str, *, teams: Mapping[Any, Mapping[str, Any]]
) -> list[dict[str, Any]]:
    """One entry per pending application on which this address holds a confirmed seat, as `compose_sitze_selbst` answers a row."""

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
                # `{team}` is the school too: an application names no season row.
                "bestaetigt": [
                    _bestaetigt(row["kontakte"], gruppe, team=schule, schule=schule, saison=row["saison_id"])
                    for gruppe in bestaetigungsgruppen(row["kontakte"], rollen)
                ],
            }
        )

    return eintraege


# --- The pending registrations a pupil confirmed: withdraw-only until the admission, a returning pupil's read-only.


def build_selbst_registrierung_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every pending registration that may be the address's, `ist_eigene_registrierung` deciding as the gate's does."""

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
        {"$sort": {"saison_id": -1, "_id": 1}},
    ]


def compose_registrierungen_selbst(
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
                "bestaetigt_text_version": block.get("text_version"),
                "umfang": block.get("umfang"),
                "medien": ist_erteilt("medien", block.get("medien")) if traegt_wahlen(block) else None,
                "nachweis_stand": nachweis_stand_of(bloecke=[block]),
                "kontext": {
                    "vorname": row["vorname"],
                    "team": None if team is None else team.get("name"),
                    "schule": None if team is None else team.get("full_name"),
                    "saison": row["saison_id"],
                },
                **{field: row.get(field) for field in ("vorname", "nachname", "geburtsdatum", "nummer", "position", "stufe")},
            }
        )

    return eintraege
