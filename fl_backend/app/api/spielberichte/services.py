from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime
from http import HTTPStatus
from typing import Any, Final, Literal, NamedTuple, TypeIs, get_args

from bson import ObjectId

from app.api.bewerbungen.services import season_has_ended
from app.api.spielberichte.schemas import (
    FLSpielberichtBericht,
    FLSpielberichtBerichtPayload,
    FLSpielberichtPublic,
    FLSpielberichtSpieler,
    FLSpielberichtState,
    FLSpielberichtVorschlag,
)
from app.api.spiele.schemas import SONDEREREIGNIS_NO_SHOW, SONDEREREIGNIS_WITHOUT_A_RESULT, FLSpielElfmeterschiessen
from app.api.spieler.services import PUBLIC_PERSON
from app.core.codes import Code
from app.core.collections import Collection
from app.core.crud import VERSION_FIELD, refuse
from app.core.exceptions import WriteRefusal
from app.shared.schemas.literals import FLSpielSide

SIDES: Final[tuple[FLSpielSide, ...]] = ("team1", "team2")

# What the report's judges and its form read off the fixture, each side with its name joined; no money, no notice.
SPIEL_FIELDS: Final[Mapping[str, int]] = {
    "_id": 1,
    "saison_id": 1,
    "saison_phase": 1,
    "spiel_nr": 1,
    "date": 1,
    "time": 1,
    "team1": 1,
    "team2": 1,
    "schiedsrichter.schiedsrichter_id": 1,
    "sonderereignis": 1,
    "ergebnis": 1,
    "elfmeterschiessen": 1,
    # The ground the form's lead names, never its rent.
    **dict.fromkeys(("spielort.spielort_id", "spielort.name", "spielort.maps_link"), 1),
}


class BerichtContext(NamedTuple):
    """What one report is judged against: the fixture, both clubs' squad rows of the season, and the season's status."""

    spiel: Mapping[str, Any]
    # Every squad row of the two clubs in the season, ausgetragen ones too, each joined to its pupil's names.
    kader: Sequence[Mapping[str, Any]]
    saison_status: str


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
                "pipeline": [{"$project": {"_id": 0, "first_name": 1, "last_name": 1}}],
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
                # Each a key every row is written with, null where unset, which the read model requires.
                "first_name": "$person.first_name",
                "last_name": "$person.last_name",
                "nummer": 1,
                "inactive_since": 1,
            }
        },
        {"$sort": {"last_name": 1, "first_name": 1, "spieler_id": 1}},
    ]


def build_submitted_pipeline(*, saison_id: str, spiel_fields: Mapping[str, int]) -> list[Mapping[str, Any]]:
    """A season's reports, each joined to `spiel_fields` of its fixture."""

    return [
        {"$match": {"saison_id": saison_id}},
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


def build_state_pipeline(*, saison_id: str) -> list[Mapping[str, Any]]:
    """A season's reports, each beside its fixture's result fields."""

    return [
        *build_submitted_pipeline(
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


def team_id_of(spiel_raw: Mapping[str, Any], side: FLSpielSide) -> ObjectId | None:
    team_field = spiel_raw.get(side)

    return None if team_field is None else team_field["team_id"]


def sides_of(spiel_raw: Mapping[str, Any]) -> dict[FLSpielSide, ObjectId | None]:
    """The clubs the fixture fields now, as a report's `sides` stores them."""

    return {side: team_id_of(spiel_raw, side) for side in SIDES}


def sides_changed(saved: Mapping[str, Any], spiel_raw: Mapping[str, Any]) -> frozenset[FLSpielSide]:
    """The sides on which the fixture fields another club than the report's last write found there."""

    current = sides_of(spiel_raw)

    return frozenset(side for side in SIDES if saved[side] != current[side])


def live_kader(context: BerichtContext, side: FLSpielSide) -> list[Mapping[str, Any]]:
    """That side's live squad: an open knockout slot fields nobody."""

    team_id = team_id_of(context.spiel, side)

    return [row for row in context.kader if team_id is not None and row["team_id"] == team_id and row["inactive_since"] is None]


def named_ids_of(bericht: Mapping[str, Any] | FLSpielberichtBerichtPayload | None) -> dict[FLSpielSide, set[ObjectId]]:
    """Every pupil a block names, per side; a scorer nobody named is no id."""

    named: dict[FLSpielSide, set[ObjectId]] = {side: set() for side in SIDES}
    if bericht is None:
        return named

    raw = (
        bericht.model_dump(context={"keep_oid": True}, include={"scorers", "cards"})
        if isinstance(bericht, FLSpielberichtBerichtPayload)
        else bericht
    )
    for entry in [*raw["scorers"], *raw["cards"]]:
        if entry["spieler_id"] is not None:
            named[entry["side"]].add(entry["spieler_id"])

    return named


def newly_named(
    payload: FLSpielberichtBerichtPayload, saved: Mapping[str, Any] | None, spiel_raw: Mapping[str, Any]
) -> dict[FLSpielSide, set[ObjectId]]:
    """The pupils this write names that the stored block did not name on that side, the only ones judged against the squad.

    So a correction keeps a scorer ausgetragen or erased since the match.
    """

    stored = named_ids_of(saved)
    # A side fielding another club since keeps none: its stored pupils played for the club that left it.
    for side in set() if saved is None else sides_changed(saved["sides"], spiel_raw):
        stored[side] = set()

    return {side: ids - stored[side] for side, ids in named_ids_of(payload).items()}


def find_not_refereed_refusal(*, spiel_raw: Mapping[str, Any], schiedsrichter_ids: Iterable[ObjectId]) -> WriteRefusal | None:
    """`bericht_not_officiated`: the report is the booked referee's, and the ghost or an empty slot books nobody who could write it."""

    booked = (spiel_raw.get("schiedsrichter") or {}).get("schiedsrichter_id")
    if booked is not None and booked in set(schiedsrichter_ids):
        return None

    return WriteRefusal(
        error_code=Code.BERICHT_NOT_OFFICIATED,
        status=HTTPStatus.FORBIDDEN,
    )


def is_played(*, date: str | None, today: str) -> bool:
    return date is not None and date <= today


def is_cancelled(*, sonderereignis: str | None) -> bool:
    return sonderereignis in SONDEREREIGNIS_WITHOUT_A_RESULT


def find_not_played_refusal(*, date: str | None, today: str) -> WriteRefusal | None:
    """`bericht_not_played`: a report follows the match day; the day arriving, or a date corrected, lifts it."""

    if is_played(date=date, today=today):
        return None

    return WriteRefusal(
        error_code=Code.BERICHT_NOT_PLAYED,
        status=HTTPStatus.CONFLICT,
    )


def find_cancelled_refusal(*, sonderereignis: str | None) -> WriteRefusal | None:
    """`bericht_cancelled`: a fixture called off or struck out took no place to report on."""

    if not is_cancelled(sonderereignis=sonderereignis):
        return None

    return WriteRefusal(
        error_code=Code.BERICHT_CANCELLED,
        status=HTTPStatus.CONFLICT,
    )


def is_concluded(context: BerichtContext) -> bool:
    """Whether the fixture's season has ended, after which its referee reads the report and writes it no more."""

    return season_has_ended(saison_status=context.saison_status)


def find_saison_ended_refusal(context: BerichtContext) -> WriteRefusal | None:
    """`saison_past`: the referee writes while the fixture's season runs."""

    if not is_concluded(context):
        return None

    return WriteRefusal(
        error_code=Code.SAISON_PAST,
        status=HTTPStatus.CONFLICT,
    )


def find_elfmeter_in_gruppe_refusal(*, spiel_raw: Mapping[str, Any], payload: FLSpielberichtBerichtPayload) -> WriteRefusal | None:
    """`bericht_elfmeter_in_the_gruppe`: a group fixture keeps no shoot-out, so a proposal holding one could never read adopted."""

    if spiel_raw["saison_phase"] != "gruppenphase" or payload.ergebnis_vorschlag.elfmeterschiessen is None:
        return None

    return WriteRefusal(
        error_code=Code.BERICHT_ELFMETER_IN_THE_GRUPPE,
        status=HTTPStatus.CONFLICT,
    )


def takes_a_bericht(spiel_raw: Mapping[str, Any], *, today: str) -> bool:
    """Whether the fixture takes a report today, as `bericht_not_played` and `bericht_cancelled` judge a write, refusing nothing."""

    return is_played(date=spiel_raw.get("date"), today=today) and not is_cancelled(sonderereignis=spiel_raw.get("sonderereignis"))


def kader_is_open(context: BerichtContext, *, today: str) -> bool:
    """Whether the referee's form serves both squads to pick from: while the fixture takes a report and its season runs."""

    return takes_a_bericht(context.spiel, today=today) and not is_concluded(context)


def find_not_in_kader_refusal(*, context: BerichtContext, new: Mapping[FLSpielSide, set[ObjectId]]) -> WriteRefusal | None:
    """`spieler_not_in_kader`: a pupil newly named on a side is in that side's live squad of the season.

    Naming no entry, unlike the line-up's: the referee's form takes it as a page gone stale, whose reload serves the
    squads as they stand.
    """

    for side in SIDES:
        kader = {row["spieler_id"] for row in live_kader(context, side)}
        if not new[side] <= kader:
            return WriteRefusal(
                error_code=Code.SPIELER_NOT_IN_KADER,
                status=HTTPStatus.CONFLICT,
            )

    return None


def judge_bericht(
    *,
    context: BerichtContext,
    payload: FLSpielberichtBerichtPayload,
    new: Mapping[FLSpielSide, set[ObjectId]],
    today: str,
) -> None:
    """Every refusal the report's write asks inside its transaction and again outside it, in order."""

    refuse(find_not_played_refusal(date=context.spiel.get("date"), today=today))
    refuse(find_cancelled_refusal(sonderereignis=context.spiel.get("sonderereignis")))
    refuse(find_elfmeter_in_gruppe_refusal(spiel_raw=context.spiel, payload=payload))
    refuse(find_not_in_kader_refusal(context=context, new=new))


def vorschlag_matches(vorschlag: FLSpielberichtVorschlag, spiel_raw: Mapping[str, Any]) -> bool:
    """Whether the stored result is what the proposal proposes.

    A no-show by its event alone, its goals being the forfeit's; the shoot-out too, absent or not, which no write proposes
    where the fixture keeps none (`bericht_elfmeter_in_the_gruppe`).
    """

    if vorschlag.sonderereignis in SONDEREREIGNIS_NO_SHOW:
        return spiel_raw.get("sonderereignis") == vorschlag.sonderereignis

    tore = tuple((spiel_raw.get(side) or {}).get("tore") for side in SIDES)
    if tore != (vorschlag.team1_tore, vorschlag.team2_tore) or spiel_raw.get("sonderereignis") != vorschlag.sonderereignis:
        return False

    # `app/api/spiele/services.py :: apply_payload_to_spiel`'s rule: a level knockout keeps its shoot-out, so one saved
    # without the proposed shoot-out is not the proposal.
    saved = spiel_raw.get("elfmeterschiessen")

    return (None if saved is None else FLSpielElfmeterschiessen.model_validate(saved)) == vorschlag.elfmeterschiessen


# The states awaiting the administrator, which the Übersicht lists: an adopted report awaits nothing, and one on a match
# that took no place awaits nothing anyone can do.
type FLSpielberichtOpenState = Literal["proposed", "differing", "sides_changed"]

BERICHT_OPEN_STATES: Final[frozenset[FLSpielberichtOpenState]] = frozenset(get_args(FLSpielberichtOpenState.__value__))


def is_open(state: FLSpielberichtState) -> TypeIs[FLSpielberichtOpenState]:
    """Whether a report in `state` awaits the administrator."""

    return state in BERICHT_OPEN_STATES


def bericht_state_of(bericht: FLSpielberichtBericht, spiel_raw: Mapping[str, Any]) -> FLSpielberichtState:
    """The state a report reads in, from the fixture and the adoption.

    No result reads `proposed` however the report was stamped, as after a later save emptied the result or on an
    abandonment still owing its result.
    """

    if is_cancelled(sonderereignis=spiel_raw.get("sonderereignis")):
        return "cancelled"

    # Ahead of every comparison of the result: a proposal by side is about the clubs its last write found, and read
    # against another club's result it would credit that club.
    if sides_changed(dict(bericht.sides), spiel_raw):
        return "sides_changed"

    if spiel_raw.get("ergebnis") is None:
        return "proposed"

    if bericht.adopted and vorschlag_matches(bericht.ergebnis_vorschlag, spiel_raw):
        return "adopted"

    return "differing"


def compose_view(
    context: BerichtContext, *, kader_open: bool, named: Sequence[FLSpielberichtSpieler], document: Mapping[str, Any] | None
) -> dict[str, Any]:
    """What the referee's form reads: the fixture, the live squads, and the stored block.

    The squads empty unless `kader_open`: the referee picks from them only while the fixture takes a report.
    """

    spiel = context.spiel
    bericht = None if document is None else document["bericht"]

    def team(side: FLSpielSide) -> dict[str, Any] | None:
        team_field = spiel.get(side)
        return None if team_field is None else {key: team_field[key] for key in ("team_id", "name", "shorthand")}

    return {
        "spiel": {
            "spiel_id": spiel["_id"],
            "saison_id": spiel["saison_id"],
            "saison_phase": spiel["saison_phase"],
            "date": spiel.get("date"),
            "time": spiel.get("time"),
            "team1": team("team1"),
            "team2": team("team2"),
            # Absent rather than null where the projection met a fixture without a ground.
            "spielort": spiel.get("spielort"),
            "sonderereignis": spiel.get("sonderereignis"),
        },
        "kader": {side: live_kader(context, side) if kader_open else [] for side in SIDES},
        "named": named,
        "bericht": bericht,
        # Served rather than re-derived by the forms, which mark these sides' entries and offer none of their old pupils.
        "sides_changed": [] if bericht is None else sorted(sides_changed(bericht["sides"], spiel)),
        "version": None if document is None else document[VERSION_FIELD],
    }


def content_of(payload: FLSpielberichtBerichtPayload) -> dict[str, Any]:
    """What a write stores of its payload: the entries and the remarks as sent, the proposal with the two counts they credit."""

    return {
        **payload.model_dump(context={"keep_oid": True}, exclude={"ergebnis_vorschlag"}),
        "ergebnis_vorschlag": payload.proposed().model_dump(),
    }


def bericht_unchanged(payload: FLSpielberichtBerichtPayload, saved: Mapping[str, Any], sides: Mapping[FLSpielSide, ObjectId | None]) -> bool:
    """Whether the stored block already says what the payload says, for the clubs `sides` names, so a save of it writes nothing.

    A save sent unchanged after the clubs moved re-stamps them, making the report adoptable again.
    """

    return saved.get("sides") == sides and all(saved.get(key) == value for key, value in content_of(payload).items())


def compose_new_bericht(
    payload: FLSpielberichtBerichtPayload, *, sides: Mapping[FLSpielSide, ObjectId | None], now: datetime
) -> dict[str, Any]:
    """The block's first write, which nobody has adopted."""

    return {**content_of(payload), "sides": dict(sides), "submitted_at": now, "adopted": False}


def compose_bericht_update(payload: FLSpielberichtBerichtPayload, *, sides: Mapping[FLSpielSide, ObjectId | None]) -> dict[str, Any]:
    """A later write of the block: the content replaced, when it was first sent kept, and the adoption cleared with it.

    Cleared in the same update, so an adoption never stands on content its administrator did not see: the report reads
    `differing` until it is adopted anew.
    """

    return {
        "$set": {f"bericht.{key}": value for key, value in content_of(payload).items()}
        | {"bericht.sides": dict(sides), "bericht.adopted": False}
    }


# --- The STRIP once the season after the match ends: the remarks; the scorers, the cards and the proposed result stand
# as the league's record of the match.


def build_season_report_texts_filter(saison_id: str) -> Mapping[str, Any]:
    """This season's reports still holding remarks, so a season stripped already is written nothing."""

    return {"saison_id": saison_id, "bericht.remarks": {"$type": "string"}}


_NAMED_IDS_AS = "named_ids"
PUBLIC_PERSONS_AS = "persons"
PUBLIC_SQUAD_ROWS_AS = "squad_rows"


def build_public_bericht_pipeline(spiel_id: ObjectId) -> list[Mapping[str, Any]]:
    """One match's report with every pupil it names, masked as the base tier serves them, and their squad rows.

    In one aggregation, the persons projected through `PUBLIC_PERSON` at the join, so no consent record and no
    withheld name leaves the database; the squad rows of the match's season alone.
    """

    named = ["$bericht.scorers.spieler_id", "$bericht.cards.spieler_id"]

    return [
        {"$match": {"spiel_id": spiel_id}},
        # The whole block, which the adoption is judged on; `FLSpielberichtPublic` is the allow-list, and serves no
        # remarks.
        {"$project": {"saison_id": 1, "bericht": 1, _NAMED_IDS_AS: {"$setUnion": named}}},
        {
            "$lookup": {
                "from": Collection.SPIELER,
                "localField": _NAMED_IDS_AS,
                "foreignField": "_id",
                "pipeline": [{"$project": {"_id": 1, **PUBLIC_PERSON}}],
                "as": PUBLIC_PERSONS_AS,
            }
        },
        {
            "$lookup": {
                "from": Collection.SAISON_SPIELER,
                "localField": _NAMED_IDS_AS,
                "foreignField": "spieler_id",
                "let": {"saison_id": "$saison_id"},
                "pipeline": [
                    {"$match": {"$expr": {"$eq": ["$saison_id", "$$saison_id"]}}},
                    {"$project": {"_id": 0, "spieler_id": 1, "team_id": 1, "nummer": 1, "position": 1}},
                ],
                "as": PUBLIC_SQUAD_ROWS_AS,
            }
        },
    ]


def _minute_order(minute: str) -> tuple[int, int]:
    """A report's minute as the DFB writes it, `45+2` after `45` and before `46`."""

    played, _, stoppage = minute.partition("+")

    return int(played), int(stoppage or 0)


def compose_public_bericht(document: Mapping[str, Any], spiel_raw: Mapping[str, Any]) -> FLSpielberichtPublic:
    """What the public reads of one report, from `build_public_bericht_pipeline`'s document and the fixture.

    The scorers and the cards only while the report reads `adopted` (`bericht_state_of`): before the
    administrator adopts it, and after a correction made since, it is content nobody approved.
    """

    persons = {person["_id"]: person for person in document.get(PUBLIC_PERSONS_AS, [])}
    squad_rows = {(row["spieler_id"], row["team_id"]): row for row in document.get(PUBLIC_SQUAD_ROWS_AS, [])}

    def spieler(spieler_id: ObjectId | None, side: FLSpielSide) -> dict[str, Any]:
        if spieler_id is None:
            return {"type": "unknown", "first_name": None, "last_name": None, "nummer": None, "position": None}

        person = persons.get(spieler_id, {})
        row = squad_rows.get((spieler_id, team_id_of(spiel_raw, side)), {})
        # A null forename is the mask's answer for a withheld name and the placeholder's for an erased pupil alike.
        named = person.get("first_name") is not None

        return {
            "type": "named" if named else "anonymous",
            "first_name": person.get("first_name") if named else None,
            "last_name": person.get("last_name") if named else None,
            "nummer": row.get("nummer"),
            "position": row.get("position"),
        }

    bericht_raw = document["bericht"]
    adopted = bericht_state_of(FLSpielberichtBericht.model_validate(bericht_raw), spiel_raw) == "adopted"
    gated = bericht_raw if adopted else None

    return FLSpielberichtPublic.model_validate(
        {
            "scorers": None
            if gated is None
            else [
                {
                    "side": tor["side"],
                    "minute": tor["minute"],
                    "eigentor": tor["eigentor"],
                    "spieler": spieler(tor["spieler_id"], tor["side"]),
                }
                for tor in sorted(gated["scorers"], key=lambda tor: _minute_order(tor["minute"]))
            ],
            "cards": None
            if gated is None
            else [
                {
                    "side": card["side"],
                    "minute": card["minute"],
                    "colour": card["colour"],
                    "spieler": spieler(card["spieler_id"], card["side"]),
                }
                for card in sorted(gated["cards"], key=lambda card: _minute_order(card["minute"]))
            ],
        }
    )
