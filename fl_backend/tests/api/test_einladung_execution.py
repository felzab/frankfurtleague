import asyncio
from collections.abc import Awaitable, Callable, Mapping
from typing import Any, cast

import pytest
from bson import ObjectId
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError, OperationFailure

from app.api.bewerbungen.services import hash_token
from app.api.einladungen.schemas import FLEinladungVersandPayload
from app.api.einladungen.services import (
    EINLADUNG_SAISON_VORBEI,
    EINLADUNG_TEAM_NICHT_EINGETRAGEN,
    EINLADUNG_UNBEKANNT,
    WITHOUT_TOKEN_HASH,
    find_live_einladung_filter,
    find_unknown_einladung_refusal,
)
from app.api.saisons.admin_router import post_einladungen_versand, preview_einladungen_versand
from app.api.teams.admin_router import delete_einladung, get_einladung, post_einladung
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_einladung_test")

SAISON_ID = "2026"
OTHER_SAISON_ID = "2025"
ADMIN = "admin@frankfurtleague.de"
TODAY = "2026-04-01"
CONFIRMED_ON = "2026-03-20"

# Inside the window seeded below, and outside it, so `laeuft` is driven both ways from one seed.
INSIDE_THE_WINDOW = TODAY
AFTER_THE_WINDOW = "2026-05-01"

# One per skip state, plus the team the press mails and a club the season never admitted.
TWO_SEATS = ObjectId("6890a1b2c3d4e5f607260001")
UNCONFIRMED = ObjectId("6890a1b2c3d4e5f607260002")
NO_BLOCK = ObjectId("6890a1b2c3d4e5f607260003")
ALREADY_MAILED = ObjectId("6890a1b2c3d4e5f607260004")
WITHDRAWN = ObjectId("6890a1b2c3d4e5f607260006")
NOT_ENTERED = ObjectId("6890a1b2c3d4e5f607260005")

SEEDED_EINLADUNG = ObjectId("6890a1b2c3d4e5f607260011")

RULES: Mapping[str, Any] = {
    "win_points": 3,
    "draw_points": 1,
    "qualifiers_per_group": 2,
    "number_of_groups": 2,
    "teams_per_group": 4,
    "tiebreak_order": "tordifferenz",
    "max_kadergroesse": 50,
    "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
    "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
}

REGISTRIERUNG: Mapping[str, Any] = {"offen": True, "von": "2026-03-01", "bis": "2026-04-30"}

ZUSTELLUNG: Mapping[str, Any] = {
    "nachricht_id": "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794",
    "stand": "angenommen",
    "grund": None,
    "am": "2026-03-29T10:00:00+00:00",
}

TEAM_NAMES = {TWO_SEATS: "Adler", UNCONFIRMED: "Bieber", NO_BLOCK: "Cronberg", ALREADY_MAILED: "Dornbusch", WITHDRAWN: "Eschborn"}

AUSTRITT: Mapping[str, Any] = {"type": "rueckzug", "grund": "Zu wenige Spieler", "datum": "2026-03-25"}


def kontaktperson(vorname: str, email: str, *, bestaetigt_am: str | None) -> dict[str, Any]:
    return {
        "vorname": vorname,
        "nachname": f"{vorname}-Mustermann",
        "email": email,
        "telefon": "+49 69 1234567",
        "geburtsdatum": "1980-05-04",
        "einwilligung": {
            "umfang": "kontaktdaten",
            "erfasst_von": "person",
            "text_version": "v1",
            "datum": "2026-01-15",
            "bestaetigt_am": bestaetigt_am,
        },
    }


def kontakte(*, trainer: Any = None, ansprechperson: Any = None) -> dict[str, Any]:
    return {"trainer": trainer, "ansprechperson": ansprechperson, "stellvertretung": None, "trainer_ist_zugleich": None}


SEEDED_KONTAKTE: Mapping[ObjectId, Any] = {
    TWO_SEATS: kontakte(
        trainer=kontaktperson("Bramblewick", "bramblewick@example.com", bestaetigt_am=CONFIRMED_ON),
        ansprechperson=kontaktperson("Quillhilde", "quillhilde@example.com", bestaetigt_am=CONFIRMED_ON),
    ),
    UNCONFIRMED: kontakte(trainer=kontaktperson("Zorbanax", "zorbanax@example.com", bestaetigt_am=None)),
    NO_BLOCK: None,
    ALREADY_MAILED: kontakte(trainer=kontaktperson("Fendrick", "fendrick@example.com", bestaetigt_am=CONFIRMED_ON)),
    # CONFIRMED, so the skip below is the withdrawal's and not the block's: seeded unconfirmed, this
    # team would be skipped by a press that had never heard of an `austritt`.
    WITHDRAWN: kontakte(trainer=kontaktperson("Gwendolyn", "gwendolyn@example.com", bestaetigt_am=CONFIRMED_ON)),
}


def junction_row(team_id: ObjectId, *, saison_id: str = SAISON_ID) -> dict[str, Any]:
    name = TEAM_NAMES[team_id]

    return {
        "_id": ObjectId(),
        "saison_id": saison_id,
        "team_id": team_id,
        "gruppe": "A",
        "austritt": dict(AUSTRITT) if team_id == WITHDRAWN else None,
        "kontakte": SEEDED_KONTAKTE[team_id],
        "name": name,
        "shorthand": name[:2].upper(),
    }


def einladung_row(team_id: ObjectId, *, versand: Any, widerrufen_am: str | None = None, _id: ObjectId | None = None) -> dict[str, Any]:
    return {
        "_id": _id or ObjectId(),
        "saison_id": SAISON_ID,
        "team_id": team_id,
        "token_hash": hash_token(f"seeded-{team_id}-{widerrufen_am}"),
        "erstellt_am": "2026-03-15",
        "erstellt_von": ADMIN,
        "widerrufen_am": widerrufen_am,
        "versand": versand,
    }


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, saison_status: str = "active", teams: tuple[ObjectId, ...] = tuple(TEAM_NAMES)) -> Any:
    """The SHIPPED validators and indexes, one season, and the four teams in their four skip states.

    `ALREADY_MAILED`'s invitation carries a delivery record, the state only
    `POST /zustellung/angenommen` writes and the only one the press skips on.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await database[Collection.SAISONS].insert_one(
                {
                    "_id": SAISON_ID,
                    "start_date": "2026-01-01",
                    "end_date": "2026-06-30",
                    "status": saison_status,
                    "rules": dict(RULES),
                    "registrierung": dict(REGISTRIERUNG),
                }
            )
            if teams:
                await database[Collection.SAISON_TEAMS].insert_many([junction_row(team_id) for team_id in teams])
            if ALREADY_MAILED in teams:
                await database[Collection.EINLADUNGEN].insert_one(
                    einladung_row(ALREADY_MAILED, versand={"zustellung": dict(ZUSTELLUNG)}, _id=SEEDED_EINLADUNG)
                )

            return await body(database)

    return on_the_seed_loop(_run())


async def mint(database: AsyncDatabase, team_id: ObjectId, *, saison_id: str = SAISON_ID) -> Any:
    return await post_einladung(
        team_id=team_id,
        saison_id=saison_id,
        einladungen_collection=database[Collection.EINLADUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        db=database.client,
        erstellt_von=ADMIN,
        today=TODAY,
    )


async def revoke(database: AsyncDatabase, team_id: ObjectId) -> Any:
    return await delete_einladung(
        team_id=team_id,
        saison_id=SAISON_ID,
        einladungen_collection=database[Collection.EINLADUNGEN],
        today=TODAY,
    )


async def read_state(database: AsyncDatabase, team_id: ObjectId, *, today: str = INSIDE_THE_WINDOW) -> Any:
    return await get_einladung(
        team_id=team_id,
        saison_id=SAISON_ID,
        einladungen_collection=database[Collection.EINLADUNGEN],
        saisons_collection=database[Collection.SAISONS],
        today=today,
    )


async def preview(database: AsyncDatabase, *, erneut: bool = False) -> Any:
    return await preview_einladungen_versand(
        saison_id=SAISON_ID,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        einladungen_collection=database[Collection.EINLADUNGEN],
        saisons_collection=database[Collection.SAISONS],
        erneut=erneut,
    )


async def press(database: AsyncDatabase, *, erneut: bool = False) -> Any:
    return await post_einladungen_versand(
        saison_id=SAISON_ID,
        versand_data=FLEinladungVersandPayload(erneut=erneut),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        einladungen_collection=database[Collection.EINLADUNGEN],
        saisons_collection=database[Collection.SAISONS],
        db=database.client,
        erstellt_von=ADMIN,
        today=TODAY,
    )


async def live_count(database: AsyncDatabase, team_id: ObjectId) -> int:
    return await database[Collection.EINLADUNGEN].count_documents({"saison_id": SAISON_ID, "team_id": team_id, "widerrufen_am": None})


class _InsertFailsForOneTeam:
    """The real collection with one team's insert raising, handed to the parameter the endpoint declares.

    A fake rather than a patch: nothing in production knows it exists.
    """

    def __init__(self, collection: Any, team_id: ObjectId) -> None:
        self._collection = collection
        self._team_id = team_id

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def insert_one(self, document: Any, **rest: Any) -> Any:
        if document.get("team_id") == self._team_id:
            raise OperationFailure("the write could not be applied")

        return await self._collection.insert_one(document, **rest)


def as_collection(stub: _InsertFailsForOneTeam) -> AsyncCollection:
    """`tests/core/test_crud.py :: as_collection`'s shape: the fake stands where a driver handle is declared."""

    return cast(AsyncCollection, stub)


def decided(zeilen: Any) -> list[tuple[str, tuple[str, ...], Any, bool]]:
    """One row per team as both readers describe it: the team, the mailboxes, the skip, and the link it kills."""

    return [(str(zeile.team_id), tuple(entry.email for entry in zeile.empfaenger), zeile.uebersprungen, zeile.ersetzt_link) for zeile in zeilen]


class TestWhatAMintStores:
    def test_the_row_carries_the_hash_the_season_the_team_the_author_and_the_day(self, mongo_replica_set_url: str):
        """The shape every later read is built on, and the one the shipped `$jsonSchema` has to accept."""

        async def body(database: AsyncDatabase) -> Any:
            response = await mint(database, TWO_SEATS)
            stored = await database[Collection.EINLADUNGEN].find_one({"_id": ObjectId(response.einladung_id)})

            assert stored is not None
            return response, stored

        response, stored = on_a_league(mongo_replica_set_url, body)

        assert set(stored) == {"_id", "saison_id", "team_id", "token_hash", "erstellt_am", "erstellt_von", "widerrufen_am", "versand"}
        assert stored["token_hash"] == hash_token(response.token)
        assert stored["erstellt_von"] == ADMIN
        assert stored["erstellt_am"] == TODAY
        assert stored["widerrufen_am"] is None
        # The carrier the accepted send needs to find, empty because nothing has been mailed yet.
        assert stored["versand"] == {}

    def test_the_raw_link_reaches_the_answer_and_no_stored_field(self, mongo_replica_set_url: str):
        """A link recoverable from the row would make the admin read the place every live credential leaks from."""

        async def body(database: AsyncDatabase) -> Any:
            response = await mint(database, TWO_SEATS)
            stored = await database[Collection.EINLADUNGEN].find_one({})

            return response.token, repr(stored)

        token, stored = on_a_league(mongo_replica_set_url, body)

        assert token
        assert token not in stored

    def test_the_write_is_logged_without_the_raw_link(self, mongo_replica_set_url: str):
        """The log is the second place a value survives a feature built to keep none."""

        async def body(database: AsyncDatabase) -> Any:
            response = await mint(database, TWO_SEATS)

            return response.token, repr([row async for row in database[Collection.AKTIONEN].find()])

        token, recorded = on_a_league(mongo_replica_set_url, body)

        assert "einladungen" in recorded, "the mint filed no log row at all, so the assertion below holds of nothing"
        assert token not in recorded


class TestReissuingALink:
    def test_a_second_mint_leaves_exactly_one_live_invitation(self, mongo_replica_set_url: str):
        """The revoke and the mint are one transaction, so the team is never without a link and never holds two."""

        async def body(database: AsyncDatabase) -> Any:
            first = await mint(database, TWO_SEATS)
            second = await mint(database, TWO_SEATS)
            rows = await database[Collection.EINLADUNGEN].find({"team_id": TWO_SEATS}).to_list(length=None)

            return first, second, rows

        first, second, rows = on_a_league(mongo_replica_set_url, body)

        assert first.einladung_id != second.einladung_id
        # The replaced row STAYS: a delivery event about the message carrying it still has to land.
        assert len(rows) == 2
        assert [row["widerrufen_am"] for row in rows if row["_id"] == ObjectId(first.einladung_id)] == [TODAY]
        assert [row["widerrufen_am"] for row in rows if row["_id"] == ObjectId(second.einladung_id)] == [None]

    def test_the_replaced_links_hash_then_opens_nothing(self, mongo_replica_set_url: str):
        """`REQ-EINLADUNG-003` over the filter S9 reads: the revocation term is half of it, and a hash alone finds the spent row."""

        async def body(database: AsyncDatabase) -> Any:
            first = await mint(database, TWO_SEATS)
            await mint(database, TWO_SEATS)

            found = await database[Collection.EINLADUNGEN].find_one(dict(find_live_einladung_filter(token_hash=hash_token(first.token))))
            by_hash_alone = await database[Collection.EINLADUNGEN].count_documents({"token_hash": hash_token(first.token)})
            # A value no mint ever produced, so the second cause is driven rather than assumed.
            unknown = await database[Collection.EINLADUNGEN].find_one(dict(find_live_einladung_filter(token_hash=hash_token("never-minted"))))

            return found, by_hash_alone, unknown

        found, by_hash_alone, unknown = on_a_league(mongo_replica_set_url, body)

        assert found is None
        # The row is still there, which is what makes the revocation term load-bearing.
        assert by_hash_alone == 1
        assert unknown is None

        # The only rung both causes exist at: a replaced link and a stranger's guess answer with
        # the SAME refusal, message included, so nothing tells the guess it hit a real link.
        replaced = find_unknown_einladung_refusal(einladung_raw=found)
        guessed = find_unknown_einladung_refusal(einladung_raw=unknown)

        assert replaced is not None
        assert replaced.error_code == EINLADUNG_UNBEKANNT
        assert replaced == guessed

    def test_the_live_link_opens(self, mongo_replica_set_url: str):
        """The control: a filter that found nothing for any hash would pass the case above and refuse every visitor."""

        async def body(database: AsyncDatabase) -> Any:
            minted = await mint(database, TWO_SEATS)

            return await database[Collection.EINLADUNGEN].find_one(dict(find_live_einladung_filter(token_hash=hash_token(minted.token))))

        found = on_a_league(mongo_replica_set_url, body)

        assert found is not None
        assert find_unknown_einladung_refusal(einladung_raw=found) is None


class TestTwoMintsAtOnce:
    """The read and the write are not one statement, so two administrators pressing together both pass the read."""

    def test_two_mints_for_one_team_leave_exactly_one_live_invitation(self, mongo_replica_set_url: str):
        """Whichever way the two transactions interleave, `uniq_einladung_live` is what decides, and it decides alone."""

        async def body(database: AsyncDatabase) -> Any:
            outcomes = await asyncio.gather(mint(database, TWO_SEATS), mint(database, TWO_SEATS), return_exceptions=True)

            return [type(outcome).__name__ for outcome in outcomes], await live_count(database, TWO_SEATS)

        outcomes, live = on_a_league(mongo_replica_set_url, body)

        # Either the call answered, or it met the index and raised what the handler turns into the
        # registered 409 -- and never anything else, an unhandled error being a 500 for a press an
        # administrator would repeat.
        assert set(outcomes) <= {"FLEinladungMintResponse", "DuplicateKeyError"}
        assert live == 1


class TestTheRuleOfOneLiveInvitation:
    """`uniq_einladung_live`, this tree's first partial index: the rule reaches the rows holding a null `widerrufen_am`.

    Written straight to the collection, which is what a second transaction committing between a
    read and a write amounts to.
    """

    def test_a_second_live_row_for_one_team_and_season_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            await database[Collection.EINLADUNGEN].insert_one(einladung_row(TWO_SEATS, versand={}))

            with pytest.raises(DuplicateKeyError):
                await database[Collection.EINLADUNGEN].insert_one(einladung_row(TWO_SEATS, versand={}))

            return await live_count(database, TWO_SEATS)

        assert on_a_league(mongo_replica_set_url, body) == 1

    def test_two_revoked_rows_stand_beside_each_other(self, mongo_replica_set_url: str):
        """The reach the filter buys: a team reissued twice holds two spent rows, and a rule over every row would refuse the second."""

        async def body(database: AsyncDatabase) -> Any:
            await database[Collection.EINLADUNGEN].insert_many(
                [
                    einladung_row(TWO_SEATS, versand={}, widerrufen_am="2026-03-20"),
                    einladung_row(TWO_SEATS, versand={}, widerrufen_am="2026-03-21"),
                ]
            )

            return await database[Collection.EINLADUNGEN].count_documents({"team_id": TWO_SEATS})

        assert on_a_league(mongo_replica_set_url, body) == 2

    def test_a_live_row_stands_beside_a_revoked_one(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            await database[Collection.EINLADUNGEN].insert_one(einladung_row(TWO_SEATS, versand={}, widerrufen_am="2026-03-20"))
            await database[Collection.EINLADUNGEN].insert_one(einladung_row(TWO_SEATS, versand={}))

            return await live_count(database, TWO_SEATS), await database[Collection.EINLADUNGEN].count_documents({"team_id": TWO_SEATS})

        assert on_a_league(mongo_replica_set_url, body) == (1, 2)

    def test_a_row_carrying_no_revocation_key_at_all_is_refused_before_the_index_sees_it(self, mongo_replica_set_url: str):
        """Why the validator requires the key: `$type: "null"` indexes no row that lacks it, so two such rows would both be live.

        The refusal is the VALIDATOR's, which is what puts that question beyond any stored row.
        """

        async def body(database: AsyncDatabase) -> Any:
            row = einladung_row(TWO_SEATS, versand={})
            del row["widerrufen_am"]

            with pytest.raises(OperationFailure) as refused:
                await database[Collection.EINLADUNGEN].insert_one(row)

            return refused.value.code, await database[Collection.EINLADUNGEN].count_documents({"team_id": TWO_SEATS})

        code, stored = on_a_league(mongo_replica_set_url, body)

        # 121 is `DocumentValidationFailure`, so the insert was refused by the schema rather than by
        # an unrelated write error.
        assert code == 121
        assert stored == 0

    def test_two_teams_hold_a_live_invitation_each(self, mongo_replica_set_url: str):
        """The control: a rule keyed on the season alone would refuse the second team of every season."""

        async def body(database: AsyncDatabase) -> Any:
            await mint(database, TWO_SEATS)
            await mint(database, UNCONFIRMED)

            return await live_count(database, TWO_SEATS), await live_count(database, UNCONFIRMED)

        assert on_a_league(mongo_replica_set_url, body) == (1, 1)


class TestWhatAMintRefuses:
    def test_a_team_the_season_does_not_hold_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(DocumentConflictException) as conflict:
                await mint(database, NOT_ENTERED)

            return conflict.value.error_code, await database[Collection.EINLADUNGEN].count_documents({"team_id": NOT_ENTERED})

        code, stored = on_a_league(mongo_replica_set_url, body)

        assert code == EINLADUNG_TEAM_NICHT_EINGETRAGEN
        assert stored == 0

    def test_a_season_that_has_ended_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(DocumentConflictException) as conflict:
                await mint(database, TWO_SEATS)

            # The team the refused mint named: the seeded league holds an invitation of its own,
            # and a count over the collection would pass for holding that row rather than none.
            return conflict.value.error_code, await database[Collection.EINLADUNGEN].count_documents({"team_id": TWO_SEATS})

        code, stored = on_a_league(mongo_replica_set_url, body, saison_status="past")

        assert code == EINLADUNG_SAISON_VORBEI
        assert stored == 0

    def test_the_ended_season_is_reported_before_the_junction(self, mongo_replica_set_url: str):
        """A team the season never held would refuse too, and entering it into a season that has ended repairs nothing."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(DocumentConflictException) as conflict:
                await mint(database, NOT_ENTERED)

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body, saison_status="past", teams=(TWO_SEATS,)) == EINLADUNG_SAISON_VORBEI

    def test_a_season_no_document_names_is_a_404(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await mint(database, TWO_SEATS, saison_id=OTHER_SAISON_ID)

            # The season the refused mint named, never the whole collection, which the seed fills.
            return await database[Collection.EINLADUNGEN].count_documents({"saison_id": OTHER_SAISON_ID})

        assert on_a_league(mongo_replica_set_url, body) == 0

    def test_a_future_season_mints(self, mongo_replica_set_url: str):
        """The links are prepared before the window opens, so the status gate must reach `past` alone."""

        async def body(database: AsyncDatabase) -> Any:
            await mint(database, TWO_SEATS)

            return await live_count(database, TWO_SEATS)

        assert on_a_league(mongo_replica_set_url, body, saison_status="future", teams=(TWO_SEATS,)) == 1


class TestRevokingALink:
    def test_the_row_is_stamped_and_kept(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            minted = await mint(database, TWO_SEATS)
            revoked = await revoke(database, TWO_SEATS)
            stored = await database[Collection.EINLADUNGEN].find_one({"_id": ObjectId(minted.einladung_id)})

            assert stored is not None
            return minted.einladung_id, revoked.einladung_id, stored["widerrufen_am"]

        minted_id, revoked_id, widerrufen_am = on_a_league(mongo_replica_set_url, body)

        assert revoked_id == minted_id
        assert widerrufen_am == TODAY

    def test_a_team_holding_no_live_link_is_a_404(self, mongo_replica_set_url: str):
        """A revoke answering 200 over nothing tells an administrator a link is dead that still opens."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await revoke(database, TWO_SEATS)

            return None

        on_a_league(mongo_replica_set_url, body)

    def test_a_link_already_revoked_is_not_revoked_twice(self, mongo_replica_set_url: str):
        """The second call must not re-stamp a spent row with today's date, which would rewrite when the link died."""

        async def body(database: AsyncDatabase) -> Any:
            await mint(database, TWO_SEATS)
            await revoke(database, TWO_SEATS)

            with pytest.raises(DocumentNotFoundException):
                await revoke(database, TWO_SEATS)

            return await live_count(database, TWO_SEATS)

        assert on_a_league(mongo_replica_set_url, body) == 0

    def test_a_link_of_a_season_that_has_ended_stays_revocable(self, mongo_replica_set_url: str):
        """The mint is refused there and the revoke is not: a link that outlived its season is exactly one to kill."""

        async def body(database: AsyncDatabase) -> Any:
            await database[Collection.EINLADUNGEN].insert_one(einladung_row(TWO_SEATS, versand={}))
            await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"status": "past"}})
            await revoke(database, TWO_SEATS)

            return await live_count(database, TWO_SEATS)

        assert on_a_league(mongo_replica_set_url, body) == 0


class TestTheStateRead:
    def test_no_hash_reaches_the_answer(self, mongo_replica_set_url: str):
        """The projection and the model both drop it, and this drives the pair rather than either alone."""

        async def body(database: AsyncDatabase) -> Any:
            minted = await mint(database, TWO_SEATS)
            state = await read_state(database, TWO_SEATS)

            return minted.token, state.model_dump_json()

        token, rendered = on_a_league(mongo_replica_set_url, body)

        assert "token_hash" not in rendered
        assert token not in rendered
        assert hash_token(token) not in rendered

    def test_the_projection_is_what_keeps_the_hash_off_a_read_of_the_whole_row(self, mongo_replica_set_url: str):
        """`FLEinladung` ignores an undeclared key, so dropping the projection changes no rendered byte and only this fails."""

        async def body(database: AsyncDatabase) -> Any:
            await mint(database, TWO_SEATS)
            projected = await database[Collection.EINLADUNGEN].find_one({"team_id": TWO_SEATS}, projection=dict(WITHOUT_TOKEN_HASH))
            whole = await database[Collection.EINLADUNGEN].find_one({"team_id": TWO_SEATS})

            assert projected is not None and whole is not None
            return sorted(projected), sorted(whole)

        projected, whole = on_a_league(mongo_replica_set_url, body)

        assert "token_hash" not in projected
        # The control: the row does hold one, so the projection is what took it out.
        assert "token_hash" in whole
        assert "versand" in projected

    def test_a_team_holding_no_link_answers_null_rather_than_a_404(self, mongo_replica_set_url: str):
        """Holding none is the state every team starts in, so the panel needs an answer rather than an error."""

        async def body(database: AsyncDatabase) -> Any:
            return await read_state(database, TWO_SEATS)

        state = on_a_league(mongo_replica_set_url, body)

        assert state.einladung is None
        assert state.laeuft is True

    def test_it_answers_the_live_row_after_a_reissue(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            await mint(database, TWO_SEATS)
            second = await mint(database, TWO_SEATS)
            state = await read_state(database, TWO_SEATS)

            return second.einladung_id, state

        einladung_id, state = on_a_league(mongo_replica_set_url, body)

        assert state.einladung is not None
        assert str(state.einladung.id) == str(einladung_id)
        assert state.einladung.widerrufen_am is None
        # Absent rather than filled: nothing has been mailed, which is not a delivery failure.
        assert state.einladung.versand is not None
        assert state.einladung.versand.zustellung is None

    def test_the_window_verdict_is_the_links_whole_expiry(self, mongo_replica_set_url: str):
        """Read at every use rather than stamped on the row, so a window moved after the mint moves the link with it."""

        async def body(database: AsyncDatabase) -> Any:
            await mint(database, TWO_SEATS)

            inside = await read_state(database, TWO_SEATS, today=INSIDE_THE_WINDOW)
            outside = await read_state(database, TWO_SEATS, today=AFTER_THE_WINDOW)

            return inside.laeuft, outside.laeuft, outside.einladung is not None

        assert on_a_league(mongo_replica_set_url, body) == (True, False, True)

    def test_a_season_that_has_ended_reads_as_a_shut_window_whatever_its_dates(self, mongo_replica_set_url: str):
        """The link's own page reads a `past` season as shut, so the panel telling the administrator it runs would contradict it."""

        async def body(database: AsyncDatabase) -> bool:
            return (await read_state(database, TWO_SEATS)).laeuft

        assert on_a_league(mongo_replica_set_url, body, saison_status="past") is False

    def test_a_mailed_link_reports_what_became_of_the_message(self, mongo_replica_set_url: str):
        """The other side of the null: an invitation nobody mailed and one whose message bounced must read differently."""

        async def body(database: AsyncDatabase) -> Any:
            return await read_state(database, ALREADY_MAILED)

        state = on_a_league(mongo_replica_set_url, body)

        assert state.einladung is not None
        assert state.einladung.versand is not None
        assert state.einladung.versand.zustellung is not None
        assert state.einladung.versand.zustellung.nachricht_id == ZUSTELLUNG["nachricht_id"]


class TestTheSeasonWidePress:
    """One press over a season whose four teams sit in the four states it can meet."""

    def test_the_preview_and_the_press_decide_the_same_rows(self, mongo_replica_set_url: str):
        """Two readers of one rule is how a preview starts telling an administrator something the press then contradicts."""

        async def body(database: AsyncDatabase) -> Any:
            shown = await preview(database)
            done = await press(database)

            return decided(shown.zeilen), decided(done.zeilen)

        shown, done = on_a_league(mongo_replica_set_url, body)

        # The whole list rather than a subset: two readers agreeing on the teams they both mention
        # is what a preview missing a team passes.
        assert shown == done
        assert len(shown) == len(TEAM_NAMES)

    def test_each_team_is_skipped_for_its_own_reason(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            done = await press(database)

            return {str(zeile.team_id): zeile.uebersprungen for zeile in done.zeilen}

        skips = on_a_league(mongo_replica_set_url, body)

        assert skips == {
            str(TWO_SEATS): None,
            str(UNCONFIRMED): "keine_bestaetigte_kontaktperson",
            str(NO_BLOCK): "kein_kontaktblock",
            str(ALREADY_MAILED): "bereits_gesendet",
            str(WITHDRAWN): "austritt_eingetragen",
        }

    def test_it_mails_the_confirmed_seats_of_the_team_it_reaches(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            done = await press(database)

            return {str(zeile.team_id): tuple(entry.email for entry in zeile.empfaenger) for zeile in done.zeilen}

        addressed = on_a_league(mongo_replica_set_url, body)

        assert addressed[str(TWO_SEATS)] == ("bramblewick@example.com", "quillhilde@example.com")
        # Empty exactly where a skip is set, so a caller mails nobody for a team the answer skipped.
        assert addressed[str(UNCONFIRMED)] == ()
        assert addressed[str(NO_BLOCK)] == ()
        assert addressed[str(ALREADY_MAILED)] == ()
        # The withdrawn team's own seat IS confirmed, so an empty list here is the withdrawal's doing.
        assert addressed[str(WITHDRAWN)] == ()

    def test_it_mints_for_the_team_it_mails_and_for_no_other(self, mongo_replica_set_url: str):
        """Per team, the count the plan asks for: one live invitation where it minted, one where it skipped a mailed team, none elsewhere."""

        async def body(database: AsyncDatabase) -> Any:
            done = await press(database)
            counts = {str(team_id): await live_count(database, team_id) for team_id in TEAM_NAMES}
            tokens = {str(zeile.team_id): zeile.token for zeile in done.zeilen}

            return counts, tokens

        counts, tokens = on_a_league(mongo_replica_set_url, body)

        assert counts == {str(TWO_SEATS): 1, str(UNCONFIRMED): 0, str(NO_BLOCK): 0, str(ALREADY_MAILED): 1, str(WITHDRAWN): 0}
        assert tokens[str(TWO_SEATS)]
        assert tokens[str(UNCONFIRMED)] is None
        assert tokens[str(NO_BLOCK)] is None
        assert tokens[str(ALREADY_MAILED)] is None
        assert tokens[str(WITHDRAWN)] is None

    def test_a_withdrawn_team_is_left_with_no_invitation_at_all(self, mongo_replica_set_url: str):
        """Its own seat IS confirmed, so a press reading the contact block alone would mint and mail for it."""

        async def body(database: AsyncDatabase) -> Any:
            await press(database)

            return await database[Collection.EINLADUNGEN].count_documents({"team_id": WITHDRAWN})

        assert on_a_league(mongo_replica_set_url, body) == 0

    def test_the_answer_names_every_team_whose_link_this_press_kills(self, mongo_replica_set_url: str):
        """What a page warns about before the press: the message already in somebody's inbox stops opening anything."""

        async def body(database: AsyncDatabase) -> Any:
            shown = await preview(database, erneut=True)
            done = await press(database, erneut=True)

            return (
                {str(zeile.team_id): zeile.ersetzt_link for zeile in shown.zeilen},
                {str(zeile.team_id): zeile.ersetzt_link for zeile in done.zeilen},
            )

        warned, performed = on_a_league(mongo_replica_set_url, body)

        assert warned == performed
        # The team holding a mailed link loses it; the one holding none loses nothing, and neither
        # does a team the press skips.
        assert warned == {
            str(TWO_SEATS): False,
            str(UNCONFIRMED): False,
            str(NO_BLOCK): False,
            str(ALREADY_MAILED): True,
            str(WITHDRAWN): False,
        }

    def test_a_team_already_mailed_keeps_the_link_its_message_carried(self, mongo_replica_set_url: str):
        """A skip leaves the team exactly as it was, or the link in somebody's inbox stops opening anything."""

        async def body(database: AsyncDatabase) -> Any:
            before = await database[Collection.EINLADUNGEN].find_one({"_id": SEEDED_EINLADUNG})
            await press(database)
            after = await database[Collection.EINLADUNGEN].find_one({"_id": SEEDED_EINLADUNG})

            return before, after

        before, after = on_a_league(mongo_replica_set_url, body)

        assert before == after

    def test_a_re_send_replaces_the_mailed_teams_link(self, mongo_replica_set_url: str):
        """The raw value is recoverable from nothing, so a link to be mailed again is one that has just been minted."""

        async def body(database: AsyncDatabase) -> Any:
            done = await press(database, erneut=True)
            zeile = next(zeile for zeile in done.zeilen if zeile.team_id == ALREADY_MAILED)
            replaced = await database[Collection.EINLADUNGEN].find_one({"_id": SEEDED_EINLADUNG})

            assert replaced is not None
            return zeile, replaced["widerrufen_am"], await live_count(database, ALREADY_MAILED)

        zeile, widerrufen_am, live = on_a_league(mongo_replica_set_url, body)

        assert zeile.uebersprungen is None
        assert zeile.token
        assert str(zeile.einladung_id) != str(SEEDED_EINLADUNG)
        assert widerrufen_am == TODAY
        assert live == 1

    def test_a_re_send_still_reaches_no_team_with_nobody_to_mail(self, mongo_replica_set_url: str):
        """`erneut` answers the third skip alone, so it cannot become the switch that mails an unproven address."""

        async def body(database: AsyncDatabase) -> Any:
            done = await press(database, erneut=True)

            return {str(zeile.team_id): zeile.uebersprungen for zeile in done.zeilen}

        skips = on_a_league(mongo_replica_set_url, body)

        assert skips[str(UNCONFIRMED)] == "keine_bestaetigte_kontaktperson"
        assert skips[str(NO_BLOCK)] == "kein_kontaktblock"

    def test_the_preview_shows_the_re_send_it_is_asked_about(self, mongo_replica_set_url: str):
        """Asked with the switch the press will carry, or the list an administrator reads is not the list they then perform."""

        async def body(database: AsyncDatabase) -> Any:
            shown = await preview(database, erneut=True)
            done = await press(database, erneut=True)

            return decided(shown.zeilen), decided(done.zeilen)

        shown, done = on_a_league(mongo_replica_set_url, body)

        assert shown == done

    def test_a_second_press_skips_the_team_whose_send_was_recorded(self, mongo_replica_set_url: str):
        """The whole of the idempotence: the skip reads the delivery record, which only the accepted send writes."""

        async def body(database: AsyncDatabase) -> Any:
            first = await press(database)
            minted = next(zeile for zeile in first.zeilen if zeile.team_id == TWO_SEATS)

            # What `POST /zustellung/angenommen` writes once the message has gone out. Without it no
            # record exists, and the second press below mints again.
            await database[Collection.EINLADUNGEN].update_one(
                {"_id": ObjectId(minted.einladung_id)}, {"$set": {"versand.zustellung": dict(ZUSTELLUNG)}}
            )

            second = await press(database)

            return {str(zeile.team_id): zeile.uebersprungen for zeile in second.zeilen}, await live_count(database, TWO_SEATS)

        skips, live = on_a_league(mongo_replica_set_url, body)

        assert skips[str(TWO_SEATS)] == "bereits_gesendet"
        assert live == 1

    def test_a_press_over_a_link_no_send_was_recorded_for_mints_again(self, mongo_replica_set_url: str):
        """Pressed twice with nothing recorded between, the team is reached twice -- which is what a withheld send leaves behind."""

        async def body(database: AsyncDatabase) -> Any:
            first = await press(database)
            second = await press(database)

            minted = [next(zeile for zeile in done.zeilen if zeile.team_id == TWO_SEATS) for done in (first, second)]

            return [str(zeile.einladung_id) for zeile in minted], await live_count(database, TWO_SEATS)

        ids, live = on_a_league(mongo_replica_set_url, body)

        assert ids[0] != ids[1]
        assert live == 1

    def test_a_season_that_has_ended_refuses_the_press(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(DocumentConflictException) as conflict:
                await press(database)

            return conflict.value.error_code, await database[Collection.EINLADUNGEN].count_documents({"widerrufen_am": None})

        code, live = on_a_league(mongo_replica_set_url, body, saison_status="past")

        assert code == EINLADUNG_SAISON_VORBEI
        # The seeded invitation is untouched, so the refusal stopped the whole press rather than part of it.
        assert live == 1

    def test_a_season_holding_no_team_answers_an_empty_list(self, mongo_replica_set_url: str):
        """An empty state the page renders, rather than an error an administrator has to interpret."""

        async def body(database: AsyncDatabase) -> Any:
            return (await preview(database)).zeilen, (await press(database)).zeilen

        shown, done = on_a_league(mongo_replica_set_url, body, teams=())

        assert shown == []
        assert done == []

    def test_one_team_s_transaction_failing_leaves_every_other_row_in_the_answer(self, mongo_replica_set_url: str):
        """The press answers a complete list or the teams already done hold links whose raw values died with the exception."""

        async def body(database: AsyncDatabase) -> Any:
            collection = as_collection(_InsertFailsForOneTeam(database[Collection.EINLADUNGEN], ALREADY_MAILED))
            done = await post_einladungen_versand(
                saison_id=SAISON_ID,
                versand_data=FLEinladungVersandPayload(erneut=True),
                saison_teams_collection=database[Collection.SAISON_TEAMS],
                einladungen_collection=collection,
                saisons_collection=database[Collection.SAISONS],
                db=database.client,
                erstellt_von=ADMIN,
                today=TODAY,
            )
            seeded = await database[Collection.EINLADUNGEN].find_one({"_id": SEEDED_EINLADUNG})

            assert seeded is not None
            return (
                {str(zeile.team_id): (zeile.uebersprungen, zeile.token is not None, zeile.ersetzt_link) for zeile in done.zeilen},
                seeded["widerrufen_am"],
                await live_count(database, TWO_SEATS),
            )

        rows, widerrufen_am, live = on_a_league(mongo_replica_set_url, body)

        # The failed team: a row of its own, no token, and no claim that a link of its died.
        assert rows[str(ALREADY_MAILED)] == ("erzeugung_fehlgeschlagen", False, False)
        # Its transaction aborted, so the link somebody already holds is untouched and still opens.
        assert widerrufen_am is None
        # Every other team is answered as though nothing had gone wrong, its raw link included.
        assert rows[str(TWO_SEATS)] == (None, True, False)
        assert rows[str(WITHDRAWN)] == ("austritt_eingetragen", False, False)
        assert live == 1

    def test_it_files_a_revocation_only_for_a_team_that_holds_a_link(self, mongo_replica_set_url: str):
        """An unconditional revoke files one log row per team holding nothing, which is a season's worth saying nothing happened."""

        async def revocations(database: AsyncDatabase) -> int:
            return await database[Collection.AKTIONEN].count_documents({"collection": "einladungen", "operation": "patch_many"})

        async def body(database: AsyncDatabase) -> Any:
            await press(database)
            plain = await revocations(database)
            # The control: with `erneut` the already-mailed team IS reissued, so exactly one
            # revocation is filed and a press filing none at all would fail here.
            await press(database, erneut=True)

            return plain, await revocations(database)

        assert on_a_league(mongo_replica_set_url, body) == (0, 2)

    def test_the_press_writes_no_delivery_record_of_its_own(self, mongo_replica_set_url: str):
        """The mint mails nobody: `POST /zustellung/angenommen` is the only writer of a record, so a press that wrote one would lie."""

        async def body(database: AsyncDatabase) -> Any:
            await press(database)
            minted = await database[Collection.EINLADUNGEN].find_one({"team_id": TWO_SEATS})

            assert minted is not None
            return minted["versand"]

        assert on_a_league(mongo_replica_set_url, body) == {}
