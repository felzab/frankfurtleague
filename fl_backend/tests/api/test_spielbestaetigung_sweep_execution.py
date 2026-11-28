from collections import Counter
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any, Literal, cast
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.system_router import get_sweep_saisons
from app.api.spielbestaetigungen.person_router import post_schiedsrichter_answer, post_team_answer
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungAppointment,
    FLSpielbestaetigungSchiedsrichterAnswerPayload,
    FLSpielbestaetigungSweepResponse,
    FLSpielbestaetigungTeamAnswerPayload,
)
from app.api.spielbestaetigungen.services import (
    ansetzung_values_of,
    build_holding_filter,
    compose_ansetzung,
    compose_answer_update,
    compose_closing_update,
    compose_spielbestaetigung,
)
from app.api.spiele.admin_router import patch_spiel
from app.api.spiele.schemas import FLPatchSpielDataPayload, FLPatchSpielDataResponse
from app.api.spiele.services import ANSETZUNG_CONFIRMED, build_spiele_pipeline
from app.api.teams.admin_router import replace_saison_team
from app.api.teams.schemas import FLReplaceSaisonTeamPayload
from app.core.clock import days_after
from app.core.codes import Code
from app.core.collections import Collection
from app.shared.schemas.bounds import SPIEL_CONFIRMATION_DEADLINE_DAYS
from app.shared.schemas.literals import KONTAKT_SEATS
from tests import documents
from tests.database import a_clean_database
from tests.documents import kontaktperson_document
from tests.erasure import erased
from tests.isolation import COMMITTED, InterleavedCollection, Rival, RowsThenTheRival, outcome_of
from tests.payloads import spiel_patch_body
from tests.records import record_collections
from tests.spielbestaetigung_corpus import (
    ALPHA,
    BETA,
    GAMMA,
    NAMES,
    NEXT_WEEK,
    NOW,
    OTHER_REFEREE_EMAIL,
    OTHER_SCHIEDSRICHTER,
    PAST_SAISON_ID,
    REFEREE_EMAIL,
    SAISON_ID,
    SCHIEDSRICHTER,
    SEATS,
    SPIEL,
    TODAY,
    Pass,
    a_pass,
    a_spiel,
    address,
    booked,
    clock_of,
    handed_out,
    junction,
    kontakte,
    rows,
    seated,
    side,
    sweep,
    the_league,
)
from tests.worker import worker_database

# Module level, as the other execution suites mark theirs: every test below reaches a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spielbestaetigung_sweep_test")


YESTERDAY = "2126-03-31"

OTHER_SPIEL = ObjectId("6890a1b2c3d4e5f6077500d2")
PAST_SPIEL = ObjectId("6890a1b2c3d4e5f6077500d3")
TODAYS_SPIEL = ObjectId("6890a1b2c3d4e5f6077500d4")
FRESH_SPIEL = ObjectId("6890a1b2c3d4e5f6077500d5")
CALLED_OFF_SPIEL = ObjectId("6890a1b2c3d4e5f6077500d6")


def mailed_row(*, spiel: Mapping[str, Any], party: Mapping[str, Any], asked_at: str | None, **fields: Any) -> dict[str, Any]:
    """A row an earlier pass wrote, as the mint writes it."""

    row = compose_spielbestaetigung(
        row_id=ObjectId(),
        saison_id=fields.pop("saison_id", SAISON_ID),
        spiel=spiel,
        party=party,
        today=fields.pop("today", days_after(day=TODAY, days=-10)),
        asked=asked_at is not None,
    )

    return {**row, "asked_at": asked_at, **fields}


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


async def on_a_league(url: str, body: Body, *, spiele: list[dict[str, Any]], junctions: list[dict[str, Any]] | None = None) -> Any:
    """The SHIPPED indexes, and the league `the_league` seeds."""

    async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
        await the_league(database, spiele=spiele, junctions=junctions)

        return await body(database, client)


# --- What a pass owed, read back off the Postausgang as the drain hands it out: each mail's recipient and its kind,
# grouped by the row it is about.


async def a_pass_through(database: AsyncDatabase, client: AsyncMongoClient, **collections: Any) -> Pass:
    """One pass, the collections named handed through a stand-in, and the drain after it."""

    return await handed_out(database, client, await a_pass(database, client, **collections), now=NOW)


async def move(
    database: AsyncDatabase, client: AsyncMongoClient, spiel_id: ObjectId, *, spiele: Any = None, **overrides: Any
) -> FLPatchSpielDataResponse:
    """Through the administrator's own save, so the state the pass compares is the one a real edit leaves; its dry run's answer.

    Confirming the later results its dry run says it deletes, as the editor's question does. `spiele` is the fixtures
    the save itself writes through, a stand-in where a case names one; the dry run reads the database's.
    """

    stored = await database[Collection.SPIELE].find_one({"_id": spiel_id})
    assert stored is not None
    payload = FLPatchSpielDataPayload.model_validate(spiel_patch_body(stored, **overrides))

    # Named one by one rather than spread from a dictionary, which no type check reads through.
    async def saved(spiel_data: FLPatchSpielDataPayload, *, dry_run: bool) -> FLPatchSpielDataResponse:
        async with client.start_session(snapshot=True) as session:
            return await patch_spiel(
                spiel_id=spiel_id,
                spiel_data=spiel_data,
                db=client,
                spiele_collection=database[Collection.SPIELE] if dry_run or spiele is None else spiele,
                teams_collection=database[Collection.TEAMS],
                saisons_collection=database[Collection.SAISONS],
                saison_teams_collection=database[Collection.SAISON_TEAMS],
                spieltage_collection=database[Collection.SPIELTAGE],
                spielorte_collection=database[Collection.SPIELORTE],
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                spielberichte_collection=database[Collection.SPIELBERICHTE],
                aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
                spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
                germany_now=NOW,
                dry_run=dry_run,
                session=session,
            )

    asked = await saved(payload, dry_run=True)
    await saved(payload.model_copy(update={"voided_ergebnisse": asked.voided_ergebnisse}), dry_run=False)

    return asked


async def press_answer(database: AsyncDatabase, client: AsyncMongoClient, row_id: Any, team_id: ObjectId) -> Any:
    """A club's Zusage to one of its rows, its Trainer signed in."""

    return await post_team_answer(
        spielbestaetigung_id=row_id,
        answer_data=FLSpielbestaetigungTeamAnswerPayload(answer="agreed", vorschlag=None, reason=None),
        identifier=address(team_id, "trainer"),
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spiele_collection=database[Collection.SPIELE],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spieltage_collection=database[Collection.SPIELTAGE],
        records=record_collections(database),
        db=client,
        germany_now=NOW,
    )


async def refusal_of(database: AsyncDatabase, client: AsyncMongoClient, row_id: Any, team_id: ObjectId) -> str:
    """The code a press on this row meets now, or `COMMITTED` where it is taken."""

    return await outcome_of(press_answer(database, client, row_id, team_id))


def row_of(stored: list[Mapping[str, Any]], *, team_id: Any = None, schiedsrichter_id: Any = None) -> Mapping[str, Any]:
    """The one row of a party; two would be the double mint a case is about."""

    found = [
        row
        for row in stored
        if (team_id is not None and row["party"].get("team_id") == team_id)
        or (schiedsrichter_id is not None and row["party"].get("schiedsrichter_id") == schiedsrichter_id)
    ]
    assert len(found) == 1, found
    return found[0]


class TestTheSweepAsksAboutNothingItCannotHelp:
    """Both halves driven: `has_taken_place` reads a record and never a date, and the copied listing reads every season."""

    async def test_a_pass_asks_about_the_coming_spiel_alone(self, mongo_replica_set_url: str):
        """Today's fixture is the floor's edge; the past season's is dated inside the window, so only the season keeps it out."""

        spiele = [
            a_spiel(SPIEL, 1, NEXT_WEEK),
            a_spiel(OTHER_SPIEL, 2, YESTERDAY),
            a_spiel(TODAYS_SPIEL, 3, TODAY),
            a_spiel(PAST_SPIEL, 1, NEXT_WEEK, saison_id=PAST_SAISON_ID),
        ]
        # The past season's clubs seated too, so nothing but its status can keep its fixture unasked.
        junctions = [junction(team_id, saison_id=saison_id) for saison_id in (SAISON_ID, PAST_SAISON_ID) for team_id in (ALPHA, BETA)]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            listing = await get_sweep_saisons(saisons_collection=database[Collection.SAISONS], status="active")
            # As the timer runs it, and the past season asked directly as a mistyped call would.
            answers = [await sweep(database, client, saison_id=saison_id) for saison_id in [*listing.saison_ids, PAST_SAISON_ID]]

            return listing.saison_ids, answers, sorted({(row["saison_id"], str(row["spiel_id"])) for row in await rows(database)})

        listed, answers, asked = await on_a_league(mongo_replica_set_url, body, spiele=spiele, junctions=junctions)

        assert listed == [SAISON_ID]
        assert len(answers) == 2
        assert asked == [(SAISON_ID, str(SPIEL))]

    async def test_the_same_pass_twice_owes_each_mail_once(self, mongo_replica_set_url: str):
        """The rows the first pass stamped in the transaction owing their mails are what the second finds asked."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await sweep(database, client)
            second = await a_pass(database, client)
            owed = await database[Collection.OUTBOX].find({}, {"to": 1, "kind": 1, "_id": 0}).to_list()

            return first, second, owed, await rows(database)

        first, second, owed, stored = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert (len(first.requests), len(first.einteilungen), second.mails) == (2, 1, 0)
        # One row per recipient: each seat's confirmed holder asked, and the referee told.
        assert sorted((mail["kind"], mail["to"]) for mail in owed) == sorted(
            [
                ("spiel_einteilung", REFEREE_EMAIL),
                *[("spiel_request", address(team_id, seat)) for team_id in (ALPHA, BETA) for seat in KONTAKT_SEATS],
            ]
        )
        assert {row["asked_at"] for row in stored} == {TODAY}


class TestTheWindow:
    """A request answers at most its answer window, so a fixture is asked once its deadline is that window away and not before."""

    async def test_a_spiel_twenty_one_days_out_is_asked_and_twenty_two_is_not(self, mongo_replica_set_url: str):
        spiele = [a_spiel(SPIEL, 1, days_after(day=TODAY, days=21)), a_spiel(OTHER_SPIEL, 2, days_after(day=TODAY, days=22))]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            return await rows(database)

        stored = await on_a_league(mongo_replica_set_url, body, spiele=spiele)

        assert {row["spiel_id"] for row in stored} == {SPIEL}
        assert {row["deadline"] for row in stored} == {days_after(day=TODAY, days=14)}


def answered(answer: Literal["agreed", "declined"]) -> dict[str, Any]:
    """A seat's answer as its press stores it, a decline proposing the day after."""

    return compose_answer_update(
        answer=answer,
        seat="trainer",
        vorschlag=FLSpielbestaetigungAppointment(date=days_after(day=NEXT_WEEK, days=1), time="18:00:00") if answer == "declined" else None,
        reason="Klassenfahrt" if answer == "declined" else None,
        today=TODAY,
    )


async def discard(database: AsyncDatabase, team_id: ObjectId) -> None:
    """The discard's write as it closes the declining club's own row, its decline standing."""

    declined = {"$set": {**answered("declined")["$set"], **compose_closing_update(reason="discarded")["$set"]}}
    await database[Collection.SPIELBESTAETIGUNGEN].update_one({"party.team_id": team_id}, declined)


async def verdict(database: AsyncDatabase) -> bool | None:
    cursor = await database[Collection.SPIELE].aggregate(build_spiele_pipeline(db_filter={"_id": SPIEL}))
    (document,) = await cursor.to_list()

    return document[ANSETZUNG_CONFIRMED]


async def alphas_discard_beside_betas_agreement(database: AsyncDatabase, client: AsyncMongoClient) -> ObjectId:
    """Every row asked and mailed, so a notice the close owed would be answered; the discarded row's id."""

    await sweep(database, client)
    await discard(database, ALPHA)
    await database[Collection.SPIELBESTAETIGUNGEN].update_one({"party.team_id": BETA}, answered("agreed"))

    return row_of(await rows(database), team_id=ALPHA)["_id"]


class TestADiscardedDeclineIsNotAskedAgain:
    """A club declines once per Ansetzung, so the decline the administrator discarded is its answer."""

    async def test_the_declining_team_is_asked_nothing_until_the_spiel_moves(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await discard(database, BETA)
            discarded = await sweep(database, client)
            await move(database, client, SPIEL, time="19:00:00")
            moved = await sweep(database, client)

            return discarded, moved

        discarded, moved = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        left = {"team1": "Alpha", "team2": "Beta", "date": NEXT_WEEK, "time": "18:00:00"}
        assert (discarded.requests, discarded.einteilungen) == ([], [])
        # Beta too is asked naming the slot left: its discard told it that slot stands, and a request naming none would
        # leave that slot standing beside the new one.
        assert sorted((request.side, request.moved_from) for request in moved.requests) == [("team1", left), ("team2", left)]

    async def test_a_fixture_whose_every_row_is_a_discard_is_asked_at_once_about_a_move_past_the_window(self, mongo_replica_set_url: str):
        """No referee booked, so nothing but the two discards holds a question about the fixture.

        Left to the window, both clubs would keep the slot they were told stands for months, and its kick-off would end
        both discards telling nobody.
        """

        moved_to = days_after(day=TODAY, days=60)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await discard(database, ALPHA)
            await discard(database, BETA)
            await move(database, client, SPIEL, date=moved_to)

            return await sweep(database, client)

        moved = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK, schiedsrichter=None)])

        left = {"team1": "Alpha", "team2": "Beta", "date": NEXT_WEEK, "time": "18:00:00"}
        assert sorted((request.side, request.ansetzung.date, request.moved_from) for request in moved.requests) == [
            ("team1", moved_to, left),
            ("team2", moved_to, left),
        ]
        assert moved.new_ansetzungen == []

    async def test_a_move_onto_today_ends_the_discard_and_tells_every_party_promising_nothing(self, mongo_replica_set_url: str):
        """Nobody is asked about a match on its own day, so the close step's notice is the last mail about it, to every party.

        Kept as the club's answer to the slot left, the discard would tell it nothing, and the slot it was told stands
        would end telling nobody.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await discard(database, BETA)
            await move(database, client, SPIEL, date=TODAY)

            return await sweep(database, client), row_of(await rows(database), team_id=BETA)

        told, discarded = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        today = {"team1": "Alpha", "team2": "Beta", "date": TODAY, "time": "18:00:00", "spielort": "Sportpark"}
        assert (told.closed, told.requests, told.einteilungen) == (3, [], [])
        # Alpha's row unanswered, Beta's the discard: each club told of the slot it was asked about.
        assert sorted(
            (sorted(r.address for r in notice.recipient), notice.old.date, notice.moved_to, notice.stays) for notice in told.new_ansetzungen
        ) == [(sorted(address(team_id, seat) for seat in KONTAKT_SEATS), NEXT_WEEK, today, True) for team_id in (ALPHA, BETA)]
        assert [(notice.moved_to, notice.stays) for notice in told.schiedsrichter_new_ansetzungen] == [(today, True)]
        assert discarded["closed"] == {"reason": "ansetzung_changed", "discarded": True, "matched": False}

    async def test_moved_away_and_back_it_is_asked_again_as_an_agreeing_team_is(self, mongo_replica_set_url: str):
        """The first move ended the discard, so back on its slot the club is asked afresh, the move named in its request.

        One rule for every answer: a move ends it, and the party is asked about the slot the fixture holds. Kept through
        the move instead, the discard would be the club's answer to the slot left beside its newer row, each owing a
        notice of the next change.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await discard(database, BETA)
            await move(database, client, SPIEL, time="19:00:00")
            await sweep(database, client)
            await move(database, client, SPIEL, time="18:00:00")

            return await sweep(database, client)

        back = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        left = {"team1": "Alpha", "team2": "Beta", "date": NEXT_WEEK, "time": "19:00:00"}
        assert back.new_ansetzungen == []
        assert sorted((request.side, request.ansetzung.time, request.moved_from) for request in back.requests) == [
            ("team1", "18:00:00", left),
            ("team2", "18:00:00", left),
        ]

    @pytest.mark.parametrize(
        "moved",
        [
            pytest.param({"date": days_after(day=NEXT_WEEK, days=-2)}, id="to an earlier day"),
            pytest.param({"time": "17:00:00"}, id="to an earlier hour of the day"),
        ],
    )
    async def test_an_asked_move_is_told_once_in_its_request_and_never_again_on_the_new_day(
        self, mongo_replica_set_url: str, moved: dict[str, Any]
    ):
        """The request names the slot left; a second notice on the match day would tell a move the club may have agreed to."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await discard(database, BETA)
            await move(database, client, SPIEL, **moved)
            asked = await sweep(database, client)
            spiel = await database[Collection.SPIELE].find_one({"_id": SPIEL})
            assert spiel is not None
            # The discard, the first of Beta's rows, ended by the mint asking Beta about the new slot.
            ended = (await rows(database, **{"party.team_id": BETA}))[0]["closed"]

            return asked, ended, await sweep(database, client, today=spiel["date"])

        asked, ended, on_its_day = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        left = {"team1": "Alpha", "team2": "Beta", "date": NEXT_WEEK, "time": "18:00:00"}
        assert [
            (request.side, request.moved_from, sorted(recipient.address for recipient in request.recipients)) for request in asked.requests
        ] == [
            ("team1", left, sorted(address(ALPHA, seat) for seat in KONTAKT_SEATS)),
            ("team2", left, sorted(address(BETA, seat) for seat in KONTAKT_SEATS)),
        ]
        assert (asked.new_ansetzungen, on_its_day.new_ansetzungen) == ([], [])
        assert ended == {"reason": "ansetzung_changed", "discarded": True}

    @pytest.mark.parametrize(
        "change",
        [
            pytest.param("onto today", id="moved onto today"),
            pytest.param("called off", id="called off"),
            pytest.param("taken off", id="its club taken off"),
        ],
    )
    async def test_a_change_after_an_asked_move_tells_the_discarded_team_once(self, mongo_replica_set_url: str, change: str):
        """Asked about the move, the club holds one question about the fixture, so the next change tells it once.

        Kept beside the request, the discard would owe a second notice of the same change, naming a slot the club was told
        two moves ago is gone, and the save question would name the club twice.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await discard(database, BETA)
            await move(database, client, SPIEL, time="19:00:00")
            await sweep(database, client)
            named: list[str] = []
            if change == "onto today":
                named = [party.name for party in (await move(database, client, SPIEL, date=TODAY)).recipients or []]
            elif change == "called off":
                await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"sonderereignis": "ausgefallen"}})
            else:
                # The bracket's own write, which re-fields a side and touches no season row.
                await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"team2": side(GAMMA)}})

            return named, await sweep(database, client)

        named, told = await on_a_league(
            mongo_replica_set_url,
            body,
            spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)],
            junctions=[junction(ALPHA), junction(BETA), documents.saison_team_document(SAISON_ID, GAMMA, *NAMES[GAMMA])],
        )

        if change == "onto today":
            assert sorted(named) == ["Alpha", "Beta", "Pfiff"]
        notices = [*told.new_ansetzungen, *told.spiel_cancelled]
        betas = [notice for notice in notices if {recipient.address for recipient in notice.recipient} & {address(BETA, "trainer")}]
        assert [(notice.old.time, sorted(recipient.address for recipient in notice.recipient)) for notice in betas] == [
            ("19:00:00", sorted(address(BETA, seat) for seat in KONTAKT_SEATS))
        ]


AUSTRITT_ON_THE_DAY = {"austritt": {"type": "rueckzug", "reason": "Schulwechsel", "date": NEXT_WEEK}}


class TestARefereeHoldsOneQuestionAcrossAMoveAndBack:
    async def test_each_pass_leaves_the_referee_one_row_about_the_slot_held_and_tells_each_move(self, mongo_replica_set_url: str):
        """The mint tells a referee of a move only in the Einteilung asking the new slot, which rests on this.

        A row of theirs about the slot held, standing beside an open one about a slot left, would be a move the mint
        tells nobody of: it has no arm for a referee whose row about the slot already stands.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            seen: list[tuple[list[tuple[Any, ...]], tuple[Any, ...], list[bool]]] = []
            for time in (None, "19:00:00", "18:00:00"):
                if time is not None:
                    await move(database, client, SPIEL, time=time)
                passed = await sweep(database, client)
                spiel = await database[Collection.SPIELE].find_one({"_id": SPIEL})
                assert spiel is not None
                held = await rows(database, spiel_id=SPIEL, **{"party.kind": "schiedsrichter"}, **build_holding_filter())
                seen.append(
                    (
                        [ansetzung_values_of(row["ansetzung"]) for row in held],
                        ansetzung_values_of(compose_ansetzung(spiel)),
                        [einteilung.moved_from is not None for einteilung in passed.einteilungen],
                    )
                )

            return seen

        seen = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert [held for held, _, _ in seen] == [[current] for _, current, _ in seen]
        # Asked first, then told of each move in the Einteilung asking the slot it moved to.
        assert [told for _, _, told in seen] == [[False], [True], [True]]


class TestADiscardEndsWhereAnAgreementBesideItEnds:
    """The public verdict counts a discard as its club's agreement only while an agreement would count."""

    @pytest.mark.parametrize(
        ("saison_team", "spiel", "reason"),
        [
            pytest.param(AUSTRITT_ON_THE_DAY, {}, "austritt", id="the agreeing club gone by the day"),
            pytest.param({}, {"sonderereignis": "ausgefallen"}, "cancelled", id="called off"),
        ],
    )
    async def test_the_pass_closing_the_agreement_ends_the_discard_and_tells_what_its_closing_owes(
        self, mongo_replica_set_url: str, saison_team: dict[str, Any], spiel: dict[str, Any], reason: str
    ):
        """Kept, the discard alone would read the fixture provisional where two agreements read null.

        Ended, it owes what its closing owes, as the agreement beside it does: a call-off tells the discarded club too.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            discarded = await alphas_discard_beside_betas_agreement(database, client)
            if saison_team:
                await database[Collection.SAISON_TEAMS].update_one({"team_id": BETA, "saison_id": SAISON_ID}, {"$set": saison_team})
            if spiel:
                await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": spiel})
            before = await verdict(database)
            answer = await sweep(database, client)

            return discarded, before, answer, await verdict(database), await rows(database)

        discarded, before, answer, after, stored = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert (before, after) == (True, None)
        # Both clubs' rows and the referee's, the discard among them.
        assert (len(stored), {row["closed"]["reason"] for row in stored}) == (3, {reason})
        # The referee's notice among them: a club's ended discard is neither a move nor a referee change.
        assert (answer.new_ansetzungen, answer.schiedsrichter_new_ansetzungen) == ([], [])
        # An exit lifts the booked referee's Einteilung, and owes neither club a thing here: the opponents heard at its write.
        assert [notice.address for notice in answer.schiedsrichter_switched] == ([REFEREE_EMAIL] if reason == "austritt" else [])
        told = {notice.spielbestaetigung_id for notice in [*answer.spiel_cancelled, *answer.schiedsrichter_spiel_cancelled]}
        # By row, the discarded club's named: the call-off's notices go to every party it closed a mailed row of.
        assert told == ({row["_id"] for row in stored} if reason == "cancelled" else set())
        assert (discarded in told) is (reason == "cancelled")


class TestTheCloseEndingARowStoresWhetherItAnsweredTheFixture:
    """What a closed row reads as is `state_of`'s, held in the default tier; this holds what the close stores for it to read."""

    @pytest.mark.parametrize(
        ("change", "team_id", "closed"),
        [
            pytest.param({}, ALPHA, {"reason": "spiel_past", "discarded": True, "matched": True}, id="a discard ended at its slot"),
            # A move onto a slot gone by, which nobody is asked about, ends it about the slot the fixture left.
            pytest.param(
                {"time": "19:00:00"}, ALPHA, {"reason": "ansetzung_changed", "discarded": True, "matched": False}, id="a discard the match left"
            ),
            # The result entered with the kick-off corrected, ahead of the pass: the agreement was to the match played.
            pytest.param(
                {"time": "18:30:00", "team1.tore": 2, "team2.tore": 1, "ergebnis": "2:1"},
                BETA,
                {"reason": "spiel_decided", "matched": True},
                id="an agreement retimed as it is decided",
            ),
            # And the discard beside it, judged as the agreement is: no discard outlives a move to differ from it.
            pytest.param(
                {"time": "18:30:00", "team1.tore": 2, "team2.tore": 1, "ergebnis": "2:1"},
                ALPHA,
                {"reason": "spiel_decided", "discarded": True, "matched": True},
                id="a discard retimed as it is decided",
            ),
        ],
    )
    async def test_the_pass_after_the_day_stores_the_mark_and_the_judgement(
        self, mongo_replica_set_url: str, change: dict[str, Any], team_id: ObjectId, closed: dict[str, Any]
    ):
        """Its end overwriting the mark, the editor would read the club agreed until the match and declined from the next pass on.

        And judged again on each read, a kick-off corrected after the pass would turn one club's answer invalid beside the
        other's, about the one slot both answered.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await alphas_discard_beside_betas_agreement(database, client)
            if change:
                await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": change})
            await sweep(database, client, today=days_after(day=NEXT_WEEK, days=1))

            return row_of(await rows(database), team_id=team_id)

        stored = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert stored["closed"] == closed


class TestAMovedSpielAsksAgain:
    """The close reaches an ANSWERED row, so a kept agreement records why it stopped applying."""

    async def test_the_answered_row_closes_with_its_answer_and_the_new_ansetzung_is_asked(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await sweep(database, client)
            asked = {request.side: request.spielbestaetigung_id for request in first.requests}
            await press_answer(database, client, asked["team1"], ALPHA)
            answered = row_of(await rows(database), team_id=ALPHA)
            await move(database, client, SPIEL, time="19:00:00")
            second = await sweep(database, client)
            refusals = [await refusal_of(database, client, asked[side], team_id) for side, team_id in (("team1", ALPHA), ("team2", BETA))]

            return answered, second, await rows(database), refusals

        answered, second, stored, refusals = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        answered_id = answered["_id"]
        closed = [row for row in stored if row["closed"] is not None]
        standing = [row for row in stored if row["closed"] is None]
        assert answered_id in {row["_id"] for row in closed}
        assert [row["closed"]["reason"] for row in closed] == ["ansetzung_changed"] * 3
        assert (answered["answer"]["kind"], answered["answer"]["by"]["seat"]) == ("agreed", "trainer")
        assert next(row for row in closed if row["_id"] == answered_id)["answer"] == answered["answer"]
        assert [row["answer"] for row in closed if row["_id"] != answered_id] == [None, None]
        assert refusals == [Code.ANSETZUNG_UNANSWERABLE, Code.ANSETZUNG_UNANSWERABLE]
        assert {row["ansetzung"]["time"] for row in standing} == {"19:00:00"}
        assert len(standing) == 3
        assert second.closed == 3
        # The request about the new slot is the one mail telling each party of the move: no notice beside it.
        left = {"team1": "Alpha", "team2": "Beta", "date": NEXT_WEEK, "time": "18:00:00"}
        assert (second.new_ansetzungen, second.schiedsrichter_new_ansetzungen) == ([], [])
        assert sorted((request.side, request.moved_from, request.ansetzung.time) for request in second.requests) == [
            ("team1", left, "19:00:00"),
            ("team2", left, "19:00:00"),
        ]
        assert [(einteilung.address, einteilung.moved_from) for einteilung in second.einteilungen] == [(REFEREE_EMAIL, left)]
        alpha_request = next(request for request in second.requests if request.side == "team1")
        assert sorted(recipient.address for recipient in alpha_request.recipients) == sorted(address(ALPHA, seat) for seat in KONTAKT_SEATS)

    async def test_a_team_never_asked_about_the_slot_left_is_asked_naming_none(self, mongo_replica_set_url: str):
        """A club first mailed after the move was never told the old slot, so its first request names no slot it left."""

        unconfirmed = {**{seat: kontaktperson_document(first_name) for seat, first_name in SEATS[ALPHA].items()}, "trainer_is_also": None}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await database[Collection.SAISON_TEAMS].update_one(
                {"team_id": ALPHA, "saison_id": SAISON_ID}, {"$set": {"kontakte.ansprechperson": seated("Anwen")}}
            )
            await move(database, client, SPIEL, time="19:00:00")

            return await sweep(database, client)

        second = await on_a_league(
            mongo_replica_set_url,
            body,
            spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)],
            junctions=[junction(ALPHA, kontakte=unconfirmed), junction(BETA)],
        )

        left = {"team1": "Alpha", "team2": "Beta", "date": NEXT_WEEK, "time": "18:00:00"}
        assert sorted((request.side, request.moved_from) for request in second.requests) == [("team1", None), ("team2", left)]


class TestAMovePastTheWindowIsAskedAtOnce:
    """Left to the window, a party told only of the move hears of no later move, call-off or exit until the window reaches it."""

    MOVED_TO = days_after(day=TODAY, days=60)

    async def asked_then_moved_out(self, database: AsyncDatabase, client: AsyncMongoClient) -> Pass:
        await sweep(database, client)
        await move(database, client, SPIEL, date=self.MOVED_TO)

        return await sweep(database, client)

    async def test_the_parties_asked_are_asked_about_the_new_slot_in_the_pass_after_the_move(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await self.asked_then_moved_out(database, client), await rows(database)

        moved, stored = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        left = {"team1": "Alpha", "team2": "Beta", "date": NEXT_WEEK, "time": "18:00:00"}
        assert Counter((row["closed"] or {}).get("reason") for row in stored) == {"ansetzung_changed": 3, None: 3}
        standing = [row for row in stored if row["closed"] is None]
        assert {(row["ansetzung"]["date"], row["asked_at"]) for row in standing} == {(self.MOVED_TO, TODAY)}
        assert {row["deadline"] for row in standing if row["party"]["kind"] == "team"} == {
            days_after(day=self.MOVED_TO, days=-SPIEL_CONFIRMATION_DEADLINE_DAYS)
        }
        # The request and the Einteilung are the mails telling of the move: no notice beside them.
        assert (moved.new_ansetzungen, moved.schiedsrichter_new_ansetzungen) == ([], [])
        assert sorted((request.side, request.moved_from) for request in moved.requests) == [("team1", left), ("team2", left)]
        assert [(einteilung.address, einteilung.moved_from) for einteilung in moved.einteilungen] == [(REFEREE_EMAIL, left)]

    async def test_a_team_leaving_after_it_lifts_the_referees_einteilung(self, mongo_replica_set_url: str):
        """The referee keeps the new day free only while a row of theirs stands open to be told it no longer holds."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await self.asked_then_moved_out(database, client)
            await database[Collection.SAISON_TEAMS].update_one(
                {"team_id": BETA, "saison_id": SAISON_ID},
                {"$set": {"austritt": {"type": "rueckzug", "reason": "Schulwechsel", "date": TODAY}}},
            )

            return await sweep(database, client)

        left = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert [(notice.address, notice.old.date) for notice in left.schiedsrichter_switched] == [(REFEREE_EMAIL, self.MOVED_TO)]

    async def test_a_slot_left_with_no_hour_tells_every_party_still_on_it_of_the_move(self, mongo_replica_set_url: str):
        """Its notice names no new slot, so only `stays` tells a party still on the fixture from one the move took off it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"time": None}})

            return await sweep(database, client)

        told = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert [(notice.moved_to, notice.stays) for notice in told.new_ansetzungen] == [(None, True), (None, True)]
        assert [(notice.moved_to, notice.stays) for notice in told.schiedsrichter_new_ansetzungen] == [(None, True)]


class TestARefereeChangeClosesTheirRowAlone:
    async def test_the_new_referee_is_asked_and_the_old_one_told_though_they_accepted(self, mongo_replica_set_url: str):
        """The close shuts the old referee's row answered or not: their acceptance is no reason to tell them nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await as_the_referee(database, client, "agreed")
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"schiedsrichter": booked(OTHER_SCHIEDSRICHTER)}})
            return await sweep(database, client), await rows(database)

        second, stored = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        old = row_of(stored, schiedsrichter_id=SCHIEDSRICHTER)
        assert old["closed"]["reason"] == "schiedsrichter_switched"
        assert [einteilung.address for einteilung in second.einteilungen] == [OTHER_REFEREE_EMAIL]
        # The referee taken off is told so at their own address, about the slot they were booked for.
        assert [(notice.spielbestaetigung_id, notice.address, notice.old.date) for notice in second.schiedsrichter_switched] == [
            (old["_id"], REFEREE_EMAIL, NEXT_WEEK)
        ]
        assert (second.schiedsrichter_new_ansetzungen, second.requests, second.closed) == ([], [], 1)


class TestAReplacedTeamsRowsClose:
    """The club leaving takes its season row along, so a notice naming it off that row would hold every mailed row open for good."""

    async def test_the_opponent_and_the_referee_are_told_and_every_row_closes(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            # A replacement runs only before the season's start, so it starts the day after `TODAY`.
            await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"start_date": "2126-04-02"}})
            await replace_saison_team(
                team_id=ALPHA,
                saison_id=SAISON_ID,
                replacement_data=FLReplaceSaisonTeamPayload(incoming_team_id=GAMMA),
                teams_collection=database[Collection.TEAMS],
                saison_teams_collection=database[Collection.SAISON_TEAMS],
                saisons_collection=database[Collection.SAISONS],
                spiele_collection=database[Collection.SPIELE],
                saison_spieler_collection=database[Collection.SAISON_SPIELER],
                aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
                db=client,
                today=TODAY,
            )
            return await sweep(database, client), await rows(database)

        second, stored = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert second.closed == 3
        assert Counter(row["closed"]["reason"] for row in stored if row["closed"] is not None) == {"ansetzung_changed": 3}
        # The leaving club's people left with its row, so its own row closes telling nobody; the opponent and the referee,
        # still the fixture's, are told by the request and the Einteilung about the new Ansetzung.
        left = {"team1": "Gamma", "team2": "Beta", "date": NEXT_WEEK, "time": "18:00:00"}
        assert (second.new_ansetzungen, second.schiedsrichter_new_ansetzungen) == ([], [])
        assert [(request.team, request.moved_from) for request in second.requests if request.team == "Beta"] == [("Beta", left)]
        assert [(einteilung.address, einteilung.moved_from) for einteilung in second.einteilungen] == [(REFEREE_EMAIL, left)]


class TestASideReFieldedNamesThePairingEachPartyWasAskedAbout:
    """A knockout correction re-fields a side, the club taken off keeping its season row: no party was asked about the new pairing."""

    async def test_the_team_taken_off_and_the_parties_still_on_it_are_told_of_the_slot_they_were_asked_about(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            # The bracket's own write, which re-fields a side and touches no season row.
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"team1": side(GAMMA)}})

            return await sweep(database, client)

        second = await on_a_league(
            mongo_replica_set_url,
            body,
            spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)],
            junctions=[junction(ALPHA), junction(BETA), documents.saison_team_document(SAISON_ID, GAMMA, *NAMES[GAMMA])],
        )

        left = {"team1": "Alpha", "team2": "Beta", "date": NEXT_WEEK, "time": "18:00:00"}
        # Alpha, off the fixture, is told the request it was sent no longer stands, about the pairing it was sent: told it
        # stays, it would read that the match it no longer plays moved.
        assert [
            ((notice.team1_name, notice.team2_name), notice.moved_to, notice.stays, sorted(r.address for r in notice.recipient))
            for notice in second.new_ansetzungen
        ] == [(("Alpha", "Beta"), None, False, sorted(address(ALPHA, seat) for seat in KONTAKT_SEATS))]
        assert [(request.team, request.moved_from) for request in second.requests] == [("Beta", left)]
        assert [(einteilung.address, einteilung.moved_from) for einteilung in second.einteilungen] == [(REFEREE_EMAIL, left)]


class TestASideReFieldedWithADepartedTeamIsToldAtOnce:
    """No request can ask about a pairing fielding a club out by the fixture's day, so the close tells of it at once.

    Judged by its rows' own clubs alone, the close would leave the change to the mint, which asks nothing about such a
    pairing: the parties still on the fixture would hear nothing until its day.
    """

    async def test_every_row_closes_and_each_party_is_told(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"team1": side(GAMMA)}})

            return await sweep(database, client), await rows(database)

        second, stored = await on_a_league(
            mongo_replica_set_url,
            body,
            spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)],
            junctions=[junction(ALPHA), junction(BETA), documents.saison_team_document(SAISON_ID, GAMMA, *NAMES[GAMMA], **AUSTRITT_ON_THE_DAY)],
        )

        assert Counter(row["closed"]["reason"] for row in stored if row["closed"] is not None) == {"ansetzung_changed": 3}
        # Alpha, off the fixture, is told it no longer plays; Beta and the referee that the match they are still on changed.
        assert sorted(notice.stays for notice in second.new_ansetzungen) == [False, True]
        assert [notice.stays for notice in second.schiedsrichter_new_ansetzungen] == [True]
        assert (second.requests, second.einteilungen) == ([], [])


class TestARowClosesOnceItsDayHasPassed:
    """A fixture nobody entered a result for keeps no row open past its day."""

    async def test_the_day_after_closes_every_row_answered_or_not_and_the_day_itself_none(self, mongo_replica_set_url: str):
        day_after = days_after(day=NEXT_WEEK, days=1)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await sweep(database, client)
            await press_answer(
                database, client, next(request.spielbestaetigung_id for request in first.requests if request.side == "team1"), ALPHA
            )
            answered = row_of(await rows(database), team_id=ALPHA)

            return (
                answered,
                await sweep(database, client, today=NEXT_WEEK),
                await sweep(database, client, today=day_after),
                await rows(database),
            )

        answered, on_the_day, after, stored = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert on_the_day.closed == 0
        assert after.closed == 3
        assert [row["closed"] for row in stored] == [{"reason": "spiel_past", "matched": True}] * 3
        assert row_of(stored, team_id=ALPHA)["answer"] == answered["answer"]
        # A day gone by is no new Ansetzung: nobody is told it moved, nor asked again.
        assert (after.new_ansetzungen, after.schiedsrichter_new_ansetzungen, after.requests, after.einteilungen) == ([], [], [], [])


class ThenTheRivalAfterTheFirstSessionRead(InterleavedCollection):
    """A collection running the rival once the pass's first in-transaction read of it has answered."""

    def find(self, *args: Any, **kwargs: Any) -> Any:
        cursor = self._collection.find(*args, **kwargs)
        if kwargs.get("session") is None:
            return cursor

        return RowsThenTheRival(cursor, self.run_the_rival)


# Fourteen days out, so the deadline falls a week before the fixture and the reminder inside it.
FORTNIGHT = days_after(day=TODAY, days=14)
DEADLINE = days_after(day=FORTNIGHT, days=-7)
REMINDER = days_after(day=DEADLINE, days=-3)


class TestEachRowIsRemindedOnce:
    """The reminder's stamp is what holds it to one: every later pass before the deadline finds the row reminded."""

    async def test_the_reminder_goes_on_its_day_alone(self, mongo_replica_set_url: str):
        """A second reminder on any later day would mail every seat again, where the league owes one reminder."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answers = [await sweep(database, client)]
            answers += [
                await sweep(database, client, today=day)
                for day in (REMINDER, days_after(day=REMINDER, days=1), days_after(day=DEADLINE, days=-1), DEADLINE)
            ]

            return answers, row_of(await rows(database), team_id=ALPHA)

        answers, alpha = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, FORTNIGHT)])

        assert [len(answer.reminders) for answer in answers] == [0, 2, 0, 0, 0]
        alpha_reminder = next(request for request in answers[1].reminders if request.side == "team1")
        assert sorted(recipient.address for recipient in alpha_reminder.recipients) == sorted(address(ALPHA, seat) for seat in KONTAKT_SEATS)
        assert alpha["reminded_at"] == REMINDER
        assert alpha["deadline"] == DEADLINE


class TestATeamIsMailedAtItsConfirmedSeats:
    """An address nobody proved is mailed nothing, and one person holding two seats is mailed once."""

    async def test_a_person_on_two_seats_gets_one_mail_and_an_unconfirmed_seat_none(self, mongo_replica_set_url: str):
        mirrored = kontakte(
            ALPHA, ansprechperson=seated("Tamsin"), stellvertretung=kontaktperson_document("Stellan"), trainer_is_also="ansprechperson"
        )

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await sweep(database, client)

        answer = await on_a_league(
            mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)], junctions=[junction(ALPHA, kontakte=mirrored), junction(BETA)]
        )

        recipients = next(request.recipients for request in answer.requests if request.side == "team1")
        assert [(recipient.address, recipient.seats) for recipient in recipients] == [(address(ALPHA, "trainer"), ["trainer"])]

    async def test_a_team_holding_no_confirmed_seat_is_asked_once_it_holds_one(self, mongo_replica_set_url: str):
        """Minted unasked, the row reads as never asked; stamped then, the club would never hear of the fixture."""

        unconfirmed = {**{seat: kontaktperson_document(first_name) for seat, first_name in SEATS[ALPHA].items()}, "trainer_is_also": None}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await sweep(database, client)
            unasked = row_of(await rows(database), team_id=ALPHA)
            await database[Collection.SAISON_TEAMS].update_one(
                {"team_id": ALPHA, "saison_id": SAISON_ID}, {"$set": {"kontakte.ansprechperson": seated("Anwen")}}
            )
            second = await sweep(database, client)
            third = await sweep(database, client)

            return first, unasked, second, third, row_of(await rows(database), team_id=ALPHA)

        first, unasked, second, third, asked = await on_a_league(
            mongo_replica_set_url,
            body,
            spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)],
            junctions=[junction(ALPHA, kontakte=unconfirmed), junction(BETA)],
        )

        assert [request.side for request in first.requests] == ["team2"]
        assert unasked["asked_at"] is None
        assert [(request.spielbestaetigung_id, [recipient.address for recipient in request.recipients]) for request in second.requests] == [
            (unasked["_id"], [address(ALPHA, "ansprechperson")])
        ]
        assert (third.requests, asked["asked_at"]) == ([], TODAY)


class TestOneRowHoldsBackNoOther:
    """A fixture the pass cannot answer is passed over alone, every pass, and its neighbour is asked."""

    async def test_a_spiel_fielding_a_team_without_a_season_row(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client, passed_over=1)
            await sweep(database, client, passed_over=1)
            return await rows(database)

        stored = await on_a_league(
            mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK, team2=side(GAMMA)), a_spiel(OTHER_SPIEL, 2, NEXT_WEEK)]
        )

        assert {row["spiel_id"] for row in stored} == {OTHER_SPIEL}

    async def test_a_referee_no_record_holds(self, mongo_replica_set_url: str):
        """Only a hand edit leaves a row or a booking naming one: the close passes the row over and the mint the fixture.

        The close meets the missing address after it took its share, so only the halving finds the row; the mint meets it
        while judging the fixture.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await database[Collection.SCHIEDSRICHTER].delete_one({"_id": SCHIEDSRICHTER})
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"sonderereignis": "ausgefallen"}})
            await database[Collection.SPIELE].insert_one(a_spiel(FRESH_SPIEL, 3, NEXT_WEEK))
            called_off = await sweep(database, client, passed_over=2)
            await sweep(database, client, passed_over=2)
            return called_off, await rows(database)

        called_off, stored = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert {row["spiel_id"] for row in stored} == {SPIEL}
        assert row_of(stored, schiedsrichter_id=SCHIEDSRICHTER)["closed"] is None
        assert [row_of(stored, team_id=team_id)["closed"]["reason"] for team_id in (ALPHA, BETA)] == ["cancelled", "cancelled"]
        # The clubs' rows closed in the same pass, each club told.
        assert {notice.spielbestaetigung_id for notice in called_off.spiel_cancelled} == {
            row_of(stored, team_id=team_id)["_id"] for team_id in (ALPHA, BETA)
        }
        assert called_off.closed == 2


class TestARefereeErasedBesideTheMintIsToldNothing:
    """The erasure deletes the referee's rows its snapshot holds, and the mint's is not yet one."""

    async def test_the_mint_runs_again_and_writes_the_erased_referee_no_row(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def erase_the_referee() -> None:
                await erased(database, client, REFEREE_EMAIL, germany_now=NOW)

            # The mint's read is the first a fresh league's pass makes of the referees.
            interleaved = ThenTheRivalAfterTheFirstSessionRead(database[Collection.SCHIEDSRICHTER], erase_the_referee)
            answer = await a_pass_through(database, client, schiedsrichter=cast(Any, interleaved))

            erased_since = await database[Collection.SCHIEDSRICHTER].count_documents({"_id": SCHIEDSRICHTER}) == 0
            return erased_since, answer, await rows(database)

        erased_since, answer, stored = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        # The premise: the erasure committed; the mint run again reads no referee, the fixture still to come now booking nobody.
        assert erased_since
        assert answer.einteilungen == []
        assert [row["party"]["kind"] for row in stored] == ["team", "team"]


class TestAnErasedContactIsNotToldTheirSpielMoved:
    """The erasure writes the season row the close read its mailboxes off, and nothing of the confirmation it closes."""

    async def test_the_close_runs_again_and_leaves_the_erased_trainer_out(self, mongo_replica_set_url: str):
        """The erasure lands inside the close, after its read of the season rows: only the close's anchor conflicts with it.

        Judged in the Postausgang before its hand-out, which drops a mail whose seat no longer holds its address: a mail the
        close owed after the erasure would keep the erased address stored until then.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            # Onto today, so the close tells of the move: nobody is asked about a match on its own day.
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"date": TODAY}})

            async def erase_the_trainer() -> None:
                await erased(database, client, address(ALPHA, "trainer"), germany_now=NOW)

            interleaved = ThenTheRivalAfterTheFirstSessionRead(database[Collection.SAISON_TEAMS], erase_the_trainer)
            answer = await a_pass(database, client, saison_teams=cast(Any, interleaved))
            owed_to = {row["to"] for row in await database[Collection.OUTBOX].find({"state": "open"}).to_list()}

            return owed_to, await handed_out(database, client, answer, now=NOW)

        owed_to, passed = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        # The premise: ALPHA's row was closed and its notice went to its other seats.
        assert address(ALPHA, "ansprechperson") in {recipient.address for notice in passed.new_ansetzungen for recipient in notice.recipient}
        assert address(ALPHA, "trainer") not in owed_to


# Eight and ten days out: each row's deadline is one of today's reminder days.
ON_REMINDER_DAYS = [a_spiel(SPIEL, 1, days_after(day=TODAY, days=8)), a_spiel(OTHER_SPIEL, 2, days_after(day=TODAY, days=10))]


class TestARowMintedOnAReminderDayIsRemindedOfNothingThatDay:
    async def test_its_request_is_the_days_one_message_on_its_pass_and_after_its_stamp(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await sweep(database, client)
            later = await sweep(database, client)

            return minted, later, await rows(database, **{"party.kind": "team"})

        minted, later, stored = await on_a_league(mongo_replica_set_url, body, spiele=ON_REMINDER_DAYS)

        # The premise: both fixtures' deadlines fall on today's reminders, and every side was asked.
        assert sorted({str(row["deadline"]) for row in stored}) == sorted({days_after(day=TODAY, days=1), days_after(day=TODAY, days=3)})
        assert (len(minted.requests), minted.reminders) == (4, [])
        assert (later.requests, later.reminders) == ([], [])


# --- The LINE-UP REMINDER: owed from 48 hours before kick-off up to the due mark, 24 hours before it.

# Ahead of the real clock, as every drained case's is (`tests/outbox.py :: MAIL_NOW`): the drain claims nothing the
# outbox's retention may already have erased.
LINEUP_TODAY = "2126-04-15"
LINEUP_NOW = datetime(2126, 4, 15, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
# Twenty-nine and a half hours out, inside the window; fifty-three and a half, before it; twenty-three and a half, past
# the due mark.
IN_THE_WINDOW = a_spiel(SPIEL, 1, "2126-04-16", time="18:00:00")
BEFORE_THE_WINDOW = a_spiel(OTHER_SPIEL, 2, "2126-04-17", time="18:00:00", schiedsrichter=None)
PAST_THE_DUE_MARK = a_spiel(FRESH_SPIEL, 3, "2126-04-16", time="12:00:00", schiedsrichter=None)


class TestTheLineupReminder:
    """Owed to a club holding no line-up, once: no line-up document exists to stamp, so the mail's keys are the record."""

    async def test_the_team_without_a_line_up_is_reminded_once_inside_the_window_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.AUFSTELLUNGEN].insert_one(documents.aufstellung_document(IN_THE_WINDOW, ALPHA, starters=[ObjectId()]))
            first = await handed_out(database, client, await a_pass(database, client, today=LINEUP_TODAY, now=LINEUP_NOW), now=LINEUP_NOW)
            later = await handed_out(database, client, await a_pass(database, client, today=LINEUP_TODAY, now=LINEUP_NOW), now=LINEUP_NOW)

            return first, later

        first, later = await on_a_league(mongo_replica_set_url, body, spiele=[IN_THE_WINDOW, BEFORE_THE_WINDOW, PAST_THE_DUE_MARK])

        # Beta's every confirmed seat, Alpha having stored its line-up; due twenty-four hours before kick-off.
        assert sorted((reminder.spiel_id, reminder.team, reminder.address) for reminder in first.aufstellungen) == sorted(
            (str(SPIEL), "Beta", address(BETA, seat)) for seat in KONTAKT_SEATS
        )
        assert {reminder.due_at for reminder in first.aufstellungen} == {datetime(2126, 4, 15, 16, 0, tzinfo=UTC)}
        assert later.aufstellungen == []

    async def test_a_team_whose_line_up_an_erasure_emptied_is_reminded(self, mongo_replica_set_url: str):
        """Ahead of kick-off an erased pupil's entry goes, and the club picks anew: a line-up holding nobody stands as none."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.AUFSTELLUNGEN].insert_one(documents.aufstellung_document(IN_THE_WINDOW, ALPHA))
            return await handed_out(database, client, await a_pass(database, client, today=LINEUP_TODAY, now=LINEUP_NOW), now=LINEUP_NOW)

        reminded = await on_a_league(mongo_replica_set_url, body, spiele=[IN_THE_WINDOW])

        assert {reminder.team for reminder in reminded.aufstellungen} == {"Alpha", "Beta"}

    async def test_a_fixture_a_teams_austritt_decided_reminds_neither_team(self, mongo_replica_set_url: str):
        """Alpha leaves before the day, so the match is not played: Beta would be asked for a line-up nobody fields against."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await handed_out(database, client, await a_pass(database, client, today=LINEUP_TODAY, now=LINEUP_NOW), now=LINEUP_NOW)

        out = junction(ALPHA, austritt={"type": "rueckzug", "reason": "Schulwechsel", "date": LINEUP_TODAY})
        reminded = await on_a_league(mongo_replica_set_url, body, spiele=[IN_THE_WINDOW], junctions=[out, junction(BETA)])

        assert reminded.aufstellungen == []

    async def test_a_reminder_owed_to_a_seat_handed_on_before_its_hand_out_is_dropped(self, mongo_replica_set_url: str):
        """The reminder names its club, so the hand-out judges the seat as it stands: sent, it asks a former Trainer for a line-up."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answer = await a_pass(database, client, today=LINEUP_TODAY, now=LINEUP_NOW)
            await database[Collection.SAISON_TEAMS].update_one(
                {"saison_id": SAISON_ID, "team_id": BETA}, {"$set": {"kontakte.trainer": seated("Nachfolge")}}
            )
            return await handed_out(database, client, answer, now=LINEUP_NOW)

        reminded = await on_a_league(mongo_replica_set_url, body, spiele=[IN_THE_WINDOW])

        assert sorted(reminder.address for reminder in reminded.aufstellungen if reminder.team == "Beta") == sorted(
            address(BETA, seat) for seat in KONTAKT_SEATS if seat != "trainer"
        )

    async def test_a_reminder_still_owed_at_the_due_mark_is_never_sent(self, mongo_replica_set_url: str):
        """A drain running behind would otherwise ask for the line-up by a moment already gone by."""

        past_the_due_mark = datetime(2126, 4, 15, 18, 30, tzinfo=ZoneInfo("Europe/Berlin"))

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answer = await a_pass(database, client, today=LINEUP_TODAY, now=LINEUP_NOW)
            owed = await database[Collection.OUTBOX].count_documents({"kind": "aufstellung_reminder"})
            return owed, await handed_out(database, client, answer, now=past_the_due_mark)

        owed, late = await on_a_league(mongo_replica_set_url, body, spiele=[IN_THE_WINDOW])

        # The premise: both clubs' every confirmed seat was owed one.
        assert owed == 2 * len(KONTAKT_SEATS)
        assert late.aufstellungen == []


# --- A REFEREE TAKEN OFF a fixture after their Einteilung went out.


async def told_and_taken_off(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    """The first pass asks the referee, and the fixture is handed to another referee."""

    await sweep(database, client)
    await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"schiedsrichter": booked(OTHER_SCHIEDSRICHTER)}})


async def as_the_referee(database: AsyncDatabase, client: AsyncMongoClient, answer: Any, reason: str | None = None) -> None:
    """The booked referee, their record confirmed, answering their one row on their own panel."""

    await database[Collection.SCHIEDSRICHTER].update_one(
        {"_id": SCHIEDSRICHTER},
        {
            "$set": {
                "einwilligung": documents.own_einwilligung_document(
                    text_versions=documents.SCHIEDSRICHTER_TEXT_VERSIONS, confirmed_at=YESTERDAY
                )
            }
        },
    )
    (own,) = await rows(database, **{"party.schiedsrichter_id": SCHIEDSRICHTER})
    await post_schiedsrichter_answer(
        spielbestaetigung_id=own["_id"],
        answer_data=FLSpielbestaetigungSchiedsrichterAnswerPayload(answer=answer, reason=reason),
        identifier=REFEREE_EMAIL,
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spiele_collection=database[Collection.SPIELE],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        records=record_collections(database),
        db=client,
        germany_now=NOW,
    )


class TestAnAddressMovedBesideTheNoticeIsTheOneTold:
    """The notice step writes each referee whose address it read, so an address change crossing it conflicts and it reads again."""

    async def test_the_notice_goes_to_the_address_the_referee_holds_once_it_commits(self, mongo_replica_set_url: str):
        moved_to = "neue-pfeife@example.com"

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await told_and_taken_off(database, client)

            async def move_the_address() -> None:
                await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER}, {"$set": {"kontakt.email": moved_to}})

            interleaved = ThenTheRivalAfterTheFirstSessionRead(database[Collection.SCHIEDSRICHTER], move_the_address)
            return await a_pass_through(database, client, schiedsrichter=cast(Any, interleaved))

        answer = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert [notice.address for notice in answer.schiedsrichter_switched] == [moved_to]


# --- A FIXTURE CALLED OFF after its parties were asked.


class TestACalledOffSpielTellsEveryPartyItAsked:
    async def test_both_teams_and_the_referee_are_told_once_whatever_each_answered_and_asked_afresh_once_reinstated(
        self, mongo_replica_set_url: str
    ):
        """Told on every pass, each party would be mailed the same call-off every hour until the fixture's day.

        The mint asks where no UNCLOSED row stands, so the call-off's closed rows never stand in for a fresh request.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await sweep(database, client)
            # One club agreed before the call-off, which tells it no less.
            await press_answer(
                database, client, next(request for request in first.requests if request.side == "team1").spielbestaetigung_id, ALPHA
            )
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"sonderereignis": "ausgefallen"}})
            second, third = await sweep(database, client), await sweep(database, client)
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"sonderereignis": None}})

            return second, third, await sweep(database, client), await rows(database)

        second, third, reinstated, stored = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK)])

        assert (second.closed, second.requests) == (3, [])
        assert sorted(recipient.address for notice in second.spiel_cancelled for recipient in notice.recipient) == sorted(
            address(team_id, seat) for team_id in (ALPHA, BETA) for seat in KONTAKT_SEATS
        )
        assert [notice.address for notice in second.schiedsrichter_spiel_cancelled] == [REFEREE_EMAIL]
        # Each names the event its mail is worded by.
        told = [*second.spiel_cancelled, *second.schiedsrichter_spiel_cancelled]
        assert {(notice.old.date, notice.old.time, notice.sonderereignis) for notice in told} == {(NEXT_WEEK, "18:00:00", "ausgefallen")}
        assert (third.spiel_cancelled, third.schiedsrichter_spiel_cancelled) == ([], []), "a call-off was told twice"
        assert (len(reinstated.requests), len(reinstated.einteilungen)) == (2, 1), "the reinstated fixture was not asked afresh"
        assert Counter((row["closed"] or {}).get("reason") for row in stored) == {"cancelled": 3, None: 3}


# --- A SAVE MOVING A FIXTURE beside a step of the pass. No referee is booked, whom both would write, so the fixture is the
# one document the two share.

# Inside the window, so a party asked already is asked about it at once.
LATER = days_after(day=TODAY, days=10)


class ThenTheRivalAfterTheNthJoinedRead(InterleavedCollection):
    """The fixtures, running the rival once the pass's `nth` read of them through the name join has answered.

    Every step reads them so, once to judge its rows and again inside each row's own transaction; the reads ahead of
    the one a case is about are counted off.
    """

    def __init__(self, collection: Any, rival: Rival, *, nth: int) -> None:
        super().__init__(collection, rival, after="aggregate")
        self._nth = nth

    async def run_the_rival(self) -> None:
        self.passes += 1
        if self.passes == self._nth and self._rival is not None:
            rival, self._rival = self._rival, None
            await rival()


class TestASaveLandingInsideAStepLeavesNoMailAboutTheSlotTheFixtureLeft:
    """Each step writes the fixtures it acts on, as the save writes the fixture, so the two conflict and the step reads again."""

    async def test_the_close(self, mongo_replica_set_url: str):
        """Moved onto today, the close tells of the move; moved on again under it, the mint asks about the new slot instead."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await move(database, client, SPIEL, date=TODAY)

            async def move_on() -> None:
                await move(database, client, SPIEL, date=LATER)

            # The close's read judging its rows is the pass's first, and the read inside the row's own transaction its second.
            interleaved = ThenTheRivalAfterTheNthJoinedRead(database[Collection.SPIELE], move_on, nth=2)
            return await a_pass_through(database, client, spiele=cast(Any, interleaved))

        passed = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK, schiedsrichter=None)])

        assert passed.new_ansetzungen == []
        assert sorted((request.ansetzung.date, (request.moved_from or {}).get("date")) for request in passed.requests) == [
            (LATER, NEXT_WEEK),
            (LATER, NEXT_WEEK),
        ]

    async def test_the_mint(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def move_on() -> None:
                await move(database, client, SPIEL, date=LATER)

            # A fresh league: the close reads no row and so no fixture, the mint's read of the window is the first, and the
            # read inside the fixture's own transaction the second.
            interleaved = ThenTheRivalAfterTheNthJoinedRead(database[Collection.SPIELE], move_on, nth=2)
            return await a_pass_through(database, client, spiele=cast(Any, interleaved)), await rows(database)

        passed, stored = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK, schiedsrichter=None)])

        assert [request.ansetzung.date for request in passed.requests] == [LATER, LATER]
        assert [row["ansetzung"]["date"] for row in stored] == [LATER, LATER]

    async def test_the_reminder(self, mongo_replica_set_url: str):
        """A reminder of a slot the fixture left asks the club to confirm a match nobody plays then."""

        later = days_after(day=FORTNIGHT, days=1)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)

            async def move_on() -> None:
                await move(database, client, SPIEL, date=later)

            # The close's read judging its rows and the mint's come first, the reminder's third, and the read inside its
            # first row's own transaction the fourth.
            interleaved = ThenTheRivalAfterTheNthJoinedRead(database[Collection.SPIELE], move_on, nth=4)
            answer = await a_pass(database, client, today=REMINDER, spiele=cast(Any, interleaved))
            return await handed_out(database, client, answer, now=clock_of(REMINDER)), await rows(database), interleaved.passes

        passed, stored, reads = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, FORTNIGHT, schiedsrichter=None)])

        # The premise: the move landed in the first row's transaction, whose read ran again after the conflict, before the
        # second row's and the line-up step's. Landed outside it, nothing runs again and the pass reads six.
        assert reads == 7
        assert passed.requests == []
        assert passed.reminders == []
        assert [row["reminded_at"] for row in stored] == [None, None]

    async def test_the_lineup_reminder(self, mongo_replica_set_url: str):
        """Sent, it asks for a line-up by a mark the fixture left, and its keys then hold back the one the new day owes."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def move_on() -> None:
                # Fifty-three and a half hours out, before the window.
                await move(database, client, SPIEL, date="2126-04-17")

            # The line-up step alone reads the line-ups, after its read of the fixtures.
            interleaved = ThenTheRivalAfterTheFirstSessionRead(database[Collection.AUFSTELLUNGEN], move_on)
            answer = await a_pass(database, client, today=LINEUP_TODAY, now=LINEUP_NOW, aufstellungen=cast(Any, interleaved))
            return await handed_out(database, client, answer, now=LINEUP_NOW)

        reminded = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, "2126-04-16", schiedsrichter=None)])

        assert reminded.aufstellungen == []


class TestAPassLandingInsideASaveLeavesItsFormSaving:
    """The pass's write to the fixture moves no `version`, and the save's own write still meets it."""

    async def test_the_save_runs_again_on_the_version_its_form_read_and_commits(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answers: list[FLSpielbestaetigungSweepResponse] = []

            async def a_pass_beside() -> None:
                answers.append(await a_pass(database, client))

            # The save's first read of the fixtures: its payload carries the version the form read before the pass.
            interleaved = ThenTheRivalAfterTheFirstSessionRead(database[Collection.SPIELE], a_pass_beside)
            outcome = await outcome_of(move(database, client, SPIEL, spiele=cast(Any, interleaved), date=LATER))
            stored = await database[Collection.SPIELE].find_one({"_id": SPIEL})

            return outcome, stored, await handed_out(database, client, answers[0], now=NOW)

        outcome, stored, passed = await on_a_league(mongo_replica_set_url, body, spiele=[a_spiel(SPIEL, 1, NEXT_WEEK, schiedsrichter=None)])

        # The premise: the pass acted on the fixture, asking both clubs about the slot it held as the pass ran.
        assert [request.ansetzung.date for request in passed.requests] == [NEXT_WEEK, NEXT_WEEK]
        assert outcome == COMMITTED
        # The save's own raise alone.
        assert stored is not None
        assert (stored["date"], stored["version"]) == (LATER, 1)
