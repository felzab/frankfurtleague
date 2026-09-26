from collections.abc import Iterator
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identitaet.crud import funktionen_of
from app.api.identitaet.schemas import FLSubjektResponse
from app.api.kontakte.services import KONTAKT_SLOTS
from app.core.collections import Collection
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from tests.database import a_clean_database, on_the_seed_loop, shared_client
from tests.documents import EINWILLIGUNG, rules_document, saison_document, saison_team_document, spieler_document
from tests.worker import worker_database

from .conftest import AUSTRITT, unwritten

DATABASE_NAME = worker_database("fl_funktionen_test")

PAST_SAISON = "2425"
ACTIVE_SAISON = "2526"
FUTURE_SAISON = "2627"

TEAM_A_OID = ObjectId("6890a1b2c3d4e5f607830001")
TEAM_B_OID = ObjectId("6890a1b2c3d4e5f607830002")
TEAM_C_OID = ObjectId("6890a1b2c3d4e5f607830003")
TEAM_D_OID = ObjectId("6890a1b2c3d4e5f607830004")
TEAM_E_OID = ObjectId("6890a1b2c3d4e5f607830005")
ROW_ACTIVE_A_OID = ObjectId("6890a1b2c3d4e5f607830011")
ROW_ACTIVE_B_OID = ObjectId("6890a1b2c3d4e5f607830012")
ROW_PAST_A_OID = ObjectId("6890a1b2c3d4e5f607830013")
ROW_FUTURE_A_OID = ObjectId("6890a1b2c3d4e5f607830014")
ROW_ACTIVE_C_OID = ObjectId("6890a1b2c3d4e5f607830015")
ROW_ACTIVE_D_OID = ObjectId("6890a1b2c3d4e5f607830016")
ROW_ACTIVE_E_OID = ObjectId("6890a1b2c3d4e5f607830017")
ROW_FUTURE_E_OID = ObjectId("6890a1b2c3d4e5f607830018")

ROW_NAME_A = "Helmholtz"
ROW_NAME_B = "Lessing"
ROW_NAME_C = "Goethe"
ROW_NAME_D = "Schiller"
ROW_NAME_E = "Herder"

STAMP = "2026-02-01"

# One mailbox per case, each spelled so that a hit in the corpus cannot be a coincidence.
AKTIV = "aktiv.sitz@schule.de"
AKTIV_UNFOLDED = "Aktiv.Sitz@SCHULE.de"
GROSS_ASKED = "gross.sitz@schule.de"
GROSS_STORED = "GROSS.SITZ@schule.de"
ZWEI_TEAMS = "zwei.teams@schule.de"
ZEITEN = "zeiten.sitz@schule.de"
OHNE_STEMPEL = "ohne.stempel@schule.de"
OHNE_SCHLUESSEL = "ohne.schluessel@schule.de"
ZUGLEICH = "zugleich.sitz@schule.de"
NUR_OFFEN = "nur.offen@schule.de"
GEMISCHT = "gemischt@schule.de"
EHEMALIG = "ehemalig@schule.de"
RUHESTAND_PFEIFE = "ruhestand.pfeife@schule.de"
RUHESTAND_OFFEN = "ruhestand.offen@schule.de"
PFEIFE_OHNE_RECORD = "pfeife.ohne@schule.de"
PFEIFE_NULL_RECORD = "pfeife.null@schule.de"
PFEIFE_NULL_STEMPEL = "pfeife.offen@schule.de"
GEIST = "geist@schule.de"
NIEMAND = "niemand.hierverzeichnet@example.com"
# Stamped with an empty string, which the validator admits from a hand edit: one mailbox per kind.
LEER_SITZ = "leer.sitz@schule.de"
LEER_SPIELER = "leer.spieler@schule.de"
LEER_PFEIFE = "leer.pfeife@schule.de"
NUR_SPIELER_OFFEN = "nur.spieler.offen@schule.de"
# A confirmed seat on a `past` season beside an unconfirmed one on the `active` season, and an
# unconfirmed `past` seat alone: the flag is judged over what could grant a panel.
VERGANGEN_UND_OFFEN = "vergangen.und.offen@schule.de"
NUR_VERGANGEN_OFFEN = "nur.vergangen.offen@schule.de"
# Seated on a team that withdrew from the active season and is entered again for the future one.
AUSGETRETEN = "ausgetreten.sitz@schule.de"
AUSGETRETEN_OFFEN = "ausgetreten.offen@schule.de"

# The „ß“ decision: IDNA 2008 keeps „ß“ in a domain, so the two are two mailboxes.
SHARP_S_ASKED = "Post@straße.de"
DOUBLE_S_ASKED = "POST@strasse.de"
DOUBLE_S_STORED = "post@strasse.de"

PUPIL_UNCONFIRMED_OID = ObjectId("6890a1b2c3d4e5f607830021")
PUPIL_GEMISCHT_OID = ObjectId("6890a1b2c3d4e5f607830022")
PUPIL_EHEMALIG_OID = ObjectId("6890a1b2c3d4e5f607830023")
PUPIL_RUHESTAND_OFFEN_OID = ObjectId("6890a1b2c3d4e5f607830024")
PUPIL_LEER_OID = ObjectId("6890a1b2c3d4e5f607830025")
PUPIL_NUR_OFFEN_OID = ObjectId("6890a1b2c3d4e5f607830026")
REFEREE_UNCONFIRMED_OID = ObjectId("6890a1b2c3d4e5f607830031")
REFEREE_GEMISCHT_OID = ObjectId("6890a1b2c3d4e5f607830032")
REFEREE_RUHESTAND_OID = ObjectId("6890a1b2c3d4e5f607830033")
REFEREE_OHNE_RECORD_OID = ObjectId("6890a1b2c3d4e5f607830034")
REFEREE_NULL_RECORD_OID = ObjectId("6890a1b2c3d4e5f607830035")
REFEREE_NULL_STEMPEL_OID = ObjectId("6890a1b2c3d4e5f607830036")
REFEREE_LEER_OID = ObjectId("6890a1b2c3d4e5f607830037")

KENNTNISNAHME: dict[str, Any] = {"umfang": "kontaktdaten", "erfasst_von": "person", "text_version": "v1", "datum": "2026-01-05"}


def _seat(email: str, *, bestaetigt_am: str | None = STAMP, keyed: bool = True) -> dict[str, Any]:
    """`keyed=False` stores a record carrying no `bestaetigt_am` KEY, the shape `_KONTAKT_KENNTNISNAHME`'s `required` admits."""

    einwilligung = {**KENNTNISNAHME, "bestaetigt_am": bestaetigt_am} if keyed else dict(KENNTNISNAHME)

    return {"vorname": "Anna", "nachname": "Müller", "email": email, "telefon": "+49 69 5550101", "einwilligung": einwilligung}


def _junction(
    row_id: ObjectId,
    saison_id: str,
    team_id: ObjectId,
    name: str,
    *,
    zugleich: str | None = None,
    austritt: dict[str, Any] | None = None,
    **slots: dict[str, Any],
) -> dict[str, Any]:
    return saison_team_document(
        saison_id,
        team_id,
        name,
        name[:2].upper(),
        _id=row_id,
        austritt=austritt,
        kontakte={**{slot: None for slot in KONTAKT_SLOTS}, **slots, "trainer_ist_zugleich": zugleich},
    )


def _saison(saison_id: str, status: str) -> dict[str, Any]:
    return saison_document(
        saison_id,
        status,
        start_date=f"20{saison_id[:2]}-08-01",
        end_date=f"20{saison_id[2:]}-06-30",
        rules=rules_document(erlaubte_stufen=["Q1", "Q2"]),
    )


def _pupil(pupil_id: ObjectId, email: str, *, bestaetigt_am: str | None, inactive_since: str | None = None) -> dict[str, Any]:
    return spieler_document(
        pupil_id,
        "Anna",
        "Müller",
        email=email,
        einwilligung={**EINWILLIGUNG, "bestaetigt_am": bestaetigt_am},
        inactive_since=inactive_since,
    )


def _referee(referee_id: ObjectId, email: str, name: str | None, **fields: Any) -> dict[str, Any]:
    # A name per referee: `app/core/constraints.py :: uniq_schiedsrichter_name` indexes it.
    return {
        "_id": referee_id,
        "name": name,
        "schule": None,
        "default_payment": 20,
        "kontakt": {"telefon": "+49 69 5550202", "email": email},
        "inactive_since": None,
        **fields,
    }


CONFIRMED: dict[str, Any] = {**EINWILLIGUNG, "bestaetigt_am": STAMP}
UNCONFIRMED: dict[str, Any] = {**EINWILLIGUNG, "bestaetigt_am": None}


async def _seed(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_many(
        [_saison(PAST_SAISON, "past"), _saison(ACTIVE_SAISON, "active"), _saison(FUTURE_SAISON, "future")]
    )
    await database[Collection.SAISON_TEAMS].insert_many(
        [
            _junction(
                ROW_ACTIVE_A_OID,
                ACTIVE_SAISON,
                TEAM_A_OID,
                ROW_NAME_A,
                trainer=_seat(AKTIV),
                ansprechperson=_seat(ZWEI_TEAMS),
                stellvertretung=_seat(GROSS_STORED),
            ),
            _junction(
                ROW_ACTIVE_B_OID,
                ACTIVE_SAISON,
                TEAM_B_OID,
                ROW_NAME_B,
                trainer=_seat(ZWEI_TEAMS),
                ansprechperson=_seat(OHNE_STEMPEL, bestaetigt_am=None),
                stellvertretung=_seat(OHNE_SCHLUESSEL, keyed=False),
            ),
            _junction(
                ROW_PAST_A_OID,
                PAST_SAISON,
                TEAM_A_OID,
                ROW_NAME_A,
                trainer=_seat(ZEITEN),
                ansprechperson=_seat(VERGANGEN_UND_OFFEN),
                stellvertretung=_seat(NUR_VERGANGEN_OFFEN, bestaetigt_am=None),
            ),
            _junction(ROW_FUTURE_A_OID, FUTURE_SAISON, TEAM_A_OID, ROW_NAME_A, trainer=_seat(ZEITEN), ansprechperson=_seat(DOUBLE_S_STORED)),
            # The Trainer also holds the Ansprechperson seat, confirmed in the first and entered by an
            # administrator into the second: the stamp is the SLOT's, so the second grants nothing.
            _junction(
                ROW_ACTIVE_C_OID,
                ACTIVE_SAISON,
                TEAM_C_OID,
                ROW_NAME_C,
                zugleich="ansprechperson",
                trainer=_seat(ZUGLEICH),
                ansprechperson=_seat(ZUGLEICH, bestaetigt_am=None),
                stellvertretung=_seat(NUR_OFFEN, bestaetigt_am=None),
            ),
            _junction(
                ROW_ACTIVE_D_OID,
                ACTIVE_SAISON,
                TEAM_D_OID,
                ROW_NAME_D,
                trainer=_seat(LEER_SITZ, bestaetigt_am=""),
                ansprechperson=_seat(VERGANGEN_UND_OFFEN, bestaetigt_am=None),
            ),
            _junction(
                ROW_ACTIVE_E_OID,
                ACTIVE_SAISON,
                TEAM_E_OID,
                ROW_NAME_E,
                austritt=dict(AUSTRITT),
                trainer=_seat(AUSGETRETEN),
                ansprechperson=_seat(AUSGETRETEN_OFFEN, bestaetigt_am=None),
            ),
            _junction(ROW_FUTURE_E_OID, FUTURE_SAISON, TEAM_E_OID, ROW_NAME_E, trainer=_seat(AUSGETRETEN)),
        ]
    )
    await database[Collection.SPIELER].insert_many(
        [
            _pupil(PUPIL_UNCONFIRMED_OID, NUR_OFFEN, bestaetigt_am=None),
            _pupil(PUPIL_GEMISCHT_OID, GEMISCHT, bestaetigt_am=None),
            _pupil(PUPIL_EHEMALIG_OID, EHEMALIG, bestaetigt_am=STAMP, inactive_since="2026-03-01"),
            _pupil(PUPIL_RUHESTAND_OFFEN_OID, RUHESTAND_OFFEN, bestaetigt_am=None, inactive_since="2026-03-01"),
            _pupil(PUPIL_LEER_OID, LEER_SPIELER, bestaetigt_am=""),
            _pupil(PUPIL_NUR_OFFEN_OID, NUR_SPIELER_OFFEN, bestaetigt_am=None),
        ]
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            _referee(REFEREE_UNCONFIRMED_OID, NUR_OFFEN, "A. Offen", einwilligung=None),
            _referee(REFEREE_GEMISCHT_OID, GEMISCHT, "B. Gemischt", einwilligung=CONFIRMED),
            _referee(REFEREE_RUHESTAND_OID, RUHESTAND_PFEIFE, "C. Ruhestand", einwilligung=CONFIRMED, inactive_since="2026-03-01"),
            _referee(REFEREE_OHNE_RECORD_OID, PFEIFE_OHNE_RECORD, "D. Ohne"),
            _referee(REFEREE_NULL_RECORD_OID, PFEIFE_NULL_RECORD, "E. Null", einwilligung=None),
            _referee(REFEREE_NULL_STEMPEL_OID, PFEIFE_NULL_STEMPEL, "F. Stempel", einwilligung=UNCONFIRMED),
            _referee(REFEREE_LEER_OID, LEER_PFEIFE, "G. Leer", einwilligung={**EINWILLIGUNG, "bestaetigt_am": ""}),
            # The ghost as no write leaves it -- an address, a stamp, not retired -- so that its id is
            # the one thing left keeping it out of every answer.
            _referee(GHOST_SCHIEDSRICHTER_ID, GEIST, None, einwilligung=CONFIRMED),
        ]
    )


# Module-scoped: every case below reads this corpus, and the one opening a transaction aborts it,
# which `unwritten` keeps from being left as a claim.
@pytest.fixture(scope="module")
def seeded_league(mongo_replica_set_url: str) -> Iterator[str]:
    async def _run() -> None:
        async with a_clean_database(mongo_replica_set_url, DATABASE_NAME) as (_, database):
            await _seed(database)

    on_the_seed_loop(_run())

    with unwritten(mongo_replica_set_url, DATABASE_NAME):
        yield mongo_replica_set_url


async def _ask(database: AsyncDatabase, email: str, session: AsyncClientSession) -> FLSubjektResponse:
    return await funktionen_of(
        email,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spieler_collection=database[Collection.SPIELER],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        session=session,
    )


def answered(url: str, email: str) -> FLSubjektResponse:
    async def _run() -> FLSubjektResponse:
        async with shared_client(url).start_session() as session:
            return await _ask(shared_client(url)[DATABASE_NAME], email, session)

    return on_the_seed_loop(_run())


def seats(answer: FLSubjektResponse) -> list[tuple[str, ObjectId, str, str, str]]:
    return [(sitz.saison_id, sitz.team_id, sitz.rolle, sitz.team_name, sitz.saison_status) for sitz in answer.sitze]


def is_empty(answer: FLSubjektResponse) -> bool:
    return (answer.sitze, answer.spieler, answer.schiedsrichter) == ([], [], [])


@pytest.mark.db
class TestTheSeasonNarrowing:
    def test_a_seat_on_the_active_season_is_answered_with_its_team_and_season(self, seeded_league: str):
        assert seats(answered(seeded_league, AKTIV)) == [(ACTIVE_SAISON, TEAM_A_OID, "trainer", ROW_NAME_A, "active")]

    def test_a_past_seat_is_answered_nothing_while_the_future_one_is_answered(self, seeded_league: str):
        """One mailbox holding both, so a narrowing dropped answers the past seat beside the future one rather than passing."""

        assert seats(answered(seeded_league, ZEITEN)) == [(FUTURE_SAISON, TEAM_A_OID, "trainer", ROW_NAME_A, "future")]

    def test_a_mailbox_on_two_teams_rows_is_answered_two_seats(self, seeded_league: str):
        assert [(sitz.team_id, sitz.rolle) for sitz in answered(seeded_league, ZWEI_TEAMS).sitze] == [
            (TEAM_A_OID, "ansprechperson"),
            (TEAM_B_OID, "trainer"),
        ]


@pytest.mark.db
class TestTheFold:
    def test_a_seat_stored_with_an_upper_case_local_part_is_answered(self, seeded_league: str):
        assert seats(answered(seeded_league, GROSS_ASKED)) == [(ACTIVE_SAISON, TEAM_A_OID, "stellvertretung", ROW_NAME_A, "active")]

    def test_an_identifier_arriving_unfolded_is_answered_the_same_seat(self, seeded_league: str):
        """Kills trusting the caller to have folded: the pre-filter is case-blind, so only the fold's own comparison parts the two."""

        assert seats(answered(seeded_league, AKTIV_UNFOLDED)) == seats(answered(seeded_league, AKTIV))

    def test_an_address_on_the_sharp_s_domain_is_not_answered_the_double_s_seat(self, seeded_league: str):
        """Kills `casefold` in the fold, which maps „ß“ to „ss“; the double-s spelling asked beside it is the control."""

        assert answered(seeded_league, SHARP_S_ASKED).sitze == []
        assert [(sitz.saison_id, sitz.rolle) for sitz in answered(seeded_league, DOUBLE_S_ASKED).sitze] == [(FUTURE_SAISON, "ansprechperson")]


@pytest.mark.db
class TestTheConfirmationNarrowing:
    def test_a_seat_with_a_null_stamp_grants_nothing(self, seeded_league: str):
        """The seat is the mailbox's only record, so the flag's seat arm is what raises it."""

        answer = answered(seeded_league, OHNE_STEMPEL)

        assert answer.sitze == []
        assert answer.unbestaetigt is True

    def test_an_unconfirmed_pupil_alone_is_answered_nothing_and_flagged(self, seeded_league: str):
        """The flag's pupil arm, with no seat or referee beside it to raise the flag instead."""

        answer = answered(seeded_league, NUR_SPIELER_OFFEN)

        assert is_empty(answer)
        assert answer.unbestaetigt is True

    def test_a_confirmed_past_seat_beside_an_unconfirmed_active_one_is_flagged(self, seeded_league: str):
        """Kills a flag judged before the season narrowing: the past seat's stamp would hold it down while nothing is granted."""

        answer = answered(seeded_league, VERGANGEN_UND_OFFEN)

        assert answer.sitze == []
        assert answer.unbestaetigt is True

    def test_an_unconfirmed_past_seat_alone_is_not_flagged(self, seeded_league: str):
        """Confirming a past seat opens nothing, so this mailbox meets the landing of one holding nothing."""

        answer = answered(seeded_league, NUR_VERGANGEN_OFFEN)

        assert is_empty(answer)
        assert answer.unbestaetigt is False

    def test_a_seat_whose_record_carries_no_stamp_key_grants_nothing(self, seeded_league: str):
        """The shape a predicate written as `!= None` over a projected field passes: the key is absent rather than null."""

        assert answered(seeded_league, OHNE_SCHLUESSEL).sitze == []

    def test_one_address_in_two_slots_is_answered_only_the_slot_it_confirmed(self, seeded_league: str):
        """Kills a confirmation judged per row: `trainer_ist_zugleich` seats this person twice, and only the Trainer seat is stamped."""

        assert [sitz.rolle for sitz in answered(seeded_league, ZUGLEICH).sitze] == ["trainer"]

    @pytest.mark.parametrize(
        "email", [PFEIFE_OHNE_RECORD, PFEIFE_NULL_RECORD, PFEIFE_NULL_STEMPEL], ids=["no record", "null record", "null stamp"]
    )
    def test_an_unconfirmed_referee_grants_nothing(self, seeded_league: str, email: str):
        """The three shapes a referee row holds before its person answers, each read as unconfirmed rather than raising."""

        answer = answered(seeded_league, email)

        assert (answer.schiedsrichter, answer.unbestaetigt) == ([], True)

    @pytest.mark.parametrize("email", [LEER_SITZ, LEER_SPIELER, LEER_PFEIFE], ids=["seat", "pupil", "referee"])
    def test_an_empty_stamp_grants_nothing(self, seeded_league: str, email: str):
        """Kills a presence test: `""` is a string the validator admits, and the public name read already withholds on it."""

        answer = answered(seeded_league, email)

        assert is_empty(answer)
        assert answer.unbestaetigt is True

    def test_a_mailbox_holding_only_unconfirmed_records_is_answered_nothing_and_flagged(self, seeded_league: str):
        """A seat, a pupil and a referee, none confirmed: an empty answer that is NOT the answer for a mailbox holding nothing."""

        answer = answered(seeded_league, NUR_OFFEN)

        assert is_empty(answer)
        assert answer.unbestaetigt is True

    def test_a_mailbox_holding_nothing_is_answered_nothing_unflagged(self, seeded_league: str):
        answer = answered(seeded_league, NIEMAND)

        assert is_empty(answer)
        assert answer.unbestaetigt is False

    def test_one_confirmed_record_beside_an_unconfirmed_one_leaves_the_flag_down(self, seeded_league: str):
        """Kills a flag set by ANY unconfirmed record: a person holding a Funktion is not awaiting their own confirmation."""

        answer = answered(seeded_league, GEMISCHT)

        assert ([row.schiedsrichter_id for row in answer.schiedsrichter], answer.spieler, answer.unbestaetigt) == (
            [REFEREE_GEMISCHT_OID],
            [],
            False,
        )

    def test_every_read_sees_what_the_caller_s_transaction_wrote(self, seeded_league: str):
        """Kills any of the four reads made outside the caller's session: each has its own change to miss.

        The seat, the pupil and the referee are stamped and the past season made `future`, in a transaction aborted after.
        """

        async def _run() -> tuple[FLSubjektResponse, FLSubjektResponse, FLSubjektResponse, FLSubjektResponse]:
            client = shared_client(seeded_league)
            database = client[DATABASE_NAME]

            async with client.start_session() as writer, client.start_session() as bystander:
                await writer.start_transaction()
                try:
                    stamped = {"$set": {"einwilligung.bestaetigt_am": STAMP}}
                    await database[Collection.SAISON_TEAMS].update_one(
                        {"_id": ROW_ACTIVE_C_OID}, {"$set": {"kontakte.stellvertretung.einwilligung.bestaetigt_am": STAMP}}, session=writer
                    )
                    await database[Collection.SPIELER].update_one({"_id": PUPIL_UNCONFIRMED_OID}, stamped, session=writer)
                    await database[Collection.SCHIEDSRICHTER].update_one(
                        {"_id": REFEREE_UNCONFIRMED_OID}, {"$set": {"einwilligung": CONFIRMED}}, session=writer
                    )
                    await database[Collection.SAISONS].update_one({"_id": PAST_SAISON}, {"$set": {"status": "future"}}, session=writer)

                    return (
                        await _ask(database, NUR_OFFEN, writer),
                        await _ask(database, ZEITEN, writer),
                        await _ask(database, NUR_OFFEN, bystander),
                        await _ask(database, ZEITEN, bystander),
                    )
                finally:
                    await writer.abort_transaction()

        offen_inside, zeiten_inside, offen_outside, zeiten_outside = on_the_seed_loop(_run())

        assert seats(offen_inside) == [(ACTIVE_SAISON, TEAM_C_OID, "stellvertretung", ROW_NAME_C, "active")]
        assert [row.spieler_id for row in offen_inside.spieler] == [PUPIL_UNCONFIRMED_OID]
        assert [row.schiedsrichter_id for row in offen_inside.schiedsrichter] == [REFEREE_UNCONFIRMED_OID]
        assert [(sitz.saison_id, sitz.saison_status) for sitz in zeiten_inside.sitze] == [(PAST_SAISON, "future"), (FUTURE_SAISON, "future")]
        assert is_empty(offen_outside)
        assert [sitz.saison_id for sitz in zeiten_outside.sitze] == [FUTURE_SAISON]


@pytest.mark.db
class TestTheWithdrawalNarrowing:
    def test_a_seat_on_the_season_its_team_withdrew_from_grants_nothing_while_the_next_season_s_does(self, seeded_league: str):
        """Both seats confirmed, so the withdrawal alone parts them; the future row is the same team's, which a per-team test would drop too."""

        assert seats(answered(seeded_league, AUSGETRETEN)) == [(FUTURE_SAISON, TEAM_E_OID, "trainer", ROW_NAME_E, "future")]

    def test_an_unconfirmed_seat_on_a_withdrawn_row_does_not_raise_the_flag(self, seeded_league: str):
        """The row grants nothing, so confirming the seat would open nothing."""

        answer = answered(seeded_league, AUSGETRETEN_OFFEN)

        assert is_empty(answer)
        assert answer.unbestaetigt is False


@pytest.mark.db
class TestTheRetirementNarrowing:
    def test_a_retired_referee_grants_nothing(self, seeded_league: str):
        """Confirmed, so only the retirement keeps it out."""

        answer = answered(seeded_league, RUHESTAND_PFEIFE)

        assert is_empty(answer)
        assert answer.unbestaetigt is False

    def test_a_retired_pupil_grants_nothing(self, seeded_league: str):
        """Confirmed, so only the retirement keeps it out."""

        assert answered(seeded_league, EHEMALIG).spieler == []

    def test_a_retired_unconfirmed_record_does_not_raise_the_flag(self, seeded_league: str):
        """A person who has left meets the landing of a mailbox holding nothing, never the one asking them to confirm."""

        assert answered(seeded_league, RUHESTAND_OFFEN).unbestaetigt is False

    def test_the_ghost_grants_nothing_whatever_its_row_holds(self, seeded_league: str):
        """Its null address and its retirement keep it out as written; the seed gives it neither, so its id is what this pins."""

        assert answered(seeded_league, GEIST).schiedsrichter == []
