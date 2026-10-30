"""
API · an address change's reads and writes: what the address holds, the start, the effect and every ending

Every route, the hourly pass, the erasure and the restore's replay start, judge, move and end a change through these
functions, so no two of them part on what a change moves or what its end leaves behind.

Invariants:
- The effect moves everything the address holds in its caller's transaction, a grant included, and nothing else.
- Every end takes the record's addresses and reason out of it; its log images lose what no record holds after it: the
  new address and the reason on every end but the effect, the replaced address on the effect.
"""

from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final, Literal

from bson import ObjectId
from pydantic import SecretStr
from pymongo import DESCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.adresswechsel.services import (
    LIVE_TERMS,
    build_address_filter,
    build_owed_carry_filter,
    compose_end_update,
    compose_genehmigung_widerrufen_update,
    deckt,
    find_abgelaufen_refusal,
    find_belegt_refusal,
    find_bestaetigung_gesperrt_refusal,
    find_ersetzte_gesperrt_refusal,
    find_neue_berechtigt_refusal,
    find_nicht_gedeckt_refusal,
    find_vergeben_refusal,
)
from app.api.aktionen.crud import (
    carry_the_replaced_address_in_images,
    reattribute_administrator_in_session,
    redact_images_in_session,
)
from app.api.berechtigungen.antraege import antrag_line, build_offen_filter, end_the_antraege_about_in_session
from app.api.berechtigungen.crud import grant_in_session, read_berechtigungen, read_the_announced, revoke_in_session
from app.api.berechtigungen.loeschung import carry_authorship_in_session
from app.api.berechtigungen.services import compose_fortgefuehrt, genehmigung_steht
from app.api.identitaet.lookup import RecordCollections
from app.api.identitaet.services import adresswechsel_einsehbar_verwehrt, eigene_sitze, ist_eigener_schiedsrichter
from app.api.kontakte.services import find_matching_slots, rows_seating, same_address
from app.api.outbox.schemas import (
    FLAddressChangeDiscardedData,
    FLAddressChangeEffectiveData,
    FLAddressChangeHinweisData,
    FLAddressChangeLinkData,
    FLOutboxLink,
    FLOutboxReference,
    FLOutboxState,
)
from app.api.outbox.services import SIGN_IN_ARTEN, OwedMail, enqueue_mails
from app.api.registrierungen.services import build_loeschung_registrierung_filter, registrierung_ist_bestaetigt
from app.api.schiedsrichter.services import build_self_referee_filter, vorname_of
from app.api.sperrliste.lookup import BanList, Saison, adressen_gesperrt
from app.api.spielbestaetigungen.services import (
    build_contact_reason_images_filter,
    build_contact_reasons_filter,
    contact_reason_image_edits,
    halter_of,
    seat_void_of,
)
from app.api.spieler.crud import another_pupil_holds
from app.api.spieler.services import build_self_pupil_filter
from app.api.teams.crud import void_moved_seats
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, erase_many_from_db, patch_many_in_db, patch_one_in_db, post_one_to_db
from app.core.exceptions import WriteRefusal
from app.core.journal import Journal, JournalLine
from app.core.recording import ERASED_ACTOR_MARKER, build_redaction_filter, log_stamp
from app.core.security import actor_pseudonym, erasure_journal_hash
from app.shared.folding import sign_in_identifier
from app.shared.schemas.literals import FLAddressChangeEndArt, FLAddressChangeViewableDenied, FLAddressChangeWay

_SPIELER_FIELDS: Final[Mapping[str, int]] = {"vorname": 1, "nachname": 1, "email": 1}
# The whole consent record: `ist_eigener_schiedsrichter` judges its stamp.
_SCHIEDSRICHTER_FIELDS: Final[Mapping[str, int]] = {"name": 1, "kontakt.email": 1, "einwilligung": 1}
_SITZ_FIELDS: Final[Mapping[str, int]] = {"saison_id": 1, "team_id": 1, "kontakte": 1, "confirmations": 1}
_REGISTRIERUNG_FIELDS: Final[Mapping[str, int]] = {"email": 1, "vorname": 1, "nachname": 1, "einwilligung": 1, "confirmation": 1}


@dataclass(frozen=True, kw_only=True)
class Bestand:
    """Everything an address holds as its person's own: what a change moves."""

    identifier: str
    spieler: Mapping[str, Any] | None
    schiedsrichter: Sequence[Mapping[str, Any]]
    sitze: Sequence[tuple[Mapping[str, Any], tuple[str, ...]]]
    bewerbung_seats: Sequence[tuple[Mapping[str, Any], tuple[str, ...]]]
    # Every registration, its pupil's confirmation or not: an open one left here, an admission would make a second person,
    # and a declined one an erasure of the new address would miss until its month is out.
    registrierungen: Sequence[Mapping[str, Any]]
    # The live grant, which moves with the rest once another administrator approved it.
    grant: Mapping[str, Any] | None

    @property
    def leer(self) -> bool:
        return not (self.spieler or self.schiedsrichter or self.sitze or self.bewerbung_seats or self.registrierungen or self.grant)

    @property
    def vorname(self) -> str:
        """Whom the notices greet: the first name the first record holding one stores, or none."""

        kandidaten = [
            *([] if self.spieler is None else [self.spieler.get("vorname")]),
            *(vorname_of(row.get("name")) for row in self.schiedsrichter),
            *((row.get("kontakte") or {}).get(slot, {}).get("vorname") for row, slots in self.sitze for slot in slots),
            *((row.get("kontakte") or {}).get(slot, {}).get("vorname") for row, slots in self.bewerbung_seats for slot in slots),
            *(row.get("vorname") for row in self.registrierungen),
        ]

        return next((str(name) for name in kandidaten if isinstance(name, str) and name), "")


async def live_grant_of(
    identifier: str, *, berechtigungen_collection: AsyncCollection, session: AsyncClientSession | None
) -> Mapping[str, Any] | None:
    """The grant this folded address holds, by `uniq_berechtigung_adresse`'s equality."""

    return await berechtigungen_collection.find_one({"adresse": identifier}, session=session)


async def read_the_bestand(
    identifier: str,
    *,
    records: RecordCollections,
    berechtigungen_collection: AsyncCollection,
    session: AsyncClientSession | None,
) -> Bestand:
    """Everything `identifier` holds as its person's own, read unbounded: a capped read would leave a record at the replaced address.

    `session` is the writing transaction's, so the effect moves what it judged; `None` for a read alone.
    """

    identifier = sign_in_identifier(identifier)
    spieler = await records.spieler_collection.find_one(build_self_pupil_filter(identifier), projection=dict(_SPIELER_FIELDS), session=session)
    referees = await aggregate_many_from_db(
        collection=records.schiedsrichter_collection,
        pipeline=[
            {"$match": build_self_referee_filter(identifier)},
            {"$project": dict(_SCHIEDSRICHTER_FIELDS)},
            {"$sort": {"_id": 1}},
        ],
        session=session,
    )
    seat_rows = await aggregate_many_from_db(
        collection=records.saison_teams_collection,
        pipeline=[{"$match": rows_seating(identifier)}, {"$project": dict(_SITZ_FIELDS)}, {"$sort": {"_id": 1}}],
        session=session,
    )
    # Every status: an accepted application keeps its seats, and the erasure of the new address reaches them only there.
    bewerbung_rows = await aggregate_many_from_db(
        collection=records.bewerbungen_collection,
        pipeline=[{"$match": rows_seating(identifier)}, {"$project": {"kontakte": 1, "confirmations": 1}}, {"$sort": {"_id": 1}}],
        session=session,
    )
    registrierungen = await aggregate_many_from_db(
        collection=records.registrierungen_collection,
        pipeline=[
            {"$match": build_loeschung_registrierung_filter(identifier)},
            {"$project": dict(_REGISTRIERUNG_FIELDS)},
            {"$sort": {"_id": 1}},
        ],
        session=session,
    )

    return Bestand(
        identifier=identifier,
        spieler=spieler,
        schiedsrichter=[row for row in referees if ist_eigener_schiedsrichter(row, identifier)],
        sitze=[(row, tuple(slots)) for row in seat_rows if (slots := eigene_sitze(row, identifier))],
        bewerbung_seats=[(row, tuple(slots)) for row in bewerbung_rows if (slots := eigene_sitze(row, identifier))],
        registrierungen=registrierungen,
        grant=await live_grant_of(identifier, berechtigungen_collection=berechtigungen_collection, session=session),
    )


@dataclass(frozen=True, kw_only=True)
class Belegung:
    """What `adresse_belegt` reads beyond the records: the grants, their open requests and the changes owing a carry."""

    berechtigungen_collection: AsyncCollection
    berechtigungen_antraege_collection: AsyncCollection
    adresswechsel_collection: AsyncCollection
    now: datetime


async def adresse_belegt(email: str, *, records: RecordCollections, belegung: Belegung, session: AsyncClientSession | None) -> bool:
    """Whether an entry names the new address, which refuses the change.

    Confirmed or not, never only what a change would move: each admits a sign-in there, now or once confirmed or granted.
    """

    folded = sign_in_identifier(email)
    reads: list[tuple[AsyncCollection, Mapping[str, Any]]] = [
        (records.spieler_collection, build_self_pupil_filter(folded)),
        (records.schiedsrichter_collection, build_self_referee_filter(folded)),
        (records.saison_teams_collection, rows_seating(folded)),
        (records.bewerbungen_collection, rows_seating(folded)),
        (records.registrierungen_collection, build_loeschung_registrierung_filter(folded)),
        # As stored, as the account sweep reads it: a row the comparison has not seen yet still keeps an account.
        (belegung.berechtigungen_collection, {"adresse": folded}),
        (belegung.berechtigungen_antraege_collection, {"adresse": folded, **build_offen_filter(belegung.now)}),
        # The account still standing there until its own carry moves it off.
        (belegung.adresswechsel_collection, build_owed_carry_filter([folded])),
    ]
    # One read at a time, as a session runs them: `$unionWith` would send one command, and no transaction takes it.
    for collection, db_filter in reads:
        if await collection.find_one(db_filter, {"_id": 1}, session=session) is not None:
            return True

    return False


def _redacting(fields: tuple[str, ...]) -> Callable[[Mapping[str, Any]], dict[str, None]]:
    def redacted(image: Mapping[str, Any]) -> dict[str, None]:
        return {field: None for field in fields if image.get(field) is not None}

    return redacted


async def end_the_change_in_session(
    *,
    adresswechsel_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    # The judgement: a change it matches not is a miss, `DocumentNotFoundError`, before any write.
    db_filter: Mapping[str, Any],
    art: FLAddressChangeEndArt,
    now: datetime,
    stamp: str,
    session: AsyncClientSession,
    # The address on file too, where its records are gone and no erasure's address pass follows.
    ohne_adresse: bool = False,
) -> Mapping[str, Any]:
    """End one live change, answering it as it stood: the one body every ending runs.

    Its images lose the unproved address and the reason; an effect's keep both, the log's account of the move.
    """

    stored = await patch_one_in_db(
        collection=adresswechsel_collection,
        db_filter={**db_filter, **LIVE_TERMS},
        update=compose_end_update(art=art, now=now),
        session=session,
        return_document=ReturnDocument.BEFORE,
    )

    # After the patch, so it reaches the image the patch filed. An effect keeps the new address, which the person's records
    # hold and their erasure finds, and drops the replaced one, which no record holds for an erasure to find.
    redacted = ("adresse",) if art == "effective" else ("email", "grund", *(("adresse",) if ohne_adresse else ()))
    await redact_images_in_session(
        aktionen_collection=aktionen_collection,
        db_filter=build_redaction_filter([(Collection.ADDRESS_CHANGES, [stored["_id"]])]),
        judge=_redacting(redacted),
        stamp=stamp,
        session=session,
    )

    return stored


EndingArt = Literal["adresswechsel_abgelehnt", "adresswechsel_gestoppt", "adresswechsel_verworfen", "adresswechsel_verworfen_mitgeteilt"]


def ending_line(*, art: EndingArt, neue: str, record_id: ObjectId, am: str, key: SecretStr) -> JournalLine:
    """A decline's, a stop's or a discard's line, so a restore does not bring the change back to act."""

    return JournalLine(
        person_hash=erasure_journal_hash(neue, key=key),
        art=art,
        collection=Collection.ADDRESS_CHANGES,
        record_id=record_id,
        am=am,
    )


def wirksam_line(*, record: Mapping[str, Any], now: datetime, key: SecretStr) -> JournalLine:
    """The effect's line, so a restore from a snapshot taken while the change stood is listed rather than silently undone.

    The replaced address's hash too, where a later erasure finds the records a snapshot from before the start holds.
    """

    return JournalLine(
        person_hash=erasure_journal_hash(str(record["email"]), key=key),
        art="adresswechsel_wirksam",
        collection=Collection.ADDRESS_CHANGES,
        record_id=record["_id"],
        am=log_stamp(now),
        before=erasure_journal_hash(str(record["adresse"]), key=key),
    )


async def start_the_change_in_session(
    *,
    record: Mapping[str, Any],
    adresswechsel_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    key: SecretStr,
    now: datetime,
    journal: Journal,
    session: AsyncClientSession,
) -> ObjectId:
    """End the address's live change as replaced, then insert the new one, answering its id.

    The replaced change is journalled as discarded: restored, a confirmed one would take effect unpressed.
    """

    stamp = log_stamp(now)
    replaced = await adresswechsel_collection.find_one(build_address_filter(str(record["adresse"])), {"email": 1}, session=session)
    if replaced is not None:
        await end_the_change_in_session(
            adresswechsel_collection=adresswechsel_collection,
            aktionen_collection=aktionen_collection,
            db_filter={"_id": replaced["_id"]},
            art="replaced",
            now=now,
            stamp=stamp,
            session=session,
        )
        journal.note(ending_line(art="adresswechsel_verworfen", neue=str(replaced["email"]), record_id=replaced["_id"], am=stamp, key=key))

    # Two starts on one address meet at `uniq_adresswechsel_adresse` as a write conflict, which the transaction retries.
    created = await post_one_to_db(collection=adresswechsel_collection, document=record, session=session)

    return created.inserted_id


# Why the effect is refused, in the order the link's view ranks its states.
FLAdresswechselUrsache = Literal["neue_gesperrt", "abgelaufen", "ersetzte_gesperrt", "vergeben", "nicht_gedeckt", "neue_berechtigt", "belegt"]


@dataclass(frozen=True, kw_only=True)
class Urteil:
    """What the effect's judgement found: a cause refusing it, nothing to move, or an approval still owed.

    A cause rather than its refusal, so the link's view and the pass read it without a check they never raise.
    """

    ursache: FLAdresswechselUrsache | None
    leer: bool
    wartet: bool
    # The approval given does not stand: its approver lost the grant, the tier or their standing since, so the change
    # waits on another (`app/api/berechtigungen/services.py :: genehmigung_steht`).
    widerrufen: bool = False


def _bezug(address_change_id: ObjectId) -> FLOutboxReference:
    return FLOutboxReference(collection=Collection.ADDRESS_CHANGES, id=address_change_id, seat=None)


async def lage_of_the_link(
    *, postausgang_collection: AsyncCollection, address_change_id: ObjectId, session: AsyncClientSession | None = None
) -> FLOutboxState | None:
    """What became of the new mailbox's last link mail, never the address on file's notice owed about the same change."""

    newest = await postausgang_collection.find_one(
        {**_bezug_filter(address_change_id), "art": "address_change_link"},
        {"stand": 1, "delivery": 1},
        sort=[("recorded_at", DESCENDING), ("_id", DESCENDING)],
        session=session,
    )

    return None if newest is None else FLOutboxState.model_validate(newest)


def _bezug_filter(address_change_id: ObjectId) -> dict[str, Any]:
    # Equality on the three keys of `outbox_reference` and its sort after them (`app/core/constraints.py :: SUPPORT_INDEXES`).
    return {"reference.collection": str(Collection.ADDRESS_CHANGES), "reference.id": address_change_id, "reference.seat": None}


async def owe_the_link_in_session(
    *,
    address_change_id: ObjectId,
    email: str,
    way: FLAddressChangeWay,
    valid_until: datetime,
    postausgang_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Owe the new mailbox its link, minted at the hand-out in place of any before it, in the caller's transaction.

    `email` as the record stores it: the hand-out mints only while the record still names it, so a change ended or
    replaced since mails nothing. Keyed by the write's instant, a re-send owing a mail of its own.
    """

    await enqueue_mails(
        outbox_collection=postausgang_collection,
        session=session,
        mails=[
            OwedMail(
                key=f"adresswechsel/{address_change_id}/link/{now.isoformat()}",
                an=email,
                data=FLAddressChangeLinkData(art="address_change_link", way=way, valid_until=valid_until),
                reference=_bezug(address_change_id),
                link=FLOutboxLink(paths=["token_hashes"], adressen=["email"], replaced=True),
            )
        ],
        now=now,
    )


async def owe_the_hinweis_in_session(
    *,
    address_change_id: ObjectId,
    adresse: str,
    way: FLAddressChangeWay,
    valid_until: datetime,
    vorname: str | None,
    postausgang_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Owe the address on file its notice of the change, with the stop link, minted beside any earlier hand-out's."""

    await enqueue_mails(
        outbox_collection=postausgang_collection,
        session=session,
        mails=[
            OwedMail(
                key=f"adresswechsel/{address_change_id}/hinweis",
                an=adresse,
                data=FLAddressChangeHinweisData(art="address_change_hinweis", way=way, valid_until=valid_until, vorname=vorname),
                reference=_bezug(address_change_id),
                link=FLOutboxLink(paths=["stop.token_hashes"], adressen=["adresse"], replaced=False),
            )
        ],
        now=now,
    )


async def owe_the_refusal_notice_in_session(
    record: Mapping[str, Any], *, postausgang_collection: AsyncCollection, now: datetime, session: AsyncClientSession
) -> None:
    """A confirmed change's notice that it did not take effect, owed in its end's transaction.

    Off the record as it stood before the end: never why, nor the address on file.
    """

    await enqueue_mails(
        outbox_collection=postausgang_collection,
        session=session,
        mails=[
            OwedMail(
                key=f"adresswechsel/{record['_id']}/discarded",
                an=str(record["email"]),
                data=FLAddressChangeDiscardedData(art="address_change_discarded"),
            )
        ],
        now=now,
    )


async def judge_the_effect_in_session(
    *,
    record: Mapping[str, Any],
    holdings: Bestand,
    records: RecordCollections,
    spieler_collection: AsyncCollection,
    berechtigungen_collection: AsyncCollection,
    berechtigungen_angekuendigt_collection: AsyncCollection,
    sperrliste: BanList,
    massgebliche_saison_id: Saison,
    belegung: Belegung,
    # The link's own deadline, judged second: a press on a lapsed link to a barred address names the ban.
    abgelaufen: bool,
    session: AsyncClientSession | None,
) -> Urteil:
    """Every judgement the effect makes, in the order the link's view ranks its states, read in `session`.

    The confirmation, the approval, the hourly pass and the link's view all ask it, so none of them parts on what refuses.
    """

    neue, alte = str(record["email"]), str(record["adresse"])
    gesperrt = await adressen_gesperrt(sperrliste, [neue, alte], massgebliche_saison_id=massgebliche_saison_id, session=session)
    erste: list[tuple[FLAdresswechselUrsache, bool]] = [
        ("neue_gesperrt", neue in gesperrt),
        ("abgelaufen", abgelaufen),
        ("ersetzte_gesperrt", alte in gesperrt),
    ]
    for ursache, gilt in erste:
        if gilt:
            return Urteil(ursache=ursache, leer=False, wartet=False)

    if holdings.leer:
        return Urteil(ursache=None, leer=True, wartet=False)

    if holdings.spieler is not None and await another_pupil_holds(
        spieler_collection=spieler_collection, identifier=sign_in_identifier(neue), spieler_id=holdings.spieler["_id"], session=session
    ):
        return Urteil(ursache="vergeben", leer=False, wartet=False)

    grant = holdings.grant
    genehmigung = record.get("approval")
    if grant is not None:
        if not deckt(genehmigung, grant.get("verwaltung")):
            return Urteil(ursache="nicht_gedeckt", leer=False, wartet=False)
        if await live_grant_of(sign_in_identifier(neue), berechtigungen_collection=berechtigungen_collection, session=session) is not None:
            return Urteil(ursache="neue_berechtigt", leer=False, wartet=False)

    # After the causes naming one kind of entry, so a press names the specific one; judged in the effect's own read, so
    # nothing reaches the new address between this judgement and the move.
    if await adresse_belegt(neue, records=records, belegung=belegung, session=session):
        return Urteil(ursache="belegt", leer=False, wartet=False)

    if grant is None:
        return Urteil(ursache=None, leer=False, wartet=False)

    assert isinstance(genehmigung, Mapping)
    if genehmigung.get("approved_at") is None:
        return Urteil(ursache=None, leer=False, wartet=True)

    # Judged again here rather than kept from the press: a revoke, a demotion, a ban or an erasure of the approver since
    # leaves no approval standing.
    von = genehmigung.get("approved_by")
    steht = genehmigung_steht(
        betroffen=alte,
        approval=genehmigung,
        grants=await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session),
        announced=await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session),
        barred=await adressen_gesperrt(sperrliste, [von], session=session) if isinstance(von, str) else set(),
    )

    return Urteil(ursache=None, leer=False, wartet=not steht, widerrufen=not steht)


def refusal_of(ursache: FLAdresswechselUrsache | None) -> WriteRefusal | None:
    """The refusal a press answers for the judgement's cause, where the link's view shows a state and the pass ends the change."""

    match ursache:
        case None:
            return None
        case "neue_gesperrt":
            return find_bestaetigung_gesperrt_refusal(barred=True)
        case "abgelaufen":
            return find_abgelaufen_refusal(abgelaufen=True)
        case "ersetzte_gesperrt":
            return find_ersetzte_gesperrt_refusal(barred=True)
        case "vergeben":
            return find_vergeben_refusal(vergeben=True)
        case "nicht_gedeckt":
            return find_nicht_gedeckt_refusal(gedeckt=False)
        case "neue_berechtigt":
            return find_neue_berechtigt_refusal(berechtigt=True)
        case "belegt":
            return find_belegt_refusal(belegt=True)


async def take_effect_in_session(
    *,
    record: Mapping[str, Any],
    records: RecordCollections,
    sperrliste: BanList,
    massgebliche_saison_id: Saison,
    adresswechsel_collection: AsyncCollection,
    spieler_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    spielbestaetigungen_collection: AsyncCollection,
    berechtigungen_collection: AsyncCollection,
    berechtigungen_angekuendigt_collection: AsyncCollection,
    postausgang_collection: AsyncCollection,
    berechtigungen_antraege_collection: AsyncCollection,
    einladungen_collection: AsyncCollection,
    sperrliste_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    key: SecretStr,
    now: datetime,
    journal: Journal,
    session: AsyncClientSession,
    # Whether a change finding nothing to move tells its new mailbox so: a confirmed one was told it waits on the effect,
    # the press's own page shows it instead.
    mitteilen: bool,
    abgelaufen: bool = False,
    # False for a confirmation that starts a waiting time: judged as the effect will be, and moving nothing yet.
    jetzt: bool = True,
) -> tuple[Urteil, bool]:
    """Judge the change and move it where nothing refuses it or is owed, answering whether it took effect.

    A change finding nothing to move ends discarded; a refusal, an owed approval and a waiting time write nothing
    (`Urteil.wartet`).
    """

    bestand = await read_the_bestand(
        str(record["adresse"]), records=records, berechtigungen_collection=berechtigungen_collection, session=session
    )
    urteil = await judge_the_effect_in_session(
        record=record,
        holdings=bestand,
        records=records,
        spieler_collection=spieler_collection,
        berechtigungen_collection=berechtigungen_collection,
        berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
        sperrliste=sperrliste,
        massgebliche_saison_id=massgebliche_saison_id,
        belegung=Belegung(
            berechtigungen_collection=berechtigungen_collection,
            berechtigungen_antraege_collection=berechtigungen_antraege_collection,
            adresswechsel_collection=adresswechsel_collection,
            now=now,
        ),
        abgelaufen=abgelaufen,
        session=session,
    )
    if urteil.widerrufen:
        # Taken off the record, so the administrators page offers the approval again and the pass finds it due nowhere.
        await patch_one_in_db(
            collection=adresswechsel_collection,
            db_filter={"_id": record["_id"], **LIVE_TERMS},
            update=compose_genehmigung_widerrufen_update(),
            session=session,
            return_document=ReturnDocument.BEFORE,
        )
    if urteil.ursache is not None or urteil.wartet:
        return urteil, False
    if not jetzt and not urteil.leer:
        return Urteil(ursache=None, leer=False, wartet=True), False

    stamp = log_stamp(now)
    if urteil.leer:
        await end_the_change_in_session(
            adresswechsel_collection=adresswechsel_collection,
            aktionen_collection=aktionen_collection,
            db_filter={"_id": record["_id"]},
            art="discarded",
            now=now,
            stamp=stamp,
            session=session,
        )
        if mitteilen:
            await owe_the_refusal_notice_in_session(record, postausgang_collection=postausgang_collection, now=now, session=session)
        # Journalled: what the address held may have gone after a snapshot a restore brings the change back from.
        journal.note(
            ending_line(
                art="adresswechsel_verworfen_mitgeteilt" if mitteilen else "adresswechsel_verworfen",
                neue=str(record["email"]),
                record_id=record["_id"],
                am=stamp,
                key=key,
            )
        )
        return urteil, False

    beendet = await move_the_address_in_session(
        record=record,
        holdings=bestand,
        sperrliste=sperrliste,
        adresswechsel_collection=adresswechsel_collection,
        spieler_collection=spieler_collection,
        schiedsrichter_collection=schiedsrichter_collection,
        saison_teams_collection=saison_teams_collection,
        bewerbungen_collection=bewerbungen_collection,
        registrierungen_collection=registrierungen_collection,
        spielbestaetigungen_collection=spielbestaetigungen_collection,
        berechtigungen_collection=berechtigungen_collection,
        berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
        postausgang_collection=postausgang_collection,
        berechtigungen_antraege_collection=berechtigungen_antraege_collection,
        einladungen_collection=einladungen_collection,
        sperrliste_collection=sperrliste_collection,
        aktionen_collection=aktionen_collection,
        key=key,
        now=now,
        session=session,
    )
    # A line for each request the effect ended, so a restore from before it does not bring one back.
    for antrag in beendet:
        journal.note(antrag_line(antrag=antrag, art="antrag_beendet", am=stamp, key=key))
    journal.note(wirksam_line(record=record, now=now, key=key))

    return urteil, True


async def move_the_address_in_session(
    *,
    record: Mapping[str, Any],
    holdings: Bestand,
    sperrliste: BanList,
    adresswechsel_collection: AsyncCollection,
    spieler_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    spielbestaetigungen_collection: AsyncCollection,
    berechtigungen_collection: AsyncCollection,
    berechtigungen_angekuendigt_collection: AsyncCollection,
    postausgang_collection: AsyncCollection,
    berechtigungen_antraege_collection: AsyncCollection,
    einladungen_collection: AsyncCollection,
    sperrliste_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    key: SecretStr,
    now: datetime,
    session: AsyncClientSession,
) -> list[Mapping[str, Any]]:
    """Move everything `holdings` holds to the change's address in the caller's transaction, then end it as taken effect.

    One patch per row, never a fan-out, so each row's own history keeps the write that moved it.
    """

    neue, stamp = str(record["email"]), log_stamp(now)

    if holdings.spieler is not None:
        # Folded as every start stores it, and again here: the sign-in seam joins on this field by equality.
        await patch_one_in_db(
            collection=spieler_collection,
            db_filter={"_id": holdings.spieler["_id"]},
            update={"$set": {"email": sign_in_identifier(neue)}},
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

    for row in holdings.schiedsrichter:
        await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": row["_id"]},
            update={"$set": {"kontakt.email": neue}},
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

    voids = []
    for row, slots in holdings.sitze:
        await patch_one_in_db(
            collection=saison_teams_collection,
            db_filter={"_id": row["_id"]},
            update=_seat_move(row, slots, neue),
            session=session,
            return_document=ReturnDocument.BEFORE,
        )
        kontakte = row.get("kontakte") or {}
        moved = {**kontakte, **{slot: {**kontakte[slot], "email": neue} for slot in slots}}
        voids.append(seat_void_of(saison_id=row["saison_id"], team_id=row["team_id"], stored_kontakte=kontakte, kontakte=moved))
    # The match confirmations' links went to the replaced mailbox, so they die here and the hourly pass mints the
    # moved seats fresh ones.
    await void_moved_seats(spielbestaetigungen_collection=spielbestaetigungen_collection, voids=voids, session=session)

    for row, slots in holdings.bewerbung_seats:
        await patch_one_in_db(
            collection=bewerbungen_collection,
            db_filter={"_id": row["_id"]},
            update=_seat_move(row, slots, neue),
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

    for row in holdings.registrierungen:
        await patch_one_in_db(
            collection=registrierungen_collection,
            db_filter={"_id": row["_id"]},
            update=_registrierung_move(row, neue),
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

    if holdings.grant is not None:
        von = (record.get("approval") or {}).get("approved_by")
        # The judgement refuses a grant its approval does not cover; this guards the replay, which judges differently.
        if not isinstance(von, str):
            raise RuntimeError("a grant moves only on an approval naming its approver")
        await _move_the_grant(
            holdings.grant,
            neue=sign_in_identifier(neue),
            von=von,
            sperrliste=sperrliste,
            berechtigungen_collection=berechtigungen_collection,
            berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
            postausgang_collection=postausgang_collection,
            now=now,
            session=session,
        )

    await _rekey_the_person(
        holdings.identifier,
        neue,
        spielbestaetigungen_collection=spielbestaetigungen_collection,
        aktionen_collection=aktionen_collection,
        key=key,
        stamp=stamp,
        session=session,
    )
    await end_the_change_in_session(
        adresswechsel_collection=adresswechsel_collection,
        aktionen_collection=aktionen_collection,
        db_filter={"_id": record["_id"]},
        art="effective",
        now=now,
        stamp=stamp,
        session=session,
    )

    # Before the images' carry below, which takes the replaced address out of the image an ended request keeps.
    beendet = await end_the_antraege_about_in_session(
        berechtigungen_antraege_collection=berechtigungen_antraege_collection,
        postausgang_collection=postausgang_collection,
        adresse=holdings.identifier,
        now=now,
        session=session,
    )

    # After every write above, so it reaches the images they filed: a record the effect leaves naming the replaced address
    # by address alone would outlive the person's erasure at the new one.
    alt, neu = holdings.identifier, sign_in_identifier(neue)
    # Who made a record is the person, whatever their address or grant, a revoked grant's records and a seat holder's
    # decisions included: the starter of a change stays excluded from approving it.
    await carry_authorship_in_session(
        berechtigungen_collection=berechtigungen_collection,
        berechtigungen_antraege_collection=berechtigungen_antraege_collection,
        bewerbungen_collection=bewerbungen_collection,
        registrierungen_collection=registrierungen_collection,
        einladungen_collection=einladungen_collection,
        sperrliste_collection=sperrliste_collection,
        alt=alt,
        neue=neu,
        session=session,
    )
    await _reattribute_the_changes(adresswechsel_collection, alt, neu, session=session)
    await reattribute_administrator_in_session(aktionen_collection=aktionen_collection, identifier=alt, value=neu, session=session)
    # A seat or referee row left before the change is in no document an erasure at the new address reads, so its images
    # follow the person; one standing at the replaced address as nobody's proven own keeps it.
    await carry_the_replaced_address_in_images(
        aktionen_collection=aktionen_collection,
        alt=alt,
        neue=neu,
        staying=await _seats_staying_at(alt, collections=(saison_teams_collection, bewerbungen_collection), session=session),
        referees_held={
            row["_id"]
            for row in await aggregate_many_from_db(
                collection=schiedsrichter_collection,
                pipeline=[{"$match": build_self_referee_filter(alt, neu)}, {"$project": {"_id": 1}}],
                session=session,
            )
        },
        stamp=stamp,
        session=session,
    )
    # An earlier effect's carry still owed takes its account to where the person is now, and an erasure there finds it.
    # Read, then written by id: the log keeps a fan-out's filter as text, address and all.
    owed = await aggregate_many_from_db(
        collection=adresswechsel_collection, pipeline=[{"$match": {"move.nach": alt}}, {"$project": {"_id": 1}}], session=session
    )
    if owed:
        await patch_many_in_db(
            collection=adresswechsel_collection,
            db_filter={"_id": {"$in": [row["_id"] for row in owed]}},
            update={"$set": {"move.nach": neu}},
            session=session,
        )
    await _carry_the_mail(postausgang_collection, alt, neu, session=session)
    # The journal's pair on the tombstone, so an erasure at the new address finds the mail the replaced one still holds.
    # A change that waited carries no account: whatever its old mailbox's holder enrolled meanwhile would follow. The carry
    # is owed on the ended record itself, in this transaction, so a commit whose answer was lost still owes it.
    await patch_many_in_db(
        collection=adresswechsel_collection,
        db_filter={"_id": record["_id"]},
        update={
            "$set": {
                "moved": {
                    "person_hash": erasure_journal_hash(neu, key=key),
                    "before": erasure_journal_hash(alt, key=key),
                },
                **({} if record["way"] == "waiting_period" else {"move": {"von": alt, "nach": neu}}),
            }
        },
        session=session,
    )
    await enqueue_mails(
        outbox_collection=postausgang_collection,
        session=session,
        mails=[
            OwedMail(
                key=f"adresswechsel/{record['_id']}/effective",
                an=alt,
                # Greeting nobody on the lost-mailbox way: that mailbox may have passed to a stranger.
                data=FLAddressChangeEffectiveData(
                    art="address_change_effective", instant=now, vorname=None if record["way"] == "waiting_period" else holdings.vorname
                ),
            )
        ],
        now=now,
    )

    # The requests for a grant it ended, each journalled by the caller as a refusal.
    return beendet


async def _carry_the_mail(postausgang_collection: AsyncCollection, alt: str, neu: str, *, session: AsyncClientSession) -> None:
    """The person's mail follows them: what is owed the replaced address goes to the new one, and what was sent there goes.

    A sent mail's delivery state describes the replaced mailbox, which on the lost-mailbox way may be a stranger's. The
    sign-in library's mails stay where they were owed, each tied to the sign-in it was asked from. Matched on the
    sign-in fold, a recipient being stored as its mail was owed; then written by id.
    """

    rows = await aggregate_many_from_db(
        collection=postausgang_collection,
        pipeline=[{"$match": {"art": {"$nin": sorted(SIGN_IN_ARTEN)}, "an": same_address(alt)}}, {"$project": {"an": 1, "stand": 1}}],
        session=session,
    )
    held = [row for row in rows if sign_in_identifier(str(row["an"])) == alt]
    if offen := [row["_id"] for row in held if row["stand"] == "open"]:
        await patch_many_in_db(
            collection=postausgang_collection, db_filter={"_id": {"$in": offen}}, update={"$set": {"an": neu}}, session=session
        )
    if gesendet := [row["_id"] for row in held if row["stand"] != "open"]:
        await erase_many_from_db(collection=postausgang_collection, db_filter={"_id": {"$in": gesendet}}, session=session)


async def _seats_staying_at(identifier: str, *, collections: Sequence[AsyncCollection], session: AsyncClientSession) -> set[tuple[Any, str]]:
    """Each document and slot seating this folded address, read after the effect moved the person's own seats."""

    staying: set[tuple[Any, str]] = set()
    for collection in collections:
        rows = await aggregate_many_from_db(
            collection=collection, pipeline=[{"$match": rows_seating(identifier)}, {"$project": {"kontakte": 1}}], session=session
        )
        staying |= {(row["_id"], slot) for row in rows for slot in find_matching_slots(row, identifier)}

    return staying


async def _move_the_grant(
    grant: Mapping[str, Any],
    *,
    neue: str,
    von: str,
    sperrliste: BanList,
    berechtigungen_collection: AsyncCollection,
    berechtigungen_angekuendigt_collection: AsyncCollection,
    postausgang_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Revoked at the replaced address and granted at the new by the approver, as the administrators page does both.

    Granted now, never the old row repointed: a session signed in before it holds none of it.
    """

    announced = await aggregate_many_from_db(
        collection=berechtigungen_angekuendigt_collection, pipeline=[{"$match": {"_id": grant["_id"]}}], session=session
    )
    gesperrt = await adressen_gesperrt(sperrliste, [von], session=session)
    await revoke_in_session(
        grant=grant,
        announced=announced,
        entzogen_von=von,
        barred=gesperrt,
        berechtigungen_collection=berechtigungen_collection,
        berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
        postausgang_collection=postausgang_collection,
        now=now,
        session=session,
    )
    await grant_in_session(
        adresse=neue,
        verwaltung=str(grant["verwaltung"]),
        granted_by=von,
        barred=gesperrt,
        berechtigungen_collection=berechtigungen_collection,
        berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
        postausgang_collection=postausgang_collection,
        now=now,
        session=session,
        # The four-eyes rule dates the person, not the mailbox.
        fortgefuehrt=compose_fortgefuehrt(grant, announced[0] if announced else None),
    )


async def _rekey_the_person(
    alt: str,
    neue: str,
    *,
    spielbestaetigungen_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    key: SecretStr,
    stamp: str,
    session: AsyncClientSession,
) -> None:
    """The digests naming the person by the replaced address, re-keyed rather than recorded, so an erasure of the new one reaches them.

    Kept on a record instead, every erasure step would have to read them.
    """

    await patch_many_in_db(
        collection=aktionen_collection,
        db_filter={"actor.pseudonym": actor_pseudonym(alt, key=key)},
        update={"$set": {"actor.pseudonym": actor_pseudonym(neue, key=key)}},
        session=session,
    )

    vorher, nachher = halter_of(alt, key=key), halter_of(neue, key=key)
    answered = await aggregate_many_from_db(
        collection=spielbestaetigungen_collection,
        pipeline=[{"$match": build_contact_reasons_filter([vorher])}, {"$project": {"saison_id": 1}}],
        session=session,
    )
    if answered:
        await patch_many_in_db(
            collection=spielbestaetigungen_collection,
            # Ids and their seasons alone, never the digest: the log keeps a fan-out's filter as text.
            db_filter={"saison_id": {"$in": sorted({row["saison_id"] for row in answered})}, "_id": {"$in": [row["_id"] for row in answered]}},
            update={"$set": {"antwort.von.halter": nachher}},
            session=session,
        )
    await redact_images_in_session(
        aktionen_collection=aktionen_collection,
        db_filter=build_contact_reason_images_filter([vorher]),
        judge=lambda image: {"antwort.von.halter": nachher} if contact_reason_image_edits(image, [vorher]) else {},
        stamp=stamp,
        session=session,
    )


def _seat_move(row: Mapping[str, Any], slots: Sequence[str], neue: str) -> dict[str, Any]:
    """The seats' address."""

    return {"$set": {f"kontakte.{slot}.email": neue for slot in slots}}


def _registrierung_move(row: Mapping[str, Any], neue: str) -> dict[str, Any]:
    """The registration's address; an unanswered one's live links die, so only a link reaching the new mailbox confirms it."""

    update: dict[str, Any] = {"$set": {"email": neue}}
    if not isinstance(row.get("confirmation"), Mapping):
        return update

    if not registrierung_ist_bestaetigt(einwilligung=row.get("einwilligung")):
        # Every link dies and the reminder is owed again: it alone mints the next link, to the moved address.
        update["$set"] |= {"confirmation.token_hashes": [], "confirmation.reminded_at": None}

    return update


# --- The ERASURE's reach: a change naming the erased address ends, and an administrator it names takes the marker.


def build_loeschung_adresswechsel_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every live change whose address on file, or whose new address, is this one, each stored folded."""

    folded = sign_in_identifier(identifier)

    # Each clause its index's, the live terms inside each: beside the `$or` they leave the planner no indexed plan, and it
    # scans every tombstone. The key's type stated for `build_address_filter`'s reason.
    return [
        {"$match": {"$or": [build_address_filter(folded), {"email": folded, **LIVE_TERMS}]}},
        {"$project": {"adresse": 1, "email": 1, "way": 1, "released_at": 1}},
        {"$sort": {"_id": 1}},
    ]


async def verwehrte_adressen(
    adressen: Iterable[str],
    *,
    akteur: str,
    auth_time: int,
    berechtigungen_collection: AsyncCollection,
    berechtigungen_angekuendigt_collection: AsyncCollection,
    session: AsyncClientSession | None,
) -> dict[str, FLAddressChangeViewableDenied]:
    """Which of these folded addresses' changes the address tool refuses this administrator, and why; one absent opens.

    Judged by `app/api/identitaet/services.py :: adresswechsel_einsehbar_verwehrt`; the grants are read only where an
    address is asked, most reads serving no change.
    """

    gefragt = set(adressen)
    if not gefragt:
        return {}
    grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
    announced = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)

    return {
        adresse: grund
        for adresse in gefragt
        if (grund := adresswechsel_einsehbar_verwehrt(adresse, akteur=akteur, auth_time=auth_time, grants=grants, announced=announced))
        is not None
    }


def others_naming(rows: Sequence[Mapping[str, Any]], identifier: str) -> list[Mapping[str, Any]]:
    """The changes of other addresses naming this one as their new address: the previews' rows, the address's own being its own."""

    return [row for row in rows if row.get("adresse") != identifier]


def known_to_the_new_mailbox(rows: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """The ones whose link was owed the new mailbox: a request awaiting approval has none."""

    return [row for row in rows if row.get("way") != "release" or row.get("released_at") is not None]


_GENEHMIGUNG_AKTEURE: Final = ("approval.started_by", "approval.approved_by")


async def end_the_address_changes_in_session(
    *,
    adresswechsel_collection: AsyncCollection,
    postausgang_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    identifier: str,
    # The subject's rows, read before the erasure's first write.
    rows: Sequence[Mapping[str, Any]],
    now: datetime,
    stamp: str,
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one.
    session: AsyncClientSession,
) -> int:
    """End every change naming the erased address, unjournalled, and give the marker where it started or approved one.

    Each change's mails go with it, owed or sent: its link went to the person's other mailbox, or to theirs from another's
    change. An erasure's line is the erasure's own: replayed, the erasure ends them again.
    """

    if rows:
        await erase_many_from_db(
            collection=postausgang_collection,
            db_filter={
                "reference.collection": str(Collection.ADDRESS_CHANGES),
                "reference.id": {"$in": [row["_id"] for row in rows]},
                "reference.seat": None,
            },
            session=session,
        )

    for row in rows:
        await end_the_change_in_session(
            adresswechsel_collection=adresswechsel_collection,
            aktionen_collection=aktionen_collection,
            db_filter={"_id": row["_id"]},
            art="discarded",
            now=now,
            stamp=stamp,
            session=session,
        )

    # Read after the endings, which took the approval off every change they ended.
    await _reattribute_the_changes(adresswechsel_collection, identifier, ERASED_ACTOR_MARKER, session=session)

    # A carry still owed off or onto the erased address goes: the erasure takes the account it would move, or the address
    # it would move one to. By id, as every write here.
    owed = await aggregate_many_from_db(
        collection=adresswechsel_collection,
        pipeline=[{"$match": {"$or": [{"move.von": identifier}, {"move.nach": identifier}]}}, {"$project": {"_id": 1}}],
        session=session,
    )
    if owed:
        await patch_many_in_db(
            collection=adresswechsel_collection,
            db_filter={"_id": {"$in": [row["_id"] for row in owed]}},
            update={"$unset": {"move": ""}},
            session=session,
        )

    return len(rows)


async def _reattribute_the_changes(
    adresswechsel_collection: AsyncCollection, identifier: str, value: str, *, session: AsyncClientSession
) -> None:
    """Put `value` where this folded administrator started or approved a live change: the erasure's marker, or their new address.

    Read, then written by id: the log keeps a fan-out's filter as text, address and all.
    """

    for path in _GENEHMIGUNG_AKTEURE:
        # Folded, as `app/core/security.py :: bind_actor` stores every administrator's address.
        named = await aggregate_many_from_db(
            collection=adresswechsel_collection,
            pipeline=[{"$match": {**LIVE_TERMS, path: sign_in_identifier(identifier)}}, {"$project": {"_id": 1}}],
            session=session,
        )
        if named:
            await patch_many_in_db(
                collection=adresswechsel_collection,
                db_filter={"_id": {"$in": [row["_id"] for row in named]}},
                update={"$set": {path: value}},
                session=session,
            )


async def end_an_emptied_change_in_session(
    *,
    adresswechsel_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    berechtigungen_collection: AsyncCollection,
    records: RecordCollections,
    identifier: str,
    now: datetime,
    stamp: str,
    session: AsyncClientSession,
) -> int:
    """End the address's live change where the pupil's erasure left the address holding nothing for it to move.

    The season's erasure takes the pupil alone, so a change standing for the address's other records stays.
    """

    live = await adresswechsel_collection.find_one(build_address_filter(identifier), {"_id": 1}, session=session)
    if live is None:
        return 0

    bestand = await read_the_bestand(identifier, records=records, berechtigungen_collection=berechtigungen_collection, session=session)
    if not bestand.leer:
        return 0

    await end_the_change_in_session(
        adresswechsel_collection=adresswechsel_collection,
        aktionen_collection=aktionen_collection,
        db_filter={"_id": live["_id"]},
        art="discarded",
        now=now,
        stamp=stamp,
        session=session,
        ohne_adresse=True,
    )

    return 1
