from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime
from http import HTTPStatus
from typing import Any, Final, NamedTuple

from bson import ObjectId

from app.api.identitaet.services import holds_a_name, namen_aus
from app.api.spielberichte.schemas import (
    FLSpielberichtBericht,
    FLSpielberichtBerichtPayload,
    FLSpielberichtSeite,
    FLSpielberichtSpieler,
    FLSpielberichtVon,
    FLSpielberichtVorschlag,
    FLSpielberichtZustand,
)
from app.api.spiele.schemas import SONDEREREIGNIS_NO_SHOW, SONDEREREIGNIS_WITHOUT_A_RESULT, FLSpielElfmeterschiessen
from app.api.teams.schemas import KONTAKT_ROLLEN
from app.core.collections import Collection
from app.core.crud import refuse
from app.core.exceptions import WriteRefusal
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID

BERICHT_NICHT_GESPIELT: Final = "REQ-BERICHT-001"
BERICHT_NICHT_GELEITET: Final = "REQ-BERICHT-002"
BERICHT_NICHT_IM_KADER: Final = "REQ-BERICHT-003"
BERICHT_ABGESAGT: Final = "REQ-BERICHT-004"
BERICHT_NAME_IN_BEMERKUNGEN: Final = "REQ-BERICHT-005"

SEITEN: Final[tuple[FLSpielberichtSeite, ...]] = ("team1", "team2")

# What the report's judges and its form read off the fixture; no money, no notice.
SPIEL_FIELDS: Final[Mapping[str, int]] = {
    "_id": 1,
    "saison_id": 1,
    "saison_phase": 1,
    "datum": 1,
    "uhrzeit": 1,
    "team1": 1,
    "team2": 1,
    "schiedsrichter.schiedsrichter_id": 1,
    "schiedsrichter.name": 1,
    "sonderereignis": 1,
    "ergebnis": 1,
    "elfmeterschiessen": 1,
}


class BerichtLage(NamedTuple):
    """What one report is judged against: the fixture, both clubs' squad rows of the season, and their season rows."""

    spiel: Mapping[str, Any]
    # Every squad row of the two clubs in the season, ausgetragen ones too, each joined to its pupil's names.
    kader: Sequence[Mapping[str, Any]]
    vereine: Sequence[Mapping[str, Any]]


def build_bericht_kader_pipeline(*, saison_id: str, team_ids: Sequence[ObjectId]) -> list[Mapping[str, Any]]:
    """Every squad row of the clubs in the season, live and ausgetragen alike, joined to its pupil's two names and nothing else."""

    return [
        {"$match": {"saison_id": saison_id, "team_id": {"$in": list(team_ids)}}},
        {
            "$lookup": {
                "from": Collection.SPIELER,
                "localField": "spieler_id",
                "foreignField": "_id",
                # An allow-list inside the join: the person row holds an address.
                "pipeline": [{"$project": {"_id": 0, "vorname": 1, "nachname": 1}}],
                "as": "person",
            }
        },
        # Strict, as the squad's own read is: the erasure removes a person's squad rows before the person.
        {"$unwind": "$person"},
        {
            "$project": {
                "_id": 0,
                "spieler_id": 1,
                "team_id": 1,
                "vorname": "$person.vorname",
                "nachname": {"$ifNull": ["$person.nachname", None]},
                "nummer": {"$ifNull": ["$nummer", None]},
                "inactive_since": {"$ifNull": ["$inactive_since", None]},
            }
        },
        {"$sort": {"nachname": 1, "vorname": 1, "spieler_id": 1}},
    ]


def build_zustand_pipeline(*, saison_id: str) -> list[Mapping[str, Any]]:
    """A season's reports holding a block, each beside its fixture's result fields."""

    return [
        {"$match": {"saison_id": saison_id, "bericht": {"$ne": None}}},
        {
            "$lookup": {
                "from": Collection.SPIELE,
                "localField": "spiel_id",
                "foreignField": "_id",
                "pipeline": [
                    {"$project": {"_id": 0, "team1.tore": 1, "team2.tore": 1, "ergebnis": 1, "sonderereignis": 1, "elfmeterschiessen": 1}}
                ],
                "as": "spiel",
            }
        },
        # A replace or an undraw removes a season's reports with its fixtures, so every report finds its fixture.
        {"$unwind": "$spiel"},
        {"$project": {"_id": 0, "spiel_id": 1, "bericht": 1, "spiel": 1}},
    ]


def team_id_of(spiel_raw: Mapping[str, Any], seite: FLSpielberichtSeite) -> ObjectId | None:
    side = spiel_raw.get(seite)

    return None if side is None else side["team_id"]


def live_kader(lage: BerichtLage, seite: FLSpielberichtSeite) -> list[Mapping[str, Any]]:
    """That side's live squad: an open knockout slot fields nobody."""

    team_id = team_id_of(lage.spiel, seite)

    return [row for row in lage.kader if team_id is not None and row["team_id"] == team_id and row["inactive_since"] is None]


def genannte_ids(bericht: Mapping[str, Any] | FLSpielberichtBerichtPayload | None) -> dict[FLSpielberichtSeite, set[ObjectId]]:
    """Every pupil a block names, per side; a scorer nobody named is no id."""

    named: dict[FLSpielberichtSeite, set[ObjectId]] = {seite: set() for seite in SEITEN}
    if bericht is None:
        return named

    raw = bericht.model_dump(context={"keep_oid": True}) if isinstance(bericht, FLSpielberichtBerichtPayload) else bericht
    for entry in [*raw["torschuetzen"], *raw["karten"]]:
        if entry["spieler_id"] is not None:
            named[entry["seite"]].add(entry["spieler_id"])

    return named


def neu_genannt(payload: FLSpielberichtBerichtPayload, gespeichert: Mapping[str, Any] | None) -> dict[FLSpielberichtSeite, set[ObjectId]]:
    """The pupils this write names that the stored block did not name on that side, the only ones judged against the squad.

    So a correction keeps a scorer ausgetragen since the match, or an erased pupil's sentinel.
    """

    stored = genannte_ids(gespeichert)

    return {seite: ids - stored[seite] for seite, ids in genannte_ids(payload).items()}


def find_nicht_geleitet_refusal(*, spiel_raw: Mapping[str, Any], schiedsrichter_ids: Iterable[ObjectId]) -> WriteRefusal | None:
    """`REQ-BERICHT-002`: the report is the booked referee's, and the ghost or an empty slot books nobody who could write it."""

    gebucht = (spiel_raw.get("schiedsrichter") or {}).get("schiedsrichter_id")
    if gebucht is not None and gebucht in set(schiedsrichter_ids):
        return None

    return WriteRefusal(
        error_code=BERICHT_NICHT_GELEITET,
        status=HTTPStatus.FORBIDDEN,
        message="the signed-in person is not the referee this fixture is booked to",
    )


def find_nicht_gespielt_refusal(*, datum: str | None, today: str) -> WriteRefusal | None:
    """`REQ-BERICHT-001`: a report follows the match day; the day arriving, or a date corrected, lifts it."""

    if datum is not None and datum <= today:
        return None

    return WriteRefusal(
        error_code=BERICHT_NICHT_GESPIELT,
        status=HTTPStatus.CONFLICT,
        message="the fixture is undated or its day is still to come",
    )


def find_abgesagt_refusal(*, sonderereignis: str | None) -> WriteRefusal | None:
    """`REQ-BERICHT-004`: a fixture called off or struck out took no place to report on."""

    if sonderereignis not in SONDEREREIGNIS_WITHOUT_A_RESULT:
        return None

    return WriteRefusal(
        error_code=BERICHT_ABGESAGT,
        status=HTTPStatus.CONFLICT,
        message="the fixture is called off or struck out, and carries no report",
    )


def find_nicht_im_kader_refusal(*, lage: BerichtLage, neu: Mapping[FLSpielberichtSeite, set[ObjectId]]) -> WriteRefusal | None:
    """`REQ-BERICHT-003`: a pupil newly named on a side is in that side's live squad of the season."""

    for seite in SEITEN:
        kader = {row["spieler_id"] for row in live_kader(lage, seite)}
        if not neu[seite] <= kader:
            return WriteRefusal(
                error_code=BERICHT_NICHT_IM_KADER,
                status=HTTPStatus.CONFLICT,
                message="a pupil the report newly names is not in that side's live squad of the season",
            )

    return None


def bericht_namen(lage: BerichtLage) -> frozenset[str]:
    """Every name the people of this fixture hold: both clubs' three seats, the booked referee, and every pupil of both squads.

    Ausgetragen pupils too: a remark about the match can name a pupil who left the squad since.
    """

    fields = [
        *(
            ((row.get("kontakte") or {}).get(seat) or {}).get(part)
            for row in lage.vereine
            for seat in KONTAKT_ROLLEN
            for part in ("vorname", "nachname")
        ),
        # Off the fixture's copy, which a rename rewrites in its own transaction; the ghost's is null.
        (lage.spiel.get("schiedsrichter") or {}).get("name"),
        *(row.get(part) for row in lage.kader for part in ("vorname", "nachname")),
    ]

    return namen_aus(fields)


def find_name_in_bemerkungen_refusal(*, bemerkungen: str | None, names: Iterable[str]) -> WriteRefusal | None:
    """`REQ-BERICHT-005`: no name of the fixture's people stands in the remarks, which outlive their erasure.

    By `holds_a_name`: a common word equal to a name is refused with it, and the referee rephrases.
    """

    if bemerkungen is None or not holds_a_name(bemerkungen, names):
        return None

    # Naming none of them: the message reaches the refusal's log line.
    return WriteRefusal(
        error_code=BERICHT_NAME_IN_BEMERKUNGEN,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        message="the remarks name a person of this fixture's clubs, squads or referee",
        fields=(("bericht", "bemerkungen"),),
    )


def judge_bericht(
    *, lage: BerichtLage, payload: FLSpielberichtBerichtPayload, neu: Mapping[FLSpielberichtSeite, set[ObjectId]], today: str
) -> None:
    """Every refusal both writers of a report owe, in order.

    The remarks last, so a write refused for anything else says nothing about a name.
    """

    refuse(find_nicht_gespielt_refusal(datum=lage.spiel.get("datum"), today=today))
    refuse(find_abgesagt_refusal(sonderereignis=lage.spiel.get("sonderereignis")))
    refuse(find_nicht_im_kader_refusal(lage=lage, neu=neu))
    refuse(find_name_in_bemerkungen_refusal(bemerkungen=payload.bemerkungen, names=bericht_namen(lage)))


def vorschlag_entspricht(vorschlag: FLSpielberichtVorschlag, spiel_raw: Mapping[str, Any]) -> bool:
    """Whether the stored result is what the proposal proposes.

    A no-show by its event alone, its goals being the forfeit's; a shoot-out only where the fixture keeps one, the save
    discarding it on a group fixture or a decided one.
    """

    if vorschlag.sonderereignis in SONDEREREIGNIS_NO_SHOW:
        return spiel_raw.get("sonderereignis") == vorschlag.sonderereignis

    tore = tuple((spiel_raw.get(seite) or {}).get("tore") for seite in SEITEN)
    if tore != (vorschlag.team1_tore, vorschlag.team2_tore) or spiel_raw.get("sonderereignis") != vorschlag.sonderereignis:
        return False

    gespeichert = spiel_raw.get("elfmeterschiessen")

    return gespeichert is None or FLSpielElfmeterschiessen.model_validate(gespeichert) == vorschlag.elfmeterschiessen


def bericht_zustand_of(bericht: FLSpielberichtBericht, spiel_raw: Mapping[str, Any]) -> FLSpielberichtZustand:
    """The state a report reads in, from the adoption, the block's version and the result together.

    A fixture holding no result reads `vorgeschlagen` however the report was stamped, which is what an undo of the
    adopting save leaves.
    """

    if spiel_raw.get("ergebnis") is None and spiel_raw.get("sonderereignis") is None:
        return "vorgeschlagen"

    # Equal versions, never instants: a correction and an adoption in one second are two writes.
    if bericht.uebernommene_version == bericht.version and vorschlag_entspricht(bericht.ergebnis_vorschlag, spiel_raw):
        return "uebernommen"

    return "abweichend"


def compose_ansicht(lage: BerichtLage, *, genannt: Sequence[FLSpielberichtSpieler], dokument: Mapping[str, Any] | None) -> dict[str, Any]:
    """What the referee's form and the administrator's panel both read: the fixture, the live squads, and the stored block."""

    spiel = lage.spiel

    def team(seite: FLSpielberichtSeite) -> dict[str, Any] | None:
        side = spiel.get(seite)
        return None if side is None else {"team_id": side["team_id"], "name": side["name"]}

    return {
        "spiel": {
            "spiel_id": spiel["_id"],
            "saison_id": spiel["saison_id"],
            "saison_phase": spiel["saison_phase"],
            "datum": spiel.get("datum"),
            "uhrzeit": spiel.get("uhrzeit"),
            "team1": team("team1"),
            "team2": team("team2"),
            "sonderereignis": spiel.get("sonderereignis"),
        },
        "kader": {seite: live_kader(lage, seite) for seite in SEITEN},
        "genannt": genannt,
        "bericht": None if dokument is None else dokument.get("bericht"),
    }


def compose_neuer_bericht(payload: FLSpielberichtBerichtPayload, *, von: FLSpielberichtVon, now: datetime) -> dict[str, Any]:
    """The block's first write: version 1, and no adoption."""

    return {
        **payload.model_dump(context={"keep_oid": True}),
        "eingereicht_am": now,
        "eingereicht_von": von.model_dump(context={"keep_oid": True}),
        "geaendert_am": now,
        "version": 1,
        "uebernommen_am": None,
        "uebernommen_von": None,
        "uebernommene_version": None,
    }


def compose_bericht_update(payload: FLSpielberichtBerichtPayload, *, now: datetime) -> dict[str, Any]:
    """A later write of the block: the content replaced, the version raised, who first wrote it and the adoption kept.

    The adoption stays as it was, so the raised version is what returns the report to `abweichend`.
    """

    return {
        "$set": {f"bericht.{key}": value for key, value in payload.model_dump(context={"keep_oid": True}).items()}
        | {"bericht.geaendert_am": now},
        "$inc": {"bericht.version": 1},
    }


# --- The REFEREE'S ERASURE: the reports they sent, and the log images of them.


def build_referee_reports_filter(schiedsrichter_ids: Sequence[Any]) -> Mapping[str, Any]:
    """Every report one of these referees first sent."""

    return {"bericht.eingereicht_von.schiedsrichter_id": {"$in": list(schiedsrichter_ids)}}


def build_referee_report_images_filter(schiedsrichter_ids: Sequence[Any]) -> Mapping[str, Any]:
    """Every `spielberichte` log row whose image names one of these referees as the report's sender.

    Selected inside the image, as `app/api/schiedsrichter/services.py :: build_booked_image_filter` selects: an undraw's
    `delete_many` row holds images of reports long gone, which no id standing now reaches.
    """

    return {"collection": str(Collection.SPIELBERICHTE), "before.bericht.eingereicht_von.schiedsrichter_id": {"$in": list(schiedsrichter_ids)}}


def referee_report_image_edits(image: Mapping[str, Any], schiedsrichter_ids: Sequence[Any]) -> dict[str, Any]:
    """One report image naming one of these referees, repointed as the report itself is; its remarks and entries stay."""

    von = (image.get("bericht") or {}).get("eingereicht_von")
    if not isinstance(von, Mapping) or von.get("schiedsrichter_id") not in schiedsrichter_ids:
        return {}

    return {"bericht.eingereicht_von.schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID}
