"""
TESTS · the addresses the subject lookup answers

One mailbox seated on two clubs' rows in two seasons, a mailbox whose records all await their own person's confirmation,
one whose referee row is retired, and an administrator's grant. Each suite seeds it on a database of its own.
"""

from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.core.collections import Collection
from app.shared.schemas.literals import KONTAKT_SEATS
from tests.documents import (
    confirmed_referee_document,
    kontaktperson_document,
    saison_team_document,
    school_year_saison_document,
)

# The folded form every record stores the address in. Deliberately unusual, so a hit in a seeded corpus cannot be a
# coincidence.
IDENTIFIER = "ortrud.zwiebelmayer@schule.example.org"

# A mailbox whose every record awaits its own person's confirmation, and one whose every record is
# confirmed on a row that has since been retired.
UNCONFIRMED = "ottilie.wartezeit@schule.example.org"
RETIRED = "rudolf.ruhestand@schule.example.org"

# The grant, stored folded as every grant is.
ADMIN_STORED = "verena.verwaltung@schule.example.org"
GRANT_STORED_OID = ObjectId("6890a1b2c3d4e5f607820052")
GRANT_TYPED = datetime(2026, 1, 1, tzinfo=UTC)

PAST_SAISON = "2425"
ACTIVE_SAISON = "2526"

# Fixed rather than generated, so a failure names the same row every run.
TEAM_A_OID = ObjectId("6890a1b2c3d4e5f607820001")
TEAM_B_OID = ObjectId("6890a1b2c3d4e5f607820002")
TEAM_C_OID = ObjectId("6890a1b2c3d4e5f607820003")
SEAT_ROW_A_OID = ObjectId("6890a1b2c3d4e5f607820011")
SEAT_ROW_B_OID = ObjectId("6890a1b2c3d4e5f607820012")
UNCONFIRMED_ROW_OID = ObjectId("6890a1b2c3d4e5f607820013")
UNCONFIRMED_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607820035")
RETIRED_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607820036")

STAMP = "2026-01-20"


def _person(email: str, *, confirmed_at: str | None = STAMP) -> dict[str, Any]:
    """Every field `app/api/teams/schemas.py :: FLKontaktperson` requires, the address and the stamp the only ones a case reads.

    Stamped by default: the lookup answers a seat only once its own person has confirmed it.
    """

    return kontaktperson_document("Anna", confirmed_at=confirmed_at, last_name="Müller", email=email, phone="+49 69 90009101")


def _junction(row_id: ObjectId, saison_id: str, team_id: ObjectId, *, name: str, **seats: str | dict[str, Any]) -> dict[str, Any]:
    """A `saison_teams` row seating whoever the caller names, an address as a confirmed seat, the seats it does not name left empty."""

    return saison_team_document(
        saison_id,
        team_id,
        name,
        name[:3].upper(),
        _id=row_id,
        kontakte={
            **{seat: None for seat in KONTAKT_SEATS},
            **{seat: _person(held) if isinstance(held, str) else held for seat, held in seats.items()},
            # A declaration about two seats rather than a seat of its own, so it names nobody and
            # no case here turns on it (`app/api/teams/schemas.py :: KONTAKT_SEATS`).
            "trainer_is_also": None,
        },
    )


async def the_subjects_corpus(database: AsyncDatabase) -> None:
    """One corpus for every case: the mailbox's seats, the unconfirmed and the retired mailboxes, and the grant."""

    await database[Collection.SAISONS].insert_many(
        [school_year_saison_document(PAST_SAISON, "past"), school_year_saison_document(ACTIVE_SAISON, "active")]
    )
    await database[Collection.SAISON_TEAMS].insert_many(
        [
            _junction(SEAT_ROW_A_OID, PAST_SAISON, TEAM_A_OID, name="Helmholtz", trainer=IDENTIFIER),
            # One address in TWO seats of one row, which is what a person entered twice is.
            _junction(SEAT_ROW_B_OID, ACTIVE_SAISON, TEAM_B_OID, name="Lessing", trainer=IDENTIFIER, ansprechperson=IDENTIFIER),
            _junction(
                UNCONFIRMED_ROW_OID, ACTIVE_SAISON, TEAM_C_OID, name="Krautzberg", ansprechperson=_person(UNCONFIRMED, confirmed_at=None)
            ),
        ]
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            confirmed_referee_document(UNCONFIRMED_REFEREE_OID, UNCONFIRMED, "F. Wartezeit", einwilligung=None, confirmed_at=STAMP),
            confirmed_referee_document(RETIRED_REFEREE_OID, RETIRED, "G. Ruhestand", inactive_since="2026-03-01", confirmed_at=STAMP),
        ]
    )
    # As a hand-written grant or the grant route stores one: the folded identifier and its tier.
    await database[Collection.GRANTS].insert_one(
        {"_id": GRANT_STORED_OID, "address": ADMIN_STORED, "admin_tier": "administration", "effective_from": GRANT_TYPED}
    )
