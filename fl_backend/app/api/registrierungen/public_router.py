from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Header
from pydantic import UUID4
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.services import build_key_filter, days_after
from app.api.invitations.services import find_live_invitation_filter, find_unknown_invitation_refusal
from app.api.outbox.services import enqueue_mails
from app.api.registrierungen.crud import judge_the_mailbox_in_session
from app.api.registrierungen.schemas import (
    FLInvitationViewResponse,
    FLPostRegistrierungPayload,
    FLPostRegistrierungResponse,
    FLRegistrierungConfirmationPayload,
    FLRegistrierungConfirmationResponse,
    FLRegistrierungConfirmationViewResponse,
)
from app.api.registrierungen.services import (
    CONFIRMATION_ANSWER_FIELDS,
    CONFIRMATION_VIEW_FIELDS,
    build_confirmation_filter,
    compose_confirmation,
    compose_confirmation_update,
    compose_registrierung,
    confirmation_mail,
    find_age_refusal,
    find_already_confirmed_refusal,
    find_expired_token_refusal,
    find_kader_refusal,
    find_media_refusal,
    find_stufe_refusal,
    find_team_departed_refusal,
    find_team_junction_refusal,
    find_unknown_token_refusal,
    find_window_refusal,
    saison_takes_registrierungen,
    state_of,
)
from app.api.saisons.services import entry_is_a_nominee
from app.api.spieler.crud import pull_squad_room
from app.api.spieler.services import find_full_squad_refusal
from app.core.clock import utc_stamp
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, post_one_to_db, pull_one_from_db, refuse
from app.core.dependencies import (
    DBClient,
    InvitationsCollection,
    InvitationsReadCollection,
    MailboxAnchorsCollection,
    OutboxCollection,
    RegistrierungenCollection,
    RegistrierungenReadCollection,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonSpielerReadCollection,
    SaisonsReadCollection,
    SaisonTeamsCollection,
    SaisonTeamsReadCollection,
    TeamsReadCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.readonly import ReadCollection
from app.core.routing import SAFE
from app.core.security import verify_access_base
from app.core.transactions import transaction_session
from app.shared.schemas.bounds import (
    BEWERBUNG_KONTAKT_MAX_AGE_YEARS,
    MEDIA_MIN_AGE_YEARS,
    REGISTRIERUNG_CONFIRMATION_DEADLINE_DAYS,
    REGISTRIERUNG_MIN_AGE_YEARS,
)
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.schemas.einwilligung import by_choice
from app.shared.tokens import hash_token

router = APIRouter(prefix=f"/api/v{API_VERSION}/registrierungen", dependencies=[Depends(verify_access_base)])


# What a season read serves this tier: the two rules a form is bounded by, the window, whose `end`
# reaches the holder as the Nachnominierung verdict alone, and the status the page words a closed link
# with. No other field of a season reaches an invite's holder.
SAISON_PROJECTION = ["registrierung", "rules.allowed_stufen", "rules.max_kader_size", "status"]

# What a season row serves this tier: the name the club plays the season under, and the Austritt that kills its link.
JUNCTION_PROJECTION = {"name": 1, "austritt": 1}

# `resolve_public_saison` is deliberately NOT called below, where every other base-tier season read
# calls it: a link minted for a season that takes no registration today, a `future` one among them,
# reads as closed rather than as a season nobody knows. The INVITE authorises instead.


async def _club_departed(
    *, saison_teams_collection: ReadCollection, registrierung_raw: Mapping[str, Any], session: AsyncClientSession | None = None
) -> bool:
    """Whether this registration's club has left the season: by an exit, on the record's presence, or by a replacement, which leaves it no row.

    A registration is taken only from a club holding a row, so a missing one is that club replaced, and it admits nobody.
    """

    junction_raw = await saison_teams_collection.find_one(
        {"saison_id": registrierung_raw["saison_id"], "team_id": registrierung_raw["team_id"]}, JUNCTION_PROJECTION, session=session
    )

    return junction_raw is None or junction_raw.get("austritt") is not None


async def _open_invitation(*, invitations_collection: ReadCollection, token: str, session: AsyncClientSession | None = None) -> Any:
    """The live invite a presented link opens, or a refusal.

    ONE code for unknown and for revoked, the reason `link_invalid` records: nothing tells a
    stranger's guess from a link an administrator replaced.
    """

    invitation_raw = await invitations_collection.find_one(find_live_invitation_filter(token_hash=hash_token(token)), session=session)
    refuse(find_unknown_invitation_refusal(invitation_raw=invitation_raw))

    return invitation_raw


@router.post(
    "/invitation/view",
    response_model=FLInvitationViewResponse,
    summary="What a registration link opens",
    openapi_extra=SAFE,
)
async def post_invitation_view(
    view_data: Annotated[FLTokenPayload, Body()],
    invitations_collection: InvitationsReadCollection,
    saisons_collection: SaisonsReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    saison_spieler_collection: SaisonSpielerReadCollection,
    teams_collection: TeamsReadCollection,
    today: str = Depends(get_german_date_str),
) -> FLInvitationViewResponse:
    """
    Answer what this registration link is for: the team, its school, the season, and what the form may offer.

    A POST because the link value travels in the body and never in a path the edge would log. A paused
    or ended window is a STATE here rather than a refusal, so such a link reads as closed rather than as
    invalid; only a link that opens no live invite, or whose team has left the season, is refused.
    """

    invitation_raw = await _open_invitation(invitations_collection=invitations_collection, token=view_data.token)

    saison_id = str(invitation_raw["saison_id"])
    team_id = invitation_raw["team_id"]

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=SAISON_PROJECTION)
    rules = saison_raw.get("rules") or {}

    # The junction row's own copy of the name, as every season-scoped read serves it: a club renamed
    # after this season finished still reads here under the name it plays the season under.
    junction_raw = await saison_teams_collection.find_one({"saison_id": saison_id, "team_id": team_id}, JUNCTION_PROJECTION)
    refuse(find_team_departed_refusal(austritt=(junction_raw or {}).get("austritt")))
    # The club itself for `full_name`, which the consent copy renders and the junction does not hold.
    team_raw = await pull_one_from_db(collection=teams_collection, db_filter={"_id": team_id}, projection=["name", "full_name"])

    # What an entry submitted TODAY would store, the admission judging the submission's day.
    nominee = entry_is_a_nominee(registrierung=saison_raw.get("registrierung"), day=today)
    room = await pull_squad_room(
        saison_spieler_collection=saison_spieler_collection,
        saison_id=saison_id,
        team_id=team_id,
        rules=rules,
        excluding_spieler_id=None,
        session=None,
    )

    return FLInvitationViewResponse(
        team=str((junction_raw or team_raw)["name"]),
        schule=str(team_raw["full_name"]),
        saison_id=saison_id,
        saison_status=saison_raw["status"],
        running=saison_takes_registrierungen(saison_status=saison_raw["status"], registrierung=saison_raw.get("registrierung")),
        allowed_stufen=list(rules.get("allowed_stufen") or []),
        # The same junction row the submission judges `registrierung_closed` on, so the page words
        # the state before anything is typed rather than after a whole form is filled in.
        team_entered=junction_raw is not None,
        kader_free=find_full_squad_refusal(room=room, nominee=nominee) is None,
        nachnominierung=nominee,
    )


@router.post(
    "",
    response_model=FLPostRegistrierungResponse,
    status_code=201,
    summary="Register through a team's link",
)
async def post_registrierung(
    registrierung_data: Annotated[FLPostRegistrierungPayload, Body()],
    registrierungen_collection: RegistrierungenCollection,
    invitations_collection: InvitationsCollection,
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    outbox_collection: OutboxCollection,
    mailbox_anchors_collection: MailboxAnchorsCollection,
    db: DBClient,
    # Version 4 alone: a guessable key lets a stranger store a registration under it first, and the
    # pupil's own press is then answered as that one.
    # Optional, so a page loaded before the form sent one still submits, unprotected.
    idempotency_key: Annotated[UUID4 | None, Header()] = None,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLPostRegistrierungResponse:
    """
    Store one pupil's registration for the team and season the link belongs to, and owe its confirmation mail.

    Everything the league decides -- the team, the season, `status`, `submitted_at` and the
    deadline -- is taken off the invite and the clock and never off the payload. The mail is owed in
    the Postausgang in the same transaction, its link minted when it is handed out; no token is answered.

    An `Idempotency-Key` header makes a second press safe. A key already stored answers with the
    registration it holds, stores none and owes no second mail, whatever its body says: a form whose details changed
    since its last press sends a new key. The key goes with its registration, so one pressed again after the team
    admitted or declined the pupil, or after the row lapsed, is a new registration.

    A mailbox already holding `OPEN_LINKS_PER_MAILBOX` unanswered links of the season is owed nothing and nothing refuses
    the press: the row stands unmailed and lapses on its deadline, and the answer is the same either way.
    """

    key = None if idempotency_key is None else str(idempotency_key)

    async def store_or_replay(session: AsyncClientSession) -> FLPostRegistrierungResponse:
        """The replay, or every refusal in the flow's order and then the one write, in one transaction."""

        # Before every judgement: a replay answers what the first request did, even where the invite
        # has been revoked or the window has closed since.
        # The id alone: the registration its first press stored, whose mail that press owed.
        stored = None if key is None else await registrierungen_collection.find_one(build_key_filter(key=key), ["_id"], session=session)
        if stored is not None:
            return FLPostRegistrierungResponse(registrierung_id=stored["_id"])

        invitation_raw = await _open_invitation(invitations_collection=invitations_collection, token=registrierung_data.token, session=session)
        saison_id = str(invitation_raw["saison_id"])
        team_id = invitation_raw["team_id"]

        # The ROW rather than a count: the answer's `team` is the junction's own copy of the name,
        # which the confirmation mail addresses the pupil by, and one read serves both.
        junction_raw = await saison_teams_collection.find_one(
            {"saison_id": saison_id, "team_id": team_id}, JUNCTION_PROJECTION, session=session
        )
        # Ahead of the window, as the view asks it: a dead link reads dead whatever the window says.
        refuse(find_team_departed_refusal(austritt=(junction_raw or {}).get("austritt")))

        saison_raw = await pull_one_from_db(
            collection=saisons_collection, db_filter={"_id": saison_id}, projection=SAISON_PROJECTION, session=session
        )
        rules = saison_raw.get("rules") or {}
        refuse(find_window_refusal(saison_status=saison_raw["status"], registrierung=saison_raw.get("registrierung")))

        refuse(find_team_junction_refusal(entered=junction_raw is not None))

        refuse(find_stufe_refusal(stufe=registrierung_data.stufe, allowed_stufen=list(rules.get("allowed_stufen") or [])))

        room = await pull_squad_room(
            saison_spieler_collection=saison_spieler_collection,
            saison_id=saison_id,
            team_id=team_id,
            rules=rules,
            excluding_spieler_id=None,
            session=session,
        )
        refuse(
            find_kader_refusal(
                full=find_full_squad_refusal(room=room, nominee=entry_is_a_nominee(registrierung=saison_raw.get("registrierung"), day=today))
            )
        )

        mailed = await judge_the_mailbox_in_session(
            registrierungen_collection=registrierungen_collection,
            mailbox_anchors_collection=mailbox_anchors_collection,
            saison_id=saison_id,
            address=str(registrierung_data.email),
            excluding_id=None,
            at=germany_now,
            session=session,
        )

        deadline = days_after(day=today, days=REGISTRIERUNG_CONFIRMATION_DEADLINE_DAYS)

        created = await post_one_to_db(
            collection=registrierungen_collection,
            document={
                **compose_registrierung(
                    saison_id=saison_id,
                    team_id=team_id,
                    invitation_id=invitation_raw["_id"],
                    first_name=registrierung_data.first_name,
                    last_name=registrierung_data.last_name,
                    email=str(registrierung_data.email),
                    position=registrierung_data.position,
                    nummer=registrierung_data.nummer,
                    stufe=registrierung_data.stufe,
                    confirmation=compose_confirmation(today=today, deadline=deadline, mailed=mailed),
                    today=today,
                ),
                **({} if key is None else {"idempotency_key": key}),
            },
            session=session,
        )
        registrierung_id = created.inserted_id

        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=[
                confirmation_mail(
                    registrierung_id=registrierung_id,
                    key=f"{Collection.REGISTRIERUNGEN}/{registrierung_id}/confirmation",
                    address=str(registrierung_data.email),
                    # Off the invite the token opened. `or {}` for the type checker alone: `refuse` above has raised where
                    # the row is missing.
                    team=str((junction_raw or {}).get("name", "")),
                    saison_id=saison_id,
                )
            ]
            if mailed
            else [],
            now=germany_now,
        )

        return FLPostRegistrierungResponse(registrierung_id=registrierung_id)

    # The key lookup is the transaction's first read: a first press committed before this snapshot is
    # found, and one committed after it makes the anchor or the insert a write conflict `with_transaction` retries.
    async with transaction_session(db) as session:
        return await session.with_transaction(store_or_replay)


# The confirmation link's two endpoints: the token is the whole credential, so both are base-tier as
# the submission is.
@router.post(
    "/confirmation/view",
    response_model=FLRegistrierungConfirmationViewResponse,
    summary="What one registration confirmation link opens",
    openapi_extra=SAFE,
)
async def get_confirmation_view(
    view_data: Annotated[FLTokenPayload, Body()],
    registrierungen_collection: RegistrierungenReadCollection,
    teams_collection: TeamsReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    today: str = Depends(get_german_date_str),
) -> FLRegistrierungConfirmationViewResponse:
    """What the confirmation page renders for the registration this token opens, and nothing of the pupil but the day they answered.

    A POST, so the token travels in the body. A confirmed or expired link is served in that state, a link whose club has
    left the season reading expired; only a token no registration holds is refused (`link_invalid`).
    """

    token_hash = hash_token(view_data.token)

    # `find_one` rather than `pull_one_from_db`: a miss is this endpoint's own refusal, never a 404.
    raw = await registrierungen_collection.find_one(build_confirmation_filter(token_hash=token_hash), projection=dict(CONFIRMATION_VIEW_FIELDS))
    refuse(find_unknown_token_refusal(found=raw is not None))
    assert raw is not None

    # `find_one` rather than `pull_one_from_db`: no team is ever deleted, so a miss is a broken
    # invariant rather than a 404 this view could answer, and never an empty slot in the consent text.
    team_raw = await teams_collection.find_one({"_id": raw["team_id"]}, projection={"name": 1, "full_name": 1})
    assert team_raw is not None

    departed = await _club_departed(saison_teams_collection=saison_teams_collection, registrierung_raw=raw)

    return FLRegistrierungConfirmationViewResponse(
        state=state_of(registrierung_raw=raw, departed=departed, today=today),
        team=str(team_raw["name"]),
        schule=str(team_raw["full_name"]),
        saison_id=str(raw["saison_id"]),
        minimum_age=REGISTRIERUNG_MIN_AGE_YEARS,
        maximum_age=BEWERBUNG_KONTAKT_MAX_AGE_YEARS,
        media_minimum_age=MEDIA_MIN_AGE_YEARS,
        # The token filter matched inside the block, so it stands, and its record model requires the day.
        deadline=str(raw["confirmation"]["deadline"]),
        answered_at=(raw.get("einwilligung") or {}).get("confirmed_at"),
    )


@router.post(
    "/confirmation",
    response_model=FLRegistrierungConfirmationResponse,
    summary="Confirm one registration and record the pupil's consent",
)
async def post_confirmation(
    answer_data: Annotated[FLRegistrierungConfirmationPayload, Body()],
    registrierungen_collection: RegistrierungenCollection,
    saison_teams_collection: SaisonTeamsCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLRegistrierungConfirmationResponse:
    """Record a pupil's own answer for the registration their link opens, which stays pending until the team decides.

    Refuses, writing nothing: `link_invalid`, `link_expired`, its club having left the season among its cases,
    `confirmation_exists`, `confirmation_age` and `media_age`.
    """

    token_hash = hash_token(answer_data.token)

    async def answer_for_the_pupil(session: AsyncClientSession) -> FLRegistrierungConfirmationResponse:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it.

        One transaction, so a second press landing between the read and the write is refused by
        the stamp rather than overwriting the answer already given.
        """

        raw = await registrierungen_collection.find_one(
            build_confirmation_filter(token_hash=token_hash), projection=dict(CONFIRMATION_ANSWER_FIELDS), session=session
        )
        refuse(find_unknown_token_refusal(found=raw is not None))
        assert raw is not None

        departed = await _club_departed(saison_teams_collection=saison_teams_collection, registrierung_raw=raw, session=session)
        refuse(find_expired_token_refusal(confirmation=raw.get("confirmation"), status=raw.get("status"), departed=departed, today=today))
        refuse(find_already_confirmed_refusal(einwilligung=raw.get("einwilligung")))
        refuse(find_age_refusal(birth_date=answer_data.birth_date, today=today))
        refuse(find_media_refusal(birth_date=answer_data.birth_date, media=answer_data.media, today=today))

        await patch_one_in_db(
            collection=registrierungen_collection,
            db_filter={"_id": raw["_id"]},
            update=compose_confirmation_update(
                birth_date=answer_data.birth_date,
                scope=answer_data.scope,
                media=answer_data.media,
                text_versions=by_choice(answer_data.text_versions),
                today=today,
                at=utc_stamp(germany_now),
            ),
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )

        # The payload's own three rather than the updated document's: this answer is what the page
        # states back, and re-reading the row would widen it to everything a registration holds.
        return FLRegistrierungConfirmationResponse(
            outcome="confirmed",
            birth_date=answer_data.birth_date,
            scope=answer_data.scope,
            media=answer_data.media,
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(answer_for_the_pupil)
