import asyncio
from collections.abc import Awaitable, Callable, Mapping
from typing import Any, cast

import pytest
from bson import ObjectId
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.invitations.crud import owed_invitation_mails
from app.api.invitations.schemas import FLInvitationMailPayload
from app.api.invitations.services import (
    InvitationRecipient,
    find_live_invitation_filter,
    find_unknown_invitation_refusal,
)
from app.api.outbox.services import enqueue_mails, final_update
from app.api.saisons.admin_router import get_saison_admin, post_invitations_dispatch
from app.api.teams.admin_router import delete_invitation, get_team_saison_admin, post_invitation, post_invitation_dispatch
from app.core import clock
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError, DocumentNotFoundError
from app.shared.tokens import hash_token
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import kontaktperson_document, rules_document, saison_document, saison_team_document, team_document
from tests.holds import HeldCollection
from tests.outbox import MAIL_NOW
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_invitation_test")

SAISON_ID = "2026"
ADMIN = "admin@frankfurtleague.de"
TODAY = "2026-04-01"
CONFIRMED_ON = "2026-03-20"

# One per skip state, plus the team the press mails and a club the season never admitted.
TWO_SEATS = ObjectId("6890a1b2c3d4e5f607260001")
UNCONFIRMED = ObjectId("6890a1b2c3d4e5f607260002")
NO_BLOCK = ObjectId("6890a1b2c3d4e5f607260003")
ALREADY_MAILED = ObjectId("6890a1b2c3d4e5f607260004")
WITHDRAWN = ObjectId("6890a1b2c3d4e5f607260006")
NOT_ENTERED = ObjectId("6890a1b2c3d4e5f607260005")

SEEDED_INVITATION = ObjectId("6890a1b2c3d4e5f607260011")

REGISTRIERUNG: Mapping[str, Any] = {"open": True, "end": "2026-04-30"}

TEAM_NAMES = {TWO_SEATS: "Adler", UNCONFIRMED: "Bieber", NO_BLOCK: "Cronberg", ALREADY_MAILED: "Dornbusch", WITHDRAWN: "Eschborn"}

AUSTRITT: Mapping[str, Any] = {"type": "rueckzug", "reason": "Zu wenige Spieler", "date": "2026-03-25"}


def kontaktperson(first_name: str, email: str, *, confirmed_at: str | None) -> dict[str, Any]:
    return kontaktperson_document(first_name, confirmed_at=confirmed_at, email=email, phone="+49 69 1234567")


def kontakte(*, trainer: Any = None, ansprechperson: Any = None) -> dict[str, Any]:
    return {"trainer": trainer, "ansprechperson": ansprechperson, "stellvertretung": None, "trainer_is_also": None}


SEEDED_KONTAKTE: Mapping[ObjectId, Any] = {
    TWO_SEATS: kontakte(
        trainer=kontaktperson("Bramblewick", "bramblewick@example.com", confirmed_at=CONFIRMED_ON),
        ansprechperson=kontaktperson("Quillhilde", "quillhilde@example.com", confirmed_at=CONFIRMED_ON),
    ),
    UNCONFIRMED: kontakte(trainer=kontaktperson("Zorbanax", "zorbanax@example.com", confirmed_at=None)),
    NO_BLOCK: None,
    ALREADY_MAILED: kontakte(trainer=kontaktperson("Fendrick", "fendrick@example.com", confirmed_at=CONFIRMED_ON)),
    # CONFIRMED, so the skip below is the withdrawal's and not the block's: seeded unconfirmed, this
    # team would be skipped by a press that had never heard of an `austritt`.
    WITHDRAWN: kontakte(trainer=kontaktperson("Gwendolyn", "gwendolyn@example.com", confirmed_at=CONFIRMED_ON)),
}


def junction_row(team_id: ObjectId, *, saison_id: str = SAISON_ID) -> dict[str, Any]:
    name = TEAM_NAMES[team_id]

    return saison_team_document(
        saison_id,
        team_id,
        name,
        name[:3].upper(),
        _id=ObjectId(),
        austritt=dict(AUSTRITT) if team_id == WITHDRAWN else None,
        kontakte=SEEDED_KONTAKTE[team_id],
    )


def invitation_row(team_id: ObjectId, *, _id: ObjectId | None = None, sent_at: str | None = None) -> dict[str, Any]:
    return {
        "_id": _id or ObjectId(),
        "saison_id": SAISON_ID,
        "team_id": team_id,
        "token_hashes": [hash_token(f"seeded-{team_id}")],
        "revoked_at": None,
        "sent_at": sent_at,
    }


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, saison_status: str = "active") -> Any:
    """The shipped indexes, one season, and the four teams in their four skip states.

    `ALREADY_MAILED`'s invitation had its mail sent, the state the press skips on.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await database[Collection.SAISONS].insert_one(
                saison_document(
                    SAISON_ID,
                    saison_status,
                    rules=rules_document(number_of_gruppen=2, max_kader_size=50),
                    registrierung=dict(REGISTRIERUNG),
                )
            )
            await database[Collection.TEAMS].insert_many(
                [team_document(team_id, name, name[:3].upper()) for team_id, name in TEAM_NAMES.items()]
            )
            await database[Collection.SAISON_TEAMS].insert_many([junction_row(team_id) for team_id in TEAM_NAMES])
            await database[Collection.INVITATIONS].insert_one(invitation_row(ALREADY_MAILED, _id=SEEDED_INVITATION, sent_at="2026-03-15"))
            await a_sent_mail(database, SEEDED_INVITATION, "fendrick@example.com")

            return await body(database)

    return on_the_seed_loop(_run())


async def a_sent_mail(database: AsyncDatabase, invitation_id: ObjectId, to: str) -> None:
    """One mail about this invite, owed and reported sent, as the drain leaves it."""

    async with database.client.start_session() as session:
        await enqueue_mails(
            outbox_collection=database[Collection.OUTBOX],
            session=session,
            mails=owed_invitation_mails(
                invitation_id=invitation_id,
                team_id=ALREADY_MAILED,
                team_name="Seeded",
                saison_id=SAISON_ID,
                recipient=[InvitationRecipient(rolle="trainer", email=to)],
                occasion="dispatch",
            ),
            now=MAIL_NOW,
        )
    await database[Collection.OUTBOX].update_many({"reference.id": invitation_id}, dict(final_update("sent", now=MAIL_NOW)))


async def mint(database: AsyncDatabase, team_id: ObjectId, *, invitations: Any = None) -> Any:
    return await post_invitation(
        team_id=team_id,
        saison_id=SAISON_ID,
        invitations_collection=invitations if invitations is not None else database[Collection.INVITATIONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        db=database.client,
        today=TODAY,
    )


async def revoke(database: AsyncDatabase, team_id: ObjectId) -> Any:
    return await delete_invitation(
        team_id=team_id,
        saison_id=SAISON_ID,
        invitations_collection=database[Collection.INVITATIONS],
        teams_collection=database[Collection.TEAMS],
        today=TODAY,
        db=database.client,
    )


async def read_state(database: AsyncDatabase, team_id: ObjectId) -> Any:
    """The team editor's read, whose `link` serves the live invitation."""

    async with database.client.start_session(snapshot=True) as session:
        return await get_team_saison_admin(
            team_id=team_id,
            saison_id=SAISON_ID,
            teams_collection=database[Collection.TEAMS],
            saison_teams_collection=database[Collection.SAISON_TEAMS],
            saisons_collection=database[Collection.SAISONS],
            spiele_collection=database[Collection.SPIELE],
            invitations_collection=database[Collection.INVITATIONS],
            outbox_collection=database[Collection.OUTBOX],
            spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
            schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
            session=session,
            today=TODAY,
            now=clock.german_instant(TODAY, "12:00:00"),
        )


async def editor(database: AsyncDatabase) -> Any:
    """The season editor's read, whose registration links' rows are the press's own plan."""

    return await get_saison_admin(
        saison_id=SAISON_ID,
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        teams_collection=database[Collection.TEAMS],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
        invitations_collection=database[Collection.INVITATIONS],
        today=TODAY,
    )


async def press(database: AsyncDatabase) -> Any:
    return await post_invitations_dispatch(
        saison_id=SAISON_ID,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        invitations_collection=database[Collection.INVITATIONS],
        saisons_collection=database[Collection.SAISONS],
        outbox_collection=database[Collection.OUTBOX],
        db=database.client,
        today=TODAY,
        germany_now=MAIL_NOW,
    )


async def owed_for(database: AsyncDatabase, team_id: ObjectId) -> list[str]:
    """The addresses every invite of this team was owed, oldest first."""

    ids = [row["_id"] for row in await database[Collection.INVITATIONS].find({"team_id": team_id}, {"_id": 1}).to_list(length=None)]
    rows = await database[Collection.OUTBOX].find({"reference.id": {"$in": ids}}).sort("_id", 1).to_list(length=None)

    return [row["to"] for row in rows]


async def dispatched(database: AsyncDatabase) -> list[str | None]:
    """The season named by each row a press wrote: nameless, the Protokoll cannot say which season was mailed."""

    return [row["label"] async for row in database[Collection.ACTION_LOG].find({"action": "saison.invitations_dispatched"})]


async def live_count(database: AsyncDatabase, team_id: ObjectId) -> int:
    return await database[Collection.INVITATIONS].count_documents({"saison_id": SAISON_ID, "team_id": team_id, "revoked_at": None})


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


class TestWhatAMintStores:
    def test_the_raw_link_reaches_the_answer_and_no_stored_field(self, mongo_replica_set_url: str):
        """A link recoverable from the row would make the admin read the place every live credential leaks from."""

        async def body(database: AsyncDatabase) -> Any:
            response = await mint(database, TWO_SEATS)
            stored = await database[Collection.INVITATIONS].find_one({})

            return response.token, repr(stored)

        token, stored = on_a_league(mongo_replica_set_url, body)

        assert token
        assert token not in stored

    def test_the_write_is_logged_without_the_raw_link(self, mongo_replica_set_url: str):
        """The log is the second place a value survives a feature built to keep none."""

        async def body(database: AsyncDatabase) -> Any:
            response = await mint(database, TWO_SEATS)

            return response.token, repr([row async for row in database[Collection.ACTION_LOG].find()])

        token, recorded = on_a_league(mongo_replica_set_url, body)

        assert "team.invitation_created" in recorded, "the mint filed no log row at all, so the assertion below holds of nothing"
        assert token not in recorded

    def test_the_withdrawal_is_logged_under_the_club(self, mongo_replica_set_url: str):
        """A row naming only a season says nothing of whose link went, and a search by the club misses it."""

        async def body(database: AsyncDatabase) -> Any:
            await mint(database, TWO_SEATS)
            await revoke(database, TWO_SEATS)

            return [row["label"] async for row in database[Collection.ACTION_LOG].find({"action": "team.invitation_withdrawn"})]

        assert on_a_league(mongo_replica_set_url, body) == [TEAM_NAMES[TWO_SEATS]]


class TestReissuingALink:
    def test_a_second_mint_leaves_exactly_one_live_invitation(self, mongo_replica_set_url: str):
        """The revoke and the mint are one transaction, so the team is never without a link and never holds two."""

        async def body(database: AsyncDatabase) -> Any:
            first = await mint(database, TWO_SEATS)
            second = await mint(database, TWO_SEATS)
            rows = await database[Collection.INVITATIONS].find({"team_id": TWO_SEATS}).to_list(length=None)

            return first, second, rows

        first, second, rows = on_a_league(mongo_replica_set_url, body)

        assert first.invitation_id != second.invitation_id
        # The replaced row STAYS: a delivery event about the message carrying it still has to land.
        assert len(rows) == 2
        assert [row["revoked_at"] for row in rows if row["_id"] == ObjectId(first.invitation_id)] == [TODAY]
        assert [row["revoked_at"] for row in rows if row["_id"] == ObjectId(second.invitation_id)] == [None]

    def test_the_replaced_links_hash_then_opens_nothing(self, mongo_replica_set_url: str):
        """`document_not_found` over the filter S9 reads: the revocation term is half of it, and a hash alone finds the spent row."""

        async def body(database: AsyncDatabase) -> Any:
            first = await mint(database, TWO_SEATS)
            await mint(database, TWO_SEATS)

            found = await database[Collection.INVITATIONS].find_one(dict(find_live_invitation_filter(token_hash=hash_token(first.token))))
            by_hash_alone = await database[Collection.INVITATIONS].count_documents({"token_hashes": hash_token(first.token)})
            # A value no mint ever produced, so the second cause is driven rather than assumed.
            unknown = await database[Collection.INVITATIONS].find_one(dict(find_live_invitation_filter(token_hash=hash_token("never-minted"))))

            return found, by_hash_alone, unknown

        found, by_hash_alone, unknown = on_a_league(mongo_replica_set_url, body)

        assert found is None
        # The row is still there, which is what makes the revocation term load-bearing.
        assert by_hash_alone == 1
        assert unknown is None

        # The only rung both causes exist at: a replaced link and a stranger's guess answer with
        # the SAME refusal, message included, so nothing tells the guess it hit a real link.
        replaced = find_unknown_invitation_refusal(invitation_raw=found)
        guessed = find_unknown_invitation_refusal(invitation_raw=unknown)

        assert replaced is not None
        assert replaced.error_code == Code.DOCUMENT_NOT_FOUND
        assert replaced == guessed


class TestTwoMintsAtOnce:
    """The read and the write are not one statement, so two administrators pressing together both pass the read."""

    def test_a_mint_whose_revoke_ran_before_the_first_commit_is_answered_by_the_retry(self, mongo_replica_set_url: str):
        """The interleaving the case above cannot promise: without the hold a serial run passes it too."""

        async def body(database: AsyncDatabase) -> Any:
            committed = asyncio.Event()
            held = _HoldsAfterItsRevoke(database[Collection.INVITATIONS], committed)
            second = asyncio.create_task(mint(database, TWO_SEATS, invitations=held))
            await held.until_held(second)

            try:
                first = await mint(database, TWO_SEATS)
            except BaseException:
                await held.abandon(second)
                raise
            committed.set()
            answered = await second

            live = await database[Collection.INVITATIONS].find({"team_id": TWO_SEATS, "revoked_at": None}).to_list(length=None)

            return first.invitation_id, answered.invitation_id, held.revokes, held.insert_failures, [row["_id"] for row in live]

        first, second, revokes, failures, live = on_a_league(mongo_replica_set_url, body)

        # 112 is `WriteConflict`, which `with_transaction` retries: the second run revokes the first's link.
        assert (revokes, failures) == (2, ["OperationFailure:112"])
        assert live == [second] and first != second


class _HoldsAfterItsRevoke(HeldCollection):
    """A second mint held between its revoke and its insert until the first mint has committed.

    Records each revoke as well: how many attempts ran.
    """

    MISSED = "the second mint answered without revoking, so nothing held it across the first mint's commit"

    def __init__(self, collection: Any, committed: asyncio.Event) -> None:
        super().__init__(collection, committed)
        self.revokes = 0

    async def update_many(self, *args: Any, **kwargs: Any) -> Any:
        result = await self._collection.update_many(*args, **kwargs)
        self.revokes += 1
        await self.hold()

        return result


class TestWhatAMintRefuses:
    def test_a_team_the_season_does_not_hold_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(APIError) as conflict:
                await mint(database, NOT_ENTERED)

            return conflict.value.error_code, await database[Collection.INVITATIONS].count_documents({"team_id": NOT_ENTERED})

        code, stored = on_a_league(mongo_replica_set_url, body)

        assert code == Code.INVITATION_TEAM_NOT_ENTERED
        assert stored == 0

    def test_a_row_whose_exit_stands_is_refused_as_a_stale_page(self, mongo_replica_set_url: str):
        """The page locks the press once the exit stands, and the link would open nothing."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(APIError) as conflict:
                await mint(database, WITHDRAWN)

            return conflict.value.error_code, await live_count(database, WITHDRAWN)

        assert on_a_league(mongo_replica_set_url, body) == (Code.VERSION_STALE, 0)

    def test_a_season_that_has_ended_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(APIError) as conflict:
                await mint(database, TWO_SEATS)

            # The team the refused mint named: the seeded league holds an invitation of its own,
            # and a count over the collection would pass for holding that row rather than none.
            return conflict.value.error_code, await database[Collection.INVITATIONS].count_documents({"team_id": TWO_SEATS})

        code, stored = on_a_league(mongo_replica_set_url, body, saison_status="past")

        assert code == Code.SAISON_PAST
        assert stored == 0


class TestRevokingALink:
    def test_the_row_is_stamped_and_kept(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            minted = await mint(database, TWO_SEATS)
            revoked = await revoke(database, TWO_SEATS)
            stored = await database[Collection.INVITATIONS].find_one({"_id": ObjectId(minted.invitation_id)})

            assert stored is not None
            return minted.invitation_id, revoked.invitation_id, stored["revoked_at"]

        minted_id, revoked_id, revoked_at = on_a_league(mongo_replica_set_url, body)

        assert revoked_id == minted_id
        assert revoked_at == TODAY

    def test_a_link_already_revoked_is_not_revoked_twice(self, mongo_replica_set_url: str):
        """The second call must not re-stamp a spent row with today's date, which would rewrite when the link died."""

        async def body(database: AsyncDatabase) -> Any:
            await mint(database, TWO_SEATS)
            await revoke(database, TWO_SEATS)

            with pytest.raises(DocumentNotFoundError):
                await revoke(database, TWO_SEATS)

            return await live_count(database, TWO_SEATS)

        assert on_a_league(mongo_replica_set_url, body) == 0


async def mail(database: AsyncDatabase, team_id: ObjectId, invitation_id: Any) -> Any:
    return await post_invitation_dispatch(
        team_id=team_id,
        saison_id=SAISON_ID,
        mail_data=FLInvitationMailPayload(invitation_id=invitation_id),
        invitations_collection=database[Collection.INVITATIONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        outbox_collection=database[Collection.OUTBOX],
        db=database.client,
        today=TODAY,
        germany_now=MAIL_NOW,
    )


class TestTheTeamsMailPress:
    def test_it_owes_each_confirmed_seat_once_and_leaves_the_copied_link_alone(self, mongo_replica_set_url: str):
        """Pressed twice on one day, the second owes nothing; the write mints nothing, so the link shown for copying still opens."""

        async def body(database: AsyncDatabase) -> Any:
            minted = await mint(database, TWO_SEATS)
            first = await mail(database, TWO_SEATS, minted.invitation_id)
            await mail(database, TWO_SEATS, minted.invitation_id)
            copied = await database[Collection.INVITATIONS].find_one(dict(find_live_invitation_filter(token_hash=hash_token(minted.token))))

            return first.mailed, await owed_for(database, TWO_SEATS), copied is not None

        mailed, owed, opens = on_a_league(mongo_replica_set_url, body)

        assert mailed == 2
        assert owed == ["bramblewick@example.com", "quillhilde@example.com"]
        assert opens

    def test_a_row_whose_exit_stands_owes_its_confirmed_seat_nothing(self, mongo_replica_set_url: str):
        """A live link minted before the exit stands, and the stale page's press would mail it dead."""

        async def body(database: AsyncDatabase) -> Any:
            live = await database[Collection.INVITATIONS].insert_one(invitation_row(WITHDRAWN))
            with pytest.raises(APIError) as conflict:
                await mail(database, WITHDRAWN, live.inserted_id)

            return conflict.value.error_code, await owed_for(database, WITHDRAWN)

        assert on_a_league(mongo_replica_set_url, body) == (Code.VERSION_STALE, [])

    def test_a_season_that_has_ended_is_refused_owing_nothing(self, mongo_replica_set_url: str):
        """A page read before the next season's activation, whose press would mail a link that opens nothing for good."""

        async def body(database: AsyncDatabase) -> Any:
            live = await database[Collection.INVITATIONS].insert_one(invitation_row(TWO_SEATS))
            with pytest.raises(APIError) as conflict:
                await mail(database, TWO_SEATS, live.inserted_id)

            return conflict.value.error_code, await owed_for(database, TWO_SEATS)

        assert on_a_league(mongo_replica_set_url, body, saison_status="past") == (Code.SAISON_PAST, [])

    def test_an_invite_replaced_since_the_panel_read_it_is_a_404_owing_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            shown = await mint(database, TWO_SEATS)
            await mint(database, TWO_SEATS)
            with pytest.raises(DocumentNotFoundError):
                await mail(database, TWO_SEATS, shown.invitation_id)

            return await owed_for(database, TWO_SEATS)

        assert on_a_league(mongo_replica_set_url, body) == []


class TestTheTeamEditorsRead:
    def test_it_serves_the_live_link_with_what_became_of_its_last_mail(self, mongo_replica_set_url: str):
        """The editor's one read of a link: a failure here breaks the page for every club holding one."""

        async def body(database: AsyncDatabase) -> Any:
            minted = await mint(database, TWO_SEATS)
            return (
                ObjectId(minted.invitation_id),
                (await read_state(database, TWO_SEATS)).link.invitation,
                (await read_state(database, ALREADY_MAILED)).link.invitation,
                (await read_state(database, UNCONFIRMED)).link.invitation,
            )

        minted, never_mailed, mailed, none = on_a_league(mongo_replica_set_url, body)

        assert (never_mailed.id, never_mailed.delivery) == (minted, None)
        assert (mailed.id, mailed.delivery.state) == (SEEDED_INVITATION, "sent")
        assert none is None


class TestTheDayALinkWasSent:
    """The season press skips a team on its link's stored day, so a press owing the link's mails and stamping none has it mailed over."""

    def test_the_team_press_stamps_the_link_it_owes(self, mongo_replica_set_url: str):
        """The team's own press sends the same live link without minting, so a day the season press alone stamped would miss it."""

        async def body(database: AsyncDatabase) -> Any:
            minted = await mint(database, TWO_SEATS)
            await mail(database, TWO_SEATS, minted.invitation_id)
            stored = await database[Collection.INVITATIONS].find_one({"_id": ObjectId(minted.invitation_id)})

            assert stored is not None
            return stored["sent_at"]

        assert on_a_league(mongo_replica_set_url, body) == TODAY


class TestTheSeasonWidePress:
    """One press over a season whose four teams sit in the four states it can meet."""

    def test_a_mailed_link_whose_outbox_row_is_gone_is_not_mailed_again(self, mongo_replica_set_url: str):
        """The row is erased a retention after it settles: judged by it, the press would mail the club again and kill the link it holds."""

        async def body(database: AsyncDatabase) -> Any:
            await database[Collection.OUTBOX].delete_many({})
            await press(database)
            live = await database[Collection.INVITATIONS].find_one({"team_id": ALREADY_MAILED, "revoked_at": None}, {"_id": 1})

            return live

        live = on_a_league(mongo_replica_set_url, body)

        assert live is not None and live["_id"] == SEEDED_INVITATION

    def test_it_mails_the_confirmed_seats_of_the_team_it_reaches(self, mongo_replica_set_url: str):
        """Per team, the count the plan asks for: one live invitation where it minted, one where it skipped a mailed team, none elsewhere.

        The fresh row holds no link of its own: each owed mail mints one when it is handed out, and no token is answered.
        """

        async def body(database: AsyncDatabase) -> Any:
            done = await press(database)
            counts = {str(team_id): await live_count(database, team_id) for team_id in TEAM_NAMES}
            fresh = await database[Collection.INVITATIONS].find_one({"team_id": TWO_SEATS, "revoked_at": None})

            assert fresh is not None
            return (
                done,
                {str(team_id): await owed_for(database, team_id) for team_id in (TWO_SEATS, UNCONFIRMED, NO_BLOCK, WITHDRAWN)},
                counts,
                fresh["token_hashes"],
            )

        done, owed, counts, hashes = on_a_league(mongo_replica_set_url, body)

        assert counts == {str(TWO_SEATS): 1, str(UNCONFIRMED): 0, str(NO_BLOCK): 0, str(ALREADY_MAILED): 1, str(WITHDRAWN): 0}
        assert hashes == []
        assert owed[str(TWO_SEATS)] == ["bramblewick@example.com", "quillhilde@example.com"]
        # Nobody is owed a mail for a team the press skipped.
        assert owed[str(UNCONFIRMED)] == []
        assert owed[str(NO_BLOCK)] == []
        # The withdrawn team's own seat IS confirmed, so an empty list here is the withdrawal's doing.
        assert owed[str(WITHDRAWN)] == []
        assert (done.mailed, done.skipped, done.failed) == (1, 4, 0)

    def test_the_press_writes_one_row_across_the_teams_it_mails(self, mongo_replica_set_url: str):
        """One press is one act in the Protokoll, though each team it mails commits in a transaction of its own."""

        async def body(database: AsyncDatabase) -> Any:
            # Every link gone, so the press mails several teams, each in its own transaction.
            await database[Collection.INVITATIONS].delete_many({})

            return (await press(database)).mailed, await dispatched(database)

        mailed, recorded = on_a_league(mongo_replica_set_url, body)

        assert mailed > 1
        assert recorded == [SAISON_ID]

    def test_a_second_press_skips_the_team_whose_mails_are_owed(self, mongo_replica_set_url: str):
        """The whole of the idempotence: a mail still waiting in the outbox counts as sent, so a second press owes nothing twice."""

        async def body(database: AsyncDatabase) -> Any:
            await press(database)
            second = await press(database)

            return second.mailed, await live_count(database, TWO_SEATS), await owed_for(database, TWO_SEATS)

        mailed, live, owed = on_a_league(mongo_replica_set_url, body)

        assert mailed == 0
        assert live == 1
        assert len(owed) == 2

    def test_a_season_that_has_ended_refuses_the_press(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(APIError) as conflict:
                await press(database)

            return conflict.value.error_code, await database[Collection.INVITATIONS].count_documents({"revoked_at": None})

        code, live = on_a_league(mongo_replica_set_url, body, saison_status="past")

        assert code == Code.SAISON_PAST
        # The seeded invitation is untouched, so the refusal stopped the whole press rather than part of it.
        assert live == 1

    def test_one_team_s_transaction_failing_leaves_every_other_team_answered(self, mongo_replica_set_url: str):
        """The press answers for every team, or the teams already done hold mails nobody is told were owed."""

        async def body(database: AsyncDatabase) -> Any:
            # The seeded link never mailed, so the press revokes it and reaches the insert that fails.
            await database[Collection.INVITATIONS].update_one({"_id": SEEDED_INVITATION}, {"$set": {"sent_at": None}})
            collection = as_collection(_InsertFailsForOneTeam(database[Collection.INVITATIONS], ALREADY_MAILED))
            done = await post_invitations_dispatch(
                saison_id=SAISON_ID,
                saison_teams_collection=database[Collection.SAISON_TEAMS],
                invitations_collection=collection,
                saisons_collection=database[Collection.SAISONS],
                outbox_collection=database[Collection.OUTBOX],
                db=database.client,
                today=TODAY,
                germany_now=MAIL_NOW,
            )
            seeded = await database[Collection.INVITATIONS].find_one({"_id": SEEDED_INVITATION})

            assert seeded is not None
            return done, seeded["revoked_at"], await live_count(database, TWO_SEATS), await owed_for(database, TWO_SEATS)

        done, revoked_at, live, owed = on_a_league(mongo_replica_set_url, body)

        # The failed team, counted, and the three teams the plan skips: no block, no confirmed seat, withdrawn.
        assert (done.mailed, done.skipped, done.failed) == (1, 3, 1)
        # Its transaction aborted, so the link somebody already holds is untouched and still opens.
        assert revoked_at is None
        # Every other team is served as though nothing had gone wrong, its seats owed.
        assert owed == ["bramblewick@example.com", "quillhilde@example.com"]
        assert live == 1
