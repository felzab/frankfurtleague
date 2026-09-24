from collections.abc import Mapping
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.schemas import (
    FLAblehnenBewerbungPayload,
    FLAblehnenBewerbungResponse,
    FLAnnehmenBewerbungPayload,
    FLAnnehmenBewerbungResponse,
    FLBewerbung,
    FLBewerbungEinwilligungErneutResponse,
    FLBewerbungKontaktEmailPayload,
    FLBewerbungKontaktEmailResponse,
    FLBewerbungKontaktSitzPayload,
    FLBewerbungKontaktSitzResponse,
    FLKontaktRolle,
)
from app.api.bewerbungen.services import (
    bestaetigungsfrist_from,
    build_erneut_filter,
    claimed_pair_seat,
    compose_erneut_update,
    compose_kontakt_email_update,
    compose_kontakt_seat_update,
    compose_new_club,
    find_acceptance_subject_refusal,
    find_already_answered_refusal,
    find_kontakt_email_refusal,
    find_new_club_refusal,
    find_reseat_refusal,
    find_triage_refusal,
    find_unconfirmed_kontakte_refusal,
    mint_token,
    paired_seat,
    parse_new_club,
    seat_named,
)
from app.api.saisons.cache import dropping_the_saison_cache
from app.api.saisons.schemas import FLSaisonRules
from app.api.teams.crud import pull_a_club_to_enter, refuse_a_full_gruppe
from app.api.teams.services import compose_kontakte_at_entry, find_club_entry_refusal
from app.core.config import API_VERSION
from app.core.crud import insert_live, patch_one_in_db, post_one_to_db, pull_one_from_db, refuse
from app.core.dependencies import (
    BewerbungenCollection,
    DBClient,
    SaisonsCollection,
    SaisonTeamsCollection,
    TeamsCollection,
    get_german_date_str,
)
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import bind_actor, get_actor_email, verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId
from app.shared.schemas.responses import FLFailureBody

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/bewerbungen",
    dependencies=[Depends(verify_access_admin), Depends(bind_actor)],
)


def _entscheidung(*, today: str, von: str, grund: str | None) -> dict[str, Any]:
    """The decision block both endpoints write, so the two cannot spell one field differently."""

    return {"getroffen_am": today, "von": von, "grund": grund}


@router.post(
    f"{by_id('bewerbung_id')}/annehmen",
    response_model=FLAnnehmenBewerbungResponse,
    summary="Accept a Bewerbung and enter the school into the season",
    responses={409: {"model": FLFailureBody}},
)
async def annehmen_bewerbung(
    bewerbung_id: CustomRouteObjectId,
    annahme_data: Annotated[FLAnnehmenBewerbungPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    von: str = Depends(get_actor_email),
) -> FLAnnehmenBewerbungResponse:
    """
    Accept an application, creating the school's club where the applicant proposed a new one.

    IRREVERSIBLE. `saison_teams` has no DELETE, so a club entered in error leaves only through an
    `austritt`, which is a public record carrying a stated reason. Refused while any contact person has yet to
    confirm their own seat (`REQ-BEWERBUNG-013`); an application stored before the confirmation flow carries no
    confirmation block and is not held to it. A seat of such an application enters the season without the birthdate
    the applicant gave for it, and recorded as entered on that person's behalf: a birthdate is the seat holder's own
    to state.
    """

    async def accept_and_enter_the_school(session: AsyncClientSession) -> FLAnnehmenBewerbungResponse:
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
        refuse(find_unconfirmed_kontakte_refusal(kontakte=bewerbung_raw.get("kontakte"), bestaetigungen=bewerbung_raw.get("bestaetigungen")))

        saison_id = str(bewerbung_raw["saison_id"])
        # In-session, as the season's own patch reads it: `activate_saison` moves `status` in a
        # transaction of its own, and entry is refused outside `future` (`REQ-ENTER-001`).
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
                # application was, and `/admin/kontakte` reads them from here. Composed, never copied:
                # a pre-flow application's dates are nobody's own (`docs/backend/spec.md :: I141`).
                "kontakte": compose_kontakte_at_entry(kontakte=bewerbung_raw["kontakte"]),
                # Copied rather than joined on read (`docs/backend/spec.md :: I95`).
                "name": name,
                "shorthand": shorthand,
            },
            session=session,
        )

        updated_raw = await patch_one_in_db(
            collection=bewerbungen_collection,
            # The status is in the FILTER. The 404 a miss answers -- not the decline's 409 -- is unreachable
            # while this patch is the last write here, and wrong the moment it is not; the repair then is a
            # re-read off no session, which sees `eingereicht` anyway.
            db_filter={"_id": bewerbung_id, "status": "eingereicht"},
            # `team_id` too: a new school's application named none until this write, and without it
            # nothing joins the accepted application to the club it produced.
            update={"$set": {"status": "angenommen", "team_id": team_id, "entscheidung": _entscheidung(today=today, von=von, grund=None)}},
            session=session,
            return_document=ReturnDocument.AFTER,
        )

        return FLAnnehmenBewerbungResponse(
            updated_document=FLBewerbung(**updated_raw),
            team_id=team_id,
            created_team=schule is not None,
            saison_id=saison_id,
            gruppe=annahme_data.gruppe,
            trikot_farbe=annahme_data.trikot_farbe,
        )

    # Whatever field the refusal helper's own write moved: every season write drops the cache
    # (`docs/backend/spec.md :: I131`).
    with dropping_the_saison_cache():
        # `with_transaction`, not a bare `start_transaction`: the callback re-reads everything it judges,
        # so a retry after a write conflict judges the season as it stands then rather than as it stood.
        async with db.start_session() as session:
            accepted = await session.with_transaction(accept_and_enter_the_school)

    return accepted


@router.post(
    f"{by_id('bewerbung_id')}/ablehnen",
    response_model=FLAblehnenBewerbungResponse,
    summary="Decline a Bewerbung",
    responses={409: {"model": FLFailureBody}},
)
async def ablehnen_bewerbung(
    bewerbung_id: CustomRouteObjectId,
    ablehnung_data: Annotated[FLAblehnenBewerbungPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    today: str = Depends(get_german_date_str),
    von: str = Depends(get_actor_email),
) -> FLAblehnenBewerbungResponse:
    """
    Decline an application, recording who decided and the reason they gave.

    The submission itself is untouched: a decline moves `status` and `entscheidung` and nothing else,
    so what the school wrote stays the record the decision was taken against.
    """

    stored_raw = await pull_one_from_db(collection=bewerbungen_collection, db_filter={"_id": bewerbung_id}, projection=["status"])
    refuse(find_triage_refusal(status=str(stored_raw["status"])))

    # The status is in the FILTER, so the write is the guard: two administrators declining at once
    # would both mail the applicants, and one `grund` would survive. `post_saison_team` keeps its
    # race, which costs a planning bound and mails nobody.
    try:
        updated_raw = await patch_one_in_db(
            collection=bewerbungen_collection,
            db_filter={"_id": bewerbung_id, "status": "eingereicht"},
            update={"$set": {"status": "abgelehnt", "entscheidung": _entscheidung(today=today, von=von, grund=ablehnung_data.grund)}},
            return_document=ReturnDocument.AFTER,
        )
    except DocumentNotFoundException:
        # Three ways here: a decision landed between the read and the write, the row is gone, or the
        # write landed and the row went before `patch_one_in_db` re-read its echo. The re-read tells
        # them apart, so only an application no document names keeps the 404.
        raced_raw = await pull_one_from_db(collection=bewerbungen_collection, db_filter={"_id": bewerbung_id}, projection=["status"])
        refuse(find_triage_refusal(status=str(raced_raw["status"])))

        raise

    return FLAblehnenBewerbungResponse(updated_document=FLBewerbung(**updated_raw))


@router.post(
    f"{by_id('bewerbung_id')}/einwilligung/{{seat}}/erneut",
    response_model=FLBewerbungEinwilligungErneutResponse,
    summary="Re-send one seat's confirmation link",
    responses={409: {"model": FLFailureBody}},
)
async def erneut_einwilligung(
    bewerbung_id: CustomRouteObjectId,
    seat: str,
    bewerbungen_collection: BewerbungenCollection,
    today: str = Depends(get_german_date_str),
) -> FLBewerbungEinwilligungErneutResponse:
    """
    Mint a fresh link for one seat and answer it raw, for the caller to mail; the old link then opens nothing.

    Where one person holds two seats both entries are replaced, so the old links die on both and the one new link answers both.
    The answer names the address and the seats as the write found them, so a correction landing mid-request is where the link goes.
    The application's confirmation deadline restarts from today and the seat's reminder is owed again. Refused on an
    application already decided (`REQ-BEWERBUNG-001`) and on any seat the link would open that is already confirmed
    or declined, or one an application stored before the confirmation flow holds — the mirrored seat included
    (`REQ-BEWERBUNG-011`). A decision, an answer or an erasure landing while the request runs is refused the same way.
    A path naming no seat is a 404.
    """

    db_filter = {"_id": bewerbung_id}
    judged = ["status", "kontakte", "bestaetigungen"]
    bewerbung_raw = await pull_one_from_db(collection=bewerbungen_collection, db_filter=db_filter, projection=judged)

    # A 404 rather than a 422, as a malformed path id answers: the segment names no seat any
    # application has, which is a miss and not a body fault.
    rolle = seat_named(seat)
    if rolle is None:
        raise DocumentNotFoundException(filter={**db_filter, "seat": seat}, error_code=DOCUMENT_NOT_FOUND)

    def seats_judged_on(stored: Mapping[str, Any]) -> tuple[FLKontaktRolle, ...]:
        """Refuse, or answer every seat the fresh link will open: the pressed one and the mirror the confirmation also answers."""

        kontakte, bestaetigungen = stored.get("kontakte"), stored.get("bestaetigungen")
        refuse(find_triage_refusal(status=str(stored["status"])))
        refuse(find_already_answered_refusal(kontakte=kontakte, bestaetigungen=bestaetigungen, seat=rolle))

        # One entry left standing would keep the replaced address's link alive. The mirror is judged
        # as the correction judges it: `paired_seat` adds a seat that merely STANDS.
        other = paired_seat(kontakte=kontakte, bestaetigungen=bestaetigungen, seat=rolle)
        if other is None:
            return (rolle,)

        refuse(find_already_answered_refusal(kontakte=kontakte, bestaetigungen=bestaetigungen, seat=other))

        return (rolle, other)

    seats = seats_judged_on(bewerbung_raw)
    raw, token_hash = mint_token()
    bestaetigungsfrist = bestaetigungsfrist_from(today=today)

    # The judgement is in the FILTER, so a decision or an answer landing after the read leaves the row
    # untouched rather than overwritten; a transaction, as the correction takes, adds nothing here.
    async def mint_on(seats: tuple[FLKontaktRolle, ...]) -> Mapping[str, Any]:
        return await patch_one_in_db(
            collection=bewerbungen_collection,
            db_filter=build_erneut_filter(bewerbung_id=bewerbung_id, seats=seats),
            update=compose_erneut_update(seats=seats, token_hash=token_hash, today=today, bestaetigungsfrist=bestaetigungsfrist),
            return_document=ReturnDocument.BEFORE,
        )

    try:
        matched = await mint_on(seats)
    except DocumentNotFoundException:
        # Judged again rather than answered as a miss, as the decline answers its race
        # (`app/api/bewerbungen/admin_router.py :: ablehnen_bewerbung`), so a link is refused for the
        # reason it is refused.
        seats = seats_judged_on(await pull_one_from_db(collection=bewerbungen_collection, db_filter=db_filter, projection=judged))
        # A re-read that passes is a row that moved back between the two, a decline and then a reseat:
        # one more write, whose own miss is the only one answering 404.
        matched = await mint_on(seats)

    return FLBewerbungEinwilligungErneutResponse(
        token=raw, rolle=rolle, email=str(matched["kontakte"][rolle]["email"]), rollen=list(seats), bestaetigungsfrist=bestaetigungsfrist
    )


@router.post(
    f"{by_id('bewerbung_id')}/kontakte/{{seat}}/email",
    response_model=FLBewerbungKontaktEmailResponse,
    summary="Correct one contact person's email address and re-send their link",
    responses={409: {"model": FLFailureBody}},
)
async def korrigiere_kontakt_email(
    bewerbung_id: CustomRouteObjectId,
    seat: str,
    email_data: Annotated[FLBewerbungKontaktEmailPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLBewerbungKontaktEmailResponse:
    """
    Write a corrected address onto one seat and mint the fresh link to mail there; the old link then opens nothing.

    The only repair there is for a link the mail provider will not carry: everything else the school typed stays the
    record the decision is taken against. Where one person holds two seats both are corrected, and the confirmation
    deadline restarts from today exactly as a re-send restarts it.

    The seat's delivery state goes with the entry it sat in, so an application held back from the fourteen-day
    deletion because its notice could not arrive is a deletion candidate again once the corrected link is answered
    for or its deadline passes. Refused on an application already decided (`REQ-BEWERBUNG-001`), on any seat this
    write would reach that is already confirmed, already answered with a Widerspruch, or holding nothing to confirm
    — the mirrored seat included (`REQ-BEWERBUNG-011`) — and on an address another contact person on this
    application already holds (`REQ-BEWERBUNG-014`). A path naming no seat is a 404.
    """

    async def correct_and_mint(session: AsyncClientSession) -> FLBewerbungKontaktEmailResponse:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it."""

        db_filter = {"_id": bewerbung_id}
        bewerbung_raw = await pull_one_from_db(
            collection=bewerbungen_collection, db_filter=db_filter, projection=["status", "kontakte", "bestaetigungen"], session=session
        )

        # A 404 rather than a 422, as the re-send's is: the segment names no seat any application has.
        rolle = seat_named(seat)
        if rolle is None:
            raise DocumentNotFoundException(filter={**db_filter, "seat": seat}, error_code=DOCUMENT_NOT_FOUND)

        kontakte, bestaetigungen = bewerbung_raw.get("kontakte"), bewerbung_raw.get("bestaetigungen")
        refuse(find_triage_refusal(status=str(bewerbung_raw["status"])))
        refuse(find_already_answered_refusal(kontakte=kontakte, bestaetigungen=bestaetigungen, seat=rolle))

        other = paired_seat(kontakte=kontakte, bestaetigungen=bestaetigungen, seat=rolle)
        seats = (rolle,) if other is None else (rolle, other)

        # The MIRROR is judged too: `paired_seat` adds a seat that merely STANDS, and a confirmed one
        # would be re-addressed and handed a link the person's own answer has already spent.
        if other is not None:
            refuse(find_already_answered_refusal(kontakte=kontakte, bestaetigungen=bestaetigungen, seat=other))

        # Asked over the seats this write does NOT reach, so a mirrored pair moving to one new address
        # together is not refused for sharing it with itself.
        refuse(find_kontakt_email_refusal(kontakte=kontakte, seats=seats, email=email_data.email))

        raw, token_hash = mint_token()
        bestaetigungsfrist = bestaetigungsfrist_from(today=today)

        await patch_one_in_db(
            collection=bewerbungen_collection,
            db_filter=db_filter,
            update=compose_kontakt_email_update(
                seats=seats, email=email_data.email, token_hash=token_hash, today=today, bestaetigungsfrist=bestaetigungsfrist
            ),
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

        return FLBewerbungKontaktEmailResponse(email=email_data.email, rollen=list(seats), token=raw, bestaetigungsfrist=bestaetigungsfrist)

    # A transaction where the re-send beside it takes none: this write moves an address as well as a
    # credential, so a decision landing mid-request must leave neither half standing.
    async with db.start_session() as session:
        return await session.with_transaction(correct_and_mint)


@router.post(
    f"{by_id('bewerbung_id')}/kontakte/{{seat}}",
    response_model=FLBewerbungKontaktSitzResponse,
    summary="Seat another person where a contact person stepped out",
    responses={409: {"model": FLFailureBody}},
)
async def besetze_kontakt_sitz(
    bewerbung_id: CustomRouteObjectId,
    seat: str,
    sitz_data: Annotated[FLBewerbungKontaktSitzPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLBewerbungKontaktSitzResponse:
    """
    Write another person into a seat its own holder stepped out of, and mint the fresh link to mail them.

    It runs on an EMPTY seat alone, and the one thing that empties a seat this way is that person's own Widerspruch.
    The record written is administrative and confirms nothing: the new person's own link is what asks them, and an
    acceptance waits on that answer as it waits on the other two. Where one person holds two seats both are filled
    from one press and one link answers both, and both must be empty for either to be written.

    The link the seat's last holder was sent stops opening anything, and the application's confirmation deadline
    restarts from today EVEN WHERE IT HAD PASSED: left where it was, it would hand the new person a link that opens
    nothing, seating them for a confirmation they cannot give.

    Refused on an application already decided (`REQ-BEWERBUNG-001`); on any seat this write would reach that nobody
    stepped out of — confirmed, still waiting, erased at its person's request, or held by an application stored
    before the confirmation flow, the claimed mirror included (`REQ-BEWERBUNG-011`); and on an address another
    contact person on this application already holds (`REQ-BEWERBUNG-014`). A path naming no seat is a 404.
    """

    async def seat_and_mint(session: AsyncClientSession) -> FLBewerbungKontaktSitzResponse:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it."""

        db_filter = {"_id": bewerbung_id}
        bewerbung_raw = await pull_one_from_db(
            collection=bewerbungen_collection, db_filter=db_filter, projection=["status", "kontakte", "bestaetigungen"], session=session
        )

        # A 404 rather than a 422, as the correction's is: the segment names no seat any application has.
        rolle = seat_named(seat)
        if rolle is None:
            raise DocumentNotFoundException(filter={**db_filter, "seat": seat}, error_code=DOCUMENT_NOT_FOUND)

        kontakte, bestaetigungen = bewerbung_raw.get("kontakte"), bewerbung_raw.get("bestaetigungen")
        refuse(find_triage_refusal(status=str(bewerbung_raw["status"])))

        # The pair is claimed rather than read off the slots, so it is composed BEFORE the refusal
        # and judged with the pressed seat: `claimed_pair_seat` adds a mirror in any state at all.
        other = claimed_pair_seat(kontakte=kontakte, seat=rolle)
        seats = (rolle,) if other is None else (rolle, other)

        refuse(find_reseat_refusal(bestaetigungen=bestaetigungen, seats=seats))

        # Asked over the seats this write does NOT reach, as the correction asks it: a mirrored pair
        # is one person, and comparing them against each other would refuse every such reseat.
        refuse(find_kontakt_email_refusal(kontakte=kontakte, seats=seats, email=sitz_data.email))

        raw, token_hash = mint_token()
        bestaetigungsfrist = bestaetigungsfrist_from(today=today)

        await patch_one_in_db(
            collection=bewerbungen_collection,
            db_filter=db_filter,
            update=compose_kontakt_seat_update(
                seats=seats,
                # The label is excluded rather than dropped by the composer: everything left is the
                # person as the slot stores them, so a sixth field added here reaches storage.
                person=sitz_data.model_dump(mode="json", exclude={"text_version"}),
                text_version=sitz_data.text_version,
                token_hash=token_hash,
                today=today,
                bestaetigungsfrist=bestaetigungsfrist,
            ),
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

        return FLBewerbungKontaktSitzResponse(rollen=list(seats), token=raw, bestaetigungsfrist=bestaetigungsfrist)

    # A transaction for the correction's reason: this write seats a person as well as a credential,
    # so a decision landing mid-request must leave neither half standing.
    async with db.start_session() as session:
        return await session.with_transaction(seat_and_mint)
