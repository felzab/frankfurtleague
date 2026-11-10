from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Header
from pydantic import UUID4
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.schemas import (
    FLBewerbungEinwilligungAnswerPayload,
    FLBewerbungEinwilligungAnswerResponse,
    FLBewerbungEinwilligungViewResponse,
    FLBewerbungFormResponse,
    FLBewerbungFormWindow,
    FLBewerbungSchuleOptionListAdapter,
    FLEinwilligungAnswerResponse,
    FLPostBewerbungPayload,
    FLSaisonTeamEinwilligungAnswerResponse,
)
from app.api.bewerbungen.services import (
    EINWILLIGUNG_ANSWER_FIELDS,
    EINWILLIGUNG_VIEW_FIELDS,
    OPEN_LINK_FIELDS,
    OPEN_LINKS_PER_MAILBOX,
    SAISON_EINWILLIGUNG_ANSWER_FIELDS,
    SAISON_EINWILLIGUNG_FIELDS,
    ansprechperson_mailbox,
    assigned_trikot_farben,
    bewerbung_reference,
    bewerbung_schule,
    build_form_pipeline,
    build_key_filter,
    build_open_links_filter,
    build_saison_token_filter,
    build_token_filter,
    compose_confirmation_update,
    compose_confirmations,
    compose_decline_update,
    compose_kontakte,
    compose_saison_decline_update,
    confirmation_deadline_from,
    deletion_day,
    find_already_answered_refusal,
    find_already_entered_refusal,
    find_alter_refusal,
    find_expired_token_refusal,
    find_picked_club_refusal,
    find_repeated_contact_refusal,
    find_saison_deadline_refusal,
    find_saison_past_einwilligung_refusal,
    find_submission_subject_refusal,
    find_unknown_token_refusal,
    find_window_refusal,
    first_name_of,
    form_window_state,
    leaving_moves_the_deletion_day,
    mailbox_anchor_ids,
    mailbox_of,
    minimum_age_for,
    objection_is_announced,
    open_links_on,
    owed_at_submission,
    paired_seat,
    saison_link_pair,
    saison_schule,
    saison_state_of,
    seat_answered_at,
    seat_deadline_of,
    seat_holding,
    seat_opens_nobody,
    seats_past_the_bound,
    zustand_of,
)
from app.api.einwilligung.services import find_self_media_refusal
from app.api.kontakte.crud import remove_the_seats_reasons
from app.api.outbox.schemas import FLBewerbungObjectionData, FLBewerbungPerson
from app.api.outbox.services import OwedMail, enqueue_mails
from app.api.spielbestaetigungen.services import HeldSeats
from app.api.teams.services import kontakt_row_of
from app.core.clock import utc_stamp
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import (
    GERMAN_COLLATION,
    aggregate_many_from_db,
    anchor_mailboxes_in_db,
    patch_one_in_db,
    post_one_to_db,
    pull_many_from_db,
    pull_one_from_db,
    refuse,
)
from app.core.dependencies import (
    BewerbungenCollection,
    BewerbungenReadCollection,
    DBClient,
    MailboxAnchorsCollection,
    OutboxCollection,
    SaisonsCollection,
    SaisonsReadCollection,
    SaisonTeamsCollection,
    SaisonTeamsReadCollection,
    SpielbestaetigungenCollection,
    TeamsCollection,
    TeamsReadCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.journal import Journal
from app.core.routing import SAFE
from app.core.security import verify_access_base
from app.core.transactions import transaction_session
from app.shared.schemas.bounds import BEWERBUNG_KONTAKT_MAX_AGE_YEARS, MEDIA_MIN_AGE_YEARS
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.schemas.einwilligung import by_choice
from app.shared.schemas.responses import FLCreatedResponse
from app.shared.tokens import hash_token

# Base-tier at the prefix the admin and person routers share: a member of the public applies here,
# and nothing served below reaches a stored application (`READ-BEWERBUNG-001`). The confirmation
# link's two endpoints are base-tier too: its token is the whole credential, as a sign-in code is.
router = APIRouter(prefix=f"/api/v{API_VERSION}/bewerbungen", dependencies=[Depends(verify_access_base)])


# The state a submission arrives in, and the only one it may arrive in: the other two are the
# triage's (`app/api/bewerbungen/admin_router.py`).
SUBMITTED = "submitted"

# What a season read takes on this tier: the window, and the status judging it, served only as
# whether it ended. The rule withholds a `future` season, as one taking
# applications is; its carve-out is this much.
WINDOW_PROJECTION = ["bewerbung", "status"]


@router.get("/form/{saison_id}", response_model=FLBewerbungFormResponse, summary="What one Saison's application form shows")
async def get_form(
    saison_id: str, saisons_collection: SaisonsReadCollection, today: str = Depends(get_german_date_str)
) -> FLBewerbungFormResponse:
    """
    One read for the form's page: the window, and while it runs the clubs a school may apply as and the colours taken.

    404 only where no season carries the id. A closed or paused window and a season recording none are served, for the
    page to say so; the clubs and the colours are served on a running window alone, each as a name or a colour and
    nothing more (`READ-BEWERBUNG-001`).
    """

    # The whole read under the league's collation, its one name-ordered list being the clubs of the `$lookup`.
    seasons = await aggregate_many_from_db(
        collection=saisons_collection, pipeline=build_form_pipeline(saison_id=saison_id), collation=GERMAN_COLLATION
    )
    if not seasons:
        raise DocumentNotFoundError()

    saison_raw = seasons[0]
    stored = saison_raw.get("bewerbung")
    window = (
        None
        if stored is None
        else FLBewerbungFormWindow(
            start=str(stored["start"]), state=form_window_state(saison_status=saison_raw["status"], bewerbung=stored, today=today)
        )
    )
    running = window is not None and window.state == "running"

    return FLBewerbungFormResponse(
        window=window,
        schulen=FLBewerbungSchuleOptionListAdapter.validate_python(saison_raw["schulen"]) if running else [],
        taken=assigned_trikot_farben(stored=[row["_id"] for row in saison_raw["colours"]]) if running else [],
    )


async def _open_links_by_mailbox(
    *, bewerbungen_collection: BewerbungenCollection, saison_id: str, addresses: Sequence[str], session: AsyncClientSession
) -> dict[str, int]:
    """Each of these addresses' mailboxes and its unanswered links of the season, each mailbox counted alone."""

    held: dict[str, int] = {}
    for mailbox in {mailbox_of(address) for address in addresses}:
        # Each row read holds a link, so the bound's worth of rows answers whether it is reached.
        rows = await pull_many_from_db(
            collection=bewerbungen_collection,
            db_filter=build_open_links_filter(saison_id=saison_id, address=mailbox),
            projection=OPEN_LINK_FIELDS,
            limit=OPEN_LINKS_PER_MAILBOX,
            session=session,
        )
        held[mailbox] = sum(open_links_on(row=row, mailbox=mailbox) for row in rows)

    return held


@router.post(
    "",
    response_model=FLCreatedResponse,
    status_code=201,
    summary="Submit a Bewerbung",
)
async def post_bewerbung(
    bewerbung_data: Annotated[FLPostBewerbungPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    saisons_collection: SaisonsCollection,
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    outbox_collection: OutboxCollection,
    mailbox_anchors_collection: MailboxAnchorsCollection,
    db: DBClient,
    # Version 4 alone: a guessable key lets a stranger store an application under it first, and the
    # visitor's own press is then answered as that one.
    idempotency_key: Annotated[UUID4, Header()],
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLCreatedResponse:
    """
    Store one school's application to play one season as submitted, and owe each contact person their confirmation mail.

    Everything the league decides -- `status`, `submitted_at`, `decision` and each consent's
    scope, source and date -- is written here and never taken off the payload. One mail per person is owed in the
    same transaction, a person holding two seats being sent one link for both: the Ansprechperson the receipt naming
    who is still to answer, every other person their link. Each link is minted when its mail is handed out; no token
    is answered.

    The `Idempotency-Key` header makes a second press safe. A key already stored answers with the
    application it holds, stores none and owes nothing again, whatever its body says: a form whose details changed
    since its last press sends a new key.

    Two people sharing an address or a number are refused on the later box (`bewerbung_kontakt_repeated`), the seat the
    Trainer also holds being that one person.

    A mailbox already holding `OPEN_LINKS_PER_MAILBOX` unanswered links of the season is owed nothing and nothing refuses the
    press: its seat stands unmailed, with a null `sent_at`, for an administrator to send the link. The answer is the same
    either way, so it tells a stranger nothing about the address.
    """

    refuse(find_repeated_contact_refusal(kontakte=bewerbung_data.kontakte.model_dump(mode="json")))

    schluessel = str(idempotency_key)

    # One per distinct address, the seat the Trainer also holds naming theirs twice.
    kontakte = bewerbung_data.kontakte
    addresses = sorted({str(person.email) for person in (kontakte.trainer, kontakte.ansprechperson, kontakte.stellvertretung)})

    async def store_or_replay(session: AsyncClientSession) -> FLCreatedResponse:
        """The replay or the judged insert, in one transaction: either write is the request's only one."""

        # Before every judgement: a replay answers what the first request did, whatever has closed since.
        # The id alone, and nothing about a person: the application its first press stored, whose mails that press owed.
        stored = await bewerbungen_collection.find_one(build_key_filter(key=schluessel), ["_id"], session=session)
        if stored is not None:
            return FLCreatedResponse(created_id=stored["_id"])

        # The season first, so a submission arriving after the deadline is refused before anything about
        # the applicant is looked up. The window is read under the same projection the public GET uses.
        saison_raw = await pull_one_from_db(
            collection=saisons_collection, db_filter={"_id": bewerbung_data.saison_id}, projection=WINDOW_PROJECTION, session=session
        )
        refuse(find_window_refusal(saison_status=saison_raw["status"], bewerbung=saison_raw.get("bewerbung"), today=today))

        # Then who is applying, because the two branches below judge different things.
        refuse(find_submission_subject_refusal(team_id=bewerbung_data.team_id, schule=bewerbung_data.schule))

        # A picked club alone: a new school has nothing stored to judge. `find_one`, not `pull_one_from_db`: a club the
        # picker never offered is refused with `bewerbung_picked_team_unusable` rather than answering the 404 a miss would raise.
        schule, team_raw = bewerbung_data.schule, None
        if schule is None:
            team_raw = await teams_collection.find_one({"_id": bewerbung_data.team_id}, {"inactive_since": 1, "name": 1}, session=session)
            refuse(find_picked_club_refusal(team_raw=team_raw))

            entered = await saison_teams_collection.count_documents(
                {"saison_id": bewerbung_data.saison_id, "team_id": bewerbung_data.team_id}, limit=1, session=session
            )
            refuse(find_already_entered_refusal(entered=entered > 0))

        confirmation_deadline = confirmation_deadline_from(today=today)
        # The school as the mails name it: proposed, or the picked club as the league holds it, never as the body spells it.
        schule_text = schule.team_name if schule is not None else str((team_raw or {}).get("name") or "")

        stored_kontakte = compose_kontakte(kontakte=bewerbung_data.kontakte.model_dump(mode="json"), today=today)

        open_links = await _open_links_by_mailbox(
            bewerbungen_collection=bewerbungen_collection, saison_id=bewerbung_data.saison_id, addresses=addresses, session=session
        )
        unmailed = seats_past_the_bound(kontakte=stored_kontakte, open_links=open_links)
        # A mailbox this press may still mail: a rival's commit since this snapshot, the count's own, is then a write conflict and
        # the retry reads its row. One found full is mailed nothing and left alone, so a flood contends only until the bound.
        await anchor_mailboxes_in_db(
            collection=mailbox_anchors_collection,
            ids=mailbox_anchor_ids(addresses=[a for a in addresses if open_links[mailbox_of(a)] < OPEN_LINKS_PER_MAILBOX]),
            at=germany_now,
            session=session,
        )

        # Every refusal is behind us, so the write follows with nothing left to judge.
        created = await post_one_to_db(
            collection=bewerbungen_collection,
            document={
                "saison_id": bewerbung_data.saison_id,
                "submitted_at": today,
                "status": SUBMITTED,
                # Written EXPLICITLY, both of them: the record model requires each key, so an omitted
                # one is a document the read-back refuses rather than a stored null.
                "team_id": bewerbung_data.team_id,
                "schule": None if schule is None else schule.model_dump(mode="json"),
                "kontakte": stored_kontakte,
                "trikot": bewerbung_data.trikot.model_dump(mode="json"),
                "kader": bewerbung_data.kader.model_dump(mode="json"),
                # Written explicitly, as `team_id` is: the record model requires the key.
                "stufengroesse": bewerbung_data.stufengroesse,
                # Written even where the applicant named nobody, for `stufengroesse`'s reason.
                "wunschgegner": bewerbung_data.wunschgegner,
                # Null until the triage decides, which is what `status == "submitted"` claims.
                "decision": None,
                # Each seat's bookkeeping and its own deadline, so the sweep and the links have something to judge.
                "confirmations": compose_confirmations(today=today, unmailed=unmailed),
                "idempotency_key": schluessel,
            },
            session=session,
        )

        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=owed_at_submission(
                bewerbung_id=created.inserted_id,
                kontakte=stored_kontakte,
                saison_id=bewerbung_data.saison_id,
                schule=schule_text,
                deadline=confirmation_deadline,
                unmailed=unmailed,
            ),
            now=germany_now,
        )

        return FLCreatedResponse(created_id=created.inserted_id)

    # The key lookup is the transaction's first read: a first press committed before this snapshot is
    # found, and one committed after it makes the anchors or the insert a write conflict `with_transaction` retries.
    async with transaction_session(db) as session:
        return await session.with_transaction(store_or_replay)


async def _schule_name(*, bewerbung_raw: Mapping[str, Any], teams_collection: TeamsReadCollection) -> str:
    """The school's name as submitted, or the picked club's own."""

    if isinstance(bewerbung_raw.get("schule"), Mapping):
        return bewerbung_schule(bewerbung_raw=bewerbung_raw, club_name=None)

    # `find_one` rather than `pull_one_from_db`: an application without its own school names a club,
    # and no team is ever deleted, so a miss is a broken invariant rather than a 404 the view answers.
    team_raw = await teams_collection.find_one({"_id": bewerbung_raw["team_id"]}, projection={"name": 1})
    assert team_raw is not None

    return bewerbung_schule(bewerbung_raw=bewerbung_raw, club_name=team_raw.get("name"))


async def _saison_view(
    *,
    token_hash: str,
    saison_teams_collection: SaisonTeamsReadCollection,
    saisons_collection: SaisonsReadCollection,
    today: str,
) -> FLBewerbungEinwilligungViewResponse:
    """The view of a link no application holds, read off the season row holding it, or the unknown-token refusal."""

    row = await saison_teams_collection.find_one(build_saison_token_filter(token_hash=token_hash), projection=SAISON_EINWILLIGUNG_FIELDS)
    seat = None if row is None else seat_holding(bewerbung_raw=row, token_hash=token_hash)
    refuse(find_unknown_token_refusal(seat=seat))
    assert row is not None and seat is not None

    slot = (row.get("kontakte") or {}).get(seat)

    zugleich = saison_link_pair(kontakte=row.get("kontakte"), confirmations=row.get("confirmations"), seat=seat, token_hash=token_hash)
    seats = (seat,) if zugleich is None else (seat, zugleich)

    # As the press reads it: no season is ever deleted, so a miss is a broken invariant rather than a 404.
    saison_raw = await saisons_collection.find_one({"_id": row["saison_id"]}, projection={"status": 1})
    assert saison_raw is not None

    state = saison_state_of(row=row, seat=seat, today=today, saison_status=saison_raw.get("status"))
    refuse(find_unknown_token_refusal(seat=None if seat_opens_nobody(slot=slot, state=state) else seat))

    return FLBewerbungEinwilligungViewResponse(
        quelle="saison",
        state=state,
        row=kontakt_row_of(saison_status=saison_raw.get("status"), austritt=row.get("austritt")),
        saison_id=str(row["saison_id"]),
        schule=saison_schule(row),
        rolle=seat,
        also_rolle=zugleich,
        minimum_age=minimum_age_for(seats),
        maximum_age=BEWERBUNG_KONTAKT_MAX_AGE_YEARS,
        deadline=seat_deadline_of(confirmations=row.get("confirmations"), seat=seat),
        answered_at=seat_answered_at(kontakte=row.get("kontakte"), confirmations=row.get("confirmations"), seat=seat),
        media_minimum_age=MEDIA_MIN_AGE_YEARS,
    )


@router.post(
    "/einwilligung/view",
    response_model=FLBewerbungEinwilligungViewResponse,
    summary="What one confirmation link opens",
    openapi_extra=SAFE,
)
async def get_einwilligung_view(
    view_data: Annotated[FLTokenPayload, Body()],
    bewerbungen_collection: BewerbungenReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    saisons_collection: SaisonsReadCollection,
    teams_collection: TeamsReadCollection,
    today: str = Depends(get_german_date_str),
) -> FLBewerbungEinwilligungViewResponse:
    """What the confirmation page renders for the seat this token opens, and nothing of the person.

    A POST, so the token travels in the body. A confirmed, declined or expired link is served in that state; only a token
    no seat holds is refused (`link_invalid`).
    """

    token_hash = hash_token(view_data.token)

    # `find_one` rather than `pull_one_from_db`: a miss is this endpoint's own refusal, never a 404.
    bewerbung_raw = await bewerbungen_collection.find_one(build_token_filter(token_hash=token_hash), projection=EINWILLIGUNG_VIEW_FIELDS)
    if bewerbung_raw is None:
        # The application first, so its own links read exactly as they did before a season row could answer one.
        return await _saison_view(
            token_hash=token_hash,
            saison_teams_collection=saison_teams_collection,
            saisons_collection=saisons_collection,
            today=today,
        )

    seat = seat_holding(bewerbung_raw=bewerbung_raw, token_hash=token_hash)
    refuse(find_unknown_token_refusal(seat=seat))
    assert seat is not None

    slot = (bewerbung_raw.get("kontakte") or {}).get(seat)

    # The answer's own resolution, so the page names exactly the seats a press will write and states
    # the floor that press will be judged by.
    zugleich = paired_seat(kontakte=bewerbung_raw.get("kontakte"), confirmations=bewerbung_raw.get("confirmations"), seat=seat)
    seats = (seat,) if zugleich is None else (seat, zugleich)

    state = zustand_of(bewerbung_raw=bewerbung_raw, seat=seat, today=today)
    refuse(find_unknown_token_refusal(seat=None if seat_opens_nobody(slot=slot, state=state) else seat))

    return FLBewerbungEinwilligungViewResponse(
        quelle="bewerbung",
        state=state,
        row=None,
        saison_id=str(bewerbung_raw["saison_id"]),
        schule=await _schule_name(bewerbung_raw=bewerbung_raw, teams_collection=teams_collection),
        rolle=seat,
        also_rolle=zugleich,
        minimum_age=minimum_age_for(seats),
        maximum_age=BEWERBUNG_KONTAKT_MAX_AGE_YEARS,
        deadline=seat_deadline_of(confirmations=bewerbung_raw.get("confirmations"), seat=seat),
        answered_at=seat_answered_at(kontakte=bewerbung_raw.get("kontakte"), confirmations=bewerbung_raw.get("confirmations"), seat=seat),
        media_minimum_age=MEDIA_MIN_AGE_YEARS,
    )


@router.post(
    "/einwilligung",
    response_model=FLEinwilligungAnswerResponse,
    summary="Confirm or decline one seat of a Bewerbung or of a team's season row",
)
async def post_einwilligung(
    answer_data: FLBewerbungEinwilligungAnswerPayload,
    bewerbungen_collection: BewerbungenCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLBewerbungEinwilligungAnswerResponse | FLSaisonTeamEinwilligungAnswerResponse:
    """Record one person's consent or decline for the seat their link opens, and for a second seat they hold.

    A decline empties the slot; on an application it owes the Ansprechperson who still stands and was mailed the notice
    naming who refused, in the same transaction, which stands as the deletion notice too. Refuses, writing nothing:
    `link_invalid`, `link_expired`, `bewerbung_seat_already_answered`, `confirmation_age`, `media_age`, and on a team's
    season row `link_expired` and `kontakt_saison_past`.
    """

    token_hash = hash_token(answer_data.token)
    # One instant for every attempt, so a retry owes the objection's one mail.
    at = utc_stamp(germany_now)
    journal = Journal()

    async def answer_on_the_season_row(session: AsyncClientSession) -> FLSaisonTeamEinwilligungAnswerResponse:
        """The application's judgement in its order, on the season row holding the token; a miss there is the unknown-token refusal."""

        row = await saison_teams_collection.find_one(
            build_saison_token_filter(token_hash=token_hash), projection=SAISON_EINWILLIGUNG_ANSWER_FIELDS, session=session
        )
        seat = None if row is None else seat_holding(bewerbung_raw=row, token_hash=token_hash)
        refuse(find_unknown_token_refusal(seat=seat))
        assert row is not None and seat is not None

        kontakte, confirmations = row.get("kontakte"), row.get("confirmations")
        refuse(find_saison_deadline_refusal(deadline=seat_deadline_of(confirmations=confirmations, seat=seat), today=today))
        refuse(find_already_answered_refusal(kontakte=kontakte, confirmations=confirmations, seat=seat))

        other = saison_link_pair(kontakte=kontakte, confirmations=confirmations, seat=seat, token_hash=token_hash)
        seats = (seat,) if other is None else (seat, other)

        if answer_data.answer == "given":
            birth_date = answer_data.birth_date

            # Unanchored: the rollover reads nothing this press writes, so one committing inside it orders as
            # one committing just after.
            saison_raw = await saisons_collection.find_one({"_id": row["saison_id"]}, projection={"status": 1}, session=session)
            # `find_one` rather than `pull_one_from_db`: no season is ever deleted, so a miss is a broken
            # invariant rather than a 404 this press could answer.
            assert saison_raw is not None
            # Every link on a closed row meets this here, whether minted before it closed, beside its
            # rollover or after it; never the Widerspruch below, which removes the person.
            refuse(find_saison_past_einwilligung_refusal(saison_status=saison_raw.get("status"), austritt=row.get("austritt")))
            refuse(find_alter_refusal(birth_date=birth_date, today=today, minimum_age=minimum_age_for(seats)))
            refuse(find_self_media_refusal(saved=None, media=answer_data.media, birth_date=birth_date, today=today))

            await patch_one_in_db(
                collection=saison_teams_collection,
                db_filter={"_id": row["_id"]},
                update=compose_confirmation_update(
                    kontakte=kontakte,
                    seats=seats,
                    birth_date=birth_date,
                    today=today,
                    text_versions=by_choice(answer_data.text_versions),
                    whatsapp=answer_data.whatsapp,
                    media=answer_data.media,
                    at=utc_stamp(germany_now),
                    # A season row carries no deletion notice.
                    takes_the_notice_back=False,
                ),
                session=session,
                expected_version=None,
                return_document=ReturnDocument.BEFORE,
            )

            return FLSaisonTeamEinwilligungAnswerResponse(
                outcome="confirmed", birth_date=birth_date, whatsapp=answer_data.whatsapp, media=answer_data.media
            )

        before = await patch_one_in_db(
            collection=saison_teams_collection,
            db_filter={"_id": row["_id"]},
            update=compose_saison_decline_update(seats=seats, today=today),
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )
        # As an erasure takes them: every reason typed from the emptied seats on the team's confirmations.
        await remove_the_seats_reasons(
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            held=[HeldSeats(saison_id=before["saison_id"], team_id=before["team_id"], seats=seats)],
            session=session,
        )
        journal.note("objection", [f"{Collection.SAISON_TEAMS}/{row['_id']}"], seats=seats)

        return FLSaisonTeamEinwilligungAnswerResponse(outcome="declined", birth_date=None, whatsapp=False, media=False)

    @journal.attempted
    async def answer_for_the_person(
        session: AsyncClientSession,
    ) -> FLBewerbungEinwilligungAnswerResponse | FLSaisonTeamEinwilligungAnswerResponse:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it.

        One transaction for both branches: a decline is two writes, and a consent judged outside
        the session could answer a seat a decline had just emptied.
        """

        bewerbung_raw = await bewerbungen_collection.find_one(
            build_token_filter(token_hash=token_hash), projection=EINWILLIGUNG_ANSWER_FIELDS, session=session
        )
        if bewerbung_raw is None:
            return await answer_on_the_season_row(session)

        seat = seat_holding(bewerbung_raw=bewerbung_raw, token_hash=token_hash)
        refuse(find_unknown_token_refusal(seat=seat))
        assert seat is not None

        kontakte, confirmations = bewerbung_raw.get("kontakte"), bewerbung_raw.get("confirmations")
        refuse(
            find_expired_token_refusal(
                deadline=seat_deadline_of(confirmations=confirmations, seat=seat), status=bewerbung_raw.get("status"), today=today
            )
        )
        refuse(find_already_answered_refusal(kontakte=kontakte, confirmations=confirmations, seat=seat))

        # Both seats one person holds, so one click answers for the person rather than for one of
        # their two seats, and the equality the submission asserted survives the write.
        other = paired_seat(kontakte=kontakte, confirmations=confirmations, seat=seat)
        seats = (seat,) if other is None else (seat, other)

        # Read before either branch writes: a decline empties this slot, and the message reporting
        # it is the one thing that has to name the person who refused.
        first_name = first_name_of(kontakte=kontakte, seat=seat)
        saison_id = str(bewerbung_raw["saison_id"])

        if answer_data.answer == "given":
            birth_date = answer_data.birth_date

            # Over BOTH seats, so a Trainer who also sits in one of the other two is judged as the
            # person they are rather than as the link they pressed.
            refuse(find_alter_refusal(birth_date=birth_date, today=today, minimum_age=minimum_age_for(seats)))
            refuse(find_self_media_refusal(saved=None, media=answer_data.media, birth_date=birth_date, today=today))

            updated_raw = await patch_one_in_db(
                collection=bewerbungen_collection,
                db_filter={"_id": bewerbung_raw["_id"]},
                update=compose_confirmation_update(
                    kontakte=kontakte,
                    seats=seats,
                    birth_date=birth_date,
                    today=today,
                    text_versions=by_choice(answer_data.text_versions),
                    whatsapp=answer_data.whatsapp,
                    media=answer_data.media,
                    at=utc_stamp(germany_now),
                    takes_the_notice_back=leaving_moves_the_deletion_day(kontakte=kontakte, confirmations=confirmations, seats=seats),
                ),
                session=session,
                expected_version=None,
                return_document=ReturnDocument.AFTER,
            )

            return FLBewerbungEinwilligungAnswerResponse(
                quelle="bewerbung",
                outcome="confirmed",
                birth_date=birth_date,
                whatsapp=answer_data.whatsapp,
                media=answer_data.media,
            )

        updated_raw = await patch_one_in_db(
            collection=bewerbungen_collection,
            db_filter={"_id": bewerbung_raw["_id"]},
            update=compose_decline_update(
                seats=seats, today=today, announced=objection_is_announced(kontakte=kontakte, confirmations=confirmations, seats=seats)
            ),
            session=session,
            expected_version=None,
            return_document=ReturnDocument.AFTER,
        )

        journal.note("objection", [f"{Collection.BEWERBUNGEN}/{bewerbung_raw['_id']}"], seats=seats)

        # Off the UPDATED document, so an Ansprechperson who has just declined leaves this null and
        # the message their decline would have gone to is owed to nobody.
        declined_email, declined_rollen = ansprechperson_mailbox(
            kontakte=updated_raw.get("kontakte"), confirmations=updated_raw.get("confirmations")
        )
        if declined_email is not None:
            # In the decline's own transaction, which stamped the notice as the deletion's: one cannot stand without the other.
            await enqueue_mails(
                outbox_collection=outbox_collection,
                session=session,
                mails=[
                    OwedMail(
                        # The press's instant: a seat refilled since a Widerspruch owes a notice of its own, and a retry keeps this one.
                        key=f"{Collection.BEWERBUNGEN}/{bewerbung_raw['_id']}/objection/{seat}/{at}",
                        to=declined_email,
                        data=FLBewerbungObjectionData(
                            kind="bewerbung_objection",
                            saison_id=saison_id,
                            rollen=declined_rollen,
                            # Named off the read before the decline: nothing left in the record can say whose entry was refused.
                            declined=FLBewerbungPerson(first_name=first_name, rollen=list(seats)),
                            # The declining seat is outstanding now, so a day is there to name.
                            deadline=str(deletion_day(kontakte=updated_raw.get("kontakte"), confirmations=updated_raw.get("confirmations"))),
                        ),
                        reference=bewerbung_reference(bewerbung_raw["_id"], declined_rollen),
                    )
                ],
                now=germany_now,
            )

        return FLBewerbungEinwilligungAnswerResponse(
            quelle="bewerbung",
            outcome="declined",
            birth_date=None,
            whatsapp=False,
            media=False,
        )

    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(answer_for_the_person)
