import asyncio
import secrets
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, status
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.address_change.crud import denied_addresses
from app.api.address_change.services import build_addresses_filter
from app.api.aktionen.crud import redact_images_in_session
from app.api.berechtigungen.guard import verify_actor_is_admin
from app.api.bewerbungen.services import seat_addresses, seat_named
from app.api.einladungen.crud import einladung_bezug, owed_einladung_mails
from app.api.einladungen.schemas import (
    FLEinladung,
    FLInvitationMailPayload,
    FLInvitationMailResponse,
    FLInvitationMintResponse,
    FLInvitationResponse,
    FLInvitationRow,
    FLInvitationWriteResponse,
    FLTeamLinkState,
)
from app.api.einladungen.services import (
    WITHOUT_TOKEN_HASH,
    bestaetigte_empfaenger,
    build_live_team_filter,
    compose_einladung,
    compose_revocation_update,
    compose_sent_update,
    find_saison_vorbei_refusal,
    find_team_in_saison_refusal,
    plan_einladung_dispatch,
)
from app.api.kontakte.crud import clear_seats, redact_seats_in_documents
from app.api.kontakte.services import SEAT_FIELDS, build_accepted_application_pipeline, contact_block_image_edits, seated_people
from app.api.outbox.crud import state_of, states_of
from app.api.outbox.services import OwedMail, enqueue_mails
from app.api.registrierungen.services import saison_nimmt_registrierungen_an
from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import find_saison_past_refusal, has_started
from app.api.sperrliste.lookup import BanList, BanListLookup, ban_list_saison, barred_addresses
from app.api.sperrliste.services import withheld_actor
from app.api.spielbestaetigungen.services import seat_void_of
from app.api.teams.crud import enter_a_club, found_a_club, pull_a_club_to_enter, refuse_a_gruppe_move, void_moved_seats, write_the_club
from app.api.teams.schemas import (
    FLAustrittPayload,
    FLKontaktInviteResponse,
    FLKontaktMint,
    FLPatchSaisonTeamKontaktePayload,
    FLPatchSaisonTeamKontakteResponse,
    FLPatchSaisonTeamPayload,
    FLPatchTeamPayload,
    FLPatchTeamResponse,
    FLPatchTeamSaisonPayload,
    FLPatchTeamSaisonResponse,
    FLPostSaisonTeamPayload,
    FLPostTeamEntryPayload,
    FLPostTeamEntryResponse,
    FLPostTeamPayload,
    FLReplaceSaisonTeamPayload,
    FLReplaceSaisonTeamResponse,
    FLSaisonTeamResponse,
    FLTeamEntryClub,
    FLTeamEntryOffer,
    FLTeamRecord,
    FLTeamsAdminFilterParams,
    FLTeamsAdminListResponse,
    FLTeamSaisonAdminResponse,
    FLTeamSaisonFacts,
    FLTeamsSaisonsResponse,
    FLTeamWithMemberships,
    FLTeamWithMembershipsListAdapter,
)
from app.api.teams.services import (
    TAKEN_PLACE_FIELDS,
    build_team_fixtures_filter,
    build_team_saisons_pipeline,
    compose_bestaetigungen_mit,
    compose_bestaetigungen_nach,
    compose_kontakt_bestaetigung,
    compose_kontakte_herkunft,
    composite_version,
    find_austritt_refusal,
    find_gruppe_move_refusal,
    find_kontakt_seat_barred_refusal,
    find_kontakt_sitz_refusal,
    find_kontakt_zeile_refusal,
    find_replacement_pair_refusal,
    find_replacement_refusal,
    find_retire_refusal,
    find_stale_team_save_refusal,
    gruppe_offer,
    has_taken_place,
    kontakt_zeile_of,
    links_owed,
    membership_row_ids,
    mit_adresswechseln,
    mit_linkstand,
    owed_kontakt_link,
    saison_blocking_retirement,
    seated_identifiers,
    seats_one_link_answers,
    teams_admin_rows,
)
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import (
    GERMAN_COLLATION,
    VERSION_FIELD,
    aggregate_many_from_db,
    anchor_in_db,
    build_sort,
    patch_many_in_db,
    patch_one_in_db,
    post_one_to_db,
    pull_many_from_db,
    pull_one_from_db,
    pull_whole_from_db,
    refuse,
    set_inactive_since,
)
from app.core.dependencies import (
    ActionLogCollection,
    AddressChangeCollection,
    BewerbungenCollection,
    DBClient,
    GrantsAnnouncedCollection,
    GrantsCollection,
    InvitationsCollection,
    OutboxCollection,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonTeamsCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
    TeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.recording import build_redaction_filter, log_stamp
from app.core.routing import by_id
from app.core.security import (
    bind_actor,
    get_actor_auth_time,
    get_actor_email,
    verify_access_admin,
    verify_step_up,
)
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import CustomRouteObjectId
from app.shared.schemas.literals import KONTAKT_ROLLEN
from app.shared.schemas.responses import FLCreatedResponse
from app.shared.tokens import mint_token

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/teams",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


async def _rewrite_the_outgoing_clubs_sides(
    *,
    spiele: Sequence[Mapping[str, Any]],
    outgoing_team_id: Any,
    incoming_team_id: Any,
    spiele_collection: AsyncCollection,
    session: AsyncClientSession,
) -> int:
    """Hand this club's sides to the incoming one by its `team_id` alone; returns how many FIXTURES moved.

    Every read joins a side's name from its season row, so no name is written here. Named by `_id` off a snapshot
    taken BEFORE any write, as `_rewrite_gruppenphase_sides` is.
    """

    # One `update_many` writes one path with one value, so the passes split by slot.
    by_slot: dict[str, list[Any]] = {}
    for spiel in spiele:
        for slot in ("team1", "team2"):
            if (spiel.get(slot) or {}).get("team_id") == outgoing_team_id:
                by_slot.setdefault(slot, []).append(spiel["_id"])

    for slot, spiel_ids in by_slot.items():
        await patch_many_in_db(
            collection=spiele_collection,
            db_filter={"_id": {"$in": spiel_ids}},
            update={"$set": {f"{slot}.team_id": incoming_team_id}},
            session=session,
        )

    # The fixtures, not the sides: `modified_count` reports 0 where a value already matched, and
    # double-counts a fixture holding the club on both.
    return len({spiel_id for spiel_ids in by_slot.values() for spiel_id in spiel_ids})


async def _with_seat_states(
    teams_raw: Sequence[Mapping[str, Any]],
    *,
    address_changes_collection: AsyncCollection,
    grants_collection: AsyncCollection,
    grants_announced_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    today: str,
    operator: str,
    auth_time: int,
) -> list[dict[str, Any]]:
    """The memberships read with each seat's link state and live address change composed on."""

    addresses = seated_identifiers(teams_raw)
    live = (
        {
            row["address"]: row["_id"]
            for row in await aggregate_many_from_db(
                collection=address_changes_collection,
                pipeline=[{"$match": build_addresses_filter(addresses)}, {"$project": {"address": 1}}],
            )
        }
        if addresses
        else {}
    )
    denied = await denied_addresses(
        live,
        actor=sign_in_identifier(operator),
        auth_time=auth_time,
        grants_collection=grants_collection,
        grants_announced_collection=grants_announced_collection,
        session=None,
    )

    lagen = await states_of(outbox_collection=outbox_collection, collection=Collection.SAISON_TEAMS, ids=membership_row_ids(teams_raw))

    return mit_adresswechseln(mit_linkstand(teams_raw, today=today, lagen=lagen), live=live, denied=denied)


async def _served_invitation(live: Mapping[str, Any], *, ban_list: BanList, outbox_collection: AsyncCollection) -> FLInvitationRow:
    """One live link as a read serves it: its minter withheld where the ban list holds that address, and what became of its last mail."""

    # As stored first, so a row the stored shape refuses fails here rather than being served withheld.
    erstellt_von = FLEinladung.model_validate(live).created_by
    barred = await barred_addresses(ban_list, [sign_in_identifier(erstellt_von)])
    withheld = withheld_actor(erstellt_von, barred)
    lage = await state_of(outbox_collection=outbox_collection, reference=einladung_bezug(live["_id"]))

    return FLInvitationRow.model_validate({**live, "created_by": withheld, "created_by_barred": withheld is None, "delivery": lage})


# A static path beside `by_id` routes: the id convertor takes 24 hex characters, so no id route can
# capture this one whatever the declaration order.
@router.get("/saisons", response_model=FLTeamsSaisonsResponse, summary="Every team with its season memberships")
async def get_team_saisons(
    teams_collection: TeamsCollection,
    address_changes_collection: AddressChangeCollection,
    grants_collection: GrantsCollection,
    grants_announced_collection: GrantsAnnouncedCollection,
    outbox_collection: OutboxCollection,
    today: str = Depends(get_german_date_str),
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
) -> FLTeamsSaisonsResponse:
    """
    Every team, retired ones included, each with every season membership it holds. Sorted by name.

    Each membership names the live change of each seat's address, which the address tool shows, and per seat why the
    tool refuses that change this administrator. Each seat's link names what became of the last mail carrying it,
    `delivery` null where none was ever owed.
    """

    teams_raw = await aggregate_many_from_db(collection=teams_collection, pipeline=build_team_saisons_pipeline(), collation=GERMAN_COLLATION)

    return FLTeamsSaisonsResponse(
        teams=FLTeamWithMembershipsListAdapter.validate_python(
            await _with_seat_states(
                teams_raw,
                address_changes_collection=address_changes_collection,
                grants_collection=grants_collection,
                grants_announced_collection=grants_announced_collection,
                outbox_collection=outbox_collection,
                today=today,
                operator=operator,
                auth_time=auth_time,
            )
        )
    )


# Two static segments, as `GET /saisons/list/admin` has, so the admin tier lists every season-scoped
# resource under one shape. No id route at this prefix ends in `/admin`, so none can shadow this one.
@router.get(
    "/list/admin",
    response_model=FLTeamsAdminListResponse,
    summary="One season's Teams list and what its create dialog offers",
)
async def get_teams_admin(
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    filters: FLTeamsAdminFilterParams = Depends(),
) -> FLTeamsAdminListResponse:
    """
    The Teams page in one read: the season's clubs, a `future` season's included, and what entering another offers.

    No base-tier season gate: a club is entered while its season is still planned. Each row counts its seats, its state
    the type of an exit and the day its club left the league. `state=retired` reads past the season's rows to every
    retired club, which is the way back to one. `entry` is every club still in the league holding no row of the season,
    each group with whether it is full, and `closed` where the season is not `future`, which the entry refuses. 404
    where no season holds that id.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": filters.saison_id}, projection=["status", "rules"])
    rows, clubs = await asyncio.gather(
        # Each whole, as the group's fill is judged over every row. The seat's stamp and never its person: this list names none.
        pull_whole_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": filters.saison_id},
            what=f"season {filters.saison_id}'s clubs",
            projection=[
                "team_id",
                "name",
                "shorthand",
                "gruppe",
                "austritt.type",
                *[f"kontakte.{seat}.einwilligung.confirmed_at" for seat in KONTAKT_ROLLEN],
            ],
            sort_by=build_sort(sort_by="name", order="asc"),
            collation=GERMAN_COLLATION,
        ),
        pull_whole_from_db(
            collection=teams_collection,
            db_filter={},
            what="the league's clubs",
            projection=["name", "shorthand", "inactive_since"],
            sort_by=build_sort(sort_by="name", order="asc"),
            collation=GERMAN_COLLATION,
        ),
    )
    entered = {row["team_id"] for row in rows}

    return FLTeamsAdminListResponse(
        teams=teams_admin_rows(rows=rows, clubs=clubs, state=filters.state, gruppe=filters.gruppe),
        entry=FLTeamEntryOffer(
            clubs=[FLTeamEntryClub.model_validate(club) for club in clubs if club["_id"] not in entered and club.get("inactive_since") is None],
            gruppen=gruppe_offer(rules=FLSaisonRules.model_validate(saison_raw["rules"]), gruppen=[row["gruppe"] for row in rows]),
            closed=saison_raw["status"] != "future",
        ),
    )


@router.get(
    f"{by_id('team_id')}/saisons/{{saison_id}}/admin",
    response_model=FLTeamSaisonAdminResponse,
    summary="One team in one season for the admin editor",
)
async def get_team_saison_admin(
    team_id: CustomRouteObjectId,
    saison_id: str,
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    invitations_collection: InvitationsCollection,
    address_changes_collection: AddressChangeCollection,
    grants_collection: GrantsCollection,
    grants_announced_collection: GrantsAnnouncedCollection,
    outbox_collection: OutboxCollection,
    ban_list: BanListLookup,
    today: str = Depends(get_german_date_str),
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
) -> FLTeamSaisonAdminResponse:
    """
    Return what the team editor shows in one read: the club, its row of the season, and what each act of the page meets.

    `version` is what the one save sends. `membership` serves the row with its seats' links and address changes, null for
    a club holding no row of the season, a retired one reached through the list's filter; `link` is null with it.
    `gruppen` is each group the season offers with whether it is full, `gruppe_locked` whether a group move is refused
    `entry_gruppe_locked`, and `retire_blocked_by` the season `retire_blocked` refuses over, by each write's own judgement.
    `link` is the live registration link, the window's judgement of it, and why the season's press would pass the team
    over. Read outside a transaction: a write landing under this read is judged by its own write. 404 where no club or no
    season holds that id.
    """

    saison_raw = await pull_one_from_db(
        collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status", "start_date", "rules", "registrierung"]
    )
    # The memberships read narrowed to this club, so a seat reads here as it does everywhere the read serves it.
    teams_raw = await aggregate_many_from_db(
        collection=teams_collection, pipeline=[{"$match": {"_id": team_id}}, *build_team_saisons_pipeline()], collation=GERMAN_COLLATION
    )
    if not teams_raw:
        raise DocumentNotFoundError()

    team_raw = teams_raw[0]
    held_saison_ids = [row["saison_id"] for row in team_raw["memberships"]]
    row_raw = next((row for row in team_raw["memberships"] if row["saison_id"] == saison_id), None)

    served, season_rows, held_saisons, fixtures_drawn, live = await asyncio.gather(
        _with_seat_states(
            teams_raw,
            address_changes_collection=address_changes_collection,
            grants_collection=grants_collection,
            grants_announced_collection=grants_announced_collection,
            outbox_collection=outbox_collection,
            today=today,
            operator=operator,
            auth_time=auth_time,
        ),
        pull_whole_from_db(
            collection=saison_teams_collection, db_filter={"saison_id": saison_id}, what=f"season {saison_id}'s clubs", projection=["gruppe"]
        ),
        pull_many_from_db(collection=saisons_collection, db_filter={"_id": {"$in": held_saison_ids}}, projection=["status"]),
        spiele_collection.count_documents(build_team_fixtures_filter(saison_id=saison_id, team_id=team_id)),
        # A list read where the answer is one row, as `get_invitation` reads it.
        pull_many_from_db(
            collection=invitations_collection,
            db_filter=build_live_team_filter(saison_id=saison_id, team_id=team_id),
            limit=1,
            projection=WITHOUT_TOKEN_HASH,
        ),
    )

    link = None
    if row_raw is not None:
        recipients = bestaetigte_empfaenger(kontakte=row_raw.get("kontakte"))
        barred = await barred_addresses(ban_list, [person.email for person in recipients]) if recipients else set()
        registrierung = saison_raw.get("registrierung")
        link = FLTeamLinkState(
            invitation=await _served_invitation(live[0], ban_list=ban_list, outbox_collection=outbox_collection) if live else None,
            running=saison_nimmt_registrierungen_an(saison_status=saison_raw["status"], registrierung=registrierung, today=today),
            paused=registrierung is not None and not registrierung["open"],
            skipped=plan_einladung_dispatch(
                austritt=row_raw.get("austritt"),
                kontakte=row_raw.get("kontakte"),
                einladung_raw=live[0] if live else None,
                resend=False,
                barred=barred,
            ).skipped,
        )

    memberships = FLTeamWithMemberships.model_validate(served[0]).memberships

    return FLTeamSaisonAdminResponse(
        version=composite_version(team=team_raw, row=row_raw or {}),
        team=FLTeamRecord.model_validate(team_raw),
        saison=FLTeamSaisonFacts(
            id=saison_id,
            status=saison_raw["status"],
            start_date=saison_raw["start_date"],
            begun=has_started(start_date=str(saison_raw["start_date"]), today=today),
        ),
        membership=next((membership for membership in memberships if membership.saison_id == saison_id), None),
        gruppen=gruppe_offer(rules=FLSaisonRules.model_validate(saison_raw["rules"]), gruppen=[row["gruppe"] for row in season_rows]),
        gruppe_locked=find_gruppe_move_refusal(fixtures_drawn=fixtures_drawn) is not None,
        retire_blocked_by=saison_blocking_retirement(held_saisons),
        link=link,
    )


# Redesign: goes with its last importer.
@router.post("", response_model=FLCreatedResponse, status_code=201, summary="Create a team")
async def post_team(
    team_data: Annotated[FLPostTeamPayload, Body()],
    teams_collection: TeamsCollection,
    db: DBClient,
) -> FLCreatedResponse:
    """Create a club. `shorthand` is unique across every club, retired ones included: a taken one is refused `duplicate_key`.

    The refusal names `shorthand`.
    """

    async def found_the_club(session: AsyncClientSession) -> Any:
        return await found_a_club(teams_collection=teams_collection, club=team_data.model_dump(mode="json"), session=session)

    async with transaction_session(db) as session:
        return FLCreatedResponse(created_id=await session.with_transaction(found_the_club))


@router.post(
    "/saisons/{saison_id}/entry",
    response_model=FLPostTeamEntryResponse,
    status_code=201,
    summary="Enter a club into a season, one the league holds or a new one",
)
async def post_team_entry(
    saison_id: str,
    entry_data: Annotated[FLPostTeamEntryPayload, Body()],
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
) -> FLPostTeamEntryResponse:
    """
    Enter a club into a `future` season in a group and a colour, founding it first where it is new.

    A new club's `shorthand` is unique across every club, retired ones included: a taken one is refused `duplicate_key`,
    naming `shorthand`. A retired club is refused `team_retired`, and the season and the group as an entry is.
    """

    async def found_and_enter(session: AsyncClientSession) -> Any:
        club = entry_data.club
        team_id = (
            club.team_id
            if club.kind == "known"
            else await found_a_club(teams_collection=teams_collection, club=club.team.model_dump(mode="json"), session=session)
        )
        await enter_a_club(
            teams_collection=teams_collection,
            saison_teams_collection=saison_teams_collection,
            saisons_collection=saisons_collection,
            team_id=team_id,
            saison_id=saison_id,
            gruppe=entry_data.gruppe,
            trikot_farbe=entry_data.trikot_farbe,
            session=session,
        )

        return team_id

    # One transaction: a refused entry leaves no new club behind it, which the list would then offer as if chosen.
    # `with_transaction` is safe to retry, the callback re-reading everything it judges.
    async with transaction_session(db) as session:
        return FLPostTeamEntryResponse(team_id=await session.with_transaction(found_and_enter))


# Redesign: goes with its last importer.
@router.patch(
    by_id("team_id"),
    response_model=FLPatchTeamResponse,
    summary="Update a team and fan the rename out",
)
async def patch_team(
    team_id: CustomRouteObjectId,
    team_data: Annotated[FLPatchTeamPayload, Body()],
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
) -> FLPatchTeamResponse:
    """
    Update a club, then rewrite the name and shorthand its unfinished seasons' rows carry.

    Every fixture reads its sides' names from their season rows, so a rename reaches the fixtures of each season it
    rewrites; a `past` season keeps the name it was played under. A shorthand another club holds, a retired one included,
    is refused `duplicate_key`, naming `shorthand`.
    """

    async def rename_and_fan_out(session: AsyncClientSession) -> FLPatchTeamResponse:
        _, fanned_out = await write_the_club(
            teams_collection=teams_collection,
            saison_teams_collection=saison_teams_collection,
            saisons_collection=saisons_collection,
            team_id=team_id,
            club=team_data.model_dump(mode="json", exclude={"version"}),
            expected_version=team_data.version,
            session=session,
        )

        return FLPatchTeamResponse(fanned_out_to_saison_teams=fanned_out)

    # One transaction over every write here: a rename reaching some and not the rest leaves a season
    # disagreeing with itself. `with_transaction` is safe to retry, every write deriving from the payload.
    async with transaction_session(db) as session:
        return await session.with_transaction(rename_and_fan_out)


@router.delete(
    by_id("team_id"),
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Retire a team (soft delete)",
)
async def delete_team(
    team_id: CustomRouteObjectId,
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> None:
    """
    Retire a club from the league. SOFT: `inactive_since` is stamped and the document stays.

    Refused while the club is entered in an `active` or `future` season. Its junction rows are left
    alone: the seasons it played still happened.
    """

    async def retire_the_club(session: AsyncClientSession) -> Mapping[str, Any]:
        """Judge the club's seasons, then stamp it. Everything judged is read in-session, so a retry re-judges it."""

        # Two small reads rather than a lookup: a club holds a handful of rows, the league a few seasons.
        junction_rows = await pull_many_from_db(
            collection=saison_teams_collection,
            db_filter={"team_id": team_id},
            projection=["saison_id"],
            session=session,
        )
        saison_ids = [row["saison_id"] for row in junction_rows]
        saison_rows = await pull_many_from_db(
            collection=saisons_collection,
            db_filter={"_id": {"$in": saison_ids}},
            projection=["status"],
            session=session,
        )

        refuse(find_retire_refusal(str(row["status"]) for row in saison_rows))

        return await set_inactive_since(collection=teams_collection, db_filter={"_id": team_id}, when=today, session=session)

    # The stamp inside the judgement's transaction: an entry writes nothing read here, so the club it
    # anchors (`app/api/teams/crud.py :: pull_a_club_to_enter`) is the one document the two conflict on.
    async with transaction_session(db) as session:
        await session.with_transaction(retire_the_club)


@router.post(
    f"{by_id('team_id')}/reactivate",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Bring a retired team back",
)
async def reactivate_team(
    team_id: CustomRouteObjectId,
    teams_collection: TeamsCollection,
    db: DBClient,
) -> None:
    """Clear `inactive_since`, restoring a retired club to reads that hide retired ones."""

    async def bring_the_club_back(session: AsyncClientSession) -> Mapping[str, Any]:
        return await set_inactive_since(collection=teams_collection, db_filter={"_id": team_id}, when=None, session=session)

    async with transaction_session(db) as session:
        await session.with_transaction(bring_the_club_back)


# Redesign: goes with its last importer.
@router.post(
    f"{by_id('team_id')}/saisons",
    response_model=FLSaisonTeamResponse,
    status_code=201,
    summary="Enter a team into a season",
    dependencies=[Depends(verify_step_up)],
)
async def post_saison_team(
    team_id: CustomRouteObjectId,
    saison_team_data: Annotated[FLPostSaisonTeamPayload, Body()],
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
) -> FLSaisonTeamResponse:
    """
    Enter a team into a season, in a group, under the name the club carries today.

    A club with no row here is ABSENT from that season rather than merely unlisted.
    """

    async def enter_the_club(session: AsyncClientSession) -> Mapping[str, Any]:
        return await enter_a_club(
            teams_collection=teams_collection,
            saison_teams_collection=saison_teams_collection,
            saisons_collection=saisons_collection,
            team_id=team_id,
            saison_id=saison_team_data.saison_id,
            gruppe=saison_team_data.gruppe,
            trikot_farbe=None,
            session=session,
        )

    # One transaction over the entry and the season write inside `refuse_a_full_gruppe`, which is
    # what makes two entrants contend. `with_transaction` is safe to retry, the callback re-reading
    # everything it judges.
    async with transaction_session(db) as session:
        entered = await session.with_transaction(enter_the_club)

    return FLSaisonTeamResponse(
        saison_id=saison_team_data.saison_id,
        team_id=team_id,
        gruppe=saison_team_data.gruppe,
        austritt=None,
        trikot_farbe=None,
        kontakte=None,
        name=entered["name"],
        shorthand=entered["shorthand"],
    )


# Redesign: goes with its last importer.
@router.patch(
    f"{by_id('team_id')}/saisons/{{saison_id}}",
    response_model=FLSaisonTeamResponse,
    summary="Rewrite a team's season row: group, exit record and kit colour",
)
async def patch_saison_team(
    team_id: CustomRouteObjectId,
    saison_id: str,
    saison_team_data: Annotated[FLPatchSaisonTeamPayload, Body()],
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSaisonTeamResponse:
    """
    Rewrite a team's row for one season: group, exit record and kit colour.

    All three are required and replaced WHOLESALE: an omitted key is a 422, never a team reinstated.
    The contact block is `PATCH .../kontakte`'s, and stays correctable there on a `past` season, which
    refuses this write (`saison_past`). A new or changed exit is refused until the season's start date
    (`austritt_before_saison_start`, its `earliest` the start): before it, the replacement takes a club out.
    """

    async def move_the_club(session: AsyncClientSession) -> tuple[Mapping[str, Any], Mapping[str, Any]]:
        """Judge the move, then rewrite the row. Everything judged is read in-session."""

        # The identity comes back with the group because this endpoint echoes the whole row and
        # writes neither field: a group change and an austritt both leave the season's name where it was.
        existing_raw = await pull_one_from_db(
            collection=saison_teams_collection,
            db_filter={"team_id": team_id, "saison_id": saison_id},
            projection=["gruppe", "name", "shorthand", "austritt"],
            session=session,
        )

        # One read of the season for both judgements below, anchored so the status belongs to this write set:
        # `activate_saison` writes this document, so a rollover landing under the move conflicts and the retry reads `past`.
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)
        await anchor_in_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)

        # Every write, an exit record included: a finished season's table and podium are read off these rows,
        # and an exit recorded now would move places its fixtures can no longer be saved to answer.
        refuse(find_saison_past_refusal(saison_status=str(saison_raw["status"])))

        # On the anchored season's stored start, so a start moved under this write conflicts and the retry judges the
        # exit against the date it left.
        austritt = saison_team_data.austritt
        start_date = str(saison_raw["start_date"])
        refuse(
            find_austritt_refusal(
                proposed=None if austritt is None else austritt.model_dump(mode="json"),
                stored=existing_raw.get("austritt"),
                start_date=start_date,
                started=has_started(start_date=start_date, today=today),
            )
        )

        # Only a CHANGE is judged: recording an austritt writes the same row without moving anyone, so two
        # austritte contend only on the season's anchor above, which costs one retry.
        if saison_team_data.gruppe != existing_raw["gruppe"]:
            await refuse_a_gruppe_move(
                spiele_collection=spiele_collection,
                saison_teams_collection=saison_teams_collection,
                saisons_collection=saisons_collection,
                team_id=team_id,
                saison_id=saison_id,
                gruppe=saison_team_data.gruppe,
                rules=FLSaisonRules.model_validate(saison_raw["rules"]),
                session=session,
            )

        updated_raw = await patch_one_in_db(
            collection=saison_teams_collection,
            db_filter={"team_id": team_id, "saison_id": saison_id},
            update={"$set": saison_team_data.model_dump(mode="json", exclude={"version"})},
            expected_version=saison_team_data.version,
            session=session,
            return_document=ReturnDocument.AFTER,
        )

        return existing_raw, updated_raw

    # One transaction, because a group change makes two writes: this row and the season the group's
    # count is scoped by. `with_transaction` is safe to retry, the callback re-reading both.
    async with transaction_session(db) as session:
        existing_raw, updated_raw = await session.with_transaction(move_the_club)

    # `kontakte` below is the one field read off the AFTER image, no payload carrying the block. A
    # block in a shape this model cannot describe refuses, a keyword being validated like any other value.

    # Assembled after the commit rather than inside the callback, so such a block answers 500 for a
    # write that landed rather than aborting a correct move over a field this endpoint never touches.
    return FLSaisonTeamResponse(
        saison_id=saison_id,
        team_id=team_id,
        gruppe=saison_team_data.gruppe,
        austritt=saison_team_data.austritt,
        # From the PAYLOAD, not the pre-read above: the `$set` writes these wholesale, so the values
        # sent are the values now stored and the projection has nothing to widen for.
        trikot_farbe=saison_team_data.trikot_farbe,
        kontakte=updated_raw["kontakte"],
        name=existing_raw["name"],
        shorthand=existing_raw["shorthand"],
    )


@router.patch(
    f"{by_id('team_id')}/saisons/{{saison_id}}/admin",
    response_model=FLPatchTeamSaisonResponse,
    summary="Save the team editor: the club and its row of the season, in one transaction",
)
async def patch_team_saison(
    team_id: CustomRouteObjectId,
    saison_id: str,
    team_data: Annotated[FLPatchTeamSaisonPayload, Body()],
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    db: DBClient,
) -> FLPatchTeamSaisonResponse:
    """
    Save the team editor's one version: the club, the rename's fan-out, and the group and colour of this season's row.

    Refused `version_stale` once the club or the row has moved since the editor read them, whichever it was. Judged per
    part: a `past` season keeps the club's fields open and refuses `saison_past` only where the group or the colour
    changes, since a finished season's table and podium are read off its rows. A shorthand another club holds, a retired one
    included, is refused `duplicate_key`, naming `shorthand`. A group move is refused as `entry_gruppe_locked` and
    `entry_gruppe_full` refuse it. 404 where the club holds no row of the season.
    """

    row_filter = {"team_id": team_id, "saison_id": saison_id}

    async def save_the_club_and_its_row(session: AsyncClientSession) -> FLPatchTeamSaisonResponse:
        """Judge both parts, then write both. Everything judged is read in-session, so a retry re-judges it."""

        team_raw = await pull_one_from_db(collection=teams_collection, db_filter={"_id": team_id}, projection=[VERSION_FIELD], session=session)
        row_raw = await pull_one_from_db(
            collection=saison_teams_collection, db_filter=row_filter, projection=["gruppe", "trikot_farbe", VERSION_FIELD], session=session
        )
        refuse(find_stale_team_save_refusal(version=team_data.version, team=team_raw, row=row_raw))

        # Anchored, so the status belongs to this write set: `activate_saison` writes this document, so a rollover landing
        # under the save conflicts and the retry reads `past`.
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)
        await anchor_in_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)

        row_part = {"gruppe": team_data.gruppe, "trikot_farbe": team_data.trikot_farbe}
        moves_the_row = any(row_raw.get(field) != value for field, value in row_part.items())
        if moves_the_row:
            refuse(find_saison_past_refusal(saison_status=str(saison_raw["status"])))

        if team_data.gruppe != row_raw["gruppe"]:
            await refuse_a_gruppe_move(
                spiele_collection=spiele_collection,
                saison_teams_collection=saison_teams_collection,
                saisons_collection=saisons_collection,
                team_id=team_id,
                saison_id=saison_id,
                gruppe=team_data.gruppe,
                rules=FLSaisonRules.model_validate(saison_raw["rules"]),
                session=session,
            )

        stored_team, _ = await write_the_club(
            teams_collection=teams_collection,
            saison_teams_collection=saison_teams_collection,
            saisons_collection=saisons_collection,
            team_id=team_id,
            club=team_data.model_dump(mode="json", exclude={"gruppe", "trikot_farbe", "version"}),
            # The sum above judged both, on reads this transaction's writes conflict with.
            expected_version=None,
            session=session,
        )

        # After the fan-out, which raises this row's count too where the rename reaches it, so the answer is the count stored.
        stored_row = (
            await patch_one_in_db(
                collection=saison_teams_collection,
                db_filter=row_filter,
                update={"$set": row_part},
                expected_version=None,
                session=session,
                return_document=ReturnDocument.AFTER,
            )
            if moves_the_row
            else await pull_one_from_db(collection=saison_teams_collection, db_filter=row_filter, projection=[VERSION_FIELD], session=session)
        )

        return FLPatchTeamSaisonResponse(version=composite_version(team=stored_team, row=stored_row))

    # One transaction, or a refusal of the row's part leaves the club's half saved under an editor reading it as failed.
    # `with_transaction` is safe to retry, every write deriving from the payload and an in-session read.
    async with transaction_session(db) as session:
        return await session.with_transaction(save_the_club_and_its_row)


async def _pull_the_season_of_an_exit(*, saisons_collection: AsyncCollection, saison_id: str, session: AsyncClientSession) -> Mapping[str, Any]:
    """The season an exit is judged on, refusing a finished one: its table and podium are read off these rows.

    Anchored, so the status and the start belong to the write set: `activate_saison` and `PATCH /saisons/{saison_id}` write
    this document, so either landing under the exit conflicts and the retry judges the season it left.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)
    await anchor_in_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)
    refuse(find_saison_past_refusal(saison_status=str(saison_raw["status"])))

    return saison_raw


@router.put(
    f"{by_id('team_id')}/saisons/{{saison_id}}/austritt",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Record a team's exit from a season",
)
async def put_austritt(
    team_id: CustomRouteObjectId,
    saison_id: str,
    austritt_data: Annotated[FLAustrittPayload, Body()],
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> None:
    """
    Record how a team left the season, or replace the record standing.

    Refused `saison_past` on a finished season, and `austritt_before_saison_start` until the season's start date, its
    `earliest` the start: before it, the replacement takes a club out. 404 where the team holds no row of the season.
    """

    row_filter = {"team_id": team_id, "saison_id": saison_id}
    proposed = austritt_data.model_dump(mode="json")

    async def record_the_exit(session: AsyncClientSession) -> None:
        stored = await pull_one_from_db(collection=saison_teams_collection, db_filter=row_filter, projection=["austritt"], session=session)
        saison_raw = await _pull_the_season_of_an_exit(saisons_collection=saisons_collection, saison_id=saison_id, session=session)
        start_date = str(saison_raw["start_date"])
        refuse(
            find_austritt_refusal(
                proposed=proposed,
                stored=stored.get("austritt"),
                start_date=start_date,
                started=has_started(start_date=start_date, today=today),
            )
        )

        await patch_one_in_db(
            collection=saison_teams_collection,
            db_filter=row_filter,
            update={"$set": {"austritt": proposed}},
            expected_version=None,
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

    # One transaction: what the exit owes commits with it or neither does.
    async with transaction_session(db) as session:
        await session.with_transaction(record_the_exit)


@router.delete(
    f"{by_id('team_id')}/saisons/{{saison_id}}/austritt",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Lift a team's exit from a season",
)
async def delete_austritt(
    team_id: CustomRouteObjectId,
    saison_id: str,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
) -> None:
    """
    Lift the exit standing on a team's row: the repair of a wrong record, a public reason among them.

    Refused `saison_past` on a finished season. Recalls no notice; a fixture called off is asked afresh once its club is
    back. 404 where the team holds no row of the season.
    """

    row_filter = {"team_id": team_id, "saison_id": saison_id}

    async def lift_the_exit(session: AsyncClientSession) -> None:
        await _pull_the_season_of_an_exit(saisons_collection=saisons_collection, saison_id=saison_id, session=session)
        await patch_one_in_db(
            collection=saison_teams_collection,
            db_filter=row_filter,
            update={"$set": {"austritt": None}},
            expected_version=None,
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

    async with transaction_session(db) as session:
        await session.with_transaction(lift_the_exit)


@router.patch(
    f"{by_id('team_id')}/saisons/{{saison_id}}/kontakte",
    response_model=FLPatchSaisonTeamKontakteResponse,
    summary="Rewrite a team's season contacts, and nothing else on the row",
)
async def patch_saison_team_kontakte(
    team_id: CustomRouteObjectId,
    saison_id: str,
    kontakte_data: Annotated[FLPatchSaisonTeamKontaktePayload, Body()],
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    outbox_collection: OutboxCollection,
    ban_list: BanListLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLPatchSaisonTeamKontakteResponse:
    """
    Rewrite the three people this team is reached through for one season. Null clears the block.

    Its own endpoint so the contacts editor and the club editor cannot clobber one row. The body carries the `version`
    its caller was served, and a row another write has raised since is refused `version_stale` rather than overwritten,
    an erasure between the caller's read and this write being what moves it. A `past` season's contacts stay correctable.
    Each seat's `entered_by` and
    `confirmed_at` are the server's: a seat keeping its person keeps both, and a seat newly filled or handed
    on is stored as the league's entry, unconfirmed.

    **Each person the save newly seats is owed a confirmation link**, mailed through the Postausgang in this write's own
    transaction and named in `confirmations` by the address it goes to, never by the link: one per person, covering
    both seats where the Trainer holds a second. A seat keeping its person keeps their link, and a seat emptied or
    handed on loses the one it held and its links on the team's open match confirmations, so the person who left it
    holds nothing live. A save newly seating an address the ban list holds is
    refused `kontakt_seat_barred`, as the re-send to one is. On a row of a `past` season, or of a team that has left it, the
    link is how its person learns of the entry, and it takes their Widerspruch alone.

    **A seat the same person keeps keeps its record whole**, each choice and its evidence included; a seat newly filled
    or handed to another person is born granting nothing, its media consent off and no choice evidenced, since only a
    person's own write grants one.
    """

    db_filter = {"team_id": team_id, "saison_id": saison_id}
    payload = kontakte_data.model_dump(mode="json")
    # Outside the callback, so a retried transaction owes this save's mails once and a second save its own.
    nonce = secrets.token_hex(8)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_barred`).
    governing_saison_id = await ban_list_saison(ban_list)

    async def rewrite_the_block(session: AsyncClientSession) -> FLPatchSaisonTeamKontakteResponse:
        # In session, so everything below composes on what this write lands on. Read outside one, an erasure
        # (`app/api/identity/crud.py :: erase_everything`) committing between the read and the `$set` puts the seat it
        # cleared back, the version it raised being what refuses the save.
        stored = await pull_one_from_db(
            collection=saison_teams_collection,
            db_filter=db_filter,
            projection=["kontakte", "confirmations", "name", "austritt"],
            session=session,
        )

        kontakte = compose_kontakte_herkunft(kontakte=payload["kontakte"], stored=stored.get("kontakte"))

        # A closed row's newcomer too: their link is how they learn of the entry, and it takes their
        # Widerspruch alone.
        owed = links_owed(kontakte=kontakte, stored=stored.get("kontakte"))
        # A ban committing after this read conflicts with the save on the saver's own grant row, which
        # the ban's judgement writes with every other (`pull_the_list_to_judge`), so the retry reads it.
        barred = await barred_addresses(
            ban_list,
            {address for seats in owed for address in seat_addresses(kontakte=kontakte, seats=seats)},
            governing_saison_id=governing_saison_id,
            session=session,
        )
        # Refused, never stored unmailed: that person would learn nothing of the entry. A ban landing
        # after the save is the press's.
        refuse(find_kontakt_seat_barred_refusal(barred=bool(barred)))

        entry = compose_kontakt_bestaetigung(today=today)
        minted = {seat: entry for seats in owed for seat in seats}
        links: list[tuple[OwedMail, FLKontaktMint]] = []
        if owed:
            assert kontakte is not None
            # Read only where a link is owed, and in session as the address is. Unanchored: a rollover
            # committing after this read leaves the mail asking the open row's answer, which the press then
            # refuses.
            saison_raw = await pull_one_from_db(
                collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"], session=session
            )
            zeile = kontakt_zeile_of(saison_status=saison_raw.get("status"), austritt=stored.get("austritt"))
            links = [
                owed_kontakt_link(
                    row=stored,
                    saison_id=saison_id,
                    kontakte=kontakte,
                    seats=seats,
                    deadline=entry["deadline"],
                    zeile=zeile,
                    key=f"{Collection.SAISON_TEAMS}/{stored['_id']}/kontakt/{seats[0]}/{nonce}",
                )
                for seats in owed
            ]

        confirmations = compose_bestaetigungen_nach(
            kontakte=kontakte, stored_kontakte=stored.get("kontakte"), stored_bestaetigungen=stored.get("confirmations"), minted=minted
        )

        updated_raw = await patch_one_in_db(
            collection=saison_teams_collection,
            db_filter=db_filter,
            # The two paths, spelled out rather than dumped wholesale: `gruppe`, `austritt` and
            # `trikot_farbe` belong to the junction PATCH, and a `$set` carrying them would reinstate
            # whatever this caller last read. The version the editor sent is the helper's to check.
            update={"$set": {"kontakte": kontakte, "confirmations": confirmations}},
            expected_version=kontakte_data.version,
            session=session,
            return_document=ReturnDocument.AFTER,
        )
        # Judged on the block read in this transaction.
        await void_moved_seats(
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            voids=[seat_void_of(saison_id=saison_id, team_id=team_id, stored_kontakte=stored.get("kontakte"), kontakte=kontakte)],
            session=session,
        )
        await enqueue_mails(outbox_collection=outbox_collection, session=session, mails=[mail for mail, _ in links], now=germany_now)

        return FLPatchSaisonTeamKontakteResponse(
            saison_id=saison_id,
            team_id=team_id,
            # The AFTER image, not the payload: what the row holds is the claim this echo makes.
            kontakte=updated_raw["kontakte"],
            confirmations=[mint for _, mint in links],
        )

    # `with_transaction`, not a bare `start_transaction`: the callback re-reads the block it judges,
    # so a retry after a write conflict refuses on what the winner left rather than on a stale read.
    async with transaction_session(db) as session:
        return await session.with_transaction(rewrite_the_block)


@router.post(
    f"{by_id('team_id')}/saisons/{{saison_id}}/replace",
    response_model=FLReplaceSaisonTeamResponse,
    summary="Replace a club in a season, keeping its schedule",
)
async def replace_saison_team(
    team_id: CustomRouteObjectId,
    saison_id: str,
    replacement_data: Annotated[FLReplaceSaisonTeamPayload, Body()],
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    bewerbungen_collection: BewerbungenCollection,
    action_log_collection: ActionLogCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLReplaceSaisonTeamResponse:
    """
    Hand this season's junction row, and every fixture on it, to another club.

    Its `team_id`, identity copy, `austritt` and every fixture side move, and the outgoing club's
    live squad rows are retired, in ONE transaction: the schedule survives.
    """

    # Before any read, as the group swap judges its pair: this one is refused whatever the season holds.
    refuse(find_replacement_pair_refusal(team_id=team_id, incoming_team_id=replacement_data.incoming_team_id))

    # Outside the transaction, as the group swap reads it: an unknown season is a 404 about the
    # season rather than about a junction row nobody expected to find in it.
    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])

    async def hand_the_row_over(session: AsyncClientSession) -> FLReplaceSaisonTeamResponse:
        """The whole replacement: judge, rewrite the fixtures, then the row. Everything it decides on is read in-session."""

        # For the 404 and the people leaving with the row, and deliberately NOT a read of the club it
        # names: a replacement repairs a row whose `team_id` resolves to no `teams` document, so nothing
        # here may require one.
        outgoing_raw = await pull_one_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "team_id": team_id},
            projection=[f"kontakte.{slot}.{field}" for slot in KONTAKT_ROLLEN for field in SEAT_FIELDS],
            session=session,
        )
        outgoing, outgoing_names = seated_people(outgoing_raw)

        # The club's accepted application seated them first, and a team's exit deletes its contacts at
        # once, so their seats there go too.
        applications = await aggregate_many_from_db(
            collection=bewerbungen_collection,
            pipeline=build_accepted_application_pipeline(saison_id=saison_id, team_id=team_id),
            session=session,
        )

        saison_raw = await pull_one_from_db(
            collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status", "start_date"], session=session
        )
        # Anchored, so the start and the status this is judged on belong to its write set: `PATCH /saisons/{saison_id}`
        # moves the one and `activate_saison` the other, each writing this document, so either landing under the
        # judgement conflicts and the retry judges the season it left.
        await anchor_in_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)

        # The ONE read of the incoming club, and it earns its place three times over: an id naming
        # nothing 404s here, the row's name is reseeded from it as `post_saison_team` seeds one at
        # entry, and every rewritten fixture side takes the same two values.
        incoming_raw = await pull_a_club_to_enter(teams_collection=teams_collection, team_id=replacement_data.incoming_team_id, session=session)

        incoming_rows = await pull_many_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "team_id": replacement_data.incoming_team_id},
            projection=["_id"],
            session=session,
        )

        # Every phase, because the incoming club inherits the whole schedule, a bracket slot included.
        spiele = await pull_many_from_db(
            collection=spiele_collection,
            db_filter={"saison_id": saison_id, "$or": [{"team1.team_id": team_id}, {"team2.team_id": team_id}]},
            projection=["team1.team_id", "team2.team_id", *TAKEN_PLACE_FIELDS],
            session=session,
        )

        refuse(
            find_replacement_refusal(
                saison_status=str(saison_raw["status"]),
                started=has_started(start_date=str(saison_raw["start_date"]), today=today),
                taken_place=any(has_taken_place(spiel) for spiel in spiele),
                incoming_inactive_since=incoming_raw.get("inactive_since"),
                incoming_already_entered=bool(incoming_rows),
            )
        )

        # The row's identity, reseeded as `post_saison_team` seeds one at entry: every fixture of the season reads its
        # side's name from here. No `tore`: a replacement runs only on fixtures none of which has taken place.
        incoming_side = {
            "team_id": replacement_data.incoming_team_id,
            "name": incoming_raw["name"],
            "shorthand": incoming_raw["shorthand"],
        }

        rewritten = await _rewrite_the_outgoing_clubs_sides(
            spiele=spiele,
            outgoing_team_id=team_id,
            incoming_team_id=replacement_data.incoming_team_id,
            spiele_collection=spiele_collection,
            session=session,
        )

        updated_raw = await patch_one_in_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "team_id": team_id},
            # `austritt` cleared: left standing it marks the INCOMING club withdrawn to
            # `find_eligibility_refusal` and `_may_hold_a_platz`; the exit survives in the logged pre-image. The
            # colour, the contacts and their links leave with the OUTGOING school.
            update={"$set": {**incoming_side, "austritt": None, "trikot_farbe": None, "kontakte": None, "confirmations": None}},
            session=session,
            expected_version=None,
            return_document=ReturnDocument.AFTER,
        )
        # The outgoing club's people, read in this transaction, leave their match links behind.
        await void_moved_seats(
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            voids=[seat_void_of(saison_id=saison_id, team_id=team_id, stored_kontakte=outgoing_raw.get("kontakte"), kontakte=None)],
            session=session,
        )

        # Owed at once, as the exit deletes the contacts. The contacts and their links alone leave the
        # images: the exit record and every earlier state stay.
        await redact_images_in_session(
            action_log_collection=action_log_collection,
            db_filter=build_redaction_filter([(Collection.SAISON_TEAMS, [updated_raw["_id"]])]),
            judge=contact_block_image_edits,
            stamp=log_stamp(germany_now),
            session=session,
        )

        # By address and by name, the application being reached by document:
        # it spells an address the editor corrected on the row the old
        # way. Its other people keep their seats.
        await clear_seats(bewerbungen_collection, applications, outgoing, session, names=outgoing_names)
        await redact_seats_in_documents(
            action_log_collection=action_log_collection,
            documents=[(Collection.BEWERBUNGEN, [application["_id"] for application in applications])],
            identifiers=outgoing,
            links=True,
            stamp=log_stamp(germany_now),
            session=session,
            names=outgoing_names,
        )

        # Ausgetragen, not moved: the players did not transfer, and a row left standing would name a
        # season its club now holds no junction row in -- what `kader_team_not_in_saison` refuses to create.
        # LIVE rows alone, so an earlier exit keeps its own date.
        ausgetragene_squad = await patch_many_in_db(
            collection=saison_spieler_collection,
            db_filter={"saison_id": saison_id, "team_id": team_id, "inactive_since": None},
            update={"$set": {"inactive_since": today}},
            session=session,
        )

        # Built from the AFTER image, so the echo cannot describe a row this write did not land; a
        # stored `gruppe` outside the closed set raises here and aborts the transaction rather than answering.
        return FLReplaceSaisonTeamResponse(
            saison_id=saison_id,
            outgoing_team_id=team_id,
            incoming_team_id=replacement_data.incoming_team_id,
            gruppe=updated_raw["gruppe"],
            trikot_farbe=updated_raw["trikot_farbe"],
            kontakte=updated_raw["kontakte"],
            name=updated_raw["name"],
            shorthand=updated_raw["shorthand"],
            rewritten_spiele=rewritten,
            ausgetragene_kader_rows=ausgetragene_squad.modified_count,
        )

    # One transaction over every write: a row handed over while its fixtures are not leaves the
    # season fielding a club that holds no place in it. `with_transaction` is safe to retry, the
    # callback re-reading everything it judges on.
    async with transaction_session(db) as session:
        return await session.with_transaction(hand_the_row_over)


@router.post(
    f"{by_id('team_id')}/saisons/{{saison_id}}/kontakte/{{seat}}/confirmation/invite",
    response_model=FLKontaktInviteResponse,
    summary="Send one contact seat a fresh confirmation link",
)
async def invite_kontakt(
    team_id: CustomRouteObjectId,
    saison_id: str,
    seat: str,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    outbox_collection: OutboxCollection,
    ban_list: BanListLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLKontaktInviteResponse:
    """
    Owe one contact seat a fresh confirmation link, mailed through the Postausgang in this write's own transaction.

    It replaces the seat's link WHOLE, and its pair's where the Trainer holds both and has not confirmed the other:
    the previous link stops opening anything from this write on, and the deadline restarts from today. The answer names
    the address the mail is owed to, never the link.

    Refused where the season has ended or the team has left it (`kontakt_row_without_saison`), where the seat holds nobody or its
    person has already confirmed it (`kontakt_seat_without_confirmation`), and where its address is on the ban list (`kontakt_seat_barred`).
    404 for a team and season holding no row, and for a path naming no seat.
    """

    db_filter = {"team_id": team_id, "saison_id": saison_id}

    # A 404 rather than a 422, as a malformed path id answers: the segment names no seat any row has.
    rolle = seat_named(seat)
    if rolle is None:
        raise DocumentNotFoundError()

    # Outside the callback, so a retried transaction owes this press's mail once and a second press its own.
    nonce = secrets.token_hex(8)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_barred`).
    governing_saison_id = await ban_list_saison(ban_list)

    async def judge_and_mint(session: AsyncClientSession) -> FLKontaktInviteResponse:
        """Judge the seat, ask the ban, then replace the link and owe its mail, everything judged read in-session for a retry to re-judge."""

        stored = await pull_one_from_db(
            collection=saison_teams_collection,
            db_filter=db_filter,
            projection=["kontakte", "confirmations", "name", "austritt"],
            session=session,
        )
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"], session=session)
        refuse(find_kontakt_zeile_refusal(saison_status=saison_raw.get("status"), austritt=stored.get("austritt")))

        kontakte = stored.get("kontakte")
        refuse(find_kontakt_sitz_refusal(kontakte=kontakte, seat=rolle))
        assert isinstance(kontakte, Mapping)

        seats = seats_one_link_answers(kontakte=kontakte, seat=rolle)
        barred = await barred_addresses(
            ban_list, seat_addresses(kontakte=kontakte, seats=seats), governing_saison_id=governing_saison_id, session=session
        )
        refuse(find_kontakt_seat_barred_refusal(barred=bool(barred)))

        entry = compose_kontakt_bestaetigung(today=today)
        await patch_one_in_db(
            collection=saison_teams_collection,
            db_filter=db_filter,
            update={
                "$set": {
                    "confirmations": compose_bestaetigungen_mit(
                        stored_bestaetigungen=stored.get("confirmations"), minted=dict.fromkeys(seats, entry)
                    )
                }
            },
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )
        # The address read in-session, never one the caller read before this request: a save moving
        # it in between would otherwise send the link to the previous mailbox.
        mail, mint = owed_kontakt_link(
            row=stored,
            saison_id=saison_id,
            kontakte=kontakte,
            seats=seats,
            deadline=entry["deadline"],
            zeile=kontakt_zeile_of(saison_status=saison_raw.get("status"), austritt=stored.get("austritt")),
            key=f"{Collection.SAISON_TEAMS}/{stored['_id']}/resend/{seats[0]}/{nonce}",
        )
        await enqueue_mails(outbox_collection=outbox_collection, session=session, mails=[mail], now=germany_now)

        return FLKontaktInviteResponse(saison_id=saison_id, team_id=team_id, confirmation=mint)

    async with transaction_session(db) as session:
        return await session.with_transaction(judge_and_mint)


@router.post(
    f"{by_id('team_id')}/saisons/{{saison_id}}/invitation",
    response_model=FLInvitationMintResponse,
    status_code=201,
    summary="Mint this team's registration link for a season",
)
async def post_invitation(
    team_id: CustomRouteObjectId,
    saison_id: str,
    invitations_collection: InvitationsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
    created_by: str = Depends(get_actor_email),
    today: str = Depends(get_german_date_str),
) -> FLInvitationMintResponse:
    """
    Mint the link a team's players register through, revoking whatever link that team held for this season.

    **The raw link value is in this answer and in no other, ever**: the row stores an unkeyed SHA-256 of it, so a link nobody copied out of
    this response is lost and the repair is another mint. Mailing the team's link is a separate press
    (`POST /teams/{team_id}/saisons/{saison_id}/invitation/dispatch`), whose mails mint links of their own beside this one.

    The reissue is part of the same transaction, so the previous link stops opening anything the moment this answers, and the team is left
    holding exactly one live invitation. The link carries no date: it expires with the season's registration window, which is judged afresh
    every time somebody opens it, so a window moved after the mint moves this link with it.

    Refused where the season holds no junction row for this team (`invitation_team_not_entered`) and where the season has ended
    (`saison_past`); a `future` season mints, the links being prepared before the window opens. 404 where no season holds that id.

    **A team that has left the season still mints here**, where the season-wide send passes it over: this call names one team an
    administrator is looking at, and a squad row and a contact correction are accepted for such a team too.
    """

    # Outside the callback: `with_transaction` may run it again, and a fresh value per attempt would
    # answer a raw link whose hash is not the one the winning attempt stored.
    raw_token, token_hash = mint_token()

    async def mint_the_link(session: AsyncClientSession) -> Any:
        """Judge the season and the junction, then revoke and mint. Everything judged is read in-session, so a retry re-judges it."""

        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"], session=session)

        # Before the junction: a season that has ended cannot be repaired by entering the team into
        # it, so nobody should be handed the junction's answer to act on first.
        refuse(find_saison_vorbei_refusal(saison_status=str(saison_raw["status"])))

        entered = await saison_teams_collection.count_documents({"saison_id": saison_id, "team_id": team_id}, session=session)
        refuse(find_team_in_saison_refusal(entered=bool(entered)))

        # `patch_many_in_db` where at most one row can match: holding no live invitation is the state
        # every team starts in, and the single-document helper answers that with a 404.
        await patch_many_in_db(
            collection=invitations_collection,
            db_filter=build_live_team_filter(saison_id=saison_id, team_id=team_id),
            update=compose_revocation_update(today=today),
            session=session,
        )

        document = compose_einladung(
            saison_id=saison_id,
            team_id=team_id,
            token_hashes=[token_hash],
            created_by=created_by,
            today=today,
            # Minted for copying: nothing is mailed until the team's own press owes it.
            sent_at=None,
        )
        post_operation = await post_one_to_db(collection=invitations_collection, document=document, session=session)

        return post_operation.inserted_id

    # One transaction over the revoke and the mint: `uniq_invitation_live` refuses the second live row
    # outright, so the two landing apart would leave the mint failing against the team's own old link.
    async with transaction_session(db) as session:
        einladung_id = await session.with_transaction(mint_the_link)

    return FLInvitationMintResponse(
        saison_id=saison_id,
        team_id=team_id,
        invitation_id=einladung_id,
        token=raw_token,
        created_at=today,
        created_by=created_by,
    )


@router.delete(
    f"{by_id('team_id')}/saisons/{{saison_id}}/invitation",
    response_model=FLInvitationWriteResponse,
    summary="Revoke this team's live registration link for a season",
)
async def delete_invitation(
    team_id: CustomRouteObjectId,
    saison_id: str,
    invitations_collection: InvitationsCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLInvitationWriteResponse:
    """
    Stamp this team's live registration link revoked, so it opens nothing from here on.

    The row stays: a delivery event about a message carrying that link still has somewhere to land, and a reissue's history is what says
    which link a bounce was about. 404 where the team holds no live link for the season; a link of a season that has ended stays revocable.
    """

    async def revoke_the_link(session: AsyncClientSession) -> Mapping[str, Any]:
        # The filter is the judgement: `patch_one_in_db` answers a miss with the 404, so no read stands
        # between resolving the live row and stamping it.
        return await patch_one_in_db(
            collection=invitations_collection,
            db_filter=build_live_team_filter(saison_id=saison_id, team_id=team_id),
            update=compose_revocation_update(today=today),
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )

    async with transaction_session(db) as session:
        revoked = await session.with_transaction(revoke_the_link)

    return FLInvitationWriteResponse(saison_id=saison_id, team_id=team_id, invitation_id=revoked["_id"])


@router.post(
    f"{by_id('team_id')}/saisons/{{saison_id}}/invitation/dispatch",
    response_model=FLInvitationMailResponse,
    summary="Mail this team's live registration link to its confirmed contact seats",
)
async def post_invitation_dispatch(
    team_id: CustomRouteObjectId,
    saison_id: str,
    mail_data: Annotated[FLInvitationMailPayload, Body()],
    invitations_collection: InvitationsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLInvitationMailResponse:
    """
    Owe this team's live registration link to every seat of its season row whose own person has confirmed it, one mail each.

    The write mints nothing and revokes nothing: each mail mints a link of its own when it is handed out, so a link copied off the mint
    stays valid beside the mailed ones. `recipient` names who is owed it, one entry per stored address, and is empty where nobody has
    confirmed a seat, which owes nothing. Where it owes anyone, the row's `sent_at` becomes today, the day the season editor shows. Pressed
    twice on one day, the second owes nothing again; a later day's press mails the seats afresh. A barred address is stopped when its mail
    is handed out.

    404 where `invitation_id` is not this team's live invite for the season, a link replaced or withdrawn since the caller read it among
    them, and where the season holds no row for the team.
    """

    async def owe_the_link(session: AsyncClientSession) -> FLInvitationMailResponse:
        # The live row the caller read, never another: the filter is the judgement, and a miss is the 404.
        await pull_one_from_db(
            collection=invitations_collection,
            db_filter={"_id": mail_data.invitation_id, **build_live_team_filter(saison_id=saison_id, team_id=team_id)},
            projection=["_id"],
            session=session,
        )
        row = await pull_one_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "team_id": team_id},
            projection=["name", "kontakte"],
            session=session,
        )
        empfaenger = bestaetigte_empfaenger(kontakte=row.get("kontakte"))
        # Only where a mail is owed: a press reaching nobody sent nothing, and the row keeps the day it last was.
        if empfaenger:
            await patch_one_in_db(
                collection=invitations_collection,
                db_filter={"_id": mail_data.invitation_id},
                update=compose_sent_update(today=today),
                expected_version=None,
                session=session,
                return_document=ReturnDocument.BEFORE,
            )
        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=owed_einladung_mails(
                invitation_id=mail_data.invitation_id,
                team_name=str(row["name"]),
                saison_id=saison_id,
                recipient=empfaenger,
                occasion=f"mail/{today}",
            ),
            now=germany_now,
        )

        return FLInvitationMailResponse(invitation_id=mail_data.invitation_id, recipient=empfaenger)

    async with transaction_session(db) as session:
        return await session.with_transaction(owe_the_link)


@router.get(
    f"{by_id('team_id')}/saisons/{{saison_id}}/invitation",
    response_model=FLInvitationResponse,
    summary="This team's live registration link for a season, and whether it opens anything",
)
async def get_invitation(
    team_id: CustomRouteObjectId,
    saison_id: str,
    invitations_collection: InvitationsCollection,
    saisons_collection: SaisonsCollection,
    outbox_collection: OutboxCollection,
    ban_list: BanListLookup,
    today: str = Depends(get_german_date_str),
) -> FLInvitationResponse:
    """
    What this team's live registration link for the season is, or that it holds none, beside the window deciding what it opens.

    **No hash and no raw value**: the link itself was answered once, by the mint. What is served is who minted it and when, and what became
    of the last mail owed about it — `delivery` null means nobody was ever owed it, which is a state rather than a delivery failure.
    The minter is `null` beside `created_by_barred` where the ban list holds that address, as no barred address is served in plain.

    `running` is the season's registration window judged against today, and false for good once the season has ended; it is the whole of
    the link's expiry. 404 where no season holds that id; a team with no invitation answers `einladung: null` rather than a 404.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["registrierung", "status"])

    # A list read where the answer is one row: a team legitimately holds no live invitation, and
    # `pull_one_from_db` would make that absence a 404.
    live = await pull_many_from_db(
        collection=invitations_collection,
        db_filter=build_live_team_filter(saison_id=saison_id, team_id=team_id),
        limit=1,
        projection=WITHOUT_TOKEN_HASH,
    )

    einladung = await _served_invitation(live[0], ban_list=ban_list, outbox_collection=outbox_collection) if live else None

    return FLInvitationResponse(
        saison_id=saison_id,
        team_id=team_id,
        invitation=einladung,
        running=saison_nimmt_registrierungen_an(saison_status=saison_raw["status"], registrierung=saison_raw.get("registrierung"), today=today),
    )
