from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pydantic import SecretStr
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.api.sperrliste.admin_router import delete_sperrliste_eintrag, get_sperrliste, post_sperrliste_eintrag
from app.api.sperrliste.crud import address_is_gesperrt, read_sperrliste_page
from app.api.sperrliste.schemas import FLPostSperrlistePayload
from app.api.sperrliste.services import SPERRLISTE_ADRESSE_GESPERRT, SPERRLISTE_SCHLUESSEL_VERSION, adresse_hash
from app.api.spieler.admin_router import delete_spieler, erase_spieler
from app.core.collections import Collection
from app.core.exceptions import DocumentNotFoundException, WriteRefusalException
from tests.config import build_test_config
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import rules_document, saison_document
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_sperrliste_test")

CONFIG = build_test_config()

TODAY = "2026-04-01"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

ADMIN = "admin@frankfurtleague.de"

# Distinctive rather than "test@example.com": a sweep of a whole database for a fragment is evidence
# of absence only where a hit could not be coincidence.
BANNED = "Zorbanax@Beispielschule.de"
# The same person typing the same address differently -- the case the write and the check must agree
# on, and the one a per-spelling hash would let through.
BANNED_RETYPED = "zorbanax@beispielschule.de"
OTHER = "quillhilde@beispielschule.de"

# Searched for apart, so a row keeping either half of the address is caught where the whole is not.
BANNED_LOCAL_PART, BANNED_DOMAIN = BANNED.lower().split("@")
BANNED_SCHOOL = BANNED_DOMAIN.split(".")[0]

GRUND = "Falsches Geburtsdatum bei der Anmeldung"

# The league a ban needs to exist at all (`app/api/sperrliste/services.py ::
# find_keine_saison_refusal`), and the season every case here is counted from. What the five-season
# bound does with it is `tests/api/test_sperrliste_lapse_execution.py`'s.
ACTIVE_SAISON_ID = "2026"

# What a ban entered under `ACTIVE_SAISON_ID` covers through: the shipped validator requires the
# field, so a row written straight to the collection needs one too.
LAST_COVERED = "2031"

SAISON_DOCUMENT: dict[str, Any] = saison_document(ACTIVE_SAISON_ID, "active", rules=rules_document(number_of_groups=2, erlaubte_stufen=["E1"]))

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_clean_list(url: str, body: Body) -> Any:
    """The SHIPPED validator and the unique index, so a document production would refuse fails here too."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(dict(SAISON_DOCUMENT))

            return await body(database, client)

    return on_the_seed_loop(_run())


async def ban(database: AsyncDatabase, client: AsyncMongoClient, *, email: str = BANNED, grund: str = GRUND, von: str = ADMIN) -> Any:
    return await post_sperrliste_eintrag(
        sperrliste_data=FLPostSperrlistePayload(email=email, grund=grund),
        sperrliste_collection=database[Collection.SPERRLISTE],
        saisons_collection=database[Collection.SAISONS],
        db=client,
        config=CONFIG,
        erstellt_von=von,
        today=TODAY,
    )


async def rows_of(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    return [row async for row in database[Collection.SPERRLISTE].find().sort("_id", 1)]


class TestWhatABanStores:
    def test_the_row_carries_the_hash_the_reason_the_author_and_the_day(self, mongo_replica_set_url: str):
        """The shape every later read is built on, and the one the shipped `$jsonSchema` has to accept."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Mapping[str, Any]:
            await ban(database, client)
            stored = await database[Collection.SPERRLISTE].find_one({})

            assert stored is not None
            return stored

        stored = on_a_clean_list(mongo_replica_set_url, body)

        assert set(stored) == {"_id", "adresse_hash", "schluessel_version", "grund", "erstellt_von", "erstellt_am", "gesperrt_bis_saison_id"}
        assert stored["adresse_hash"] == adresse_hash(BANNED, schluessel=CONFIG.sperrliste_schluessel)
        assert stored["grund"] == GRUND
        assert stored["erstellt_von"] == ADMIN
        assert stored["erstellt_am"] == TODAY

    def test_the_row_records_the_label_its_key_was_derived_under(self, mongo_replica_set_url: str):
        """The only thing that would ever let an operator tell which rows a key in force was never able to match."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client)
            stored = await database[Collection.SPERRLISTE].find_one({})

            assert stored is not None
            return stored["schluessel_version"]

        assert on_a_clean_list(mongo_replica_set_url, body) == SPERRLISTE_SCHLUESSEL_VERSION

    def test_no_part_of_the_banned_address_reaches_the_row(self, mongo_replica_set_url: str):
        """The whole point of the collection, and the half nothing else in the suite would notice going wrong."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Mapping[str, Any]:
            await ban(database, client)
            stored = await database[Collection.SPERRLISTE].find_one({})

            assert stored is not None
            return stored

        stored = on_a_clean_list(mongo_replica_set_url, body)

        # `erstellt_von` is the ADMINISTRATOR's own address and the one field here that may hold
        # one, so the `@` clause is asked of everything beside it.
        assert "@" not in repr({key: value for key, value in stored.items() if key != "erstellt_von"})
        assert BANNED_LOCAL_PART not in repr(stored).lower()
        assert BANNED_SCHOOL not in repr(stored).lower()

    def test_the_write_is_recorded_without_the_address(self, mongo_replica_set_url: str):
        """The log is the second place a value can survive a feature built to keep none: the create files a row here too."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await ban(database, client)

            return repr([row async for row in database[Collection.AKTIONEN].find()])

        recorded = on_a_clean_list(mongo_replica_set_url, body)

        assert "sperrliste" in recorded, "the create filed no log row at all, so the assertion below holds of nothing"
        assert BANNED_LOCAL_PART not in recorded.lower()


class TestASecondBanOfOneAddress:
    def test_a_row_written_is_a_row_refused(self, mongo_replica_set_url: str):
        """The full cycle: the write and the check hash under one key, so a second ban meets the first.

        Keyed differently at the two ends, every case here still passes -- and the list silently
        refuses nobody.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> None:
            await ban(database, client)

            with pytest.raises(WriteRefusalException) as raised:
                await ban(database, client)

            assert raised.value.error_code == SPERRLISTE_ADRESSE_GESPERRT

        on_a_clean_list(mongo_replica_set_url, body)

    def test_the_same_address_retyped_meets_the_row_it_already_has(self, mongo_replica_set_url: str):
        """The case a per-spelling hash lets through: one person, two spellings, one row and one refusal."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await ban(database, client)

            with pytest.raises(WriteRefusalException) as raised:
                await ban(database, client, email=BANNED_RETYPED)

            assert raised.value.error_code == SPERRLISTE_ADRESSE_GESPERRT

            return await database[Collection.SPERRLISTE].count_documents({})

        assert on_a_clean_list(mongo_replica_set_url, body) == 1

    def test_the_index_refuses_a_second_row_the_check_never_saw(self, mongo_replica_set_url: str):
        """The backstop under the read: two administrators inside one window both pass it, and only the index decides.

        Written straight to the collection, which is what a second transaction committing between
        the read and the write amounts to.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> None:
            await ban(database, client)
            duplicate = {
                "adresse_hash": adresse_hash(BANNED_RETYPED, schluessel=CONFIG.sperrliste_schluessel),
                "schluessel_version": SPERRLISTE_SCHLUESSEL_VERSION,
                "grund": GRUND,
                "erstellt_von": ADMIN,
                "erstellt_am": TODAY,
                "gesperrt_bis_saison_id": LAST_COVERED,
            }

            with pytest.raises(DuplicateKeyError):
                await database[Collection.SPERRLISTE].insert_one(duplicate)

        on_a_clean_list(mongo_replica_set_url, body)

    def test_another_address_is_banned_beside_it(self, mongo_replica_set_url: str):
        """The control: a uniqueness rule keyed on nothing would refuse the second ban of any address at all."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await ban(database, client)
            await ban(database, client, email=OTHER)

            return await database[Collection.SPERRLISTE].count_documents({})

        assert on_a_clean_list(mongo_replica_set_url, body) == 2


class TestTheCheckASignUpWillAsk:
    def test_a_banned_address_answers_the_check_in_every_spelling(self, mongo_replica_set_url: str):
        """What a registration calls before it writes; nothing calls it yet, so this is the only thing holding it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[bool]:
            await ban(database, client)

            return [
                await address_is_gesperrt(
                    sperrliste_collection=database[Collection.SPERRLISTE],
                    adresse_hash=adresse_hash(typed, schluessel=CONFIG.sperrliste_schluessel),
                    massgebliche_saison_id=ACTIVE_SAISON_ID,
                )
                for typed in (BANNED, BANNED_RETYPED, "Zorbanax@BEISPIELSCHULE.DE  ")
            ]

        assert on_a_clean_list(mongo_replica_set_url, body) == [True, True, True]

    def test_an_address_the_list_does_not_hold_answers_false(self, mongo_replica_set_url: str):
        """The control: a check answering `True` for everything passes the case above and bars every sign-up."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> bool:
            await ban(database, client)

            return await address_is_gesperrt(
                sperrliste_collection=database[Collection.SPERRLISTE],
                adresse_hash=adresse_hash(OTHER, schluessel=CONFIG.sperrliste_schluessel),
                massgebliche_saison_id=ACTIVE_SAISON_ID,
            )

        assert on_a_clean_list(mongo_replica_set_url, body) is False

    def test_an_address_answers_false_once_its_row_is_lifted(self, mongo_replica_set_url: str):
        """The other half of the cycle: a ban that outlived its own removal would bar a person nobody can unbar."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> bool:
            created = await ban(database, client)
            await delete_sperrliste_eintrag(
                sperrliste_id=ObjectId(created.created_id),
                sperrliste_collection=database[Collection.SPERRLISTE],
                db=client,
            )

            return await address_is_gesperrt(
                sperrliste_collection=database[Collection.SPERRLISTE],
                adresse_hash=adresse_hash(BANNED, schluessel=CONFIG.sperrliste_schluessel),
                massgebliche_saison_id=ACTIVE_SAISON_ID,
            )

        assert on_a_clean_list(mongo_replica_set_url, body) is False


class TestWhatTheListServes:
    def test_the_served_rows_carry_no_address_and_no_hash(self, mongo_replica_set_url: str):
        """A read is the widest surface a stored value escapes through, and the hash is what a leaked collection lacks."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client)

            return await get_sperrliste(sperrliste_collection=database[Collection.SPERRLISTE])

        served = on_a_clean_list(mongo_replica_set_url, body)

        assert len(served.sperrliste) == 1
        rendered = served.model_dump_json()
        # `erstellt_von` carries the administrator's own address, so the banned one is named
        # directly rather than sought by its `@`.
        assert BANNED_LOCAL_PART not in rendered.lower()
        assert "adresse_hash" not in rendered
        assert served.sperrliste[0].grund == GRUND
        assert served.sperrliste[0].erstellt_von == ADMIN
        assert served.sperrliste[0].erstellt_am == TODAY

    def test_the_total_counts_the_collection_and_not_the_rows_served(self, mongo_replica_set_url: str):
        """A ban past the cap is enforced and not rendered, so the count is what says one is there to lift.

        The cap is driven rather than named: a total copied off the served rows passes otherwise.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, int]:
            await ban(database, client)
            await ban(database, client, email=OTHER)

            served = await get_sperrliste(sperrliste_collection=database[Collection.SPERRLISTE])
            capped = await read_sperrliste_page(sperrliste_collection=database[Collection.SPERRLISTE], limit=1)

            return served.anzahl_gesamt, capped[1]

        # The cap is what makes the pair differ: one row served, two held, and both reads say two.
        assert on_a_clean_list(mongo_replica_set_url, body) == (2, 2)

    def test_a_capped_read_serves_fewer_rows_than_it_counts(self, mongo_replica_set_url: str):
        """The state the frontend renders a note for, and the one nothing else in this suite produces."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, int]:
            await ban(database, client)
            await ban(database, client, email=OTHER)

            rows, anzahl_gesamt = await read_sperrliste_page(sperrliste_collection=database[Collection.SPERRLISTE], limit=1)

            return len(rows), anzahl_gesamt

        assert on_a_clean_list(mongo_replica_set_url, body) == (1, 2)

    def test_an_empty_list_counts_zero(self, mongo_replica_set_url: str):
        """`$count` emits NO document over an empty collection, so the reader has to answer zero for itself."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, int]:
            rows, anzahl_gesamt = await read_sperrliste_page(sperrliste_collection=database[Collection.SPERRLISTE], limit=10)

            return len(rows), anzahl_gesamt

        assert on_a_clean_list(mongo_replica_set_url, body) == (0, 0)

    def test_the_read_projects_away_every_field_it_does_not_serve(self, mongo_replica_set_url: str):
        """The hash and its label never cross the wire at all, where a read model would drop them only after they had."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[str]:
            await ban(database, client)
            rows, _ = await read_sperrliste_page(sperrliste_collection=database[Collection.SPERRLISTE], limit=10)

            return sorted(rows[0])

        # Sorted, so the order is the codepoint one rather than the projection's: `gesperrt_…`
        # precedes `grund`.
        assert on_a_clean_list(mongo_replica_set_url, body) == ["_id", "erstellt_am", "erstellt_von", "gesperrt_bis_saison_id", "grund"]

    def test_the_newest_ban_is_served_first(self, mongo_replica_set_url: str):
        """Two rows on ONE day, which is the case `erstellt_am` alone cannot order and an administrator meets first."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[str]:
            await ban(database, client, grund="Zuerst eingetragen")
            await ban(database, client, email=OTHER, grund="Danach eingetragen")

            served = await get_sperrliste(sperrliste_collection=database[Collection.SPERRLISTE])

            return [row.grund for row in served.sperrliste]

        assert on_a_clean_list(mongo_replica_set_url, body) == ["Danach eingetragen", "Zuerst eingetragen"]


class TestLiftingABan:
    def test_the_row_is_gone_and_its_neighbour_stands(self, mongo_replica_set_url: str):
        """A removal reaching past its own id would empty the list, which nothing else here would catch."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[str]:
            created = await ban(database, client)
            await ban(database, client, email=OTHER, grund="Bleibt stehen")

            await delete_sperrliste_eintrag(
                sperrliste_id=ObjectId(created.created_id),
                sperrliste_collection=database[Collection.SPERRLISTE],
                db=client,
            )

            return [str(row["grund"]) for row in await rows_of(database)]

        assert on_a_clean_list(mongo_replica_set_url, body) == ["Bleibt stehen"]

    def test_the_log_image_holds_the_whole_row_and_no_address(self, mongo_replica_set_url: str):
        """What outlives a lifted ban, pinned rather than assumed: the image is kept for `docs/backend/spec.md :: I119`'s twelve months.

        A field added to the row joins this image on the next removal, so the set is asserted whole.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            created = await ban(database, client)
            await delete_sperrliste_eintrag(
                sperrliste_id=ObjectId(created.created_id),
                sperrliste_collection=database[Collection.SPERRLISTE],
                db=client,
            )
            recorded = await database[Collection.AKTIONEN].find_one({"operation": "delete_many", "collection": "sperrliste"})

            assert recorded is not None
            return recorded

        recorded = on_a_clean_list(mongo_replica_set_url, body)
        images = recorded["before"]

        assert len(images) == 1
        assert set(images[0]) == {"_id", "adresse_hash", "schluessel_version", "grund", "erstellt_von", "erstellt_am", "gesperrt_bis_saison_id"}
        assert images[0]["grund"] == GRUND
        # The reason the image is safe to keep: it holds the hash and the administrator, never the
        # address the ban was taken from.
        assert BANNED_LOCAL_PART not in repr(images).lower()

    def test_an_id_no_row_holds_is_a_404_that_removes_nothing(self, mongo_replica_set_url: str):
        """A removal answering 200 over an empty result tells an administrator a ban is lifted that still stands."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await ban(database, client)

            with pytest.raises(DocumentNotFoundException):
                await delete_sperrliste_eintrag(
                    sperrliste_id=ObjectId("6890a1b2c3d4e5f60794ffff"),
                    sperrliste_collection=database[Collection.SPERRLISTE],
                    db=client,
                )

            return await database[Collection.SPERRLISTE].count_documents({})

        assert on_a_clean_list(mongo_replica_set_url, body) == 1


class TestAnErasureLeavesTheListStanding:
    def test_erasing_a_pupil_moves_no_row_of_the_ban_list(self, mongo_replica_set_url: str):
        """The deliberate exception (`docs/backend/spec.md :: I268`): the one record a person's own erasure does not reach.

        Driven through the real erasure rather than asserted about it, so a collection added to that
        walk fails here.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[list[Mapping[str, Any]], list[Mapping[str, Any]]]:
            await ban(database, client)
            before = await rows_of(database)

            # A pupil as one was stored BEFORE the registration flow existed, the shape production
            # still holds: this case needs a stored pupil to erase, not a route that made one.
            spieler_id = ObjectId()
            await database[Collection.SPIELER].insert_one(
                {
                    "_id": spieler_id,
                    "vorname": "Zorbanax",
                    "nachname": "Mustermann",
                    "einwilligung": {
                        "umfang": "kader_oeffentlich",
                        "erteilt_von": "erziehungsberechtigt",
                        "datum": TODAY,
                        "bestaetigt_am": TODAY,
                        "medien": False,
                        "text_version": None,
                    },
                    "geburtsdatum": None,
                    "inactive_since": None,
                }
            )
            await delete_spieler(spieler_id=spieler_id, spieler_collection=database[Collection.SPIELER], today=TODAY)
            await erase_spieler(
                spieler_id=spieler_id,
                spieler_collection=database[Collection.SPIELER],
                saison_spieler_collection=database[Collection.SAISON_SPIELER],
                aktionen_collection=database[Collection.AKTIONEN],
                db=client,
                germany_now=NOW,
            )

            return before, await rows_of(database)

        before, after = on_a_clean_list(mongo_replica_set_url, body)

        # Non-empty first: two empty lists compare equal, and an erasure that emptied the collection
        # would then read as one that left it alone.
        assert before
        assert after == before


class TestTheKeyTheRowsWereTakenUnder:
    def test_a_row_written_under_another_key_is_matched_by_nothing(self, mongo_replica_set_url: str):
        """Why the key can never be rotated: a rotation leaves every ban standing and refusing nobody, in silence.

        Nothing refuses a rotation -- the list still renders, and only this case says what it costs.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> bool:
            await database[Collection.SPERRLISTE].insert_one(
                {
                    "adresse_hash": adresse_hash(BANNED, schluessel=SecretStr("the-previous-key".ljust(64, "0"))),
                    # The label a row keyed under the previous master would carry: the validator
                    # closes no set, so the old population stays readable.
                    "schluessel_version": SPERRLISTE_SCHLUESSEL_VERSION,
                    "grund": GRUND,
                    "erstellt_von": ADMIN,
                    "erstellt_am": TODAY,
                    "gesperrt_bis_saison_id": LAST_COVERED,
                }
            )

            return await address_is_gesperrt(
                sperrliste_collection=database[Collection.SPERRLISTE],
                adresse_hash=adresse_hash(BANNED, schluessel=CONFIG.sperrliste_schluessel),
                massgebliche_saison_id=ACTIVE_SAISON_ID,
            )

        assert on_a_clean_list(mongo_replica_set_url, body) is False
