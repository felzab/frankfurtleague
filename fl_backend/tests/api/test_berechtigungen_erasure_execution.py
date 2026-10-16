"""
API · the erasure's grants step: an erased person's grants, the notices naming them, and the records they made

Against a replica set, the step run in a transaction of its own as the registry runs it. Seeded through
the composers each route writes with, so a field a route stores in another shape is one these cases miss.
"""

from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase

from app.api.berechtigungen.erasure import ErasedGrantsAndAuthorship, erase_grants_and_authorship_in_session
from app.api.berechtigungen.schemas import FLBerechtigungStand
from app.api.berechtigungen.services import compose_postausgang
from app.api.einladungen.services import compose_einladung
from app.api.kontakte.services import same_address
from app.api.registrierungen.services import compose_ablehnung_update
from app.api.sperrliste.services import compose_gesperrt_bis_saison_id
from app.core.collections import Collection
from app.core.recording import ERASED_ACTOR_MARKER
from tests.bans import ban_list
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import ban_document, bewerbung_document, kontakte_document, registrierung_document, saison_document
from tests.whole_database import where_held
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_berechtigungen_erasure_test")

NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
# When the notices she finds still queued were, so none reads as one the erasure queued.
QUEUED = datetime(2026, 3, 31, 9, 0, tzinfo=UTC)
TODAY = "2026-04-01"
RUNNING = "2026"
STANDING = compose_gesperrt_bis_saison_id(massgebliche_saison_id=RUNNING)

# The person erased, an owner. Distinctive, so the whole-database scan finding it is no coincidence.
ERIKA = "erika.zwirbelmoos@frankfurtleague.de"
# Her mailbox as a paste, or an actor stored before the fold, typed it: the fold claims it.
ERIKA_TYPED = "Erika.Zwirbelmoos@FrankfurtLeague.de"
# Another mailbox, which a pattern leaving the dot unescaped takes as hers.
NAHE = "erikaxzwirbelmoos@frankfurtleague.de"
# Another mailbox, a long s where hers has an s: the pattern's `i` may read it as hers, the fold does not.
LANGES_S = ERIKA.replace("moos@", f"moo{chr(0x17F)}@")
# Her mailbox at a Unicode domain, whose fold is punycode, and as a paste would spell it, the full stop
# fullwidth: only the fold equates the two, so a read narrowed on any spelling of the address misses it.
ERIKA_UNICODE = "erika@xn--mller-kva.de"
ERIKA_UNICODE_PASTED = "Erika@MÜLLER．de"
# Another `owner`, erasing her as the administrator's own route will.
DORA = "dora.inhaberin@frankfurtleague.de"
BERND = "bernd.admin@frankfurtleague.de"
CLARA = "clara.admin@frankfurtleague.de"
GESPERRT = "gesperrt@beispiel.de"

ERIKA_ID = ObjectId("6890a1b2c3d4e5f607a10001")
# A second row of hers in a spelling no request matches: a dead grant still holds the address.
ERIKA_DEAD_ID = ObjectId("6890a1b2c3d4e5f607a10002")
DORA_ID = ObjectId("6890a1b2c3d4e5f607a10003")
BERND_ID = ObjectId("6890a1b2c3d4e5f607a10004")
CLARA_ID = ObjectId("6890a1b2c3d4e5f607a10005")
NAHE_ID = ObjectId("6890a1b2c3d4e5f607a10006")
GESPERRT_ID = ObjectId("6890a1b2c3d4e5f607a10007")

# The notices still queued when she is erased, one per way a notice can name her or not.
NAMING_HER_GRANT = ObjectId("6890a1b2c3d4e5f607a20001")
MADE_BY_HER = ObjectId("6890a1b2c3d4e5f607a20002")
A_BARRED_GRANT_BY_HER = ObjectId("6890a1b2c3d4e5f607a20003")
NOT_HERS = ObjectId("6890a1b2c3d4e5f607a20004")

# The records she made, each in a store the step reaches, and a bystander's beside each.
BAN_BY_HER, BAN_BY_HER_TYPED, BAN_BY_DORA, BAN_BY_NAHE, BAN_BY_LANGES_S = (ObjectId(f"6890a1b2c3d4e5f607a3000{n}") for n in range(1, 6))
INVITE_BY_HER, INVITE_BY_DORA = ObjectId("6890a1b2c3d4e5f607a40001"), ObjectId("6890a1b2c3d4e5f607a40002")
DECIDED_BY_HER, DECIDED_BY_DORA = ObjectId("6890a1b2c3d4e5f607a50001"), ObjectId("6890a1b2c3d4e5f607a50002")
DECLINED_BY_HER, DECLINED_BY_DORA = ObjectId("6890a1b2c3d4e5f607a60001"), ObjectId("6890a1b2c3d4e5f607a60002")

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def grant_row(grant_id: ObjectId, adresse: str, verwaltung: str, erteilt_von: str) -> dict[str, Any]:
    return {
        "_id": grant_id,
        "adresse": adresse,
        "verwaltung": verwaltung,
        "erteilt_von": erteilt_von,
        "erteilt_am": datetime(2026, 1, 1, tzinfo=UTC),
    }


def announced(grant_id: ObjectId, adresse: str, verwaltung: str) -> dict[str, Any]:
    return {"_id": grant_id, "adresse": adresse, "verwaltung": verwaltung, "angekuendigt_am": datetime(2026, 1, 2, tzinfo=UTC)}


def notice(
    row_id: ObjectId, grant_id: ObjectId, art: Any, jetzt: str | None, vorher: str | None, von: str, *, gesperrt: frozenset[str] = frozenset()
) -> dict[str, Any]:
    def stand(adresse: str | None) -> FLBerechtigungStand | None:
        return None if adresse is None else FLBerechtigungStand(adresse=adresse, verwaltung="administration")

    return {
        "_id": row_id,
        **compose_postausgang(
            berechtigung_id=grant_id, art=art, jetzt=stand(jetzt), vorher=stand(vorher), geaendert_von=von, now=QUEUED, gesperrt=gesperrt
        ),
    }


def decided(bewerbung_id: ObjectId, von: str) -> dict[str, Any]:
    return bewerbung_document(
        bewerbung_id,
        RUNNING,
        "abgelehnt",
        kontakte=kontakte_document(),
        eingereicht_am="2026-03-01",
        entscheidung={"getroffen_am": "2026-03-10", "von": von, "grund": "Keine Halle"},
    )


def declined(registrierung_id: ObjectId, von: str) -> dict[str, Any]:
    stored = registrierung_document(
        registrierung_id,
        f"pupil-{registrierung_id}@beispiel.de",
        saison_id=RUNNING,
        team_id=ObjectId(),
        vorname="Rita",
        nachname="Registriert",
        token=str(registrierung_id),
        eingereicht_am="2026-03-20",
        frist="2026-03-27",
    )

    return {**stored, **compose_ablehnung_update(von=von, grund="Nicht in der Stufe", today="2026-03-22")["$set"]}


async def a_league_she_administered(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_one(saison_document(RUNNING, "active"))
    await database[Collection.BERECHTIGUNGEN].insert_many(
        [
            grant_row(ERIKA_ID, ERIKA, "owner", "PLAYGROUND"),
            grant_row(ERIKA_DEAD_ID, ERIKA_TYPED, "administration", "PLAYGROUND"),
            grant_row(DORA_ID, DORA, "owner", "PLAYGROUND"),
            grant_row(BERND_ID, BERND, "administration", ERIKA),
            grant_row(CLARA_ID, CLARA, "administration", ERIKA_TYPED),
            grant_row(NAHE_ID, NAHE, "administration", DORA),
        ]
    )
    await database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT].insert_many(
        [
            announced(ERIKA_ID, ERIKA, "owner"),
            announced(DORA_ID, DORA, "owner"),
            *(announced(grant_id, adresse, "administration") for grant_id, adresse in ((BERND_ID, BERND), (CLARA_ID, CLARA), (NAHE_ID, NAHE))),
        ]
    )
    await database[Collection.BERECHTIGUNGEN_POSTAUSGANG].insert_many(
        [
            notice(NAMING_HER_GRANT, ERIKA_ID, "geaendert", ERIKA, ERIKA, DORA),
            notice(MADE_BY_HER, BERND_ID, "erteilt", BERND, None, ERIKA_TYPED),
            notice(A_BARRED_GRANT_BY_HER, GESPERRT_ID, "entzogen", None, GESPERRT, ERIKA, gesperrt=frozenset({GESPERRT})),
            notice(NOT_HERS, CLARA_ID, "erteilt", CLARA, None, DORA),
        ]
    )
    await database[Collection.SPERRLISTE].insert_many(
        [
            ban_document(f"gebannt-{number}@beispiel.de", bis=STANDING, _id=ban_id, erstellt_von=von)
            for number, (ban_id, von) in enumerate(
                (
                    (BAN_BY_HER, ERIKA),
                    (BAN_BY_HER_TYPED, ERIKA_TYPED),
                    (BAN_BY_DORA, DORA),
                    (BAN_BY_NAHE, NAHE),
                    (BAN_BY_LANGES_S, LANGES_S),
                )
            )
        ]
    )
    await database[Collection.EINLADUNGEN].insert_many(
        [
            {
                "_id": invite_id,
                **compose_einladung(saison_id=RUNNING, team_id=ObjectId(), token_hash=f"hash-{invite_id}", erstellt_von=von, today=TODAY),
            }
            for invite_id, von in ((INVITE_BY_HER, ERIKA), (INVITE_BY_DORA, DORA))
        ]
    )
    await database[Collection.BEWERBUNGEN].insert_many([decided(DECIDED_BY_HER, ERIKA), decided(DECIDED_BY_DORA, DORA)])
    await database[Collection.REGISTRIERUNGEN].insert_many([declined(DECLINED_BY_HER, ERIKA), declined(DECLINED_BY_DORA, DORA)])


def on_a_league(url: str, body: Body) -> Any:
    """The shipped validators, so a write production would refuse fails here too."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await a_league_she_administered(database)

            return await body(database, client)

    return on_the_seed_loop(_run())


async def erased(
    database: AsyncDatabase, client: AsyncMongoClient, *, geaendert_von: str = DORA, identifier: str = ERIKA
) -> ErasedGrantsAndAuthorship:
    async def step(session: AsyncClientSession) -> ErasedGrantsAndAuthorship:
        return await erase_grants_and_authorship_in_session(
            berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
            berechtigungen_angekuendigt_collection=database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT],
            berechtigungen_postausgang_collection=database[Collection.BERECHTIGUNGEN_POSTAUSGANG],
            bewerbungen_collection=database[Collection.BEWERBUNGEN],
            registrierungen_collection=database[Collection.REGISTRIERUNGEN],
            einladungen_collection=database[Collection.EINLADUNGEN],
            sperrliste_collection=database[Collection.SPERRLISTE],
            sperrliste=ban_list(database),
            identifier=identifier,
            geaendert_von=geaendert_von,
            now=NOW,
            session=session,
        )

    async with client.start_session() as session:
        return await session.with_transaction(step)


async def ids_in(database: AsyncDatabase, collection: Collection) -> set[ObjectId]:
    return {row["_id"] async for row in database[collection].find({}, {"_id": 1})}


async def queued_for(database: AsyncDatabase, grant_id: ObjectId) -> list[Mapping[str, Any]]:
    """The notices about one grant this erasure queued, as stored, in the order it queued them."""

    projection = {"_id": 0, "art": 1, "urheber": 1, "jetzt": 1, "vorher": 1, "geaendert_von": 1, "vorenthalten": 1}

    return [
        row
        async for row in database[Collection.BERECHTIGUNGEN_POSTAUSGANG]
        .find({"berechtigung_id": grant_id, "erfasst_am": NOW}, projection)
        .sort("_id", 1)
    ]


class TestHerGrantsGo:
    def test_every_grant_her_address_holds_goes_her_owner_grant_and_a_dead_spelling_included(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[ErasedGrantsAndAuthorship, set[ObjectId], set[ObjectId]]:
            result = await erased(database, client)

            return result, await ids_in(database, Collection.BERECHTIGUNGEN), await ids_in(database, Collection.BERECHTIGUNGEN_ANGEKUENDIGT)

        result, grants, records = on_a_league(mongo_replica_set_url, body)

        assert grants == {DORA_ID, BERND_ID, CLARA_ID, NAHE_ID}
        assert records == {DORA_ID, BERND_ID, CLARA_ID, NAHE_ID}
        assert (result.removed_berechtigungen, result.removed_angekuendigt) == (2, 1)

    def test_the_last_owner_goes_below_the_floor_of_two_and_the_step_refuses_neither(self, mongo_replica_set_url: str):
        """Neither the revoke's floor nor its owner refusal holds against the step (`docs/backend/spec.md :: I435`, `:: I436`).

        Whether the last owner may go is the caller's: `fl_backend/tests/api/test_funktionen_erasure.py :: TestTheLastOwner`.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[str]:
            await database[Collection.BERECHTIGUNGEN].delete_many({"_id": {"$nin": [ERIKA_ID, BERND_ID]}})
            await erased(database, client)

            return [str(row["_id"]) async for row in database[Collection.BERECHTIGUNGEN].find()]

        assert on_a_league(mongo_replica_set_url, body) == [str(BERND_ID)]

    def test_a_grant_pasted_with_her_domain_in_unicode_goes_and_her_pasted_authorship_with_it(self, mongo_replica_set_url: str):
        """A paste may type the domain as an address book shows it, which the pattern built from the fold never reads."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[bool, Any, dict[str, list[str]]]:
            pasted, granted = ObjectId(), ObjectId()
            await database[Collection.BERECHTIGUNGEN].insert_many(
                [
                    grant_row(pasted, ERIKA_UNICODE_PASTED, "administration", "PLAYGROUND"),
                    grant_row(granted, "neu@frankfurtleague.de", "administration", ERIKA_UNICODE_PASTED),
                ]
            )
            await erased(database, client, identifier=ERIKA_UNICODE)
            stands = await database[Collection.BERECHTIGUNGEN].find_one({"_id": pasted}) is not None
            row = await database[Collection.BERECHTIGUNGEN].find_one({"_id": granted})
            assert row is not None

            return stands, row["erteilt_von"], await where_held(database, "MÜLLER")

        assert on_a_league(mongo_replica_set_url, body) == (False, ERASED_ACTOR_MARKER, {"MÜLLER": []})


class TestTheNotices:
    """`docs/backend/spec.md :: I659`: no notice still queued names her, and every administrator is told her grant ended."""

    def test_her_grants_end_is_queued_already_withheld_and_attributed_to_who_erased_her(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Mapping[str, Any]]:
            await erased(database, client)

            return await queued_for(database, ERIKA_ID)

        assert on_a_league(mongo_replica_set_url, body) == [
            {
                "art": "entzogen",
                "urheber": "anwendung",
                "jetzt": None,
                "vorher": {"adresse": None, "verwaltung": "owner"},
                "geaendert_von": DORA,
                "vorenthalten": "geloescht",
            }
        ]

    def test_erased_on_her_own_request_her_grants_end_names_its_maker_by_the_marker(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Any]:
            await erased(database, client, geaendert_von=ERIKA_TYPED)

            return [row["geaendert_von"] for row in await queued_for(database, ERIKA_ID)]

        assert on_a_league(mongo_replica_set_url, body) == [ERASED_ACTOR_MARKER]

    def test_a_database_edit_to_her_grant_nobody_was_told_of_goes_out_first_withheld_too(self, mongo_replica_set_url: str):
        """A promotion pasted and never announced: dropped, the holders never learn she held the tier (`docs/backend/spec.md :: I451`)."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[tuple[Any, ...]]:
            await database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT].update_one({"_id": ERIKA_ID}, {"$set": {"verwaltung": "administration"}})
            await erased(database, client)

            return [
                (row["art"], row["urheber"], row["jetzt"], row["vorher"], row["vorenthalten"]) for row in await queued_for(database, ERIKA_ID)
            ]

        withheld = {"adresse": None, "verwaltung": "owner"}
        assert on_a_league(mongo_replica_set_url, body) == [
            ("geaendert", "datenbank", withheld, {"adresse": None, "verwaltung": "administration"}, "geloescht"),
            ("entzogen", "anwendung", None, withheld, "geloescht"),
        ]

    def test_a_record_of_her_kept_under_a_grant_since_repointed_goes_and_that_grant_stands(self, mongo_replica_set_url: str):
        """Repointed in the database and not yet compared: the record is hers, the grant somebody else's (`docs/backend/spec.md :: I464`)."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[set[ObjectId], set[ObjectId], list[tuple[Any, ...]]]:
            await database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT].update_one({"_id": NAHE_ID}, {"$set": {"adresse": ERIKA}})
            await erased(database, client)
            queued = [(row["art"], row["urheber"], row["vorher"], row["vorenthalten"]) for row in await queued_for(database, NAHE_ID)]

            return await ids_in(database, Collection.BERECHTIGUNGEN), await ids_in(database, Collection.BERECHTIGUNGEN_ANGEKUENDIGT), queued

        grants, records, queued = on_a_league(mongo_replica_set_url, body)

        assert NAHE_ID in grants
        assert NAHE_ID not in records
        assert queued == [("entzogen", "datenbank", {"adresse": None, "verwaltung": "administration"}, "geloescht")]

    def test_every_notice_queued_before_her_erasure_names_her_nowhere_and_no_other_moves(self, mongo_replica_set_url: str):
        """Her grant's address withheld under its own reason; her as the actor, the marker; a ban's reason kept beside it."""

        sites = ("jetzt", "vorher", "geaendert_von", "vorenthalten")

        async def stored(database: AsyncDatabase) -> dict[ObjectId, tuple[Any, ...]]:
            return {
                row["_id"]: tuple(row[site] for site in sites)
                async for row in database[Collection.BERECHTIGUNGEN_POSTAUSGANG].find(
                    {"_id": {"$in": [NAMING_HER_GRANT, MADE_BY_HER, A_BARRED_GRANT_BY_HER, NOT_HERS]}}
                )
            }

        async def body(
            database: AsyncDatabase, client: AsyncMongoClient
        ) -> tuple[dict[ObjectId, tuple[Any, ...]], dict[ObjectId, tuple[Any, ...]], int]:
            before = await stored(database)
            result = await erased(database, client)

            return before, await stored(database), result.withheld_postausgang

        before, after, withheld = on_a_league(mongo_replica_set_url, body)

        bernd = {"adresse": BERND, "verwaltung": "administration"}
        assert after[NAMING_HER_GRANT] == (
            {"adresse": None, "verwaltung": "administration"},
            {"adresse": None, "verwaltung": "administration"},
            DORA,
            "geloescht",
        )
        assert after[MADE_BY_HER] == (bernd, None, ERASED_ACTOR_MARKER, None)
        assert after[A_BARRED_GRANT_BY_HER] == (None, {"adresse": None, "verwaltung": "administration"}, ERASED_ACTOR_MARKER, "gesperrt")
        assert after[NOT_HERS] == before[NOT_HERS]
        assert withheld == 3


class TestTheRecordsSheMade:
    """`docs/backend/spec.md :: I660`: a grant, a ban, an invite or a decision she made names her by the marker alone."""

    AUTHORS = (
        (Collection.BERECHTIGUNGEN, BERND_ID, ("erteilt_von",)),
        (Collection.BERECHTIGUNGEN, CLARA_ID, ("erteilt_von",)),
        (Collection.SPERRLISTE, BAN_BY_HER, ("erstellt_von",)),
        (Collection.SPERRLISTE, BAN_BY_HER_TYPED, ("erstellt_von",)),
        (Collection.EINLADUNGEN, INVITE_BY_HER, ("erstellt_von",)),
        (Collection.BEWERBUNGEN, DECIDED_BY_HER, ("entscheidung", "von")),
        (Collection.REGISTRIERUNGEN, DECLINED_BY_HER, ("entscheidung", "von")),
    )

    BYSTANDERS = (
        (Collection.BERECHTIGUNGEN, NAHE_ID, ("erteilt_von",), DORA),
        (Collection.SPERRLISTE, BAN_BY_DORA, ("erstellt_von",), DORA),
        (Collection.SPERRLISTE, BAN_BY_NAHE, ("erstellt_von",), NAHE),
        (Collection.SPERRLISTE, BAN_BY_LANGES_S, ("erstellt_von",), LANGES_S),
        (Collection.EINLADUNGEN, INVITE_BY_DORA, ("erstellt_von",), DORA),
        (Collection.BEWERBUNGEN, DECIDED_BY_DORA, ("entscheidung", "von"), DORA),
        (Collection.REGISTRIERUNGEN, DECLINED_BY_DORA, ("entscheidung", "von"), DORA),
    )

    @staticmethod
    async def author(database: AsyncDatabase, collection: Collection, row_id: ObjectId, path: tuple[str, ...]) -> Any:
        value: Any = await database[collection].find_one({"_id": row_id})
        for key in path:
            value = value[key]

        return value

    def test_every_record_she_made_reads_the_marker_whatever_spelling_stored_her(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[list[Any], int]:
            result = await erased(database, client)

            return [await self.author(database, collection, row_id, path) for collection, row_id, path in self.AUTHORS], result.marked

        authors, marked = on_a_league(mongo_replica_set_url, body)

        assert authors == [ERASED_ACTOR_MARKER] * len(self.AUTHORS)
        assert marked == len(self.AUTHORS)

    def test_another_administrators_records_keep_their_author_a_similar_address_included(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Any]:
            await erased(database, client)

            return [await self.author(database, collection, row_id, path) for collection, row_id, path, _ in self.BYSTANDERS]

        assert on_a_league(mongo_replica_set_url, body) == [author for _, _, _, author in self.BYSTANDERS]

    def test_the_pattern_reads_the_long_s_spelling_so_the_fold_alone_keeps_that_ban(self, mongo_replica_set_url: str):
        """The control under the case above: a server whose `i` refused the long s would let that case pass on the pattern alone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> set[ObjectId]:
            cursor = await database[Collection.SPERRLISTE].aggregate([{"$match": {"erstellt_von": same_address(ERIKA)}}])

            return {row["_id"] for row in await cursor.to_list()}

        assert BAN_BY_LANGES_S in on_a_league(mongo_replica_set_url, body)


def test_her_address_is_held_nowhere_in_the_database_in_either_spelling(mongo_replica_set_url: str):
    """Rendered whole, the step's own log rows included: an image or a filter naming her would keep what the step destroys."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> dict[str, list[str]]:
        held = await where_held(database, ERIKA, ERIKA_TYPED)
        assert held[ERIKA] and held[ERIKA_TYPED], f"the control: the seed holds her nowhere, so the scan below proves nothing: {held}"
        await erased(database, client)

        return await where_held(database, ERIKA, ERIKA_TYPED)

    assert on_a_league(mongo_replica_set_url, body) == {ERIKA: [], ERIKA_TYPED: []}
