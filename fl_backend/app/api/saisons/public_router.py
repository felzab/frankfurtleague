import asyncio
from collections.abc import Mapping
from typing import Any, Final

from fastapi import APIRouter, Depends

from app.api.aufstellungen.services import compose_public_aufstellungen, public_aufstellungen_lookup
from app.api.saisons.crud import CURRENT_SAISON_FILTER, pull_finale_by_saison, pull_landing_windows
from app.api.saisons.schemas import (
    SAISON_FRAME_FIELDS,
    SAISON_FRAME_ORDER,
    FLBewerbungWindow,
    FLLandingBeforeStart,
    FLLandingCounts,
    FLLandingDecided,
    FLLandingOpeningSpiel,
    FLLandingResponse,
    FLLandingRunning,
    FLLandingSide,
    FLSaison,
    FLSaisonFrameEntryListAdapter,
    FLSaisonFrameResponse,
    FLSaisonsSingleResponse,
    FLSpielPageResponse,
    FLSpielSideStanding,
    FLSpielSideStandings,
    FLTeamPageResponse,
    FLTeamPageSpielListAdapter,
    saison_start,
)
from app.api.saisons.services import (
    SPIELTAG_POSITION_LOOKUP,
    SPIELTAG_ROWS_AS,
    base_tier_status_term,
    decided_podium,
    has_started,
    matchday_of,
    with_schedule,
)
from app.api.saisons.visibility import PublicSaison, resolve_public_saison
from app.api.spielberichte.services import SIDES, build_public_bericht_pipeline, compose_public_bericht, team_id_of
from app.api.spiele.schemas import FLSpielJoined, FLSpielJoinedListAdapter, FLSpielTeamFieldJoinedInternal, unplayed_filter
from app.api.spiele.services import build_named_spiele_pipeline, build_spiele_pipeline
from app.api.spieler.schemas import FLSpielerListAdapter
from app.api.spieler.services import build_spieler_pipeline
from app.api.spieltage.schemas import FLKoRundeResponse, FLSpielplanResponse, FLSpielplanSpieltag
from app.api.spieltage.services import build_spielplan, current_spieltag_id
from app.api.teams.crud import pull_tabelle
from app.api.teams.schemas import (
    FLSaisonTeamEntry,
    FLSaisonTeamEntryListAdapter,
    FLSaisonTeamsResponse,
    FLTabelleResponse,
    FLTeamPageClub,
)
from app.api.teams.services import build_team_pipeline, counting_spiele_match
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import GERMAN_COLLATION, aggregate_many_from_db, pull_many_from_db, pull_one_from_db
from app.core.dependencies import (
    SaisonSpielerReadCollection,
    SaisonsReadCollection,
    SaisonTeamsReadCollection,
    SpielberichteReadCollection,
    SpieleReadCollection,
    SpieltageReadCollection,
    TeamsReadCollection,
    get_german_date_str,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.readonly import ReadCollection
from app.core.routing import by_id
from app.core.security import verify_access_base
from app.shared.schemas.bounds import LIST_LIMIT_MAX
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/saisons",
    dependencies=[Depends(verify_access_base)],
)


@router.get("/frame", response_model=FLSaisonFrameResponse, summary="The season pages' frame")
async def get_frame(saisons_collection: SaisonsReadCollection) -> FLSaisonFrameResponse:
    """Every season the public may read, the newest first, and the one the site is on; that one is null for a league that has none."""

    saisons_raw = await pull_many_from_db(
        collection=saisons_collection,
        db_filter=base_tier_status_term(),
        sort_by=list(SAISON_FRAME_ORDER.items()),
        projection=["_id", *SAISON_FRAME_FIELDS, "status"],
        limit=LIST_LIMIT_MAX,
    )

    # The stored status alone: `uniq_saison_active` holds at most one, and activating the next
    # season is the one write that moves it, so a finished season stays the site's until then.
    active_saison_id = next((str(raw["_id"]) for raw in saisons_raw if raw["status"] == "active"), None)

    return FLSaisonFrameResponse(saisons=FLSaisonFrameEntryListAdapter.validate_python(saisons_raw), active_saison_id=active_saison_id)


# How many of the latest results, and of the next matches, the landing shows while the season runs: its card holds one
# of each.
LANDING_SPIELE: Final = 1


def _opening_spiel_pipeline(saison_id: str) -> list[Mapping[str, Any]]:
    """The season's earliest dated group match, a timed one ahead of an untimed one on the same day, with its matchday's `position`."""

    return [
        {"$match": {"saison_id": saison_id, "saison_phase": "gruppenphase", "date": {"$type": "string"}}},
        # A null sorts ahead of every time, so an untimed fixture would otherwise hide the opening day's Anpfiff.
        {"$set": {"untimed": {"$ne": [{"$type": "$time"}, "string"]}}},
        {"$sort": {"date": 1, "untimed": 1, "time": 1}},
        # Ahead of the lookups, so they join the one match served rather than every dated one.
        {"$limit": 1},
        SPIELTAG_POSITION_LOOKUP,
        # The stored fixture names no side: each is named as every fixture read names it, its one match already chosen.
        *build_named_spiele_pipeline(
            {},
            projection={
                "_id": 0,
                "date": 1,
                "time": 1,
                "spieltag_position": {"$first": f"${SPIELTAG_ROWS_AS}.position"},
                "team1": 1,
                "team2": 1,
            },
        ),
    ]


async def _no_rows() -> list[Mapping[str, Any]]:
    """What a read the landing's state cannot serve answers, without the round trip."""

    return []


async def _active_or_none(saisons_collection: ReadCollection) -> Mapping[str, Any] | None:
    """The season the site is on, its id and `start_date`; the `active` one, which no tier withholds."""

    try:
        return await pull_one_from_db(collection=saisons_collection, db_filter=CURRENT_SAISON_FILTER, projection=["_id", "start_date"])
    except DocumentNotFoundError:
        return None


# Keeps a season's row in a count only where the public reads its season, joined on the row's `saison_id`: a planned
# season's clubs and fixtures count once it starts being read, by the rule every base-tier season read narrows on.
_IN_A_PUBLIC_SAISON: tuple[Mapping[str, Any], ...] = (
    {
        "$lookup": {
            "from": Collection.SAISONS,
            "localField": "saison_id",
            "foreignField": "_id",
            "pipeline": [{"$match": base_tier_status_term()}, {"$project": {"_id": 0, "status": 1}}],
            "as": "public_saison",
        }
    },
    {"$match": {"public_saison": {"$ne": []}}},
)

# A club a season's Teams page lists, as `app/api/teams/services.py :: build_retirement_stages` keeps it: one that has
# not left the league, or one that left it after a season now `past`, which keeps its place there.
_LISTED_CLUB: tuple[Mapping[str, Any], ...] = (
    {
        "$lookup": {
            "from": Collection.TEAMS,
            "localField": "team_id",
            "foreignField": "_id",
            "pipeline": [{"$project": {"_id": 0, "inactive_since": 1}}],
            "as": "club",
        }
    },
    # `$elemMatch` rather than a `club.0.inactive_since` path, which a missing field "0" in the joined element matches as null.
    {"$match": {"$or": [{"club": {"$elemMatch": {"inactive_since": None}}}, {"public_saison": {"$elemMatch": {"status": "past"}}}]}},
)


async def _league_counts(
    *, saisons_collection: ReadCollection, spiele_collection: ReadCollection, saison_teams_collection: ReadCollection
) -> FLLandingCounts:
    """The league's figures over every season the public reads, three reads sent at once."""

    count_saisons, counted_raw, schulen_raw = await asyncio.gather(
        saisons_collection.count_documents(base_tier_status_term()),
        # The matches the Tabelle counts, every phase's: one group, so the goals and the matches stand on one basis.
        aggregate_many_from_db(
            collection=spiele_collection,
            pipeline=[
                {"$match": counting_spiele_match()},
                *_IN_A_PUBLIC_SAISON,
                {"$group": {"_id": None, "tore": {"$sum": {"$add": ["$team1.tore", "$team2.tore"]}}, "spiele": {"$sum": 1}}},
            ],
        ),
        # The clubs the seasons' Teams pages list, a club playing several seasons one school.
        aggregate_many_from_db(
            collection=saison_teams_collection,
            pipeline=[*_IN_A_PUBLIC_SAISON, *_LISTED_CLUB, {"$group": {"_id": "$team_id"}}, {"$count": "schulen"}],
        ),
    )

    return FLLandingCounts(
        count_saisons=count_saisons,
        count_schulen=schulen_raw[0]["schulen"] if schulen_raw else 0,
        # No group row where no match counts yet.
        count_spiele=counted_raw[0]["spiele"] if counted_raw else 0,
        count_tore=counted_raw[0]["tore"] if counted_raw else 0,
    )


async def _landing_saison(
    *,
    saisons_collection: ReadCollection,
    spiele_collection: ReadCollection,
    teams_collection: ReadCollection,
    today: str,
) -> FLLandingBeforeStart | FLLandingRunning | FLLandingDecided | None:
    """The season the site is on in its state, null for a league that has none."""

    saison_raw = await _active_or_none(saisons_collection)

    if saison_raw is None:
        return None

    saison_id = str(saison_raw["_id"])
    in_saison = {"saison_id": saison_id}
    # The start every start lock reads, so the countdown reaching zero and the season reading as running are one instant.
    # Known before any match is read, so only the reads its state can serve are sent: the opening match before it, the
    # two lists after. The Finale is read either way, a played one deciding the season over both.
    started = has_started(start_date=saison_raw["start_date"], today=today)
    first_raw, recent_raw, upcoming_raw, finale_by_saison, teams = await asyncio.gather(
        _no_rows() if started else aggregate_many_from_db(collection=spiele_collection, pipeline=_opening_spiel_pipeline(saison_id), limit=1),
        aggregate_many_from_db(
            collection=spiele_collection,
            pipeline=build_spiele_pipeline(
                db_filter={**in_saison, "ergebnis": {"$ne": None}},
                sort_by=[("date", -1), ("time", -1), ("spiel_nr", -1)],
                limit=LANDING_SPIELE,
            ),
        )
        if started
        else _no_rows(),
        aggregate_many_from_db(
            collection=spiele_collection,
            pipeline=build_spiele_pipeline(
                db_filter={**in_saison, "date": {"$gte": today}, **unplayed_filter()},
                sort_by=[("date", 1), ("time", 1), ("spiel_nr", 1)],
                limit=LANDING_SPIELE,
            ),
        )
        if started
        else _no_rows(),
        pull_finale_by_saison(spiele_collection=spiele_collection, saison_ids=[saison_id]),
        _clubs_of(teams_collection=teams_collection, saison_id=saison_id),
    )

    start = saison_start(saison_raw["start_date"])

    # Decided by the rule the admin list and the editor read too, so the three say the same word of one season.
    podium = decided_podium(finale_by_saison.get(saison_id, []))

    def landing_side(side: FLSpielTeamFieldJoinedInternal | None) -> FLLandingSide | None:
        return None if side is None else FLLandingSide(name=side.name, shorthand=side.shorthand)

    match podium:
        case (first_place, second_place, third_place, fourth_place):
            return FLLandingDecided(
                id=saison_id,
                state="decided",
                starts_at=start,
                podium=(landing_side(first_place), landing_side(second_place), landing_side(third_place), landing_side(fourth_place)),
                teams=teams,
            )
        case _ if started:
            return FLLandingRunning(
                id=saison_id,
                state="running",
                starts_at=start,
                recent=FLSpielJoinedListAdapter.validate_python(recent_raw),
                upcoming=FLSpielJoinedListAdapter.validate_python(upcoming_raw),
                teams=teams,
            )
        case _:
            return FLLandingBeforeStart(
                id=saison_id,
                state="before_start",
                starts_at=start,
                opening_spiel=FLLandingOpeningSpiel.model_validate(first_raw[0]) if first_raw else None,
                teams=teams,
            )


@router.get("/landing", response_model=FLLandingResponse, summary="The landing")
async def get_landing(
    saisons_collection: SaisonsReadCollection,
    spiele_collection: SpieleReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    teams_collection: TeamsReadCollection,
    today: str = Depends(get_german_date_str),
) -> FLLandingResponse:
    """The season the site is on, `before_start`, `running` or `decided`, null for a league that has none.

    Beside it, the application window open today by the rule the submission refuses on, the day the next one opens by
    the judgement the form's page serves, whether a season not yet ended holds a window at all, and the league's figures
    over every season the public reads, counted on every read. The windows and the figures are read beside the season's
    two steps rather than after them, so they add no step to the read.
    """

    saison, windows, counts = await asyncio.gather(
        _landing_saison(
            saisons_collection=saisons_collection, spiele_collection=spiele_collection, teams_collection=teams_collection, today=today
        ),
        pull_landing_windows(saisons_collection=saisons_collection, today=today),
        _league_counts(
            saisons_collection=saisons_collection, spiele_collection=spiele_collection, saison_teams_collection=saison_teams_collection
        ),
    )

    return FLLandingResponse(
        saison=saison,
        bewerbung_window=None
        if windows.open is None
        else FLBewerbungWindow(saison_id=str(windows.open["_id"]), end=windows.open["bewerbung"]["end"]),
        bewerbung_opens_on=windows.opens_on,
        bewerbung_window_held=windows.held,
        counts=counts,
    )


# Declared after `/frame` and `/landing`, which it would otherwise answer as season ids: routes match in
# declaration order, and the `objectid` convertor cannot help here, a season id being a four-character string.
@router.get("/{saison_id}", response_model=FLSaisonsSingleResponse, summary="One Saison")
async def get_saison(saison_id: str, saisons_collection: SaisonsReadCollection) -> FLSaisonsSingleResponse:
    """One season the public may read, by its id.

    404 where no season carries it or it is a `future` one.
    """

    # The status term withholds a `future` season in the filter itself, so its miss is the miss of an id no season
    # carries and nothing here needs to know it was withheld.
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id, **base_tier_status_term()})

    return FLSaisonsSingleResponse(saison=FLSaison.model_validate(with_schedule(saison_raw)))


# The knockout phases, which the K.-o.-Runde shows of the same matchdays and matches the Spielplan does.
_KNOCKOUT_TERM: Mapping[str, Any] = {"saison_phase": {"$ne": "gruppenphase"}}


async def _spielplan_of(
    *,
    saison_id: str,
    saisons_collection: ReadCollection,
    spieltage_collection: ReadCollection,
    spiele_collection: ReadCollection,
    phase_term: Mapping[str, Any],
) -> tuple[PublicSaison, list[FLSpielplanSpieltag]]:
    """The season and its matchdays holding their matches, in one round trip.

    The two contents are read beside the resolve rather than after it: the id is the path's, so neither waits on it,
    and nothing they hold is served before the resolve has passed.
    """

    db_filter = {"saison_id": saison_id, **phase_term}
    saison, spieltage_raw, spiele_raw = await asyncio.gather(
        resolve_public_saison(saisons_collection=saisons_collection, saison_id=saison_id),
        pull_many_from_db(collection=spieltage_collection, db_filter=db_filter),
        aggregate_many_from_db(collection=spiele_collection, pipeline=build_spiele_pipeline(db_filter=db_filter)),
    )

    return saison, build_spielplan(spieltage_raw, spiele_raw, saison.rules)


@router.get("/{saison_id}/spielplan", response_model=FLSpielplanResponse, summary="One Saison's Spielplan")
async def get_spielplan(
    saison_id: str,
    saisons_collection: SaisonsReadCollection,
    spieltage_collection: SpieltageReadCollection,
    spiele_collection: SpieleReadCollection,
) -> FLSpielplanResponse:
    """Every matchday of one season with its matches, in playing order, and the matchday to open on.

    The Spielplan and the Spielsuche both show this. 404 for a season this tier may not read.
    """

    saison, spieltage = await _spielplan_of(
        saison_id=saison_id,
        saisons_collection=saisons_collection,
        spieltage_collection=spieltage_collection,
        spiele_collection=spiele_collection,
        phase_term={},
    )

    return FLSpielplanResponse(spieltage=spieltage, current_spieltag_id=current_spieltag_id(spieltage, saison_status=saison.status))


@router.get("/{saison_id}/ko_runde", response_model=FLKoRundeResponse, summary="One Saison's K.-o.-Runde")
async def get_ko_runde(
    saison_id: str,
    saisons_collection: SaisonsReadCollection,
    spieltage_collection: SpieltageReadCollection,
    spiele_collection: SpieleReadCollection,
) -> FLKoRundeResponse:
    """Every knockout matchday of one season with its matches in playing order, a side not yet known null beside its `quelle`.

    Empty before the draw; 404 for a season this tier may not read.
    """

    _, spieltage = await _spielplan_of(
        saison_id=saison_id,
        saisons_collection=saisons_collection,
        spieltage_collection=spieltage_collection,
        spiele_collection=spiele_collection,
        phase_term=_KNOCKOUT_TERM,
    )

    return FLKoRundeResponse(spieltage=spieltage)


@router.get("/{saison_id}/tabelle", response_model=FLTabelleResponse, summary="One Saison's Tabelle")
async def get_tabelle(
    saison_id: str,
    saisons_collection: SaisonsReadCollection,
    teams_collection: TeamsReadCollection,
    spiele_collection: SpieleReadCollection,
) -> FLTabelleResponse:
    """Each group's standing over the group phase with its goals counted on every read, and how many of each group advance.

    A club that left the season keeps its row; it holds no `platz` where it left before its group was decided, and
    neither does a club that has played no match, listed after every club that has; 404 for a season this tier may not
    read.
    """

    saison = await resolve_public_saison(saisons_collection=saisons_collection, saison_id=saison_id)
    tabelle = await pull_tabelle(
        teams_collection=teams_collection, spiele_collection=spiele_collection, saison_id=saison.id, rules=saison.rules
    )

    return FLTabelleResponse(gruppen=tabelle, qualifiers_per_gruppe=saison.rules.qualifiers_per_gruppe)


async def _clubs_of(*, teams_collection: ReadCollection, saison_id: str) -> list[FLSaisonTeamEntry]:
    """A season's clubs as the Teams page and the landing list them, a club that left the league in a `past` season alone."""

    teams_raw = await aggregate_many_from_db(
        collection=teams_collection,
        pipeline=build_team_pipeline(saison_id=saison_id, rules=None),
        collation=GERMAN_COLLATION,
    )

    return FLSaisonTeamEntryListAdapter.validate_python(
        [{**raw, "austritt_type": (raw.get("austritt") or {}).get("type")} for raw in teams_raw]
    )


@router.get("/{saison_id}/teams", response_model=FLSaisonTeamsResponse, summary="One Saison's teams")
async def get_teams(saison_id: str, saisons_collection: SaisonsReadCollection, teams_collection: TeamsReadCollection) -> FLSaisonTeamsResponse:
    """The clubs of one season by name, each under the name and shorthand it plays that season under.

    404 for a season this tier may not read.
    """

    _, teams = await asyncio.gather(
        resolve_public_saison(saisons_collection=saisons_collection, saison_id=saison_id),
        _clubs_of(teams_collection=teams_collection, saison_id=saison_id),
    )

    return FLSaisonTeamsResponse(teams=teams)


@router.get(f"/{{saison_id}}/teams{by_id('team_id')}", response_model=FLTeamPageResponse, summary="One team's page in one Saison")
async def get_team(
    saison_id: str,
    team_id: CustomRouteObjectId,
    saisons_collection: SaisonsReadCollection,
    teams_collection: TeamsReadCollection,
    spiele_collection: SpieleReadCollection,
    saison_spieler_collection: SaisonSpielerReadCollection,
) -> FLTeamPageResponse:
    """One club in one season: the club, its row of the Tabelle, its matches and its squad.

    404 for a season this tier may not read and for a club the season does not hold.
    """

    # Beside the resolve, for `_spielplan_of`'s reason: each needs the path's id alone, and none is served before the
    # resolve has passed.
    saison, club_raw, spiele_raw, kader_raw = await asyncio.gather(
        resolve_public_saison(saisons_collection=saisons_collection, saison_id=saison_id),
        # A club that left the league stays addressable by id, as `GET /teams/{team_id}` keeps it: a caller holding one
        # was given it by something.
        aggregate_many_from_db(
            collection=teams_collection, pipeline=build_team_pipeline(saison_id=saison_id, rules=None, team_id=team_id, include_inactive=True)
        ),
        aggregate_many_from_db(
            collection=spiele_collection,
            pipeline=[
                *build_spiele_pipeline(
                    db_filter={"saison_id": saison_id, "$or": [{"team1.team_id": team_id}, {"team2.team_id": team_id}]},
                    sort_by=[("spiel_nr", 1)],
                ),
                SPIELTAG_POSITION_LOOKUP,
            ],
        ),
        aggregate_many_from_db(
            collection=saison_spieler_collection,
            pipeline=build_spieler_pipeline(team_id=team_id, saison_id=saison_id),
            collation=GERMAN_COLLATION,
        ),
    )

    if not club_raw:
        raise DocumentNotFoundError()

    # After the resolve, being the one read that needs the season's rules.
    tabelle = await pull_tabelle(
        teams_collection=teams_collection, spiele_collection=spiele_collection, saison_id=saison.id, rules=saison.rules
    )

    standing = next((row for rows in tabelle.root.values() for row in rows if row.id == team_id), None)

    return FLTeamPageResponse(
        team=FLTeamPageClub.model_validate(club_raw[0]),
        standing=standing,
        spiele=FLTeamPageSpielListAdapter.validate_python([{**spiel_raw, **matchday_of(spiel_raw)} for spiel_raw in spiele_raw]),
        kader=FLSpielerListAdapter.validate_python(kader_raw),
    )


@router.get(f"/{{saison_id}}/spiele{by_id('spiel_id')}", response_model=FLSpielPageResponse, summary="One Spiel's page")
async def get_spiel(
    saison_id: str,
    spiel_id: CustomRouteObjectId,
    saisons_collection: SaisonsReadCollection,
    spiele_collection: SpieleReadCollection,
    teams_collection: TeamsReadCollection,
    spielberichte_collection: SpielberichteReadCollection,
) -> FLSpielPageResponse:
    """One match as its page and its pop-up show it, each side of a group match with its group and `platz`; 404 outside a readable season.

    Each side's line-up from the moment its club stores one, the scorers and cards only while the report is adopted
    and unchanged since, every pupil through the public mask.
    """

    saison, spiele_raw, berichte_raw = await asyncio.gather(
        resolve_public_saison(saisons_collection=saisons_collection, saison_id=saison_id),
        aggregate_many_from_db(
            collection=spiele_collection,
            pipeline=[
                *build_spiele_pipeline(db_filter={"_id": spiel_id, "saison_id": saison_id}),
                SPIELTAG_POSITION_LOOKUP,
                public_aufstellungen_lookup(),
            ],
            limit=1,
        ),
        aggregate_many_from_db(collection=spielberichte_collection, pipeline=build_public_bericht_pipeline(spiel_id), limit=1),
    )
    if not spiele_raw:
        raise DocumentNotFoundError()

    spiel_raw = spiele_raw[0]
    standings = FLSpielSideStandings(team1=None, team2=None)

    if spiel_raw["saison_phase"] == "gruppenphase":
        tabelle = await pull_tabelle(
            teams_collection=teams_collection, spiele_collection=spiele_collection, saison_id=saison.id, rules=saison.rules
        )
        placed: dict[Any, FLSpielSideStanding] = {
            row.id: FLSpielSideStanding(gruppe=gruppe, platz=row.platz) for gruppe, rows in tabelle.root.items() for row in rows
        }
        standings = FLSpielSideStandings(**{side: placed.get(team_id_of(spiel_raw, side)) for side in SIDES})

    matchday = matchday_of(spiel_raw)

    return FLSpielPageResponse(
        spiel=FLSpielJoined.model_validate(spiel_raw),
        spieltag_position=matchday["spieltag_position"],
        count_spieltage_in_phase=matchday["count_spieltage_in_phase"],
        standings=standings,
        aufstellungen=compose_public_aufstellungen(spiel_raw),
        bericht=compose_public_bericht(berichte_raw[0], spiel_raw) if berichte_raw else None,
    )
