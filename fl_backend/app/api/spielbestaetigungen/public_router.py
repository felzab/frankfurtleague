from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, sperrliste_saison
from app.api.spielbestaetigungen.crud import ANSICHT_SPIEL_FIELDS, pull_ansetzung_lage, pull_vorschlag_offen, verein_fields
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungAnsichtResponse,
    FLSpielbestaetigungAntwortPayload,
    FLSpielbestaetigungAntwortResponse,
    FLSpielbestaetigungTermin,
    FLSpielbestaetigungVonKontakt,
)
from app.api.spielbestaetigungen.services import (
    LINK_FIELDS,
    AnsetzungLage,
    ansicht_ansetzung_of,
    ansicht_snapshot_of,
    build_answerable_filter,
    build_token_filter,
    clubs_without_a_season_row,
    compose_antwort_update,
    find_gesperrt_link_refusal,
    find_spent_link_refusal,
    find_unknown_link_refusal,
    find_vorschlag_vergangen_refusal,
    first_press_refusal,
    proposal_payload,
    seat_adresse,
    seat_holding,
    seite_of,
    stand_moved,
    zustand_of,
)
from app.api.spiele.crud import pull_booked_slots, pull_booked_venue, pull_saison_membership, pull_spieltag_span
from app.api.spiele.schemas import FLSpiel, FLSpielOrtFieldPublic
from app.api.spiele.services import find_claims_made, find_clash_refusal, find_eligibility_refusal, find_fixture_date_refusal
from app.api.teams.crud import pull_team_names
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, refuse
from app.core.dependencies import (
    DBClient,
    SaisonTeamsCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
    SpielorteCollection,
    SpieltageCollection,
    TeamsCollection,
    get_german_date_str,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.security import bind_public_actor, verify_access_base
from app.core.transactions import transaction_session
from app.shared.schemas.bestaetigung import FLTokenPayload
from app.shared.tokens import hash_token

# Base tier and the public actor: the token is the whole credential, as a sign-in code is, for
# `app/api/bewerbungen/public_router.py`'s reason.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielbestaetigungen",
    dependencies=[Depends(verify_access_base), Depends(bind_public_actor)],
)


@router.post(
    "/ansicht",
    response_model=FLSpielbestaetigungAnsichtResponse,
    summary="What one fixture confirmation link opens",
)
async def get_spielbestaetigung_ansicht(
    ansicht_data: Annotated[FLTokenPayload, Body()],
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spiele_collection: SpieleCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spielorte_collection: SpielorteCollection,
    teams_collection: TeamsCollection,
    sperrliste: SperrlisteLookup,
    today: str = Depends(get_german_date_str),
) -> FLSpielbestaetigungAnsichtResponse:
    """
    Answer what the page renders for the fixture this token asks a club about, and nobody's name or address (`READ-ANSETZUNG-001`).

    The state, which side the reader's club plays, the fixture as it stands now (or, where it moved since the link, the
    Ansetzung the link asked about), the row's deadline, the other club's proposal and which role answered. A POST that
    reads, so the token travels in a body and never in a second URL. Refuses only a token no seat of any row holds
    (`link_ungueltig`), a guess and a link voided when its seat changed hands alike: an answered, closed, moved,
    decided or expired link is SERVED in that state rather than refused, so a reopened link shows what became of it. The
    state is `gesperrt`, ahead of every other, wherever the ban list holds the address the seat's links were mailed to.
    `vorschlag` is the state of an open link while the other club's decline proposes another date for the same
    Ansetzung, whose date and hour alone are served.
    """

    token_hash = hash_token(ansicht_data.token)

    # `find_one` rather than `pull_one_from_db`: a miss is this endpoint's own refusal, and no state term, so a spent link
    # is found and shown in its state.
    row = await spielbestaetigungen_collection.find_one(build_token_filter(token_hash=token_hash), projection=LINK_FIELDS)
    seat = None if row is None else seat_holding(spielbestaetigung_raw=row, token_hash=token_hash)
    refuse(find_unknown_link_refusal(seat=seat))
    assert row is not None and seat is not None

    lage = await pull_ansetzung_lage(
        spiele_collection=spiele_collection,
        saison_teams_collection=saison_teams_collection,
        spielbestaetigung_raw=row,
        spiel_projection=ANSICHT_SPIEL_FIELDS,
        verein_projection=verein_fields(team_id=row["partei"]["team_id"], seat=seat),
    )
    # The row read outside any transaction: an undraw or a replace committing since took the fixture and the row together.
    refuse(find_unknown_link_refusal(seat=None if lage is None else seat))
    assert lage is not None
    adresse = seat_adresse(lage=lage, spielbestaetigung_raw=row, seat=seat)
    gesperrt = bool(await adressen_gesperrt(sperrliste, [] if adresse is None else [adresse]))
    vorschlag_offen = await pull_vorschlag_offen(spielbestaetigungen_collection=spielbestaetigungen_collection, spielbestaetigung_raw=row)

    zustand = zustand_of(spielbestaetigung_raw=row, lage=lage, today=today, gesperrt=gesperrt, vorschlag_offen=vorschlag_offen)
    antwort = row.get("antwort")

    if stand_moved(spielbestaetigung_raw=row, lage=lage):
        venue = await pull_booked_venue(spielorte_collection, row["ansetzung"]["spielort_id"])
        spielort = (
            None
            if venue is None
            else FLSpielOrtFieldPublic(spielort_id=row["ansetzung"]["spielort_id"], name=venue.name, maps_link=venue.maps_link)
        )
        vereinsnamen = await pull_team_names(
            teams_collection=teams_collection, team_ids=clubs_without_a_season_row(spielbestaetigung_raw=row, lage=lage)
        )
        ansetzung = ansicht_snapshot_of(spielbestaetigung_raw=row, lage=lage, vereinsnamen=vereinsnamen, spielort=spielort)
    else:
        ansetzung = ansicht_ansetzung_of(lage.spiel)

    return FLSpielbestaetigungAnsichtResponse(
        zustand=zustand,
        seite=seite_of(row),
        ansetzung=ansetzung,
        frist=str(row["frist"]),
        # Never the row's own proposal on `abgelehnt`: the page shows an answered link its answering role alone.
        vorschlag=vorschlag_offen if zustand == "vorschlag" else None,
        beantwortet_von=antwort["von"] if zustand in ("zugesagt", "abgelehnt") and antwort is not None else None,
    )


@router.post(
    "",
    response_model=FLSpielbestaetigungAntwortResponse,
    summary="Confirm a fixture's Ansetzung, or decline it proposing another date",
)
async def post_spielbestaetigung(
    antwort_data: Annotated[FLSpielbestaetigungAntwortPayload, Body()],
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spiele_collection: SpieleCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spieltage_collection: SpieltageCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSpielbestaetigungAntwortResponse:
    """
    Record one club's answer about one Ansetzung, from whichever of its three seats presses first, and the seat it came from.

    The first press binds: a second seat pressing at once conflicts with it, and its retry finds the row answered
    (`ansetzung_beantwortet`). Writes no fixture: a proposal is the administrator's to act on.

    Refuses, in this order: a token no seat holds (`link_ungueltig`); a link whose seat's address the ban list holds
    now, whenever it was minted (`link_gesperrt`); a row already answered, closed since or not
    (`ansetzung_beantwortet`); one closed unanswered (`ansetzung_geschlossen`); a fixture decided, called off or left by a club
    (`ansetzung_entschieden`), then one whose date, time, ground or sides moved since the link (`ansetzung_geaendert`), each
    as the confirmation pass's close judges the row; an answer after the deadline's day (`ansetzung_frist_vorbei`); a
    proposal dated before today (`ansetzung_vorschlag_vergangen`); and a proposal the administrator's own save of that date would be
    refused, judged on what it newly claims and in that save's order: on or after a club's exit
    (`eligibility_disqualified`), outside the matchday (`spiel_outside_spieltag`), or within four hours of the ground's or the referee's
    other fixture (`spiel_double_booked`). The reason is stored as typed. Every refusal after the ban's is asked again outside
    the transaction just before answering, so a write landing mid-answer on what was judged refuses the answer rather
    than letting it stand.
    """

    token_hash = hash_token(antwort_data.token)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await sperrliste_saison(sperrliste)
    vorschlag = (
        None
        if antwort_data.vorschlag is None
        else FLSpielbestaetigungTermin(datum=antwort_data.vorschlag.datum, uhrzeit=antwort_data.vorschlag.uhrzeit)
    )

    async def answer_for_the_seat(session: AsyncClientSession) -> FLSpielbestaetigungAntwortResponse:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it."""

        row = await spielbestaetigungen_collection.find_one(build_token_filter(token_hash=token_hash), projection=LINK_FIELDS, session=session)
        seat = None if row is None else seat_holding(spielbestaetigung_raw=row, token_hash=token_hash)
        refuse(find_unknown_link_refusal(seat=seat))
        assert row is not None and seat is not None

        lage = await pull_ansetzung_lage(
            spiele_collection=spiele_collection,
            saison_teams_collection=saison_teams_collection,
            spielbestaetigung_raw=row,
            spiel_projection=None,
            verein_projection=verein_fields(team_id=row["partei"]["team_id"], seat=seat),
            session=session,
        )
        # One snapshot with the row, and the fixture is removed with its rows in one transaction.
        assert lage is not None
        adresse = seat_adresse(lage=lage, spielbestaetigung_raw=row, seat=seat)
        gesperrt = await adressen_gesperrt(
            sperrliste, [] if adresse is None else [adresse], massgebliche_saison_id=massgebliche_saison_id, session=session
        )
        # The ban alone is not asked again below: one committing after this read bars the next press, and an answer
        # given before it stands.
        refuse(find_gesperrt_link_refusal(gesperrt=bool(gesperrt)))

        async def judge(gegen: AnsetzungLage, reads: AsyncClientSession | None) -> None:
            """Every other refusal, over this Ansetzung and reads under `reads`: asked in the transaction, then again outside it."""

            refuse(find_spent_link_refusal(spielbestaetigung_raw=row, lage=gegen, today=today))

            if vorschlag is not None:
                refuse(find_vorschlag_vergangen_refusal(vorschlag=vorschlag, today=today))

                stored = FLSpiel.model_validate(gegen.spiel)
                proposed = proposal_payload(stored, vorschlag)

                # The administrator's save's judges in its order, each read just ahead of the one refusal that consumes it.
                membership = await pull_saison_membership(
                    saison_teams_collection=saison_teams_collection, saison_id=stored.saison_id, session=reads
                )
                # The composer spelled at the call: its kept sides are what disarm this check's no-membership code here.
                refuse(find_eligibility_refusal(stored.id, proposal_payload(stored, vorschlag), [stored], membership))

                span = await pull_spieltag_span(spieltage_collection=spieltage_collection, spieltag_id=stored.spieltag_id, session=reads)
                if span is not None:
                    refuse(find_fixture_date_refusal(datum=proposed.datum, spieltag_beginn=span.beginn, spieltag_ende=span.ende))

                # Last, as in the save: it validates every season's fixtures, and a hand-edited one raises, answering 500 for a
                # proposal an earlier rule refuses. Only claims the stored fixture did not make.
                booked = await pull_booked_slots(
                    spiele_collection=spiele_collection, spiel_id=stored.id, claims=find_claims_made(stored, proposed), session=reads
                )
                refuse(find_clash_refusal(datum=proposed.datum, uhrzeit=proposed.uhrzeit, booked=booked))

        await judge(lage, session)

        try:
            await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={**build_token_filter(token_hash=token_hash), **build_answerable_filter()},
                update=compose_antwort_update(
                    antwort=antwort_data.antwort,
                    seat=seat,
                    adresse=adresse,
                    schluessel=sperrliste.schluessel,
                    vorschlag=vorschlag,
                    begruendung=antwort_data.begruendung,
                    today=today,
                ),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )
        except DocumentNotFoundError:
            # Never a seat answering under this press, which conflicts with the write and meets the retry's judgement:
            # the filter repeats that judgement on the write.
            refuse(first_press_refusal())

        # Nothing judged is written here, so a move, a club's exit, a renamed seat, a re-dated matchday or a rival booking
        # landing under this transaction raises no conflict: all judged again outside it before answering.
        jetzt = await pull_ansetzung_lage(
            spiele_collection=spiele_collection,
            saison_teams_collection=saison_teams_collection,
            spielbestaetigung_raw=row,
            spiel_projection=None,
            verein_projection=verein_fields(team_id=row["partei"]["team_id"], seat=seat),
            session=None,
        )
        # An undraw removing the fixture deletes this row in its transaction, a write conflict while this one holds it.
        assert jetzt is not None
        await judge(jetzt, None)

        return FLSpielbestaetigungAntwortResponse(
            zustand=antwort_data.antwort, beantwortet_von=FLSpielbestaetigungVonKontakt(art="kontakt", rolle=seat), vorschlag=vorschlag
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(answer_for_the_seat)
