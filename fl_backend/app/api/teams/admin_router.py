import asyncio
import secrets
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, status
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aufstellungen.crud import remove_the_seasons_aufstellungen
from app.api.bewerbungen.services import assigned_trikot_farben, seat_named
from app.api.grants.guard import verify_actor_is_admin
from app.api.invitations.crud import invitation_reference, owed_invitation_mails
from app.api.invitations.schemas import (
    FLInvitationMailPayload,
    FLInvitationMailResponse,
    FLInvitationMintResponse,
    FLInvitationRow,
    FLInvitationWriteResponse,
    FLTeamLinkState,
)
from app.api.invitations.services import (
    WITHOUT_TOKEN_HASH,
    build_live_team_filter,
    compose_invitation,
    compose_revocation_update,
    compose_sent_update,
    confirmed_recipients,
    find_invitation_saison_past_refusal,
    find_team_in_saison_refusal,
    plan_invitation_dispatch,
)
from app.api.kontakte.crud import clear_seats
from app.api.kontakte.services import SEAT_FIELDS, build_accepted_application_pipeline, seated_people
from app.api.outbox.crud import state_of, states_of
from app.api.outbox.services import OwedMail, enqueue_mails
from app.api.registrierungen.services import saison_takes_registrierungen
from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import find_saison_past_refusal, has_started
from app.api.spielbestaetigungen.crud import owe_the_austritt_notices_in_session
from app.api.teams.crud import (
    enter_a_club,
    found_a_club,
    pull_a_club_to_enter,
    refuse_a_gruppe_move,
    refuse_a_taken_colour,
    write_the_club,
)
from app.api.teams.schemas import (
    FLAustrittPayload,
    FLKontaktInviteResponse,
    FLKontaktMint,
    FLKontaktSeatPayload,
    FLKontaktSeatResponse,
    FLPatchTeamSaisonPayload,
    FLPatchTeamSaisonResponse,
    FLPostTeamEntryPayload,
    FLPostTeamEntryResponse,
    FLReplaceSaisonTeamPayload,
    FLReplaceSaisonTeamResponse,
    FLTeamEntryClub,
    FLTeamEntryOffer,
    FLTeamMembership,
    FLTeamRecord,
    FLTeamsAdminFilterParams,
    FLTeamsAdminListResponse,
    FLTeamSaisonAdminResponse,
    FLTeamSaisonFacts,
)
from app.api.teams.services import (
    TAKEN_PLACE_FIELDS,
    build_team_saisons_pipeline,
    build_team_spiele_filter,
    compose_confirmations_with,
    compose_kontakt_confirmation,
    compose_kontakte_origin,
    compose_seat_block,
    find_austritt_refusal,
    find_austritt_standing_refusal,
    find_gruppe_move_refusal,
    find_kontakt_row_refusal,
    find_kontakt_seat_refusal,
    find_kontakt_taken_refusal,
    find_replacement_pair_refusal,
    find_replacement_refusal,
    find_retire_refusal,
    gruppe_offer,
    has_taken_place,
    kontakt_row_of,
    links_owed,
    membership_row_ids,
    owed_kontakt_link,
    saison_blocking_retirement,
    seats_one_link_answers,
    teams_admin_rows,
    with_link_state,
)
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import (
    GERMAN_COLLATION,
    VERSION_FIELD,
    aggregate_many_from_db,
    anchor_in_db,
    build_sort,
    composite_version,
    find_stale_save_refusal,
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
    AufstellungenCollection,
    BewerbungenCollection,
    DBClient,
    InvitationsCollection,
    InvitationsReadCollection,
    OutboxCollection,
    OutboxReadCollection,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonsReadCollection,
    SaisonTeamsCollection,
    SaisonTeamsReadCollection,
    SpieleCollection,
    SpieleReadCollection,
    TeamsCollection,
    TeamsReadCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.readonly import ReadCollection
from app.core.recording import record_act
from app.core.routing import by_id
from app.core.security import (
    bind_actor,
    verify_access_admin,
)
from app.core.transactions import transaction_session
from app.shared.schemas.custom import CustomRouteObjectId
from app.shared.schemas.literals import KONTAKT_ROLLEN
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
    outbox_collection: ReadCollection,
    today: str,
) -> list[dict[str, Any]]:
    """The memberships read with each seat's link state composed on."""

    states = await states_of(outbox_collection=outbox_collection, collection=Collection.SAISON_TEAMS, ids=membership_row_ids(teams_raw))

    return with_link_state(teams_raw, today=today, states=states)


# What a write of a seat's person or link reads of the row: what it composes on, and what the mails it owes name.
KONTAKT_WRITE_FIELDS = ["kontakte", "confirmations", "name", "austritt"]


async def write_the_contact_block(
    *,
    stored: Mapping[str, Any],
    proposed: Mapping[str, Any],
    expected_version: int,
    team_id: Any,
    saison_id: str,
    saison_teams_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    # Made outside the caller's callback, so a retried transaction owes this save's mails once and a second save its own.
    nonce: str,
    today: str,
    germany_now: datetime,
    session: AsyncClientSession,
) -> list[FLKontaktMint]:
    """Store a block over `stored`, read in this session, owing each person it newly seats their link; each link owed.

    Each seat keeping its person keeps its record and its link. A seat newly filled or handed on is stored as the league's
    entry, unconfirmed.
    """

    kontakte = compose_kontakte_origin(kontakte=proposed, stored=stored.get("kontakte"))

    # A closed row's newcomer too: their link is how they learn of the entry, and it takes their
    # Widerspruch alone.
    owed = links_owed(kontakte=kontakte, stored=stored.get("kontakte"))

    entry = compose_kontakt_confirmation(today=today)
    minted = {seat: entry for seats in owed for seat in seats}
    links: list[tuple[OwedMail, FLKontaktMint]] = []
    if owed:
        # Read only where a link is owed, and in session as the address is. Unanchored: a rollover
        # committing after this read leaves the mail asking the open row's answer, which the press then
        # refuses.
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"], session=session)
        kontakt_row = kontakt_row_of(saison_status=saison_raw.get("status"), austritt=stored.get("austritt"))
        links = [
            owed_kontakt_link(
                row=stored,
                saison_id=saison_id,
                kontakte=kontakte,
                seats=seats,
                deadline=entry["deadline"],
                kontakt_row=kontakt_row,
                key=f"{Collection.SAISON_TEAMS}/{stored['_id']}/kontakt/{seats[0]}/{nonce}",
            )
            for seats in owed
        ]

    confirmations = compose_confirmations_with(stored_confirmations=stored.get("confirmations"), minted=minted)

    await patch_one_in_db(
        collection=saison_teams_collection,
        db_filter={"team_id": team_id, "saison_id": saison_id},
        # The two paths, spelled out rather than dumped wholesale: `gruppe`, `austritt` and
        # `trikot_farbe` belong to the row's own saves, and a `$set` carrying them would reinstate
        # whatever this caller last read. The version the editor sent is the helper's to check.
        update={"$set": {"kontakte": kontakte, "confirmations": confirmations}},
        expected_version=expected_version,
        session=session,
        return_document=ReturnDocument.BEFORE,
    )
    await enqueue_mails(outbox_collection=outbox_collection, session=session, mails=[mail for mail, _ in links], now=germany_now)
    await record_act(
        collection=saison_teams_collection, action="team.seat_changed", record_id=team_id, label=str(stored["name"]), session=session
    )

    return [mint for _, mint in links]


async def _served_invitation(live: Mapping[str, Any], *, outbox_collection: ReadCollection) -> FLInvitationRow:
    """One live link as a read serves it, with what became of its last mail."""

    state = await state_of(outbox_collection=outbox_collection, reference=invitation_reference(live["_id"]))

    return FLInvitationRow.model_validate({**live, "delivery": state})


# Two static segments, as `GET /saisons/list/admin` has, so the admin tier lists every season-scoped
# resource under one shape. No id route at this prefix ends in `/admin`, so none can shadow this one.
@router.get(
    "/list/admin",
    response_model=FLTeamsAdminListResponse,
    summary="One season's Teams list and what its create dialog offers",
)
async def get_teams_admin(
    teams_collection: TeamsReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    saisons_collection: SaisonsReadCollection,
    filters: FLTeamsAdminFilterParams = Depends(),
) -> FLTeamsAdminListResponse:
    """
    The Teams page in one read: the season's clubs, a `future` season's included, and what entering another offers.

    No base-tier season gate: a club is entered while its season is still planned. Each row counts its seats, its state
    the type of an exit and the day its club left the league. `state=retired` reads past the season's rows to every
    retired club, which is the way back to one. `entry` is every club still in the league holding no row of the season,
    each group with whether it is full, `closed` where the season is not `future`, which the entry refuses, and `taken`
    the colours the season's rows hold. 404 where no season holds that id.
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
                "trikot_farbe",
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
            taken=assigned_trikot_farben(stored=[row.get("trikot_farbe") for row in rows]),
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
    teams_collection: TeamsReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    saisons_collection: SaisonsReadCollection,
    spiele_collection: SpieleReadCollection,
    invitations_collection: InvitationsReadCollection,
    outbox_collection: OutboxReadCollection,
    today: str = Depends(get_german_date_str),
) -> FLTeamSaisonAdminResponse:
    """
    Return what the team editor shows in one read: the club, its row of the season, and what each act of the page meets.

    `version` is what the one save sends. `membership` serves the row with its seats' links, null for
    a club holding no row of the season, a retired one reached through the list's filter; `link` is null with it.
    `gruppen` is each group the season offers with whether it is full, `gruppe_locked` whether a group move is refused
    `entry_gruppe_locked`, `taken_trikot_farben` the colours another row holds, and `retire_blocked_by` the season
    `retire_blocked` refuses over, by each write's own judgement.
    `link` is the live registration link, the window's judgement of it, and why the season's press would pass the team
    over. Read outside a transaction: a write landing under this read is judged by its own write. 404 where no club or no
    season holds that id.
    """

    saison_raw = await pull_one_from_db(
        collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status", "start_date", "rules", "registrierung"]
    )
    teams_raw = await aggregate_many_from_db(collection=teams_collection, pipeline=build_team_saisons_pipeline(team_id))
    if not teams_raw:
        raise DocumentNotFoundError()

    team_raw = teams_raw[0]
    held_saison_ids = [row["saison_id"] for row in team_raw["memberships"]]
    row_raw = next((row for row in team_raw["memberships"] if row["saison_id"] == saison_id), None)

    # Every membership is read for the seasons `retire_blocked` judges; only this season's seats are served.
    served, season_rows, held_saisons, spiele_drawn, live = await asyncio.gather(
        _with_seat_states(
            [{**team_raw, "memberships": [] if row_raw is None else [row_raw]}],
            outbox_collection=outbox_collection,
            today=today,
        ),
        pull_whole_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id},
            what=f"season {saison_id}'s clubs",
            projection=["team_id", "gruppe", "trikot_farbe"],
        ),
        pull_many_from_db(collection=saisons_collection, db_filter={"_id": {"$in": held_saison_ids}}, projection=["status"]),
        spiele_collection.count_documents(build_team_spiele_filter(saison_id=saison_id, team_id=team_id)),
        # A list read where the answer is one row: a team legitimately holds no live invitation, and
        # `pull_one_from_db` would make that absence a 404.
        pull_many_from_db(
            collection=invitations_collection,
            db_filter=build_live_team_filter(saison_id=saison_id, team_id=team_id),
            limit=1,
            projection=WITHOUT_TOKEN_HASH,
        ),
    )

    link = None
    if row_raw is not None:
        registrierung = saison_raw.get("registrierung")
        link = FLTeamLinkState(
            invitation=await _served_invitation(live[0], outbox_collection=outbox_collection) if live else None,
            running=saison_takes_registrierungen(saison_status=saison_raw["status"], registrierung=registrierung),
            paused=registrierung is not None and not registrierung["open"],
            skipped=plan_invitation_dispatch(
                austritt=row_raw.get("austritt"),
                kontakte=row_raw.get("kontakte"),
                invitation_raw=live[0] if live else None,
                resend=False,
            ).skipped,
        )

    memberships = served[0]["memberships"]

    return FLTeamSaisonAdminResponse(
        version=composite_version(team_raw, *([] if row_raw is None else [row_raw])),
        team=FLTeamRecord.model_validate(team_raw),
        saison=FLTeamSaisonFacts(
            id=saison_id,
            status=saison_raw["status"],
            start_date=saison_raw["start_date"],
            begun=has_started(start_date=str(saison_raw["start_date"]), today=today),
            registrierung_end=(saison_raw.get("registrierung") or {}).get("end"),
        ),
        membership=FLTeamMembership.model_validate(memberships[0]) if memberships else None,
        gruppen=gruppe_offer(rules=FLSaisonRules.model_validate(saison_raw["rules"]), gruppen=[row["gruppe"] for row in season_rows]),
        gruppe_locked=find_gruppe_move_refusal(spiele_drawn=spiele_drawn) is not None,
        taken_trikot_farben=assigned_trikot_farben(stored=[row.get("trikot_farbe") for row in season_rows if row["team_id"] != team_id]),
        retire_blocked_by=saison_blocking_retirement(held_saisons),
        link=link,
    )


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
    naming `shorthand`. A retired club is refused `team_retired`, a club the season already holds
    `bewerbung_picked_team_already_entered`, a colour another row holds `trikot_farbe_taken`, naming `trikot_farbe`, and the
    season and the group as an entry is.
    """

    async def found_and_enter(session: AsyncClientSession) -> Any:
        club = entry_data.club
        team_id = (
            club.team_id
            if club.kind == "known"
            else await found_a_club(teams_collection=teams_collection, club=club.team.model_dump(mode="json"), session=session)
        )
        name = await enter_a_club(
            teams_collection=teams_collection,
            saison_teams_collection=saison_teams_collection,
            saisons_collection=saisons_collection,
            team_id=team_id,
            saison_id=saison_id,
            gruppe=entry_data.gruppe,
            trikot_farbe=entry_data.trikot_farbe,
            session=session,
        )
        await record_act(collection=saison_teams_collection, action="team.entered", record_id=team_id, label=name, session=session)

        return team_id

    # One transaction: a refused entry leaves no new club behind it, which the list would then offer as if chosen.
    # `with_transaction` is safe to retry, the callback re-reading everything it judges.
    async with transaction_session(db) as session:
        return FLPostTeamEntryResponse(team_id=await session.with_transaction(found_and_enter))


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

    async def retire_the_club(session: AsyncClientSession) -> None:
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

        retired = await set_inactive_since(collection=teams_collection, db_filter={"_id": team_id}, when=today, session=session)
        if retired is not None:
            await record_act(collection=teams_collection, action="team.retired", record_id=team_id, label=str(retired["name"]), session=session)

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

    async def bring_the_club_back(session: AsyncClientSession) -> None:
        revived = await set_inactive_since(collection=teams_collection, db_filter={"_id": team_id}, when=None, session=session)
        if revived is not None:
            await record_act(
                collection=teams_collection, action="team.reactivated", record_id=team_id, label=str(revived["name"]), session=session
            )

    async with transaction_session(db) as session:
        await session.with_transaction(bring_the_club_back)


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
    `entry_gruppe_full` refuse it, and a colour the save moves onto one another row holds `trikot_farbe_taken`, naming
    `trikot_farbe`. 404 where the club holds no row of the season.
    """

    row_filter = {"team_id": team_id, "saison_id": saison_id}

    async def save_the_club_and_its_row(session: AsyncClientSession) -> FLPatchTeamSaisonResponse:
        """Judge both parts, then write both. Everything judged is read in-session, so a retry re-judges it."""

        team_raw = await pull_one_from_db(collection=teams_collection, db_filter={"_id": team_id}, projection=[VERSION_FIELD], session=session)
        row_raw = await pull_one_from_db(
            collection=saison_teams_collection, db_filter=row_filter, projection=["gruppe", "trikot_farbe", VERSION_FIELD], session=session
        )
        refuse(find_stale_save_refusal(team_raw, row_raw, version=team_data.version))

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

        # Judged only where the save moves it: a colour a row already stores beside another's must not lock the club's
        # other fields, as `find_kader_stufe_refusal` passes a stored Stufe.
        if team_data.trikot_farbe != row_raw.get("trikot_farbe"):
            await refuse_a_taken_colour(
                saison_teams_collection=saison_teams_collection,
                saisons_collection=saisons_collection,
                saison_id=saison_id,
                trikot_farbe=team_data.trikot_farbe,
                own_id=row_raw["_id"],
                session=session,
            )

        stored_team = await write_the_club(
            teams_collection=teams_collection,
            saison_teams_collection=saison_teams_collection,
            saisons_collection=saisons_collection,
            team_id=team_id,
            club=team_data.model_dump(mode="json", exclude={"gruppe", "trikot_farbe", "version"}),
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
        await record_act(collection=teams_collection, action="team.changed", record_id=team_id, label=team_data.name, session=session)

        return FLPatchTeamSaisonResponse(version=composite_version(stored_team, stored_row))

    # One transaction, or a refusal of the row's part leaves the club's half saved under an editor reading it as failed.
    # `with_transaction` is safe to retry, every write deriving from the payload and an in-session read.
    async with transaction_session(db) as session:
        return await session.with_transaction(save_the_club_and_its_row)


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
    spiele_collection: SpieleCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> None:
    """
    Record how a team left the season, once: an exit is never lifted and never replaced.

    Refused `version_stale` on a row whose exit stands, whatever the write carries, the page having been read before it;
    `saison_past` on a finished season; and `austritt_before_saison_start` until the season's start date, its `earliest`
    the start: before it, the replacement takes a club out. 404 where the team holds no row of the season.
    """

    row_filter = {"team_id": team_id, "saison_id": saison_id}
    proposed = austritt_data.model_dump(mode="json")

    async def record_the_exit(session: AsyncClientSession) -> None:
        stored = await pull_one_from_db(
            collection=saison_teams_collection, db_filter=row_filter, projection=["austritt", "name"], session=session
        )
        # Two presses racing conflict on the row this writes, and the retry reads the exit the first left.
        refuse(find_austritt_standing_refusal(stored=stored.get("austritt")))

        # Anchored, so the status and the start belong to the write set: `activate_saison` and `PATCH /saisons/{saison_id}`
        # write this document, so either landing under the exit conflicts and the retry judges the season it left.
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)
        await anchor_in_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)
        # A finished season's table and podium are read off these rows.
        refuse(find_saison_past_refusal(saison_status=str(saison_raw["status"])))

        start_date = str(saison_raw["start_date"])
        refuse(find_austritt_refusal(start_date=start_date, started=has_started(start_date=start_date, today=today)))

        await patch_one_in_db(
            collection=saison_teams_collection,
            db_filter=row_filter,
            update={"$set": {"austritt": proposed}},
            expected_version=None,
            session=session,
            return_document=ReturnDocument.BEFORE,
        )
        await record_act(
            collection=saison_teams_collection, action="team.austritt_entered", record_id=team_id, label=str(stored["name"]), session=session
        )
        await owe_the_austritt_notices_in_session(
            spiele_collection=spiele_collection,
            saison_teams_collection=saison_teams_collection,
            outbox_collection=outbox_collection,
            saison_id=saison_id,
            team_id=team_id,
            exit_day=austritt_data.date,
            now=germany_now,
            session=session,
        )

    # One transaction: what the exit owes commits with it or neither does.
    async with transaction_session(db) as session:
        await session.with_transaction(record_the_exit)


@router.put(
    f"{by_id('team_id')}/saisons/{{saison_id}}/kontakte/{{seat}}",
    response_model=FLKontaktSeatResponse,
    summary="Write the person one contact seat holds",
)
async def put_kontakt_seat(
    team_id: CustomRouteObjectId,
    saison_id: str,
    seat: str,
    seat_data: Annotated[FLKontaktSeatPayload, Body()],
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLKontaktSeatResponse:
    """
    „Sitz bearbeiten“: write the person into one seat, judged by the seat's state, on the row's `version`.

    The same person, the address and name folded, keeps the seat's record and link, so a corrected number mails nobody and
    `email` answers null. Anyone else takes the seat unconfirmed, a confirmed person giving way, and is owed a fresh link
    in this write's own transaction, the answer naming the address; an emptied seat is filled the same way. The seat's
    last holder answers the team's match confirmations no more. A `past` season's seats and a departed team's
    stay correctable, and such a link takes the person's Widerspruch alone.

    Where the Trainer holds a second seat, a write on either seat writes both, under one link. `trainer_is_also` is read
    on the Trainer's seat alone: sent, it replaces the claim, and the seat it names takes this person; null ends the
    claim, and the seat it named keeps its person. Left out, the claim stands.

    Refused `version_stale` on a row moved since the read, and `kontakt_email_taken` and `kontakt_phone_taken` where another
    seat's person holds the address or the number. 404 for a team and season holding no row, and for a path naming no seat.
    """

    # A 404 rather than a 422, as a malformed path id answers: the segment names no seat any row has.
    rolle = seat_named(seat)
    if rolle is None:
        raise DocumentNotFoundError()

    # Unset fields left out, so an omitted claim stands rather than reading as the null that ends it.
    sent = seat_data.model_dump(mode="json", exclude={"version"}, exclude_unset=True)
    # Outside the callback, so a retried transaction owes this save's mail once and a second save its own.
    nonce = secrets.token_hex(8)

    async def seat_the_person(session: AsyncClientSession) -> FLKontaktSeatResponse:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it."""

        stored = await pull_one_from_db(
            collection=saison_teams_collection,
            db_filter={"team_id": team_id, "saison_id": saison_id},
            projection=KONTAKT_WRITE_FIELDS,
            session=session,
        )
        kontakte, seats = compose_seat_block(stored=stored.get("kontakte"), seat=rolle, sent=sent, today=today)
        refuse(find_kontakt_taken_refusal(kontakte=kontakte, seats=seats))

        confirmations = await write_the_contact_block(
            stored=stored,
            proposed=kontakte,
            expected_version=seat_data.version,
            team_id=team_id,
            saison_id=saison_id,
            saison_teams_collection=saison_teams_collection,
            saisons_collection=saisons_collection,
            outbox_collection=outbox_collection,
            nonce=nonce,
            today=today,
            germany_now=germany_now,
            session=session,
        )

        # One person, so one link at most.
        return FLKontaktSeatResponse(email=confirmations[0].email if confirmations else None)

    async with transaction_session(db) as session:
        return await session.with_transaction(seat_the_person)


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
    aufstellungen_collection: AufstellungenCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLReplaceSaisonTeamResponse:
    """
    Hand this season's junction row, and every fixture on it, to another club.

    Its `team_id`, identity copy and every fixture side move, its `austritt`, colour, contacts and
    their links are cleared, and the outgoing club's live squad rows are retired, in ONE transaction:
    the schedule survives.
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
        # nothing 404s here, the row's name is reseeded from it as `enter_a_club` seeds one at
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

        # The row's identity, reseeded as `enter_a_club` seeds one at entry: every fixture of the season reads its
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
            # `find_eligibility_refusal` and `_may_hold_a_platz`. The colour, the contacts and their links
            # leave with the OUTGOING school.
            update={"$set": {**incoming_side, "austritt": None, "trikot_farbe": None, "kontakte": None, "confirmations": None}},
            session=session,
            expected_version=None,
            return_document=ReturnDocument.AFTER,
        )
        # By address and by name, the application being reached by document:
        # it spells an address the editor corrected on the row the old
        # way. Its other people keep their seats.
        await clear_seats(bewerbungen_collection, applications, outgoing, session, names=outgoing_names)

        # Ausgetragen, not moved: the players did not transfer, and a row left standing would name a
        # season its club now holds no junction row in -- what `kader_team_not_in_saison` refuses to create.
        # LIVE rows alone, so an earlier exit keeps its own date.
        retired_squad = await patch_many_in_db(
            collection=saison_spieler_collection,
            db_filter={"saison_id": saison_id, "team_id": team_id, "inactive_since": None},
            update={"$set": {"inactive_since": today}},
            session=session,
        )
        # The outgoing club's line-ups go with its place: each names pupils of a squad the fixture no longer fields.
        await remove_the_seasons_aufstellungen(
            aufstellungen_collection=aufstellungen_collection, saison_id=saison_id, team_id=team_id, session=session
        )
        await record_act(
            collection=saison_teams_collection, action="team.replaced", record_id=team_id, label=str(updated_raw["name"]), session=session
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
            retired_kader_rows=retired_squad.modified_count,
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
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLKontaktInviteResponse:
    """
    Owe one contact seat a fresh confirmation link, mailed through the Postausgang in this write's own transaction.

    It replaces the seat's link WHOLE, and its pair's where the Trainer holds both and has not confirmed the other:
    the previous link stops opening anything from this write on, and the deadline restarts from today. The answer names
    the address the mail is owed to, never the link.

    Refused where the season has ended or the team has left it (`kontakt_row_without_saison`), and where the seat holds nobody or its
    person has already confirmed it (`kontakt_seat_without_confirmation`).
    404 for a team and season holding no row, and for a path naming no seat.
    """

    db_filter = {"team_id": team_id, "saison_id": saison_id}

    # A 404 rather than a 422, as a malformed path id answers: the segment names no seat any row has.
    rolle = seat_named(seat)
    if rolle is None:
        raise DocumentNotFoundError()

    # Outside the callback, so a retried transaction owes this press's mail once and a second press its own.
    nonce = secrets.token_hex(8)

    async def judge_and_mint(session: AsyncClientSession) -> FLKontaktInviteResponse:
        """Judge the seat, then replace the link and owe its mail, everything judged read in-session for a retry to re-judge."""

        stored = await pull_one_from_db(
            collection=saison_teams_collection,
            db_filter=db_filter,
            projection=KONTAKT_WRITE_FIELDS,
            session=session,
        )
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"], session=session)
        refuse(find_kontakt_row_refusal(saison_status=saison_raw.get("status"), austritt=stored.get("austritt")))

        kontakte = stored.get("kontakte")
        refuse(find_kontakt_seat_refusal(kontakte=kontakte, seat=rolle))
        assert isinstance(kontakte, Mapping)

        seats = seats_one_link_answers(kontakte=kontakte, seat=rolle)

        entry = compose_kontakt_confirmation(today=today)
        await patch_one_in_db(
            collection=saison_teams_collection,
            db_filter=db_filter,
            update={
                "$set": {
                    "confirmations": compose_confirmations_with(
                        stored_confirmations=stored.get("confirmations"), minted=dict.fromkeys(seats, entry)
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
            kontakt_row=kontakt_row_of(saison_status=saison_raw.get("status"), austritt=stored.get("austritt")),
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

    A row whose exit stands is refused `version_stale`, the page offering this press having been read before the exit: its team's link
    opens nothing, whoever holds it.
    """

    # Outside the callback: `with_transaction` may run it again, and a fresh value per attempt would
    # answer a raw link whose hash is not the one the winning attempt stored.
    raw_token, token_hash = mint_token()

    async def mint_the_link(session: AsyncClientSession) -> Any:
        """Judge the season and the junction, then revoke and mint. Everything judged is read in-session, so a retry re-judges it."""

        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"], session=session)

        # Before the junction: a season that has ended cannot be repaired by entering the team into
        # it, so nobody should be handed the junction's answer to act on first.
        refuse(find_invitation_saison_past_refusal(saison_status=str(saison_raw["status"])))

        row = await saison_teams_collection.find_one({"saison_id": saison_id, "team_id": team_id}, {"austritt": 1, "name": 1}, session=session)
        refuse(find_team_in_saison_refusal(entered=row is not None))
        assert row is not None
        refuse(find_austritt_standing_refusal(stored=row.get("austritt")))

        # `patch_many_in_db` where at most one row can match: holding no live invitation is the state
        # every team starts in, and the single-document helper answers that with a 404.
        await patch_many_in_db(
            collection=invitations_collection,
            db_filter=build_live_team_filter(saison_id=saison_id, team_id=team_id),
            update=compose_revocation_update(today=today),
            session=session,
        )

        document = compose_invitation(
            saison_id=saison_id,
            team_id=team_id,
            token_hashes=[token_hash],
            today=today,
            # Minted for copying: nothing is mailed until the team's own press owes it.
            sent_at=None,
        )
        post_operation = await post_one_to_db(collection=invitations_collection, document=document, session=session)
        await record_act(
            collection=invitations_collection, action="team.invitation_created", record_id=team_id, label=str(row["name"]), session=session
        )

        return post_operation.inserted_id

    # One transaction over the revoke and the mint: `uniq_invitation_live` refuses the second live row
    # outright, so the two landing apart would leave the mint failing against the team's own old link.
    async with transaction_session(db) as session:
        invitation_id = await session.with_transaction(mint_the_link)

    return FLInvitationMintResponse(
        saison_id=saison_id,
        team_id=team_id,
        invitation_id=invitation_id,
        token=raw_token,
        created_at=today,
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
    teams_collection: TeamsCollection,
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
        before = await patch_one_in_db(
            collection=invitations_collection,
            db_filter=build_live_team_filter(saison_id=saison_id, team_id=team_id),
            update=compose_revocation_update(today=today),
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )
        # The club's own document: a season's junction row can be handed to another club, and the link stays revocable.
        club = await pull_one_from_db(collection=teams_collection, db_filter={"_id": team_id}, projection=["name"], session=session)
        await record_act(
            collection=invitations_collection, action="team.invitation_withdrawn", record_id=team_id, label=str(club["name"]), session=session
        )

        return before

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
    saisons_collection: SaisonsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLInvitationMailResponse:
    """
    Owe this team's live registration link to every seat of its season row whose own person has confirmed it, one mail each.

    The write mints nothing and revokes nothing: each mail mints a link of its own when it is handed out, so a link copied off the mint
    stays valid beside the mailed ones. `mailed` counts who is owed it, one per stored address, and is 0 where nobody has confirmed a
    seat, which owes nothing. Where it owes anyone, the row's `sent_at` becomes today, the day the season editor shows. Pressed
    twice on one day, the second owes nothing again; a later day's press mails the seats afresh. A barred address is stopped when its mail
    is handed out.

    Refused where the season has ended (`saison_past`), as the mint and the season's press are: its link opens nothing for good. A
    window shut for now is no refusal, the link opening once the season takes registrations, and past the window's end it opens on
    as a Nachnominierung. 404 where `invitation_id` is not this team's live invite for the season, a link replaced or withdrawn since
    the caller read it among them, and where the season holds no row for the team. A row whose exit stands is refused `version_stale`,
    as the mint refuses it.
    """

    async def owe_the_link(session: AsyncClientSession) -> FLInvitationMailResponse:
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"], session=session)
        # First, as the mint judges it: nothing done to the team's link or row repairs a season that has ended.
        refuse(find_invitation_saison_past_refusal(saison_status=str(saison_raw["status"])))

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
            projection=["name", "kontakte", "austritt"],
            session=session,
        )
        refuse(find_austritt_standing_refusal(stored=row.get("austritt")))
        recipients = confirmed_recipients(kontakte=row.get("kontakte"))
        # Only where a mail is owed: a press reaching nobody sent nothing, and the row keeps the day it last was.
        if recipients:
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
            mails=owed_invitation_mails(
                invitation_id=mail_data.invitation_id,
                team_id=team_id,
                team_name=str(row["name"]),
                saison_id=saison_id,
                recipient=recipients,
                occasion=f"mail/{today}",
            ),
            now=germany_now,
        )

        return FLInvitationMailResponse(mailed=len(recipients))

    async with transaction_session(db) as session:
        return await session.with_transaction(owe_the_link)
