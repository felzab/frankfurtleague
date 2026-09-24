from collections.abc import Mapping
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Header
from pydantic import UUID4
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.bewerbungen.schemas import (
    FLBewerbungBestaetigungTokens,
    FLBewerbungFensterResponse,
    FLBewerbungKeinFensterResponse,
    FLBewerbungKuerzelResponse,
    FLBewerbungSchulenResponse,
    FLBewerbungSchuleOptionListAdapter,
    FLBewerbungTrikotFarbenResponse,
    FLPostBewerbungPayload,
    FLPostBewerbungResponse,
)
from app.api.bewerbungen.services import (
    KONTAKT_SEATS,
    SAISON_NOT_ENDED_FILTER,
    assigned_trikot_farben,
    bestaetigungsfrist_from,
    build_schluessel_filter,
    build_wiederholung_filter,
    compose_bestaetigungen,
    compose_kontakte,
    compose_wiederholung_update,
    find_abweichender_fingerabdruck_refusal,
    find_already_entered_refusal,
    find_picked_club_refusal,
    find_shorthand_refusal,
    find_submission_subject_refusal,
    find_veraltete_fassung_refusal,
    find_window_refusal,
    mint_token,
    payload_fingerabdruck,
    recorded_window,
    saison_nimmt_bewerbungen_an,
    season_has_ended,
)
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, post_one_to_db, pull_many_from_db, pull_one_from_db, refuse
from app.core.dependencies import (
    BewerbungenCollection,
    DBClient,
    SaisonsCollection,
    SaisonTeamsCollection,
    TeamsCollection,
    get_german_date_str,
)
from app.core.exception_handlers import DUPLICATE_KEY_RESPONSE
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.core.security import bind_public_actor, verify_access_base

# Base-tier at a prefix whose other two routers are admin: a member of the public applies here, and
# nothing served below reaches a stored application (`READ-BEWERBUNG-001`).

# `bind_public_actor`, never `bind_actor`: no browser sends `X-FL-Actor`, so that guard would refuse
# every submission with `REQ-AUTH-005`. The write still passes `app/core/crud.py`, and an insert
# records no `before`.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/bewerbungen",
    dependencies=[Depends(verify_access_base), Depends(bind_public_actor)],
)

# The state a submission arrives in, and the only one it may arrive in: the other two are the
# triage's (`app/api/bewerbungen/admin_router.py`).
SUBMITTED = "eingereicht"

# What a replay reads of the application its key found: what the answer echoes and the hashes the
# filter compares, and nothing about a person.
WIEDERHOLUNG_PROJECTION = [
    "saison_id",
    "eingereicht_am",
    "bestaetigungsfrist",
    "idempotenz_fingerabdruck",
    *(f"bestaetigungen.{seat}.token_hash" for seat in KONTAKT_SEATS),
]

# What a season read takes on this tier: the window, and the status judging it, served only as
# whether it ended. `docs/backend/spec.md :: I47` withholds a `future` season, as one taking
# applications is; `:: I111` carves this much out.
WINDOW_PROJECTION = ["bewerbung", "status"]


async def _pull_window(*, saisons_collection: AsyncCollection, saison_id: str) -> tuple[Mapping[str, Any] | None, Any]:
    """One season's application window, `None` where unreadable, beside its status.

    A null, no key -- every season stored before the field carries none -- or an object short of a
    field: none is readable, and all are a miss rather than an error.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=WINDOW_PROJECTION)

    # `recorded_window`, not a shape check: `_fenster` subscripts every window key, so a short object
    # would 500 where this promises a miss.
    window = recorded_window(bewerbung=saison_raw.get("bewerbung"))

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
@router.get("/fenster", response_model=FLBewerbungFensterResponse, summary="The Saison currently accepting applications")
async def get_offenes_fenster(saisons_collection: SaisonsCollection, today: str = Depends(get_german_date_str)) -> FLBewerbungFensterResponse:
    """
    Return the season taking applications today -- its window open and the season not ended; 404 when none is.

    What is served is the window and whether its season has ended, never the season: `docs/backend/spec.md :: I47`
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

    # `recorded_window` for `_pull_window`'s reason, and reachable past the query: a dotted term
    # traverses a LIST, so a window stored inside one matches every term and 500s in `_fenster`.
    bewerbung = recorded_window(bewerbung=open_seasons[0]["bewerbung"]) if open_seasons else None

    if bewerbung is None:
        raise DocumentNotFoundException(filter=db_filter, error_code=DOCUMENT_NOT_FOUND)

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
    Answer whether any club holds this two-letter code.

    Retired clubs COUNT and no club is named: `uniq_shorthand` spans the collection, and an answer
    naming the holder would publish which schools have left (`READ-BEWERBUNG-001`).
    """

    # No length constraint on the parameter: the width is the submission payload's rule, and a 422
    # here would be the malformed-path answer this application does not give.
    taken = await teams_collection.count_documents({"shorthand": shorthand}, limit=1)

    return FLBewerbungKuerzelResponse(shorthand=shorthand, vergeben=taken > 0)


@router.get(
    "/trikotfarben/{saison_id}", response_model=FLBewerbungTrikotFarbenResponse, summary="The kit colours a Saison has already assigned"
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
    # `docs/backend/spec.md :: I111`'s carve-out stays the window reads' own.
    bewerbung, saison_status = await _pull_window(saisons_collection=saisons_collection, saison_id=saison_id)

    # `saison_nimmt_bewerbungen_an`, the judgement `/fenster` and the submission already take: one
    # spelling of "this season is taking applications", so a second cannot drift from it.
    if not saison_nimmt_bewerbungen_an(saison_status=saison_status, bewerbung=bewerbung, today=today):
        raise DocumentNotFoundException(filter={"_id": saison_id}, error_code=DOCUMENT_NOT_FOUND)

    # `distinct`, never a document read: what leaves the database is the field's values, so no
    # projection or response model stands between a club's row and this body.

    # A row a club LEFT the season on still holds its colour, and this makes no exception for one:
    # the assignment stands until an administrator clears it, which is the set the admin sees too.
    stored = await saison_teams_collection.distinct("trikot_farbe", {"saison_id": saison_id})

    return FLBewerbungTrikotFarbenResponse(saison_id=saison_id, vergeben=assigned_trikot_farben(stored=stored))


async def _answer_as_the_first(
    *, bewerbungen_collection: AsyncCollection, stored: Mapping[str, Any], fingerabdruck: str, today: str, session: AsyncClientSession
) -> FLPostBewerbungResponse:
    """The answer a stored key gets: the application it already holds, never a second one (`docs/backend/spec.md :: I346`)."""

    refuse(find_abweichender_fingerabdruck_refusal(gespeichert=stored.get("idempotenz_fingerabdruck"), fingerabdruck=fingerabdruck))

    tokens: FLBewerbungBestaetigungTokens | None = None
    db_filter = build_wiederholung_filter(bewerbung_raw=stored, today=today)

    if db_filter is not None:
        minted = {seat: mint_token() for seat in KONTAKT_SEATS}
        try:
            await patch_one_in_db(
                collection=bewerbungen_collection,
                db_filter=db_filter,
                update=compose_wiederholung_update(
                    hashes={seat: token_hash for seat, (_, token_hash) in minted.items()}, bestaetigungen=stored.get("bestaetigungen")
                ),
                session=session,
                # `AFTER` would add a re-read nothing here uses.
                return_document=ReturnDocument.BEFORE,
            )
            tokens = FLBewerbungBestaetigungTokens(**{seat: raw for seat, (raw, _) in minted.items()})
        except DocumentNotFoundException:
            # The filter is the judgement: an application whose state holds its links back matches
            # nothing, and this answer hands none.
            tokens = None

    return FLPostBewerbungResponse(
        created_id=stored["_id"],
        saison_id=str(stored["saison_id"]),
        eingereicht_am=stored["eingereicht_am"],
        bestaetigungen=tokens,
        bestaetigungsfrist=stored["bestaetigungsfrist"],
    )


@router.post("", response_model=FLPostBewerbungResponse, summary="Submit a Bewerbung", responses={409: DUPLICATE_KEY_RESPONSE})
async def post_bewerbung(
    bewerbung_data: Annotated[FLPostBewerbungPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    saisons_collection: SaisonsCollection,
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    db: DBClient,
    # Version 4 alone: a guessable key lets a stranger store other details under it first, and the
    # visitor's own press is then refused as a changed replay.
    # Optional, so a page loaded before the form sent one still submits, unprotected.
    idempotency_key: Annotated[UUID4 | None, Header()] = None,
    today: str = Depends(get_german_date_str),
) -> FLPostBewerbungResponse:
    """
    Store one school's application to play one season as submitted, and mint one confirmation link per contact person.

    Everything the league decides -- `status`, `eingereicht_am`, `entscheidung` and each consent's
    scope, source and date -- is written here and never taken off the payload. The three raw tokens are answered
    for the caller to mail and stored only as hashes; the response is the one place outside the recipients' inboxes
    they ever exist.

    An `Idempotency-Key` header makes a second press safe. A key already stored answers with the
    application it holds and stores none: fresh links where no message to any seat is known to have
    reached its inbox, none otherwise. The same key over other details is refused (`REQ-BEWERBUNG-015`).

    A seat naming a consent wording other than the one the form now shows is refused (`REQ-BEWERBUNG-016`),
    and only once the key has been looked up: a stored key is answered whatever wording it names.
    """

    schluessel = None if idempotency_key is None else str(idempotency_key)
    fingerabdruck = payload_fingerabdruck(bewerbung_data)

    async def store_or_replay(session: AsyncClientSession) -> FLPostBewerbungResponse:
        """The replay or the judged insert, in one transaction: either write is the request's only one (`docs/backend/spec.md :: I52`)."""

        # Before every judgement: a replay answers what the first request did, whatever has closed since.
        stored = (
            None
            if schluessel is None
            else await bewerbungen_collection.find_one(build_schluessel_filter(schluessel=schluessel), WIEDERHOLUNG_PROJECTION, session=session)
        )
        if stored is not None:
            return await _answer_as_the_first(
                bewerbungen_collection=bewerbungen_collection, stored=stored, fingerabdruck=fingerabdruck, today=today, session=session
            )

        # After the lookup and never ahead of it: a retry across a deploy that moved the label resends
        # the first press's words, and refusing it here would have its reload store a second application.
        refuse(find_veraltete_fassung_refusal(kontakte=bewerbung_data.kontakte.model_dump(mode="json")))

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
            # `REQ-BEWERBUNG-006` rather than answering the 404 a miss would raise.
            team_raw = await teams_collection.find_one({"_id": bewerbung_data.team_id}, {"inactive_since": 1}, session=session)
            refuse(find_picked_club_refusal(team_raw=team_raw))

            entered = await saison_teams_collection.count_documents(
                {"saison_id": bewerbung_data.saison_id, "team_id": bewerbung_data.team_id}, limit=1, session=session
            )
            refuse(find_already_entered_refusal(entered=entered > 0))

        # Minted here rather than in the document literal below, so the raw half reaches the response
        # and the hashed half the database, and the two never sit in one structure.
        tokens = {seat: mint_token() for seat in KONTAKT_SEATS}
        bestaetigungsfrist = bestaetigungsfrist_from(today=today)

        # Every refusal is behind us, so the write follows with nothing left to judge. The uniqueness the
        # checks narrow is held at acceptance.
        created = await post_one_to_db(
            collection=bewerbungen_collection,
            document={
                "saison_id": bewerbung_data.saison_id,
                "eingereicht_am": today,
                "status": SUBMITTED,
                # Written EXPLICITLY, both of them: `required` in the `$jsonSchema` means the key is
                # present, so an omitted null is a validator rejection rather than a stored null.
                "team_id": bewerbung_data.team_id,
                "schule": None if schule is None else schule.model_dump(mode="json"),
                "kontakte": compose_kontakte(kontakte=bewerbung_data.kontakte.model_dump(mode="json"), today=today),
                "trikot": bewerbung_data.trikot.model_dump(mode="json"),
                "kader": bewerbung_data.kader.model_dump(mode="json"),
                # Written explicitly for `wunschgegner`'s reason.
                "stufengroesse": bewerbung_data.stufengroesse,
                # Written even where the applicant named nobody, though the validator does not require
                # it: every application this endpoint creates then carries the key, and only the ones
                # stored before the field lack it.
                "wunschgegner": bewerbung_data.wunschgegner,
                # Null until the triage decides, which is what `status == "eingereicht"` claims.
                "entscheidung": None,
                # The deadline and the three hashes, so the sweep and the links have something to
                # judge; every application stored before this key carries none and is exempt from both.
                "bestaetigungsfrist": bestaetigungsfrist,
                "bestaetigungen": compose_bestaetigungen(hashes={seat: token_hash for seat, (_, token_hash) in tokens.items()}, today=today),
                # Left off a keyless press rather than stored null, which the validator's string type refuses.
                **({} if schluessel is None else {"idempotenz_schluessel": schluessel, "idempotenz_fingerabdruck": fingerabdruck}),
            },
            session=session,
        )

        return FLPostBewerbungResponse(
            created_id=created.inserted_id,
            saison_id=bewerbung_data.saison_id,
            eingereicht_am=today,
            bestaetigungen=FLBewerbungBestaetigungTokens(**{seat: raw for seat, (raw, _) in tokens.items()}),
            bestaetigungsfrist=bestaetigungsfrist,
        )

    # The key lookup is the transaction's first read: a first press committed before this snapshot is
    # found, and one committed after it makes the insert a write conflict `with_transaction` retries.
    async with db.start_session() as session:
        return await session.with_transaction(store_or_replay)
