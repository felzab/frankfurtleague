from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from bson import ObjectId
from fastapi import APIRouter, Body, Depends, Query
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.identitaet.crud import refuse_without_a_seat
from app.api.identitaet.lookup import SubjektLookup
from app.api.identitaet.services import ist_eigene_registrierung
from app.api.konto.crud import press_widerruf
from app.api.konto.services import KONTO_SEITE_SPIELER, compose_person_move, find_eigener_eintrag_refusal, widerruf_line
from app.api.outbox.schemas import FLOutboxReference, FLRegistrierungAbsageData
from app.api.outbox.services import OwedMail, enqueue_mails
from app.api.registrierungen.crud import (
    nummern_rows,
    persons_at,
    pull_offene_registrierung,
    pull_offene_registrierungen,
)
from app.api.registrierungen.schemas import (
    FLOffeneRegistrierungenParams,
    FLOpenRegistrierung,
    FLOpenRegistrierungenResponse,
    FLRegistrierungAccountEinwilligungResponse,
    FLRegistrierungAdmissionResponse,
    FLRegistrierungAdmitPayload,
    FLRegistrierungDeclinePayload,
    FLRegistrierungDeclineResponse,
)
from app.api.registrierungen.services import (
    compose_ablehnung_update,
    compose_kader_fields,
    compose_person,
    compose_person_update,
    find_gesperrt_refusal,
    find_person_fehlt_refusal,
    find_person_refusal,
    find_schon_im_kader_refusal,
    find_stufe_refusal,
    find_unbestaetigt_refusal,
    nummern_im_kader,
    person_weicht_ab,
    registrierung_ist_bestaetigt,
    traegt_wahlen,
)
from app.api.sperrliste.guard import PERSON_ACTOR_BINDERS, KontaktIdentifier, SpielerIdentifier
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, sperrliste_saison
from app.api.spieler.crud import refuse_a_full_squad
from app.api.spieltage.crud import nachnominierung_laeuft_in
from app.core.collections import Collection
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import (
    erase_many_from_db,
    patch_one_in_db,
    post_one_to_db,
    pull_one_from_db,
    redact_log_rows_in_db,
    refuse,
)
from app.core.dependencies import (
    ActionLogCollection,
    DBClient,
    OutboxCollection,
    RegistrierungenCollection,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonTeamsCollection,
    SpielerCollection,
    SpieltageCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.journal import Journal
from app.core.recording import log_stamp
from app.core.routing import by_id
from app.core.security import erasure_journal_hash, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung_nachweis import FLEinwilligungChoice, nachweis_stand_of
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import CustomRouteObjectId
from app.shared.schemas.einwilligung import FLAccountEinwilligungPayload

# The person lane's binder in place of `bind_actor`: a seat holder signs in by code and holds no
# grant, so the administrator's actor check would refuse every one of them.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/registrierungen",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["kontakt"])],
)


@router.get(
    "/kader/{team_id:objectid}/{saison_id}",
    response_model=FLOpenRegistrierungenResponse,
    summary="A team's pending registrations for one season",
)
async def get_open_registrierungen(
    team_id: CustomRouteObjectId,
    saison_id: str,
    params: Annotated[FLOffeneRegistrierungenParams, Query()],
    identifier: KontaktIdentifier,
    registrierungen_collection: RegistrierungenCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    spieler_collection: SpielerCollection,
    records: SubjektLookup,
    db: DBClient,
) -> FLOpenRegistrierungenResponse:
    """
    Every pending registration for this team's season, each marked admissible or not by whether the pupil has confirmed it.

    A confirmed row names the stored person its address resolves to, flagged where that person's name or birthdate
    differs. An unconfirmed row names nobody: its address is unproven.
    No address, telephone number, birthdate or consent record is served for anybody.
    `complete` is false where more pending rows exist than `limit` serves.
    """

    # A snapshot rather than a transaction: this writes nothing, and one point in time keeps the
    # seat, the rows and the persons they resolve to from straddling a commit.
    async with db.start_session(snapshot=True) as session:
        await refuse_without_a_seat(identifier, records, team_id=team_id, saison_id=saison_id, session=session)

        read = await pull_offene_registrierungen(
            registrierungen_collection=registrierungen_collection,
            saison_id=saison_id,
            team_id=team_id,
            limit=params.limit,
            order=params.order,
            session=session,
        )
        served = read[: params.limit]
        bestaetigte = [row for row in served if registrierung_ist_bestaetigt(einwilligung=row.get("einwilligung"))]

        persons = await persons_at(
            spieler_collection=spieler_collection,
            adressen=[sign_in_identifier(str(row["email"])) for row in bestaetigte],
            session=session,
        )
        by_address = {person["email"]: person for person in persons}

        worn = nummern_im_kader(
            await nummern_rows(saison_spieler_collection=saison_spieler_collection, saison_id=saison_id, team_id=team_id, session=session)
        )

        def as_served(row: Mapping[str, Any]) -> FLOpenRegistrierung:
            aufnehmbar = registrierung_ist_bestaetigt(einwilligung=row.get("einwilligung"))
            person = by_address.get(sign_in_identifier(str(row["email"]))) if aufnehmbar else None

            return FLOpenRegistrierung.model_validate(
                {
                    "registrierung_id": row["_id"],
                    "submitted_at": row["submitted_at"],
                    "vorname": row["vorname"],
                    "nachname": row["nachname"],
                    "nummer": row.get("nummer"),
                    "position": row.get("position"),
                    "stufe": row.get("stufe"),
                    "admissible": aufnehmbar,
                    "nummer_double": row.get("nummer") in worn,
                    "person": None
                    if person is None
                    else {
                        "spieler_id": person["_id"],
                        "vorname": person["vorname"],
                        "nachname": person.get("nachname"),
                        "deviates_from": person_weicht_ab(registrierung_raw=row, spieler_raw=person),
                    },
                }
            )

    return FLOpenRegistrierungenResponse(
        team_id=team_id,
        saison_id=saison_id,
        registrierungen=[as_served(row) for row in served],
        complete=len(read) <= params.limit,
    )


@router.post(
    f"{by_id('registrierung_id')}/admit",
    response_model=FLRegistrierungAdmissionResponse,
    summary="Admit a registration into the team's squad",
)
async def admit(
    registrierung_id: CustomRouteObjectId,
    aufnahme_data: Annotated[FLRegistrierungAdmitPayload, Body()],
    identifier: KontaktIdentifier,
    registrierungen_collection: RegistrierungenCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    saisons_collection: SaisonsCollection,
    spieler_collection: SpielerCollection,
    records: SubjektLookup,
    spieltage_collection: SpieltageCollection,
    aktionen_collection: ActionLogCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLRegistrierungAdmissionResponse:
    """
    Admit one confirmed registration: the person it resolves to, or a new one, joins the team's squad, and the registration is erased.

    The person survives the season, so the admission first looks for them: the stored person holding the
    registration's address IS that person, and is updated with the registration's name and, where the new pupil's page
    asked them, its birthdate and its freshly confirmed consent record: one confirmed on the returning pupil's page
    leaves the person's own birthdate standing, as an administrator may have corrected it since. Where that person's
    name or birthdate differs, `spieler_id` must name them (the team said it is the same person). With no such
    person, `spieler_id` is null for a new one. A retired person comes back. A pending address change of theirs
    stands, asked over the address this admission proves again.

    The squad row takes the registration's number, position and Stufe, no role, and a Nachnominierung marker derived
    today; this person's retired row of this season is rewritten rather than a second one written, whichever team
    it was on. The registration is deleted and its values redacted from the log in the same transaction, so a second
    press meets no row. Its submission key moves onto the squad row, so the submission replayed later stores nothing.

    Refuses, in this order: no pending registration with this id (404), no seat on its team's season
    (`role_not_held`), a registration the pupil has not confirmed (`registrierung_unconfirmed`), an address the ban list
    holds (`registrierung_adresse_barred`, worded to the team as neutrally as to the pupil), a Stufe the season does not offer
    (`registrierung_stufe_not_allowed`), a registration confirmed on the returning pupil's page whose address holds no stored
    person (`registrierung_person_missing`: it carries no choice, so it admits nobody, and the pupil registers again), a
    `spieler_id` that is not the person this registration may be admitted into (`registrierung_person_not_named`), a person
    already playing in a squad this season (`registrierung_already_in_kader`) and a full squad (`kader_full`). Nothing is
    written on any of them.
    """

    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await sperrliste_saison(sperrliste)

    async def admit_the_pupil(session: AsyncClientSession) -> FLRegistrierungAdmissionResponse:
        """Judge, then write the person, the squad row and the erasure. Everything judged is read in-session."""

        registrierung_raw = await pull_offene_registrierung(
            registrierungen_collection=registrierungen_collection, registrierung_id=registrierung_id, session=session
        )
        saison_id = str(registrierung_raw["saison_id"])
        team_id = registrierung_raw["team_id"]

        await refuse_without_a_seat(identifier, records, team_id=team_id, saison_id=saison_id, session=session)
        refuse(find_unbestaetigt_refusal(einwilligung=registrierung_raw.get("einwilligung")))

        # Inside the transaction, with no season anchor: a ban writes no registration, so only this
        # read orders a ban entered between the team's read and its press.
        gesperrt = await adressen_gesperrt(
            sperrliste, [str(registrierung_raw["email"])], massgebliche_saison_id=massgebliche_saison_id, session=session
        )
        refuse(find_gesperrt_refusal(barred=bool(gesperrt)))

        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["rules"], session=session)
        erlaubte_stufen = list((saison_raw.get("rules") or {}).get("allowed_stufen") or [])
        refuse(find_stufe_refusal(stufe=registrierung_raw.get("stufe"), allowed_stufen=erlaubte_stufen))

        adresse = sign_in_identifier(str(registrierung_raw["email"]))
        resolved = await persons_at(spieler_collection=spieler_collection, adressen=[adresse], session=session)
        adresse_raw = resolved[0] if resolved else None
        # Before the body is judged: the team's answer cannot stand in for the person the pupil confirmed as.
        refuse(find_person_fehlt_refusal(registrierung_raw=registrierung_raw, adresse_raw=adresse_raw))
        refuse(find_person_refusal(registrierung_raw=registrierung_raw, adresse_raw=adresse_raw, spieler_id=aufnahme_data.spieler_id))
        person_raw = adresse_raw
        spieler_id = person_raw["_id"] if person_raw is not None else ObjectId()

        kader_raw = (
            await saison_spieler_collection.find_one({"spieler_id": spieler_id, "saison_id": saison_id}, session=session)
            if person_raw is not None
            else None
        )
        refuse(find_schon_im_kader_refusal(kader_raw=kader_raw))

        await refuse_a_full_squad(
            saison_spieler_collection=saison_spieler_collection,
            saisons_collection=saisons_collection,
            saison_id=saison_id,
            team_id=team_id,
            spieler_id=spieler_id,
            session=session,
        )

        if person_raw is None:
            await post_one_to_db(
                collection=spieler_collection,
                document=compose_person(spieler_id=spieler_id, registrierung_raw=registrierung_raw, adresse=adresse),
                session=session,
            )
        else:
            # Read here, not by the address lookup, which serves no consent record:
            # a choice the person moved after confirming the
            # registration stands.
            gespeichert = await spieler_collection.find_one({"_id": spieler_id}, projection={"einwilligung": 1}, session=session)
            await patch_one_in_db(
                collection=spieler_collection,
                db_filter={"_id": spieler_id},
                update=compose_person_update(
                    registrierung_raw=registrierung_raw, gespeichert=(gespeichert or {}).get("einwilligung"), adresse=adresse
                ),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )

        kader_fields = compose_kader_fields(
            registrierung_raw=registrierung_raw,
            team_id=team_id,
            is_nachnominiert=await nachnominierung_laeuft_in(
                spieltage_collection=spieltage_collection, saison_id=saison_id, today=today, session=session
            ),
        )
        if kader_raw is None:
            await post_one_to_db(
                collection=saison_spieler_collection,
                document={"spieler_id": spieler_id, "saison_id": saison_id, **kader_fields},
                session=session,
            )
        else:
            # The retired row and never a second one: `uniq_spieler_id_saison_id` keeps one row per
            # player per season, a retired one included.
            await patch_one_in_db(
                collection=saison_spieler_collection,
                db_filter={"_id": kader_raw["_id"]},
                update={"$set": kader_fields},
                session=session,
                return_document=ReturnDocument.BEFORE,
            )

        # An ID filter alone: the log keeps a filter as text, so one naming the pupil would keep
        # what this erasure destroys.
        await erase_many_from_db(
            collection=registrierungen_collection, db_filter={"_id": registrierung_id, "saison_id": saison_id}, session=session
        )
        await redact_log_rows_in_db(
            action_log_collection=aktionen_collection,
            targets=[(Collection.REGISTRIERUNGEN, [registrierung_id])],
            at=log_stamp(germany_now),
            session=session,
        )

        return FLRegistrierungAdmissionResponse(
            registrierung_id=registrierung_id,
            spieler_id=spieler_id,
            team_id=team_id,
            saison_id=saison_id,
            vorname=registrierung_raw["vorname"],
            nachname=registrierung_raw["nachname"],
            nummer=kader_fields["nummer"],
            position=kader_fields["position"],
            stufe=kader_fields["stufe"],
            is_nachnominiert=kader_fields["is_nachnominiert"],
        )

    # The squad cap's own write moved the season.
    async with transaction_session(db) as session:
        return await session.with_transaction(admit_the_pupil)


@router.post(
    f"{by_id('registrierung_id')}/decline",
    response_model=FLRegistrierungDeclineResponse,
    summary="Decline a registration",
)
async def decline(
    registrierung_id: CustomRouteObjectId,
    ablehnung_data: Annotated[FLRegistrierungDeclinePayload, Body()],
    identifier: KontaktIdentifier,
    registrierungen_collection: RegistrierungenCollection,
    saison_teams_collection: SaisonTeamsCollection,
    outbox_collection: OutboxCollection,
    records: SubjektLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLRegistrierungDeclineResponse:
    """
    Decline one pending registration, confirmed or not: its state and the decision are written, and the pupil's note owed.

    The decision records the declining seat holder's address and a reason from a closed set, never free text:
    `other_person` where the team answered that the registration is not the person its address belongs to. The
    row stays until the retention sweep erases it a month later. The note is owed in the same transaction, and only
    where the pupil confirmed their address: an unconfirmed one may be a stranger's, typed by whoever held the link.

    Refuses, in this order, no pending registration with this id (404) and no seat on its team's season
    (`role_not_held`).
    """

    async def decline_for_the_team(session: AsyncClientSession) -> FLRegistrierungDeclineResponse:
        registrierung_raw = await pull_offene_registrierung(
            registrierungen_collection=registrierungen_collection, registrierung_id=registrierung_id, session=session
        )
        saison_id = str(registrierung_raw["saison_id"])
        team_id = registrierung_raw["team_id"]

        await refuse_without_a_seat(identifier, records, team_id=team_id, saison_id=saison_id, session=session)

        await patch_one_in_db(
            collection=registrierungen_collection,
            # By `_id` alone: a decision landing after the read conflicts with this write, and the retry's
            # read finds nothing pending (`TestTheDecline`), so no status term is reached.
            db_filter={"_id": registrierung_id},
            update=compose_ablehnung_update(von=identifier, grund=ablehnung_data.grund, today=today),
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

        # The seat check just found this junction row, so it stands.
        junction_raw = await pull_one_from_db(
            collection=saison_teams_collection, db_filter={"saison_id": saison_id, "team_id": team_id}, projection=["name"], session=session
        )

        if registrierung_ist_bestaetigt(einwilligung=registrierung_raw.get("einwilligung")):
            await enqueue_mails(
                outbox_collection=outbox_collection,
                session=session,
                mails=[
                    OwedMail(
                        # A decline is taken once: a pending row is what this transaction reads, and it leaves that state.
                        key=f"{Collection.REGISTRIERUNGEN}/{registrierung_id}/absage",
                        an=str(registrierung_raw["email"]),
                        data=FLRegistrierungAbsageData(
                            art="registrierung_absage",
                            vorname=str(registrierung_raw["vorname"]),
                            team=str(junction_raw["name"]),
                            saison_id=saison_id,
                            grund=ablehnung_data.grund,
                        ),
                        reference=FLOutboxReference(collection=Collection.REGISTRIERUNGEN, id=registrierung_id, seat=None),
                    )
                ],
                now=germany_now,
            )

        return FLRegistrierungDeclineResponse(registrierung_id=registrierung_id, vorname=registrierung_raw["vorname"])

    async with transaction_session(db) as session:
        return await session.with_transaction(decline_for_the_team)


# A router of its own, for `app/api/spieler/person_router.py :: spieler_router`'s reason: `router`
# binds the `kontakt` Funktion at router level, and a pending registrant writes as the pupil they
# registered as.
spieler_router = APIRouter(
    prefix=f"/api/v{API_VERSION}/registrierungen/account",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["spieler"])],
)


@spieler_router.patch(
    f"{by_id('registrierung_id')}/einwilligung",
    response_model=FLRegistrierungAccountEinwilligungResponse,
    summary="Withdraw a pupil's own publication and media consent on their pending registration",
)
async def patch_einwilligung(
    registrierung_id: CustomRouteObjectId,
    einwilligung_data: Annotated[FLAccountEinwilligungPayload, Body()],
    identifier: SpielerIdentifier,
    registrierungen_collection: RegistrierungenCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLRegistrierungAccountEinwilligungResponse:
    """Withdraw the publication scope or the media consent the signed-in pupil gave on their own pending registration.

    A grant is refused, and a PATCH moving neither writes nothing. Refuses, writing nothing: `role_not_held`,
    `wording_not_allowed` (the wording or the choices moved since the page was served) and `giving_not_allowed`.
    """

    gewaehlt: dict[FLEinwilligungChoice, object] = {"umfang": einwilligung_data.umfang, "medien": einwilligung_data.medien}
    # For `app/api/spieler/person_router.py :: patch_einwilligung`'s reason: a replay stamps the moment the person pressed.
    am = log_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def write(session: AsyncClientSession) -> FLRegistrierungAccountEinwilligungResponse:
        # By the id alone: the predicate judges the status, the fold, the confirmation and the choices.
        row = await registrierungen_collection.find_one(
            {"_id": registrierung_id}, projection={"status": 1, "email": 1, "einwilligung": 1}, session=session
        )
        # A returning pupil's is the address's own and holds no choice to withdraw, its person's own record holding them.
        refuse(
            find_eigener_eintrag_refusal(
                gehalten=row is not None and ist_eigene_registrierung(row, identifier) and traegt_wahlen(row["einwilligung"])
            )
        )
        assert row is not None
        gespeichert = row["einwilligung"]

        # Withdraw-only: a pending registration grants no panel to answer a grant against.
        await press_widerruf(
            bloecke=[gespeichert],
            gewaehlt=gewaehlt,
            nachweis_stand=einwilligung_data.nachweis_stand.model_dump(),
            text_version=einwilligung_data.text_version,
            seite=KONTO_SEITE_SPIELER,
        )

        update = compose_person_move(gespeichert=gespeichert, gewaehlt=gewaehlt, am=am, text_version=einwilligung_data.text_version)
        updated = (
            None
            if update is None
            else await patch_one_in_db(
                collection=registrierungen_collection,
                db_filter={"_id": row["_id"]},
                update=update,
                session=session,
                return_document=ReturnDocument.AFTER,
            )
        )
        line = widerruf_line(
            person_hash=erasure_journal_hash(identifier, key=config.sperrliste_key),
            collection=Collection.REGISTRIERUNGEN,
            record_id=row["_id"],
            bloecke=[gespeichert],
            gewaehlt=gewaehlt,
            am=am,
            text_version=einwilligung_data.text_version,
        )
        if line is not None:
            journal.note(line)
        # A press moving neither choice is no act, so nothing was written and the record answers as stored.
        einwilligung = gespeichert if updated is None else updated["einwilligung"]

        return FLRegistrierungAccountEinwilligungResponse.model_validate(
            {
                "registrierung_id": row["_id"],
                "einwilligung": einwilligung,
                "nachweis_stand": nachweis_stand_of(bloecke=[einwilligung]),
            }
        )

    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(write)
