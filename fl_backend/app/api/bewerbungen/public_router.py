from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Header
from pydantic import UUID4
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.bewerbungen.schemas import (
    FLBewerbungEinwilligungAnsichtResponse,
    FLBewerbungEinwilligungAntwortPayload,
    FLBewerbungEinwilligungAntwortResponse,
    FLBewerbungFensterResponse,
    FLBewerbungKeinFensterResponse,
    FLBewerbungKuerzelResponse,
    FLBewerbungSchulenResponse,
    FLBewerbungSchuleOptionListAdapter,
    FLBewerbungTrikotFarbenResponse,
    FLEinwilligungAntwortResponse,
    FLPostBewerbungPayload,
    FLPostBewerbungResponse,
    FLSaisonTeamEinwilligungAntwortResponse,
)
from app.api.bewerbungen.services import (
    EINWILLIGUNG_ANSICHT_FIELDS,
    EINWILLIGUNG_ANTWORT_FIELDS,
    SAISON_EINWILLIGUNG_ANTWORT_FIELDS,
    SAISON_EINWILLIGUNG_FIELDS,
    SAISON_NOT_ENDED_FILTER,
    ansprechperson_mailbox,
    assigned_trikot_farben,
    bestaetigungsfrist_from,
    bewerbung_antwort_seite,
    bewerbung_bezug,
    bewerbung_schule,
    build_saison_token_filter,
    build_schluessel_filter,
    build_token_filter,
    compose_bestaetigungen,
    compose_confirmation_update,
    compose_decline_update,
    compose_kontakte,
    compose_saison_decline_update,
    find_abweichender_fingerabdruck_refusal,
    find_already_answered_refusal,
    find_already_entered_refusal,
    find_alter_refusal,
    find_einwilligung_gesperrt_refusal,
    find_expired_token_refusal,
    find_gesperrt_refusal,
    find_picked_club_refusal,
    find_saison_frist_refusal,
    find_saison_vorbei_einwilligung_refusal,
    find_shorthand_refusal,
    find_submission_subject_refusal,
    find_unknown_token_refusal,
    find_window_refusal,
    hash_token,
    mindestalter_for,
    objection_is_announced,
    owed_at_submission,
    paired_seat,
    payload_fingerabdruck,
    saison_antwort_seite,
    saison_frist_of,
    saison_link_pair,
    saison_nimmt_bewerbungen_an,
    saison_schule,
    saison_zustand_of,
    season_has_ended,
    seat_adressen,
    seat_holding,
    seat_opens_nobody,
    seat_vorname,
    zustand_of,
)
from app.api.einwilligung.services import find_fassung_refusal, find_self_medien_refusal
from app.api.kontakte.crud import redact_the_decliner, remove_their_reasons
from app.api.postausgang.schemas import FLBewerbungPerson, FLBewerbungWiderspruchDaten
from app.api.postausgang.services import enqueue_mail, enqueue_mails
from app.api.sperrliste.lookup import BanList, SperrlisteLookup, adressen_gesperrt, hashes_gesperrt, sperrliste_saison
from app.api.spielbestaetigungen.crud import redact_seat_entries_in_images
from app.api.spielbestaetigungen.services import kontakte_ohne, seat_void_of
from app.api.teams.crud import void_moved_seats
from app.api.teams.services import kontakt_zeile_of
from app.core.collections import Collection
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import patch_one_in_db, post_one_to_db, pull_many_from_db, pull_one_from_db, refuse
from app.core.dependencies import (
    AktionenCollection,
    BewerbungenCollection,
    DBClient,
    PostausgangCollection,
    SaisonsCollection,
    SaisonTeamsCollection,
    SpielbestaetigungenCollection,
    TeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.journal import Journal, JournalLine
from app.core.recording import log_stamp
from app.core.security import bind_public_actor, loeschung_journal_hash, verify_access_base
from app.core.transactions import transaction_session
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from app.shared.schemas.bestaetigung import FLTokenPayload
from app.shared.schemas.bounds import MEDIEN_MIN_AGE_YEARS
from app.shared.schemas.custom import fold_shorthand
from app.shared.schemas.literals import KONTAKT_ROLLEN

# Base-tier at the prefix the admin and person routers share: a member of the public applies here,
# and nothing served below reaches a stored application (`READ-BEWERBUNG-001`). The confirmation
# link's two endpoints are base-tier too: its token is the whole credential, as a sign-in code is.

# `bind_public_actor`, never `bind_actor`: no browser sends `X-FL-Actor`, so that guard would refuse
# every submission with `missing_actor`. The write still passes `app/core/crud.py`, and an insert
# records no `before`.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/bewerbungen",
    dependencies=[Depends(verify_access_base), Depends(bind_public_actor)],
)


# The state a submission arrives in, and the only one it may arrive in: the other two are the
# triage's (`app/api/bewerbungen/admin_router.py`).
SUBMITTED = "eingereicht"

# What a replay reads of the application its key found: the digest it is compared by, and nothing about a person.
WIEDERHOLUNG_PROJECTION = ["idempotenz_fingerabdruck"]

# What a season read takes on this tier: the window, and the status judging it, served only as
# whether it ended. The rule withholds a `future` season, as one taking
# applications is; its carve-out is this much.
WINDOW_PROJECTION = ["bewerbung", "status"]


async def _pull_window(*, saisons_collection: AsyncCollection, saison_id: str) -> tuple[Mapping[str, Any] | None, Any]:
    """One season's application window, `None` where it records none, beside its status."""

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=WINDOW_PROJECTION)
    window = saison_raw.get("bewerbung")

    # The status travels beside the window and is served only as whether it is `past`: that season
    # takes no application whatever its window says (`app/api/bewerbungen/services.py :: saison_nimmt_bewerbungen_an`).
    return window, saison_raw["status"]


def _fenster(*, saison_id: str, saison_status: Any, bewerbung: Any, today: str) -> FLBewerbungFensterResponse:
    """One window as this tier is served it, with the running judgement already taken."""

    return FLBewerbungFensterResponse(
        saison_id=saison_id,
        offen=bool(bewerbung["offen"]),
        von=str(bewerbung["von"]),
        bis=str(bewerbung["bis"]),
        laeuft=saison_nimmt_bewerbungen_an(saison_status=saison_status, bewerbung=bewerbung, today=today),
        saison_beendet=season_has_ended(saison_status=saison_status),
    )


# NOT an ordering constraint: this and `/fenster/{saison_id}` are different segment counts, so
# neither matches the other's path in any order. What keeps these literals out of the admin id route
# is its `objectid` convertor (`app/core/routing.py`).
@router.get(
    "/fenster",
    response_model=FLBewerbungFensterResponse,
    summary="The Saison currently accepting applications",
)
async def get_offenes_fenster(saisons_collection: SaisonsCollection, today: str = Depends(get_german_date_str)) -> FLBewerbungFensterResponse:
    """
    Return the season taking applications today -- its window open and the season not ended; 404 when none is.

    What is served is the window and whether its season has ended, never the season: the rule
    withholds a `future` one from this tier (`READ-BEWERBUNG-001`).
    """

    # Compared in the query rather than after it, so a closed season is never read. ISO dates order
    # lexicographically, which is how the rest of this application compares two.
    db_filter = {"bewerbung.offen": True, "bewerbung.von": {"$lte": today}, "bewerbung.bis": {"$gte": today}, **SAISON_NOT_ENDED_FILTER}

    # Sorted and limited rather than `find_one`: two open windows is a state an administrator can
    # create, and an arbitrary pick would move between reads. Newest season id first, ids being years.
    open_seasons = await pull_many_from_db(
        collection=saisons_collection, db_filter=db_filter, limit=1, sort_by=[("_id", -1)], projection=WINDOW_PROJECTION
    )

    bewerbung = open_seasons[0]["bewerbung"] if open_seasons else None

    if bewerbung is None:
        raise DocumentNotFoundError()

    return _fenster(saison_id=str(open_seasons[0]["_id"]), saison_status=open_seasons[0]["status"], bewerbung=bewerbung, today=today)


@router.get(
    "/fenster/{saison_id}",
    response_model=FLBewerbungFensterResponse | FLBewerbungKeinFensterResponse,
    summary="One Saison's application window",
)
async def get_fenster(
    saison_id: str, saisons_collection: SaisonsCollection, today: str = Depends(get_german_date_str)
) -> FLBewerbungFensterResponse | FLBewerbungKeinFensterResponse:
    """
    Return one season's application window, or that it records none; 404 only where no season carries the id.

    A CLOSED window is served rather than hidden: the page says the deadline has passed, which a
    404 could not tell from a mistyped id. A season with no window recorded is served for the same
    reason, and its existence is the whole of what this tier learns about it.
    """

    bewerbung, saison_status = await _pull_window(saisons_collection=saisons_collection, saison_id=saison_id)
    if bewerbung is None:
        return FLBewerbungKeinFensterResponse(saison_id=saison_id, fenster=None)

    return _fenster(saison_id=saison_id, saison_status=saison_status, bewerbung=bewerbung, today=today)


@router.get("/schulen", response_model=FLBewerbungSchulenResponse, summary="The clubs a public application may name")
async def get_schulen(teams_collection: TeamsCollection) -> FLBewerbungSchulenResponse:
    """
    Every club still in the league, as `{id, name}` and nothing else, sorted by name.

    `FLBewerbungSchuleOption` decides the wire (`READ-BEWERBUNG-001`) and the projection below
    decides what leaves the database. Both are pinned.
    """

    # Retired clubs are out: the picker offers what a school may apply AS, and a club that left the
    # league is not one. `find_picked_club_refusal` refuses the same set at the write.

    # Both layers narrow: this one keeps a club's address from crossing the wire at all, where the
    # model would drop it only after it had.
    teams_raw = await pull_many_from_db(
        collection=teams_collection, db_filter={"inactive_since": None}, sort_by=[("name", 1)], projection=["name"]
    )

    return FLBewerbungSchulenResponse(schulen=FLBewerbungSchuleOptionListAdapter.validate_python(teams_raw))


@router.get("/kuerzel/{shorthand}", response_model=FLBewerbungKuerzelResponse, summary="Whether a Kürzel is already a club's")
async def get_kuerzel(shorthand: str, teams_collection: TeamsCollection) -> FLBewerbungKuerzelResponse:
    """
    Answer whether any club holds this three-letter code.

    Retired clubs COUNT and no club is named: `uniq_shorthand` spans the collection, and an answer
    naming the holder would publish which schools have left (`READ-BEWERBUNG-001`).
    """

    # Folded as the submission folds it, so the answer is the one the submission will meet; no pattern
    # on the parameter, a 422 here being the malformed-path answer this application does not give.
    folded: str = fold_shorthand(shorthand)
    taken = await teams_collection.count_documents({"shorthand": folded}, limit=1)

    return FLBewerbungKuerzelResponse(shorthand=folded, vergeben=taken > 0)


@router.get(
    "/trikotfarben/{saison_id}",
    response_model=FLBewerbungTrikotFarbenResponse,
    summary="The kit colours a Saison has already assigned",
)
async def get_trikotfarben(
    saison_id: str,
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    today: str = Depends(get_german_date_str),
) -> FLBewerbungTrikotFarbenResponse:
    """
    Answer which kit colours this season has assigned, so the form can offer the rest.

    404 unless that season takes applications today, which is the one state the form reads this in.
    The SET alone, naming no club (`READ-BEWERBUNG-001`).
    """

    # Not `refuse_withheld_saison`, which would 404 every season this read exists for: one taking
    # applications is `future`. Whether it takes applications gates it instead, so
    # the carve-out stays the window reads' own.
    bewerbung, saison_status = await _pull_window(saisons_collection=saisons_collection, saison_id=saison_id)

    # `saison_nimmt_bewerbungen_an`, the judgement `/fenster` and the submission already take: one
    # spelling of "this season is taking applications", so a second cannot drift from it.
    if not saison_nimmt_bewerbungen_an(saison_status=saison_status, bewerbung=bewerbung, today=today):
        raise DocumentNotFoundError()

    # `distinct`, never a document read: what leaves the database is the field's values, so no
    # projection or response model stands between a club's row and this body.

    # A row a club LEFT the season on still holds its colour, and this makes no exception for one:
    # the assignment stands until an administrator clears it, which is the set the admin sees too.
    stored = await saison_teams_collection.distinct("trikot_farbe", {"saison_id": saison_id})

    return FLBewerbungTrikotFarbenResponse(saison_id=saison_id, vergeben=assigned_trikot_farben(stored=stored))


async def _any_gesperrt(
    *, sperrliste: BanList, gehasht: Sequence[str], massgebliche_saison_id: str | None, session: AsyncClientSession
) -> bool:
    """Whether the ban list holds any of the seats' addresses, asked in the caller's transaction in one read."""

    return bool(await hashes_gesperrt(sperrliste, gehasht, massgebliche_saison_id=massgebliche_saison_id, session=session))


def _answer_as_the_first(*, stored: Mapping[str, Any], fingerabdruck: str) -> FLPostBewerbungResponse:
    """The answer a stored key gets: the application it already holds, whose mails its first press owed, never a second one."""

    refuse(find_abweichender_fingerabdruck_refusal(gespeichert=stored.get("idempotenz_fingerabdruck"), fingerabdruck=fingerabdruck))

    return FLPostBewerbungResponse(created_id=stored["_id"])


@router.post(
    "",
    response_model=FLPostBewerbungResponse,
    status_code=201,
    summary="Submit a Bewerbung",
)
async def post_bewerbung(
    bewerbung_data: Annotated[FLPostBewerbungPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    saisons_collection: SaisonsCollection,
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    postausgang_collection: PostausgangCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    # Version 4 alone: a guessable key lets a stranger store other details under it first, and the
    # visitor's own press is then refused as a changed replay.
    # Optional, so a page loaded before the form sent one still submits, unprotected.
    idempotency_key: Annotated[UUID4 | None, Header()] = None,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLPostBewerbungResponse:
    """
    Store one school's application to play one season as submitted, and owe each contact person their confirmation mail.

    Everything the league decides -- `status`, `eingereicht_am`, `entscheidung` and each consent's
    scope, source and date -- is written here and never taken off the payload. One mail per person is owed in the
    same transaction, a person holding two seats being sent one link for both: the Ansprechperson the receipt naming
    who is still to answer, every other person their link. Each link is minted when its mail is handed out; no token
    is answered.

    An `Idempotency-Key` header makes a second press safe. A key already stored answers with the
    application it holds, stores none and owes nothing again. The same key over other details is refused
    (`bewerbung_schluessel_abweichend`).

    An address the ban list holds, on any seat, is refused (`bewerbung_adresse_gesperrt`) on a first press.

    A seat naming a consent wording other than the one the form now shows is refused (`fassung_unzulaessig`),
    and only once the key has been looked up: a stored key is answered whatever wording it names.
    """

    schluessel = None if idempotency_key is None else str(idempotency_key)
    fingerabdruck = payload_fingerabdruck(bewerbung_data)

    # Hashed outside the transaction, whose callback may run again: the hash reads no document. One
    # per distinct address, the seat the Trainer also holds naming theirs twice.
    kontakte = bewerbung_data.kontakte
    gehasht = sorted(
        {sperrliste.hash_of(str(person.email)) for person in (kontakte.trainer, kontakte.ansprechperson, kontakte.stellvertretung)}
    )
    # The REFERENCE season a ban is counted from, as the registration reads it.
    massgebliche_saison_id = await sperrliste_saison(sperrliste)

    async def store_or_replay(session: AsyncClientSession) -> FLPostBewerbungResponse:
        """The replay or the judged insert, in one transaction: either write is the request's only one."""

        # Before every judgement: a replay answers what the first request did, whatever has closed since.
        stored = (
            None
            if schluessel is None
            else await bewerbungen_collection.find_one(build_schluessel_filter(schluessel=schluessel), WIEDERHOLUNG_PROJECTION, session=session)
        )
        if stored is not None:
            return _answer_as_the_first(stored=stored, fingerabdruck=fingerabdruck)

        # After the lookup and never ahead of it: a retry across a deploy that moved the label resends
        # the first press's words, and refusing it here would have its reload store a second application.
        refuse(
            find_fassung_refusal(
                seite="bewerbung", genannt={seat: getattr(kontakte, seat).einwilligung.text_version for seat in KONTAKT_ROLLEN}
            )
        )

        # The season first, so a submission arriving after the deadline is refused before anything about
        # the applicant is looked up. The window is read under the same projection the public GET uses.
        saison_raw = await pull_one_from_db(
            collection=saisons_collection, db_filter={"_id": bewerbung_data.saison_id}, projection=WINDOW_PROJECTION, session=session
        )
        refuse(find_window_refusal(saison_status=saison_raw["status"], bewerbung=saison_raw.get("bewerbung"), today=today))

        # Then who is applying, because the two branches below judge different things.
        refuse(find_submission_subject_refusal(team_id=bewerbung_data.team_id, schule=bewerbung_data.schule))

        # Branched on `schule` rather than on `team_id`, so the narrowing the shorthand read needs is one
        # the type checker can follow: the refusal above has already made the two branches exclusive.
        if (schule := bewerbung_data.schule) is not None:
            # Asked of a NEW school alone: a picked club already holds its own shorthand, and refusing it
            # for that would make applying impossible.

            # NO `inactive_since` term: `uniq_shorthand` spans retired clubs, so narrowing this to live
            # ones would pass a submission here that acceptance then fails on a duplicate key.
            taken = await teams_collection.count_documents({"shorthand": schule.shorthand}, limit=1, session=session)
            refuse(find_shorthand_refusal(taken=taken > 0))
        else:
            # `find_one`, not `pull_one_from_db`: a club the picker never offered is refused with
            # `bewerbung_picked_team_unusable` rather than answering the 404 a miss would raise.
            team_raw = await teams_collection.find_one({"_id": bewerbung_data.team_id}, {"inactive_since": 1, "name": 1}, session=session)
            refuse(find_picked_club_refusal(team_raw=team_raw))

            entered = await saison_teams_collection.count_documents(
                {"saison_id": bewerbung_data.saison_id, "team_id": bewerbung_data.team_id}, limit=1, session=session
            )
            refuse(find_already_entered_refusal(entered=entered > 0))

        # Last, as the registration asks it: every other refusal names what the applicant can repair
        # themselves, and this one they are told neutrally.
        gesperrt = await _any_gesperrt(sperrliste=sperrliste, gehasht=gehasht, massgebliche_saison_id=massgebliche_saison_id, session=session)
        refuse(find_gesperrt_refusal(gesperrt=gesperrt))

        bestaetigungsfrist = bestaetigungsfrist_from(today=today)
        # The school as the mails name it: proposed, or the picked club as the league holds it, never as the body spells it.
        schule_text = schule.team_name if schule is not None else str((team_raw or {}).get("name") or "")

        stored_kontakte = compose_kontakte(kontakte=bewerbung_data.kontakte.model_dump(mode="json"), today=today)

        # Every refusal is behind us, so the write follows with nothing left to judge. The uniqueness the
        # checks narrow is held at acceptance.
        created = await post_one_to_db(
            collection=bewerbungen_collection,
            document={
                "saison_id": bewerbung_data.saison_id,
                "eingereicht_am": today,
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
                # Null until the triage decides, which is what `status == "eingereicht"` claims.
                "entscheidung": None,
                # The deadline and each seat's bookkeeping, so the sweep and the links have something to judge.
                "bestaetigungsfrist": bestaetigungsfrist,
                "bestaetigungen": compose_bestaetigungen(today=today),
                **({} if schluessel is None else {"idempotenz_schluessel": schluessel, "idempotenz_fingerabdruck": fingerabdruck}),
            },
            session=session,
        )

        await enqueue_mails(
            postausgang_collection=postausgang_collection,
            session=session,
            mails=owed_at_submission(
                bewerbung_id=created.inserted_id,
                kontakte=stored_kontakte,
                saison_id=bewerbung_data.saison_id,
                schule=schule_text,
                frist=bestaetigungsfrist,
            ),
            now=germany_now,
        )

        return FLPostBewerbungResponse(created_id=created.inserted_id)

    # The key lookup is the transaction's first read: a first press committed before this snapshot is
    # found, and one committed after it makes the insert a write conflict `with_transaction` retries.
    async with transaction_session(db) as session:
        return await session.with_transaction(store_or_replay)


async def _schule_name(*, bewerbung_raw: Mapping[str, Any], teams_collection: TeamsCollection) -> str:
    """The school's name as submitted, or the picked club's own."""

    if isinstance(bewerbung_raw.get("schule"), Mapping):
        return bewerbung_schule(bewerbung_raw=bewerbung_raw, club_name=None)

    # `find_one` rather than `pull_one_from_db`: an application without its own school names a club,
    # and no team is ever deleted, so a miss is a broken invariant rather than a 404 the view answers.
    team_raw = await teams_collection.find_one({"_id": bewerbung_raw["team_id"]}, projection={"name": 1})
    assert team_raw is not None

    return bewerbung_schule(bewerbung_raw=bewerbung_raw, club_name=team_raw.get("name"))


async def _saison_ansicht(
    *,
    token_hash: str,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    sperrliste: SperrlisteLookup,
    today: str,
) -> FLBewerbungEinwilligungAnsichtResponse:
    """The view of a link no application holds, read off the season row holding it, or the unknown-token refusal."""

    row = await saison_teams_collection.find_one(build_saison_token_filter(token_hash=token_hash), projection=SAISON_EINWILLIGUNG_FIELDS)
    seat = None if row is None else seat_holding(bewerbung_raw=row, token_hash=token_hash)
    refuse(find_unknown_token_refusal(seat=seat))
    assert row is not None and seat is not None

    slot = (row.get("kontakte") or {}).get(seat)

    zugleich = saison_link_pair(kontakte=row.get("kontakte"), bestaetigungen=row.get("bestaetigungen"), seat=seat, token_hash=token_hash)
    seats = (seat,) if zugleich is None else (seat, zugleich)

    gesperrt = await adressen_gesperrt(sperrliste, seat_adressen(kontakte=row.get("kontakte"), seats=seats))
    # As the press reads it: no season is ever deleted, so a miss is a broken invariant rather than a 404.
    saison_raw = await saisons_collection.find_one({"_id": row["saison_id"]}, projection={"status": 1})
    assert saison_raw is not None

    zustand = saison_zustand_of(row=row, seat=seat, today=today, gesperrt=bool(gesperrt), saison_status=saison_raw.get("status"))
    refuse(find_unknown_token_refusal(seat=None if seat_opens_nobody(slot=slot, zustand=zustand) else seat))

    return FLBewerbungEinwilligungAnsichtResponse(
        quelle="saison",
        zustand=zustand,
        zeile=kontakt_zeile_of(saison_status=saison_raw.get("status"), austritt=row.get("austritt")),
        saison_id=str(row["saison_id"]),
        schule=saison_schule(row),
        rolle=seat,
        zugleich_rolle=zugleich,
        laufende_fassung=LAUFENDE_FASSUNGEN[saison_antwort_seite(row=row, seats=seats)],
        mindestalter=mindestalter_for(seats),
        medien_mindestalter=MEDIEN_MIN_AGE_YEARS,
    )


@router.post(
    "/einwilligung/ansicht",
    response_model=FLBewerbungEinwilligungAnsichtResponse,
    summary="What one confirmation link opens",
)
async def get_einwilligung_ansicht(
    ansicht_data: Annotated[FLTokenPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    teams_collection: TeamsCollection,
    sperrliste: SperrlisteLookup,
    today: str = Depends(get_german_date_str),
) -> FLBewerbungEinwilligungAnsichtResponse:
    """What the confirmation page renders for the seat this token opens, and nothing of the person.

    A POST, so the token travels in the body. A confirmed, declined or expired link is served in that state, `gesperrt`
    ranking first; only a token no seat holds is refused (`link_ungueltig`).
    """

    token_hash = hash_token(ansicht_data.token)

    # `find_one` rather than `pull_one_from_db`: a miss is this endpoint's own refusal, never a 404.
    bewerbung_raw = await bewerbungen_collection.find_one(build_token_filter(token_hash=token_hash), projection=EINWILLIGUNG_ANSICHT_FIELDS)
    if bewerbung_raw is None:
        # The application first, so its own links read exactly as they did before a season row could answer one.
        return await _saison_ansicht(
            token_hash=token_hash,
            saison_teams_collection=saison_teams_collection,
            saisons_collection=saisons_collection,
            sperrliste=sperrliste,
            today=today,
        )

    seat = seat_holding(bewerbung_raw=bewerbung_raw, token_hash=token_hash)
    refuse(find_unknown_token_refusal(seat=seat))
    assert seat is not None

    slot = (bewerbung_raw.get("kontakte") or {}).get(seat)

    # The answer's own resolution, so the page names exactly the seats a press will write and states
    # the floor that press will be judged by.
    zugleich = paired_seat(kontakte=bewerbung_raw.get("kontakte"), bestaetigungen=bewerbung_raw.get("bestaetigungen"), seat=seat)
    seats = (seat,) if zugleich is None else (seat, zugleich)

    gesperrt = await adressen_gesperrt(sperrliste, seat_adressen(kontakte=bewerbung_raw.get("kontakte"), seats=seats))

    zustand = zustand_of(bewerbung_raw=bewerbung_raw, seat=seat, today=today, gesperrt=bool(gesperrt))
    refuse(find_unknown_token_refusal(seat=None if seat_opens_nobody(slot=slot, zustand=zustand) else seat))

    return FLBewerbungEinwilligungAnsichtResponse(
        quelle="bewerbung",
        zustand=zustand,
        zeile=None,
        saison_id=str(bewerbung_raw["saison_id"]),
        schule=await _schule_name(bewerbung_raw=bewerbung_raw, teams_collection=teams_collection),
        rolle=seat,
        zugleich_rolle=zugleich,
        laufende_fassung=LAUFENDE_FASSUNGEN[bewerbung_antwort_seite(bewerbung_raw=bewerbung_raw, seats=seats)],
        mindestalter=mindestalter_for(seats),
        medien_mindestalter=MEDIEN_MIN_AGE_YEARS,
    )


@router.post(
    "/einwilligung",
    response_model=FLEinwilligungAntwortResponse,
    summary="Confirm or decline one seat of a Bewerbung or of a team's season row",
)
async def post_einwilligung(
    antwort_data: FLBewerbungEinwilligungAntwortPayload,
    bewerbungen_collection: BewerbungenCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    aktionen_collection: AktionenCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    postausgang_collection: PostausgangCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLBewerbungEinwilligungAntwortResponse | FLSaisonTeamEinwilligungAntwortResponse:
    """Record one person's consent or decline for the seat their link opens, and for a second seat they hold.

    A decline empties the slot; on an application it owes the Ansprechperson who still stands the notice naming who
    refused, in the same transaction, which stands as the deletion notice too. Refuses, writing nothing:
    `link_ungueltig`, `link_abgelaufen`, `bewerbung_sitz_already_answered`, `bestaetigung_alter`, `link_gesperrt`, `fassung_unzulaessig`,
    `medien_alter`, and on a team's season row `link_abgelaufen` and `kontakt_saison_vorbei`.
    """

    token_hash = hash_token(antwort_data.token)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`), and only for the
    # answer that asks the ban.
    massgebliche_saison_id = await sperrliste_saison(sperrliste) if antwort_data.antwort == "erteilt" else None
    # One instant for the decline's day and its journal line, so a replay records the day the person declined on.
    am = log_stamp(germany_now)
    journal = Journal()

    def journal_the_widerspruch(home: Collection, row: Mapping[str, Any], seat: str, seats: tuple[str, ...]) -> None:
        # Keyed on the link's own seat, whose person pressed; an emptied one holds nobody a replay could find again.
        for adresse in seat_adressen(kontakte=row.get("kontakte"), seats=(seat,)):
            hashed = loeschung_journal_hash(adresse, schluessel=config.sperrliste_schluessel)
            journal.note(JournalLine(person_hash=hashed, art="widerspruch", collection=home, record_id=row["_id"], am=am, sitze=seats))

    async def answer_on_the_season_row(session: AsyncClientSession) -> FLSaisonTeamEinwilligungAntwortResponse:
        """The application's judgement in its order, on the season row holding the token; a miss there is the unknown-token refusal."""

        row = await saison_teams_collection.find_one(
            build_saison_token_filter(token_hash=token_hash), projection=SAISON_EINWILLIGUNG_ANTWORT_FIELDS, session=session
        )
        seat = None if row is None else seat_holding(bewerbung_raw=row, token_hash=token_hash)
        refuse(find_unknown_token_refusal(seat=seat))
        assert row is not None and seat is not None

        kontakte, bestaetigungen = row.get("kontakte"), row.get("bestaetigungen")
        refuse(find_saison_frist_refusal(frist=saison_frist_of(bestaetigungen=bestaetigungen, seat=seat), today=today))
        refuse(find_already_answered_refusal(kontakte=kontakte, bestaetigungen=bestaetigungen, seat=seat))

        other = saison_link_pair(kontakte=kontakte, bestaetigungen=bestaetigungen, seat=seat, token_hash=token_hash)
        seats = (seat,) if other is None else (seat, other)

        if antwort_data.antwort == "erteilt":
            geburtsdatum = antwort_data.geburtsdatum

            # Unanchored: the rollover reads nothing this press writes, so one committing inside it orders as
            # one committing just after.
            saison_raw = await saisons_collection.find_one({"_id": row["saison_id"]}, projection={"status": 1}, session=session)
            # `find_one` rather than `pull_one_from_db`: no season is ever deleted, so a miss is a broken
            # invariant rather than a 404 this press could answer.
            assert saison_raw is not None
            # Every link on a closed row meets this here, whether minted before it closed, beside its
            # rollover or after it; never the Widerspruch below, which removes the person.
            refuse(find_saison_vorbei_einwilligung_refusal(saison_status=saison_raw.get("status"), austritt=row.get("austritt")))

            # Against the one page the view answered for these seats.
            seite = saison_antwort_seite(row=row, seats=seats)
            refuse(find_fassung_refusal(seite=seite, genannt={seat: antwort_data.text_version}))

            # Asked at the press, however old the link, as the application's consent asks it;
            # never of the Widerspruch below.
            gesperrt = await adressen_gesperrt(
                sperrliste, seat_adressen(kontakte=kontakte, seats=seats), massgebliche_saison_id=massgebliche_saison_id, session=session
            )
            refuse(find_einwilligung_gesperrt_refusal(gesperrt=bool(gesperrt)))
            refuse(find_alter_refusal(geburtsdatum=geburtsdatum, today=today, mindestalter=mindestalter_for(seats)))
            refuse(find_self_medien_refusal(gespeichert=None, medien=antwort_data.medien, geburtsdatum=geburtsdatum, today=today))

            await patch_one_in_db(
                collection=saison_teams_collection,
                db_filter={"_id": row["_id"]},
                update=compose_confirmation_update(
                    kontakte=kontakte,
                    seats=seats,
                    geburtsdatum=geburtsdatum,
                    today=today,
                    text_version=antwort_data.text_version,
                    whatsapp=antwort_data.whatsapp,
                    medien=antwort_data.medien,
                    am=log_stamp(germany_now),
                ),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )

            return FLSaisonTeamEinwilligungAntwortResponse(
                ergebnis="bestaetigt", geburtsdatum=geburtsdatum, whatsapp=antwort_data.whatsapp, medien=antwort_data.medien
            )

        before = await patch_one_in_db(
            collection=saison_teams_collection,
            db_filter={"_id": row["_id"]},
            update=compose_saison_decline_update(seats=seats, today=today),
            session=session,
            return_document=ReturnDocument.BEFORE,
        )
        # The emptied seats' links on the team's confirmations, answered and closed ones too, go with them.
        stored_kontakte = before.get("kontakte")
        voids = [
            seat_void_of(
                saison_id=before["saison_id"],
                team_id=before["team_id"],
                stored_kontakte=stored_kontakte,
                kontakte=kontakte_ohne(stored_kontakte, seats),
            )
        ]
        await void_moved_seats(spielbestaetigungen_collection=spielbestaetigungen_collection, voids=voids, session=session)
        await redact_seat_entries_in_images(aktionen_collection=aktionen_collection, voids=voids, stamp=am, session=session)
        # As an erasure takes them: the person's reasons on every confirmation, from whichever seat they typed them.
        await remove_their_reasons(
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            aktionen_collection=aktionen_collection,
            adressen=seat_adressen(kontakte=kontakte, seats=seats),
            schluessel=config.sperrliste_schluessel,
            stamp=am,
            session=session,
        )

        # LAST, for the application's reason: it reaches the pre-image the clearing patch just filed,
        # which still holds the person who refused to be held.
        await redact_the_decliner(
            aktionen_collection=aktionen_collection,
            collection=Collection.SAISON_TEAMS,
            row_id=row["_id"],
            adressen=seat_adressen(kontakte=kontakte, seats=seats),
            stamp=am,
            session=session,
        )
        journal_the_widerspruch(Collection.SAISON_TEAMS, row, seat, seats)

        return FLSaisonTeamEinwilligungAntwortResponse(ergebnis="abgelehnt", geburtsdatum=None, whatsapp=False, medien=False)

    @journal.attempted
    async def answer_for_the_person(
        session: AsyncClientSession,
    ) -> FLBewerbungEinwilligungAntwortResponse | FLSaisonTeamEinwilligungAntwortResponse:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it.

        One transaction for both branches: a decline is two writes, and a consent judged outside
        the session could answer a seat a decline had just emptied.
        """

        bewerbung_raw = await bewerbungen_collection.find_one(
            build_token_filter(token_hash=token_hash), projection=EINWILLIGUNG_ANTWORT_FIELDS, session=session
        )
        if bewerbung_raw is None:
            return await answer_on_the_season_row(session)

        seat = seat_holding(bewerbung_raw=bewerbung_raw, token_hash=token_hash)
        refuse(find_unknown_token_refusal(seat=seat))
        assert seat is not None

        kontakte, bestaetigungen = bewerbung_raw.get("kontakte"), bewerbung_raw.get("bestaetigungen")
        refuse(
            find_expired_token_refusal(
                bestaetigungsfrist=bewerbung_raw.get("bestaetigungsfrist"), status=bewerbung_raw.get("status"), today=today
            )
        )
        refuse(find_already_answered_refusal(kontakte=kontakte, bestaetigungen=bestaetigungen, seat=seat))

        # Both seats one person holds, so one click answers for the person rather than for one of
        # their two seats, and the equality the submission asserted survives the write.
        other = paired_seat(kontakte=kontakte, bestaetigungen=bestaetigungen, seat=seat)
        seats = (seat,) if other is None else (seat, other)

        # Read before either branch writes: a decline empties this slot, and the message reporting
        # it is the one thing that has to name the person who refused.
        vorname = seat_vorname(kontakte=kontakte, seat=seat)
        # Present wherever a token is: the submission writes the deadline and the tokens in one
        # insert, and a re-send moves both (`app/api/bewerbungen/services.py :: compose_erneut_update`).
        bestaetigungsfrist = str(bewerbung_raw["bestaetigungsfrist"])
        saison_id = str(bewerbung_raw["saison_id"])

        if antwort_data.antwort == "erteilt":
            geburtsdatum = antwort_data.geburtsdatum

            # Against the one page the view answered for these seats.
            seite = bewerbung_antwort_seite(bewerbung_raw=bewerbung_raw, seats=seats)
            refuse(find_fassung_refusal(seite=seite, genannt={seat: antwort_data.text_version}))

            # Asked at the press rather than only at the mint, so a ban entered after the link went out
            # stops it here. Never of the decline below: a barred person asking to be removed is not refused.
            gesperrt = await adressen_gesperrt(
                sperrliste, seat_adressen(kontakte=kontakte, seats=seats), massgebliche_saison_id=massgebliche_saison_id, session=session
            )
            refuse(find_einwilligung_gesperrt_refusal(gesperrt=bool(gesperrt)))
            # Over BOTH seats, so a Trainer who also sits in one of the other two is judged as the
            # person they are rather than as the link they pressed.
            refuse(find_alter_refusal(geburtsdatum=geburtsdatum, today=today, mindestalter=mindestalter_for(seats)))
            refuse(find_self_medien_refusal(gespeichert=None, medien=antwort_data.medien, geburtsdatum=geburtsdatum, today=today))

            updated_raw = await patch_one_in_db(
                collection=bewerbungen_collection,
                db_filter={"_id": bewerbung_raw["_id"]},
                update=compose_confirmation_update(
                    kontakte=kontakte,
                    seats=seats,
                    geburtsdatum=geburtsdatum,
                    today=today,
                    text_version=antwort_data.text_version,
                    whatsapp=antwort_data.whatsapp,
                    medien=antwort_data.medien,
                    am=log_stamp(germany_now),
                ),
                session=session,
                return_document=ReturnDocument.AFTER,
            )

            return FLBewerbungEinwilligungAntwortResponse(
                quelle="bewerbung",
                ergebnis="bestaetigt",
                geburtsdatum=geburtsdatum,
                whatsapp=antwort_data.whatsapp,
                medien=antwort_data.medien,
            )

        updated_raw = await patch_one_in_db(
            collection=bewerbungen_collection,
            db_filter={"_id": bewerbung_raw["_id"]},
            update=compose_decline_update(seats=seats, today=today, angekuendigt=objection_is_announced(kontakte=kontakte, seats=seats)),
            session=session,
            return_document=ReturnDocument.AFTER,
        )

        # LAST, so it reaches the pre-image the clearing patch just filed, which still holds the
        # person who refused to be held (`app/api/kontakte/crud.py :: loeschen_kontaktperson_in_session`).
        await redact_the_decliner(
            aktionen_collection=aktionen_collection,
            collection=Collection.BEWERBUNGEN,
            row_id=bewerbung_raw["_id"],
            adressen=seat_adressen(kontakte=kontakte, seats=seats),
            stamp=am,
            session=session,
        )
        journal_the_widerspruch(Collection.BEWERBUNGEN, bewerbung_raw, seat, seats)

        # Off the UPDATED document, so an Ansprechperson who has just declined leaves this null and
        # the message their decline would have gone to is owed to nobody.
        abgelehnt_email, abgelehnt_rollen = ansprechperson_mailbox(kontakte=updated_raw.get("kontakte"))
        if abgelehnt_email is not None:
            # In the decline's own transaction, which stamped the notice as the deletion's: one cannot stand without the other.
            await enqueue_mail(
                postausgang_collection=postausgang_collection,
                session=session,
                schluessel=f"{Collection.BEWERBUNGEN}/{bewerbung_raw['_id']}/widerspruch/{seat}",
                an=abgelehnt_email,
                daten=FLBewerbungWiderspruchDaten(
                    art="bewerbung_widerspruch",
                    saison_id=saison_id,
                    rollen=abgelehnt_rollen,
                    # Named off the read before the decline: nothing left in the record can say whose entry was refused.
                    abgelehnt=FLBewerbungPerson(vorname=vorname, rollen=list(seats)),
                    frist=bestaetigungsfrist,
                ),
                now=germany_now,
                bezug=bewerbung_bezug(bewerbung_raw["_id"], abgelehnt_rollen),
            )

        return FLBewerbungEinwilligungAntwortResponse(
            quelle="bewerbung",
            ergebnis="abgelehnt",
            geburtsdatum=None,
            whatsapp=False,
            medien=False,
        )

    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(answer_for_the_person)
