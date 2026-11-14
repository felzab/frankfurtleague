"""The Übersicht: one season's open work, each kind on its card, read in one aggregation.

The read is anchored on the season's own document, and every collection a card draws on is joined to it by an
uncorrelated `$lookup`: the fixtures through `build_spiele_pipeline`, the confirmation rows in the administrator's
queue and every row holding its party's question, the reports and the undecided applications. That makes one round
trip and one document. Each kind is judged here in Python, by the predicates the confirmations, the reports and the
applications already hold, so no rule is spelled a second time in a query. The bracket faults are the exception: they
need the standings walk, so they are judged over the same fixtures by `bracket_faults_of`, whose own reads are the
ones no aggregation can fold in.
"""

from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime
from typing import Annotated, Any, Final, Literal, get_args

from pydantic import BaseModel, Field

from app.api.bewerbungen.services import (
    build_bewerbungen_sort,
    pending_seats,
)
from app.api.spielberichte.schemas import FLSpielberichtBericht
from app.api.spielberichte.services import FLSpielberichtOpenState, bericht_state_of, build_state_pipeline, is_open
from app.api.spielbestaetigungen.schemas import FLSpielbestaetigungAppointment
from app.api.spielbestaetigungen.services import (
    CLOSE_FIELDS,
    build_holding_filter,
    build_triage_rows_filter,
    due_by_of,
    lapsed_on,
    parties_told_of_the_change,
    party_key,
    reason_to_close,
)
from app.api.spiele.schemas import (
    SONDEREREIGNIS_OWING_NOTHING,
    FLBracketFault,
    FLSpielbestaetigungParty,
    FLSpielJoinedAdmin,
    FLSpielJoinedInternal,
    FLSpielRecipient,
)
from app.api.spiele.services import PARTY_NAME_FIELD, build_party_name_stages, build_spiele_pipeline, recipients_named
from app.core import clock
from app.core.collections import Collection
from app.shared.schemas.custom import CustomDateString, CustomNonEmptyString, CustomObjectId, CustomOptionalDateString
from app.shared.schemas.literals import KONTAKT_ROLLEN
from app.shared.schemas.responses import BaseAPIResponse

# The four cards, in the urgency order the page shows them: what is due by a deadline, the results, the fixtures'
# slots and casts, then the applications.
type FLOverviewCardName = Literal["due", "ergebnisse", "dates", "bewerbungen"]

# What a fixture lacks, read off the fixture alone: its slot, set from the row, or what the match editor sets. A referee
# missing is one kind whether nobody was booked or the booked one declined, since either asks the same act.
type FLOverviewGapKind = Literal["ergebnis_missing", "appointment_missing", "spielort_missing", "schiedsrichter_missing", "team_missing"]

# A party's answer still owed, a club's or the booked referee's: lapsed, or not yet.
type FLOverviewAnswerKind = Literal["spielbestaetigung_overdue", "spielbestaetigung_due"]

type FLOverviewKind = FLOverviewGapKind | FLOverviewAnswerKind | Literal["spielbericht_open", "vorschlag_open", "bracket_fault", "bewerbung"]

# Which card each kind of open work stands on: the one table a placement moves in, so moving a kind is one line here
# and nothing on the wire changes shape. Its order is the order of the rows within a card, and a fixture standing for
# several kinds on one card stands once, for the first of them.
CARD_OF: Final[Mapping[FLOverviewKind, FLOverviewCardName]] = {
    "spielbestaetigung_overdue": "due",
    "spielbestaetigung_due": "due",
    # A report to adopt before a result missing: on a fixture played without one, the report is how the result comes.
    "spielbericht_open": "ergebnisse",
    "ergebnis_missing": "ergebnisse",
    "vorschlag_open": "dates",
    "appointment_missing": "dates",
    "spielort_missing": "dates",
    "schiedsrichter_missing": "dates",
    "team_missing": "dates",
    "bracket_fault": "dates",
    "bewerbung": "bewerbungen",
}

KIND_ORDER: Final[Mapping[FLOverviewKind, int]] = {kind: place for place, kind in enumerate(CARD_OF)}

CARDS: Final[tuple[FLOverviewCardName, ...]] = get_args(FLOverviewCardName.__value__)

# What the season's one document carries beside its own `rules`, each the `as` of one `$lookup`.
SPIELE_AS: Final = "spiele"
QUEUE_ROWS_AS: Final = "queue_rows"
HELD_ROWS_AS: Final = "held_rows"
SPIELBERICHTE_AS: Final = "spielberichte"
BEWERBUNGEN_AS: Final = "bewerbungen"
PICKED_CLUB_AS: Final = "picked_club"

# The stored keys of a confirmation row this module reads raw, named once so the stored rename finds them: no model
# of the rows serves the subset a card needs.
ROW_PARTY: Final = "party"
ROW_ANSWER: Final = "answer"
ROW_DEADLINE: Final = "deadline"


class FLOverviewSpielRow(BaseModel):
    """A fixture lacking what its kind names, or played and still without a result; its act is the match editor's."""

    kind: FLOverviewGapKind
    spiel: FLSpielJoinedAdmin


class FLOverviewParty(BaseModel):
    """One party's open confirmation row, a club's or the booked referee's: the row „Zusage eintragen“ records its agreement on.

    `name` is the one its own record holds, as each act's recipients are named, so the page names every party one way.
    """

    spielbestaetigung_id: CustomObjectId
    party: FLSpielbestaetigungParty
    name: CustomNonEmptyString
    # The day the party's request was first mailed, as the match editor's row serves it; null where it was never mailed,
    # its club holding no confirmed seat, so the league enters its Zusage.
    asked_at: CustomOptionalDateString
    # The day the party's answer is due by, as the match editor's row serves it: a club's stored deadline, and a
    # referee's slot, whom no deadline binds.
    due_by: CustomDateString
    # The day the party's answer lapsed, its `due_by` gone by; null while it may still answer, as a referee may until
    # the kick-off.
    lapsed_on: CustomDateString | None


class FLOverviewSpielbestaetigungRow(BaseModel):
    """A fixture whose parties owe their answer: overdue where one party's answer has lapsed, else still due."""

    kind: FLOverviewAnswerKind
    spiel: FLSpielJoinedAdmin
    # Every party of the fixture still owing its answer, so the act offers each one still open.
    parties: list[FLOverviewParty]


class FLOverviewVorschlagRow(BaseModel):
    """A club's decline proposing another date and hour, neither adopted nor discarded; its row is the one both acts write.

    Each act's recipients are the parties the backend mails of it, each by the name its own record holds, so its question
    names them: `adoption_recipients` those the confirmation pass tells of the move, `discard_recipients` the club the
    discard tells the date stands.
    """

    kind: Literal["vorschlag_open"]
    spiel: FLSpielJoinedAdmin
    spielbestaetigung_id: CustomObjectId
    team_id: CustomObjectId
    vorschlag: FLSpielbestaetigungAppointment
    adoption_recipients: list[FLSpielRecipient]
    discard_recipients: list[FLSpielRecipient]


class FLOverviewSpielberichtRow(BaseModel):
    """A report awaiting the administrator: not adopted, changed since its adoption, or written for other clubs."""

    kind: Literal["spielbericht_open"]
    spiel: FLSpielJoinedAdmin
    state: FLSpielberichtOpenState


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
    """One card and its rows, a fixture once, ordered by kind, then each fixture's day, undated last, then its number."""

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
        # The rows in the administrator's queue: a standing proposal, a deadline passed, or due today. Each one still has
        # to speak for its fixture as it stands, which `reason_to_close` judges below.
        {
            "$lookup": {
                "from": Collection.SPIELBESTAETIGUNGEN,
                "pipeline": [
                    {"$match": build_triage_rows_filter(saison_id=saison_id, today=today)},
                    # An inclusion of what the close's judgement and the cards read, so nothing else a row stores reaches
                    # this handler.
                    {"$project": dict.fromkeys([*CLOSE_FIELDS, ROW_ANSWER, ROW_DEADLINE], 1)},
                    # Each party by its own record's name, as the acts' recipients below are named.
                    *build_party_name_stages(saison_id=saison_id),
                ],
                "as": QUEUE_ROWS_AS,
            }
        },
        # Every row holding its party's question, as the pass's close reads it: whom an adoption has the pass tell.
        {
            "$lookup": {
                "from": Collection.SPIELBESTAETIGUNGEN,
                "pipeline": [
                    {"$match": {"saison_id": saison_id, **build_holding_filter()}},
                    {"$project": dict.fromkeys(CLOSE_FIELDS, 1)},
                    # Each party by its own record's name, which both acts' recipients are named by: a standing proposal
                    # is unclosed, so its club is among these too.
                    *build_party_name_stages(saison_id=saison_id),
                ],
                "as": HELD_ROWS_AS,
            }
        },
        {"$lookup": {"from": Collection.SPIELBERICHTE, "pipeline": build_state_pipeline(saison_id=saison_id), "as": SPIELBERICHTE_AS}},
        {
            "$lookup": {
                "from": Collection.BEWERBUNGEN,
                "pipeline": [
                    {
                        "$match": {
                            "saison_id": saison_id,
                            "status": "submitted",
                        }
                    },
                    {"$sort": dict(build_bewerbungen_sort(order="asc"))},
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


def _gaps(spiel: FLSpielJoinedInternal, *, today: str) -> list[FLOverviewGapKind]:
    """What a fixture still lacks, each kind once; a fixture called off, struck out or decided by a no-show owes nothing."""

    if spiel.sonderereignis in SONDEREREIGNIS_OWING_NOTHING:
        return []

    open_side = spiel.saison_phase != "gruppenphase" and any(
        team is None and quelle is None for team, quelle in ((spiel.team1, spiel.team1_quelle), (spiel.team2, spiel.team2_quelle))
    )
    checks: tuple[tuple[FLOverviewGapKind, bool], ...] = (
        # From the day after the match, not from its kick-off as the report counts it: no result can stand while the match
        # is being played, and its evening is the referee's to send the report the result comes from.
        ("ergebnis_missing", spiel.date is not None and spiel.date < today and spiel.ergebnis is None),
        ("appointment_missing", spiel.date is None or spiel.time is None),
        ("spielort_missing", spiel.spielort is None),
        ("schiedsrichter_missing", spiel.schiedsrichter is None),
        # A knockout side with neither a club nor a source; the group phase carries no source.
        ("team_missing", open_side),
    )

    return [kind for kind, lacks in checks if lacks]


def _austritte(spiele: Iterable[FLSpielJoinedInternal]) -> dict[Any, str]:
    """Each club's exit day, as the fixtures' joined sides carry it: what `reason_to_close` asks of a row's clubs."""

    return {
        side.team_id: side.austritt.date
        for spiel in spiele
        for side in (spiel.team1, spiel.team2)
        if side is not None and side.austritt is not None
    }


def _order(row: FLOverviewRow) -> tuple[int, bool, str, int]:
    """`CARD_OF`'s order of kinds, then the fixture's day, undated last, then its number; applications as the read sorted them."""

    if isinstance(row, FLOverviewBewerbungRow):
        return KIND_ORDER[row.kind], False, "", 0

    return KIND_ORDER[row.kind], row.spiel.date is None, row.spiel.date or "", row.spiel.spiel_nr


def overview_of(
    *,
    read: Mapping[str, Any],
    spiele: Sequence[FLSpielJoinedInternal],
    faults: Sequence[FLBracketFault],
    now: datetime,
) -> FLSaisonOverviewResponse:
    """The four cards from the season's one document, its fixtures validated, and their faults."""

    today = clock.german_day(now)

    spiele_raw: dict[Any, Mapping[str, Any]] = {raw["_id"]: raw for raw in read[SPIELE_AS]}
    by_id: dict[Any, FLSpielJoinedInternal] = {spiel.id: spiel for spiel in spiele}
    austritte = _austritte(spiele)

    rows: list[FLOverviewRow] = []

    for spiel in spiele:
        rows.extend(FLOverviewSpielRow(kind=kind, spiel=spiel) for kind in _gaps(spiel, today=today))

    held: dict[Any, list[Mapping[str, Any]]] = {}
    for row in read[HELD_ROWS_AS]:
        held.setdefault(row["spiel_id"], []).append(row)
    names = {party_key(row[ROW_PARTY]): row.get(PARTY_NAME_FIELD) for row in read[HELD_ROWS_AS]}

    parties: dict[Any, list[FLOverviewParty]] = {}
    for row in read[QUEUE_ROWS_AS]:
        spiel_raw = spiele_raw.get(row["spiel_id"])
        # A row about an Ansetzung its fixture has left, or one the next pass ends, asks the administrator nothing.
        if spiel_raw is None or reason_to_close(row=row, spiel=spiel_raw, austritte=austritte, now=now) is not None:
            continue
        spiel = by_id[row["spiel_id"]]
        answer = row[ROW_ANSWER]
        # The queue's filter takes an answered row only for its standing proposal; an unanswered one is overdue or due today.
        if answer is not None:
            vorschlag = FLSpielbestaetigungAppointment.model_validate(answer["vorschlag"])
            adopted = {**spiel_raw, "date": vorschlag.date, "time": vorschlag.time}
            rows.append(
                FLOverviewVorschlagRow(
                    kind="vorschlag_open",
                    spiel=spiel,
                    spielbestaetigung_id=row["_id"],
                    team_id=row[ROW_PARTY]["team_id"],
                    vorschlag=vorschlag,
                    adoption_recipients=recipients_named(
                        parties_told_of_the_change(
                            rows=held.get(spiel.id, []),
                            stored=spiel_raw,
                            changed=adopted,
                            stored_austritte=austritte,
                            changed_austritte=austritte,
                            now=now,
                        ),
                        names=names,
                    ),
                    discard_recipients=recipients_named([row[ROW_PARTY]], names=names),
                )
            )
            continue
        parties.setdefault(spiel.id, []).append(
            FLOverviewParty(
                spielbestaetigung_id=row["_id"],
                party=row[ROW_PARTY],
                name=row.get(PARTY_NAME_FIELD),
                asked_at=row["asked_at"],
                due_by=due_by_of(row),
                # No reason: the next close ends none of these rows, as judged above.
                lapsed_on=lapsed_on(spielbestaetigung_raw=row, reason=None, spiel=spiel_raw, austritte=austritte, now=now),
            )
        )
    rows.extend(
        FLOverviewSpielbestaetigungRow(
            kind="spielbestaetigung_overdue" if any(party.lapsed_on is not None for party in owed) else "spielbestaetigung_due",
            spiel=by_id[spiel_id],
            parties=owed,
        )
        for spiel_id, owed in parties.items()
    )

    for row in read[SPIELBERICHTE_AS]:
        state = bericht_state_of(FLSpielberichtBericht.model_validate(row["bericht"]), row["spiel"])
        if is_open(state):
            rows.append(FLOverviewSpielberichtRow(kind="spielbericht_open", spiel=by_id[row["spiel_id"]], state=state))

    rows.extend(FLOverviewBracketFaultRow(kind="bracket_fault", spiel=by_id[fault.spiel_id], fault=fault) for fault in faults)

    for bewerbung in read[BEWERBUNGEN_AS]:
        picked = bewerbung[PICKED_CLUB_AS]
        rows.append(
            FLOverviewBewerbungRow(
                kind="bewerbung",
                bewerbung_id=bewerbung["_id"],
                name=picked[0]["name"] if picked else bewerbung["schule"]["team_name"],
                seats_confirmed=len(KONTAKT_ROLLEN) - len(pending_seats(kontakte=bewerbung.get("kontakte"))),
                seats=len(KONTAKT_ROLLEN),
            )
        )

    return FLSaisonOverviewResponse(
        cards=[FLOverviewCard(card=card, rows=_once(row for row in rows if CARD_OF[row.kind] == card)) for card in CARDS]
    )


def _once(rows: Iterable[FLOverviewRow]) -> list[FLOverviewRow]:
    """One card's rows in `_order`, each fixture once, for its first kind, so its row names one reason."""

    seen: set[Any] = set()
    kept: list[FLOverviewRow] = []
    for row in sorted(rows, key=_order):
        if not isinstance(row, FLOverviewBewerbungRow):
            if row.spiel.id in seen:
                continue
            seen.add(row.spiel.id)
        kept.append(row)
    return kept
