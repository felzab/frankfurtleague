from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Annotated, Any, Final

from bson import ObjectId
from fastapi import APIRouter, Body, Depends
from pymongo import ASCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.api.bewerbungen.services import SWEEP_PAGE, group_seats_by_mailbox, mint_token, seat_is_unreachable
from app.api.registrierungen.services import link_is_unreachable
from app.api.saisons.cache import dropping_the_saison_cache
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, sperrliste_saison
from app.api.spielbestaetigungen.crud import anchor_the_mailboxes_told, anchor_the_referees_told, anchor_the_seats_minted
from app.api.spielbestaetigungen.schemas import (
    MITTEILUNGEN_PER_PASS,
    FLSpielbestaetigungGrund,
    FLSpielbestaetigungSweepAnfrage,
    FLSpielbestaetigungSweepAngefragtPayload,
    FLSpielbestaetigungSweepAngefragtResponse,
    FLSpielbestaetigungSweepAufgegeben,
    FLSpielbestaetigungSweepEinteilung,
    FLSpielbestaetigungSweepEmpfaenger,
    FLSpielbestaetigungSweepLink,
    FLSpielbestaetigungSweepMitgeteiltPayload,
    FLSpielbestaetigungSweepMitgeteiltResponse,
    FLSpielbestaetigungSweepNeueAnsetzung,
    FLSpielbestaetigungSweepResponse,
    FLSpielbestaetigungSweepSaisonsResponse,
    FLSpielbestaetigungSweepSchiedsrichterGewechselt,
    FLSpielbestaetigungSweepSchiedsrichterNeueAnsetzung,
    FLSpielbestaetigungSweepSchiedsrichterSpielAbgesagt,
    FLSpielbestaetigungSweepSpielAbgesagt,
    FLSpielbestaetigungSweepVorschlagVerworfen,
    FLSpielbestaetigungTermin,
)
from app.api.spielbestaetigungen.services import (
    AnsetzungLage,
    anfrage_is_due,
    ansetzung_stand_of,
    ansicht_ansetzung_of,
    build_anfrage_filter,
    build_answerable_filter,
    build_erinnerung_filter,
    build_held_filter,
    build_holding_filter,
    build_mitteilung_filter,
    build_void_notice_held_filter,
    compose_closing_update,
    compose_erinnerung_update,
    compose_seats_update,
    compose_spielbestaetigung,
    grund_to_close,
    grund_to_end,
    kontakt_adresse,
    link_groups,
    mitteilung_spent,
    notice_holds,
    notice_owed,
    partei_key,
    parteien_of,
    seite_of,
    vereinsnamen_of,
    void_notice_held,
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

# Each close costs three commands, logging the pre-image a restore needs, which a fan-out's count-only row
# (`docs/backend/spec.md :: I40`) loses; a 20th close takes the worst call past
# `app/core/middlewares.py :: REQUEST_DEADLINE_S` at a 37 ms round trip
# (`tests/api/test_spielbestaetigung_sweep_refusal.py :: test_a_full_share_finishes_inside_the_deadline_at_the_round_trip_its_comment_names`).
CLOSES_PER_PASS: Final = 19

# Counted in rows written, a fixture taken whole. With `REMINDERS_PER_PASS` at most `ANFRAGEN_LISTED_PER_PASS`, a
# reminder of a request never stamped going out as one: so one `/angefragt` call stamps every row a call answers.
MINTS_PER_PASS: Final = 26

REMINDERS_PER_PASS: Final = 24

WHAT: Final = "Confirmation"

CLOSE_FIELDS: Final = ["spiel_id", "partei", "ansetzung", "angefragt_am", "geschlossen"]

# Each notice per closing reason that owes one (`app/api/spielbestaetigungen/services.py :: notice_owed`, and
# `:: verwerfen_owes_a_notice` for the discard's), by the party's kind.
TEAM_NOTICES: Final[
    Mapping[
        str,
        type[FLSpielbestaetigungSweepNeueAnsetzung | FLSpielbestaetigungSweepSpielAbgesagt | FLSpielbestaetigungSweepVorschlagVerworfen],
    ]
] = {
    "ansetzung_geaendert": FLSpielbestaetigungSweepNeueAnsetzung,
    "abgesagt": FLSpielbestaetigungSweepSpielAbgesagt,
    "verworfen": FLSpielbestaetigungSweepVorschlagVerworfen,
}
SCHIEDSRICHTER_NOTICES: Final[
    Mapping[
        str,
        type[
            FLSpielbestaetigungSweepSchiedsrichterNeueAnsetzung
            | FLSpielbestaetigungSweepSchiedsrichterGewechselt
            | FLSpielbestaetigungSweepSchiedsrichterSpielAbgesagt
        ],
    ]
] = {
    "ansetzung_geaendert": FLSpielbestaetigungSweepSchiedsrichterNeueAnsetzung,
    "schiedsrichter_gewechselt": FLSpielbestaetigungSweepSchiedsrichterGewechselt,
    "abgesagt": FLSpielbestaetigungSweepSchiedsrichterSpielAbgesagt,
}

# What a closed row holds for the party it shut a mailed request of.
type _Notice = (
    FLSpielbestaetigungSweepNeueAnsetzung
    | FLSpielbestaetigungSweepSpielAbgesagt
    | FLSpielbestaetigungSweepSchiedsrichterNeueAnsetzung
    | FLSpielbestaetigungSweepSchiedsrichterGewechselt
    | FLSpielbestaetigungSweepSchiedsrichterSpielAbgesagt
    | FLSpielbestaetigungSweepVorschlagVerworfen
)


@dataclass
class _Told:
    """What one notice transaction answered: the notices to mail, and those given up unsent."""

    notices: list[_Notice]
    aufgegeben: list[FLSpielbestaetigungSweepAufgegeben]


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


async def _referees(
    *, schiedsrichter_collection: AsyncCollection, ids: Iterable[Any], session: AsyncClientSession
) -> dict[Any, Mapping[str, Any]]:
    """The referees' addresses, and what the provider last said of a message to each, which their confirmation link carries."""

    wanted = list(set(ids))
    if not wanted:
        return {}

    return _by(
        await pull_many_from_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": {"$in": wanted}},
            projection=["kontakt.email", "bestaetigung.zustellung"],
            limit=LIST_LIMIT_MAX,
            session=session,
        ),
        "_id",
    )


def _address_of(referee: Mapping[str, Any]) -> str | None:
    return (referee.get("kontakt") or {}).get("email") or None


async def _referee_addresses(
    *, schiedsrichter_collection: AsyncCollection, ids: Iterable[Any], session: AsyncClientSession
) -> dict[Any, str | None]:
    referees = await _referees(schiedsrichter_collection=schiedsrichter_collection, ids=ids, session=session)

    return {referee_id: _address_of(referee) for referee_id, referee in referees.items()}


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

    anfragen: list[FLSpielbestaetigungSweepAnfrage]
    einteilungen: list[FLSpielbestaetigungSweepEinteilung]
    written: int
    inserted: list[Any]
    fresh: dict[Any, frozenset[str]]


@dataclass
class _Owed:
    """What the reminder step owes one row it read: a message or none, the links it minted, and whether today counts as reminded."""

    message: FLSpielbestaetigungSweepAnfrage | FLSpielbestaetigungSweepEinteilung | None = None
    links: _Links = field(default_factory=_Links)
    marked: bool = False


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
    club's decline closed `verworfen` is closed again for each of those but a move and a referee change, in the pass
    that closes an agreement beside it, and once the day it was about has passed: the public fixture then stops
    counting it as that club's agreement.

    A closing owes its party a notice where the party's first request or Einteilung went out, about a day today or later:
    for a move, the slot it left or the one the fixture holds now; for a referee taken off the fixture -- ahead of a move
    it shares a close with, and never for the referee's own decline, which closed its row as it was given -- and for a
    call-off, the slot the row was about. The closed row holds the
    notice, and the notice step answers a share of those the season's rows hold, each built off the fixture and the
    mailboxes or address as they stand: a team's move in `neue_ansetzungen`, a referee's in
    `schiedsrichter_neue_ansetzungen`, a referee taken off in `schiedsrichter_gewechselt`, a call-off in `spiel_abgesagt`
    and `schiedsrichter_spiel_abgesagt`, and the notice an administrator's discard holds, that the date stands, in
    `vorschlag_verworfen`. A notice is answered on every pass until the caller stamps it through
    `/mitgeteilt`; one answered as often as `app/api/spielbestaetigungen/services.py :: MITTEILUNG_VERSUCHE_HOECHSTENS`
    allows, or about no day still to come, is given up: answered in `mitteilungen_aufgegeben` by its row, its fixture
    and its party's kind, never a person, for the administrator to tell by hand, and answered so on every pass until
    `/mitgeteilt` stamps it too, so a lost answer loses no give-up. One with nobody left to tell, or whose closing the
    fixture has since undone -- reinstated, its referee booked again, back at the row's slot -- is dropped unanswered,
    the mint asking its party afresh.

    The mint asks about every fixture dated strictly after today and at most the answer window ahead that has its time and
    ground, both sides, no result and no `sonderereignis`, and that the close would not shut: one row per side and one for
    its booked referee, unless a row about that party and that Ansetzung is still unclosed, or was closed `verworfen`: a
    decline the administrator discarded is the party's one answer to that Ansetzung. A fixture booked onto the erased
    referee's ghost gets no referee row, the ghost holding no address. The deadline falls the notice period
    (`app/shared/schemas/bounds.py :: SPIEL_BESTAETIGUNG_FRIST_TAGE`) before the fixture, or today where that has passed.
    Each seat holding an address gets one link, a person holding two seats one link naming both, and the raw tokens are
    answered in `anfragen` UNSTAMPED: the caller stamps what it mailed through `/angefragt`, so a request that never went
    out shows as never asked. An open row's occupied seat holding no link -- its holder replaced,
    newly seated, or a ban since lifted -- is minted one too and answered the same way. Referee rows are answered in
    `einteilungen`, with the referee's address and no token. A fixture holding rows about an Ansetzung it has left is asked
    once the close has shut them and each one's notice that its links are void is answered, in this answer or an earlier
    one, so that notice goes out first.

    The reminder mints a fresh link per seat on each team row whose deadline lies a reminder's count of days away
    (`app/shared/schemas/bounds.py :: SPIEL_ERINNERUNG_TAGE_ERSTE`, `:: SPIEL_ERINNERUNG_TAGE_ZWEITE`), appended beside the
    links already mailed so every one of them answers until the deadline, and stamps the day BEFORE answering: a failed send
    costs one reminder, never a daily repeat. It passes over each seat whose last mail the provider refused, and reminds no
    row this pass inserted nor one whose request was stamped today; where this pass's mint gave one of a row's seats a fresh
    link, that request is the seat's message of the day and the row's other seats are reminded beside it.

    A row whose first request was never stamped as sent, inserted on an earlier pass, is asked again on every pass until a
    stamp lands or it stops taking an answer, a team row after its deadline and a referee row after the fixture's day: a
    team row in `anfragen`, with a fresh link per seat appended the same way and each
    refused seat passed over; a referee row in `einteilungen`, unless the provider refused the last mail recorded to the
    referee's address. A row with nobody left to ask is not asked and stays unstamped, so it shows as never asked.

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
            schiedsrichter_gewechselt=[],
            spiel_abgesagt=[],
            schiedsrichter_spiel_abgesagt=[],
            vorschlag_verworfen=[],
            geschlossen=0,
            fehlgeschlagen=0,
            mitteilungen_aufgegeben=[],
        )

    # Outside the transactions, whose callbacks may run again, as the application sweep reads it.
    massgebliche_saison_id = await sperrliste_saison(sperrliste)

    async def stamp_the_run(session: AsyncClientSession) -> None:
        """Inside the pass's last transaction, so a stamped day is a committed call; a day already stamped matches, writes and logs nothing."""

        await patch_many_in_db(
            collection=saisons_collection,
            # The day in the filter, as the application and registration passes stamp theirs: the later passes of a day match nothing.
            db_filter={"_id": saison_id, "spiel_sweep_gelaufen_am": {"$ne": today}},
            update={"$set": {"spiel_sweep_gelaufen_am": today}},
            session=session,
        )

    async def close(session: AsyncClientSession, batch: Batch) -> int:
        """Judge every row holding its question against its fixture as it stands, then close a share. Read in-session, so a retry re-judges.

        A closing owing a notice holds it in the same write, for the notice step.
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

        for row in taken:
            grund = gruende[row["_id"]]
            owed = notice_owed(row=row, grund=grund, spiel=spiele[row["spiel_id"]], today=today)
            await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": row["_id"], **build_holding_filter()},
                update=compose_closing_update(grund=grund, today=today, mitteilung=owed),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )

        return len(taken)

    async def tell(session: AsyncClientSession, batch: Batch) -> _Told:
        """Answer a share of the notices the season's closed rows hold.

        The grants' claim, stamp and cap, with the row as the outbox: their record ends, this row lives on. No lease:
        one process runs the pass (`docs/ops/spec.md :: I149`).
        """

        rows = await batch.saw(
            pull_many_from_db(
                collection=spielbestaetigungen_collection,
                db_filter=batch.within(build_mitteilung_filter(saison_id=saison_id)),
                sort_by=[("ansetzung.datum", ASCENDING), ("_id", ASCENDING)],
                projection=CLOSE_FIELDS,
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        # The share cut before the reads it needs, every held row being one it answers or drops: read for the page, the
        # fixtures, clubs and referees would cost a season's `getMore`s the close's share pays for (`CLOSES_PER_PASS`).
        share = rows if batch.share is None else rows[: batch.share]
        spiele = await _spiele(
            spiele_collection=spiele_collection, saison_id=saison_id, ids=[row["spiel_id"] for row in share], session=session
        )
        junctions = await _junctions(
            saison_teams_collection=saison_teams_collection,
            saison_id=saison_id,
            team_ids=[row["ansetzung"][side] for row in share for side in ("team1_id", "team2_id")],
            session=session,
        )
        adressen = await _referee_addresses(
            schiedsrichter_collection=schiedsrichter_collection,
            ids=[row["partei"]["schiedsrichter_id"] for row in share if row["partei"]["art"] == "schiedsrichter"],
            session=session,
        )

        def notice_of(row: Mapping[str, Any]) -> _Notice | FLSpielbestaetigungSweepAufgegeben | None:
            """The notice this row holds, given up where spent, or `None` where its closing was undone or nobody is left to tell."""

            spiel = spiele[row["spiel_id"]]
            # Ahead of the spend, and dropped rather than given up: a given-up notice warns the administrator to tell its
            # party by hand, and a closing undone leaves nothing to tell.
            if not notice_holds(row=row, spiel=spiel):
                return None

            # Held, unwritten, until `/mitgeteilt` stamps it, as a notice is: cleared here, a lost answer would lose it.
            if mitteilung_spent(row=row, spiel=spiel, today=today):
                return FLSpielbestaetigungSweepAufgegeben(
                    spielbestaetigung_id=row["_id"], spiel_id=row["spiel_id"], partei=row["partei"]["art"]
                )

            ansetzung, partei, grund = row["ansetzung"], row["partei"], row["geschlossen"]["grund"]
            # Named as the requests are, off the fixture as it stands: a club replaced since holds no season row to name it by.
            team1_name, team2_name = vereinsnamen_of(
                spielbestaetigung_raw=row, lage=AnsetzungLage(spiel=spiele[row["spiel_id"]], vereine=list(junctions.values()))
            )
            namen = {"team1_name": team1_name, "team2_name": team2_name}
            alt = FLSpielbestaetigungTermin(datum=ansetzung["datum"], uhrzeit=ansetzung["uhrzeit"])
            if partei["art"] == "schiedsrichter":
                address = adressen.get(partei["schiedsrichter_id"])
                if address is None:
                    return None
                return SCHIEDSRICHTER_NOTICES[grund](
                    spielbestaetigung_id=row["_id"], spiel_id=row["spiel_id"], alt=alt, address=address, **namen
                )

            # Read off the season row's seats as they stand now, a mailbox per message with no name in it. A replaced
            # club's people left with its row, their links voided by the replacement, so nobody is told.
            empfaenger = [
                FLSpielbestaetigungSweepEmpfaenger(address=address, rollen=rollen)
                for address, rollen in group_seats_by_mailbox(
                    kontakte=(junctions.get(partei["team_id"]) or {}).get("kontakte"), seats=KONTAKT_ROLLEN
                )
            ]
            if not empfaenger:
                return None
            return TEAM_NOTICES[grund](spielbestaetigung_id=row["_id"], spiel_id=row["spiel_id"], alt=alt, empfaenger=empfaenger, **namen)

        judged = batch.judged(share, notice_of)
        batch.took([row for row, _ in judged])
        taken = [(row, notice) for row, notice in judged if not isinstance(notice, FLSpielbestaetigungSweepAufgegeben)]
        refuse_a_stalled_page(read=len(rows), moved=len(judged) + len(batch.refused), page=SWEEP_PAGE, clock="notice", saison_id=saison_id)

        # Ahead of the writes: what each answer's mailbox was read off, so a seat emptied or an address moved beside this
        # step conflicts with it rather than leaving the replaced mailbox told (`docs/backend/spec.md :: I762`).
        told_clubs = sorted(
            {
                junctions[row["partei"]["team_id"]]["_id"]
                for row, notice in taken
                if notice is not None and row["partei"]["art"] == "team" and row["partei"]["team_id"] in junctions
            },
            key=str,
        )
        if told_clubs:
            await anchor_the_mailboxes_told(saison_teams_collection=saison_teams_collection, saison_team_ids=told_clubs, session=session)
        told_referees = sorted(
            {row["partei"]["schiedsrichter_id"] for row, notice in taken if notice is not None and row["partei"]["art"] == "schiedsrichter"},
            key=str,
        )
        if told_referees:
            await anchor_the_referees_told(
                schiedsrichter_collection=schiedsrichter_collection, schiedsrichter_ids=told_referees, session=session
            )

        # Bookkeeping on rows the close already imaged, so a fan-out each, logged by filter and count (`docs/backend/spec.md :: I40`).
        answered = [row["_id"] for row, notice in taken if notice is not None]
        if answered:
            await patch_many_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": {"$in": answered}, **build_mitteilung_filter(saison_id=saison_id)},
                update={"$inc": {"geschlossen.mitteilung.versuche": 1}},
                session=session,
            )
        dropped = [row["_id"] for row, notice in taken if notice is None]
        if dropped:
            await patch_many_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": {"$in": dropped}, **build_mitteilung_filter(saison_id=saison_id)},
                update={"$set": {"geschlossen.mitteilung": None}},
                session=session,
            )

        return _Told(
            notices=[notice for _, notice in taken if notice is not None],
            aufgegeben=[notice for _, notice in judged if isinstance(notice, FLSpielbestaetigungSweepAufgegeben)],
        )

    async def mint(session: AsyncClientSession, batch: Batch) -> _Minted:
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
            return _Minted(anfragen=[], einteilungen=[], written=0, inserted=[], fresh={})

        spiel_ids = [spiel["_id"] for spiel in spiele]
        # One read for both, a second command taking the worst call past its deadline
        # (`tests/api/test_spielbestaetigung_sweep_refusal.py :: SWEEP_OTHER_COMMANDS`).
        read = await pull_many_from_db(
            collection=spielbestaetigungen_collection,
            db_filter={
                "$or": [
                    build_held_filter(saison_id=saison_id, spiel_ids=spiel_ids),
                    build_void_notice_held_filter(saison_id=saison_id, spiel_ids=spiel_ids),
                ]
            },
            limit=LIST_LIMIT_MAX + 1,
            session=session,
        )
        # A cut read would mint a second row for a party that already answered: raised, so the failure
        # halves the page (`app/core/transactions.py :: isolate`) until each half's rows fit one read.
        if len(read) > LIST_LIMIT_MAX:
            raise ValueError(f"season {saison_id}'s window holds more held confirmations than one read answers")
        held = {(row["spiel_id"], partei_key(row["partei"]), row["ansetzung"]["stand"]): row for row in read if not void_notice_held(row)}
        stande = {spiel["_id"]: ansetzung_stand_of(spiel) for spiel in spiele}
        # Waits on a row about an Ansetzung the fixture left while it is unclosed or holds a notice this pass did not
        # answer; one answered now is mailed ahead of the request (`docs/backend/spec.md :: I769`).
        waiting = {
            row["spiel_id"]
            for row in read
            if row["ansetzung"]["stand"] != stande[row["spiel_id"]]
            and (row.get("geschlossen") is None or (void_notice_held(row) and row["_id"] not in angekuendigt))
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
                        plan.refereed.add(partei["schiedsrichter_id"])
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
                        plan.fresh[row["_id"]] = frozenset(minted.hashes)
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

        return _Minted(
            anfragen=[anfrage for _, plan in taken for anfrage in plan.anfragen],
            einteilungen=[einteilung for _, plan in taken for einteilung in plan.einteilungen],
            written=sum(plan.written for _, plan in taken),
            inserted=[document["_id"] for document in inserts],
            fresh={row_id: seats for _, plan in taken for row_id, seats in plan.fresh.items()},
        )

    async def remind(session: AsyncClientSession, batch: Batch) -> list[tuple[Any, _Owed]]:
        """Mint, stamp, stamp the run, then hand back, as the pass's last transaction. Read in-session, so a retry re-judges.

        Counts on the batch how many seats on the page a ban kept from their reminder, for the log line.
        """

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
        referees = await _referees(
            schiedsrichter_collection=schiedsrichter_collection,
            ids=[row["partei"]["schiedsrichter_id"] for row in rows if row["partei"]["art"] == "schiedsrichter"],
            session=session,
        )

        def einteilung_of(row: Mapping[str, Any], spiel: Mapping[str, Any]) -> _Owed:
            referee = referees.get(row["partei"]["schiedsrichter_id"])
            address = None if referee is None else _address_of(referee)
            # Passed over where the provider refused the referee's last recorded mail, as a seat is: an address corrected since
            # mints their confirmation link afresh, and with it the record this reads.
            if referee is None or address is None or link_is_unreachable(bestaetigung=referee.get("bestaetigung")):
                return _Owed()

            return _Owed(
                message=FLSpielbestaetigungSweepEinteilung(
                    spielbestaetigung_id=row["_id"], spiel_id=row["spiel_id"], ansetzung=ansicht_ansetzung_of(spiel), address=address
                )
            )

        def reminder_of(row: Mapping[str, Any]) -> _Owed:
            spiel = spiele[row["spiel_id"]]
            # A row the close would shut answers no press, so a fresh link to it would be a dead one.
            if grund_to_close(row=row, spiel=spiel, austritte=austritte, today=today) is not None:
                return _Owed()

            if row["partei"]["art"] == "schiedsrichter":
                return einteilung_of(row, spiel)

            entries = row.get("kontakte") or {}
            erinnert = row.get("angefragt_am") is not None
            # A seat this pass's mint asked has had today's message: the request just written for it.
            fresh = minted_now.fresh.get(row["_id"], frozenset())
            minted = _mint_links(
                kontakte=junctions[row["partei"]["team_id"]].get("kontakte"),
                # Only a seat already holding a link, one without being the mint's to ask; and never one whose last mail the
                # provider refused, which a corrected address voids for the mint to ask afresh.
                seats=[
                    seat
                    for seat in KONTAKT_ROLLEN
                    if entries.get(seat) is not None and seat not in fresh and not seat_is_unreachable(bestaetigungen=entries, seat=seat)
                ],
                gesperrt=gesperrt,
            )
            if not minted.links:
                # Every seat that could be reminded was just asked, so the day is marked and a later pass sends it no reminder;
                # a barred seat keeps the row unmarked, due once its ban lifts.
                return _Owed(links=minted, marked=erinnert and bool(fresh) and not minted.withheld)

            anfrage = FLSpielbestaetigungSweepAnfrage(
                spielbestaetigung_id=row["_id"],
                spiel_id=row["spiel_id"],
                seite=seite_of(row),
                ansetzung=ansicht_ansetzung_of(spiel),
                frist=row["frist"],
                links=minted.links,
            )
            return _Owed(message=anfrage, links=minted, marked=erinnert)

        judged = batch.judged(rows, reminder_of)
        batch.withheld = sum(owed.links.withheld for _, owed in judged)
        taken = [(row, owed) for row, owed in judged if owed.message is not None or owed.marked][: batch.share]
        batch.took([row for row, _ in taken])
        refuse_a_stalled_page(read=len(rows), moved=len(taken) + len(batch.refused), page=SWEEP_PAGE, clock="reminder", saison_id=saison_id)

        # Ahead of the writes, as the mint anchors them: an Einteilung asked again writes nothing to its row, which the
        # referee's erasure deletes.
        told = sorted(
            {row["partei"]["schiedsrichter_id"] for row, owed in taken if isinstance(owed.message, FLSpielbestaetigungSweepEinteilung)}, key=str
        )
        if told:
            await anchor_the_referees_told(schiedsrichter_collection=schiedsrichter_collection, schiedsrichter_ids=told, session=session)

        for row, owed in taken:
            if row["partei"]["art"] != "team":
                continue
            # The stamp lands before the caller can mail: a crash between the two costs one reminder,
            # where the other order would repeat it every pass of the day until the address works.
            await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": row["_id"], **build_answerable_filter()},
                update=compose_erinnerung_update(hashes=owed.links.hashes, today=today, erinnert=owed.marked),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )

        await stamp_the_run(session)

        return [(row["_id"], owed) for row, owed in taken]

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

    # Owing nothing in its answer: a notice it owes is held on the row it closes, for the step after it.
    closed, passed = await run_isolated(
        db=db,
        batch=Batch(share=CLOSES_PER_PASS),
        attempt=lambda session, batch: session.with_transaction(close, batch),
        moved=lambda count: count,
        owes=False,
        what=WHAT,
        clock="close",
    )
    fehlgeschlagen += len(passed)

    told, passed = await run_isolated(
        db=db,
        batch=Batch(share=MITTEILUNGEN_PER_PASS),
        attempt=lambda session, batch: session.with_transaction(tell, batch),
        moved=lambda answered: len(answered.notices) + len(answered.aufgegeben),
        owes=True,
        what=WHAT,
        clock="notice",
    )
    fehlgeschlagen += len(passed)
    notices = [notice for answered in told for notice in answered.notices]
    neue_ansetzungen = [notice for notice in notices if isinstance(notice, FLSpielbestaetigungSweepNeueAnsetzung)]
    schiedsrichter_neue_ansetzungen = [notice for notice in notices if isinstance(notice, FLSpielbestaetigungSweepSchiedsrichterNeueAnsetzung)]
    schiedsrichter_gewechselt = [notice for notice in notices if isinstance(notice, FLSpielbestaetigungSweepSchiedsrichterGewechselt)]
    spiel_abgesagt = [notice for notice in notices if isinstance(notice, FLSpielbestaetigungSweepSpielAbgesagt)]
    schiedsrichter_spiel_abgesagt = [notice for notice in notices if isinstance(notice, FLSpielbestaetigungSweepSchiedsrichterSpielAbgesagt)]
    vorschlag_verworfen = [notice for notice in notices if isinstance(notice, FLSpielbestaetigungSweepVorschlagVerworfen)]
    mitteilungen_aufgegeben = [notice for answered in told for notice in answered.aufgegeben]
    # The rows whose notice this answer carries, mailed or given up: the mint asks their fixture beside them.
    angekuendigt = {notice.spielbestaetigung_id for notice in [*notices, *mitteilungen_aufgegeben]}
    owed = bool(notices)

    anfragen: list[FLSpielbestaetigungSweepAnfrage] = []
    einteilungen: list[FLSpielbestaetigungSweepEinteilung] = []
    mint_share = Batch(share=MINTS_PER_PASS)
    minted = await after_what_is_owed(
        lambda: run_isolated(
            db=db,
            batch=mint_share,
            attempt=lambda session, batch: session.with_transaction(mint, batch),
            moved=lambda answered: answered.written,
            owes=True,
            what=WHAT,
            clock="mint",
        ),
        clock="mint",
        may_stand=taken_by(mint_share, "rows minted for fixture(s)"),
    )
    if minted is not None:
        fehlgeschlagen += len(minted[1])
        anfragen = [anfrage for answered in minted[0] for anfrage in answered.anfragen]
        einteilungen = [einteilung for answered in minted[0] for einteilung in answered.einteilungen]
        owed = owed or bool(anfragen or einteilungen)

    erinnerungen: list[FLSpielbestaetigungSweepAnfrage] = []
    reminder_share = Batch(share=REMINDERS_PER_PASS)
    if minted is not None:
        # A row inserted this pass is wholly the mint's; a row it updated owes the reminder its other seats
        # (`docs/backend/spec.md :: I767`).
        minted_now = _Minted(
            anfragen=anfragen,
            einteilungen=einteilungen,
            written=sum(answered.written for answered in minted[0]),
            inserted=[row_id for answered in minted[0] for row_id in answered.inserted],
            fresh={row_id: seats for answered in minted[0] for row_id, seats in answered.fresh.items()},
        )
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
                # A team row's message beside whether its first request was recorded as sent: a reminder of one that may
                # never have arrived would point at a link nobody holds, so it goes out worded as the request.
                owed_now = [owed for answered in reminded[0] for _, owed in answered]
                erinnerungen = [owed.message for owed in owed_now if isinstance(owed.message, FLSpielbestaetigungSweepAnfrage) and owed.marked]
                anfragen += [owed.message for owed in owed_now if isinstance(owed.message, FLSpielbestaetigungSweepAnfrage) and not owed.marked]
                einteilungen += [owed.message for owed in owed_now if isinstance(owed.message, FLSpielbestaetigungSweepEinteilung)]
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
        schiedsrichter_gewechselt=schiedsrichter_gewechselt,
        spiel_abgesagt=spiel_abgesagt,
        schiedsrichter_spiel_abgesagt=schiedsrichter_spiel_abgesagt,
        vorschlag_verworfen=vorschlag_verworfen,
        geschlossen=sum(closed),
        fehlgeschlagen=fehlgeschlagen,
        mitteilungen_aufgegeben=mitteilungen_aufgegeben,
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


@router.post(
    "/{saison_id}/mitgeteilt",
    response_model=FLSpielbestaetigungSweepMitgeteiltResponse,
    summary="Stamp the confirmations whose notice went out",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
async def mitgeteilt_spielbestaetigungen(
    saison_id: str,
    mitgeteilt_data: Annotated[FLSpielbestaetigungSweepMitgeteiltPayload, Body()],
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
) -> FLSpielbestaetigungSweepMitgeteiltResponse:
    """
    Record that the notices about the rows named went out, or were given up and logged, so no later pass answers them again.

    Every named row of this season still holding its notice stops holding it. A row holding none -- stamped already,
    dropped, or never owing one -- and an id of another season are left alone and not counted. No claim is checked:
    one process runs the pass, so no second pass can hold the rows named (`docs/ops/spec.md :: I149`). One
    transaction, recorded under the system actor. 404 where no season has the id. An empty list answers zero.
    """

    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])
    ids = sorted(set(mitgeteilt_data.spielbestaetigung_ids), key=str)
    if not ids:
        return FLSpielbestaetigungSweepMitgeteiltResponse(saison_id=saison_id, mitgeteilt=0)

    async def stamp(session: AsyncClientSession) -> int:
        result = await patch_many_in_db(
            collection=spielbestaetigungen_collection,
            db_filter={"_id": {"$in": ids}, **build_mitteilung_filter(saison_id=saison_id)},
            update={"$set": {"geschlossen.mitteilung": None}},
            session=session,
        )

        return result.modified_count

    async with transaction_session(db) as session:
        mitgeteilt = await session.with_transaction(stamp)

    return FLSpielbestaetigungSweepMitgeteiltResponse(saison_id=saison_id, mitgeteilt=mitgeteilt)
