from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Annotated, Any, Final

from bson import ObjectId
from fastapi import APIRouter, Body, Depends
from pymongo import ASCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.api.bewerbungen.services import SWEEP_PAGE, group_seats_by_mailbox, mint_token
from app.api.saisons.cache import dropping_the_saison_cache
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, sperrliste_saison
from app.api.spielbestaetigungen.crud import anchor_the_seats_minted
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungGrund,
    FLSpielbestaetigungSweepAnfrage,
    FLSpielbestaetigungSweepAngefragtPayload,
    FLSpielbestaetigungSweepAngefragtResponse,
    FLSpielbestaetigungSweepEinteilung,
    FLSpielbestaetigungSweepEmpfaenger,
    FLSpielbestaetigungSweepLink,
    FLSpielbestaetigungSweepNeueAnsetzung,
    FLSpielbestaetigungSweepResponse,
    FLSpielbestaetigungSweepSaisonsResponse,
    FLSpielbestaetigungSweepSchiedsrichterNeueAnsetzung,
    FLSpielbestaetigungTermin,
)
from app.api.spielbestaetigungen.services import (
    AnsetzungLage,
    anfrage_is_due,
    ansetzung_stand_of,
    ansicht_ansetzung_of,
    build_anfrage_filter,
    build_answerable_filter,
    build_closable_filter,
    build_erinnerung_filter,
    build_held_filter,
    compose_closing_update,
    compose_erinnerung_update,
    compose_seats_update,
    compose_spielbestaetigung,
    grund_to_close,
    kontakt_adresse,
    link_groups,
    partei_key,
    parteien_of,
    seite_of,
    vereinsnamen_of,
)
from app.api.teams.schemas import KONTAKT_ROLLEN
from app.core.config import API_VERSION
from app.core.crud import patch_many_in_db, patch_one_in_db, post_many_to_db, pull_many_from_db, pull_one_from_db
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
    get_german_date_str,
)
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, DUPLICATE_KEY_RESPONSE, UNKNOWN_OUTCOME
from app.core.logging import fl_logger
from app.core.security import bind_system_actor, verify_access_system
from app.core.transactions import UNKNOWN_COMMIT_RESULT, Batch, diagnosis_of, refuse_a_stalled_page, run_isolated, transaction_session
from app.shared.schemas.bounds import LIST_LIMIT_MAX

# System tier and the system actor, for `app/api/bewerbungen/sweep_router.py`'s reason: the timer
# holds no session, and an invented administrator for a machine is what `SYSTEM_ACTOR` exists to avoid.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielbestaetigungen/sweep",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)

# The three shares together fit `app/core/middlewares.py :: REQUEST_DEADLINE_S` at a 36 ms round trip, beside the worst
# call's other commands and `getMore`s
# (`tests/api/test_spielbestaetigung_sweep_refusal.py :: test_a_full_share_finishes_inside_the_deadline_at_the_round_trip_its_comment_names`).
CLOSES_PER_PASS: Final = 25

# Counted in rows written, a fixture taken whole. With `REMINDERS_PER_PASS` at most `ANFRAGEN_LISTED_PER_PASS`, a
# reminder of a request never stamped going out as one: so one `/angefragt` call stamps every row a call answers.
MINTS_PER_PASS: Final = 26

REMINDERS_PER_PASS: Final = 25

WHAT: Final = "Confirmation"

CLOSE_FIELDS: Final = ["spiel_id", "partei", "ansetzung", "angefragt_am"]


def _by(rows: Iterable[Mapping[str, Any]], key: str) -> dict[Any, Mapping[str, Any]]:
    return {row[key]: row for row in rows}


async def _spiele(
    *, spiele_collection: AsyncCollection, saison_id: str, ids: Iterable[Any], session: AsyncClientSession
) -> dict[Any, Mapping[str, Any]]:
    wanted = list(set(ids))
    if not wanted:
        return {}

    return _by(
        await pull_many_from_db(
            collection=spiele_collection, db_filter={"saison_id": saison_id, "_id": {"$in": wanted}}, limit=LIST_LIMIT_MAX, session=session
        ),
        "_id",
    )


async def _junctions(
    *, saison_teams_collection: AsyncCollection, saison_id: str, team_ids: Iterable[Any], session: AsyncClientSession
) -> dict[Any, Mapping[str, Any]]:
    """The clubs' season rows: their seats as they stand now, their exit, and the name they play under."""

    wanted = list({team_id for team_id in team_ids if team_id is not None})
    if not wanted:
        return {}

    return _by(
        await pull_many_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "team_id": {"$in": wanted}},
            projection=["team_id", "name", "kontakte", "austritt"],
            limit=LIST_LIMIT_MAX,
            session=session,
        ),
        "team_id",
    )


def _austritte(junctions: Mapping[Any, Mapping[str, Any]]) -> dict[Any, str]:
    return {
        team_id: str(junction["austritt"]["datum"]) for team_id, junction in junctions.items() if isinstance(junction.get("austritt"), Mapping)
    }


async def _referee_addresses(
    *, schiedsrichter_collection: AsyncCollection, ids: Iterable[Any], session: AsyncClientSession
) -> dict[Any, str | None]:
    wanted = list(set(ids))
    if not wanted:
        return {}

    referees = await pull_many_from_db(
        collection=schiedsrichter_collection, db_filter={"_id": {"$in": wanted}}, projection=["kontakt"], limit=LIST_LIMIT_MAX, session=session
    )

    return {referee["_id"]: (referee.get("kontakt") or {}).get("email") or None for referee in referees}


async def _gesperrt(
    *,
    sperrliste: SperrlisteLookup,
    junctions: Mapping[Any, Mapping[str, Any]],
    massgebliche_saison_id: str | None,
    session: AsyncClientSession,
) -> set[str]:
    """Every seat address of these clubs the ban list holds, asked before a share is cut so it never fills with barred seats."""

    adressen = [
        adresse
        for junction in junctions.values()
        for seat in KONTAKT_ROLLEN
        if (adresse := kontakt_adresse(kontakte=junction.get("kontakte"), seat=seat))
    ]

    return await adressen_gesperrt(sperrliste, adressen, massgebliche_saison_id=massgebliche_saison_id, session=session)


@dataclass
class _Links:
    """The links one mint or reminder writes for a team row's seats, and what it answers."""

    hashes: dict[str, str] = field(default_factory=dict)
    links: list[FLSpielbestaetigungSweepLink] = field(default_factory=list)
    withheld: int = 0


def _mint_links(*, kontakte: Any, seats: Iterable[str], gesperrt: set[str]) -> _Links:
    """One fresh token per LINK over the occupied `seats` no ban holds; a barred seat is counted and written nothing, so it stays due."""

    occupied = [seat for seat in seats if kontakt_adresse(kontakte=kontakte, seat=seat) is not None]
    reachable = [seat for seat in occupied if kontakt_adresse(kontakte=kontakte, seat=seat) not in gesperrt]
    minted = _Links(withheld=len(occupied) - len(reachable))
    for gruppe in link_groups(kontakte=kontakte, seats=reachable):
        raw, token_hash = mint_token()
        minted.hashes.update(dict.fromkeys(gruppe, token_hash))
        minted.links.append(
            FLSpielbestaetigungSweepLink(address=str(kontakt_adresse(kontakte=kontakte, seat=gruppe[0])), rollen=gruppe, token=raw)
        )

    return minted


@dataclass
class _MintPlan:
    """One fixture's writes and answers; written whole or not at all, so a club is never asked while its opponent waits."""

    inserts: list[dict[str, Any]] = field(default_factory=list)
    updates: list[tuple[Any, Mapping[str, Any]]] = field(default_factory=list)
    anfragen: list[FLSpielbestaetigungSweepAnfrage] = field(default_factory=list)
    einteilungen: list[FLSpielbestaetigungSweepEinteilung] = field(default_factory=list)
    withheld: int = 0
    # The clubs a link was minted for, off their season rows' seats as the mint read them.
    seated: set[Any] = field(default_factory=set)

    @property
    def written(self) -> int:
        return len(self.inserts) + len(self.updates)


@router.get("", response_model=FLSpielbestaetigungSweepSaisonsResponse, summary="Every season the confirmation pass visits")
async def get_spiel_sweep_saisons(saisons_collection: SaisonsCollection) -> FLSpielbestaetigungSweepSaisonsResponse:
    """
    Answer every `active` season's id, oldest first, and the day a confirmation pass last ran over any of them.

    `active` alone: a confirmation serves no purpose once its season is over, and a season that ended with a fixture nobody
    entered a result for would otherwise be asked about a day long gone. System tier because this is the timer's own
    bookkeeping, asked by the process running the pass and by no page. Null means no pass has run over these seasons. Reading
    it writes nothing.
    """

    seasons = await pull_many_from_db(
        collection=saisons_collection,
        db_filter={"status": "active"},
        projection=["_id", "spiel_sweep_gelaufen_am"],
        sort_by=[("_id", ASCENDING)],
        limit=LIST_LIMIT_MAX,
    )

    return FLSpielbestaetigungSweepSaisonsResponse(
        saison_ids=[str(season["_id"]) for season in seasons],
        # The newest day any of them carries, for `GET /bewerbungen/sweep`'s reason: a season activated
        # since the last pass carries none.
        spiel_sweep_gelaufen_am=max(
            (str(season["spiel_sweep_gelaufen_am"]) for season in seasons if season.get("spiel_sweep_gelaufen_am")), default=None
        ),
    )


@router.post(
    "/{saison_id}",
    response_model=FLSpielbestaetigungSweepResponse,
    summary="Run one season's fixture confirmation pass",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
)
async def sweep_spielbestaetigungen(
    saison_id: str,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spiele_collection: SpieleCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSpielbestaetigungSweepResponse:
    """
    Close, mint and remind one season's fixture confirmations, as of today in Europe/Berlin, and answer what the caller must mail.

    The close shuts every row not yet closed, answered or not, whose fixture moved, was decided, was called off, lost a club
    to an `austritt` dated on or before its day, or -- a referee's row -- names another referee or none; failing all of
    those, a row whose fixture's day is before today closes `spiel_vergangen`, so nobody is asked about a past date. A
    team row closed for a move whose first request went out is answered in `neue_ansetzungen`, a referee's in
    `schiedsrichter_neue_ansetzungen`.

    The mint asks about every fixture dated strictly after today and at most the answer window ahead that has its time and
    ground, both sides, no result and no `sonderereignis`, and that the close would not shut: one row per side and one for
    its booked referee, unless a row about that party and that Ansetzung is still unclosed, or was closed `verworfen`: a
    decline the administrator discarded is the party's one answer to that Ansetzung. A fixture booked onto the erased
    referee's ghost gets no referee row, the ghost holding no address. The deadline is seven days before the fixture, or
    today where that has passed. Each seat holding an address gets one link, a person holding two seats one link naming
    both, and the raw tokens are answered in `anfragen` UNSTAMPED: the caller stamps what it mailed through `/angefragt`, so
    a request that never went out shows as never asked. An open row's occupied seat holding no link -- its holder replaced,
    newly seated, or a ban since lifted -- is minted one too and answered the same way. Referee rows are answered in
    `einteilungen`, with the referee's address and no token. A fixture holding rows about an Ansetzung it has left is asked
    on the pass whose close shuts them, so the notice that their links are void goes out first.

    The reminder mints a fresh link per seat on each row whose deadline is three or one days away, appended beside the links
    already mailed so every one of them still answers, and stamps the day BEFORE answering: a failed send costs one reminder,
    never a daily repeat. A row whose first request was never stamped as sent is answered in `anfragen` instead, its fresh
    links a request rather than a reminder of one that may never have arrived, and is stamped through `/angefragt` like any.

    A seat whose address the ban list holds is minted nothing and has nothing written, so it stays due and a later pass mints
    it once the ban is lifted; each pass logs how many seats it withheld, never which.

    Each step takes a bounded share and leaves the rest due. Everything answered was committed, and once a step has
    committed something owed a message, a later failure -- the stamp of the pass's day on this season included -- is logged
    and the call answers what committed. A row whose write or answer fails is passed over alone, logged by id and counted in
    `fehlgeschlagen`.

    A season that is not `active` is passed by whole -- nothing closed, minted, reminded or stamped, every list empty -- so a
    mistyped call, or one for a season ended since the listing, mails nobody. 404 where no season has the id.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"])
    # Every step's gate as well as the listing's, answered rather than refused: a mistyped call, or a season ended
    # between the listing and this call, mails nobody and writes nothing.
    if saison_raw.get("status") != "active":
        return FLSpielbestaetigungSweepResponse(
            saison_id=saison_id,
            anfragen=[],
            erinnerungen=[],
            einteilungen=[],
            neue_ansetzungen=[],
            schiedsrichter_neue_ansetzungen=[],
            geschlossen=0,
            fehlgeschlagen=0,
        )

    # Outside the transactions, whose callbacks may run again, as the application sweep reads it.
    massgebliche_saison_id = await sperrliste_saison(sperrliste)

    async def stamp_the_run(session: AsyncClientSession) -> None:
        """Inside the pass's last transaction, so a stamped day is a committed call; the read keeps a day to one log row."""

        stale = await pull_many_from_db(
            collection=saisons_collection,
            db_filter={"_id": saison_id, "spiel_sweep_gelaufen_am": {"$ne": today}},
            projection=["_id"],
            limit=1,
            session=session,
        )
        if not stale:
            return

        await patch_many_in_db(
            collection=saisons_collection, db_filter={"_id": saison_id}, update={"$set": {"spiel_sweep_gelaufen_am": today}}, session=session
        )

    async def close(
        session: AsyncClientSession, batch: Batch
    ) -> tuple[list[FLSpielbestaetigungSweepNeueAnsetzung], list[FLSpielbestaetigungSweepSchiedsrichterNeueAnsetzung], int]:
        """Judge every unclosed row against its fixture as it stands, then close a share. Read in-session, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=spielbestaetigungen_collection,
                db_filter=batch.within({"saison_id": saison_id, **build_closable_filter()}),
                # Oldest Ansetzung first, the likeliest to have been decided; `_id` keeps the page one page.
                sort_by=[("ansetzung.datum", ASCENDING), ("_id", ASCENDING)],
                # The season's every unclosed row: what the close and its notices read, and not each seat's hashes.
                projection=CLOSE_FIELDS,
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        spiele = await _spiele(spiele_collection=spiele_collection, saison_id=saison_id, ids=[row["spiel_id"] for row in rows], session=session)
        junctions = await _junctions(
            saison_teams_collection=saison_teams_collection,
            saison_id=saison_id,
            team_ids=[row["ansetzung"][side] for row in rows for side in ("team1_id", "team2_id")],
            session=session,
        )
        austritte = _austritte(junctions)

        def grund_of(row: Mapping[str, Any]) -> FLSpielbestaetigungGrund | None:
            return grund_to_close(row=row, spiel=spiele[row["spiel_id"]], austritte=austritte, today=today)

        gruende: dict[Any, FLSpielbestaetigungGrund] = {row["_id"]: grund for row, grund in batch.judged(rows, grund_of) if grund is not None}
        closable = [row for row in rows if row["_id"] in gruende]

        def notified(row: Mapping[str, Any]) -> bool:
            # A party never mailed is owed no notice that its link went void.
            return gruende[row["_id"]] == "ansetzung_geaendert" and row.get("angefragt_am") is not None

        adressen = await _referee_addresses(
            schiedsrichter_collection=schiedsrichter_collection,
            ids=[row["partei"]["schiedsrichter_id"] for row in closable if notified(row) and row["partei"]["art"] == "schiedsrichter"],
            session=session,
        )

        def notice_of(
            row: Mapping[str, Any],
        ) -> FLSpielbestaetigungSweepNeueAnsetzung | FLSpielbestaetigungSweepSchiedsrichterNeueAnsetzung | None:
            if not notified(row):
                return None

            ansetzung, partei = row["ansetzung"], row["partei"]
            # Named as the requests are, off the fixture as it stands: a club replaced since holds no season row to name it by.
            team1_name, team2_name = vereinsnamen_of(
                spielbestaetigung_raw=row, lage=AnsetzungLage(spiel=spiele[row["spiel_id"]], vereine=list(junctions.values()))
            )
            namen = {"team1_name": team1_name, "team2_name": team2_name}
            alt = FLSpielbestaetigungTermin(datum=ansetzung["datum"], uhrzeit=ansetzung["uhrzeit"])
            if partei["art"] == "schiedsrichter":
                address = adressen.get(partei["schiedsrichter_id"])
                return (
                    None
                    if address is None
                    else FLSpielbestaetigungSweepSchiedsrichterNeueAnsetzung(
                        spielbestaetigung_id=row["_id"], spiel_id=row["spiel_id"], alt=alt, address=address, **namen
                    )
                )

            # Read off the season row's seats as they stand now, a mailbox per message with no name in it. A replaced
            # club's people left with its row, their links voided by the replacement, so nobody is told.
            empfaenger = [
                FLSpielbestaetigungSweepEmpfaenger(address=address, rollen=rollen)
                for address, rollen in group_seats_by_mailbox(
                    kontakte=(junctions.get(partei["team_id"]) or {}).get("kontakte"), seats=KONTAKT_ROLLEN
                )
            ]
            return (
                FLSpielbestaetigungSweepNeueAnsetzung(
                    spielbestaetigung_id=row["_id"], spiel_id=row["spiel_id"], alt=alt, empfaenger=empfaenger, **namen
                )
                if empfaenger
                else None
            )

        # Notices built before any write, the share cut from the rows they carry: a refused row is closed by no attempt.
        taken = batch.judged(closable, notice_of)[: batch.share]
        batch.took([row for row, _ in taken])
        refuse_a_stalled_page(read=len(rows), moved=len(taken) + len(batch.refused), page=SWEEP_PAGE, clock="close", saison_id=saison_id)

        for row, _ in taken:
            await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": row["_id"], **build_closable_filter()},
                update=compose_closing_update(grund=gruende[row["_id"]], today=today),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )

        notices = [notice for _, notice in taken]

        return (
            [notice for notice in notices if isinstance(notice, FLSpielbestaetigungSweepNeueAnsetzung)],
            [notice for notice in notices if isinstance(notice, FLSpielbestaetigungSweepSchiedsrichterNeueAnsetzung)],
            len(taken),
        )

    async def mint(
        session: AsyncClientSession, batch: Batch
    ) -> tuple[list[FLSpielbestaetigungSweepAnfrage], list[FLSpielbestaetigungSweepEinteilung], int]:
        """Plan the window's fixtures, then write a share of rows, whole fixtures, soonest first. Read in-session, so a retry re-judges.

        Counts on the batch the page's seats a ban kept from a link, for the log line.
        """

        spiele = await batch.saw(
            pull_many_from_db(
                collection=spiele_collection,
                db_filter=batch.within(build_anfrage_filter(saison_id=saison_id, today=today)),
                # Soonest first, so the fixture whose deadline comes first is asked first.
                sort_by=[("datum", ASCENDING), ("uhrzeit", ASCENDING), ("_id", ASCENDING)],
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        if not spiele:
            return [], [], 0

        holding = await pull_many_from_db(
            collection=spielbestaetigungen_collection,
            db_filter=build_held_filter(saison_id=saison_id, spiel_ids=[spiel["_id"] for spiel in spiele]),
            limit=LIST_LIMIT_MAX + 1,
            session=session,
        )
        # A cut read would mint a second row for a party that already answered: raised, so the failure
        # halves the page (`app/core/transactions.py :: isolate`) until each half's rows fit one read.
        if len(holding) > LIST_LIMIT_MAX:
            raise ValueError(f"season {saison_id}'s window holds more held confirmations than one read answers")
        held = {(row["spiel_id"], partei_key(row["partei"]), row["ansetzung"]["stand"]): row for row in holding}
        stande = {spiel["_id"]: ansetzung_stand_of(spiel) for spiel in spiele}
        # A fixture holding rows about an Ansetzung it left waits for the close to shut them, a share's overflow or
        # a move since the close: their "link is void" notice goes out ahead of the fresh request (`docs/backend/spec.md :: I769`).
        waiting = {
            row["spiel_id"] for row in holding if row.get("geschlossen") is None and row["ansetzung"]["stand"] != stande[row["spiel_id"]]
        }

        junctions = await _junctions(
            saison_teams_collection=saison_teams_collection,
            saison_id=saison_id,
            team_ids=[spiel[side]["team_id"] for spiel in spiele for side in ("team1", "team2")],
            session=session,
        )
        austritte = _austritte(junctions)
        referees = await _referee_addresses(
            schiedsrichter_collection=schiedsrichter_collection,
            ids=[partei["schiedsrichter_id"] for spiel in spiele for partei in parteien_of(spiel) if partei["art"] == "schiedsrichter"],
            session=session,
        )
        gesperrt = await _gesperrt(sperrliste=sperrliste, junctions=junctions, massgebliche_saison_id=massgebliche_saison_id, session=session)

        def plan_of(spiel: Mapping[str, Any]) -> _MintPlan:
            plan = _MintPlan()
            if spiel["_id"] in waiting or not anfrage_is_due(spiel=spiel, austritte=austritte, today=today):
                return plan

            stand = stande[spiel["_id"]]
            for partei in parteien_of(spiel):
                existing = held.get((spiel["_id"], partei_key(partei), stand))
                if partei["art"] == "schiedsrichter":
                    if existing is None:
                        address = referees[partei["schiedsrichter_id"]]
                        if address is None:
                            raise ValueError(f"referee {partei['schiedsrichter_id']} holds no address to tell of the booking")
                        row = compose_spielbestaetigung(
                            row_id=ObjectId(), saison_id=saison_id, spiel=spiel, partei=partei, hashes={}, today=today
                        )
                        plan.inserts.append(row)
                        plan.einteilungen.append(
                            FLSpielbestaetigungSweepEinteilung(
                                spielbestaetigung_id=row["_id"],
                                spiel_id=spiel["_id"],
                                ansetzung=ansicht_ansetzung_of(spiel),
                                address=address,
                            )
                        )
                    continue

                kontakte = junctions[partei["team_id"]].get("kontakte")
                if existing is None:
                    seats: list[str] = list(KONTAKT_ROLLEN)
                # An answered or closed row, or one past its deadline, takes no link: its next press is refused.
                elif existing.get("antwort") is None and existing.get("geschlossen") is None and today <= existing["frist"]:
                    entries = existing.get("kontakte") or {}
                    seats = [seat for seat in KONTAKT_ROLLEN if entries.get(seat) is None]
                else:
                    continue

                minted = _mint_links(kontakte=kontakte, seats=seats, gesperrt=gesperrt)
                plan.withheld += minted.withheld
                if minted.hashes:
                    plan.seated.add(partei["team_id"])
                if existing is None:
                    row: Mapping[str, Any] = compose_spielbestaetigung(
                        row_id=ObjectId(), saison_id=saison_id, spiel=spiel, partei=partei, hashes=minted.hashes, today=today
                    )
                    plan.inserts.append(dict(row))
                else:
                    row = existing
                    if minted.hashes:
                        plan.updates.append((row["_id"], compose_seats_update(hashes=minted.hashes)))
                if minted.links:
                    plan.anfragen.append(
                        FLSpielbestaetigungSweepAnfrage(
                            spielbestaetigung_id=row["_id"],
                            spiel_id=spiel["_id"],
                            seite=seite_of(row),
                            ansetzung=ansicht_ansetzung_of(spiel),
                            frist=row["frist"],
                            links=minted.links,
                        )
                    )

            return plan

        planned = batch.judged(spiele, plan_of)
        batch.withheld = sum(plan.withheld for _, plan in planned)
        # Answers built before any write and the share cut from them, a fixture whole: a refused one writes
        # nothing, and the fixtures past the share stay due.
        room = MINTS_PER_PASS if batch.share is None else batch.share
        taken: list[tuple[Mapping[str, Any], _MintPlan]] = []
        for spiel, plan in planned:
            if not plan.written:
                continue
            if plan.written > room:
                break
            taken.append((spiel, plan))
            room -= plan.written
        batch.took([spiel for spiel, _ in taken])
        refuse_a_stalled_page(read=len(spiele), moved=len(taken) + len(batch.refused), page=SWEEP_PAGE, clock="mint", saison_id=saison_id)

        # Ahead of the writes, so a seat handed on since this attempt read is a conflict before any work rather than after.
        seated = [junctions[team_id]["_id"] for _, plan in taken for team_id in sorted(plan.seated, key=str)]
        if seated:
            await anchor_the_seats_minted(saison_teams_collection=saison_teams_collection, saison_team_ids=seated, session=session)

        inserts = [document for _, plan in taken for document in plan.inserts]
        if inserts:
            await post_many_to_db(collection=spielbestaetigungen_collection, documents=inserts, session=session)
        for _, plan in taken:
            for row_id, update in plan.updates:
                await patch_one_in_db(
                    collection=spielbestaetigungen_collection,
                    db_filter={"_id": row_id, **build_answerable_filter()},
                    update=update,
                    session=session,
                    return_document=ReturnDocument.BEFORE,
                )

        return (
            [anfrage for _, plan in taken for anfrage in plan.anfragen],
            [einteilung for _, plan in taken for einteilung in plan.einteilungen],
            sum(plan.written for _, plan in taken),
        )

    async def remind(session: AsyncClientSession, batch: Batch) -> list[tuple[FLSpielbestaetigungSweepAnfrage, bool]]:
        """Mint, stamp, stamp the run, then hand back, as the pass's last transaction. Read in-session, so a retry re-judges.

        Counts on the batch how many seats on the page a ban kept from their reminder, for the log line.
        """

        rows = await batch.saw(
            pull_many_from_db(
                collection=spielbestaetigungen_collection,
                db_filter=batch.within(build_erinnerung_filter(saison_id=saison_id, today=today)),
                sort_by=[("frist", ASCENDING), ("_id", ASCENDING)],
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        spiele = await _spiele(spiele_collection=spiele_collection, saison_id=saison_id, ids=[row["spiel_id"] for row in rows], session=session)
        junctions = await _junctions(
            saison_teams_collection=saison_teams_collection,
            saison_id=saison_id,
            team_ids=[row["ansetzung"][side] for row in rows for side in ("team1_id", "team2_id")],
            session=session,
        )
        austritte = _austritte(junctions)
        gesperrt = await _gesperrt(sperrliste=sperrliste, junctions=junctions, massgebliche_saison_id=massgebliche_saison_id, session=session)

        def reminder_of(row: Mapping[str, Any]) -> tuple[FLSpielbestaetigungSweepAnfrage | None, _Links]:
            spiel = spiele[row["spiel_id"]]
            # A row the close would shut answers no press, so a fresh link to it would be a dead one.
            if grund_to_close(row=row, spiel=spiel, austritte=austritte, today=today) is not None:
                return None, _Links()

            entries = row.get("kontakte") or {}
            minted = _mint_links(
                kontakte=junctions[row["partei"]["team_id"]].get("kontakte"),
                # Only a seat already holding a link: one without is the mint's to ask.
                seats=[seat for seat in KONTAKT_ROLLEN if entries.get(seat) is not None],
                gesperrt=gesperrt,
            )
            if not minted.links:
                return None, minted

            anfrage = FLSpielbestaetigungSweepAnfrage(
                spielbestaetigung_id=row["_id"],
                spiel_id=row["spiel_id"],
                seite=seite_of(row),
                ansetzung=ansicht_ansetzung_of(spiel),
                frist=row["frist"],
                links=minted.links,
            )
            return anfrage, minted

        judged = batch.judged(rows, reminder_of)
        batch.withheld = sum(minted.withheld for _, (_, minted) in judged)
        taken = [(row, (anfrage, minted)) for row, (anfrage, minted) in judged if anfrage is not None][: batch.share]
        batch.took([row for row, _ in taken])
        refuse_a_stalled_page(read=len(rows), moved=len(taken) + len(batch.refused), page=SWEEP_PAGE, clock="reminder", saison_id=saison_id)

        for row, (_, minted) in taken:
            # The stamp lands before the caller can mail: a crash between the two costs one reminder,
            # where the other order would repeat it every pass of the day until the address works.
            await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": row["_id"], **build_answerable_filter()},
                update=compose_erinnerung_update(hashes=minted.hashes, today=today),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )

        await stamp_the_run(session)

        # Each beside whether its first request was recorded as sent: a reminder of one that may never
        # have arrived would point at a link nobody holds.
        return [(anfrage, row.get("angefragt_am") is not None) for row, (anfrage, _) in taken if anfrage is not None]

    async def stamp_alone() -> None:
        async with transaction_session(db) as session:
            await session.with_transaction(stamp_the_run)

    owed = False
    fehlgeschlagen = 0

    async def after_what_is_owed[R](step: Callable[[], Awaitable[R]], *, clock: str, may_stand: Callable[[], str]) -> R | None:
        """`docs/backend/spec.md :: I753`: once a step committed something owed, a later failure is answered, not raised.

        `may_stand` names what the step's commit would have written, for a commit whose answer was lost.
        """

        try:
            return await step()
        except Exception as stop:
            if not owed:
                raise
            # The label, as `app/core/transactions.py :: _log_stopped` reads it: a lost answer may hide a commit.
            if isinstance(stop, PyMongoError) and stop.has_error_label(UNKNOWN_COMMIT_RESULT):
                fl_logger.warning(
                    f"The {clock} clock's commit went unanswered after the call committed messages it owes: {may_stand()} may have "
                    "been written with nobody told, the call answers what else committed, and the rest stay due",
                    extra={"error_code": UNKNOWN_OUTCOME},
                )
                return None
            code, diagnosis = diagnosis_of(stop)
            fl_logger.warning(
                f"The {clock} clock stopped at a failure ({diagnosis}) after the call committed messages it owes: "
                "the call answers what committed, and the rest stay due",
                extra={"error_code": code},
            )
            return None

    def taken_by(batch: Batch, noun: str) -> Callable[[], str]:
        return lambda: f"the {noun} {', '.join(map(str, batch.taken or batch.ids))}"

    closed, passed = await run_isolated(
        db=db,
        batch=Batch(share=CLOSES_PER_PASS),
        attempt=lambda session, batch: session.with_transaction(close, batch),
        moved=lambda answered: answered[2],
        owes=True,
        what=WHAT,
        clock="close",
    )
    fehlgeschlagen += len(passed)
    neue_ansetzungen = [notice for answered in closed for notice in answered[0]]
    schiedsrichter_neue_ansetzungen = [notice for answered in closed for notice in answered[1]]
    owed = bool(neue_ansetzungen or schiedsrichter_neue_ansetzungen)

    anfragen: list[FLSpielbestaetigungSweepAnfrage] = []
    einteilungen: list[FLSpielbestaetigungSweepEinteilung] = []
    mint_share = Batch(share=MINTS_PER_PASS)
    minted = await after_what_is_owed(
        lambda: run_isolated(
            db=db,
            batch=mint_share,
            attempt=lambda session, batch: session.with_transaction(mint, batch),
            moved=lambda answered: answered[2],
            owes=True,
            what=WHAT,
            clock="mint",
        ),
        clock="mint",
        may_stand=taken_by(mint_share, "rows minted for fixture(s)"),
    )
    if minted is not None:
        fehlgeschlagen += len(minted[1])
        anfragen = [anfrage for answered in minted[0] for anfrage in answered[0]]
        einteilungen = [einteilung for answered in minted[0] for einteilung in answered[1]]
        owed = owed or bool(anfragen or einteilungen)

    erinnerungen: list[FLSpielbestaetigungSweepAnfrage] = []
    reminder_share = Batch(share=REMINDERS_PER_PASS)
    if minted is not None:
        # The run's day is a season write, which the cache serves.
        with dropping_the_saison_cache():
            reminded = await after_what_is_owed(
                lambda: run_isolated(
                    db=db,
                    batch=reminder_share,
                    attempt=lambda session, batch: session.with_transaction(remind, batch),
                    moved=len,
                    owes=True,
                    what=WHAT,
                    clock="reminder",
                ),
                clock="reminder",
                may_stand=taken_by(reminder_share, "reminders of confirmation(s)"),
            )
            if reminded is not None:
                fehlgeschlagen += len(reminded[1])
                erinnerungen = [anfrage for answered in reminded[0] for anfrage, angefragt in answered if angefragt]
                anfragen += [anfrage for answered in reminded[0] for anfrage, angefragt in answered if not angefragt]
                # Every attempt that committed stamped the day; where none did, it is stamped alone, under the same
                # contract as every step after a message is owed.
                if not reminded[0]:
                    await after_what_is_owed(stamp_alone, clock="run stamp", may_stand=lambda: f"season {saison_id}'s day")

    # After the commits, so a retried transaction writes no second line. A count and never an id: a line
    # naming the row would tie its club to the ban for as long as the log is kept.
    if mint_share.withheld or reminder_share.withheld:
        fl_logger.info(
            f"Links withheld from barred addresses in season {saison_id}: {mint_share.withheld} seat(s) unminted, "
            f"{reminder_share.withheld} seat(s) unreminded"
        )

    return FLSpielbestaetigungSweepResponse(
        saison_id=saison_id,
        anfragen=anfragen,
        erinnerungen=erinnerungen,
        einteilungen=einteilungen,
        neue_ansetzungen=neue_ansetzungen,
        schiedsrichter_neue_ansetzungen=schiedsrichter_neue_ansetzungen,
        geschlossen=sum(answered[2] for answered in closed),
        fehlgeschlagen=fehlgeschlagen,
    )


@router.post(
    "/{saison_id}/angefragt",
    response_model=FLSpielbestaetigungSweepAngefragtResponse,
    summary="Stamp the confirmations whose first message went out",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
async def angefragt_spielbestaetigungen(
    saison_id: str,
    angefragt_data: Annotated[FLSpielbestaetigungSweepAngefragtPayload, Body()],
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSpielbestaetigungSweepAngefragtResponse:
    """
    Record that the first message about the rows named went out, team and referee rows alike.

    Every named row of this season not yet stamped is stamped today, answered or closed since or not: the stamp says the
    request was mailed, which a row closed for a move needs before its parties are told the date changed. A row already
    stamped keeps the day it has, and an id of another season is skipped. A row whose stamp fails is passed over alone,
    logged by id, left unstamped and counted in `fehlgeschlagen`. 404 where no season has the id. An empty list answers zero.
    """

    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])

    async def stamp_the_asked(session: AsyncClientSession, batch: Batch) -> int:
        """Judge and stamp in one transaction. Read in-session, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=spielbestaetigungen_collection,
                db_filter=batch.within(
                    {"saison_id": saison_id, "_id": {"$in": list(angefragt_data.spielbestaetigung_ids)}, "angefragt_am": None}
                ),
                projection=["_id"],
                limit=LIST_LIMIT_MAX,
                session=session,
            )
        )
        for row in batch.took(rows):
            await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": row["_id"], "angefragt_am": None},
                update={"$set": {"angefragt_am": today}},
                session=session,
                return_document=ReturnDocument.BEFORE,
            )

        return len(rows)

    stamped, passed = await run_isolated(
        db=db,
        batch=Batch(),
        attempt=lambda session, batch: session.with_transaction(stamp_the_asked, batch),
        moved=lambda count: count,
        owes=False,
        what=WHAT,
        clock="request stamp",
    )

    return FLSpielbestaetigungSweepAngefragtResponse(saison_id=saison_id, angefragt=sum(stamped), fehlgeschlagen=len(passed))
