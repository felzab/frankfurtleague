from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, Header, status
from pydantic import UUID4
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.schemas import (
    FLBewerbungEinwilligungAnswerPayload,
    FLBewerbungEinwilligungViewAnswered,
    FLBewerbungEinwilligungViewExpired,
    FLBewerbungEinwilligungViewResponse,
    FLBewerbungEinwilligungViewSaisonPast,
    FLBewerbungEinwilligungViewValid,
    FLBewerbungFormResponse,
    FLBewerbungFormWindow,
    FLBewerbungSchuleOptionListAdapter,
    FLPostBewerbungPayload,
)
from app.api.bewerbungen.services import (
    EINWILLIGUNG_ANSWER_FIELDS,
    EINWILLIGUNG_VIEW_FIELDS,
    FORM_WINDOW_FIELDS,
    OPEN_LINK_FIELDS,
    SAISON_EINWILLIGUNG_ANSWER_FIELDS,
    SAISON_EINWILLIGUNG_FIELDS,
    ansprechperson_mailbox,
    assigned_trikot_farben,
    bewerbung_reference,
    build_form_pipeline,
    build_open_links_filter,
    build_token_filter,
    compose_confirmation_update,
    compose_confirmations,
    compose_decline_update,
    compose_kontakte,
    confirmation_deadline_from,
    deletion_day,
    find_already_answered_refusal,
    find_already_entered_refusal,
    find_expired_token_refusal,
    find_picked_team_refusal,
    find_repeated_contact_refusal,
    find_saison_past_einwilligung_refusal,
    find_submission_subject_refusal,
    find_unknown_token_refusal,
    find_window_refusal,
    form_window_state,
    leaving_moves_the_deletion_day,
    link_is_over,
    minimum_age_for,
    objection_is_announced,
    open_links_on,
    outbox_key,
    owed_at_submission,
    paired_seat,
    person_of,
    pull_schule_name,
    saison_link_pair,
    saison_schule,
    saison_state_of,
    seat_deadline_of,
    seat_holding,
    seat_opens_nobody,
    seat_view,
    seats_past_the_bound,
    state_of,
)
from app.api.kontakte.crud import remove_the_seats_reasons
from app.api.outbox.schemas import FLBewerbungObjectionData
from app.api.outbox.services import OwedMail, enqueue_mails
from app.api.spielbestaetigungen.services import HeldSeats
from app.api.teams.services import kontakt_row_of
from app.core.clock import utc_stamp
from app.core.collections import Collection
from app.core.crud import (
    GERMAN_COLLATION,
    aggregate_many_from_db,
    anchor_mailboxes_in_db,
    patch_one_in_db,
    patch_past_the_version_in_db,
    post_one_to_db,
    pull_many_from_db,
    pull_one_from_db,
    refuse,
    refuse_faults,
)
from app.core.dependencies import (
    BewerbungenCollection,
    BewerbungenReadCollection,
    DBClient,
    GermanDay,
    GermanyNow,
    MailboxAnchorsCollection,
    OutboxCollection,
    SaisonsCollection,
    SaisonsReadCollection,
    SaisonTeamsCollection,
    SaisonTeamsReadCollection,
    SpielbestaetigungenCollection,
    TeamsCollection,
    TeamsReadCollection,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.journal import Journal
from app.core.recording import ACT_BY_KONTAKT, record_act
from app.core.routing import SAFE
from app.core.security import BASE_TIER
from app.core.transactions import transact
from app.shared.einwilligung import find_self_media_refusal
from app.shared.idempotency import build_key_filter
from app.shared.links import deadline_passed, find_age_refusal
from app.shared.mailbox import OPEN_LINKS_PER_MAILBOX, mailbox_anchor_ids, mailbox_of
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.schemas.einwilligung import by_choice
from app.shared.schemas.responses import FLCreatedResponse
from app.shared.tokens import hash_token

# Base-tier at the prefix the admin and person routers share: a member of the public applies here, and nothing served
# below carries a person's details. The confirmation link's two endpoints are base-tier too: its token is the whole
# credential, as a sign-in code is.
router = APIRouter(prefix="/bewerbungen", dependencies=BASE_TIER)


@router.get("/saisons/{saison_id}/form", summary="What one Saison's application form shows")
async def get_form(saison_id: str, saisons_collection: SaisonsReadCollection, today: GermanDay) -> FLBewerbungFormResponse:
    """A season's application window, and while it runs the clubs a school may apply as and the colours taken.

    A closed or paused window and a season recording none are served too, and each club is served as its name alone.
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
    status_code=201,
    summary="Submit a Bewerbung",
)
async def post_bewerbung(
    bewerbung_data: FLPostBewerbungPayload,
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
    today: GermanDay,
    germany_now: GermanyNow,
) -> FLCreatedResponse:
    """Store one school's application to play one season, and mail each contact person their confirmation link, one per person.

    A second press with an `Idempotency-Key` already stored answers the application that key holds and stores nothing.
    """

    key = str(idempotency_key)

    # One per distinct address, the seat the Trainer also holds naming theirs twice.
    kontakte = bewerbung_data.kontakte
    addresses = sorted({str(person.email) for person in (kontakte.trainer, kontakte.ansprechperson, kontakte.stellvertretung)})

    async def store_or_replay(session: AsyncClientSession) -> FLCreatedResponse:
        """The replay or the judged insert, in one transaction: either write is the request's only one."""

        # Before every judgement: a replay answers what the first request did, whatever has closed since and whatever its
        # body says, as a form whose details changed since its last press sends a new key.
        # The id alone, and nothing about a person: the application its first press stored, whose mails that press owed.
        stored = await bewerbungen_collection.find_one(build_key_filter(key=key), ["_id"], session=session)
        if stored is not None:
            return FLCreatedResponse(created_id=stored["_id"])

        # The season first, so a submission arriving after the deadline is refused before anything about
        # the applicant is looked up.
        saison_raw = await pull_one_from_db(
            collection=saisons_collection, db_filter={"_id": bewerbung_data.saison_id}, projection=FORM_WINDOW_FIELDS, session=session
        )
        refuse(find_window_refusal(saison_status=saison_raw["status"], bewerbung=saison_raw.get("bewerbung"), today=today))

        # A picked club alone, judged ahead of the boxes: a club that may not apply makes every seat's fault meaningless, so
        # its gate answers first rather than after the applicant has mended the seats. A new school has nothing stored to
        # judge, and a body naming both or neither is the subject's fault below. `find_one`, not `pull_one_from_db`: a club
        # the picker never offered is refused with `bewerbung_picked_team_unusable` rather than answering the 404 a miss would raise.
        schule = bewerbung_data.schule
        if schule is None and bewerbung_data.team_id is not None:
            team_raw = await teams_collection.find_one({"_id": bewerbung_data.team_id}, {"inactive_since": 1}, session=session)
            refuse(find_picked_team_refusal(team_raw=team_raw))

            entered = await saison_teams_collection.find_one(
                {"saison_id": bewerbung_data.saison_id, "team_id": bewerbung_data.team_id}, projection={"_id": 1}, session=session
            )
            refuse(find_already_entered_refusal(entered=entered is not None))

        refuse_faults(
            find_submission_subject_refusal(team_id=bewerbung_data.team_id, schule=schule),
            find_repeated_contact_refusal(kontakte=bewerbung_data.kontakte.model_dump(mode="json")),
        )

        confirmation_deadline = confirmation_deadline_from(today=today)
        stored_kontakte = compose_kontakte(kontakte=bewerbung_data.kontakte.model_dump(mode="json"), today=today)

        open_links = await _open_links_by_mailbox(
            bewerbungen_collection=bewerbungen_collection, saison_id=bewerbung_data.saison_id, addresses=addresses, session=session
        )
        # A mailbox past the bound is owed nothing and nothing refuses the press, its seat standing unmailed for an
        # administrator to send; the answer is the same either way, so it tells a stranger nothing about the address.
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
        document = {
            "saison_id": bewerbung_data.saison_id,
            "submitted_at": today,
            "status": "submitted",
            # Written explicitly, both of them: the record model requires each key, so an omitted
            # one is a document the read-back refuses rather than a stored null.
            "team_id": bewerbung_data.team_id,
            "schule": None if schule is None else schule.model_dump(mode="json"),
            "kontakte": stored_kontakte,
            "trikot": bewerbung_data.trikot.model_dump(mode="json"),
            "kader": bewerbung_data.kader.model_dump(mode="json"),
            # Written explicitly, as `team_id` is: the record model requires the key.
            "stufengroesse": bewerbung_data.stufengroesse,
            # Written even where the applicant named nobody: the record model requires the key.
            "wunschgegner": bewerbung_data.wunschgegner,
            # Null until the triage decides, which is what `status == "submitted"` claims.
            "decision": None,
            # Each seat's bookkeeping and its own deadline, so the sweep and the links have something to judge.
            "confirmations": compose_confirmations(today=today, unmailed=unmailed),
            "idempotency_key": key,
        }
        created = await post_one_to_db(collection=bewerbungen_collection, document=document, session=session)

        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=owed_at_submission(
                bewerbung_id=created.inserted_id,
                kontakte=stored_kontakte,
                saison_id=bewerbung_data.saison_id,
                deadline=confirmation_deadline,
                unmailed=unmailed,
            ),
            now=germany_now,
        )

        return FLCreatedResponse(created_id=created.inserted_id)

    # The key lookup is the transaction's first read: a first press committed before this snapshot is
    # found, and one committed after it makes the anchors or the insert a write conflict `transact` retries.
    return await transact(db, store_or_replay)


async def _saison_view(
    *,
    token_hash: str,
    saison_teams_collection: SaisonTeamsReadCollection,
    saisons_collection: SaisonsReadCollection,
    today: str,
) -> (
    FLBewerbungEinwilligungViewValid
    | FLBewerbungEinwilligungViewSaisonPast
    | FLBewerbungEinwilligungViewAnswered
    | FLBewerbungEinwilligungViewExpired
):
    """The view of a link no application holds, read off the season row holding it, or the unknown-token refusal."""

    row = await saison_teams_collection.find_one(build_token_filter(token_hash=token_hash), projection=SAISON_EINWILLIGUNG_FIELDS)
    seat = None if row is None else seat_holding(bewerbung_raw=row, token_hash=token_hash)
    refuse(find_unknown_token_refusal(seat=seat))
    assert row is not None and seat is not None

    person = person_of(row.get("kontakte"), seat)

    also = saison_link_pair(kontakte=row.get("kontakte"), confirmations=row.get("confirmations"), seat=seat, token_hash=token_hash)

    # As the press reads it: no season is ever deleted, so a miss is a broken invariant rather than a 404.
    saison_raw = await saisons_collection.find_one({"_id": row["saison_id"]}, projection={"status": 1})
    assert saison_raw is not None

    state = saison_state_of(row=row, seat=seat, today=today, saison_status=saison_raw.get("status"))
    refuse(find_unknown_token_refusal(seat=None if seat_opens_nobody(person=person, state=state) else seat))

    if state == "saison_past":
        # Why the row takes no consent, read as the mint reads it, so the page can name it.
        return FLBewerbungEinwilligungViewSaisonPast(
            state=state,
            record="saison",
            row=kontakt_row_of(saison_status=saison_raw.get("status"), austritt=row.get("austritt")),
            saison_id=str(row["saison_id"]),
            schule=saison_schule(row),
            seat=seat,
            also_seat=also,
        )

    return seat_view(
        state=state,
        record="saison",
        kontakte=row.get("kontakte"),
        confirmations=row.get("confirmations"),
        seat=seat,
        also=also,
        saison_id=str(row["saison_id"]),
        schule=saison_schule(row),
    )


# A POST that reads, so the token travels in the body.
@router.post(
    "/confirmation/view",
    summary="What one confirmation link opens",
    openapi_extra=SAFE,
)
async def get_confirmation_view(
    view_data: FLTokenPayload,
    bewerbungen_collection: BewerbungenReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    saisons_collection: SaisonsReadCollection,
    teams_collection: TeamsReadCollection,
    today: GermanDay,
) -> FLBewerbungEinwilligungViewResponse:
    """What the confirmation page renders for the seat this token opens, and nothing of the person.

    A confirmed, declined or expired link is served in that state; only a token no seat holds is refused.
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

    person = person_of(bewerbung_raw.get("kontakte"), seat)

    # The answer's own resolution, so the page names exactly the seats a press will write.
    also = paired_seat(kontakte=bewerbung_raw.get("kontakte"), confirmations=bewerbung_raw.get("confirmations"), seat=seat)

    state = state_of(bewerbung_raw=bewerbung_raw, seat=seat, today=today)
    refuse(find_unknown_token_refusal(seat=None if seat_opens_nobody(person=person, state=state) else seat))

    return seat_view(
        state=state,
        record="bewerbung",
        kontakte=bewerbung_raw.get("kontakte"),
        confirmations=bewerbung_raw.get("confirmations"),
        seat=seat,
        also=also,
        saison_id=str(bewerbung_raw["saison_id"]),
        schule=await pull_schule_name(bewerbung_raw=bewerbung_raw, teams_collection=teams_collection),
    )


@router.post(
    "/confirmation",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Confirm or decline one seat of a Bewerbung or of a team's season row",
)
async def post_confirmation(
    answer_data: FLBewerbungEinwilligungAnswerPayload,
    bewerbungen_collection: BewerbungenCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    outbox_collection: OutboxCollection,
    teams_collection: TeamsReadCollection,
    db: DBClient,
    today: GermanDay,
    germany_now: GermanyNow,
) -> None:
    """Record one person's consent or Widerspruch for the seat their link opens, and for a second seat they hold.

    A Widerspruch empties the seat and writes the Protokoll's row, and on an application it tells the Ansprechperson who
    still stands, in a notice that is the deletion notice too.
    """

    token_hash = hash_token(answer_data.token)
    # One instant for every attempt, so a retry owes the objection's one mail.
    at = utc_stamp(germany_now)
    journal = Journal()

    async def answer_on_the_season_row(session: AsyncClientSession) -> None:
        """The application's judgement in its order, on the season row holding the token; a miss there is the unknown-token refusal."""

        row = await saison_teams_collection.find_one(
            build_token_filter(token_hash=token_hash), projection=SAISON_EINWILLIGUNG_ANSWER_FIELDS, session=session
        )
        seat = None if row is None else seat_holding(bewerbung_raw=row, token_hash=token_hash)
        refuse(find_unknown_token_refusal(seat=seat))
        assert row is not None and seat is not None

        kontakte, confirmations = row.get("kontakte"), row.get("confirmations")
        # The answer first, as `saison_state_of` ranks it: a person who answered and presses again after the deadline is
        # told their answer stands, never that the link expired.
        refuse(find_already_answered_refusal(kontakte=kontakte, confirmations=confirmations, seat=seat))
        # The deadline alone: a season row has no decision to end its link.
        refuse(find_expired_token_refusal(over=deadline_passed(deadline=seat_deadline_of(confirmations=confirmations, seat=seat), today=today)))

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
            age = find_age_refusal(birth_date=birth_date, today=today, minimum_age=minimum_age_for(seats))
            # The media switch is judged on the birthdate, which means nothing once refused.
            refuse_faults(
                age, None if age else find_self_media_refusal(saved=None, media=answer_data.media, birth_date=birth_date, today=today)
            )

            # The person's own press, judged on the read above: an administrator's save read before it still lands, and
            # the seat write keeps a kept seat's record from its own in-session read.
            await patch_past_the_version_in_db(
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
            )
            return

        before = await patch_one_in_db(
            collection=saison_teams_collection,
            db_filter={"_id": row["_id"]},
            # Never announced: a season row carries no deletion notice.
            update=compose_decline_update(seats=seats, today=today, announced=False),
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
        await record_act(
            collection=saison_teams_collection,
            action="team.seat_objected",
            by=ACT_BY_KONTAKT,
            team=str(before["name"]),
            record_id=before["team_id"],
            session=session,
        )
        journal.note("objection", [f"{Collection.SAISON_TEAMS}/{row['_id']}"], seats=seats)

    @journal.attempted
    async def answer_for_the_person(session: AsyncClientSession) -> None:
        """One transaction for both branches: a decline is two writes.

        A consent judged outside the session could answer a seat a decline had just emptied.
        """

        bewerbung_raw = await bewerbungen_collection.find_one(
            build_token_filter(token_hash=token_hash), projection=EINWILLIGUNG_ANSWER_FIELDS, session=session
        )
        if bewerbung_raw is None:
            await answer_on_the_season_row(session)
            return

        seat = seat_holding(bewerbung_raw=bewerbung_raw, token_hash=token_hash)
        refuse(find_unknown_token_refusal(seat=seat))
        assert seat is not None

        kontakte, confirmations = bewerbung_raw.get("kontakte"), bewerbung_raw.get("confirmations")
        # The answer first, as `state_of` ranks it: a person who answered and presses again after the deadline or the
        # decision is told their answer stands, never that the link expired.
        refuse(find_already_answered_refusal(kontakte=kontakte, confirmations=confirmations, seat=seat))
        refuse(
            find_expired_token_refusal(
                over=link_is_over(
                    deadline=seat_deadline_of(confirmations=confirmations, seat=seat), status=bewerbung_raw.get("status"), today=today
                )
            )
        )

        # Both seats one person holds, so one click answers for the person rather than for one of
        # their two seats, and the equality the submission asserted survives the write.
        other = paired_seat(kontakte=kontakte, confirmations=confirmations, seat=seat)
        seats = (seat,) if other is None else (seat, other)

        saison_id = str(bewerbung_raw["saison_id"])

        if answer_data.answer == "given":
            birth_date = answer_data.birth_date

            # Over both seats, so a Trainer who also sits in one of the other two is judged as the
            # person they are rather than as the link they pressed.
            age = find_age_refusal(birth_date=birth_date, today=today, minimum_age=minimum_age_for(seats))
            # The media switch is judged on the birthdate, which means nothing once refused.
            refuse_faults(
                age, None if age else find_self_media_refusal(saved=None, media=answer_data.media, birth_date=birth_date, today=today)
            )

            # Past the count, as on the season row: a decision read before the press still lands.
            await patch_past_the_version_in_db(
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
            )
            return

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

        # By the school, as the administration's own seat act is: the application's team is no club's yet.
        await record_act(
            collection=bewerbungen_collection,
            action="bewerbung.seat_objected",
            by=ACT_BY_KONTAKT,
            record_id=bewerbung_raw["_id"],
            label=await pull_schule_name(bewerbung_raw=updated_raw, teams_collection=teams_collection, session=session),
            session=session,
        )
        journal.note("objection", [f"{Collection.BEWERBUNGEN}/{bewerbung_raw['_id']}"], seats=seats)

        # Off the updated document, so an Ansprechperson who has just declined leaves this null and
        # the message their decline would have gone to is owed to nobody.
        declined_email, declined_seats = ansprechperson_mailbox(
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
                        key=outbox_key(bewerbung_raw["_id"], "objection", seat, at),
                        to=declined_email,
                        data=FLBewerbungObjectionData(
                            kind="bewerbung_objection",
                            saison_id=saison_id,
                            seats=declined_seats,
                            declined=list(seats),
                            # The declining seat is outstanding now, so a day is there to name.
                            deadline=str(deletion_day(kontakte=updated_raw.get("kontakte"), confirmations=updated_raw.get("confirmations"))),
                        ),
                        reference=bewerbung_reference(bewerbung_raw["_id"], declined_seats),
                    )
                ],
                now=germany_now,
            )

    async with journal:
        await transact(db, answer_for_the_person)
