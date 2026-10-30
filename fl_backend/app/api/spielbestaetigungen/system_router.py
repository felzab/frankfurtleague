from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Final, Literal

from bson import ObjectId
from fastapi import APIRouter, Depends
from pymongo import ASCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.bewerbungen.services import SWEEP_PAGE
from app.api.postausgang.crud import lagen_of
from app.api.postausgang.schemas import FLPostausgangLage, FLSpielAnfrageDaten, FLSpielEinteilungDaten
from app.api.postausgang.services import OwedMail, enqueue_mails
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, sperrliste_saison
from app.api.spielbestaetigungen.crud import anchor_the_mailboxes_told, anchor_the_referees_told, anchor_the_seats_minted
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungGrund,
    FLSpielbestaetigungSweepResponse,
    FLSpielbestaetigungSweepSaisonsResponse,
)
from app.api.spielbestaetigungen.services import (
    AnsetzungLage,
    anfrage_is_due,
    ansetzung_stand_of,
    ansicht_ansetzung_of,
    bezug_of,
    build_anfrage_filter,
    build_answerable_filter,
    build_erinnerung_filter,
    build_held_filter,
    build_holding_filter,
    compose_closing_update,
    compose_erinnerung_update,
    compose_seats_update,
    compose_spielbestaetigung,
    grund_to_close,
    grund_to_end,
    kontakt_adresse,
    link_groups,
    notice_daten_of,
    notice_owed,
    partei_key,
    parteien_of,
    seats_link,
    seite_of,
    spiel_mail_ansetzung_of,
    spiel_mail_termin_of,
    team_notices,
    vereinsnamen_of,
)
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, post_many_to_db, pull_many_from_db, pull_one_from_db
from app.core.dependencies import (
    DBClient,
    PostausgangCollection,
    SaisonsCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.security import bind_system_actor, verify_access_system
from app.core.transactions import Batch, refuse_a_stalled_page, run_isolated
from app.shared.schemas.bounds import LIST_LIMIT_MAX
from app.shared.schemas.literals import KONTAKT_ROLLEN, FLKontaktRolle

# System tier and the system actor, for `app/api/bewerbungen/system_router.py`'s reason: the timer
# holds no session, and an invented administrator for a machine is what `SYSTEM_ACTOR` exists to avoid.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielbestaetigungen/sweep",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)

# Each close costs three commands, logging the pre-image a restore needs, which a fan-out's count-only row
# loses; the budget in `fl_backend/tests/api/test_spielbestaetigung_sweep_refusal.py` holds the three shares below
# inside `app/core/middlewares.py :: REQUEST_DEADLINE_S` together, each step's mails owed in two commands of its own.
CLOSES_PER_PASS: Final = 19

# Counted in rows written, a fixture taken whole.
MINTS_PER_PASS: Final = 26

REMINDERS_PER_PASS: Final = 24

WHAT: Final = "Confirmation"

CLOSE_FIELDS: Final = ["spiel_id", "partei", "ansetzung", "angefragt_am", "geschlossen"]


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
    """The referees' addresses, an erased referee's absent."""

    wanted = list(set(ids))
    if not wanted:
        return {}

    referees = await pull_many_from_db(
        collection=schiedsrichter_collection,
        db_filter={"_id": {"$in": wanted}},
        projection=["kontakt.email"],
        limit=LIST_LIMIT_MAX,
        session=session,
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
    """The links one mint or reminder owes a team row's seats: each person's address and the seats one link answers."""

    groups: list[tuple[str, list[FLKontaktRolle]]] = field(default_factory=list)
    withheld: int = 0

    @property
    def emails(self) -> dict[str, str]:
        return {seat: address for address, seats in self.groups for seat in seats}


def _links_of(*, kontakte: Any, seats: Iterable[str], gesperrt: set[str]) -> _Links:
    """One link per person over the occupied `seats` no ban holds; a barred seat is counted and written nothing, so it stays due."""

    occupied = [seat for seat in seats if kontakt_adresse(kontakte=kontakte, seat=seat) is not None]
    reachable = [seat for seat in occupied if kontakt_adresse(kontakte=kontakte, seat=seat) not in gesperrt]

    return _Links(
        groups=[
            (str(kontakt_adresse(kontakte=kontakte, seat=gruppe[0])), gruppe) for gruppe in link_groups(kontakte=kontakte, seats=reachable)
        ],
        withheld=len(occupied) - len(reachable),
    )


def _anfrage(
    *,
    row: Mapping[str, Any],
    spiel: Mapping[str, Any],
    links: _Links,
    art: Literal["spiel_anfrage", "spiel_erinnerung"],
    schluessel_of: Callable[[str], str],
) -> list[OwedMail]:
    """A team row's request or reminder, one mail per link, each minting its link into the seats it answers."""

    ansicht = ansicht_ansetzung_of(spiel)
    team = ansicht.team1_name if seite_of(row) == "team1" else ansicht.team2_name
    daten = FLSpielAnfrageDaten(art=art, team=team, ansetzung=spiel_mail_ansetzung_of(ansicht), frist=row["frist"])

    return [
        OwedMail(
            schluessel=schluessel_of(seats[0]),
            an=address,
            daten=daten,
            bezug=bezug_of(spielbestaetigung_id=row["_id"], sitz=seats[0]),
            link=seats_link(seats),
        )
        for address, seats in links.groups
    ]


@dataclass
class _Closed:
    geschlossen: int
    mails: int


@dataclass
class _MintPlan:
    """One fixture's writes and mails; written whole or not at all, so a club is never asked while its opponent waits."""

    inserts: list[dict[str, Any]] = field(default_factory=list)
    updates: list[tuple[Any, Mapping[str, Any]]] = field(default_factory=list)
    mails: list[OwedMail] = field(default_factory=list)
    angefragt: int = 0
    # The clubs a link was owed for, off their season rows' seats as the mint read them.
    seated: set[Any] = field(default_factory=set)
    # The referees a row was written for, off the bookings the mint read.
    refereed: set[Any] = field(default_factory=set)
    # Each open row's seats minted afresh, which the reminder after the mint leaves to this request and no other seat.
    fresh: dict[Any, frozenset[str]] = field(default_factory=dict)

    @property
    def written(self) -> int:
        return len(self.inserts) + len(self.updates)


@dataclass
class _Minted:
    """What one mint transaction committed, and what the reminder after it must leave alone."""

    written: int
    angefragt: int
    mails: int
    inserted: list[Any]
    fresh: dict[Any, frozenset[str]]


@dataclass
class _Owed:
    """What the reminder step owes one row it read: its mails, and whether today counts as reminded."""

    mails: list[OwedMail] = field(default_factory=list)
    emails: dict[str, str] = field(default_factory=dict)
    marked: bool = False


@router.get("", response_model=FLSpielbestaetigungSweepSaisonsResponse, summary="Every season the confirmation pass visits")
async def get_sweep_saisons(saisons_collection: SaisonsCollection) -> FLSpielbestaetigungSweepSaisonsResponse:
    """
    Answer every `active` season's id, oldest first.

    `active` alone: a confirmation serves no purpose once its season is over, and a season that ended with a fixture nobody
    entered a result for would otherwise be asked about a day long gone. System tier because this is the timer's own
    bookkeeping, asked by the process running the pass and by no page. Reading it writes nothing.
    """

    seasons = await pull_many_from_db(
        collection=saisons_collection,
        db_filter={"status": "active"},
        projection=["_id"],
        sort_by=[("_id", ASCENDING)],
        limit=LIST_LIMIT_MAX,
    )

    return FLSpielbestaetigungSweepSaisonsResponse(saison_ids=[str(season["_id"]) for season in seasons])


@router.post(
    "/{saison_id}",
    response_model=FLSpielbestaetigungSweepResponse,
    summary="Run one season's fixture confirmation pass",
)
async def sweep_spielbestaetigungen(
    saison_id: str,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spiele_collection: SpieleCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    postausgang_collection: PostausgangCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> FLSpielbestaetigungSweepResponse:
    """
    Close, mint and remind one season's fixture confirmations, as of today in Europe/Berlin, and answer what it did, counted.

    Each mail is owed through the Postausgang in the transaction that writes its row.

    The close shuts every row not yet closed, answered or not, whose fixture moved, was decided, was called off, lost a club
    to an `austritt` dated on or before its day, or -- a referee's row -- names another referee or none; failing all of
    those, a row whose fixture's day is before today closes `spiel_vergangen`, so nobody is asked about a past date. A
    club's decline closed `verworfen` is closed again for each of those but a move and a referee change, in the pass
    that closes an agreement beside it, and once the day it was about has passed: the public fixture then stops
    counting it as that club's agreement.

    A closing owes its party a notice in its own transaction where the party's first request or Einteilung was owed,
    about a day today or later: for a move, the slot it left or the one the fixture holds now; for a referee taken off
    the fixture -- ahead of a move it shares a close with, and never for the referee's own decline, which closed its row
    as it was given -- and for a call-off, the slot the row was about. A club is told at every address its season row's
    seats hold now, a referee at the address their record holds; a party nobody is left to tell is told nothing.

    The mint asks about every fixture dated strictly after today and at most the answer window ahead that has its time and
    ground, both sides, no result and no `sonderereignis`, and that the close would not shut: one row per side and one for
    its booked referee, unless a row about that party and that Ansetzung is still unclosed, or was closed `verworfen`: a
    decline the administrator discarded is the party's one answer to that Ansetzung. A fixture booked onto the erased
    referee's ghost gets no referee row, the ghost holding no address. The deadline falls the notice period
    (`app/shared/schemas/bounds.py :: SPIEL_BESTAETIGUNG_FRIST_TAGE`) before the fixture, or today where that has passed.
    Each seat holding an address is owed one link, a person holding two seats one link naming both, each minted when the
    mail is handed out, and the row is stamped as asked; a referee row is owed its Einteilung, with no link. An open row's
    occupied seat holding no link -- its holder replaced, newly seated, or a ban since lifted -- is owed one too. A
    fixture holding an unclosed row about an Ansetzung it has left is asked once the close has shut it, the close owing
    its notice first.

    The reminder owes a fresh link per person on each team row whose deadline lies a reminder's count of days away
    (`app/shared/schemas/bounds.py :: SPIEL_ERINNERUNG_TAGE_ERSTE`, `:: SPIEL_ERINNERUNG_TAGE_ZWEITE`), minted beside the
    links already mailed so every one of them answers until the deadline, and stamps the day. It passes over each seat
    whose last mail did not arrive, and reminds no row this pass inserted nor one whose request was owed today; where
    this pass's mint owed one of a row's seats a fresh link, that request is the seat's message of the day and the row's
    other seats are reminded beside it.

    A seat whose address the ban list holds is owed nothing and has nothing written, so it stays due and a later pass asks
    it once the ban is lifted.

    Each step takes a bounded share and leaves the rest due. A row whose write fails is passed over alone, logged by id
    and counted in `fehlgeschlagen`; any other failure is raised, every step committed before it standing with its mails.

    A season that is not `active` is passed by whole -- nothing closed, minted or reminded -- so a mistyped call, or one for
    a season ended since the listing, mails nobody. 404 where no season has the id.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"])
    # Every step's gate as well as the listing's, answered rather than refused: a mistyped call, or a season ended
    # between the listing and this call, mails nobody and writes nothing.
    if saison_raw.get("status") != "active":
        return FLSpielbestaetigungSweepResponse(saison_id=saison_id, geschlossen=0, angefragt=0, erinnert=0, mails=0, fehlgeschlagen=0)

    # Outside the transactions, whose callbacks may run again, as the application sweep reads it.
    massgebliche_saison_id = await sperrliste_saison(sperrliste)

    async def close(session: AsyncClientSession, batch: Batch) -> _Closed:
        """Judge every row holding its question against its fixture as it stands, then close a share, owing each notice.

        Read in-session, so a retry re-judges.
        """

        rows = await batch.saw(
            pull_many_from_db(
                collection=spielbestaetigungen_collection,
                db_filter=batch.within({"saison_id": saison_id, **build_holding_filter()}),
                # Oldest Ansetzung first, the likeliest to have been decided; `_id` keeps the page one page.
                sort_by=[("ansetzung.datum", ASCENDING), ("_id", ASCENDING)],
                # The season's every row holding its question: what the close judges, and not each seat's hashes.
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
            return grund_to_end(row=row, spiel=spiele[row["spiel_id"]], austritte=austritte, today=today)

        gruende: dict[Any, FLSpielbestaetigungGrund] = {row["_id"]: grund for row, grund in batch.judged(rows, grund_of) if grund is not None}
        taken = batch.took([row for row in rows if row["_id"] in gruende][: batch.share])
        refuse_a_stalled_page(read=len(rows), moved=len(taken) + len(batch.refused), page=SWEEP_PAGE, clock="close", saison_id=saison_id)

        owing = [row for row in taken if notice_owed(row=row, grund=gruende[row["_id"]], spiel=spiele[row["spiel_id"]], today=today)]
        adressen = await _referee_addresses(
            schiedsrichter_collection=schiedsrichter_collection,
            ids=[row["partei"]["schiedsrichter_id"] for row in owing if row["partei"]["art"] == "schiedsrichter"],
            session=session,
        )

        mails: list[OwedMail] = []
        told_clubs: set[Any] = set()
        told_referees: set[Any] = set()
        for row in owing:
            grund, partei = gruende[row["_id"]], row["partei"]
            # Named as the requests are, off the fixture as it stands: a club replaced since holds no season row to name it by.
            namen = vereinsnamen_of(
                spielbestaetigung_raw=row, lage=AnsetzungLage(spiel=spiele[row["spiel_id"]], vereine=list(junctions.values()))
            )
            daten = notice_daten_of(grund=grund, partei_art=partei["art"], termin=spiel_mail_termin_of(spielbestaetigung_raw=row, namen=namen))
            if partei["art"] == "schiedsrichter":
                address = adressen.get(partei["schiedsrichter_id"])
                if address is not None:
                    told_referees.add(partei["schiedsrichter_id"])
                    mails.append(
                        OwedMail(
                            schluessel=f"spielbestaetigung/{row['_id']}/{grund}",
                            an=address,
                            daten=daten,
                            bezug=bezug_of(spielbestaetigung_id=row["_id"], sitz=None),
                        )
                    )
                continue

            # Read off the season row's seats as they stand now, a mailbox per message with no name in it. A replaced
            # club's people left with its row, their links voided by the replacement, so nobody is told.
            junction = junctions.get(partei["team_id"])
            if junction is None:
                continue
            told = team_notices(spielbestaetigung_raw=row, kontakte=junction.get("kontakte"), daten=daten, anlass=grund)
            if told:
                told_clubs.add(junction["_id"])
                mails += told

        # Ahead of the writes: what each mail's mailbox was read off, so a seat emptied or an address moved beside this
        # step conflicts with it rather than leaving the replaced mailbox told.
        if told_clubs:
            await anchor_the_mailboxes_told(
                saison_teams_collection=saison_teams_collection, saison_team_ids=sorted(told_clubs, key=str), session=session
            )
        if told_referees:
            await anchor_the_referees_told(
                schiedsrichter_collection=schiedsrichter_collection, schiedsrichter_ids=sorted(told_referees, key=str), session=session
            )

        for row in taken:
            await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": row["_id"], **build_holding_filter()},
                update=compose_closing_update(grund=gruende[row["_id"]], today=today),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )
        await enqueue_mails(postausgang_collection=postausgang_collection, session=session, mails=mails, now=now)

        return _Closed(geschlossen=len(taken), mails=len(mails))

    async def mint(session: AsyncClientSession, batch: Batch) -> _Minted:
        """Plan the window's fixtures, then write a share of rows, whole fixtures, soonest first, owing their mails.

        Read in-session, so a retry re-judges.
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
            return _Minted(written=0, angefragt=0, mails=0, inserted=[], fresh={})

        read = await pull_many_from_db(
            collection=spielbestaetigungen_collection,
            db_filter=build_held_filter(saison_id=saison_id, spiel_ids=[spiel["_id"] for spiel in spiele]),
            limit=LIST_LIMIT_MAX + 1,
            session=session,
        )
        # A cut read would mint a second row for a party that already answered: raised, so the failure
        # halves the page (`app/core/transactions.py :: isolate`) until each half's rows fit one read.
        if len(read) > LIST_LIMIT_MAX:
            raise ValueError(f"season {saison_id}'s window holds more held confirmations than one read answers")
        held = {(row["spiel_id"], partei_key(row["partei"]), row["ansetzung"]["stand"]): row for row in read}
        stande = {spiel["_id"]: ansetzung_stand_of(spiel) for spiel in spiele}
        # Waits on an unclosed row about an Ansetzung the fixture left, which a later close shuts and tells of first.
        waiting = {row["spiel_id"] for row in read if row["ansetzung"]["stand"] != stande[row["spiel_id"]] and row.get("geschlossen") is None}

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
                        address = referees.get(partei["schiedsrichter_id"])
                        if address is None:
                            raise ValueError(f"referee {partei['schiedsrichter_id']} holds no address to tell of the booking")
                        row = compose_spielbestaetigung(
                            row_id=ObjectId(), saison_id=saison_id, spiel=spiel, partei=partei, emails={}, today=today, angefragt=True
                        )
                        plan.inserts.append(row)
                        plan.refereed.add(partei["schiedsrichter_id"])
                        plan.angefragt += 1
                        plan.mails.append(
                            OwedMail(
                                schluessel=f"spielbestaetigung/{row['_id']}/einteilung",
                                an=address,
                                daten=FLSpielEinteilungDaten(
                                    art="spiel_einteilung", ansetzung=spiel_mail_ansetzung_of(ansicht_ansetzung_of(spiel))
                                ),
                                bezug=bezug_of(spielbestaetigung_id=row["_id"], sitz=None),
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

                links = _links_of(kontakte=kontakte, seats=seats, gesperrt=gesperrt)
                if links.groups:
                    plan.seated.add(partei["team_id"])
                if existing is None:
                    row = compose_spielbestaetigung(
                        row_id=ObjectId(),
                        saison_id=saison_id,
                        spiel=spiel,
                        partei=partei,
                        emails=links.emails,
                        today=today,
                        angefragt=bool(links.groups),
                    )
                    plan.inserts.append(row)
                elif links.groups:
                    row = existing
                    plan.updates.append(
                        (row["_id"], compose_seats_update(emails=links.emails, today=today, angefragt=existing.get("angefragt_am") is None))
                    )
                    plan.fresh[row["_id"]] = frozenset(links.emails)
                else:
                    continue
                if links.groups:
                    plan.angefragt += 1
                    # A fresh id in each key: a seat handed on and back the same day is owed again, and the stamps this
                    # transaction writes are what keep a later pass from owing it a second time.
                    plan.mails += _anfrage(
                        row=row,
                        spiel=spiel,
                        links=links,
                        art="spiel_anfrage",
                        schluessel_of=lambda sitz, row_id=row["_id"]: f"spielbestaetigung/{row_id}/anfrage/{sitz}/{ObjectId()}",
                    )

            return plan

        planned = batch.judged(spiele, plan_of)
        # Plans built before any write and the share cut from them, a fixture whole: a refused one writes
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
        refereed = sorted({referee for _, plan in taken for referee in plan.refereed}, key=str)
        if refereed:
            await anchor_the_referees_told(schiedsrichter_collection=schiedsrichter_collection, schiedsrichter_ids=refereed, session=session)

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
        mails = [mail for _, plan in taken for mail in plan.mails]
        await enqueue_mails(postausgang_collection=postausgang_collection, session=session, mails=mails, now=now)

        return _Minted(
            written=sum(plan.written for _, plan in taken),
            angefragt=sum(plan.angefragt for _, plan in taken),
            mails=len(mails),
            inserted=[document["_id"] for document in inserts],
            fresh={row_id: seats for _, plan in taken for row_id, seats in plan.fresh.items()},
        )

    async def remind(session: AsyncClientSession, batch: Batch) -> list[_Owed]:
        """Owe a share of the day's reminders and stamp them, as the pass's last transaction. Read in-session, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=spielbestaetigungen_collection,
                db_filter=batch.within(build_erinnerung_filter(saison_id=saison_id, today=today, inserted=minted_now.inserted)),
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
        lagen = await lagen_of(
            postausgang_collection=postausgang_collection,
            sammlung=Collection.SPIELBESTAETIGUNGEN,
            ids=[row["_id"] for row in rows],
            session=session,
        )

        def reached(lage: FLPostausgangLage | None) -> bool:
            return lage is None or not lage.unzustellbar

        def reminder_of(row: Mapping[str, Any]) -> _Owed:
            spiel = spiele[row["spiel_id"]]
            # A row the close would shut answers no press, so a fresh link to it would be a dead one.
            if grund_to_close(row=row, spiel=spiel, austritte=austritte, today=today) is not None:
                return _Owed()

            entries = row.get("kontakte") or {}
            # A seat this pass's mint asked has had today's message: the request just owed it.
            fresh = minted_now.fresh.get(row["_id"], frozenset())
            links = _links_of(
                kontakte=junctions[row["partei"]["team_id"]].get("kontakte"),
                # Only a seat already holding a link, one without being the mint's to ask.
                seats=[seat for seat in KONTAKT_ROLLEN if entries.get(seat) is not None and seat not in fresh],
                gesperrt=gesperrt,
            )
            # Never a person whose last mail did not arrive: a corrected address voids their seat for the mint to ask afresh.
            links.groups = [(address, seats) for address, seats in links.groups if reached(lagen.get((row["_id"], seats[0])))]
            if not links.groups:
                # Every seat that could be reminded was just asked, so the day is marked and a later pass sends it no reminder;
                # a barred seat keeps the row unmarked, due once its ban lifts.
                return _Owed(marked=bool(fresh) and not links.withheld)

            mails = _anfrage(
                row=row,
                spiel=spiel,
                links=links,
                art="spiel_erinnerung",
                schluessel_of=lambda sitz: f"spielbestaetigung/{row['_id']}/erinnerung/{today}/{sitz}",
            )
            return _Owed(mails=mails, emails=links.emails, marked=True)

        judged = batch.judged(rows, reminder_of)
        taken = [(row, owed) for row, owed in judged if owed.mails or owed.marked][: batch.share]
        batch.took([row for row, _ in taken])
        refuse_a_stalled_page(read=len(rows), moved=len(taken) + len(batch.refused), page=SWEEP_PAGE, clock="reminder", saison_id=saison_id)

        if taken:
            # Ahead of the writes, as the mint anchors them: the seats the reminders' mailboxes were read off.
            await anchor_the_seats_minted(
                saison_teams_collection=saison_teams_collection,
                saison_team_ids=sorted({junctions[row["partei"]["team_id"]]["_id"] for row, owed in taken if owed.mails}, key=str),
                session=session,
            )
        for row, owed in taken:
            await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": row["_id"], **build_answerable_filter()},
                update=compose_erinnerung_update(emails=owed.emails, today=today, erinnert=owed.marked),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )
        await enqueue_mails(
            postausgang_collection=postausgang_collection, session=session, mails=[mail for _, owed in taken for mail in owed.mails], now=now
        )

        return [owed for _, owed in taken]

    fehlgeschlagen = 0

    closed, passed = await run_isolated(
        db=db,
        batch=Batch(share=CLOSES_PER_PASS),
        attempt=close,
        moved=lambda answered: answered.geschlossen,
        owes=False,
        what=WHAT,
        clock="close",
    )
    fehlgeschlagen += len(passed)

    minted, passed = await run_isolated(
        db=db, batch=Batch(share=MINTS_PER_PASS), attempt=mint, moved=lambda answered: answered.written, owes=False, what=WHAT, clock="mint"
    )
    fehlgeschlagen += len(passed)
    # A row inserted this pass is wholly the mint's; a row it updated owes the reminder its other seats.
    minted_now = _Minted(
        written=sum(answered.written for answered in minted),
        angefragt=sum(answered.angefragt for answered in minted),
        mails=sum(answered.mails for answered in minted),
        inserted=[row_id for answered in minted for row_id in answered.inserted],
        fresh={row_id: seats for answered in minted for row_id, seats in answered.fresh.items()},
    )

    reminded, passed = await run_isolated(
        db=db, batch=Batch(share=REMINDERS_PER_PASS), attempt=remind, moved=len, owes=False, what=WHAT, clock="reminder"
    )
    fehlgeschlagen += len(passed)
    erinnert = [owed for answered in reminded for owed in answered if owed.mails]

    return FLSpielbestaetigungSweepResponse(
        saison_id=saison_id,
        geschlossen=sum(answered.geschlossen for answered in closed),
        angefragt=minted_now.angefragt,
        erinnert=len(erinnert),
        mails=sum(answered.mails for answered in closed) + minted_now.mails + sum(len(owed.mails) for owed in erinnert),
        fehlgeschlagen=fehlgeschlagen,
    )
