import asyncio
import secrets
from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Query
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.berechtigungen.guard import verify_actor_is_admin
from app.api.bewerbungen.schemas import (
    FLAcceptBewerbungPayload,
    FLAcceptBewerbungResponse,
    FLBewerbung,
    FLBewerbungEinwilligungResendResponse,
    FLBewerbungenAdminListResponse,
    FLBewerbungEntry,
    FLBewerbungEntryOffer,
    FLBewerbungGruppeOffer,
    FLBewerbungKontaktSeatPayload,
    FLBewerbungKontaktSeatResponse,
    FLBewerbungListRow,
    FLBewerbungSingleResponse,
    FLDeclineBewerbungPayload,
    FLDeclineBewerbungResponse,
)
from app.api.bewerbungen.services import (
    BEWERBUNG_LIST_FIELDS,
    WITHOUT_TOKEN_HASHES,
    bewerbung_list_row,
    build_bewerbungen_sort,
    build_confirmed_seat_filter,
    build_dubletten_pipeline,
    build_entry_offer_pipeline,
    build_erneut_filter,
    claimed_pair_seat,
    compose_erneut_update,
    compose_kontakt_seat_update,
    compose_new_club,
    confirmation_deadline_from,
    decider_addresses,
    find_acceptance_code_refusal,
    find_acceptance_subject_refusal,
    find_already_answered_refusal,
    find_already_entered_refusal,
    find_kontakt_barred_refusal,
    find_new_club_refusal,
    find_seat_contact_refusal,
    find_seat_write_refusal,
    find_triage_refusal,
    find_unconfirmed_kontakte_refusal,
    mit_vorenthaltener_entscheidung,
    mit_zustellung,
    owed_link,
    paired_seat,
    parse_new_club,
    people_with_address,
    schule_name,
    seat_named,
    seats_confirmed_of,
)
from app.api.outbox.crud import states_of
from app.api.outbox.schemas import FLBewerbungAbsageData, FLBewerbungZusageData
from app.api.outbox.services import OwedMail, enqueue_mails
from app.api.saisons.schemas import FLSaisonRules
from app.api.sperrliste.lookup import BanList, BanListLookup, ban_list_saison, barred_addresses, hash_barred
from app.api.teams.crud import pull_a_club_to_enter, pull_team_names_and_codes, refuse_a_full_gruppe
from app.api.teams.services import find_club_entry_refusal, find_shorthand_refusal, offered_gruppen
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import (
    aggregate_many_from_db,
    insert_live,
    is_held_elsewhere,
    patch_one_in_db,
    post_one_to_db,
    pull_many_from_db,
    pull_one_from_db,
    refuse,
)
from app.core.dependencies import (
    BewerbungenCollection,
    DBClient,
    OutboxCollection,
    SaisonsCollection,
    SaisonsReadCollection,
    SaisonTeamsCollection,
    SaisonTeamsReadCollection,
    TeamsCollection,
    TeamsReadCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.routing import by_id
from app.core.security import bind_actor, get_actor_email, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.custom import CustomRouteObjectId
from app.shared.schemas.literals import FLKontaktRolle

# Admin-guarded, not base, as `schiedsrichter` is: an application carries three people's names,
# addresses, telephone numbers and dates of birth (`READ-CONTACT-001`), and says which schools
# asked and were turned down. `public_router.py` shares this prefix at base tier and reads no
# stored application.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/bewerbungen",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


async def _entry_offer(*, saison_id: str, saisons_collection: SaisonsReadCollection) -> FLBewerbungEntryOffer:
    """What an acceptance into this season would meet, by the bounds `app/api/teams/services.py :: find_entry_refusal` judges."""

    seasons = await aggregate_many_from_db(collection=saisons_collection, pipeline=build_entry_offer_pipeline(saison_id=saison_id))
    if not seasons:
        raise DocumentNotFoundError()

    saison_raw = seasons[0]
    rules = FLSaisonRules.model_validate(saison_raw["rules"])
    occupied = Counter(row["gruppe"] for row in saison_raw["rows"])

    return FLBewerbungEntryOffer(
        saison_id=saison_id,
        status=saison_raw["status"],
        gruppen=[
            FLBewerbungGruppeOffer(gruppe=gruppe, free=max(rules.teams_per_gruppe - occupied[gruppe], 0))
            for gruppe in offered_gruppen(rules.number_of_gruppen)
        ],
    )


async def _entry_of(bewerbung_raw: Mapping[str, Any], *, saison_teams_collection: SaisonTeamsReadCollection) -> FLBewerbungEntry | None:
    """Where the accepted application's club stands in its season, `None` for an application no acceptance entered."""

    if bewerbung_raw["status"] != "accepted":
        return None

    row = await saison_teams_collection.find_one(
        {"saison_id": bewerbung_raw["saison_id"], "team_id": bewerbung_raw.get("team_id")}, {"gruppe": 1, "trikot_farbe": 1}
    )

    return None if row is None else FLBewerbungEntry.model_validate(row)


async def _as_served(
    rows: Sequence[Mapping[str, Any]],
    *,
    ban_list: BanList,
    outbox_collection: AsyncCollection,
    today: str,
) -> list[dict[str, Any]]:
    # Concurrently: the ban list and the Postausgang are two collections, and neither read waits on the other.
    barred, lagen = await asyncio.gather(
        barred_addresses(ban_list, decider_addresses(rows)),
        states_of(outbox_collection=outbox_collection, collection=Collection.BEWERBUNGEN, ids=[row["_id"] for row in rows]),
    )

    return [mit_zustellung(mit_vorenthaltener_entscheidung(row, barred), lagen, today=today) for row in rows]


# Two static segments, matching `GET /saisons/list/admin`.
@router.get("/list/admin", response_model=FLBewerbungenAdminListResponse, summary="One Saison's Bewerbungen for its list")
async def get_bewerbungen_admin(
    bewerbungen_collection: BewerbungenCollection,
    teams_collection: TeamsReadCollection,
    saisons_collection: SaisonsReadCollection,
    saison_id: Annotated[str, Query()],
) -> FLBewerbungenAdminListResponse:
    """
    One read for the season's list and its bulk accept: its rows, newest first, and what an acceptance would meet.

    A row holds nothing of a person: a seat's count stands for it. 404 where no season carries the id, and `duplicate`
    taken over every open application of the season. Degrades rather than refusing: the rows are written by an anonymous
    public form, so a tripwire would hand whoever writes them the power to 500 this page, and `complete` reports the cut.
    Every application with a confirmed seat is served past the newest rows, which a flood can fill and no flood confirms.
    """

    async def newest_of(db_filter: Mapping[str, Any]) -> list[Mapping[str, Any]]:
        return await pull_many_from_db(
            collection=bewerbungen_collection,
            db_filter=db_filter,
            # One past the cap, so `complete` is answered without counting.
            limit=LIST_LIMIT_DEFAULT + 1,
            sort_by=build_bewerbungen_sort(order="desc"),
            projection=BEWERBUNG_LIST_FIELDS,
        )

    offer, doubled, read, confirmed = await asyncio.gather(
        _entry_offer(saison_id=saison_id, saisons_collection=saisons_collection),
        aggregate_many_from_db(collection=bewerbungen_collection, pipeline=build_dubletten_pipeline(saison_id=saison_id)),
        newest_of({"saison_id": saison_id}),
        newest_of(build_confirmed_seat_filter(saison_id=saison_id)),
    )
    # Sliced before validation, so neither probe row is ever parsed or reaches the wire.
    newest = read[:LIST_LIMIT_DEFAULT]
    shown = {row["_id"] for row in newest}
    # Past the newest rows, so the two reads' one order holds without a sort here.
    served = [*newest, *(row for row in confirmed[:LIST_LIMIT_DEFAULT] if row["_id"] not in shown)]
    club_names, club_codes = await pull_team_names_and_codes(teams_collection=teams_collection, team_ids=[row.get("team_id") for row in served])
    clubs = {cell["_id"] for cell in doubled}

    return FLBewerbungenAdminListResponse(
        saison=offer,
        bewerbungen=[
            FLBewerbungListRow.model_validate(bewerbung_list_row(row=row, club_names=club_names, club_codes=club_codes, doubled=clubs))
            for row in served
        ],
        complete=len(read) <= LIST_LIMIT_DEFAULT,
    )


@router.get(by_id("bewerbung_id"), response_model=FLBewerbungSingleResponse, summary="One Bewerbung for its review page")
async def get_bewerbung(
    bewerbung_id: CustomRouteObjectId,
    bewerbungen_collection: BewerbungenCollection,
    teams_collection: TeamsReadCollection,
    saisons_collection: SaisonsReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    outbox_collection: OutboxCollection,
    ban_list: BanListLookup,
    today: str = Depends(get_german_date_str),
) -> FLBewerbungSingleResponse:
    """One application, its decision's administrator withheld as the list withholds it.

    Each seat's `expired` says whether its own deadline has passed today.
    """

    bewerbung_raw = await pull_one_from_db(collection=bewerbungen_collection, db_filter={"_id": bewerbung_id}, projection=WITHOUT_TOKEN_HASHES)
    [served] = await _as_served([bewerbung_raw], ban_list=ban_list, outbox_collection=outbox_collection, today=today)

    team_id = bewerbung_raw.get("team_id")
    offer, (club_names, club_codes), entry = await asyncio.gather(
        _entry_offer(saison_id=str(bewerbung_raw["saison_id"]), saisons_collection=saisons_collection),
        pull_team_names_and_codes(teams_collection=teams_collection, team_ids=[team_id]),
        _entry_of(bewerbung_raw, saison_teams_collection=saison_teams_collection),
    )

    return FLBewerbungSingleResponse(
        bewerbung=FLBewerbung(**served),
        entry=entry,
        name=schule_name(bewerbung_raw=bewerbung_raw, club_names=club_names),
        shorthand=club_codes.get(team_id),
        seats_confirmed=seats_confirmed_of(kontakte=bewerbung_raw.get("kontakte")),
        saison=offer,
    )


def _entscheidung(*, today: str, by: str, reason: str | None) -> dict[str, Any]:
    """The decision block both endpoints write, so the two cannot spell one field differently."""

    return {"made_at": today, "by": by, "reason": reason}


async def _schule_text(*, bewerbung_raw: Mapping[str, Any], teams_collection: AsyncCollection, session: AsyncClientSession) -> str:
    """The school a mail names: as submitted, or the picked club as the league holds it."""

    schule = bewerbung_raw.get("schule")
    if isinstance(schule, Mapping):
        return str(schule.get("team_name") or "")

    club = await teams_collection.find_one({"_id": bewerbung_raw.get("team_id")}, {"name": 1}, session=session)

    return str((club or {}).get("name") or "")


def _key(bewerbung_id: Any, *teile: str) -> str:
    return "/".join([str(Collection.BEWERBUNGEN), str(bewerbung_id), *teile])


@router.post(
    f"{by_id('bewerbung_id')}/accept",
    response_model=FLAcceptBewerbungResponse,
    summary="Accept a Bewerbung and enter the school into the season",
)
async def accept_bewerbung(
    bewerbung_id: CustomRouteObjectId,
    annahme_data: Annotated[FLAcceptBewerbungPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    by: str = Depends(get_actor_email),
    germany_now: datetime = Depends(get_germany_now),
) -> FLAcceptBewerbungResponse:
    """
    Accept an application, creating the school's club where the applicant proposed a new one, each call one transaction.

    The bulk accept is this endpoint once per card, so a refusal lands on its card and nothing already done is undone:
    one request over a season's applications would outrun `app/core/middlewares.py :: REQUEST_DEADLINE_S`.

    IRREVERSIBLE. `saison_teams` has no DELETE, so a club entered in error leaves only through an
    `austritt`, which is a public record carrying a stated reason. Refused while any contact person has yet to
    confirm their own seat (`bewerbung_kontakte_unconfirmed`), so every seat enters the season as its person confirmed it.
    A new school takes its `shorthand` here, a taken one refused `duplicate_key` naming it; a picked club sends null.
    The acceptance is owed to every person of the application in the same transaction, naming the seats each holds.
    """

    async def accept_and_enter_the_school(session: AsyncClientSession) -> FLAcceptBewerbungResponse:
        """Judge everything, then write. Everything judged is read in-session, so a retry re-judges it.

        One transaction over every write: a club created without its junction row is a school in no
        season that nothing reports.
        """

        bewerbung_raw = await pull_one_from_db(collection=bewerbungen_collection, db_filter={"_id": bewerbung_id}, session=session)

        refuse(find_triage_refusal(status=str(bewerbung_raw["status"])))
        schule = bewerbung_raw.get("schule")
        picked_team_id = bewerbung_raw.get("team_id")
        refuse(find_acceptance_subject_refusal(team_id=picked_team_id, schule=schule))
        # In-session, as everything judged here is: a confirmation landing mid-request is judged by
        # the retry rather than lost, and the block copied into `saison_teams` below then carries
        # every person's own date and stamp.
        refuse(find_unconfirmed_kontakte_refusal(kontakte=bewerbung_raw.get("kontakte")))
        refuse(find_acceptance_code_refusal(new_school=schule is not None, shorthand=annahme_data.shorthand))

        saison_id = str(bewerbung_raw["saison_id"])
        # In-session, as the season's own patch reads it: `activate_saison` moves `status` in a
        # transaction of its own, and entry is refused outside `future` (`entry_saison_not_future`).
        saison_raw = await pull_one_from_db(
            collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status", "rules"], session=session
        )

        # Exactly one of the two is filled in below, which `find_acceptance_subject_refusal` has
        # already established -- declared here so the write at the end reads one variable, not two.
        picked_club: Any = None
        new_club: dict[str, Any] | None = None

        # Read before the count, as `enter_a_club` reads it: a club's standing in the league is
        # not repaired by picking another group, so nobody is handed a capacity figure first. A
        # school being created cannot have left, so only a PICKED club is checked.
        if schule is None:
            team_raw = await pull_a_club_to_enter(teams_collection=teams_collection, team_id=picked_team_id, session=session)
            refuse(find_club_entry_refusal(inactive_since=team_raw.get("inactive_since")))
            # The club's OWN `_id`, never the application's copy of it: this read is what proves the
            # club exists, so the id the junction row carries comes from the document it resolved.
            picked_club = team_raw["_id"]
            # Two applications may name one club, so the first's acceptance reaches the second here: on the status
            # line by this code, ahead of the junction's unique index, which answers only a race.
            entered = await saison_teams_collection.count_documents({"saison_id": saison_id, "team_id": picked_club}, limit=1, session=session)
            refuse(find_already_entered_refusal(entered=entered > 0))
            name, shorthand = str(team_raw["name"]), str(team_raw["shorthand"])
        else:
            # Composed beside the guard that judges it, and reaching for no field of the application
            # itself: nothing here may raise before the refusal below has had its say.
            new_club = compose_new_club(schule=schule, shorthand=annahme_data.shorthand)
            # Asked where the picked club's standing is asked, and for that reason: a school whose
            # own details make no club is not repaired by picking another group.
            refuse(find_new_club_refusal(club_document=new_club))
            # PARSED before it is stored, so this path and `POST /teams` put one document in `teams`
            # for one school; the guard above has already proved it validates.
            new_club = parse_new_club(club_document=new_club)
            # Read off the document the write STORES rather than the school a second time, so no
            # field is composed twice and differently.
            name, shorthand = new_club["name"], new_club["shorthand"]

        # The helper rather than `find_entry_refusal` directly: the count it takes is a read, which no
        # snapshot re-validates, so the group's capacity holds only where the season is written inside
        # this transaction too.
        await refuse_a_full_gruppe(
            saison_teams_collection=saison_teams_collection,
            saisons_collection=saisons_collection,
            saison_id=saison_id,
            gruppe=annahme_data.gruppe,
            saison_status=str(saison_raw["status"]),
            # Validated, not read raw: a season missing the capacity keys fails here rather than
            # admitting a school against a bound nobody chose.
            rules=FLSaisonRules.model_validate(saison_raw["rules"]),
            session=session,
        )

        # On the box a person typed it in, before the write meets `uniq_shorthand`, which answers only a race.
        if new_club is not None:
            taken = await is_held_elsewhere(collection=teams_collection, key="shorthand", value=shorthand, own_id=None, session=session)
            refuse(find_shorthand_refusal(taken=taken))

        # Every refusal is behind us, so the writes follow with nothing left to judge.
        if new_club is None:
            team_id = picked_club
        else:
            created = await insert_live(collection=teams_collection, document=new_club, session=session)
            team_id = created.inserted_id

        await post_one_to_db(
            collection=saison_teams_collection,
            document={
                "saison_id": saison_id,
                "team_id": team_id,
                "gruppe": annahme_data.gruppe,
                "austritt": None,
                "trikot_farbe": annahme_data.trikot_farbe,
                # The three people arrive WITH the row rather than in a later write: they are what the
                # application was, and `/area/admin/kontakte` reads them from here. Copied whole, each seat
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
            # retry's read refuses it, so no status term is reached. Held by
            # `TestADeclineLandingInsideAnAcceptance` and, the read being in-session,
            # `TestTheAcceptanceJudgesWhatItReadsInsideTheTransaction`.
            db_filter={"_id": bewerbung_id},
            # `team_id` too: a new school's application named none until this write, and without it
            # nothing joins the accepted application to the club it produced. `kontakte` stays as answered:
            # only the season row's copy moves after.
            update={"$set": {"status": "accepted", "team_id": team_id, "decision": _entscheidung(today=today, by=by, reason=None)}},
            session=session,
            expected_version=annahme_data.version,
            return_document=ReturnDocument.BEFORE,
        )
        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=[
                OwedMail(
                    key=_key(bewerbung_id, "zusage", seats[0]),
                    an=email,
                    data=FLBewerbungZusageData(
                        kind="bewerbung_zusage",
                        team=name,
                        shorthand=shorthand,
                        saison_id=saison_id,
                        rollen=seats,
                        gruppe=annahme_data.gruppe,
                        trikot_farbe=annahme_data.trikot_farbe,
                        # As the school submitted it, which the acceptance's payload never carries.
                        wunschgegner=bewerbung_raw.get("wunschgegner"),
                    ),
                )
                for email, seats in people_with_address(kontakte=bewerbung_raw.get("kontakte"))
            ],
            now=germany_now,
        )

        return FLAcceptBewerbungResponse(
            team_id=team_id,
            created_team=schule is not None,
            saison_id=saison_id,
            gruppe=annahme_data.gruppe,
            trikot_farbe=annahme_data.trikot_farbe,
        )

    # `with_transaction`, not a bare `start_transaction`: the callback re-reads everything it judges,
    # so a retry after a write conflict judges the season as it stands then rather than as it stood.
    async with transaction_session(db) as session:
        accepted = await session.with_transaction(accept_and_enter_the_school)

    return accepted


@router.post(
    f"{by_id('bewerbung_id')}/decline",
    response_model=FLDeclineBewerbungResponse,
    summary="Decline a Bewerbung",
)
async def decline_bewerbung(
    bewerbung_id: CustomRouteObjectId,
    ablehnung_data: Annotated[FLDeclineBewerbungPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    teams_collection: TeamsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    by: str = Depends(get_actor_email),
    germany_now: datetime = Depends(get_germany_now),
) -> FLDeclineBewerbungResponse:
    """
    Decline an application, recording who decided and the reason they gave, and owe every person of it the decline.

    The submission itself is untouched: a decline moves `status` and `decision` and nothing else,
    so what the school wrote stays the record the decision was taken against. The mails carry the reason verbatim.
    """

    async def decline_the_application(session: AsyncClientSession) -> None:
        stored_raw = await pull_one_from_db(
            collection=bewerbungen_collection,
            db_filter={"_id": bewerbung_id},
            projection=["status", "saison_id", "schule", "team_id", "kontakte"],
            session=session,
        )
        refuse(find_triage_refusal(status=str(stored_raw["status"])))

        # By `_id` alone: a decision landing after the read conflicts with this write, and the retry's
        # read refuses it (`TestTwoDeclinesAtOnce`), so no status term is reached.
        await patch_one_in_db(
            collection=bewerbungen_collection,
            db_filter={"_id": bewerbung_id},
            update={"$set": {"status": "declined", "decision": _entscheidung(today=today, by=by, reason=ablehnung_data.reason)}},
            session=session,
            expected_version=ablehnung_data.version,
            return_document=ReturnDocument.BEFORE,
        )
        team = await _schule_text(bewerbung_raw=stored_raw, teams_collection=teams_collection, session=session)
        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=[
                OwedMail(
                    key=_key(bewerbung_id, "absage", seats[0]),
                    an=email,
                    data=FLBewerbungAbsageData(
                        kind="bewerbung_absage",
                        team=team,
                        saison_id=str(stored_raw["saison_id"]),
                        rollen=seats,
                        reason=ablehnung_data.reason,
                    ),
                )
                for email, seats in people_with_address(kontakte=stored_raw.get("kontakte"))
            ],
            now=germany_now,
        )

    async with transaction_session(db) as session:
        await session.with_transaction(decline_the_application)

    return FLDeclineBewerbungResponse(id=bewerbung_id)


@router.post(
    f"{by_id('bewerbung_id')}/einwilligung/{{seat}}/resend",
    response_model=FLBewerbungEinwilligungResendResponse,
    summary="Re-send one seat's confirmation link",
)
async def resend_einwilligung(
    bewerbung_id: CustomRouteObjectId,
    seat: str,
    bewerbungen_collection: BewerbungenCollection,
    teams_collection: TeamsCollection,
    outbox_collection: OutboxCollection,
    ban_list: BanListLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLBewerbungEinwilligungResendResponse:
    """
    Void one seat's link and owe its person a fresh one in the same transaction; the old link then opens nothing.

    Where one person holds two seats both entries are replaced, so the old links die on both and the one new link answers both.
    The answer names the address and the seats as the write found them, so a seat write landing mid-request is where the link goes.
    That seat's 14 days restart from today, no other seat's moving, and its reminder is owed again. The mirrored seat
    is judged with the pressed one, a seat an erasure emptied is refused as an answered one is, and a
    decision, an answer or an erasure landing while the request runs is refused too. A seat whose address the ban list
    holds is refused `bewerbung_kontakt_barred`. A path naming no seat is a 404.
    """

    db_filter = {"_id": bewerbung_id}
    judged = ["status", "kontakte", "confirmations"]
    bewerbung_raw = await pull_one_from_db(collection=bewerbungen_collection, db_filter=db_filter, projection=judged)

    async def refuse_a_barred_address(
        stored: Mapping[str, Any], seats: tuple[FLKontaktRolle, ...], *, governing_saison_id: str | None, session: AsyncClientSession
    ) -> None:
        """Every address the seats the link answers hold, judged as the seat write judges the one it writes."""

        kontakte = stored.get("kontakte")
        # Both seats of a pair, which no write path lets hold two addresses: the submission requires the
        # pair's details equal and the seat write moves both. Only a hand edit could part them.
        slots = [kontakte.get(held) for held in seats] if isinstance(kontakte, Mapping) else []
        addresses = {str(slot["email"]) for slot in slots if isinstance(slot, Mapping) and slot.get("email")}
        barred = await barred_addresses(ban_list, addresses, governing_saison_id=governing_saison_id, session=session)
        refuse(find_kontakt_barred_refusal(barred=bool(barred)))

    # A 404 rather than a 422, as a malformed path id answers: the segment names no seat any
    # application has, which is a miss and not a body fault.
    rolle = seat_named(seat)
    if rolle is None:
        raise DocumentNotFoundError()

    def seats_judged_on(stored: Mapping[str, Any]) -> tuple[FLKontaktRolle, ...]:
        """Refuse, or answer every seat the fresh link will open: the pressed one and the mirror the confirmation also answers."""

        kontakte, confirmations = stored.get("kontakte"), stored.get("confirmations")
        refuse(find_triage_refusal(status=str(stored["status"])))
        refuse(find_already_answered_refusal(kontakte=kontakte, confirmations=confirmations, seat=rolle))

        # One entry left standing would keep the replaced address's link alive. The mirror is judged
        # too: `paired_seat` adds a seat that merely STANDS.
        other = paired_seat(kontakte=kontakte, confirmations=confirmations, seat=rolle)
        if other is None:
            return (rolle,)

        refuse(find_already_answered_refusal(kontakte=kontakte, confirmations=confirmations, seat=other))

        return (rolle, other)

    seats = seats_judged_on(bewerbung_raw)
    confirmation_deadline = confirmation_deadline_from(today=today)
    # Outside the callback, so a retried transaction owes the press's one mail and a second press its own.
    nonce = secrets.token_hex(8)

    # The judgement is in the FILTER, so a decision or an answer landing after the read leaves the row
    # untouched rather than overwritten.
    async def mint_on(seats: tuple[FLKontaktRolle, ...]) -> Mapping[str, Any]:
        async def mint_unless_barred(session: AsyncClientSession) -> Mapping[str, Any]:
            """Write, then ask the ban list of the addresses the write found; a barred one aborts the write."""

            governing_saison_id = await ban_list_saison(ban_list, session=session)
            matched = await patch_one_in_db(
                collection=bewerbungen_collection,
                db_filter=build_erneut_filter(bewerbung_id=bewerbung_id, seats=seats),
                update=compose_erneut_update(seats=seats, today=today),
                session=session,
                expected_version=None,
                return_document=ReturnDocument.BEFORE,
            )
            # Asked of what the write found, so a seat write landing after the first read is judged at the
            # address this link is mailed to.
            await refuse_a_barred_address(matched, seats, governing_saison_id=governing_saison_id, session=session)
            await enqueue_mails(
                outbox_collection=outbox_collection,
                session=session,
                mails=[
                    owed_link(
                        bewerbung_id=bewerbung_id,
                        kontakte=matched["kontakte"],
                        seats=seats,
                        saison_id=str(matched["saison_id"]),
                        schule=await _schule_text(bewerbung_raw=matched, teams_collection=teams_collection, session=session),
                        deadline=confirmation_deadline,
                        key=_key(bewerbung_id, "resend", seats[0], nonce),
                    )
                ],
                now=germany_now,
            )

            return matched

        async with transaction_session(db) as session:
            return await session.with_transaction(mint_unless_barred)

    try:
        matched = await mint_on(seats)
    except DocumentNotFoundError:
        # The judgement above was read outside the write's transaction, so a decision or an answer
        # landing between them leaves the filter matching nothing. Judged again rather than answered as
        # a miss, so the refusal names what moved.
        reread = await pull_one_from_db(collection=bewerbungen_collection, db_filter=db_filter, projection=judged)
        seats = seats_judged_on(reread)
        # A re-read that passes is a row that moved back between the two, a decline and then a seat write:
        # one more write, whose own miss is the only one answering 404.
        matched = await mint_on(seats)

    return FLBewerbungEinwilligungResendResponse(
        rolle=rolle, email=str(matched["kontakte"][rolle]["email"]), rollen=list(seats), confirmation_deadline=confirmation_deadline
    )


@router.post(
    f"{by_id('bewerbung_id')}/kontakte/{{seat}}",
    response_model=FLBewerbungKontaktSeatResponse,
    summary="Write the person one contact seat holds and mail them a fresh link",
)
async def post_kontakt_seat(
    bewerbung_id: CustomRouteObjectId,
    seat: str,
    sitz_data: Annotated[FLBewerbungKontaktSeatPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    teams_collection: TeamsCollection,
    outbox_collection: OutboxCollection,
    ban_list: BanListLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLBewerbungKontaktSeatResponse:
    """
    „Sitz bearbeiten“: write the person into one seat and owe them their link in the same transaction.

    One write judged by the seat's state. A standing seat's person is replaced or their address corrected, a seat a
    Widerspruch emptied is filled, and a confirmed seat's person gives way, the record written being administrative
    and confirming nothing: the person's own link is what asks them, and an acceptance waits on that answer as it
    waits on the other two. Where one person holds two seats both are written from one press and one link answers
    both. The link the seat's last holder was sent opens nothing afterwards, and that seat's 14 days restart from today
    EVEN WHERE THEY HAD PASSED: left where they were, the person would be handed a link that opens nothing.

    Refused on a stale `version` (`version_stale`), on an application already decided (`bewerbung_already_decided`), on
    a seat erased at its person's request, the claimed mirror included (`bewerbung_seat_already_answered`), and on an
    address or a number another contact person on this application already holds (`bewerbung_kontakt_email_taken`,
    `bewerbung_kontakt_phone_taken`), or an address the ban list holds (`bewerbung_kontakt_barred`). A path naming no
    seat is a 404.
    """

    # Outside the transaction, whose callback may run again, as the referee editor reads both
    # (`app/api/sperrliste/crud.py :: address_is_barred`).
    hashed = ban_list.hash_of(sitz_data.email)
    governing_saison_id = await ban_list_saison(ban_list)
    # Outside the callback, for the re-send's reason.
    nonce = secrets.token_hex(8)

    async def seat_and_mint(session: AsyncClientSession) -> FLBewerbungKontaktSeatResponse:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it."""

        db_filter = {"_id": bewerbung_id}
        bewerbung_raw = await pull_one_from_db(
            collection=bewerbungen_collection,
            db_filter=db_filter,
            projection=["status", "kontakte", "confirmations", "saison_id", "schule", "team_id"],
            session=session,
        )

        # A 404 rather than a 422, as the re-send's is: the segment names no seat any application has.
        rolle = seat_named(seat)
        if rolle is None:
            raise DocumentNotFoundError()

        kontakte, confirmations = bewerbung_raw.get("kontakte"), bewerbung_raw.get("confirmations")
        refuse(find_triage_refusal(status=str(bewerbung_raw["status"])))

        # The pair is claimed rather than read off the slots, so it holds on the emptied seats too, and it is judged
        # with the pressed seat: `claimed_pair_seat` adds a mirror in any state at all.
        other = claimed_pair_seat(kontakte=kontakte, seat=rolle)
        seats = (rolle,) if other is None else (rolle, other)

        refuse(find_seat_write_refusal(confirmations=confirmations, seats=seats))

        # Asked over the seats this write does NOT reach: a mirrored pair is one person, and comparing them against
        # each other would refuse every such write.
        refuse(find_seat_contact_refusal(kontakte=kontakte, seats=seats, email=sitz_data.email, phone=sitz_data.phone))
        barred = await hash_barred(ban_list, hashed, governing_saison_id=governing_saison_id, session=session)
        refuse(find_kontakt_barred_refusal(barred=barred))

        confirmation_deadline = confirmation_deadline_from(today=today)

        after = await patch_one_in_db(
            collection=bewerbungen_collection,
            db_filter=db_filter,
            update=compose_kontakt_seat_update(
                seats=seats,
                # The person as the slot stores them, so a sixth field added here reaches storage.
                person=sitz_data.model_dump(mode="json", exclude={"version"}),
                today=today,
                confirmations=confirmations,
            ),
            session=session,
            expected_version=sitz_data.version,
            return_document=ReturnDocument.AFTER,
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
                    schule=await _schule_text(bewerbung_raw=bewerbung_raw, teams_collection=teams_collection, session=session),
                    deadline=confirmation_deadline,
                    key=_key(bewerbung_id, "seat", seats[0], nonce),
                )
            ],
            now=germany_now,
        )

        return FLBewerbungKontaktSeatResponse(email=sitz_data.email, rollen=list(seats), confirmation_deadline=confirmation_deadline)

    # A transaction where the re-send beside it takes none: this write moves a person as well as a credential, so a
    # decision landing mid-request must leave neither half standing.
    async with transaction_session(db) as session:
        return await session.with_transaction(seat_and_mint)
