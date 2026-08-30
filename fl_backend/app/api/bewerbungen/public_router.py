from typing import Annotated, Any, Mapping

from fastapi import APIRouter, Body, Depends

from app.api.bewerbungen.schemas import (
    FLBewerbungFensterResponse,
    FLBewerbungKuerzelResponse,
    FLBewerbungSchulenResponse,
    FLBewerbungSchuleOptionListAdapter,
    FLPostBewerbungPayload,
    FLPostBewerbungResponse,
)
from app.api.bewerbungen.services import (
    compose_kontakte,
    find_already_entered_refusal,
    find_picked_club_refusal,
    find_shorthand_refusal,
    find_submission_subject_refusal,
    find_window_refusal,
    window_is_running,
)
from app.core.config import API_VERSION
from app.core.crud import post_one_to_db, pull_many_from_db, pull_one_from_db, refuse
from app.core.dependencies import (
    BewerbungenCollection,
    SaisonsCollection,
    SaisonTeamsCollection,
    TeamsCollection,
    get_german_date_str,
)
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

# What a season read serves this tier: the window and no other field. `docs/backend/spec.md :: I47`
# withholds a `future` season whole, and one taking applications IS `future`.
WINDOW_PROJECTION = ["bewerbung"]


def _fenster(*, saison_id: str, bewerbung: Any, today: str) -> FLBewerbungFensterResponse:
    """One window as this tier is served it, with the running judgement already taken."""

    return FLBewerbungFensterResponse(
        saison_id=saison_id,
        offen=bool(bewerbung["offen"]),
        von=str(bewerbung["von"]),
        bis=str(bewerbung["bis"]),
        laeuft=window_is_running(bewerbung=bewerbung, today=today),
    )


# Declared before `/fenster/{saison_id}`: a season id is four characters and the `objectid` convertor
# cannot constrain it, so route order is what keeps the literal out of the parameterised sibling
# (`docs/backend/spec.md :: I37`).
@router.get("/fenster", response_model=FLBewerbungFensterResponse, summary="The Saison currently accepting applications")
async def get_offenes_fenster(saisons_collection: SaisonsCollection, today: str = Depends(get_german_date_str)) -> FLBewerbungFensterResponse:
    """
    Return the season whose application window is open today; 404 when none is.

    The window alone, never the season: `docs/backend/spec.md :: I47` withholds a `future` one from
    this tier (`READ-BEWERBUNG-001`).
    """

    # Compared in the query rather than after it, so a closed season is never read. ISO dates order
    # lexicographically, which is how the rest of this application compares two.
    db_filter = {"bewerbung.offen": True, "bewerbung.von": {"$lte": today}, "bewerbung.bis": {"$gte": today}}

    # Sorted and limited rather than `find_one`: two open windows is a state an administrator can
    # create, and an arbitrary pick would move between reads. Newest season id first, ids being years.
    open_seasons = await pull_many_from_db(
        collection=saisons_collection, db_filter=db_filter, limit=1, sort_by=[("_id", -1)], projection=WINDOW_PROJECTION
    )

    if not open_seasons:
        raise DocumentNotFoundException(filter=db_filter, error_code=DOCUMENT_NOT_FOUND)

    return _fenster(saison_id=str(open_seasons[0]["_id"]), bewerbung=open_seasons[0]["bewerbung"], today=today)


@router.get("/fenster/{saison_id}", response_model=FLBewerbungFensterResponse, summary="One Saison's application window")
async def get_fenster(
    saison_id: str, saisons_collection: SaisonsCollection, today: str = Depends(get_german_date_str)
) -> FLBewerbungFensterResponse:
    """
    Return one season's application window; 404 when the season has none, or does not exist.

    A CLOSED window is served rather than hidden: the page says the deadline has passed, which a
    404 could not tell from a mistyped id.
    """

    db_filter = {"_id": saison_id}
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter=db_filter, projection=WINDOW_PROJECTION)

    # A season may carry `bewerbung: null` or no key at all -- every season stored before the field
    # existed does. Both are "no window recorded", which is a miss rather than an error.
    bewerbung = saison_raw.get("bewerbung")
    if not isinstance(bewerbung, Mapping):
        raise DocumentNotFoundException(filter=db_filter, error_code=DOCUMENT_NOT_FOUND)

    return _fenster(saison_id=saison_id, bewerbung=bewerbung, today=today)


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


@router.post("", response_model=FLPostBewerbungResponse, summary="Submit a Bewerbung")
async def post_bewerbung(
    bewerbung_data: Annotated[FLPostBewerbungPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    saisons_collection: SaisonsCollection,
    teams_collection: TeamsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    today: str = Depends(get_german_date_str),
) -> FLPostBewerbungResponse:
    """
    Store one school's application to play one season, exactly as it was submitted.

    Everything the league decides -- `status`, `eingereicht_am`, `entscheidung` and each consent's
    scope, source and date -- is written here and never taken off the payload.
    """

    # The season first, so a submission arriving after the deadline is refused before anything about
    # the applicant is looked up. The window is read under the same projection the public GET uses.
    saison_raw = await pull_one_from_db(
        collection=saisons_collection, db_filter={"_id": bewerbung_data.saison_id}, projection=WINDOW_PROJECTION
    )
    refuse(find_window_refusal(bewerbung=saison_raw.get("bewerbung"), today=today))

    # Then who is applying, because the two branches below judge different things.
    refuse(find_submission_subject_refusal(team_id=bewerbung_data.team_id, schule=bewerbung_data.schule))

    # Branched on `schule` rather than on `team_id`, so the narrowing the shorthand read needs is one
    # the type checker can follow: the refusal above has already made the two branches exclusive.
    if (schule := bewerbung_data.schule) is not None:
        # Asked of a NEW school alone: a picked club already holds its own shorthand, and refusing it
        # for that would make applying impossible.

        # NO `inactive_since` term: `uniq_shorthand` spans retired clubs, so narrowing this to live
        # ones would pass a submission here that acceptance then fails on a duplicate key.
        taken = await teams_collection.count_documents({"shorthand": schule.shorthand}, limit=1)
        refuse(find_shorthand_refusal(taken=taken > 0))
    else:
        # `find_one`, not `pull_one_from_db`: a club the picker never offered is refused with
        # `REQ-BEWERBUNG-006` rather than answering the 404 a miss would raise.
        team_raw = await teams_collection.find_one({"_id": bewerbung_data.team_id}, {"inactive_since": 1})
        refuse(find_picked_club_refusal(team_raw=team_raw))

        entered = await saison_teams_collection.count_documents(
            {"saison_id": bewerbung_data.saison_id, "team_id": bewerbung_data.team_id}, limit=1
        )
        refuse(find_already_entered_refusal(entered=entered > 0))

    # Every refusal is behind us, so the write follows with nothing left to judge. No transaction:
    # one insert into one collection, and the uniqueness the checks narrow is held at acceptance.
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
            # Null until the triage decides, which is what `status == "eingereicht"` claims.
            "entscheidung": None,
        },
    )

    return FLPostBewerbungResponse(created_id=created.inserted_id, saison_id=bewerbung_data.saison_id, eingereicht_am=today)
