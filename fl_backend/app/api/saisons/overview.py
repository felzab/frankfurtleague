"""SAISONS · the Übersicht: one season's open work, each kind on its card, read in one aggregation.

The read is anchored on the season's own document, and every collection a card draws on is joined to it by an
uncorrelated `$lookup`: the fixtures through `build_spiele_pipeline`, the clubs' open confirmation rows, the referees'
newest rows, the reports and the undecided applications. That makes one round trip and one document. Each kind is
judged here in Python, by the predicates the confirmations, the reports and the applications already hold, so no rule
is spelled a second time in a query. The bracket faults are the exception: they need the standings walk, so they are
judged over the same fixtures by `app/api/spiele/crud.py :: bracket_faults_of`, whose own reads are the ones no
aggregation can fold in.
"""

from collections.abc import Iterable, Mapping, Sequence
from typing import Annotated, Any, Final, Literal, get_args

from pydantic import BaseModel, Field

from app.api.bewerbungen.services import (
    ausstehende_seats,
    build_bewerbungen_saison_term,
    build_bewerbungen_sort,
    build_bewerbungen_status_term,
)
from app.api.spielberichte.schemas import FLSpielberichtBericht, FLSpielberichtState
from app.api.spielberichte.services import BERICHT_ZUSTAENDE_OFFEN, bericht_zustand_of, build_zustand_pipeline
from app.api.spielbestaetigungen.schemas import FLSpielbestaetigungAppointment
from app.api.spielbestaetigungen.services import GRUND_EIGENE_ABSAGE, build_triage_rows_filter, grund_to_end
from app.api.spiele.schemas import SONDEREREIGNIS_COUNTED_AS_ABSAGE, FLBracketFault, FLSpielJoinedAdmin, FLSpielJoinedInternal
from app.api.spiele.services import build_spiele_pipeline
from app.core.collections import Collection
from app.shared.schemas.custom import CustomDateString, CustomObjectId
from app.shared.schemas.literals import KONTAKT_ROLLEN
from app.shared.schemas.responses import BaseAPIResponse

# The four cards, in the urgency order the page shows them: what is due by a deadline, the results, the fixtures'
# slots and casts, then the applications.
type FLOverviewCardName = Literal["due", "ergebnisse", "dates", "bewerbungen"]

# What a fixture lacks, read off the fixture alone and acted on in the match editor.
type FLOverviewGapKind = Literal[
    "ergebnis_missing", "date_missing", "time_missing", "spielort_missing", "schiedsrichter_missing", "schiedsrichter_declined", "team_missing"
]

# A club's answer still owed: past its deadline, or due today.
type FLOverviewAnswerKind = Literal["spielbestaetigung_overdue", "spielbestaetigung_due"]

type FLOverviewKind = FLOverviewGapKind | FLOverviewAnswerKind | Literal["spielbericht_open", "vorschlag_open", "bracket_fault", "bewerbung"]

# Which card each kind of open work stands on: the one table a placement moves in, so moving a kind is one line here
# and nothing on the wire changes shape. Its order is the order of the rows within a card.
CARD_OF: Final[Mapping[FLOverviewKind, FLOverviewCardName]] = {
    "spielbestaetigung_overdue": "due",
    "spielbestaetigung_due": "due",
    "ergebnis_missing": "ergebnisse",
    "spielbericht_open": "ergebnisse",
    "vorschlag_open": "dates",
    "date_missing": "dates",
    "time_missing": "dates",
    "spielort_missing": "dates",
    "schiedsrichter_missing": "dates",
    "schiedsrichter_declined": "dates",
    "team_missing": "dates",
    "bracket_fault": "dates",
    "bewerbung": "bewerbungen",
}

KIND_ORDER: Final[Mapping[FLOverviewKind, int]] = {kind: place for place, kind in enumerate(CARD_OF)}

CARDS: Final[tuple[FLOverviewCardName, ...]] = get_args(FLOverviewCardName.__value__)

# What the season's one document carries beside its own `rules`, each the `as` of one `$lookup`.
SPIELE_AS: Final = "spiele"
CLUB_ROWS_AS: Final = "club_rows"
REFEREE_ROWS_AS: Final = "referee_rows"
SPIELBERICHTE_AS: Final = "spielberichte"
BEWERBUNGEN_AS: Final = "bewerbungen"
PICKED_CLUB_AS: Final = "picked_club"

# The stored keys of a confirmation row this module reads raw, named once so the stored rename finds them: no model
# of the rows serves the subset a card needs.
ROW_PARTY: Final = "party"
ROW_ANSWER: Final = "antwort"
ROW_DEADLINE: Final = "frist"
ROW_CLOSED: Final = "closed"


class FLOverviewSpielRow(BaseModel):
    """A fixture lacking what its kind names, or played and still without a result; its act is the match editor's."""

    kind: FLOverviewGapKind
    spiel: FLSpielJoinedAdmin


class FLOverviewParty(BaseModel):
    """One club's open confirmation row: the row „Zusage eintragen“ records the club's agreement on."""

    spielbestaetigung_id: CustomObjectId
    team_id: CustomObjectId
    deadline: CustomDateString


class FLOverviewSpielbestaetigungRow(BaseModel):
    """A fixture whose clubs owe their answer: overdue past its deadline, or due today and asked today or not yet."""

    kind: FLOverviewAnswerKind
    spiel: FLSpielJoinedAdmin
    # Every club of the fixture in this kind, so the act offers each party still open.
    parties: list[FLOverviewParty]


class FLOverviewVorschlagRow(BaseModel):
    """A club's decline proposing another date and hour, neither adopted nor discarded; its row is the one both acts write."""

    kind: Literal["vorschlag_open"]
    spiel: FLSpielJoinedAdmin
    spielbestaetigung_id: CustomObjectId
    team_id: CustomObjectId
    vorschlag: FLSpielbestaetigungAppointment


class FLOverviewSpielberichtRow(BaseModel):
    """A report awaiting the administrator: not adopted, changed since its adoption, or written for other clubs."""

    kind: Literal["spielbericht_open"]
    spiel: FLSpielJoinedAdmin
    state: FLSpielberichtState


class FLOverviewBracketFaultRow(BaseModel):
    """One derived fault of the season's bracket or bookings, on the fixture it names."""

    kind: Literal["bracket_fault"]
    spiel: FLSpielJoinedAdmin
    fault: FLBracketFault


class FLOverviewBewerbungRow(BaseModel):
    """One undecided application to play the season, by its school's name and how many of its seats have confirmed."""

    kind: Literal["bewerbung"]
    bewerbung_id: CustomObjectId
    # The club the applicant picked, or the new school it proposed.
    name: str
    seats_confirmed: int
    seats: int


type FLOverviewRow = Annotated[
    FLOverviewSpielRow
    | FLOverviewSpielbestaetigungRow
    | FLOverviewVorschlagRow
    | FLOverviewSpielberichtRow
    | FLOverviewBracketFaultRow
    | FLOverviewBewerbungRow,
    Field(discriminator="kind"),
]


class FLOverviewCard(BaseModel):
    """One card and its rows, ordered by `CARD_OF`'s kinds, then each fixture's day, undated last, then its number."""

    card: FLOverviewCardName
    rows: list[FLOverviewRow]


class FLSaisonOverviewResponse(BaseAPIResponse):
    # All four cards in `CARDS`' order, an empty one included, so the page keeps one shape every day.
    cards: list[FLOverviewCard]


def build_overview_pipeline(*, saison_id: str, today: str) -> list[Mapping[str, Any]]:
    """The season's document with everything its cards judge, one `$lookup` per source.

    Each `$lookup` is uncorrelated, reading nothing of the season's document, which is only the anchor: no season, no
    document. Each source's pipeline opens on the season's own key. The whole answer is one document, held by MongoDB's
    16 MiB document cap: a season's fixtures, rows and reports are bounded by its rules.
    """

    return [
        {"$match": {"_id": saison_id}},
        {"$project": {"rules": 1}},
        {"$lookup": {"from": Collection.SPIELE, "pipeline": build_spiele_pipeline(db_filter={"saison_id": saison_id}), "as": SPIELE_AS}},
        # The clubs' rows in the administrator's queue: a standing proposal, a deadline passed, or due today. Each one
        # still has to speak for its fixture as it stands, which `grund_to_end` judges below.
        {
            "$lookup": {
                "from": Collection.SPIELBESTAETIGUNGEN,
                "pipeline": [{"$match": build_triage_rows_filter(saison_id=saison_id, today=today)}, {"$project": {"kontakte": 0}}],
                "as": CLUB_ROWS_AS,
            }
        },
        # Each fixture's newest referee row and how it closed: a referee's own decline stands until a later booking.
        {
            "$lookup": {
                "from": Collection.SPIELBESTAETIGUNGEN,
                "pipeline": [
                    {"$match": {"saison_id": saison_id, f"{ROW_PARTY}.art": "schiedsrichter"}},
                    {"$sort": {"_id": -1}},
                    {"$group": {"_id": "$spiel_id", ROW_CLOSED: {"$first": f"${ROW_CLOSED}"}}},
                ],
                "as": REFEREE_ROWS_AS,
            }
        },
        {"$lookup": {"from": Collection.SPIELBERICHTE, "pipeline": build_zustand_pipeline(saison_id=saison_id), "as": SPIELBERICHTE_AS}},
        {
            "$lookup": {
                "from": Collection.BEWERBUNGEN,
                "pipeline": [
                    {
                        "$match": {
                            **build_bewerbungen_saison_term(saison_id=saison_id, saison_reference=None),
                            **build_bewerbungen_status_term(["submitted"]),
                        }
                    },
                    {"$sort": dict(build_bewerbungen_sort(sort_by="submitted_at", order="asc"))},
                    {
                        "$lookup": {
                            "from": Collection.TEAMS,
                            "localField": "team_id",
                            "foreignField": "_id",
                            "pipeline": [{"$project": {"_id": 0, "name": 1}}],
                            "as": PICKED_CLUB_AS,
                        }
                    },
                    # The seats for their confirmation alone; nothing of a person is served.
                    {"$project": {"schule.team_name": 1, "kontakte": 1, PICKED_CLUB_AS: 1}},
                ],
                "as": BEWERBUNGEN_AS,
            }
        },
    ]


def _gaps(spiel: FLSpielJoinedInternal, *, today: str, declined: bool) -> list[FLOverviewGapKind]:
    """What a fixture still lacks, each kind once; a fixture called off or struck out owes nothing."""

    if spiel.sonderereignis in SONDEREREIGNIS_COUNTED_AS_ABSAGE:
        return []

    open_side = spiel.saison_phase != "gruppenphase" and any(
        team is None and quelle is None for team, quelle in ((spiel.team1, spiel.team1_quelle), (spiel.team2, spiel.team2_quelle))
    )
    checks: tuple[tuple[FLOverviewGapKind, bool], ...] = (
        ("ergebnis_missing", spiel.datum is not None and spiel.datum < today and spiel.ergebnis is None),
        ("date_missing", spiel.datum is None),
        ("time_missing", spiel.uhrzeit is None),
        ("spielort_missing", spiel.ort is None),
        ("schiedsrichter_missing", spiel.schiedsrichter is None),
        ("schiedsrichter_declined", declined),
        # A knockout side with neither a club nor a source; the group phase carries no source.
        ("team_missing", open_side),
    )

    return [kind for kind, lacks in checks if lacks]


def _austritte(spiele: Iterable[FLSpielJoinedInternal]) -> dict[Any, str]:
    """Each club's exit day, as the fixtures' joined sides carry it: what `grund_to_end` asks of a row's clubs."""

    return {
        side.team_id: side.austritt.datum
        for spiel in spiele
        for side in (spiel.team1, spiel.team2)
        if side is not None and side.austritt is not None
    }


def _order(row: FLOverviewRow) -> tuple[int, bool, str, int]:
    """`CARD_OF`'s order of kinds, then the fixture's day, undated last, then its number; applications as the read sorted them."""

    if isinstance(row, FLOverviewBewerbungRow):
        return KIND_ORDER[row.kind], False, "", 0

    return KIND_ORDER[row.kind], row.spiel.datum is None, row.spiel.datum or "", row.spiel.spiel_nr


def overview_of(
    *,
    read: Mapping[str, Any],
    spiele: Sequence[FLSpielJoinedInternal],
    faults: Sequence[FLBracketFault],
    today: str,
) -> FLSaisonOverviewResponse:
    """The four cards from the season's one document, its fixtures validated, and their faults."""

    spiele_raw: dict[Any, Mapping[str, Any]] = {raw["_id"]: raw for raw in read[SPIELE_AS]}
    by_id: dict[Any, FLSpielJoinedInternal] = {spiel.id: spiel for spiel in spiele}
    austritte = _austritte(spiele)
    declined = {row["_id"] for row in read[REFEREE_ROWS_AS] if (row.get(ROW_CLOSED) or {}).get("grund") == GRUND_EIGENE_ABSAGE}

    rows: list[FLOverviewRow] = []

    for spiel in spiele:
        rows.extend(
            FLOverviewSpielRow(kind=kind, spiel=spiel)
            for kind in _gaps(spiel, today=today, declined=spiel.schiedsrichter is None and spiel.id in declined)
        )

    parties: dict[tuple[FLOverviewAnswerKind, Any], list[FLOverviewParty]] = {}
    for row in read[CLUB_ROWS_AS]:
        spiel_raw = spiele_raw.get(row["spiel_id"])
        # A row about an Ansetzung its fixture has left, or one the next pass ends, asks the administrator nothing.
        if spiel_raw is None or grund_to_end(row=row, spiel=spiel_raw, austritte=austritte, today=today) is not None:
            continue
        spiel = by_id[row["spiel_id"]]
        team_id = row[ROW_PARTY]["team_id"]
        answer = row[ROW_ANSWER]
        # The queue's filter takes an answered row only for its standing proposal; an unanswered one is overdue or due today.
        if answer is not None:
            rows.append(
                FLOverviewVorschlagRow(
                    kind="vorschlag_open",
                    spiel=spiel,
                    spielbestaetigung_id=row["_id"],
                    team_id=team_id,
                    vorschlag=FLSpielbestaetigungAppointment.model_validate(answer["vorschlag"]),
                )
            )
            continue
        kind: FLOverviewAnswerKind = "spielbestaetigung_overdue" if row[ROW_DEADLINE] < today else "spielbestaetigung_due"
        parties.setdefault((kind, spiel.id), []).append(
            FLOverviewParty(spielbestaetigung_id=row["_id"], team_id=team_id, deadline=row[ROW_DEADLINE])
        )
    rows.extend(FLOverviewSpielbestaetigungRow(kind=kind, spiel=by_id[spiel_id], parties=owed) for (kind, spiel_id), owed in parties.items())

    for row in read[SPIELBERICHTE_AS]:
        state = bericht_zustand_of(FLSpielberichtBericht.model_validate(row["bericht"]), row["spiel"])
        if state in BERICHT_ZUSTAENDE_OFFEN:
            rows.append(FLOverviewSpielberichtRow(kind="spielbericht_open", spiel=by_id[row["spiel_id"]], state=state))

    rows.extend(FLOverviewBracketFaultRow(kind="bracket_fault", spiel=by_id[fault.spiel_id], fault=fault) for fault in faults)

    for bewerbung in read[BEWERBUNGEN_AS]:
        picked = bewerbung[PICKED_CLUB_AS]
        rows.append(
            FLOverviewBewerbungRow(
                kind="bewerbung",
                bewerbung_id=bewerbung["_id"],
                name=picked[0]["name"] if picked else bewerbung["schule"]["team_name"],
                seats_confirmed=len(KONTAKT_ROLLEN) - len(ausstehende_seats(kontakte=bewerbung.get("kontakte"))),
                seats=len(KONTAKT_ROLLEN),
            )
        )

    return FLSaisonOverviewResponse(
        cards=[FLOverviewCard(card=card, rows=sorted((row for row in rows if CARD_OF[row.kind] == card), key=_order)) for card in CARDS]
    )
