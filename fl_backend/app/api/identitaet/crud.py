from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from types import TracebackType
from typing import Any, Final, Literal, get_args

from bson import ObjectId
from pydantic import SecretStr
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.api.aktionen.crud import redact_address_in_images
from app.api.berechtigungen.crud import read_berechtigungen
from app.api.berechtigungen.erasure import erase_grants_and_authorship_in_session
from app.api.identitaet.lookup import RecordCollections
from app.api.identitaet.schemas import FLAnmeldung, FLErasure, FLSubjekt, FLSubjektSchiedsrichter, FLSubjektSitz, FLSubjektSpieler
from app.api.identitaet.services import (
    EintragArt,
    awaits_confirmation,
    build_bewerbung_pipeline,
    build_bewerbung_references_pipeline,
    build_erasure_pupil_pipeline,
    build_erasure_referee_pipeline,
    build_erasure_registrierung_pipeline,
    build_erasure_seat_pipeline,
    build_pending_address_pipeline,
    build_pending_pupil_address_pipeline,
    build_pupil_pipeline,
    build_pupil_references_pipeline,
    build_referee_pipeline,
    build_referee_references_pipeline,
    build_registrierung_pipeline,
    build_registrierung_references_pipeline,
    build_seat_pipeline,
    build_seat_references_pipeline,
    can_judge,
    eigene_eintraege,
    eigene_sitze,
    find_funktion_refusal,
    find_kein_inhaber_refusal,
    folds_to,
    grants_a_panel,
    ist_eigener_schiedsrichter,
    ist_eigener_spieler,
    lebt,
    nicht_ausgetreten,
    pending_addresses_of,
    pupil_address,
    referee_address,
    referenced_addresses,
    seat_is_confirmed,
    seats_naming,
    unreferenced,
)
from app.api.kontakte.crud import erase_kontaktperson_in_session
from app.api.kontakte.services import rows_naming, same_address
from app.api.registrierungen.crud import erase_registrierungen_in_session
from app.api.saisons.schemas import FLSaisonStatus
from app.api.schiedsrichter.crud import ensure_ghost_schiedsrichter, erase_referee_in_session, remove_pending_addresses_in_session
from app.api.sperrliste.lookup import BanList, adressen_gesperrt
from app.api.spieler.crud import ensure_ghost_spieler, erase_person_in_session, remove_pending_pupil_addresses_in_session
from app.core.collections import Collection
from app.core.concurrency import gather_cancelling
from app.core.crud import aggregate_many_from_db, patch_many_in_db, refuse
from app.core.db import warn_about_the_grants
from app.core.drosselung import erase_counts_in_session
from app.core.logging import journal_logger
from app.core.recording import ERASED_ACTOR_MARKER
from app.core.security import akteur_pseudonym, loeschung_journal_hash
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

    Unbounded, as `resolve_subject`'s are: a capped list reads as a person holding fewer records
    rather than as a truncated answer.
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


# --- The ERASURE: one registry of every step that reaches a person's data, run in one transaction.

# The kinds of person a step's records belong to, „Personengruppe“ in the published notice: never a
# `rolle` or a `Funktion`, each of which names something else here (`docs/glossary.md :: Funktion`).
Personengruppe = Literal["kontakt", "spieler", "schiedsrichter"]

# The scope of a person's own request and an administrator's: everything the address holds.
JEDE_PERSONENGRUPPE: Final[frozenset[Personengruppe]] = frozenset(get_args(Personengruppe))


@dataclass(frozen=True, kw_only=True)
class Subject:
    """Every record one folded address holds, read in the erasure's own session before its first step writes.

    Each step takes its rows from here: one reading after another step wrote would miss what that step removed and answer zero.
    """

    identifier: str
    # The log's and the write counts' key for this person (`app/core/security.py :: akteur_pseudonym`).
    pseudonym: str
    saison_teams: Rows
    bewerbungen: Rows
    schiedsrichter: Rows
    spieler: Rows
    registrierungen: Rows
    # Another address's referee rows and pupil rows whose pending change names this one.
    adresswechsel: Rows
    spieler_adresswechsel: Rows


async def resolve_subject(
    identifier: str,
    *,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    spieler_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    schluessel: SecretStr,
    # REQUIRED: the erasure reads it inside its transaction, so a retry re-reads it, and the preview in
    # a snapshot, so it names the records of one moment.
    session: AsyncClientSession,
) -> Subject:
    """What `identifier` holds, through the unnarrowed selections: an unconfirmed seat, a retired row and a declined registration included.

    One read at a time: a session runs one operation at a time, and gathered reads would race unseen.
    """

    saison_teams = rows_naming(
        await aggregate_many_from_db(collection=saison_teams_collection, pipeline=build_erasure_seat_pipeline(identifier), session=session),
        identifier,
    )
    bewerbungen = rows_naming(
        await aggregate_many_from_db(collection=bewerbungen_collection, pipeline=build_erasure_seat_pipeline(identifier), session=session),
        identifier,
    )
    schiedsrichter = [
        row
        for row in await aggregate_many_from_db(
            collection=schiedsrichter_collection, pipeline=build_erasure_referee_pipeline(identifier), session=session
        )
        if folds_to((row.get("kontakt") or {}).get("email"), identifier)
    ]
    spieler = await aggregate_many_from_db(collection=spieler_collection, pipeline=build_erasure_pupil_pipeline(identifier), session=session)
    registrierungen = [
        row
        for row in await aggregate_many_from_db(
            collection=registrierungen_collection, pipeline=build_erasure_registrierung_pipeline(identifier), session=session
        )
        if folds_to(row.get("email"), identifier)
    ]
    adresswechsel = pending_addresses_of(
        await aggregate_many_from_db(
            collection=schiedsrichter_collection, pipeline=build_pending_address_pipeline(identifier), session=session
        ),
        identifier,
        stored=referee_address,
    )
    spieler_adresswechsel = pending_addresses_of(
        await aggregate_many_from_db(collection=spieler_collection, pipeline=build_pending_pupil_address_pipeline(identifier), session=session),
        identifier,
        stored=pupil_address,
    )

    return Subject(
        identifier=identifier,
        pseudonym=akteur_pseudonym(identifier, schluessel=schluessel),
        saison_teams=saison_teams,
        bewerbungen=bewerbungen,
        schiedsrichter=schiedsrichter,
        spieler=spieler,
        registrierungen=registrierungen,
        adresswechsel=adresswechsel,
        spieler_adresswechsel=spieler_adresswechsel,
    )


async def unattribute_in_session(
    *,
    aktionen_collection: AsyncCollection,
    identifier: str,
    pseudonym: str,
    # REQUIRED: it reaches the rows this transaction's own steps filed under the person, a
    # self-erasure being recorded under the person it erases.
    session: AsyncClientSession,
) -> int:
    """Put the marker where the person stood as author of every log row they wrote, as a person or an administrator.

    The row keeps its kind, route, instant and image, saying an action happened and not by whom.
    """

    as_person = await patch_many_in_db(
        collection=aktionen_collection,
        db_filter={"actor.pseudonym": pseudonym},
        update={"$set": {"actor.pseudonym": ERASED_ACTOR_MARKER}},
        session=session,
    )

    # Read then judged on the fold, as every stored address is: the pre-filter's `i` ignores case beyond ASCII.
    candidates = await aggregate_many_from_db(
        collection=aktionen_collection,
        pipeline=[{"$match": {"actor.email": same_address(identifier)}}, {"$project": {"actor.email": 1}}],
        session=session,
    )
    as_administrator = await patch_many_in_db(
        collection=aktionen_collection,
        db_filter={"_id": {"$in": [row["_id"] for row in candidates if folds_to(row["actor"].get("email"), identifier)]}},
        update={"$set": {"actor.email": ERASED_ACTOR_MARKER}},
        session=session,
    )

    return as_person.modified_count + as_administrator.modified_count


@dataclass(frozen=True)
class ErasureStep:
    """One member of the erasure: the collections it writes, whose records they are, and the function `erase_everything` calls by name."""

    reaches: frozenset[Collection]
    # `None` for a step serving no one kind of person: the full scope alone runs it. Every step leaving
    # the address in another record's images is one, so no scope runs it without the address pass.
    personengruppe: Personengruppe | None
    run: Callable[..., Awaitable[Any]]


# In the order `erase_everything` runs them: every step reaching a person's references before the
# step removing the person, the log's actor after every write the steps filed under them, and the
# address pass after every image they filed.
ERASURE_STEPS: Final[tuple[ErasureStep, ...]] = (
    ErasureStep(
        reaches=frozenset({Collection.SAISON_TEAMS, Collection.BEWERBUNGEN, Collection.AKTIONEN}),
        personengruppe="kontakt",
        run=erase_kontaktperson_in_session,
    ),
    # No kind's alone, either of them: the row each waits on is another address's.
    ErasureStep(reaches=frozenset({Collection.SCHIEDSRICHTER}), personengruppe=None, run=remove_pending_addresses_in_session),
    ErasureStep(reaches=frozenset({Collection.SPIELER}), personengruppe=None, run=remove_pending_pupil_addresses_in_session),
    ErasureStep(
        reaches=frozenset({Collection.SCHIEDSRICHTER, Collection.SPIELE, Collection.AKTIONEN}),
        personengruppe="schiedsrichter",
        run=erase_referee_in_session,
    ),
    ErasureStep(
        reaches=frozenset({Collection.REGISTRIERUNGEN, Collection.AKTIONEN}), personengruppe="spieler", run=erase_registrierungen_in_session
    ),
    ErasureStep(
        reaches=frozenset({Collection.SPIELER, Collection.SAISON_SPIELER, Collection.AKTIONEN}),
        personengruppe="spieler",
        run=erase_person_in_session,
    ),
    # No kind's alone: it changes records the person made as an administrator and as a seat holder, so
    # the pupil scope must never run it.
    ErasureStep(
        reaches=frozenset(
            {
                Collection.BERECHTIGUNGEN,
                Collection.BERECHTIGUNGEN_ANGEKUENDIGT,
                Collection.BERECHTIGUNGEN_POSTAUSGANG,
                Collection.BEWERBUNGEN,
                Collection.REGISTRIERUNGEN,
                Collection.SPERRLISTE,
                Collection.EINLADUNGEN,
            }
        ),
        personengruppe=None,
        run=erase_grants_and_authorship_in_session,
    ),
    ErasureStep(reaches=frozenset({Collection.DROSSELUNG}), personengruppe=None, run=erase_counts_in_session),
    ErasureStep(reaches=frozenset({Collection.AKTIONEN}), personengruppe=None, run=unattribute_in_session),
    # LAST: images filed before the erasure hold the address, and the seat clearing files more. No kind's
    # alone: in the pupil scope it would take a standing referee's or administrator's address out of their own images.
    ErasureStep(reaches=frozenset({Collection.AKTIONEN}), personengruppe=None, run=redact_address_in_images),
)


def _runs(run: Callable[..., Awaitable[Any]], scope: frozenset[Personengruppe]) -> bool:
    """Whether the step running `run` belongs to this scope, read off its one declaration in `ERASURE_STEPS`."""

    (step,) = [step for step in ERASURE_STEPS if step.run is run]

    return scope == JEDE_PERSONENGRUPPE if step.personengruppe is None else step.personengruppe in scope


async def erase_everything(
    identifier: str,
    *,
    scope: frozenset[Personengruppe],
    # Each by its own name, as every route hands a collection on: the static traces resolve a
    # collection by its parameter's spelling, never through an attribute of a bundle.
    spieler_collection: AsyncCollection,
    saison_spieler_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    spiele_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    drosselung_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    berechtigungen_collection: AsyncCollection,
    berechtigungen_angekuendigt_collection: AsyncCollection,
    berechtigungen_postausgang_collection: AsyncCollection,
    einladungen_collection: AsyncCollection,
    sperrliste_collection: AsyncCollection,
    sperrliste: BanList,
    # Whom the grant notice names as ending the person's grant: the person on their own request, the
    # administrator on theirs.
    geaendert_von: str,
    schluessel: SecretStr,
    # The caller's, so every redaction of one erasure carries one instant.
    stamp: str,
    now: datetime,
    # REQUIRED: the caller's transaction, every step committing together or none (`docs/backend/spec.md :: I52`).
    session: AsyncClientSession,
) -> FLErasure:
    """Erase every record of this folded address the scope reaches, in the caller's transaction.

    The subject is read HERE, so a retry after a conflict re-reads it. The caller runs its transaction inside an
    `ErasureJournal`, which journals once it commits.
    """

    subject = await resolve_subject(
        identifier,
        saison_teams_collection=saison_teams_collection,
        bewerbungen_collection=bewerbungen_collection,
        schiedsrichter_collection=schiedsrichter_collection,
        spieler_collection=spieler_collection,
        registrierungen_collection=registrierungen_collection,
        schluessel=schluessel,
        session=session,
    )

    # Each sentinel once, ahead of the first step that may repoint a reference at it, and only where one will.
    if subject.schiedsrichter and _runs(erase_referee_in_session, scope):
        await ensure_ghost_schiedsrichter(schiedsrichter_collection=schiedsrichter_collection, session=session)
    if subject.spieler and _runs(erase_person_in_session, scope):
        await ensure_ghost_spieler(spieler_collection=spieler_collection, session=session)

    kontakt_sitze = 0
    if _runs(erase_kontaktperson_in_session, scope):
        kontakt_sitze = (
            await erase_kontaktperson_in_session(
                saison_teams_collection=saison_teams_collection,
                bewerbungen_collection=bewerbungen_collection,
                aktionen_collection=aktionen_collection,
                identifier=identifier,
                saison_team_rows=subject.saison_teams,
                bewerbung_rows=subject.bewerbungen,
                stamp=stamp,
                session=session,
            )
        ).kontakt_slots

    adresswechsel = 0
    if _runs(remove_pending_addresses_in_session, scope):
        adresswechsel = await remove_pending_addresses_in_session(
            schiedsrichter_collection=schiedsrichter_collection,
            schiedsrichter_ids=[row["_id"] for row in subject.adresswechsel],
            session=session,
        )
    if _runs(remove_pending_pupil_addresses_in_session, scope):
        adresswechsel += await remove_pending_pupil_addresses_in_session(
            spieler_collection=spieler_collection, spieler_ids=[row["_id"] for row in subject.spieler_adresswechsel], session=session
        )

    spiele = 0
    if _runs(erase_referee_in_session, scope):
        for row in subject.schiedsrichter:
            spiele += await erase_referee_in_session(
                schiedsrichter_collection=schiedsrichter_collection,
                spiele_collection=spiele_collection,
                aktionen_collection=aktionen_collection,
                schiedsrichter_id=row["_id"],
                stamp=stamp,
                session=session,
            )

    registrierungen = 0
    if _runs(erase_registrierungen_in_session, scope):
        registrierungen = await erase_registrierungen_in_session(
            registrierungen_collection=registrierungen_collection,
            aktionen_collection=aktionen_collection,
            registrierungen=subject.registrierungen,
            stamp=stamp,
            session=session,
        )

    spieler, saison_spieler = 0, 0
    if _runs(erase_person_in_session, scope):
        for row in subject.spieler:
            erased = await erase_person_in_session(
                spieler_collection=spieler_collection,
                saison_spieler_collection=saison_spieler_collection,
                aktionen_collection=aktionen_collection,
                spieler_id=row["_id"],
                stamp=stamp,
                session=session,
            )
            spieler += erased.spieler
            saison_spieler += erased.saison_spieler

    berechtigungen = 0
    if _runs(erase_grants_and_authorship_in_session, scope):
        berechtigungen = (
            await erase_grants_and_authorship_in_session(
                berechtigungen_collection=berechtigungen_collection,
                berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
                berechtigungen_postausgang_collection=berechtigungen_postausgang_collection,
                bewerbungen_collection=bewerbungen_collection,
                registrierungen_collection=registrierungen_collection,
                einladungen_collection=einladungen_collection,
                sperrliste_collection=sperrliste_collection,
                sperrliste=sperrliste,
                identifier=identifier,
                geaendert_von=geaendert_von,
                now=now,
                session=session,
            )
        ).removed_berechtigungen

    drosselung = 0
    if _runs(erase_counts_in_session, scope):
        drosselung = await erase_counts_in_session(drosselung_collection=drosselung_collection, pseudonym=subject.pseudonym, session=session)

    if _runs(unattribute_in_session, scope):
        await unattribute_in_session(
            aktionen_collection=aktionen_collection, identifier=identifier, pseudonym=subject.pseudonym, session=session
        )

    if _runs(redact_address_in_images, scope):
        await redact_address_in_images(aktionen_collection=aktionen_collection, identifier=identifier, stamp=stamp, session=session)

    return FLErasure(
        spieler=spieler,
        saison_spieler=saison_spieler,
        schiedsrichter=len(subject.schiedsrichter) if _runs(erase_referee_in_session, scope) else 0,
        spiele=spiele,
        kontakt_sitze=kontakt_sitze,
        registrierungen=registrierungen,
        adresswechsel=adresswechsel,
        berechtigungen=berechtigungen,
        drosselung=drosselung,
    )


# What every erasure journal line opens with: a token rather than a sentence, so the host's daily
# export matches the day's lines by it whatever wording surrounds it.
ERASURE_JOURNAL_EVENT: Final = "loeschung-journal"

# The driver's label on a commit whose answer was lost: the erasure may have landed.
UNKNOWN_COMMIT_RESULT: Final = "UnknownTransactionCommitResult"


class ErasureJournal[Erased: FLErasure]:
    """Entered around every erasure route's transaction block: the journal and the warnings follow its commit.

    Outside the block, whose abort a failure meets first (`docs/backend/spec.md :: I539`); never in the callback, where a
    rolled-back attempt would be journalled.
    """

    def __init__(self, identifier: str, *, schluessel: SecretStr, berechtigungen_collection: AsyncCollection) -> None:
        self._identifier = identifier
        self._schluessel = schluessel
        self._berechtigungen_collection = berechtigungen_collection
        self._erased: Erased | None = None

    async def __aenter__(self) -> ErasureJournal[Erased]:
        return self

    def took(self, erased: Erased) -> Erased:
        """The transaction's answer, handed on as it arrives."""

        self._erased = erased

        return erased

    async def __aexit__(self, kind: type[BaseException] | None, failure: BaseException | None, traceback: TracebackType | None) -> None:
        if failure is None:
            if self._erased is None:
                raise RuntimeError("an erasure route left its journal without handing it the transaction's answer")
            self._journal()
            # It fires on a list left holding no live grant, no owner or a dead row, never on one merely a
            # grant short: the ended grant's queued notice is what tells the other administrators.
            if self._erased.berechtigungen:
                await warn_about_the_grants(self._berechtigungen_collection)
        # A lost answer, never a refusal (which raises before any commit): it may have landed, and replaying an
        # erasure the person asked for wrongs nobody. Unwarned: the warning's read would meet the deadline that
        # lost the answer.
        elif isinstance(failure, PyMongoError) and failure.has_error_label(UNKNOWN_COMMIT_RESULT):
            self._journal()

    def _journal(self) -> None:
        journal_logger.info(f"{ERASURE_JOURNAL_EVENT} {loeschung_journal_hash(self._identifier, schluessel=self._schluessel)}")


async def unreferenced_of(
    identifiers: Sequence[str], records: RecordCollections, *, berechtigungen_collection: AsyncCollection, sperrliste: BanList
) -> list[str]:
    """Which of these addresses no record references and no ban holds (`docs/backend/spec.md :: I698`).

    Each collection is read once for the whole batch rather than once per address, which is what
    `app/shared/schemas/bounds.py :: REFERENZEN_ADRESSEN_MAX` is measured against.
    """

    judged = [identifier for identifier in identifiers if can_judge(identifier)]
    folded = sorted({sign_in_identifier(identifier) for identifier in judged})

    # No address, no read: an empty `$or` is a query the server refuses.
    if not folded:
        return []

    rows, gesperrt = await gather_cancelling(
        gather_cancelling(
            aggregate_many_from_db(collection=records.saison_teams_collection, pipeline=build_seat_references_pipeline(folded)),
            aggregate_many_from_db(collection=records.bewerbungen_collection, pipeline=build_bewerbung_references_pipeline(folded)),
            aggregate_many_from_db(collection=records.schiedsrichter_collection, pipeline=build_referee_references_pipeline(folded)),
            aggregate_many_from_db(collection=records.spieler_collection, pipeline=build_pupil_references_pipeline(folded)),
            aggregate_many_from_db(collection=records.registrierungen_collection, pipeline=build_registrierung_references_pipeline(folded)),
            # Every row as stored, never `app/api/berechtigungen/crud.py :: verwaltung_of`: a grant edited in
            # the database is in effect for nobody until the comparison sees it, and its account outlasts that.
            read_berechtigungen(berechtigungen_collection=berechtigungen_collection),
        ),
        adressen_gesperrt(sperrliste, judged),
    )
    seat_rows, bewerbung_rows, referee_rows, pupil_rows, registrierung_rows, grant_rows = rows

    # Before any address is judged: the whole batch answers nothing rather than all of it unreferenced.
    refuse(find_kein_inhaber_refusal(grant_rows))

    referenced = referenced_addresses(
        seat_rows=seat_rows,
        bewerbung_rows=bewerbung_rows,
        referee_rows=referee_rows,
        pupil_rows=pupil_rows,
        registrierung_rows=registrierung_rows,
        grant_rows=grant_rows,
    )

    return unreferenced(identifiers, referenced=referenced, gesperrt=gesperrt)
