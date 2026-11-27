import secrets
from collections import Counter
from collections.abc import Mapping
from typing import Annotated, Any

from fastapi import APIRouter, Query, Response, status
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.ban_list.crud import find_address_barred_refusal
from app.api.bewerbungen.schemas import (
    FLAcceptBewerbungPayload,
    FLBewerbung,
    FLBewerbungenAdminListResponse,
    FLBewerbungEntry,
    FLBewerbungEntryOffer,
    FLBewerbungGruppeOffer,
    FLBewerbungKontaktSeatPayload,
    FLBewerbungKontaktSeatResponse,
    FLBewerbungListRow,
    FLBewerbungSingleResponse,
    FLDeclineBewerbungPayload,
)
from app.api.bewerbungen.services import (
    BEWERBUNG_LIST_FIELDS,
    WITHOUT_TOKEN_HASHES,
    assigned_trikot_farben,
    bewerbung_list_row,
    build_bewerbungen_sort,
    build_confirmed_seat_filter,
    build_duplicates_pipeline,
    build_entry_offer_pipeline,
    claimed_pair_seat,
    compose_acceptance_seats,
    compose_kontakt_seat_update,
    compose_new_team,
    compose_resend_update,
    confirmation_deadline_from,
    find_acceptance_code_refusal,
    find_already_answered_refusal,
    find_already_entered_refusal,
    find_seat_contact_refusal,
    find_seat_write_refusal,
    find_triage_refusal,
    find_unconfirmed_kontakte_refusal,
    is_duplicate,
    mailed_seats,
    outbox_key,
    owed_link,
    paired_seat,
    parse_new_team,
    people_with_address,
    pull_schule_name,
    schule_name,
    seat_named,
    seats_confirmed_of,
    with_delivery,
)
from app.api.grants.guard import ADMIN_TIER
from app.api.outbox.crud import states_of
from app.api.outbox.schemas import FLBewerbungAbsageData, FLBewerbungZusageData, FLOutboxTeam
from app.api.outbox.services import OwedMail, enqueue_mails
from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import find_saison_past_refusal
from app.api.teams.crud import pull_a_team_to_enter, pull_team_names_and_codes, refuse_a_full_gruppe, refuse_a_taken_colour
from app.api.teams.services import find_entry_saison_refusal, find_shorthand_refusal, find_team_entry_refusal, offered_gruppen
from app.core.collections import Collection
from app.core.concurrency import concurrently
from app.core.crud import (
    VERSION_FIELD,
    aggregate_many_from_db,
    find_stale_save_refusal,
    insert_live,
    is_held_elsewhere,
    patch_one_in_db,
    post_one_to_db,
    pull_many_from_db,
    pull_one_from_db,
    refuse,
    refuse_faults,
)
from app.core.dependencies import (
    BanListReadCollection,
    BewerbungenCollection,
    BewerbungenReadCollection,
    DBClient,
    GermanDay,
    GermanyNow,
    OutboxCollection,
    OutboxReadCollection,
    SaisonsCollection,
    SaisonsReadCollection,
    SaisonTeamsCollection,
    SaisonTeamsReadCollection,
    SnapshotSession,
    TeamsCollection,
    TeamsReadCollection,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.readonly import ReadCollection
from app.core.recording import record_act
from app.core.routing import DRY_RUN_PASSED, SAFE_WHEN, DryRun, by_id, dry_run_passed
from app.core.transactions import transact
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.literals import FLKontaktSeat

# Admin-guarded, not base: an application carries three people's names, addresses, telephone numbers and dates of
# birth, and says which schools asked and were turned down. The public router shares this prefix at base tier and
# serves no person's details.
router = APIRouter(
    prefix="/bewerbungen",
    dependencies=ADMIN_TIER,
)


async def _entry_offer(*, saison_id: str, saisons_collection: SaisonsReadCollection) -> FLBewerbungEntryOffer:
    """What an acceptance into this season would meet, by the bounds an entry's refusal judges."""

    seasons = await aggregate_many_from_db(collection=saisons_collection, pipeline=build_entry_offer_pipeline(saison_id=saison_id))
    if not seasons:
        raise DocumentNotFoundError()

    saison_raw = seasons[0]
    rules = FLSaisonRules.model_validate(saison_raw["rules"])
    occupied = Counter(row["gruppe"] for row in saison_raw["rows"])

    return FLBewerbungEntryOffer(
        status=saison_raw["status"],
        gruppen=[
            FLBewerbungGruppeOffer(gruppe=gruppe, free=max(rules.teams_per_gruppe - occupied[gruppe], 0))
            for gruppe in offered_gruppen(rules.number_of_gruppen)
        ],
        taken=assigned_trikot_farben(stored=[row.get("trikot_farbe") for row in saison_raw["rows"]]),
    )


async def _entry_of(bewerbung_raw: Mapping[str, Any], *, saison_teams_collection: SaisonTeamsReadCollection) -> FLBewerbungEntry | None:
    """Where the accepted application's club stands in its season, `None` for an application no acceptance entered."""

    if bewerbung_raw["status"] != "accepted":
        return None

    row = await saison_teams_collection.find_one(
        {"saison_id": bewerbung_raw["saison_id"], "team_id": bewerbung_raw.get("team_id")}, {"gruppe": 1, "trikot_farbe": 1}
    )

    return None if row is None else FLBewerbungEntry.model_validate(row)


async def _doubled_teams(*, saison_id: str, bewerbungen_collection: ReadCollection) -> set[Any]:
    """The clubs the season's `Dublette`n collide on, which `is_duplicate` asks of a stored application."""

    cells = await aggregate_many_from_db(collection=bewerbungen_collection, pipeline=build_duplicates_pipeline(saison_id=saison_id))

    return {cell["_id"] for cell in cells}


@router.get("", summary="One Saison's Bewerbungen for its list")
async def get_bewerbungen_admin(
    bewerbungen_collection: BewerbungenReadCollection,
    teams_collection: TeamsReadCollection,
    saisons_collection: SaisonsReadCollection,
    saison_id: Annotated[str, Query()],
) -> FLBewerbungenAdminListResponse:
    """The season's applications, newest first, holding nothing of a person, and what an acceptance would meet there.

    A long list is cut, but every application with a confirmed seat is served past the cut.
    """

    # Cut rather than refused: an anonymous public form writes these rows, so a tripwire would hand whoever writes them
    # the power to 500 this page.
    async def newest_of(db_filter: Mapping[str, Any]) -> list[Mapping[str, Any]]:
        return await pull_many_from_db(
            collection=bewerbungen_collection,
            db_filter=db_filter,
            limit=LIST_LIMIT_DEFAULT,
            sort_by=build_bewerbungen_sort(order="desc"),
            projection=BEWERBUNG_LIST_FIELDS,
        )

    offer, teams, newest, confirmed = await concurrently(
        _entry_offer(saison_id=saison_id, saisons_collection=saisons_collection),
        _doubled_teams(saison_id=saison_id, bewerbungen_collection=bewerbungen_collection),
        newest_of({"saison_id": saison_id}),
        newest_of(build_confirmed_seat_filter(saison_id=saison_id)),
    )
    shown = {row["_id"] for row in newest}
    # Past the newest rows, so the two reads' one order holds without a sort here.
    served = [*newest, *(row for row in confirmed if row["_id"] not in shown)]
    team_names, team_codes = await pull_team_names_and_codes(teams_collection=teams_collection, team_ids=[row.get("team_id") for row in served])

    return FLBewerbungenAdminListResponse(
        saison=offer,
        bewerbungen=[
            FLBewerbungListRow.model_validate(bewerbung_list_row(row=row, team_names=team_names, team_codes=team_codes, doubled=teams))
            for row in served
        ],
    )


@router.get(by_id("bewerbung_id"), summary="One Bewerbung for its review page")
async def get_bewerbung(
    bewerbung_id: CustomObjectId,
    bewerbungen_collection: BewerbungenReadCollection,
    teams_collection: TeamsReadCollection,
    saisons_collection: SaisonsReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    outbox_collection: OutboxReadCollection,
    today: GermanDay,
) -> FLBewerbungSingleResponse:
    """One application, each seat's state judged today and `duplicate` taken over every open application of the season."""

    bewerbung_raw = await pull_one_from_db(collection=bewerbungen_collection, db_filter={"_id": bewerbung_id}, projection=WITHOUT_TOKEN_HASHES)
    states = await states_of(outbox_collection=outbox_collection, collection=Collection.BEWERBUNGEN, ids=[bewerbung_raw["_id"]])
    served = with_delivery(bewerbung_raw, states, today=today)

    team_id = bewerbung_raw.get("team_id")
    saison_id = str(bewerbung_raw["saison_id"])
    offer, (team_names, team_codes), entry, teams = await concurrently(
        _entry_offer(saison_id=saison_id, saisons_collection=saisons_collection),
        pull_team_names_and_codes(teams_collection=teams_collection, team_ids=[team_id]),
        _entry_of(bewerbung_raw, saison_teams_collection=saison_teams_collection),
        _doubled_teams(saison_id=saison_id, bewerbungen_collection=bewerbungen_collection),
    )

    return FLBewerbungSingleResponse(
        bewerbung=FLBewerbung(**served),
        entry=entry,
        name=schule_name(bewerbung_raw=bewerbung_raw, team_names=team_names),
        shorthand=team_codes.get(team_id),
        seats_confirmed=seats_confirmed_of(kontakte=bewerbung_raw.get("kontakte"), confirmations=bewerbung_raw.get("confirmations")),
        duplicate=is_duplicate(row=bewerbung_raw, doubled=teams),
        saison=offer,
    )


def _decision(*, today: str, reason: str | None) -> dict[str, Any]:
    """The decision block both endpoints write, so the two cannot spell one field differently."""

    return {"made_at": today, "reason": reason}


# One application a call, the bulk accept calling it once per card, so a refusal lands on its card and nothing already
# done is undone: one request over a season's applications would outrun `REQUEST_DEADLINE_S`.
@router.post(
    f"{by_id('bewerbung_id')}/accept",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Accept a Bewerbung and enter the school into the season",
)
async def accept_bewerbung(
    bewerbung_id: CustomObjectId,
    acceptance_data: FLAcceptBewerbungPayload,
    bewerbungen_collection: BewerbungenCollection,
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: GermanDay,
    germany_now: GermanyNow,
) -> None:
    """Accept an application once every contact person confirmed their seat, entering its club into the season and creating it for a new school.

    It cannot be undone, as an entered club leaves only by an `austritt`, and every person of the application is mailed
    the acceptance.
    """

    async def accept_and_enter_the_school(session: AsyncClientSession) -> None:
        """One transaction over every write: a club created without its junction row is a school in no season that nothing reports."""

        bewerbung_raw = await pull_one_from_db(collection=bewerbungen_collection, db_filter={"_id": bewerbung_id}, session=session)

        refuse(find_triage_refusal(status=str(bewerbung_raw["status"])))
        schule = bewerbung_raw.get("schule")
        picked_team_id = bewerbung_raw.get("team_id")
        # In-session, so the block copied into `saison_teams` below carries every person's own date and stamp, a
        # confirmation landing mid-request among them.
        refuse(find_unconfirmed_kontakte_refusal(kontakte=bewerbung_raw.get("kontakte")))
        refuse_faults(find_acceptance_code_refusal(new_school=schule is not None, shorthand=acceptance_data.shorthand))

        saison_id = str(bewerbung_raw["saison_id"])
        # In-session, as the season's own patch reads it: `activate_saison` moves `status` in a
        # transaction of its own, and entry is refused outside `future` (`entry_saison_not_future`).
        saison_raw = await pull_one_from_db(
            collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status", "rules"], session=session
        )

        # One of the two is filled in below, a stored school taking its branch whatever `team_id` holds -- declared here
        # so the write at the end reads one variable, not two.
        picked_team: Any = None
        new_team: dict[str, Any] | None = None

        # Read before the count, as `enter_a_team` reads it: a club's standing in the league is
        # not repaired by picking another group, so nobody is handed a capacity figure first. A
        # school being created cannot have left, so only a picked club is checked.
        if schule is None:
            team_raw = await pull_a_team_to_enter(teams_collection=teams_collection, team_id=picked_team_id, session=session)
            refuse(find_team_entry_refusal(inactive_since=team_raw.get("inactive_since")))
            # The club's own `_id`, never the application's copy of it: this read is what proves the
            # club exists, so the id the junction row carries comes from the document it resolved.
            picked_team = team_raw["_id"]
            # Two applications may name one club, so the first's acceptance reaches the second here: on the status
            # line by this code, ahead of the junction's unique index, which answers only a race.
            entered = await saison_teams_collection.find_one(
                {"saison_id": saison_id, "team_id": picked_team}, projection={"_id": 1}, session=session
            )
            refuse(find_already_entered_refusal(entered=entered is not None))
            name, shorthand = str(team_raw["name"]), str(team_raw["shorthand"])
        else:
            # Judged where the picked club's standing is judged, and for that reason: a school whose own details make no
            # club is not repaired by picking another group. Parsed before it is stored, so this path and `POST /teams`
            # put one document in `teams` for one school.
            new_team = parse_new_team(composed_team=compose_new_team(schule=schule, shorthand=acceptance_data.shorthand))
            # Read off the document the write stores rather than the school a second time, so no
            # field is composed twice and differently.
            name, shorthand = new_team["name"], new_team["shorthand"]

        refuse(find_entry_saison_refusal(saison_status=str(saison_raw["status"])))
        # The helper rather than `find_entry_refusal` directly: the count it takes is a read, which no
        # snapshot re-validates, so the group's capacity holds only where the season is written inside
        # this transaction too.
        await refuse_a_full_gruppe(
            saison_teams_collection=saison_teams_collection,
            saisons_collection=saisons_collection,
            saison_id=saison_id,
            gruppe=acceptance_data.gruppe,
            # Validated, not read raw: a season missing the capacity keys fails here rather than
            # admitting a school against a bound nobody chose.
            rules=FLSaisonRules.model_validate(saison_raw["rules"]),
            session=session,
        )
        await refuse_a_taken_colour(
            saison_teams_collection=saison_teams_collection,
            saison_id=saison_id,
            trikot_farbe=acceptance_data.trikot_farbe,
            own_id=None,
            session=session,
        )

        # On the box a person typed it in, before the write meets `uniq_shorthand`, which answers only a race.
        if new_team is not None:
            taken = await is_held_elsewhere(collection=teams_collection, key="shorthand", value=shorthand, own_id=None, session=session)
            refuse_faults(find_shorthand_refusal(taken=taken))

        # Every refusal is behind us, so the writes follow with nothing left to judge.
        if new_team is None:
            team_id = picked_team
        else:
            created = await insert_live(collection=teams_collection, document=new_team, session=session)
            team_id = created.inserted_id

        await post_one_to_db(
            collection=saison_teams_collection,
            document={
                "saison_id": saison_id,
                "team_id": team_id,
                "gruppe": acceptance_data.gruppe,
                "austritt": None,
                "trikot_farbe": acceptance_data.trikot_farbe,
                # The three people arrive with the row rather than in a later write: they are what the
                # application was, and the team editor reads them from here. Copied whole, each seat
                # confirmed by its own person before acceptance was allowed (`bewerbung_kontakte_unconfirmed`).
                "kontakte": bewerbung_raw["kontakte"],
                # Copied rather than joined on read.
                "name": name,
                "shorthand": shorthand,
            },
            session=session,
        )

        await patch_one_in_db(
            collection=bewerbungen_collection,
            # By `_id` alone: a decision landing after the read above conflicts with this write, and the
            # retry's read refuses it, so no status term is reached.
            db_filter={"_id": bewerbung_id},
            # `team_id` too: a new school's application named none until this write, and without it
            # nothing joins the accepted application to the club it produced. The people leave with the
            # season row's copy, so one copy of each stands.
            update={
                "$set": {
                    "status": "accepted",
                    "team_id": team_id,
                    "decision": _decision(today=today, reason=None),
                    **compose_acceptance_seats(kontakte=bewerbung_raw["kontakte"], confirmations=bewerbung_raw.get("confirmations")),
                }
            },
            session=session,
            expected_version=acceptance_data.version,
            return_document=ReturnDocument.BEFORE,
        )
        await record_act(collection=bewerbungen_collection, action="bewerbung.accepted", record_id=bewerbung_id, label=name, session=session)
        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=[
                OwedMail(
                    key=outbox_key(bewerbung_id, "zusage", seats[0]),
                    to=email,
                    data=FLBewerbungZusageData(
                        kind="bewerbung_zusage",
                        team=name,
                        shorthand=shorthand,
                        saison_id=saison_id,
                        seats=seats,
                        gruppe=acceptance_data.gruppe,
                        trikot_farbe=acceptance_data.trikot_farbe,
                    ),
                    # To the season row's seats written above, so the hand-out drops it once its person left the seat.
                    team=FLOutboxTeam(saison_id=saison_id, team_id=team_id),
                )
                for email, seats in people_with_address(kontakte=bewerbung_raw.get("kontakte"))
            ],
            now=germany_now,
        )

    await transact(db, accept_and_enter_the_school)


@router.post(
    f"{by_id('bewerbung_id')}/decline",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Decline a Bewerbung",
)
async def decline_bewerbung(
    bewerbung_id: CustomObjectId,
    decline_data: FLDeclineBewerbungPayload,
    bewerbungen_collection: BewerbungenCollection,
    teams_collection: TeamsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: GermanDay,
    germany_now: GermanyNow,
) -> None:
    """Decline an application with the reason given, mailed verbatim to each person the application mailed.

    What the school submitted stays as it was, the record the decision was taken against.
    """

    async def decline_the_application(session: AsyncClientSession) -> None:
        stored_raw = await pull_one_from_db(
            collection=bewerbungen_collection,
            db_filter={"_id": bewerbung_id},
            projection=["status", "saison_id", "schule", "team_id", "kontakte", "confirmations"],
            session=session,
        )
        refuse(find_triage_refusal(status=str(stored_raw["status"])))

        # By `_id` alone: a decision landing after the read conflicts with this write, and the retry's
        # read refuses it, so no status term is reached.
        await patch_one_in_db(
            collection=bewerbungen_collection,
            db_filter={"_id": bewerbung_id},
            update={"$set": {"status": "declined", "decision": _decision(today=today, reason=decline_data.reason)}},
            session=session,
            expected_version=decline_data.version,
            return_document=ReturnDocument.BEFORE,
        )
        team = await pull_schule_name(bewerbung_raw=stored_raw, teams_collection=teams_collection, session=session)
        await record_act(collection=bewerbungen_collection, action="bewerbung.declined", record_id=bewerbung_id, label=team, session=session)
        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=[
                OwedMail(
                    key=outbox_key(bewerbung_id, "absage", seats[0]),
                    to=email,
                    data=FLBewerbungAbsageData(
                        kind="bewerbung_absage",
                        team=team,
                        saison_id=str(stored_raw["saison_id"]),
                        seats=seats,
                        reason=decline_data.reason,
                    ),
                )
                for email, seats in people_with_address(
                    kontakte=stored_raw.get("kontakte"), seats=mailed_seats(confirmations=stored_raw.get("confirmations"))
                )
            ],
            now=germany_now,
        )

    await transact(db, decline_the_application)


@router.post(
    f"{by_id('bewerbung_id')}/kontakte/{{seat}}/confirmation/resend",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Re-send one seat's confirmation link",
)
async def resend_kontakt_confirmation(
    bewerbung_id: CustomObjectId,
    seat: str,
    bewerbungen_collection: BewerbungenCollection,
    saisons_collection: SaisonsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: GermanDay,
    germany_now: GermanyNow,
) -> None:
    """Void one seat's link and mail its person a fresh one, that seat's deadline and reminder starting again from today.

    Where one person holds two seats both are replaced and one link answers both. A finished season's application takes
    no fresh link.
    """

    # A 404 rather than a 422, as a malformed path id answers: the segment names no seat any
    # application has, which is a miss and not a body fault.
    pressed = seat_named(seat)
    if pressed is None:
        raise DocumentNotFoundError()

    def seats_judged_on(stored: Mapping[str, Any]) -> tuple[FLKontaktSeat, ...]:
        """Refuse, or answer every seat the fresh link will open: the pressed one and the mirror the confirmation also answers."""

        kontakte, confirmations = stored.get("kontakte"), stored.get("confirmations")
        refuse(find_triage_refusal(status=str(stored["status"])))
        refuse(find_already_answered_refusal(kontakte=kontakte, confirmations=confirmations, seat=pressed))

        # One entry left standing would keep the replaced address's link alive. The mirror is judged
        # too: `paired_seat` adds a seat that merely stands.
        other = paired_seat(kontakte=kontakte, confirmations=confirmations, seat=pressed)
        if other is None:
            return (pressed,)

        refuse(find_already_answered_refusal(kontakte=kontakte, confirmations=confirmations, seat=other))

        return (pressed, other)

    confirmation_deadline = confirmation_deadline_from(today=today)
    # Outside the callback, so a retried transaction owes the press's one mail and a second press its own.
    nonce = secrets.token_hex(8)

    async def judge_and_mint(session: AsyncClientSession) -> None:
        db_filter = {"_id": bewerbung_id}
        # In-session, as the seat write reads it: an answer, an erasure or a decision committing before the patch makes
        # the patch a write conflict, and the retry judges what it left.
        bewerbung_raw = await pull_one_from_db(
            collection=bewerbungen_collection,
            db_filter=db_filter,
            projection=["status", "kontakte", "confirmations", "saison_id"],
            session=session,
        )
        seats = seats_judged_on(bewerbung_raw)
        kontakte, confirmations = bewerbung_raw.get("kontakte"), bewerbung_raw.get("confirmations")

        # So a season closed before this press mails nobody a link its season's end deletes with the application.
        # Unanchored, as the confirmation's read is: the rollover reads nothing this press writes, so one committing
        # inside it orders as one committing just before.
        saison_raw = await pull_one_from_db(
            collection=saisons_collection, db_filter={"_id": bewerbung_raw["saison_id"]}, projection=["status"], session=session
        )
        refuse(find_saison_past_refusal(saison_status=str(saison_raw["status"])))

        await patch_one_in_db(
            collection=bewerbungen_collection,
            db_filter=db_filter,
            update=compose_resend_update(seats=seats, today=today, kontakte=kontakte, confirmations=confirmations),
            session=session,
            expected_version=None,
            return_document=ReturnDocument.AFTER,
        )
        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=[
                owed_link(
                    bewerbung_id=bewerbung_id,
                    kontakte=bewerbung_raw["kontakte"],
                    seats=seats,
                    saison_id=str(bewerbung_raw["saison_id"]),
                    deadline=confirmation_deadline,
                    key=outbox_key(bewerbung_id, "resend", seats[0], nonce),
                )
            ],
            now=germany_now,
        )

    await transact(db, judge_and_mint)


@router.post(
    f"{by_id('bewerbung_id')}/kontakte/{{seat}}",
    summary="Write the person one contact seat holds and mail them a fresh link",
    response_model=FLBewerbungKontaktSeatResponse,
    openapi_extra=SAFE_WHEN,
    responses=DRY_RUN_PASSED,
)
async def post_kontakt_seat(
    bewerbung_id: CustomObjectId,
    seat: str,
    seat_data: FLBewerbungKontaktSeatPayload,
    bewerbungen_collection: BewerbungenCollection,
    teams_collection: TeamsCollection,
    saisons_collection: SaisonsCollection,
    ban_list_collection: BanListReadCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    session: SnapshotSession,
    today: GermanDay,
    germany_now: GermanyNow,
    dry_run: DryRun = False,
) -> FLBewerbungKontaktSeatResponse | Response:
    """Write a person into one seat, whatever its state, and mail them a fresh link; an acceptance waits on their answer.

    Where one person holds two seats both are written, the last holder's link opens nothing afterwards, and the seat's
    deadline starts again from today. A finished season's application takes no write, as it takes no fresh link. A
    `dry_run` is refused as the write would be, and answers 204 and writes nothing where it would land.
    """

    # Outside the callback, so a retried transaction owes the press's one mail and a second press its own.
    nonce = secrets.token_hex(8)
    db_filter = {"_id": bewerbung_id}

    async def judge(session: AsyncClientSession) -> tuple[Mapping[str, Any], tuple[FLKontaktSeat, ...]]:
        # Every refusal of the write, in its transaction or the dry run's snapshot alike: the application and the seats.
        bewerbung_raw = await pull_one_from_db(
            collection=bewerbungen_collection,
            db_filter=db_filter,
            projection=["status", "kontakte", "confirmations", "saison_id", "schule", "team_id", VERSION_FIELD],
            session=session,
        )

        # A 404 rather than a 422, as the re-send's is: the segment names no seat any application has.
        pressed = seat_named(seat)
        if pressed is None:
            raise DocumentNotFoundError()

        kontakte, confirmations = bewerbung_raw.get("kontakte"), bewerbung_raw.get("confirmations")
        refuse(find_triage_refusal(status=str(bewerbung_raw["status"])))

        # As the re-send judges it: the season's end deletes the application, so the person written here would be mailed
        # a link to nothing. Unanchored, as the re-send's read is: the rollover reads nothing this write writes.
        saison_raw = await pull_one_from_db(
            collection=saisons_collection, db_filter={"_id": bewerbung_raw["saison_id"]}, projection=["status"], session=session
        )
        refuse(find_saison_past_refusal(saison_status=str(saison_raw["status"])))

        # The pair is claimed rather than read off the seats, so it holds on the emptied seats too, and it is judged
        # with the pressed seat: `claimed_pair_seat` adds a mirror in any state at all.
        other = claimed_pair_seat(kontakte=kontakte, seat=pressed)
        seats = (pressed,) if other is None else (pressed, other)

        refuse(find_seat_write_refusal(confirmations=confirmations, seats=seats))
        # Read as well as filtered on: a dry run patches nothing for the version to refuse, and the patch's filter still
        # refuses a write racing past this read.
        refuse(find_stale_save_refusal(bewerbung_raw, version=seat_data.version))

        refuse_faults(
            # Asked over the seats this write does not reach: a mirrored pair is one person, and comparing them against
            # each other would refuse every such write.
            find_seat_contact_refusal(kontakte=kontakte, seats=seats, email=seat_data.email, phone=seat_data.phone),
            # Every write here mails the person a fresh link, which the drain never hands to a banned address.
            await find_address_barred_refusal(
                ban_list_collection=ban_list_collection, address=seat_data.email, path=("email",), session=session
            ),
        )
        return bewerbung_raw, seats

    if dry_run:
        await judge(session)
        return dry_run_passed()

    async def seat_and_mint(session: AsyncClientSession) -> FLBewerbungKontaktSeatResponse:
        bewerbung_raw, seats = await judge(session)
        kontakte, confirmations = bewerbung_raw.get("kontakte"), bewerbung_raw.get("confirmations")

        # Restarted even where it had passed: left where it was, the person would be handed a link that opens nothing.
        confirmation_deadline = confirmation_deadline_from(today=today)

        after = await patch_one_in_db(
            collection=bewerbungen_collection,
            db_filter=db_filter,
            update=compose_kontakt_seat_update(
                seats=seats,
                # The person as the seat stores them, so a sixth field added here reaches storage.
                person=seat_data.model_dump(mode="json", exclude={"version"}),
                today=today,
                kontakte=kontakte,
                confirmations=confirmations,
            ),
            session=session,
            expected_version=seat_data.version,
            return_document=ReturnDocument.AFTER,
        )
        schule = await pull_schule_name(bewerbung_raw=bewerbung_raw, teams_collection=teams_collection, session=session)
        await record_act(
            collection=bewerbungen_collection, action="bewerbung.seat_changed", record_id=bewerbung_id, label=schule, session=session
        )
        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=[
                owed_link(
                    bewerbung_id=bewerbung_id,
                    kontakte=after["kontakte"],
                    seats=seats,
                    saison_id=str(bewerbung_raw["saison_id"]),
                    deadline=confirmation_deadline,
                    key=outbox_key(bewerbung_id, "seat", seats[0], nonce),
                )
            ],
            now=germany_now,
        )

        return FLBewerbungKontaktSeatResponse(email=seat_data.email)

    # One transaction: this write moves a person as well as a credential, so a decision landing mid-request must leave
    # neither half standing.
    return await transact(db, seat_and_mint)
