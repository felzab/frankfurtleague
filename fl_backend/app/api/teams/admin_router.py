import secrets
from collections.abc import Mapping, Sequence
from datetime import datetime
from http import HTTPStatus
from typing import Annotated, Any

from fastapi import APIRouter, Query, Response, status
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aufstellungen.crud import remove_the_seasons_aufstellungen
from app.api.bewerbungen.services import assigned_trikot_farben, seat_named
from app.api.grants.guard import ADMIN_TIER
from app.api.invitations.schemas import (
    FLInvitation,
    FLInvitationMailPayload,
    FLInvitationMailResponse,
    FLInvitationMintResponse,
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
    owed_invitation_mails,
    plan_invitation_mail,
)
from app.api.outbox.crud import states_of
from app.api.outbox.services import OwedMail, enqueue_mails
from app.api.registrierungen.services import saison_takes_registrierungen
from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import find_saison_past_refusal, has_started
from app.api.spielbestaetigungen.crud import owe_the_austritt_notices_in_session, pull_austritt_recipients
from app.api.teams.crud import (
    enter_a_team,
    find_taken_colour_refusal,
    find_taken_shorthand_refusal,
    pull_a_team_to_enter,
    refuse_a_gruppe_move,
    write_the_team,
)
from app.api.teams.panel import FLAustrittRecipients, FLTeamSaisonAdminResponse
from app.api.teams.schemas import (
    FLAustrittPayload,
    FLKontaktMint,
    FLKontaktSeatPayload,
    FLKontaktSeatResponse,
    FLPatchTeamSaisonPayload,
    FLPostTeamEntryPayload,
    FLReplaceSaisonTeamPayload,
    FLTeamEntryOffer,
    FLTeamEntryTeam,
    FLTeamMembership,
    FLTeamRecord,
    FLTeamsAdminFilterParams,
    FLTeamsAdminListResponse,
    FLTeamSaisonFacts,
)
from app.api.teams.services import (
    build_membership_pipeline,
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
    kontakt_row_of,
    links_owed,
    owed_kontakt_link,
    saison_blocking_retirement,
    seats_one_link_answers,
    teams_admin_rows,
    with_link_state,
)
from app.core.codes import Code
from app.core.collections import Collection
from app.core.concurrency import concurrently
from app.core.crud import (
    GERMAN_COLLATION,
    VERSION_FIELD,
    aggregate_many_from_db,
    anchor_in_db,
    composite_version,
    find_stale_save_refusal,
    patch_many_in_db,
    patch_one_in_db,
    post_one_to_db,
    pull_many_from_db,
    pull_one_from_db,
    pull_whole_from_db,
    refuse,
    refuse_faults,
    set_inactive_since,
)
from app.core.dependencies import (
    AufstellungenCollection,
    DBClient,
    GermanDay,
    GermanyNow,
    InvitationsCollection,
    InvitationsReadCollection,
    OutboxCollection,
    OutboxReadCollection,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonsReadCollection,
    SaisonTeamsCollection,
    SaisonTeamsReadCollection,
    SchiedsrichterReadCollection,
    SnapshotSession,
    SpielbestaetigungenReadCollection,
    SpieleCollection,
    SpieleReadCollection,
    TeamsCollection,
    TeamsReadCollection,
)
from app.core.exceptions import APIError, DocumentNotFoundError
from app.core.readonly import ReadCollection
from app.core.recording import record_act
from app.core.routing import DRY_RUN_PASSED, SAFE_WHEN, DryRun, by_id, dry_run_passed
from app.core.transactions import transact
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.responses import FLVersionResponse
from app.shared.tokens import mint_token

router = APIRouter(
    prefix="/teams",
    dependencies=ADMIN_TIER,
)


async def _rewrite_the_outgoing_teams_sides(
    *,
    spiele: Sequence[Mapping[str, Any]],
    outgoing_team_id: Any,
    incoming_team_id: Any,
    spiele_collection: AsyncCollection,
    session: AsyncClientSession,
) -> None:
    """Hand this club's sides to the incoming one by its `team_id` alone.

    Every read joins a side's name from its season row, so no name is written here. Named by `_id` off a snapshot
    taken before any write.
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


async def _membership_of(row_raw: Mapping[str, Any] | None, *, outbox_collection: ReadCollection, today: str) -> FLTeamMembership | None:
    """The membership read with each seat's link state composed on; `None` for a club holding no row of the season."""

    if row_raw is None:
        return None

    states = await states_of(outbox_collection=outbox_collection, collection=Collection.SAISON_TEAMS, ids=[row_raw["_id"]])

    return FLTeamMembership.model_validate(with_link_state(row_raw, today=today, states=states))


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


@router.get(
    "",
    summary="One season's Teams list and what its create dialog offers",
)
async def get_teams_admin(
    teams_collection: TeamsReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    saisons_collection: SaisonsReadCollection,
    filters: Annotated[FLTeamsAdminFilterParams, Query()],
) -> FLTeamsAdminListResponse:
    """One season's clubs, a `future` season's included, each with its state, and what entering another offers.

    `state=retired` reads past the season's rows to every retired club, which is the way back to one, and `entry.closed`
    is true where the season, not being `future`, takes no entry.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": filters.saison_id}, projection=["status", "rules"])
    rows, teams = await concurrently(
        # Each whole, as the group's fill is judged over every row.
        pull_whole_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": filters.saison_id},
            projection=["team_id", "name", "shorthand", "gruppe", "trikot_farbe", "austritt.type"],
            sort_by=[("name", 1)],
            collation=GERMAN_COLLATION,
        ),
        pull_whole_from_db(
            collection=teams_collection,
            db_filter={},
            projection=["name", "shorthand", "inactive_since"],
            sort_by=[("name", 1)],
            collation=GERMAN_COLLATION,
        ),
    )
    entered = {row["team_id"] for row in rows}

    return FLTeamsAdminListResponse(
        teams=teams_admin_rows(rows=rows, teams=teams, state=filters.state, gruppe=filters.gruppe),
        entry=FLTeamEntryOffer(
            teams=[FLTeamEntryTeam.model_validate(team) for team in teams if team["_id"] not in entered and team.get("inactive_since") is None],
            gruppen=gruppe_offer(rules=FLSaisonRules.model_validate(saison_raw["rules"]), gruppen=[row["gruppe"] for row in rows]),
            closed=saison_raw["status"] != "future",
            taken=assigned_trikot_farben(stored=[row.get("trikot_farbe") for row in rows]),
        ),
    )


@router.get(
    f"{by_id('team_id')}/saisons/{{saison_id}}",
    summary="One team in one season for the admin editor",
)
async def get_team_saison_admin(
    team_id: CustomObjectId,
    saison_id: str,
    teams_collection: TeamsReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    saisons_collection: SaisonsReadCollection,
    spiele_collection: SpieleReadCollection,
    invitations_collection: InvitationsReadCollection,
    outbox_collection: OutboxReadCollection,
    spielbestaetigungen_collection: SpielbestaetigungenReadCollection,
    schiedsrichter_collection: SchiedsrichterReadCollection,
    session: SnapshotSession,
    today: GermanDay,
    germany_now: GermanyNow,
) -> FLTeamSaisonAdminResponse:
    """What the team editor shows in one read: the club, its row of the season, and what each act of the page would meet.

    `version` is what the one save sends, each flag is judged as its write judges it, and `membership` and `link` are
    null for a club holding no row of the season.
    """

    # Outside a transaction: a write landing under this read is judged by its own write.
    saison_raw = await pull_one_from_db(
        collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status", "start_date", "rules", "registrierung"]
    )
    team_raw, rows_raw, held_saison_ids = await concurrently(
        pull_one_from_db(collection=teams_collection, db_filter={"_id": team_id}),
        aggregate_many_from_db(collection=saison_teams_collection, pipeline=build_membership_pipeline(saison_id=saison_id, team_id=team_id)),
        # The seasons `retire_blocked` judges, by id alone: only this season's row is served.
        saison_teams_collection.distinct("saison_id", {"team_id": team_id}),
    )
    row_raw = rows_raw[0] if rows_raw else None

    membership, junctions, held_saisons, drawn_spiel, live = await concurrently(
        _membership_of(row_raw, outbox_collection=outbox_collection, today=today),
        pull_whole_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id},
            # The seats, exits and names too, which judge and name whom an exit would mail.
            projection=["team_id", "gruppe", "trikot_farbe", "name", "kontakte", "austritt"],
        ),
        pull_whole_from_db(collection=saisons_collection, db_filter={"_id": {"$in": held_saison_ids}}, projection=["status"]),
        spiele_collection.find_one(build_team_spiele_filter(saison_id=saison_id, team_id=team_id), {"_id": 1}),
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
            invitation=FLInvitation.model_validate(live[0]) if live else None,
            running=saison_takes_registrierungen(saison_status=saison_raw["status"], registrierung=registrierung),
            paused=registrierung is not None and not registrierung["open"],
            skipped=plan_invitation_mail(
                austritt=row_raw.get("austritt"),
                kontakte=row_raw.get("kontakte"),
                invitation_raw=live[0] if live else None,
            ).skipped,
        )

    austritt_recipients = (
        []
        if row_raw is None or row_raw.get("austritt") is not None
        else await pull_austritt_recipients(
            spiele_collection=spiele_collection,
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            saison_id=saison_id,
            team_id=team_id,
            start_date=str(saison_raw["start_date"]),
            junctions={row["team_id"]: row for row in junctions},
            now=germany_now,
            session=session,
        )
    )

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
        membership=membership,
        gruppen=gruppe_offer(rules=FLSaisonRules.model_validate(saison_raw["rules"]), gruppen=[row["gruppe"] for row in junctions]),
        gruppe_locked=find_gruppe_move_refusal(drawn=drawn_spiel is not None) is not None,
        taken_trikot_farben=assigned_trikot_farben(stored=[row.get("trikot_farbe") for row in junctions if row["team_id"] != team_id]),
        retire_blocked_by=saison_blocking_retirement(held_saisons),
        link=link,
        austritt_recipients=[FLAustrittRecipients(date=day, recipients=recipients) for day, recipients in austritt_recipients],
    )


@router.post(
    "/saisons/{saison_id}/entry",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Enter a club into a season, one the league holds or a new one",
)
async def post_team_entry(
    saison_id: str,
    entry_data: FLPostTeamEntryPayload,
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
) -> None:
    """Enter a club into a `future` season in a group and a colour, founding it first where it is new.

    A club's `shorthand` is unique across every club, retired ones included, and a colour across the season's rows.
    """

    async def found_and_enter(session: AsyncClientSession) -> None:
        picked = entry_data.team
        team_id, name = await enter_a_team(
            teams_collection=teams_collection,
            saison_teams_collection=saison_teams_collection,
            saisons_collection=saisons_collection,
            team_id=picked.team_id if picked.kind == "known" else None,
            new_team=None if picked.kind == "known" else picked.team.model_dump(mode="json"),
            saison_id=saison_id,
            gruppe=entry_data.gruppe,
            trikot_farbe=entry_data.trikot_farbe,
            session=session,
        )
        await record_act(collection=saison_teams_collection, action="team.entered", record_id=team_id, label=name, session=session)

    # One transaction: a refused entry leaves no new club behind it, which the list would then offer as if chosen.
    await transact(db, found_and_enter)


@router.delete(
    by_id("team_id"),
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Retire a team (soft delete)",
)
async def delete_team(
    team_id: CustomObjectId,
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
    today: GermanDay,
) -> None:
    """Retire a club from the league, its rows of the seasons it played left as they are.

    Refused while the club is entered in an `active` or `future` season.
    """

    async def retire_the_team(session: AsyncClientSession) -> None:
        # Two small reads rather than a lookup: a club holds a handful of rows, the league a few seasons.
        junction_rows = await pull_whole_from_db(
            collection=saison_teams_collection,
            db_filter={"team_id": team_id},
            projection=["saison_id"],
            session=session,
        )
        saison_ids = [row["saison_id"] for row in junction_rows]
        saison_rows = await pull_whole_from_db(
            collection=saisons_collection,
            db_filter={"_id": {"$in": saison_ids}},
            projection=["status"],
            session=session,
        )

        refuse(find_retire_refusal(str(row["status"]) for row in saison_rows))

        retired = await set_inactive_since(collection=teams_collection, db_filter={"_id": team_id}, when=today, session=session)
        if retired is not None:
            await record_act(collection=teams_collection, action="team.retired", record_id=team_id, label=str(retired["name"]), session=session)

    # Soft, since the seasons it played still happened. The stamp inside the judgement's transaction: an entry writes
    # nothing read here, so the club it anchors (`pull_a_team_to_enter`) is the one document the two conflict on.
    await transact(db, retire_the_team)


@router.post(
    f"{by_id('team_id')}/reactivate",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Bring a retired team back",
)
async def reactivate_team(
    team_id: CustomObjectId,
    teams_collection: TeamsCollection,
    db: DBClient,
) -> None:
    """Clear `inactive_since`, restoring a retired club to reads that hide retired ones."""

    async def bring_the_team_back(session: AsyncClientSession) -> None:
        revived = await set_inactive_since(collection=teams_collection, db_filter={"_id": team_id}, when=None, session=session)
        if revived is not None:
            await record_act(
                collection=teams_collection, action="team.reactivated", record_id=team_id, label=str(revived["name"]), session=session
            )

    await transact(db, bring_the_team_back)


@router.patch(
    f"{by_id('team_id')}/saisons/{{saison_id}}",
    summary="Save the team editor: the club and its row of the season, in one transaction",
)
async def patch_team_saison(
    team_id: CustomObjectId,
    saison_id: str,
    team_data: FLPatchTeamSaisonPayload,
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    db: DBClient,
) -> FLVersionResponse:
    """Save the team editor's one version: the club, its name on its unfinished seasons' rows, and this season's group and colour.

    A `past` season keeps the club's fields open and fixes the row's group and colour, and a group move and a colour
    are judged as an entry's.
    """

    row_filter = {"team_id": team_id, "saison_id": saison_id}

    async def save_the_team_and_its_row(session: AsyncClientSession) -> FLVersionResponse:
        team_raw = await pull_one_from_db(collection=teams_collection, db_filter={"_id": team_id}, projection=[VERSION_FIELD], session=session)
        row_raw = await pull_one_from_db(
            collection=saison_teams_collection, db_filter=row_filter, projection=["gruppe", "trikot_farbe", VERSION_FIELD], session=session
        )
        refuse(find_stale_save_refusal(team_raw, row_raw, version=team_data.version))

        # Unanchored here: `write_the_team` below anchors every season it reads as open on every save, this one among them
        # while it is not `past`, and `activate_saison` writes this document, so a rollover landing under the save
        # conflicts and the retry reads `past`.
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)

        row_part = {"gruppe": team_data.gruppe, "trikot_farbe": team_data.trikot_farbe}
        moves_the_row = any(row_raw.get(field) != value for field, value in row_part.items())
        # Judged per part: a finished season's table and podium are read off its rows, so only a save moving the row is
        # refused there.
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

        refuse_faults(
            # Judged only where the save moves it: a colour a row already stores beside another's must not lock the
            # club's other fields.
            await find_taken_colour_refusal(
                saison_teams_collection=saison_teams_collection,
                saison_id=saison_id,
                trikot_farbe=team_data.trikot_farbe,
                own_id=row_raw["_id"],
                session=session,
            )
            if team_data.trikot_farbe != row_raw.get("trikot_farbe")
            else None,
            await find_taken_shorthand_refusal(
                teams_collection=teams_collection, shorthand=team_data.shorthand, own_id=team_id, session=session
            ),
        )

        stored_team = await write_the_team(
            teams_collection=teams_collection,
            saison_teams_collection=saison_teams_collection,
            saisons_collection=saisons_collection,
            team_id=team_id,
            team=team_data.model_dump(mode="json", exclude={"gruppe", "trikot_farbe", "version"}),
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

        return FLVersionResponse(version=composite_version(stored_team, stored_row))

    # One transaction, or a refusal of the row's part leaves the club's half saved under an editor reading it as failed.
    return await transact(db, save_the_team_and_its_row)


@router.put(
    f"{by_id('team_id')}/saisons/{{saison_id}}/austritt",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Record a team's exit from a season",
)
async def put_austritt(
    team_id: CustomObjectId,
    saison_id: str,
    austritt_data: FLAustrittPayload,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: GermanDay,
    germany_now: GermanyNow,
) -> None:
    """Record how a team left the season, once: an exit is never lifted and never replaced.

    An exit is taken from the season's start date on, before which the replacement takes a club out, and never on a
    finished season.
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
        refuse_faults(find_austritt_refusal(start_date=start_date, started=has_started(start_date=start_date, today=today)))

        # Every fixture of the season, not only the club's: a save judges this row's exit on a read it never writes, and
        # writes the fixture it saves, which may be one fielding the club only once it lands. So any save judging under
        # this exit conflicts with it, and its retry is judged against the exit. The exit is rare, a retried save cheap.
        await anchor_in_db(collection=spiele_collection, db_filter={"saison_id": saison_id}, session=session)

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
    await transact(db, record_the_exit)


@router.put(
    f"{by_id('team_id')}/saisons/{{saison_id}}/kontakte/{{seat}}",
    summary="Write the person one contact seat holds",
    response_model=FLKontaktSeatResponse,
    openapi_extra=SAFE_WHEN,
    responses=DRY_RUN_PASSED,
)
async def put_kontakt_seat(
    team_id: CustomObjectId,
    saison_id: str,
    seat: str,
    seat_data: FLKontaktSeatPayload,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    session: SnapshotSession,
    today: GermanDay,
    germany_now: GermanyNow,
    dry_run: DryRun = False,
) -> FLKontaktSeatResponse | Response:
    """Write the person one seat holds on the row's `version`, a newly seated person owed a fresh link whose address `email` names.

    The same person, address and name folded, keeps the seat's record and link, and where the Trainer holds a second seat
    a write on either seat writes both under one link. A `dry_run` is refused as the write would be, and answers 204 and
    writes nothing where it would land.
    """

    # A 404 rather than a 422, as a malformed path id answers: the segment names no seat any row has.
    pressed = seat_named(seat)
    if pressed is None:
        raise DocumentNotFoundError()

    # Unset fields left out, so an omitted claim stands rather than reading as the null that ends it.
    sent = seat_data.model_dump(mode="json", exclude={"version"}, exclude_unset=True)
    # Outside the callback, so a retried transaction owes this save's mail once and a second save its own.
    nonce = secrets.token_hex(8)

    async def judge(session: AsyncClientSession) -> tuple[Mapping[str, Any], dict[str, Any]]:
        # Every refusal of the write, in its transaction or the dry run's snapshot alike: the row and the block it stores.
        stored = await pull_one_from_db(
            collection=saison_teams_collection,
            db_filter={"team_id": team_id, "saison_id": saison_id},
            projection=[*KONTAKT_WRITE_FIELDS, VERSION_FIELD],
            session=session,
        )
        # Read as well as filtered on: a dry run patches nothing for the version to refuse, and the patch's filter still
        # refuses a write racing past this read.
        refuse(find_stale_save_refusal(stored, version=seat_data.version))
        kontakte, seats = compose_seat_block(stored=stored.get("kontakte"), seat=pressed, sent=sent, today=today)
        refuse_faults(find_kontakt_taken_refusal(kontakte=kontakte, seats=seats))
        return stored, kontakte

    if dry_run:
        await judge(session)
        return dry_run_passed()

    async def seat_the_person(session: AsyncClientSession) -> FLKontaktSeatResponse:
        stored, kontakte = await judge(session)

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

    return await transact(db, seat_the_person)


@router.post(
    f"{by_id('team_id')}/saisons/{{saison_id}}/replace",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Replace a club in a season, keeping its schedule",
)
async def replace_saison_team(
    team_id: CustomObjectId,
    saison_id: str,
    replacement_data: FLReplaceSaisonTeamPayload,
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    aufstellungen_collection: AufstellungenCollection,
    db: DBClient,
    today: GermanDay,
) -> None:
    """Hand this season's row, and every fixture on it, to another club, keeping the schedule.

    The row's colour, contacts and their links are cleared, and the outgoing club's live squad rows retired.
    """

    # Before any read: this one is refused whatever the season holds.
    refuse(find_replacement_pair_refusal(team_id=team_id, incoming_team_id=replacement_data.incoming_team_id))

    # Outside the transaction: an unknown season is a 404 about the season rather than about a
    # junction row nobody expected to find in it.
    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])

    async def hand_the_row_over(session: AsyncClientSession) -> None:
        # For the 404. The outgoing club's own document is never read: nothing below needs it.
        await pull_one_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "team_id": team_id},
            projection=["_id"],
            session=session,
        )

        saison_raw = await pull_one_from_db(
            collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status", "start_date"], session=session
        )
        # Anchored, so the start and the status this is judged on belong to its write set: `PATCH /saisons/{saison_id}`
        # moves the one and `activate_saison` the other, each writing this document, so either landing under the
        # judgement conflicts and the retry judges the season it left.
        await anchor_in_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)

        # The one read of the incoming club: an id naming nothing 404s here, and the row's name and
        # shorthand are reseeded from it.
        incoming_raw = await pull_a_team_to_enter(teams_collection=teams_collection, team_id=replacement_data.incoming_team_id, session=session)

        incoming_rows = await pull_whole_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "team_id": replacement_data.incoming_team_id},
            projection=["_id"],
            session=session,
        )

        refuse(
            find_replacement_refusal(
                saison_status=str(saison_raw["status"]),
                started=has_started(start_date=str(saison_raw["start_date"]), today=today),
                incoming_inactive_since=incoming_raw.get("inactive_since"),
                incoming_already_entered=bool(incoming_rows),
            )
        )

        # Every phase, because the incoming club inherits the whole schedule, a bracket slot included.
        spiele = await pull_whole_from_db(
            collection=spiele_collection,
            db_filter={"saison_id": saison_id, "$or": [{"team1.team_id": team_id}, {"team2.team_id": team_id}]},
            projection=["team1.team_id", "team2.team_id"],
            session=session,
        )

        # The row's identity, reseeded as at entry: every fixture of the season reads its side's name from
        # here. No `tore`: a replacement runs only before the season's start, when the save refuses a
        # result.
        incoming_side = {
            "team_id": replacement_data.incoming_team_id,
            "name": incoming_raw["name"],
            "shorthand": incoming_raw["shorthand"],
        }

        await _rewrite_the_outgoing_teams_sides(
            spiele=spiele,
            outgoing_team_id=team_id,
            incoming_team_id=replacement_data.incoming_team_id,
            spiele_collection=spiele_collection,
            session=session,
        )

        updated_raw = await patch_one_in_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "team_id": team_id},
            # The colour, the contacts and their links leave with the outgoing school. The row holds no exit to clear: one is
            # recorded only from the season's start, which refuses a replacement.
            update={"$set": {**incoming_side, "trikot_farbe": None, "kontakte": None, "confirmations": None}},
            session=session,
            expected_version=None,
            return_document=ReturnDocument.AFTER,
        )
        # Ausgetragen, not moved: the players did not transfer, and a row left standing would name a
        # season its club now holds no junction row in, a squad row the squad's save refuses to create.
        # Live rows alone, so an earlier exit keeps its own date.
        await patch_many_in_db(
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

    # One transaction over every write: a row handed over while its fixtures are not leaves the
    # season fielding a club that holds no place in it.
    await transact(db, hand_the_row_over)


@router.post(
    f"{by_id('team_id')}/saisons/{{saison_id}}/kontakte/{{seat}}/confirmation/resend",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Send one contact seat a fresh confirmation link",
)
async def resend_kontakt_confirmation(
    team_id: CustomObjectId,
    saison_id: str,
    seat: str,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: GermanDay,
    germany_now: GermanyNow,
) -> None:
    """Owe one contact seat a fresh confirmation link, and its pair where the Trainer holds both and has not confirmed it.

    The previous link opens nothing from this write on, and the deadline restarts from today.
    """

    db_filter = {"team_id": team_id, "saison_id": saison_id}

    # A 404 rather than a 422, as a malformed path id answers: the segment names no seat any row has.
    pressed = seat_named(seat)
    if pressed is None:
        raise DocumentNotFoundError()

    # Outside the callback, so a retried transaction owes this press's mail once and a second press its own.
    nonce = secrets.token_hex(8)

    async def judge_and_mint(session: AsyncClientSession) -> None:
        stored = await pull_one_from_db(
            collection=saison_teams_collection,
            db_filter=db_filter,
            projection=KONTAKT_WRITE_FIELDS,
            session=session,
        )
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"], session=session)
        refuse(find_kontakt_row_refusal(saison_status=saison_raw.get("status"), austritt=stored.get("austritt")))

        kontakte = stored.get("kontakte")
        refuse(find_kontakt_seat_refusal(kontakte=kontakte, seat=pressed))
        # The refusal answered a null block, so this only narrows the type.
        assert kontakte is not None

        seats = seats_one_link_answers(kontakte=kontakte, seat=pressed)

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
        mail, _ = owed_kontakt_link(
            row=stored,
            saison_id=saison_id,
            kontakte=kontakte,
            seats=seats,
            deadline=entry["deadline"],
            kontakt_row=kontakt_row_of(saison_status=saison_raw.get("status"), austritt=stored.get("austritt")),
            key=f"{Collection.SAISON_TEAMS}/{stored['_id']}/resend/{seats[0]}/{nonce}",
        )
        await enqueue_mails(outbox_collection=outbox_collection, session=session, mails=[mail], now=germany_now)

    await transact(db, judge_and_mint)


@router.post(
    f"{by_id('team_id')}/saisons/{{saison_id}}/invitation",
    status_code=201,
    summary="Mint this team's registration link for a season",
)
async def post_invitation(
    team_id: CustomObjectId,
    saison_id: str,
    invitations_collection: InvitationsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
    today: GermanDay,
) -> FLInvitationMintResponse:
    """Mint the link a team's players register through, revoking whatever link that team held for this season.

    The raw link is in this answer and in no other, the row storing only its hash, and it opens for as long as the season's
    registration window does, judged afresh at each opening.
    """

    # Outside the callback: `transact` may run it again, and a fresh value per attempt would
    # answer a raw link whose hash is not the one the winning attempt stored.
    raw_token, token_hash = mint_token()

    async def mint_the_link(session: AsyncClientSession) -> None:
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"], session=session)

        # Before the junction: a season that has ended cannot be repaired by entering the team into
        # it, so nobody should be handed the junction's answer to act on first.
        refuse(find_invitation_saison_past_refusal(saison_status=str(saison_raw["status"])))

        row = await saison_teams_collection.find_one({"saison_id": saison_id, "team_id": team_id}, {"austritt": 1, "name": 1}, session=session)
        if row is None:
            raise APIError(HTTPStatus.NOT_FOUND, Code.INVITATION_TEAM_NOT_ENTERED)
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
            # Minted for copying: nothing is mailed until the team's own press owes it.
            sent_at=None,
        )
        await post_one_to_db(collection=invitations_collection, document=document, session=session)
        await record_act(
            collection=invitations_collection, action="team.invitation_created", record_id=team_id, label=str(row["name"]), session=session
        )

    # One transaction over the revoke and the mint: `uniq_invitation_live` refuses the second live row
    # outright, so the two landing apart would leave the mint failing against the team's own old link.
    await transact(db, mint_the_link)

    return FLInvitationMintResponse(token=raw_token)


@router.delete(
    f"{by_id('team_id')}/saisons/{{saison_id}}/invitation",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke this team's live registration link for a season",
)
async def delete_invitation(
    team_id: CustomObjectId,
    saison_id: str,
    invitations_collection: InvitationsCollection,
    teams_collection: TeamsCollection,
    db: DBClient,
    today: GermanDay,
) -> None:
    """Stamp this team's live registration link revoked, so it opens nothing from here on.

    The row stays, so a delivery event about a mail carrying the link still has somewhere to land.
    """

    async def revoke_the_link(session: AsyncClientSession) -> None:
        # The filter is the judgement: `patch_one_in_db` answers a miss with the 404, so no read stands
        # between resolving the live row and stamping it.
        await patch_one_in_db(
            collection=invitations_collection,
            db_filter=build_live_team_filter(saison_id=saison_id, team_id=team_id),
            update=compose_revocation_update(today=today),
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )
        # The club's own document: a season's junction row can be handed to another club, and the link stays revocable.
        team = await pull_one_from_db(collection=teams_collection, db_filter={"_id": team_id}, projection=["name"], session=session)
        await record_act(
            collection=invitations_collection, action="team.invitation_withdrawn", record_id=team_id, label=str(team["name"]), session=session
        )

    await transact(db, revoke_the_link)


@router.post(
    f"{by_id('team_id')}/saisons/{{saison_id}}/invitation/mail",
    summary="Mail this team's live registration link to its confirmed contact seats",
)
async def post_invitation_mail(
    team_id: CustomObjectId,
    saison_id: str,
    mail_data: FLInvitationMailPayload,
    invitations_collection: InvitationsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: GermanDay,
    germany_now: GermanyNow,
) -> FLInvitationMailResponse:
    """Owe this team's live registration link to every seat whose own person has confirmed it, one mail each, `mailed` counting them.

    Each mail mints a link of its own at its hand-out, so a copied link stays valid beside them, and a second press on
    one day owes nothing again.
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

    return await transact(db, owe_the_link)
