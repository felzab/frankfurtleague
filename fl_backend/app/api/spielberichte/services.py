from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime
from http import HTTPStatus
from typing import Any, Final, NamedTuple

from bson import ObjectId

from app.api.bewerbungen.services import season_has_ended
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
# Both writes replace the whole block, so a form opened before another write would put back what that write changed.
BERICHT_INZWISCHEN_GEAENDERT: Final = "REQ-BERICHT-006"
BERICHT_SAISON_BEENDET: Final = "REQ-BERICHT-007"
BERICHT_GRUND_FEHLT: Final = "REQ-BERICHT-008"
BERICHT_ELFMETER_IN_DER_GRUPPE: Final = "REQ-BERICHT-009"

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
    """What one report is judged against: the fixture, both clubs' squad rows of the season, their season rows, and the season's status."""

    spiel: Mapping[str, Any]
    # Every squad row of the two clubs in the season, ausgetragen ones too, each joined to its pupil's names.
    kader: Sequence[Mapping[str, Any]]
    vereine: Sequence[Mapping[str, Any]]
    saison_status: str | None


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


def build_eingereichte_pipeline(*, saison_id: str, spiel_fields: Mapping[str, int]) -> list[Mapping[str, Any]]:
    """A season's reports holding a block, each joined to `spiel_fields` of a fixture that stands.

    A report write crossing an undraw can outlive its fixture (`docs/backend/spec.md :: I118`), and is then neither read
    nor counted.
    """

    return [
        {"$match": {"saison_id": saison_id, "bericht": {"$ne": None}}},
        {
            "$lookup": {
                "from": Collection.SPIELE,
                "localField": "spiel_id",
                "foreignField": "_id",
                "pipeline": [{"$project": {"_id": 0, **spiel_fields}}],
                "as": "spiel",
            }
        },
        {"$unwind": "$spiel"},
    ]


def build_zustand_pipeline(*, saison_id: str) -> list[Mapping[str, Any]]:
    """A season's reports holding a block, each beside its fixture's result fields."""

    return [
        *build_eingereichte_pipeline(
            saison_id=saison_id,
            spiel_fields={
                "saison_phase": 1,
                "team1.team_id": 1,
                "team1.tore": 1,
                "team2.team_id": 1,
                "team2.tore": 1,
                "ergebnis": 1,
                "sonderereignis": 1,
                "elfmeterschiessen": 1,
            },
        ),
        {"$project": {"_id": 0, "spiel_id": 1, "bericht": 1, "spiel": 1}},
    ]


def team_id_of(spiel_raw: Mapping[str, Any], seite: FLSpielberichtSeite) -> ObjectId | None:
    side = spiel_raw.get(seite)

    return None if side is None else side["team_id"]


def seiten_of(spiel_raw: Mapping[str, Any]) -> dict[FLSpielberichtSeite, ObjectId | None]:
    """The clubs the fixture fields now, as a report's `seiten` stores them."""

    return {seite: team_id_of(spiel_raw, seite) for seite in SEITEN}


def seiten_geaendert(gespeichert: Mapping[str, Any], spiel_raw: Mapping[str, Any]) -> frozenset[FLSpielberichtSeite]:
    """The sides on which the fixture fields another club than the report's last write found there."""

    jetzt = seiten_of(spiel_raw)

    return frozenset(seite for seite in SEITEN if gespeichert[seite] != jetzt[seite])


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


def neu_genannt(
    payload: FLSpielberichtBerichtPayload, gespeichert: Mapping[str, Any] | None, spiel_raw: Mapping[str, Any]
) -> dict[FLSpielberichtSeite, set[ObjectId]]:
    """The pupils this write names that the stored block did not name on that side, the only ones judged against the squad.

    So a correction keeps a scorer ausgetragen or erased since the match.
    """

    stored = genannte_ids(gespeichert)
    # A side fielding another club since keeps none: its stored pupils played for the club that left it.
    for seite in set() if gespeichert is None else seiten_geaendert(gespeichert["seiten"], spiel_raw):
        stored[seite] = set()

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


def ist_gespielt(*, datum: str | None, today: str) -> bool:
    return datum is not None and datum <= today


def ist_abgesagt(*, sonderereignis: str | None) -> bool:
    return sonderereignis in SONDEREREIGNIS_WITHOUT_A_RESULT


def find_nicht_gespielt_refusal(*, datum: str | None, today: str) -> WriteRefusal | None:
    """`REQ-BERICHT-001`: a report follows the match day; the day arriving, or a date corrected, lifts it."""

    if ist_gespielt(datum=datum, today=today):
        return None

    return WriteRefusal(
        error_code=BERICHT_NICHT_GESPIELT,
        status=HTTPStatus.CONFLICT,
        message="the fixture is undated or its day is still to come",
    )


def find_abgesagt_refusal(*, sonderereignis: str | None) -> WriteRefusal | None:
    """`REQ-BERICHT-004`: a fixture called off or struck out took no place to report on."""

    if not ist_abgesagt(sonderereignis=sonderereignis):
        return None

    return WriteRefusal(
        error_code=BERICHT_ABGESAGT,
        status=HTTPStatus.CONFLICT,
        message="the fixture is called off or struck out, and carries no report",
    )


def ist_abgeschlossen(lage: BerichtLage) -> bool:
    """Whether the fixture's season has ended, after which its referee reads the report and writes it no more."""

    return season_has_ended(saison_status=lage.saison_status)


def find_saison_beendet_refusal(lage: BerichtLage) -> WriteRefusal | None:
    """`REQ-BERICHT-007`: the referee writes while the fixture's season runs; the administrator's correction is not asked."""

    if not ist_abgeschlossen(lage):
        return None

    return WriteRefusal(
        error_code=BERICHT_SAISON_BEENDET,
        status=HTTPStatus.CONFLICT,
        message="the fixture's season has ended, and its referee's report only reads",
    )


def find_elfmeter_in_der_gruppe_refusal(*, spiel_raw: Mapping[str, Any], payload: FLSpielberichtBerichtPayload) -> WriteRefusal | None:
    """`REQ-BERICHT-009`: a group fixture keeps no shoot-out, so a proposal holding one could never read adopted."""

    if spiel_raw["saison_phase"] != "gruppenphase" or payload.ergebnis_vorschlag.elfmeterschiessen is None:
        return None

    return WriteRefusal(
        error_code=BERICHT_ELFMETER_IN_DER_GRUPPE,
        status=HTTPStatus.CONFLICT,
        message="a group-phase fixture keeps no shoot-out, and its report proposes none",
    )


def nimmt_einen_bericht(spiel_raw: Mapping[str, Any], *, today: str) -> bool:
    """Whether the fixture takes a report today, as `REQ-BERICHT-001` and `REQ-BERICHT-004` judge a write, refusing nothing."""

    return ist_gespielt(datum=spiel_raw.get("datum"), today=today) and not ist_abgesagt(sonderereignis=spiel_raw.get("sonderereignis"))


def find_bericht_stand_refusal(*, stand: int | None, gespeichert: Mapping[str, Any] | None) -> WriteRefusal | None:
    """`REQ-BERICHT-006`: the write was composed on the version standing now, or on none where none stands.

    Judged on the transaction's read: a write committing meanwhile, a crossing first one included, conflicts with this
    one, whose retry is refused.
    """

    if stand == (None if gespeichert is None else gespeichert["version"]):
        return None

    return WriteRefusal(
        error_code=BERICHT_INZWISCHEN_GEAENDERT,
        status=HTTPStatus.CONFLICT,
        message="the report changed since this write was composed; re-read it and send the change again",
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


def find_grund_fehlt_refusal(*, payload: FLSpielberichtBerichtPayload, gespeichert: Mapping[str, Any] | None) -> WriteRefusal | None:
    """`REQ-BERICHT-008`: a caution names its reason unless the stored block holds it stripped, which a correction would otherwise invent.

    A card has no id: the same side, pupil and colour is the same card, its minute correctable.
    """

    def schluessel(karte: Mapping[str, Any]) -> tuple[Any, ...]:
        return karte["seite"], karte["spieler_id"], karte["farbe"]

    gestrippt = Counter(
        schluessel(karte)
        for karte in ([] if gespeichert is None else gespeichert["karten"])
        if karte["farbe"] != "rot" and karte["grund"] is None
    )
    for karte in payload.model_dump(context={"keep_oid": True})["karten"]:
        if karte["farbe"] == "rot" or karte["grund"] is not None:
            continue
        if gestrippt[schluessel(karte)] > 0:
            gestrippt[schluessel(karte)] -= 1
            continue

        return WriteRefusal(
            error_code=BERICHT_GRUND_FEHLT,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
            message="a yellow or a second yellow card the stored report does not hold names no reason",
            # The list, a refusal's field being a literal: the form refuses the card itself before any press.
            fields=(("bericht", "karten"),),
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
    *,
    lage: BerichtLage,
    payload: FLSpielberichtBerichtPayload,
    gespeichert: Mapping[str, Any] | None,
    neu: Mapping[FLSpielberichtSeite, set[ObjectId]],
    today: str,
) -> None:
    """Every refusal both writers of a report owe, in order.

    The remarks last, so a write refused for anything else says nothing about a name.
    """

    refuse(find_nicht_gespielt_refusal(datum=lage.spiel.get("datum"), today=today))
    refuse(find_abgesagt_refusal(sonderereignis=lage.spiel.get("sonderereignis")))
    refuse(find_elfmeter_in_der_gruppe_refusal(spiel_raw=lage.spiel, payload=payload))
    refuse(find_nicht_im_kader_refusal(lage=lage, neu=neu))
    refuse(find_grund_fehlt_refusal(payload=payload, gespeichert=gespeichert))
    refuse(find_name_in_bemerkungen_refusal(bemerkungen=payload.bemerkungen, names=bericht_namen(lage)))


def vorschlag_entspricht(vorschlag: FLSpielberichtVorschlag, spiel_raw: Mapping[str, Any]) -> bool:
    """Whether the stored result is what the proposal proposes.

    A no-show by its event alone, its goals being the forfeit's; the shoot-out too, absent or not, which no write proposes
    where the fixture keeps none (`REQ-BERICHT-009`).
    """

    if vorschlag.sonderereignis in SONDEREREIGNIS_NO_SHOW:
        return spiel_raw.get("sonderereignis") == vorschlag.sonderereignis

    tore = tuple((spiel_raw.get(seite) or {}).get("tore") for seite in SEITEN)
    if tore != (vorschlag.team1_tore, vorschlag.team2_tore) or spiel_raw.get("sonderereignis") != vorschlag.sonderereignis:
        return False

    # `app/api/spiele/services.py :: apply_payload_to_spiel`'s rule: a level knockout keeps its shoot-out, so one saved
    # without the proposed shoot-out is not the proposal.
    gespeichert = spiel_raw.get("elfmeterschiessen")

    return (None if gespeichert is None else FLSpielElfmeterschiessen.model_validate(gespeichert)) == vorschlag.elfmeterschiessen


# The states awaiting the administrator, which the triage lists: an adopted report awaits nothing, and one on a match
# that took no place awaits nothing anyone can do.
BERICHT_ZUSTAENDE_OFFEN: Final[frozenset[FLSpielberichtZustand]] = frozenset({"vorgeschlagen", "abweichend", "teams_geaendert"})


def bericht_zustand_of(bericht: FLSpielberichtBericht, spiel_raw: Mapping[str, Any]) -> FLSpielberichtZustand:
    """The state a report reads in, from the fixture, the adoption and the block's version.

    No result reads `vorgeschlagen` however the report was stamped, as after an undone adoption or on an abandonment
    still owing its result.
    """

    if ist_abgesagt(sonderereignis=spiel_raw.get("sonderereignis")):
        return "abgesagt"

    # Ahead of every comparison of the result: a proposal by side is about the clubs its last write found, and read
    # against another club's result it would credit that club.
    if seiten_geaendert(dict(bericht.seiten), spiel_raw):
        return "teams_geaendert"

    if spiel_raw.get("ergebnis") is None:
        return "vorgeschlagen"

    # Equal versions, never instants: a correction and an adoption in one second are two writes.
    if bericht.uebernommene_version == bericht.version and vorschlag_entspricht(bericht.ergebnis_vorschlag, spiel_raw):
        return "uebernommen"

    return "abweichend"


def compose_ansicht(
    lage: BerichtLage, *, kader_offen: bool, genannt: Sequence[FLSpielberichtSpieler], dokument: Mapping[str, Any] | None
) -> dict[str, Any]:
    """What the referee's form and the administrator's panel both read: the fixture, the live squads, and the stored block.

    The squads empty unless `kader_offen`: the referee picks from them only while the fixture takes a report.
    """

    spiel = lage.spiel
    bericht = None if dokument is None else dokument.get("bericht")

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
        "kader": {seite: live_kader(lage, seite) if kader_offen else [] for seite in SEITEN},
        "genannt": genannt,
        "bericht": bericht,
        # Served rather than re-derived by the forms, which mark these sides' entries and offer none of their old pupils.
        "seiten_geaendert": [] if bericht is None else sorted(seiten_geaendert(bericht["seiten"], spiel)),
    }


def bericht_unveraendert(
    payload: FLSpielberichtBerichtPayload, gespeichert: Mapping[str, Any] | None, seiten: Mapping[FLSpielberichtSeite, ObjectId | None]
) -> bool:
    """Whether the stored block already says what the payload says, for the clubs `seiten` names, so a save of it writes nothing.

    A save sent unchanged after the clubs moved re-stamps them, making the report adoptable again.
    """

    return (
        gespeichert is not None
        and gespeichert.get("seiten") == seiten
        and all(gespeichert.get(key) == value for key, value in payload.model_dump(context={"keep_oid": True}).items())
    )


def compose_neuer_bericht(
    payload: FLSpielberichtBerichtPayload, *, von: FLSpielberichtVon, seiten: Mapping[FLSpielberichtSeite, ObjectId | None], now: datetime
) -> dict[str, Any]:
    """The block's first write: version 1, and no adoption."""

    return {
        **payload.model_dump(context={"keep_oid": True}),
        "seiten": dict(seiten),
        "eingereicht_am": now,
        "eingereicht_von": von.model_dump(context={"keep_oid": True}),
        "geaendert_am": now,
        "version": 1,
        "uebernommen_am": None,
        "uebernommen_von": None,
        "uebernommene_version": None,
    }


def compose_bericht_update(
    payload: FLSpielberichtBerichtPayload, *, seiten: Mapping[FLSpielberichtSeite, ObjectId | None], now: datetime
) -> dict[str, Any]:
    """A later write of the block: the content replaced, the version raised, who first wrote it and the adoption kept.

    The adoption stays as it was, so the raised version is what returns the report to `abweichend`.
    """

    return {
        "$set": {f"bericht.{key}": value for key, value in payload.model_dump(context={"keep_oid": True}).items()}
        | {"bericht.seiten": dict(seiten), "bericht.geaendert_am": now},
        "$inc": {"bericht.version": 1},
    }


# --- The SEASON'S END: the remarks and every card's reason, on the reports and in their log images; the scorers, the
# cards and the proposed result stand as the league's record of the match.


def build_season_report_texts_filter(saison_id: str) -> Mapping[str, Any]:
    """This season's reports still holding remarks or a card's reason, so a season stripped already is written nothing."""

    # `$type` and never `$ne: null`, which a list of cards matches only where no card holds a null reason.
    return {"saison_id": saison_id, "$or": [{"bericht.bemerkungen": {"$type": "string"}}, {"bericht.karten.grund": {"$type": "string"}}]}


def build_season_report_images_filter(saison_id: str) -> Mapping[str, Any]:
    """Every `spielberichte` log row whose image of this season's report holds remarks or a card's reason."""

    return {
        "collection": str(Collection.SPIELBERICHTE),
        "before.saison_id": saison_id,
        "$or": [{"before.bericht.bemerkungen": {"$type": "string"}}, {"before.bericht.karten.grund": {"$type": "string"}}],
    }


def season_end_report_image_edits(image: Mapping[str, Any], saison_id: str) -> dict[str, None]:
    """One image of this season's report stripped as the report is: its remarks and every card's reason."""

    bericht = image.get("bericht")
    if image.get("saison_id") != saison_id or not isinstance(bericht, Mapping):
        return {}

    edits: dict[str, None] = {"bericht.bemerkungen": None} if bericht.get("bemerkungen") is not None else {}
    for index, karte in enumerate(bericht.get("karten") or []):
        if isinstance(karte, Mapping) and karte.get("grund") is not None:
            edits[f"bericht.karten.{index}.grund"] = None

    return edits


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
