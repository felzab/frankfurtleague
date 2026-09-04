from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from pydantic import ValidationError
from pymongo.asynchronous.database import AsyncDatabase

from app.api.teams.admin_router import patch_saison_team_kontakte
from app.api.teams.schemas import FLKontaktEinwilligungPayload, FLPatchSaisonTeamKontaktePayload
from app.api.teams.services import UNCONFIRMED_HERKUNFT, compose_kontakte_herkunft
from app.core.collections import Collection
from app.core.exceptions import DocumentNotFoundException
from tests.database import a_clean_database, on_the_seed_loop
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


def person(vorname: str, *, email: str | None = None) -> dict[str, Any]:
    """One person as the editor SENDS them: the consent names its scope, wording and day, and no source or stamp."""

    return {
        "vorname": vorname,
        "nachname": "Musterfrau",
        "email": email or f"{vorname.lower()}@example.com",
        "telefon": "+4915112345678",
        "geburtsdatum": "1990-05-17",
        "einwilligung": {"umfang": "kontaktdaten", "text_version": "v1", "datum": "2026-03-01"},
    }


def stored_person(
    vorname: str, *, email: str | None = None, erteilt_von: str = "administrativ", bestaetigt_am: str | None = None
) -> dict[str, Any]:
    """The same person as a row HOLDS them, provenance included."""

    sent = person(vorname, email=email)

    return {**sent, "einwilligung": {**sent["einwilligung"], "erteilt_von": erteilt_von, "bestaetigt_am": bestaetigt_am}}


def as_stored(kontakte: dict[str, Any]) -> dict[str, Any]:
    """What the endpoint writes from a payload whose seats nobody has confirmed."""

    return {
        seat: {**value, "einwilligung": {**value["einwilligung"], **UNCONFIRMED_HERKUNFT}} if isinstance(value, dict) else value
        for seat, value in kontakte.items()
    }


# The shape every row held before the stamp existed: `person` on each seat, and no stamp key at all.
SEEDED_KONTAKTE: dict[str, Any] = {
    "trainer": {**person("Ida"), "einwilligung": {**person("Ida")["einwilligung"], "erteilt_von": "person"}},
    "ansprechperson": {**person("Jonas"), "einwilligung": {**person("Jonas")["einwilligung"], "erteilt_von": "person"}},
    "stellvertretung": {**person("Klara"), "einwilligung": {**person("Klara")["einwilligung"], "erteilt_von": "person"}},
    "trainer_ist_zugleich": None,
}

NEW_KONTAKTE: dict[str, Any] = {
    "trainer": person("Lea"),
    "ansprechperson": person("Mika"),
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
    "trainer": stored_person("Ida", erteilt_von="person", bestaetigt_am=CONFIRMED_ON),
    "ansprechperson": stored_person("Jonas"),
    "stellvertretung": stored_person("Klara"),
    "trainer_ist_zugleich": None,
}


def junction_document(saison_id: str, kontakte: dict[str, Any] | None) -> dict[str, Any]:
    """One junction row, filled out as the validator requires and as a season in progress holds it."""

    return {
        "saison_id": saison_id,
        "team_id": TEAM_OID,
        "gruppe": GRUPPE,
        "austritt": dict(AUSTRITT),
        "trikot_farbe": TRIKOT_FARBE,
        "kontakte": kontakte,
        "name": TEAM_NAME,
        "shorthand": TEAM_SHORTHAND,
    }


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, seeded: dict[str, Any] | None = SEEDED_KONTAKTE) -> Any:
    """`constraints=True`, so what this endpoint stores is judged by the database's own validator rather than by Pydantic alone."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            # The other season FIRST: `find_one_and_update` takes natural order, so this is the row a
            # filter that forgot `saison_id` would write to.
            await database[Collection.SAISON_TEAMS].insert_one(junction_document(OTHER_SAISON_ID, None))
            await database[Collection.SAISON_TEAMS].insert_one(junction_document(SAISON_ID, seeded))

            return await body(database)

    return on_the_seed_loop(_run())


async def write_kontakte(
    database: AsyncDatabase,
    kontakte: dict[str, Any] | None,
    *,
    team_id: ObjectId = TEAM_OID,
    saison_id: str = SAISON_ID,
) -> Any:
    return await patch_saison_team_kontakte(
        team_id=team_id,
        saison_id=saison_id,
        kontakte_data=FLPatchSaisonTeamKontaktePayload.model_validate({"kontakte": kontakte}),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
    )


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
        assert response.kontakte.model_dump(mode="json") == as_stored(NEW_KONTAKTE)
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
        """The data-loss path: the block is `$set` whole, so a stamp the write does not carry over is destroyed with no refusal."""

        renamed = {**PARTLY_CONFIRMED, "trainer": person("Ida-Marie", email=PARTLY_CONFIRMED["trainer"]["email"])}
        renamed["ansprechperson"] = person("Jonas")
        renamed["stellvertretung"] = person("Klara")

        async def body(database: AsyncDatabase) -> Any:
            response = await write_kontakte(database, renamed)

            return response, await row_now(database)

        response, stored = on_a_league(mongo_replica_set_url, body, seeded=PARTLY_CONFIRMED)

        trainer = stored["kontakte"]["trainer"]
        assert trainer["vorname"] == "Ida-Marie"
        assert (trainer["einwilligung"]["erteilt_von"], trainer["einwilligung"]["bestaetigt_am"]) == ("person", CONFIRMED_ON)
        assert response.kontakte is not None and response.kontakte.trainer is not None
        assert response.kontakte.trainer.einwilligung.bestaetigt_am == CONFIRMED_ON

    def test_an_unconfirmed_seat_is_recorded_as_entered_on_the_persons_behalf(self, mongo_replica_set_url: str):
        """Whatever the row held before: a seat with no stamp is `administrativ`, and the stamp stays null."""

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, NEW_KONTAKTE)

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body, seeded=PARTLY_CONFIRMED)

        for seat in ("ansprechperson", "stellvertretung"):
            assert stored["kontakte"][seat]["einwilligung"]["erteilt_von"] == "administrativ"
            assert stored["kontakte"][seat]["einwilligung"]["bestaetigt_am"] is None

    def test_a_confirmed_seat_handed_to_another_address_starts_unconfirmed(self, mongo_replica_set_url: str):
        """The confirmation is what one mailbox's owner clicked: a new address in the seat has clicked nothing."""

        replaced = {**PARTLY_CONFIRMED, "trainer": person("Ida", email="another.ida@example.com")}
        replaced["ansprechperson"] = person("Jonas")
        replaced["stellvertretung"] = person("Klara")

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, replaced)

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body, seeded=PARTLY_CONFIRMED)

        assert stored["kontakte"]["trainer"]["einwilligung"] == {**person("Ida")["einwilligung"], **UNCONFIRMED_HERKUNFT}

    def test_a_row_stored_before_the_stamp_is_written_as_unconfirmed(self, mongo_replica_set_url: str):
        """`person` with no stamp is the shape every row held before the stamp existed, and it is not a confirmation."""

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, {**NEW_KONTAKTE, "trainer": person("Ida")})

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body)

        assert stored["kontakte"]["trainer"]["einwilligung"]["erteilt_von"] == "administrativ"


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


class TestWhatThePayloadRefuses:
    """The two provenance fields are on no payload: a field the editor merely hid would still be a route an API caller has."""

    @pytest.mark.parametrize(("field", "value"), [("erteilt_von", "person"), ("bestaetigt_am", CONFIRMED_ON)])
    def test_a_consent_naming_its_source_or_its_stamp_is_refused(self, field: str, value: str):
        with pytest.raises(ValidationError) as failure:
            FLKontaktEinwilligungPayload.model_validate({**person("Ida")["einwilligung"], field: value})

        assert [(entry["type"], entry["loc"][-1]) for entry in failure.value.errors()] == [("extra_forbidden", field)]

    def test_the_whole_block_is_refused_on_one_seats_source(self):
        """Through the endpoint's own payload, so the refusal reaches the wire as a 422 rather than a stored claim."""

        block = {**NEW_KONTAKTE, "trainer": stored_person("Lea", erteilt_von="person", bestaetigt_am=CONFIRMED_ON)}

        with pytest.raises(ValidationError) as failure:
            FLPatchSaisonTeamKontaktePayload.model_validate({"kontakte": block})

        assert {entry["type"] for entry in failure.value.errors()} == {"extra_forbidden"}


class TestTheCompositionDecidesFromItsArguments:
    """The pure half, so every branch is pinned without a container."""

    def test_a_cleared_block_stays_cleared(self):
        assert compose_kontakte_herkunft(kontakte=None, stored=PARTLY_CONFIRMED) is None

    @pytest.mark.parametrize("stored", [pytest.param(None, id="a row with no block"), pytest.param({}, id="an empty block")])
    def test_a_row_holding_no_block_yields_every_seat_unconfirmed(self, stored: Any):
        assert compose_kontakte_herkunft(kontakte=NEW_KONTAKTE, stored=stored) == as_stored(NEW_KONTAKTE)

    def test_the_address_is_matched_case_insensitively(self):
        """On the erasure's terms: a mailbox is one address however its local part is capitalised."""

        recased = {**PARTLY_CONFIRMED, "trainer": person("Ida", email="IDA@Example.com")}
        composed = compose_kontakte_herkunft(kontakte=recased, stored=PARTLY_CONFIRMED)

        assert composed is not None
        assert composed["trainer"]["einwilligung"]["bestaetigt_am"] == CONFIRMED_ON

    def test_a_null_slot_is_left_null(self):
        composed = compose_kontakte_herkunft(kontakte=ONE_SLOT_FILLED, stored=PARTLY_CONFIRMED)

        assert composed is not None
        assert (composed["ansprechperson"], composed["stellvertretung"]) == (None, None)

    def test_the_flag_beside_the_seats_passes_through(self):
        composed = compose_kontakte_herkunft(kontakte=NEW_KONTAKTE, stored=None)

        assert composed is not None
        assert composed["trainer_ist_zugleich"] == "ansprechperson"
