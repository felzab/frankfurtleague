import asyncio
import secrets
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Annotated, Any, get_args

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
    FLBewerbungenFilterParams,
    FLBewerbungenListResponse,
    FLBewerbungKontaktEmailPayload,
    FLBewerbungKontaktEmailResponse,
    FLBewerbungKontaktSeatPayload,
    FLBewerbungListAdapter,
    FLBewerbungSingleResponse,
    FLBewerbungStatus,
    FLDeclineBewerbungPayload,
    FLDeclineBewerbungResponse,
)
from app.api.bewerbungen.services import (
    WITHOUT_TOKEN_HASHES,
    bestaetigungsfrist_from,
    bestaetigungsfrist_passed,
    build_bewerbungen_saison_term,
    build_bewerbungen_saisonbezug_terms,
    build_bewerbungen_sort,
    build_bewerbungen_status_term,
    build_dubletten_pipeline,
    build_erneut_filter,
    claimed_pair_seat,
    compose_erneut_update,
    compose_kontakt_email_update,
    compose_kontakt_seat_update,
    compose_new_club,
    dubletten_schluessel_of,
    entscheider_adressen,
    find_acceptance_subject_refusal,
    find_already_answered_refusal,
    find_kontakt_email_refusal,
    find_kontakt_gesperrt_refusal,
    find_new_club_refusal,
    find_reseat_refusal,
    find_sitz_inhaber_refusal,
    find_triage_refusal,
    find_unconfirmed_kontakte_refusal,
    mit_vorenthaltener_entscheidung,
    mit_zustellung,
    owed_link,
    paired_seat,
    parse_new_club,
    personen_mit_adresse,
    seat_named,
)
from app.api.einwilligung.services import find_fassung_refusal
from app.api.outbox.crud import states_of
from app.api.outbox.schemas import FLBewerbungAbsageData, FLBewerbungZusageData
from app.api.outbox.services import OwedMail, enqueue_mails
from app.api.saisons.schemas import FLSaisonRules
from app.api.sperrliste.lookup import BanList, SperrlisteLookup, adressen_gesperrt, hash_gesperrt, sperrliste_saison
from app.api.teams.crud import pull_a_club_to_enter, refuse_a_full_gruppe
from app.api.teams.services import find_club_entry_refusal
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, insert_live, patch_one_in_db, post_one_to_db, pull_many_from_db, pull_one_from_db, refuse
from app.core.dependencies import (
    BewerbungenCollection,
    DBClient,
    OutboxCollection,
    SaisonsCollection,
    SaisonTeamsCollection,
    TeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.routing import by_id
from app.core.security import bind_actor, get_actor_email, verify_access_admin, verify_step_up
from app.core.transactions import transaction_session
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

# `Query()` and never `Depends()`: on a `Depends()` model a `list` field is read as a BODY field, so
# it publishes no query parameter at all and answers `None` whatever the query string holds.
FLBewerbungenFilters = Annotated[FLBewerbungenFilterParams, Query()]


async def _as_served(
    rows: Sequence[Mapping[str, Any]],
    *,
    sperrliste: BanList,
    postausgang_collection: AsyncCollection,
) -> list[dict[str, Any]]:
    # Concurrently: the ban list and the Postausgang are two collections, and neither read waits on the other.
    barred, lagen = await asyncio.gather(
        adressen_gesperrt(sperrliste, entscheider_adressen(rows)),
        states_of(outbox_collection=postausgang_collection, collection=Collection.BEWERBUNGEN, ids=[row["_id"] for row in rows]),
    )

    return [mit_zustellung(mit_vorenthaltener_entscheidung(row, barred), lagen) for row in rows]


@router.get("", response_model=FLBewerbungenListResponse, summary="List Bewerbungen")
async def get_bewerbungen(
    bewerbungen_collection: BewerbungenCollection,
    postausgang_collection: OutboxCollection,
    sperrliste: SperrlisteLookup,
    filters: FLBewerbungenFilters,
) -> FLBewerbungenListResponse:
    """Every application, newest first, narrowed by `saison_id` with `saison_reference` and by any of the three statuses.

    `complete` is false where more rows exist than one read serves, and each count covers the values its facet left out.
    `duplicates_key` names every key two or more open applications share: the season and the club id or upper-cased
    Kürzel, joined by `team` or `kuerzel`. A barred administrator is served as `null` beside `decision.by_barred`.
    """

    # The season term alone, because each count answers for the status it names: counted with the
    # request's own status term applied, every status the caller did not ask for would read zero.
    beyond_status = build_bewerbungen_saison_term(saison_id=filters.saison_id, saisonbezug=filters.saison_reference)
    # And the mirror: a relation counted with the season term applied would read zero for the side
    # the read left out, leaving the other season's queue reachable from nothing on this page.
    beyond_saison = build_bewerbungen_status_term(filters.status)
    saisonbezug_terms = build_bewerbungen_saisonbezug_terms(saison_id=filters.saison_id)

    # Concurrently, so five counts and the collision pass cost one round trip's latency rather than six.
    counted, bezogen, cells = await asyncio.gather(
        asyncio.gather(
            # `bewerbungen_saison_id_status_queue` carries both terms, so a count walks keys and
            # fetches nothing; measured, the complement loses the COUNT_SCAN and stays an IXSCAN.
            *(bewerbungen_collection.count_documents({**beyond_status, "status": status}) for status in get_args(FLBewerbungStatus.__value__))
        ),
        asyncio.gather(*(bewerbungen_collection.count_documents({**beyond_saison, **term}) for term in saisonbezug_terms.values())),
        aggregate_many_from_db(collection=bewerbungen_collection, pipeline=build_dubletten_pipeline(beyond_status)),
    )

    # One row over what is served, and the extra never is: it answers whether the list is whole
    # without a count, and counting the filtered set is the unbounded work this read must not do.

    # The projection keeps the token hashes from crossing the wire at all, where the read model
    # would drop them only after they had (`app/api/bewerbungen/public_router.py :: get_schulen`).
    read = await pull_many_from_db(
        collection=bewerbungen_collection,
        db_filter={**beyond_status, **beyond_saison},
        limit=filters.limit + 1,
        sort_by=build_bewerbungen_sort(sort_by=filters.sort_by, order=filters.order),
        projection=WITHOUT_TOKEN_HASHES,
    )

    # Sliced before validation, so the probe row is never parsed and never reaches the wire.
    served = read[: filters.limit]

    # Degrades rather than refusing: the rows are written by an anonymous public form, so a tripwire
    # would hand whoever writes them the power to 500 this page. Answering short leaves the
    # administrator a usable list, and `complete` reports the cut.
    return FLBewerbungenListResponse(
        bewerbungen=FLBewerbungListAdapter.validate_python(
            await _as_served(served, sperrliste=sperrliste, postausgang_collection=postausgang_collection)
        ),
        complete=len(read) <= filters.limit,
        count_per_status=dict(zip(get_args(FLBewerbungStatus.__value__), counted, strict=True)),
        count_per_saison_reference=dict(zip(saisonbezug_terms, bezogen, strict=True)),
        duplicates_key=dubletten_schluessel_of(cells),
    )


@router.get(by_id("bewerbung_id"), response_model=FLBewerbungSingleResponse, summary="One Bewerbung")
async def get_bewerbung(
    bewerbung_id: CustomRouteObjectId,
    bewerbungen_collection: BewerbungenCollection,
    postausgang_collection: OutboxCollection,
    sperrliste: SperrlisteLookup,
    today: str = Depends(get_german_date_str),
) -> FLBewerbungSingleResponse:
    """One application, its decision's administrator withheld as the list withholds it.

    `confirmation_deadline_expired` says whether its confirmation deadline has passed today.
    """

    bewerbung_raw = await pull_one_from_db(collection=bewerbungen_collection, db_filter={"_id": bewerbung_id}, projection=WITHOUT_TOKEN_HASHES)
    [served] = await _as_served([bewerbung_raw], sperrliste=sperrliste, postausgang_collection=postausgang_collection)

    return FLBewerbungSingleResponse(
        bewerbung=FLBewerbung(**served),
        confirmation_deadline_expired=bestaetigungsfrist_passed(confirmation_deadline=bewerbung_raw.get("confirmation_deadline"), today=today),
    )


def _entscheidung(*, today: str, von: str, grund: str | None) -> dict[str, Any]:
    """The decision block both endpoints write, so the two cannot spell one field differently."""

    return {"made_at": today, "von": von, "grund": grund}


async def _schule_text(*, bewerbung_raw: Mapping[str, Any], teams_collection: AsyncCollection, session: AsyncClientSession) -> str:
    """The school a mail names: as submitted, or the picked club as the league holds it."""

    schule = bewerbung_raw.get("schule")
    if isinstance(schule, Mapping):
        return str(schule.get("team_name") or "")

    club = await teams_collection.find_one({"_id": bewerbung_raw.get("team_id")}, {"name": 1}, session=session)

    return str((club or {}).get("name") or "")


def _schluessel(bewerbung_id: Any, *teile: str) -> str:
    return "/".join([str(Collection.BEWERBUNGEN), str(bewerbung_id), *teile])


@router.post(
    f"{by_id('bewerbung_id')}/accept",
    response_model=FLAcceptBewerbungResponse,
    summary="Accept a Bewerbung and enter the school into the season",
    dependencies=[Depends(verify_step_up)],
)
async def accept_bewerbung(
    bewerbung_id: CustomRouteObjectId,
    annahme_data: Annotated[FLAcceptBewerbungPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    postausgang_collection: OutboxCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    von: str = Depends(get_actor_email),
    germany_now: datetime = Depends(get_germany_now),
) -> FLAcceptBewerbungResponse:
    """
    Accept an application, creating the school's club where the applicant proposed a new one.

    IRREVERSIBLE. `saison_teams` has no DELETE, so a club entered in error leaves only through an
    `austritt`, which is a public record carrying a stated reason. Refused while any contact person has yet to
    confirm their own seat (`bewerbung_kontakte_unconfirmed`), so every seat enters the season as its person confirmed it.
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

        # Read before the count, as `post_saison_team` reads it: a club's standing in the league is
        # not repaired by picking another group, so nobody is handed a capacity figure first. A
        # school being created cannot have left, so only a PICKED club is checked.
        if schule is None:
            team_raw = await pull_a_club_to_enter(teams_collection=teams_collection, team_id=picked_team_id, session=session)
            refuse(find_club_entry_refusal(inactive_since=team_raw.get("inactive_since")))
            # The club's OWN `_id`, never the application's copy of it: this read is what proves the
            # club exists, so the id the junction row carries comes from the document it resolved.
            picked_club = team_raw["_id"]
            name, shorthand = str(team_raw["name"]), str(team_raw["shorthand"])
        else:
            # Composed beside the guard that judges it, and reaching for no field of the application
            # itself: nothing here may raise before the refusal below has had its say.
            new_club = compose_new_club(schule=schule)
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
                # application was, and `/bereich/admin/kontakte` reads them from here. Copied whole, each seat
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
            update={"$set": {"status": "accepted", "team_id": team_id, "decision": _entscheidung(today=today, von=von, grund=None)}},
            session=session,
            return_document=ReturnDocument.BEFORE,
        )
        await enqueue_mails(
            outbox_collection=postausgang_collection,
            session=session,
            mails=[
                OwedMail(
                    key=_schluessel(bewerbung_id, "zusage", seats[0]),
                    an=email,
                    data=FLBewerbungZusageData(
                        art="bewerbung_zusage",
                        team=name,
                        saison_id=saison_id,
                        rollen=seats,
                        gruppe=annahme_data.gruppe,
                        trikot_farbe=annahme_data.trikot_farbe,
                        # As the school submitted it, which the acceptance's payload never carries.
                        wunschgegner=bewerbung_raw.get("wunschgegner"),
                    ),
                )
                for email, seats in personen_mit_adresse(kontakte=bewerbung_raw.get("kontakte"))
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
    dependencies=[Depends(verify_step_up)],
)
async def decline_bewerbung(
    bewerbung_id: CustomRouteObjectId,
    ablehnung_data: Annotated[FLDeclineBewerbungPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    teams_collection: TeamsCollection,
    postausgang_collection: OutboxCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    von: str = Depends(get_actor_email),
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
            update={"$set": {"status": "declined", "decision": _entscheidung(today=today, von=von, grund=ablehnung_data.grund)}},
            session=session,
            return_document=ReturnDocument.BEFORE,
        )
        team = await _schule_text(bewerbung_raw=stored_raw, teams_collection=teams_collection, session=session)
        await enqueue_mails(
            outbox_collection=postausgang_collection,
            session=session,
            mails=[
                OwedMail(
                    key=_schluessel(bewerbung_id, "absage", seats[0]),
                    an=email,
                    data=FLBewerbungAbsageData(
                        art="bewerbung_absage", team=team, saison_id=str(stored_raw["saison_id"]), rollen=seats, grund=ablehnung_data.grund
                    ),
                )
                for email, seats in personen_mit_adresse(kontakte=stored_raw.get("kontakte"))
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
    dependencies=[Depends(verify_step_up)],
)
async def resend_einwilligung(
    bewerbung_id: CustomRouteObjectId,
    seat: str,
    bewerbungen_collection: BewerbungenCollection,
    teams_collection: TeamsCollection,
    postausgang_collection: OutboxCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLBewerbungEinwilligungResendResponse:
    """
    Void one seat's link and owe its person a fresh one in the same transaction; the old link then opens nothing.

    Where one person holds two seats both entries are replaced, so the old links die on both and the one new link answers both.
    The answer names the address and the seats as the write found them, so a correction landing mid-request is where the link goes.
    The application's confirmation deadline restarts from today and the seat's reminder is owed again. The mirrored seat
    is judged with the pressed one, a seat an erasure emptied is refused as an answered one is, and a
    decision, an answer or an erasure landing while the request runs is refused too. A seat whose address the ban list
    holds is refused `bewerbung_kontakt_barred`. A path naming no seat is a 404.
    """

    db_filter = {"_id": bewerbung_id}
    judged = ["status", "kontakte", "confirmations"]
    bewerbung_raw = await pull_one_from_db(collection=bewerbungen_collection, db_filter=db_filter, projection=judged)

    async def refuse_a_barred_address(
        stored: Mapping[str, Any], seats: tuple[FLKontaktRolle, ...], *, massgebliche_saison_id: str | None, session: AsyncClientSession
    ) -> None:
        """Every address the seats the link answers hold, judged as the correction judges the one it writes."""

        kontakte = stored.get("kontakte")
        # Both seats of a pair, which no write path lets hold two addresses: the submission requires the
        # pair's details equal and the correction moves both. Only a hand edit could part them.
        slots = [kontakte.get(held) for held in seats] if isinstance(kontakte, Mapping) else []
        adressen = {str(slot["email"]) for slot in slots if isinstance(slot, Mapping) and slot.get("email")}
        gesperrt = await adressen_gesperrt(sperrliste, adressen, massgebliche_saison_id=massgebliche_saison_id, session=session)
        refuse(find_kontakt_gesperrt_refusal(barred=bool(gesperrt)))

    # A 404 rather than a 422, as a malformed path id answers: the segment names no seat any
    # application has, which is a miss and not a body fault.
    rolle = seat_named(seat)
    if rolle is None:
        raise DocumentNotFoundError()

    def seats_judged_on(stored: Mapping[str, Any]) -> tuple[FLKontaktRolle, ...]:
        """Refuse, or answer every seat the fresh link will open: the pressed one and the mirror the confirmation also answers."""

        kontakte, bestaetigungen = stored.get("kontakte"), stored.get("confirmations")
        refuse(find_triage_refusal(status=str(stored["status"])))
        refuse(find_already_answered_refusal(kontakte=kontakte, confirmations=bestaetigungen, seat=rolle))

        # One entry left standing would keep the replaced address's link alive. The mirror is judged
        # as the correction judges it: `paired_seat` adds a seat that merely STANDS.
        other = paired_seat(kontakte=kontakte, confirmations=bestaetigungen, seat=rolle)
        if other is None:
            return (rolle,)

        refuse(find_already_answered_refusal(kontakte=kontakte, confirmations=bestaetigungen, seat=other))

        return (rolle, other)

    seats = seats_judged_on(bewerbung_raw)
    bestaetigungsfrist = bestaetigungsfrist_from(today=today)
    # Outside the callback, so a retried transaction owes the press's one mail and a second press its own.
    nonce = secrets.token_hex(8)

    # The judgement is in the FILTER, so a decision or an answer landing after the read leaves the row
    # untouched rather than overwritten.
    async def mint_on(seats: tuple[FLKontaktRolle, ...]) -> Mapping[str, Any]:
        async def mint_unless_gesperrt(session: AsyncClientSession) -> Mapping[str, Any]:
            """Write, then ask the ban list of the addresses the write found; a barred one aborts the write."""

            massgebliche_saison_id = await sperrliste_saison(sperrliste, session=session)
            matched = await patch_one_in_db(
                collection=bewerbungen_collection,
                db_filter=build_erneut_filter(bewerbung_id=bewerbung_id, seats=seats),
                update=compose_erneut_update(seats=seats, today=today, confirmation_deadline=bestaetigungsfrist),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )
            # Asked of what the write found, so a correction landing after the first read is judged at the
            # address this link is mailed to.
            await refuse_a_barred_address(matched, seats, massgebliche_saison_id=massgebliche_saison_id, session=session)
            await enqueue_mails(
                outbox_collection=postausgang_collection,
                session=session,
                mails=[
                    owed_link(
                        bewerbung_id=bewerbung_id,
                        kontakte=matched["kontakte"],
                        seats=seats,
                        saison_id=str(matched["saison_id"]),
                        schule=await _schule_text(bewerbung_raw=matched, teams_collection=teams_collection, session=session),
                        frist=bestaetigungsfrist,
                        key=_schluessel(bewerbung_id, "resend", seats[0], nonce),
                    )
                ],
                now=germany_now,
            )

            return matched

        async with transaction_session(db) as session:
            return await session.with_transaction(mint_unless_gesperrt)

    try:
        matched = await mint_on(seats)
    except DocumentNotFoundError:
        # The judgement above was read outside the write's transaction, so a decision or an answer
        # landing between them leaves the filter matching nothing. Judged again rather than answered as
        # a miss, so the refusal names what moved.
        reread = await pull_one_from_db(collection=bewerbungen_collection, db_filter=db_filter, projection=judged)
        seats = seats_judged_on(reread)
        # A re-read that passes is a row that moved back between the two, a decline and then a reseat:
        # one more write, whose own miss is the only one answering 404.
        matched = await mint_on(seats)

    return FLBewerbungEinwilligungResendResponse(
        rolle=rolle, email=str(matched["kontakte"][rolle]["email"]), rollen=list(seats), confirmation_deadline=bestaetigungsfrist
    )


@router.post(
    f"{by_id('bewerbung_id')}/kontakte/{{seat}}/email",
    response_model=FLBewerbungKontaktEmailResponse,
    summary="Correct one contact person's email address and re-send their link",
    dependencies=[Depends(verify_step_up)],
)
async def post_kontakt_email(
    bewerbung_id: CustomRouteObjectId,
    seat: str,
    email_data: Annotated[FLBewerbungKontaktEmailPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    teams_collection: TeamsCollection,
    postausgang_collection: OutboxCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLBewerbungKontaktEmailResponse:
    """
    Write a corrected address onto one seat and owe a fresh link there in the same transaction; the old link then opens nothing.

    The only repair there is for a link the mail provider will not carry: everything else the school typed stays the
    record the decision is taken against. Where one person holds two seats both are corrected, and the confirmation
    deadline restarts from today exactly as a re-send restarts it.

    The fresh link's mail is the seat's last mail, so an application held back from the fourteen-day deletion because
    its notice could not arrive is a deletion candidate again once that mail is not refused.

    Refused on an application already decided (`bewerbung_already_decided`), on any seat this write would reach that is already
    confirmed, already answered with a Widerspruch, or holding nothing to confirm — the mirrored seat included
    (`bewerbung_seat_already_answered`) — on a seat holding another address than `previous_email`, the address the caller's page
    showed, as after a Widerspruch and a reseat (`bewerbung_seat_differently_seated`), and on an address another contact person on this
    application already holds (`bewerbung_kontakt_email_taken`), or that the ban list holds (`bewerbung_kontakt_barred`). A path naming
    no seat is a 404.
    """

    # Outside the transaction, whose callback may run again, as the referee editor reads both
    # (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    gehasht = sperrliste.hash_of(email_data.email)
    massgebliche_saison_id = await sperrliste_saison(sperrliste)
    # Outside the callback, for the re-send's reason.
    nonce = secrets.token_hex(8)

    async def correct_and_mint(session: AsyncClientSession) -> FLBewerbungKontaktEmailResponse:
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

        kontakte, bestaetigungen = bewerbung_raw.get("kontakte"), bewerbung_raw.get("confirmations")
        refuse(find_triage_refusal(status=str(bewerbung_raw["status"])))
        refuse(find_already_answered_refusal(kontakte=kontakte, confirmations=bestaetigungen, seat=rolle))
        # After the answered check, which names an emptied seat more plainly than a holder that moved would.
        refuse(find_sitz_inhaber_refusal(kontakte=kontakte, seat=rolle, previous_email=email_data.previous_email))

        other = paired_seat(kontakte=kontakte, confirmations=bestaetigungen, seat=rolle)
        seats = (rolle,) if other is None else (rolle, other)

        # The MIRROR is judged too: `paired_seat` adds a seat that merely STANDS, and a confirmed one
        # would be re-addressed and handed a link the person's own answer has already spent.
        if other is not None:
            refuse(find_already_answered_refusal(kontakte=kontakte, confirmations=bestaetigungen, seat=other))

        # Asked over the seats this write does NOT reach, so a mirrored pair moving to one new address
        # together is not refused for sharing it with itself.
        refuse(find_kontakt_email_refusal(kontakte=kontakte, seats=seats, email=email_data.email))
        gesperrt = await hash_gesperrt(sperrliste, gehasht, massgebliche_saison_id=massgebliche_saison_id, session=session)
        refuse(find_kontakt_gesperrt_refusal(barred=gesperrt))

        bestaetigungsfrist = bestaetigungsfrist_from(today=today)

        after = await patch_one_in_db(
            collection=bewerbungen_collection,
            db_filter=db_filter,
            update=compose_kontakt_email_update(seats=seats, email=email_data.email, today=today, confirmation_deadline=bestaetigungsfrist),
            session=session,
            return_document=ReturnDocument.AFTER,
        )
        await enqueue_mails(
            outbox_collection=postausgang_collection,
            session=session,
            mails=[
                owed_link(
                    bewerbung_id=bewerbung_id,
                    kontakte=after["kontakte"],
                    seats=seats,
                    saison_id=str(bewerbung_raw["saison_id"]),
                    schule=await _schule_text(bewerbung_raw=bewerbung_raw, teams_collection=teams_collection, session=session),
                    frist=bestaetigungsfrist,
                    key=_schluessel(bewerbung_id, "korrektur", seats[0], nonce),
                )
            ],
            now=germany_now,
        )

        return FLBewerbungKontaktEmailResponse(email=email_data.email, rollen=list(seats), confirmation_deadline=bestaetigungsfrist)

    # A transaction where the re-send beside it takes none: this write moves an address as well as a
    # credential, so a decision landing mid-request must leave neither half standing.
    async with transaction_session(db) as session:
        return await session.with_transaction(correct_and_mint)


@router.post(
    f"{by_id('bewerbung_id')}/kontakte/{{seat}}",
    response_model=FLBewerbungKontaktEmailResponse,
    summary="Seat another person where a contact person stepped out",
    dependencies=[Depends(verify_step_up)],
)
async def post_kontakt_seat(
    bewerbung_id: CustomRouteObjectId,
    seat: str,
    sitz_data: Annotated[FLBewerbungKontaktSeatPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    teams_collection: TeamsCollection,
    postausgang_collection: OutboxCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLBewerbungKontaktEmailResponse:
    """
    Write another person into a seat its own holder stepped out of, and owe them their link in the same transaction.

    It runs on an EMPTY seat alone, and the one thing that empties a seat this way is that person's own Widerspruch.
    The record written is administrative and confirms nothing: the new person's own link is what asks them, and an
    acceptance waits on that answer as it waits on the other two. Where one person holds two seats both are filled
    from one press and one link answers both, and both must be empty for either to be written.

    The link the seat's last holder was sent stops opening anything, and the application's confirmation deadline
    restarts from today EVEN WHERE IT HAD PASSED: left where it was, it would hand the new person a link that opens
    nothing, seating them for a confirmation they cannot give.

    Refused on an application already decided (`bewerbung_already_decided`); on any seat this write would reach that nobody
    stepped out of — confirmed, still waiting or erased at its person's request, the claimed mirror included
    (`bewerbung_seat_already_answered`); and on an address another
    contact person on this application already holds (`bewerbung_kontakt_email_taken`), or that the ban list holds
    (`bewerbung_kontakt_barred`); and on any label but the application form's running one (`wording_not_allowed`), the person
    seated being a new acceptance. A path naming no seat is a 404.
    """

    # Outside the transaction, as the correction reads both.
    gehasht = sperrliste.hash_of(sitz_data.email)
    massgebliche_saison_id = await sperrliste_saison(sperrliste)
    # Outside the callback, for the re-send's reason.
    nonce = secrets.token_hex(8)

    async def seat_and_mint(session: AsyncClientSession) -> FLBewerbungKontaktEmailResponse:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it."""

        db_filter = {"_id": bewerbung_id}
        bewerbung_raw = await pull_one_from_db(
            collection=bewerbungen_collection,
            db_filter=db_filter,
            projection=["status", "kontakte", "confirmations", "saison_id", "schule", "team_id"],
            session=session,
        )

        # A 404 rather than a 422, as the correction's is: the segment names no seat any application has.
        rolle = seat_named(seat)
        if rolle is None:
            raise DocumentNotFoundError()

        kontakte, bestaetigungen = bewerbung_raw.get("kontakte"), bewerbung_raw.get("confirmations")
        refuse(find_triage_refusal(status=str(bewerbung_raw["status"])))

        # The pair is claimed rather than read off the slots, so it is composed BEFORE the refusal
        # and judged with the pressed seat: `claimed_pair_seat` adds a mirror in any state at all.
        other = claimed_pair_seat(kontakte=kontakte, seat=rolle)
        seats = (rolle,) if other is None else (rolle, other)

        refuse(find_reseat_refusal(confirmations=bestaetigungen, seats=seats))

        # Asked over the seats this write does NOT reach, as the correction asks it: a mirrored pair
        # is one person, and comparing them against each other would refuse every such reseat.
        refuse(find_kontakt_email_refusal(kontakte=kontakte, seats=seats, email=sitz_data.email))
        gesperrt = await hash_gesperrt(sperrliste, gehasht, massgebliche_saison_id=massgebliche_saison_id, session=session)
        refuse(find_kontakt_gesperrt_refusal(barred=gesperrt))
        # A new acceptance on every seat it fills: the person seated holds no label of their own to keep.
        refuse(find_fassung_refusal(seite="bewerbung", named=dict.fromkeys(seats, sitz_data.text_version)))

        bestaetigungsfrist = bestaetigungsfrist_from(today=today)

        after = await patch_one_in_db(
            collection=bewerbungen_collection,
            db_filter=db_filter,
            update=compose_kontakt_seat_update(
                seats=seats,
                # The label is excluded rather than dropped by the composer: everything left is the
                # person as the slot stores them, so a sixth field added here reaches storage.
                person=sitz_data.model_dump(mode="json", exclude={"text_version"}),
                text_version=sitz_data.text_version,
                today=today,
                confirmation_deadline=bestaetigungsfrist,
            ),
            session=session,
            return_document=ReturnDocument.AFTER,
        )
        await enqueue_mails(
            outbox_collection=postausgang_collection,
            session=session,
            mails=[
                owed_link(
                    bewerbung_id=bewerbung_id,
                    kontakte=after["kontakte"],
                    seats=seats,
                    saison_id=str(bewerbung_raw["saison_id"]),
                    schule=await _schule_text(bewerbung_raw=bewerbung_raw, teams_collection=teams_collection, session=session),
                    frist=bestaetigungsfrist,
                    key=_schluessel(bewerbung_id, "besetzung", seats[0], nonce),
                )
            ],
            now=germany_now,
        )

        return FLBewerbungKontaktEmailResponse(email=sitz_data.email, rollen=list(seats), confirmation_deadline=bestaetigungsfrist)

    # A transaction for the correction's reason: this write seats a person as well as a credential,
    # so a decision landing mid-request must leave neither half standing.
    async with transaction_session(db) as session:
        return await session.with_transaction(seat_and_mint)
