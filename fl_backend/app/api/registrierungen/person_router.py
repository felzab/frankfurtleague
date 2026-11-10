from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from bson import ObjectId
from fastapi import APIRouter, Body, Depends, status
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.account.crud import press_withdrawal
from app.api.account.services import compose_person_move, find_own_entry_refusal, withdrawal_line
from app.api.identity.crud import refuse_without_a_seat
from app.api.identity.lookup import SubjectLookup
from app.api.identity.services import is_own_registrierung
from app.api.outbox.schemas import FLOutboxReference, FLRegistrierungAbsageData
from app.api.outbox.services import OwedMail, enqueue_mails
from app.api.registrierungen.crud import (
    kader_rows_of,
    nummern_rows,
    persons_at,
    pull_offene_registrierung,
    pull_offene_registrierungen,
)
from app.api.registrierungen.schemas import (
    FLOpenRegistrierung,
    FLOpenRegistrierungenResponse,
    FLRegistrierungAdmissionResponse,
    FLRegistrierungAdmitPayload,
    FLRegistrierungDeclinePayload,
    FLRegistrierungDeclineResponse,
)
from app.api.registrierungen.services import (
    admits_a_nominee,
    compose_ablehnung_update,
    compose_kader_fields,
    compose_person,
    compose_person_update,
    find_person_refusal,
    find_schon_im_kader_refusal,
    find_stufe_refusal,
    find_unbestaetigt_refusal,
    nummern_im_kader,
    person_weicht_ab,
    registrierung_is_confirmed,
)
from app.api.saisons.schemas import FLSaisonRules
from app.api.spieler.crud import find_full_squad_refusal, refuse_a_full_squad
from app.api.spieler.services import build_live_squad_filter
from app.core.clock import utc_stamp
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import (
    delete_many_from_db,
    patch_one_in_db,
    post_one_to_db,
    pull_one_from_db,
    refuse,
)
from app.core.dependencies import (
    DBClient,
    OutboxCollection,
    RegistrierungenCollection,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonsReadCollection,
    SaisonTeamsCollection,
    SpielerCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.journal import Journal
from app.core.recording import ACT_BY_KONTAKT, record_act
from app.core.routing import by_id
from app.core.security import PersonIdentifier, get_person_identifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung_evidence import FLEinwilligungChoice
from app.shared.folding import sign_in_identifier
from app.shared.schemas.bounds import DECLINED_RETENTION_DAYS
from app.shared.schemas.custom import CustomRouteObjectId
from app.shared.schemas.einwilligung import FLAccountEinwilligungPayload, by_choice

# A person's route in place of `bind_actor`: a seat holder signs in by code and holds no grant, so the
# administrator's actor check would refuse every one of them.
router = APIRouter(prefix=f"/api/v{API_VERSION}/registrierungen", dependencies=[Depends(verify_access_admin), Depends(get_person_identifier)])


@router.get(
    "/kader/{team_id:objectid}/{saison_id}",
    response_model=FLOpenRegistrierungenResponse,
    summary="A team's pending registrations for one season",
)
async def get_open_registrierungen(
    team_id: CustomRouteObjectId,
    saison_id: str,
    identifier: PersonIdentifier,
    registrierungen_collection: RegistrierungenCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    saisons_collection: SaisonsReadCollection,
    spieler_collection: SpielerCollection,
    records: SubjectLookup,
    db: DBClient,
) -> FLOpenRegistrierungenResponse:
    """
    Every pending registration for this team's season, each marked admissible or not by whether the pupil has confirmed it.

    Each is marked `kader_full` where admitting it now would meet the squad's cap, by the verdict the admission refuses on.
    A confirmed row names the stored person its address resolves to, flagged where that person's name or birthdate
    differs. An unconfirmed row names nobody: its address is unproven.
    No address, telephone number, birthdate or consent record is served for anybody. Newest first, and no
    more than `app/api/registrierungen/crud.py :: OPEN_REGISTRIERUNGEN_CAP` of them.
    """

    # A snapshot rather than a transaction: this writes nothing, and one point in time keeps the
    # seat, the rows and the persons they resolve to from straddling a commit.
    async with db.start_session(snapshot=True) as session:
        await refuse_without_a_seat(identifier, records, team_id=team_id, saison_id=saison_id, session=session)

        served = await pull_offene_registrierungen(
            registrierungen_collection=registrierungen_collection, saison_id=saison_id, team_id=team_id, session=session
        )
        bestaetigte = [row for row in served if registrierung_is_confirmed(einwilligung=row.get("einwilligung"))]

        persons = await persons_at(
            spieler_collection=spieler_collection,
            addresses=[sign_in_identifier(str(row["email"])) for row in bestaetigte],
            session=session,
        )
        by_address = {person["email"]: person for person in persons}

        worn = nummern_im_kader(
            await nummern_rows(saison_spieler_collection=saison_spieler_collection, saison_id=saison_id, team_id=team_id, session=session)
        )

        # What the admission judges the cap by, read as it reads them: the season's rules and window, the squad's count,
        # and each resolved person's row of the season for a stored Nachnominierung mark.
        saison_raw = await pull_one_from_db(
            collection=saisons_collection, db_filter={"_id": saison_id}, projection=["rules", "registrierung"], session=session
        )
        max_kader_size = FLSaisonRules.model_validate(saison_raw["rules"]).max_kader_size
        # Nobody excluded: the one a row resolves to has no capped row here, or the admission refuses them as already in
        # a squad before it reaches the cap.
        squad_size = await saison_spieler_collection.count_documents(
            build_live_squad_filter(saison_id=saison_id, team_id=team_id, excluding_spieler_id=None), session=session
        )
        kader_by_person = {
            kader["spieler_id"]: kader
            for kader in await kader_rows_of(
                saison_spieler_collection=saison_spieler_collection,
                saison_id=saison_id,
                spieler_ids=[person["_id"] for person in persons],
                session=session,
            )
        }

        def as_served(row: Mapping[str, Any]) -> FLOpenRegistrierung:
            aufnehmbar = registrierung_is_confirmed(einwilligung=row.get("einwilligung"))
            person = by_address.get(sign_in_identifier(str(row["email"]))) if aufnehmbar else None
            nominee = admits_a_nominee(
                kader_raw=None if person is None else kader_by_person.get(person["_id"]),
                registrierung=saison_raw.get("registrierung"),
                submitted_at=row["submitted_at"],
            )

            return FLOpenRegistrierung.model_validate(
                {
                    "registrierung_id": row["_id"],
                    "submitted_at": row["submitted_at"],
                    "first_name": row["first_name"],
                    "last_name": row["last_name"],
                    "nummer": row.get("nummer"),
                    "position": row.get("position"),
                    "stufe": row.get("stufe"),
                    "admissible": aufnehmbar,
                    "kader_full": find_full_squad_refusal(squad_size=squad_size, max_kader_size=max_kader_size, nominee=nominee) is not None,
                    "nummer_double": row.get("nummer") in worn,
                    "person": None
                    if person is None
                    else {
                        "spieler_id": person["_id"],
                        "first_name": person["first_name"],
                        "last_name": person.get("last_name"),
                        "deviates_from": person_weicht_ab(registrierung_raw=row, spieler_raw=person),
                    },
                }
            )

    return FLOpenRegistrierungenResponse(
        team_id=team_id,
        saison_id=saison_id,
        registrierungen=[as_served(row) for row in served],
    )


@router.post(
    f"{by_id('registrierung_id')}/admit",
    response_model=FLRegistrierungAdmissionResponse,
    summary="Admit a registration into the team's squad",
)
async def admit(
    registrierung_id: CustomRouteObjectId,
    aufnahme_data: Annotated[FLRegistrierungAdmitPayload, Body()],
    identifier: PersonIdentifier,
    registrierungen_collection: RegistrierungenCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spieler_collection: SpielerCollection,
    records: SubjectLookup,
    db: DBClient,
) -> FLRegistrierungAdmissionResponse:
    """
    Admit one confirmed registration: the person it resolves to, or a new one, joins the team's squad, and the registration is erased.

    The person survives the season, so the admission first looks for them: the stored person holding the
    registration's address IS that person, and is updated with the registration's name, its birthdate and its freshly
    confirmed consent record. Where that person's
    name or birthdate differs, `spieler_id` must name them (the team said it is the same person). With no such
    person, `spieler_id` is null for a new one. A pending address change of theirs stands, asked over the address
    this admission proves again.

    The squad row takes the registration's number, position and Stufe, no role, and a Nachnominierung marker judged on
    the day the registration was submitted, never today's and never lifted from a retired row; this person's retired
    row of this season is rewritten rather than a second one written, whichever team it was on. The registration is
    deleted in the same transaction, so a second press meets no row.

    Refuses, in this order: no pending registration with this id (404), no seat on its team's season
    (`role_not_held`), a registration the pupil has not confirmed (`registrierung_unconfirmed`), a Stufe the season does not
    offer (`registrierung_stufe_not_allowed`), a
    `spieler_id` that is not the person this registration may be admitted into (`registrierung_person_not_named`), a person
    already playing in a squad this season (`registrierung_already_in_kader`) and a full squad (`kader_full`). Nothing is
    written on any of them.
    """

    async def admit_the_pupil(session: AsyncClientSession) -> FLRegistrierungAdmissionResponse:
        """Judge, then write the person, the squad row and the erasure. Everything judged is read in-session."""

        registrierung_raw = await pull_offene_registrierung(
            registrierungen_collection=registrierungen_collection, registrierung_id=registrierung_id, session=session
        )
        saison_id = str(registrierung_raw["saison_id"])
        team_id = registrierung_raw["team_id"]

        await refuse_without_a_seat(identifier, records, team_id=team_id, saison_id=saison_id, session=session)
        refuse(find_unbestaetigt_refusal(einwilligung=registrierung_raw.get("einwilligung")))

        # The one read of the season: its rules for the level and the cap, its window for the Nachnominierung marker.
        saison_raw = await pull_one_from_db(
            collection=saisons_collection, db_filter={"_id": saison_id}, projection=["rules", "registrierung"], session=session
        )
        erlaubte_stufen = list((saison_raw.get("rules") or {}).get("allowed_stufen") or [])
        refuse(find_stufe_refusal(stufe=registrierung_raw.get("stufe"), allowed_stufen=erlaubte_stufen))

        address = sign_in_identifier(str(registrierung_raw["email"]))
        resolved = await persons_at(spieler_collection=spieler_collection, addresses=[address], session=session)
        address_raw = resolved[0] if resolved else None
        refuse(find_person_refusal(registrierung_raw=registrierung_raw, address_raw=address_raw, spieler_id=aufnahme_data.spieler_id))
        person_raw = address_raw
        spieler_id = person_raw["_id"] if person_raw is not None else ObjectId()

        kader_raw = (
            await saison_spieler_collection.find_one({"spieler_id": spieler_id, "saison_id": saison_id}, session=session)
            if person_raw is not None
            else None
        )
        refuse(find_schon_im_kader_refusal(kader_raw=kader_raw))

        nominee = admits_a_nominee(
            kader_raw=kader_raw, registrierung=saison_raw.get("registrierung"), submitted_at=registrierung_raw["submitted_at"]
        )

        await refuse_a_full_squad(
            saison_spieler_collection=saison_spieler_collection,
            saisons_collection=saisons_collection,
            saison_id=saison_id,
            rules=saison_raw["rules"],
            team_id=team_id,
            spieler_id=spieler_id,
            nominee=nominee,
            session=session,
        )

        if person_raw is None:
            await post_one_to_db(
                collection=spieler_collection,
                document=compose_person(spieler_id=spieler_id, registrierung_raw=registrierung_raw, address=address),
                session=session,
            )
        else:
            # Read here, not by the address lookup, which serves no consent record:
            # a choice the person moved after confirming the
            # registration stands.
            saved = await spieler_collection.find_one({"_id": spieler_id}, projection={"einwilligung": 1}, session=session)
            await patch_one_in_db(
                collection=spieler_collection,
                db_filter={"_id": spieler_id},
                update=compose_person_update(registrierung_raw=registrierung_raw, saved=(saved or {}).get("einwilligung"), address=address),
                session=session,
                expected_version=None,
                return_document=ReturnDocument.BEFORE,
            )

        kader_fields = compose_kader_fields(
            registrierung_raw=registrierung_raw,
            team_id=team_id,
            is_nachnominiert=nominee,
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
                expected_version=None,
                return_document=ReturnDocument.BEFORE,
            )

        await delete_many_from_db(
            collection=registrierungen_collection, db_filter={"_id": registrierung_id, "saison_id": saison_id}, session=session
        )
        # The seat check just found this junction row, so it stands.
        junction_raw = await pull_one_from_db(
            collection=saison_teams_collection, db_filter={"saison_id": saison_id, "team_id": team_id}, projection=["name"], session=session
        )
        await record_act(
            collection=registrierungen_collection,
            action="registrierung.admitted",
            by=ACT_BY_KONTAKT,
            team=str(junction_raw["name"]),
            record_id=registrierung_id,
            session=session,
        )

        return FLRegistrierungAdmissionResponse(
            registrierung_id=registrierung_id,
            spieler_id=spieler_id,
            team_id=team_id,
            saison_id=saison_id,
            first_name=registrierung_raw["first_name"],
            last_name=registrierung_raw["last_name"],
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
    identifier: PersonIdentifier,
    registrierungen_collection: RegistrierungenCollection,
    saison_teams_collection: SaisonTeamsCollection,
    outbox_collection: OutboxCollection,
    records: SubjectLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLRegistrierungDeclineResponse:
    """
    Decline one pending registration, confirmed or not: its state and the decision are written, and the pupil's note owed.

    The decision records a reason from a closed set, never free text:
    `other_person` where the team answered that the registration is not the person its address belongs to. The
    row stays until the retention sweep erases it 14 days later. The note is owed in the same transaction, and only
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
            update=compose_ablehnung_update(reason=ablehnung_data.reason, today=today),
            session=session,
            expected_version=None,
            return_document=ReturnDocument.BEFORE,
        )

        # The seat check just found this junction row, so it stands.
        junction_raw = await pull_one_from_db(
            collection=saison_teams_collection, db_filter={"saison_id": saison_id, "team_id": team_id}, projection=["name"], session=session
        )
        await record_act(
            collection=registrierungen_collection,
            action="registrierung.declined",
            by=ACT_BY_KONTAKT,
            team=str(junction_raw["name"]),
            record_id=registrierung_id,
            session=session,
        )

        if registrierung_is_confirmed(einwilligung=registrierung_raw.get("einwilligung")):
            await enqueue_mails(
                outbox_collection=outbox_collection,
                session=session,
                mails=[
                    OwedMail(
                        # A decline is taken once: a pending row is what this transaction reads, and it leaves that state.
                        key=f"{Collection.REGISTRIERUNGEN}/{registrierung_id}/absage",
                        to=str(registrierung_raw["email"]),
                        data=FLRegistrierungAbsageData(
                            kind="registrierung_absage",
                            team=str(junction_raw["name"]),
                            saison_id=saison_id,
                            reason=ablehnung_data.reason,
                            # The bound the sweep erases a declined row by (`services.py :: decline_loeschung_is_due`).
                            deletion_days=DECLINED_RETENTION_DAYS,
                        ),
                        reference=FLOutboxReference(collection=Collection.REGISTRIERUNGEN, id=registrierung_id, seat=None),
                    )
                ],
                now=germany_now,
            )

        return FLRegistrierungDeclineResponse(registrierung_id=registrierung_id, first_name=registrierung_raw["first_name"])

    async with transaction_session(db) as session:
        return await session.with_transaction(decline_for_the_team)


# A prefix of its own: a pending registrant reaches their own row, and no team's.
spieler_router = APIRouter(
    prefix=f"/api/v{API_VERSION}/registrierungen/account", dependencies=[Depends(verify_access_admin), Depends(get_person_identifier)]
)


@spieler_router.patch(
    f"{by_id('registrierung_id')}/einwilligung",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Withdraw a pupil's own publication and media consent on their pending registration",
)
async def patch_einwilligung(
    registrierung_id: CustomRouteObjectId,
    einwilligung_data: Annotated[FLAccountEinwilligungPayload, Body()],
    identifier: PersonIdentifier,
    registrierungen_collection: RegistrierungenCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> None:
    """Withdraw the publication scope or the media consent the signed-in pupil gave on their own pending registration.

    A grant is refused, and a PATCH moving neither writes nothing. Refuses, writing nothing: `role_not_held`,
    `choices_stale` and `giving_not_allowed`.
    """

    chosen: dict[FLEinwilligungChoice, object] = {"scope": einwilligung_data.scope, "media": einwilligung_data.media}
    # One instant for every attempt, as `app/api/spieler/person_router.py :: patch_einwilligung` stamps its own.
    at = utc_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def write(session: AsyncClientSession) -> None:
        # By the id alone: the predicate judges the status, the fold, the confirmation and the choices.
        row = await registrierungen_collection.find_one(
            {"_id": registrierung_id}, projection={"status": 1, "email": 1, "einwilligung": 1}, session=session
        )
        refuse(find_own_entry_refusal(held=row is not None and is_own_registrierung(row, identifier)))
        assert row is not None
        saved = row["einwilligung"]

        # Withdraw-only: a pending registration grants no panel to answer a grant against.
        await press_withdrawal(
            blocks=[saved],
            chosen=chosen,
            evidence_state=einwilligung_data.evidence_state.model_dump(),
        )

        update = compose_person_move(saved=saved, chosen=chosen, at=at, text_versions=by_choice(einwilligung_data.text_versions))
        if update is not None:
            await patch_one_in_db(
                collection=registrierungen_collection,
                db_filter={"_id": row["_id"]},
                update=update,
                session=session,
                expected_version=None,
                return_document=ReturnDocument.BEFORE,
            )
        if moved := withdrawal_line(blocks=[saved], chosen=chosen):
            journal.note("withdrawal", [f"{Collection.REGISTRIERUNGEN}/{row['_id']}"], choices=list(moved))

    async with journal:
        async with transaction_session(db) as session:
            await session.with_transaction(write)
