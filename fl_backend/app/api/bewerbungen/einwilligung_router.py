from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.schemas import (
    FLBewerbungEinwilligungAnsichtPayload,
    FLBewerbungEinwilligungAnsichtResponse,
    FLBewerbungEinwilligungAntwortPayload,
    FLBewerbungEinwilligungAntwortResponse,
    FLEinwilligungAntwortResponse,
    FLSaisonTeamEinwilligungAntwortResponse,
)
from app.api.bewerbungen.services import (
    EINWILLIGUNG_ANSICHT_FIELDS,
    EINWILLIGUNG_ANTWORT_FIELDS,
    SAISON_EINWILLIGUNG_ANTWORT_FIELDS,
    SAISON_EINWILLIGUNG_FIELDS,
    ansprechperson_mailbox,
    ausstehende_seats,
    bewerbung_antwort_seite,
    bewerbung_schule,
    build_saison_token_filter,
    build_token_filter,
    compose_confirmation_update,
    compose_decline_update,
    compose_saison_decline_update,
    find_already_answered_refusal,
    find_alter_refusal,
    find_einwilligung_gesperrt_refusal,
    find_expired_token_refusal,
    find_saison_frist_refusal,
    find_saison_vorbei_einwilligung_refusal,
    find_unknown_token_refusal,
    hash_token,
    mindestalter_for,
    paired_seat,
    saison_antwort_seite,
    saison_frist_of,
    saison_link_pair,
    saison_schule,
    saison_zustand_of,
    seat_adressen,
    seat_holding,
    seat_vorname,
    zustand_of,
)
from app.api.einwilligung.services import find_fassung_refusal, find_selbst_medien_refusal
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, sperrliste_saison
from app.api.teams.services import kontakt_zeile_of
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import patch_many_in_db, patch_one_in_db, refuse
from app.core.dependencies import (
    AktionenCollection,
    BewerbungenCollection,
    DBClient,
    SaisonsCollection,
    SaisonTeamsCollection,
    TeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exception_handlers import stores_nothing
from app.core.recording import build_redaction_filter, build_redaction_update, log_stamp
from app.core.security import bind_public_actor, verify_access_base
from app.core.transactions import transaction_session
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from app.shared.schemas.bounds import MEDIEN_MIN_AGE_YEARS

# A THIRD router on the prefix, beside the admin one and the public create: the token is the whole
# credential, as a sign-in code is, so both endpoints are base-tier and bound to the public actor
# for `app/api/bewerbungen/public_router.py`'s reason.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/bewerbungen/einwilligung",
    dependencies=[Depends(verify_access_base), Depends(bind_public_actor)],
)


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
    einwilligung = slot.get("einwilligung") if isinstance(slot, Mapping) else None

    zugleich = saison_link_pair(kontakte=row.get("kontakte"), bestaetigungen=row.get("bestaetigungen"), seat=seat, token_hash=token_hash)
    seats = (seat,) if zugleich is None else (seat, zugleich)

    gesperrt = await adressen_gesperrt(sperrliste, seat_adressen(kontakte=row.get("kontakte"), seats=seats))
    # As the press reads it: no season is ever deleted, so a miss is a broken invariant rather than a 404.
    saison_raw = await saisons_collection.find_one({"_id": row["saison_id"]}, projection={"status": 1})
    assert saison_raw is not None

    return FLBewerbungEinwilligungAnsichtResponse(
        quelle="saison",
        zustand=saison_zustand_of(row=row, seat=seat, today=today, gesperrt=bool(gesperrt), saison_status=saison_raw.get("status")),
        zeile=kontakt_zeile_of(saison_status=saison_raw.get("status"), austritt=row.get("austritt")),
        saison_id=str(row["saison_id"]),
        schule=saison_schule(row),
        rolle=seat,
        zugleich_rolle=zugleich,
        vorname=str(slot["vorname"]) if isinstance(slot, Mapping) else None,
        text_version=str(einwilligung["text_version"]) if isinstance(einwilligung, Mapping) else None,
        laufende_fassung=LAUFENDE_FASSUNGEN[saison_antwort_seite(row=row, seats=seats)],
        mindestalter=mindestalter_for(seats),
        medien_mindestalter=MEDIEN_MIN_AGE_YEARS,
    )


@router.post(
    "/ansicht",
    response_model=FLBewerbungEinwilligungAnsichtResponse,
    summary="What one confirmation link opens",
    dependencies=[Depends(stores_nothing)],
)
async def get_einwilligung_ansicht(
    ansicht_data: Annotated[FLBewerbungEinwilligungAnsichtPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    teams_collection: TeamsCollection,
    sperrliste: SperrlisteLookup,
    today: str = Depends(get_german_date_str),
) -> FLBewerbungEinwilligungAnsichtResponse:
    """
    Answer what the page renders for the seat this token opens, and no contact record (`READ-BEWERBUNG-002`).

    The seat's state, the school, the season, the role, the holder's first name and the consent wording's version,
    and `zugleich_rolle`: the second seat the same person holds, which an answer on this link writes too, or null.
    `mindestalter` is the age this link's person has to reach, over both seats where they hold two, so the page offers
    exactly the dates the answer will take. `laufende_fassung` is the label of the page the person is shown and their
    answer must name: the applicant's where the applicant named them in every seat the link answers, else the one for a
    person the administration seated.
    A POST that reads, so the token travels in a body and never in a second URL. Refuses only a token no
    seat holds (`REQ-BEWERBUNG-009`): a confirmed, declined or expired link is SERVED in that state rather than refused,
    so a reopened link shows what became of it. The state is `gesperrt`, ahead of every other, wherever the ban list
    holds an address a consent on this link would be refused for (`REQ-BEWERBUNG-020`), so the page offers a barred
    person nothing to press.

    The same token may open a seat an administrator entered on a team's season row (`quelle: saison`): `schule` is then
    the name the club carries that season, and the link is over once its seat's own deadline has passed. Before that, a
    season that has ended or a team that has left it answers `saison_vorbei`: the link takes a Widerspruch and no consent.
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

    # A declined or erased seat holds nobody, so the two fields naming the person are null there.
    slot = (bewerbung_raw.get("kontakte") or {}).get(seat)
    einwilligung = slot.get("einwilligung") if isinstance(slot, Mapping) else None

    # The answer's own resolution, so the page names exactly the seats a press will write and states
    # the floor that press will be judged by.
    zugleich = paired_seat(kontakte=bewerbung_raw.get("kontakte"), bestaetigungen=bewerbung_raw.get("bestaetigungen"), seat=seat)
    seats = (seat,) if zugleich is None else (seat, zugleich)

    gesperrt = await adressen_gesperrt(sperrliste, seat_adressen(kontakte=bewerbung_raw.get("kontakte"), seats=seats))

    return FLBewerbungEinwilligungAnsichtResponse(
        quelle="bewerbung",
        zustand=zustand_of(bewerbung_raw=bewerbung_raw, seat=seat, today=today, gesperrt=bool(gesperrt)),
        zeile=None,
        saison_id=str(bewerbung_raw["saison_id"]),
        schule=await _schule_name(bewerbung_raw=bewerbung_raw, teams_collection=teams_collection),
        rolle=seat,
        zugleich_rolle=zugleich,
        vorname=str(slot["vorname"]) if isinstance(slot, Mapping) else None,
        text_version=str(einwilligung["text_version"]) if isinstance(einwilligung, Mapping) else None,
        laufende_fassung=LAUFENDE_FASSUNGEN[bewerbung_antwort_seite(bewerbung_raw=bewerbung_raw, seats=seats)],
        mindestalter=mindestalter_for(seats),
        medien_mindestalter=MEDIEN_MIN_AGE_YEARS,
    )


@router.post(
    "",
    response_model=FLEinwilligungAntwortResponse,
    summary="Confirm or decline one seat of a Bewerbung or of a team's season row",
)
async def post_einwilligung(
    antwort_data: Annotated[FLBewerbungEinwilligungAntwortPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    aktionen_collection: AktionenCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLBewerbungEinwilligungAntwortResponse | FLSaisonTeamEinwilligungAntwortResponse:
    """
    Record one person's own answer for the seat their link opens, and for a second seat the form said they hold.

    A consent writes their date of birth, the stamp, `person` and the wording they were shown in one update, each
    choice with its evidence, and leaves who seated them as it stands; a decline empties their slot and redacts
    every log image holding it, as an erasure does. Refuses, in this order: a token no seat holds (`REQ-BEWERBUNG-009`),
    a link whose deadline has passed or whose application was decided (`REQ-BEWERBUNG-010`), a seat already answered
    (`REQ-BEWERBUNG-011`), a consent naming any label but the one the view answered as `laufende_fassung` for this link
    (`REQ-EINWILLIGUNG-001`), a consent from an address the ban list holds now, whenever the link was minted
    (`REQ-BEWERBUNG-020`), an age outside the span the seats this person holds ask for (`REQ-BEWERBUNG-012`), and a
    media consent from a person below `medien_mindestalter` (`REQ-EINWILLIGUNG-002`) -- the last four judged before
    anything is written, so a reloaded page or a mistyped year spends nothing. A decline
    stores no label and is taken from a barred address too: it empties the seat.

    The answer also carries what the two outbound messages are composed from, the Ansprechperson seat's own
    mailbox among it: this is a server-to-server response, and a caller putting it in front of a browser
    would hand one contact person another's address.

    A link on a team's season row (`quelle: saison`) is answered the same way on that row, refused in the same order but
    for `REQ-BEWERBUNG-010`, nothing deciding a season row, and its answer carries nothing to compose a message from. Its
    own deadline passed is `REQ-KONTAKT-004`, and a consent once its season has ended or its team has left it is
    `REQ-KONTAKT-006`, a Widerspruch being taken all the same.
    """

    token_hash = hash_token(antwort_data.token)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`), and only for the
    # answer that asks the ban.
    massgebliche_saison_id = await sperrliste_saison(sperrliste) if antwort_data.antwort == "erteilt" else None

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
            assert geburtsdatum is not None

            # Unanchored: the rollover reads nothing this press writes, so one committing inside it orders as
            # one committing just after (`docs/backend/spec.md :: I579`).
            saison_raw = await saisons_collection.find_one({"_id": row["saison_id"]}, projection={"status": 1}, session=session)
            # `find_one` rather than `pull_one_from_db`: no season is ever deleted, so a miss is a broken
            # invariant rather than a 404 this press could answer.
            assert saison_raw is not None
            # Every link on a closed row meets this here, whether minted before it closed, beside its
            # rollover or after it; never the Widerspruch below, which removes the person
            # (`docs/backend/spec.md :: I570`).
            refuse(find_saison_vorbei_einwilligung_refusal(saison_status=saison_raw.get("status"), austritt=row.get("austritt")))

            # Against the one page the view answered for these seats.
            seite = saison_antwort_seite(row=row, seats=seats)
            refuse(find_fassung_refusal(seite=seite, genannt={seat: antwort_data.text_version}))

            # Asked at the press, however old the link, as the application's consent asks it
            # (`docs/backend/spec.md :: I505`); never of the Widerspruch below.
            gesperrt = await adressen_gesperrt(
                sperrliste, seat_adressen(kontakte=kontakte, seats=seats), massgebliche_saison_id=massgebliche_saison_id, session=session
            )
            refuse(find_einwilligung_gesperrt_refusal(gesperrt=bool(gesperrt)))
            refuse(find_alter_refusal(geburtsdatum=geburtsdatum, today=today, mindestalter=mindestalter_for(seats)))
            refuse(find_selbst_medien_refusal(gespeichert=None, medien=antwort_data.medien, geburtsdatum=geburtsdatum, today=today))

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

        await patch_one_in_db(
            collection=saison_teams_collection,
            db_filter={"_id": row["_id"]},
            update=compose_saison_decline_update(seats=seats, today=today),
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

        # LAST, for the application's reason: it reaches the pre-image the clearing patch just filed,
        # which still holds the person who refused to be held.
        await patch_many_in_db(
            collection=aktionen_collection,
            db_filter=build_redaction_filter([(Collection.SAISON_TEAMS, [row["_id"]])]),
            update=build_redaction_update(at=log_stamp(germany_now)),
            session=session,
        )

        return FLSaisonTeamEinwilligungAntwortResponse(ergebnis="abgelehnt", geburtsdatum=None, whatsapp=antwort_data.whatsapp, medien=False)

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
            assert geburtsdatum is not None

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
            refuse(find_selbst_medien_refusal(gespeichert=None, medien=antwort_data.medien, geburtsdatum=geburtsdatum, today=today))

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

            bestaetigt_email, bestaetigt_rollen = ansprechperson_mailbox(kontakte=updated_raw.get("kontakte"))

            return FLBewerbungEinwilligungAntwortResponse(
                quelle="bewerbung",
                ergebnis="bestaetigt",
                ausstehend=ausstehende_seats(kontakte=updated_raw.get("kontakte")),
                geburtsdatum=geburtsdatum,
                whatsapp=antwort_data.whatsapp,
                medien=antwort_data.medien,
                bewerbung_id=bewerbung_raw["_id"],
                saison_id=saison_id,
                rolle=seat,
                vorname=vorname,
                bestaetigungsfrist=bestaetigungsfrist,
                ansprechperson_email=bestaetigt_email,
                ansprechperson_rollen=bestaetigt_rollen,
            )

        updated_raw = await patch_one_in_db(
            collection=bewerbungen_collection,
            db_filter={"_id": bewerbung_raw["_id"]},
            update=compose_decline_update(seats=seats, today=today),
            session=session,
            return_document=ReturnDocument.AFTER,
        )

        # LAST, so it reaches the pre-image the clearing patch just filed, which still holds the
        # person who refused to be held (`app/api/kontakte/admin_router.py :: erase_kontaktperson`).
        await patch_many_in_db(
            collection=aktionen_collection,
            db_filter=build_redaction_filter([(Collection.BEWERBUNGEN, [bewerbung_raw["_id"]])]),
            update=build_redaction_update(at=log_stamp(germany_now)),
            session=session,
        )

        # Off the UPDATED document, so an Ansprechperson who has just declined leaves this null and
        # the message their decline would have gone to is not composed at all.
        abgelehnt_email, abgelehnt_rollen = ansprechperson_mailbox(kontakte=updated_raw.get("kontakte"))

        return FLBewerbungEinwilligungAntwortResponse(
            quelle="bewerbung",
            ergebnis="abgelehnt",
            ausstehend=ausstehende_seats(kontakte=updated_raw.get("kontakte")),
            geburtsdatum=None,
            whatsapp=antwort_data.whatsapp,
            medien=False,
            bewerbung_id=bewerbung_raw["_id"],
            saison_id=saison_id,
            rolle=seat,
            vorname=vorname,
            bestaetigungsfrist=bestaetigungsfrist,
            ansprechperson_email=abgelehnt_email,
            ansprechperson_rollen=abgelehnt_rollen,
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(answer_for_the_person)
