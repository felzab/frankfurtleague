"""
API · an address change across every record the address holds: the read choosing them and the writes every route shares

A change belongs to an address, so the person's start, an administrator's, the new mailbox's confirmation and the hourly
pass read one set and move it in one write; each lane's router keeps its own refusals.

Invariants:
- The effect moves the set's every record in its caller's transaction, and nothing else (`docs/backend/spec.md :: I793`).
- A start ends every other change pending on the set's rows (`docs/backend/spec.md :: I792`).
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from pydantic import SecretStr
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aktionen.crud import redact_images_in_session
from app.api.bewerbungen.services import mint_token
from app.api.identitaet.lookup import RecordCollections
from app.api.identitaet.services import eigene_sitze, folds_to, ist_eigener_schiedsrichter, namen_aus
from app.api.kontakte.services import rows_possibly_naming
from app.api.registrierungen.services import build_eigene_registrierung_filter, registrierung_ist_bestaetigt
from app.api.schiedsrichter.crud import discard_adresswechsel_in_session
from app.api.schiedsrichter.services import adresswechsel_image_edits, build_selbst_referee_filter, vorname_of
from app.api.spielbestaetigungen.services import seat_void_of
from app.api.spieler.crud import discard_spieler_adresswechsel_in_session
from app.api.spieler.services import build_selbst_pupil_filter, spieler_adresswechsel_image_edits
from app.api.teams.crud import void_moved_seats
from app.core.adressanker import anchor_the_addresses
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, patch_one_in_db
from app.core.journal import JournalLine
from app.core.recording import build_redaction_filter, log_stamp
from app.core.security import loeschung_journal_hash
from app.shared.adresswechsel import ADRESSWECHSEL_FELD, neue_adresse_of
from app.shared.folding import sign_in_identifier

# Which lane carries a change: the pupil row where the address holds one, else a confirmed referee row.
Art = Literal["spieler", "schiedsrichter"]

ART_OF: Mapping[Collection, Art] = {Collection.SPIELER: "spieler", Collection.SCHIEDSRICHTER: "schiedsrichter"}

_SPIELER_FIELDS: Mapping[str, int] = {"vorname": 1, "nachname": 1, "email": 1, ADRESSWECHSEL_FELD: 1}
# The whole consent record: `ist_eigener_schiedsrichter` judges its stamp.
_SCHIEDSRICHTER_FIELDS: Mapping[str, int] = {"name": 1, "kontakt.email": 1, "einwilligung": 1, ADRESSWECHSEL_FELD: 1}
_SITZ_FIELDS: Mapping[str, int] = {"saison_id": 1, "team_id": 1, "kontakte": 1, "bestaetigungen": 1}
_REGISTRIERUNG_FIELDS: Mapping[str, int] = {"email": 1, "vorname": 1, "nachname": 1, "einwilligung": 1, "bestaetigung": 1}


@dataclass(frozen=True, kw_only=True)
class Zeile:
    """One row that may carry a change: its lane and the row as read."""

    collection: Collection
    row: Mapping[str, Any]

    @property
    def art(self) -> Art:
        return ART_OF[self.collection]

    @property
    def block(self) -> Mapping[str, Any] | None:
        block = self.row.get(ADRESSWECHSEL_FELD)
        return block if isinstance(block, Mapping) else None

    @property
    def adresse(self) -> str:
        """The address on file as the row stores it: a pupil's folded, a referee's as typed."""

        stored = self.row.get("email") if self.collection == Collection.SPIELER else (self.row.get("kontakt") or {}).get("email")
        return str(stored or "")

    @property
    def vorname(self) -> str:
        if self.collection == Collection.SPIELER:
            return str(self.row.get("vorname") or "")
        return vorname_of(self.row.get("name")) or ""


@dataclass(frozen=True, kw_only=True)
class Bestand:
    """Every record an address holds as its person's own, the records a change moves (`docs/backend/spec.md :: I793`)."""

    identifier: str
    spieler: Mapping[str, Any] | None
    # In `_id` order: the lowest carries a person's own start where the address holds no pupil row.
    schiedsrichter: Sequence[Mapping[str, Any]]
    sitze: Sequence[tuple[Mapping[str, Any], tuple[str, ...]]]
    bewerbungssitze: Sequence[tuple[Mapping[str, Any], tuple[str, ...]]]
    # Every open registration, its pupil's confirmation or not: left here, an admission would make a second person.
    registrierungen: Sequence[Mapping[str, Any]]

    @property
    def zeilen(self) -> list[Zeile]:
        """The rows a change may stand on, the pupil's first."""

        pupil = [] if self.spieler is None else [Zeile(collection=Collection.SPIELER, row=self.spieler)]
        return [*pupil, *(Zeile(collection=Collection.SCHIEDSRICHTER, row=row) for row in self.schiedsrichter)]

    @property
    def traeger(self) -> Zeile | None:
        zeilen = self.zeilen
        return zeilen[0] if zeilen else None

    @property
    def offen(self) -> Zeile | None:
        """The row holding the address's pending change; the carrier's first, should a hand edit have left two."""

        return next((zeile for zeile in self.zeilen if zeile.block is not None), None)

    def zeile(self, collection: Collection, row_id: Any) -> Zeile | None:
        return next((zeile for zeile in self.zeilen if zeile.collection == collection and zeile.row["_id"] == row_id), None)

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


async def read_the_bestand(identifier: str, *, records: RecordCollections, session: AsyncClientSession | None) -> Bestand:
    """Everything `identifier` holds as its person's own, read unbounded: a capped read would leave a record at the replaced address.

    `session` is the writing transaction's, so the effect moves what it judged; `None` for the account page's read alone.
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
        pipeline=[{"$match": rows_possibly_naming(identifier)}, {"$project": dict(_SITZ_FIELDS)}, {"$sort": {"_id": 1}}],
        session=session,
    )
    # Every status: an accepted application keeps its seats, and the erasure of the new address reaches them only there.
    bewerbung_rows = await aggregate_many_from_db(
        collection=records.bewerbungen_collection,
        pipeline=[{"$match": rows_possibly_naming(identifier)}, {"$project": {"kontakte": 1, "bestaetigungen": 1}}, {"$sort": {"_id": 1}}],
        session=session,
    )
    registrierungen = await aggregate_many_from_db(
        collection=records.registrierungen_collection,
        pipeline=[{"$match": build_eigene_registrierung_filter(identifier)}, {"$project": dict(_REGISTRIERUNG_FIELDS)}, {"$sort": {"_id": 1}}],
        session=session,
    )

    return Bestand(
        identifier=identifier,
        spieler=spieler,
        schiedsrichter=[row for row in referees if ist_eigener_schiedsrichter(row, identifier)],
        sitze=[(row, tuple(slots)) for row in seat_rows if (slots := eigene_sitze(row, identifier))],
        bewerbungssitze=[(row, tuple(slots)) for row in bewerbung_rows if (slots := eigene_sitze(row, identifier))],
        registrierungen=[row for row in registrierungen if folds_to(row.get("email"), identifier)],
    )


def _image_edits(collection: Collection) -> Callable[[Mapping[str, Any], str], dict[str, None]]:
    return spieler_adresswechsel_image_edits if collection == Collection.SPIELER else adresswechsel_image_edits


async def discard_the_change_in_session(
    *,
    collection: Collection,
    spieler_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    db_filter: Mapping[str, Any],
    stamp: str,
    session: AsyncClientSession,
) -> Mapping[str, Any]:
    """The lane's discard body on `db_filter`, the judgement: the block goes, and its address from the row's log images."""

    if collection == Collection.SPIELER:
        return await discard_spieler_adresswechsel_in_session(
            spieler_collection=spieler_collection,
            aktionen_collection=aktionen_collection,
            db_filter=db_filter,
            stamp=stamp,
            return_document=ReturnDocument.BEFORE,
            session=session,
        )

    return await discard_adresswechsel_in_session(
        schiedsrichter_collection=schiedsrichter_collection,
        aktionen_collection=aktionen_collection,
        db_filter=db_filter,
        stamp=stamp,
        return_document=ReturnDocument.BEFORE,
        session=session,
    )


async def start_the_change_in_session(
    *,
    bestand: Bestand,
    traeger: Zeile,
    block: Mapping[str, Any],
    spieler_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    adressanker_collection: AsyncCollection,
    schluessel: SecretStr,
    stamp: str,
    session: AsyncClientSession,
) -> None:
    """End every other change pending on the set's rows, then write the carrier's block whole (`docs/backend/spec.md :: I792`)."""

    for zeile in bestand.zeilen:
        if zeile.block is None or (zeile.collection, zeile.row["_id"]) == (traeger.collection, traeger.row["_id"]):
            continue
        await discard_the_change_in_session(
            collection=zeile.collection,
            spieler_collection=spieler_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            aktionen_collection=aktionen_collection,
            db_filter={"_id": zeile.row["_id"], ADRESSWECHSEL_FELD: {"$type": "object"}},
            stamp=stamp,
            session=session,
        )

    update = {"$set": {ADRESSWECHSEL_FELD: dict(block)}}
    if traeger.collection == Collection.SPIELER:
        await patch_one_in_db(
            collection=spieler_collection,
            db_filter={"_id": traeger.row["_id"]},
            update=update,
            session=session,
            return_document=ReturnDocument.BEFORE,
        )
    else:
        await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": traeger.row["_id"]},
            update=update,
            session=session,
            return_document=ReturnDocument.BEFORE,
        )
    # The address entering here, which an erasure of it running now never read (`docs/backend/spec.md :: I719`).
    await anchor_the_addresses([str(block["email"])], adressanker_collection=adressanker_collection, schluessel=schluessel, session=session)

    # After the write, for the decline's reason: it reaches the pre-image this start just filed, which still holds the
    # address it replaced. Typing the pending one again drops nothing.
    replaced = neue_adresse_of(traeger.block)
    if replaced is not None and sign_in_identifier(replaced) != sign_in_identifier(str(block["email"])):
        dropped = sign_in_identifier(replaced)
        edits = _image_edits(traeger.collection)
        await redact_images_in_session(
            aktionen_collection=aktionen_collection,
            db_filter=build_redaction_filter([(traeger.collection, [traeger.row["_id"]])]),
            judge=lambda image: edits(image, dropped),
            stamp=stamp,
            session=session,
        )


@dataclass(frozen=True, kw_only=True)
class Mitteilung:
    """Whom the completion notice greets, at the address the change replaced, read in the effect's transaction."""

    bisherige_email: str
    vorname: str


async def move_the_address_in_session(
    *,
    bestand: Bestand,
    traeger: Zeile,
    neue: str,
    spieler_collection: AsyncCollection,
    schiedsrichter_collection: AsyncCollection,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    registrierungen_collection: AsyncCollection,
    spielbestaetigungen_collection: AsyncCollection,
    adressanker_collection: AsyncCollection,
    schluessel: SecretStr,
    session: AsyncClientSession,
) -> Mitteilung:
    """Move every record of `bestand` to `neue` in the caller's transaction, ending the change (`docs/backend/spec.md :: I793`).

    One patch per row, never a fan-out, so each row's own history keeps the write that moved it (`docs/backend/spec.md :: I40`).
    """

    if bestand.spieler is not None:
        # Folded, never as typed: the sign-in seam joins on this field by equality (`docs/backend/spec.md :: I265`).
        await patch_one_in_db(
            collection=spieler_collection,
            db_filter={"_id": bestand.spieler["_id"]},
            update={"$set": {"email": sign_in_identifier(neue)}, "$unset": {ADRESSWECHSEL_FELD: ""}},
            session=session,
            return_document=ReturnDocument.BEFORE,
        )

    for row in bestand.schiedsrichter:
        # The consent link's delivery state described the replaced address (`docs/backend/spec.md :: I561`).
        await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": row["_id"]},
            update={"$set": {"kontakt.email": neue}, "$unset": {ADRESSWECHSEL_FELD: "", "bestaetigung.zustellung": ""}},
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

    # The effect writes the address onto rows the start never wrote (`docs/backend/spec.md :: I719`).
    await anchor_the_addresses([neue], adressanker_collection=adressanker_collection, schluessel=schluessel, session=session)

    return Mitteilung(bisherige_email=traeger.adresse, vorname=traeger.vorname)


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
        # A hash no token was kept for: the reminder mints the next one to the moved address.
        update["$set"] |= {"bestaetigung.token_hash": mint_token()[1], "bestaetigung.token_hash_zuvor": None}

    return update


def wirksam_line(*, neue: str, traeger: Zeile, now: datetime, schluessel: SecretStr) -> JournalLine:
    """The effect's journal line, so a restore from a snapshot taken while the change stood is listed rather than silently undone."""

    return JournalLine(
        person_hash=loeschung_journal_hash(neue, schluessel=schluessel),
        art="adresswechsel_wirksam",
        collection=traeger.collection,
        record_id=traeger.row["_id"],
        am=log_stamp(now),
    )


def gestoppt_line(*, neue: str, collection: Collection, record_id: Any, now: datetime, schluessel: SecretStr) -> JournalLine:
    """A stop's line, as a decline's, so a restore does not bring the change back with a live link (`docs/backend/spec.md :: I706`)."""

    return JournalLine(
        person_hash=loeschung_journal_hash(neue, schluessel=schluessel),
        art="adresswechsel_gestoppt",
        collection=collection,
        record_id=record_id,
        am=log_stamp(now),
    )
