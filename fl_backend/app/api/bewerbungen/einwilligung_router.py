from datetime import datetime
from typing import Annotated, Any, Mapping

from fastapi import APIRouter, Body, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.schemas import (
    FLBewerbungEinwilligungAnsichtPayload,
    FLBewerbungEinwilligungAnsichtResponse,
    FLBewerbungEinwilligungAntwortPayload,
    FLBewerbungEinwilligungAntwortResponse,
)
from app.api.bewerbungen.services import (
    ausstehende_seats,
    build_token_filter,
    compose_confirmation_update,
    compose_decline_update,
    find_already_answered_refusal,
    find_alter_refusal,
    find_expired_token_refusal,
    find_unknown_token_refusal,
    hash_token,
    paired_seat,
    seat_holding,
    zustand_of,
)
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import patch_many_in_db, patch_one_in_db, pull_one_from_db, refuse
from app.core.dependencies import AktionenCollection, BewerbungenCollection, DBClient, TeamsCollection, get_german_date_str, get_germany_now
from app.core.recording import build_redaction_filter, build_redaction_update, log_stamp
from app.core.security import bind_public_actor, verify_access_base

# A THIRD router on the prefix, beside the admin one and the public create: the token is the whole
# credential, as for a sign-in link, so both endpoints are base-tier and bound to the public actor
# for `app/api/bewerbungen/public_router.py`'s reason.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/bewerbungen/einwilligung",
    dependencies=[Depends(verify_access_base), Depends(bind_public_actor)],
)


async def _schule_name(*, bewerbung_raw: Mapping[str, Any], teams_collection: TeamsCollection) -> str:
    """The school's name as submitted, or the picked club's own."""

    schule = bewerbung_raw.get("schule")
    if isinstance(schule, Mapping):
        return str(schule.get("team_name") or "")

    team_raw = await pull_one_from_db(collection=teams_collection, db_filter={"_id": bewerbung_raw.get("team_id")}, projection=["name"])

    return str(team_raw.get("name") or "")


@router.post("/ansicht", response_model=FLBewerbungEinwilligungAnsichtResponse, summary="What one confirmation link opens")
async def get_einwilligung_ansicht(
    ansicht_data: Annotated[FLBewerbungEinwilligungAnsichtPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    teams_collection: TeamsCollection,
    today: str = Depends(get_german_date_str),
) -> FLBewerbungEinwilligungAnsichtResponse:
    """
    Answer what the page renders for the seat this token opens, and no contact record (`READ-BEWERBUNG-002`).

    The seat's state, the school, the season, the role, the holder's first name and the consent wording's version.
    A POST that reads, so the token travels in a body and never in a second URL. Refuses only a token no
    seat holds (`REQ-BEWERBUNG-009`): a confirmed, declined or expired link is SERVED in that state rather than refused,
    so a reopened link shows what became of it.
    """

    token_hash = hash_token(ansicht_data.token)

    # `find_one` rather than `pull_one_from_db`: a miss is this endpoint's own refusal, never a 404.
    bewerbung_raw = await bewerbungen_collection.find_one(build_token_filter(token_hash=token_hash))
    seat = None if bewerbung_raw is None else seat_holding(bewerbung_raw=bewerbung_raw, token_hash=token_hash)
    refuse(find_unknown_token_refusal(seat=seat))
    assert bewerbung_raw is not None and seat is not None

    # A declined or erased seat holds nobody, so the two fields naming the person are null there.
    slot = (bewerbung_raw.get("kontakte") or {}).get(seat)
    einwilligung = slot.get("einwilligung") if isinstance(slot, Mapping) else None

    return FLBewerbungEinwilligungAnsichtResponse(
        zustand=zustand_of(bewerbung_raw=bewerbung_raw, seat=seat, today=today),
        saison_id=str(bewerbung_raw["saison_id"]),
        schule=await _schule_name(bewerbung_raw=bewerbung_raw, teams_collection=teams_collection),
        rolle=seat,
        vorname=str(slot["vorname"]) if isinstance(slot, Mapping) else None,
        text_version=str(einwilligung["text_version"]) if isinstance(einwilligung, Mapping) else None,
    )


@router.post("", response_model=FLBewerbungEinwilligungAntwortResponse, summary="Confirm or decline one seat of a Bewerbung")
async def post_einwilligung(
    antwort_data: Annotated[FLBewerbungEinwilligungAntwortPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLBewerbungEinwilligungAntwortResponse:
    """
    Record one person's own answer for the seat their link opens, and for a second seat the form said they hold.

    A consent writes their date of birth, the stamp, `person` and the wording they were shown in one update;
    a decline empties their slot and redacts every log image holding it, as an erasure does. Refuses, in this order:
    a token no seat holds (`REQ-BEWERBUNG-009`), a link whose deadline has passed or whose application was decided
    (`REQ-BEWERBUNG-010`), a seat already answered (`REQ-BEWERBUNG-011`), and an age outside the league's span
    (`REQ-BEWERBUNG-012`) -- the last judged before anything is written, so a mistyped year spends nothing.
    """

    token_hash = hash_token(antwort_data.token)

    async def answer_for_the_person(session: AsyncClientSession) -> FLBewerbungEinwilligungAntwortResponse:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it.

        One transaction for both branches: a decline is two writes, and a consent judged outside
        the session could answer a seat a decline had just emptied.
        """

        bewerbung_raw = await bewerbungen_collection.find_one(build_token_filter(token_hash=token_hash), session=session)
        seat = None if bewerbung_raw is None else seat_holding(bewerbung_raw=bewerbung_raw, token_hash=token_hash)
        refuse(find_unknown_token_refusal(seat=seat))
        assert bewerbung_raw is not None and seat is not None

        kontakte, bestaetigungen = bewerbung_raw.get("kontakte"), bewerbung_raw.get("bestaetigungen")
        refuse(
            find_expired_token_refusal(
                bestaetigungsfrist=bewerbung_raw.get("bestaetigungsfrist"), status=bewerbung_raw.get("status"), today=today
            )
        )
        refuse(find_already_answered_refusal(kontakte=kontakte, bestaetigungen=bestaetigungen, seat=seat))

        # Both seats one person holds, so one click answers for the person rather than for one of
        # their two seats, and the equality the submission asserted survives the write.
        other = paired_seat(kontakte=kontakte, seat=seat)
        seats = (seat,) if other is None else (seat, other)

        if antwort_data.antwort == "erteilt":
            geburtsdatum = antwort_data.geburtsdatum
            assert geburtsdatum is not None
            refuse(find_alter_refusal(geburtsdatum=geburtsdatum, today=today))

            updated_raw = await patch_one_in_db(
                collection=bewerbungen_collection,
                db_filter={"_id": bewerbung_raw["_id"]},
                update=compose_confirmation_update(
                    seats=seats, geburtsdatum=geburtsdatum, today=today, text_version=antwort_data.text_version, whatsapp=antwort_data.whatsapp
                ),
                session=session,
            )

            return FLBewerbungEinwilligungAntwortResponse(
                ergebnis="bestaetigt",
                ausstehend=ausstehende_seats(kontakte=updated_raw.get("kontakte")),
                geburtsdatum=geburtsdatum,
                whatsapp=antwort_data.whatsapp,
            )

        updated_raw = await patch_one_in_db(
            collection=bewerbungen_collection,
            db_filter={"_id": bewerbung_raw["_id"]},
            update=compose_decline_update(seats=seats, today=today),
            session=session,
        )

        # LAST, so it reaches the pre-image the clearing patch just filed, which still holds the
        # person who refused to be held (`app/api/kontakte/admin_router.py :: erase_kontaktperson`).
        await patch_many_in_db(
            collection=aktionen_collection,
            db_filter=build_redaction_filter([(Collection.BEWERBUNGEN, [bewerbung_raw["_id"]])]),
            update=build_redaction_update(at=log_stamp(germany_now)),
            session=session,
        )

        return FLBewerbungEinwilligungAntwortResponse(
            ergebnis="abgelehnt",
            ausstehend=ausstehende_seats(kontakte=updated_raw.get("kontakte")),
            geburtsdatum=None,
            whatsapp=antwort_data.whatsapp,
        )

    async with db.start_session() as session:
        return await session.with_transaction(answer_for_the_person)
