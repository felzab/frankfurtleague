from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from bson import ObjectId
from fastapi import APIRouter, Body, Depends, Query
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.identitaet.crud import refuse_without_a_seat
from app.api.identitaet.lookup import SubjektLookup
from app.api.registrierungen.crud import (
    nummern_rows,
    persons_at,
    persons_without_an_address,
    pull_offene_registrierung,
    pull_offene_registrierungen,
)
from app.api.registrierungen.schemas import (
    FLOffeneRegistrierung,
    FLOffeneRegistrierungenParams,
    FLOffeneRegistrierungenResponse,
    FLRegistrierungAblehnenPayload,
    FLRegistrierungAblehnungResponse,
    FLRegistrierungAufnahmeResponse,
    FLRegistrierungAufnehmenPayload,
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
    sole_vorschlag,
)
from app.api.saisons.cache import dropping_the_saison_cache
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, sperrliste_saison
from app.api.spieler.crud import refuse_a_full_squad
from app.api.spieltage.crud import nachnominierung_laeuft_in
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import erase_many_from_db, patch_many_in_db, patch_one_in_db, post_one_to_db, pull_one_from_db, refuse
from app.core.dependencies import (
    AktionenCollection,
    DBClient,
    RegistrierungenCollection,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonTeamsCollection,
    SpielerCollection,
    SpieltageCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.drosselung import gedrosselt
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, DUPLICATE_KEY_RESPONSE
from app.core.recording import build_redaction_filter, build_redaction_update, log_stamp
from app.core.routing import by_id
from app.core.security import PERSON_ACTOR_BINDERS, KontaktIdentifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import CustomRouteObjectId

# The person lane's binder in place of `bind_actor`: a seat holder signs in by code and holds no
# grant, so the administrator's actor check would refuse every one of them.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/registrierungen",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["kontakt"])],
)


@router.get(
    "/kader/{team_id:objectid}/{saison_id}",
    response_model=FLOffeneRegistrierungenResponse,
    summary="A team's pending registrations for one season",
)
async def get_offene_registrierungen(
    team_id: CustomRouteObjectId,
    saison_id: str,
    params: Annotated[FLOffeneRegistrierungenParams, Query()],
    identifier: KontaktIdentifier,
    registrierungen_collection: RegistrierungenCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    spieler_collection: SpielerCollection,
    records: SubjektLookup,
    db: DBClient,
) -> FLOffeneRegistrierungenResponse:
    """
    Every pending registration for this team's season, each marked admissible or not by whether the pupil has confirmed it.

    A confirmed row names the stored person its address resolves to, flagged where that person's name or birthdate
    differs, or else the one stored person holding no address whose name is the registration's. A typed name is a
    weaker key than a shorthand, so a name only ever proposes. An unconfirmed row names neither: its address is unproven.
    No address, telephone number, birthdate or consent record is served for anybody.
    `vollstaendig` is false where more pending rows exist than `limit` serves.
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
        # Read only where some confirmed row resolves to nobody: the one read that scans `spieler`.
        unresolved = [row for row in bestaetigte if sign_in_identifier(str(row["email"])) not in by_address]
        ohne_adresse = await persons_without_an_address(spieler_collection=spieler_collection, session=session) if unresolved else []

        worn = nummern_im_kader(
            await nummern_rows(saison_spieler_collection=saison_spieler_collection, saison_id=saison_id, team_id=team_id, session=session)
        )

        def as_served(row: Mapping[str, Any]) -> FLOffeneRegistrierung:
            aufnehmbar = registrierung_ist_bestaetigt(einwilligung=row.get("einwilligung"))
            person = by_address.get(sign_in_identifier(str(row["email"]))) if aufnehmbar else None
            vorschlag = sole_vorschlag(registrierung_raw=row, ohne_adresse=ohne_adresse) if aufnehmbar and person is None else None

            return FLOffeneRegistrierung.model_validate(
                {
                    "registrierung_id": row["_id"],
                    "eingereicht_am": row["eingereicht_am"],
                    "vorname": row["vorname"],
                    "nachname": row["nachname"],
                    "nummer": row.get("nummer"),
                    "position": row.get("position"),
                    "stufe": row.get("stufe"),
                    "aufnehmbar": aufnehmbar,
                    "nummer_doppelt": row.get("nummer") in worn,
                    "person": None
                    if person is None
                    else {
                        "spieler_id": person["_id"],
                        "vorname": person["vorname"],
                        "nachname": person.get("nachname"),
                        "weicht_ab": person_weicht_ab(registrierung_raw=row, spieler_raw=person),
                    },
                    "vorschlag": None
                    if vorschlag is None
                    else {"spieler_id": vorschlag["_id"], "vorname": vorschlag["vorname"], "nachname": vorschlag.get("nachname")},
                }
            )

    return FLOffeneRegistrierungenResponse(
        team_id=team_id,
        saison_id=saison_id,
        registrierungen=[as_served(row) for row in served],
        vollstaendig=len(read) <= params.limit,
    )


@router.post(
    f"{by_id('registrierung_id')}/aufnehmen",
    response_model=FLRegistrierungAufnahmeResponse,
    summary="Admit a registration into the team's squad",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
    dependencies=[Depends(gedrosselt)],
)
async def aufnehmen(
    registrierung_id: CustomRouteObjectId,
    aufnahme_data: Annotated[FLRegistrierungAufnehmenPayload, Body()],
    identifier: KontaktIdentifier,
    registrierungen_collection: RegistrierungenCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    saisons_collection: SaisonsCollection,
    spieler_collection: SpielerCollection,
    records: SubjektLookup,
    spieltage_collection: SpieltageCollection,
    aktionen_collection: AktionenCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLRegistrierungAufnahmeResponse:
    """
    Admit one confirmed registration: the person it resolves to, or a new one, joins the team's squad, and the registration is erased.

    The person survives the season, so the admission first looks for them: the stored person holding the
    registration's address IS that person, and is updated with the registration's name, its confirmed birthdate and
    its freshly confirmed consent record. Where that person's name or birthdate differs, `spieler_id` must name them
    (the team said it is the same person). With no such person, `spieler_id` is null for a new one, or names the
    addressless namesake the read proposed, who then takes the registration's address. A retired person comes back.

    The squad row takes the registration's number, position and Stufe, no role, and a Nachnominierung marker derived
    today; this person's retired row of this season is rewritten rather than a second one written, whichever team
    it was on. The registration is deleted and its values redacted from the log in the same transaction, so a second
    press meets no row. Its submission key moves onto the squad row, so the submission replayed later stores nothing.

    Refuses, in this order: no pending registration with this id (404), no seat on its team's season
    (`REQ-FUNKTION-001`), a registration the pupil has not confirmed (`REQ-REGISTRIERUNG-013`), an address the ban
    list holds (`REQ-REGISTRIERUNG-009`, worded to the team as neutrally as to the pupil), a Stufe the season no
    longer offers (`REQ-REGISTRIERUNG-003`), a registration confirmed on the returning pupil's page whose address holds
    no stored person (`REQ-REGISTRIERUNG-018`: it carries no choice, so it admits nobody, a namesake the body names
    included, and the pupil registers again), a `spieler_id` that is not the person this registration may be admitted
    into (`REQ-REGISTRIERUNG-014`), a person already playing in a squad this season (`REQ-REGISTRIERUNG-015`) and a
    full squad (`REQ-SQUAD-003`). Nothing is written on any of them.
    """

    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await sperrliste_saison(sperrliste)

    async def admit_the_pupil(session: AsyncClientSession) -> FLRegistrierungAufnahmeResponse:
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
        refuse(find_gesperrt_refusal(gesperrt=bool(gesperrt)))

        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["rules"], session=session)
        erlaubte_stufen = list((saison_raw.get("rules") or {}).get("erlaubte_stufen") or [])
        refuse(find_stufe_refusal(stufe=registrierung_raw.get("stufe"), erlaubte_stufen=erlaubte_stufen))

        adresse = sign_in_identifier(str(registrierung_raw["email"]))
        resolved = await persons_at(spieler_collection=spieler_collection, adressen=[adresse], session=session)
        adresse_raw = resolved[0] if resolved else None
        # Before a namesake is read: the team's answer cannot stand in for the person the pupil confirmed as.
        refuse(find_person_fehlt_refusal(registrierung_raw=registrierung_raw, adresse_raw=adresse_raw))
        benannt_raw = (
            await spieler_collection.find_one({"_id": aufnahme_data.spieler_id}, session=session)
            if adresse_raw is None and aufnahme_data.spieler_id is not None
            else None
        )
        refuse(
            find_person_refusal(
                registrierung_raw=registrierung_raw, adresse_raw=adresse_raw, benannt_raw=benannt_raw, spieler_id=aufnahme_data.spieler_id
            )
        )
        person_raw = adresse_raw or benannt_raw
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
            # Read here, not by the address lookup, which serves no consent record
            # (`docs/backend/spec.md :: I584`): a choice the person moved after confirming the
            # registration stands (`:: I611`).
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
            ist_nachnominiert=await nachnominierung_laeuft_in(
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
            # player per season, a retired one included (`docs/backend/spec.md :: I583`).
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
        await patch_many_in_db(
            collection=aktionen_collection,
            db_filter=build_redaction_filter([(Collection.REGISTRIERUNGEN, [registrierung_id])]),
            update=build_redaction_update(at=log_stamp(germany_now)),
            session=session,
        )

        return FLRegistrierungAufnahmeResponse(
            registrierung_id=registrierung_id,
            spieler_id=spieler_id,
            team_id=team_id,
            saison_id=saison_id,
            vorname=registrierung_raw["vorname"],
            nachname=registrierung_raw["nachname"],
            nummer=kader_fields["nummer"],
            position=kader_fields["position"],
            stufe=kader_fields["stufe"],
            ist_nachnominiert=kader_fields["ist_nachnominiert"],
        )

    # The squad cap's own write moved the season (`docs/backend/spec.md :: I131`).
    with dropping_the_saison_cache():
        async with transaction_session(db) as session:
            return await session.with_transaction(admit_the_pupil)


@router.post(
    f"{by_id('registrierung_id')}/ablehnen",
    response_model=FLRegistrierungAblehnungResponse,
    summary="Decline a registration",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
    dependencies=[Depends(gedrosselt)],
)
async def ablehnen(
    registrierung_id: CustomRouteObjectId,
    ablehnung_data: Annotated[FLRegistrierungAblehnenPayload, Body()],
    identifier: KontaktIdentifier,
    registrierungen_collection: RegistrierungenCollection,
    saison_teams_collection: SaisonTeamsCollection,
    records: SubjektLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLRegistrierungAblehnungResponse:
    """
    Decline one pending registration, confirmed or not: its state and the decision are written, and nothing else.

    The decision records the declining seat holder's address and a reason from a closed set, never free text:
    `andere_person` where the team answered that the registration is not the person its address belongs to. The
    row stays until the retention sweep erases it a month later. The answer carries the address the pupil's link
    went to, for the decline mail and nothing else, and whether that address was ever confirmed.

    Refuses no pending registration with this id (404) and no seat on its team's season (`REQ-FUNKTION-001`).
    """

    async def decline_for_the_team(session: AsyncClientSession) -> FLRegistrierungAblehnungResponse:
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

        return FLRegistrierungAblehnungResponse(
            registrierung_id=registrierung_id,
            team_id=team_id,
            saison_id=saison_id,
            team=str(junction_raw["name"]),
            vorname=registrierung_raw["vorname"],
            email=str(registrierung_raw["email"]),
            bestaetigt=registrierung_ist_bestaetigt(einwilligung=registrierung_raw.get("einwilligung")),
            grund=ablehnung_data.grund,
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(decline_for_the_team)
