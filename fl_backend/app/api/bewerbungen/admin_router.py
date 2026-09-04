from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.schemas import (
    FLAblehnenBewerbungPayload,
    FLAblehnenBewerbungResponse,
    FLAnnehmenBewerbungPayload,
    FLAnnehmenBewerbungResponse,
    FLBewerbung,
    FLBewerbungEinwilligungErneutResponse,
)
from app.api.bewerbungen.services import (
    bestaetigungsfrist_from,
    compose_erneut_update,
    compose_new_club,
    find_acceptance_subject_refusal,
    find_already_answered_refusal,
    find_new_club_refusal,
    find_triage_refusal,
    find_unconfirmed_kontakte_refusal,
    mint_token,
    parse_new_club,
    seat_named,
)
from app.api.saisons.schemas import FLSaisonRules
from app.api.teams.services import find_club_entry_refusal, find_entry_refusal
from app.core.config import API_VERSION
from app.core.crud import insert_live, patch_one_in_db, post_one_to_db, pull_many_from_db, pull_one_from_db, refuse
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
    confirmation block and is not held to it.
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
            team_raw = await pull_one_from_db(
                collection=teams_collection,
                db_filter={"_id": picked_team_id},
                projection=["name", "shorthand", "inactive_since"],
                session=session,
            )
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

        occupied_rows = await pull_many_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "gruppe": annahme_data.gruppe},
            projection=["_id"],
            session=session,
        )

        # REUSED, never restated: `REQ-ENTER-001` through `-003` are the season's own entry rules,
        # and a second copy of them here would be the copy that drifts.
        refuse(
            find_entry_refusal(
                saison_status=str(saison_raw["status"]),
                gruppe=annahme_data.gruppe,
                # Validated, not read raw: a season missing the capacity keys fails here rather than
                # admitting a school against a bound nobody chose.
                rules=FLSaisonRules.model_validate(saison_raw["rules"]),
                occupied=len(occupied_rows),
            )
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
                # The three people arrive WITH the season's row rather than being typed in after it:
                # they are what the application was, and `/admin/kontakte` reads them from here.
                "kontakte": bewerbung_raw["kontakte"],
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
        )

        return FLAnnehmenBewerbungResponse(
            updated_document=FLBewerbung(**updated_raw),
            team_id=team_id,
            created_team=schule is not None,
            saison_id=saison_id,
            gruppe=annahme_data.gruppe,
            trikot_farbe=annahme_data.trikot_farbe,
        )

    # `with_transaction`, not a bare `start_transaction`: the callback re-reads everything it judges,
    # so a retry after a write conflict judges the season as it stands then rather than as it stood.
    async with db.start_session() as session:
        return await session.with_transaction(accept_and_enter_the_school)


@router.post(f"{by_id('bewerbung_id')}/ablehnen", response_model=FLAblehnenBewerbungResponse, summary="Decline a Bewerbung")
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
)
async def erneut_einwilligung(
    bewerbung_id: CustomRouteObjectId,
    seat: str,
    bewerbungen_collection: BewerbungenCollection,
    today: str = Depends(get_german_date_str),
) -> FLBewerbungEinwilligungErneutResponse:
    """
    Mint a fresh link for one seat and answer it raw, for the caller to mail; the old link then opens nothing.

    The application's confirmation deadline restarts from today and the seat's reminder is owed again. Refused on an
    application already decided (`REQ-BEWERBUNG-001`) and on a seat already confirmed or declined, or one an
    application stored before the confirmation flow holds (`REQ-BEWERBUNG-011`). A path naming no seat is a 404.
    """

    db_filter = {"_id": bewerbung_id}
    bewerbung_raw = await pull_one_from_db(
        collection=bewerbungen_collection, db_filter=db_filter, projection=["status", "kontakte", "bestaetigungen"]
    )

    # A 404 rather than a 422, as a malformed path id answers: the segment names no seat any
    # application has, which is a miss and not a body fault.
    rolle = seat_named(seat)
    if rolle is None:
        raise DocumentNotFoundException(filter={**db_filter, "seat": seat}, error_code=DOCUMENT_NOT_FOUND)

    refuse(find_triage_refusal(status=str(bewerbung_raw["status"])))
    refuse(
        find_already_answered_refusal(kontakte=bewerbung_raw.get("kontakte"), bestaetigungen=bewerbung_raw.get("bestaetigungen"), seat=rolle)
    )

    raw, token_hash = mint_token()
    bestaetigungsfrist = bestaetigungsfrist_from(today=today)

    # The status is in the FILTER, as the decline's is: a decision landing between the read and this
    # write leaves the row untouched and answers the miss.
    await patch_one_in_db(
        collection=bewerbungen_collection,
        db_filter={**db_filter, "status": "eingereicht"},
        update=compose_erneut_update(seat=rolle, token_hash=token_hash, today=today, bestaetigungsfrist=bestaetigungsfrist),
    )

    return FLBewerbungEinwilligungErneutResponse(token=raw, rolle=rolle, bestaetigungsfrist=bestaetigungsfrist)
