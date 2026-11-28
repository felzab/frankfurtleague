"""
TESTS · one person holding a record of every kind an erasure takes, and the league around them

One address holds a pupil row in a live squad, a seat on a season row and on an application beside
two bystanders, a referee row booked on a played fixture and asked to confirm it, a pending and a declined registration,
another referee's and another pupil's pending address change, a pupil row corrected away from the
address, a day's counts, records they made as an administrator, though they hold no grant, and as a
seat holder. Another mailbox at their local part holds records beside them. Each suite seeds it on a
database of its own.
"""

from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.registrierungen.services import compose_decline_update
from app.core.collections import Collection
from app.shared.tokens import hash_token
from tests import documents
from tests.config import ADMIN_KEY
from tests.documents import (
    SCHIEDSRICHTER_TEXT_VERSIONS,
    SPIELER_TEXT_VERSIONS,
    aufstellung_document,
    bericht_document,
    bewerbung_document,
    kontakte_document,
    kontaktperson_document,
    new_schule_document,
    own_einwilligung_document,
    registrierung_document,
    saison_document,
    saison_spieler_document,
    saison_team_document,
    schiedsrichter_document,
    spiel_document,
    spielbericht_document,
    spielbestaetigung_document,
    spieler_document,
    team_document,
)
from tests.erasure import erased
from tests.session_headers import StampedHeaders

PATH = "/api/identity/self/erasure"

# A century ahead of the real clock: the TTL monitor deletes an expired tombstone, request or day's count at its next
# pass, under a case reading it back. Every seeded day moves with it.
SAISON_ID = "2026"
TODAY = "2126-04-01"
YESTERDAY = "2126-03-31"
# Injected through `get_germany_now`, and in summer, so the conversion to the log's stamp moves the clock.
NOW = datetime(2126, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

# The person as a request or a pasted grant may spell them, and the fold every record the league writes stores.
TYPED = "Zorbanax.Quillfeather@Example.org"
IDENTIFIER = "zorbanax.quillfeather@example.org"
FIRST_NAME, LAST_NAME = "Zorbanax", "Quillfeather"
PHONE = "+49 69 90009777"
BIRTH_DATE = "2008-07-14"
# The one their referee row holds, which they typed otherwise.
REFEREE_BIRTH_DATE = "1990-02-03"

# Why they declined to officiate, in their own words.
THEIR_REASON = "Knieverletzung beim Hallenturnier"

# Distinctive, so a hit in a whole-database scan is never coincidence: every value the person holds.
THEIR_VALUES = (
    FIRST_NAME,
    LAST_NAME,
    IDENTIFIER,
    "90009777",
    BIRTH_DATE,
    REFEREE_BIRTH_DATE,
    THEIR_REASON,
)

HOME_TEAM_OID = ObjectId("6890a1b2c3d4e5f607b00001")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607b00002")
PUPIL_OID = ObjectId("6890a1b2c3d4e5f607b00011")
THEIR_KADER_ROW_OID = ObjectId("6890a1b2c3d4e5f607b00013")
OTHER_PUPIL_OID = ObjectId("6890a1b2c3d4e5f607b00012")
REFEREE_OID = ObjectId("6890a1b2c3d4e5f607b00021")
OTHER_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607b00022")
BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607b00031")
BLOCKLESS_BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607b00032")
PENDING_OID = ObjectId("6890a1b2c3d4e5f607b00041")
DECLINED_OID = ObjectId("6890a1b2c3d4e5f607b00042")
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f607b00051")
THEIR_SPIEL_OID = ObjectId("6890a1b2c3d4e5f607b00061")
OTHER_SPIEL_OID = ObjectId("6890a1b2c3d4e5f607b00062")

THEIR_GRANT_OID = ObjectId("6890a1b2c3d4e5f607b00071")
# Another pupil, moving to the person's address: the row is theirs until the change is confirmed.
MOVING_PUPIL_OID = ObjectId("6890a1b2c3d4e5f607b00081")
# A pupil once entered under the person's address and corrected to another: the row is the other's.
READDRESSED_PUPIL_OID = ObjectId("6890a1b2c3d4e5f607b00082")
# Another mailbox at the person's local part, whose records every read narrowed by that local part reaches: the fold
# after each read alone keeps them. Lower case, so no exact scan for the person's names finds it.
ELSEWHERE = IDENTIFIER.replace("@example.org", "@anderswo.example.net")
ELSEWHERE_REGISTRATION_OID = ObjectId("6890a1b2c3d4e5f607b00091")
ELSEWHERE_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607b00092")
ELSEWHERE_GRANT_OID = ObjectId("6890a1b2c3d4e5f607b00093")
REFEREE_MOVING_ELSEWHERE_OID = ObjectId("6890a1b2c3d4e5f607b00094")
PUPIL_MOVING_ELSEWHERE_OID = ObjectId("6890a1b2c3d4e5f607b00095")
ELSEWHERE_SEAT_ROW_OID = ObjectId("6890a1b2c3d4e5f607b00096")
# The pending changes naming the person's address, or the one sharing its local part, as their new one.
OTHER_REFEREE_CHANGE_OID = ObjectId("6890a1b2c3d4e5f607b000c1")
MOVING_PUPIL_CHANGE_OID = ObjectId("6890a1b2c3d4e5f607b000c2")
REFEREE_MOVING_ELSEWHERE_CHANGE_OID = ObjectId("6890a1b2c3d4e5f607b000c3")
PUPIL_MOVING_ELSEWHERE_CHANGE_OID = ObjectId("6890a1b2c3d4e5f607b000c4")

# Their referee row's confirmation, and another referee's.
THEIR_CONFIRMATION_OID = ObjectId("6890a1b2c3d4e5f607b000a1")
OTHER_CONFIRMATION_OID = ObjectId("6890a1b2c3d4e5f607b000a3")
# Their team's open row, which stands: a team's row names its seats by role and never by person.
TEAM_CONFIRMATION_OID = ObjectId("6890a1b2c3d4e5f607b000a4")
OTHER_REASON = "Dienstreise nach Hamburg"

REFEREE_NAME = f"{FIRST_NAME} {LAST_NAME}"
PAYMENT = 25


def their_seat() -> dict[str, Any]:
    return kontaktperson_document(FIRST_NAME, confirmed_at="2126-03-21", last_name=LAST_NAME, email=IDENTIFIER, phone=PHONE)


def referee(schiedsrichter_id: ObjectId, *, email: str, name: str, **fields: Any) -> dict[str, Any]:
    return schiedsrichter_document(
        schiedsrichter_id,
        email=email,
        name=name,
        default_payment=PAYMENT,
        einwilligung=own_einwilligung_document(text_versions=SCHIEDSRICHTER_TEXT_VERSIONS, confirmed_at="2126-03-01"),
        **fields,
    )


def a_registration(registrierung_id: ObjectId, email: str, **fields: Any) -> dict[str, Any]:
    return registrierung_document(
        registrierung_id,
        email,
        saison_id=SAISON_ID,
        team_id=HOME_TEAM_OID,
        first_name=FIRST_NAME,
        last_name=LAST_NAME,
        token=f"token-{registrierung_id}",
        submitted_at="2126-03-25",
        deadline="2126-04-08",
        **fields,
    )


# The reports a referee sent, theirs and another referee's.
THEIR_REPORT_OID = ObjectId("6890a1b2c3d4e5f607b000b1")
OTHER_REPORT_OID = ObjectId("6890a1b2c3d4e5f607b000b2")
OWED_CARRY_OID = ObjectId("6890a1b2c3d4e5f607b000d1")
THEIR_REMARKS = "Flutlicht fiel in der 70. Minute aus."


def a_report(report_id: ObjectId, *, spiel_id: ObjectId) -> dict[str, Any]:
    return spielbericht_document({"_id": spiel_id, "saison_id": SAISON_ID}, _id=report_id, bericht=bericht_document(remarks=THEIR_REMARKS))


async def their_reports(database: AsyncDatabase) -> None:
    await database[Collection.SPIELBERICHTE].insert_many(
        [
            a_report(THEIR_REPORT_OID, spiel_id=THEIR_SPIEL_OID),
            a_report(OTHER_REPORT_OID, spiel_id=OTHER_SPIEL_OID),
        ]
    )


def a_confirmation(row_id: ObjectId, party: dict[str, Any], *, spiel_id: ObjectId) -> dict[str, Any]:
    """An open, unanswered row, as the sweep mints one; a referee's holds no seats."""

    spiel = spiel_document(
        spiel_id=spiel_id,
        saison_id=SAISON_ID,
        spiel_nr=1,
        spieltag_id=SPIELTAG_OID,
        date="2126-03-15",
        time="14:00:00",
        team1={"team_id": HOME_TEAM_OID, "tore": None},
        team2={"team_id": OTHER_TEAM_OID, "tore": None},
    )

    return spielbestaetigung_document(spiel, party=party, _id=row_id, deadline="2126-03-08", asked_at="2126-03-01")


def a_referee(schiedsrichter_id: ObjectId) -> dict[str, Any]:
    return {"kind": "schiedsrichter", "schiedsrichter_id": schiedsrichter_id}


def declined(reason: str) -> dict[str, Any]:
    return {"kind": "declined", "at": "2126-03-03", "by": {"kind": "schiedsrichter"}, "vorschlag": None, "reason": reason}


async def their_confirmations(database: AsyncDatabase) -> None:
    """Their answered row, another referee's, and their team's row."""

    await database[Collection.SPIELBESTAETIGUNGEN].insert_many(
        [
            {
                **a_confirmation(THEIR_CONFIRMATION_OID, a_referee(REFEREE_OID), spiel_id=THEIR_SPIEL_OID),
                "answer": declined(THEIR_REASON),
                "closed": {"reason": "schiedsrichter_switched"},
            },
            {
                **a_confirmation(OTHER_CONFIRMATION_OID, a_referee(OTHER_REFEREE_OID), spiel_id=OTHER_SPIEL_OID),
                "answer": declined(OTHER_REASON),
            },
            a_confirmation(TEAM_CONFIRMATION_OID, {"kind": "team", "team_id": HOME_TEAM_OID}, spiel_id=THEIR_SPIEL_OID),
        ]
    )


async def a_person_holding_everything(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active", start_date="2126-01-01", end_date="2126-06-30"))
    await database[Collection.TEAMS].insert_many(
        [team_document(HOME_TEAM_OID, "Heim-Schule", "HSX"), team_document(OTHER_TEAM_OID, "Gast-Schule", "GSX")]
    )
    await database[Collection.SAISON_TEAMS].insert_one(
        saison_team_document(
            SAISON_ID,
            HOME_TEAM_OID,
            "Heim-Schule",
            "HSX",
            kontakte=kontakte_document(
                ansprechperson=their_seat(),
                stellvertretung=kontaktperson_document("Quillhilde", confirmed_at="2126-03-21"),
                # A day of its own: the journal's seat entry is read from the person's seat, never the row's first confirmed one.
                trainer=kontaktperson_document("Bramblewick", confirmed_at="2126-03-19"),
            ),
        )
    )
    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(
            BEWERBUNG_OID,
            SAISON_ID,
            "submitted",
            kontakte=kontakte_document(
                trainer=their_seat(),
                ansprechperson=kontaktperson_document("Quillhilde"),
                stellvertretung=kontaktperson_document("Bramblewick"),
            ),
            submitted_at="2126-03-10",
            confirmation_deadline="2126-04-10",
            schule=new_schule_document("Neue"),
        )
    )
    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(
            BLOCKLESS_BEWERBUNG_OID,
            SAISON_ID,
            "submitted",
            kontakte=kontakte_document(ansprechperson=their_seat()),
            submitted_at="2126-02-10",
            schule=new_schule_document("Alte"),
        )
    )
    einwilligung = own_einwilligung_document(text_versions=SPIELER_TEXT_VERSIONS, confirmed_at="2126-03-02")
    await database[Collection.SPIELER].insert_many(
        [
            spieler_document(READDRESSED_PUPIL_OID, "Hartwig", "Hartwig-Muster", email="hartwig@example.com", einwilligung=einwilligung),
            spieler_document(PUPIL_OID, FIRST_NAME, LAST_NAME, email=IDENTIFIER, birth_date=BIRTH_DATE, einwilligung=einwilligung),
            spieler_document(OTHER_PUPIL_OID, "Wraxlington", "Wraxlington-Muster", email="wraxlington@example.com", einwilligung=einwilligung),
        ]
    )
    await database[Collection.SAISON_SPIELER].insert_many(
        [
            saison_spieler_document(PUPIL_OID, SAISON_ID, HOME_TEAM_OID, _id=THEIR_KADER_ROW_OID, nummer="7"),
            saison_spieler_document(OTHER_PUPIL_OID, SAISON_ID, HOME_TEAM_OID, nummer="8"),
        ]
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            referee(
                REFEREE_OID,
                email=IDENTIFIER,
                name=REFEREE_NAME,
                birth_date=REFEREE_BIRTH_DATE,
                kontakt={"phone": PHONE, "email": IDENTIFIER},
            ),
            referee(OTHER_REFEREE_OID, email="kraus.bernd@example.com", name="Bernd Kraus"),
        ]
    )
    await database[Collection.SPIELE].insert_many(
        [
            spiel_document(
                spiel_id=spiel_id,
                saison_id=SAISON_ID,
                spiel_nr=spiel_nr,
                spieltag_id=SPIELTAG_OID,
                date="2126-03-15",
                time="14:00:00",
                # As a fixture stores its referee, naming nobody: the name is joined from the referee's row.
                schiedsrichter={"schiedsrichter_id": referee_id, "payment": PAYMENT},
                ergebnis="2:1",
            )
            for spiel_nr, (spiel_id, referee_id) in enumerate(((THEIR_SPIEL_OID, REFEREE_OID), (OTHER_SPIEL_OID, OTHER_REFEREE_OID)), start=1)
        ]
    )
    # The pupil fielded in a match kicked off before `NOW`, so the pupil step has a line-up entry to repoint.
    await database[Collection.AUFSTELLUNGEN].insert_one(
        aufstellung_document({"_id": THEIR_SPIEL_OID, "saison_id": SAISON_ID}, HOME_TEAM_OID, starters=[PUPIL_OID, OTHER_PUPIL_OID])
    )
    await database[Collection.REGISTRIERUNGEN].insert_many(
        [
            a_registration(PENDING_OID, IDENTIFIER),
            a_registration(
                DECLINED_OID,
                IDENTIFIER,
                **compose_decline_update(reason=None, today="2126-03-28")["$set"],
            ),
        ]
    )
    await database[Collection.SPIELER].insert_one(
        spieler_document(MOVING_PUPIL_OID, "Gwendolyn", "Gwendolyn-Muster", email="gwendolyn@example.com", einwilligung=einwilligung)
    )
    await pending_changes(
        database,
        (OTHER_REFEREE_CHANGE_OID, "kraus.bernd@example.com", IDENTIFIER, "their-new-address", "2126-03-28"),
        (MOVING_PUPIL_CHANGE_OID, "gwendolyn@example.com", IDENTIFIER, "her-new-address", "2126-03-29"),
    )
    # An account's carry still owed to them by an earlier change of theirs, ended, its record keeping the two addresses.
    await database[Collection.ADDRESS_CHANGES].insert_one(
        {
            "_id": OWED_CARRY_OID,
            **documents.address_change_document(address="vorher.zorbanax@example.org", email=IDENTIFIER, token_hash=None, day="2126-03-01"),
            "address": None,
            "email": None,
            "ended": {"kind": "effective", "at": NOW},
            "move": {"old": "vorher.zorbanax@example.org", "new": IDENTIFIER},
        }
    )

    await database[Collection.OUTBOX].insert_one(a_mail("spiel_request", to=IDENTIFIER))
    await their_confirmations(database)
    await their_reports(database)
    await a_mailbox_sharing_their_local_part(database)


def a_mail(kind: str, *, to: str) -> dict[str, Any]:
    """A settled row of the Postausgang, as a hand-out's report leaves it."""

    return {
        "key": f"{kind}/{ObjectId()}",
        "kind": kind,
        "to": to,
        "secret": None,
        "reference": None,
        "link": None,
        "team": None,
        "state": "sent",
        # Ahead of the erasure, whose own rows carry its `now` and stand on no line.
        "recorded_at": NOW - timedelta(days=1),
        "deadline": NOW,
        # Far off, so the TTL monitor reads nothing a case is about.
        "erase_at": datetime(2199, 1, 1, tzinfo=UTC),
        "lease": None,
        "leased_until": None,
        "attempts": 1,
        "delivery_reason": None,
        "delivery": None,
    }


async def pending_changes(database: AsyncDatabase, *changes: tuple[ObjectId, str, str, str, str]) -> None:
    """Each `(id, address on file, new address, link, day)` as a start inserts it."""

    await database[Collection.ADDRESS_CHANGES].insert_many(
        [
            {"_id": change_id, **documents.address_change_document(address=address, email=email, token_hash=hash_token(link), day=day)}
            for change_id, address, email, link, day in changes
        ]
    )


async def a_mailbox_sharing_their_local_part(database: AsyncDatabase) -> None:
    await database[Collection.REGISTRIERUNGEN].insert_one(
        registrierung_document(
            ELSEWHERE_REGISTRATION_OID,
            ELSEWHERE,
            saison_id=SAISON_ID,
            team_id=HOME_TEAM_OID,
            first_name="Quendolin",
            last_name="Anderswo",
            token="token-anderswo",
            submitted_at="2126-03-25",
            deadline="2126-04-08",
        )
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            referee(ELSEWHERE_REFEREE_OID, email=ELSEWHERE, name="Quendolin Anderswo"),
            referee(REFEREE_MOVING_ELSEWHERE_OID, email="umzug.dritter@example.com", name="Udo Dritter"),
        ]
    )
    await database[Collection.SPIELER].insert_one(
        spieler_document(
            PUPIL_MOVING_ELSEWHERE_OID,
            "Ulla",
            "Ulla-Muster",
            email="ulla@example.com",
            einwilligung=own_einwilligung_document(text_versions=SPIELER_TEXT_VERSIONS, confirmed_at="2126-03-02"),
        )
    )
    await pending_changes(
        database,
        (REFEREE_MOVING_ELSEWHERE_CHANGE_OID, "umzug.dritter@example.com", ELSEWHERE, "to-anderswo", "2126-03-28"),
        (PUPIL_MOVING_ELSEWHERE_CHANGE_OID, "ulla@example.com", ELSEWHERE, "ulla-to-anderswo", "2126-03-29"),
    )
    await a_grant(database, ELSEWHERE_GRANT_OID, ELSEWHERE, "administration")
    await database[Collection.SAISON_TEAMS].insert_one(
        saison_team_document(
            SAISON_ID,
            OTHER_TEAM_OID,
            "Gast-Schule",
            "GSX",
            _id=ELSEWHERE_SEAT_ROW_OID,
            kontakte=kontakte_document(
                ansprechperson=kontaktperson_document("Quendolin", confirmed_at="2126-03-21", last_name="Anderswo", email=ELSEWHERE)
            ),
        )
    )


GRANTED = datetime(2126, 1, 1, tzinfo=UTC)


async def a_grant(database: AsyncDatabase, grant_id: ObjectId, address: str, admin_tier: str) -> None:
    """A grant by a paste, for the cases about a grant the address holds."""

    await database[Collection.GRANTS].insert_one({"_id": grant_id, "address": address, "admin_tier": admin_tier, "effective_from": GRANTED})


async def everything_in(database: AsyncDatabase) -> dict[str, list[Any]]:
    """Every document of every collection, in a fixed order, so two reads compare equal only where nothing was written."""

    return {name: await database[name].find().sort("_id", 1).to_list(length=None) for name in sorted(await database.list_collection_names())}


def action_log_row(row_id: ObjectId, *, by: str, label: str | None = None) -> dict[str, Any]:
    return {
        "_id": row_id,
        "at": NOW,
        "by": by,
        "team": None,
        "action": "ban.added",
        "record_id": None,
        "saison_id": None,
        "spiel_nr": None,
        "label": label,
        "count": None,
        "trace_id": "t",
    }


def as_person(email: str) -> StampedHeaders:
    return StampedHeaders(email, ADMIN_KEY, lane="person")


async def erased_by_the_handler(database: AsyncDatabase, client: AsyncMongoClient, *, identifier: str = IDENTIFIER, **replaced: Any) -> Any:
    """The route's own function, outside a request: what a case needs to catch the driver's failure itself."""

    return await erased(database, client, identifier, germany_now=NOW, **replaced)
