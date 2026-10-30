import asyncio
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

from app.api.adresswechsel.crud import (
    build_loeschung_adresswechsel_pipeline,
    end_an_emptied_change_in_session,
    end_the_address_changes_in_session,
)
from app.api.adresswechsel.services import build_owed_carry_filter
from app.api.aktionen.crud import reattribute_administrator_in_session, redact_address_in_images
from app.api.berechtigungen.antraege import loeschen_antraege_in_session
from app.api.berechtigungen.crud import read_berechtigungen
from app.api.berechtigungen.loeschung import loeschen_grants_and_authorship_in_session
from app.api.identitaet.lookup import RecordCollections
from app.api.identitaet.schemas import FLAnmeldung, FLLoeschung, FLSubjectSchiedsrichter, FLSubjectSeat, FLSubjectSpieler, FLSubjekt
from app.api.identitaet.services import (
    EintragArt,
    awaits_confirmation,
    behaltene_saison_ids,
    build_bewerbung_pipeline,
    build_bewerbung_references_pipeline,
    build_loeschung_anzahl_pipeline,
    build_loeschung_pupil_pipeline,
    build_loeschung_referee_pipeline,
    build_loeschung_registrierung_pipeline,
    build_loeschung_seat_pipeline,
    build_loeschung_seite_pipeline,
    build_offene_registrierungen_pipeline,
    build_pupil_pipeline,
    build_pupil_references_pipeline,
    build_referee_pipeline,
    build_referee_references_pipeline,
    build_registrierung_pipeline,
    build_registrierung_references_pipeline,
    build_seat_pipeline,
    build_seat_references_pipeline,
    eigene_eintraege,
    eigene_sitze,
    find_funktion_refusal,
    find_kein_inhaber_refusal,
    folds_to,
    grants_a_panel,
    ist_eigener_schiedsrichter,
    ist_eigener_spieler,
    lebt,
    loeschung_faellig,
    nicht_ausgetreten,
    offene_adressen,
    referenced_addresses,
    seat_is_confirmed,
    seats_naming,
    statuses_of,
    unreferenced,
)
from app.api.kontakte.crud import loeschen_kontaktperson_in_session
from app.api.registrierungen.crud import loeschen_registrierungen_in_session
from app.api.registrierungen.services import build_eigene_registrierung_filter
from app.api.schiedsrichter.crud import ensure_ghost_schiedsrichter, loeschen_referee_in_session
from app.api.sperrliste.lookup import BanList
from app.api.spielberichte.crud import repoint_referee_reports_in_session
from app.api.spielbestaetigungen.crud import loeschen_referee_confirmations_in_session
from app.api.spielbestaetigungen.services import halter_of
from app.api.spieler.crud import ensure_ghost_spieler, loeschen_person_in_session
from app.core.codes import Code
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, anchor_in_db, erase_many_from_db, patch_many_in_db, refuse
from app.core.db import warn_about_the_grants
from app.core.journal import JournalLine, lost_its_answer
from app.core.logging import fl_logger, journal_logger
from app.core.recording import ERASED_ACTOR_MARKER, SYSTEM_ACTOR_EMAIL
from app.core.security import actor_pseudonym, erasure_journal_hash
from app.shared.einwilligung import is_confirmed
from app.shared.folding import sign_in_identifier
from app.shared.schemas.literals import FLSaisonStatus


async def _statuses_of(
    *, saisons_collection: AsyncCollection, saison_ids: Sequence[str], session: AsyncClientSession | None
) -> Mapping[str, FLSaisonStatus]:
    """One read of `saisons` for every season the seats sit in, the junction row carrying no copy of its season's `status`.

    Made after the live seats are judged, so a withdrawn team's season is never read for.
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
    holder.
    """

    # Live rows alone, here and in the flag: a retired person and a withdrawn team grant nothing, and
    # confirming one would open nothing.
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
        seats=[
            # `model_validate` rather than the constructor: the slot is a plain string here, and the
            # wire's closed set is what refuses one no endpoint publishes.
            FLSubjectSeat.model_validate(
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
        spieler=[FLSubjectSpieler(spieler_id=row["_id"]) for row in lebende_spieler if ist_eigener_spieler(row)],
        schiedsrichter=[
            FLSubjectSchiedsrichter(schiedsrichter_id=row["_id"])
            for row in lebende_schiedsrichter
            if ist_eigener_schiedsrichter(row, identifier)
        ],
        # Over the records that could grant a panel alone: confirming a
        # seat on a `past` season opens nothing, so it neither raises the flag nor holds it down.
        unconfirmed=awaits_confirmation(
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

    Its reads gathered and outside any transaction, for `POST /identity/subject`; a caller inside one
    reads through `find_subjekt_in_session`.
    """

    seat_rows, referee_rows, pupil_rows = await asyncio.gather(
        *(aggregate_many_from_db(collection=collection, pipeline=pipeline) for collection, pipeline in _reads(identifier, records))
    )

    return await _judged(identifier, seat_rows, referee_rows, pupil_rows, saisons_collection=records.saisons_collection, session=None)


async def find_eigene_eintraege(identifier: str, records: RecordCollections) -> tuple[FLSubjekt, frozenset[tuple[EintragArt, Any]]]:
    """The gate's five reads, judged twice: the subject's answer, and every own record of the address.

    The two only the gate pays for, a pending application's and a registration's, grant no panel and
    so are read on no page render.
    """

    seat_rows, referee_rows, pupil_rows, bewerbung_rows, registrierung_rows = await asyncio.gather(
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

    return FLAnmeldung(unconfirmed=subjekt.unconfirmed, account=bool(eintraege))


async def find_subjekt_in_session(
    identifier: str,
    records: RecordCollections,
    *,
    # REQUIRED: this is the lookup a transaction reaches, so no read of it can leave the session.
    session: AsyncClientSession,
) -> FLSubjekt:
    """`find_subject`'s answer read inside a caller's session, one read at a time.

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
    """What a person endpoint may authorise against: `find_subject`'s answer, its seats narrowed to the seasons granting a panel.

    Narrowed here and not in the lookup, each caller narrowing for itself.
    """

    # Folded whatever arrived: a header spelled otherwise than the store would otherwise authorise
    # nothing, every read matching the stored fold by equality.
    folded = sign_in_identifier(identifier)

    # Raised rather than answered: a person's binder refuses a malformed actor before any handler
    # runs, so an empty one here is a caller's bug, and it would match a hand-edited empty stored
    # address.
    if folded == "":
        raise ValueError("funktionen_of was asked about an empty identifier")

    return _nur_mit_panel(await find_subjekt_in_session(folded, records, session=session))


def _nur_mit_panel(subjekt: FLSubjekt) -> FLSubjekt:
    return subjekt.model_copy(update={"seats": [sitz for sitz in subjekt.seats if grants_a_panel(sitz.saison_status)]})


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
    """`role_not_held` unless the person holds a seat on this team in this season, judged in the caller's session.

    In-session because a seat may end between the page's check and this one.
    """

    subjekt = await funktionen_of(identifier, records, session=session)

    refuse(find_funktion_refusal(sitze=subjekt.seats, team_id=team_id, saison_id=saison_id))


# --- The ERASURE: one registry of every step that reaches a person's data, run in one transaction.

# The kinds of person a step's records belong to, „Personengruppe“ in the published notice: never a
# `rolle` or a `Funktion`, each of which names something else here (`docs/glossary.md :: Funktion`).
Personengruppe = Literal["kontakt", "spieler", "schiedsrichter"]

# The scope of a person's own request and an administrator's: everything the address holds.
JEDE_PERSONENGRUPPE: Final[frozenset[Personengruppe]] = frozenset(get_args(Personengruppe))


def _read(rows: Rows | None, kind: str) -> Rows:
    if rows is None:
        raise RuntimeError(f"an erasure step reads `{kind}`, which the subject of its scope never read")

    return rows


@dataclass(frozen=True, kw_only=True)
class Subject:
    """Every record one folded address holds that its scope uses, read before the erasure's first step writes.

    Each step takes its rows from here: one reading after another step wrote would miss what that step removed and answer zero.
    """

    identifier: str
    # The log's key for this person (`app/core/security.py :: actor_pseudonym`).
    pseudonym: str
    # Each `None` where no step of the scope uses it, never an empty list: its property raises, so a step
    # given a scope without its read fails rather than erasing nothing and answering zero.
    _saison_teams: Rows | None
    _bewerbungen: Rows | None
    _schiedsrichter: Rows | None
    _spieler: Rows | None
    _registrierungen: Rows | None
    # The live changes naming this address, its own and another address's whose new address it is.
    _adresswechsel: Rows | None

    @property
    def saison_teams(self) -> Rows:
        return _read(self._saison_teams, "saison_teams")

    @property
    def bewerbungen(self) -> Rows:
        return _read(self._bewerbungen, "bewerbungen")

    @property
    def schiedsrichter(self) -> Rows:
        return _read(self._schiedsrichter, "schiedsrichter")

    @property
    def spieler(self) -> Rows:
        return _read(self._spieler, "spieler")

    @property
    def registrierungen(self) -> Rows:
        return _read(self._registrierungen, "registrierungen")

    @property
    def adresswechsel(self) -> Rows:
        return _read(self._adresswechsel, "adresswechsel")


async def resolve_subject(
    identifier: str,
    *,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    spieler_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    key: SecretStr,
    # REQUIRED: the erasure reads it inside its transaction, so a retry re-reads it, and the preview in
    # a snapshot, so it names the records of one moment.
    session: AsyncClientSession,
    # The previews' default: they name every record the full erasure takes.
    scope: frozenset[Personengruppe] = JEDE_PERSONENGRUPPE,
) -> Subject:
    """What `identifier` holds, through the unnarrowed selections: an unconfirmed seat, a retired row and a declined registration included.

    One read at a time: a session runs one operation at a time, and gathered reads would race unseen.
    """

    async def read(collection: AsyncCollection, pipeline: Sequence[Mapping[str, Any]]) -> Rows:
        return await aggregate_many_from_db(collection=collection, pipeline=pipeline, session=session)

    seats = _runs(loeschen_kontaktperson_in_session, scope)
    saison_teams = await read(saison_teams_collection, build_loeschung_seat_pipeline(identifier)) if seats else None
    bewerbungen = await read(bewerbungen_collection, build_loeschung_seat_pipeline(identifier)) if seats else None
    schiedsrichter = (
        await read(schiedsrichter_collection, build_loeschung_referee_pipeline(identifier))
        if _runs(loeschen_referee_in_session, scope)
        else None
    )
    spieler = await read(spieler_collection, build_loeschung_pupil_pipeline(identifier)) if _runs(loeschen_person_in_session, scope) else None
    registrierungen = (
        await read(registrierungen_collection, build_loeschung_registrierung_pipeline(identifier))
        if _runs(loeschen_registrierungen_in_session, scope)
        else None
    )
    adresswechsel = (
        # On the subject's own database, a read alone: the ban's reveal reads the subject too and holds no change's collection.
        await read(spieler_collection.database[Collection.ADDRESS_CHANGES], build_loeschung_adresswechsel_pipeline(identifier))
        if _runs(end_the_address_changes_in_session, scope)
        else None
    )

    return Subject(
        identifier=identifier,
        pseudonym=actor_pseudonym(identifier, key=key),
        _saison_teams=saison_teams,
        _bewerbungen=bewerbungen,
        _schiedsrichter=schiedsrichter,
        _spieler=spieler,
        _registrierungen=registrierungen,
        _adresswechsel=adresswechsel,
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

    as_person = await unattribute_pseudonym_in_session(aktionen_collection=aktionen_collection, pseudonym=pseudonym, session=session)
    as_administrator = await reattribute_administrator_in_session(
        aktionen_collection=aktionen_collection, identifier=identifier, value=ERASED_ACTOR_MARKER, session=session
    )

    return as_person + as_administrator


async def unattribute_pseudonym_in_session(*, aktionen_collection: AsyncCollection, pseudonym: str, session: AsyncClientSession) -> int:
    """The marker on every log row the person wrote signed in, by their pseudonym alone: what a restore's replay reaches without the address."""

    marked = await patch_many_in_db(
        collection=aktionen_collection,
        db_filter={"actor.pseudonym": pseudonym},
        update={"$set": {"actor.pseudonym": ERASED_ACTOR_MARKER}},
        session=session,
    )

    return marked.modified_count


async def loeschen_pupil_actor_in_session(
    *,
    aktionen_collection: AsyncCollection,
    pseudonym: str,
    # REQUIRED: outside the erasure's transaction, a pupil it rolls back would still lose their authorship.
    session: AsyncClientSession,
) -> None:
    """Put the marker where the person stood as a pupil in the log."""

    await patch_many_in_db(
        collection=aktionen_collection,
        db_filter={"actor.pseudonym": pseudonym, "actor.funktion": "spieler"},
        update={"$set": {"actor.pseudonym": ERASED_ACTOR_MARKER}},
        session=session,
    )


async def _replaced_addresses(
    identifier: str, *, adresswechsel_collection: AsyncCollection, key: SecretStr, session: AsyncClientSession
) -> tuple[set[str], list[Any]]:
    """The hashes of every address this one replaced, through the chain of effects that moved the person here, and those effects.

    The journal's own keyed hash (`app/core/security.py :: erasure_journal_hash`), so no address is kept to find them by.
    """

    replaced: set[str] = set()
    effects: list[Any] = []
    sought = {erasure_journal_hash(identifier, key=key)}
    while sought:
        found = await aggregate_many_from_db(
            collection=adresswechsel_collection,
            pipeline=[{"$match": {"moved.person_hash": {"$in": sorted(sought)}}}, {"$project": {"moved": 1}}],
            session=session,
        )
        effects += [row["_id"] for row in found]
        sought = {str(row["moved"]["before"]) for row in found} - replaced
        replaced |= sought

    return replaced, effects


async def loeschen_the_mails_in_session(
    *,
    outbox_collection: AsyncCollection,
    adresswechsel_collection: AsyncCollection,
    identifier: str,
    key: SecretStr,
    session: AsyncClientSession,
) -> int:
    """Every mail to this folded address or one it replaced removed, and a replaced address withheld in every grant notice owed.

    Owed or settled, every kind but the sign-in library's deletion link, which asks the erasure. A settled row's
    retention bounds a row nobody erases; no reader serves an erased person's delivery history. No index serves the
    read, the collection holding a month of mail. Matched on the sign-in fold, a recipient being stored as its mail was
    owed.
    """

    replaced, effects = await _replaced_addresses(identifier, adresswechsel_collection=adresswechsel_collection, key=key, session=session)

    def theirs(value: Any) -> bool:
        if not isinstance(value, str):
            return False
        folded = sign_in_identifier(value)
        return folded == identifier or erasure_journal_hash(folded, key=key) in replaced

    rows = await aggregate_many_from_db(
        collection=outbox_collection,
        pipeline=[
            {"$match": {"art": {"$ne": "account_erasure"}}},
            {"$project": {"an": 1, "art": 1, "stand": 1, "data.now": 1, "data.before": 1, "data.changed_by": 1}},
        ],
        session=session,
    )
    ids = [row["_id"] for row in rows if theirs(row["an"])]
    if ids:
        await erase_many_from_db(collection=outbox_collection, db_filter={"_id": {"$in": ids}}, session=session)

    # The person's own address the grants' step withholds; a replaced one only this chain finds.
    for row in rows:
        if row["_id"] in ids or row["art"] != "grant" or row["stand"] != "open" or not replaced:
            continue
        daten = row.get("data") or {}
        withheld: dict[str, Any] = {}
        for site in ("now", "before"):
            if theirs((daten.get(site) or {}).get("adresse")):
                withheld |= {f"data.{site}.adresse": None, "data.withheld": "erased"}
        if theirs(daten.get("changed_by")):
            withheld["data.changed_by"] = ERASED_ACTOR_MARKER
        if withheld:
            await patch_many_in_db(collection=outbox_collection, db_filter={"_id": row["_id"]}, update={"$set": withheld}, session=session)

    # The chain served its one reader: nothing links the erased person's addresses past this erasure.
    if effects:
        await patch_many_in_db(
            collection=adresswechsel_collection, db_filter={"_id": {"$in": effects}}, update={"$unset": {"moved": ""}}, session=session
        )

    return len(ids)


@dataclass(frozen=True)
class LoeschungStep:
    """One member of the erasure: the collections it writes, whose records they are, and the function `loeschen_everything` calls by name."""

    reaches: frozenset[Collection]
    # `None` for a step serving no one kind of person: the full scope alone runs it. Every step leaving
    # the address in another record's images is one, so no scope runs it without the address pass.
    personengruppe: Personengruppe | None
    run: Callable[..., Awaitable[Any]]


# In the order `loeschen_everything` runs them: every step reaching a person's references before the
# step removing the person, the log's actor after every write the steps filed under them, and the
# address pass after every image they filed.
LOESCHUNG_STEPS: Final[tuple[LoeschungStep, ...]] = (
    LoeschungStep(
        reaches=frozenset({Collection.SAISON_TEAMS, Collection.BEWERBUNGEN, Collection.SPIELBESTAETIGUNGEN, Collection.ACTION_LOG}),
        personengruppe="kontakt",
        run=loeschen_kontaktperson_in_session,
    ),
    # No kind's alone: a change belongs to the address, whatever it holds, and another address's to that one.
    LoeschungStep(
        reaches=frozenset({Collection.ADDRESS_CHANGES, Collection.OUTBOX, Collection.ACTION_LOG}),
        personengruppe=None,
        run=end_the_address_changes_in_session,
    ),
    LoeschungStep(
        reaches=frozenset({Collection.SPIELBESTAETIGUNGEN, Collection.ACTION_LOG}),
        personengruppe="schiedsrichter",
        run=loeschen_referee_confirmations_in_session,
    ),
    LoeschungStep(
        reaches=frozenset({Collection.SPIELBERICHTE, Collection.ACTION_LOG}),
        personengruppe="schiedsrichter",
        run=repoint_referee_reports_in_session,
    ),
    LoeschungStep(
        reaches=frozenset({Collection.SCHIEDSRICHTER, Collection.SPIELE, Collection.ACTION_LOG}),
        personengruppe="schiedsrichter",
        run=loeschen_referee_in_session,
    ),
    LoeschungStep(
        reaches=frozenset({Collection.REGISTRIERUNGEN, Collection.ACTION_LOG}),
        personengruppe="spieler",
        run=loeschen_registrierungen_in_session,
    ),
    LoeschungStep(
        reaches=frozenset({Collection.SPIELER, Collection.SAISON_SPIELER, Collection.ACTION_LOG}),
        personengruppe="spieler",
        run=loeschen_person_in_session,
    ),
    # After the pupil's records went: the season's erasure leaves the address's other records, and their change, standing.
    LoeschungStep(
        reaches=frozenset({Collection.ADDRESS_CHANGES, Collection.ACTION_LOG}), personengruppe="spieler", run=end_an_emptied_change_in_session
    ),
    # No kind's alone: a request is about an address, whatever it holds, or made by an administrator.
    LoeschungStep(
        reaches=frozenset({Collection.GRANT_APPROVAL_REQUESTS, Collection.OUTBOX}), personengruppe=None, run=loeschen_antraege_in_session
    ),
    # No kind's alone: it changes records the person made as an administrator and as a seat holder, so
    # the pupil scope must never run it.
    LoeschungStep(
        reaches=frozenset(
            {
                Collection.GRANTS,
                Collection.GRANTS_ANNOUNCED,
                Collection.OUTBOX,
                Collection.BEWERBUNGEN,
                Collection.REGISTRIERUNGEN,
                Collection.SPERRLISTE,
                Collection.INVITATIONS,
            }
        ),
        personengruppe=None,
        run=loeschen_grants_and_authorship_in_session,
    ),
    # No kind's alone: a mail to the address is owed it whatever it holds. After the grants' step, which owes this
    # erasure's notices to the administrators who remain.
    LoeschungStep(reaches=frozenset({Collection.OUTBOX, Collection.ADDRESS_CHANGES}), personengruppe=None, run=loeschen_the_mails_in_session),
    LoeschungStep(reaches=frozenset({Collection.ACTION_LOG}), personengruppe=None, run=unattribute_in_session),
    # The pupil's share of the one above, finding nothing after it in the full scope: in the pupil scope a seat's or a
    # referee row's rows are that standing record's, and stay.
    LoeschungStep(reaches=frozenset({Collection.ACTION_LOG}), personengruppe="spieler", run=loeschen_pupil_actor_in_session),
    # LAST: images filed before the erasure hold the address, and the seat clearing files more. No kind's
    # alone: in the pupil scope it would take a standing referee's or administrator's address out of their own images.
    LoeschungStep(reaches=frozenset({Collection.ACTION_LOG}), personengruppe=None, run=redact_address_in_images),
)


def _runs(run: Callable[..., Awaitable[Any]], scope: frozenset[Personengruppe]) -> bool:
    """Whether the step running `run` belongs to this scope, read off its one declaration in `LOESCHUNG_STEPS`."""

    (step,) = [step for step in LOESCHUNG_STEPS if step.run is run]

    return scope == JEDE_PERSONENGRUPPE if step.personengruppe is None else step.personengruppe in scope


async def loeschen_everything(
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
    spielbestaetigungen_collection: AsyncCollection,
    spielberichte_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    berechtigungen_collection: AsyncCollection,
    berechtigungen_angekuendigt_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    einladungen_collection: AsyncCollection,
    sperrliste_collection: AsyncCollection,
    adresswechsel_collection: AsyncCollection,
    berechtigungen_antraege_collection: AsyncCollection,
    sperrliste: BanList,
    # Whom the grant notice names as ending the person's grant: the person on their own request, the
    # administrator on theirs.
    changed_by: str,
    key: SecretStr,
    # The caller's, so every redaction of one erasure carries one instant.
    stamp: str,
    now: datetime,
    # REQUIRED: the caller's transaction, every step committing together or none.
    session: AsyncClientSession,
) -> FLLoeschung:
    """Erase every record of this folded address the scope reaches, in the caller's transaction.

    The subject is read HERE, so a retry after a conflict re-reads it. The caller runs its transaction inside an
    `LoeschungJournal`, which journals once it commits.
    """

    subject = await resolve_subject(
        identifier,
        saison_teams_collection=saison_teams_collection,
        bewerbungen_collection=bewerbungen_collection,
        schiedsrichter_collection=schiedsrichter_collection,
        spieler_collection=spieler_collection,
        registrierungen_collection=registrierungen_collection,
        key=key,
        session=session,
        scope=scope,
    )

    # Each sentinel ahead of the step erasing its kind. The referee's takes the fixtures that booked the
    # person; nothing is repointed at the pupils'.
    if _runs(loeschen_referee_in_session, scope) and subject.schiedsrichter:
        await ensure_ghost_schiedsrichter(schiedsrichter_collection=schiedsrichter_collection, session=session)
    if _runs(loeschen_person_in_session, scope) and subject.spieler:
        await ensure_ghost_spieler(spieler_collection=spieler_collection, session=session)

    kontakt_sitze = 0
    if _runs(loeschen_kontaktperson_in_session, scope):
        kontakt_sitze = (
            await loeschen_kontaktperson_in_session(
                saison_teams_collection=saison_teams_collection,
                bewerbungen_collection=bewerbungen_collection,
                spielbestaetigungen_collection=spielbestaetigungen_collection,
                aktionen_collection=aktionen_collection,
                identifier=identifier,
                key=key,
                saison_team_rows=subject.saison_teams,
                bewerbung_rows=subject.bewerbungen,
                stamp=stamp,
                session=session,
            )
        ).kontakt_slots

    adresswechsel = 0
    if _runs(end_the_address_changes_in_session, scope):
        adresswechsel = await end_the_address_changes_in_session(
            adresswechsel_collection=adresswechsel_collection,
            outbox_collection=outbox_collection,
            aktionen_collection=aktionen_collection,
            identifier=identifier,
            rows=subject.adresswechsel,
            now=now,
            stamp=stamp,
            session=session,
        )

    if _runs(loeschen_referee_confirmations_in_session, scope):
        await loeschen_referee_confirmations_in_session(
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            aktionen_collection=aktionen_collection,
            schiedsrichter_ids=[row["_id"] for row in subject.schiedsrichter],
            stamp=stamp,
            session=session,
        )

    # Repointed rather than removed, as the fixtures are: a report is the league's record of the match, after the ghost stands.
    if _runs(repoint_referee_reports_in_session, scope):
        await repoint_referee_reports_in_session(
            spielberichte_collection=spielberichte_collection,
            aktionen_collection=aktionen_collection,
            schiedsrichter_ids=[row["_id"] for row in subject.schiedsrichter],
            stamp=stamp,
            session=session,
        )

    spiele = 0
    if _runs(loeschen_referee_in_session, scope):
        for row in subject.schiedsrichter:
            spiele += await loeschen_referee_in_session(
                schiedsrichter_collection=schiedsrichter_collection,
                spiele_collection=spiele_collection,
                aktionen_collection=aktionen_collection,
                schiedsrichter_id=row["_id"],
                stamp=stamp,
                session=session,
            )

    registrierungen = 0
    if _runs(loeschen_registrierungen_in_session, scope):
        registrierungen = await loeschen_registrierungen_in_session(
            registrierungen_collection=registrierungen_collection,
            aktionen_collection=aktionen_collection,
            registrierungen=subject.registrierungen,
            stamp=stamp,
            session=session,
        )

    spieler, saison_spieler = 0, 0
    if _runs(loeschen_person_in_session, scope):
        for row in subject.spieler:
            geloescht = await loeschen_person_in_session(
                spieler_collection=spieler_collection,
                saison_spieler_collection=saison_spieler_collection,
                aktionen_collection=aktionen_collection,
                spieler_id=row["_id"],
                stamp=stamp,
                session=session,
            )
            spieler += geloescht.spieler
            saison_spieler += geloescht.saison_spieler

    if _runs(end_an_emptied_change_in_session, scope):
        adresswechsel += await end_an_emptied_change_in_session(
            adresswechsel_collection=adresswechsel_collection,
            aktionen_collection=aktionen_collection,
            berechtigungen_collection=berechtigungen_collection,
            records=RecordCollections(
                saison_teams_collection=saison_teams_collection,
                # Read by no step: the record lookup's bundle carries it for the subject's own reads.
                saisons_collection=saison_teams_collection.database[Collection.SAISONS],
                spieler_collection=spieler_collection,
                schiedsrichter_collection=schiedsrichter_collection,
                bewerbungen_collection=bewerbungen_collection,
                registrierungen_collection=registrierungen_collection,
            ),
            identifier=identifier,
            now=now,
            stamp=stamp,
            session=session,
        )

    berechtigungen_antraege = 0
    if _runs(loeschen_antraege_in_session, scope):
        berechtigungen_antraege = await loeschen_antraege_in_session(
            berechtigungen_antraege_collection=berechtigungen_antraege_collection,
            outbox_collection=outbox_collection,
            identifier=identifier,
            now=now,
            session=session,
        )

    berechtigungen = 0
    if _runs(loeschen_grants_and_authorship_in_session, scope):
        berechtigungen = (
            await loeschen_grants_and_authorship_in_session(
                berechtigungen_collection=berechtigungen_collection,
                berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
                outbox_collection=outbox_collection,
                bewerbungen_collection=bewerbungen_collection,
                registrierungen_collection=registrierungen_collection,
                einladungen_collection=einladungen_collection,
                sperrliste_collection=sperrliste_collection,
                sperrliste=sperrliste,
                identifier=identifier,
                changed_by=changed_by,
                now=now,
                session=session,
            )
        ).removed_berechtigungen

    if _runs(loeschen_the_mails_in_session, scope):
        await loeschen_the_mails_in_session(
            outbox_collection=outbox_collection,
            adresswechsel_collection=adresswechsel_collection,
            identifier=identifier,
            key=key,
            session=session,
        )

    if _runs(unattribute_in_session, scope):
        await unattribute_in_session(
            aktionen_collection=aktionen_collection, identifier=identifier, pseudonym=subject.pseudonym, session=session
        )

    if _runs(loeschen_pupil_actor_in_session, scope):
        await loeschen_pupil_actor_in_session(aktionen_collection=aktionen_collection, pseudonym=subject.pseudonym, session=session)

    if _runs(redact_address_in_images, scope):
        await redact_address_in_images(aktionen_collection=aktionen_collection, identifier=identifier, stamp=stamp, session=session)

    return FLLoeschung(
        spieler=spieler,
        saison_spieler=saison_spieler,
        schiedsrichter=len(subject.schiedsrichter) if _runs(loeschen_referee_in_session, scope) else 0,
        spiele=spiele,
        kontakt_seats=kontakt_sitze,
        registrierungen=registrierungen,
        address_change=adresswechsel,
        grants=berechtigungen,
        grants_approval_requests=berechtigungen_antraege,
    )


class LoeschungJournal[Geloescht: FLLoeschung]:
    """Entered around every erasure route's transaction block: the journal and the warnings follow its commit.

    Outside the block, whose abort a failure meets first; never in the callback, where a
    rolled-back attempt would be journalled.
    """

    def __init__(self, identifier: str, *, key: SecretStr, berechtigungen_collection: AsyncCollection) -> None:
        self._identifier = identifier
        self._schluessel = key
        self._berechtigungen_collection = berechtigungen_collection
        self._geloescht: Geloescht | None = None

    async def __aenter__(self) -> LoeschungJournal[Geloescht]:
        return self

    def took(self, erased: Geloescht) -> Geloescht:
        """The transaction's answer, handed on as it arrives."""

        self._geloescht = erased

        return erased

    async def __aexit__(self, kind: type[BaseException] | None, failure: BaseException | None, traceback: TracebackType | None) -> None:
        if failure is None:
            if self._geloescht is None:
                raise RuntimeError("an erasure route left its journal without handing it the transaction's answer")
            self._journal()
            # It fires on a list left holding no live grant, no owner or a dead row, never on one merely a
            # grant short: the ended grant's queued notice is what tells the other administrators.
            if self._geloescht.grants:
                await self._warn_about_the_grants()
        # A lost answer, never a refusal (which raises before any commit): it may have landed, and replaying an
        # erasure the person asked for wrongs nobody. Unwarned: the warning's read would meet the deadline that
        # lost the answer.
        elif lost_its_answer(failure):
            self._journal()

    def _journal(self) -> None:
        line = JournalLine(
            person_hash=erasure_journal_hash(self._identifier, key=self._schluessel),
            art="loeschung",
            pseudonym=actor_pseudonym(self._identifier, key=self._schluessel),
            halter=halter_of(self._identifier, key=self._schluessel),
        )
        journal_logger.info(line.text())

    async def _warn_about_the_grants(self) -> None:
        # Logged, never raised: the erasure committed, and an error answered here, a read meeting the deadline
        # say, keeps the person's sign-in account until they ask again.
        try:
            await warn_about_the_grants(self._berechtigungen_collection)
        except PyMongoError as failure:
            fl_logger.error("identity.grants_unchecked", extra={"error_code": Code.DATABASE_FAILED, "exception": type(failure).__name__})


async def unreferenced_of(
    identifiers: Sequence[str],
    records: RecordCollections,
    *,
    berechtigungen_collection: AsyncCollection,
    adresswechsel_collection: AsyncCollection,
) -> list[str]:
    """Which of these addresses no record references.

    Each collection is read once for the whole batch rather than once per address, which is what
    `app/shared/schemas/bounds.py :: REFERENCES_ADRESSEN_MAX` is measured against.
    """

    folded = sorted({sign_in_identifier(identifier) for identifier in identifiers})

    # No address, no read.
    if not folded:
        return []

    # No ban read beside these: a ban keeps no account, a barred address's going once no record holds it
    # (`docs/datenschutz.md :: 6`).
    (seat_rows, bewerbung_rows, referee_rows, pupil_rows, registrierung_rows, grant_rows, carry_rows) = await asyncio.gather(
        aggregate_many_from_db(collection=records.saison_teams_collection, pipeline=build_seat_references_pipeline(folded)),
        aggregate_many_from_db(collection=records.bewerbungen_collection, pipeline=build_bewerbung_references_pipeline(folded)),
        aggregate_many_from_db(collection=records.schiedsrichter_collection, pipeline=build_referee_references_pipeline(folded)),
        aggregate_many_from_db(collection=records.spieler_collection, pipeline=build_pupil_references_pipeline(folded)),
        aggregate_many_from_db(collection=records.registrierungen_collection, pipeline=build_registrierung_references_pipeline(folded)),
        # Every row as stored, never `app/api/berechtigungen/crud.py :: verwaltung_of`: a grant edited in
        # the database is in effect for nobody until the comparison sees it, and its account outlasts that.
        read_berechtigungen(berechtigungen_collection=berechtigungen_collection),
        aggregate_many_from_db(
            collection=adresswechsel_collection,
            pipeline=[{"$match": build_owed_carry_filter(folded)}, {"$project": {"move.von": 1}}],
        ),
    )

    # Before any address is judged: the whole batch answers nothing rather than all of it unreferenced.
    refuse(find_kein_inhaber_refusal(grant_rows))

    referenced = referenced_addresses(
        seat_rows=seat_rows,
        bewerbung_rows=bewerbung_rows,
        referee_rows=referee_rows,
        pupil_rows=pupil_rows,
        registrierung_rows=registrierung_rows,
        grant_rows=grant_rows,
        carry_rows=carry_rows,
    )

    return unreferenced(identifiers, referenced=referenced)


# --- The SEASON-AFTER RULE's two readers: one outside any transaction
# naming the population, one inside each person's re-judging it.

# A pupil's own data alone: a seat, a referee row or a grant at the same address is another purpose's.
NUR_SPIELER: Final[frozenset[Personengruppe]] = frozenset({"spieler"})


async def saison_statuses(*, saisons_collection: AsyncCollection) -> dict[str, FLSaisonStatus]:
    """Every season's status as stored now, read outside any transaction and never from a cache."""

    return statuses_of(await aggregate_many_from_db(collection=saisons_collection, pipeline=[{"$project": {"status": 1}}]))


async def _offene(registrierungen_collection: AsyncCollection) -> frozenset[str]:
    return offene_adressen(
        await aggregate_many_from_db(collection=registrierungen_collection, pipeline=build_offene_registrierungen_pipeline())
    )


async def faellige_seite(
    statuses: Mapping[str, FLSaisonStatus],
    *,
    nach: ObjectId | None,
    groesse: int,
    spieler_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
) -> tuple[list[Mapping[str, Any]], int]:
    """The due pupils after `nach`, at most `groesse` with their id and address, and how many are due in all.

    Read outside any transaction; each erasure judges its pupil again in its own.
    """

    behalten = behaltene_saison_ids(statuses)
    if behalten is None:
        return [], 0

    pipeline = build_loeschung_seite_pipeline(behalten=behalten, offene=await _offene(registrierungen_collection), nach=nach, groesse=groesse)
    [gelesen] = await aggregate_many_from_db(collection=spieler_collection, pipeline=pipeline)

    return gelesen["seite"], sum(row["anzahl"] for row in gelesen["anzahl"])


async def faellige_anzahl(
    statuses: Mapping[str, FLSaisonStatus], *, spieler_collection: AsyncCollection, registrierungen_collection: AsyncCollection
) -> int:
    """How many pupils the rule makes due under `statuses`, read outside any transaction."""

    behalten = behaltene_saison_ids(statuses)
    if behalten is None:
        return 0

    pipeline = build_loeschung_anzahl_pipeline(behalten=behalten, offene=await _offene(registrierungen_collection))

    return sum(row["anzahl"] for row in await aggregate_many_from_db(collection=spieler_collection, pipeline=pipeline))


async def loeschen_if_still_due(
    spieler_id: Any,
    *,
    saisons_collection: AsyncCollection,
    spieler_collection: AsyncCollection,
    saison_spieler_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    spiele_collection: AsyncCollection,
    spielbestaetigungen_collection: AsyncCollection,
    spielberichte_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    berechtigungen_collection: AsyncCollection,
    berechtigungen_angekuendigt_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    einladungen_collection: AsyncCollection,
    sperrliste_collection: AsyncCollection,
    adresswechsel_collection: AsyncCollection,
    berechtigungen_antraege_collection: AsyncCollection,
    sperrliste: BanList,
    key: SecretStr,
    stamp: str,
    now: datetime,
    # REQUIRED: the judgement and the erasure commit together, so a squad row or a registration
    # landing between the population read and this transaction keeps the person.
    session: AsyncClientSession,
) -> FLLoeschung | None:
    """Erase one pupil's own data where the rule holds in this transaction, or answer `None` where it does not.

    The address is read off the row here and never handed in: an address change moves it between two reads.
    """

    statuses = statuses_of(await aggregate_many_from_db(collection=saisons_collection, pipeline=[{"$project": {"status": 1}}], session=session))
    behalten = behaltene_saison_ids(statuses)
    if behalten is None:
        return None

    # A planned season `behalten` leaves out joins it once activated, which no lower id refuses: anchored, an activation
    # committing after these statuses were read sends this pupil round. Normally none.
    if ausgelassen := sorted(saison_id for saison_id, status in statuses.items() if status == "future" and saison_id not in behalten):
        await anchor_in_db(collection=saisons_collection, db_filter={"_id": {"$in": ausgelassen}}, session=session)

    pupils = await aggregate_many_from_db(
        collection=spieler_collection, pipeline=[{"$match": {"_id": spieler_id}}, {"$project": {"email": 1}}], session=session
    )
    email = pupils[0].get("email") if pupils else None
    if not isinstance(email, str):
        return None

    kader = await aggregate_many_from_db(
        collection=saison_spieler_collection, pipeline=[{"$match": {"spieler_id": spieler_id}}, {"$project": {"saison_id": 1}}], session=session
    )
    registrierungen = await aggregate_many_from_db(
        collection=registrierungen_collection,
        pipeline=[{"$match": build_eigene_registrierung_filter(email)}, {"$project": {"status": 1, "email": 1}}],
        session=session,
    )
    if not loeschung_faellig(
        email=email,
        kader_saison_ids=[row["saison_id"] for row in kader],
        offene=offene_adressen(registrierungen),
        behalten=behalten,
    ):
        return None

    return await loeschen_everything(
        email,
        scope=NUR_SPIELER,
        spieler_collection=spieler_collection,
        saison_spieler_collection=saison_spieler_collection,
        saison_teams_collection=saison_teams_collection,
        bewerbungen_collection=bewerbungen_collection,
        schiedsrichter_collection=schiedsrichter_collection,
        spiele_collection=spiele_collection,
        spielbestaetigungen_collection=spielbestaetigungen_collection,
        spielberichte_collection=spielberichte_collection,
        registrierungen_collection=registrierungen_collection,
        aktionen_collection=aktionen_collection,
        berechtigungen_collection=berechtigungen_collection,
        berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
        outbox_collection=outbox_collection,
        einladungen_collection=einladungen_collection,
        sperrliste_collection=sperrliste_collection,
        adresswechsel_collection=adresswechsel_collection,
        berechtigungen_antraege_collection=berechtigungen_antraege_collection,
        sperrliste=sperrliste,
        # Read by the grants step alone, which this scope never runs.
        changed_by=SYSTEM_ACTOR_EMAIL,
        key=key,
        stamp=stamp,
        now=now,
        session=session,
    )
