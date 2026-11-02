import asyncio
from collections.abc import Mapping
from typing import Any, Final

from fastapi import APIRouter, Depends
from pymongo.asynchronous.collection import AsyncCollection

from app.api.bewerbungen.services import saison_nimmt_bewerbungen_an
from app.api.saisons.crud import has_started, pull_active_saison, pull_open_window_saison
from app.api.saisons.schemas import (
    FLBewerbungWindow,
    FLLandingCounts,
    FLLandingKickoff,
    FLLandingResponse,
    FLLandingSaison,
    FLLandingState,
    FLPodiumPlace,
    FLSaison,
    FLSaisonFrameEntryListAdapter,
    FLSaisonFrameResponse,
    FLSaisonListAdapter,
    FLSaisonsFilterParams,
    FLSaisonsListResponse,
    FLSaisonsSingleResponse,
    FLSpielPageResponse,
    FLSpielSideStanding,
    FLSpielSideStandings,
    FLTeamPageResponse,
    FLTeamPageSpielListAdapter,
)
from app.api.saisons.services import base_tier_status_term, with_schedule
from app.api.saisons.visibility import PublicSaison, resolve_public_saison
from app.api.spielberichte.services import SEITEN, build_public_bericht_pipeline, compose_public_bericht, team_id_of
from app.api.spiele.schemas import FLSpielJoined, FLSpielJoinedListAdapter, unplayed_filter
from app.api.spiele.services import build_spiele_pipeline, podium_of
from app.api.spieler.schemas import FLSpielerFilterParams, FLSpielerListAdapter
from app.api.spieler.services import build_spieler_pipeline
from app.api.spieltage.schemas import FLKoRundeResponse, FLSpielplanResponse, FLSpielplanSpieltag
from app.api.spieltage.services import build_spielplan, current_spieltag_id
from app.api.teams.crud import pull_tabelle
from app.api.teams.schemas import (
    FLPublicTeamsFilterParams,
    FLSaisonTeamEntry,
    FLSaisonTeamEntryListAdapter,
    FLSaisonTeamsResponse,
    FLTabelleResponse,
    FLTeamPageClub,
    FLTeamsFilterParams,
)
from app.api.teams.services import build_team_pipeline, counting_fixtures_match
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import GERMAN_COLLATION, aggregate_many_from_db, build_query, build_sort, pull_many_from_db, pull_one_from_db
from app.core.dependencies import (
    SaisonsCollection,
    SaisonSpielerCollection,
    SpielberichteCollection,
    SpieleCollection,
    SpieltageCollection,
    TeamsCollection,
    get_german_date_str,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.routing import by_id
from app.core.security import verify_access_base
from app.shared.schemas.bounds import LIST_LIMIT_MAX
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/saisons",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLSaisonsListResponse, summary="List Saisons")
async def get_saisons(saisons_collection: SaisonsCollection, filters: FLSaisonsFilterParams = Depends()) -> FLSaisonsListResponse:
    """Every season the public may read, a `future` one never among them, narrowed by `status` to `past` or `active`.

    Without `status` it lists them all, never the season the site is on alone.
    """

    # `compiled` last, so the narrowing replaces the raw `status` the dump wrote for the caller.
    db_filter = build_query(filters, terms={"status"}, compiled=base_tier_status_term(filters.status))
    db_sort = build_sort(sort_by=filters.sort_by, order=filters.order)

    saisons_raw = await pull_many_from_db(
        collection=saisons_collection,
        db_filter=db_filter,
        limit=filters.limit,
        sort_by=db_sort,
    )
    saisons = FLSaisonListAdapter.validate_python([with_schedule(raw) for raw in saisons_raw])

    return FLSaisonsListResponse(saisons=saisons)


@router.get("/active", response_model=FLSaisonsSingleResponse, summary="The active Saison")
async def get_active_saison(
    saisons_collection: SaisonsCollection,
) -> FLSaisonsSingleResponse:
    """Return the season currently marked active -- what every other endpoint resolves an omitted `saison_id` against."""

    saison_raw = await pull_active_saison(saisons_collection=saisons_collection)

    saison = FLSaison.model_validate(with_schedule(saison_raw))

    return FLSaisonsSingleResponse(saison=saison)


@router.get("/frame", response_model=FLSaisonFrameResponse, summary="The season pages' frame")
async def get_frame(saisons_collection: SaisonsCollection) -> FLSaisonFrameResponse:
    """Every season the public may read, the newest first, and the one the site is on; that one is null for a league that has none."""

    saisons_raw = await pull_many_from_db(
        collection=saisons_collection,
        db_filter=base_tier_status_term(),
        sort_by=[("_id", -1)],
        projection=["_id", "start_date", "end_date", "status"],
        limit=LIST_LIMIT_MAX,
    )
    saisons = FLSaisonFrameEntryListAdapter.validate_python(saisons_raw)

    # The stored status alone: `uniq_saison_active` holds at most one, and activating the next
    # season is the one write that moves it, so a finished season stays the site's until then.
    active_saison_id = next((saison.id for saison in saisons if saison.status == "active"), None)

    return FLSaisonFrameResponse(saisons=saisons, active_saison_id=active_saison_id)


# How many of the latest results, and of the next matches, the landing shows while the season runs.
LANDING_SPIELE: Final = 2


_SPIELTAG_ROWS_AS = "spieltag_rows"

# The matchday's `position` beside the match, which a match's page and the landing's opening match name it by, in the same aggregation.
_SPIELTAG_POSITION_LOOKUP: Mapping[str, Any] = {
    "$lookup": {
        "from": Collection.SPIELTAGE,
        "localField": "spieltag_id",
        "foreignField": "_id",
        "pipeline": [{"$project": {"_id": 0, "position": 1}}],
        "as": _SPIELTAG_ROWS_AS,
    }
}


def _first_kickoff_pipeline(saison_id: str) -> list[Mapping[str, Any]]:
    """The season's earliest dated group match, a timed one ahead of an untimed one on the same day, with its matchday's `position`."""

    return [
        {"$match": {"saison_id": saison_id, "saison_phase": "gruppenphase", "datum": {"$type": "string"}}},
        # A null sorts ahead of every time, so an untimed fixture would otherwise hide the opening day's kick-off.
        {"$set": {"untimed": {"$ne": [{"$type": "$uhrzeit"}, "string"]}}},
        {"$sort": {"datum": 1, "untimed": 1, "uhrzeit": 1}},
        # Ahead of the lookup, so it joins the one match served rather than every dated one.
        {"$limit": 1},
        _SPIELTAG_POSITION_LOOKUP,
        {
            "$project": {
                "_id": 0,
                "datum": 1,
                "uhrzeit": 1,
                "spieltag_position": {"$first": f"${_SPIELTAG_ROWS_AS}.position"},
                "team1": 1,
                "team2": 1,
            }
        },
    ]


async def _active_or_none(saisons_collection: AsyncCollection) -> PublicSaison | None:
    try:
        return await resolve_public_saison(saisons_collection=saisons_collection, saison_id=None)
    except DocumentNotFoundError:
        return None


@router.get("/landing", response_model=FLLandingResponse, summary="The landing")
async def get_landing(
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    spieltage_collection: SpieltageCollection,
    teams_collection: TeamsCollection,
    today: str = Depends(get_german_date_str),
) -> FLLandingResponse:
    """The season the site is on, `before_start`, `running` or `decided`, null for a league that has none; its figures counted on every read.

    Beside it, the application window open today by the rule the submission refuses on.
    """

    saison, open_window = await asyncio.gather(
        _active_or_none(saisons_collection),
        pull_open_window_saison(saisons_collection=saisons_collection, today=today),
    )

    # The submission's own rule over what the query found, so the landing never offers a window it refuses.
    window = (
        FLBewerbungWindow(saison_id=str(open_window["_id"]), von=open_window["bewerbung"]["von"], bis=open_window["bewerbung"]["bis"])
        if open_window is not None
        and saison_nimmt_bewerbungen_an(saison_status=open_window["status"], bewerbung=open_window["bewerbung"], today=today)
        else None
    )

    if saison is None:
        return FLLandingResponse(saison=None, bewerbung_window=window)

    in_saison = {"saison_id": saison.id}
    # Two groups of reads sent at once, because one gather of nine types none of its results.
    (started, first_raw, recent_raw, upcoming_raw, finale_raw), (teams, tore_raw, count_spiele, count_spieltage) = await asyncio.gather(
        asyncio.gather(
            has_started(spiele_collection=spiele_collection, saison_id=saison.id, today=today),
            aggregate_many_from_db(collection=spiele_collection, pipeline=_first_kickoff_pipeline(saison.id), limit=1),
            aggregate_many_from_db(
                collection=spiele_collection,
                pipeline=build_spiele_pipeline(
                    db_filter={**in_saison, "ergebnis": {"$ne": None}},
                    sort_by=[("datum", -1), ("uhrzeit", -1), ("spiel_nr", -1)],
                    limit=LANDING_SPIELE,
                ),
            ),
            aggregate_many_from_db(
                collection=spiele_collection,
                pipeline=build_spiele_pipeline(
                    db_filter={**in_saison, "datum": {"$gte": today}, **unplayed_filter()},
                    sort_by=[("datum", 1), ("uhrzeit", 1), ("spiel_nr", 1)],
                    limit=LANDING_SPIELE,
                ),
            ),
            aggregate_many_from_db(
                collection=spiele_collection, pipeline=build_spiele_pipeline(db_filter={**in_saison, "saison_phase": "finale"})
            ),
        ),
        asyncio.gather(
            _clubs_of(teams_collection=teams_collection, saison_id=saison.id),
            # The matches the Tabelle counts, every phase's, as `count_spiele` counts them.
            aggregate_many_from_db(
                collection=spiele_collection,
                pipeline=[
                    {"$match": {**in_saison, **counting_fixtures_match()}},
                    {"$group": {"_id": None, "tore": {"$sum": {"$add": ["$team1.tore", "$team2.tore"]}}}},
                ],
            ),
            spiele_collection.count_documents(in_saison),
            spieltage_collection.count_documents(in_saison),
        ),
    )

    # Every season ends in a knockout (`find_rules_refusal` refuses rules drawing none), so the Finale decides it.
    podium = [
        FLPodiumPlace(platz=platz, team_id=side.team_id, name=side.name, shorthand=side.shorthand)
        for platz, side in podium_of(FLSpielJoinedListAdapter.validate_python(finale_raw))
    ]

    first = first_raw[0] if first_raw else None

    state: FLLandingState = "decided" if any(place.platz == 1 for place in podium) else "running" if started else "before_start"

    return FLLandingResponse(
        saison=FLLandingSaison(
            id=saison.id,
            state=state,
            first_kickoff=FLLandingKickoff.model_validate(first) if state == "before_start" and first else None,
            recent=FLSpielJoinedListAdapter.validate_python(recent_raw) if state == "running" else [],
            upcoming=FLSpielJoinedListAdapter.validate_python(upcoming_raw) if state == "running" else [],
            podium=podium if state == "decided" else [],
            counts=FLLandingCounts(
                count_teams=len(teams),
                # No group row where no match counts yet.
                count_tore=tore_raw[0]["tore"] if tore_raw else 0,
                count_spiele=count_spiele,
                count_spieltage=count_spieltage,
            ),
            teams=teams,
        ),
        bewerbung_window=window,
    )


# Declared after `/active`, `/frame` and `/landing`: routes match in declaration order, and the
# `objectid` convertor cannot help here, a season id being a four-character string.
@router.get("/{saison_id}", response_model=FLSaisonsSingleResponse, summary="One Saison")
async def get_saison(saison_id: str, saisons_collection: SaisonsCollection) -> FLSaisonsSingleResponse:
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
    saisons_collection: AsyncCollection,
    spieltage_collection: AsyncCollection,
    spiele_collection: AsyncCollection,
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
    saisons_collection: SaisonsCollection,
    spieltage_collection: SpieltageCollection,
    spiele_collection: SpieleCollection,
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
    saisons_collection: SaisonsCollection,
    spieltage_collection: SpieltageCollection,
    spiele_collection: SpieleCollection,
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
    saisons_collection: SaisonsCollection,
    teams_collection: TeamsCollection,
    spiele_collection: SpieleCollection,
) -> FLTabelleResponse:
    """Each group's standing over the group phase with its goals counted on every read, and how many of each group advance.

    A club that left the season keeps its row and holds no `platz`, and neither does a club that has played no match,
    listed after every club that has; 404 for a season this tier may not read.
    """

    saison = await resolve_public_saison(saisons_collection=saisons_collection, saison_id=saison_id)
    tabelle = await pull_tabelle(
        teams_collection=teams_collection, spiele_collection=spiele_collection, saison_id=saison.id, rules=saison.rules
    )

    return FLTabelleResponse(gruppen=tabelle, qualifiers_per_gruppe=saison.rules.qualifiers_per_gruppe)


async def _clubs_of(*, teams_collection: AsyncCollection, saison_id: str) -> list[FLSaisonTeamEntry]:
    """A season's clubs as the Teams page and the landing list them, a club that left the league in a `past` season alone."""

    teams_raw = await aggregate_many_from_db(
        collection=teams_collection,
        pipeline=build_team_pipeline(filters=FLPublicTeamsFilterParams(saison_id=saison_id), rules=None),
        collation=GERMAN_COLLATION,
    )

    return FLSaisonTeamEntryListAdapter.validate_python(
        [{**raw, "austritt_type": (raw.get("austritt") or {}).get("type")} for raw in teams_raw]
    )


@router.get("/{saison_id}/teams", response_model=FLSaisonTeamsResponse, summary="One Saison's teams")
async def get_teams(saison_id: str, saisons_collection: SaisonsCollection, teams_collection: TeamsCollection) -> FLSaisonTeamsResponse:
    """The clubs of one season by name, each under the name and shorthand it plays that season under.

    404 for a season this tier may not read.
    """

    _, teams = await asyncio.gather(
        resolve_public_saison(saisons_collection=saisons_collection, saison_id=saison_id),
        _clubs_of(teams_collection=teams_collection, saison_id=saison_id),
    )

    return FLSaisonTeamsResponse(teams=teams)


_SPIELTAG_ROWS_AS = "spieltag_rows"

# The matchday's `position` beside the match, which the page's eyebrow names it by, in the same aggregation.
_SPIELTAG_POSITION_LOOKUP: Mapping[str, Any] = {
    "$lookup": {
        "from": Collection.SPIELTAGE,
        "localField": "spieltag_id",
        "foreignField": "_id",
        "pipeline": [{"$project": {"_id": 0, "position": 1}}],
        "as": _SPIELTAG_ROWS_AS,
    }
}


@router.get(f"/{{saison_id}}/teams{by_id('team_id')}", response_model=FLTeamPageResponse, summary="One team's page in one Saison")
async def get_team(
    saison_id: str,
    team_id: CustomRouteObjectId,
    saisons_collection: SaisonsCollection,
    teams_collection: TeamsCollection,
    spiele_collection: SpieleCollection,
    saison_spieler_collection: SaisonSpielerCollection,
) -> FLTeamPageResponse:
    """One club in one season: the club, its row of the Tabelle, its matches and its squad.

    404 for a season this tier may not read and for a club the season does not hold.
    """

    saison = await resolve_public_saison(saisons_collection=saisons_collection, saison_id=saison_id)

    # A club that left the league stays addressable by id, as `GET /teams/{team_id}` keeps it: a caller holding one
    # was given it by something.
    club_filters = FLTeamsFilterParams(saison_id=saison.id, include_inactive=True)
    club_raw, tabelle, spiele_raw, kader_raw = await asyncio.gather(
        aggregate_many_from_db(collection=teams_collection, pipeline=build_team_pipeline(filters=club_filters, rules=None, team_id=team_id)),
        pull_tabelle(teams_collection=teams_collection, spiele_collection=spiele_collection, saison_id=saison.id, rules=saison.rules),
        aggregate_many_from_db(
            collection=spiele_collection,
            pipeline=[
                *build_spiele_pipeline(
                    db_filter={"saison_id": saison.id, "$or": [{"team1.team_id": team_id}, {"team2.team_id": team_id}]},
                    sort_by=[("spiel_nr", 1)],
                ),
                _SPIELTAG_POSITION_LOOKUP,
            ],
        ),
        aggregate_many_from_db(
            collection=saison_spieler_collection,
            pipeline=build_spieler_pipeline(FLSpielerFilterParams(team_id=team_id, saison_id=saison.id)),
            collation=GERMAN_COLLATION,
        ),
    )

    if not club_raw:
        raise DocumentNotFoundError()

    standing = next((row for rows in tabelle.root.values() for row in rows if row.id == team_id), None)

    return FLTeamPageResponse(
        team=FLTeamPageClub.model_validate(club_raw[0]),
        standing=standing,
        spiele=FLTeamPageSpielListAdapter.validate_python(
            [{**spiel_raw, "spieltag_position": spiel_raw[_SPIELTAG_ROWS_AS][0]["position"]} for spiel_raw in spiele_raw]
        ),
        kader=FLSpielerListAdapter.validate_python(kader_raw),
    )


@router.get(f"/{{saison_id}}/spiele{by_id('spiel_id')}", response_model=FLSpielPageResponse, summary="One Spiel's page")
async def get_spiel(
    saison_id: str,
    spiel_id: CustomRouteObjectId,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    teams_collection: TeamsCollection,
    spielberichte_collection: SpielberichteCollection,
) -> FLSpielPageResponse:
    """One match as its page and its pop-up show it, each side of a group match with its group and `platz`; 404 outside a readable season.

    Its report's line-ups whenever a club entered one, the scorers and cards only while the report is adopted and
    unchanged since, every pupil through the public mask.
    """

    saison, spiele_raw, berichte_raw = await asyncio.gather(
        resolve_public_saison(saisons_collection=saisons_collection, saison_id=saison_id),
        aggregate_many_from_db(
            collection=spiele_collection,
            pipeline=[*build_spiele_pipeline(db_filter={"_id": spiel_id, "saison_id": saison_id}), _SPIELTAG_POSITION_LOOKUP],
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
        standings = FLSpielSideStandings(**{seite: placed.get(team_id_of(spiel_raw, seite)) for seite in SEITEN})

    return FLSpielPageResponse(
        spiel=FLSpielJoined.model_validate(spiel_raw),
        spieltag_position=spiel_raw[_SPIELTAG_ROWS_AS][0]["position"],
        standings=standings,
        bericht=compose_public_bericht(berichte_raw[0], spiel_raw) if berichte_raw else None,
    )
