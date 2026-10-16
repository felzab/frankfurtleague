"""
API · after a restore from a snapshot: every journal line written inside its window, matched against the restored database

Run in the backend's container by `scripts/ops/replay_journal.sh`, where the journal's key and the database's
credentials already are, so neither is typed or printed, and no address is printed either: an erasure is named by
where the restored database holds its address, for an administrator to run again on the erasure page, which
also deletes the sign-in account; a choice by its record, which `--apply` writes again (`docs/ops/runbooks.md` §13).

Invariants:
- A line is read only between the snapshot and the restore's end: an act on the restored site stands on its own.
- A choice is replayed only onto a record still holding its person and set by nothing later, as its press wrote it; where
  a stored day cannot tell whether the restored site set it, the record is left for review.
- A second run over the same lines writes nothing.
"""

import argparse
import asyncio
import json
import sys
from collections.abc import Awaitable, Callable, Iterable, Iterator, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Final, Literal, TextIO
from zoneinfo import ZoneInfo

from pydantic import SecretStr
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import PyMongoError

from app.api.bewerbungen.services import compose_decline_update, compose_saison_decline_update, seat_adressen, seat_is_answered
from app.api.identitaet.crud import unattribute_pseudonym_in_session
from app.api.kontakte.crud import redact_the_decliner
from app.api.konto.services import compose_person_move, compose_sitz_move
from app.api.schiedsrichter.crud import discard_adresswechsel_in_session
from app.api.schiedsrichter.services import ADRESSWECHSEL_FELD
from app.api.spieler.crud import discard_spieler_adresswechsel_in_session
from app.api.spieler.services import SPIELER_ADRESSWECHSEL_FELD
from app.api.teams.schemas import KONTAKT_ROLLEN
from app.core.collections import Collection

# Outside any request, as the constraints CLI is, so the environment's settings rather than an application's.
from app.core.config import EnvironmentValidationError, get_config  # noqa: TID251
from app.core.crud import patch_one_in_db, post_one_to_db
from app.core.drosselung import build_counts_filter, erase_counts_in_session
from app.core.exceptions import BaseAPIException
from app.core.journal import JournalLine, parse_line
from app.core.logging import trace_id_var
from app.core.middlewares import resolve_trace_id
from app.core.recording import act_row, log_stamp, request_var
from app.core.security import loeschung_journal_hash
from app.core.transactions import transaction_session
from app.shared.einwilligung_nachweis import FLEinwilligungWahl, beleg_of, ist_erteilt

# What the action log names as a replay's call: no route made it, and its path names the line it replays.
REPLAY_METHOD: Final = "REPLAY"

# The erasure page as the sidemenu names it (`fl_frontend/src/features/admin/constants.ts :: LOESCHUNG_EINTRAG`), where
# the listing sends an operator. This image holds no frontend source to read it from, so a mirror case holds the two.
LOESCHUNG_SEITE: Final = "Löschung auf Anfrage"

# The day a Widerspruch records is the German one its person declined on (`app/core/dependencies.py :: get_german_date_str`).
_GERMANY: Final = ZoneInfo("Europe/Berlin")

# Where each record keeps the address its person signed in or was written to under.
_PERSON_ADDRESS: Final[Mapping[Collection, Callable[[Mapping[str, Any]], Any]]] = {
    Collection.SPIELER: lambda row: row.get("email"),
    Collection.REGISTRIERUNGEN: lambda row: row.get("email"),
    Collection.SCHIEDSRICHTER: lambda row: (row.get("kontakt") or {}).get("email"),
}

# Each home's own update emptying the seats a Widerspruch names, as the link's answer writes it.
_WIDERSPRUCH_UPDATE: Final = {Collection.BEWERBUNGEN: compose_decline_update, Collection.SAISON_TEAMS: compose_saison_decline_update}

# Where each record keeps a pending address change.
_ADRESSWECHSEL_FELD: Final = {Collection.SCHIEDSRICHTER: ADRESSWECHSEL_FELD, Collection.SPIELER: SPIELER_ADRESSWECHSEL_FELD}

# A line's standing: to replay, replayed, already as the line left it or set since, held by somebody else or in another
# state (listed and left), or a record the restore does not hold.
Stand = Literal["to replay", "replayed", "already done", "left for review", "no such record"]

Rewrite = Callable[[AsyncClientSession], Awaitable[Any]]


@dataclass(frozen=True)
class Read:
    """One journal line as a day file holds it."""

    timestamp: datetime
    line: JournalLine

    def named(self) -> str:
        """How the listing and a replay's log row name the line: its act, its record and when it was journalled."""

        return f"{self.line.act()} journalled={self.timestamp.isoformat()}"


@dataclass(frozen=True)
class Window:
    """The snapshot's instant and the restore's end: a line between them was written on the database the restore lost."""

    since: datetime
    until: datetime

    def sent_after_restore(self, verschickt_am: str) -> bool | None:
        """Whether the restored site sent a link the database holds, by its German day.

        The snapshot's went out by the snapshot's day, the site's from the restore's, so one sent on a day both fell on is `None`.
        """

        if verschickt_am > _german_day(self.since):
            return True
        if verschickt_am < _german_day(self.until):
            return False
        return None


@dataclass(frozen=True)
class Plan:
    stand: Stand
    rewrite: Rewrite | None = None
    # What the listing says beside the standing, counts and ids alone.
    detail: str | None = None


def read_day_files(lines: Iterable[str], *, since: datetime, until: datetime) -> tuple[list[Read], int]:
    """Every journal line written after `since` and no later than `until`, oldest first and each once, and how many could not be read.

    A day file holds journal lines alone, so an unreadable one is counted, never skipped.
    """

    found: dict[tuple[datetime, str], Read] = {}
    unreadable = 0
    for raw in lines:
        if not raw.strip():
            continue
        try:
            envelope = json.loads(raw)
            timestamp = datetime.fromisoformat(envelope["timestamp"])
            line = parse_line(envelope["message"])
        except ValueError, KeyError, TypeError:
            unreadable += 1
            continue
        if line is None:
            unreadable += 1
            continue
        # By the line's own instant, which follows its commit: a line a hair after a snapshot holding its write finds it
        # standing. One after the restore's end is the restored site's act, which stands.
        if since < timestamp <= until:
            found[(timestamp, line.text())] = Read(timestamp=timestamp, line=line)

    return [found[key] for key in sorted(found, key=lambda key: key[0])], unreadable


def _strings(value: Any, path: str = "") -> Iterator[tuple[str, str]]:
    if isinstance(value, str):
        yield path, value
    elif isinstance(value, Mapping):
        for key, member in value.items():
            yield from _strings(member, f"{path}.{key}" if path else str(key))
    elif isinstance(value, list):
        for index, member in enumerate(value):
            yield from _strings(member, f"{path}.{index}")


async def where_held(database: AsyncDatabase, person_hashes: set[str], *, schluessel: SecretStr) -> dict[str, list[tuple[str, Any, str]]]:
    """For each hash, every collection, document and field holding an address that hashes to it.

    Every string carrying an `@` in every document: an erasure reaches an address wherever it is held, so no list of fields is whole.
    """

    held: dict[str, list[tuple[str, Any, str]]] = {person_hash: [] for person_hash in person_hashes}
    hashed: dict[str, str] = {}
    for name in sorted(await database.list_collection_names()):
        if name.startswith("system."):
            continue
        async for document in database[name].find({}):
            for path, value in _strings(document):
                if "@" not in value:
                    continue
                if value not in hashed:
                    hashed[value] = loeschung_journal_hash(value, schluessel=schluessel)
                if hashed[value] in held:
                    held[hashed[value]].append((name, document.get("_id"), path))

    return held


def _holds(address: Any, line: JournalLine, schluessel: SecretStr) -> bool:
    return isinstance(address, str) and loeschung_journal_hash(address, schluessel=schluessel) == line.person_hash


def _german_day(instant: datetime) -> str:
    return instant.astimezone(_GERMANY).strftime("%Y-%m-%d")


def _withdrawable(block: Mapping[str, Any], line: JournalLine) -> dict[FLEinwilligungWahl, Any]:
    """The line's choices that still grant on `block` by an act no later than the line's: a later grant is its person's last word."""

    assert line.am is not None
    made = datetime.fromisoformat(line.am)

    def set_since(wahl: FLEinwilligungWahl) -> bool:
        evidenced = beleg_of(block, wahl, stamp=log_stamp)
        return evidenced is not None and evidenced[0] > made

    return {wahl: wert for wahl, wert in line.wahlen.items() if ist_erteilt(wahl, block.get(wahl)) and not set_since(wahl)}


async def _plan_widerruf(line: JournalLine, database: AsyncDatabase, *, schluessel: SecretStr, session: AsyncClientSession | None) -> Plan:
    assert line.collection is not None and line.am is not None and line.text_version is not None
    collection = database[line.collection]
    row = await collection.find_one({"_id": line.record_id}, session=session)
    if row is None:
        return Plan("no such record")

    if line.collection in _PERSON_ADDRESS:
        block = row.get("einwilligung")
        if not _holds(_PERSON_ADDRESS[line.collection](row), line, schluessel) or not isinstance(block, Mapping):
            return Plan("left for review")
        gewaehlt = _withdrawable(block, line)
        update = compose_person_move(gespeichert=block, gewaehlt=gewaehlt, am=line.am, text_version=line.text_version) if gewaehlt else None
    else:
        kontakte = row.get("kontakte") or {}
        sitze = {
            slot: kontakte[slot]["einwilligung"]
            for slot in KONTAKT_ROLLEN
            if isinstance(kontakte.get(slot), Mapping)
            and _holds(kontakte[slot].get("email"), line, schluessel)
            and isinstance(kontakte[slot].get("einwilligung"), Mapping)
        }
        if not sitze:
            return Plan("left for review")
        # Seat by seat: one person's seats on a row are answered apart, so a later grant on one leaves the other's to replay.
        gesetzt: dict[str, Any] = {}
        for slot, block in sitze.items():
            gewaehlt = _withdrawable(block, line)
            moved = compose_sitz_move(sitze={slot: block}, gewaehlt=gewaehlt, am=line.am, text_version=line.text_version) if gewaehlt else None
            gesetzt |= moved["$set"] if moved is not None else {}
        update = {"$set": gesetzt} if gesetzt else None

    if update is None:
        return Plan("already done")

    async def rewrite_withdrawal(session: AsyncClientSession) -> Any:
        return await patch_one_in_db(
            collection=collection, db_filter={"_id": row["_id"]}, update=update, session=session, return_document=ReturnDocument.BEFORE
        )

    return Plan("to replay", rewrite_withdrawal)


async def _plan_widerspruch(
    line: JournalLine, database: AsyncDatabase, *, schluessel: SecretStr, session: AsyncClientSession | None, now: datetime, window: Window
) -> Plan:
    assert line.collection is not None and line.am is not None
    home = line.collection
    collection = database[home]
    row = await collection.find_one({"_id": line.record_id}, session=session)
    if row is None:
        return Plan("no such record")

    kontakte, bestaetigungen = row.get("kontakte") or {}, row.get("bestaetigungen")
    declined_on = _german_day(datetime.fromisoformat(line.am))

    def linked_since(slot: str) -> bool | None:
        # A link the restored site sent is a seating since, which the decline must not empty.
        entry = bestaetigungen.get(slot) if isinstance(bestaetigungen, Mapping) else None
        sent = entry.get("verschickt_am") if isinstance(entry, Mapping) else None
        return window.sent_after_restore(sent) if isinstance(sent, str) else False

    linked = {slot: linked_since(slot) for slot in line.sitze}
    offen = [
        slot
        for slot in line.sitze
        if slot in KONTAKT_ROLLEN
        and isinstance(kontakte.get(slot), Mapping)
        and _holds(kontakte[slot].get("email"), line, schluessel)
        and not seat_is_answered(kontakte=kontakte, bestaetigungen=bestaetigungen, seat=slot)
        and linked[slot] is not True
    ]
    if any(linked[slot] is None for slot in offen):
        return Plan("left for review", detail="a seat's link went out on the day of both the snapshot and the restore")
    if not offen:
        settled = all(slot in KONTAKT_ROLLEN and (not isinstance(kontakte.get(slot), Mapping) or linked[slot] is True) for slot in line.sitze)
        return Plan("already done" if settled else "left for review")

    async def rewrite_widerspruch(session: AsyncClientSession) -> Any:
        await patch_one_in_db(
            collection=collection,
            db_filter={"_id": row["_id"]},
            update=_WIDERSPRUCH_UPDATE[home](seats=offen, today=declined_on),
            session=session,
            return_document=ReturnDocument.BEFORE,
        )
        # After the patch, as the link's answer redacts, so it reaches the pre-image the patch filed; the redaction
        # happens now, so its stamp is the replay's, where the day the person declined on is theirs.
        await redact_the_decliner(
            aktionen_collection=database[Collection.AKTIONEN],
            collection=home,
            row_id=row["_id"],
            adressen=seat_adressen(kontakte=row.get("kontakte"), seats=offen),
            stamp=log_stamp(now),
            session=session,
        )

    return Plan("to replay", rewrite_widerspruch)


async def _plan_adresswechsel(
    line: JournalLine, database: AsyncDatabase, *, schluessel: SecretStr, session: AsyncClientSession | None, now: datetime, window: Window
) -> Plan:
    assert line.collection is not None
    feld = _ADRESSWECHSEL_FELD[line.collection]
    row = await database[line.collection].find_one({"_id": line.record_id}, {feld: 1}, session=session)
    if row is None:
        return Plan("no such record")

    wechsel = row.get(feld)
    if not isinstance(wechsel, Mapping):
        return Plan("already done")
    sent = wechsel.get("verschickt_am")
    asked_since = window.sent_after_restore(sent) if isinstance(sent, str) else False
    # A change the restored site asked for, never the one declined.
    if asked_since is True:
        return Plan("already done")
    if asked_since is None:
        return Plan("left for review", detail="its pending change went out on the day of both the snapshot and the restore")
    if not _holds(wechsel.get("email"), line, schluessel):
        return Plan("left for review")

    # The address judged above, so a change replaced since this plan was made is not taken with it.
    db_filter = {"_id": row["_id"], f"{feld}.email": wechsel["email"]}

    # The discard's body, which writes the decline's own update and redaction (`docs/backend/spec.md :: I704`).
    async def rewrite_declined_address(session: AsyncClientSession) -> Any:
        if line.collection == Collection.SCHIEDSRICHTER:
            return await discard_adresswechsel_in_session(
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                aktionen_collection=database[Collection.AKTIONEN],
                db_filter=db_filter,
                stamp=log_stamp(now),
                return_document=ReturnDocument.BEFORE,
                session=session,
            )
        return await discard_spieler_adresswechsel_in_session(
            spieler_collection=database[Collection.SPIELER],
            aktionen_collection=database[Collection.AKTIONEN],
            db_filter=db_filter,
            stamp=log_stamp(now),
            return_document=ReturnDocument.BEFORE,
            session=session,
        )

    return Plan("to replay", rewrite_declined_address)


async def pseudonym_traces(database: AsyncDatabase, pseudonym: str, *, session: AsyncClientSession | None) -> tuple[list[Any], int]:
    """The log rows an erased person's pseudonym still marks, by id, and how many day counts it still keys."""

    rows = [row["_id"] async for row in database[Collection.AKTIONEN].find({"actor.pseudonym": pseudonym}, {"_id": 1}, session=session)]
    counts = await database[Collection.DROSSELUNG].count_documents(build_counts_filter(pseudonym), session=session)

    return rows, counts


async def _plan_pseudonym(line: JournalLine, database: AsyncDatabase, *, session: AsyncClientSession | None) -> Plan:
    """An erasure whose address the restored database holds nowhere: the rows and counts its pseudonym still marks.

    Held nowhere by its caller's walk, which no transaction could hold; held anywhere, the page's erasure takes them.
    """

    assert line.pseudonym is not None
    pseudonym = line.pseudonym
    rows, counts = await pseudonym_traces(database, pseudonym, session=session)
    if not rows and not counts:
        return Plan("already done", detail="its address is held nowhere in the restored database, and its pseudonym marks nothing")

    shown = ", ".join(str(row_id) for row_id in rows[:3]) + (", …" if len(rows) > 3 else "")
    detail = (
        f"its address is held nowhere in the restored database, but its pseudonym still marks {len(rows)} log row(s)"
        f"{f' ({shown})' if rows else ''} and {counts} day count(s)"
    )

    # The erasure's own pseudonym steps, and the one row the log keeps of an act writing none of the logged collections.
    async def rewrite_pseudonym(session: AsyncClientSession) -> Any:
        await unattribute_pseudonym_in_session(aktionen_collection=database[Collection.AKTIONEN], pseudonym=pseudonym, session=session)
        await erase_counts_in_session(drosselung_collection=database[Collection.DROSSELUNG], pseudonym=pseudonym, session=session)
        await post_one_to_db(collection=database[Collection.AKTIONEN], document=act_row("pseudonyme", operation="patch_many"), session=session)

    return Plan("to replay", rewrite_pseudonym, detail)


async def plan_replay(
    line: JournalLine, database: AsyncDatabase, *, schluessel: SecretStr, session: AsyncClientSession | None, now: datetime, window: Window
) -> Plan:
    """What replaying a line would write on the restored database, judged in `session` where one is given.

    An erasure's line is planned only for its pseudonym's traces: its records are the page's to erase.
    """

    match line.art:
        case "widerruf":
            return await _plan_widerruf(line, database, schluessel=schluessel, session=session)
        case "widerspruch":
            return await _plan_widerspruch(line, database, schluessel=schluessel, session=session, now=now, window=window)
        case "adresswechsel_abgelehnt":
            return await _plan_adresswechsel(line, database, schluessel=schluessel, session=session, now=now, window=window)
        case "loeschung":
            return await _plan_pseudonym(line, database, session=session)


async def replay_line(
    entry: Read, client: AsyncMongoClient, database: AsyncDatabase, *, schluessel: SecretStr, now: datetime, window: Window
) -> Plan:
    """Judge the line again inside one transaction and write it where it stands to be replayed.

    Recorded under the system actor, the call naming the line, each line one action on the log's page.
    """

    request_token = request_var.set((REPLAY_METHOD, entry.named()))
    trace_token = trace_id_var.set(resolve_trace_id(None))
    try:

        async def judged_and_rewritten(session: AsyncClientSession) -> Plan:
            planned = await plan_replay(entry.line, database, schluessel=schluessel, session=session, now=now, window=window)
            if planned.rewrite is None:
                return planned
            await planned.rewrite(session)
            return Plan("replayed", detail=planned.detail)

        async with transaction_session(client) as session:
            return await session.with_transaction(judged_and_rewritten)
    finally:
        trace_id_var.reset(trace_token)
        request_var.reset(request_token)


async def run_replay(
    lines: Iterable[str],
    *,
    since: datetime,
    until: datetime,
    apply: bool,
    client: AsyncMongoClient,
    database: AsyncDatabase,
    schluessel: SecretStr,
    now: datetime,
    out: TextIO,
) -> int:
    """List each line inside the window, replaying each under `apply`; 0 once nothing is left, else 1.

    No address, hash or pseudonym is printed: a line is named by its act and record, an erasure by where it is held.
    """

    window = Window(since=since, until=until)
    read, unreadable = read_day_files(lines, since=since, until=until)
    erased = {entry.line.person_hash for entry in read if entry.line.art == "loeschung"}
    held = await where_held(database, erased, schluessel=schluessel)
    # A person whose erasure has run again: their own choices' records went with it, and nothing of theirs is left to replay.
    gone = {person_hash for person_hash in erased if not held[person_hash]}
    print(f"Journal lines written after {since.isoformat()} and no later than {until.isoformat()}: {len(read)}.", file=out)

    left = {"erasures to run": 0, "lines to replay": 0, "records to review": 0, "replays that failed": 0}
    for entry in read:
        line = entry.line
        print(f"\n{entry.timestamp.isoformat()}  {line.act()}", file=out)

        if line.art == "loeschung" and held[line.person_hash]:
            places = held[line.person_hash]
            left["erasures to run"] += 1
            for collection in sorted({place[0] for place in places}):
                found = [place for place in places if place[0] == collection]
                shown = ", ".join(f"{document_id} {path}" for _, document_id, path in found[:3])
                print(f"    held in {collection}: {len(found)} field(s), {shown}{', …' if len(found) > 3 else ''}", file=out)
            print(f"    run it again on „{LOESCHUNG_SEITE}“ with the address one of those records shows", file=out)
            continue
        if line.art == "loeschung" and line.pseudonym is None:
            print("    its address is held nowhere in the restored database: nothing to run", file=out)
            continue
        if line.art != "loeschung" and line.person_hash in gone:
            print("    its person's erasure has run: nothing to replay", file=out)
            continue

        try:
            planned = (
                await replay_line(entry, client, database, schluessel=schluessel, now=now, window=window)
                if apply
                else await plan_replay(line, database, schluessel=schluessel, session=None, now=now, window=window)
            )
        # The type alone: a driver's or a validator's message can quote the stored document, an address among it.
        except (PyMongoError, BaseAPIException) as failure:
            left["replays that failed"] += 1
            print(f"    failed, nothing written: {type(failure).__name__}", file=out)
            continue

        if planned.detail is not None:
            print(f"    {planned.detail}", file=out)
        print(f"    {planned.stand}", file=out)
        if planned.stand == "to replay":
            left["lines to replay"] += 1
        elif planned.stand == "left for review":
            left["records to review"] += 1

    if unreadable:
        left["unreadable lines"] = unreadable
    print(f"\nLeft: {', '.join(f'{count} {what}' for what, count in left.items())}.", file=out)

    return 1 if any(left.values()) else 0


def _instant(parser: argparse.ArgumentParser, flag: str, spelled: str) -> datetime:
    try:
        instant = datetime.fromisoformat(spelled)
    except ValueError:
        parser.error(f"{flag} is no ISO 8601 instant")
    if instant.tzinfo is None:
        parser.error(f"{flag} names no offset, so which instant it is depends on the clock reading it")

    return instant


def _main() -> int:
    """The exit contract: 0 nothing left, 1 lines left, 2 nothing judged (the arguments, the settings or the database), 3 a crash."""

    parser = argparse.ArgumentParser(
        prog="python -m app.api.identitaet.wiederherstellung",
        description="Match the journal lines on stdin against the restored database, and replay the choices they name.",
    )
    parser.add_argument("--since", required=True, help="the instant the restored snapshot was taken, ISO 8601 with its offset")
    parser.add_argument("--until", required=True, help="the instant the restore completed, ISO 8601 with its offset")
    parser.add_argument(
        "--apply", action="store_true", help="write every line that stands to be replayed; erasures held anywhere stay the page's"
    )
    arguments = parser.parse_args()

    since = _instant(parser, "--since", arguments.since)
    until = _instant(parser, "--until", arguments.until)
    if until <= since:
        parser.error("--until is no later than --since, so the window holds no line")

    try:
        config = get_config()
    # The settings' own refusal names variables and files alone, never a value (`app/core/config.py :: EnvironmentValidationError`).
    except EnvironmentValidationError as refusal:
        print(f"\nThe settings could not be read, so no line was judged: {refusal}", file=sys.stdout)
        return 2
    except Exception as failure:
        print(f"\nThe settings could not be read ({type(failure).__name__}), so the replay stopped.", file=sys.stdout)
        return 3

    async def main() -> int:
        client: AsyncMongoClient = AsyncMongoClient(
            host=config.mongodb_uri.get_secret_value(),
            serverSelectionTimeoutMS=config.db_server_selection_timeout,
            uuidRepresentation="standard",
        )
        try:
            return await run_replay(
                sys.stdin,
                since=since,
                until=until,
                apply=arguments.apply,
                client=client,
                database=client[config.db_base_name],
                schluessel=config.sperrliste_schluessel,
                now=datetime.now(UTC),
                out=sys.stdout,
            )
        except PyMongoError as failure:
            # Refused, never findings: the lines were not judged at all. The type alone, for the reason above.
            print(f"\nThe database could not be read ({type(failure).__name__}), so no line was judged.", file=sys.stdout)
            return 2
        finally:
            await client.close()

    try:
        return asyncio.run(main())
    # The exit contract's crash, and the type alone, for the reason above: a traceback quotes what it failed over.
    except Exception as failure:
        print(f"\nThe replay stopped on {type(failure).__name__}.", file=sys.stdout)
        return 3


if __name__ == "__main__":
    raise SystemExit(_main())
