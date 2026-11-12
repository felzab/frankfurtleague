from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from bson import ObjectId
from fastapi import APIRouter, Body, Depends, status
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.account.crud import press_withdrawal
from app.api.account.services import compose_person_move, find_own_entry_refusal, withdrawal_line
from app.api.identity.crud import refuse_without_a_seat
from app.api.identity.lookup import RecordCollections, SubjectLookup
from app.api.identity.services import is_own_registrierung
from app.api.outbox.schemas import FLOutboxReference, FLRegistrierungAbsageData
from app.api.outbox.services import OwedMail, enqueue_mails, final_update
from app.api.registrierungen.crud import (
    kader_rows_of,
    nummern_rows,
    persons_at,
    pull_open_registrierungen,
    pull_registrierung,
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
    SUBMITTED,
    admits_a_nominee,
    build_admission_erasure_filter,
    compose_decline_update,
    compose_kader_fields,
    compose_person,
    compose_person_update,
    find_already_in_kader_refusal,
    find_person_refusal,
    find_stufe_refusal,
    find_unconfirmed_refusal,
    nummern_in_kader,
    person_deviates,
    registrierung_is_confirmed,
)
from app.api.spieler.crud import pull_squad_room, refuse_a_full_squad
from app.api.spieler.services import find_full_squad_refusal
from app.core.clock import utc_stamp
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import (
    delete_many_from_db,
    patch_many_in_db,
    patch_one_in_db,
    post_one_to_db,
    pull_one_from_db,
    refuse,
)
from app.core.dependencies import (
    DBClient,
    OutboxCollection,
    RegistrierungenCollection,
    RegistrierungenReadCollection,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonSpielerReadCollection,
    SaisonsReadCollection,
    SaisonTeamsCollection,
    SnapshotSession,
    SpielerCollection,
    SpielerReadCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.journal import Journal
from app.core.recording import ACT_BY_KONTAKT, record_act
from app.core.routing import by_id
from app.core.security import PersonIdentifier, get_person_identifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.einwilligung_evidence import FLEinwilligungChoice
from app.shared.folding import sign_in_identifier
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
    registrierungen_collection: RegistrierungenReadCollection,
    saison_spieler_collection: SaisonSpielerReadCollection,
    saisons_collection: SaisonsReadCollection,
    spieler_collection: SpielerReadCollection,
    records: SubjectLookup,
    session: SnapshotSession,
) -> FLOpenRegistrierungenResponse:
    """Every pending registration of this team's season, newest first, each marked by whether its pupil confirmed it.

    A confirmed row names the stored person its address resolves to, flagged where their name or birthdate differs,
    `kader_full` marks a row whose admission would meet the squad's cap, and no address, telephone number, birthdate or
    consent record is served for anybody.
    """

    # A snapshot rather than a transaction: this writes nothing, and one point in time keeps the
    # seat, the rows and the persons they resolve to from straddling a commit.
    await refuse_without_a_seat(identifier, records, team_id=team_id, saison_id=saison_id, session=session)

    opened = await pull_open_registrierungen(
        registrierungen_collection=registrierungen_collection, saison_id=saison_id, team_id=team_id, session=session
    )
    served = opened.rows
    confirmed = [row for row in served if registrierung_is_confirmed(einwilligung=row.get("einwilligung"))]

    persons = await persons_at(
        spieler_collection=spieler_collection,
        addresses=[sign_in_identifier(str(row["email"])) for row in confirmed],
        session=session,
    )
    by_address = {person["email"]: person for person in persons}

    worn = nummern_in_kader(
        await nummern_rows(saison_spieler_collection=saison_spieler_collection, saison_id=saison_id, team_id=team_id, session=session)
    )

    # What the admission judges the cap by, read as it reads them: the season's rules and window, the squad's count,
    # and each resolved person's row of the season for a stored Nachnominierung mark.
    saison_raw = await pull_one_from_db(
        collection=saisons_collection, db_filter={"_id": saison_id}, projection=["rules", "registrierung"], session=session
    )
    # Nobody excluded: the one a row resolves to has no capped row here, or the admission refuses them as already in
    # a squad before it reaches the cap.
    room = await pull_squad_room(
        saison_spieler_collection=saison_spieler_collection,
        saison_id=saison_id,
        team_id=team_id,
        rules=saison_raw["rules"],
        excluding_spieler_id=None,
        session=session,
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
        admissible = registrierung_is_confirmed(einwilligung=row.get("einwilligung"))
        person = by_address.get(sign_in_identifier(str(row["email"]))) if admissible else None
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
                "admissible": admissible,
                "kader_full": find_full_squad_refusal(room=room, nominee=nominee) is not None,
                "nummer_double": row.get("nummer") in worn,
                "person": None
                if person is None
                else {
                    "spieler_id": person["_id"],
                    "first_name": person["first_name"],
                    "last_name": person.get("last_name"),
                    "deviates_from": person_deviates(registrierung_raw=row, spieler_raw=person),
                },
            }
        )

    return FLOpenRegistrierungenResponse(
        team_id=team_id,
        saison_id=saison_id,
        registrierungen=[as_served(row) for row in served],
        complete=opened.complete,
    )


async def _pull_the_teams_open_row(
    *,
    registrierungen_collection: AsyncCollection,
    registrierung_id: Any,
    identifier: str,
    records: RecordCollections,
    session: AsyncClientSession,
) -> Mapping[str, Any]:
    """The pending registration a team's press names, judged in the press's session: the row, the seat, then its state.

    `role_not_held` alike for an unknown id and another team's row; a 404 only to the row's own team, for a row it has
    declined since.
    """

    registrierung_raw = await pull_registrierung(
        registrierungen_collection=registrierungen_collection, registrierung_id=registrierung_id, session=session
    )
    await refuse_without_a_seat(
        identifier, records, team_id=registrierung_raw["team_id"], saison_id=str(registrierung_raw["saison_id"]), session=session
    )
    # After the seat, so only the row's own team learns that it decided the row.
    if registrierung_raw["status"] != SUBMITTED:
        raise DocumentNotFoundError

    return registrierung_raw


@router.post(
    f"{by_id('registrierung_id')}/admit",
    response_model=FLRegistrierungAdmissionResponse,
    summary="Admit a registration into the team's squad",
)
async def admit(
    registrierung_id: CustomRouteObjectId,
    admit_data: Annotated[FLRegistrierungAdmitPayload, Body()],
    identifier: PersonIdentifier,
    registrierungen_collection: RegistrierungenCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spieler_collection: SpielerCollection,
    records: SubjectLookup,
    db: DBClient,
) -> FLRegistrierungAdmissionResponse:
    """Admit one confirmed registration: the person holding its address, or a new one, joins the team's squad.

    `spieler_id` names that person where their name or birthdate differs and is null where nobody holds the address;
    the registration and every other pending one of its address this season are erased, and nobody is mailed.
    """

    async def admit_the_pupil(session: AsyncClientSession) -> FLRegistrierungAdmissionResponse:
        """Judge, then write the person, the squad row and the erasure. Everything judged is read in-session."""

        registrierung_raw = await _pull_the_teams_open_row(
            registrierungen_collection=registrierungen_collection,
            registrierung_id=registrierung_id,
            identifier=identifier,
            records=records,
            session=session,
        )
        saison_id = str(registrierung_raw["saison_id"])
        team_id = registrierung_raw["team_id"]

        refuse(find_unconfirmed_refusal(einwilligung=registrierung_raw.get("einwilligung")))

        # The one read of the season: its rules for the level and the cap, its window for the Nachnominierung marker.
        saison_raw = await pull_one_from_db(
            collection=saisons_collection, db_filter={"_id": saison_id}, projection=["rules", "registrierung"], session=session
        )
        allowed_stufen = list((saison_raw.get("rules") or {}).get("allowed_stufen") or [])
        refuse(find_stufe_refusal(stufe=registrierung_raw.get("stufe"), allowed_stufen=allowed_stufen))

        address = sign_in_identifier(str(registrierung_raw["email"]))
        resolved = await persons_at(spieler_collection=spieler_collection, addresses=[address], session=session)
        address_raw = resolved[0] if resolved else None
        refuse(find_person_refusal(registrierung_raw=registrierung_raw, address_raw=address_raw, spieler_id=admit_data.spieler_id))
        person_raw = address_raw
        spieler_id = person_raw["_id"] if person_raw is not None else ObjectId()

        kader_raw = (
            await saison_spieler_collection.find_one({"spieler_id": spieler_id, "saison_id": saison_id}, session=session)
            if person_raw is not None
            else None
        )
        refuse(find_already_in_kader_refusal(kader_raw=kader_raw))

        # Judged on the day the registration was submitted, never today's, and never lifted from a retired row.
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
            # Read here, not by the address lookup, which serves no consent record: a choice the person moved after
            # confirming the registration stands. A pending address change of theirs stands too, asked over the address
            # this admission proves again.
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

        # Every other pending row of the address this season goes too, whichever team it was for: each would be refused
        # as already in a squad.
        erased = await delete_many_from_db(
            collection=registrierungen_collection,
            db_filter=build_admission_erasure_filter(registrierung_id=registrierung_id, saison_id=saison_id, address=address),
            session=session,
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
            # The address's other pending rows the admission erased, another team's among them, which leave no act of
            # their own: every row deleted but the admitted one.
            count=erased.deleted_count - 1,
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
    decline_data: Annotated[FLRegistrierungDeclinePayload, Body()],
    identifier: PersonIdentifier,
    registrierungen_collection: RegistrierungenCollection,
    saison_teams_collection: SaisonTeamsCollection,
    outbox_collection: OutboxCollection,
    records: SubjectLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLRegistrierungDeclineResponse:
    """Decline one pending registration, confirmed or not, for a reason from a closed set or none.

    A pupil who confirmed their address is mailed the decision; an unconfirmed address may be a stranger's, and is
    mailed nothing.
    """

    async def decline_for_the_team(session: AsyncClientSession) -> FLRegistrierungDeclineResponse:
        registrierung_raw = await _pull_the_teams_open_row(
            registrierungen_collection=registrierungen_collection,
            registrierung_id=registrierung_id,
            identifier=identifier,
            records=records,
            session=session,
        )
        saison_id = str(registrierung_raw["saison_id"])
        team_id = registrierung_raw["team_id"]

        await patch_one_in_db(
            collection=registrierungen_collection,
            # By `_id` alone: a decision landing after the read conflicts with this write, and the retry's
            # read finds nothing pending, so no status term is reached.
            db_filter={"_id": registrierung_id},
            update=compose_decline_update(reason=decline_data.reason, today=today),
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

        # A confirmation mail still owed is dropped, its link one the confirmation refuses on a declined row. Equality on
        # the three keys of the `outbox_reference` index.
        await patch_many_in_db(
            collection=outbox_collection,
            db_filter={
                "reference.collection": str(Collection.REGISTRIERUNGEN),
                "reference.id": registrierung_id,
                "reference.seat": None,
                "kind": "registrierung_confirmation",
                "state": "open",
            },
            update=final_update("dropped", now=germany_now),
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
                            reason=decline_data.reason,
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

    A grant is refused, and a request moving neither choice writes nothing.
    """

    chosen: dict[FLEinwilligungChoice, object] = {"scope": einwilligung_data.scope, "media": einwilligung_data.media}
    # One instant for every attempt, as the pupil record's own consent press stamps it.
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
