from collections.abc import Mapping, Sequence
from typing import Any

from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.identitaet.lookup import RecordCollections
from app.api.identitaet.schemas import FLAnmeldung, FLSubjekt, FLSubjektSchiedsrichter, FLSubjektSitz, FLSubjektSpieler
from app.api.identitaet.services import (
    EintragArt,
    awaits_confirmation,
    build_bewerbung_pipeline,
    build_pupil_pipeline,
    build_referee_pipeline,
    build_registrierung_pipeline,
    build_seat_pipeline,
    eigene_eintraege,
    eigene_sitze,
    find_funktion_refusal,
    folds_to,
    grants_a_panel,
    ist_eigener_schiedsrichter,
    ist_eigener_spieler,
    lebt,
    nicht_ausgetreten,
    seat_is_confirmed,
    seats_naming,
)
from app.api.saisons.schemas import FLSaisonStatus
from app.core.concurrency import gather_cancelling
from app.core.crud import aggregate_many_from_db, refuse
from app.shared.einwilligung import is_confirmed
from app.shared.folding import sign_in_identifier


async def _statuses_of(
    *, saisons_collection: AsyncCollection, saison_ids: Sequence[str], session: AsyncClientSession | None
) -> Mapping[str, FLSaisonStatus]:
    """One read of `saisons` for every season the seats sit in, the junction row carrying no copy of its season's `status`.

    Made after the fold has judged, so a row the pre-filter alone reached is never read for.
    """

    # No seat, no read: an empty `$in` answers nothing, and it would cost a mailbox holding no seat a
    # second round trip after the gathered reads.
    if not saison_ids:
        return {}

    rows = await aggregate_many_from_db(
        collection=saisons_collection,
        pipeline=[{"$match": {"_id": {"$in": sorted(set(saison_ids))}}}, {"$project": {"status": 1}}],
        session=session,
    )
    statuses = {row["_id"]: row["status"] for row in rows}

    if missing := sorted(set(saison_ids) - statuses.keys()):
        # Raised rather than dropped: a seat whose season has no row is a database this read cannot
        # answer truthfully for, and a silently shorter list is a person shown no panel at all.
        raise RuntimeError(f"saison_teams holds seats in {missing}, which saisons has no row for")

    return statuses


Rows = list[Mapping[str, Any]]


def _reads(identifier: str, records: RecordCollections) -> tuple[tuple[AsyncCollection, Rows], ...]:
    """The three record reads a Funktion stands on, in the order every lookup unpacks them.

    Unbounded, as `app/api/kontakte/admin_router.py`'s are: a capped list reads as a person holding
    fewer records rather than as a truncated answer.
    """

    return (
        (records.saison_teams_collection, build_seat_pipeline(identifier)),
        (records.schiedsrichter_collection, build_referee_pipeline(identifier)),
        (records.spieler_collection, build_pupil_pipeline(identifier)),
    )


async def _judged(
    identifier: str,
    seat_rows: Rows,
    referee_rows: Rows,
    pupil_rows: Rows,
    *,
    saisons_collection: AsyncCollection,
    session: AsyncClientSession | None,
) -> FLSubjekt:
    """The answer every lookup gives from the same three reads: one judgement, so no two can narrow differently.

    Each list is the live part of the address's own records, so the gate never refuses a Funktion
    holder (`docs/backend/spec.md :: I376`).
    """

    # Live rows alone, here and in the flag: a retired person and a withdrawn team grant nothing, and
    # confirming one would open nothing (`docs/backend/spec.md :: I376`).
    lebende_sitzzeilen = [row for row in seat_rows if nicht_ausgetreten(row)]
    lebende_schiedsrichter = [row for row in referee_rows if lebt(row) and folds_to((row.get("kontakt") or {}).get("email"), identifier)]
    lebende_spieler = [row for row in pupil_rows if lebt(row)]

    # Every live seat naming the address and not only its confirmed ones: the flag below reads an
    # unconfirmed seat's season too, so a seat whose season has no row stays loud whichever list counts it.
    statuses = await _statuses_of(
        saisons_collection=saisons_collection,
        saison_ids=[row["saison_id"] for row, _ in seats_naming(lebende_sitzzeilen, identifier)],
        session=session,
    )

    # The confirmation narrows HERE, through the predicates every reader shares, and never at a caller:
    # a caller-side check leaves the sign-in gate mailing, and a panel drawn for, a person nobody confirmed.
    return FLSubjekt(
        sitze=[
            # `model_validate` rather than the constructor: the slot is a plain string here, and the
            # wire's closed set is what refuses one no endpoint publishes.
            FLSubjektSitz.model_validate(
                {
                    "saison_id": row["saison_id"],
                    "team_id": row["team_id"],
                    "rolle": slot,
                    "team_name": row["name"],
                    "saison_status": statuses[row["saison_id"]],
                }
            )
            for row in lebende_sitzzeilen
            for slot in eigene_sitze(row, identifier)
        ],
        spieler=[FLSubjektSpieler(spieler_id=row["_id"]) for row in lebende_spieler if ist_eigener_spieler(row)],
        schiedsrichter=[
            FLSubjektSchiedsrichter(schiedsrichter_id=row["_id"])
            for row in lebende_schiedsrichter
            if ist_eigener_schiedsrichter(row, identifier)
        ],
        # Over the records that could grant a panel alone (`docs/backend/spec.md :: I374`): confirming a
        # seat on a `past` season opens nothing, so it neither raises the flag nor holds it down.
        unbestaetigt=awaits_confirmation(
            [
                seat_is_confirmed(row, slot)
                for row, slot in seats_naming(lebende_sitzzeilen, identifier)
                if grants_a_panel(statuses[row["saison_id"]])
            ]
            + [is_confirmed(row.get("einwilligung")) for row in [*lebende_spieler, *lebende_schiedsrichter]]
        ),
    )


async def find_subjekt(identifier: str, records: RecordCollections) -> FLSubjekt:
    """Every confirmed, live record this folded identifier matches, and whether its granting records are all unconfirmed.

    Its reads gathered and outside any transaction, for `POST /identitaet/subjekt`; a caller inside one
    reads through `find_subjekt_in_session`.
    """

    seat_rows, referee_rows, pupil_rows = await gather_cancelling(
        *(aggregate_many_from_db(collection=collection, pipeline=pipeline) for collection, pipeline in _reads(identifier, records))
    )

    return await _judged(identifier, seat_rows, referee_rows, pupil_rows, saisons_collection=records.saisons_collection, session=None)


async def find_eigene_eintraege(identifier: str, records: RecordCollections) -> tuple[FLSubjekt, frozenset[tuple[EintragArt, Any]]]:
    """The gate's five reads, judged twice: the subject's answer, and every own record of the address.

    The two only the gate pays for, a pending application's and a registration's, grant no panel and
    so are read on no page render.
    """

    seat_rows, referee_rows, pupil_rows, bewerbung_rows, registrierung_rows = await gather_cancelling(
        *(aggregate_many_from_db(collection=collection, pipeline=pipeline) for collection, pipeline in _reads(identifier, records)),
        aggregate_many_from_db(collection=records.bewerbungen_collection, pipeline=build_bewerbung_pipeline(identifier)),
        aggregate_many_from_db(collection=records.registrierungen_collection, pipeline=build_registrierung_pipeline(identifier)),
    )

    subjekt = await _judged(identifier, seat_rows, referee_rows, pupil_rows, saisons_collection=records.saisons_collection, session=None)

    return subjekt, eigene_eintraege(
        identifier,
        seat_rows=seat_rows,
        referee_rows=referee_rows,
        pupil_rows=pupil_rows,
        bewerbung_rows=bewerbung_rows,
        registrierung_rows=registrierung_rows,
    )


async def find_anmeldung(identifier: str, records: RecordCollections) -> FLAnmeldung:
    """What the sign-in gate asks of the records: the subject's flag, and whether the address holds any record of its own."""

    subjekt, eintraege = await find_eigene_eintraege(identifier, records)

    return FLAnmeldung(unbestaetigt=subjekt.unbestaetigt, konto=bool(eintraege))


async def find_subjekt_in_session(
    identifier: str,
    records: RecordCollections,
    *,
    # REQUIRED: this is the lookup a transaction reaches, so no read of it can leave the session.
    session: AsyncClientSession,
) -> FLSubjekt:
    """`find_subjekt`'s answer read inside a caller's session, one read at a time.

    A session runs one operation at a time, which PyMongo's `AsyncClientSession` documents and never
    refuses, so the gathered reads would race unseen here.
    """

    seat_rows, referee_rows, pupil_rows = [
        await aggregate_many_from_db(collection=collection, pipeline=pipeline, session=session)
        for collection, pipeline in _reads(identifier, records)
    ]

    return await _judged(identifier, seat_rows, referee_rows, pupil_rows, saisons_collection=records.saisons_collection, session=session)


async def funktionen_of(
    identifier: str,
    records: RecordCollections,
    *,
    # REQUIRED: a person endpoint judges this inside the session it reads or writes in, so a caller
    # forgetting it is a TypeError rather than a read outside its own write.
    session: AsyncClientSession,
) -> FLSubjekt:
    """What a person endpoint may authorise against: `find_subjekt`'s answer, its seats narrowed to the seasons granting a panel.

    Narrowed here and not in the lookup, each caller narrowing for itself (`docs/backend/spec.md :: I375`).
    """

    # Folded whatever arrived: a header spelled otherwise than the store would otherwise authorise
    # nothing, the fold judging each stored address against this exact spelling.
    folded = sign_in_identifier(identifier)

    # Raised rather than answered: a person's binder refuses a malformed actor before any handler
    # runs, so an empty one here is a caller's bug, and it would match a hand-edited empty stored
    # address (`docs/backend/spec.md :: I388`).
    if folded == "":
        raise ValueError("funktionen_of was asked about an empty identifier")

    return _nur_mit_panel(await find_subjekt_in_session(folded, records, session=session))


def _nur_mit_panel(subjekt: FLSubjekt) -> FLSubjekt:
    return subjekt.model_copy(update={"sitze": [sitz for sitz in subjekt.sitze if grants_a_panel(sitz.saison_status)]})


async def funktionen_aus(
    identifier: str,
    *,
    seat_rows: Rows,
    referee_rows: Rows,
    pupil_rows: Rows,
    saisons_collection: AsyncCollection,
    session: AsyncClientSession,
) -> FLSubjekt:
    """`funktionen_of`'s answer over rows a caller already read through the subject's own selections, so none is read twice.

    The rows must carry what `_judged` reads: each seat row's `austritt`, `name` and seats, and each person's stamp and retirement.
    """

    return _nur_mit_panel(
        await _judged(identifier, seat_rows, referee_rows, pupil_rows, saisons_collection=saisons_collection, session=session)
    )


async def refuse_without_a_seat(
    identifier: str, records: RecordCollections, *, team_id: ObjectId, saison_id: str, session: AsyncClientSession
) -> None:
    """`REQ-FUNKTION-001` unless the person holds a seat on this team in this season, judged in the caller's session.

    In-session because a seat may end between the page's check and this one.
    """

    subjekt = await funktionen_of(identifier, records, session=session)

    refuse(find_funktion_refusal(sitze=subjekt.sitze, team_id=team_id, saison_id=saison_id))
