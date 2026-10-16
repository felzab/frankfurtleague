"""
API · after a restore from a snapshot: every journal line written since it, matched against the restored database

Run in the backend's container by `scripts/ops/replay_journal.sh`, where the journal's key and the database's
credentials already are, so neither is typed or printed, and no address is printed either: an erasure is named by
where the restored database holds its address, for an administrator to run again on „Löschung auf Anfrage“, which
also deletes the sign-in account; a choice by its record, which `--apply` writes again (`docs/ops/runbooks.md` §13).

Invariants:
- A choice is replayed only onto a record still holding its person, by the body the person's own press ran.
- A replayed choice stamps the instant its line carries, never the replay's.
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

from app.api.bewerbungen.services import seat_is_answered
from app.api.kontakte.crud import take_widerspruch_in_session
from app.api.konto.services import compose_person_move, compose_sitz_move
from app.api.schiedsrichter.crud import discard_adresswechsel_in_session
from app.api.schiedsrichter.services import ADRESSWECHSEL_FELD
from app.api.spieler.crud import discard_spieler_adresswechsel_in_session
from app.api.spieler.services import SPIELER_ADRESSWECHSEL_FELD
from app.api.teams.schemas import KONTAKT_ROLLEN
from app.core.collections import Collection

# Outside any request, as the constraints CLI is, so the environment's settings rather than an application's.
from app.core.config import get_config  # noqa: TID251
from app.core.crud import patch_one_in_db
from app.core.exceptions import BaseAPIException
from app.core.journal import JournalLine, parse_line
from app.core.logging import trace_id_var
from app.core.middlewares import resolve_trace_id
from app.core.recording import log_stamp, request_var
from app.core.security import loeschung_journal_hash
from app.core.transactions import transaction_session
from app.shared.einwilligung_nachweis import FLEinwilligungWahl, ist_erteilt

# What the action log names as a replayed choice's call: no route made it, and its path is the line it replays.
REPLAY_METHOD: Final = "REPLAY"

# The day a Widerspruch records is the German one its person declined on (`app/core/dependencies.py :: get_german_date_str`).
_GERMANY: Final = ZoneInfo("Europe/Berlin")

# Where each record keeps the address its person signed in or was written to under.
_PERSON_ADDRESS: Final[Mapping[Collection, Callable[[Mapping[str, Any]], Any]]] = {
    Collection.SPIELER: lambda row: row.get("email"),
    Collection.REGISTRIERUNGEN: lambda row: row.get("email"),
    Collection.SCHIEDSRICHTER: lambda row: (row.get("kontakt") or {}).get("email"),
}

# Where each record keeps a pending address change.
_ADRESSWECHSEL_FELD: Final = {Collection.SCHIEDSRICHTER: ADRESSWECHSEL_FELD, Collection.SPIELER: SPIELER_ADRESSWECHSEL_FELD}

# A choice line's standing against the restored record: to replay, replayed, already as the line left it, held by somebody
# else or in another state (listed and left), or a record the restored database does not hold.
Stand = Literal["to replay", "replayed", "already done", "left for review", "no such record"]

Write = Callable[[AsyncClientSession], Awaitable[Any]]


@dataclass(frozen=True)
class Read:
    """One journal line as a day file holds it."""

    timestamp: datetime
    line: JournalLine


@dataclass(frozen=True)
class Plan:
    stand: Stand
    write: Write | None = None


def read_day_files(lines: Iterable[str], *, since: datetime) -> tuple[list[Read], int]:
    """Every journal line written after `since`, oldest first and each once, and how many lines no act could be read off.

    A day file holds journal lines alone, so a line failing to read is counted rather than passed over in silence.
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
        # After the snapshot by the line's own instant, which follows its commit: a line a hair later than a snapshot
        # holding its write finds that write already standing, and replays nothing.
        if timestamp > since:
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
    """For each hash, every collection, document and field of the restored database holding an address that hashes to it.

    Every string value carrying an `@`, in every document of every collection: an erasure reaches an address wherever it
    is held, the log's images and every author field among them, so no list of fields could be the whole of it.
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
        # Only what still grants: the person's press moved a grant, and a choice already withheld has nothing to take back.
        gewaehlt: dict[FLEinwilligungWahl, Any] = {wahl: wert for wahl, wert in line.wahlen.items() if ist_erteilt(wahl, block.get(wahl))}
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
        update = compose_sitz_move(sitze=sitze, gewaehlt=line.wahlen, am=line.am, text_version=line.text_version)

    if update is None:
        return Plan("already done")

    async def write(session: AsyncClientSession) -> Any:
        return await patch_one_in_db(
            collection=collection, db_filter={"_id": row["_id"]}, update=update, session=session, return_document=ReturnDocument.BEFORE
        )

    return Plan("to replay", write)


async def _plan_widerspruch(
    line: JournalLine, database: AsyncDatabase, *, schluessel: SecretStr, session: AsyncClientSession | None, now: datetime
) -> Plan:
    assert line.collection is not None and line.am is not None
    collection = database[line.collection]
    row = await collection.find_one({"_id": line.record_id}, session=session)
    if row is None:
        return Plan("no such record")

    kontakte, bestaetigungen = row.get("kontakte") or {}, row.get("bestaetigungen")
    offen = [
        slot
        for slot in line.sitze
        if slot in KONTAKT_ROLLEN
        and isinstance(kontakte.get(slot), Mapping)
        and _holds(kontakte[slot].get("email"), line, schluessel)
        and not seat_is_answered(kontakte=kontakte, bestaetigungen=bestaetigungen, seat=slot)
    ]
    if not offen:
        emptied = all(slot in KONTAKT_ROLLEN and not isinstance(kontakte.get(slot), Mapping) for slot in line.sitze)
        return Plan("already done" if emptied else "left for review")

    # The German day the person declined on; the log's redaction below happens now, so its stamp is the replay's.
    declined_on = datetime.fromisoformat(line.am).astimezone(_GERMANY).strftime("%Y-%m-%d")

    async def write(session: AsyncClientSession) -> Any:
        return await take_widerspruch_in_session(
            collection=collection,
            aktionen_collection=database[Collection.AKTIONEN],
            row=row,
            seats=offen,
            today=declined_on,
            stamp=log_stamp(now),
            session=session,
        )

    return Plan("to replay", write)


async def _plan_adresswechsel(
    line: JournalLine, database: AsyncDatabase, *, schluessel: SecretStr, session: AsyncClientSession | None, now: datetime
) -> Plan:
    assert line.collection is not None
    feld = _ADRESSWECHSEL_FELD[line.collection]
    row = await database[line.collection].find_one({"_id": line.record_id}, {feld: 1}, session=session)
    if row is None:
        return Plan("no such record")

    wechsel = row.get(feld)
    if not isinstance(wechsel, Mapping):
        return Plan("already done")
    if not _holds(wechsel.get("email"), line, schluessel):
        return Plan("left for review")

    # The address judged above, so a change replaced since this plan was made is not taken with it.
    db_filter = {"_id": row["_id"], f"{feld}.email": wechsel["email"]}

    # The discard's body, which the person's decline runs too.
    async def write(session: AsyncClientSession) -> Any:
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

    return Plan("to replay", write)


async def plan(line: JournalLine, database: AsyncDatabase, *, schluessel: SecretStr, session: AsyncClientSession | None, now: datetime) -> Plan:
    """What replaying a choice's line would write on the restored record, judged in `session` where one is given."""

    match line.art:
        case "widerruf":
            return await _plan_widerruf(line, database, schluessel=schluessel, session=session)
        case "widerspruch":
            return await _plan_widerspruch(line, database, schluessel=schluessel, session=session, now=now)
        case "adresswechsel_abgelehnt":
            return await _plan_adresswechsel(line, database, schluessel=schluessel, session=session, now=now)
        case "loeschung":
            raise ValueError("an erasure is run again on its page, never replayed here")


async def replay(line: JournalLine, client: AsyncMongoClient, database: AsyncDatabase, *, schluessel: SecretStr, now: datetime) -> Stand:
    """Judge the line again inside one transaction and write it where it stands to be replayed.

    Recorded under the system actor, the call naming the line without its person, each line one action on the log's page.
    """

    request_token = request_var.set((REPLAY_METHOD, line.text(with_person=False)))
    trace_token = trace_id_var.set(resolve_trace_id(None))
    try:

        async def attempt(session: AsyncClientSession) -> Stand:
            planned = await plan(line, database, schluessel=schluessel, session=session, now=now)
            if planned.write is None:
                return planned.stand
            await planned.write(session)
            return "replayed"

        async with transaction_session(client) as session:
            return await session.with_transaction(attempt)
    finally:
        trace_id_var.reset(trace_token)
        request_var.reset(request_token)


async def run(
    lines: Iterable[str],
    *,
    since: datetime,
    apply: bool,
    client: AsyncMongoClient,
    database: AsyncDatabase,
    schluessel: SecretStr,
    now: datetime,
    out: TextIO,
) -> int:
    """List every line written after `since`, replaying each choice under `apply`; 0 once nothing is left, else 1.

    Prints no address and no person's hash: a line is named without its person, and an erasure by where its address is held.
    """

    read, unreadable = read_day_files(lines, since=since)
    held = await where_held(database, {entry.line.person_hash for entry in read if entry.line.art == "loeschung"}, schluessel=schluessel)
    print(f"Journal lines written after {since.isoformat()}: {len(read)}.", file=out)

    left = {"erasures to run": 0, "choices to replay": 0, "records to review": 0, "replays that failed": 0}
    for entry in read:
        line = entry.line
        print(f"\n{entry.timestamp.isoformat()}  {line.text(with_person=False)}", file=out)

        if line.art == "loeschung":
            places = held[line.person_hash]
            if not places:
                print("    its address is held nowhere in the restored database: nothing to run", file=out)
                continue
            left["erasures to run"] += 1
            for collection in sorted({place[0] for place in places}):
                found = [place for place in places if place[0] == collection]
                shown = ", ".join(f"{document_id} {path}" for _, document_id, path in found[:3])
                print(f"    held in {collection}: {len(found)} field(s), {shown}{', …' if len(found) > 3 else ''}", file=out)
            print("    run it again on „Löschung auf Anfrage“ with the address one of those records shows", file=out)
            continue

        try:
            stand = (
                await replay(line, client, database, schluessel=schluessel, now=now)
                if apply
                else (await plan(line, database, schluessel=schluessel, session=None, now=now)).stand
            )
        # The type alone: a driver's or a validator's message can quote the stored document, an address among it.
        except (PyMongoError, BaseAPIException) as failure:
            left["replays that failed"] += 1
            print(f"    failed, nothing written: {type(failure).__name__}", file=out)
            continue

        print(f"    {stand}", file=out)
        if stand == "to replay":
            left["choices to replay"] += 1
        elif stand == "left for review":
            left["records to review"] += 1

    if unreadable:
        left["unreadable lines"] = unreadable
    print(f"\nLeft: {', '.join(f'{count} {what}' for what, count in left.items())}.", file=out)

    return 1 if any(left.values()) else 0


def _main() -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.api.identitaet.wiederherstellung",
        description="Match the journal lines on stdin against the restored database, and replay the choices they name.",
    )
    parser.add_argument("--since", required=True, help="the instant the restored snapshot was taken, ISO 8601 with its offset")
    parser.add_argument("--apply", action="store_true", help="write every choice that stands to be replayed; erasures stay the page's")
    arguments = parser.parse_args()

    try:
        since = datetime.fromisoformat(arguments.since)
    except ValueError:
        parser.error("--since is no ISO 8601 instant")
    if since.tzinfo is None:
        parser.error("--since names no offset, so which instant it is depends on the clock reading it")

    config = get_config()

    async def main() -> int:
        client: AsyncMongoClient = AsyncMongoClient(
            host=config.mongodb_uri.get_secret_value(),
            serverSelectionTimeoutMS=config.db_server_selection_timeout,
            uuidRepresentation="standard",
        )
        try:
            return await run(
                sys.stdin,
                since=since,
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
