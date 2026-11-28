"""The match editor's one view read: the fixture, and everything its sections offer beside it or show of it.

Its own module because it composes three slices' reads, the reports' and the confirmations' beside the fixtures',
and each of those slices imports this one's schemas.
"""

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from pydantic import Field

from app.api.aufstellungen.schemas import FLAufstellungMarks, FLAufstellungSummary
from app.api.aufstellungen.services import aufstellung_marks, aufstellung_stands
from app.api.saisons.overview import PARTY_NAME_FIELD, build_party_name_stages
from app.api.saisons.services import has_started
from app.api.spielberichte.schemas import (
    FLSpielberichtBericht,
    FLSpielberichtScorer,
    FLSpielberichtState,
    FLSpielberichtVorschlag,
)
from app.api.spielberichte.services import SIDES, bericht_state_of
from app.api.spielbestaetigungen.crud import JUDGED_JUNCTION_FIELDS, pull_admin_rows
from app.api.spielbestaetigungen.schemas import FLSpielbestaetigungAnswer, FLSpielbestaetigungAppointment, FLSpielbestaetigungState
from app.api.spielbestaetigungen.services import (
    CLOSE_FIELDS,
    AnsetzungState,
    austritte_of,
    build_holding_filter,
    due_by_of,
    find_enter_refusal,
    holds_an_open_proposal,
    lapsed_on,
    party_key,
    reason_of,
    state_of,
)
from app.api.spiele.crud import MEMBERSHIP_FIELDS, membership_of
from app.api.spiele.schemas import (
    FLPatchSpielDataPayload,
    FLSpiel,
    FLSpielbestaetigungParty,
    FLSpielJoinedAdmin,
    FLSpielListAdapter,
    FLSpielRecipient,
    FLSpielTeamFieldPayload,
)
from app.api.spiele.services import (
    build_spiele_pipeline,
    find_eligibility_refusal,
    judge_spieltag_occupancy,
    stored_in_slice,
    vorschlag_recipients,
)
from app.core import clock
from app.core.concurrency import concurrently
from app.core.crud import GERMAN_COLLATION, VERSION_FIELD, aggregate_many_from_db, pull_many_from_db, pull_one_from_db, pull_whole_from_db
from app.core.exceptions import DocumentNotFoundError
from app.core.readonly import ReadCollection
from app.shared.einwilligung import is_confirmed
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.custom import CustomDateString, CustomNonEmptyString, CustomObjectId, CustomOptionalDateString
from app.shared.schemas.literals import FLSaisonStatus, FLSpielSide
from app.shared.schemas.responses import BaseReadModel


class FLSpielEditorSpielort(BaseReadModel):
    """A venue the editor offers: its name, the rent it defaults to, and the day it retired, null while it serves."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    name: CustomNonEmptyString
    default_mietpreis: int = Field(ge=0)
    inactive_since: CustomOptionalDateString


class FLSpielEditorSchiedsrichter(BaseReadModel):
    """A referee the editor offers: their whole name, the fee they default to, whether they confirmed their entry, and the day they retired."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    name: CustomNonEmptyString
    default_payment: int = Field(ge=0)
    # Offered unconfirmed too, so the editor marks the one a save refuses (`booking_unconfirmed_schiedsrichter`).
    confirmed: bool
    inactive_since: CustomOptionalDateString


class FLSpielEditorTeam(BaseReadModel):
    """A club a knockout fixture's Begegnung offers for either side, by the name and shorthand its season row holds.

    `on_spieltag` says the club stands on another fixture of this matchday, and `fieldable` whether a save fielding it
    here as the fixture stands would pass.
    """

    id: CustomObjectId
    name: CustomNonEmptyString
    # The plaque a side picked and not yet saved shows, as a fielded side's joined block carries it.
    shorthand: CustomNonEmptyString
    # A save fielding the club here either moves it off that fixture or is refused for it.
    on_spieltag: bool
    # Judged by the write's own eligibility and occupancy rules, on the side the club already holds.
    fieldable: bool


class FLSpielEditorSpieler(BaseReadModel):
    """A pupil a goal names, by the names their record holds, both null where no record holds the pupil."""

    spieler_id: CustomObjectId
    first_name: str | None
    last_name: str | None


class FLSpielEditorBericht(BaseReadModel):
    """The fixture's report as the editor's Spielbericht section shows it: its goals and the result they propose.

    `version` is the report document's, the one an adoption names (`adopts_bericht`), and `named` each pupil a goal
    names, by the names their record holds.
    """

    state: FLSpielberichtState
    version: int
    ergebnis_vorschlag: FLSpielberichtVorschlag
    scorers: list[FLSpielberichtScorer]
    named: list[FLSpielEditorSpieler]


class FLSpielEditorAufstellungen(BaseReadModel):
    """Each side's line-up as the editor's line states it, the club the fixture fields there now; null where it has stored none."""

    team1: FLAufstellungSummary | None
    team2: FLAufstellungSummary | None


class FLSpielEditorAufstellungMarks(BaseReadModel):
    """Each side's line-up marks, off the clock alone, as the club's own pages are served them.

    Null for an open side and for a fixture with no day or hour. A fixture carrying an event owes no line-up either,
    which a page reads off its `sonderereignis`, as the club's own pages do.
    """

    team1: FLAufstellungMarks | None
    team2: FLAufstellungMarks | None


class FLSpielbestaetigungEditorVorschlag(BaseReadModel):
    """A club's decline proposing another date and hour, neither adopted nor discarded, and whom each act on it mails.

    Each recipient by the name its own record holds, as the Übersicht names them: `adoption_recipients` those the
    confirmation pass tells of the move, `discard_recipients` the club the discard tells the date stands.
    """

    vorschlag: FLSpielbestaetigungAppointment
    adoption_recipients: list[FLSpielRecipient]
    discard_recipients: list[FLSpielRecipient]


class FLSpielbestaetigungEditorRow(BaseReadModel):
    """A confirmation row as the match editor reads it, the state it stands in, a closed row's included, and the league's acts it takes.

    Never `vorschlag`, which only a club's own page tells: an open row reads `valid` while its party may still answer.
    """

    # The row the league's acts on it write by.
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    party: FLSpielbestaetigungParty
    # The slot the row asked about, which an answer about a slot the match has left is shown beside.
    ansetzung: FLSpielbestaetigungAppointment
    # Null until the party was owed a mail, so a row nobody could be asked on reads as never asked.
    asked_at: CustomOptionalDateString
    answer: FLSpielbestaetigungAnswer | None
    state: FLSpielbestaetigungState
    # The day the party's answer is due by: a club's `deadline`, and a referee's slot, whom no deadline binds.
    due_by: CustomDateString
    # The day its answer lapsed, `due_by`; null on an answered row, on one a call-off or a move ended, and on one an exit
    # or a decision ended before its answer was due (`lapsed_on`).
    lapsed_on: CustomDateString | None
    # Whether the league may enter the party's Zusage on the row, as the write judges it: unanswered, unclosed and left
    # open by the pass's next close. A deadline gone by refuses nothing, so a lapsed row may take one and a row the
    # kick-off or a move ended may not, which `state` alone does not tell apart.
    enterable: bool
    # The club's standing proposal, which „Übernehmen“ and „Verwerfen“ act on; null on every other row.
    vorschlag_open: FLSpielbestaetigungEditorVorschlag | None


class FLSpieleAdminSingleResponse(BaseReadModel):
    """One fixture for the match editor, money and `version` included, and all its sections offer and show beside it."""

    spiel: FLSpielJoinedAdmin
    # On the response rather than on the fixture: the editor alone asks it, to open a finished season's match read-only,
    # which the save refuses, and a fixture carries no season-scoped state.
    saison_status: FLSaisonStatus
    # `has_started` on the season's start, as the save judges it: before it, the save takes no result
    # (`ergebnis_before_saison_start`), so the editor locks the result's fields.
    saison_begun: bool
    # Every live venue and referee, and the fixture's own where it has retired, so a booking stays named.
    spielorte: list[FLSpielEditorSpielort]
    schiedsrichter: list[FLSpielEditorSchiedsrichter]
    # Null on a group fixture, whose sides the draw sets and no save picks.
    teams: list[FLSpielEditorTeam] | None
    # Null where the fixture holds no report.
    spielbericht: FLSpielEditorBericht | None
    # The fixture's confirmation rows, newest first, as an administrator reads them.
    spielbestaetigungen: list[FLSpielbestaetigungEditorRow]
    aufstellungen: FLSpielEditorAufstellungen
    aufstellung_marks: FLSpielEditorAufstellungMarks


async def _junctions_of(
    rows: Sequence[Mapping[str, Any]], *, saison_id: str, saison_teams_collection: ReadCollection
) -> list[Mapping[str, Any]]:
    """The season rows of every club the confirmation rows' Ansetzungen name, as `state_of` judges a row against them."""

    team_ids = {team_id for row in rows for team_id in (row["ansetzung"]["team1_id"], row["ansetzung"]["team2_id"])}
    if not team_ids:
        return []

    return await pull_whole_from_db(
        collection=saison_teams_collection,
        db_filter={"saison_id": saison_id, "team_id": {"$in": list(team_ids)}},
        projection=JUDGED_JUNCTION_FIELDS,
    )


async def _proposals_of(
    rows: Sequence[Mapping[str, Any]],
    *,
    spiel_id: CustomObjectId,
    saison_id: str,
    ansetzung_state: AnsetzungState,
    austritte: Mapping[Any, str],
    spielbestaetigungen_collection: ReadCollection,
    saison_teams_collection: ReadCollection,
    now: datetime,
) -> dict[Any, FLSpielbestaetigungEditorVorschlag]:
    """Each standing proposal among the fixture's `rows`, by its row's id, with whom each act on it mails, as the Übersicht reads them.

    A proposal stands as the acts judge it (`holds_an_open_proposal`). Read only for a fixture holding one: the rows
    holding their party's question, each party by its own record's name, and the seats of every club a row asks, which
    decide whether a mail reaches it.
    """

    proposing = [row for row in rows if holds_an_open_proposal(spielbestaetigung_raw=row, ansetzung_state=ansetzung_state, now=now)]
    if not proposing:
        return {}

    # Every club a row of the fixture asks: the parties an adoption may tell are among them.
    team_ids = list({row["party"]["team_id"] for row in rows if row["party"]["kind"] == "team"})
    held, seats = await concurrently(
        aggregate_many_from_db(
            collection=spielbestaetigungen_collection,
            pipeline=[
                {"$match": {"saison_id": saison_id, "spiel_id": spiel_id, **build_holding_filter()}},
                {"$project": dict.fromkeys(CLOSE_FIELDS, 1)},
                *build_party_name_stages(saison_id=saison_id),
            ],
        ),
        pull_whole_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "team_id": {"$in": team_ids}},
            projection=["team_id", "kontakte"],
        ),
    )
    names = {party_key(row["party"]): row.get(PARTY_NAME_FIELD) for row in held}
    kontakte = {row["team_id"]: row.get("kontakte") for row in seats}

    def proposal(row: Mapping[str, Any]) -> FLSpielbestaetigungEditorVorschlag:
        vorschlag = FLSpielbestaetigungAppointment.model_validate(row["answer"]["vorschlag"])
        adoption, discard = vorschlag_recipients(
            party=row["party"],
            vorschlag=vorschlag,
            held=held,
            spiel=ansetzung_state.spiel,
            austritte=austritte,
            kontakte=kontakte,
            names=names,
            now=now,
        )
        return FLSpielbestaetigungEditorVorschlag(vorschlag=vorschlag, adoption_recipients=adoption, discard_recipients=discard)

    return {row["_id"]: proposal(row) for row in proposing}


async def _none() -> None:
    """The part a group fixture has none of, awaited beside the reads a knockout fixture makes in its place."""

    return None


def _offered(booked: CustomObjectId | None) -> Mapping[str, Any]:
    """Every live row, and the booked one whatever it is, so a fixture booked onto a retired row still names it."""

    return {"$or": [{"inactive_since": None}, *([] if booked is None else [{"_id": booked}])]}


def _fielding(stored: FLSpiel, team_id: CustomObjectId) -> FLPatchSpielDataPayload:
    """The save that fields this club on this fixture by hand, everything else as stored.

    On the side the club already holds, else the first, with that side's source cleared, as a hand-picked side is
    saved: the resolution leaves a side without a source as it stands (`_occupant_of`).
    """

    payload = FLPatchSpielDataPayload.model_validate(stored.model_dump(include=set(FLPatchSpielDataPayload.model_fields)))
    side = "team2" if stored.team2 is not None and stored.team2.team_id == team_id else "team1"
    held = getattr(stored, side)
    tore = held.tore if held is not None and held.team_id == team_id else None
    return payload.model_copy(update={side: FLSpielTeamFieldPayload(team_id=team_id, tore=tore), f"{side}_quelle": None})


async def _teams_of(
    *,
    spiel: FLSpielJoinedAdmin,
    spiele_collection: ReadCollection,
    saison_teams_collection: ReadCollection,
) -> list[FLSpielEditorTeam]:
    """Every club holding a row for the fixture's season, in the German order of their names, each judged by the write's own rules."""

    # Whole, as the save reads its season and its clubs.
    season_raw, rows = await concurrently(
        pull_whole_from_db(collection=spiele_collection, db_filter={"saison_id": spiel.saison_id}),
        pull_whole_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": spiel.saison_id},
            sort_by=[("name", 1)],
            projection=[*MEMBERSHIP_FIELDS, "shorthand"],
            collation=GERMAN_COLLATION,
        ),
    )
    season = FLSpielListAdapter.validate_python(season_raw)
    stored = stored_in_slice(spiel.id, season)
    membership = {row["team_id"]: membership_of(row) for row in rows}

    def judged(row: Mapping[str, Any]) -> FLSpielEditorTeam:
        team_id = row["team_id"]
        payload = _fielding(stored, team_id)
        verdict = judge_spieltag_occupancy(spiel.id, payload, season)
        return FLSpielEditorTeam(
            id=team_id,
            name=membership[team_id].name,
            shorthand=row["shorthand"],
            on_spieltag=verdict.refusal is not None or len(verdict.releases) > 0,
            fieldable=verdict.refusal is None and not find_eligibility_refusal(spiel.id, payload, season, membership),
        )

    return [judged(row) for row in rows]


async def _spielbericht_of(
    *,
    spiel_raw: Mapping[str, Any],
    spieler_collection: ReadCollection,
    spielberichte_collection: ReadCollection,
) -> FLSpielEditorBericht | None:
    """The report as the administrator's panel composes it, its goals alone: the cards and the remarks are not the editor's.

    Judged against the editor's own read of the fixture, which holds every stored field the report's state reads.
    """

    document = await spielberichte_collection.find_one({"spiel_id": spiel_raw["_id"]}, {"bericht": 1, VERSION_FIELD: 1})
    if document is None:
        return None

    bericht = FLSpielberichtBericht.model_validate(document["bericht"])
    scorers = sorted({tor.spieler_id for tor in bericht.scorers if tor.spieler_id is not None})
    # The scorers alone, off their own records: the page names nobody else the report names.
    people = (
        []
        if not scorers
        else await pull_whole_from_db(
            collection=spieler_collection,
            db_filter={"_id": {"$in": scorers}},
            projection=["first_name", "last_name"],
        )
    )
    found = {person["_id"]: person for person in people}

    return FLSpielEditorBericht(
        state=bericht_state_of(bericht, spiel_raw),
        version=document[VERSION_FIELD],
        ergebnis_vorschlag=bericht.ergebnis_vorschlag,
        scorers=bericht.scorers,
        # A pupil erased since keeps the goal and names nobody, as the report's own read serves them.
        named=[
            FLSpielEditorSpieler(
                spieler_id=spieler_id,
                first_name=found.get(spieler_id, {}).get("first_name"),
                last_name=found.get(spieler_id, {}).get("last_name"),
            )
            for spieler_id in scorers
        ],
    )


async def _aufstellungen_of(
    *, spiel: FLSpielJoinedAdmin, aufstellungen_collection: ReadCollection, now: datetime
) -> tuple[FLSpielEditorAufstellungen, FLSpielEditorAufstellungMarks]:
    """Each side's stored line-up, counted, and its marks at `now`: picked by the club the fixture fields there now, never by a side.

    A club a knockout correction replaced keeps its line-up, which no side then names.
    """

    fielded = {side: field.team_id for side in SIDES if (field := getattr(spiel, side)) is not None}
    stored_raw = await pull_whole_from_db(
        collection=aufstellungen_collection,
        db_filter={"spiel_id": spiel.id, "team_id": {"$in": list(fielded.values())}},
        projection=["team_id", "spieler.starts"],
    )
    stored_by_team: dict[Any, Mapping[str, Any]] = {row["team_id"]: row for row in stored_raw}

    def summary_of(side: FLSpielSide) -> FLAufstellungSummary | None:
        saved = None if side not in fielded else stored_by_team.get(fielded[side])
        if saved is None:
            return None
        entries = saved["spieler"]
        return FLAufstellungSummary(count=len(entries), starters=sum(entry["starts"] for entry in entries))

    def marks_of(side: FLSpielSide) -> FLAufstellungMarks | None:
        if side not in fielded:
            return None
        stored = aufstellung_stands(stored_by_team.get(fielded[side]))
        return aufstellung_marks(date=spiel.date, time=spiel.time, stored=stored, now=now)

    return (
        FLSpielEditorAufstellungen(team1=summary_of("team1"), team2=summary_of("team2")),
        FLSpielEditorAufstellungMarks(team1=marks_of("team1"), team2=marks_of("team2")),
    )


async def read_spiel_editor(
    *,
    spiel_id: CustomObjectId,
    spiele_collection: ReadCollection,
    saisons_collection: ReadCollection,
    spielorte_collection: ReadCollection,
    schiedsrichter_collection: ReadCollection,
    spieler_collection: ReadCollection,
    spielberichte_collection: ReadCollection,
    spielbestaetigungen_collection: ReadCollection,
    saison_teams_collection: ReadCollection,
    aufstellungen_collection: ReadCollection,
    now: datetime,
) -> FLSpieleAdminSingleResponse:
    """Everything the match editor shows, the fixture first: `document_not_found` for an id no fixture holds."""

    spiele_raw = await aggregate_many_from_db(
        collection=spiele_collection, pipeline=build_spiele_pipeline(db_filter={"_id": spiel_id}), limit=1
    )
    if not spiele_raw:
        raise DocumentNotFoundError()
    spiel = FLSpielJoinedAdmin.model_validate(spiele_raw[0])

    booked_spielort = None if spiel.spielort is None else spiel.spielort.spielort_id
    booked_schiedsrichter = None if spiel.schiedsrichter is None else spiel.schiedsrichter.schiedsrichter_id

    # The rest named by the fixture alone, so read beside one another.
    saison_raw, spielorte_raw, schiedsrichter_raw, teams, spielbericht, confirmations, (aufstellungen, marks) = await concurrently(
        # Read as the save's judgement reads it, so the editor opens read-only on exactly the season the write refuses.
        pull_one_from_db(collection=saisons_collection, db_filter={"_id": spiel.saison_id}, projection=["status", "start_date"]),
        pull_many_from_db(
            collection=spielorte_collection,
            db_filter=_offered(booked_spielort),
            limit=LIST_LIMIT_DEFAULT,
            sort_by=[("name", 1)],
            projection=["name", "default_mietpreis", "inactive_since"],
            collation=GERMAN_COLLATION,
        ),
        pull_many_from_db(
            collection=schiedsrichter_collection,
            db_filter=_offered(booked_schiedsrichter),
            limit=LIST_LIMIT_DEFAULT,
            sort_by=[("name", 1)],
            projection=["name", "default_payment", "inactive_since", "einwilligung.confirmed_at"],
            collation=GERMAN_COLLATION,
        ),
        _none()
        if spiel.saison_phase == "gruppenphase"
        else _teams_of(spiel=spiel, spiele_collection=spiele_collection, saison_teams_collection=saison_teams_collection),
        _spielbericht_of(spiel_raw=spiele_raw[0], spieler_collection=spieler_collection, spielberichte_collection=spielberichte_collection),
        # The administrator's read of confirmation rows, so no seat's address reaches the editor.
        pull_admin_rows(
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            db_filter={"saison_id": spiel.saison_id, "spiel_id": spiel_id},
        ),
        _aufstellungen_of(spiel=spiel, aufstellungen_collection=aufstellungen_collection, now=now),
    )
    junctions = await _junctions_of(confirmations, saison_id=spiel.saison_id, saison_teams_collection=saison_teams_collection)
    ansetzung_state = AnsetzungState(spiel=spiele_raw[0], junctions=junctions)
    austritte = austritte_of(ansetzung_state.junctions)
    proposals = await _proposals_of(
        confirmations,
        spiel_id=spiel_id,
        saison_id=spiel.saison_id,
        ansetzung_state=ansetzung_state,
        austritte=austritte,
        spielbestaetigungen_collection=spielbestaetigungen_collection,
        saison_teams_collection=saison_teams_collection,
        now=now,
    )

    def editor_row(row: Mapping[str, Any]) -> FLSpielbestaetigungEditorRow:
        reason = reason_of(spielbestaetigung_raw=row, ansetzung_state=ansetzung_state, now=now)
        return FLSpielbestaetigungEditorRow.model_validate(
            {
                **row,
                "state": state_of(spielbestaetigung_raw=row, ansetzung_state=ansetzung_state, now=now, vorschlag_open=None),
                "due_by": due_by_of(row),
                "lapsed_on": lapsed_on(spielbestaetigung_raw=row, reason=reason, spiel=ansetzung_state.spiel, austritte=austritte, now=now),
                "enterable": find_enter_refusal(spielbestaetigung_raw=row, ansetzung_state=ansetzung_state, now=now) is None,
                "vorschlag_open": proposals.get(row["_id"]),
            }
        )

    return FLSpieleAdminSingleResponse(
        spiel=spiel,
        saison_status=saison_raw["status"],
        saison_begun=has_started(start_date=str(saison_raw["start_date"]), today=clock.german_day(now)),
        spielorte=[FLSpielEditorSpielort.model_validate(row) for row in spielorte_raw],
        schiedsrichter=[
            FLSpielEditorSchiedsrichter.model_validate({**row, "confirmed": is_confirmed(row.get("einwilligung"))})
            for row in schiedsrichter_raw
        ],
        teams=teams,
        spielbericht=spielbericht,
        spielbestaetigungen=[editor_row(row) for row in confirmations],
        aufstellungen=aufstellungen,
        aufstellung_marks=marks,
    )
