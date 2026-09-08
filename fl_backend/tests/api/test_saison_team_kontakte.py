from datetime import datetime
from typing import Any, Awaitable, Callable
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pydantic import ValidationError
from pymongo.asynchronous.database import AsyncDatabase

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
    UNCONFIRMED_HERKUNFT,
    compose_kontakte_herkunft,
    kontakte_stand_of,
)
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
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
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))


# On no payload: each person types their own on their confirmation page, so a seat only ever holds a
# date the server carried over from the row.
GEBURTSDATUM = "1990-05-17"


def person(vorname: str, *, email: str | None = None) -> dict[str, Any]:
    """One person as the editor SENDS them: the consent names its scope, wording and day, and no source, stamp or birthdate."""

    return {
        "vorname": vorname,
        "nachname": "Musterfrau",
        "email": email or f"{vorname.lower()}@example.com",
        "telefon": "+4915112345678",
        "einwilligung": {"umfang": "kontaktdaten", "text_version": "v1", "datum": "2026-03-01"},
    }


def stored_person(
    vorname: str, *, email: str | None = None, erfasst_von: str = "administrativ", bestaetigt_am: str | None = None
) -> dict[str, Any]:
    """The same person as a row HOLDS them, provenance and birthdate included."""

    sent = person(vorname, email=email)

    return {
        **sent,
        "geburtsdatum": GEBURTSDATUM,
        "einwilligung": {**sent["einwilligung"], "erfasst_von": erfasst_von, "bestaetigt_am": bestaetigt_am},
    }


def as_stored(kontakte: dict[str, Any]) -> dict[str, Any]:
    """What the endpoint writes from a payload whose seats no row already holds."""

    return {
        seat: (
            {**value, "geburtsdatum": None, "einwilligung": {**value["einwilligung"], **UNCONFIRMED_HERKUNFT}}
            if isinstance(value, dict)
            else value
        )
        for seat, value in kontakte.items()
    }


# The shape every row held before the stamp existed: a dated `person` on each seat, and no stamp key
# at all.
SEEDED_KONTAKTE: dict[str, Any] = {
    "trainer": {**person("Ida"), "geburtsdatum": GEBURTSDATUM, "einwilligung": {**person("Ida")["einwilligung"], "erfasst_von": "person"}},
    "ansprechperson": {
        **person("Jonas"),
        "geburtsdatum": GEBURTSDATUM,
        "einwilligung": {**person("Jonas")["einwilligung"], "erfasst_von": "person"},
    },
    "stellvertretung": {
        **person("Klara"),
        "geburtsdatum": GEBURTSDATUM,
        "einwilligung": {**person("Klara")["einwilligung"], "erfasst_von": "person"},
    },
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
    "trainer": stored_person("Ida", erfasst_von="person", bestaetigt_am=CONFIRMED_ON),
    "ansprechperson": stored_person("Jonas"),
    "stellvertretung": stored_person("Klara"),
    "trainer_ist_zugleich": None,
}

# The seeded block as the EDITOR sends it back: the same three people with the provenance stripped,
# which is what an administrator's open page holds while somebody else asks to be forgotten.
RESAVED_AS_RENDERED: dict[str, Any] = {
    "trainer": person("Ida"),
    "ansprechperson": person("Jonas"),
    "stellvertretung": person("Klara"),
    "trainer_ist_zugleich": None,
}

# The same three seats before any of them answered their own link: the state ruling 274's read-only
# control shows, and the one the payload had made unsaveable.
UNDATED_SEEDED: dict[str, Any] = {
    **SEEDED_KONTAKTE,
    **{slot: {**SEEDED_KONTAKTE[slot], "geburtsdatum": None} for slot in ("trainer", "ansprechperson", "stellvertretung")},
}

ERASED_SEAT = "ansprechperson"
ERASED_EMAIL = str(RESAVED_AS_RENDERED[ERASED_SEAT]["email"])


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
        db=database.client,
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


class JunctionRunningAHookBeforeTheWrite:
    """The junction collection, running one hook immediately before the first update asked of it.

    A stand-in rather than a subclass: the driver builds a collection off a database handle, so what
    the endpoint is handed must delegate every other call.
    """

    def __init__(self, inner: Any, hook: Callable[[], Awaitable[Any]]) -> None:
        self._inner = inner
        self._hook: Callable[[], Awaitable[Any]] | None = hook

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        # ONE-SHOT: a retry has to write against what the erasure left rather than erase again, and
        # a second erasure would find the row already cleared and report nothing to prove.
        if self._hook is not None:
            hook, self._hook = self._hook, None
            await hook()

        return await self._inner.find_one_and_update(*args, **kwargs)


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
            response = await write_kontakte(database, renamed, stand=kontakte_stand_of(PARTLY_CONFIRMED))

            return response, await row_now(database)

        response, stored = on_a_league(mongo_replica_set_url, body, seeded=PARTLY_CONFIRMED)

        trainer = stored["kontakte"]["trainer"]
        assert trainer["vorname"] == "Ida-Marie"
        assert (trainer["einwilligung"]["erfasst_von"], trainer["einwilligung"]["bestaetigt_am"]) == ("person", CONFIRMED_ON)
        # The date goes the same way, and by the same route: the payload names none, so a save that
        # did not carry it over would leave a stamped seat with no birthdate at all (I141).
        assert trainer["geburtsdatum"] == GEBURTSDATUM
        assert response.kontakte is not None and response.kontakte.trainer is not None
        assert response.kontakte.trainer.einwilligung.bestaetigt_am == CONFIRMED_ON

    def test_an_unconfirmed_seat_is_recorded_as_entered_on_the_persons_behalf(self, mongo_replica_set_url: str):
        """Whatever the row held before: a seat with no stamp is `administrativ`, and the stamp stays null."""

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, NEW_KONTAKTE, stand=kontakte_stand_of(PARTLY_CONFIRMED))

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body, seeded=PARTLY_CONFIRMED)

        for seat in ("ansprechperson", "stellvertretung"):
            assert stored["kontakte"][seat]["einwilligung"]["erfasst_von"] == "administrativ"
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

        assert stored["kontakte"]["trainer"]["einwilligung"] == {**person("Ida")["einwilligung"], **UNCONFIRMED_HERKUNFT}
        # And the date with it: it is a fact about the person, and this seat now holds another one.
        assert stored["kontakte"]["trainer"]["geburtsdatum"] is None

    def test_a_row_stored_before_the_stamp_is_written_as_unconfirmed(self, mongo_replica_set_url: str):
        """`person` with no stamp is the shape every row held before the stamp existed, and it is not a confirmation."""

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, {**NEW_KONTAKTE, "trainer": person("Ida")})

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body)

        assert stored["kontakte"]["trainer"]["einwilligung"]["erfasst_von"] == "administrativ"


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
            with pytest.raises(DocumentConflictException) as refused:
                await write_kontakte(database, RESAVED_AS_RENDERED, saison_teams_collection=junction)

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
        assert stored["kontakte"][ERASED_SEAT] == {**as_stored(RESAVED_AS_RENDERED)[ERASED_SEAT], "geburtsdatum": GEBURTSDATUM}


@pytest.mark.db
class TestASaveComposedAgainstAnotherBlockIsRefused:
    def test_the_row_keeps_what_it_held_and_records_nothing(self, mongo_replica_set_url: str):
        """A refusal has to stop the write rather than accompany it: the pre-image is the only copy of the block."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(DocumentConflictException) as refused:
                await write_kontakte(database, NEW_KONTAKTE, stand=kontakte_stand_of(PARTLY_CONFIRMED))

            return refused.value, await row_now(database), await junction_log(database)

        refusal, stored, log = on_a_league(mongo_replica_set_url, body)

        assert refusal.error_code == KONTAKTE_MOVED_UNDER_THE_SAVE
        assert stored["kontakte"] == SEEDED_KONTAKTE
        assert log == []

    def test_the_undo_replays_against_the_block_the_save_left(self, mongo_replica_set_url: str):
        """The write's own answer is the undo's precondition: the save has already moved the row past what the editor read."""

        async def body(database: AsyncDatabase) -> Any:
            saved = await write_kontakte(database, NEW_KONTAKTE)

            await write_kontakte(database, RESAVED_AS_RENDERED, stand=saved.kontakte_stand)

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body)

        assert stored["kontakte"] == as_stored(RESAVED_AS_RENDERED)


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
        assert composed["trainer"]["geburtsdatum"] == GEBURTSDATUM

    def test_a_null_slot_is_left_null(self):
        composed = compose_kontakte_herkunft(kontakte=ONE_SLOT_FILLED, stored=PARTLY_CONFIRMED)

        assert composed is not None
        assert (composed["ansprechperson"], composed["stellvertretung"]) == (None, None)

    def test_the_flag_beside_the_seats_passes_through(self):
        composed = compose_kontakte_herkunft(kontakte=NEW_KONTAKTE, stored=None)

        assert composed is not None
        assert composed["trainer_ist_zugleich"] == "ansprechperson"


class TestTheDateRidesWithTheAddress:
    """The payload names no birthdate, so a save can only carry the row's own forward."""

    def test_the_stored_date_is_carried_forward_for_the_same_address(self):
        composed = compose_kontakte_herkunft(kontakte=RESAVED_AS_RENDERED, stored=SEEDED_KONTAKTE)

        assert composed is not None
        assert [composed[slot]["geburtsdatum"] for slot in ("trainer", "ansprechperson", "stellvertretung")] == [GEBURTSDATUM] * 3

    def test_a_seat_handed_to_another_address_holds_no_date(self):
        handed = {**RESAVED_AS_RENDERED, "trainer": person("Ida", email="another.ida@example.com")}
        composed = compose_kontakte_herkunft(kontakte=handed, stored=SEEDED_KONTAKTE)

        assert composed is not None
        assert composed["trainer"]["geburtsdatum"] is None

    def test_a_date_under_no_stamp_survives_an_edit_to_the_seat(self):
        """Nulling the date would destroy it as a side effect of an edit to the telephone number."""

        composed = compose_kontakte_herkunft(kontakte=RESAVED_AS_RENDERED, stored=SEEDED_KONTAKTE)

        assert composed is not None
        assert composed["trainer"]["einwilligung"]["bestaetigt_am"] is None, "the seed is confirmed, so this case proves nothing"
        assert composed["trainer"]["geburtsdatum"] == GEBURTSDATUM

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

        assert kontakte_stand_of(SEEDED_KONTAKTE) == "01ec6d11e0df8edb7b016ac75de3e5eb1dab05df87833d9f2e4f8ff53bd9e428"

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
