"""The match editor's one view read: the fixture, and everything its sections offer beside it or show of it.

Its own module because it composes three slices' reads, the reports' and the confirmations' beside the fixtures',
and each of those slices imports this one's schemas.
"""

import asyncio
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from pydantic import Field

from app.api.aufstellungen.schemas import FLAufstellungMarks, FLAufstellungSummary
from app.api.aufstellungen.services import aufstellung_marks, aufstellung_stands
from app.api.saisons.services import has_started
from app.api.schiedsrichter.services import DECLINED_AT_PATH, is_declined
from app.api.spielberichte.crud import pull_bericht_context, pull_named
from app.api.spielberichte.schemas import (
    FLSpielberichtBericht,
    FLSpielberichtScorer,
    FLSpielberichtSides,
    FLSpielberichtSpieler,
    FLSpielberichtState,
    FLSpielberichtVorschlag,
)
from app.api.spielberichte.services import SIDES, bericht_state_of
from app.api.spielbestaetigungen.crud import JUDGED_VEREIN_FIELDS, pull_admin_rows
from app.api.spielbestaetigungen.schemas import FLSpielbestaetigung, FLSpielbestaetigungState
from app.api.spielbestaetigungen.services import AnsetzungState, austritte_of, due_by_of, lapsed_on, reason_of, state_of
from app.api.spiele.crud import pull_saison_membership
from app.api.spiele.schemas import FLPatchSpielDataPayload, FLSpiel, FLSpielJoinedAdmin, FLSpielListAdapter, FLSpielTeamFieldPayload
from app.api.spiele.services import (
    SaisonMembership,
    build_spiele_pipeline,
    find_eligibility_refusal,
    judge_spieltag_occupancy,
    stored_in_slice,
)
from app.core import clock
from app.core.crud import GERMAN_COLLATION, VERSION_FIELD, aggregate_many_from_db, pull_many_from_db, pull_one_from_db, pull_whole_from_db
from app.core.exceptions import DocumentNotFoundError
from app.core.readonly import ReadCollection
from app.shared.einwilligung import is_confirmed
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.custom import CustomDateString, CustomNonEmptyString, CustomObjectId, CustomOptionalDateString
from app.shared.schemas.literals import FLSaisonStatus, FLSpielSide
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel


class FLSpielEditorSpielort(BaseReadModel):
    """A venue the editor offers: its name, the rent it defaults to, and the day it retired, null while it serves."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    name: CustomNonEmptyString
    default_mietpreis: int = Field(ge=0)
    inactive_since: CustomOptionalDateString


class FLSpielEditorSchiedsrichter(BaseReadModel):
    """A referee the editor offers: their whole name, the fee they default to, how they answered their entry, and the day they retired."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    name: CustomNonEmptyString
    default_payment: int = Field(ge=0)
    # Offered unconfirmed too, so the editor marks the one a save refuses (`booking_unconfirmed_schiedsrichter`), and
    # whether that is an objection, after which nobody asks the person again, or no answer yet.
    confirmed: bool
    declined: bool
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


class FLSpielEditorBericht(BaseReadModel):
    """The fixture's report as the editor's Spielbericht section shows it: its goals and the result they propose.

    `version` is the report document's, the one an adoption names (`adopts_bericht`), `sides` the clubs the report is
    about, and `named` each pupil a goal names, by the names their record holds.
    """

    state: FLSpielberichtState
    version: int
    ergebnis_vorschlag: FLSpielberichtVorschlag
    sides: FLSpielberichtSides
    scorers: list[FLSpielberichtScorer]
    named: list[FLSpielberichtSpieler]


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


class FLSpielbestaetigungEditorRow(FLSpielbestaetigung):
    """A confirmation row as the match editor reads it, and the state it stands in, a closed row's included.

    Never `vorschlag`, which only a club's own page tells: an open row reads `valid` while its party may still answer.
    """

    state: FLSpielbestaetigungState
    # The day the party's answer is due by: a club's `deadline`, and a referee's slot, whom no deadline binds.
    due_by: CustomDateString
    # The day its answer lapsed, `due_by`; null on an answered row, on one a call-off or a move ended, and on one an exit
    # or a decision ended before its answer was due (`lapsed_on`).
    lapsed_on: CustomDateString | None


class FLSpieleAdminSingleResponse(BaseAPIResponse):
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


async def _vereine_of(rows: Sequence[Mapping[str, Any]], *, saison_id: str, saison_teams_collection: ReadCollection) -> list[Mapping[str, Any]]:
    """The season rows of every club the confirmation rows' Ansetzungen name, as `state_of` judges a row against them."""

    clubs = {club for row in rows for club in (row["ansetzung"]["team1_id"], row["ansetzung"]["team2_id"])}
    if not clubs:
        return []

    return await pull_many_from_db(
        collection=saison_teams_collection,
        db_filter={"saison_id": saison_id, "team_id": {"$in": list(clubs)}},
        projection=JUDGED_VEREIN_FIELDS,
    )


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

    # Whole, as the save reads its season.
    season_raw, membership, ordered = await asyncio.gather(
        pull_whole_from_db(collection=spiele_collection, db_filter={"saison_id": spiel.saison_id}, what=f"season {spiel.saison_id}'s fixtures"),
        pull_saison_membership(saison_teams_collection=saison_teams_collection, saison_id=spiel.saison_id),
        pull_many_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": spiel.saison_id},
            limit=LIST_LIMIT_DEFAULT,
            sort_by=[("name", 1)],
            projection=["team_id", "shorthand"],
            collation=GERMAN_COLLATION,
        ),
    )
    season = FLSpielListAdapter.validate_python(season_raw)
    stored = stored_in_slice(spiel.id, season)

    def judged(row: Mapping[str, Any], member: SaisonMembership) -> FLSpielEditorTeam:
        team_id = row["team_id"]
        payload = _fielding(stored, team_id)
        verdict = judge_spieltag_occupancy(spiel.id, payload, season, membership)
        return FLSpielEditorTeam(
            id=team_id,
            name=member.name,
            shorthand=row["shorthand"],
            on_spieltag=verdict.refusal is not None or len(verdict.releases) > 0,
            fieldable=verdict.refusal is None and find_eligibility_refusal(spiel.id, payload, season, membership) is None,
        )

    return [judged(row, membership[row["team_id"]]) for row in ordered if row["team_id"] in membership]


async def _spielbericht_of(
    *,
    spiel_id: CustomObjectId,
    spiele_collection: ReadCollection,
    saisons_collection: ReadCollection,
    saison_spieler_collection: ReadCollection,
    spieler_collection: ReadCollection,
    spielberichte_collection: ReadCollection,
) -> FLSpielEditorBericht | None:
    """The report as the administrator's panel composes it, its goals alone: the cards and the remarks are not the editor's."""

    document = await spielberichte_collection.find_one({"spiel_id": spiel_id}, {"bericht": 1, VERSION_FIELD: 1})
    if document is None:
        return None

    block = document["bericht"]
    bericht = FLSpielberichtBericht.model_validate(block)
    context = await pull_bericht_context(
        spiele_collection=spiele_collection,
        saisons_collection=saisons_collection,
        saison_spieler_collection=saison_spieler_collection,
        spiel_id=spiel_id,
        session=None,
    )
    scorers = {tor.spieler_id for tor in bericht.scorers if tor.spieler_id is not None}
    named = await pull_named(spieler_collection=spieler_collection, context=context, kader_open=False, bericht=block, session=None)

    return FLSpielEditorBericht(
        state=bericht_state_of(bericht, context.spiel),
        version=document[VERSION_FIELD],
        ergebnis_vorschlag=bericht.ergebnis_vorschlag,
        sides=bericht.sides,
        scorers=bericht.scorers,
        named=[spieler for spieler in named if spieler.spieler_id in scorers],
    )


async def _aufstellungen_of(
    *, spiel: FLSpielJoinedAdmin, aufstellungen_collection: ReadCollection, now: datetime
) -> tuple[FLSpielEditorAufstellungen, FLSpielEditorAufstellungMarks]:
    """Each side's stored line-up, counted, and its marks at `now`: picked by the club the fixture fields there now, never by a side.

    A club a knockout correction replaced keeps its line-up, which no side then names.
    """

    fielded = {side: field.team_id for side in SIDES if (field := getattr(spiel, side)) is not None}
    stored_raw = await pull_many_from_db(
        collection=aufstellungen_collection,
        db_filter={"spiel_id": spiel.id, "team_id": {"$in": list(fielded.values())}},
        projection=["team_id", "spieler.starts"],
    )
    stored_by_club: dict[Any, Mapping[str, Any]] = {row["team_id"]: row for row in stored_raw}

    def summary_of(side: FLSpielSide) -> FLAufstellungSummary | None:
        saved = None if side not in fielded else stored_by_club.get(fielded[side])
        if saved is None:
            return None
        entries = saved["spieler"]
        return FLAufstellungSummary(count=len(entries), starters=sum(entry["starts"] for entry in entries))

    def marks_of(side: FLSpielSide) -> FLAufstellungMarks | None:
        if side not in fielded:
            return None
        stored = aufstellung_stands(stored_by_club.get(fielded[side]))
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
    saison_spieler_collection: ReadCollection,
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

    # The rest named by the fixture alone, so read beside one another, in two groups because `asyncio.gather`'s typing
    # stops at six.
    (saison_raw, spielorte_raw, schiedsrichter_raw, teams, spielbericht, confirmations), (aufstellungen, marks) = await asyncio.gather(
        asyncio.gather(
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
                projection=["name", "default_payment", "inactive_since", "einwilligung.confirmed_at", DECLINED_AT_PATH],
                collation=GERMAN_COLLATION,
            ),
            _none()
            if spiel.saison_phase == "gruppenphase"
            else _teams_of(spiel=spiel, spiele_collection=spiele_collection, saison_teams_collection=saison_teams_collection),
            _spielbericht_of(
                spiel_id=spiel_id,
                spiele_collection=spiele_collection,
                saisons_collection=saisons_collection,
                saison_spieler_collection=saison_spieler_collection,
                spieler_collection=spieler_collection,
                spielberichte_collection=spielberichte_collection,
            ),
            # The administrator's read of confirmation rows, so no seat's address reaches the editor.
            pull_admin_rows(
                spielbestaetigungen_collection=spielbestaetigungen_collection,
                db_filter={"saison_id": spiel.saison_id, "spiel_id": spiel_id},
            ),
        ),
        _aufstellungen_of(spiel=spiel, aufstellungen_collection=aufstellungen_collection, now=now),
    )
    vereine = await _vereine_of(confirmations, saison_id=spiel.saison_id, saison_teams_collection=saison_teams_collection)
    ansetzung_state = AnsetzungState(spiel=spiele_raw[0], vereine=vereine)
    austritte = austritte_of(ansetzung_state)

    def editor_row(row: Mapping[str, Any]) -> FLSpielbestaetigungEditorRow:
        reason = reason_of(spielbestaetigung_raw=row, ansetzung_state=ansetzung_state, now=now)
        return FLSpielbestaetigungEditorRow.model_validate(
            {
                **row,
                "state": state_of(spielbestaetigung_raw=row, ansetzung_state=ansetzung_state, now=now, vorschlag_open=None),
                "due_by": due_by_of(row),
                "lapsed_on": lapsed_on(spielbestaetigung_raw=row, reason=reason, spiel=ansetzung_state.spiel, austritte=austritte, now=now),
            }
        )

    return FLSpieleAdminSingleResponse(
        spiel=spiel,
        saison_status=saison_raw["status"],
        saison_begun=has_started(start_date=str(saison_raw["start_date"]), today=clock.german_day(now)),
        spielorte=[FLSpielEditorSpielort.model_validate(row) for row in spielorte_raw],
        schiedsrichter=[
            FLSpielEditorSchiedsrichter.model_validate(
                {**row, "confirmed": is_confirmed(row.get("einwilligung")), "declined": is_declined(row.get("confirmation"))}
            )
            for row in schiedsrichter_raw
        ],
        teams=teams,
        spielbericht=spielbericht,
        spielbestaetigungen=[editor_row(row) for row in confirmations],
        aufstellungen=aufstellungen,
        aufstellung_marks=marks,
    )
