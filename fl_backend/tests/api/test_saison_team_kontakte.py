from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import bson
import pytest
from bson import ObjectId
from pydantic import ValidationError
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import compose_einwilligung
from app.api.identity.schemas import FLErasureResponse
from app.api.outbox.schemas import FLOutboxStatus
from app.api.teams.schemas import FLKontaktSeatPayload
from app.api.teams.services import compose_kontakte_herkunft, with_link_state
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import SEAT_TEXT_VERSIONS, kontaktperson_document, saison_document, saison_team_document
from tests.erasure import erased
from tests.isolation import InterleavedCollection
from tests.outbox import MAIL_NOW
from tests.team_writes import BlockWritten, write_the_block
from tests.worker import worker_database

# Marked per class rather than for the module: what the payload refuses and what the composition
# decides are reached with no container (`docs/decisions.md`'s `tests` line), while which
# KEYS a `$set` leaves alone only a stored document shows.
DATABASE_NAME = worker_database("fl_saison_team_kontakte_test")

SAISON_ID = "2026"
# A second season the SAME club holds a row in, seeded first so it is what a filter missing
# `saison_id` would reach.
OTHER_SAISON_ID = "2025"

# Fixed rather than generated, so a failure names the same club every run.
TEAM_OID = ObjectId("6890a1b2c3d4e5f607240001")

TEAM_NAME = "Adler"
TEAM_SHORTHAND = "ADX"

# The three fields the block's write must not reach, each seeded to a value entry never writes: a `$set`
# carrying the whole payload would answer with `None` for all three.
GRUPPE = "C"
TRIKOT_FARBE = "bordeaux"
AUSTRITT: dict[str, Any] = {"type": "rueckzug", "reason": "Keine Mannschaft mehr", "date": "2026-04-01"}

CONFIRMED_ON = "2026-03-15"
# An edit to a seat that changes nothing about who holds it: `person` writes the other number.
OTHER_PHONE = "+4915199999999"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
TODAY = "2026-04-01"

# On no payload: each person types their own on their confirmation page, so a seat only ever holds a
# date the server carried over from the row.
BIRTH_DATE = "1990-05-17"


# One number per person: two different people sharing one is a payload the save refuses.
PHONE: dict[str, str] = {
    "Ida": "+4915110000001",
    "Jonas": "+4915110000002",
    "Klara": "+4915110000003",
    "Lea": "+4915110000004",
    "Mika": "+4915110000005",
    "Nils": "+4915110000006",
    "Bert": "+4915110000008",
}


def person(first_name: str, *, email: str | None = None) -> dict[str, Any]:
    """One person as `compose_seat_block` hands them on: what the editor sends, under the record the write bears."""

    return {
        "first_name": first_name,
        "last_name": "Musterfrau",
        "email": email or f"{first_name.lower()}@example.com",
        "phone": PHONE[first_name],
        "einwilligung": compose_einwilligung(today=TODAY, entered_by="liga"),
    }


def stored_person(first_name: str, *, email: str | None = None, confirmed_at: str | None = None) -> dict[str, Any]:
    """The same person as a row HOLDS them, provenance and birthdate included, the league having seated them."""

    sent = person(first_name, email=email)

    return kontaktperson_document(
        first_name,
        confirmed_at=confirmed_at,
        einwilligung={"date": "2026-03-01"},
        entered_by="liga",
        last_name=sent["last_name"],
        email=sent["email"],
        phone=sent["phone"],
        birth_date=BIRTH_DATE,
    )


def born(sent: dict[str, Any]) -> dict[str, Any]:
    """The record a person newly seated holds: theirs alone, naming the league as who seated them.

    Spelled out here rather than composed by the helper, so a composer drifting from it fails.
    """

    return {"scope": "kontakt_data", "date": TODAY, "confirmed_at": None, "media": False, "entered_by": "liga"}


def as_stored(kontakte: dict[str, Any]) -> dict[str, Any]:
    """What the block's write stores from a payload whose seats no row already holds: every seat born afresh."""

    return {
        seat: ({**value, "birth_date": None, "einwilligung": born(value)} if isinstance(value, dict) else value)
        for seat, value in kontakte.items()
    }


def unconfirmed(einwilligung: dict[str, Any]) -> dict[str, Any]:
    """A stored record held unconfirmed: the stamp nulled."""

    return {**einwilligung, "confirmed_at": None}


def as_kept(stored: dict[str, Any]) -> dict[str, Any]:
    """A stored seat its unconfirmed person keeps through a save: the whole record, held unconfirmed."""

    return {**stored, "einwilligung": unconfirmed(stored["einwilligung"])}


# Three seats as the league seated them, nobody having answered.
SEEDED_KONTAKTE: dict[str, Any] = {
    "trainer": stored_person("Ida"),
    "ansprechperson": stored_person("Jonas"),
    "stellvertretung": stored_person("Klara"),
    "trainer_is_also": None,
}

# The Trainer holding the Ansprechperson's seat too, so the two blocks are one person's.
NEW_KONTAKTE: dict[str, Any] = {
    "trainer": person("Lea"),
    "ansprechperson": person("Lea"),
    "stellvertretung": person("Nils"),
    "trainer_is_also": "ansprechperson",
}

# One seat its person confirmed, beside two nobody has.
PARTLY_CONFIRMED: dict[str, Any] = {
    "trainer": stored_person("Ida", confirmed_at=CONFIRMED_ON),
    "ansprechperson": stored_person("Jonas"),
    "stellvertretung": stored_person("Klara"),
    "trainer_is_also": None,
}

# The seeded block as the EDITOR sends it back: the same three people with the provenance stripped,
# which is what an administrator's open page holds while somebody else asks to be forgotten.
RESAVED_AS_RENDERED: dict[str, Any] = {
    "trainer": person("Ida"),
    "ansprechperson": person("Jonas"),
    "stellvertretung": person("Klara"),
    "trainer_is_also": None,
}

# What the seat write's payload takes of a person.
SEAT_SENT = {field: value for field, value in person("Ida").items() if field != "einwilligung"}

ERASED_SEAT = "ansprechperson"
ERASED_EMAIL = str(RESAVED_AS_RENDERED[ERASED_SEAT]["email"])


def junction_document(saison_id: str, kontakte: dict[str, Any] | None) -> dict[str, Any]:
    """One junction row as a season in progress holds it."""

    return saison_team_document(
        saison_id, TEAM_OID, TEAM_NAME, TEAM_SHORTHAND, gruppe=GRUPPE, austritt=dict(AUSTRITT), trikot_farbe=TRIKOT_FARBE, kontakte=kontakte
    )


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, seeded: dict[str, Any] | None = SEEDED_KONTAKTE) -> Any:
    """`constraints=True`, so what the block's write stores is judged by the database's own indexes rather than by Pydantic alone."""

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
    kontakte: dict[str, Any],
    *,
    # The version the caller last read off the row, the seed's unless a case names another.
    version: int = 0,
    saison_teams_collection: Any = None,
) -> BlockWritten:
    return await write_the_block(
        database,
        kontakte,
        team_id=TEAM_OID,
        saison_id=SAISON_ID,
        version=version,
        today=TODAY,
        germany_now=MAIL_NOW,
        saison_teams_collection=saison_teams_collection,
    )


async def erase_the_seats_person(database: AsyncDatabase) -> FLErasureResponse:
    """The erasure of the person holding `ERASED_SEAT`, in a transaction of its own."""

    return await erased(database, database.client, ERASED_EMAIL, germany_now=NOW)


class JunctionRunningAHookBeforeTheWrite(InterleavedCollection):
    """The junction collection, running one hook immediately before the first update asked of it."""

    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()

        return await self._collection.find_one_and_update(*args, **kwargs)


async def row_now(database: AsyncDatabase, saison_id: str = SAISON_ID) -> dict[str, Any]:
    found = await database[Collection.SAISON_TEAMS].find_one({"team_id": TEAM_OID, "saison_id": saison_id})
    assert found is not None, f"the seeded row for {saison_id} is gone"

    return found


@pytest.mark.db
class TestTheBlockIsWritten:
    def test_the_stored_block_is_the_one_sent(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, NEW_KONTAKTE)

            return await row_now(database)

        assert on_a_league(mongo_replica_set_url, body)["kontakte"] == as_stored(NEW_KONTAKTE)


@pytest.mark.db
class TestTheProvenanceIsTheServers:
    """A stored confirmation survives the editor, and nothing an editor sends can create one."""

    def test_a_confirmed_seat_keeps_its_source_and_its_stamp_through_an_edit(self, mongo_replica_set_url: str):
        """The data-loss path: the block is `$set` whole, so a stamp the write does not carry over is destroyed with no refusal.

        The telephone number is the edit here, and says nothing about who holds the seat.
        """

        edited = {**PARTLY_CONFIRMED, "trainer": {**person("Ida", email=PARTLY_CONFIRMED["trainer"]["email"]), "phone": OTHER_PHONE}}
        edited["ansprechperson"] = person("Jonas")
        edited["stellvertretung"] = person("Klara")

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, edited)

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body, seeded=PARTLY_CONFIRMED)

        trainer = stored["kontakte"]["trainer"]
        assert trainer["phone"] == OTHER_PHONE, "the edit itself did not land, so this case proves nothing"
        assert trainer["einwilligung"]["confirmed_at"] == CONFIRMED_ON
        # The date goes the same way, and by the same route: the payload names none, so a save that
        # did not carry it over would leave a stamped seat with no birthdate at all.
        assert trainer["birth_date"] == BIRTH_DATE

    def test_a_confirmed_seat_renamed_at_its_own_address_starts_unconfirmed(self, mongo_replica_set_url: str):
        """A role mailbox handed from one teacher to the next, which the address alone cannot tell from an edit.

        The WhatsApp scope goes with the stamp and the date.
        """

        whatsapp = {
            **PARTLY_CONFIRMED,
            "trainer": {
                **PARTLY_CONFIRMED["trainer"],
                "einwilligung": {**PARTLY_CONFIRMED["trainer"]["einwilligung"], "scope": "kontakt_data_whatsapp"},
            },
        }
        successor = {**person("Bert", email=str(PARTLY_CONFIRMED["trainer"]["email"])), "last_name": "Neu"}
        renamed = {**RESAVED_AS_RENDERED, "trainer": successor}

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, renamed)

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body, seeded=whatsapp)

        trainer = stored["kontakte"]["trainer"]
        assert (trainer["first_name"], trainer["last_name"]) == ("Bert", "Neu"), "the rename did not land, so this case proves nothing"
        assert trainer["einwilligung"] == born(successor)
        assert trainer["birth_date"] is None

    def test_a_confirmed_seat_handed_to_another_address_starts_unconfirmed(self, mongo_replica_set_url: str):
        """The confirmation is what one mailbox's owner clicked: a new address in the seat has clicked nothing."""

        replaced = {**PARTLY_CONFIRMED, "trainer": person("Ida", email="another.ida@example.com")}
        replaced["ansprechperson"] = person("Jonas")
        replaced["stellvertretung"] = person("Klara")

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, replaced)

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body, seeded=PARTLY_CONFIRMED)

        assert stored["kontakte"]["trainer"]["einwilligung"] == born(person("Ida"))
        # And the date with it: it is a fact about the person, and this seat now holds another one.
        assert stored["kontakte"]["trainer"]["birth_date"] is None


@pytest.mark.db
class TestNothingElseOnTheRowMoves:
    """Two editors write one row, so the block's write leaves every other field alone."""

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
class TestAnErasureLandingMidSaveIsNotUndone:
    """Two administrators on one row: an erasure empties a seat while the editor holds the block it rendered.

    The editor replaces the block whole, so its payload puts the seat back unless the write
    judges the row first.
    """

    def test_a_seat_erased_under_the_save_is_refused_rather_than_put_back(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            erasures: list[Any] = []

            async def erase_between() -> None:
                erasures.append(await erase_the_seats_person(database))

            junction = JunctionRunningAHookBeforeTheWrite(database[Collection.SAISON_TEAMS], erase_between)
            with pytest.raises(APIError) as refused:
                await write_kontakte(database, RESAVED_AS_RENDERED, saison_teams_collection=junction)
            # An erasure committing first refuses the save at its read, before it reaches the write.
            junction.assert_landed_inside(serially=0)

            return erasures[0], refused.value, await row_now(database)

        erasure, refusal, stored = on_a_league(mongo_replica_set_url, body)

        assert erasure.kontakt_seats == 1, "the interference emptied no seat, so the save had nothing to undo"
        assert refusal.error_code == Code.VERSION_STALE
        assert stored["kontakte"][ERASED_SEAT] is None, "the save put the person who asked to be forgotten back on the row"


@pytest.mark.db
class TestASaveComposedAgainstAnotherBlockIsRefused:
    def test_the_row_keeps_what_it_held(self, mongo_replica_set_url: str):
        """A refusal has to stop the write rather than accompany it."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(APIError) as refused:
                await write_kontakte(database, NEW_KONTAKTE, version=1)

            return refused.value, await row_now(database)

        refusal, stored = on_a_league(mongo_replica_set_url, body)

        assert refusal.error_code == Code.VERSION_STALE
        assert stored["kontakte"] == SEEDED_KONTAKTE


class TestWhatThePayloadRefuses:
    """The provenance and the birthdate are on no payload: a field the editor merely hid would still be a route an API caller has."""

    @pytest.mark.parametrize(("field", "value"), [("birth_date", BIRTH_DATE), ("confirmed_at", CONFIRMED_ON), ("einwilligung", {})])
    def test_a_seat_naming_what_only_its_person_gives_is_refused(self, field: str, value: Any):
        """Through the seat write's own payload: refused rather than bounded, an age floor here would still let an administrator enter it."""

        with pytest.raises(ValidationError) as failure:
            FLKontaktSeatPayload.model_validate({**SEAT_SENT, "version": 0, field: value})

        assert [(entry["type"], entry["loc"][-1]) for entry in failure.value.errors()] == [("extra_forbidden", field)]


class TestTheCompositionDecidesFromItsArguments:
    """The pure half, so every branch is pinned without a container."""

    @pytest.mark.parametrize("stored", [pytest.param(None, id="a row with no block"), pytest.param({}, id="an empty block")])
    def test_a_row_holding_no_block_yields_every_seat_unconfirmed(self, stored: Any):
        assert compose_kontakte_herkunft(kontakte=NEW_KONTAKTE, stored=stored) == as_stored(NEW_KONTAKTE)

    def test_the_address_is_matched_case_insensitively(self):
        """On the sign-in fold, which the erasure shares: a mailbox is one address however its local part is capitalised."""

        recased = {**PARTLY_CONFIRMED, "trainer": person("Ida", email="IDA@Example.com")}
        composed = compose_kontakte_herkunft(kontakte=recased, stored=PARTLY_CONFIRMED)

        assert composed["trainer"]["einwilligung"]["confirmed_at"] == CONFIRMED_ON
        assert composed["trainer"]["birth_date"] == BIRTH_DATE


class TestTheDateRidesWithThePerson:
    """The payload names no birthdate, so a save can only carry the row's own forward."""

    def test_the_stored_date_is_carried_forward_for_the_same_person(self):
        composed = compose_kontakte_herkunft(kontakte=RESAVED_AS_RENDERED, stored=SEEDED_KONTAKTE)

        # The floor under the claim below: a date standing beside a stamp would prove a confirmation
        # survived rather than the identity match that carries the date.
        assert composed["trainer"]["einwilligung"]["confirmed_at"] is None, "the seed is confirmed, so this case proves nothing"
        assert [composed[slot]["birth_date"] for slot in ("trainer", "ansprechperson", "stellvertretung")] == [BIRTH_DATE] * 3

    def test_a_seat_handed_to_another_address_holds_no_date(self):
        handed = {**RESAVED_AS_RENDERED, "trainer": person("Ida", email="another.ida@example.com")}
        composed = compose_kontakte_herkunft(kontakte=handed, stored=SEEDED_KONTAKTE)

        assert composed["trainer"]["birth_date"] is None

    @pytest.mark.parametrize(
        "renamed",
        [
            pytest.param({"first_name": "Bert"}, id="a first name"),
            pytest.param({"last_name": "Neu"}, id="a surname"),
            pytest.param({"first_name": "Ida-Marie"}, id="a first name a typo could explain"),
        ],
    )
    def test_a_seat_whose_name_changed_at_its_own_address_holds_no_date(self, renamed: dict[str, str]):
        """The role mailbox handed on. The third case is the accepted false positive: a correction costs the same as a handover."""

        handed = {**RESAVED_AS_RENDERED, "trainer": {**RESAVED_AS_RENDERED["trainer"], **renamed}}
        composed = compose_kontakte_herkunft(kontakte=handed, stored=SEEDED_KONTAKTE)

        assert composed["trainer"]["birth_date"] is None

    @pytest.mark.parametrize(
        ("held", "sent"),
        [
            pytest.param({}, {"first_name": "IDA"}, id="the case, which a payload does carry"),
            pytest.param({"last_name": " Musterfrau "}, {}, id="padding, which only a stored row carries"),
            pytest.param({"last_name": "Muster  frau"}, {"last_name": "Muster frau"}, id="a doubled inner space"),
            # Built from code points: the decomposed umlaut renders exactly as the composed one.
            pytest.param({"last_name": f"Mu{chr(0x308)}ller"}, {"last_name": f"M{chr(0xFC)}ller"}, id="an umlaut stored decomposed"),
        ],
    )
    def test_a_name_respelled_and_not_changed_keeps_the_date(self, held: dict[str, str], sent: dict[str, str]):
        """The fold's whole purpose: none of these is another person, and each would otherwise cost one a fresh confirmation."""

        stored = {**SEEDED_KONTAKTE, "trainer": {**SEEDED_KONTAKTE["trainer"], **held}}
        respelt = {**RESAVED_AS_RENDERED, "trainer": {**RESAVED_AS_RENDERED["trainer"], **sent}}
        composed = compose_kontakte_herkunft(kontakte=respelt, stored=stored)

        assert composed["trainer"]["birth_date"] == BIRTH_DATE

    def test_a_sharp_s_surname_and_its_ss_spelling_are_two_people(self):
        """„Weiß“ and „Weiss“ are two families, which `casefold` would make one person holding the other's date."""

        stored = {**SEEDED_KONTAKTE, "trainer": {**SEEDED_KONTAKTE["trainer"], "last_name": "Weiß"}}
        respelt = {**RESAVED_AS_RENDERED, "trainer": {**RESAVED_AS_RENDERED["trainer"], "last_name": "Weiss"}}
        composed = compose_kontakte_herkunft(kontakte=respelt, stored=stored)

        assert composed["trainer"]["birth_date"] is None


class TestWhatASeatsLinkReads:
    """What the team editor's seat row draws as lapsed and as undelivered, judged as the press judges the link."""

    ROW = ObjectId("6890a1b2c3d4e5f607240002")
    TODAY = "2026-04-01"
    PAST = "2026-03-31"
    SENT = FLOutboxStatus(state="sent", delivery=None)
    GIVEN_UP = FLOutboxStatus(state="abandoned", delivery=None)

    def read(self, *, kontakte: dict[str, Any], confirmations: dict[str, Any], states: dict[tuple[Any, str | None], FLOutboxStatus]) -> Any:
        team = {"memberships": [{"_id": self.ROW, "kontakte": {"trainer_is_also": None, **kontakte}, "confirmations": confirmations}]}

        return with_link_state([team], today=self.TODAY, states=states)[0]["memberships"][0]["confirmations"]

    def link(self, deadline: str) -> dict[str, Any]:
        return {"token_hashes": [], "sent_at": "2026-03-18", "reminded_at": None, "declined_at": None, "deadline": deadline}

    def test_a_link_lapses_past_its_day_and_only_while_unanswered(self):
        """The deadline's own day still answers, and an answered seat has nothing left to collect."""

        links = self.read(
            kontakte={
                "trainer": kontaktperson_document("Bramblewick"),
                "ansprechperson": kontaktperson_document("Quillhilde"),
                "stellvertretung": kontaktperson_document("Wraxlington", confirmed_at=self.PAST),
            },
            confirmations={"trainer": self.link(self.PAST), "ansprechperson": self.link(self.TODAY), "stellvertretung": self.link(self.PAST)},
            states={},
        )

        assert {seat: link["expired"] for seat, link in links.items()} == {"trainer": True, "ansprechperson": False, "stellvertretung": False}

    def test_each_seat_reads_the_mail_owed_about_it(self):
        links = self.read(
            kontakte={"trainer": kontaktperson_document("Bramblewick"), "ansprechperson": kontaktperson_document("Quillhilde")},
            confirmations={"trainer": self.link(self.TODAY), "ansprechperson": self.link(self.TODAY)},
            states={(self.ROW, "ansprechperson"): self.GIVEN_UP},
        )

        assert (links["trainer"]["delivery"], links["ansprechperson"]["delivery"]) == (None, self.GIVEN_UP)

    def test_a_trainer_holding_another_seat_reads_that_seats_mail(self):
        """One link answers both seats and its mail was owed about the mirrored one, so the Trainer's row reads a mail keyed elsewhere."""

        person = kontaktperson_document("Bramblewick")
        link = self.link(self.TODAY)

        links = self.read(
            kontakte={"trainer": person, "ansprechperson": person, "trainer_is_also": "ansprechperson"},
            confirmations={"trainer": link, "ansprechperson": link},
            states={(self.ROW, "ansprechperson"): self.SENT},
        )

        assert (links["trainer"]["delivery"], links["ansprechperson"]["delivery"]) == (self.SENT, self.SENT)


@pytest.mark.db
class TestAKeptRecordKeepsItsEvidence:
    """An unchanged person keeps their record whole: the payload spells none of its evidence, its media answer or its scope."""

    def test_a_confirmed_seat_saved_unchanged_is_stored_byte_for_byte(self, mongo_replica_set_url: str):
        """The data-loss path the record exists against: a block recomposed from the payload erases its evidence."""

        confirmed = {
            "scope": "kontakt_data_whatsapp",
            "date": "2026-03-01",
            "confirmed_at": CONFIRMED_ON,
            "media": True,
            "entered_by": "bewerbung",
            "evidence": {
                "scope": {"at": "2026-03-15T09:00:00+00:00", "text_version": SEAT_TEXT_VERSIONS["scope"]},
                "media": {"at": "2026-03-20T09:00:00+00:00", "text_version": SEAT_TEXT_VERSIONS["media"]},
            },
        }
        seeded = {**PARTLY_CONFIRMED, "trainer": {**PARTLY_CONFIRMED["trainer"], "einwilligung": confirmed}}
        # As the editor renders a confirmed seat and sends it back.
        sent = {**RESAVED_AS_RENDERED, "trainer": {**person("Ida"), "phone": OTHER_PHONE}}

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, sent)

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body, seeded=seeded)

        assert stored["kontakte"]["trainer"]["phone"] == OTHER_PHONE, "the edit itself did not land, so this case proves nothing"
        assert bson.encode(stored["kontakte"]["trainer"]["einwilligung"]) == bson.encode(confirmed)

    def test_an_unconfirmed_seat_saved_unchanged_keeps_who_seated_its_person(self, mongo_replica_set_url: str):
        """The commoner seat: who seated its person, the applicant or the league, is the seating's and no save's."""

        held = PARTLY_CONFIRMED["ansprechperson"]
        seeded = {**PARTLY_CONFIRMED, "ansprechperson": {**held, "einwilligung": {**held["einwilligung"], "entered_by": "bewerbung"}}}

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, RESAVED_AS_RENDERED)

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body, seeded=seeded)

        assert stored["kontakte"]["ansprechperson"]["einwilligung"]["entered_by"] == "bewerbung"

    def test_a_seat_handed_to_another_person_is_born_afresh_by_the_league(self, mongo_replica_set_url: str):
        """Nothing of the person who left travels: their evidence, scope and media answer go with their data."""

        handed = {**RESAVED_AS_RENDERED, "trainer": person("Lea")}

        async def body(database: AsyncDatabase) -> Any:
            await write_kontakte(database, handed)

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body, seeded=PARTLY_CONFIRMED)

        assert stored["kontakte"]["trainer"]["einwilligung"] == born(person("Lea"))
        assert stored["kontakte"]["ansprechperson"] == as_kept(PARTLY_CONFIRMED["ansprechperson"])
