from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import bson
import pytest
from bson import ObjectId
from pydantic import ValidationError
from pymongo.asynchronous.database import AsyncDatabase

from app.api.einwilligung.services import FASSUNG_UNZULAESSIG
from app.api.kontakte.admin_router import erase_kontaktperson
from app.api.kontakte.schemas import FLKontaktErasurePayload
from app.api.teams.admin_router import patch_saison_team_kontakte
from app.api.teams.schemas import (
    FLKontaktKenntnisnahmePayload,
    FLKontaktperson,
    FLKontaktpersonPayload,
    FLPatchSaisonTeamKontaktePayload,
    FLSaisonTeamKontakte,
    FLTeamMembership,
)
from app.api.teams.services import (
    KONTAKTE_MOVED_UNDER_THE_SAVE,
    compose_kontakte_at_entry,
    compose_kontakte_herkunft,
    kontakte_stand_of,
)
from app.core.collections import Collection
from app.core.exceptions import DocumentNotFoundException, WriteRefusalException
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from tests.actor_tokens import FRESH_STEP_UP_CHECK
from tests.bans import ban_list
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import saison_document, saison_team_document
from tests.isolation import InterleavedCollection
from tests.worker import worker_database

# Marked per class rather than for the module: what the payload refuses and what the composition
# decides are reached with no container (`.claude/rules/backend.md`'s `tests` clause), while which
# KEYS a `$set` leaves alone only a stored document shows.
DATABASE_NAME = worker_database("fl_saison_team_kontakte_test")

SAISON_ID = "2026"
# A second season the SAME club holds a row in, seeded first so it is what a filter missing
# `saison_id` would reach.
OTHER_SAISON_ID = "2025"

# Fixed rather than generated, so a failure names the same club every run.
TEAM_OID = ObjectId("6890a1b2c3d4e5f607240001")
ABSENT_OID = ObjectId("6890a1b2c3d4e5f607240002")

TEAM_NAME = "Adler"
TEAM_SHORTHAND = "AD"

# The three fields this endpoint must not reach, each seeded to a value entry never writes: a `$set`
# carrying the whole payload would answer with `None` for all three.
GRUPPE = "C"
TRIKOT_FARBE = "bordeaux"
AUSTRITT: dict[str, Any] = {"type": "rueckzug", "grund": "Keine Mannschaft mehr", "datum": "2026-04-01"}

CONFIRMED_ON = "2026-03-15"
# An edit to a seat that changes nothing about who holds it: `person` writes the other number.
OTHER_TELEFON = "+4915199999999"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
TODAY = "2026-04-01"

# The label the editor stamps on a seat it fills, the one a new acceptance must name.
RUNNING_LABEL = LAUFENDE_FASSUNGEN["bewerbung"]
# A label stored on rows before the editor's labels were judged, which a seat its person keeps names back.
STORED_LABEL = "v1"


# On no payload: each person types their own on their confirmation page, so a seat only ever holds a
# date the server carried over from the row.
GEBURTSDATUM = "1990-05-17"


# One number per person: two different people sharing one is a payload the save refuses.
TELEFON: dict[str, str] = {
    "Ida": "+4915110000001",
    "Jonas": "+4915110000002",
    "Klara": "+4915110000003",
    "Lea": "+4915110000004",
    "Mika": "+4915110000005",
    "Nils": "+4915110000006",
    "Ove": "+4915110000007",
    "Bert": "+4915110000008",
    "Ida-Marie": "+4915110000001",
}


def person(vorname: str, *, email: str | None = None, text_version: str = RUNNING_LABEL) -> dict[str, Any]:
    """One person as the editor SENDS them: the consent names its scope, wording and day, and no source, stamp or birthdate."""

    return {
        "vorname": vorname,
        "nachname": "Musterfrau",
        "email": email or f"{vorname.lower()}@example.com",
        "telefon": TELEFON[vorname],
        "einwilligung": {"umfang": "kontaktdaten", "text_version": text_version, "datum": "2026-03-01"},
    }


def stored_person(
    vorname: str, *, email: str | None = None, erfasst_von: str = "administrativ", bestaetigt_am: str | None = None
) -> dict[str, Any]:
    """The same person as a row HOLDS them, provenance and birthdate included."""

    sent = person(vorname, email=email, text_version=STORED_LABEL)

    return {
        **sent,
        "geburtsdatum": GEBURTSDATUM,
        "einwilligung": {**sent["einwilligung"], "erfasst_von": erfasst_von, "bestaetigt_am": bestaetigt_am},
    }


def born(sent: dict[str, Any]) -> dict[str, Any]:
    """The record the editor writes for a person it newly seats: theirs alone, naming the league as who seated them.

    Spelled out here rather than composed by the helper, so a composer drifting from it fails.
    """

    return {**sent["einwilligung"], "bestaetigt_am": None, "medien": False, "eingetragen_von": "liga"}


def as_stored(kontakte: dict[str, Any]) -> dict[str, Any]:
    """What the endpoint writes from a payload whose seats no row already holds: every seat born afresh."""

    return {
        seat: ({**value, "geburtsdatum": None, "einwilligung": born(value)} if isinstance(value, dict) else value)
        for seat, value in kontakte.items()
    }


def unbestaetigt(einwilligung: dict[str, Any]) -> dict[str, Any]:
    """A stored record held unconfirmed: the stamp nulled and the stored speaker dropped, no write naming who answered."""

    return {**{field: value for field, value in einwilligung.items() if field != "erfasst_von"}, "bestaetigt_am": None}


def as_kept(stored: dict[str, Any]) -> dict[str, Any]:
    """A stored seat its unconfirmed person keeps through a save: the whole record, held unconfirmed."""

    return {**stored, "einwilligung": unbestaetigt(stored["einwilligung"])}


# The shape every row held before the stamp existed: a dated `person` on each seat, and no stamp key
# at all.
SEEDED_KONTAKTE: dict[str, Any] = {
    slot: {
        **person(vorname, text_version=STORED_LABEL),
        "geburtsdatum": GEBURTSDATUM,
        "einwilligung": {**person(vorname, text_version=STORED_LABEL)["einwilligung"], "erfasst_von": "person"},
    }
    for slot, vorname in (("trainer", "Ida"), ("ansprechperson", "Jonas"), ("stellvertretung", "Klara"))
} | {"trainer_ist_zugleich": None}

# The Trainer holding the Ansprechperson's seat too, so the two blocks are one person's.
NEW_KONTAKTE: dict[str, Any] = {
    "trainer": person("Lea"),
    "ansprechperson": person("Lea"),
    "stellvertretung": person("Nils"),
    "trainer_ist_zugleich": "ansprechperson",
}

# What an erasure leaves behind, and what the editor has to be able to send back.
ONE_SLOT_FILLED: dict[str, Any] = {
    "trainer": person("Ove"),
    "ansprechperson": None,
    "stellvertretung": None,
    "trainer_ist_zugleich": None,
}

# One seat its person confirmed, beside two nobody has.
PARTLY_CONFIRMED: dict[str, Any] = {
    "trainer": stored_person("Ida", erfasst_von="person", bestaetigt_am=CONFIRMED_ON),
    "ansprechperson": stored_person("Jonas"),
    "stellvertretung": stored_person("Klara"),
    "trainer_ist_zugleich": None,
}

# The seeded block as the EDITOR sends it back: the same three people with the provenance stripped,
# which is what an administrator's open page holds while somebody else asks to be forgotten.
RESAVED_AS_RENDERED: dict[str, Any] = {
    "trainer": person("Ida", text_version=STORED_LABEL),
    "ansprechperson": person("Jonas", text_version=STORED_LABEL),
    "stellvertretung": person("Klara", text_version=STORED_LABEL),
    "trainer_ist_zugleich": None,
}

# The same three seats before any of them answered their own link: a seat carries no date until the
# person enters one at their own confirmation (`docs/backend/spec.md :: I141`).
UNDATED_SEEDED: dict[str, Any] = {
    **SEEDED_KONTAKTE,
    **{slot: {**SEEDED_KONTAKTE[slot], "geburtsdatum": None} for slot in ("trainer", "ansprechperson", "stellvertretung")},
}

ERASED_SEAT = "ansprechperson"
ERASED_EMAIL = str(RESAVED_AS_RENDERED[ERASED_SEAT]["email"])


def junction_document(saison_id: str, kontakte: dict[str, Any] | None) -> dict[str, Any]:
    """One junction row as a season in progress holds it."""

    return saison_team_document(
        saison_id, TEAM_OID, TEAM_NAME, TEAM_SHORTHAND, gruppe=GRUPPE, austritt=dict(AUSTRITT), trikot_farbe=TRIKOT_FARBE, kontakte=kontakte
    )


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, seeded: dict[str, Any] | None = SEEDED_KONTAKTE) -> Any:
    """`constraints=True`, so what this endpoint stores is judged by the database's own validator rather than by Pydantic alone."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            # The other season FIRST: `find_one_and_update` takes natural order, so this is the row a
            # filter that forgot `saison_id` would write to.
            # Read by the save, which mints no link for a season that has ended.
            await database[Collection.SAISONS].insert_many([saison_document(OTHER_SAISON_ID, "past"), saison_document(SAISON_ID, "active")])
            await database[Collection.SAISON_TEAMS].insert_one(junction_document(OTHER_SAISON_ID, None))
            await database[Collection.SAISON_TEAMS].insert_one(junction_document(SAISON_ID, seeded))

            return await body(database)

    return on_the_seed_loop(_run())


async def write_kontakte(
    database: AsyncDatabase,
    kontakte: dict[str, Any] | None,
    *,
    # The token for what the caller last read off the row. Defaulted to the seed's rather than to the
    # payload's: taken from `kontakte` it would agree with the row by construction and judge nothing.
    stand: str = kontakte_stand_of(SEEDED_KONTAKTE),
    team_id: ObjectId = TEAM_OID,
    saison_id: str = SAISON_ID,
    saison_teams_collection: Any = None,
) -> Any:
    return await patch_saison_team_kontakte(
        team_id=team_id,
        saison_id=saison_id,
        kontakte_data=FLPatchSaisonTeamKontaktePayload.model_validate({"kontakte": kontakte, "kontakte_stand": stand}),
        saison_teams_collection=database[Collection.SAISON_TEAMS] if saison_teams_collection is None else saison_teams_collection,
        saisons_collection=database[Collection.SAISONS],
        sperrliste=ban_list(database),
        db=database.client,
        refuse_unconfirmed=FRESH_STEP_UP_CHECK,
        today=TODAY,
    )


async def erase_the_seats_person(database: AsyncDatabase) -> Any:
    """`POST /kontakte/erasure` for the person holding `ERASED_SEAT`, in a transaction of its own."""

    return await erase_kontaktperson(
        erasure_data=FLKontaktErasurePayload.model_validate({"email": ERASED_EMAIL}),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        aktionen_collection=database[Collection.AKTIONEN],
        db=database.client,
        germany_now=NOW,
    )


class JunctionRunningAHookBeforeTheWrite(InterleavedCollection):
    """The junction collection, running one hook immediately before the first update asked of it."""

    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()

        return await self._collection.find_one_and_update(*args, **kwargs)


async def row_now(database: AsyncDatabase, saison_id: str = SAISON_ID) -> dict[str, Any]:
    found = await database[Collection.SAISON_TEAMS].find_one({"team_id": TEAM_OID, "saison_id": saison_id})
    assert found is not None, f"the seeded row for {saison_id} is gone"

    return found


async def junction_log(database: AsyncDatabase) -> list[dict[str, Any]]:
    return await database[Collection.AKTIONEN].find({"collection": str(Collection.SAISON_TEAMS)}).sort("_id", 1).to_list(length=None)


@pytest.mark.db
class TestTheBlockIsWritten:
    def test_the_stored_block_is_the_one_sent_and_the_echo_is_the_stored_one(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            response = await write_kontakte(database, NEW_KONTAKTE)

            return response, await row_now(database)

        response, stored = on_a_league(mongo_replica_set_url, body)

        assert stored["kontakte"] == as_stored(NEW_KONTAKTE)
        assert response.kontakte is not None
        # The record each seat was born with, `medien` included: the echo is the row, its absent
        # evidence read as none set.
        assert response.kontakte.model_dump(mode="json") == {
            seat: (
                {**value, "einwilligung": {**value["einwilligung"], "erfasst_von": None, "nachweis": {"umfang": None, "medien": None}}}
                if isinstance(value, dict)
                else value
            )
            for seat, value in as_stored(NEW_KONTAKTE).items()
        }
        assert (response.saison_id, response.team_id) == (SAISON_ID, TEAM_OID)

    def test_a_null_clears_the_block(self, mongo_replica_set_url: str):
        """How a team with no recorded contacts is expressed at entry, and the only way back to it."""

        async def body(database: AsyncDatabase) -> Any:
            response = await write_kontakte(database, None)

            return response, await row_now(database)

        response, stored = on_a_league(mongo_replica_set_url, body)

        assert stored["kontakte"] is None
        assert response.kontakte is None

    def test_an_empty_slot_round_trips(self, mongo_replica_set_url: str):
        """A row an erasure emptied stays editable: two null slots are sent, stored and echoed back."""

        async def body(database: AsyncDatabase) -> Any:
            response = await write_kontakte(database, ONE_SLOT_FILLED)

            return response, await row_now(database)

        response, stored = on_a_league(mongo_replica_set_url, body)

        assert stored["kontakte"] == as_stored(ONE_SLOT_FILLED)
        assert response.kontakte is not None
        assert (response.kontakte.ansprechperson, response.kontakte.stellvertretung) == (None, None)


@pytest.mark.db
class TestTheProvenanceIsTheServers:
    """`docs/backend/spec.md :: I142`: a stored confirmation survives the editor, and nothing an editor sends can create one."""

    def test_a_confirmed_seat_keeps_its_source_and_its_stamp_through_an_edit(self, mongo_replica_set_url: str):
        """The data-loss path: the block is `$set` whole, so a stamp the write does not carry over is destroyed with no refusal.

        The telephone number is the edit here, and says nothing about who holds the seat.
        """

        edited = {**PARTLY_CONFIRMED, "trainer": {**person("Ida", email=PARTLY_CONFIRMED["trainer"]["email"]), "telefon": OTHER_TELEFON}}
        edited["ansprechperson"] = person("Jonas")
        edited["stellvertretung"] = person("Klara")

        async def body(database: AsyncDatabase) -> Any:
            response = await write_kontakte(database, edited, stand=kontakte_stand_of(PARTLY_CONFIRMED))

            return response, await row_now(database)

        response, stored = on_a_league(mongo_replica_set_url, body, seeded=PARTLY_CONFIRMED)

        trainer = stored["kontakte"]["trainer"]
        assert trainer["telefon"] == OTHER_TELEFON, "the edit itself did not land, so this case proves nothing"
        assert (trainer["einwilligung"]["erfasst_von"], trainer["einwilligung"]["bestaetigt_am"]) == ("person", CONFIRMED_ON)
        # The date goes the same way, and by the same route: the payload names none, so a save that
        # did not carry it over would leave a stamped seat with no birthdate at all (I141).
        assert trainer["geburtsdatum"] == GEBURTSDATUM
        assert response.kontakte is not None and response.kontakte.trainer is not None
        assert response.kontakte.trainer.einwilligung.bestaetigt_am == CONFIRMED_ON

    def test_a_confirmed_seat_renamed_at_its_own_address_starts_unconfirmed(self, mongo_replica_set_url: str):
        """A role mailbox handed from one teacher to the next, which the address alone cannot tell from an edit.

        The WhatsApp scope goes with the stamp and the date.
        """

        whatsapp = {
            **PARTLY_CONFIRMED,
            "trainer": {
                **PARTLY_CONFIRMED["trainer"],
                "einwilligung": {**PARTLY_CONFIRMED["trainer"]["einwilligung"], "umfang": "kontaktdaten_whatsapp"},
            },
        }
        successor = {**person("Bert", email=str(PARTLY_CONFIRMED["trainer"]["email"])), "nachname": "Neu"}
        renamed = {**RESAVED_AS_RENDERED, "trainer": successor}

        async def body(database: AsyncDatabase) -> Any:
            return await write_kontakte(database, renamed, stand=kontakte_stand_of(whatsapp)), await row_now(database)

        response, stored = on_a_league(mongo_replica_set_url, body, seeded=whatsapp)

        trainer = stored["kontakte"]["trainer"]
        assert (trainer["vorname"], trainer["nachname"]) == ("Bert", "Neu"), "the rename did not land, so this case proves nothing"
        assert trainer["einwilligung"] == born(successor)
        assert trainer["geburtsdatum"] is None
        assert response.kontakte is not None and response.kontakte.trainer is not None
        assert response.kontakte.trainer.einwilligung.bestaetigt_am is None

    def test_an_unconfirmed_seat_is_recorded_as_entered_on_the_persons_behalf(self, mongo_replica_set_url: str):
        """Whatever the row held before: a seat with no stamp is `administrativ`, and the stamp stays null."""

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, NEW_KONTAKTE, stand=kontakte_stand_of(PARTLY_CONFIRMED))

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body, seeded=PARTLY_CONFIRMED)

        for seat in ("ansprechperson", "stellvertretung"):
            assert "erfasst_von" not in stored["kontakte"][seat]["einwilligung"]
            assert stored["kontakte"][seat]["einwilligung"]["bestaetigt_am"] is None

    def test_a_confirmed_seat_handed_to_another_address_starts_unconfirmed(self, mongo_replica_set_url: str):
        """The confirmation is what one mailbox's owner clicked: a new address in the seat has clicked nothing."""

        replaced = {**PARTLY_CONFIRMED, "trainer": person("Ida", email="another.ida@example.com")}
        replaced["ansprechperson"] = person("Jonas")
        replaced["stellvertretung"] = person("Klara")

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, replaced, stand=kontakte_stand_of(PARTLY_CONFIRMED))

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body, seeded=PARTLY_CONFIRMED)

        assert stored["kontakte"]["trainer"]["einwilligung"] == born(person("Ida"))
        # And the date with it: it is a fact about the person, and this seat now holds another one.
        assert stored["kontakte"]["trainer"]["geburtsdatum"] is None

    def test_a_row_stored_before_the_stamp_is_written_as_unconfirmed(self, mongo_replica_set_url: str):
        """`person` with no stamp is the shape every row held before the stamp existed, and it is not a confirmation."""

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, {**NEW_KONTAKTE, "trainer": person("Ida"), "ansprechperson": person("Ida")})

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body)

        assert "erfasst_von" not in stored["kontakte"]["trainer"]["einwilligung"]
        assert stored["kontakte"]["trainer"]["einwilligung"]["bestaetigt_am"] is None


@pytest.mark.db
class TestNothingElseOnTheRowMoves:
    """The whole reason the endpoint exists: two editors write one row and must not clobber each other."""

    def test_the_group_the_exit_and_the_kit_colour_are_left_exactly_as_seeded(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, NEW_KONTAKTE)

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body)

        # By equality against the seed, not merely "not None": a wholesale `$set` would write the
        # payload's absent keys as nulls, and a colour cleared reads as an admin's own choice.
        assert stored["gruppe"] == GRUPPE
        assert stored["austritt"] == AUSTRITT
        assert stored["trikot_farbe"] == TRIKOT_FARBE
        assert (stored["name"], stored["shorthand"]) == (TEAM_NAME, TEAM_SHORTHAND)

    def test_the_same_clubs_other_season_is_not_the_row_that_moves(self, mongo_replica_set_url: str):
        """`saison_id` is half the filter: without it the club's earliest row takes the write."""

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, NEW_KONTAKTE)

            return await row_now(database, OTHER_SAISON_ID), await row_now(database)

        other, target = on_a_league(mongo_replica_set_url, body)

        assert other["kontakte"] is None
        assert target["kontakte"] == as_stored(NEW_KONTAKTE)


@pytest.mark.db
class TestAPairNoRowAnswers:
    def test_an_unknown_club_is_a_404_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await write_kontakte(database, NEW_KONTAKTE, team_id=ABSENT_OID)

            return await row_now(database), await junction_log(database)

        stored, log = on_a_league(mongo_replica_set_url, body)

        assert stored["kontakte"] == SEEDED_KONTAKTE
        # The refusal has to stop the write, not merely accompany it.
        assert log == []

    def test_a_season_the_club_holds_no_row_in_is_a_404(self, mongo_replica_set_url: str):
        """The pair is what is addressed: a club that exists and a season that exists still name no row."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await write_kontakte(database, NEW_KONTAKTE, saison_id="2027")

            return await row_now(database)

        assert on_a_league(mongo_replica_set_url, body)["kontakte"] == SEEDED_KONTAKTE


@pytest.mark.db
class TestTheWriteIsRecorded:
    def test_one_action_row_carries_the_block_this_write_replaced(self, mongo_replica_set_url: str):
        """The undo path: the pre-image is the only copy of three people's details a mistake overwrote."""

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, NEW_KONTAKTE)

            return await row_now(database), await junction_log(database)

        stored, log = on_a_league(mongo_replica_set_url, body)

        assert len(log) == 1
        assert log[0]["operation"] == "patch_one"
        assert log[0]["document_id"] == stored["_id"]
        assert log[0]["before"]["kontakte"] == SEEDED_KONTAKTE


@pytest.mark.db
class TestAnErasureLandingMidSaveIsNotUndone:
    """Two administrators on one row: an erasure empties a seat while the editor holds the block it rendered.

    The editor replaces the block whole, so its payload puts the seat back unless the endpoint
    judges the row first.
    """

    def test_a_seat_erased_under_the_save_is_refused_rather_than_put_back(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            erased: list[Any] = []

            async def erase_between() -> None:
                erased.append(await erase_the_seats_person(database))

            junction = JunctionRunningAHookBeforeTheWrite(database[Collection.SAISON_TEAMS], erase_between)
            with pytest.raises(WriteRefusalException) as refused:
                await write_kontakte(database, RESAVED_AS_RENDERED, saison_teams_collection=junction)
            # An erasure committing first refuses the save at its read, before it reaches the write.
            junction.assert_landed_inside(serially=0)

            return erased[0], refused.value, await row_now(database)

        erasure, refusal, stored = on_a_league(mongo_replica_set_url, body)

        assert erasure.cleared_kontakt_slots == 1, "the interference emptied no seat, so the save had nothing to undo"
        assert refusal.error_code == KONTAKTE_MOVED_UNDER_THE_SAVE
        assert stored["kontakte"][ERASED_SEAT] is None, "the save put the person who asked to be forgotten back on the row"

    def test_the_same_save_lands_the_seat_where_no_erasure_interferes(self, mongo_replica_set_url: str):
        """The control: without it the case above would pass on an endpoint that stored this seat for nobody."""

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, RESAVED_AS_RENDERED)

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body)

        # The seeded row's own date rides along: the address is the same person's, and the payload
        # names none for the composition to prefer.
        assert stored["kontakte"][ERASED_SEAT] == as_kept(SEEDED_KONTAKTE[ERASED_SEAT])


@pytest.mark.db
class TestASaveComposedAgainstAnotherBlockIsRefused:
    def test_the_row_keeps_what_it_held_and_records_nothing(self, mongo_replica_set_url: str):
        """A refusal has to stop the write rather than accompany it: the pre-image is the only copy of the block."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(WriteRefusalException) as refused:
                await write_kontakte(database, NEW_KONTAKTE, stand=kontakte_stand_of(PARTLY_CONFIRMED))

            return refused.value, await row_now(database), await junction_log(database)

        refusal, stored, log = on_a_league(mongo_replica_set_url, body)

        assert refusal.error_code == KONTAKTE_MOVED_UNDER_THE_SAVE
        assert stored["kontakte"] == SEEDED_KONTAKTE
        assert log == []

    def test_the_undo_replays_against_the_block_the_save_left(self, mongo_replica_set_url: str):
        """The write's own answer is the undo's precondition: the save has already moved the row past what the editor read.

        Under the running label: the save handed every seat on, so the replay seats each person afresh
        (`TestTheLabelASaveNames`).
        """

        replayed: dict[str, Any] = {
            slot: person(vorname) for slot, vorname in (("trainer", "Ida"), ("ansprechperson", "Jonas"), ("stellvertretung", "Klara"))
        }
        replayed["trainer_ist_zugleich"] = None

        async def body(database: AsyncDatabase) -> Any:
            saved = await write_kontakte(database, NEW_KONTAKTE)

            await write_kontakte(database, replayed, stand=saved.kontakte_stand)

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body)

        assert stored["kontakte"] == as_stored(replayed)


@pytest.mark.db
class TestTheReadsTokenIsWhatTheWriteAccepts:
    def test_a_save_carrying_the_token_the_membership_read_served_lands(self, mongo_replica_set_url: str):
        """The read takes its token over a VALIDATED block and the write over the raw one.

        Through the stored document rather than the block above, so a projection reaching one and not
        the other fails here.
        """

        async def body(database: AsyncDatabase) -> Any:
            served = FLTeamMembership.model_validate(await row_now(database))

            await write_kontakte(database, NEW_KONTAKTE, stand=served.kontakte_stand)

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body)

        assert stored["kontakte"] == as_stored(NEW_KONTAKTE)


class TestWhatThePayloadRefuses:
    """The provenance and the birthdate are on no payload: a field the editor merely hid would still be a route an API caller has."""

    @pytest.mark.parametrize(("field", "value"), [("erfasst_von", "person"), ("bestaetigt_am", CONFIRMED_ON)])
    def test_a_consent_naming_its_source_or_its_stamp_is_refused(self, field: str, value: str):
        with pytest.raises(ValidationError) as failure:
            FLKontaktKenntnisnahmePayload.model_validate({**person("Ida")["einwilligung"], field: value})

        assert [(entry["type"], entry["loc"][-1]) for entry in failure.value.errors()] == [("extra_forbidden", field)]

    @pytest.mark.parametrize("value", [pytest.param(GEBURTSDATUM, id="an adult's"), pytest.param("2015-01-01", id="a ten-year-old's")])
    def test_a_seat_naming_a_birthdate_is_refused_whatever_the_date(self, value: str):
        """Refused rather than bounded: an age floor here would still let an administrator enter a date the person alone may give."""

        with pytest.raises(ValidationError) as failure:
            FLKontaktpersonPayload.model_validate({**person("Ida"), "geburtsdatum": value})

        assert [(entry["type"], entry["loc"][-1]) for entry in failure.value.errors()] == [("extra_forbidden", "geburtsdatum")]

    def test_the_whole_block_is_refused_on_one_seats_source(self):
        """Through the endpoint's own payload, so the refusal reaches the wire as a 422 rather than a stored claim."""

        block = {**NEW_KONTAKTE, "trainer": stored_person("Lea", erfasst_von="person", bestaetigt_am=CONFIRMED_ON)}

        with pytest.raises(ValidationError) as failure:
            FLPatchSaisonTeamKontaktePayload.model_validate({"kontakte": block, "kontakte_stand": kontakte_stand_of(SEEDED_KONTAKTE)})

        assert {entry["type"] for entry in failure.value.errors()} == {"extra_forbidden"}

    def test_a_body_carrying_no_precondition_is_refused(self):
        """Optional, this field would land the backend alone: the acceptance supplies what an unchanged editor never sends."""

        with pytest.raises(ValidationError) as failure:
            FLPatchSaisonTeamKontaktePayload.model_validate({"kontakte": NEW_KONTAKTE})

        assert [(entry["type"], entry["loc"][-1]) for entry in failure.value.errors()] == [("missing", "kontakte_stand")]


class TestTheTwoContactRules:
    """The application's two rules on the season row too, an empty seat comparing with nothing.

    One refusal per rule, which a rule moved down to the application's payload fails; the rules' own
    table is `tests/api/test_bewerbung_submission_refusal.py :: TestTheThreeSeatsAreThreePeople`.
    """

    def block(self, **seats: Any) -> dict[str, Any]:
        return {"kontakte": {**RESAVED_AS_RENDERED, **seats}, "kontakte_stand": kontakte_stand_of(SEEDED_KONTAKTE)}

    def test_a_trainer_holding_a_seat_whose_block_differs_is_refused(self):
        """Two records of one person the erasure cannot pair up, each mailed a link of its own."""

        with pytest.raises(ValidationError) as failure:
            FLPatchSaisonTeamKontaktePayload.model_validate(self.block(trainer_ist_zugleich="ansprechperson"))

        assert "denen des Trainers" in str(failure.value)

    @pytest.mark.parametrize(
        "emptied",
        [pytest.param("trainer", id="the Trainer emptied"), pytest.param("ansprechperson", id="the seat they also hold emptied")],
    )
    def test_an_empty_side_of_the_pair_compares_with_nothing(self, emptied: str):
        """A seat an erasure or a Widerspruch emptied leaves the row editable."""

        sent = self.block(**{"ansprechperson": person("Ida"), "trainer_ist_zugleich": "ansprechperson", emptied: None})

        assert FLPatchSaisonTeamKontaktePayload.model_validate(sent).kontakte is not None

    def test_two_different_people_sharing_a_mailbox_on_the_sign_in_fold_are_refused(self):
        with pytest.raises(ValidationError) as failure:
            FLPatchSaisonTeamKontaktePayload.model_validate(self.block(ansprechperson={**person("Jonas"), "email": "IDA@example.com"}))

        assert "E-Mail-Adressen" in str(failure.value)

    def test_an_empty_seat_shares_nothing(self):
        """Two empty seats are not two people at one address."""

        sent = self.block(ansprechperson=None, stellvertretung=None)

        assert FLPatchSaisonTeamKontaktePayload.model_validate(sent).kontakte is not None


class TestTheCompositionDecidesFromItsArguments:
    """The pure half, so every branch is pinned without a container."""

    def test_a_cleared_block_stays_cleared(self):
        assert compose_kontakte_herkunft(kontakte=None, stored=PARTLY_CONFIRMED) is None

    @pytest.mark.parametrize("stored", [pytest.param(None, id="a row with no block"), pytest.param({}, id="an empty block")])
    def test_a_row_holding_no_block_yields_every_seat_unconfirmed(self, stored: Any):
        assert compose_kontakte_herkunft(kontakte=NEW_KONTAKTE, stored=stored) == as_stored(NEW_KONTAKTE)

    def test_the_address_is_matched_case_insensitively(self):
        """On the sign-in fold, which the erasure shares: a mailbox is one address however its local part is capitalised."""

        recased = {**PARTLY_CONFIRMED, "trainer": person("Ida", email="IDA@Example.com")}
        composed = compose_kontakte_herkunft(kontakte=recased, stored=PARTLY_CONFIRMED)

        assert composed is not None
        assert composed["trainer"]["einwilligung"]["bestaetigt_am"] == CONFIRMED_ON
        assert composed["trainer"]["geburtsdatum"] == GEBURTSDATUM

    def test_a_domain_spelled_with_ss_where_it_held_sharp_s_is_another_mailbox(self):
        """IDNA 2008 and the sign-in fold read „straße“ and „strasse“ as two domains: a stamp carried across confirms an unproven inbox."""

        held = {**PARTLY_CONFIRMED, "trainer": stored_person("Ida", email="ida@straße.de", erfasst_von="person", bestaetigt_am=CONFIRMED_ON)}
        moved = {**held, "trainer": person("Ida", email="ida@strasse.de")}
        composed = compose_kontakte_herkunft(kontakte=moved, stored=held)

        assert composed is not None
        assert composed["trainer"]["einwilligung"]["bestaetigt_am"] is None

    def test_a_seat_stamped_with_an_empty_string_is_saved_as_unconfirmed(self):
        """Carried across a save, `""` would stand as a confirmation nobody gave; the same person is held, so only the stamp decides."""

        held = {**PARTLY_CONFIRMED, "trainer": stored_person("Ida", erfasst_von="person", bestaetigt_am="")}
        composed = compose_kontakte_herkunft(kontakte=RESAVED_AS_RENDERED, stored=held)

        assert composed is not None
        assert composed["trainer"]["einwilligung"] == unbestaetigt(held["trainer"]["einwilligung"])

    def test_an_application_seat_stamped_with_an_empty_string_enters_undated_and_unconfirmed(self):
        """The acceptance's arm: the stamped seat beside it keeps its date, so the stamp alone parts the two."""

        entering = {
            **PARTLY_CONFIRMED,
            "ansprechperson": stored_person("Jonas", erfasst_von="person", bestaetigt_am=""),
        }
        composed = compose_kontakte_at_entry(kontakte=entering)

        assert composed["ansprechperson"]["geburtsdatum"] is None
        assert composed["ansprechperson"]["einwilligung"] == unbestaetigt(entering["ansprechperson"]["einwilligung"])
        assert composed["trainer"]["geburtsdatum"] == GEBURTSDATUM

    def test_a_confirmed_application_seat_enters_without_the_speaker_its_application_stored(self):
        """The season row is a new document and no write sets a speaker; the confirmation and the date move with the person."""

        composed = compose_kontakte_at_entry(kontakte=PARTLY_CONFIRMED)
        stored = PARTLY_CONFIRMED["trainer"]["einwilligung"]

        # The premise: an application confirmed before the speaker was retired carries one.
        assert stored["erfasst_von"] == "person"
        assert composed["trainer"]["einwilligung"] == {field: value for field, value in stored.items() if field != "erfasst_von"}
        assert composed["trainer"]["einwilligung"]["bestaetigt_am"] == CONFIRMED_ON
        assert composed["trainer"]["geburtsdatum"] == GEBURTSDATUM

    def test_a_null_slot_is_left_null(self):
        composed = compose_kontakte_herkunft(kontakte=ONE_SLOT_FILLED, stored=PARTLY_CONFIRMED)

        assert composed is not None
        assert (composed["ansprechperson"], composed["stellvertretung"]) == (None, None)

    def test_the_flag_beside_the_seats_passes_through(self):
        composed = compose_kontakte_herkunft(kontakte=NEW_KONTAKTE, stored=None)

        assert composed is not None
        assert composed["trainer_ist_zugleich"] == "ansprechperson"


class TestTheDateRidesWithThePerson:
    """The payload names no birthdate, so a save can only carry the row's own forward."""

    def test_the_stored_date_is_carried_forward_for_the_same_person(self):
        composed = compose_kontakte_herkunft(kontakte=RESAVED_AS_RENDERED, stored=SEEDED_KONTAKTE)

        assert composed is not None
        # The floor under the claim below: a date standing beside a stamp would prove a confirmation
        # survived rather than the identity match that carries the date.
        assert composed["trainer"]["einwilligung"]["bestaetigt_am"] is None, "the seed is confirmed, so this case proves nothing"
        assert [composed[slot]["geburtsdatum"] for slot in ("trainer", "ansprechperson", "stellvertretung")] == [GEBURTSDATUM] * 3

    def test_a_seat_handed_to_another_address_holds_no_date(self):
        handed = {**RESAVED_AS_RENDERED, "trainer": person("Ida", email="another.ida@example.com")}
        composed = compose_kontakte_herkunft(kontakte=handed, stored=SEEDED_KONTAKTE)

        assert composed is not None
        assert composed["trainer"]["geburtsdatum"] is None

    @pytest.mark.parametrize(
        "renamed",
        [
            pytest.param({"vorname": "Bert"}, id="a first name"),
            pytest.param({"nachname": "Neu"}, id="a surname"),
            pytest.param({"vorname": "Ida-Marie"}, id="a first name a typo could explain"),
        ],
    )
    def test_a_seat_whose_name_changed_at_its_own_address_holds_no_date(self, renamed: dict[str, str]):
        """The role mailbox handed on. The third case is the accepted false positive: a correction costs the same as a handover."""

        handed = {**RESAVED_AS_RENDERED, "trainer": {**RESAVED_AS_RENDERED["trainer"], **renamed}}
        composed = compose_kontakte_herkunft(kontakte=handed, stored=SEEDED_KONTAKTE)

        assert composed is not None
        assert composed["trainer"]["geburtsdatum"] is None

    @pytest.mark.parametrize(
        ("held", "sent"),
        [
            pytest.param({}, {"vorname": "IDA"}, id="the case, which a payload does carry"),
            pytest.param({"nachname": " Musterfrau "}, {}, id="padding, which only a stored row carries"),
            pytest.param({"nachname": "Muster  frau"}, {"nachname": "Muster frau"}, id="a doubled inner space"),
            # Built from code points: the decomposed umlaut renders exactly as the composed one.
            pytest.param({"nachname": f"Mu{chr(0x308)}ller"}, {"nachname": f"M{chr(0xFC)}ller"}, id="an umlaut stored decomposed"),
        ],
    )
    def test_a_name_respelled_and_not_changed_keeps_the_date(self, held: dict[str, str], sent: dict[str, str]):
        """The fold's whole purpose: none of these is another person, and each would otherwise cost one a fresh confirmation."""

        stored = {**SEEDED_KONTAKTE, "trainer": {**SEEDED_KONTAKTE["trainer"], **held}}
        respelt = {**RESAVED_AS_RENDERED, "trainer": {**RESAVED_AS_RENDERED["trainer"], **sent}}
        composed = compose_kontakte_herkunft(kontakte=respelt, stored=stored)

        assert composed is not None
        assert composed["trainer"]["geburtsdatum"] == GEBURTSDATUM

    def test_a_sharp_s_surname_and_its_ss_spelling_are_two_people(self):
        """„Weiß“ and „Weiss“ are two families, which `casefold` would make one person holding the other's date."""

        stored = {**SEEDED_KONTAKTE, "trainer": {**SEEDED_KONTAKTE["trainer"], "nachname": "Weiß"}}
        respelt = {**RESAVED_AS_RENDERED, "trainer": {**RESAVED_AS_RENDERED["trainer"], "nachname": "Weiss"}}
        composed = compose_kontakte_herkunft(kontakte=respelt, stored=stored)

        assert composed is not None
        assert composed["trainer"]["geburtsdatum"] is None

    def test_a_stored_blank_is_carried_forward_as_the_null_every_read_answers(self):
        """Written back as it stands, the blank would be a value no reader can see and no token can tell from null."""

        blank = {**SEEDED_KONTAKTE, "trainer": {**SEEDED_KONTAKTE["trainer"], "geburtsdatum": ""}}
        composed = compose_kontakte_herkunft(kontakte=RESAVED_AS_RENDERED, stored=blank)

        assert composed is not None
        assert composed["trainer"]["geburtsdatum"] is None

    def test_every_seat_answers_the_key_whether_the_row_held_one_or_not(self):
        """Spelled null rather than omitted, as the submission spells it: a missing key is a shape only some readers project."""

        composed = compose_kontakte_herkunft(kontakte=NEW_KONTAKTE, stored=None)

        assert composed is not None
        for slot in ("trainer", "ansprechperson", "stellvertretung"):
            assert "geburtsdatum" in composed[slot] and composed[slot]["geburtsdatum"] is None


@pytest.mark.db
class TestASeatNobodyHasConfirmedIsStillSaveable:
    """A required birthdate would make an unconfirmed seat unsaveable whole.

    Every field of the seat rides that one payload, so its address, telephone number and
    Kenntnisnahme would go with the date.
    """

    def test_a_row_whose_seats_hold_no_date_takes_an_edit(self, mongo_replica_set_url: str):
        renamed = {**RESAVED_AS_RENDERED, "trainer": person("Ida-Marie", email=str(RESAVED_AS_RENDERED["trainer"]["email"]))}

        async def body(database: AsyncDatabase) -> Any:
            response = await write_kontakte(database, renamed, stand=kontakte_stand_of(UNDATED_SEEDED))

            return response, await row_now(database)

        response, stored = on_a_league(mongo_replica_set_url, body, seeded=UNDATED_SEEDED)

        assert stored["kontakte"]["trainer"]["vorname"] == "Ida-Marie"
        assert stored["kontakte"]["trainer"]["geburtsdatum"] is None
        assert response.kontakte is not None and response.kontakte.trainer is not None
        assert response.kontakte.trainer.geburtsdatum is None


class TestTheTokenNamesWhatTheEditorWasServed:
    """The pure half of the refusal, so every way two spellings of one block can differ is pinned."""

    def test_the_token_over_a_block_is_the_same_value_in_every_process(self):
        """Written out rather than recomputed, the only shape of this case that can fail.

        `hash()` satisfies every other case here and reseeds at each start, so a minted token and the
        write judging it would stop agreeing after a restart.
        """

        assert kontakte_stand_of(SEEDED_KONTAKTE) == "05b1776c54d66b663c3fa97476da8f0cd342cc9d4c3f3fc20e2b750e933d1561"

    def test_a_row_predating_the_optional_fields_answers_the_token_of_one_spelling_them_null(self):
        """The whole reason the token is not taken over the document: `SEEDED_KONTAKTE` carries no `bestaetigt_am` key at all."""

        served = FLSaisonTeamKontakte.model_validate(SEEDED_KONTAKTE).model_dump(mode="json")

        assert served != SEEDED_KONTAKTE, "the read model fills in no key, so this case proves nothing"
        assert kontakte_stand_of(served) == kontakte_stand_of(SEEDED_KONTAKTE)

    def test_a_stored_blank_answers_the_token_of_the_null_the_read_model_makes_of_it(self):
        """`CustomOptionalDateString` nulls a blank on the way in, and the write judges the raw document.

        Without the same step here the two sides answer different tokens, so that row refuses every
        save and a reload never helps.
        """

        blank = {**SEEDED_KONTAKTE["trainer"], "geburtsdatum": ""}
        nulled = {**SEEDED_KONTAKTE["trainer"], "geburtsdatum": None}

        assert kontakte_stand_of({**SEEDED_KONTAKTE, "trainer": blank}) == kontakte_stand_of({**SEEDED_KONTAKTE, "trainer": nulled})
        assert FLKontaktperson.model_validate(blank).geburtsdatum is None, "the read model keeps the blank, so this case proves nothing"

    def test_a_key_no_read_model_carries_is_not_a_change_the_editor_could_have_seen(self):
        """Refusing over one would leave the row unsavable: the editor is served no such key, so it can echo none back."""

        widened = {**SEEDED_KONTAKTE, "trainer": {**SEEDED_KONTAKTE["trainer"], "spitzname": "Idi"}}

        assert kontakte_stand_of(widened) == kontakte_stand_of(SEEDED_KONTAKTE)

    @pytest.mark.parametrize(
        ("moved", "id_of"),
        [
            pytest.param(PARTLY_CONFIRMED, "a seat confirmed since", id="a stamp arriving"),
            pytest.param({**SEEDED_KONTAKTE, ERASED_SEAT: None}, "a seat emptied since", id="an erasure"),
            pytest.param({**SEEDED_KONTAKTE, "trainer_ist_zugleich": "stellvertretung"}, "a claim made since", id="the shared seat"),
            pytest.param(None, "a block cleared since", id="a cleared block"),
        ],
    )
    def test_a_block_that_moved_answers_a_different_token(self, moved: Any, id_of: str):
        """The floor under the equalities above: a projection flattening everything would refuse nothing."""

        assert kontakte_stand_of(moved) != kontakte_stand_of(SEEDED_KONTAKTE), id_of


@pytest.mark.db
class TestAKeptRecordKeepsItsEvidence:
    """An unchanged person keeps their record whole: the payload spells none of its evidence, its media answer or its scope."""

    def test_a_confirmed_seat_saved_unchanged_is_stored_byte_for_byte(self, mongo_replica_set_url: str):
        """The data-loss path the record exists against: a block recomposed from the payload erases its evidence."""

        confirmed = {
            "umfang": "kontaktdaten_whatsapp",
            "erfasst_von": "person",
            "text_version": "2026-09-bestaetigungsseite-6",
            "datum": "2026-03-01",
            "bestaetigt_am": CONFIRMED_ON,
            "medien": True,
            "eingetragen_von": "bewerbung",
            "nachweis": {
                "umfang": {"am": "2026-03-15T09:00:00+00:00", "text_version": "2026-09-bestaetigungsseite-6"},
                "medien": {"am": "2026-03-20T09:00:00+00:00", "text_version": "2026-10-konto-kontakt"},
            },
        }
        seeded = {**PARTLY_CONFIRMED, "trainer": {**PARTLY_CONFIRMED["trainer"], "einwilligung": confirmed}}
        # As the editor renders a confirmed seat and sends it back: under its own, the confirmation page's, label.
        sent = {**RESAVED_AS_RENDERED, "trainer": {**person("Ida", text_version="2026-09-bestaetigungsseite-6"), "telefon": OTHER_TELEFON}}

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, sent, stand=kontakte_stand_of(seeded))

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body, seeded=seeded)

        assert stored["kontakte"]["trainer"]["telefon"] == OTHER_TELEFON, "the edit itself did not land, so this case proves nothing"
        assert bson.encode(stored["kontakte"]["trainer"]["einwilligung"]) == bson.encode(confirmed)

    def test_an_unconfirmed_seat_saved_unchanged_keeps_who_seated_its_person(self, mongo_replica_set_url: str):
        """The commoner seat: the applicant or the league having seated them is what decides which page its link opens."""

        held = PARTLY_CONFIRMED["ansprechperson"]
        seeded = {**PARTLY_CONFIRMED, "ansprechperson": {**held, "einwilligung": {**held["einwilligung"], "eingetragen_von": "bewerbung"}}}

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, RESAVED_AS_RENDERED, stand=kontakte_stand_of(seeded))

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body, seeded=seeded)

        assert stored["kontakte"]["ansprechperson"]["einwilligung"]["eingetragen_von"] == "bewerbung"

    def test_a_seat_handed_to_another_person_is_born_afresh_by_the_league(self, mongo_replica_set_url: str):
        """Nothing of the person who left travels: their evidence, scope and media answer go with their data."""

        handed = {**RESAVED_AS_RENDERED, "trainer": person("Lea")}

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, handed, stand=kontakte_stand_of(PARTLY_CONFIRMED))

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body, seeded=PARTLY_CONFIRMED)

        assert stored["kontakte"]["trainer"]["einwilligung"] == born(person("Lea"))
        assert stored["kontakte"]["ansprechperson"] == as_kept(PARTLY_CONFIRMED["ansprechperson"])


@pytest.mark.db
class TestTheLabelASaveNames:
    """`REQ-EINWILLIGUNG-001`: a seat the save fills names the running label; the same person may name back the label they hold."""

    @pytest.mark.parametrize(
        ("sent", "id_of"),
        [
            pytest.param(
                {**RESAVED_AS_RENDERED, "trainer": person("Lea", text_version="2026-09-bestaetigung-4")},
                "a new person under a superseded form label",
                id="a new person, a superseded label",
            ),
            pytest.param(
                {**RESAVED_AS_RENDERED, "trainer": person("Lea", text_version=STORED_LABEL)},
                "a person handed the seat under the label the seat's last holder keeps",
                id="a handed seat, the seat's stored label",
            ),
            pytest.param(
                {**RESAVED_AS_RENDERED, "trainer": person("Ida", text_version="2026-09-bestaetigung-4")},
                "the same person under a label neither stored nor running",
                id="a kept seat, a third label",
            ),
        ],
    )
    def test_a_label_no_seat_may_name_is_refused_and_writes_nothing(self, mongo_replica_set_url: str, sent: dict[str, Any], id_of: str):
        """The second row is the one keyed on the PERSON: a seat keyed arm would admit the old holder's label for a stranger."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(WriteRefusalException) as refused:
                await write_kontakte(database, sent)

            return refused.value, await row_now(database), await junction_log(database)

        refusal, stored, log = on_a_league(mongo_replica_set_url, body)

        assert (refusal.error_code, refusal.status_code) == (FASSUNG_UNZULAESSIG, 409), id_of
        assert stored["kontakte"] == SEEDED_KONTAKTE
        assert log == []

    @pytest.mark.parametrize(
        "label",
        [pytest.param(STORED_LABEL, id="the label the person holds"), pytest.param(RUNNING_LABEL, id="the running label")],
    )
    def test_a_kept_seat_naming_its_own_or_the_running_label_is_saved_and_keeps_its_record(self, mongo_replica_set_url: str, label: str):
        """Either way the record is carried, so the running label never restamps a person who did not move."""

        sent = {**RESAVED_AS_RENDERED, "trainer": person("Ida", text_version=label)}

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, sent)

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body)

        assert stored["kontakte"]["trainer"] == as_kept(SEEDED_KONTAKTE["trainer"])

    def test_an_undo_putting_a_handed_seats_earlier_person_back_under_their_old_label_is_refused(self, mongo_replica_set_url: str):
        """What the undo route replays: the save being undone handed every seat on, so the replay seats each person afresh."""

        async def body(database: AsyncDatabase) -> Any:
            saved = await write_kontakte(database, NEW_KONTAKTE)
            with pytest.raises(WriteRefusalException) as refused:
                await write_kontakte(database, RESAVED_AS_RENDERED, stand=saved.kontakte_stand)

            return refused.value.error_code, await row_now(database)

        code, stored = on_a_league(mongo_replica_set_url, body)

        assert code == FASSUNG_UNZULAESSIG
        assert stored["kontakte"] == as_stored(NEW_KONTAKTE)
