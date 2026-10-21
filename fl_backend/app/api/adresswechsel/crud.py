"""
API · an address change's reads and writes: what the address holds, the start, the effect and every ending

Every route, the hourly pass, the erasure and the restore's replay start, judge, move and end a change through these
functions, so no two of them part on what a change moves or what its end leaves behind.

Invariants:
- The effect moves everything the address holds in its caller's transaction, a grant included, and nothing else.
- Every end takes the record's addresses and reason out of it; every end but the effect's takes them out of its log images.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final, Literal

from bson import ObjectId
from pydantic import SecretStr
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.adresswechsel.services import (
    LIVE_TERMS,
    FLAdresswechselEndeArt,
    build_address_filter,
    compose_end_update,
    compose_genehmigung_widerrufen_update,
    compose_postausgang,
    deckt,
    find_abgelaufen_refusal,
    find_bestaetigung_gesperrt_refusal,
    find_ersetzte_gesperrt_refusal,
    find_neue_berechtigt_refusal,
    find_nicht_gedeckt_refusal,
    find_vergeben_refusal,
)
from app.api.aktionen.crud import (
    carry_the_replaced_address_in_images,
    carry_the_replaced_address_in_seat_images,
    reattribute_administrator_in_session,
    redact_images_in_session,
)
from app.api.aktionen.services import IMAGE_ADDRESSES
from app.api.berechtigungen.antraege import abgelehnt_line, end_the_antraege_about_in_session
from app.api.berechtigungen.crud import grant_in_session, read_berechtigungen, read_the_announced, revoke_in_session
from app.api.berechtigungen.erasure import carry_authorship_in_session
from app.api.berechtigungen.services import genehmigung_steht, lebendige_adresse
from app.api.bewerbungen.services import mint_token
from app.api.identitaet.lookup import RecordCollections
from app.api.identitaet.services import eigene_sitze, ist_eigener_schiedsrichter, namen_aus
from app.api.kontakte.services import find_matching_slots, rows_seating
from app.api.registrierungen.services import build_erasure_registrierung_filter, registrierung_ist_bestaetigt
from app.api.schiedsrichter.services import build_selbst_referee_filter, vorname_of
from app.api.sperrliste.lookup import BanList, Saison, adressen_gesperrt
from app.api.spielbestaetigungen.services import (
    build_contact_reason_images_filter,
    build_contact_reasons_filter,
    contact_reason_image_edits,
    halter_of,
    seat_void_of,
)
from app.api.spieler.crud import another_pupil_holds
from app.api.spieler.services import build_selbst_pupil_filter
from app.api.teams.crud import void_moved_seats
from app.core.adressanker import anchor_the_addresses
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, erase_many_from_db, patch_many_in_db, patch_one_in_db, post_one_to_db
from app.core.drosselung import carry_counts_in_session
from app.core.exceptions import WriteRefusal
from app.core.journal import Journal, JournalLine
from app.core.recording import ERASED_ACTOR_MARKER, build_redaction_filter, log_stamp
from app.core.security import akteur_pseudonym, loeschung_journal_hash
from app.shared.folding import sign_in_identifier

_SPIELER_FIELDS: Final[Mapping[str, int]] = {"vorname": 1, "nachname": 1, "email": 1}
# The whole consent record: `ist_eigener_schiedsrichter` judges its stamp.
_SCHIEDSRICHTER_FIELDS: Final[Mapping[str, int]] = {"name": 1, "kontakt.email": 1, "einwilligung": 1}
_SITZ_FIELDS: Final[Mapping[str, int]] = {"saison_id": 1, "team_id": 1, "kontakte": 1, "bestaetigungen": 1}
_REGISTRIERUNG_FIELDS: Final[Mapping[str, int]] = {"email": 1, "vorname": 1, "nachname": 1, "einwilligung": 1, "bestaetigung": 1}


@dataclass(frozen=True, kw_only=True)
class Bestand:
    """Everything an address holds as its person's own: what a change moves (`docs/backend/spec.md :: I793`)."""

    identifier: str
    spieler: Mapping[str, Any] | None
    schiedsrichter: Sequence[Mapping[str, Any]]
    sitze: Sequence[tuple[Mapping[str, Any], tuple[str, ...]]]
    bewerbungssitze: Sequence[tuple[Mapping[str, Any], tuple[str, ...]]]
    # Every registration, its pupil's confirmation or not: an open one left here, an admission would make a second person,
    # and a declined one an erasure of the new address would miss until its month is out.
    registrierungen: Sequence[Mapping[str, Any]]
    # The live grant, which moves with the rest once another administrator approved it.
    berechtigung: Mapping[str, Any] | None

    @property
    def leer(self) -> bool:
        return not (self.spieler or self.schiedsrichter or self.sitze or self.bewerbungssitze or self.registrierungen or self.berechtigung)

    @property
    def vorname(self) -> str:
        """Whom the notices greet: the first name the first record holding one stores, or none."""

        kandidaten = [
            *([] if self.spieler is None else [self.spieler.get("vorname")]),
            *(vorname_of(row.get("name")) for row in self.schiedsrichter),
            *((row.get("kontakte") or {}).get(slot, {}).get("vorname") for row, slots in self.sitze for slot in slots),
            *((row.get("kontakte") or {}).get(slot, {}).get("vorname") for row, slots in self.bewerbungssitze for slot in slots),
            *(row.get("vorname") for row in self.registrierungen),
        ]

        return next((str(name) for name in kandidaten if isinstance(name, str) and name), "")

    def namen(self) -> frozenset[str]:
        """Every name the moved records hold, which an administrator's reason may not name (`holds_a_name`)."""

        fields = [
            *([] if self.spieler is None else [self.spieler.get("vorname"), self.spieler.get("nachname")]),
            *(row.get("name") for row in self.schiedsrichter),
            *(
                (row.get("kontakte") or {}).get(slot, {}).get(part)
                for row, slots in (*self.sitze, *self.bewerbungssitze)
                for slot in slots
                for part in ("vorname", "nachname")
            ),
            *(row.get(part) for row in self.registrierungen for part in ("vorname", "nachname")),
        ]

        return namen_aus(fields)


async def live_grant_of(
    identifier: str, *, berechtigungen_collection: AsyncCollection, session: AsyncClientSession | None
) -> Mapping[str, Any] | None:
    """The live grant this folded address holds, by `uniq_berechtigung_adresse`'s equality; a dead row admits nobody and moves with nothing."""

    row = await berechtigungen_collection.find_one({"adresse": identifier}, session=session)

    return row if row is not None and lebendige_adresse(row) is not None else None


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
    spieler = await records.spieler_collection.find_one(
        build_selbst_pupil_filter(identifier), projection=dict(_SPIELER_FIELDS), session=session
    )
    referees = await aggregate_many_from_db(
        collection=records.schiedsrichter_collection,
        pipeline=[
            {"$match": build_selbst_referee_filter(identifier)},
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
        pipeline=[{"$match": rows_seating(identifier)}, {"$project": {"kontakte": 1, "bestaetigungen": 1}}, {"$sort": {"_id": 1}}],
        session=session,
    )
    registrierungen = await aggregate_many_from_db(
        collection=records.registrierungen_collection,
        pipeline=[{"$match": build_erasure_registrierung_filter(identifier)}, {"$project": dict(_REGISTRIERUNG_FIELDS)}, {"$sort": {"_id": 1}}],
        session=session,
    )

    return Bestand(
        identifier=identifier,
        spieler=spieler,
        schiedsrichter=[row for row in referees if ist_eigener_schiedsrichter(row, identifier)],
        sitze=[(row, tuple(slots)) for row in seat_rows if (slots := eigene_sitze(row, identifier))],
        bewerbungssitze=[(row, tuple(slots)) for row in bewerbung_rows if (slots := eigene_sitze(row, identifier))],
        registrierungen=registrierungen,
        berechtigung=await live_grant_of(identifier, berechtigungen_collection=berechtigungen_collection, session=session),
    )


async def adresse_belegt(
    email: str, *, records: RecordCollections, berechtigungen_collection: AsyncCollection, session: AsyncClientSession | None
) -> bool:
    """Whether a new address holds records of its own, which an effect joins to the ones it moves.

    The start warns of it; an effect, reading it before its move, carries no sign-in account onto them.
    """

    bestand = await read_the_bestand(email, records=records, berechtigungen_collection=berechtigungen_collection, session=session)

    return not bestand.leer


def _redacting(fields: tuple[str, ...]) -> Callable[[Mapping[str, Any]], dict[str, None]]:
    def redacted(image: Mapping[str, Any]) -> dict[str, None]:
        return {field: None for field in fields if image.get(field) is not None}

    return redacted


async def end_the_change_in_session(
    *,
    adresswechsel_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    # The judgement: a change it matches not is a miss, `DocumentNotFoundException`, before any write.
    db_filter: Mapping[str, Any],
    art: FLAdresswechselEndeArt,
    now: datetime,
    stamp: str,
    session: AsyncClientSession,
    # The address on file too, where its records are gone and no erasure's address pass follows.
    ohne_adresse: bool = False,
) -> Mapping[str, Any]:
    """End one live change, answering it as it stood: the one body every ending runs (`docs/backend/spec.md :: I704`, `:: I816`).

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
    redacted = ("adresse",) if art == "wirksam" else ("email", "grund", *(("adresse",) if ohne_adresse else ()))
    await redact_images_in_session(
        aktionen_collection=aktionen_collection,
        db_filter=build_redaction_filter([(Collection.ADRESSWECHSEL, [stored["_id"]])]),
        judge=_redacting(redacted),
        stamp=stamp,
        session=session,
    )

    return stored


EndingArt = Literal["adresswechsel_abgelehnt", "adresswechsel_gestoppt", "adresswechsel_verworfen"]


def ending_line(*, art: EndingArt, neue: str, record_id: ObjectId, am: str, schluessel: SecretStr) -> JournalLine:
    """A decline's, a stop's or a discard's line, so a restore does not bring the change back to act (`docs/backend/spec.md :: I706`)."""

    return JournalLine(
        person_hash=loeschung_journal_hash(neue, schluessel=schluessel),
        art=art,
        collection=Collection.ADRESSWECHSEL,
        record_id=record_id,
        am=am,
    )


def wirksam_line(*, record: Mapping[str, Any], now: datetime, schluessel: SecretStr) -> JournalLine:
    """The effect's line, so a restore from a snapshot taken while the change stood is listed rather than silently undone.

    The replaced address's hash too, where a later erasure finds the records a snapshot from before the start holds.
    """

    return JournalLine(
        person_hash=loeschung_journal_hash(str(record["email"]), schluessel=schluessel),
        art="adresswechsel_wirksam",
        collection=Collection.ADRESSWECHSEL,
        record_id=record["_id"],
        am=log_stamp(now),
        zuvor=loeschung_journal_hash(str(record["adresse"]), schluessel=schluessel),
    )


async def start_the_change_in_session(
    *,
    record: Mapping[str, Any],
    adresswechsel_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    adressanker_collection: AsyncCollection,
    schluessel: SecretStr,
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
            art="ersetzt",
            now=now,
            stamp=stamp,
            session=session,
        )
        journal.note(
            ending_line(art="adresswechsel_verworfen", neue=str(replaced["email"]), record_id=replaced["_id"], am=stamp, schluessel=schluessel)
        )

    # Two starts on one address meet at `uniq_adresswechsel_adresse` as a write conflict, which the transaction retries.
    created = await post_one_to_db(collection=adresswechsel_collection, document=record, session=session)
    # The new address enters here, which an erasure of it running now never read; the one on file is stored on the record
    # (`docs/backend/spec.md :: I719`).
    await anchor_the_addresses(
        [str(record["email"]), str(record["adresse"])], adressanker_collection=adressanker_collection, schluessel=schluessel, session=session
    )

    return created.inserted_id


# Why the effect is refused, in the order the link's view ranks its states.
FLAdresswechselUrsache = Literal["neue_gesperrt", "abgelaufen", "ersetzte_gesperrt", "vergeben", "nicht_gedeckt", "neue_berechtigt"]


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


async def judge_the_effect_in_session(
    *,
    record: Mapping[str, Any],
    bestand: Bestand,
    spieler_collection: AsyncCollection,
    berechtigungen_collection: AsyncCollection,
    berechtigungen_angekuendigt_collection: AsyncCollection,
    sperrliste: BanList,
    massgebliche_saison_id: Saison,
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

    if bestand.leer:
        return Urteil(ursache=None, leer=True, wartet=False)

    if bestand.spieler is not None and await another_pupil_holds(
        spieler_collection=spieler_collection, identifier=sign_in_identifier(neue), spieler_id=bestand.spieler["_id"], session=session
    ):
        return Urteil(ursache="vergeben", leer=False, wartet=False)

    grant = bestand.berechtigung
    if grant is None:
        return Urteil(ursache=None, leer=False, wartet=False)

    genehmigung = record.get("genehmigung")
    if not deckt(genehmigung, grant.get("verwaltung")):
        return Urteil(ursache="nicht_gedeckt", leer=False, wartet=False)
    if await live_grant_of(sign_in_identifier(neue), berechtigungen_collection=berechtigungen_collection, session=session) is not None:
        return Urteil(ursache="neue_berechtigt", leer=False, wartet=False)

    assert isinstance(genehmigung, Mapping)
    if genehmigung.get("genehmigt_am") is None:
        return Urteil(ursache=None, leer=False, wartet=True)

    # Judged again here rather than kept from the press: a revoke, a demotion, a ban or an erasure of the approver since
    # leaves no approval standing (`docs/backend/spec.md :: I844`).
    von = genehmigung.get("genehmigt_von")
    steht = genehmigung_steht(
        betroffen=alte,
        genehmigung=genehmigung,
        grants=await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session),
        announced=await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session),
        gesperrt=await adressen_gesperrt(sperrliste, [von], session=session) if isinstance(von, str) else set(),
    )

    return Urteil(ursache=None, leer=False, wartet=not steht, widerrufen=not steht)


def refusal_of(ursache: FLAdresswechselUrsache | None) -> WriteRefusal | None:
    """The refusal a press answers for the judgement's cause, where the link's view shows a state and the pass ends the change."""

    match ursache:
        case None:
            return None
        case "neue_gesperrt":
            return find_bestaetigung_gesperrt_refusal(gesperrt=True)
        case "abgelaufen":
            return find_abgelaufen_refusal(abgelaufen=True)
        case "ersetzte_gesperrt":
            return find_ersetzte_gesperrt_refusal(gesperrt=True)
        case "vergeben":
            return find_vergeben_refusal(vergeben=True)
        case "nicht_gedeckt":
            return find_nicht_gedeckt_refusal(gedeckt=False)
        case "neue_berechtigt":
            return find_neue_berechtigt_refusal(berechtigt=True)


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
    berechtigungen_postausgang_collection: AsyncCollection,
    berechtigungen_antraege_collection: AsyncCollection,
    einladungen_collection: AsyncCollection,
    sperrliste_collection: AsyncCollection,
    adresswechsel_postausgang_collection: AsyncCollection,
    drosselung_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    adressanker_collection: AsyncCollection,
    schluessel: SecretStr,
    now: datetime,
    journal: Journal,
    session: AsyncClientSession,
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
        bestand=bestand,
        spieler_collection=spieler_collection,
        berechtigungen_collection=berechtigungen_collection,
        berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
        sperrliste=sperrliste,
        massgebliche_saison_id=massgebliche_saison_id,
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
            art="verworfen",
            now=now,
            stamp=stamp,
            session=session,
        )
        # Journalled: what the address held may have gone after a snapshot a restore brings the change back from.
        journal.note(
            ending_line(art="adresswechsel_verworfen", neue=str(record["email"]), record_id=record["_id"], am=stamp, schluessel=schluessel)
        )
        return urteil, False

    beendet = await move_the_address_in_session(
        record=record,
        bestand=bestand,
        # Before the move, after which the new address holds the moved records too.
        adresse_belegt=await adresse_belegt(
            str(record["email"]), records=records, berechtigungen_collection=berechtigungen_collection, session=session
        ),
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
        berechtigungen_postausgang_collection=berechtigungen_postausgang_collection,
        berechtigungen_antraege_collection=berechtigungen_antraege_collection,
        einladungen_collection=einladungen_collection,
        sperrliste_collection=sperrliste_collection,
        adresswechsel_postausgang_collection=adresswechsel_postausgang_collection,
        drosselung_collection=drosselung_collection,
        aktionen_collection=aktionen_collection,
        adressanker_collection=adressanker_collection,
        schluessel=schluessel,
        now=now,
        session=session,
    )
    # The refusal's own line for each request the effect ended, so a restore from before it does not bring one back.
    for antrag in beendet:
        journal.note(abgelehnt_line(antrag=antrag, am=stamp, schluessel=schluessel))
    journal.note(wirksam_line(record=record, now=now, schluessel=schluessel))

    return urteil, True


async def move_the_address_in_session(
    *,
    record: Mapping[str, Any],
    bestand: Bestand,
    # `adresse_belegt` of the new address, judged before this move.
    adresse_belegt: bool,
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
    berechtigungen_postausgang_collection: AsyncCollection,
    berechtigungen_antraege_collection: AsyncCollection,
    einladungen_collection: AsyncCollection,
    sperrliste_collection: AsyncCollection,
    adresswechsel_postausgang_collection: AsyncCollection,
    drosselung_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    adressanker_collection: AsyncCollection,
    schluessel: SecretStr,
    now: datetime,
    session: AsyncClientSession,
) -> list[Mapping[str, Any]]:
    """Move everything `bestand` holds to the change's address in the caller's transaction, then end it as taken effect.

    One patch per row, never a fan-out, so each row's own history keeps the write that moved it (`docs/backend/spec.md :: I40`).
    """

    neue, stamp = str(record["email"]), log_stamp(now)

    if bestand.spieler is not None:
        # Folded, never as typed: the sign-in seam joins on this field by equality (`docs/backend/spec.md :: I265`).
        await patch_one_in_db(
            collection=spieler_collection,
            db_filter={"_id": bestand.spieler["_id"]},
            update={"$set": {"email": sign_in_identifier(neue)}},
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

    for row in bestand.schiedsrichter:
        # The consent link's delivery state described the replaced address (`docs/backend/spec.md :: I561`).
        await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": row["_id"]},
            update={"$set": {"kontakt.email": neue}, "$unset": {"bestaetigung.zustellung": ""}},
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

    voids = []
    for row, slots in bestand.sitze:
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
    # moved seats fresh ones (`docs/backend/spec.md :: I758`).
    await void_moved_seats(spielbestaetigungen_collection=spielbestaetigungen_collection, voids=voids, session=session)

    for row, slots in bestand.bewerbungssitze:
        await patch_one_in_db(
            collection=bewerbungen_collection,
            db_filter={"_id": row["_id"]},
            update=_seat_move(row, slots, neue),
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

    for row in bestand.registrierungen:
        await patch_one_in_db(
            collection=registrierungen_collection,
            db_filter={"_id": row["_id"]},
            update=_registrierung_move(row, neue),
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

    if bestand.berechtigung is not None:
        von = (record.get("genehmigung") or {}).get("genehmigt_von")
        # The judgement refuses a grant its approval does not cover; this guards the replay, which judges differently.
        if not isinstance(von, str):
            raise RuntimeError("a grant moves only on an approval naming its approver")
        await _move_the_grant(
            bestand.berechtigung,
            neue=sign_in_identifier(neue),
            von=von,
            sperrliste=sperrliste,
            berechtigungen_collection=berechtigungen_collection,
            berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
            berechtigungen_postausgang_collection=berechtigungen_postausgang_collection,
            now=now,
            session=session,
        )

    await _rekey_the_person(
        bestand.identifier,
        neue,
        spielbestaetigungen_collection=spielbestaetigungen_collection,
        aktionen_collection=aktionen_collection,
        schluessel=schluessel,
        stamp=stamp,
        session=session,
    )
    await end_the_change_in_session(
        adresswechsel_collection=adresswechsel_collection,
        aktionen_collection=aktionen_collection,
        db_filter={"_id": record["_id"]},
        art="wirksam",
        now=now,
        stamp=stamp,
        session=session,
    )

    # Before the images' carry below, which takes the replaced address out of the image an ended request keeps.
    beendet = await end_the_antraege_about_in_session(
        berechtigungen_antraege_collection=berechtigungen_antraege_collection,
        berechtigungen_postausgang_collection=berechtigungen_postausgang_collection,
        adresse=bestand.identifier,
        session=session,
    )

    # After every write above, so it reaches the images they filed: a record the effect leaves naming the replaced address
    # by address alone would outlive the person's erasure at the new one (`docs/backend/spec.md :: I845`).
    alt, neu = bestand.identifier, sign_in_identifier(neue)
    # Who made a record is the person, whatever their address or grant, a revoked grant's records and a seat holder's
    # decisions included: the starter of a change stays excluded from approving it.
    await carry_authorship_in_session(
        berechtigungen_collection=berechtigungen_collection,
        berechtigungen_postausgang_collection=berechtigungen_postausgang_collection,
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
    await carry_the_replaced_address_in_images(
        aktionen_collection=aktionen_collection, alt=alt, neue=neu, collections=tuple(IMAGE_ADDRESSES), stamp=stamp, session=session
    )
    # A seat left before the change is in no document an erasure at the new address reads, so its images follow the
    # person; one standing at the replaced address as nobody's proven own keeps it.
    await carry_the_replaced_address_in_seat_images(
        aktionen_collection=aktionen_collection,
        alt=alt,
        neue=neu,
        staying=await _seats_staying_at(alt, collections=(saison_teams_collection, bewerbungen_collection), session=session),
        stamp=stamp,
        session=session,
    )
    # The day's counts follow the pseudonym, or every effect hands the person a fresh day (`docs/backend/spec.md :: I797`).
    await carry_counts_in_session(
        drosselung_collection=drosselung_collection,
        alt=akteur_pseudonym(alt, schluessel=schluessel),
        neu=akteur_pseudonym(neu, schluessel=schluessel),
        session=session,
    )
    # An earlier effect's notice still queued carries its account to where the person is now, and an erasure there finds it.
    queued = await aggregate_many_from_db(
        collection=adresswechsel_postausgang_collection,
        pipeline=[{"$match": {"email": alt}}, {"$project": {"_id": 1}}],
        session=session,
    )
    if queued:
        await patch_many_in_db(
            collection=adresswechsel_postausgang_collection,
            db_filter={"_id": {"$in": [row["_id"] for row in queued]}},
            update={"$set": {"email": neu}},
            session=session,
        )
    # In this transaction, so a commit whose answer was lost still owes its notice (`docs/backend/spec.md :: I846`). Both
    # addresses folded, as every stored address is, so an erasure's equality finds the row.
    await post_one_to_db(
        collection=adresswechsel_postausgang_collection,
        document=compose_postausgang(
            art="wirksam",
            bisherige_email=alt,
            email=neu,
            # Greeting nobody on the lost-mailbox way: that mailbox may have passed to a stranger.
            vorname=None if record["weg"] == "wartezeit" else bestand.vorname,
            weg=record["weg"],
            # The sign-in account is carried nowhere the new address held records of its own: their holder never signed
            # in there, and a passkey enrolled at the replaced address would sign in to them.
            adresse_belegt=adresse_belegt,
            now=now,
        ),
        session=session,
    )

    # The effect writes the address onto rows the start never wrote (`docs/backend/spec.md :: I719`), and moves every
    # record of the one replaced: a record committed there meanwhile, which this read never saw, would stay behind.
    await anchor_the_addresses(
        [neue, bestand.identifier], adressanker_collection=adressanker_collection, schluessel=schluessel, session=session
    )

    # The requests for a grant it ended, each journalled by the caller as a refusal (`docs/backend/spec.md :: I857`).
    return beendet


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
    berechtigungen_postausgang_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Revoked at the replaced address and granted at the new by the approver, as the administrators page does both.

    Granted now, never the old row repointed: a session signed in before it holds none of it (`docs/backend/spec.md :: I526`).
    """

    announced = await aggregate_many_from_db(
        collection=berechtigungen_angekuendigt_collection, pipeline=[{"$match": {"_id": grant["_id"]}}], session=session
    )
    gesperrt = await adressen_gesperrt(sperrliste, [von], session=session)
    await revoke_in_session(
        grant=grant,
        announced=announced,
        entzogen_von=von,
        gesperrt=gesperrt,
        berechtigungen_collection=berechtigungen_collection,
        berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
        berechtigungen_postausgang_collection=berechtigungen_postausgang_collection,
        now=now,
        session=session,
    )
    await grant_in_session(
        adresse=neue,
        verwaltung=str(grant["verwaltung"]),
        erteilt_von=von,
        gesperrt=gesperrt,
        berechtigungen_collection=berechtigungen_collection,
        berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
        berechtigungen_postausgang_collection=berechtigungen_postausgang_collection,
        now=now,
        session=session,
    )


async def _rekey_the_person(
    alt: str,
    neue: str,
    *,
    spielbestaetigungen_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    schluessel: SecretStr,
    stamp: str,
    session: AsyncClientSession,
) -> None:
    """The digests naming the person by the replaced address, re-keyed rather than recorded, so an erasure of the new one reaches them.

    Kept on a record instead, every erasure step would have to read them (`docs/backend/spec.md :: I809`).
    """

    await patch_many_in_db(
        collection=aktionen_collection,
        db_filter={"actor.pseudonym": akteur_pseudonym(alt, schluessel=schluessel)},
        update={"$set": {"actor.pseudonym": akteur_pseudonym(neue, schluessel=schluessel)}},
        session=session,
    )

    vorher, nachher = halter_of(alt, schluessel=schluessel), halter_of(neue, schluessel=schluessel)
    answered = await aggregate_many_from_db(
        collection=spielbestaetigungen_collection,
        pipeline=[{"$match": build_contact_reasons_filter([vorher])}, {"$project": {"saison_id": 1}}],
        session=session,
    )
    if answered:
        await patch_many_in_db(
            collection=spielbestaetigungen_collection,
            # Ids and their seasons alone, never the digest: the log keeps a fan-out's filter as text (`docs/backend/spec.md :: I48`).
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
    """The seats' address, and their links' delivery state, which described the replaced mailbox."""

    stored = row.get("bestaetigungen")
    links: Mapping[str, Any] = stored if isinstance(stored, Mapping) else {}
    # Only under a link block that stands: `$unset` through a null member is no path at all.
    unset = {f"bestaetigungen.{slot}.zustellung": "" for slot in slots if isinstance(links.get(slot), Mapping)}
    update: dict[str, Any] = {"$set": {f"kontakte.{slot}.email": neue for slot in slots}}
    if unset:
        update["$unset"] = unset

    return update


def _registrierung_move(row: Mapping[str, Any], neue: str) -> dict[str, Any]:
    """The registration's address; an unanswered one's live links die, so only a link reaching the new mailbox confirms it."""

    update: dict[str, Any] = {"$set": {"email": neue}}
    if not isinstance(row.get("bestaetigung"), Mapping):
        return update

    update["$unset"] = {"bestaetigung.zustellung": ""}
    if not registrierung_ist_bestaetigt(einwilligung=row.get("einwilligung")):
        # A hash no token was kept for, and the reminder owed again: it alone mints the next link, to the moved address.
        update["$set"] |= {"bestaetigung.token_hash": mint_token()[1], "bestaetigung.token_hash_zuvor": None, "bestaetigung.erinnert_am": None}

    return update


# --- The ERASURE's reach: a change naming the erased address ends, and an administrator it names takes the marker.


def build_erasure_adresswechsel_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every live change whose address on file, or whose new address, is this one, each stored folded."""

    folded = sign_in_identifier(identifier)

    # Each clause its index's, or the `$or` scans the collection: the key's type stated for `build_address_filter`'s reason.
    return [
        {"$match": {**LIVE_TERMS, "$or": [{"adresse": {"$eq": folded, "$type": "string"}}, {"email": folded}]}},
        {"$project": {"adresse": 1, "email": 1, "token_hash": 1}},
        {"$sort": {"_id": 1}},
    ]


def others_naming(rows: Sequence[Mapping[str, Any]], identifier: str) -> list[Mapping[str, Any]]:
    """The changes of other addresses naming this one as their new address: the previews' rows, the address's own being its own."""

    return [row for row in rows if row.get("adresse") != identifier]


def known_to_the_new_mailbox(rows: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """The ones whose link reached the new mailbox (`docs/backend/spec.md :: I794`): a request awaiting approval has not."""

    return [row for row in rows if row.get("token_hash") is not None]


_GENEHMIGUNG_AKTEURE: Final = ("genehmigung.gestartet_von", "genehmigung.genehmigt_von")


async def end_the_address_changes_in_session(
    *,
    adresswechsel_collection: AsyncCollection,
    adresswechsel_postausgang_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    identifier: str,
    # The subject's rows, read before the erasure's first write.
    rows: Sequence[Mapping[str, Any]],
    now: datetime,
    stamp: str,
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one (`docs/backend/spec.md :: I52`).
    session: AsyncClientSession,
) -> int:
    """End every change naming the erased address, unjournalled, and give the marker where it started or approved one.

    An erasure's line is the erasure's own: replayed, the erasure ends them again.
    """

    for row in rows:
        await end_the_change_in_session(
            adresswechsel_collection=adresswechsel_collection,
            aktionen_collection=aktionen_collection,
            db_filter={"_id": row["_id"]},
            art="verworfen",
            now=now,
            stamp=stamp,
            session=session,
        )

    # Read after the endings, which took the approval off every change they ended.
    await _reattribute_the_changes(adresswechsel_collection, identifier, ERASED_ACTOR_MARKER, session=session)

    # A notice still owed to the erased person goes undelivered: by id, imageless, as a delivered one is removed. Every
    # address the outbox stores is folded, so an equality finds them.
    owed = await aggregate_many_from_db(
        collection=adresswechsel_postausgang_collection,
        pipeline=[{"$match": {"$or": [{"bisherige_email": identifier}, {"email": identifier}]}}, {"$project": {"_id": 1}}],
        session=session,
    )
    if owed:
        await erase_many_from_db(
            collection=adresswechsel_postausgang_collection, db_filter={"_id": {"$in": [row["_id"] for row in owed]}}, session=session
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
        art="verworfen",
        now=now,
        stamp=stamp,
        session=session,
        ohne_adresse=True,
    )

    return 1
